// 生成 workbench/AGENTS.md：一份「给任意 Agent 读」的自更新说明文件。
// 两部分：
//   · 能力（怎么读状态、怎么投意图、怎么调 HTTP）—— 来自代码常量，不手写，功能变它会跟着变
//   · 状态（现在在跑什么、等谁、有哪些规则）—— 来自实时快照
// 控制台每次投影时重写，所以它和 state.json 一样永远是最新的。
import {
  INTENT_ACTIONS,
  INTENT_FORBIDDEN_FIELDS,
  INTENT_MAX_BYTES,
  INTENT_MAX_PER_MINUTE,
  intentStats,
} from "./intents.mjs";

const one = (s) => String(s ?? "").replace(/\r?\n/g, " ").trim().slice(0, 200);

export function renderAgentsDoc(state, { rev, hub, workbench }) {
  const t = state.totals ?? {};
  const sp = state.spending?.today ?? {};
  const cards = state.cards ?? [];
  const runs = state.runs ?? [];
  const lines = state.lines ?? [];
  const agents = state.agents ?? [];
  const bridge = intentStats(workbench);

  const tokens = sp.tokens ?? 0;
  const money = sp.cost > 0 ? `$${Number(sp.cost).toFixed(3)}` : "费用未上报";
  const cardsMd = cards.length
    ? cards
        .map((c) => `- #${c.id} [${c.kind === "ask" ? "提问" : "通知"}] ${one(c.title)}${(c.options ?? []).length ? `（${c.options.join(" / ")}）` : ""}`)
        .join("\n")
    : "- （没有待决卡片）";

  const runsMd = runs
    .slice(0, 5)
    .map((r) => `- #${r.id} ${r.state} · ${one(r.rule)} · ${one(r.summary || r.error || "—")}`)
    .join("\n");

  const rulesMd = lines
    .map((l) => `- ${one(l.name)} → ${l.agent}${l.every ? ` · 每 ${l.every}` : ` · 来源 ${l.source}（${(l.types ?? []).join(", ") || "全部"}）`}`)
    .join("\n");

  const agentsMd = agents
    .map((a) => `- ${one(a.name)}（${a.use}@${a.worker}）${a.online ? "在线" : "离线"}`)
    .join("\n");

  const actions = INTENT_ACTIONS.join(" / ");

  return `# 工作台 · Agent 接口说明

> 自动生成，别改。控制台每次状态变化都会重写它；看 \`rev\` 知道有没有变。

- 版本：\`workbench.state/0.2\` · rev \`${rev}\` · 生成于 ${new Date().toISOString()}
- 中台：${hub}

## 一句话

中台里那条**只追加的事实日志是唯一真相**；\`state.json\` 是它的只读投影；\`intents/\` 是你表达意图的地方。
你只能做低危动作；**编排权（规则、Agent、目录、权限、模型）永远在人手里**。

## 相关文档

- \`PROJECT.md\` —— **项目台账**：已有功能、关键决策、已知问题、待办
- \`docs/architecture.md\` —— 整体架构（静态，人写，改代码前读）
- \`docs/design-rules.md\` —— **改界面前必读**：前端设计硬线（焦点环/字距/字面色值/动效）+ 自查命令
- \`docs/agent-prompt.md\` —— 多 Agent 协作的开工提示词模板

## 工作协议（人与 Agent 都遵守）

**开工前，读三份**（顺序就是从粗到细）：

1. \`PROJECT.md\` —— 这个项目做了什么、定了什么、下一步做什么
2. **本文件** —— 现在能怎么用、当前运行状态
3. \`workbench/state.json\` —— 机器可读的世界现状

**收工后，更新**：

- \`PROJECT.md\` —— **人工维护，有变化就必须改**：功能、决策、已知问题、待办
- 本文件和 \`state.json\` —— **不要手改**，控制台每 300ms 从事实日志重新生成，改了会被覆盖

一句话：**运行时状态自动，项目进展手动**。

## 读当前状态

文件：\`workbench/state.json\`（只读，UTF-8，原子换，<64KB）。

- 靠 \`rev\` 判断变化，别靠文件时间。
- \`totals.attention\` = 待决卡片数；\`cards\` = 等你决定的卡片；\`agents[].online\` = 谁还活着。
- \`runs[].state\`：queued 排队 / claimed 在跑 / unknown 失联但可能还在跑 / done 做完 / nothing 没事可做 / failed 没跑成 / cancelled 已停。
- \`bridge\` = 文件桥写侧状态：\`pending\` 待处理意图数、\`lastReceipt\` 最近一条回执。

## 采取行动（投意图）

写 \`workbench/intents/<id>.json\`，文件名去掉 \`.json\` 就是 \`id\`（必须一致）。

动作只有：${actions}

示例：

\`\`\`json
{ "id": "answer-card-42", "action": "answer", "from": "codex", "card": 42, "choice": 1 }
{ "id": "answer-text-42", "action": "answer", "from": "codex", "card": 42, "text": "两个都要" }
{ "id": "resolve-42",     "action": "resolve", "from": "codex", "card": 42, "text": "已核实解决" }
{ "id": "stop-run-17",    "action": "stop",    "from": "codex", "run": 17 }
\`\`\`

铁律：

- **原子写**：先写 \`<id>.json.tmp\`，再 \`rename\` 成 \`<id>.json\`。直接写目标文件可能被读到半截。
- **禁止字段**（带一个就整条拒收）：\`${INTENT_FORBIDDEN_FIELDS.join("`, `")}\`
- 上限：${INTENT_MAX_BYTES} 字节/条，${INTENT_MAX_PER_MINUTE} 条/分钟。
- 幂等：同一个 \`id\` 投第二次只归档不重放。
- 结果：成功进 \`intents/done/\`，失败进 \`intents/rejected/\`；都在 \`intents/receipts.ndjson\` 留档。
- \`answer\` 的 \`choice\` 从 0 起；\`resolve\` 必须带 \`text\`（结案理由）。

## 直接调 HTTP（本机、有网络时）

控制台 \`http://127.0.0.1:51425\`。要先登录（cookie），来源：打开 \`/?k=<token>\` 或 \`/login\` 输口令。

| 方法 | 路径 | 用途 | 额外 |
|---|---|---|---|
| GET | \`/api/state\` | 全部状态 | 快照 |
| GET | \`/api/stream\` | 事实流（SSE） | 增量 |
| GET | \`/api/why/:id\` | 一轮的全部事实 | 审计 |
| GET | \`/api/output/:id\` | 一轮的原始输出 | tail |
| GET | \`/api/intents\` | 意图收件箱与回执 | 只读 |
| POST | \`/api/answer\` | 回答卡片 | \`{cardId, choice\|text}\` + 头 \`X-WB: 1\` |
| POST | \`/api/stop\` | 停止一轮 | \`{runId}\` + 头 \`X-WB: 1\` |

写接口只有这两个，且都要自定义头 \`X-WB: 1\`（跨站表单带不了）。

## 当前状态

- 在跑 ${t.running} · 排队 ${t.queued} · 重试 ${t.retrying} · 失联 ${t.unknown} · **等你 ${t.attention}**
- 今日完成 ${t.doneToday} · 今日 ${sp.rounds ?? 0} 轮 · ${tokens} Token · ${money}
- 文件桥：待处理 ${bridge.pending} 条意图，最近 50 条里被拒 ${bridge.recentRejected} 条

### 待决卡片

${cardsMd}

### 在场

${agentsMd}

### 规则

${rulesMd}

### 最近轮次

${runsMd}

## 边界

- 不能改规则/Agent/目录/权限/模型（intent 里带这些字段会被拒）
- 不能新建任务（发事件要来源密钥，Agent 拿不到）
- 没有实时推送：只能轮询 \`rev\`。中台自己的 SSE 是给人看的界面用的。
`;
}
