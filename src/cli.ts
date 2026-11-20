import readline from "node:readline/promises";
import { ArkError, getJson } from "./ark-client.js";
import { readBaseUrl } from "./config.js";
import { backendLabel, credentialBackend, credentialStore, type createCredentialStore } from "./credentials.js";
import { currentAgentEnv, realInstallFiles, runInstall, type InstallFiles } from "./install.js";
import { redact } from "./redact.js";
import { field, frame, paint, type Paint } from "./terminal.js";

export const CLI_NAME = "volc-ark-mcp";

type Store = ReturnType<typeof createCredentialStore>;

export type CliDeps = {
  platform?: NodeJS.Platform;
  envKey?: string;
  store?: Pick<Store, "get" | "set" | "delete" | "backend">;
  prompt?: (label: string) => Promise<string>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  color?: boolean;
  probe?: (apiKey: string) => Promise<void>;
  home?: string;
  appData?: string;
  xdgConfigHome?: string;
  files?: InstallFiles;
};

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text) => process.stderr.write(text));
  const style = paint(deps.color ?? (deps.stdout === undefined && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR));
  const platform = deps.platform ?? process.platform;
  const envKey = "envKey" in deps ? deps.envKey : process.env.ARK_API_KEY;
  const store = deps.store ?? credentialStore;
  const [group, action, extra] = argv;
  const probe = deps.probe ?? ((apiKey: string) => probeArk(apiKey, readBaseUrl()));
  if (group === "--help" || group === "-h" || (group === "config" && action === undefined && extra === undefined)) {
    stdout(helpScreen(style));
    return 0;
  }
  if ((group === "test" && action === undefined) || (group === "config" && action === "test" && extra === undefined)) {
    return runConnectionTest(store, envKey, platform, stdout, stderr, style, probe);
  }
  if (group === "install") {
    const interactive = deps.prompt !== undefined || (deps.files === undefined && deps.stdout === undefined && Boolean(process.stdin.isTTY));
    const keySaved = Boolean(envKey?.trim()) || Boolean(await store.get());
    return runInstall(
      argv.slice(1),
      currentAgentEnv({ home: deps.home, platform, appData: deps.appData, xdgConfigHome: deps.xdgConfigHome }),
      deps.files ?? realInstallFiles(),
      style,
      stdout,
      stderr,
      deps.prompt ?? (interactive ? promptLine : undefined),
      interactive,
      keySaved,
    );
  }
  if (group !== "config" || extra !== undefined || !action) {
    if (group === "config" && action === "set" && extra !== undefined) {
      stderr(frame(style, [
        field(style, "结果", style.bad("没有保存")),
        "Key 不能写在命令后面。",
        "",
        style.strong(`npx ${CLI_NAME} config set`),
      ]));
      return 1;
    }
    stderr(helpScreen(style));
    return 1;
  }
  if (action === "set") return setKey(store, deps.prompt ?? promptHidden, stdout, stderr, style);
  if (action === "list") return listKey(store, envKey, platform, stdout, style);
  if (action === "delete") return deleteKey(store, envKey, stdout, stderr, style);
  stderr(helpScreen(style));
  return 1;
}

function helpScreen(style: Paint): string {
  const row = (command: string, description: string) => `${style.strong(command.padEnd(15))}${style.dim(description)}`;
  return frame(style, [
    row("config set", "保存方舟 API Key"),
    row("config list", "查看是否已保存"),
    row("config delete", "从凭据库删除"),
    row("test", "检查 Key 是否可用"),
    row("install", "写入多个 Agent"),
    "",
    style.dim("不带参数时启动 MCP，供 Cursor 连接。"),
    style.dim("Key 不会出现在屏幕和命令参数里。"),
  ]);
}

export async function probeArk(apiKey: string, baseUrl: string): Promise<void> {
  await getJson({ apiKey, baseUrl }, "/api/v3/contents/generations/tasks?page_size=1&page_num=1");
}

async function runConnectionTest(
  store: Pick<Store, "get" | "backend">,
  envKey: string | undefined,
  platform: NodeJS.Platform,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
  style: Paint,
  probe: (apiKey: string) => Promise<void>,
): Promise<number> {
  const key = envKey?.trim() || await store.get();
  if (!key) {
    stderr(frame(style, [
      field(style, "结果", style.warn("未保存")),
      "",
      style.strong(`npx ${CLI_NAME} config set`),
    ]));
    return 1;
  }
  try {
    await probe(key);
  } catch (error) {
    const code = error instanceof ArkError ? error.code : "probe_failed";
    const message = error instanceof Error ? error.message : String(error);
    stderr(frame(style, [
      field(style, "结果", style.bad("未连通")),
      field(style, "错误", code),
      style.dim(redact(message, key)),
    ]));
    return 1;
  }
  const place = envKey?.trim() ? "当前进程的环境变量" : backendLabel(store.backend || credentialBackend(platform));
  stdout(frame(style, [
    field(style, "结果", style.ok("已连通")),
    field(style, "凭据", place),
  ]));
  return 0;
}

