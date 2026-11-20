import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ArkError, deleteJson, getJson, postImage, postJson } from "./ark-client.js";
import { readBaseUrl, readDefaultModel, resolveApiKey } from "./config.js";
import { runCli } from "./cli.js";
import { MediaError, readLocalImageSize } from "./media.js";
import { budgetDecision, estimateImage, estimateVideo, type Estimate } from "./pricing/estimate.js";
import { attachImages, presentImages, presentTaskList, presentVideo } from "./present.js";
import { redact } from "./redact.js";
import { buildImageBody, buildVideoBody, type ImageRequestInput, type VideoRequestInput } from "./requests.js";
import { REPLY_GUIDE, toolResult, type ToolPayload } from "./result.js";
import { setupGuide, setupRequired } from "./setup.js";

const imageSchema = {
  model: z.string().optional().describe("模型 ID 或 Endpoint ID。缺省时用 ARK_IMAGE_MODEL。"),
  prompt: z.string().optional().describe("提示词。普通生图需要；图层拆分可以不传。"),
  images: z.array(z.string()).optional().describe("参考图。可以是公网 URL、asset://、data URI 或本机路径。"),
  size: z.string().optional().describe("1K、1.5K、2K，或宽x高。"),
  output_format: z.enum(["png", "jpeg"]).optional(),
  background: z.enum(["transparent", "opaque"]).optional(),
  response_format: z.enum(["url", "b64_json"]).optional().describe("默认 url。只有明确要 b64_json 时才把 base64 放进 JSON。"),
  sequential_image_generation: z.enum(["auto", "disabled"]).optional(),
  max_images: z.number().int().min(1).max(15).optional().describe("组图最多张数。参考图数量加生成数量不超过 15。"),
  optimize_prompt_mode: z.enum(["standard", "fast"]).optional(),
  layer_decomposition: z.boolean().optional(),
  layer_max_images: z.number().int().min(2).max(100).optional(),
  text_recognition: z.boolean().optional(),
  web_search: z.boolean().optional(),
  stream: z.boolean().optional().describe("方舟侧流式返回。MCP 读完后仍只给一份结果。"),
  watermark: z.boolean().optional(),
  max_cny: z.number().positive().optional().describe("公示价上界超过该金额，或无法确定上界时，不提交生成。"),
};

const videoSchema = {
  model: z.string().optional().describe("模型 ID 或 Endpoint ID。缺省时用 ARK_VIDEO_MODEL。"),
  prompt: z.string().optional(),
  images: z.array(z.object({
    source: z.string(),
    role: z.enum(["first_frame", "last_frame", "reference_image"]),
  })).optional(),
  videos: z.array(z.object({ source: z.string() })).optional().describe("公网 URL 或 asset://。不接受本机路径和 Base64。"),
  audios: z.array(z.object({ source: z.string() })).optional(),
  draft_task_id: z.string().optional(),
  omni_reference_task_type: z.enum(["auto", "reference", "edit", "extend"]).optional(),
  resolution: z.string().optional(),
  ratio: z.string().optional(),
  duration: z.number().optional(),
  frames: z.number().int().optional(),
  generate_audio: z.boolean().optional(),
  watermark: z.boolean().optional(),
  output_format: z.enum(["mp4", "mov"]).optional(),
  seed: z.number().int().optional(),
  camera_fixed: z.boolean().optional(),
  return_last_frame: z.boolean().optional(),
  draft: z.boolean().optional(),
  service_tier: z.enum(["default", "flex"]).optional(),
  callback_url: z.string().optional(),
  execution_expires_after: z.number().int().optional(),
  priority: z.number().int().min(0).max(9).optional(),
  safety_identifier: z.string().max(64).optional(),
  web_search: z.boolean().optional(),
  input_video_seconds: z.number().nonnegative().optional().describe("参考视频总秒数，只用于估价，不提交给生成接口。"),
  source_had_input_video: z.boolean().optional().describe("样片转正式时，第一步是否含输入视频。"),
  max_cny: z.number().positive().optional(),
};

type ImageArgs = {
  model?: string;
  prompt?: string;
  images?: string[];
  size?: string;
  output_format?: "png" | "jpeg";
  background?: "transparent" | "opaque";
  response_format?: "url" | "b64_json";
  sequential_image_generation?: "auto" | "disabled";
  max_images?: number;
  optimize_prompt_mode?: "standard" | "fast";
  layer_decomposition?: boolean;
  layer_max_images?: number;
  text_recognition?: boolean;
  web_search?: boolean;
  stream?: boolean;
  watermark?: boolean;
  max_cny?: number;
};

