# 编排层架构（项目 / 员工 / 图 / 运行）

> 这一层是**控制台的**，不属于内核。内核只认「事件 → 规则 → Agent」，不认识"项目""员工""图"。
> 改这一层的代码前先读完本文；本文没写的东西，说明还没想清楚，先别写代码。

## 1. 一句话

**项目 = 一张图 + 一份工作状态；员工 = 一个后端 Agent + 一段角色设定；运行 = 把图上的节点依次派给内核，节点之间用文件交接。**

## 2. 四个对象

| 对象 | 存在哪 | 谁改 | 说明 |
|---|---|---|---|
| **员工** Employee | `workflow/employees.json` | 人（界面）或负责人提案 + 人批准 | `{id, name, backend, role, persona, defaultTask}` |
| **项目** Project | `workflow/graphs/<id>.json` | 人（界面） | `{id, name, brief, nodes[], edges[], proposals[], chats{}}` |
| **图** | 项目里的 `nodes[] / edges[]` | 人（画布） | 节点四类：input / agent / confirm / output |
| **运行** Run | `workflow/runs/<id>.json` | 控制台执行器 | 一次图的执行记录，含每个节点的状态与产出文件 |

**关系**：一个项目是一张图；图里的 agent 节点指向某个员工；一次运行把这张图跑一遍。

## 3. 三条边界（不许越）

### 3.1 谁能派活

- **只有控制台执行器**能派活（`POST /api/workflow/run` 或对话 `/api/workflow/chat`）。
- 派活方式是：控制台持**来源密钥**，向内核投一条 `manual.<后端>` 事件，然后轮询该 run 直到结束。
- **Agent 拿不到来源密钥，所以 Agent 不能派活**。负责人"派活"是**输出指令块**，由控制台解析后代替它派——它本身没有这个能力。

### 3.2 谁能改员工

- **人**：界面上直接改（`POST /api/workflow/employee`）。
- **负责人**：只能提**提案**（`[[HIRE]]` / `[[EDIT]]`），进项目 `proposals[]`，**必须人在「待办」里点批准**才生效。
- 这条是硬线：**Agent 不能直接改自己的团队。**

### 3.3 什么必须走事件

- 任何真正的执行（跑模型、跑命令）都必须是一条**内核事件**，不能由控制台直接 spawn 进程。
- 好处：审计、重试、卡片、停止、用量统计全都白得。
- **反例（不许做）**：控制台里直接用 `spawn` 起一个模型进程"图省事"。

## 4. 两个协议

这两个协议是**我们发明的**，不在内核里，只存在于 `console/workflow/`。

### 4.1 负责人指令块

负责人输出文本，控制台解析：

```
[[ASSIGN 员工名字]]  派活（直接执行）
[[BRIEF]]            写进工作状态（直接执行）
[[HIRE 名字]]        招人（进提案，等人批准）
[[EDIT 名字]]        改人（进提案，等人批准）
```

- 解析器：`console/workflow/directives.mjs`，测试：`tools/test-directives.mjs`（14 项）
- 指令块**不会显示在对话里**（显示前被剥掉），但原文留在 run 的产出文件里

### 4.2 对话的一轮怎么拼

每轮对话 = 一次 `manual.<后端>` 事件，提示词按固定结构拼（**每段有字数预算，防止任务被挤掉**）：

```
【项目状态】     ≤700 字   （项目 brief，全员共享）
【项目资料】     最多 8 条 （附件绝对路径）
【负责人的工作手册】≤1100 字 （只有 role=lead 才给）
【你的角色】     ≤500 字
【本次任务】     ≤1200 字  （对话里 = 老板这句话）
【文件】         运行目录 / 上游产出 / 输出路径
【要求】         一行结论
```

总长截到 3900 字（内核 detail 上限 4000）。

## 5. 记忆分两层（这是本层最容易被误解的地方）

| 层 | 是什么 | 存在哪 | 谁读 |
|---|---|---|---|
| **短期** | 这轮对话说了什么 | `workbench/brief/chats/<项目>/<节点>.md`（落盘）+ 项目里的 `chats{}` | 员工按路径自己去读 |
| **长期** | 项目共识（目标/进展/约定/资料） | `projects[].brief` + `workbench/brief/<项目>/*` | 每个员工每轮都注入 |

**设计决定**：短期记忆不进上下文窗口，进文件。理由见第 6 条。

## 6. 明确不做：session resume（有证据，别再试）

试过给对话固定 subject，希望内核复用同一个会话。**实测无效**（2026-11-08，run #30 / #31 的 session 完全不同）。

原因在内核：

```ts
// kernel/decide.ts:184  普通事件派活——不传 resume
for (const rule of matched) enqueue(draft, rule, id, event.subject);
// kernel/decide.ts:396  卡片回答——传 session
enqueue(draft, rule, eventId, card.lane, card.agent === rule.to ? card.session : null);
// kernel/decide.ts:449  定时器——传 session
if (rule) enqueue(draft, rule, eventId, timer.lane, timer.session);
```

**结论：普通事件永远不会续用会话。** 想真续用只能改内核（`decide.ts:184` 按车道查上一轮 session），那会影响所有规则，需要全量回归。

**当前决定：不改内核。** 连续性靠第 5 条的"短期记忆落盘"解决。

## 7. 已知的债（改这块时优先还）

1. **chat 自己造了一个 mini graph**，和正式执行器是两条路——改执行器会漏掉它。应该合成 `runMode: graph | chat`。
2. **`workflow.js` 1146 行**，画布/对话/属性面板/提案/文件全在一个文件，应拆成 `canvas.js` / `chat.js` / `props.js`。
3. **`server.mjs` 1135 行**，workflow 的四个写接口全在一个 `workflowWrite` 里，应拆成路由模块。
4. **并行扇出的并发上限**是 worker 的 `capacity`（默认 2），不是我们能配的；图里扇出超过 2 会排队。

## 8. 和非编排层的边界

- 控制台**永远不直接改内核状态**（不写 SQLite、不伪造 run）。执行只走事件。
- 内核也**永远不认识**项目/员工/图——它只看到事件、规则、run。
- 两边唯一的共同语言是：**事件**（进去）和 **`/v1/state` 的 runs**（出来）。
