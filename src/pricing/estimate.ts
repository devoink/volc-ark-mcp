import {
  CATALOG_DATE,
  FPS,
  IMAGE_PIXEL_HIGH,
  IMAGE_PIXEL_LOW,
  IMAGE_TIER_PIXELS,
  PRICE_SOURCE,
  RATIOS,
  VIDEO_MODELS,
  imageFamily,
  videoFamily,
  type ImageFamily,
  type Ratio,
} from "./catalog.js";

export type Estimate = {
  price_basis: "list";
  currency: "CNY";
  catalog_date: string;
  source: string;
  amount_cny: number | null;
  amount_range_cny: { min: number; max: number } | null;
  unresolved: string[];
  excluded: string[];
  assumptions: string[];
};

export type BudgetDecision =
  | { ok: true }
  | { ok: false; reason: "estimate_exceeds_max_cny" | "estimate_unresolved" };

const roundMoney = (value: number) => Math.round(value * 100) / 100;

function blank(excluded: string[]): Estimate {
  return {
    price_basis: "list",
    currency: "CNY",
    catalog_date: CATALOG_DATE,
    source: PRICE_SOURCE,
    amount_cny: null,
    amount_range_cny: null,
    unresolved: [],
    excluded,
    assumptions: [],
  };
}

function finish(estimate: Estimate, values: number[]): Estimate {
  const unique = [...new Set(values.map(roundMoney))];
  if (estimate.unresolved.length > 0 || unique.length === 0) {
    estimate.amount_cny = null;
    estimate.amount_range_cny = null;
    return estimate;
  }
  const min = Math.min(...unique);
  const max = Math.max(...unique);
  if (min === max) {
    estimate.amount_cny = min;
    estimate.amount_range_cny = null;
  } else {
    estimate.amount_cny = null;
    estimate.amount_range_cny = { min, max };
  }
  return estimate;
}

export function budgetDecision(estimate: Estimate, maxCny: number | undefined): BudgetDecision {
  if (maxCny === undefined) return { ok: true };
  if (estimate.unresolved.length > 0 || (estimate.amount_cny === null && estimate.amount_range_cny === null)) {
    return { ok: false, reason: "estimate_unresolved" };
  }
  const upper = estimate.amount_range_cny?.max ?? estimate.amount_cny ?? Number.POSITIVE_INFINITY;
  if (upper > maxCny) return { ok: false, reason: "estimate_exceeds_max_cny" };
  return { ok: true };
}

export type VideoEstimateInput = {
  model: string;
  resolution?: string;
  ratio?: string;
  duration?: number;
  frames?: number;
  draft?: boolean;
  draftTaskId?: string;
  serviceTier?: string;
  hasInputVideo?: boolean;
  inputVideoSeconds?: number;
  sourceHadInputVideo?: boolean;
  firstFrame?: { width: number; height: number };
  webSearch?: boolean;
};

export function estimateVideo(input: VideoEstimateInput): Estimate {
  const excluded = ["copyright_ip", ...(input.webSearch ? ["web_search"] : [])];
  const estimate = blank(excluded);
  const family = videoFamily(input.model);
  if (!family) {
    estimate.unresolved.push("模型不在公示价目录中");
    return estimate;
  }
  const spec = VIDEO_MODELS[family];
  let resolution = (input.resolution || "").toLowerCase();
  if (input.draft) {
    resolution = "480p";
    estimate.assumptions.push("样片按 480p 估算这一步");
  }
  if (!resolution) {
    estimate.unresolved.push("未指定 resolution");
    return estimate;
  }
  if (!spec.resolutions.includes(resolution) || !spec.tokenPrice[resolution] || !spec.pixels[resolution]) {
    estimate.unresolved.push(`${resolution} 不在该模型的公示分辨率中`);
    return estimate;
  }

  const hasInputVideo = Boolean(input.draftTaskId ? input.sourceHadInputVideo : input.hasInputVideo);
  if (input.draftTaskId && input.sourceHadInputVideo === undefined) {
    estimate.unresolved.push("正式视频需要 source_had_input_video，以确定第一步是否含输入视频");
    return estimate;
  }
  const inputSeconds = input.draftTaskId || input.hasInputVideo ? input.inputVideoSeconds : 0;
  if ((input.hasInputVideo || input.draftTaskId) && (inputSeconds === undefined || inputSeconds < 0)) {
    estimate.unresolved.push("有参考视频时需要 input_video_seconds；不下载视频探测时长");
    return estimate;
  }

  let outputSeconds: number[] = [];
  if (input.frames !== undefined) {
    outputSeconds = [input.frames / FPS];
    if (input.duration !== undefined) estimate.assumptions.push("同时传入 duration 和 frames，按 frames 估算");
  } else if (input.duration === undefined || input.duration === -1) {
    outputSeconds = [spec.duration.min, spec.duration.max];
    estimate.assumptions.push(`duration 为 -1 或未指定，按 ${spec.duration.min}–${spec.duration.max} 秒给区间`);
  } else {
    outputSeconds = [input.duration];
  }

  const ratio = (input.ratio || (family.startsWith("sd10") && !input.hasInputVideo ? "16:9" : "adaptive")).toLowerCase();
  let ratios: Ratio[];
  if (ratio === "adaptive") {
    if (input.firstFrame) {
      ratios = [nearestRatio(input.firstFrame.width, input.firstFrame.height)];
      estimate.assumptions.push(`按首帧宽高选择最接近的 ${ratios[0]}`);
    } else {
      ratios = [...RATIOS];
      estimate.assumptions.push("ratio 为 adaptive，按该分辨率全部标准宽高比给区间");
    }
  } else if ((RATIOS as readonly string[]).includes(ratio)) {
    ratios = [ratio as Ratio];
  } else {
    estimate.unresolved.push(`未知 ratio：${input.ratio}`);
    return estimate;
  }

  const unit = unitPrice(spec, resolution, hasInputVideo, input.serviceTier, estimate);
  const table = spec.pixels[resolution]!;
  const totals: number[] = [];
  for (const seconds of outputSeconds) {
    for (const item of ratios) {
      const [width, height] = table[item];
      const tokens = ((inputSeconds ?? 0) + seconds) * width * height * FPS / 1024;
      totals.push(tokens / 1_000_000 * unit);
    }
  }
  return finish(estimate, totals);
}

