// 编排层的写接口：图 / 员工 / 资料 / 提案 / 运行 / 对话 / 停止 / 确认 / 节点产物。
//
// 从 server.mjs 整块搬出来（2026-11-08），正文保持原样，只是把外部依赖
// 改成调用时注入——这样 server.mjs 只负责路由分发，不再塞业务。
//
// 依赖清单（少一个就会在运行时报 ReferenceError，加接口时注意）：
//   store · send · jsonBody · ensureRulesFor · handleDirectives
//   startGraphRun · startChatRun · ROOT · HUB · HUB_AUTH · SOURCE_KEY
import { readFileSync } from "node:fs";
import path from "node:path";
import { startGraphRun, startChatRun } from "../workflow/runner.mjs";
import { backendsInfo } from "../workflow/store.mjs";
import { setBackendModel } from "../workflow/rules-sync.mjs";

export async function handleWorkflowWrite(deps, p, req, res) {
  const { store, send, jsonBody, ensureRulesFor, handleDirectives, ROOT, HUB, HUB_AUTH, SOURCE_KEY } = deps;

  const input = await jsonBody(req, res);
  if (!input) return;

  if (p === "/api/workflow/employee") {
    try {
      if (input.op === "remove") {
        const ok = store.removeEmployee(String(input.id));
        return send(res, ok ? 200 : 404, { ok });
      }
      const emp = store.upsertEmployee(input);
      return send(res, 200, { ok: true, employee: emp });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  // 给某个后端设模型（写进 rules.json 的 agents[<backend>].model）。
  // 只接受本机真实存在的后端 id，走备份 + check + 回滚。
  if (p === "/api/workflow/backend") {
    const backend = String(input.id ?? "").trim();
    if (!backend) return send(res, 400, { error: "缺 backend" });
    const known = backendsInfo().map((b) => b.id);
    if (!known.includes(backend)) return send(res, 400, { error: `本机没有这个后端：${backend}` });
    const r = setBackendModel({
      backend,
      model: String(input.model ?? ""),
      workspace: ROOT,
      repoDir: path.join(ROOT, "agent-autoloop-wb-dsh"),
      log: (m) => console.log(m),
    });
    if (r.error) return send(res, 400, { error: r.error });
    return send(res, 200, { ok: true, changed: r.changed, backends: backendsInfo() });
  }

  if (p === "/api/workflow/graph") {
    try {
      // op: "delete" 走同一个接口，少一条路由
      if (input.op === "delete") {
        const ok = store.deleteGraph(String(input.id ?? ""));
        return send(res, ok ? 200 : 404, { ok });
      }
      const g = store.saveGraph(input.graph ?? {});
      return send(res, 200, { ok: true, graph: g });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (p === "/api/workflow/run") {
    const graph = input.graph?.nodes ? input.graph : store.getGraph(String(input.graphId ?? ""));
    if (!graph) return send(res, 404, { error: "没有这张图" });
    const employees = store.employees();
    const used = [...new Set((graph.nodes ?? []).filter((n) => n.type === "agent").map((n) => {
      const emp = employees.find((e) => e.id === n.employee);
      return emp?.backend;
    }).filter(Boolean))];
    if (!used.length) return send(res, 400, { error: "图里没有绑定员工的 Agent 节点" });

    // 先确保「手动 · <后端>」规则在，再派活
    let synced;
    try {
      synced = ensureRulesFor(used);
    } catch (e) {
      return send(res, 500, { error: `规则同步失败：${e.message}` });
    }

    try {
      const run = startGraphRun({
        store,
        workspace: ROOT,
        hub: HUB,
        auth: HUB_AUTH,
        sourceKey: SOURCE_KEY,
        graph,
        employees,
        resources: graph.id ? store.listBriefFiles(graph.id).map((f) => f.path) : [],
        onUpdate: () => {},
        onFinish: (r) => handleDirectives(graph.id, r),
      });
      return send(res, 200, { ok: true, run, rulesAdded: synced.added });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (p === "/api/workflow/file") {
    try {
      const graphId = String(input.graphId ?? "");
      if (input.op === "remove") {
        const ok = store.removeBriefFile(graphId, input.name);
        return send(res, ok ? 200 : 404, { ok });
      }
      const f = store.saveBriefFile(graphId, input.name, input.data);
      return send(res, 200, { ok: true, file: { name: f.name, size: f.size } });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (p === "/api/workflow/proposal") {
    const g = store.getGraph(String(input.graphId ?? ""));
    if (!g) return send(res, 404, { error: "没有这个项目" });
    const prop = (g.proposals ?? []).find((x) => x.id === input.id);
    if (!prop) return send(res, 404, { error: "没有这个提案" });
    if (input.op === "apply") {
      try {
        const employees = store.employees();
        if (prop.kind === "hire") {
          if (employees.length >= 12) return send(res, 400, { error: "员工上限 12 个" });
          const created = store.upsertEmployee({
            name: prop.name,
            backend: prop.backend ?? "ds",
            role: prop.role ?? "worker",
            persona: prop.persona ?? "",
            defaultTask: prop.defaultTask ?? "",
          });
          // 招进来就直接放到画布上，负责人才能给它派活
          g.nodes.push({ id: "n" + Math.random().toString(36).slice(2, 7), type: "agent", x: 320, y: 320, employee: created.id, text: "" });
        } else {
          const target = employees.find((e) => e.name === prop.name);
          if (!target) return send(res, 404, { error: `找不到员工「${prop.name}」` });
          store.upsertEmployee({
            id: target.id,
            name: prop.patch?.name ?? target.name,
            backend: prop.patch?.backend ?? target.backend,
            role: prop.patch?.role ?? target.role,
            persona: prop.patch?.persona ?? target.persona,
            defaultTask: prop.patch?.defaultTask ?? target.defaultTask,
          });
        }
        g.proposals = (g.proposals ?? []).filter((x) => x.id !== prop.id);
        store.saveGraph(g);
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }
    if (input.op === "reject") {
      g.proposals = (g.proposals ?? []).filter((x) => x.id !== prop.id);
      store.saveGraph(g);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: "op 只能是 apply / reject" });
  }

  if (p === "/api/workflow/chat") {
    const g = store.getGraph(String(input.graphId ?? ""));
    if (!g) return send(res, 404, { error: "没有这个项目" });
    const nodeId = String(input.nodeId ?? "");
    const node = (g.nodes ?? []).find((n) => n.id === nodeId);
    const employees = store.employees();

    // 以客户端给的 employeeId 为准：节点可能还没保存进项目，但员工一定在
    const empId = String(input.employeeId ?? node?.employee ?? "");
    const emp = employees.find((e) => e.id === empId);
    if (!emp) {
      return send(res, 400, {
        error: `这个节点没有绑定员工（nodeId=${nodeId || "空"}，employeeId=${empId || "空"}）`,
      });
    }
    if (!node) {
      // 节点不在已保存的项目里：不阻塞对话，只是这条记录挂在 nodeId 上
      console.warn(`对话节点 ${nodeId} 不在项目 ${g.id} 里，按员工 ${emp.name} 继续`);
    }

    const text = String(input.text ?? "").trim().slice(0, 4000);
    if (!text) return send(res, 400, { error: "说点什么再发" });

    // 先把用户这句存下来，刷新页面也不会丢
    const chats = { ...(g.chats ?? {}) };
    const list = [...(chats[nodeId] ?? []), { role: "user", text, at: new Date().toISOString() }].slice(-40);
    chats[nodeId] = list;
    g.chats = chats;
    store.saveGraph(g);

    // 完整对话落盘：员工随时能打开读，不依赖上下文窗口
    const logFile = store.appendChatLog(g.id, nodeId, "user", text);

    try {
      ensureRulesFor([emp.backend]);
    } catch (e) {
      return send(res, 500, { error: `规则同步失败：${e.message}` });
    }

    // 图怎么合成、提示词怎么拼，都归执行器管（runner.mjs）；这里只管收发和存档
    startChatRun({
      store,
      workspace: ROOT,
      hub: HUB,
      auth: HUB_AUTH,
      sourceKey: SOURCE_KEY,
      employee: emp,
      text,
      history: list,
      logFile,
      brief: g.brief ?? "",
      resources: store.listBriefFiles(g.id).map((f) => f.path),
      subjectFor: () => `#chat-${g.id}-${nodeId}`,
      onFinish: (run) => {
        const rec = (run.nodes ?? []).find((n) => n.type === "agent");
        let reply = rec?.summary ?? "";
        try {
          const fromFile = readFileSync(rec.file, "utf8").trim();
          if (fromFile) reply = fromFile;
        } catch {}
        // 指令块是给我执行的，不该出现在对话里
        const shown = reply.replace(/\[\[\s*(ASSIGN|BRIEF|HIRE|EDIT)[\s\S]*?\[\[\s*\/\s*\1\s*\]\]/g, "").trim();
        const g2 = store.getGraph(g.id) ?? g;
        const ch = { ...(g2.chats ?? {}) };
        ch[nodeId] = [
          ...(ch[nodeId] ?? []),
          {
            role: "assistant",
            text: shown || "（它这轮没有输出文字，可能只做了动作）",
            at: new Date().toISOString(),
            runId: run.id,
            state: run.state,
          },
        ].slice(-40);
        g2.chats = ch;
        store.appendChatLog(g.id, nodeId, "assistant", shown || "（没说话）");
        store.saveGraph(g2);
        handleDirectives(g.id, run);
      },
    });

    return send(res, 200, { ok: true });
  }

  if (p === "/api/workflow/stop") {
    const id = String(input.runId ?? "");
    const run = store.getRun(id);
    if (!run) return send(res, 404, { error: "没有这次运行" });
    run.stopRequested = true;
    if (run.state === "running") run.state = "stopped";
    store.saveRun(run);
    return send(res, 200, { ok: true });
  }

  if (p === "/api/workflow/confirm") {
    const run = store.getRun(String(input.runId ?? ""));
    if (!run) return send(res, 404, { error: "没有这次运行" });
    const node = (run.nodes ?? []).find((n) => n.id === input.nodeId);
    if (!node) return send(res, 404, { error: "没有这个节点" });
    if (node.state !== "waiting") return send(res, 409, { error: `这个节点不在等待状态（${node.state}）` });
    node.state = input.ok === false ? "skipped" : "done";
    if (input.ok === false) run.stopRequested = true;
    store.saveRun(run);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "没有这个写接口" });
}
