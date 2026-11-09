// 接单程序专用的启动器：以独立进程组把 Agent 拉起来，把输出落进文件、把退出码落进 exit 文件。
// 接单程序自己被停掉、甚至整个程序退出，Agent 都还在跑；接单程序回来时通过这两个文件接着看。
// 用 Node 而不是 shell 包装，是为了命令参数不被任何 shell 转义破坏。
import { spawn } from "node:child_process";
import { closeSync, openSync, renameSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const dash = args.indexOf("--");
const opts = {};
for (let i = 0; i < dash; i += 2) opts[args[i].slice(2)] = args[i + 1];
const argv = args.slice(dash + 1);
const out = String(opts.out);
const err = String(opts.err);
const exit = String(opts.exit);
const outFd = openSync(out, "a");
const errFd = openSync(err, "a");

function persist(code) {
  try {
    closeSync(outFd);
    closeSync(errFd);
  } catch {}
  try {
    const temp = exit + ".tmp";
    writeFileSync(temp, String(code));
    renameSync(temp, exit);
  } catch {}
}

const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", outFd, errFd] });
child.on("error", () => persist(-1));
child.on("exit", (code) => persist(code === null ? -1 : code));