async function setKey(store: Pick<Store, "set" | "backend">, prompt: (label: string) => Promise<string>, stdout: (text: string) => void, stderr: (text: string) => void, style: Paint): Promise<number> {
  let key = "";
  try {
    key = (await prompt(secretPrompt(style))).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(frame(style, [
      field(style, "结果", style.bad("已取消")),
      style.dim(message === "已取消" ? "没有写入。" : message),
    ]));
    return 1;
  }
  if (!key || /[\r\n]/.test(key)) {
    stderr(frame(style, [
      field(style, "结果", style.bad("没有保存")),
      style.dim(key ? "Key 不能包含换行。" : "输入是空的。"),
    ]));
    return 1;
  }
  try {
    await store.set(key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(frame(style, [
      field(style, "结果", style.bad("没有保存")),
      style.dim(message),
    ]));
    return 1;
  }
  stdout(frame(style, [
    field(style, "Key", style.ok("已保存")),
    field(style, "凭据库", backendLabel(store.backend)),
    "",
    style.dim("完全退出 Cursor 再打开。"),
    style.dim("新进程才会读到这把 Key。"),
  ]));
  return 0;
}

function secretPrompt(style: Paint): string {
  return `${frame(style, [
    field(style, "Key", "方舟 API Key"),
    style.dim("输入后按回车。字符不会显示。"),
    style.dim("Ctrl+C 取消。"),
  ])}\n  › `;
}

async function listKey(store: Pick<Store, "get" | "backend">, envKey: string | undefined, platform: NodeJS.Platform, stdout: (text: string) => void, style: Paint): Promise<number> {
  if (envKey?.trim()) {
    stdout(frame(style, [
      field(style, "Key", style.ok("已保存")),
      field(style, "来源", "当前进程的环境变量"),
      style.dim(`优先于${backendLabel(credentialBackend(platform))}。`),
    ]));
    return 0;
  }
  const stored = await store.get();
  if (!stored) {
    stdout(frame(style, [
      field(style, "Key", style.warn("未保存")),
      field(style, "凭据库", backendLabel(credentialBackend(platform))),
      "",
      style.strong(`npx ${CLI_NAME} config set`),
    ]));
    return 0;
  }
  stdout(frame(style, [
    field(style, "Key", style.ok("已保存")),
    field(style, "凭据库", backendLabel(store.backend)),
    "",
    `${style.dim("更换")}  ${style.strong(`npx ${CLI_NAME} config set`)}`,
    `${style.dim("删除")}  ${style.strong(`npx ${CLI_NAME} config delete`)}`,
  ]));
  return 0;
}

async function deleteKey(store: Pick<Store, "delete" | "backend">, envKey: string | undefined, stdout: (text: string) => void, stderr: (text: string) => void, style: Paint): Promise<number> {
  try {
    await store.delete();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(frame(style, [
      field(style, "结果", style.bad("没有删除")),
      style.dim(message),
    ]));
    return 1;
  }
  const lines = [
    field(style, "Key", style.ok("已删除")),
    field(style, "凭据库", backendLabel(store.backend)),
  ];
  if (envKey?.trim()) {
    lines.push("", style.dim("当前进程里的环境变量还在。"), style.dim("这次运行仍会使用它。"));
  }
  stdout(frame(style, lines));
  return 0;
}

export async function promptLine(label: string): Promise<string> {
  const input = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await input.question(label);
  } finally {
    input.close();
  }
}

export async function promptHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
  process.stderr.write(label);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const previous = stdin.isRaw;
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const finish = (error?: Error, result?: string) => {
      stdin.off("data", onData);
      if (stdin.isTTY) stdin.setRawMode(previous ?? false);
      stdin.pause();
      if (error) reject(error);
      else resolve(result ?? "");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          process.stderr.write("\n");
          finish(new Error("已取消"));
          return;
        }
        if (char === "\u0004" || char === "\r" || char === "\n") {
          process.stderr.write("\n");
          finish(undefined, value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}
