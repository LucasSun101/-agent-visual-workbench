// 从 GitHub API 取资产的权威 digest（GitHub 2025 起在 assets[].digest 里给 sha256）。
const r = await fetch("https://api.github.com/repos/cloudflare/cloudflared/releases/latest", {
  headers: { accept: "application/vnd.github+json" },
  signal: AbortSignal.timeout(60_000),
});
if (!r.ok) {
  console.log("API 失败:", r.status);
  process.exit(1);
}
const j = await r.json();
console.log("release:", j.tag_name, "| published:", j.published_at);
for (const a of j.assets ?? []) {
  if (/windows-amd64\.exe$/i.test(a.name)) {
    console.log("资产:", a.name);
    console.log("  size  :", a.size);
    console.log("  digest:", a.digest ?? "(API 没给)");
    console.log("  url   :", a.browser_download_url);
  }
}
