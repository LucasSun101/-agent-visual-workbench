// 通过公网隧道验收：登录 → 静态资源 → 数据 → PWA 资源。
const B = process.env.WB_URL;
const code = process.argv[2];
if (!B || !code) {
  console.error("usage: WB_URL=https://xxx node verify-tunnel.mjs <passcode>");
  process.exit(2);
}

const login = await fetch(`${B}/login`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: `code=${encodeURIComponent(code)}`,
  redirect: "manual",
});
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
console.log("登录:", login.status, "| cookie 有:", Boolean(cookie));

let ok = 0;
for (const [path, want] of [
  ["/", "text/html"],
  ["/app.js", "javascript"],
  ["/style.css", "css"],
  ["/manifest.webmanifest", "manifest"],
  ["/icon-192.png", "png"],
  ["/api/state", "json"],
  ["/healthz", "json"],
]) {
  const r = await fetch(B + path, { headers: { cookie } });
  const ct = r.headers.get("content-type") ?? "";
  const good = r.status === 200 && ct.includes(want);
  if (good) ok++;
  console.log(`${good ? "✓" : "✗"} ${path} · HTTP ${r.status} · ${ct}`);
}
console.log(`\n${ok}/7 通过 · ${B}`);
