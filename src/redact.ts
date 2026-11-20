export function redact(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}
