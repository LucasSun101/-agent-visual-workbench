#!/usr/bin/env node
// 发布前隐私自检：仓库里不该有密钥、个人路径、机器身份、运行时数据。
// 用法：node tools/check-privacy.mjs   （发现问题的退出码是 1）
//
// 2026-11-09 第二轮审计推翻了它的第一版，原话是「它报 ✓ 的时候我不敢信」：
// 审计构造了 10 个反例，9 个被放行。这一版针对那些反例重写，逐条对应：
//   ① 不再"整文件豁免"（只跳过本脚本自己）——曾经有几个文件被整份跳过，一个可预测的文件名就等于后门
//   ② 每行每条规则扫**全部**匹配，不再只取第一个（曾用 exec + break）
//   ③ 去掉 2 MB 静默跳过，改成"只扫前 2 MB"并明确告警
//   ④ .gitignore 自检覆盖各种等价写法（**/workflow/、workflow、workflow/**）
//   ⑤ 占位符不再"见到尖括号就放过"（`C:\Users\<demo-user>\` 这种曾因此混过）
//   ⑥ 路径规则同时认反斜杠与正斜杠，并覆盖 macOS 的 /Users/
//   ⑦ 报告里对疑似敏感值做遮挡，避免自检工具二次扩散
import { readdirSync, statSync, existsSync, readFileSync, openSync, closeSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, "/");
const SKIP_DIRS = new Set(["node_modules", ".git"]); // 只跳依赖与版本库
// 只跳"根下这个具体路径"，不按目录名通配——否则 agent-autoloop-wb-dsh/bin/ 里的源码会被整目录漏扫
const SKIP_PATHS = ["tools/bin"]; // 只跳第三方二进制（52 MB），其余一律扫
const TEXT_EXT =
  /\.(mjs|cjs|js|jsx|ts|tsx|json|cmd|bat|ps1|sh|md|html|css|yml|yaml|txt|sql|webmanifest|ini|cfg|conf|env|lock)$/i;
const MAX_SCAN = 2_000_000;

function walkAll(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const rel = path.relative(ROOT, p).replace(/\\/g, "/");
    if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) continue; // 任意层级跳过依赖/版本库
    if (SKIP_PATHS.some((p) => rel === p || rel.startsWith(p + "/"))) continue;
    const st = statSync(p);
    if (st.isDirectory()) walkAll(p, out);
    else out.push({ full: p, rel, name, size: st.size });
  }
  return out;
}

const problems = [];
const seen = new Set();
function note(where, line, why, text) {
  const key = `${where}|${line}|${why}`;
  if (seen.has(key)) return;
  seen.add(key);
  problems.push({ where, line, why, text: mask(String(text ?? "").trim().slice(0, 120)) });
}

/** 报告里不要把疑似敏感值原样抄出来 */
function mask(s) {
  return s
    .replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]{8,}/g, "$1…")
    .replace(/\b([A-Za-z0-9_-]{6})[A-Za-z0-9_-]{14,}\b/g, "$1…")
    .replace(/([?&](?:k|token|key|secret|passcode)=)([A-Za-z0-9._~-]{4})[A-Za-z0-9._~-]+/g, "$1$2…");
}

const files = walkAll(ROOT);

// ---------- 1. 文件名本身就是秘密 ----------
const BAD_NAME = [
  [/\.key$/i, "密钥文件"],
  [/\.pem$/i, "证书/私钥"],
  [/\.(p12|pfx)$/i, "证书容器"],
  [/^id_(rsa|dsa|ecdsa|ed25519)/i, "SSH 私钥"],
  [/\.ppk$/i, "PuTTY 私钥"],
  [/\.keystore$/i, "密钥库"],
  [/^master\.key$/i, "主密钥"],
  [/^\.npmrc$/i, "可能含 registry 凭据"],
  [/^credentials\.json$/i, "云凭据"],
  [/\.sqlite3?(-(wal|shm|journal))?$/i, "SQLite 数据库"],
  [/\.db(-wal|-shm)?$/i, "数据库"],
  [/\.log$/i, "日志"],
  [/\.bak(~|-\d{4}-|$)|\.backup$/i, "备份文件"],
  [/^\.passcode$/i, "控制台登录口令"],
  [/^\.session$/i, "控制台会话令牌"],
  [/^state\.json$/i, "运行时状态"],
  [/^up\.pid$/i, "进程号文件"],
  [/^mobile-url\.txt$/i, "带 token 的隧道地址"],
  [/^cloudflare\.json$/i, "隧道凭据"],
];
for (const f of files) {
  for (const [re, why] of BAD_NAME) {
    if (re.test(f.name)) note(f.rel, 0, why + "（文件名即秘密）", "删掉；打包/换目录时 .gitignore 未必跟得上");
  }
}

