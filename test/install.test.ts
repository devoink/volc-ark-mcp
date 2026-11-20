import assert from "node:assert/strict";
import test from "node:test";
import { agentTargets } from "../src/agents.js";
import { runCli } from "../src/cli.js";
import { mergeAgentConfig, selectAgents, type InstallFiles } from "../src/install.js";

const HOME = "/Users/me";
const KEY = "sk-test-seedance-key";

function memory(dirs: string[] = []): InstallFiles & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const known = new Set(dirs);
  return {
    files,
    exists(file) {
      if (known.has(file) || files.has(file)) return true;
      const prefix = file.endsWith("/") ? file : `${file}/`;
      for (const item of [...known, ...files.keys()]) if (item.startsWith(prefix)) return true;
      return false;
    },
    async read(file) {
      return files.get(file);
    },
    async write(file, text) {
      files.set(file, text);
      known.add(file.slice(0, file.lastIndexOf("/")));
    },
  };
}

test("选择序号、全部已检测到的，以及取消", () => {
  const agents = [
    { id: "cursor", detected: true },
    { id: "claude-code", detected: false },
    { id: "codex", detected: true },
  ];
  assert.deepEqual(selectAgents("1,3", agents), { ids: ["cursor", "codex"] });
  assert.deepEqual(selectAgents("", agents), { ids: ["cursor", "codex"] });
  assert.deepEqual(selectAgents("2", agents), { ids: ["claude-code"] });
  assert.deepEqual(selectAgents("q", agents), { error: "已取消" });
  assert.equal("error" in selectAgents("9", agents), true);
});

test("写入 Cursor 时保留其他服务，并且不写 Key", () => {
  const target = agentTargets({ home: HOME, platform: "darwin" }).find((item) => item.id === "cursor");
  assert.ok(target);
  const merged = mergeAgentConfig(target, JSON.stringify({ mcpServers: { other: { command: "other" } } }));
  assert.equal(merged.status, "written");
  const saved = JSON.parse(merged.text ?? "{}") as { mcpServers: Record<string, { command: string; args?: string[]; env?: unknown }> };
  assert.equal(saved.mcpServers.other.command, "other");
  assert.deepEqual(saved.mcpServers["volc-ark-mcp"], { command: "npx", args: ["-y", "volc-ark-mcp"] });
  assert.equal(JSON.stringify(saved).includes(KEY), false);
  assert.equal(mergeAgentConfig(target, merged.text).status, "exists");
  const custom = mergeAgentConfig(target, JSON.stringify({ mcpServers: { "volc-ark-mcp": { command: "node", args: ["local.js"] } } }));
  assert.equal(custom.status, "kept");
  assert.equal(custom.text, undefined);
});

test("VS Code、OpenCode 和 Codex 使用各自的配置格式", () => {
  const targets = agentTargets({ home: HOME, platform: "darwin" });
  const vscode = targets.find((item) => item.id === "vscode");
  const opencode = targets.find((item) => item.id === "opencode");
  const codex = targets.find((item) => item.id === "codex");
  assert.ok(vscode && opencode && codex);
  const vscodeText = mergeAgentConfig(vscode, "{\"theme\": \"dark\"}").text ?? "";
  assert.equal(JSON.parse(vscodeText).theme, "dark");
  assert.equal(JSON.parse(vscodeText).servers["volc-ark-mcp"].type, "stdio");
  const opencodeText = mergeAgentConfig(opencode, undefined).text ?? "";
  assert.deepEqual(JSON.parse(opencodeText).mcp.servers["volc-ark-mcp"].command, ["npx", "-y", "volc-ark-mcp"]);
  const toml = mergeAgentConfig(codex, "model = \"gpt\"\n");
  assert.match(toml.text ?? "", /model = "gpt"/);
  assert.match(toml.text ?? "", /\[mcp_servers\.volc-ark-mcp\]/);
  assert.equal(mergeAgentConfig(codex, toml.text).status, "exists");
  assert.equal(mergeAgentConfig(codex, "[mcp_servers.volc-ark-mcp]\ncommand = \"node\"\n").status, "kept");
});

test("无法解析的配置不会被覆盖", () => {
  const target = agentTargets({ home: HOME, platform: "linux", xdgConfigHome: "/Users/me/.config" }).find((item) => item.id === "cursor");
  assert.ok(target);
  assert.throws(() => mergeAgentConfig(target, "{"));
});

test("Windows 上 Claude Desktop 写到凭据目录旁的配置", () => {
  const target = agentTargets({ home: "C:\\Users\\me", platform: "win32", appData: "C:\\Users\\me\\AppData\\Roaming" }).find((item) => item.id === "claude-desktop");
  assert.equal(target?.configPath, "C:\\Users\\me\\AppData\\Roaming\\Claude\\claude_desktop_config.json");
});

test("install 只写入点名的 Agent", async () => {
  const store = memory([`${HOME}/.cursor`]);
  let output = "";
  const code = await runCli(["install", "cursor", "claude-code"], {
    home: HOME,
    platform: "darwin",
    envKey: "",
    files: store,
    stdout: (text) => { output += text; },
    stderr: (text) => { output += text; },
  });
  assert.equal(code, 0);
  const cursor = JSON.parse(store.files.get(`${HOME}/.cursor/mcp.json`) ?? "{}") as { mcpServers: Record<string, unknown> };
  const claude = JSON.parse(store.files.get(`${HOME}/.claude.json`) ?? "{}") as { mcpServers: Record<string, unknown> };
  assert.ok(cursor.mcpServers["volc-ark-mcp"]);
  assert.ok(claude.mcpServers["volc-ark-mcp"]);
  assert.equal(output.includes(KEY), false);
  assert.match(output, /已写入/);
});

test("install --all 只处理已检测到的 Agent", async () => {
  const store = memory([`${HOME}/.codex`]);
  const code = await runCli(["install", "--all"], {
    home: HOME,
    platform: "darwin",
    envKey: "",
    files: store,
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(code, 0);
  assert.equal(store.files.size, 1);
  assert.match(store.files.get(`${HOME}/.codex/config.toml`) ?? "", /\[mcp_servers\.volc-ark-mcp\]/);
});
