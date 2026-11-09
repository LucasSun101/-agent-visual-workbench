// 通过隧道验收 dsh web：令牌换 cookie → 首页 → 前端资源 → /api 信任栅栏。
// 用法: node verify-dsh-tunnel.mjs <https://xxx.lhr.life> <token>
const ROOT = process.argv[2];
const TOKEN = process.argv[3];
if (!ROOT || !TOKEN) {
  console.error("usage: node verify-dsh-tunnel.mjs <root> <token>");
  process.exit(2);
}

let ok = 0;
const check = (name, pass, extra = "") => {
  if (pass) ok++;
  console.log(`${pass ? "✓" : "✗"} ${name}${extra ? " · " + extra : ""}`);
};

const boot = await fetch(`${ROOT}/?token=${encodeURIComponent(TOKEN)}`, { redirect: "manual" });
const cookie = (boot.headers.get("set-cookie") ?? "").split(";")[0];
check("令牌换 cookie", boot.status === 303 && cookie.startsWith("dsh-auth-"), `HTTP ${boot.status}`);

const page = await fetch(`${ROOT}/`, { headers: { cookie } });
const html = await page.text();
check("首页 200", page.status === 200 && html.length > 5000, `${html.length} 字节`);

// 资源：<base href="./">，取一个主 bundle 验证静态资源也通了
const assets = [...html.matchAll(/(?:src|href)="(\.?\/?[^"]*assets\/[^"]+)"/g)].map((m) => m[1].replace(/^\.\//, "/"));
const asset = assets.find((a) => a.endsWith(".js"));
if (asset) {
  const r = await fetch(ROOT + asset, { headers: { cookie } });
  const body = await r.text();
  check("前端 bundle 可下载", r.status === 200, `${r.status} · ${(body.length / 1024).toFixed(0)} KB`);

  // 从 bundle 里挖出真实 API 路径，验证信任栅栏
  const paths = [...new Set([...body.matchAll(/["'`](\/api\/[a-zA-Z0-9/_.-]{2,40})["'`]/g)].map((m) => m[1]))];
  console.log("   bundle 里的 API 路径:", paths.slice(0, 8).join(", ") || "(没找到)");
  for (const p of paths.slice(0, 4)) {
    const r2 = await fetch(ROOT + p, { headers: { cookie } });
    const txt = (await r2.text()).slice(0, 90).replace(/\s+/g, " ");
    check(`API ${p}`, r2.status !== 403 && r2.status !== 401, `HTTP ${r2.status} ${txt}`);
  }
} else {
  check("找到主 bundle 引用", false, html.slice(0, 120));
}

console.log(`\n${ok} 项通过 · ${ROOT}`);
