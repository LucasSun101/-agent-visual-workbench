# agent-autoloop：这台电脑上的自动化中台

Agent 自动化中台（Windows 版）。它让你的命令行 Agent 在后台自己接活、自己跟进到底；平时不烦人，
遇到拿不准的事才发卡片找人拍板。这份手册就是给 Agent（和你）看的。

## 这是什么

- **内核**：只做四件事——收事件、按规则派活、把活交给 Agent、把每一步记进只追加的账本。
- **事件**：定时、GitHub webhook、业务系统报错……都变成统一格式的事件。
- **Agent**：WorkBuddy CLI（`workbuddy`）、DeepSeek Harness（`deepseek`）、Claude Code、Codex，或任何能「接一段提示词、打印最后一条回复」的命令行程序。
- **通道**：桌面通知（默认）、钉钉/企微/Slack/Discord webhook。
- **四个机制**：挂起零消耗（等你时进程退出）、事件溯源（只记账，断网重发不重做）、
  指令数据分离（外部文字只当资料）、跳数熔断（事件套事件最多 8 层）。

## 常用命令

| 命令 | 干什么 |
|---|---|
| `agent-autoloop status` | 谁在线、等你什么、在做什么、做过什么、花了多少 |
| `agent-autoloop try` | 用你的 Agent 跑一遍完整流程（提问→拍板→接着干） |
| `agent-autoloop answer <卡片> [序号]` | 回答一张卡片；通知不用写序号 |
| `agent-autoloop why <第几轮>` | 任何一轮的来龙去脉 |
| `agent-autoloop check` | 检查 rules.json 写没写对 |
| `agent-autoloop doctor` | 哪里没配好 |
| `agent-autoloop emit <类型> [--subject x]` | 手动发一条事件 |
| `agent-autoloop key new <source\|worker\|channel\|owner> <名字>` | 新建密钥 |

## 规则怎么写

`%USERPROFILE%\.agent-autoloop\rules.json`，改完几秒内自动生效。规则说三件事：**什么事、交给谁、在哪个目录干**。

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

事件规则用 `when: { "source": "github", "types": ["issues.opened"] }` 接外部事件。

## Agent 跟中台怎么配合

中台对 Agent 只有一个约定：**在最后一条回复里交代结果**。办完写一句结论；
要问人就在回复末尾附一个回执代码块：

````
订单已经核对完毕，库存充足。

```agent-autoloop
{"ask":[{"title":"怎么发货？","text":"两种方式今天都能发出。","options":["快递","自提"],"key":"shipping"}]}
```
````

回执能做的事：`ask` 提问、`notice` 通知、`resolve` 结卡片、`later` 约复查、`events` 触发新事件。

## 常见用法

- 接定时任务：`when.cron` 用五段 cron，时区默认电脑时区。
- 接 GitHub：sources 里登记 `github` 并配 webhook，密钥放 `%USERPROFILE%\.agent-autoloop\secrets.env` 的 `AGENT_AUTOLOOP_SECRET_GITHUB`。
- 接别的命令行 Agent：agents 里写 `"use": "command"` + `"command": ["your-cli", "-p", "{prompt}"]`。
- 看某一轮为什么、结果如何：`agent-autoloop why 1`。
