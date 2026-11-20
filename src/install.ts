import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { agentTargets, displayPath, SERVER_ID, type AgentEnv, type AgentTarget } from "./agents.js";
import { field, frame, type Paint } from "./terminal.js";

export type InstallFiles = {
  exists: (file: string) => boolean;
  read: (file: string) => Promise<string | undefined>;
  write: (file: string, text: string) => Promise<void>;
};

export type InstallStatus = "written" | "exists" | "kept" | "failed";

export type InstallResult = {
  id: string;
  label: string;
  path: string;
  status: InstallStatus;
  message?: string;
};

const STDIO = { command: "npx", args: ["-y", SERVER_ID] };
const STDIO_TYPED = { type: "stdio", command: "npx", args: ["-y", SERVER_ID] };
const OPENCODE = { type: "local", command: ["npx", "-y", SERVER_ID] };
const TOML_HEADER = `[mcp_servers.${SERVER_ID}]`;
const TOML_COMMAND = 'command = "npx"';
const TOML_ARGS = `args = ["-y", "${SERVER_ID}"]`;

export function realInstallFiles(): InstallFiles {
  return {
    exists: (file) => existsSync(file),
    async read(file) {
      try {
        return await readFile(file, "utf8");
      } catch (error) {
        if (isEnoent(error)) return undefined;
        throw error;
      }
    },
    async write(file, text) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text, "utf8");
    },
  };
}

export function parseInstallArgs(args: string[]): { list: boolean; all: boolean; ids: string[] } | { error: string } {
  const ids: string[] = [];
  let list = false;
  let all = false;
  for (const arg of args) {
    if (arg === "--list") list = true;
    else if (arg === "--all") all = true;
    else if (arg.startsWith("-")) return { error: `不认识的参数 ${arg}。` };
    else for (const id of arg.split(/[,，]/)) if (id) ids.push(id);
  }
  return { list, all, ids };
}

export function selectAgents(input: string, agents: Array<{ id: string; detected: boolean }>): { ids: string[] } | { error: string } {
  const text = input.trim().toLowerCase();
  if (text === "q" || text === "quit") return { error: "已取消" };
  if (text === "" || text === "a" || text === "all" || text === "全部") {
    const ids = agents.filter((agent) => agent.detected).map((agent) => agent.id);
    if (ids.length === 0) return { error: "没有检测到 Agent。请输入序号。" };
    return { ids };
  }
  const ids: string[] = [];
  for (const token of text.split(/[\s,，]+/).filter(Boolean)) {
    if (/^\d+$/.test(token)) {
      const index = Number(token) - 1;
      const agent = agents[index];
      if (!agent) return { error: `没有序号 ${token}。` };
      ids.push(agent.id);
      continue;
    }
    const agent = agents.find((item) => item.id === token);
    if (!agent) return { error: `不认识 ${token}。` };
    ids.push(agent.id);
  }
  return { ids: [...new Set(ids)] };
}

export function mergeAgentConfig(target: AgentTarget, raw: string | undefined): { status: Exclude<InstallStatus, "failed">; text?: string } {
  if (target.root === "toml") return mergeToml(raw);
  return mergeJson(target, raw);
}

export async function installAgents(ids: string[], env: AgentEnv, files: InstallFiles): Promise<InstallResult[]> {
  const targets = agentTargets(env);
  const results: InstallResult[] = [];
  for (const id of ids) {
    const target = targets.find((item) => item.id === id);
    if (!target) {
      results.push({ id, label: id, path: "", status: "failed", message: "不认识这个 Agent。" });
      continue;
    }
    results.push(await installOne(target, files));
  }
  return results;
}

export function agentChoices(env: AgentEnv, files: InstallFiles): Array<AgentTarget & { detected: boolean }> {
  return agentTargets(env).map((target) => ({
    ...target,
    detected: files.exists(target.detectPath) || files.exists(target.configPath),
  }));
}

