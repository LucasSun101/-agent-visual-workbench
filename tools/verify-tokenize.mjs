// 验证令牌化只改了颜色，没动结构。
// 做法：两边都先剔掉 :root 块（那是要重写的），再把颜色值抹成占位符，逐行比对。
// 预期：除颜色外的声明应该**逐字相同**。
import { readFileSync } from "node:fs";
import path from "node:path";

const A = path.join(process.cwd(), "console", "public", "style.pre-tokenize.css");
const B = path.join(process.cwd(), "console", "public", "style.css");

const COLOR_TOKENS = [
  "bg", "bg-sunken",
  "surface-0", "surface-1", "surface-2", "surface-3", "surface-hover", "surface-raised", "surface-bar", "surface-notice",
  "panel", "panel2",
  "line", "line-2", "line-strong", "dot", "dot-off",
  "text", "text-soft", "dim", "faint",
  "accent", "ok", "warn", "bad", "run", "unknown",
  "bad-text", "bad-text-strong", "bad-text-soft", "accent-text",
  "accent-bg", "accent-bg-hover", "accent-line", "edge",
  "shade-35", "shade-40", "shade-45", "shade-55", "hairline",
];

const tokenRe = new RegExp(`var\\(--(?:${COLOR_TOKENS.join("|")})\\)`, "g");

const norm = (s) =>
  s
    .replace(/:root\s*\{[^}]*\}/g, "") // 剔除令牌块（两边都剔）
    .replace(/color-mix\((?:[^()]|\([^()]*\))*\)/g, "«C»") // 允许一层嵌套 var()
    .replace(/rgba?\([^)]*\)/g, "«C»")
    .replace(/#[0-9a-fA-F]{3,8}\b/g, "«C»")
    .replace(tokenRe, "«C»")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const a = norm(readFileSync(A, "utf8"));
const b = norm(readFileSync(B, "utf8"));

const same = a.length === b.length && a.every((line, i) => line === b[i]);
console.log(`旧文件 ${a.length} 行 · 新文件 ${b.length} 行`);

if (same) {
  console.log("\n✓ 除颜色外完全一致：令牌化没有改动任何结构");
  process.exit(0);
}

const setA = new Set(a);
const setB = new Set(b);
const onlyA = a.filter((l) => !setB.has(l));
const onlyB = b.filter((l) => !setA.has(l));
console.log(`\n只在旧文件里（${onlyA.length} 条）：`);
for (const l of onlyA) console.log("  - " + l.slice(0, 120));
console.log(`\n只在新文件里（${onlyB.length} 条）：`);
for (const l of onlyB) console.log("  + " + l.slice(0, 120));
process.exit(1);
