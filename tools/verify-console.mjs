// 控制台自检：配对、鉴权、只读、SSE、state.json 投影。
// usage: node verify-console.mjs <token>
const TOKEN = process.argv[2];
const BASE = `http://127.0.0.1:${process.env.WB_PORT ?? 51425}`;
if (!TOKEN) {
  console.error("usage: node verify-console.mjs <token>");
  process.exit(2);
}

let ok = 0;
let bad = 0;
const check = (name, pass, extra = "") => {
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? "✓" : "✗"} ${name}${extra ? " · " + extra : ""}`);
};

// 1. 不配对 → 401
{
  const r = await fetch(`${BASE}/api/state`);
  check("未配对访问 /api/state 被拒", r.status === 401, `HTTP ${r.status}`);
}

// 2. 配对：拿 cookie
let cookie = "";
{
  const r = await fetch(`${BASE}/?k=${TOKEN}`, { redirect: "manual" });
  const sc = r.headers.get("set-cookie") ?? "";
  cookie = sc.split(";")[0];
  check("配对链接返回 302 + HttpOnly cookie", r.status === 302 && /HttpOnly/i.test(sc), `HTTP ${r.status}`);
}

const H = { cookie };

// 3. state
let state = null;
{
  const r = await fetch(`${BASE}/api/state`, { headers: H });
  state = await r.json();
  check("/api/state 返回快照", r.status === 200 && Array.isArray(state.runs), `HTTP ${r.status}, runs=${state?.runs?.length}`);
  check(
    "快照字段齐全",
    ["totals", "spending", "cards", "agents", "channels", "sources", "lines", "runs"].every((k) => k in state),
  );
}

// 4. 只读：写接口必须不存在
for (const [method, path] of [
  ["POST", "/api/state"],
  ["PUT", "/api/rules"],
  ["DELETE", "/api/rules"],
]) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H });
  check(`${method} ${path} 被拒`, r.status === 405 || r.status === 404, `HTTP ${r.status}`);
}

// 5. why
{
  const id = state?.runs?.[0]?.id;
  const r = await fetch(`${BASE}/api/why/${id}`, { headers: H });
  const list = await r.json();
  check(`/api/why/${id} 返回事实数组`, r.status === 200 && Array.isArray(list), `facts=${list?.length}`);
}

// 6. recent
{
  const r = await fetch(`${BASE}/api/recent?n=10`, { headers: H });
  const list = await r.json();
  check("/api/recent 有界返回", r.status === 200 && Array.isArray(list) && list.length <= 10, `count=${list?.length}`);
}

// 7. SSE
{
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 2500);
  try {
    const r = await fetch(`${BASE}/api/stream`, { headers: H, signal: ac.signal });
    const ctype = r.headers.get("content-type") ?? "";
    const reader = r.body.getReader();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value, { stream: true });
      if (/: connected/.test(text) || /id:\s*\d+/.test(text)) break;
      if (text.length > 4000) break;
    }
    const alive = /: connected/.test(text) || /id:\s*\d+/.test(text);
    check("/api/stream 是 SSE（有握手或事实帧）", ctype.includes("text/event-stream") && alive, ctype);
  } catch (e) {
    check("/api/stream 是 SSE（有握手或事实帧）", false, e.name);
  } finally {
    clearTimeout(t);
    ac.abort();
  }
}

// 8. 静态页
for (const p of ["/", "/app.js", "/style.css"]) {
  const r = await fetch(`${BASE}${p}`, { headers: H });
  check(`静态 ${p} 可访问`, r.status === 200, `HTTP ${r.status} ${r.headers.get("content-type")}`);
}

// 8.5 写入口只有一个，而且必须带自定义头（CSRF）
{
  const post = (body, extra = {}) =>
    fetch(`${BASE}/api/answer`, {
      method: "POST",
      headers: { cookie: H.cookie, "content-type": "application/json", ...extra },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  const noHeader = await post({ cardId: 1, choice: 0 });
  check("POST /api/answer 缺 X-WB 头 → 403", noHeader.status === 403, `HTTP ${noHeader.status}`);

  const badBody = await post("not json", { "x-wb": "1" });
  check("POST /api/answer 非法 body → 400", badBody.status === 400, `HTTP ${badBody.status}`);

  const ghost = await post({ cardId: 999999, choice: 0 }, { "x-wb": "1" });
  check("POST /api/answer 不存在的卡片被中台拒", ghost.status >= 400, `HTTP ${ghost.status}`);

  const other = await fetch(`${BASE}/api/cards/2/answer`, {
    method: "POST",
    headers: { cookie: H.cookie, "content-type": "application/json", "x-wb": "1" },
    body: JSON.stringify({ cardId: 2, choice: 0 }),
  });
  check("其它写路径一律 405", other.status === 405, `HTTP ${other.status}`);
}

// 8.55 停止一轮：同样两道闸
{
  const post = (body, extra = {}) =>
    fetch(`${BASE}/api/stop`, {
      method: "POST",
      headers: { cookie: H.cookie, "content-type": "application/json", ...extra },
      body: JSON.stringify(body),
    });

  const noHeader = await post({ runId: 1 });
  check("POST /api/stop 缺 X-WB 头 → 403", noHeader.status === 403, `HTTP ${noHeader.status}`);

  const badId = await post({ runId: -1 }, { "x-wb": "1" });
  check("POST /api/stop 非法 runId → 400", badId.status === 400, `HTTP ${badId.status}`);

  const ghost = await post({ runId: 999999 }, { "x-wb": "1" });
  check("POST /api/stop 不存在的轮次被中台拒", ghost.status >= 400, `HTTP ${ghost.status}`);

  const get = await fetch(`${BASE}/api/stop`, { headers: H });
  check("GET /api/stop 不存在（只接受 POST）", get.status === 405 || get.status === 404, `HTTP ${get.status}`);
}

// 8.6 原始输出
{
  const id = state?.runs?.[0]?.id;
  const o = await (await fetch(`${BASE}/api/output/${id}`, { headers: H })).json();
  check("/api/output 返回该轮原始输出", o.found === true && typeof o.stdout?.text === "string", `dir=${o.dir} turn=${o.turn} exit=${o.exit}`);
  const none = await (await fetch(`${BASE}/api/output/999999`, { headers: H })).json();
  check("/api/output 不存在的轮次安全返回", none.found === false);
}

// 8.7 PWA 资源
for (const [p, type] of [
  ["/manifest.webmanifest", "json"],
  ["/sw.js", "javascript"],
  ["/icon-192.png", "image/png"],
  ["/icon-512.png", "image/png"],
]) {
  const r = await fetch(`${BASE}${p}`, { headers: H });
  const ct = r.headers.get("content-type") ?? "";
  check(`PWA ${p}`, r.status === 200 && ct.includes(type), `HTTP ${r.status} ${ct}`);
}

// 9. 前端契约：app.js / workflow.js 里 $("id") 用到的元素，index.html 里必须都有
//    例外：抽屉与编排里的动态区块由脚本现插，不在静态 HTML 里。
{
  const DYNAMIC = new Set(["outSection"]);
  const html = await (await fetch(`${BASE}/`, { headers: H })).text();
  for (const [name, file] of [
    ["app.js", "/app.js"],
    ["workflow.js", "/workflow.js"],
    ["chat.js", "/chat.js"],
  ]) {
    const js = await (await fetch(`${BASE}${file}`, { headers: H })).text();
    if (!js || js.length < 100) {
      check(`${name} 可下载`, false, `${js.length} 字节`);
      continue;
    }
    const wanted = [...new Set([...js.matchAll(/\$\("([a-zA-Z0-9_-]+)"\)/g)].map((m) => m[1]))].filter((id) => !DYNAMIC.has(id));
    const missing = wanted.filter((id) => !new RegExp(`id="${id}"`).test(html));
    check(`${name} 引用的静态元素 id 都在页面里`, missing.length === 0, missing.length ? `缺 ${missing.join(",")}` : `${wanted.length} 个 id`);
  }
}

console.log(`\n${ok} 通过 · ${bad} 失败`);
process.exit(bad ? 1 : 0);
