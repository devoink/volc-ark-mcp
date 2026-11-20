import { credentialStore } from "./credentials.js";

let storedKey: string | undefined | null = null;

export function readApiKey(): string | undefined {
  const value = process.env.ARK_API_KEY?.trim();
  return value ? value : undefined;
}

export function resetApiKeyCache(): void {
  storedKey = null;
}

export async function resolveApiKey(): Promise<string | undefined> {
  const envKey = readApiKey();
  if (envKey) return envKey;
  if (storedKey === null) storedKey = await credentialStore.get();
  return storedKey;
}

export function readBaseUrl(): string {
  const raw = process.env.ARK_BASE_URL?.trim() || "https://ark.cn-beijing.volces.com";
  return raw.replace(/\/+$/, "");
}

export function readDefaultModel(kind: "image" | "video"): string | undefined {
  const name = kind === "image" ? process.env.ARK_IMAGE_MODEL : process.env.ARK_VIDEO_MODEL;
  const value = name?.trim();
  return value ? value : undefined;
}
