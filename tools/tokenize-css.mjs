// 把 style.css 里的字面色值全部换成 :root 令牌（hallmark Floor #1）。
// 思路：按**语义**归并，不是一值一令牌——比如三种近似悬停底色合并成一个 --surface-hover。
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "console", "public", "style.css");
const src = readFileSync(FILE, "utf8");

// 备份
copyFileSync(FILE, FILE + ".bak");

const ROOT = `:root {
  /* ---- 底色：层级越高越亮 ---- */
  --bg: #0a0e13;              /* 页面底 */
  --bg-sunken: #080d12;       /* 画布、代码块、产物框 */
  --surface-0: #0b1219;       /* 输入框、列表行 */
  --surface-1: #0f1620;       /* 面板 */
  --surface-2: #121b26;       /* 面板里的内嵌块 */
  --surface-3: #16232f;       /* 按钮、控件 */
  --surface-hover: #1c2c3b;   /* 悬停（原来有 3 种近似值，合并成一个） */
  --surface-raised: #0c141d;  /* 抽屉、浮层、右栏 */
  --surface-bar: #0d141d;     /* 顶栏、栏目标题 */
  --surface-notice: #101a24;  /* 通知类卡片 */

  /* ---- 描边 ---- */
  --line: #1d2836;            /* 普通 */
  --line-2: #2b4a63;          /* 中等强调：聚焦、悬停 */
  --line-strong: #34536e;     /* 强强调：选中、浮层 */
  --dot: #16202b;             /* 画布点阵 */

  /* ---- 文字 ---- */
  --text: #dbe6f2;
  --text-soft: #c3d3e3;       /* 正文引用，比主文字暗一档 */
  --dim: #7f92a8;
  --faint: #55657a;
  --dot-off: #3a4655;

  /* ---- 状态色 ---- */
  --accent: #49c6ff;
  --ok: #3ddc97;
  --warn: #ffb74d;
  --bad: #ff6b6b;
  --run: #5aa9ff;
  --unknown: #b388ff;

  /* ---- 状态色的文字 / 按钮变体 ---- */
  --bad-text: #ffb3b3;
  --bad-text-strong: #ffd0d0;
  --bad-text-soft: #e6a3a3;
  --accent-text: #d9f2ff;
  --accent-bg: #17405a;
  --accent-bg-hover: #1d5172;
  --accent-line: #2b6d92;
  --edge: #3d7ba3;            /* 画布连线 */

  /* ---- 阴影 ---- */
  --shade-35: rgba(0, 0, 0, 0.35);
  --shade-40: rgba(0, 0, 0, 0.4);
  --shade-45: rgba(0, 0, 0, 0.45);
  --shade-55: rgba(0, 0, 0, 0.55);
  --hairline: rgba(255, 255, 255, 0.018);

  /* ---- 字体 / 尺寸 / 动效 ---- */
  --mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
  --sp-25: 2px; --sp-50: 4px; --sp-75: 8px; --sp-100: 12px;
  --sp-200: 16px; --sp-300: 24px; --sp-400: 32px;
  --r-sm: 4px; --r-md: 6px; --r-lg: 8px; --r-xl: 12px;
  --fs-12: 12px; --fs-14: 14px; --fs-16: 16px; --fs-18: 18px;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
}`;

// 1. 先删掉多余的 :root 块（之前加的间距/字号令牌，已并入新的 ROOT）
const allRoots = [...src.matchAll(/:root\s*\{[^}]*\}/g)];
if (!allRoots.length) {
  console.error("找不到 :root 块，中止");
  process.exit(1);
}
let cleaned = src;
for (const extra of allRoots.slice(1)) {
  cleaned = cleaned.replace(extra[0], "");
}
console.log(`合并掉 ${allRoots.length - 1} 个多余 :root 块`);

// 2. 换掉第一个 :root 块
let out = cleaned.replace(/:root\s*\{[^}]*\}/, ROOT);

// 2. 这里开始才是"令牌块之后"，所有字面色值都得消失
let body = out.slice(out.indexOf(ROOT) + ROOT.length);

