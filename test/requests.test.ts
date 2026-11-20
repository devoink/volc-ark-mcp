import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ArkError, parseImageSse, postJson } from "../src/ark-client.js";
import { MediaError } from "../src/media.js";
import { budgetDecision, estimateImage, estimateVideo } from "../src/pricing/estimate.js";
import { presentImages, presentVideo } from "../src/present.js";
import { redact } from "../src/redact.js";
import { presentModels } from "../src/models.js";
import { buildImageBody, buildVideoBody } from "../src/requests.js";
import { setupSteps } from "../src/setup.js";

test("list_models 默认只要生图生视频，并给出选用规则", () => {
  const listed = presentModels({
    object: "list",
    data: [
      {
        id: "doubao-seedream-5-5-261028",
        name: "doubao-seedream-5-5",
        version: "261028",
        domain: "ImageGeneration",
        status: "Published",
        created: 200,
        task_type: ["text_to_image"],
        modalities: { input_modalities: ["text", "image"], output_modalities: ["image"] },
      },
      {
        id: "doubao-seedream-4-0-250828",
        name: "doubao-seedream-4-0",
        version: "250828",
        domain: "ImageGeneration",
        status: "Published",
        created: 100,
      },
      {
        id: "doubao-seedance-2-5-260628",
        name: "doubao-seedance-2-5",
        version: "260628",
        domain: "VideoGeneration",
        status: "Published",
        created: 150,
      },
      {
        id: "doubao-seed-2-1-pro-260915",
        name: "doubao-seed-2-1-pro",
        version: "260915",
        domain: "VLM",
        status: "Published",
      },
    ],
  });
  assert.equal(listed.count, 3);
  assert.equal(listed.models[0]?.id, "doubao-seedream-5-5-261028");
  assert.match(listed.models[0]?.pick_hint ?? "", /透明|首选/);
  assert.equal(listed.models[0]?.capabilities?.transparent_background, true);
  assert.ok(listed.selection_guide.length > 0);
  const transparent = presentModels({ object: "list", data: listed.models }, { use_case: "transparent_background" });
  assert.deepEqual(transparent.models.map((item) => item.id), ["doubao-seedream-5-5-261028"]);
  const sequential = presentModels({ object: "list", data: listed.models }, { use_case: "sequential_images" });
  assert.deepEqual(sequential.models.map((item) => item.id), ["doubao-seedream-4-0-250828"]);
  const llm = presentModels({
    object: "list",
    data: [{ id: "doubao-seed-2-1-pro-260915", domain: "VLM", status: "Published" }],
  }, { domain: "VLM" });
  assert.equal(llm.count, 1);
});

test("图片请求组装组图、图层拆分和 web_search", async () => {
  const body = await buildImageBody({
    model: "doubao-seedream-5-5",
    prompt: "同一只猫的三视图",
    images: ["https://example.com/a.png", "asset://cat"],
    size: "2048x2048",
    outputFormat: "png",
    background: "opaque",
    sequentialImageGeneration: "auto",
    maxImages: 3,
    optimizePromptMode: "standard",
    layerDecomposition: true,
    layerMaxImages: 4,
    textRecognition: true,
    webSearch: true,
    watermark: false,
  });

  assert.equal(body.model, "doubao-seedream-5-5");
  assert.deepEqual(body.image, ["https://example.com/a.png", "asset://cat"]);
  assert.equal(body.response_format, "url");
  assert.equal(body.sequential_image_generation, "auto");
  assert.deepEqual(body.sequential_image_generation_options, { max_images: 3 });
  assert.deepEqual(body.optimize_prompt_options, { mode: "standard" });
  assert.equal(body.layer_decomposition, true);
  assert.deepEqual(body.layer_decomposition_options, { max_images: 4, text_recognition: true });
  assert.deepEqual(body.tools, [{ type: "web_search" }]);
  assert.equal(body.watermark, false);
});

test("本机图片转成 data URI", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "seedance-"));
  const file = path.join(dir, "dot.png");
  await writeFile(file, Buffer.from("iVBORw0KGgo=", "base64"));
  const body = await buildImageBody({ model: "doubao-seedream-4-0", prompt: "点", images: [file] });
  assert.equal(body.image, "data:image/png;base64,iVBORw0KGgo=");
});

test("视频 content 角色，frames 与 duration 同时提交", async () => {
  const { body, note } = await buildVideoBody({
    model: "doubao-seedance-2-5-260628",
    prompt: "橘猫转头看向镜头",
    images: [{ source: "https://example.com/cat.png", role: "first_frame" }],
    videos: [{ source: "asset://clip" }],
    audios: [{ source: "https://example.com/meow.mp3" }],
    draftTaskId: "cgt-draft",
    duration: 5,
    frames: 120,
    webSearch: true,
  });
  assert.deepEqual(body.content, [
    { type: "text", text: "橘猫转头看向镜头" },
    { type: "image_url", image_url: { url: "https://example.com/cat.png" }, role: "first_frame" },
    { type: "video_url", video_url: { url: "asset://clip" }, role: "reference_video" },
    { type: "audio_url", audio_url: { url: "https://example.com/meow.mp3" }, role: "reference_audio" },
    { type: "draft_task", draft_task: { id: "cgt-draft" } },
  ]);
  assert.equal(body.duration, 5);
  assert.equal(body.frames, 120);
  assert.deepEqual(body.tools, [{ type: "web_search" }]);
  assert.match(note ?? "", /frames 优先/);
});

