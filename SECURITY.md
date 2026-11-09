# 安全策略

## 支持范围

这是一个 alpha 阶段的个人项目，**只维护主分支**。安全问题会在主分支上直接修。

## 报告问题

**不要开公开 Issue。** 请用 GitHub 的
[Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
（仓库 → Security → Report a vulnerability）。这是唯一收件渠道。

请写清：影响范围、复现步骤、你用的版本/提交。

## 设计上的安全边界（不是漏洞，是有意的）

| 机制 | 说明 |
|---|---|
| **控制台只对本机/局域网** | 默认绑 `127.0.0.1`，可选绑内网地址；首次启动生成一次性口令，`?k=<token>` 登录后走 cookie |
| **写接口要求自定义头** `X-WB: 1` | 跨站表单带不了这个头，挡住 CSRF |
| **意图只能做低危动作** | 只接受 `answer` / `resolve` / `stop`；带 `rules`/`agent`/`cwd`/`model`/`access`/`to` 的整条拒收 |
| **Agent 拿不到来源密钥** | 所以 Agent 不能自己造事件、不能自己派活 |
| **编排权在人手里** | 负责人只能提**提案**（招人/改人），必须人批准才生效 |
| **控制台不直接改内核** | 执行一律走事件，不写数据库、不伪造 run |

## 已知风险（使用者要知道）

1. **控制台的登录令牌会打印在启动终端里**，并通过 `?k=` 出现在 URL 里。别在公共屏幕/录屏时暴露；用完可以重启换新的。
2. **项目资料（附件）是明文存在工作区里的**，员工会被给到绝对路径去读。别把敏感文件挂进项目资料。
3. **Agent 有文件与命令权限**（适配器决定 `access` 级别）。它读得到你的工作区，**别把它指到含密钥的目录**。
4. **对话记录会落盘**（`workbench/brief/chats/`），含你和负责人的全部往来。分享工作区前先清掉。
5. **不要在生产环境暴露控制台到公网**。它设计给"本机一个人用"，没有多用户隔离、没有审计加固。

## 仓库里不会有的东西

- 任何 API Key（只从 `~/.agent-autoloop/secrets/deepseek.key` 或环境变量读）
- 任何真实对话/项目数据（`workbench/`、`workflow/` 都被 `.gitignore` 排除）
- 任何个人绝对路径（发布前已做通用化）