type VideoArgs = {
  model?: string;
  prompt?: string;
  images?: Array<{ source: string; role: "first_frame" | "last_frame" | "reference_image" }>;
  videos?: Array<{ source: string }>;
  audios?: Array<{ source: string }>;
  draft_task_id?: string;
  omni_reference_task_type?: "auto" | "reference" | "edit" | "extend";
  resolution?: string;
  ratio?: string;
  duration?: number;
  frames?: number;
  generate_audio?: boolean;
  watermark?: boolean;
  output_format?: "mp4" | "mov";
  seed?: number;
  camera_fixed?: boolean;
  return_last_frame?: boolean;
  draft?: boolean;
  service_tier?: "default" | "flex";
  callback_url?: string;
  execution_expires_after?: number;
  priority?: number;
  safety_identifier?: string;
  web_search?: boolean;
  input_video_seconds?: number;
  source_had_input_video?: boolean;
  max_cny?: number;
};

async function requireKey(): Promise<ToolPayload | undefined> {
  if (await resolveApiKey()) return undefined;
  return toolResult(setupRequired(), [], true);
}

async function fail(error: unknown): Promise<ToolPayload> {
  const secret = await resolveApiKey();
  if (error instanceof ArkError) {
    return toolResult({ ok: false, kind: "error", error: { code: error.code, message: error.message } }, [], true);
  }
  if (error instanceof MediaError) {
    return toolResult({ ok: false, kind: "error", error: { code: "media", message: error.message } }, [], true);
  }
  const message = error instanceof Error ? error.message : String(error);
  return toolResult({ ok: false, kind: "error", error: { code: "internal", message: redact(message, secret) } }, [], true);
}

function rejectBudget(estimate: Estimate, maxCny: number, reason: "estimate_exceeds_max_cny" | "estimate_unresolved"): ToolPayload {
  return toolResult({ ok: false, kind: "rejected", reason, max_cny: maxCny, estimate }, [], true);
}

function imageInput(args: ImageArgs, model: string): ImageRequestInput {
  return {
    model,
    prompt: args.prompt,
    images: args.images,
    size: args.size,
    outputFormat: args.output_format,
    background: args.background,
    responseFormat: args.response_format,
    sequentialImageGeneration: args.sequential_image_generation,
    maxImages: args.max_images,
    optimizePromptMode: args.optimize_prompt_mode,
    layerDecomposition: args.layer_decomposition,
    layerMaxImages: args.layer_max_images,
    textRecognition: args.text_recognition,
    webSearch: args.web_search,
    stream: args.stream,
    watermark: args.watermark,
  };
}

function videoInput(args: VideoArgs, model: string): VideoRequestInput {
  return {
    model,
    prompt: args.prompt,
    images: args.images,
    videos: args.videos,
    audios: args.audios,
    draftTaskId: args.draft_task_id,
    omniReferenceTaskType: args.omni_reference_task_type,
    resolution: args.resolution,
    ratio: args.ratio,
    duration: args.duration,
    frames: args.frames,
    generateAudio: args.generate_audio,
    watermark: args.watermark,
    outputFormat: args.output_format,
    seed: args.seed,
    cameraFixed: args.camera_fixed,
    returnLastFrame: args.return_last_frame,
    draft: args.draft,
    serviceTier: args.service_tier,
    callbackUrl: args.callback_url,
    executionExpiresAfter: args.execution_expires_after,
    priority: args.priority,
    safetyIdentifier: args.safety_identifier,
    webSearch: args.web_search,
  };
}

async function videoEstimate(args: VideoArgs, model: string): Promise<Estimate> {
  const first = args.images?.find((item) => item.role === "first_frame");
  const firstFrame = first ? await readLocalImageSize(first.source) ?? undefined : undefined;
  return estimateVideo({
    model,
    resolution: args.resolution,
    ratio: args.ratio,
    duration: args.duration,
    frames: args.frames,
    draft: args.draft,
    draftTaskId: args.draft_task_id,
    serviceTier: args.service_tier,
    hasInputVideo: (args.videos?.length ?? 0) > 0,
    inputVideoSeconds: args.input_video_seconds,
    sourceHadInputVideo: args.source_had_input_video,
    firstFrame: firstFrame ?? undefined,
    webSearch: args.web_search,
  });
}

const server = new McpServer({ name: "volc-ark-mcp", version: "0.1.0" });

server.registerTool("setup_guide", {
  description: "说明如何在 macOS 或 Windows 上把 ARK_API_KEY 设为系统环境变量。不需要 Key。",
  inputSchema: {},
}, async () => toolResult(setupGuide()));

