// 测 GitHub 下载镜像的可用性和速度：每个源抢 3 秒，看能拿多少字节。
const TARGET = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
const MIRRORS = [
  ["直连", TARGET],
  ["ghproxy.net", `https://ghproxy.net/${TARGET}`],
  ["gh-proxy.com", `https://gh-proxy.com/${TARGET}`],
  ["ghfast.top", `https://ghfast.top/${TARGET}`],
  ["hk.gh-proxy.com", `https://hk.gh-proxy.com/${TARGET}`],
  ["ghp.ci", `https://ghp.ci/${TARGET}`],
];

for (const [name, url] of MIRRORS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3000);
  let got = 0;
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: "follow" });
    if (!r.ok || !r.body) {
      console.log(`${name.padEnd(18)} HTTP ${r.status}`);
      clearTimeout(timer);
      continue;
    }
    const total = Number(r.headers.get("content-length") ?? 0);
    for await (const chunk of r.body) {
      got += chunk.length;
      if (Date.now() > 0 && got > 20_000_000) break;
    }
  } catch (e) {
    // 3 秒到点被 abort 是预期的
  } finally {
    clearTimeout(timer);
  }
  const kbs = (got / 1024 / 3).toFixed(0);
  console.log(`${name.padEnd(18)} 3 秒拿到 ${(got / 1024 / 1024).toFixed(2)} MB · ${kbs} KB/s`);
}
