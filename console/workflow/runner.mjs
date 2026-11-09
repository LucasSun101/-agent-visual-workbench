// 图的执行器：DAG 并发执行，节点之间用 workbench/handoff/<runId>/ 交接。
//
// 语义（和用户敲定的四条一致）：
//   · 即时编排：图只活在控制台，点运行时才派活，不写进 rules.json
//   · 约定文件：每个节点的产出写成 <nodeId>.md，下游在提示词里拿到路径
//   · 节点仍走内核：重试、卡片、审计、停止全部白得
//   · 边是单向的：上游产出给下游读；一个节点可以连多个下游（并行扇出）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MANUAL_PREFIX, manualEventType } from "./rules-sync.mjs";
import { DIRECTIVE_HELP } from "./directives.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ACTIVE = new Set(["queued", "claimed", "unknown"]);
const TYPES = new Set(["input", "agent", "confirm", "output"]);

/** 同时最多跑几个真实 Agent。与 worker 的 capacity 对齐，超过的会在中台排队。 */
const CONCURRENCY = Math.max(1, Number(process.env.WF_CONCURRENCY ?? 2));

/** 一个极简信号量：限制同时执行的 Agent 节点数。 */
function semaphore(n) {
  let active = 0;
  const queue = [];
  return {
    acquire: () =>
      new Promise((resolve) => {
        if (active < n) {
          active++;
          resolve();
        } else queue.push(() => {
          active++;
          resolve();
        });
      }),
    release: () => {
      active--;
      const next = queue.shift();
      if (next) next();
    },
  };
}

/** 结构校验 + 拓扑序（顺序只用于展示，执行靠依赖）。 */
export function plan(graph) {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!nodes.length) throw new Error("图是空的");
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) throw new Error(`边指向不存在的节点：${e.from} → ${e.to}`);
    if (e.from === e.to) throw new Error("节点不能连自己");
  }
  const inputs = nodes.filter((n) => n.type === "input");
  if (inputs.length !== 1) throw new Error(`必须有且只有一个「输入」节点（现在 ${inputs.length} 个）`);
  if (!(inputs[0].text ?? "").trim()) {
    throw new Error("「输入」节点是空的：先点它写上这次要做什么，否则下游只能拿到占位符");
  }
  const outNodes = nodes.filter((n) => n.type === "output");
  for (const o of outNodes) {
    if (edges.some((e) => e.from === o.id)) throw new Error("「输出」节点是终点，不能再连出去");
  }
  if (!nodes.some((n) => n.type === "agent")) throw new Error("图里至少要有一个 Agent 节点");

  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(byId.get(id));
    for (const e of edges.filter((x) => x.from === id)) {
      const left = (indeg.get(e.to) ?? 0) - 1;
      indeg.set(e.to, left);
      if (left === 0) queue.push(e.to);
    }
  }
  if (order.length !== nodes.length) throw new Error("图里有环，执行不了（连线必须是单向的）");
  return order;
}

// ---- 对话也是"图"，只是只有两个节点：输入(老板这句话) → 员工 ----
// 这套构造放在执行器里，server 不再自己拼 mini graph，避免两条路各改各的。

export function chatPrompt({ text, history = [], logFile }) {
  const recent = history
    .filter((m) => m.role !== "system")
    .slice(-6)
    .map((m) => `${m.role === "user" ? "老板" : "你"}：${String(m.text).slice(0, 300)}`)
    .join("\n\n");
  const parts = [];
  if (logFile) {
    parts.push(`【完整对话记录】${logFile}`);
    parts.push("（这是你和老板的全部聊天记录，需要回顾更早的内容就打开这个文件读。）");
  }
  if (recent) parts.push(`【最近几轮】\n${recent}`);
  parts.push(`【老板这次说】\n${text}`);
  return parts.join("\n\n");
}

export function chatGraph({ employee, text, history = [], logFile, brief = "" }) {
  return {
    id: "",
    name: `对话 · ${employee.name}`,
    brief,
    nodes: [
      { id: "chat-in", type: "input", x: 0, y: 0, text: chatPrompt({ text, history, logFile }) },
      { id: "chat-agent", type: "agent", x: 0, y: 0, employee: employee.id, text },
    ],
    edges: [{ from: "chat-in", to: "chat-agent" }],
  };
}

/** 跑一轮对话。和图的执行走同一个 execNode，只是图是这里合成的。 */
export function startChatRun({ store, workspace, hub, auth, sourceKey, employee, text, history, logFile, brief, resources, subjectFor, onFinish }) {
  const graph = chatGraph({ employee, text, history, logFile, brief });
  return startGraphRun({
    store,
    workspace,
    hub,
    auth,
    sourceKey,
    graph,
    employees: [employee],
    resources,
    subjectFor,
    onFinish,
  });
}

const clip = (s, n) => (s ?? "").toString().slice(0, n);

