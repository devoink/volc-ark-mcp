import path from "node:path";

export const SERVER_ID = "volc-ark-mcp";

export type AgentRoot = "mcpServers" | "servers" | "opencode" | "toml";
export type AgentEntry = "stdio" | "stdio-typed" | "opencode" | "toml";

export type AgentTarget = {
  id: string;
  label: string;
  root: AgentRoot;
  entry: AgentEntry;
  configPath: string;
  detectPath: string;
};

export type AgentEnv = {
  home: string;
  platform: NodeJS.Platform;
  appData?: string;
  xdgConfigHome?: string;
};

type PathApi = Pick<typeof path.posix, "dirname" | "join" | "resolve" | "sep">;

function pathApi(platform: NodeJS.Platform): PathApi {
  return platform === "win32" ? path.win32 : path.posix;
}

export function agentTargets(env: AgentEnv): AgentTarget[] {
  const p = pathApi(env.platform);
  const home = env.home;
  const xdg = env.xdgConfigHome || p.join(home, ".config");
  const appData = env.appData || p.join(home, "AppData", "Roaming");
  const claudeDesktop = env.platform === "darwin"
    ? p.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
    : env.platform === "win32"
      ? p.join(appData, "Claude", "claude_desktop_config.json")
      : p.join(xdg, "Claude", "claude_desktop_config.json");
  const vscode = env.platform === "darwin"
    ? p.join(home, "Library", "Application Support", "Code", "User", "mcp.json")
    : env.platform === "win32"
      ? p.join(appData, "Code", "User", "mcp.json")
      : p.join(xdg, "Code", "User", "mcp.json");
  const opencode = p.join(xdg, "opencode", "opencode.json");
  return [
    target("cursor", "Cursor", "mcpServers", "stdio", p.join(home, ".cursor", "mcp.json"), p.join(home, ".cursor")),
    target("claude-code", "Claude Code", "mcpServers", "stdio", p.join(home, ".claude.json"), p.join(home, ".claude")),
    target("claude-desktop", "Claude Desktop", "mcpServers", "stdio", claudeDesktop, p.dirname(claudeDesktop)),
    target("vscode", "VS Code", "servers", "stdio-typed", vscode, p.dirname(vscode)),
    target("copilot", "GitHub Copilot", "mcpServers", "stdio-typed", p.join(home, ".copilot", "mcp-config.json"), p.join(home, ".copilot")),
    target("windsurf", "Windsurf", "mcpServers", "stdio", p.join(home, ".codeium", "windsurf", "mcp_config.json"), p.join(home, ".codeium", "windsurf")),
    target("gemini-cli", "Gemini CLI", "mcpServers", "stdio", p.join(home, ".gemini", "settings.json"), p.join(home, ".gemini")),
    target("codex", "Codex", "toml", "toml", p.join(home, ".codex", "config.toml"), p.join(home, ".codex")),
    target("opencode", "OpenCode", "opencode", "opencode", opencode, p.dirname(opencode)),
  ];
}

function target(id: string, label: string, root: AgentRoot, entry: AgentEntry, configPath: string, detectPath: string): AgentTarget {
  return { id, label, root, entry, configPath, detectPath };
}

export function displayPath(file: string, env: AgentEnv): string {
  const p = pathApi(env.platform);
  const home = p.resolve(env.home);
  const resolved = p.resolve(file);
  const prefix = home.endsWith(p.sep) ? home : home + p.sep;
  if (resolved.startsWith(prefix)) return `~${p.sep}${resolved.slice(prefix.length)}`;
  return file;
}
