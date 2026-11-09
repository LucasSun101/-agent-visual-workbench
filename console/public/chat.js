/* 对话子系统
 *
 * 唯一职责：把「和某个员工的一轮对话」画出来、发出去。
 * 所有对话状态（打开的是哪个节点、在发没在发、错误）都封在这里，外面拿不到也不需要拿。
 *
 * 依赖通过 ctx 注入，不碰任何全局：
 *   ctx.$            元素查询
 *   ctx.esc          转义
 *   ctx.api          { get, post }
 *   ctx.toast        轻提示
 *   ctx.byId         按节点 id 找画布节点
 *   ctx.employees()  员工列表
 *   ctx.getGraph()   当前项目（活的引用，可写 chats）
 *   ctx.saveProject  保存（对话要落盘，必须有 id）
 *   ctx.refreshFiles 关掉对话时刷新资料列表
 *   ctx.startPolling 打开对话时确保运行状态在轮询
 */
window.WBChat = function createChat(ctx) {
  const { $, esc, api, toast, byId } = ctx;

  let chatNode = null;
  let chatEmployeeId = null;
  let chatPoll = null;
  let chatSending = false;
  let chatError = "";

  function graph() {
    return ctx.getGraph();
  }

  function chatEmployee() {
    const n = byId(chatNode);
    return (ctx.employees() ?? []).find((e) => e.id === n?.employee) ?? null;
  }

  function renderChat() {
    if (!chatNode) return;
    const emp = chatEmployee();
    $("wfChatTitle").textContent = emp ? `和「${emp.name}」对话` : "对话";
    const msgs = (graph()?.chats ?? {})[chatNode] ?? [];
    const busy = msgs.length > 0 && msgs[msgs.length - 1].role === "user";
    $("wfChatMeta").textContent = busy
      ? "正在跑…（一轮约 20-60 秒）"
      : msgs.length
        ? `${msgs.length} 条 · 只有这个项目能看`
        : "还没说过话";
    const body = $("wfChatBody");
    body.innerHTML =
      (msgs.length
        ? msgs
            .map(
              (m) => `<div class="wf-msg ${m.role === "user" ? "me" : "it"}">
                <div class="wf-msg-text">${esc(m.text)}</div>
                <span class="wf-msg-at">${esc((m.at ?? "").slice(11, 19))}${m.state && m.state !== "done" ? " · " + esc(m.state) : ""}</span>
              </div>`,
            )
            .join("")
        : `<div class="wf-msg it"><div class="wf-msg-text">说点什么。它会用这个项目的【工作状态】当背景，也能用指令块派活、写结论、申请招人。</div></div>`) +
      (chatSending ? `<div class="wf-msg pending"><div class="wf-msg-text">正在发送…</div></div>` : "") +
      (chatError ? `<div class="wf-msg error"><div class="wf-msg-text">发送失败：${esc(chatError)}</div></div>` : "") +
      (busy && !chatSending ? `<div class="wf-msg pending"><div class="wf-msg-text">正在跑…（一轮约 20-60 秒）</div></div>` : "");
    body.scrollTop = body.scrollHeight;
  }

  async function refreshChat() {
    const g0 = graph();
    if (!chatNode || !g0?.id) return;
    try {
      const g = await api.get("/api/workflow/graph?id=" + encodeURIComponent(g0.id));
      g0.chats = g.chats ?? {};
      g0.proposals = g.proposals ?? [];
      renderChat();
    } catch {}
  }

  function openChat(nodeId) {
    if (!graph()) return;
    chatNode = nodeId;
    // 记住当时绑的员工：节点之后可能被删/改名，但对话还能继续
    chatEmployeeId = byId(nodeId)?.employee ?? null;
    chatError = "";
    chatSending = false;
    $("wfChat").hidden = false;
    $("wfProps").hidden = true;
    renderChat();
    refreshChat();
    ctx.startPolling();
    if (chatPoll) clearInterval(chatPoll);
    chatPoll = setInterval(refreshChat, 2500);
    $("wfChatInput").focus();
  }

  function closeChat() {
    chatNode = null;
    chatEmployeeId = null;
    $("wfChat").hidden = true;
    if (chatPoll) clearInterval(chatPoll);
    chatPoll = null;
    ctx.refreshFiles();
  }

  async function sendChat(e) {
    if (e?.preventDefault) e.preventDefault();
    const input = $("wfChatInput");
    const text = input.value.trim();
    if (!text) return;
    if (!chatNode) return toast("先在画布上点一个员工节点", true);
    chatError = "";

    // 没保存过的项目没有 id，对话存不下来——先自动存一次
    if (!graph()?.id) {
      const ok = await ctx.saveProject(true);
      if (!ok || !graph()?.id) return toast("项目没保存成功，没法发消息", true);
    }

    chatSending = true;
    $("wfChatSend").disabled = true;
    renderChat();
    let r;
    try {
      r = await api.post("/api/workflow/chat", {
        graphId: graph().id,
        nodeId: chatNode,
        employeeId: chatEmployeeId ?? byId(chatNode)?.employee ?? null,
        text,
      });
    } catch (err) {
      r = { ok: false, status: 0, body: { error: err.message } };
    }
    chatSending = false;
    $("wfChatSend").disabled = false;

    if (!r.ok) {
      // 失败时把话还回输入框，别让人白打一遍
      input.value = text;
      chatError = r.body?.error ?? `HTTP ${r.status}`;
      renderChat();
      return;
    }
    input.value = "";
    await refreshChat();
  }

  return {
    openChat,
    closeChat,
    sendChat,
    renderChat,
    refreshChat,
    isOpen: () => !$("wfChat").hidden,
    currentNode: () => chatNode,
  };
};