// 十六进制 → 语义令牌
const HEX = {
  "#0a0e13": "var(--bg)",
  "#080d12": "var(--bg-sunken)",
  "#0b1219": "var(--surface-0)",
  "#0f1620": "var(--surface-1)",
  "#121b26": "var(--surface-2)",
  "#16232f": "var(--surface-3)",
  "#121d28": "var(--surface-hover)",
  "#101c27": "var(--surface-hover)",
  "#1c2c3b": "var(--surface-hover)",
  "#0c141d": "var(--surface-raised)",
  "#0d141d": "var(--surface-bar)",
  "#101a24": "var(--surface-notice)",
  "#1d2836": "var(--line)",
  "#2b4a63": "var(--line-2)",
  "#2b3d51": "var(--line-2)",
  "#34536e": "var(--line-strong)",
  "#16202b": "var(--dot)",
  "#dbe6f2": "var(--text)",
  "#c3d3e3": "var(--text-soft)",
  "#7f92a8": "var(--dim)",
  "#55657a": "var(--faint)",
  "#3a4655": "var(--dot-off)",
  "#49c6ff": "var(--accent)",
  "#3ddc97": "var(--ok)",
  "#ffb74d": "var(--warn)",
  "#ff6b6b": "var(--bad)",
  "#5aa9ff": "var(--run)",
  "#b388ff": "var(--unknown)",
  "#ffb3b3": "var(--bad-text)",
  "#ffd0d0": "var(--bad-text-strong)",
  "#e6a3a3": "var(--bad-text-soft)",
  "#d9f2ff": "var(--accent-text)",
  "#17405a": "var(--accent-bg)",
  "#1d5172": "var(--accent-bg-hover)",
  "#2b6d92": "var(--accent-line)",
  "#3d7ba3": "var(--edge)",
  "#0e1721": "var(--surface-0)",
};

let hexCount = 0;
body = body.replace(/#[0-9a-fA-F]{3,8}\b/g, (m) => {
  const token = HEX[m.toLowerCase()];
  if (!token) {
    console.error(`✗ 没给 ${m} 分配令牌`);
    process.exit(1);
  }
  hexCount++;
  return token;
});

// rgba() → color-mix（状态色）或阴影令牌（黑/白）
const STATE = {
  "73,198,255": "--accent",
  "90,169,255": "--run",
  "61,220,151": "--ok",
  "255,183,77": "--warn",
  "255,107,107": "--bad",
  "179,136,255": "--unknown",
};

let rgbaCount = 0;
body = body.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g, (m, r, g, b, a) => {
  const rgb = `${r},${g},${b}`;
  const alpha = a === undefined ? 1 : Number(a);
  rgbaCount++;

  if (rgb === "0,0,0") {
    const t = { 0.35: "--shade-35", 0.4: "--shade-40", 0.45: "--shade-45", 0.55: "--shade-55" }[alpha];
    if (!t) {
      console.error(`✗ 黑色 alpha ${alpha} 没有令牌`);
      process.exit(1);
    }
    return `var(${t})`;
  }
  if (rgb === "255,255,255") return "var(--hairline)";

  const token = STATE[rgb];
  if (!token) {
    console.error(`✗ 没给 rgb(${rgb}) 分配颜色`);
    process.exit(1);
  }
  const pct = Math.round(alpha * 100);
  return `color-mix(in srgb, var(${token}) ${pct}%, transparent)`;
});

out = out.slice(0, out.indexOf(ROOT) + ROOT.length) + body;

// 顺便把 --panel / --panel2 的旧名统一到新尺度
out = out.replace(/var\(--panel2\)/g, "var(--surface-2)").replace(/var\(--panel\)/g, "var(--surface-1)");

writeFileSync(FILE, out, "utf8");

const left = [...out.slice(out.indexOf(ROOT) + ROOT.length).matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].length;
console.log(`替换 ${hexCount} 处十六进制、${rgbaCount} 处 rgba()`);
console.log(`令牌块之后剩余字面色值：${left}`);
console.log(`备份：style.css.bak`);