const estimateSchema = {
  modality: z.enum(["image", "video"]),
  model: z.string().optional().describe("模型 ID。缺省时按 modality 读取 ARK_IMAGE_MODEL 或 ARK_VIDEO_MODEL。"),
  prompt: z.string().optional(),
  images: z.array(z.union([
    z.string(),
    z.object({
      source: z.string(),
      role: z.enum(["first_frame", "last_frame", "reference_image"]),
    }),
  ])).optional().describe("生图时传 URL 或本机路径字符串。生视频时传带 role 的图片。"),
  size: imageSchema.size,
  output_format: z.enum(["png", "jpeg", "mp4", "mov"]).optional(),
  background: imageSchema.background,
  sequential_image_generation: imageSchema.sequential_image_generation,
  max_images: imageSchema.max_images,
  layer_decomposition: imageSchema.layer_decomposition,
  layer_max_images: imageSchema.layer_max_images,
  web_search: z.boolean().optional(),
  videos: videoSchema.videos,
  audios: videoSchema.audios,
  draft_task_id: videoSchema.draft_task_id,
  resolution: videoSchema.resolution,
  ratio: videoSchema.ratio,
  duration: videoSchema.duration,
  frames: videoSchema.frames,
  generate_audio: videoSchema.generate_audio,
  draft: videoSchema.draft,
  service_tier: videoSchema.service_tier,
  input_video_seconds: videoSchema.input_video_seconds,
  source_had_input_video: videoSchema.source_had_input_video,
};

server.registerTool("estimate_generation_cost", {
  description: `按公示价估算生图或生视频费用，不调用生成接口。${REPLY_GUIDE}`,
  inputSchema: estimateSchema,
}, async (args) => {
  try {
    const model = args.model || readDefaultModel(args.modality);
    if (!model) return toolResult({ ok: false, kind: "error", error: { code: "model_required", message: "需要 model，或设置对应的 ARK_IMAGE_MODEL / ARK_VIDEO_MODEL。" } }, [], true);
    const videoImages = (args.images ?? []).flatMap((item) => typeof item === "string" ? [] : [item]);
    const estimate = args.modality === "image"
      ? estimateImage({
          model,
          size: args.size,
          imageCount: args.images?.length ?? 0,
          sequential: args.sequential_image_generation,
          maxImages: args.layer_decomposition ? args.layer_max_images : args.max_images,
          layerDecomposition: args.layer_decomposition,
          webSearch: args.web_search,
        })
      : await videoEstimate({
          images: videoImages,
          videos: args.videos,
          resolution: args.resolution,
          ratio: args.ratio,
          duration: args.duration,
          frames: args.frames,
          generate_audio: args.generate_audio,
          draft: args.draft,
          draft_task_id: args.draft_task_id,
          service_tier: args.service_tier,
          input_video_seconds: args.input_video_seconds,
          source_had_input_video: args.source_had_input_video,
          web_search: args.web_search,
        }, model);
    return toolResult({ ok: true, kind: "estimate", modality: args.modality, model, ...estimate });
  } catch (error) {
    return fail(error);
  }
});

server.registerTool("generate_image", {
  description: `同步生成图片。默认返回 24 小时内有效的 URL，并附上可显示的图像。${REPLY_GUIDE}`,
  inputSchema: imageSchema,
}, async (args: ImageArgs) => {
  const missing = await requireKey();
  if (missing) return missing;
  try {
    const model = args.model || readDefaultModel("image");
    if (!model) return toolResult({ ok: false, kind: "error", error: { code: "model_required", message: "需要 model，或设置 ARK_IMAGE_MODEL。" } }, [], true);
    if (!args.prompt && !args.layer_decomposition) {
      return toolResult({ ok: false, kind: "error", error: { code: "prompt_required", message: "普通生图需要 prompt。" } }, [], true);
    }
    const estimate = estimateImage({
      model,
      size: args.size,
      imageCount: args.images?.length ?? 0,
      sequential: args.sequential_image_generation,
      maxImages: args.layer_decomposition ? args.layer_max_images : args.max_images,
      layerDecomposition: args.layer_decomposition,
      webSearch: args.web_search,
    });
    const decision = budgetDecision(estimate, args.max_cny);
    if (!decision.ok) return rejectBudget(estimate, args.max_cny!, decision.reason);
    const format = args.response_format ?? "url";
    const body = await buildImageBody(imageInput(args, model));
    const raw = await postImage({ apiKey: (await resolveApiKey())!, baseUrl: readBaseUrl() }, body, Boolean(args.stream));
    const presented = presentImages(raw, format);
    const blocks = format === "url" ? await attachImages(presented.images.flatMap((item) => item.url ? [item.url] : [])) : [];
    const layerFailed = Boolean(args.layer_decomposition) && presented.partialFailures > 0;
    return toolResult({
      ok: !layerFailed,
      kind: "image_result",
      model: presented.model ?? model,
      images: presented.images,
      usage: presented.usage,
      partial_failures: presented.partialFailures,
      request: { model, prompt: args.prompt, size: args.size },
      estimate,
    }, blocks, layerFailed);
  } catch (error) {
    return fail(error);
  }
});

