// 探 dsh web 实例：令牌换 cookie、看 boot 载荷、试几个 API 路径。
const B = process.env.DSH_WEB || "http://127.0.0.1:51426";
const T = process.argv[2];
if (!T) {
  console.error("usage: node probe-dsh-web.mjs <token>");
  process.exit(2);
}

const boot = await fetch(`${B}/?token=${encodeURIComponent(T)}`, { redirect: "manual" });
const cookie = (boot.headers.get("set-cookie") ?? "").split(";")[0];
console.log("令牌 -> cookie:", boot.status, cookie.slice(0, 46) + "…");

const page = await fetch(`${B}/`, { headers: { cookie } });
const html = await page.text();
console.log("GET / :", page.status, "| bytes:", html.length);

const m = html.match(/window\.__DSH_BOOT__\s*=\s*([\s\S]*?)\s*=\s*<\/script>|window\.__DSH_BOOT__\s*=\s*(\{[\s\S]*?\});/);
if (m) console.log("boot 载荷:", (m[1] ?? m[2]).slice(0, 700));
else console.log("没找到 __DSH_BOOT__；HTML 头:", html.slice(0, 200).replace(/\s+/g, " "));

const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((x) => x[1]);
console.log("脚本:", srcs.slice(0, 8).join(", ") || "(内联)");

for (const p of ["/api/healthz", "/api/sessions", "/api/state", "/api/session/list", "/api/runtime"]) {
  const r = await fetch(B + p, { headers: { cookie } });
  const ct = r.headers.get("content-type") ?? "";
  let body = "";
  if (ct.includes("json")) {
    body = (await r.text()).slice(0, 220);
  } else {
    body = (await r.text()).slice(0, 80);
  }
  console.log(p.padEnd(20), r.status, ct.split(";")[0].padEnd(18), body.replace(/\s+/g, " "));
}