export function instructionFor({ employee, node, runDir, upstream, outFile, brief, resources }) {
  const parts = [];
  // 每一段都有自己的字数预算，保证「本次任务」永远不会被别的段挤掉
  if (brief?.trim()) parts.push(`【项目状态】（整个项目的共享背景，所有员工都要知道）\n${clip(brief.trim(), 700)}`);
  if (resources?.length) parts.push(`【项目资料】（这个项目的共享文件，需要就打开读）\n${resources.slice(0, 8).join("\n")}`);
  if (employee?.role === "lead") parts.push(`【你这个负责人的工作手册】\n${clip(DIRECTIVE_HELP, 1100)}`);
  if (employee?.persona) parts.push(`【你的角色】\n${clip(employee.persona, 500)}`);
  parts.push(`【本次任务】\n${clip(node.text?.trim() || "接着上游的产出继续做。", 1200)}`);
  parts.push(`【文件】\n本次运行目录：${runDir}`);
  if (upstream.length) parts.push(`上游的产出（存在就读）：\n${upstream.join("\n")}`);
  else parts.push("这是第一步，没有上游产出。");
  parts.push(`把最终结果写到：${outFile}`);
  parts.push("【要求】\n完成后在最后一条消息里写一行结论；不要附 agent-autoloop 回执。");
  return parts.join("\n\n").slice(0, 3900);
}

/**
 * 跑一张图。返回 run 记录（会被持续更新并落盘）。
 * @param {object} o
 * @param {object} o.store  createStore 的返回值
 * @param {string} o.workspace
 * @param {string} o.hub  http://127.0.0.1:3350
 * @param {object} o.auth { authorization: 'Bearer <owner>' } —— 只用来读 state
 * @param {string} o.sourceKey  来源密钥，用来投事件
 * @param {object} o.graph
 * @param {Array}  o.employees
 * @param {Function} o.onUpdate 状态变化回调（可选）
 */
