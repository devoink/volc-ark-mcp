<p align="center">
  <img src="assets/logo.png" alt="volc-ark-mcp" width="200" />
</p>

<h1 align="center">volc-ark-mcp</h1>

<p align="center">
  让本机的 Agent 调用火山方舟生图和 Seedance 生视频。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/volc-ark-mcp"><img alt="npm" src="https://img.shields.io/badge/npm-volc--ark--mcp-006EFF" /></a>
  <img alt="version" src="https://img.shields.io/badge/version-0.1.1-006EFF" />
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D20-00E5E5" />
  <img alt="MCP" src="https://img.shields.io/badge/MCP-stdio-00E5E5" />
</p>

本地 stdio MCP。Key 存在系统凭据库，不写进各个 Agent 的配置。需要 Node.js 20 或更高版本。

## 安装和使用

### 推荐用法

日常推荐用 `npx`，不必先全局安装。Key 写进系统凭据库，Agent 配置里只写启动命令，不写 Key，也不写 `env`。

#### 命令说明

| 命令 | 作用 |
| --- | --- |
| `config set` | 交互输入方舟 API Key，写入系统凭据库。输入不回显；不要把 Key 写在命令后面 |
| `config list` | 查看 Key 是否已保存，以及来自凭据库还是当前进程环境变量。不打印 Key 本身 |
| `config delete` | 从系统凭据库删除已保存的 Key。不会改各 Agent 的 MCP 配置 |
| `test` | 用已保存的 Key 请求方舟，检查能否连通。不提交生图或生视频任务 |
| `install` | 把本 MCP 的启动命令写进所选 Agent 的用户级配置。不写 Key，不写 `env` |
| `install <id…>` | 同上，但直接指定一个或多个 Agent，例如 `install cursor` |
| `install --all` | 只给本机已检测到的 Agent 写入配置 |
| `install --list` | 列出可写入的 Agent、检测状态和配置文件路径，不写入 |
| 不带参数 | 以 stdio 启动 MCP，供 Cursor 等 Agent 连接。一般由 Agent 拉起，不必手跑 |

凭据库：macOS 用钥匙串，Windows 用凭据管理器，Linux 用 Secret Service（需已安装 `secret-tool`）。三个平台的子命令相同。

#### 推荐步骤

