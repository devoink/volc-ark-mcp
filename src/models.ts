export type ArkModelRecord = {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  domain?: unknown;
  status?: unknown;
  task_type?: unknown;
  created?: unknown;
  modalities?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
};

export type ModelCapability = {
  sequential_images: boolean;
  web_search: boolean;
  stream: boolean;
  transparent_background: boolean;
  quality: "high" | "balanced" | "fast";
};

export type PresentedModel = {
  id: string;
  name?: string;
  version?: string;
  domain?: string;
  status?: string;
  task_type?: string[];
  input_modalities?: string[];
  output_modalities?: string[];
  created?: number;
  recommended_for: string[];
  avoid_for: string[];
  capabilities?: ModelCapability;
  pick_hint: string;
};

export type ModelUseCase =
  | "text_to_image"
  | "image_to_image"
  | "transparent_background"
  | "sequential_images"
  | "image_web_search"
  | "best_image_quality"
  | "fast_cheap_image"
  | "text_to_video"
  | "image_to_video"
  | "reference_video"
  | "best_video_quality"
  | "fast_cheap_video";

export type ListModelsFilter = {
  domain?: string;
  query?: string;
  status?: string;
  use_case?: ModelUseCase;
};

const MEDIA_DOMAINS = new Set(["ImageGeneration", "VideoGeneration"]);

type FamilyGuide = {
  match: (id: string, name: string) => boolean;
  recommended_for: string[];
  avoid_for: string[];
  capabilities: ModelCapability;
  pick_hint: string;
  use_cases: ModelUseCase[];
};

