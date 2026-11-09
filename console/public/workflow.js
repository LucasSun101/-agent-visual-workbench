// 编排视图：模块区 / 画布 / 运行区 / 待办区。
// 纯手写 SVG 画布，零依赖——不引 React Flow / LiteGraph，因为它们要么要构建链，要么视觉和交互得大改。
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const NODE_W = 184;
  const HEAD = 37;
  const TYPE_NAME = { input: "输入", confirm: "确认", agent: "员工", output: "输出" };
  // 线性图标（同一套笔画，替掉 emoji —— 跨平台渲染不一致）
  const SVG = (d) =>
    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON = {
    input: SVG('<path d="M8 3v7"/><path d="M5 7.5l3 3 3-3"/><path d="M3.5 13h9"/>'),
    agent: SVG('<rect x="3" y="5.5" width="10" height="7.5" rx="2"/><path d="M8 2.5v3"/><circle cx="6.4" cy="9.2" r=".9"/><circle cx="9.6" cy="9.2" r=".9"/>'),
    confirm: SVG('<circle cx="8" cy="8" r="5.6"/><path d="M5.6 8.2l1.8 1.8 3.2-3.8"/>'),
    output: SVG('<rect x="3.5" y="2.5" width="9" height="11" rx="1.6"/><path d="M5.8 6h4.4"/><path d="M5.8 8.4h4.4"/><path d="M5.8 10.8h2.6"/>'),
  };
  const STATE_LABEL = {
    pending: "等待",
    running: "在跑",
    waiting: "等你放行",
    done: "完成",
    failed: "失败",
    skipped: "跳过",
  };

  let wf = null; // /api/workflow 快照
  let graph = null; // 当前编辑的图
  let sel = null; // 选中的节点 id
  let selEmp = null; // 正在编辑的员工 id
  let runId = null; // 本次运行
  let run = null; // 本次运行记录
  let dirty = false;
  let linking = null; // {from, x, y}
  let dragging = null; // {id, dx, dy}
  let poll = null;
  let panelMode = null; // 'node' | 'employee'

  const backendOf = (id) => (wf?.backends ?? []).find((b) => b.id === id) ?? { id, label: id, note: "" };

  /**
   * 把一个后端的说明 / 模型 / 密钥状态画出来。
   * 密钥只显示"已配置 / 未配置 / 不需要"，永远不读内容、不回显。
   */
  function applyBackendInfo(backendId) {
    const b = backendOf(backendId);
    $("wfEmpBackendNote").textContent = b.note ?? "";
    $("wfEmpModel").value = b.model ?? "";
    $("wfEmpModelNote").textContent = b.model
      ? `这个后端现在用 ${b.model}（改动会影响所有用它的员工）`
      : "留空 = 该后端的默认模型";
    $("wfEmpKeyNote").textContent =
      b.hasKey === null
        ? "钥匙：这个后端用自己 CLI 的登录态，不用在这里配"
        : b.hasKey
          ? "钥匙：已配置"
          : "钥匙：未配置 —— 在 ~/.agent-autoloop/secrets/deepseek.key 里写一行，或设环境变量 DEEPSEEK_API_KEY";
  }

  /** 员工字段：画布节点和模块区两处共用同一套，保证格式一致 */
  function fillEmployeeFields(empId, scopeText) {
    const e = (wf?.employees ?? []).find((x) => x.id === empId);
    if (!e) {
      $("wfEmpFields").hidden = true;
      selEmp = null;
      return null;
    }
    $("wfEmpFields").hidden = false;
    $("wfEmpTitle").textContent = `员工设定 · ${e.name}`;
    $("wfEmpScope").textContent = scopeText ?? "";
    $("wfEmpName").value = e.name ?? "";
    $("wfEmpRole").innerHTML = (wf?.roles ?? [])
      .map((r) => `<option value="${esc(r.id)}" ${r.id === (e.role ?? "worker") ? "selected" : ""}>${esc(r.label)}</option>`)
      .join("");
    $("wfEmpRole").value = e.role ?? "worker";
    $("wfEmpRoleNote").textContent = (wf?.roles ?? []).find((r) => r.id === (e.role ?? "worker"))?.note ?? "";
    $("wfEmpBackend").innerHTML = (wf?.backends ?? [])
      .map((b) => `<option value="${esc(b.id)}" ${b.id === e.backend ? "selected" : ""}>${esc(b.label)}</option>`)
      .join("");
    $("wfEmpBackend").value = e.backend ?? "ds";
    applyBackendInfo(e.backend);
    $("wfEmpPersona").value = e.persona ?? "";
    $("wfEmpTask").value = e.defaultTask ?? "";
    selEmp = e.id;
    return e;
  }

  // ---------- 对话（实现在 chat.js，状态全封在里面）----------
  const chat = window.WBChat({
    $: (id) => $(id),
    esc: (s) => esc(s),
    api: { get: (u) => api.get(u), post: (u, b) => api.post(u, b) },
    toast: (t, bad) => toast(t, bad),
    byId: (id) => byId(id),
    employees: () => wf?.employees ?? [],
    getGraph: () => graph,
    saveProject: (quiet) => saveProject(quiet),
    refreshFiles: () => refreshFiles(),
    startPolling: () => startPolling(),
  });
  const { openChat, closeChat, sendChat, renderChat, refreshChat } = chat;

  // ---------- 项目资料 ----------
  const fmtSize = (n) => (n < 1024 ? n + " B" : n < 1024 * 1024 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");

  function renderFiles() {
    const files = graph?.files ?? [];
    $("wfFileList").innerHTML = files.length
      ? files
          .map(
            (f) => `<div class="wf-file">
              <span class="wf-file-name" title="${esc(f.name)}">${esc(f.name)}</span>
              <span class="wf-file-size">${esc(fmtSize(f.size))}</span>
              <button class="wf-file-del" type="button" data-del="${esc(f.name)}" title="删除">×</button>
            </div>`,
          )
          .join("")
      : `<span class="wf-note" style="margin:0">还没有资料</span>`;
  }

  async function refreshFiles() {
    const id = graph?.id;
    if (!id) {
      graph.files = [];
      renderFiles();
      return;
    }
    const g = await api.get("/api/workflow/graph?id=" + encodeURIComponent(id));
    graph.files = g.files ?? [];
    renderFiles();
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
      fr.onerror = () => reject(new Error("读文件失败"));
      fr.readAsDataURL(file);
    });
  }

  const api = {
    get: (p) => fetch(p, { cache: "no-store" }).then((r) => r.json()),
    post: (p, body) =>
      fetch(p, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wb": "1" },
        body: JSON.stringify(body ?? {}),
      }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) })),
  };

  function toast(text, bad) {
    const el = $("toast");
    el.textContent = text;
    el.dataset.bad = bad ? "1" : "0";
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, 3200);
  }

  // ---------- 视图切换 ----------
  function switchView(v) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
    const isWf = v === "workflow";
    $("grid").hidden = isWf;
    $("wf").hidden = !isWf;
    if (isWf) {
      startPolling();
      renderAll();
    } else {
      stopPolling();
      $("wfProps").hidden = true;
    }
  }

  // ---------- 加载 ----------
  async function loadWorkflow() {
    wf = await api.get("/api/workflow");
    return wf;
  }

  async function loadGraph(id) {
    if (!id) {
      graph = { id: "", name: "新项目", brief: "", nodes: [], edges: [] };
      addNode("input", 90, 120);
      dirty = true;
      return;
    }
    graph = await api.get("/api/workflow/graph?id=" + encodeURIComponent(id));
    graph.brief = graph.brief ?? "";
    graph.files = graph.files ?? [];
    dirty = false;
  }

  /** 保存当前项目（画布 + 工作状态 + 项目名），quiet 时不弹提示（给自动保存用） */
  async function saveProject(quiet) {
    if (!graph) return false;
    graph.name = $("wfName").value.trim() || "未命名项目";
    const r = await api.post("/api/workflow/graph", { graph });
    if (!r.ok) {
      toast(`保存失败：${r.body.error ?? r.status}`, true);
      return false;
    }
    graph = r.body.graph;
    dirty = false;
    await loadWorkflow();
    renderAll();
    if (!quiet) toast("已保存");
    return true;
  }

  /** 切换/新建项目之后，把上一个项目的界面状态清干净 */
  function resetView() {
    sel = null;
    selEmp = null;
    panelMode = null;
    $("wfProps").hidden = true;
    stopOutPoll();
    run = null;
    runId = null;
    renderAll();
  }

  // ---------- 模块区 ----------
  const modMarkup = (type, name, sub, employee, role) =>
    `<div class="wf-mod" draggable="true" data-type="${esc(type)}"${employee ? ` data-employee="${esc(employee)}"` : ""}>
      <span class="wf-grip" title="按住拖到画布">⠿</span>
      <span class="wf-ico">${ICON[type] ?? ""}</span>
      <span class="wf-mod-name">${esc(name)}${role === "lead" ? ' <i class="wf-lead">负责人</i>' : ""}</span>
      <span class="wf-mod-sub">${esc(sub)}</span>
      ${employee ? `<button class="wf-mod-edit" type="button" draggable="false" data-edit="${esc(employee)}" title="编辑这个员工">✎</button>` : ""}
    </div>`;

  function renderPalette() {
    $("wfBase").innerHTML =
      modMarkup("input", "输入", "起点：需求或初始资料", null) +
      modMarkup("confirm", "人工确认", "停在这里等你放行", null) +
      modMarkup("output", "输出", "把上游产出汇总成一个文件", null);
    const list = wf?.employees ?? [];
    $("wfEmployees").innerHTML = list.length
      ? list
          .map((e) => {
            const task = (e.defaultTask || e.persona || "").replace(/\s+/g, " ").slice(0, 16);
            return modMarkup("agent", e.name, `${backendOf(e.backend).short ?? e.backend} · ${task || "没有设定"}`, e.id, e.role);
          })
          .join("")
      : `<div class="empty">还没有员工，点下面招一个。</div>`;
  }

  // ---------- 节点产物 ----------
  let outPoll = null;
  function stopOutPoll() {
    if (outPoll) clearInterval(outPoll);
    outPoll = null;
  }

  async function loadNodeOutput(id) {
    const box = $("wfPropOut");
    const rid = run?.id ?? wf?.runs?.[0]?.id ?? null;
    $("wfPropOutMeta").textContent = rid ?? "";
    if (!rid) {
      box.textContent = "还没有运行记录。点「▶ 运行」跑一次，这里就会显示它写出来的东西。";
      return;
    }
    const r = await api.get(`/api/workflow/nodefile?run=${encodeURIComponent(rid)}&node=${encodeURIComponent(id)}`);
    box.textContent = r.missing ? "（这个节点还没有产物文件）" : r.text || "（空）";
  }

  // ---------- 画布 ----------
  function anchorOut(n) {
    return { x: n.x + NODE_W, y: n.y + HEAD / 2 + 2 };
  }
  function anchorIn(n) {
    return { x: n.x, y: n.y + HEAD / 2 + 2 };
  }
  const byId = (id) => (graph?.nodes ?? []).find((n) => n.id === id);

  function nodeTitle(n) {
    if (n.type === "agent") {
      const emp = (wf?.employees ?? []).find((e) => e.id === n.employee);
      return emp ? emp.name : "未指派";
    }
    return TYPE_NAME[n.type] ?? n.type;
  }

  function nodeSub(n) {
    if (n.type === "input") return "起点 · 需求或初始资料";
    if (n.type === "confirm") return "暂停 · 等你放行";
    if (n.type === "output") return "终点 · 汇总上游产出成一个文件";
    const emp = (wf?.employees ?? []).find((e) => e.id === n.employee);
    return emp ? `后端 ${esc(emp.backend)}` : "还没指派员工";
  }

  function renderNodes() {
    const box = $("wfNodes");
    const nodes = graph?.nodes ?? [];
    $("wfEmpty").hidden = nodes.length > 0;
    $("wf").classList.toggle("linking", Boolean(linking));
    box.innerHTML = nodes
      .map((n) => {
        const st = runStateOf(n.id);
        const text = (n.text || "").replace(/\s+/g, " ") || "（点我写任务说明）";
        // 徽标按「角色」显示，不是按节点类型——否则改成负责人了还写着「员工」
        const emp = n.type === "agent" ? (wf?.employees ?? []).find((e) => e.id === n.employee) : null;
        const isLead = emp?.role === "lead";
        const badge = n.type === "agent" ? (isLead ? "负责人" : "员工") : (TYPE_NAME[n.type] ?? n.type);
        return `<div class="wf-node ${sel === n.id ? "sel" : ""}" data-id="${esc(n.id)}" data-type="${esc(n.type)}"
             ${isLead ? 'data-lead="1"' : ""}
             data-state="${esc(st)}" style="left:${n.x}px;top:${n.y}px">
          <div class="wf-node-head">
            <span class="wf-grip" title="按住拖动">⠿</span>
            <span class="wf-ico">${ICON[n.type] ?? ""}</span>
            <span class="wf-node-title">${esc(nodeTitle(n))}</span>
            <span class="wf-badge">${esc(badge)}</span>
            ${n.type === "agent" ? '<button class="wf-chat-btn" type="button" data-chat="1" title="和它对话">对话</button>' : ""}
            <button class="wf-del" type="button" title="删除">×</button>
          </div>
          <div class="wf-node-body">
            <div class="wf-node-sub">${nodeSub(n)}</div>
            <div class="wf-node-text">${esc(text.slice(0, 46))}</div>
          </div>
          ${st ? `<span class="wf-node-state">${esc(STATE_LABEL[st] ?? st)}</span>` : ""}
          ${n.type !== "input" ? '<span class="wf-port in" title="输入"></span>' : ""}
          ${!["confirm", "output"].includes(n.type) ? '<span class="wf-port out" title="拖到别的节点连线"></span>' : ""}
        </div>`;
      })
      .join("");
  }

  function runStateOf(nodeId) {
    const n = (run?.nodes ?? []).find((x) => x.id === nodeId);
    return n?.state && n.state !== "pending" ? n.state : "";
  }

  function renderEdges() {
    const svg = $("wfEdges");
    // 箭头：边是单向的（上游产出给下游读）
    const defs = `<defs>
      <marker id="wfArrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="9" markerHeight="9" orient="auto">
        <path d="M0 0 L10 5 L0 10 z" fill="#5aa0d0"></path>
      </marker>
      <marker id="wfArrowTemp" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="9" markerHeight="9" orient="auto">
        <path d="M0 0 L10 5 L0 10 z" fill="#49c6ff"></path>
      </marker>
    </defs>`;
    const paths = (graph?.edges ?? [])
      .map((e) => {
        const a = byId(e.from);
        const b = byId(e.to);
        if (!a || !b) return "";
        const p1 = anchorOut(a);
        const p2 = anchorIn(b);
        const d = `M ${p1.x} ${p1.y} C ${p1.x + 70} ${p1.y}, ${p2.x - 70} ${p2.y}, ${p2.x - 2} ${p2.y}`;
        return `<path data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${d}" marker-end="url(#wfArrow)"></path>`;
      })
      .join("");
    const temp = linking
      ? `<path class="temp" marker-end="url(#wfArrowTemp)" d="M ${linking.ax} ${linking.ay} C ${linking.ax + 70} ${linking.ay}, ${linking.x - 70} ${linking.y}, ${linking.x} ${linking.y}"></path>`
      : "";
    svg.innerHTML = defs + paths + temp;
  }

  function renderAll() {
    if (!graph) return;
    // 正在输入的时候别覆盖，否则光标会跳
    if (document.activeElement !== $("wfName")) $("wfName").value = graph.name ?? "新项目";
    if (document.activeElement !== $("wfBrief")) $("wfBrief").value = graph.brief ?? "";
    updateBriefState();
    renderFiles();
    renderPalette();
    renderProjectBar();
    renderNodes();
    renderEdges();
    renderRun();
    setStatus(dirty ? "未保存" : "已保存");
  }

  function updateBriefState() {
    const n = (graph?.brief ?? "").length;
    $("wfBriefState").textContent = n ? `${n} 字 · 全员共享` : "全员共享（空的）";
  }

  /** 项目栏：一张画布就是一个项目 */
  function renderProjectBar() {
    const cur = graph?.id ?? "";
    const list = wf?.graphs ?? [];
    $("wfProjects").innerHTML = list.length
      ? list
          .map(
            (g) => `<button class="wf-proj ${g.id === cur ? "on" : ""}" type="button" data-id="${esc(g.id)}" title="${esc(g.name)}">
              ${esc(g.name)}<span class="n">${g.nodes ?? 0}</span>
            </button>`,
          )
          .join("")
      : `<span class="wf-note" style="margin:0">还没有项目</span>`;
  }

  function setStatus(text, bad) {
    const el = $("wfStatus");
    el.textContent = text;
    el.style.color = bad ? "var(--bad)" : "";
  }

  // ---------- 运行区 ----------
  function renderRun() {
    const box = $("wfRunNodes");
    $("wfRunState").textContent = run ? run.state : "—";
    $("wfStop").hidden = !(run && run.state === "running");
    const nodes = run?.nodes ?? [];
    if (!nodes.length) {
      box.innerHTML = `<div class="empty">还没运行过。点「运行」开始。</div>`;
      return;
    }
    box.innerHTML = nodes
      .map(
        (n) => `<div class="wf-rn" data-state="${esc(n.state)}" data-node="${esc(n.id)}">
          <span class="dot"></span>
          <span class="wf-rn-name">${esc(nodeTitle({ ...n }))}</span>
          <span class="wf-rn-state">${esc(STATE_LABEL[n.state] ?? n.state)}</span>
        </div>`,
      )
      .join("");
    const waiting = nodes.find((n) => n.state === "waiting");
    if (waiting) {
      box.insertAdjacentHTML(
        "beforeend",
        `<div class="drawer-actions" style="margin-top:6px">
           <button class="wf-hire" style="flex:1" data-confirm="1">✓ 放行</button>
           <button class="wf-hire" style="flex:1;color:#ffb3b3;border-color:rgba(255,107,107,.5)" data-confirm="0">✕ 取消</button>
         </div>`,
      );
    }
  }

  async function showNodeFile(nodeId) {
    if (!run) return;
    const r = await api.get(`/api/workflow/nodefile?run=${encodeURIComponent(run.id)}&node=${encodeURIComponent(nodeId)}`);
    $("wfNodeOut").textContent = r.missing ? "（这个节点还没有产出文件）" : r.text || "（空）";
  }

  // ---------- 待办 ----------
  async function renderTodo() {
    const state = await api.get("/api/state");
    const cards = state.cards ?? [];
    const props = graph?.proposals ?? [];
    $("wfTodoCount").textContent = cards.length + props.length;

    const propHtml = props
      .map((p) => {
        const title =
          p.kind === "hire"
            ? `招一个「${esc(p.name)}」（${esc(backendOf(p.backend).short ?? p.backend ?? "真实模型")}）`
            : `改「${esc(p.name)}」的设定`;
        return `<div class="card-item" data-kind="notice">
          <div class="ci-top"><span class="kind">负责人提案 · ${p.kind === "hire" ? "招人" : "改人"}</span></div>
          <div class="ci-title">${title}</div>
          <div class="ci-opts">
            <button class="opt" type="button" data-prop="${esc(p.id)}" data-op="apply">批准</button>
            <button class="opt" type="button" data-prop="${esc(p.id)}" data-op="reject">拒绝</button>
          </div>
        </div>`;
      })
      .join("");

    if (!cards.length && !props.length) {
      $("wfTodo").innerHTML = `<div class="empty">没有等你决定的事。</div>`;
      return;
    }
    $("wfTodo").innerHTML =
      propHtml +
      cards
        .map((c) => {
          const opts = (c.options ?? [])
            .map((o, i) => `<button class="opt" type="button" data-card="${c.id}" data-choice="${i}">${i + 1} ${esc(o)}</button>`)
            .join("");
          return `<div class="card-item" data-kind="${esc(c.kind)}">
            <div class="ci-top"><span class="kind">${c.kind === "ask" ? "提问" : "通知"}</span>
              <span class="age">#${esc(c.id)}</span></div>
            <div class="ci-title">${esc(c.title)}</div>
            ${opts ? `<div class="ci-opts">${opts}</div>` : ""}
          </div>`;
        })
        .join("");
  }

  // ---------- 轮询 ----------
  function startPolling() {
    if (poll) return;
    poll = setInterval(async () => {
      try {
        const before = JSON.stringify(wf?.employees ?? []);
        wf = await api.get("/api/workflow");
        if (JSON.stringify(wf.employees ?? []) !== before) renderPalette();
        if (runId) {
          run = (wf.runs ?? []).find((r) => r.id === runId) ?? run;
          renderRun();
          renderNodes();
        }
        await renderTodo();
      } catch {
        /* 下次再来 */
      }
    }, 2500);
  }
  function stopPolling() {
    if (poll) clearInterval(poll);
    poll = null;
  }

  // ---------- 编辑操作 ----------
  function addNode(type, x, y, employee) {
    if (!graph) return;
    if (type === "input" && graph.nodes.some((n) => n.type === "input")) {
      toast("一张图只能有一个「输入」节点", true);
      return;
    }
    const id = "n" + Math.random().toString(36).slice(2, 7);
    let empId = employee ?? null;
    let text = "";
    if (type === "agent") {
      if (!empId) empId = wf?.employees?.[0]?.id ?? null;
      const emp = (wf?.employees ?? []).find((e) => e.id === empId);
      text = emp?.defaultTask ?? ""; // 员工设了默认任务就预填
    }
    graph.nodes.push({ id, type, x: Math.round(x), y: Math.round(y), employee: empId, text });
    dirty = true;
    sel = id;
    renderNodes();
    renderEdges();
    openProps(id);
    setStatus("未保存");
  }

  function deleteNode(id) {
    graph.nodes = graph.nodes.filter((n) => n.id !== id);
    graph.edges = graph.edges.filter((e) => e.from !== id && e.to !== id);
    if (sel === id) {
      sel = null;
      $("wfProps").hidden = true;
    }
    dirty = true;
    renderNodes();
    renderEdges();
    setStatus("未保存");
  }

  function openProps(id) {
    const n = byId(id);
    if (!n) return;
    panelMode = "node";
    sel = id;
    $("wfProps").hidden = false;
    $("wfNodeFields").hidden = false;
    $("wfPropTitle").textContent = `${TYPE_NAME[n.type] ?? ""} · ${nodeTitle(n)}`;
    $("wfPropTextLabel").textContent =
      n.type === "input"
        ? "输入内容（这一步要做什么，会交给第一个员工）"
        : n.type === "confirm"
          ? "说明（只给你自己看，可留空）"
          : n.type === "output"
            ? "备注（只给你自己看，可留空）"
            : "这一步要它做什么（只对这个节点生效）";
    $("wfPropText").value = n.text ?? "";
    const empWrap = $("wfPropEmpWrap");
    if (n.type === "agent") {
      empWrap.hidden = false;
      $("wfPropEmp").innerHTML = (wf?.employees ?? [])
        .map((e) => `<option value="${esc(e.id)}" ${e.id === n.employee ? "selected" : ""}>${esc(e.name)}（${esc(backendOf(e.backend).label)}）</option>`)
        .join("");
      $("wfPropEmp").value = n.employee ?? (wf?.employees?.[0]?.id ?? "");
      if (!n.employee) n.employee = $("wfPropEmp").value;
      // 同一个员工设定块，位置和格式跟模块区点 ✎ 完全一致
      fillEmployeeFields(n.employee, "这些是员工本身的设定（不是这个节点的）。改了会影响所有用它的节点。");
    } else {
      empWrap.hidden = true;
      $("wfEmpFields").hidden = true;
      selEmp = null;
    }
    // 对话入口对任何 Agent 节点都开着（负责人只是多了指令能力，不是能聊天的前提）
    $("wfPropChatWrap").hidden = n.type !== "agent";
    renderNodes();
    renderEdges();

    // 打开面板就显示这个节点当前的产物；跑的过程中自动刷新
    stopOutPoll();
    loadNodeOutput(id);
    outPoll = setInterval(() => {
      if ($("wfProps").hidden || panelMode !== "node") return stopOutPoll();
      if (run && run.state === "running") loadNodeOutput(sel);
    }, 2500);
  }
  function openEmployeeProps(id) {
    const e = (wf?.employees ?? []).find((x) => x.id === id);
    if (!e) return;
    stopOutPoll();
    panelMode = "employee";
    sel = null;
    $("wfProps").hidden = false;
    $("wfNodeFields").hidden = true;
    $("wfPropTitle").textContent = `员工 · ${e.name}`;
    const used = (graph?.nodes ?? []).filter((n) => n.employee === id).length;
    fillEmployeeFields(id, used ? `这张图里有 ${used} 个节点用它，改动会一并生效。` : "这张图还没有节点用它。");
    renderNodes();
    renderEdges();
  }

  // ---------- 事件绑定 ----------
  function bindCanvas() {
    const canvas = $("wfCanvas");

    // 从模块区拖进来：拖到画布上方时给出明确的落点提示
    const setDropHint = (on) => {
      canvas.classList.toggle("dropping", on);
      $("wfDrop").hidden = !on;
    };
    canvas.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropHint(true);
    });
    canvas.addEventListener("dragleave", (e) => {
      // 移到子元素上也会触发 dragleave，只有真的离开画布才收起
      if (!canvas.contains(e.relatedTarget)) setDropHint(false);
    });
    canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      setDropHint(false);
      const type = e.dataTransfer.getData("type");
      if (!type) return;
      const employee = e.dataTransfer.getData("employee") || null;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left + canvas.scrollLeft - NODE_W / 2;
      const y = e.clientY - rect.top + canvas.scrollTop - HEAD / 2;
      addNode(type, Math.max(10, x), Math.max(10, y), employee);
    });

    // 选节点 / 删除 / 从端口拖线
    $("wfNodes").addEventListener("mousedown", (e) => {
      const del = e.target.closest(".wf-del");
      const chatBtn = e.target.closest(".wf-chat-btn");
      const node = e.target.closest(".wf-node");
      if (!node) return;
      const id = node.dataset.id;
      if (del) {
        deleteNode(id);
        e.stopPropagation();
        return;
      }
      if (chatBtn) {
        e.preventDefault();
        e.stopPropagation();
        openChat(id);
        return;
      }
      const port = e.target.closest(".wf-port.out");
      if (port) {
        const n = byId(id);
        const a = anchorOut(n);
        linking = { from: id, ...a, ax: a.x, ay: a.y };
        $("wf").classList.add("linking");
        renderEdges();
        e.preventDefault();
        return;
      }
      // 拖动节点
      const rect = canvas.getBoundingClientRect();
      const n = byId(id);
      dragging = {
        id,
        moved: false,
        dx: e.clientX - rect.left + canvas.scrollLeft - n.x,
        dy: e.clientY - rect.top + canvas.scrollTop - n.y,
      };
      sel = id;
      renderNodes();
      renderEdges();
      document.querySelector(`.wf-node[data-id="${id}"]`)?.classList.add("dragging");
    });

    document.addEventListener("mousemove", (e) => {
      if (linking) {
        const rect = canvas.getBoundingClientRect();
        linking.x = e.clientX - rect.left + canvas.scrollLeft;
        linking.y = e.clientY - rect.top + canvas.scrollTop;
        renderEdges();
      } else if (dragging) {
        const n = byId(dragging.id);
        if (!n) return;
        const rect = canvas.getBoundingClientRect();
        const nx = Math.max(4, Math.round(e.clientX - rect.left + canvas.scrollLeft - dragging.dx));
        const ny = Math.max(4, Math.round(e.clientY - rect.top + canvas.scrollTop - dragging.dy));
        if (nx !== n.x || ny !== n.y) dragging.moved = true;
        n.x = nx;
        n.y = ny;
        const el = document.querySelector(`.wf-node[data-id="${dragging.id}"]`);
        if (el) {
          el.style.left = n.x + "px";
          el.style.top = n.y + "px";
        }
        renderEdges();
        dirty = true;
      }
    });

    document.addEventListener("mouseup", (e) => {
      if (linking) {
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest(".wf-node");
        const from = linking.from;
        linking = null;
        $("wf").classList.remove("linking");
        if (target && target.dataset.id !== from && graph) {
          const to = target.dataset.id;
          const exists = graph.edges.some((x) => x.from === from && x.to === to);
          if (!exists) {
            graph.edges.push({ from, to });
            dirty = true;
            setStatus("未保存");
          }
        }
        renderEdges();
      }
      if (dragging) {
        const wasDrag = dragging.moved;
        const id = dragging.id;
        dragging = null;
        document.querySelector(`.wf-node[data-id="${id}"]`)?.classList.remove("dragging");
        if (!wasDrag) {
          // 没挪动 = 当点击处理：打开属性面板
          openProps(id);
        } else {
          setStatus("未保存");
        }
      }
    });

    // 点空白取消选中
    canvas.addEventListener("click", (e) => {
      if (e.target === canvas || e.target === $("wfNodes") || e.target.id === "wfEdges") {
        sel = null;
        $("wfProps").hidden = true;
        renderNodes();
        renderEdges();
      }
    });
  }

  // ---------- 启动 ----------
  async function boot() {
    document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));

    await loadWorkflow();
    const first = wf.graphs?.[0]?.id ?? null;
    await loadGraph(first);
    renderAll();
    renderTodo();

    // 模块区拖拽源
    $("wf").addEventListener("dragstart", (e) => {
      const mod = e.target.closest(".wf-mod");
      if (!mod) return;
      e.dataTransfer.setData("type", mod.dataset.type);
      if (mod.dataset.employee) e.dataTransfer.setData("employee", mod.dataset.employee);
      e.dataTransfer.effectAllowed = "copy";
      mod.classList.add("dragging");
    });
    $("wf").addEventListener("dragend", (e) => {
      e.target.closest(".wf-mod")?.classList.remove("dragging");
      $("wfCanvas").classList.remove("dropping");
      $("wfDrop").hidden = true;
    });

    bindCanvas();

    $("wfHire").addEventListener("click", async () => {
      const name = window.prompt("新员工叫什么？", "小A");
      if (!name) return;
      const r = await api.post("/api/workflow/employee", { name, backend: "ds", persona: "", defaultTask: "" });
      if (!r.ok) return toast(`招人失败：${r.body.error ?? r.status}`, true);
      await loadWorkflow();
      renderAll();
      openEmployeeProps(r.body.employee.id);
      toast("已招入，在右边填它的设定");
    });

    // 员工卡片上的 ✎：编辑属性
    $("wfEmployees").addEventListener("click", (e) => {
      const b = e.target.closest("[data-edit]");
      if (b) openEmployeeProps(b.dataset.edit);
    });

    $("wfEmpSave").addEventListener("click", async () => {
      if (!selEmp) return;
      const r = await api.post("/api/workflow/employee", {
        id: selEmp,
        name: $("wfEmpName").value.trim() || "未命名",
        backend: $("wfEmpBackend").value,
        role: $("wfEmpRole").value,
        persona: $("wfEmpPersona").value,
        defaultTask: $("wfEmpTask").value,
      });
      if (!r.ok) return toast(`保存失败：${r.body.error ?? r.status}`, true);
      const saved = selEmp;
      const mode = panelMode;
      const nodeId = sel;
      await loadWorkflow();
      renderAll();
      // 从哪个入口进来就回到哪个入口，别把人踢出画布
      if (mode === "node" && nodeId) openProps(nodeId);
      else openEmployeeProps(saved);
      toast("员工已保存");
    });

    $("wfEmpDelete").addEventListener("click", async () => {
      if (!selEmp) return;
      const used = (graph?.nodes ?? []).filter((n) => n.employee === selEmp);
      if (used.length && !window.confirm(`这张图里有 ${used.length} 个节点用着它，开除后它们会变成「未指派」。继续？`)) return;
      const r = await api.post("/api/workflow/employee", { op: "remove", id: selEmp });
      if (!r.ok) return toast(`开除失败：${r.body.error ?? r.status}`, true);
      selEmp = null;
      $("wfProps").hidden = true;
      await loadWorkflow();
      renderAll();
      toast("已开除");
    });
    $("wfSave").addEventListener("click", () => saveProject(false));

    // 项目栏：切换项目
    $("wfProjects").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-id]");
      if (!b || b.dataset.id === graph?.id) return;
      if (dirty && !window.confirm("当前项目有未保存的修改，确定切换？")) return;
      await loadGraph(b.dataset.id);
      resetView();
    });

    // 新建项目
    $("wfNewProject").addEventListener("click", async () => {
      if (dirty && !window.confirm("当前项目有未保存的修改，确定新建？")) return;
      if ((wf?.graphs ?? []).length >= 20) return toast("项目上限 20 个", true);
      graph = { id: "", name: "新项目", brief: "", nodes: [], edges: [] };
      sel = null;
      selEmp = null;
      panelMode = null;
      run = null;
      runId = null;
      $("wfProps").hidden = true;
      stopOutPoll();
      renderAll();
      addNode("input", 90, 140);
      setStatus("未保存");
    });

    // 删除项目
    $("wfDeleteProject").addEventListener("click", async () => {
      if (!graph?.id) return toast("这个项目还没保存过，直接刷新页面就没了", true);
      if (!window.confirm(`删除项目「${graph.name}」？画布和工作状态都会没，不可恢复。`)) return;
      const r = await api.post("/api/workflow/graph", { op: "delete", id: graph.id });
      if (!r.ok) return toast(`删除失败：${r.body.error ?? r.status}`, true);
      await loadWorkflow();
      await loadGraph(wf.graphs?.[0]?.id ?? null);
      resetView();
      toast("项目已删除");
    });

    // 工作状态：边写边存（900ms 防抖），所有员工的提示词都会带上它
    let briefTimer = null;
    $("wfBrief").addEventListener("input", (e) => {
      if (!graph) return;
      graph.brief = e.target.value;
      dirty = true;
      setStatus("未保存");
      updateBriefState();
      clearTimeout(briefTimer);
      briefTimer = setTimeout(() => {
        if (dirty) saveProject(true);
      }, 900);
    });

    // 项目资料：上传 / 删除
    $("wfFilePick").addEventListener("click", () => $("wfFileInput").click());
    $("wfFileInput").addEventListener("change", async (e) => {
      const picked = [...e.target.files];
      e.target.value = "";
      if (!picked.length) return;
      if (!graph?.id) return toast("先保存一次项目，再传资料", true);
      for (const f of picked) {
        if (f.size > 4 * 1024 * 1024) {
          toast(`${f.name} 超过 4MB，跳过`, true);
          continue;
        }
        try {
          const data = await fileToBase64(f);
          const r = await api.post("/api/workflow/file", { graphId: graph.id, name: f.name, data });
          if (!r.ok) toast(`上传失败 ${f.name}：${r.body.error ?? r.status}`, true);
        } catch (err) {
          toast(`上传失败 ${f.name}：${err.message}`, true);
        }
      }
      await refreshFiles();
    });
    $("wfFileList").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-del]");
      if (!b || !graph?.id) return;
      if (!window.confirm(`删除资料「${b.dataset.del}」？`)) return;
      const r = await api.post("/api/workflow/file", { op: "remove", graphId: graph.id, name: b.dataset.del });
      if (!r.ok) return toast(`删除失败：${r.body.error ?? r.status}`, true);
      await refreshFiles();
    });

    $("wfRun").addEventListener("click", async () => {
      graph.name = $("wfName").value.trim() || "未命名";
      const r = await api.post("/api/workflow/run", { graph });
      if (!r.ok) return toast(`跑不起来：${r.body.error ?? r.status}`, true);
      run = r.body.run;
      runId = run.id;
      if (r.body.rulesAdded?.length) toast(`已合入规则：${r.body.rulesAdded.join("、")}`);
      renderRun();
      renderNodes();
      startPolling();
    });

    $("wfStop").addEventListener("click", async () => {
      if (!runId) return;
      const r = await api.post("/api/workflow/stop", { runId });
      if (!r.ok) return toast(`停不下来：${r.body.error ?? r.status}`, true);
      toast("已请求停止");
    });

    $("wfRunNodes").addEventListener("click", async (e) => {
      const c = e.target.closest("[data-confirm]");
      if (c && runId) {
        const waiting = (run?.nodes ?? []).find((n) => n.state === "waiting");
        if (!waiting) return;
        await api.post("/api/workflow/confirm", { runId, nodeId: waiting.id, ok: c.dataset.confirm === "1" });
        return;
      }
      const row = e.target.closest(".wf-rn");
      if (row) showNodeFile(row.dataset.node);
    });

    $("wfPropClose").addEventListener("click", () => {
      $("wfProps").hidden = true;
      sel = null;
      selEmp = null;
      panelMode = null;
      stopOutPoll();
      renderNodes();
    });
    $("wfPropOutRefresh").addEventListener("click", () => {
      if (sel) loadNodeOutput(sel);
    });

    // 对话
    $("wfPropChat").addEventListener("click", () => {
      if (sel) openChat(sel);
    });
    // 对话：工具栏的入口（先选节点）
    $("wfChatClose").addEventListener("click", closeChat);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("wfChat").hidden) closeChat();
    });
    $("wfChatOpen").addEventListener("click", () => {
      if (!sel) return toast("先在画布上点一个员工节点，再点「对话」", true);
      const n = byId(sel);
      if (n?.type !== "agent") return toast("「对话」只能对员工节点用", true);
      openChat(sel);
    });
    // 双击员工节点也能进对话
    $("wfNodes").addEventListener("dblclick", (e) => {
      const node = e.target.closest(".wf-node");
      if (!node || node.dataset.type !== "agent") return;
      e.preventDefault();
      openChat(node.dataset.id);
    });
    $("wfChatForm").addEventListener("submit", sendChat);
    $("wfChatInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChat(e);
      }
    });
    $("wfPropText").addEventListener("input", (e) => {
      const n = byId(sel);
      if (!n) return;
      n.text = e.target.value;
      dirty = true;
      setStatus("未保存");
      renderNodes();
    });
    $("wfPropEmp").addEventListener("change", (e) => {
      const n = byId(sel);
      if (!n) return;
      n.employee = e.target.value;
      dirty = true;
      setStatus("未保存");
      // 换员工后，下面的员工设定块要跟着换成那个人的
      fillEmployeeFields(n.employee, "这些是员工本身的设定（不是这个节点的）。改了会影响所有用它的节点。");
      renderNodes();
    });
    $("wfEmpRole").addEventListener("change", (e) => {
      $("wfEmpRoleNote").textContent = (wf?.roles ?? []).find((r) => r.id === e.target.value)?.note ?? "";
    });
    // 只改这个后端的模型（写进 rules.json 的 agents[后端].model），不新增员工字段
    $("wfEmpModel").addEventListener("change", async () => {
      const backend = $("wfEmpBackend").value;
      const model = $("wfEmpModel").value.trim();
      const r = await api.post("/api/workflow/backend", { id: backend, model });
      if (!r.ok) return toast(`模型没保存：${r.body?.error ?? r.status}`, true);
      wf = await api.get("/api/workflow");
      applyBackendInfo(backend);
      toast(r.body?.changed ? `${backend} 的模型 → ${model || "默认"}` : "模型没有变化");
    });

    $("wfEmpBackend").addEventListener("change", (e) => {
      $("wfEmpBackendNote").textContent = backendOf(e.target.value).note ?? "";
    });

    // 左栏两个分组：点标题展开/收起，记住上次的选择
    for (const [key, btnId, secId] of [
      ["base", "wfFoldBase", "wfBaseSection"],
      ["emp", "wfFoldEmp", "wfEmpSection"],
    ]) {
      const btn = $(btnId);
      const sec = $(secId);
      const open = localStorage.getItem("wf.fold." + key) !== "0";
      btn.setAttribute("aria-expanded", String(open));
      sec.hidden = !open;
      btn.addEventListener("click", () => {
        const now = btn.getAttribute("aria-expanded") !== "true";
        btn.setAttribute("aria-expanded", String(now));
        sec.hidden = !now;
        localStorage.setItem("wf.fold." + key, now ? "1" : "0");
      });
    }
    $("wfPropDelete").addEventListener("click", () => {
      if (sel) deleteNode(sel);
    });

    $("wfTodo").addEventListener("click", async (e) => {
      const pb = e.target.closest("button[data-prop]");
      if (pb && graph?.id) {
        const r = await api.post("/api/workflow/proposal", { graphId: graph.id, id: pb.dataset.prop, op: pb.dataset.op });
        if (!r.ok) return toast(`没处理成：${r.body.error ?? r.status}`, true);
        await loadWorkflow();
        await loadGraph(graph.id);
        renderAll();
        toast(pb.dataset.op === "apply" ? "已批准" : "已拒绝");
        return;
      }
      const btn = e.target.closest("button[data-card]");
      if (!btn) return;
      const r = await api.post("/api/answer", { cardId: Number(btn.dataset.card), choice: Number(btn.dataset.choice) });
      if (!r.ok) return toast(`没答上：${r.body.error ?? r.status}`, true);
      toast("已送出");
      renderTodo();
    });

    let nameTimer = null;
    $("wfName").addEventListener("input", () => {
      if (!graph) return;
      graph.name = $("wfName").value;
      dirty = true;
      setStatus("未保存");
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => {
        if (dirty) saveProject(true);
      }, 900);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Delete" && sel && !$("wf").hidden && document.activeElement.tagName !== "TEXTAREA") {
        deleteNode(sel);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
