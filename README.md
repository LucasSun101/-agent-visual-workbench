# Agent 可视化工作台 · Agent Visual Workbench

> 把「命令行 Agent」变成一张**看得见的图**：在画布上拖节点、连线、给每个员工派活；
> 跑起来能看到每个节点在干什么、产出了什么，还能直接和「负责人」对话。

**状态：alpha。** 只在一台 Windows 机器上验证过；安装流程已做一键化（`node tools/setup.mjs`），但没在其他机器上实测过。

---

## 它解决什么问题

现在用 DeepSeek Harness / WorkBuddy / Claude Code 这类命令行 Agent，基本是「一个人守着一个终端」：
你说一句，盯着它跑；关掉窗口，事情就断了。

这个项目在它们外面加了两层：

| 层 | 作用 |
|---|---|
| **中台**（`agent-autoloop-wb-dsh/`） | 事件 → 规则 → Agent 进程。只追加的事实日志是唯一真相，`state.json` 是它的只读投影 |
| **控制台**（`console/`） | 零构建静态页 + 认证反代 + SSE + 文件桥。画布编排、运行监控、员工管理、对话 |

编排是**图和约定文件**，不是编译成规则：画布上的图只是控制台里的数据，运行时分派，
节点之间用 `workbench/handoff/<runId>/<nodeId>.md` 交接。

## 现在能做什么

- **画布编排**：拖员工进画布、拉线定顺序、一个节点连多个下游就并行扇出
- **每个节点有产物**：跑完能看它写了什么，跑的过程中自动刷新
- **和负责人对话**：每句话 = 一次真实 run，有 runId 可审计；负责人能派活、写工作状态、提招人申请
- **员工档**：后端（哪个 Agent）、角色（员工/负责人）、persona、默认任务，都能在界面上改
- **换模型 / 换后端**：插件目录里有哪些 Agent（`claude` / `codex` / `deepseek` / `dsh-desktop` …）界面就列哪些；
  每个后端能单独指定模型，界面上还能看到 Key 有没有配好（**只显示状态，不回显内容**）
- **项目资料**：每个项目能挂附件，员工按路径自己去读
- **移动端可看**：控制台绑局域网时手机能打开

## 快速开始

前置：

- **Node.js ≥ 22.18**（内核入口是 TypeScript，靠 Node 自带类型剥离直接跑；22.18 起默认开启。
  更早的版本会报 `ERR_UNKNOWN_FILE_EXTENSION`）
- **一个 Agent 后端**：DeepSeek Harness（本机安装版）、WorkBuddy CLI、Claude Code CLI、Codex CLI 任选其一
- **一个模型 API Key**（如果用 DeepSeek），**不要**提交进仓库

不需要 `npm install`：这个项目没有第三方运行时依赖，clone 下来就能跑。

```bash
# 仓库名开头有个连字符，所以要显式指定目标目录
git clone https://github.com/LucasSun101/-agent-visual-workbench.git agent-workbench
cd agent-workbench

# 1) 一键配置（会问：用哪个后端、哪个模型、Key 放哪）
node tools/setup.mjs
#    先看它会做什么、不改任何东西：node tools/setup.mjs --dry-run

# 2) 起中台（默认 3350）—— 这是前台常驻进程，别关这个窗口
npm run up

# 3) 另开一个终端，起控制台（默认 51425）
npm run console
#    首次启动会打印带 ?k=<token> 的地址，用它打开
```

也可以完全不走交互（`--backend` 只接受 `deepseek` / `workbuddy` / `claude` / `codex`）：

```bash
node tools/setup.mjs --backend deepseek --model deepseek-chat --key-file ./my-key.txt
```

Key 只有两种进法，都**不进仓库**：

- 写文件：`~/.agent-autoloop/secrets/deepseek.key`（一行，无引号）
- 环境变量：`DEEPSEEK_API_KEY=sk-...`

> 这个 key 文件**只有桌面版适配器（`dsh-desktop`）会读**。用 `deepseek` CLI、`claude`、`codex`、`workbuddy`
> 的，用它们各自 CLI 的登录态或环境变量，不需要在这里配。

## 它会在你机器上留下什么

`node tools/setup.mjs` 只写一个目录：`~/.agent-autoloop/`（配置 + `rules.json` + 事实日志），
**不会注册开机自启**（它给 `init` 带了 `--no-service`）。

如果你想要开机自动运行：

```bash
npm run init          # 不加 --no-service，会注册成登录自启（计划任务，失败则退到注册表 Run 项）
```

想撤掉：