const FAMILY_GUIDES: FamilyGuide[] = [
  {
    match: (id, name) => includes(id, name, "seedream-5-5"),
    recommended_for: ["普通文生图", "图生图", "透明背景 PNG", "要当前最新画质"],
    avoid_for: ["组图/连续多张", "生图联网搜索", "流式出图"],
    capabilities: { sequential_images: false, web_search: false, stream: false, transparent_background: true, quality: "high" },
    pick_hint: "默认首选生图模型。要透明背景时优先选它。",
    use_cases: ["text_to_image", "image_to_image", "transparent_background", "best_image_quality"],
  },
  {
    match: (id, name) => includes(id, name, "seedream-5-0-pro"),
    recommended_for: ["高质量文生图", "图生图"],
    avoid_for: ["组图/连续多张", "生图联网搜索", "流式出图", "只要更快更便宜"],
    capabilities: { sequential_images: false, web_search: false, stream: false, transparent_background: false, quality: "high" },
    pick_hint: "高质量生图备选；一般优先 5.5。",
    use_cases: ["text_to_image", "image_to_image", "best_image_quality"],
  },
  {
    match: (id, name) => includes(id, name, "seedream-5-0-flash"),
    recommended_for: ["更快或更省的文生图", "图生图"],
    avoid_for: ["组图/连续多张", "生图联网搜索", "流式出图", "透明背景", "追求最高画质"],
    capabilities: { sequential_images: false, web_search: false, stream: false, transparent_background: false, quality: "fast" },
    pick_hint: "要快或省时选 flash，不要用来做透明背景。",
    use_cases: ["text_to_image", "image_to_image", "fast_cheap_image"],
  },
  {
    match: (id, name) => includes(id, name, "seedream-5-0") && !includes(id, name, "seedream-5-0-pro") && !includes(id, name, "seedream-5-0-flash") && !includes(id, name, "seedream-5-0-lite"),
    recommended_for: ["兼容旧请求的文生图"],
    avoid_for: ["新任务首选", "组图若文档标明不支持"],
    capabilities: { sequential_images: false, web_search: false, stream: false, transparent_background: false, quality: "balanced" },
    pick_hint: "旧版 5.0，若状态为 Retiring 请改用 5.5。",
    use_cases: ["text_to_image", "image_to_image"],
  },
  {
    match: (id, name) => includes(id, name, "seedream-4-5") || includes(id, name, "seedream-4-0"),
    recommended_for: ["组图/连续多张", "生图联网搜索", "流式出图"],
    avoid_for: ["只要最新画质", "透明背景（优先 5.5）"],
    capabilities: { sequential_images: true, web_search: true, stream: true, transparent_background: false, quality: "balanced" },
    pick_hint: "需要组图、联网搜索或流式时，优先在 4.x 里选 Published 版本。",
    use_cases: ["text_to_image", "image_to_image", "sequential_images", "image_web_search"],
  },
  {
    match: (id, name) => includes(id, name, "seedance-2-5-flash"),
    recommended_for: ["更快或更省的生视频", "文生视频", "图生视频"],
    avoid_for: ["要最高分辨率/画质", "明确要求 2.5 正式版能力"],
    capabilities: { sequential_images: false, web_search: false, stream: false, transparent_background: false, quality: "fast" },
    pick_hint: "要快或省的视频用 flash；要更高规格用 Seedance 2.5。",
    use_cases: ["text_to_video", "image_to_video", "fast_cheap_video"],
  },
  {
    match: (id, name) => includes(id, name, "seedance-2-5") && !includes(id, name, "flash"),
    recommended_for: ["高质量文生视频", "图生视频", "参考视频/多模态成片"],
    avoid_for: ["只要更快更便宜"],
    capabilities: { sequential_images: false, web_search: false, stream: false, transparent_background: false, quality: "high" },
    pick_hint: "默认首选生视频模型。",
    use_cases: ["text_to_video", "image_to_video", "reference_video", "best_video_quality"],
  },
  {
    match: (id, name) => includes(id, name, "seedance-2-0-mini"),
    recommended_for: ["更便宜的短视频草稿"],
    avoid_for: ["追求成片质量"],
    capabilities: { sequential_images: false, web_search: false, stream: false, transparent_background: false, quality: "fast" },
    pick_hint: "低成本草稿用；正式成片优先 2.5。",
    use_cases: ["text_to_video", "image_to_video", "fast_cheap_video"],
  },
  {
    match: (id, name) => includes(id, name, "seedance-2-0-fast"),
    recommended_for: ["较快的 2.0 生视频"],
    avoid_for: ["追求最新 2.5 能力"],
    capabilities: { sequential_images: false, web_search: false, stream: false, transparent_background: false, quality: "fast" },
    pick_hint: "2.0 快速档；新任务优先考虑 2.5 / 2.5-flash。",
    use_cases: ["text_to_video", "image_to_video", "fast_cheap_video"],
  },
  {
    match: (id, name) => includes(id, name, "seedance-2-0") && !includes(id, name, "fast") && !includes(id, name, "mini"),
    recommended_for: ["兼容旧 2.0 视频请求"],
    avoid_for: ["新任务首选"],
    capabilities: { sequential_images: false, web_search: false, stream: false, transparent_background: false, quality: "balanced" },
    pick_hint: "旧版 2.0；新任务优先 Seedance 2.5。",
    use_cases: ["text_to_video", "image_to_video", "reference_video"],
  },
  {
    match: (id, name) => includes(id, name, "seedance-1-0"),
    recommended_for: ["仅文生视频或图生视频的旧链路"],
    avoid_for: ["参考视频多模态", "新任务"],
    capabilities: { sequential_images: false, web_search: false, stream: false, transparent_background: false, quality: "balanced" },
    pick_hint: "1.0 多为 Retiring，尽量改用 2.5。",
    use_cases: ["text_to_video", "image_to_video"],
  },
];

export const SELECTION_GUIDE = [
  "先看用户要生图还是生视频，再调用 list_models。",
  "只用返回的 id（含版本后缀）作为 model，不要猜家族名，也不要写死某一个环境变量。",
  "优先选 status=Published；Retiring 仅在用户明确要求旧版时使用。",
  "普通生图默认选 Seedream 5.5；要透明背景也选 5.5。",
  "要组图、生图联网搜索或流式出图时，不要选 5.5 / 5.0 pro / 5.0 flash，改选仍支持这些能力的 4.x。",
  "要更快更省的生图选 5.0 flash；要最高画质选 5.5 或 5.0 pro。",
  "普通生视频默认选 Seedance 2.5；要更快更省选 2.5-flash 或 2.0-mini。",
  "有参考视频/多模态成片时优先 2.5；1.0 主要是文生/图生视频且多为下线中。",
  "若列表里同名有多个版本，选 created 更新且 Published 的那一条。",
];

