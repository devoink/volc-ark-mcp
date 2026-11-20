import { redact } from "./redact.js";

export class ArkError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ArkError";
    this.code = code;
  }
}

type FetchImpl = typeof fetch;

export type ArkClientOptions = {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: FetchImpl;
};

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

async function readError(response: Response, secret: string): Promise<ArkError> {
  const raw = await response.text();
  let code = `http_${response.status}`;
  let message = raw || response.statusText;
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: string; message?: string } };
    if (parsed.error?.code) code = parsed.error.code;
    if (parsed.error?.message) message = parsed.error.message;
  } catch {
    // 非 JSON 错误体按原文返回。
  }
  return new ArkError(code, redact(message, secret));
}

async function request(options: ArkClientOptions, path: string, init: RequestInit): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${options.apiKey}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetchImpl(endpoint(options.baseUrl, path), { ...init, headers });
  if (!response.ok) throw await readError(response, options.apiKey);
  return response;
}

export async function postJson<T>(options: ArkClientOptions, path: string, body: unknown): Promise<T> {
  const response = await request(options, path, { method: "POST", body: JSON.stringify(body) });
  return (await response.json()) as T;
}

export async function getJson<T>(options: ArkClientOptions, path: string): Promise<T> {
  const response = await request(options, path, { method: "GET" });
  return (await response.json()) as T;
}

export async function deleteJson(options: ArkClientOptions, path: string): Promise<void> {
  const response = await request(options, path, { method: "DELETE" });
  await response.text();
}

export type ImageSseEvent = {
  type?: string;
  image_index?: number;
  url?: string;
  b64_json?: string;
  size?: string;
  output_format?: string;
  background?: string;
  error?: { code?: string; message?: string } | null;
  model?: string;
  usage?: unknown;
  z_index?: number;
  name?: string;
  description?: string;
  bounding_box?: unknown;
  text_recognition?: unknown;
};

export function parseImageSse(payload: string): ImageSseEvent[] {
  const events: ImageSseEvent[] = [];
  for (const line of payload.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    events.push(JSON.parse(data) as ImageSseEvent);
  }
  return events;
}

export async function postImage(options: ArkClientOptions, body: Record<string, unknown>, stream: boolean): Promise<unknown> {
  if (!stream) return postJson(options, "/api/v3/images/generations", body);
  const response = await request(options, "/api/v3/images/generations", {
    method: "POST",
    body: JSON.stringify({ ...body, stream: true }),
  });
  const text = await response.text();
  const events = parseImageSse(redact(text, options.apiKey));
  const failed = events.find((event) => event.type === "image_generation.error" || event.type === "error");
  if (failed?.error?.message) {
    throw new ArkError(failed.error.code || "stream_error", redact(failed.error.message, options.apiKey));
  }
  return { stream: true, events };
}