function unitPrice(
  spec: (typeof VIDEO_MODELS)[keyof typeof VIDEO_MODELS],
  resolution: string,
  hasInputVideo: boolean,
  serviceTier: string | undefined,
  estimate: Estimate,
): number {
  const row = spec.tokenPrice[resolution]!;
  if (serviceTier === "flex" && spec.offlinePerMillion !== undefined) {
    estimate.assumptions.push("Seedance 1.x 的 flex 使用离线推理单价");
    return spec.offlinePerMillion;
  }
  if (serviceTier === "flex") {
    estimate.assumptions.push("2.x 的 flex 不在公示折扣内，按在线单价估算");
  }
  return hasInputVideo ? row.withVideo : row.plain;
}

export function nearestRatio(width: number, height: number): Ratio {
  const aspect = width / height;
  let best: Ratio = "16:9";
  let bestGap = Number.POSITIVE_INFINITY;
  for (const ratio of RATIOS) {
    const [w, h] = ratio.split(":").map(Number) as [number, number];
    const gap = Math.abs(aspect - w / h);
    if (gap < bestGap) {
      best = ratio;
      bestGap = gap;
    }
  }
  return best;
}

export type ImageEstimateInput = {
  model: string;
  size?: string;
  imageCount?: number;
  sequential?: "auto" | "disabled";
  maxImages?: number;
  layerDecomposition?: boolean;
  webSearch?: boolean;
};

export function estimateImage(input: ImageEstimateInput): Estimate {
  const excluded = ["copyright_ip", ...(input.webSearch ? ["web_search"] : [])];
  const estimate = blank(excluded);
  const family = imageFamily(input.model);
  if (!family) {
    estimate.unresolved.push("模型不在图片公示价目录中");
    return estimate;
  }
  const pixels = imagePixels(input.size, estimate);
  if (!pixels) return estimate;
  const outputPrices = pixels.map((count) => outputUnit(family, count, Boolean(input.layerDecomposition)));
  if (outputPrices.some((price) => price === null)) {
    estimate.unresolved.push("像素超出公示档位");
    return estimate;
  }
  const prices = outputPrices as number[];
  const imageCount = input.imageCount ?? 0;
  const inputCost = inputUnit(family, imageCount);
  let outputMin = 1;
  let outputMax = 1;
  if (input.layerDecomposition) {
    outputMax = input.maxImages ?? (family === "5.5" ? 30 : 17);
    estimate.assumptions.push("图层拆分的输出张数在生成后才确定，按 1 张到上限给区间");
  } else if (input.sequential === "auto") {
    const cap = input.maxImages ?? 15;
    outputMax = Math.max(1, Math.min(cap, 15 - imageCount));
    estimate.assumptions.push("组图张数在生成后才确定，按 1 张到可生成上限给区间");
  }
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return finish(estimate, [
    inputCost + outputMin * low,
    inputCost + outputMax * high,
  ]);
}

function imagePixels(size: string | undefined, estimate: Estimate): number[] | null {
  if (!size) {
    estimate.assumptions.push("未传 size，按文档默认 2K 估算");
    return IMAGE_TIER_PIXELS["2k"]!.map(([w, h]) => w * h);
  }
  const tier = size.trim().toLowerCase();
  if (IMAGE_TIER_PIXELS[tier]) return IMAGE_TIER_PIXELS[tier].map(([w, h]) => w * h);
  const match = size.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/);
  if (!match) {
    estimate.unresolved.push(`无法解析 size：${size}`);
    return null;
  }
  return [Number(match[1]) * Number(match[2])];
}

function inputUnit(family: ImageFamily, count: number): number {
  if (family === "5.5") return count * 0.05;
  if (family === "5.0-pro") return Math.max(0, count - 1) * 0.02;
  return 0;
}

function outputUnit(family: ImageFamily, pixels: number, layer: boolean): number | null {
  if (family === "5.5") {
    if (pixels <= IMAGE_PIXEL_LOW) return 0.13;
    if (pixels <= IMAGE_PIXEL_HIGH) return 0.23;
    return null;
  }
  if (family === "5.0-pro") {
    const high = pixels > IMAGE_PIXEL_LOW;
    if (layer) return high ? 0.3 : 0.15;
    return high ? 0.6 : 0.3;
  }
  if (family === "5.0-flash") return 0.12;
  if (family === "5.0-lite") return 0.22;
  if (family === "4.5") return 0.25;
  return 0.2;
}
