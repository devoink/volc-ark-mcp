import { readFile } from "node:fs/promises";
import path from "node:path";

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_BODY_BYTES = 64 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const AUDIO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaError";
  }
}

export function isRemoteSource(source: string): boolean {
  return /^(https?:|asset:|data:)/i.test(source.trim());
}

export async function resolveImageSource(source: string): Promise<string> {
  return resolveLocal(source, IMAGE_MIME, "image");
}

export async function resolveAudioSource(source: string): Promise<string> {
  return resolveLocal(source, AUDIO_MIME, "audio");
}

export function assertRemoteVideo(source: string): string {
  const value = source.trim();
  if (!value) throw new MediaError("视频地址为空。");
  if (!isRemoteSource(value)) {
    throw new MediaError("本机视频不能提交。视频只接受公网 URL 或 asset:// 素材 ID。");
  }
  if (value.toLowerCase().startsWith("data:")) {
    throw new MediaError("视频不接受 Base64。请改用公网 URL 或 asset:// 素材 ID。");
  }
  return value;
}

async function resolveLocal(source: string, mimeByExt: Record<string, string>, kind: "image" | "audio"): Promise<string> {
  const value = source.trim();
  if (!value) throw new MediaError(`${kind === "image" ? "图片" : "音频"}地址为空。`);
  if (isRemoteSource(value)) return value;
  const buffer = await readFile(value);
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new MediaError("单个文件超过 30MB，不能放进请求。");
  }
  const ext = path.extname(value).toLowerCase();
  const mime = mimeByExt[ext];
  if (!mime) throw new MediaError(`不认识的${kind === "image" ? "图片" : "音频"}扩展名：${ext || "（无）"}`);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export function assertBodySize(body: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(body));
  if (bytes > MAX_BODY_BYTES) {
    throw new MediaError("请求体超过 64MB。请改用公网 URL，不要用 Base64 提交大文件。");
  }
}

export function readImageSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "GIF") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      if (marker === undefined) break;
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const size = buffer.readUInt16BE(offset + 2);
      if (size < 2) break;
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + size;
    }
  }
  return null;
}

export async function readLocalImageSize(source: string): Promise<{ width: number; height: number } | null> {
  if (isRemoteSource(source)) return null;
  try {
    const buffer = await readFile(source);
    return readImageSize(buffer);
  } catch {
    return null;
  }
}
