# 多 Agent 协作 · 开工提示词

> **这份模板假定你在一个"已经有台账"的工作区里干活。**
> 它提到的 `PROJECT.md`（人工台账）和 `workbench/AGENTS.md`（控制台自动生成）都是**本地文件、不随仓库分发**：
> 前者只在本地维护，不随仓库分发；后者要等你本机第一次跑起控制台才会生成。
> 如果你是刚 clone 下本项目的新人，把这两处换成 `README.md` 和 `docs/architecture.md` 就行。

> 用法：**只发第 1 段那一句话**（整段是给 Agent 看的），然后直接在对话框里说要做什么。
> Agent 会自己去读文件、自己验证、自己更新台账，你不用解释架构。
> 适用于任何能读写本机文件的编码 Agent（DSH / Codex / Claude Code / WorkBuddy …）。

---

## 复制这一段给 Agent（就这一段，别加别减）

```
你在「工作台」项目里干活。工作区是 <repo> —— 先按顺序读这四份，再动手：
1) PROJECT.md（台账：已有什么、什么决策、已知问题、待办）
2) workbench/AGENTS.md（实时接口说明，自动生成）
3) docs/orchestration.md（编排层架构：四个对象、三条边界、两个协议）
4) docs/design-rules.md（改界面必读的硬线）
读完先跟我说一句"读完了，我的计划是 X"，然后按我说的做。改完必须跑验证命令，只报事实不报感觉。
```

之后你只需要在对话框里说：**「把对话页的字体调大」「给节点加个复制按钮」** 这种话。

---

## Agent 读完会知道的事（这份文件是给它看的参考）

### 一句真话：什么算"改好了"

**测试绿了才算。** 不许说"应该是好的"。没有浏览器控制权，就只能靠契约测试和 API 断言——这一点要在报告里明说。

### 验证命令（改完必跑，全绿才算完）

```powershell
# 本机捆绑的 node（不要在 PATH 里找 node）
$node = "node"

$t = (Get-Content console\.session -Raw).Trim()
& $node tools\verify-console.mjs $t     # 30 项：页面/接口/DOM 契约（app.js + workflow.js + chat.js）
& $node tools\check-css.mjs             # 样式：字面色值、动效、悬停反馈等 11 条硬线
& $node tools\test-brief.mjs            # 13 项：提示词分段预算 + 负责人手册只给 lead
& $node tools\test-directives.mjs       # 14 项：指令块解析
& $node tools\test-chat.mjs             # 7 项：对话端到端（走 slow 后端，60 秒，不花 token）
```

只改界面时可以只跑前两个；**改了 `console/*.mjs` 或 `console/workflow/*.mjs` 必须全跑**。

### 重启规则（这条最容易踩）

| 改了什么 | 要重启吗 |
|---|---|
| `console/public/*.js` `.css` `.html` | **不用**，浏览器刷新即可 |
| `console/*.mjs`、`console/workflow/*.mjs` | **必须重启**控制台进程 |

重启的坑（2026-11-08 实际踩过，白忙半小时）：

- `job_kill` 只杀外壳，**node 子进程会活下来占住 51425**，后续实例全部 `EADDRINUSE`，但文件桥还在跑 → 看起来"在运行"其实是旧代码在服务
- 查占用：`netstat -ano | Select-String ":51425\s.*LISTENING"` 取 PID
  （`Get-NetTCPConnection` 在沙箱里**静默返回空**，会骗人）
- 杀进程：`taskkill /PID <pid> /F`，**需要 `danger-full-access`**，默认沙箱报 Access denied
- **重启后必须看启动输出有没有 `EADDRINUSE`**，不能只看测试绿

### 硬规则（违反会白干或搞乱架构）

1. **只读投影别碰**：`workbench/AGENTS.md`、`workbench/state.json` 由控制台每 300ms 重写，手改会被覆盖。要改状态只有一条路——投意图。
2. **意图只能做低危动作**：`answer` / `resolve` / `stop`。带 `rules` / `agent` / `cwd` / `model` / `access` / `to` / `access_mode` 会被整条拒收。
3. **原子写意图**：先写 `<id>.json.tmp`，再 `rename` 成 `<id>.json`；文件名去 `.json` 就是 id，必须一致。
4. **编排权在人**：不要改 `~/.agent-autoloop/rules.json` 去换 Agent / 模型 / 目录，除非人明确要求。
5. **控制台永远不直接改内核状态**：执行只走事件，不写 hub.db、不伪造 run。这是 `docs/orchestration.md` 第 3.3 条。
6. **对话不靠 session resume**：内核只对"卡片回答"和"定时器"传 session，普通事件永远新会话。连续性靠"对话记录落盘 + 提示词里给路径"。别再试 resume。
7. **中文路径别过 shell**：从 UTF-8 文件读、写 UTF-8 文件；命令行里只传 ASCII。PowerShell 里 `node -e "..."` 带中文和 `$(` 极易炸——**改成写临时 .mjs 再执行**。

### 收工必须做

更新 **`PROJECT.md`**（人工维护的唯一台账）：功能清单、关键决策、已知问题、待办。
**只改这一份**。`workbench/AGENTS.md` 和 `state.json` 是自动生成的，改了就白改。

### 多人/多 Agent 同时改的约定

- **同一时间只让一个 Agent 改代码**。两个 Agent 同时改 `workflow.js` 会互相覆盖，且没人能查清是谁改坏的。
- 接手前先读 `PROJECT.md` 的「待办」，从第 1 条往下做，不要自己另起一摊。
- 如果必须并行：**按文件分工**（一个改界面、一个改服务端），事先说清谁碰哪些文件。
- 冲突仲裁以 `PROJECT.md` 为准：它没写的决定，就是还没做决定。

### 关键路径速查

| 什么 | 路径 |
|---|---|
| 工作区根 | `<repo>` |
| 台账（人维护） | `PROJECT.md` |
| 实时接口说明（自动） | `workbench/AGENTS.md` |
| 状态投影（自动） | `workbench/state.json` |
| 投意图 | `workbench/intents\` |
| 架构（内核+控制台） | `docs/architecture.md` |
| **编排层架构** | `docs/orchestration.md` |
| 界面硬线 | `docs/design-rules.md` |
| 控制台 | `http://127.0.0.1:51425`（token 在 `console\.session`） |
| 中台 | `http://127.0.0.1:3350` |
