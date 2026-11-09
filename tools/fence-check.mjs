// 区分「信任栅栏拒绝(403/401)」和「路径不存在(404)」：同一个不存在的 /api 路径，本地 vs 隧道各打一次。
const T = process.argv[2];
if (!T) {
  console.error("usage: node fence-check.mjs <token>");
  process.exit(2);
}

// 隧道地址不要写死：用 WB_TUNNEL_HOST=xxxx.lhr.life 传进来（每次起隧道都会变）
const rawTunnel = (process.env.WB_TUNNEL_HOST ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
if (rawTunnel && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(rawTunnel)) {
  console.error(`WB_TUNNEL_HOST 看起来不像域名：${rawTunnel}`);
  process.exit(2);
}
const targets = [
  ["本地", "http://127.0.0.1:51426", "127.0.0.1:51426"],
  ...(rawTunnel ? [["隧道", `https://${rawTunnel}`, rawTunnel]] : []),
];
if (!rawTunnel) {
  console.log("跳过隧道检查：没有设 WB_TUNNEL_HOST（本次只验了本地）。");
  console.log("要同时验隧道，先起隧道，再带 WB_TUNNEL_HOST=<子域>.lhr.life 重跑。\n");
}

for (const [label, root, host] of targets) {
  const boot = await fetch(`${root}/?token=${encodeURIComponent(T)}`, { redirect: "manual" });
  const cookie = (boot.headers.get("set-cookie") ?? "").split(";")[0];
  const r = await fetch(`${root}/api/__nonexistent_probe__`, { headers: { cookie } });
  const body = (await r.text()).slice(0, 60).replace(/\s+/g, " ");
  console.log(`${label.padEnd(3)} GET /api/__nonexistent_probe__ -> ${r.status} | ${body}`);
  console.log(`     (Host: ${host})`);
}
console.log(
  rawTunnel
    ? "\n判读：403/401 = 栅栏拒了这个 Host；404 = 栅栏通过、只是路径不存在。"
    : "\n判读（仅本地）：404 = 栅栏通过、只是路径不存在。隧道那一侧这次没验。",
);
