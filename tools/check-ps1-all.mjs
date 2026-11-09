#!/usr/bin/env node
// 检查所有 .ps1 能否被 Windows PowerShell 5.1 解析。
//
// 为什么单独写一个：`check-syntax.mjs` 只收 .mjs/.js，`.ps1` 完全在它的视野外。
// 真实教训（2026-11-09 审计发现）：`install.ps1` 存成了不带 BOM 的 UTF-8，
// PowerShell 5.1 按 ANSI 解码中文注释，把后面的引号吃掉 —— 解析直接失败 6 处，
// 而 `npm test` 当时全绿。**官方安装命令 `powershell -File install.ps1` 因此根本跑不起来。**
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".git", "dist", "tools/bin"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const rel = path.relative(ROOT, p).replace(/\\/g, "/");
    if ([...SKIP].some((d) => rel === d || rel.startsWith(d + "/"))) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.ps1$/i.test(name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
if (!files.length) {
  console.log("✓ 没有 .ps1 文件要检查");
  process.exit(0);
}

// 优先用 Windows PowerShell 5.1（兼容面最窄、最容易暴露编码问题的那一个）
const ps = existsSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
  ? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  : "powershell";

const failed = [];
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, "/");
  try {
    // stdio 用 inherit：受限环境里管道会 EPERM，只看退出码就够
    execFileSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "tools", "check-ps1.ps1"), f], {
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 60_000,
    });
    console.log(`  ✓ ${rel}`);
  } catch {
    failed.push(rel);
    console.error(`  ✗ ${rel} —— PowerShell 解析失败（多半是编码：必须存成 UTF-8 **带 BOM**）`);
  }
}

if (failed.length) {
  console.error(`\n✗ ${failed.length} 个 .ps1 解析失败：${failed.join(", ")}`);
  console.error("修法：把它们另存为 UTF-8 带 BOM（PowerShell 5.1 不会把无 BOM 的 UTF-8 当中文处理）。");
  process.exit(1);
}
console.log(`\n✓ ${files.length} 个 .ps1 全部通过 PowerShell 解析`);
