# Agent Autoloop（WorkBuddy / DeepSeek 版）

**让你的命令行 Agent 在 Windows 上自己接活、自己跟进到底；平时不烦你，遇到拿不准的事才发卡片找你拍板。Agent 后端可选 WorkBuddy CLI 或 DeepSeek Harness（dsh）。**

这是一个从头实现的、**原生支持 Windows** 的 Agent 自动化中台。架构与协议借鉴自 [KKKKhazix/agent-autoloop](https://github.com/KKKKhazix/agent-autoloop)（MIT），代码为独立实现，并针对 Windows 做了深度适配。

> **默认后端：DeepSeek Harness（dsh）**。本仓库对 dsh 做了深度适配（见下方「DeepSeek Harness 适配」），`init --agent deepseek` 即可一键使用。

**中文** | [English](README.en.md)

## 它解决什么问题？

平时我们用 WorkBuddy CLI、DeepSeek Harness（dsh）、Claude Code 这类命令行 Agent，大多是「人守着终端用」：你输一句话，盯着它跑，等它问你下一步；一旦关掉窗口或者人走开，事情就断了。

**Agent Autoloop** 是一个极轻量的自动化中台。它把任务调度做成一个零第三方依赖的**内核**，把事件来源、Agent、通知通道全部拆成可随时插拔的**插件**。

- **一台 Windows 电脑、一条命令就能跑。** 不用买云服务器，也不用开放公网端口。
- **一行配置接新 Agent。** 不需要 SDK，也不需要改 Agent 源码，能接收提示词并打印最后一条回复的命令行工具都能接。
- **默认两个后端可选**：WorkBuddy CLI（Windows 用户的官方 Agent）或 DeepSeek Harness（dsh，DeepSeek 官方开源编码 Agent）。init 时谁装好了就用谁，也可以 `--agent workbuddy` 或 `--agent deepseek` 指定。
- **没有后台界面。** 需要你拍板时把卡片推到桌面通知或钉钉/企微/Slack/Discord；想看全局进展，敲一行命令。

## 上手

需要装好 **Node.js 22.18+**（推荐 24）、**Git for Windows**，以及任意一个你已经登录好的命令行 Agent（WorkBuddy CLI / DeepSeek Harness / Claude Code / Codex，或 `--command` 指定的任意命令）。不需要 GitHub 账号。

### 装 Agent 后端（二选一，装好登录即可）

- **WorkBuddy CLI**：WorkBuddy / CodeBuddy 桌面应用自带，或单独安装后 `codebuddy --version` 能出结果。
- **DeepSeek Harness（推荐，默认）**：`npm install -g @deepseek-ai/dsh`，并配好 API key。验证：`dsh --version`。本项目适配的版本见下方「DeepSeek Harness 适配」。

```powershell
# 从你的仓库跑（上传到 GitHub 后）
powershell -ExecutionPolicy Bypass -File install.ps1
```

或用你本机的 Agent 真实走一遍「提问 → 退出等回复 → 拍板 → 接着干完」：

```
agent-autoloop try
```

交互终端里直接输入数字回车；非交互终端运行 `agent-autoloop answer 1 2` 选择「绿色」。再跑 `agent-autoloop status`，能看到它接上刚才的会话并显示「你选了绿色，试跑通过」，还有今天和最近 7 天的轮数、Token 和费用。

## DeepSeek Harness 适配

本仓库的默认 Agent 后端是 **DeepSeek Harness（dsh）**，headless 模式直接驱动。实测适配的版本与配置如下：

| 项 | 版本 / 值 | 说明 |
| --- | --- | --- |
| dsh | `0.2.1-rc.5`（npm 全局 `@deepseek-ai/dsh`） | `dsh --profile headless --json "<任务>"` 一次性模式 |
| Node.js | `24.x`（22.18+ 即可） | 适配器直接用 `node + lib/bin.js` 启动，绕过 npm 的 `.cmd` 包装（Windows 上 `.cmd` 不能 spawn，会 `EINVAL`） |
| headless 输出 | `--json` NDJSON 事件流 | 首行 `session` 事件带 `sessionId`，末尾 `final` 事件带 `text`；`--session-id <id>` 续会话 |
| 协议 | `anthropic-messages`（`/v1/messages`） | headless profile 的 `llm-pi-ai` provider 配置 |
| API key | `UNITTEC_API_KEY`（或 `DEEPSEEK_API_KEY`） | 适配器从 `~/.dsh/.credentials.yaml` 的 `refs` 读取并注入环境变量；dsh headless 不读 `~/.dsh/.env` |
| 模型 | `Qwen3.5-9B-text-nothink`（示例：任意 anthropic-messages 兼容端点上的模型） | 在 `~/.dsh/profiles/headless/cordis.patch.yml` 的 `agent-default-model` 里配置；默认模型可选任意 anthropic-messages 端点上的模型 |

**两个适配要点（改代码的原因）：**

1. **`.cmd` 不能直接 spawn**：Windows 上 `node:child_process` 无法 spawn npm 的 `dsh.cmd`（`spawn EINVAL`）。适配器 `plugins/deepseek/agent.ts` 会解析出真实的 `node.exe + node_modules/@deepseek-ai/dsh/lib/bin.js` 直接启动。
2. **回执围栏容错**：部分模型在输出 ```` ```agent-autoloop ```` 代码块时会**漏掉收尾的三个反引号**（输出到 JSON 末尾就 `end_turn` 截断）。`worker/contract.ts` 的围栏正则已放宽为「开头围栏后到收尾反引号或到文本结尾都算」，确保漏收尾反引号的 JSON 回执也能被解析出 ask 卡片。若换用截断更严重的模型，建议选一个能完整输出代码块 JSON 的模型（如 `Qwen3.5-9B-text-nothink`）。

WorkBuddy CLI 仍可作为可选后端（`init --agent workbuddy`）。

## 一件事怎么转起来

1. **新事件进来。** 早上 9 点的定时任务、GitHub 上新提的 Issue、业务系统报的错，都变成一条标准事件送进内核。
2. **按规则派活。** 内核照你写的规则，决定交给哪个 Agent、去哪个目录干。同一件事排队时又来的消息，会合并成一轮处理。
3. **干完一轮就退出。** Agent 把结果写在最后一条回复里，进程直接退出。
4. **拿不准才问你。** 碰到删数据、重启服务、花钱、对外发消息这类事，内核通过桌面通知或 webhook 发一张卡片给你。等你回复期间，它不占后台进程，也不消耗 Token。
5. **点一下，接着干。** 你选完，它接上原来的对话，把剩下的活干完。

## 日常怎么配？

写一份 `%USERPROFILE%\.agent-autoloop\rules.json`，在 `rules` 里写清楚**什么事、交给谁、在哪个目录干**。比如每天早上 9 点写早报：

```json
{
  "sources": { "local": { "name": "本机" } },
  "agents": { "wb": { "name": "WorkBuddy", "worker": "my-pc", "use": "workbuddy" } },
  "channels": { "desktop": { "name": "桌面通知" } },
  "rules": [
    {
      "name": "早报",
      "when": { "cron": "0 9 * * *" },
      "to": "wb",
      "cwd": "C:\\Users\\you\\notes",
      "prompt": "整理昨天的笔记和提交，写今天的早报。"
    }
  ]
}
```

想用 DeepSeek Harness 就换一行：`"agents": { "ds": { "name": "DeepSeek", "worker": "my-pc", "use": "deepseek" } }`，`to` 改成 `"ds"`。两个都配好，不同规则可以交给不同 Agent。

保存后几秒内自动生效，可以运行 `agent-autoloop check` 检查。就算改错了，系统也会继续按旧规则跑，并发卡片提醒你哪里写错了。

### Agent 怎么跟中台配合？

中台对 Agent 只有一个约定：**在最后一条回复里交代结果**。事情办完了，正常输出一句结论就行。需要向你请示时，在回复末尾附一段 `agent-autoloop` 代码块：

````
订单已经核对完毕，库存充足。

```agent-autoloop
{
  "ask": [{
    "title": "怎么发货？",
    "text": "两种方式今天都能发出。",
    "options": ["快递", "自提"],
    "key": "shipping"
  }]
}
```
````

除了提问（`ask`），还能发通知（`notice`）、关闭已解决的卡片（`resolve`）、预约复查（`later`）和触发新事件（`events`）。

## 插件体系

方向 | 内置 | 配置
--- | --- | ---
**事件**：怎么发现新活 | 定时规则、HTTP 接口、GitHub Webhook | [接事件插件](docs/plugins.md)
**Agent**：谁来干活 | WorkBuddy CLI、DeepSeek Harness、Claude Code、Codex、通用命令 | [接 Agent](docs/plugins.md)
**通道**：去哪找你拍板 | 桌面通知（默认）、钉钉/企微/Slack/Discord Webhook | [接通道](docs/plugins.md)

其他命令行 Agent 一行接入：agents 里写 `"use": "command"` 并传入命令数组，`{prompt}` 作为独立参数传递，不会被当成 shell 代码执行：

```json
"agents": {
  "dsh": { "name": "DeepSeek", "worker": "my-pc", "use": "command",
           "command": ["dsh", "--profile", "headless", "{prompt}"] }
}
```

注意：`use: "deepseek"` 用的是本项目自带的 DeepSeek Harness 适配器（自动接会话、读 sessionId），比上面这种 `use: "command"` 裸调更好用，优先用前者。

## 内核的四个机制

内核约 1800 行代码、零第三方运行时依赖。它不读系统时钟、不用随机数、不向外发请求，插件主动连进来，账号凭据留在各自的插件里；同样的输入永远得出同样的结果。

- **挂起零消耗**：等你拍板时进程直接退出，等待状态存在数据库里，Agent 不用一直挂着。你三天没回，这三天就没有 Agent 进程在跑、不花 Token；你一回答，它接着原来的对话继续干。
- **事件溯源**：所有状态都从一条只追加的日志算出来，日志和索引在同一个事务里写进磁盘，写完才应答。进程被强杀，已经确认的事不丢；任何一轮为什么跑、结果是什么，一条命令就能查清；数据格式变了就从日志重建，不用写迁移脚本。
- **指令数据分离**：思路和 SQL 参数化一样。Issue 的标题和正文等外部文字只作为资料放进文件，不拼进提示词，提示词里只有校验过字符的类型、编号和链接；用哪个 Agent、在哪个目录、什么权限，只由你本机的规则决定。
- **跳数熔断**：思路和网络包的 TTL 一样。Agent 交回的事件会再派给 Agent，层数一路累加，超过 8 层就只记录、不再派活，并发一张卡片告诉你。

### 自己跑一遍

验证什么 | 命令
--- | ---
任何一轮的来龙去脉 | `agent-autoloop why 1`
现在什么情况 | `agent-autoloop status`
哪里没配好 | `agent-autoloop doctor`

## 和原版（macOS/Linux）的差别

原版只支持 macOS 和 Linux；本仓库是**面向 Windows 的独立实现**，Windows 适配点包括：

- **Agent 后端可选**：默认优先 WorkBuddy CLI 和 DeepSeek Harness（dsh），Claude Code / Codex 也能用；`init --agent <名字>` 指定，或改 rules.json 的 `use` 字段。
- **安装**：`install.ps1` + `agent-autoloop.cmd` shim，不需要 shell 脚本。
- **后台运行**：任务计划（schtasks）登录自启，无管理员权限时退回注册表 Run 键。
- **桌面通知**：PowerShell `NotifyIcon` 托盘气泡，取代 osascript/notify-send。
- **进程管理**：接单程序用独立的 Node 启动器（`worker/runner.mjs`）拉起 Agent，输出落文件、退出码落文件，进程存活查 `tasklist`，停止用 `taskkill /T` 进程树。
- **路径**：`~` 目录展开、`%USERPROFILE%\.agent-autoloop`、junction 链接 skills。

## 更多文档

- [安装说明](INSTALL.md)
- [规则与配置手册](skills/agent-autoloop/SKILL.md)
- [如何编写插件](docs/plugins.md)
- [完整通信协议](docs/protocol.md)
- [安全边界说明](docs/security.md)

## 目录结构

位置 | 放什么
--- | ---
`kernel/` | 内核：决策、事实日志、状态投影、到期任务、规则匹配、接口行为
`host/` | 运行外壳：Node HTTP、文件与 SQLite 连接、时钟、配置、后台服务和插件加载
`protocol/` | 通信格式、JSON Schema、输入校验、HTTP 客户端
`worker/` | 接单程序：领活、运行 Agent（Windows 进程管理）、心跳与停止、读取和提交回执
`cli/`、`bin/` | 用户命令及启动入口，包括状态、回答、`why`、更新与卸载
`plugins/` | 内置 Agent、事件、通道插件
`skills/agent-autoloop/` | 中台的正式配置与操作手册，安装时也提供给 Agent 使用
`docs/` | 通信协议、插件开发说明

读代码可以从 `bin/agent-autoloop.ts` → `cli/main.ts` 开始，再按功能进入 `host/`、`worker/` 或 `plugins/`；内核设计先看[协议](docs/protocol.md)。

[MIT License](LICENSE)
