// 测 GitHub 可达性：默认证书库 vs 系统证书库（加速器 MITM 时只有后者能过）。
// 用法: node gh-check.mjs [--use-system-ca 由外部传入]
const U = [
  "https://github.com/",
  "https://api.github.com/",
  "https://objects.githubusercontent.com/",
  "https://github.com/cloudflare/cloudflared/releases/latest",
];

const mode = process.execArgv.includes("--use-system-ca") ? "系统证书库" : "默认证书库";
console.log(`== ${mode} ==`);

for (const u of U) {
  try {
    const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    console.log(`${String(r.status).padEnd(4)} ${u}`);
  } catch (e) {
    console.log(`ERR  ${u}  (${e.cause?.code ?? e.name}: ${e.cause?.message ?? e.message})`);
  }
}
