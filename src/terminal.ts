export type Paint = {
  dim: (text: string) => string;
  strong: (text: string) => string;
  ok: (text: string) => string;
  warn: (text: string) => string;
  bad: (text: string) => string;
};

const plain = (text: string) => text;
const ANSI = /\u001b\[[0-9;]*m/g;

export function paint(enabled: boolean): Paint {
  if (!enabled) return { dim: plain, strong: plain, ok: plain, warn: plain, bad: plain };
  const wrap = (code: string) => (text: string) => `\u001b[${code}m${text}\u001b[0m`;
  return {
    dim: wrap("2"),
    strong: wrap("1"),
    ok: wrap("32"),
    warn: wrap("33"),
    bad: wrap("31"),
  };
}

export function frame(style: Paint, rows: string[]): string {
  const header = [
    `  ${style.strong("volc-ark-mcp")}`,
    `  ${style.dim("方舟生图 · 生视频")}`,
  ].join("\n");
  return `\n${header}\n\n${card(style, rows)}\n`;
}

export function card(style: Paint, rows: string[]): string {
  const width = Math.max(32, ...rows.map(visibleWidth));
  const rule = "─".repeat(width + 2);
  const top = `  ${style.dim(`╭${rule}╮`)}`;
  const bottom = `  ${style.dim(`╰${rule}╯`)}`;
  const body = rows.map((row) => {
    const pad = " ".repeat(width - visibleWidth(row));
    return `  ${style.dim("│")} ${row}${pad} ${style.dim("│")}`;
  });
  return [top, ...body, bottom].join("\n");
}

export function field(style: Paint, label: string, value: string): string {
  const gap = " ".repeat(Math.max(2, 8 - displayWidth(label)));
  return `${style.dim(label)}${gap}${value}`;
}

export function visibleWidth(text: string): number {
  return displayWidth(text.replace(ANSI, ""));
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += codePointWidth(char.codePointAt(0) ?? 0);
  return width;
}

function codePointWidth(code: number): number {
  if (code < 0x1100) return 1;
  if (code <= 0x115f || code === 0x2329 || code === 0x232a) return 2;
  if (code >= 0x2e80 && code <= 0xa4cf) return 2;
  if (code >= 0xac00 && code <= 0xd7a3) return 2;
  if (code >= 0xf900 && code <= 0xfaff) return 2;
  if (code >= 0xfe10 && code <= 0xfe19) return 2;
  if (code >= 0xfe30 && code <= 0xfe6f) return 2;
  if (code >= 0xff00 && code <= 0xff60) return 2;
  if (code >= 0xffe0 && code <= 0xffe6) return 2;
  return 1;
}
