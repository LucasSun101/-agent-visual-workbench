#!/usr/bin/env node
// 语法自检：所有 .mjs / .js 过一遍 `node --check`，再对纯模块做一次真实加载。
//
// 两个坑（都踩过）：
//   1. execFileSync 用默认 pipe stdio 在受限沙箱里会 EPERM → 必须 stdio: "ignore"，只看退出码
//   2. 别 import console/server.mjs：它在模块顶层会读 console/.session、启动文件桥，有副作用
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".git", "tools/bin", "dist"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const rel = path.relative(ROOT, p).replace(/\\/g, "/");
    if ([...SKIP].some((d) => rel === d || rel.startsWith(d + "/"))) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const failed = [];

for (const f of files) {
  try {
    // stdio: "ignore" —— 管道在受限沙箱里会 EPERM
    execFileSync(process.execPath, ["--check", f], { stdio: "ignore" });
  } catch {
    failed.push(path.relative(ROOT, f));
  }
}

// 纯模块：加载一次，确认没有悬空导入 / 顶层错误
const PURE_MODULES = [
  "console/workflow/runner.mjs",
  "console/workflow/store.mjs",
  "console/workflow/directives.mjs",
  "console/workflow/rules-sync.mjs",
  "console/routes/workflow-write.mjs",
];
const loadFailed = [];
for (const mod of PURE_MODULES) {
  try {
    await import(pathToFileURL(path.join(ROOT, mod)).href);
  } catch (e) {
    loadFailed.push(`${mod} → ${e.message}`);
  }
}

if (failed.length) console.error("✗ 语法错误：\n  " + failed.join("\n  "));
if (loadFailed.length) console.error("✗ 模块加载失败：\n  " + loadFailed.join("\n  "));

const bad = failed.length + loadFailed.length;
console.log(
  bad
    ? `✗ ${bad} 处问题（检查 ${files.length} 个文件，加载 ${PURE_MODULES.length} 个模块）`
    : `✓ 语法与加载全部通过（${files.length} 个文件，${PURE_MODULES.length} 个模块）`,
);
process.exit(bad ? 1 : 0);
