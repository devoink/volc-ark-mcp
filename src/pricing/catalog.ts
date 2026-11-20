export const PRICE_SOURCE = "https://ark.volcengine.com/region:cn-beijing/docs/model-pricing";
export const CATALOG_DATE = "2026-11-19";
export const FPS = 24;

export const RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"] as const;
export type Ratio = (typeof RATIOS)[number];

type Pixels = Record<Ratio, readonly [number, number]>;

const SD25: Record<string, Pixels> = {
  "480p": { "16:9": [854, 480], "4:3": [752, 560], "1:1": [640, 640], "3:4": [560, 752], "9:16": [480, 854], "21:9": [992, 432] },
  "720p": { "16:9": [1280, 720], "4:3": [1112, 834], "1:1": [960, 960], "3:4": [834, 1112], "9:16": [720, 1280], "21:9": [1470, 630] },
  "1080p": { "16:9": [1920, 1080], "4:3": [1664, 1248], "1:1": [1440, 1440], "3:4": [1248, 1664], "9:16": [1080, 1920], "21:9": [2206, 946] },
  "4k": { "16:9": [3840, 2160], "4:3": [3326, 2494], "1:1": [2880, 2880], "3:4": [2494, 3326], "9:16": [2160, 3840], "21:9": [4398, 1886] },
};

const SD20: Record<string, Pixels> = {
  "480p": { "16:9": [864, 496], "4:3": [752, 560], "1:1": [640, 640], "3:4": [560, 752], "9:16": [496, 864], "21:9": [992, 432] },
  "720p": SD25["720p"]!,
  "1080p": SD25["1080p"]!,
  "4k": SD25["4k"]!,
};

const SD10: Record<string, Pixels> = {
  "480p": { "16:9": [864, 480], "4:3": [736, 544], "1:1": [640, 640], "3:4": [544, 736], "9:16": [480, 864], "21:9": [960, 416] },
  "720p": { "16:9": [1248, 704], "4:3": [1120, 832], "1:1": [960, 960], "3:4": [832, 1120], "9:16": [704, 1248], "21:9": [1504, 640] },
  "1080p": { "16:9": [1920, 1088], "4:3": [1664, 1248], "1:1": [1440, 1440], "3:4": [1248, 1664], "9:16": [1088, 1920], "21:9": [2176, 928] },
};

export type VideoFamily = "sd25" | "sd25flash" | "sd20" | "sd20fast" | "sd20mini" | "sd10pro" | "sd10fast";

export type VideoModel = {
  family: VideoFamily;
  pixels: Record<string, Pixels>;
  resolutions: string[];
  duration: { min: number; max: number };
  /** 元 / 百万 token。withVideo 为输入含视频时的单价。 */
  tokenPrice: Record<string, { plain: number; withVideo: number }>;
  offlinePerMillion?: number;
};

const price = (plain: number, withVideo: number) => ({ plain, withVideo });

export const VIDEO_MODELS: Record<VideoFamily, VideoModel> = {
  sd25: {
    family: "sd25",
    pixels: SD25,
    resolutions: ["480p", "720p", "1080p", "4k"],
    duration: { min: 4, max: 30 },
    tokenPrice: {
      "480p": price(70, 42),
      "720p": price(70, 42),
      "1080p": price(77, 46),
      "4k": price(31, 19),
    },
  },
  sd25flash: {
    family: "sd25flash",
    pixels: SD25,
    resolutions: ["480p", "720p"],
    duration: { min: 4, max: 30 },
    tokenPrice: {
      "480p": price(46, 28),
      "720p": price(46, 28),
    },
  },
  sd20: {
    family: "sd20",
    pixels: SD20,
    resolutions: ["480p", "720p", "1080p", "4k"],
    duration: { min: 4, max: 15 },
    tokenPrice: {
      "480p": price(46, 28),
      "720p": price(46, 28),
      "1080p": price(51, 31),
      "4k": price(26, 16),
    },
  },
  sd20fast: {
    family: "sd20fast",
    pixels: SD20,
    resolutions: ["480p", "720p"],
    duration: { min: 4, max: 15 },
    tokenPrice: {
      "480p": price(37, 22),
      "720p": price(37, 22),
    },
  },
  sd20mini: {
    family: "sd20mini",
    pixels: SD20,
    resolutions: ["480p", "720p"],
    duration: { min: 4, max: 15 },
    tokenPrice: {
      "480p": price(23, 14),
      "720p": price(23, 14),
    },
  },
  sd10pro: {
    family: "sd10pro",
    pixels: SD10,
    resolutions: ["480p", "720p", "1080p"],
    duration: { min: 2, max: 12 },
    tokenPrice: {
      "480p": price(15, 15),
      "720p": price(15, 15),
      "1080p": price(15, 15),
    },
    offlinePerMillion: 7.5,
  },
  sd10fast: {
    family: "sd10fast",
    pixels: SD10,
    resolutions: ["480p", "720p", "1080p"],
    duration: { min: 2, max: 12 },
    tokenPrice: {
      "480p": price(4.2, 4.2),
      "720p": price(4.2, 4.2),
      "1080p": price(4.2, 4.2),
    },
    offlinePerMillion: 2.1,
  },
};

export function videoFamily(model: string): VideoFamily | null {
  const name = model.toLowerCase().replaceAll(".", "-");
  if (name.includes("seedance-2-5-flash")) return "sd25flash";
  if (name.includes("seedance-2-5")) return "sd25";
  if (name.includes("seedance-2-0-fast")) return "sd20fast";
  if (name.includes("seedance-2-0-mini")) return "sd20mini";
  if (name.includes("seedance-2-0")) return "sd20";
  if (name.includes("seedance-1-0-pro-fast")) return "sd10fast";
  if (name.includes("seedance-1-0-pro")) return "sd10pro";
  return null;
}

export type ImageFamily = "5.5" | "5.0-pro" | "5.0-flash" | "5.0-lite" | "4.5" | "4.0";

export function imageFamily(model: string): ImageFamily | null {
  const name = model.toLowerCase().replaceAll(".", "-");
  if (!name.includes("seedream")) return null;
  if (name.includes("seedream-5-5")) return "5.5";
  if (name.includes("seedream-5-0-pro")) return "5.0-pro";
  if (name.includes("seedream-5-0-flash")) return "5.0-flash";
  if (name.includes("seedream-5-0-lite")) return "5.0-lite";
  if (name.includes("seedream-4-5")) return "4.5";
  if (name.includes("seedream-4-0")) return "4.0";
  return null;
}

/** 文档给出的分辨率档位常见宽高。 */
export const IMAGE_TIER_PIXELS: Record<string, Array<[number, number]>> = {
  "1k": [[1024, 1024], [1152, 864], [864, 1152], [1424, 800], [800, 1424], [1248, 832], [832, 1248], [1568, 672]],
  "1.5k": [[1536, 1536], [1792, 1344], [1344, 1792], [2048, 1152], [1152, 2048], [1872, 1248], [1248, 1872], [2352, 1008]],
  "2k": [[2048, 2048], [2368, 1776], [1776, 2368], [2816, 1584], [1584, 2816], [2496, 1664], [1664, 2496], [3136, 1344]],
};

export const IMAGE_PIXEL_LOW = 2_610_000;
export const IMAGE_PIXEL_HIGH = 4_630_000;
