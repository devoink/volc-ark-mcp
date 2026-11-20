export type ImageBlock = {
  type: "image";
  data: string;
  mimeType: string;
};

export type ToolPayload = {
  content: Array<{ type: "text"; text: string } | ImageBlock>;
  isError?: boolean;
};

export function toolResult(value: unknown, images: ImageBlock[] = [], isError = false): ToolPayload {
  const content: ToolPayload["content"] = [
    { type: "text", text: JSON.stringify(value, null, 2) },
  ];
  for (const image of images) content.push(image);
  return isError ? { content, isError: true } : { content };
}

export const REPLY_GUIDE = [
  "把 JSON 留给自己，按交付卡片回复用户，不要贴 JSON。",
  "标题用提示词第一句，超过 40 字就截断。成图或尾帧放在标题下面。",
  "规格、任务、费用各写一行，费用写明公示价，并说明全部成功才计费、审核失败不计费。",
  "视频 queued 或 running 时不要给视频链接，也不要画进度条。succeeded 才放尾帧和视频链接。",
  "聊天窗口不内嵌播放器。单张失败要写出 error.code 和 error.message。",
].join("");
