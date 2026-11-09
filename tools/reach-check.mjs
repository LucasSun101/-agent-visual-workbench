// 用 node 的 TLS 栈测外网可达性（curl 在这里走 Schannel，结果不可信）。
const targets = [
  "https://registry.npmjs.org/",
  "https://cdn.jsdelivr.net/",
  "https://github.com/cloudflare/cloudflared/releases/latest",
  "https://ngrok.com/download",
  "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip",
  "https://localhost.run/docs/",
  "https://admin.localhost.run/",
  "https://dash.cloudflare.com/login",
  "https://api.cloudflare.com/client/v4/",
];

for (const u of targets) {
  try {
    const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    console.log(`${String(r.status).padEnd(4)} ${u}`);
  } catch (e) {
    console.log(`ERR  ${u}  (${e.cause?.code ?? e.name})`);
  }
}