test("本机视频和 Base64 视频被拒绝", async () => {
  await assert.rejects(
    () => buildVideoBody({ model: "m", videos: [{ source: "/tmp/cat.mp4" }] }),
    (error: unknown) => error instanceof MediaError && /本机视频/.test(error.message),
  );
  await assert.rejects(
    () => buildVideoBody({ model: "m", videos: [{ source: "data:video/mp4;base64,AAAA" }] }),
    (error: unknown) => error instanceof MediaError && /Base64/.test(error.message),
  );
});

test("图片 SSE 聚合成最终结果", () => {
  const events = parseImageSse([
    'data: {"type":"image_generation.partial_succeeded","image_index":0,"url":"https://example.com/a.png","size":"2048x2048"}',
    "",
    'data: {"type":"image_generation.partial_failed","image_index":1,"error":{"code":"OutputImageSensitiveContentDetected","message":"输出图片未通过内容审核。"}}',
    "data: [DONE]",
  ].join("\n"));
  const presented = presentImages({ stream: true, events, usage: { generated_images: 1 } }, "url");
  assert.equal(presented.images.length, 2);
  assert.equal(presented.images[0]?.url, "https://example.com/a.png");
  assert.equal(presented.images[0]?.b64_json, undefined);
  assert.equal(presented.images[1]?.url, undefined);
  assert.equal(presented.images[1]?.error?.code, "OutputImageSensitiveContentDetected");
  assert.equal(presented.partialFailures, 1);
});

test("错误文本里的 Key 被替换", async () => {
  assert.equal(redact("token sk-test appeared as sk-test", "sk-test"), "token [redacted] appeared as [redacted]");
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    error: { code: "AuthenticationError", message: "rejected sk-live-key" },
  }), { status: 401, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => postJson({ apiKey: "sk-live-key", baseUrl: "https://example.com", fetchImpl }, "/api/v3/images/generations", {}),
    (error: unknown) => {
      assert.ok(error instanceof ArkError);
      assert.equal(error.code, "AuthenticationError");
      assert.equal(error.message.includes("sk-live-key"), false);
      assert.match(error.message, /\[redacted\]/);
      return true;
    },
  );
});

test("Seedance 2.5 无输入视频 16:9 五秒的公示价", () => {
  const input = {
    model: "doubao-seedance-2-5-260628",
    ratio: "16:9",
    duration: 5,
  };
  assert.equal(estimateVideo({ ...input, resolution: "480p" }).amount_cny, 3.36);
  assert.equal(estimateVideo({ ...input, resolution: "720p" }).amount_cny, 7.56);
});

test("图片按像素档给单点价，组图给区间", () => {
  const pro2k = estimateImage({ model: "doubao-seedream-5-0-pro", size: "2K" });
  const pro1k = estimateImage({ model: "doubao-seedream-5-0-pro", size: "1K" });
  const exact = estimateImage({ model: "doubao-seedream-5-0-pro", size: "2048x2048" });
  assert.equal(pro2k.amount_cny, 0.6);
  assert.equal(pro1k.amount_cny, 0.3);
  assert.equal(exact.amount_cny, 0.6);
  const group = estimateImage({
    model: "doubao-seedream-5-5",
    size: "2K",
    sequential: "auto",
    maxImages: 2,
  });
  assert.deepEqual(group.amount_range_cny, { min: 0.23, max: 0.46 });
});

test("估价上界超过 max_cny 或无法确定时拦截", () => {
  const estimate = estimateVideo({
    model: "doubao-seedance-2-5-260628",
    resolution: "720p",
    ratio: "16:9",
    duration: 5,
  });
  assert.deepEqual(budgetDecision(estimate, 5), { ok: false, reason: "estimate_exceeds_max_cny" });
  assert.deepEqual(budgetDecision(estimate, 7.56), { ok: true });
  assert.deepEqual(budgetDecision(estimate, undefined), { ok: true });
  const unresolved = estimateVideo({ model: "unknown-model", resolution: "720p", duration: 5 });
  assert.deepEqual(budgetDecision(unresolved, 100), { ok: false, reason: "estimate_unresolved" });
});

test("查询结果带 Seedance 2.5 下载上限，并保留 usage", () => {
  const presented = presentVideo({
    id: "cgt-1",
    model: "doubao-seedance-2-5-260628",
    status: "succeeded",
    resolution: "720p",
    ratio: "16:9",
    duration: 5,
    framespersecond: 24,
    content: { video_url: "https://example.com/cat.mp4" },
    usage: { completion_tokens: 108000 },
  });
  const video = presented.video as { url: string; download_limit: number; frames_per_second: number };
  assert.equal(video.url, "https://example.com/cat.mp4");
  assert.equal(video.download_limit, 100);
  assert.equal(video.frames_per_second, 24);
  assert.deepEqual(presented.usage, { completion_tokens: 108000 });
  const estimate = presented.estimate as { amount_cny: number };
  assert.equal(estimate.amount_cny, 7.56);
});

test("三个平台使用同一套凭据库引导", () => {
  const steps = setupSteps().join("\n");
  assert.match(steps, /volc-ark-mcp config set/);
  assert.match(steps, /volc-ark-mcp config list/);
  assert.match(steps, /volc-ark-mcp config delete/);
  assert.match(steps, /钥匙串/);
  assert.match(steps, /凭据管理器/);
  assert.match(steps, /Secret Service/);
  assert.equal(steps.includes("launchctl"), false);
  assert.equal(steps.includes("~/.zshrc"), false);
});
