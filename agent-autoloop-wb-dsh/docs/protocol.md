# 通信协议

中台对外的门只有 HTTP。接单程序、通道和命令行都是它的客户端；插件与中台之间也是这个协议。

## 事件（来源 → 中台）

`POST /v1/events`，请求头 `Authorization: Bearer <source key>`，体是一个事件对象：

```json
{
  "id": "issue-42",
  "type": "issues.opened",
  "subject": "#42",
  "summary": "登录页偶发报错",
  "detail": "Issue 全文……（只当资料）",
  "link": "https://github.com/org/repo/issues/42"
}
```

- `id`：来源里的固定编号，同来源同 id 只记一次。
- `type`：小写字母、数字和 `. _ -`，以字母开头。
- `subject`：会进提示词，只能用字母、数字和 `# . _ : / @ -`；`detail` 只进资料文件。
- 返回：`{ "event": 编号, "duplicate": false, "routed": ["规则名"] }`。

## 领活（接单程序 → 中台）

`GET /v1/work?claim=<这次领活的编号>&wait=<秒>&running=<在手的轮>&capacity=1`，`Bearer <worker key>`。

中台返回 `{ "job": {...} | null, "cancel": [轮号] }`。`job` 就是派给 Agent 的活：
规则、目录、提示词要素、上下文（事件、回答、复查、待办、已决）、运行令牌。

## 交回（接单程序 → 中台）

- `POST /v1/runs/<轮>/started`，体 `{ "session": "会话id", "link": "..." }`。
- `POST /v1/runs/<轮>/result`，体是结果：

```json
{
  "outcome": "done",
  "summary": "一句话结论",
  "session": "会话id（接着原来的对话）",
  "usage": { "input": 123, "output": 45, "cost": 0.01 },
  "ask": [ { "title": "怎么发货？", "text": "...", "options": ["快递", "自提"], "key": "shipping" } ]
}
```

`outcome` 只能是 `done` / `nothing` / `failed` / `cancelled`。失败会自动退避重试。
幂等：同一次执行交两次，只生效一次；中途断电后重发也不重做。

## 卡片（通道 ↔ 中台）

- `GET /v1/cards/next?wait=50`：长轮询取一张要发的卡片。
- `POST /v1/cards/<id>/delivered` / `failed`：报告发出/失败。
- `POST /v1/cards/<id>/answer`：通道把人的回答转回来（带 `by`、`ref`）。
- 回答也可以让本人直接 `agent-autoloop answer <id> <序号>`，或点卡片链接（`links: true`）。

## 本人（命令行 → 中台）

- `GET /v1/state`：全部现状（`Bearer <owner key>`）。
- `GET /v1/runs/<轮>/why`：一轮的原始事实。
- `POST /v1/tell`、`GET /v1/stream`（SSE 日志流）等。

## 一致性

- 事件先记账、后应答：`facts` 只追加，`projections` 可整体丢弃重建。
- 日志和索引在同一事务里写盘（WAL + synchronous=FULL）。
- 运行令牌由主密钥派生，不落盘；访问密钥只存哈希。
