# 插件开发

插件就是本机 `%USERPROFILE%\.agent-autoloop\plugins`（或随程序带的 `plugins/`）下的一个目录，
目录名必须是 `[a-z][a-z0-9-]*`，放一个 `agent.ts`（Agent）、`channel.ts`（通道）或 `source.ts`（事件源），
默认导出。本机装的盖过随程序带的。用 `agent-autoloop add <git 地址>` 安装第三方插件。

## 接一个 Agent（agent.ts）

中台对一个 Agent 的约定只有一个：**在最后一条回复里交代结果**。适配器做两件事：
- `command(turn)`：这一轮的命令行。
- `read(stdout, code, stderr)`：从输出读最后一条消息（还有会话、用量）。

```ts
import { tail, type Adapter } from "../../worker/agents.ts";

export default {
  command: (turn) => ["your-cli", "-p", turn.prompt, ...(turn.resume ? ["--resume", turn.resume] : [])],
  read(stdout, code, stderr) {
    if (code === null) return {};
    if (code !== 0) return { error: `退出码 ${code}：${tail(stderr || stdout)}` };
    return { text: stdout };
  },
} satisfies Adapter;
```

`turn` 提供：`prompt`（这一轮要它做的事）、`session`/`resume`（新会话/续接）、`cwd`、`model`/`effort`、
`access`（read/edit/full）、`contextFile`（资料文件路径）、`command`（rules.json 里的 command 数组）。
rules.json 里 agents 写 `"use": "command"` 加 `"command": [...]` 可以免写插件。

## 接一个通道（channel.ts）

通道循环 `hub.nextCard(50)` 等卡片，把卡片发到聊天应用，报告 `delivered`/`failed`，
把人点的答案用 `hub.answer` 转回：

```ts
export default async function channel({ hub, options, log, signal }) {
  while (!signal.aborted) {
    const { card } = await hub.nextCard(50);
    if (!card) continue;
    await hub.delivered(card.id, card.version, `ref-${card.id}`);
  }
}
```

config.json 里 `channels.<名字>` 有 `key` 和任意 `options`；rules.json 里 channels 有 `name`。

## 接一个事件源（source.ts）

把外部系统（GitHub、企业系统、脚本）的负载翻译成标准事件：

```ts
export default function source({ headers, body, secret }) {
  // 验签，返回事件数组（或抛错）
  return [{ id: "…", type: "…", subject: "…", summary: "…", detail: "…", link: "…" }];
}
```

rules.json 里 sources 写 `"adapter": "source-name"`，中台的 `/v1/in/<source>` 收 webhook，
`AGENT_AUTOLOOP_SECRET_<SOURCE>` 环境变量给验签密钥。想定时看、不能主动推的系统，
写个小脚本 `agent-autoloop emit` 即可，没新东西就退出，不花 Token。

## 让 Agent 操作网页

给 Agent 的适配器里带上浏览器能力（如 `--allowedTools=...`），或让规则加载带浏览器的 Skill。
接单程序不会把桌面浏览器的登录态带给后台运行的 Agent，适配器要注意。
