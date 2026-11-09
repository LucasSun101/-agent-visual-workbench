# 安装说明（给 Agent 看）

读这份说明，照着把 agent-autoloop（Windows 版）装到这台 Windows 电脑上，跑通一遍试跑，
试跑中间需要人选的，转告主人。跑通后，问问主人平时有哪些事想交给它自动处理，帮第一条规则写好。

## 前置要求

- **Windows 10 / 11**
- **Node.js 22.18+**（推荐 24）：`node -v` 确认；没有就去 https://nodejs.org 装 LTS。
- **Git for Windows**：`git --version` 确认。
- 任意一个已登录的命令行 Agent：WorkBuddy CLI（`codebuddy`）、DeepSeek Harness（`dsh`）、Claude Code 或 Codex。
  至少有一个，`agent-autoloop init` 才能认出它。

## 安装

在 PowerShell 里运行：

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

脚本会：
1. 检查 Node 和 git；
2. 把代码放到 `%USERPROFILE%\.agent-autoloop\app`；
3. 在 `%USERPROFILE%\.local\bin` 放 `agent-autoloop.cmd` 并把该目录加进用户 PATH（新开终端生效）；
4. 自动装成登录自启（任务计划或注册表）；
5. 生成第一份 `rules.json`，里面有专门试跑的「试一下」规则。

也可以让主人的 Agent 直接帮你装：把仓库地址和这句话丢给它
「帮我装一下这个项目：<你的仓库地址>。先读 README.md 和 INSTALL.md，照着装好，再跑一遍试跑。」

## 试跑

打开**新的** PowerShell 窗口（让 PATH 生效），运行：

```powershell
agent-autoloop try
```

它会用主人的 Agent 走一遍完整流程：发一个「试跑：选一个颜色」的问题 → 主人选一个颜色 →
Agent 接上原会话把活干完，显示「试跑通过」。

- 试跑中如果桌面弹了通知，那是 Agent 在问颜色。主人选完再跑 `agent-autoloop status` 看结果。
- 如果一直没动静，跑 `agent-autoloop doctor` 看哪里没配好。

## 之后

把 `%USERPROFILE%\.agent-autoloop\rules.json` 改成主人自己的规则。详细说明见
`skills/agent-autoloop/SKILL.md`（也随安装提供给了 Agent）。

常见问题：
- **`agent-autoloop` 不是内部或外部命令**：新开一个终端；还不行就跑
  `agent-autoloop` 的完整路径 `%USERPROFILE%\.local\bin\agent-autoloop.cmd`。
- **init 说找不到 Agent**：先装好并登录 WorkBuddy CLI / DeepSeek Harness（dsh）/ Claude Code / Codex，或
  `agent-autoloop init --command '你的命令 {prompt}'`。
- **Node 版本不够**：装 Node 24，删掉 `%USERPROFILE%\.agent-autoloop` 重来。