export async function runInstall(
  args: string[],
  env: AgentEnv,
  files: InstallFiles,
  style: Paint,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
  prompt?: (label: string) => Promise<string>,
  interactive = false,
  keySaved = false,
): Promise<number> {
  const parsed = parseInstallArgs(args);
  if ("error" in parsed) {
    stderr(frame(style, [field(style, "结果", style.bad("没有写入")), parsed.error]));
    return 1;
  }
  const choices = agentChoices(env, files);
  if (parsed.list) {
    stdout(frame(style, choiceRows(style, choices, env, "list")));
    return 0;
  }
  let ids = parsed.ids;
  if (parsed.all) ids = choices.filter((agent) => agent.detected).map((agent) => agent.id);
  if (ids.length === 0 && interactive && prompt) {
    stdout(frame(style, choiceRows(style, choices, env, "choose")));
    let selected: { ids: string[] } | { error: string };
    try {
      selected = selectAgents(await prompt("\n  选择  › "), choices);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr(frame(style, [field(style, "结果", style.bad("已取消")), style.dim(message === "已取消" ? "没有写入。" : message)]));
      return 1;
    }
    if ("error" in selected) {
      stderr(frame(style, [field(style, "结果", style.bad(selected.error === "已取消" ? "已取消" : "没有写入")), selected.error === "已取消" ? "没有写入。" : selected.error]));
      return 1;
    }
    ids = selected.ids;
  }
  if (ids.length === 0) {
    stderr(frame(style, [
      field(style, "结果", style.bad("没有写入")),
      parsed.all ? "没有检测到 Agent。" : "请指定 Agent，或在终端里运行 install 进行选择。",
      "",
      style.strong("npx volc-ark-mcp install --list"),
    ]));
    return 1;
  }
  const unknown = ids.filter((id) => !choices.some((agent) => agent.id === id));
  if (unknown.length > 0) {
    stderr(frame(style, [field(style, "结果", style.bad("没有写入")), `不认识 ${unknown.join("、")}。`, "", style.strong("npx volc-ark-mcp install --list")]));
    return 1;
  }
  const results = await installAgents(ids, env, files);
  const failed = results.some((result) => result.status === "failed");
  const lines = resultRows(style, results, env, keySaved);
  if (failed) stderr(frame(style, lines));
  else stdout(frame(style, lines));
  return failed ? 1 : 0;
}

function choiceRows(style: Paint, choices: Array<AgentTarget & { detected: boolean }>, env: AgentEnv, mode: "choose" | "list"): string[] {
  const rows = mode === "list"
    ? ["可写入的 Agent。", ""]
    : [
      "选择要写入的 Agent。序号用空格或逗号分隔。",
      style.dim("直接回车写入全部已检测到的。q 取消。"),
      "",
    ];
  choices.forEach((agent, index) => {
    const state = agent.detected ? style.ok("已检测到") : style.dim("未检测到");
    rows.push(`${style.strong(String(index + 1).padStart(2))}  ${agent.label.padEnd(16)}  ${state}`);
    rows.push(style.dim(`    ${displayPath(agent.configPath, env)}`));
  });
  return rows;
}

function resultRows(style: Paint, results: InstallResult[], env: AgentEnv, keySaved: boolean): string[] {
  const failed = results.filter((result) => result.status === "failed").length;
  const written = results.some((result) => result.status === "written");
  const headline = failed === results.length ? style.bad("没有写入") : failed ? style.warn("部分未写入") : written ? style.ok("已写入") : style.ok("已存在");
  const rows = [field(style, "结果", headline)];
  for (const result of results) {
    const mark = result.status === "written" ? style.ok("已写入")
      : result.status === "exists" ? style.dim("已存在")
      : result.status === "kept" ? style.warn("未改动")
      : style.bad("失败");
    rows.push(`${result.label.padEnd(16)}  ${mark}`);
    if (result.path) rows.push(style.dim(`  ${displayPath(result.path, env)}`));
    if (result.message) rows.push(style.dim(`  ${result.message}`));
  }
  rows.push("", style.dim(keySaved
    ? "Key 已可用，不会写入配置。重启对应 Agent 后生效。"
    : "还没有保存 Key。先运行 npx volc-ark-mcp config set，再重启对应 Agent。"));
  return rows;
}

