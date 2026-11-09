// 下载 cloudflared：走快镜像取二进制，走直连取官方 sha256 做校验。需 --use-system-ca。
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "bin");
const EXE = path.join(BIN, "cloudflared.exe");
const GH = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
const MIRRORS = [`https://hk.gh-proxy.com/${GH}`, GH];

mkdirSync(BIN, { recursive: true });

// 1. 官方校验和：直连取（只有几百字节，慢也无所谓）
let official = null;
try {
  const r = await fetch(`${GH}.sha256`, { signal: AbortSignal.timeout(90_000) });
  if (r.ok) {
    const t = (await r.text()).trim();
    official = (t.match(/[a-f0-9]{64}/i) ?? [])[0]?.toLowerCase() ?? null;
    console.log("官方 sha256:", official ?? "(格式没认出来)");
  } else {
    console.log("官方校验和: HTTP", r.status, "（没有就用不了）");
  }
} catch (e) {
  console.log("官方校验和取不到:", e.cause?.code ?? e.message);
}

// 2. 下载
let buf = null;
for (const url of MIRRORS) {
  const label = url === GH ? "直连" : "镜像 " + new URL(url).host;
  try {
    console.log(`从 ${label} 下载…`);
    const t0 = Date.now();
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(300_000) });
    if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
    const hash = createHash("sha256");
    const out = createWriteStream(EXE);
    let done = 0;
    for await (const chunk of r.body) {
      out.write(chunk);
      hash.update(chunk);
      done += chunk.length;
    }
    await new Promise((res) => out.end(res));
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`  完成 ${(done / 1024 / 1024).toFixed(1)} MB / ${secs}s`);
    buf = { digest: hash.digest("hex"), size: done };
    break;
  } catch (e) {
    console.log(`  失败: ${e.message}`);
  }
}

if (!buf) {
  console.error("所有源都失败。");
  process.exit(1);
}

const ok = official ? official === buf.digest : null;
console.log("下载 sha256:", buf.digest);
if (ok === true) console.log("✓ 与官方校验和一致");
else if (ok === false) {
  console.log("✗ 校验和不一致 —— 拒绝使用，文件已删除");
  try { rmSync(EXE); } catch {}
  process.exit(1);
} else console.log("⚠ 拿不到官方校验和，无法验证来源（自己决定要不要用）");

try {
  const v = execFileSync(EXE, ["--version"], { encoding: "utf8", timeout: 30_000 }).trim();
  console.log("✓ 可执行:", v);
} catch (e) {
  console.error("✗ 跑不起来:", e.message.split("\n")[0]);
  process.exit(1);
}