export function startGraphRun({ store, workspace, hub, auth, sourceKey, graph, employees, resources, subjectFor, onUpdate = () => {}, onFinish = () => {} }) {
  const order = plan(graph); // 结构不对就在这里抛，调用方返回 400
  const runId = "gr-" + Date.now().toString(36);
  const runDir = path.join(workspace, "workbench", "handoff", runId);
  mkdirSync(runDir, { recursive: true });

  const edges = graph.edges ?? [];
  const parentsOf = (id) => edges.filter((e) => e.to === id).map((e) => e.from);

  const run = {
    id: runId,
    graph: { id: graph.id, name: graph.name },
    dir: runDir,
    state: "running",
    concurrency: CONCURRENCY,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    stopRequested: false,
    nodes: order.map((n) => ({
      id: n.id,
      type: n.type,
      employee: n.employee ?? null,
      state: "pending",
      runId: null,
      startedAt: null,
      finishedAt: null,
      summary: "",
      error: "",
      file: path.join(runDir, `${n.id}.md`),
      upstream: parentsOf(n.id),
    })),
  };
  store.saveRun(run);
  const bump = () => {
    store.saveRun(run);
    onUpdate(run);
  };
  const nodeOf = (id) => run.nodes.find((x) => x.id === id);
  const fileOf = (id) => path.join(runDir, `${id}.md`);
  const startOf = (id) => Date.parse(nodeOf(id)?.startedAt ?? "") || 0;

  const gate = semaphore(CONCURRENCY);

  /** 单个节点的执行体。await 上游 promise 即完成依赖等待。 */
  async function execNode(node) {
    const rec = nodeOf(node.id);
    const parents = parentsOf(node.id);

    // 上游失败或跳过 → 本节点跟着跳过，不白烧 token
    const blocked = parents.find((p) => {
      const st = nodeOf(p)?.state;
      return st === "failed" || st === "skipped";
    });
    if (blocked) {
      rec.state = "skipped";
      rec.error = `上游 ${blocked} 没成功`;
      rec.finishedAt = new Date().toISOString();
      bump();
      return;
    }
    if (run.stopRequested) {
      rec.state = "skipped";
      rec.finishedAt = new Date().toISOString();
      bump();
      return;
    }

    rec.startedAt = new Date().toISOString();
    rec.state = "running";
    bump();

    if (node.type === "input") {
      writeFileSync(rec.file, `${node.text?.trim() || "(空输入)"}\n`, "utf8");
      rec.state = "done";
      rec.summary = "输入已写入";
      rec.finishedAt = new Date().toISOString();
      bump();
      return;
    }

    if (node.type === "confirm") {
      rec.state = "waiting";
      bump();
      const ok = await new Promise((resolve) => {
        const t = setInterval(() => {
          const fresh = store.getRun(runId);
          const me = fresh?.nodes?.find((x) => x.id === node.id);
          if (!me) return;
          if (me.state !== "waiting") {
            clearInterval(t);
            resolve(me.state === "done");
          } else if (fresh.stopRequested) {
            clearInterval(t);
            resolve(false);
          }
        }, 1000);
      });
      rec.state = ok ? "done" : "skipped";
      rec.finishedAt = new Date().toISOString();
      if (!ok) run.stopRequested = true;
      if (ok) writeFileSync(rec.file, `已人工确认（${new Date().toISOString()}）\n`, "utf8");
      bump();
      return;
    }

    if (node.type === "output") {
      // 汇总所有上游的产出，形成一个可以直接给人看的结果文件
      const parts = parents.map((p) => {
        const f = fileOf(p);
        const txt = existsSync(f) ? readFileSync(f, "utf8").trim() : "（没有产出）";
        const emp = (employees ?? []).find((e) => e.id === nodeOf(p)?.employee);
        return `## ${p}${emp ? ` · ${emp.name}` : ""}\n\n${txt}`;
      });
      writeFileSync(rec.file, `# 运行结果\n\n${parts.join("\n\n---\n\n")}\n`, "utf8");
      rec.state = "done";
      rec.summary = `汇总了 ${parents.length} 个上游`;
      rec.finishedAt = new Date().toISOString();
      bump();
      return;
    }

    // ---- agent 节点 ----
    const employee = (employees ?? []).find((e) => e.id === node.employee);
    if (!employee) {
      rec.state = "failed";
      rec.error = "这个节点没绑定员工";
      rec.finishedAt = new Date().toISOString();
      bump();
      return;
    }
    const backend = employee.backend;
    // 同一个 subject 会被内核当成"同一件事"，复用同一个会话——对话就靠这个续上记忆
    const subject = subjectFor ? subjectFor(node) : `#${runId}-${node.id}`;
    const outFile = rec.file;
    const upstream = parents.map(fileOf).filter((f) => existsSync(f));
    const detail = instructionFor({ employee, node, runDir, upstream, outFile, brief: graph.brief, resources });

    await gate.acquire();
    try {
      const emit = await fetch(`${hub}/v1/events`, {
        method: "POST",
        headers: { authorization: `Bearer ${sourceKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          id: `${runId}-${node.id}`,
          type: manualEventType(backend),
          subject,
          summary: `${graph.name} · ${employee.name}`,
          detail,
        }),
      });
      if (!emit.ok) {
        rec.state = "failed";
        rec.error = `派活被拒：HTTP ${emit.status} ${(await emit.text()).slice(0, 200)}`;
        rec.finishedAt = new Date().toISOString();
        bump();
        return;
      }

      const deadline = Date.now() + 15 * 60_000;
      let finished = null;
      while (Date.now() < deadline) {
        await sleep(1500);
        let state;
        try {
          state = await (await fetch(`${hub}/v1/state`, { headers: auth })).json();
        } catch {
          continue;
        }
        const mine = (state.runs ?? []).find(
          (r) => r.rule === MANUAL_PREFIX + backend && (r.events ?? []).some((e) => e.subject === subject),
        );
        if (!mine) continue;
        rec.runId = mine.id;
        if (run.stopRequested && ACTIVE.has(mine.state)) {
          await fetch(`${hub}/v1/runs/${mine.id}/cancel`, {
            method: "POST",
            headers: { ...auth, "content-type": "application/json" },
            body: "{}",
          }).catch(() => {});
        }
        if (!ACTIVE.has(mine.state)) {
          finished = mine;
          break;
        }
      }

      rec.finishedAt = new Date().toISOString();
      if (!finished) {
        rec.state = "failed";
        rec.error = "等太久（15 分钟）没跑完";
        bump();
        return;
      }
      rec.summary = finished.summary || finished.error || "";
      if (!existsSync(outFile)) {
        writeFileSync(outFile, `${finished.summary || finished.error || "(没有产出)"}\n`, "utf8");
      }
      rec.state =
        finished.state === "done" || finished.state === "nothing"
          ? "done"
          : finished.state === "cancelled"
            ? "skipped"
            : "failed";
      if (rec.state === "failed") rec.error = finished.error || finished.state;
      bump();
    } finally {
      gate.release();
    }
  }

  // ---- 调度：每个节点等自己的上游，互不相干的同时跑 ----
  const byId = new Map(order.map((n) => [n.id, n]));
  const started = new Map();
  function start(id) {
    if (started.has(id)) return started.get(id);
    let done;
    const outer = new Promise((r) => (done = r));
    started.set(id, outer);
    (async () => {
      try {
        await Promise.all(parentsOf(id).map(start));
        await execNode(byId.get(id));
      } catch (e) {
        const rec = nodeOf(id);
        if (rec) {
          rec.state = "failed";
          rec.error = e.message;
          bump();
        }
      } finally {
        done();
      }
    })();
    return outer;
  }

  (async () => {
    try {
      await Promise.all(order.map((n) => start(n.id)));
      if (run.stopRequested) run.state = "stopped";
      else if (run.nodes.some((n) => n.state === "failed")) run.state = "failed";
      else if (run.nodes.every((n) => n.state === "skipped")) run.state = "failed";
      else run.state = "done";
    } catch (e) {
      run.state = "failed";
      run.error = e.message;
    } finally {
      run.finishedAt = new Date().toISOString();
      run.elapsedMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
      // 每个 agent 节点的实际开工时刻，用来验证"确实并行"
      run.spans = run.nodes
        .filter((n) => n.type === "agent")
        .map((n) => ({ id: n.id, start: startOf(n.id) }));
      bump();
      try {
        onFinish(run);
      } catch {}
    }
  })();

  return run;
}
