// 工作台前端。
// 数据：/api/state 是快照（渲染依据），/api/stream 是事实流（变更信号 + 审计时间线）。
// 事实到达不自己算状态，只标记脏 → 去抖 → 重取快照，这样永远和中台一致。
// 写：只有一条路径——/api/answer 回答卡片。
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const LABEL = {
    queued: "排队",
    claimed: "在跑",
    unknown: "不确定",
    done: "完成",
    nothing: "没事",
    failed: "没跑成",
    cancelled: "已停",
  };

  let state = null;
  let facts = [];
  let lastSeq = 0;
  let timer = null;
  let drawerRun = null;
  let outTimer = null;
  let primed = false;
  let lastOutputText = "";

  const connEl = $("conn");
  const setConn = (kind, text) => {
    connEl.dataset.state = kind;
    connEl.textContent = text;
  };

  const ago = (iso) => {
    const t = Date.parse(iso || "");
    if (!t) return "";
    const d = Math.max(0, Date.now() - t) / 1000;
    if (d < 60) return `${Math.floor(d)} 秒前`;
    if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
    if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
    return `${Math.floor(d / 86400)} 天前`;
  };

  const dur = (run) => {
    const a = Date.parse(run.claimedAt || run.createdAt || "");
    const b = Date.parse(run.finishedAt || "");
    if (!a || !b) return "";
    const s = (b - a) / 1000;
    if (s < 1) return `${Math.max(1, Math.round(s * 1000))}ms`;
    if (s < 60) return `${s.toFixed(1)}s`;
    return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
  };

  const clock = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("zh-CN", { hour12: false });
  };

  let toastTimer = null;
  function toast(text, bad) {
    const el = $("toast");
    el.textContent = text;
    el.dataset.bad = bad ? "1" : "0";
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 3200);
  }

  // ---------- 顶栏 ----------
  function renderStats(s) {
    const t = s.totals || {};
    const today = (s.spending && s.spending.today) || {};
    const money = today.cost > 0 ? `$${Number(today.cost).toFixed(2)}` : "未上报";
    const pills = [
      ["在跑", t.running ?? 0, t.running > 0 ? "" : "dim"],
      ["排队", t.queued ?? 0, ""],
      ["重试", t.retrying ?? 0, t.retrying > 0 ? "hot" : "dim"],
      ["等你", t.attention ?? 0, t.attention > 0 ? "hot" : "dim"],
      ["今日完成", t.doneToday ?? 0, ""],
      ["今日花费", money, "money"],
    ];
    $("stats").innerHTML = pills
      .map(([k, v, cls]) => `<span class="pill ${cls || ""}">${esc(k)}<b>${esc(v)}</b></span>`)
      .join("");
  }

  // ---------- 收件箱（唯一的写入口）----------
  function renderInbox(s) {
    const cards = s.cards || [];
    $("inboxCount").textContent = cards.length;
    if (!cards.length) {
      $("inbox").innerHTML = `<div class="empty">没有等你决定的事。</div>`;
      return;
    }
    $("inbox").innerHTML = cards
      .slice()
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((c) => {
        const isAsk = c.kind === "ask";
        const opts = (c.options || [])
          .map(
            (o, i) =>
              `<button class="opt ${c.recommend === i ? "rec" : ""}" type="button" data-card="${c.id}" data-choice="${i}">
                 ${i + 1} ${esc(o)}${c.recommend === i ? " ★" : ""}
               </button>`,
          )
          .join("");
        const free = isAsk
          ? `<div class="ci-free">
               <input class="ci-input" data-input="${c.id}" placeholder="或者写一句别的…" maxlength="500" />
               <button class="ci-send" type="button" data-card="${c.id}" data-text="1">发送</button>
             </div>`
          : `<div class="ci-free"><button class="ci-done" type="button" data-card="${c.id}" data-text="1">标为已处理</button></div>`;
        return `<div class="card-item" data-kind="${esc(c.kind)}">
          <div class="ci-top"><span class="kind">${isAsk ? "提问" : "通知"}</span><span class="age">${esc(ago(c.createdAt))}</span></div>
          <div class="ci-title">#${esc(c.id)} ${esc(c.title)}</div>
          ${c.text ? `<div class="ci-text">${esc(c.text)}</div>` : ""}
          ${opts ? `<div class="ci-opts">${opts}</div>` : ""}
          ${free}
        </div>`;
      })
      .join("");
  }

  async function answer(cardId, payload, label) {
    if (label) {
      const ok = window.confirm(`回答 #${cardId}：「${label}」？\n\n答完中台会接着把活干完。`);
      if (!ok) return;
    }
    const res = await fetch("/api/answer", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wb": "1" },
      body: JSON.stringify({ cardId, ...payload }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(`没答上：${body.error ?? res.status}`, true);
      return;
    }
    toast("已送出，中台接着干");
    await refresh();
  }

  async function stopRun(id) {
    const ok = window.confirm(
      `停止第 ${id} 轮？\n\n· 先温和结束进程，10 秒后强杀整个进程树\n· 这一轮记为「已停」，不会重试\n· 已经写进磁盘的改动不会回滚`,
    );
    if (!ok) return;
    const res = await fetch("/api/stop", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wb": "1" },
      body: JSON.stringify({ runId: Number(id) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(`没停成：${body.error ?? res.status}`, true);
      return;
    }
    toast("已发出停止信号，等接单程序确认");
    await refresh();
    if (drawerRun === String(id)) {
      await pollOutput(id);
      // 进程要一点时间才真的走，抽屉里继续盯一会儿
      if (!outTimer) outTimer = setInterval(() => pollOutput(id), 1200);
    }
  }

  // ---------- 在场 ----------
  function renderPresence(s) {
    const dot = (on) => `<span class="dot ${on ? "on" : "off"}"></span>`;
    const agents = (s.agents || [])
      .map(
        (a) => `<div class="ent">${dot(a.online)}<span class="nm">${esc(a.name)}</span>
          <span class="meta">${esc(a.use)}@${esc(a.worker)}</span></div>`,
      )
      .join("");
    const chan = (s.channels || [])
      .map(
        (c) => `<div class="ent">${dot(c.online)}<span class="nm">${esc(c.name)}</span>
          <span class="meta">${c.online ? "在线" : "离线"}</span></div>`,
      )
      .join("");
    const src = (s.sources || [])
      .map(
        (x) => `<div class="ent">${dot(true)}<span class="nm">${esc(x.name)}</span>
          <span class="meta">${esc(x.events)} 事件</span></div>`,
      )
      .join("");
    $("presence").innerHTML = `
      <div class="group-label">AGENT</div>${agents || `<div class="empty">没有 Agent</div>`}
      <div class="group-label">通道</div>${chan || `<div class="empty">没有通道</div>`}
      <div class="group-label">来源</div>${src || `<div class="empty">没有来源</div>`}`;
  }

  // ---------- 泳道 ----------
  function renderLanes(s) {
    const lines = s.lines || [];
    const runs = s.runs || [];
    if (!lines.length) {
      $("lanes").innerHTML = `<div class="panel"><div class="empty">还没有规则。规则写在 ~/.agent-autoloop/rules.json。</div></div>`;
      return;
    }
    $("lanes").innerHTML = lines
      .map((line) => {
        const mine = runs.filter((r) => r.rule === line.name);
        const t = line.totals || {};
        const trigger = line.every ? `每 ${esc(line.every)}` : `${esc(line.source)} · ${esc((line.types || []).join(", ") || "全部")}`;
        const next = line.next ? `下次 ${clock(line.next)}` : "";
        const body = mine.length
          ? mine
              .map(
                (r) => `<button class="run" type="button" data-id="${esc(r.id)}" data-state="${esc(r.state)}">
                  <span class="dot"></span>
                  <span class="rid">#${esc(r.id)}</span>
                  <span class="rs">${esc(LABEL[r.state] || r.state)}</span>
                  <span class="sum">${esc(r.summary || r.error || "—")}</span>
                  <span class="dur">${esc(dur(r))}${r.attempts ? ` · 试${esc(r.attempts)}` : ""}</span>
                </button>`,
              )
              .join("")
          : `<div class="empty">还没有轮次。</div>`;
        return `<section class="lane">
          <div class="lane-head">
            <span class="lane-name">${esc(line.name)}</span>
            <span class="chip">→ ${esc(line.agent)}</span>
            <span class="chip trigger">${trigger}</span>
            <span class="lane-meta">完成 ${esc(t.done ?? 0)} · 今日 ${esc(t.doneToday ?? 0)}${next ? " · " + next : ""}</span>
          </div>
          <div class="runs">${body}</div>
        </section>`;
      })
      .join("");
  }

  // ---------- 时间线 ----------
  const FACT_LABEL = { rules: "规则更新", key: "密钥变更", config: "配置" };

  function renderFacts() {
    $("seqBadge").textContent = `#${lastSeq}`;
    $("facts").innerHTML = facts
      .slice(0, 120)
      .map((f) => {
        const tables = [...new Set((f.changes || []).map((c) => c.table))].join(",");
        const ty = FACT_LABEL[f.type] || f.type;
        return `<li class="fact">
          <span class="t">${esc(clock(new Date(f.at).toISOString()))}</span>
          <span class="s">${esc(f.seq)}</span>
          <span><span class="ty">${esc(ty)}</span>${tables ? ` <span class="tbl">${esc(tables)}</span>` : ""}</span>
        </li>`;
      })
      .join("");
  }

  // ---------- 抽屉：这一轮 + 它的原始输出 ----------
  function stopOutput() {
    if (outTimer) clearInterval(outTimer);
    outTimer = null;
  }

  async function pollOutput(id) {
    if (drawerRun !== id) return;
    const host = $("outSection");
    try {
      const res = await fetch(`/api/output/${id}`, { cache: "no-store" });
      const o = await res.json();
      if (!host || drawerRun !== id) return;
      if (!o.found) {
        host.innerHTML = `<div class="empty">${esc(o.reason || "没有输出")}</div>`;
        return;
      }
      const size = o.stdout?.size ?? 0;
      const text = o.stdout?.text ?? "";
      const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 40;
      host.innerHTML = `
        <div class="out-meta">${esc(o.dir)} · 第 ${esc(o.turn)} 次执行 · ${size} 字节${o.stdout?.truncated ? " · 显示末尾" : ""}${
          o.exit === null ? ' · <span class="live">运行中</span>' : ` · 退出码 ${esc(o.exit)}`
        }</div>
        <pre class="out-text">${esc(text) || "(还没有输出)"}</pre>
        ${o.stderr ? `<div class="out-meta">stderr</div><pre class="out-text err">${esc(o.stderr.text)}</pre>` : ""}`;
      if (atBottom && text !== lastOutputText) host.scrollTop = host.scrollHeight;
      lastOutputText = text;
    } catch {
      /* 忽略一次失败，下一次轮询再来 */
    }
  }

  async function openRun(id) {
    drawerRun = String(id);
    $("drawer").hidden = false;
    $("drawerTitle").textContent = `第 ${id} 轮`;
    $("drawerBody").innerHTML = `<div class="empty">读取中…</div>`;
    stopOutput();
    lastOutputText = "";

    const run = (state?.runs || []).find((r) => String(r.id) === String(id));
    const meta = run
      ? `<dl class="kv">
          <dt>规则</dt><dd>${esc(run.rule)}</dd>
          <dt>Agent</dt><dd>${esc(run.agent)}</dd>
          <dt>状态</dt><dd>${esc(LABEL[run.state] || run.state)}${run.stopping ? " · 正在停" : ""}</dd>
          <dt>结论</dt><dd>${esc(run.summary || "—")}</dd>
          ${run.error ? `<dt>错误</dt><dd>${esc(run.error)}</dd>` : ""}
          <dt>发起</dt><dd>${esc(run.createdAt)}</dd>
          <dt>结束</dt><dd>${esc(run.finishedAt || "—")}</dd>
          <dt>耗时</dt><dd>${esc(dur(run) || "—")}</dd>
          <dt>重试</dt><dd>${esc(run.attempts)}</dd>
          <dt>会话</dt><dd>${esc(run.session || "—")}</dd>
          <dt>用量</dt><dd>${run.usage ? esc(JSON.stringify(run.usage)) : "未上报"}</dd>
        </dl>`
      : "";
    const stoppable = run && ["claimed", "queued", "unknown"].includes(run.state);
    const actions = stoppable
      ? `<div class="drawer-actions">
           <button class="btn-danger" type="button" data-stop="${esc(id)}">停止这一轮</button>
           <span class="hint">先温和通知，10 秒后强杀进程树；记为「已停」不再重试</span>
         </div>`
      : "";
    $("drawerBody").innerHTML =
      actions +
      meta +
      `<div class="group-label">Agent 的原始输出</div><div class="out" id="outSection"><div class="empty">读取中…</div></div>`;

    await pollOutput(id);
    if (run && (run.state === "claimed" || run.state === "queued" || run.state === "unknown")) {
      outTimer = setInterval(() => pollOutput(id), 1200);
    }

    try {
      const res = await fetch(`/api/why/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      if (drawerRun !== String(id)) return;
      const items = (Array.isArray(list) ? list : []).map((f) => {
        const tables = [...new Set((f.changes || []).map((c) => c.table))].join(",");
        return `<li><b>${esc(clock(new Date(f.at).toISOString()))}</b> · seq ${esc(f.seq)} · ${esc(FACT_LABEL[f.type] || f.type)}${
          tables ? ` · ${esc(tables)}` : ""
        }</li>`;
      });
      $("drawerBody").insertAdjacentHTML(
        "beforeend",
        `<div class="group-label">这一轮的事实</div><ul class="why">${items.join("") || "<li>没有事实</li>"}</ul>`,
      );
    } catch (e) {
      $("drawerBody").insertAdjacentHTML("beforeend", `<div class="empty">读不到事实：${esc(e.message)}</div>`);
    }
  }

  function closeDrawer() {
    $("drawer").hidden = true;
    drawerRun = null;
    stopOutput();
  }

  // ---------- 文件桥 ----------
  function renderBridge(b) {
    const el = $("bridge");
    if (!el) return;
    const pending = b?.pending ?? 0;
    $("bridgeCount").textContent = pending;
    const last = b?.lastReceipt;
    const rej = b?.recentRejected ?? 0;
    const rows = [];
    rows.push(
      `<div class="ent"><span class="dot ${pending > 0 ? "on" : "off"}"></span>
        <span class="nm">待处理意图</span><span class="meta">${pending} 条</span></div>`,
    );
    if (last) {
      const ok = last.ok === true;
      rows.push(
        `<div class="ent"><span class="dot ${ok ? "on" : "off"}"></span>
          <span class="nm">${esc(last.action ?? "?")} ${ok ? "生效" : "被拒"}</span>
          <span class="meta">${esc(ago(last.at))}</span></div>`,
      );
      if (!ok && last.error) {
        rows.push(`<div class="ci-text" style="margin:2px 0 0 14px">${esc(String(last.error).slice(0, 90))}</div>`);
      }
    } else {
      rows.push(`<div class="empty">还没有 Agent 投过意图。</div>`);
    }
    if (rej > 0) rows.push(`<div class="ci-text" style="margin:4px 0 0">最近 50 条里有 ${rej} 条被拒</div>`);
    el.innerHTML = rows.join("");
  }

  // ---------- 渲染与刷新 ----------
  function render() {
    if (!state) return;
    renderStats(state);
    renderInbox(state);
    renderPresence(state);
    renderLanes(state);
    renderBridge(state.bridge);
  }

  async function refresh() {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state = await res.json();
      if (!primed) {
        primed = true;
        await primeTimeline();
      }
      render();
    } catch (e) {
      setConn("down", `中台连不上 · ${e.message}`);
    }
  }

  async function primeTimeline() {
    try {
      const res = await fetch("/api/recent?n=40", { cache: "no-store" });
      if (!res.ok) return;
      const list = await res.json();
      for (const f of list) {
        if (!f || typeof f.seq !== "number") continue;
        facts.push(f);
        lastSeq = Math.max(lastSeq, f.seq);
      }
      facts.sort((a, b) => b.seq - a.seq);
      renderFacts();
    } catch {}
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, 250);
  }

  function connect() {
    const es = new EventSource("/api/stream");
    es.onopen = () => setConn("live", "已连接");
    es.onerror = () => setConn("wait", "重连中…");
    const onFact = (ev) => {
      try {
        const f = JSON.parse(ev.data);
        if (!f || typeof f.seq !== "number") return;
        lastSeq = Math.max(lastSeq, f.seq);
        facts.unshift(f);
        if (facts.length > 400) facts.length = 400;
        renderFacts();
        schedule();
      } catch {}
    };
    es.addEventListener("fact", onFact);
    es.onmessage = onFact;
  }

  // ---------- 交互 ----------
  $("inbox").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-card]");
    if (!btn) return;
    const cardId = Number(btn.dataset.card);
    if (btn.dataset.text === "1") {
      const input = document.querySelector(`input[data-input="${cardId}"]`);
      const text = (input?.value || "").trim() || "在控制台点了已处理";
      answer(cardId, { text }, text);
      return;
    }
    const choice = Number(btn.dataset.choice);
    answer(cardId, { choice }, btn.textContent.trim().replace(/\s+/g, " "));
  });
  $("inbox").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.matches("input[data-input]")) {
      const cardId = Number(ev.target.dataset.input);
      const text = ev.target.value.trim();
      if (text) answer(cardId, { text }, text);
    }
  });
  $("lanes").addEventListener("click", (ev) => {
    const btn = ev.target.closest(".run");
    if (btn) openRun(btn.dataset.id);
  });
  $("drawerBody").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-stop]");
    if (btn && drawerRun) stopRun(btn.dataset.stop);
  });
  $("drawerClose").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeDrawer();
  });

  // 不再注册 service worker：它缓存过前端资源，导致"改了代码页面还是旧的"。
  // index.html 里有一段脚本会主动注销已有的 SW（升级时清一次）。

  setConn("wait", "连接中");
  refresh().then(connect);
  setInterval(render, 30000);
})();
