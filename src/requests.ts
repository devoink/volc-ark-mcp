import { assertBodySize, assertRemoteVideo, MediaError, resolveAudioSource, resolveImageSource } from "./media.js";

export type ImageRequestInput = {
  model: string;
  prompt?: string;
  images?: string[];
  size?: string;
  outputFormat?: "png" | "jpeg";
  background?: "transparent" | "opaque";
  responseFormat?: "url" | "b64_json";
  sequentialImageGeneration?: "auto" | "disabled";
  maxImages?: number;
  optimizePromptMode?: "standard" | "fast";
  layerDecomposition?: boolean;
  layerMaxImages?: number;
  textRecognition?: boolean;
  webSearch?: boolean;
  stream?: boolean;
  watermark?: boolean;
};

export async function buildImageBody(input: ImageRequestInput): Promise<Record<string, unknown>> {
  const images = input.images ?? [];
  const resolved = await Promise.all(images.map((item) => resolveImageSource(item)));
  const body: Record<string, unknown> = {
    model: input.model,
    response_format: input.responseFormat ?? "url",
  };
  if (input.prompt !== undefined) body.prompt = input.prompt;
  if (resolved.length === 1) body.image = resolved[0];
  if (resolved.length > 1) body.image = resolved;
  if (input.size) body.size = input.size;
  if (input.outputFormat) body.output_format = input.outputFormat;
  if (input.background) body.background = input.background;
  if (input.sequentialImageGeneration) body.sequential_image_generation = input.sequentialImageGeneration;
  if (input.maxImages !== undefined) body.sequential_image_generation_options = { max_images: input.maxImages };
  if (input.optimizePromptMode) body.optimize_prompt_options = { mode: input.optimizePromptMode };
  if (input.layerDecomposition !== undefined) body.layer_decomposition = input.layerDecomposition;
  if (input.layerMaxImages !== undefined || input.textRecognition !== undefined) {
    body.layer_decomposition_options = {
      ...(input.layerMaxImages !== undefined ? { max_images: input.layerMaxImages } : {}),
      ...(input.textRecognition !== undefined ? { text_recognition: input.textRecognition } : {}),
    };
  }
  if (input.webSearch) body.tools = [{ type: "web_search" }];
  if (input.stream) body.stream = true;
  if (input.watermark !== undefined) body.watermark = input.watermark;
  assertBodySize(body);
  return body;
}

export type VideoImage = { source: string; role: "first_frame" | "last_frame" | "reference_image" };
export type VideoRef = { source: string; role?: "reference_video" };
export type AudioRef = { source: string; role?: "reference_audio" };

export type VideoRequestInput = {
  model: string;
  prompt?: string;
  images?: VideoImage[];
  videos?: VideoRef[];
  audios?: AudioRef[];
  draftTaskId?: string;
  omniReferenceTaskType?: "auto" | "reference" | "edit" | "extend";
  resolution?: string;
  ratio?: string;
  duration?: number;
  frames?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  outputFormat?: "mp4" | "mov";
  seed?: number;
  cameraFixed?: boolean;
  returnLastFrame?: boolean;
  draft?: boolean;
  serviceTier?: "default" | "flex";
  callbackUrl?: string;
  executionExpiresAfter?: number;
  priority?: number;
  safetyIdentifier?: string;
  webSearch?: boolean;
};

export async function buildVideoBody(input: VideoRequestInput): Promise<{ body: Record<string, unknown>; note?: string }> {
  const content: Array<Record<string, unknown>> = [];
  if (input.prompt) content.push({ type: "text", text: input.prompt });
  for (const image of input.images ?? []) {
    content.push({
      type: "image_url",
      image_url: { url: await resolveImageSource(image.source) },
      role: image.role,
    });
  }
  for (const video of input.videos ?? []) {
    content.push({
      type: "video_url",
      video_url: { url: assertRemoteVideo(video.source) },
      role: "reference_video",
    });
  }
  for (const audio of input.audios ?? []) {
    content.push({
      type: "audio_url",
      audio_url: { url: await resolveAudioSource(audio.source) },
      role: "reference_audio",
    });
  }
  if (input.draftTaskId) content.push({ type: "draft_task", draft_task: { id: input.draftTaskId } });
  if (content.length === 0) throw new MediaError("视频任务至少需要提示词、素材或样片任务 ID。");

  const body: Record<string, unknown> = { model: input.model, content };
  const passthrough: Array<[string, unknown]> = [
    ["omni_reference_task_type", input.omniReferenceTaskType],
    ["resolution", input.resolution],
    ["ratio", input.ratio],
    ["duration", input.duration],
    ["frames", input.frames],
    ["generate_audio", input.generateAudio],
    ["watermark", input.watermark],
    ["output_format", input.outputFormat],
    ["seed", input.seed],
    ["camera_fixed", input.cameraFixed],
    ["return_last_frame", input.returnLastFrame],
    ["draft", input.draft],
    ["service_tier", input.serviceTier],
    ["callback_url", input.callbackUrl],
    ["execution_expires_after", input.executionExpiresAfter],
    ["priority", input.priority],
    ["safety_identifier", input.safetyIdentifier],
  ];
  for (const [key, value] of passthrough) {
    if (value !== undefined) body[key] = value;
  }
  if (input.webSearch) body.tools = [{ type: "web_search" }];
  assertBodySize(body);
  const note = input.duration !== undefined && input.frames !== undefined
    ? "同时传入 duration 和 frames。文档约定 frames 优先，两个值都已原样提交。"
    : undefined;
  return { body, note };
}