async function installOne(target: AgentTarget, files: InstallFiles): Promise<InstallResult> {
  const base = { id: target.id, label: target.label, path: target.configPath };
  let raw: string | undefined;
  try {
    raw = await files.read(target.configPath);
  } catch {
    return { ...base, status: "failed", message: "没有读到配置文件。" };
  }
  let next: { status: Exclude<InstallStatus, "failed">; text?: string };
  try {
    next = mergeAgentConfig(target, raw);
  } catch {
    return { ...base, status: "failed", message: "配置文件无法解析，没有改动。" };
  }
  if (next.text === undefined) return { ...base, status: next.status };
  try {
    await files.write(target.configPath, next.text);
  } catch {
    return { ...base, status: "failed", message: "没有写入配置文件。" };
  }
  return { ...base, status: next.status };
}

function mergeJson(target: AgentTarget, raw: string | undefined): { status: Exclude<InstallStatus, "failed">; text?: string } {
  const doc = raw && raw.trim() ? JSON.parse(raw) as unknown : {};
  const root = asObject(doc, "根");
  if (target.root === "opencode") {
    const mcp = asObject(root.mcp ?? {}, "mcp");
    const servers = asObject(mcp.servers ?? {}, "mcp.servers");
    const outcome = place(servers, OPENCODE);
    if (outcome !== "written") return { status: outcome };
    mcp.servers = servers;
    root.mcp = mcp;
    return { status: "written", text: `${JSON.stringify(root, null, 2)}\n` };
  }
  const key = target.root;
  const servers = asObject(root[key] ?? {}, key);
  const outcome = place(servers, target.entry === "stdio-typed" ? STDIO_TYPED : STDIO);
  if (outcome !== "written") return { status: outcome };
  root[key] = servers;
  return { status: "written", text: `${JSON.stringify(root, null, 2)}\n` };
}

function place(servers: Record<string, unknown>, entry: object): Exclude<InstallStatus, "failed"> {
  const current = servers[SERVER_ID];
  if (current === undefined) {
    servers[SERVER_ID] = entry;
    return "written";
  }
  return sameEntry(current, entry) ? "exists" : "kept";
}

function sameEntry(current: unknown, entry: object): boolean {
  if (!current || typeof current !== "object" || Array.isArray(current)) return false;
  const item = current as Record<string, unknown>;
  const expected = entry as { type?: string; command: string | string[]; args?: string[] };
  if (expected.type !== undefined && item.type !== expected.type) return false;
  return JSON.stringify(item.command) === JSON.stringify(expected.command) && JSON.stringify(item.args ?? []) === JSON.stringify(expected.args ?? []);
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} 不是对象`);
  return value as Record<string, unknown>;
}

function mergeToml(raw: string | undefined): { status: Exclude<InstallStatus, "failed">; text?: string } {
  const text = raw ?? "";
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === TOML_HEADER);
  if (start === -1) {
    const block = `${TOML_HEADER}\n${TOML_COMMAND}\n${TOML_ARGS}\n`;
    const next = text.trim().length === 0 ? block : `${text.replace(/\s*$/, "")}\n\n${block}`;
    return { status: "written", text: next };
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const body = lines.slice(start + 1, end).map((line) => line.trim()).filter(Boolean);
  const command = body.find((line) => line.startsWith("command"));
  const args = body.find((line) => line.startsWith("args"));
  const same = command === TOML_COMMAND && args === TOML_ARGS;
  return { status: same ? "exists" : "kept" };
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export function currentAgentEnv(overrides: Partial<AgentEnv> = {}): AgentEnv {
  return {
    home: overrides.home ?? homedir(),
    platform: overrides.platform ?? process.platform,
    appData: overrides.appData ?? process.env.APPDATA,
    xdgConfigHome: overrides.xdgConfigHome ?? process.env.XDG_CONFIG_HOME,
  };
}
