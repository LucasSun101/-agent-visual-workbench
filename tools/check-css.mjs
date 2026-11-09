// 前端样式自查：把 docs/design-rules.md 里能机器判的几条跑一遍。
// 用法：node tools/check-css.mjs
import { readFileSync } from "node:fs";
import path from "node:path";

const CSS = path.join(process.cwd(), "console", "public", "style.css");
const JS = [path.join(process.cwd(), "console", "public", "workflow.js"), path.join(process.cwd(), "console", "public", "app.js")];

let fails = 0;
let infos = 0;
const fail = (msg, detail = "") => {
  fails++;
  console.log(`✗ ${msg}${detail ? " · " + detail : ""}`);
};
const pass = (msg, detail = "") => console.log(`✓ ${msg}${detail ? " · " + detail : ""}`);
const info = (msg, detail = "") => {
  infos++;
  console.log(`· ${msg}${detail ? " · " + detail : ""}`);
};

const css = readFileSync(CSS, "utf8");

// 1. 装饰性背景渐变（Floor 11 要的是"紫蓝渐变"这种装饰；点阵背景不算）
const gradients = [...css.matchAll(/linear-gradient|radial-gradient\((?!circle at 1px 1px)/g)].length;
gradients === 0 ? pass("没有装饰性背景渐变") : fail("出现装饰渐变", `${gradients} 处`);

// 2. 卡片单边描边（Floor：卡片必须整圈描边）
const sideBorders = [...css.matchAll(/border-(left|right):\s*\d/g)].length;
sideBorders === 0 ? pass("没有单边描边") : fail("有单边描边", `${sideBorders} 处（区域内部分隔线可接受，需人工确认）`);

// 3. 小号大写 / 字距加宽的标签（Floor 9）
const tracked = [...css.matchAll(/letter-spacing:\s*(0?\.[1-9]\d*em|[1-9]\d*px)/g)].length;
tracked === 0 ? pass("没有字距加宽的标签") : fail("有 tracked 标签", `${tracked} 处`);

// 4. transition: all（Floor 2）
/transition:\s*all/.test(css) ? fail("用了 transition: all") : pass("没有 transition: all");

// 5. 动效属性：禁止动 width/height/top/left
const badTransition = [...css.matchAll(/transition:[^;]*\b(width|height|top|left)\b/g)].length;
badTransition === 0 ? pass("动效不涉及 width/height/top/left") : fail("动效动了布局属性", `${badTransition} 处`);

// 6. 焦点环
if (/:focus-visible/.test(css)) pass("有 :focus-visible"); else fail("缺 :focus-visible（无障碍必需）");

// 7. 减弱动效
if (/prefers-reduced-motion/.test(css)) pass("尊重 prefers-reduced-motion"); else fail("缺 prefers-reduced-motion");

// 8. 彩色 emoji 当图标（Floor 11）。文字符号 ✎ ✓ ✕ ▶ × 不在禁止之列：
//    它们按字色渲染、跨平台一致，和彩色 emoji 是两回事。
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F5FF}\u{1F900}-\u{1F9FF}]/u;
let emojiHits = 0;
for (const f of JS) {
  try {
    const src = readFileSync(f, "utf8");
    for (const line of src.split("\n")) {
      if (EMOJI.test(line) && !line.trim().startsWith("//")) emojiHits++;
    }
  } catch {}
}
emojiHits === 0 ? pass("代码里没有 emoji 图标") : fail("还有 emoji 图标", `${emojiHits} 行`);

// 9. 字面色值（Floor 1）：令牌块之后不许出现 #hex / rgb() / rgba()
{
  const rootEnd = css.indexOf("}", css.indexOf(":root"));
  const body = rootEnd === -1 ? css : css.slice(rootEnd);
  const literals = [...body.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].length;
  literals === 0
    ? pass("令牌块之后没有字面色值", `color-mix 用法 ${[...css.matchAll(/color-mix\(/g)].length} 处`)
    : fail("还有字面色值", `${literals} 处应改成 var(--token) 或 color-mix()`);
}

// 10. 令牌完整性：用到的 var(--x) 必须在 :root 里有定义
//     （机械替换最容易漏这个：改名后某处还引用旧名，整条声明会静默失效）
{
  const rootEnd = css.indexOf("}", css.indexOf(":root"));
  const rootBlock = rootEnd === -1 ? "" : css.slice(0, rootEnd);
  const defined = new Set([...rootBlock.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((t) => !defined.has(t));
  missing.length === 0
    ? pass("用到的令牌都有定义", `${defined.size} 个令牌`)
    : fail("引用了未定义的令牌", missing.join(", "));
  const unused = [...defined].filter((t) => !used.has(t));
  if (unused.length) info("定义了但没用到", unused.join(", "));
}

// 12. 悬停必须有可见变化：`:hover` 的 background 不能和基础态一样
//     （这正是"看不出哪里能点"的机械成因——令牌化时把两个不同深浅合并成了同一个）
{
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: m[1].trim().replace(/\s+/g, " "),
    body: m[2],
  }));
  const bgOf = (body) => (body.match(/background(?:-color)?:\s*([^;]+);/) ?? [])[1]?.trim();
  const base = new Map();
  for (const b of blocks) {
    if (b.sel.includes(":") || b.sel.includes(" ")) continue;
    const bg = bgOf(b.body);
    if (bg) base.set(b.sel, bg);
  }
  const dead = [];
  for (const b of blocks) {
    const m = b.sel.match(/^([.#][\w-]+):hover$/);
    if (!m) continue;
    const hoverBg = bgOf(b.body);
    const baseBg = base.get(m[1]);
    if (hoverBg && baseBg && hoverBg === baseBg) dead.push(`${b.sel}（和基础态同为 ${hoverBg}）`);
  }
  dead.length === 0 ? pass("悬停都有可见的背景变化") : fail("悬停背景和基础态相同", dead.join("；"));
}

// 11. 字号档位（只提示非常规值）
const oddSizes = [...new Set([...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1])))].filter(
  (n) => ![12, 14, 16, 18, 20, 24, 30, 36].includes(n),
);
oddSizes.length === 0 ? pass("字号都在档位上") : info("非常规字号", oddSizes.map((n) => n + "px").join(" "));

console.log(`\n${fails} 处问题 · ${infos} 条提示`);
process.exit(fails ? 1 : 0);