// ---------- 2. 文本内容扫描 ----------
/** 尖括号里只认"看起来就是占位"的词，不再见到 < 就放过 */
function isPlaceholderWord(w) {
  const s = String(w ?? "").trim();
  if (!s) return false;
  if (/^(you|your|yourname|user|username|name|me|someone|example|test|foo|bar|placeholder)$/i.test(s)) return true;
  if (/[\u4e00-\u9fa5]/.test(s)) return true; // 中文占位（<你>、<你的用户名>）
  return /^[.…]+$/.test(s);
}
function placeholderInBrackets(seg) {
  const m = /^<([^>]*)>$/.exec(String(seg ?? "").trim());
  return Boolean(m) && isPlaceholderWord(m[1]);
}

const ALLOW_IP = /^(127\.|0\.0\.0\.0$|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/;
const ALLOW_EMAIL_DOMAIN = /^(localhost|localhost\.run|example\.(com|org|net)|users\.noreply\.github\.com)$/i;
const ALLOW_EMAIL_LOCAL = /^(noreply|no-reply|git|ssh|nokey|deploy|action|actions)$/i;

const RULES = [
  { why: "疑似 API Key（sk-）", re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { why: "疑似 GitHub token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { why: "疑似 AWS key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { why: "疑似 Google key", re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { why: "疑似 Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { why: "疑似私钥块", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { why: "疑似 bearer token", re: /\bBearer\s+[A-Za-z0-9._-]{20,}/g },
  // Windows / macOS / Linux 个人目录：同时认 \ 和 /，并认被尖括号包住的真实名字
  {
    why: "个人目录路径",
    re: /(?:[A-Za-z]:[\\/]+Users[\\/]+([^\\/"'\s)]+))|(?:[\\/]Users[\\/]+([^\\/"'\s)]+)[\\/])|(?:[\\/]home[\\/]+([^\\/"'\s)]+)[\\/])/g,
    check: (m) => {
      const seg = m[1] ?? m[2] ?? m[3] ?? "";
      if (placeholderInBrackets(seg)) return false;
      if (/[\[\]()|*+?^${}\\~]/.test(seg)) return false; // 正则/通配示例，不是真实路径
      return !isPlaceholderWord(seg);
    },
  },
  // 隧道域名：允许连字符，不限制长度上限那么死
  {
    why: "隧道域名（真实子域）",
    re: /\b([a-z0-9][a-z0-9-]{5,62})\.(lhr\.life|trycloudflare\.com|ngrok\.(io|app|free\.app)|localtunnel\.me|serveo\.net)\b/gi,
    check: (m) => !/^x{3,}$/i.test(m[1]) && !isPlaceholderWord(m[1]),
  },
  {
    why: "内网 IP",
    re: /\b(192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/g,
    check: (m, line) => !ALLOW_IP.test(m[1]) && !/^\/\d+/.test(line.slice(m.index + m[0].length)),
  },
  // 带凭据的 URL 参数：不再要求 ≥12 位
  { why: "带凭据的 URL 参数", re: /[?&](k|token|key|secret|passcode|access_token)=([A-Za-z0-9._~+/=-]{8,})/gi },
  {
    why: "邮箱地址",
    re: /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    check: (m) => !ALLOW_EMAIL_DOMAIN.test(m[1]) && !ALLOW_EMAIL_LOCAL.test(m[0].split("@")[0]),
  },
  { why: "疑似手机号", re: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
];

for (const f of files) {
  if (!TEXT_EXT.test(f.name)) continue;
  if (f.rel === SELF) continue; // 只跳过本脚本自己（它必然包含这些正则）

  const buf = readFileSync(f.full);
  const truncated = buf.length > MAX_SCAN;
  const text = buf.subarray(0, MAX_SCAN).toString("utf8");
  if (truncated) {
    problems.push({
      where: f.rel,
      line: 0,
      why: "文件过大，只扫了前 2 MB",
      text: `${f.size} 字节；剩余部分未检查，请人工确认`,
    });
  }

  text.split(/\r?\n/).forEach((line, i) => {
    for (const r of RULES) {
      r.re.lastIndex = 0;
      for (const m of line.matchAll(r.re)) {
        if (r.check && !r.check(m, line)) continue;
        note(f.rel, i + 1, r.why, line);
      }
    }
  });
}

// ---------- 3. 运行时数据：只关心"会不会被提交" ----------
// 以前用 existsSync 判断，结果任何真用过这个项目的人（workbench/ workflow/ 自然存在）都会看到假红灯。
// 现在：有 .git 就问 git（是否被跟踪）；没有 .git（刚解压的目录）才退回存在性检查。
const RUNTIME = [
  "workbench",
  "workflow",
  ".research",
  "intents",
  "handoff",
  "runs",
  "brief",
  "logs",
  "console/.session",
  "console/.passcode",
  "tools/bin",
  "node_modules",
];

function gitTracked(rel) {
  const log = path.join(tmpdir(), `wb-privacy-git-${process.pid}.txt`);
  const fd = openSync(log, "w");
  let out = "";
  try {
    execFileSync("git", ["ls-files", "--", rel], { cwd: ROOT, stdio: ["ignore", fd, fd], timeout: 30_000 });
    out = readFileSync(log, "utf8");
  } catch {
    out = "";
  } finally {
    closeSync(fd);
    rmSync(log, { force: true });
  }
  return out.split(/\r?\n/).filter(Boolean).length > 0;
}

const hasGit = existsSync(path.join(ROOT, ".git"));
for (const rel of RUNTIME) {
  if (hasGit) {
    if (gitTracked(rel)) {
      problems.push({
        where: rel,
        line: 0,
        why: "运行时数据被纳入了 git 索引",
        text: "它不该被提交；`git rm -r --cached` 并从 .gitignore 补上忽略规则",
      });
    }
  } else if (existsSync(path.join(ROOT, rel))) {
    problems.push({ where: rel, line: 0, why: "运行时/个人数据不该进仓库", text: "应被 .gitignore 排除，且不应存在" });
  }
}

// ---------- 4. .gitignore 自检 ----------
// 语义坑：不带前导斜杠、或带 ** 的目录规则会匹配任意层级，
// 把 console/workflow/（控制台核心模块）一起吞掉 —— 首提交就缺模块，clone 下来跑不起来。
const giPath = path.join(ROOT, ".gitignore");
if (!existsSync(giPath)) {
  problems.push({ where: ".gitignore", line: 0, why: "缺少 .gitignore", text: "没有它，谁都可能误提交密钥" });
} else {
  const giLines = readFileSync(giPath, "utf8").split(/\r?\n/);
  for (const name of ["workbench", "workflow"]) {
    const safe = new RegExp(`^\\s*/${name}/?\\s*$`);
    const dangerous = new RegExp(`^\\s*(\\*\\*[\\/])?${name}([\\/](\\*\\*)?)?\\s*$`);
    const hasSafe = giLines.some((l) => safe.test(l));
    const bad = giLines.findIndex((l) => dangerous.test(l) && !safe.test(l));
    if (bad >= 0) {
      // 危险写法与安全写法并存时**照样生效**（gitignore 是叠加的），所以只要存在就报
      problems.push({
        where: ".gitignore",
        line: bad + 1,
        why: `.gitignore 第 ${bad + 1} 行会吞掉任意层级的 ${name}/`,
        text: `写法「${giLines[bad].trim()}」也匹配 console/${name}/，而那正是控制台的核心模块。改成 /${name}/`,
      });
    } else if (!hasSafe) {
      problems.push({
        where: ".gitignore",
        line: 0,
        why: `没有用 /${name}/ 形式忽略根目录 ${name}`,
        text: `建议加一行 /${name}/`,
      });
    }
  }
}

// ---------- 5. 合规底线 ----------
if (!existsSync(path.join(ROOT, "LICENSE"))) {
  problems.push({ where: "LICENSE", line: 0, why: "缺少许可证", text: "公开仓库必须有 LICENSE，否则默认保留所有权利" });
}

// ---------- 报告 ----------
if (!problems.length) {
  console.log(`✓ 隐私自检通过：${files.length} 个文件，没有密钥、个人路径、机器身份、运行时数据`);
  process.exit(0);
}

const byWhy = new Map();
for (const p of problems) {
  if (!byWhy.has(p.why)) byWhy.set(p.why, []);
  byWhy.get(p.why).push(p);
}

console.error(`✗ 发现 ${problems.length} 处问题（${byWhy.size} 类）：\n`);
for (const [why, list] of byWhy) {
  console.error(`  [${why}] ${list.length} 处`);
  for (const p of list.slice(0, 8)) {
    console.error(`    ${p.where}${p.line ? ":" + p.line : ""}`);
    if (p.text) console.error(`        ${p.text}`);
  }
  if (list.length > 8) console.error(`    …… 还有 ${list.length - 8} 处`);
  console.error("");
}
console.error("处理方式：删掉这些文件 / 把值换成占位符；参见 SECURITY.md 的「仓库里不会有的东西」。");
process.exit(1);