export function presentModels(
  payload: unknown,
  filter: ListModelsFilter = {},
): {
  ok: true;
  kind: "model_list";
  count: number;
  models: PresentedModel[];
  selection_guide: string[];
  note: string;
} {
  const root = payload && typeof payload === "object" ? (payload as { data?: unknown }) : {};
  const rows = Array.isArray(root.data) ? root.data : [];
  const query = filter.query?.trim().toLowerCase();
  const models = rows
    .map(asPresented)
    .filter((model): model is PresentedModel => Boolean(model))
    .filter((model) => {
      if (filter.domain) return model.domain === filter.domain;
      return model.domain ? MEDIA_DOMAINS.has(model.domain) : false;
    })
    .filter((model) => !filter.status || model.status === filter.status)
    .filter((model) => {
      if (!query) return true;
      const hay = `${model.id} ${model.name ?? ""} ${model.version ?? ""} ${model.recommended_for.join(" ")} ${model.pick_hint}`.toLowerCase();
      return hay.includes(query);
    })
    .filter((model) => !filter.use_case || modelMatchesUseCase(model, filter.use_case))
    .sort((a, b) => {
      const statusRank = (status?: string) => (status === "Published" ? 0 : status === "Retiring" ? 1 : 2);
      const byStatus = statusRank(a.status) - statusRank(b.status);
      if (byStatus !== 0) return byStatus;
      return (b.created ?? 0) - (a.created ?? 0);
    });
  return {
    ok: true,
    kind: "model_list",
    count: models.length,
    models,
    selection_guide: SELECTION_GUIDE,
    note: "生成时请传 id。可按 use_case 过滤；未指定 domain 时默认只返回生图与生视频。",
  };
}

function asPresented(value: unknown): PresentedModel | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as ArkModelRecord;
  if (typeof row.id !== "string" || !row.id) return undefined;
  const id = row.id;
  const name = typeof row.name === "string" ? row.name : "";
  const guide = FAMILY_GUIDES.find((item) => item.match(id, name));
  return {
    id,
    ...(name ? { name } : {}),
    ...(typeof row.version === "string" ? { version: row.version } : {}),
    ...(typeof row.domain === "string" ? { domain: row.domain } : {}),
    ...(typeof row.status === "string" ? { status: row.status } : {}),
    ...(Array.isArray(row.task_type) ? { task_type: row.task_type.filter((item): item is string => typeof item === "string") } : {}),
    ...(Array.isArray(row.modalities?.input_modalities) ? { input_modalities: row.modalities.input_modalities.filter((item): item is string => typeof item === "string") } : {}),
    ...(Array.isArray(row.modalities?.output_modalities) ? { output_modalities: row.modalities.output_modalities.filter((item): item is string => typeof item === "string") } : {}),
    ...(typeof row.created === "number" ? { created: row.created } : {}),
    recommended_for: guide?.recommended_for ?? ["请结合 domain、task_type 与用户需求判断"],
    avoid_for: guide?.avoid_for ?? [],
    ...(guide ? { capabilities: guide.capabilities } : {}),
    pick_hint: guide?.pick_hint ?? "无内置选用规则时，优先 Published，并按用户要的模态选择。",
  };
}

function modelMatchesUseCase(model: PresentedModel, useCase: ModelUseCase): boolean {
  const guide = FAMILY_GUIDES.find((item) => item.match(model.id, model.name ?? ""));
  if (guide) return guide.use_cases.includes(useCase);
  if (
    useCase === "text_to_image" ||
    useCase === "image_to_image" ||
    useCase === "best_image_quality" ||
    useCase === "fast_cheap_image" ||
    useCase === "transparent_background" ||
    useCase === "sequential_images" ||
    useCase === "image_web_search"
  ) {
    return model.domain === "ImageGeneration";
  }
  return model.domain === "VideoGeneration";
}

function includes(id: string, name: string, token: string): boolean {
  const hay = `${id} ${name}`.toLowerCase().replaceAll(".", "-");
  return hay.includes(token);
}
