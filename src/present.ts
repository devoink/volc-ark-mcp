import type { ImageSseEvent } from "./ark-client.js";
import { estimateVideo, type Estimate } from "./pricing/estimate.js";
import type { ImageBlock } from "./result.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BLOCKS = 4;

type FetchImpl = typeof fetch;

export type PresentedImage = {
  index: number;
  url?: string;
  b64_json?: string;
  expires_in_hours?: number;
  size?: string;
  output_format?: string;
  background?: string;
  layer: {
    z_index?: number;
    name?: string;
    description?: string;
    bounding_box?: unknown;
    text_recognition?: unknown;
  } | null;
  error: { code?: string; message?: string } | null;
};

export function presentImages(payload: unknown, responseFormat: "url" | "b64_json"): { model?: string; images: PresentedImage[]; usage: unknown; partialFailures: number } {
  const record = asRecord(payload);
  if (record.stream === true && Array.isArray(record.events)) {
    return presentEvents(record.events as ImageSseEvent[], responseFormat);
  }
  const data = Array.isArray(record.data) ? record.data : [];
  const images = data.map((item, index) => presentOne(asRecord(item), index, responseFormat));
  return {
    model: typeof record.model === "string" ? record.model : undefined,
    images,
    usage: record.usage ?? {},
    partialFailures: images.filter((item) => item.error).length,
  };
}

function presentEvents(events: ImageSseEvent[], responseFormat: "url" | "b64_json"): { model?: string; images: PresentedImage[]; usage: unknown; partialFailures: number } {
  const byIndex = new Map<number, PresentedImage>();
  let model: string | undefined;
  let usage: unknown = {};
  for (const event of events) {
    if (event.model) model = event.model;
    if (event.usage) usage = event.usage;
    if (event.image_index === undefined) continue;
    const current = presentOne(event as unknown as Record<string, unknown>, event.image_index, responseFormat);
    byIndex.set(event.image_index, current);
  }
  const images = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
  return { model, images, usage, partialFailures: images.filter((item) => item.error).length };
}

function presentOne(item: Record<string, unknown>, index: number, responseFormat: "url" | "b64_json"): PresentedImage {
  const error = item.error && typeof item.error === "object" ? item.error as { code?: string; message?: string } : null;
  const layerFields = ["z_index", "name", "description", "bounding_box", "text_recognition"] as const;
  const hasLayer = layerFields.some((key) => item[key] !== undefined);
  const image: PresentedImage = {
    index,
    expires_in_hours: typeof item.url === "string" ? 24 : undefined,
    size: typeof item.size === "string" ? item.size : undefined,
    output_format: typeof item.output_format === "string" ? item.output_format : undefined,
    background: typeof item.background === "string" ? item.background : undefined,
    layer: hasLayer ? {
      z_index: typeof item.z_index === "number" ? item.z_index : undefined,
      name: typeof item.name === "string" ? item.name : undefined,
      description: typeof item.description === "string" ? item.description : undefined,
      bounding_box: item.bounding_box,
      text_recognition: item.text_recognition,
    } : null,
    error,
  };
  if (!error && typeof item.url === "string") image.url = item.url;
  if (!error && responseFormat === "b64_json" && typeof item.b64_json === "string") image.b64_json = item.b64_json;
  if (!image.url) delete image.expires_in_hours;
  return image;
}

export function presentVideo(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  const content = asRecord(record.content);
  const status = typeof record.status === "string" ? record.status : "unknown";
  const model = typeof record.model === "string" ? record.model : undefined;
  const video = status === "succeeded" ? compactVideo(record, content, model) : null;
  const request = taskRequest(record);
  return {
    ok: true,
    kind: "video_task_status",
    id: record.id,
    status,
    ...(model ? { model } : {}),
    video,
    usage: record.usage ?? {},
    error: record.error ?? null,
    request,
    estimate: taskEstimate(record),
  };
}

function taskRequest(record: Record<string, unknown>): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  if (typeof record.model === "string") request.model = record.model;
  const prompt = promptFrom(record.content);
  if (prompt) request.prompt = prompt;
  for (const key of ["resolution", "ratio", "duration", "generate_audio"] as const) {
    if (record[key] !== undefined && record[key] !== null) request[key] = record[key];
  }
  return request;
}

function taskEstimate(record: Record<string, unknown>): Estimate | null {
  if (typeof record.model !== "string") return null;
  const content = Array.isArray(record.content) ? record.content : [];
  const hasInputVideo = content.some((item) => asRecord(item).type === "video_url");
  return estimateVideo({
    model: record.model,
    resolution: typeof record.resolution === "string" ? record.resolution : undefined,
    ratio: typeof record.ratio === "string" ? record.ratio : undefined,
    duration: typeof record.duration === "number" ? record.duration : undefined,
    frames: typeof record.frames === "number" ? record.frames : undefined,
    draft: record.draft === true ? true : undefined,
    serviceTier: typeof record.service_tier === "string" ? record.service_tier : undefined,
    hasInputVideo,
  });
}

function promptFrom(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    const row = asRecord(item);
    if (row.type === "text" && typeof row.text === "string") return row.text;
  }
  return undefined;
}

function compactVideo(record: Record<string, unknown>, content: Record<string, unknown>, model: string | undefined): Record<string, unknown> {
  const video: Record<string, unknown> = {};
  if (typeof content.video_url === "string") {
    video.url = content.video_url;
    video.expires_in_hours = 24;
  }
  if (typeof content.last_frame_url === "string") video.last_frame_url = content.last_frame_url;
  for (const key of ["duration", "frames", "ratio", "resolution", "generate_audio", "draft", "seed"] as const) {
    if (record[key] !== undefined && record[key] !== null) video[key] = record[key];
  }
  if (record.framespersecond !== undefined) video.frames_per_second = record.framespersecond;
  if (record.output_format !== undefined) video.output_format = record.output_format;
  if (model && /seedance[-.]2[-.]5(?![-.]flash)/i.test(model)) video.download_limit = 100;
  return video;
}

export function presentTaskList(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  const items = Array.isArray(record.items) ? record.items : Array.isArray(record.data) ? record.data : [];
  return {
    ok: true,
    kind: "video_task_list",
    items: items.map((item) => {
      const row = asRecord(item);
      const content = asRecord(row.content);
      const summary: Record<string, unknown> = {
        id: row.id,
        model: row.model,
        status: row.status,
        created_at: row.created_at,
      };
      if (typeof content.video_url === "string") summary.video = { url: content.video_url };
      return summary;
    }),
  };
}

export async function attachImages(urls: string[], fetchImpl: FetchImpl = fetch): Promise<ImageBlock[]> {
  const blocks: ImageBlock[] = [];
  for (const url of urls) {
    if (blocks.length >= MAX_IMAGE_BLOCKS) break;
    const block = await downloadImage(url, fetchImpl);
    if (block) blocks.push(block);
  }
  return blocks;
}

async function downloadImage(url: string, fetchImpl: FetchImpl): Promise<ImageBlock | null> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_IMAGE_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return null;
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { type: "image", data: bytes.toString("base64"), mimeType: mime };
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