1. 在[方舟控制台](https://ark.volcengine.com/region:cn-beijing/apiKey)创建 API Key。
2. 保存 Key：

```bash
npx -y volc-ark-mcp config set
```

3. 可选：确认状态，并检查连通：

```bash
npx -y volc-ark-mcp config list
npx -y volc-ark-mcp test
```

4. 写入 Agent 配置。交互选择时，直接回车写入全部已检测到的；也可以直接点名：

```bash
npx -y volc-ark-mcp install
npx -y volc-ark-mcp install cursor
npx -y volc-ark-mcp install cursor claude-code
npx -y volc-ark-mcp install --all
npx -y volc-ark-mcp install --list
```

5. 完全退出并重新打开对应的 Agent。之后由 Agent 自动执行不带参数的 `npx -y volc-ark-mcp` 启动 MCP。

`install` 写入的是用户级配置，启动命令固定为 `npx -y volc-ark-mcp`。已有相同配置时保持不动；已有不同命令时不覆盖。换 Key 再跑一次 `config set`，然后重启 Agent。删除 Key 用 `config delete`。旧 Key 如果进过对话或终端历史，到方舟控制台作废。

| id | Agent | 配置文件 |
| --- | --- | --- |
| `cursor` | Cursor | `~/.cursor/mcp.json` |
| `claude-code` | Claude Code | `~/.claude.json` |
| `claude-desktop` | Claude Desktop | macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`；Windows：`%APPDATA%\Claude\claude_desktop_config.json`；Linux：`~/.config/Claude/claude_desktop_config.json` |
| `vscode` | VS Code | 用户目录下的 `mcp.json`，字段是 `servers` |
| `copilot` | GitHub Copilot | `~/.copilot/mcp-config.json` |
| `windsurf` | Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| `gemini-cli` | Gemini CLI | `~/.gemini/settings.json` |
| `codex` | Codex | `~/.codex/config.toml` |
| `opencode` | OpenCode | `~/.config/opencode/opencode.json` |

从程序坞或开始菜单打开的 Agent 不一定能找到终端里的 `npx`。找不到时，把手动配置里的 `command` 换成 `npx` 的绝对路径，`args` 保持不变。

### 其他安装方式

一般不需要。只有你更想用全局命令、项目内依赖，或要手改配置时，再看这一节。保存 Key、检查连通和启动 MCP 仍是同一套子命令，只是前面的启动方式不同；Key 在凭据库里，换一种方式启动也能读到。

其他 Agent 的文件位置见上表，字段名以各 Agent 自己的格式为准：Cursor、Claude、Windsurf、Gemini CLI 用 `mcpServers`；VS Code 用 `servers`；OpenCode 用 `mcp.servers`；Codex 用 `[mcp_servers.volc-ark-mcp]`。都不要写 Key，也不要写 `env`。

#### npm 全局安装

安装一次，之后直接敲 `volc-ark-mcp`。

```bash
npm install -g volc-ark-mcp
volc-ark-mcp config set
volc-ark-mcp config list
volc-ark-mcp test
volc-ark-mcp install
```

```json
{
  "mcpServers": {
    "volc-ark-mcp": {
      "command": "volc-ark-mcp"
    }
  }
}
```

#### 安装到当前项目

包放在项目的 `node_modules` 里，Cursor 用该项目里的入口启动。

```bash
npm install volc-ark-mcp
npx volc-ark-mcp config set
npx volc-ark-mcp config list
npx volc-ark-mcp test
```

```json
{
  "mcpServers": {
    "volc-ark-mcp": {
      "command": "node",
      "args": ["/项目绝对路径/node_modules/volc-ark-mcp/bin/volc-ark-mcp.js"]
    }
  }
}
```

把 `/项目绝对路径` 换成这个项目在本机上的路径。项目级 MCP 配置需自行写入，`install` 只写用户级配置。

#### pnpm

临时运行：

```bash
pnpm dlx volc-ark-mcp config set
pnpm dlx volc-ark-mcp test
pnpm dlx volc-ark-mcp install
```

```json
{
  "mcpServers": {
    "volc-ark-mcp": {
      "command": "pnpm",
      "args": ["dlx", "volc-ark-mcp"]
    }
  }
}
```

全局安装：

```bash
pnpm add -g volc-ark-mcp
volc-ark-mcp config set
volc-ark-mcp install
```

Cursor 配置与 npm 全局安装相同，`command` 为 `volc-ark-mcp`。

装进当前项目：

```bash
pnpm add volc-ark-mcp
pnpm exec volc-ark-mcp config set
```

Cursor 仍使用项目里的 `node_modules/volc-ark-mcp/bin/volc-ark-mcp.js`。

#### Yarn

Yarn 2 及以上用 `dlx`：

```bash
yarn dlx volc-ark-mcp config set
yarn dlx volc-ark-mcp test
yarn dlx volc-ark-mcp install
```

```json
{
  "mcpServers": {
    "volc-ark-mcp": {
      "command": "yarn",
      "args": ["dlx", "volc-ark-mcp"]
    }
  }
}
```

Yarn 1 没有 `dlx`，用全局安装：

```bash
yarn global add volc-ark-mcp
volc-ark-mcp config set
volc-ark-mcp install
```

Cursor 配置与 npm 全局安装相同。

装进当前项目：

```bash
yarn add volc-ark-mcp
yarn volc-ark-mcp config set
```

Cursor 仍使用项目里的 `node_modules/volc-ark-mcp/bin/volc-ark-mcp.js`。

## 使用

在对话里直接说要生图或生视频。没配 Key 时服务仍会启动；需要 Key 的工具会返回配置步骤。

视频是异步的。agent 提交任务后拿到 ID，再查询状态。`queued` 和 `running` 不是失败，不要重复提交。

进程环境里如果已经有 `ARK_API_KEY`，这次运行优先用它。日常配置不需要设这个变量。

可选环境变量：

- `ARK_BASE_URL`：默认 `https://ark.cn-beijing.volces.com`
- `ARK_IMAGE_MODEL`：生图未传 `model` 时使用
- `ARK_VIDEO_MODEL`：生视频未传 `model` 时使用

模型 ID 由调用方传入，或用上面两个变量作为缺省。参数取值随模型变化，错误会原样返回方舟的 `error.code` 和 `error.message`。

## 功能

| 工具 | 作用 |
| --- | --- |
| `setup_guide` | 返回配置步骤，不需要 Key |
| `estimate_generation_cost` | 按公示价估算，不调用生成接口 |
| `generate_image` | 同步生图 |
| `create_video_task` | 提交视频任务，立即返回 ID |
| `get_video_task` | 查询一个任务，不在这里轮询 |
| `list_video_tasks` | 按模型、服务等级、状态或任务 ID 列出 |
| `delete_video_task` | 取消或删除。只有 `queued` 可以取消 |

生图：

- 文生图、单图生图、多张参考图
- 组图，以及提示词优化、联网搜索、流式结果汇总
- 图层拆分，可限制张数并返回富文本 OCR
- 透明或非透明背景、输出格式、水印
- 本机图片会在 30MB 以内转成 data URI
- 可选 `max_cny`：公示价上界超限，或无法确定上界时，不提交生成

生视频：

- 文生视频、首尾帧、参考图、参考视频和参考音频
- 分辨率、比例、时长或帧数、是否出声、随机种子
- 样片、服务等级、回调、优先级
- 查询成功后返回视频地址；有尾帧时附上尾帧图
- 参考视频只接受公网 URL 或 `asset://`。本机视频和 Base64 会直接拒绝

图片默认返回 24 小时内有效的 URL。只有明确要求 `b64_json` 时，结果里才有 base64。MCP 会下载不超过 4 张、每张不超过 5MB 的图片放进工具结果，供对话界面显示。它不保存文件，也不打开播放器。请求体按 64MB 估算，超限则不提交。

当前不包含交互编辑（点选、框选、箭头）、`safety_identifier`，以及透明背景的 `auto`。组图、联网搜索和流式输出取决于模型；Seedream 5.5、5.0 pro、5.0 flash 暂不支持这三项。

## 费用

估价来自[模型价格](https://ark.volcengine.com/region:cn-beijing/docs/model-pricing)的公示价，币种 CNY，目录日期 2026-11-19。这不是账号折后结算价。审核失败不计费，所以估价是全部成功时的费用。联网搜索和版权 IP 不计入。

## 开发

```bash
npm install
npm test
```

测试覆盖请求组装、视频角色、本机视频拒绝、流式事件聚合、密钥脱敏和凭据命令。测试不调用真实付费接口，也不写入系统凭据库。推送到 `main` 或打开拉取请求时，GitHub Actions 会在 Node.js 20、22、24 上跑同一套测试。

## 发布

推送与 `package.json` 版本一致的标签后，GitHub Actions 会跑测试、打 npm 包，并把这个包发布到 npm，同时附带 provenance。仓库里不保存 npm token。发布目标是 `https://registry.npmjs.org/`。

npm 要求包先存在，才能登记可信发布者。因此 `0.1.0` 需要在已登录 npm 的机器上发布一次。之后在 [npm Trusted Publisher](https://docs.npmjs.com/trusted-publishers/) 里把 `devoink/volc-ark-mcp` 登记为发布者，工作流文件名填 `publish.yml`，并允许直接执行 `npm publish`。新建的配置要在两天内完成下一次成功发布，否则会过期。

之后每次发布：

1. 修改 `package.json` 的 `version` 并提交。
2. 打上同样的标签并推送，例如版本 `0.2.0` 对应标签 `v0.2.0`。

```bash
git tag v0.2.0
git push origin v0.2.0
```

标签和版本不一致时，工作流会停在发布之前。npm 包只包含 `bin` 和 `src`。