```bash
# 方式一：用内核自带命令（会一并清理）
node --disable-warning=ExperimentalWarning --experimental-sqlite agent-autoloop-wb-dsh/bin/agent-autoloop.ts uninstall

# 方式二：手动删自启项
schtasks /Delete /TN "Agent-Autoloop" /F
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Agent-Autoloop" /f
```

## 换模型、换后端

- 界面上点员工 →「后端」下拉可选本机真实装了的 Agent（插件目录里有 `agent.ts` 的才会出现）
- 下面一行「这个后端的模型」填模型名，留空就用该后端的默认模型
- 改完写进 `~/.agent-autoloop/rules.json` 的 `agents.<后端>.model`，写前自动备份、写后跑 `check`，不过就回滚
- 「钥匙」那一行只显示**已配置 / 未配置 / 不需要**，从不显示内容

> 模型是**按后端**生效的：同一个后端的所有员工用同一个模型。要两个员工用不同模型，让它们用不同后端。

## 自检

```bash
npm test          # 语法 + .ps1 解析 + 隐私 + 隐私检查器自测 + 单元测试
```

具体查什么：没有密钥/个人路径/运行时数据进仓库、`tools/check-privacy.mjs` 自己是否还有效、
所有 `.mjs`/`.js` 能被解析、所有 `.ps1` 能被 Windows PowerShell 5.1 解析、brief 与指令协议的行为符合预期。

> **没有覆盖的**：44 个 `.ts`（整个内核）目前**没有**类型检查，也没有接 `tsc`；`npm test` 也不验证 UI。
> `npm test` 还依赖 Windows PowerShell（`.ps1` 那条），在 macOS/Linux 上会红。

## 架构

```
事件源（手动/定时/HTTP）
      │
      ▼
   中台内核 ── 事实日志（唯一真相）── state.json（只读投影）
      │
      ▼
   Agent 适配器（插件）── dsh-desktop / codebuddy / …
      │
      ▼
   文件桥 workbench/（意图、回执）

控制台 ── 认证反代 ── 浏览器（画布 / 对话 / 待办）
      └── 编排层：项目 · 员工 · 图 · 运行
```

两篇文档值得先读：

- [docs/architecture.md](docs/architecture.md) —— 整体架构、安全边界、已知坑
- [docs/orchestration.md](docs/orchestration.md) —— 编排层：四个对象、三条边界、两个协议

## 关键设计取舍（有意的）

| 决定 | 为什么 |
|---|---|
| **零构建**前端 | 改一行 CSS 刷新就生效，不需要 bundler。代价是模块只能靠 `<script>` 顺序加载 |
| **编排权永远在人手里** | Agent 不能改规则/员工/目录/模型；负责人只能提**提案**，人批准才生效 |
| **控制台不直接改内核** | 执行一律走事件，好处是审计、重试、卡片、停止、用量全都白得 |
| **不做 session resume** | 实测内核只对「卡片回答」「定时器」传 session，普通事件永远新会话。连续性改用「对话记录落盘 + 提示词里给路径」 |
| **对话不流式** | 每句话等整轮跑完（20–60 秒），先保证可审计 |

## 已知限制

- **只验证过 Windows**（内核是为 Windows 做的深度适配）
- 需要本机装好 DSH 或 WorkBuddy CLI，不是纯云端方案
- 对话非流式、不渲染 Markdown
- 前端 `workflow.js` / `canvas` 还没拆成模块（见 [docs/orchestration.md](docs/orchestration.md) 第 7 节）
- 并行扇出的真实上限是 worker 的 `capacity`（默认 2），不是图能画多少

## 安全

- 控制台只对本机/局域网开放，首次启动生成一次性口令，`?k=<token>` 登录后走 cookie
- 写接口要求自定义头 `X-WB: 1`（跨站表单带不了）
- 密钥只从 `~/.agent-autoloop/secrets/deepseek.key` 或环境变量读，**不进仓库**
- 发现安全问题请看 [SECURITY.md](SECURITY.md)

## 许可

[MIT](LICENSE)。

内核（`agent-autoloop-wb-dsh/`）的**架构与协议**借鉴自
[KKKKhazix/agent-autoloop](https://github.com/KKKKhazix/agent-autoloop)（MIT），
代码为独立实现并针对 Windows 做了深度适配；本仓库保留其 MIT 声明。

## 致谢

- [KKKKhazix/agent-autoloop](https://github.com/KKKKhazix/agent-autoloop) —— 架构与协议来源
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— 默认 Agent 后端
- [Nutlope/hallmark](https://github.com/Nutlope/hallmark)、[elayadesign/ai-design-skills](https://github.com/elayadesign/ai-design-skills) —— 界面设计硬线来源