server.registerTool("create_video_task", {
  description: `提交视频任务并立即返回任务 ID。queued 和 running 不是失败，不要再次创建。${REPLY_GUIDE}`,
  inputSchema: videoSchema,
}, async (args: VideoArgs) => {
  const missing = await requireKey();
  if (missing) return missing;
  try {
    const model = args.model || readDefaultModel("video");
    if (!model) return toolResult({ ok: false, kind: "error", error: { code: "model_required", message: "需要 model，或设置 ARK_VIDEO_MODEL。" } }, [], true);
    const estimate = await videoEstimate(args, model);
    const decision = budgetDecision(estimate, args.max_cny);
    if (!decision.ok) return rejectBudget(estimate, args.max_cny!, decision.reason);
    const { body, note } = await buildVideoBody(videoInput(args, model));
    const created = await postJson<Record<string, unknown>>({ apiKey: (await resolveApiKey())!, baseUrl: readBaseUrl() }, "/api/v3/contents/generations/tasks", body);
    return toolResult({
      ok: true,
      kind: "video_task",
      id: created.id,
      status: created.status ?? "queued",
      model,
      ...(note ? { note } : {}),
      next: "调用 get_video_task，直到 status 为 succeeded、failed、cancelled 或 expired。queued 和 running 都不是失败，不要重新 create_video_task。",
      request: {
        model,
        prompt: args.prompt,
        resolution: args.resolution,
        ratio: args.ratio,
        duration: args.duration,
        generate_audio: args.generate_audio,
      },
      estimate,
    });
  } catch (error) {
    return fail(error);
  }
});

server.registerTool("get_video_task", {
  description: `查询一个视频任务。succeeded 时返回视频 URL；有尾帧 URL 时附上尾帧图。${REPLY_GUIDE}`,
  inputSchema: { id: z.string() },
}, async ({ id }) => {
  const missing = await requireKey();
  if (missing) return missing;
  try {
    const payload = await getJson({ apiKey: (await resolveApiKey())!, baseUrl: readBaseUrl() }, `/api/v3/contents/generations/tasks/${encodeURIComponent(id)}`);
    const presented = presentVideo(payload);
    const video = presented.video as { last_frame_url?: string } | null;
    const blocks = video?.last_frame_url ? await attachImages([video.last_frame_url]) : [];
    return toolResult(presented, blocks);
  } catch (error) {
    return fail(error);
  }
});

server.registerTool("list_video_tasks", {
  description: "按模型、服务等级、状态或任务 ID 列出视频任务。",
  inputSchema: {
    model: z.string().optional(),
    service_tier: z.enum(["default", "flex"]).optional(),
    status: z.enum(["queued", "running", "cancelled", "succeeded", "failed"]).optional(),
    task_ids: z.array(z.string()).optional(),
    page_num: z.number().int().positive().optional(),
    page_size: z.number().int().positive().optional(),
  },
}, async (args) => {
  const missing = await requireKey();
  if (missing) return missing;
  try {
    const params = new URLSearchParams();
    if (args.model) params.append("filter.model", args.model);
    if (args.service_tier) params.append("filter.service_tier", args.service_tier);
    if (args.status) params.append("filter.status", args.status);
    for (const id of args.task_ids ?? []) params.append("filter.task_ids", id);
    if (args.page_num) params.append("page_num", String(args.page_num));
    if (args.page_size) params.append("page_size", String(args.page_size));
    const query = params.size ? `?${params.toString()}` : "";
    const payload = await getJson({ apiKey: (await resolveApiKey())!, baseUrl: readBaseUrl() }, `/api/v3/contents/generations/tasks${query}`);
    return toolResult(presentTaskList(payload));
  } catch (error) {
    return fail(error);
  }
});

server.registerTool("delete_video_task", {
  description: "取消或删除视频任务。文档写明只有 queued 可以取消，取消后 24 小时自动删除。",
  inputSchema: { id: z.string() },
}, async ({ id }) => {
  const missing = await requireKey();
  if (missing) return missing;
  try {
    await deleteJson({ apiKey: (await resolveApiKey())!, baseUrl: readBaseUrl() }, `/api/v3/contents/generations/tasks/${encodeURIComponent(id)}`);
    return toolResult({ ok: true, kind: "video_task_deleted", id });
  } catch (error) {
    return fail(error);
  }
});

const cliArgs = process.argv.slice(2);
if (cliArgs.length > 0) {
  process.exit(await runCli(cliArgs));
}

if (!(await resolveApiKey())) {
  console.error("缺少 ARK_API_KEY。运行 volc-ark-mcp config set，或调用 setup_guide。");
}

const transport = new StdioServerTransport();
await server.connect(transport);
