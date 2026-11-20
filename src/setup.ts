import { credentialBackend } from "./credentials.js";

export type SetupPayload = {
  ok: boolean;
  kind: "setup_guide" | "setup_required";
  platform: "darwin" | "win32" | "linux" | "other";
  backend: ReturnType<typeof credentialBackend>;
  variable: "ARK_API_KEY";
  steps: string[];
};

function platformOf(platform: NodeJS.Platform): SetupPayload["platform"] {
  if (platform === "darwin" || platform === "win32" || platform === "linux") return platform;
  return "other";
}

export function setupSteps(): string[] {
  return [
    "运行 npx volc-ark-mcp config set，按提示输入方舟 API Key。输入时不回显，也不要把 Key 写在命令后面。",
    "Key 写入系统凭据库。macOS 用钥匙串，Windows 用凭据管理器，Linux 用 Secret Service。三个平台的命令相同。",
    "运行 volc-ark-mcp config list 确认状态。它只显示是否已保存，不显示 Key。",
    "运行 npx volc-ark-mcp install，选择要写入的 Agent。也可以手动配置。不要写 Key，也不要写 env。",
    "保存后完全退出并重新打开对应的 Agent。",
    "更换 Key 时重新运行 volc-ark-mcp config set。删除运行 volc-ark-mcp config delete。旧 Key 如果进过对话、终端历史或仓库，到方舟控制台作废。",
  ];
}

export function setupGuide(platform: NodeJS.Platform = process.platform): SetupPayload {
  return payload(true, "setup_guide", platform);
}

export function setupRequired(platform: NodeJS.Platform = process.platform): SetupPayload {
  return payload(false, "setup_required", platform);
}

function payload(ok: boolean, kind: SetupPayload["kind"], platform: NodeJS.Platform): SetupPayload {
  const backend = credentialBackend(platform);
  return {
    ok,
    kind,
    platform: platformOf(platform),
    backend,
    variable: "ARK_API_KEY",
    steps: setupSteps(),
  };
}
