# 工作台 · 架构说明

> 给后续维护者和参与协作的 Agent 看。这是**人写**的静态文档，会落后于代码；
> 运行时接口和当前状态见 `workbench/AGENTS.md`——它由控制台**在你本机生成**，不随仓库分发，
> 第一次跑起来之后才会出现。

## 1. 一句话

一个 **多 Agent 中台**：事件进 → 按规则派给某个 Agent → 一轮跑完交回执 → 拿不准的事发卡片等人拍板 → 拍板后续接同一个会话。
可视化层（控制台）是它的**纯客户端**，文件桥（workbench/）是任何 Agent 都能参与的**读写接口**。

## 2. 总体拓扑

```
                     ┌───────────── 人（浏览器 / 手机）─────────────┐
                     │  控制台 Web UI（泳道/收件箱/时间线/文件桥）    │
                     └───────────────────┬────────────────────────┘
                                          │ HTTP(带 cookie) + SSE
        ┌─────────────────────────────────▼──────────────────────────────┐
        │  控制台 console/server.mjs  端口 51425                          │
        │   · 静态页 + /v1 反向代理 + SSE 中继                             │
        │   · 口令登录 / ?k= 令牌  →  HttpOnly cookie                      │
        │   · 写接口只有 /api/answer、/api/stop（要 X-WB 头）              │
        │   · 每次投影：写 state.json + 重写 AGENTS.md                     │
        │   · 每 2 秒：消费 workbench/intents/ 里的意图                    │
        └──────────────┬───────────────────────────────┬─────────────────┘
                       │ 读 /v1/*（owner key 只在服务端） │ 文件桥
        ┌──────────────▼──────────────┐      ┌──────────▼──────────────┐
        │  中台 agent-autoloop-wb-dsh  │      │  workbench/             │
        │  端口 3350，一个进程三合一    │      │   state.json 只读投影   │
        │  · 内核：事实日志+SQLite     │      │   AGENTS.md  自更新说明  │
        │  · worker：领活→spawn Agent  │      │   intents/   意图(写)    │
        │  · channel：桌面通知         │      │   receipts.ndjson 审计   │
        └──────────────┬──────────────┘      └─────────────────────────┘
                       │ spawn
        ┌──────────────▼──────────────────────────────┐
        │  Agent 进程（plugins/<name>/agent.ts）       │
        │   dsh-desktop(真模型) / command / 测试用     │
        └─────────────────────────────────────────────┘
```

## 3. 中台（kernel/host/worker/cli）

基座是 `agent-autoloop-wb-dsh`（上游 `agent-autoloop` 的 Windows 独立实现，MIT；两个许可证都随仓库分发）。

- **内核**：确定性状态机。`decide(view,input,now,env)` 只读、`evolve(view,facts)` 唯一写入；只追加事实日志 + SQLite(WAL) 投影。~1800 行、零运行时依赖。
- **三通阀**：来源、worker、通道都是**自己连进来的客户端**，内核从不主动发起请求、不保管凭据。
- **世界模型五层**：事件 → 规则 → 事项(subject) → 轮(run) → Agent 进程。没有 agent→agent 边，协作靠 Agent 回执里交 `events` 再派。
- **回执**：Agent 只承诺「最后一条消息交代结果」。要请示就在末尾附 ` ```agent-autoloop ` 代码块（ask/notice/resolve/later/events）。
- **命令**：`up`（跑起来）、`try`（试跑）、`status`、`answer <id> <序号>`、`resolve`、`stop <run>`、`check`、`doctor`、`why <run>`。
- **配置**：`~/.agent-autoloop/rules.json`（规则）、`config.json`（密钥）、`hub.db`（状态）。

### rules.json 结构

```jsonc
{
  "sources": { "local": { "name": "本机" } },
  "agents": {
    "ds": { "name": "DeepSeek Harness（真实模型）", "worker": "worker-1", "use": "dsh-desktop", "access": "edit" }
  },
  "channels": { "desktop": { "name": "桌面通知" } },
  "rules": [
    { "name": "试一下", "when": { "source": "local", "types": ["try.*"] }, "to": "ds",
      "cwd": "<用户目录>\\.agent-autoloop\\try", "prompt": "…" }
  ],
  "elsewhere": []
}
```

## 4. 控制台（console/）

零 npm 依赖，Node 24 原生跑。文件：

| 文件 | 职责 |
|---|---|
| `server.mjs` | 静态页 + `/v1/*` 反向代理 + SSE 中继 + 登录 + 写接口 + 投影 + 意图循环 |
| `public/` | 前端：`index.html` / `app.js` / `style.css` + PWA（manifest/sw/图标） |
| `intents.mjs` | 文件桥写侧：校验、幂等、限速、回执、消费循环 |
| `agents-doc.mjs` | 生成 `workbench/AGENTS.md` |

**HTTP 接口**（详情见 AGENTS.md 的表）：

- 只读：`/api/state`、`/api/stream`(SSE)、`/api/why/:id`、`/api/output/:id`、`/api/intents`
- 写：`/api/answer`、`/api/stop`（都要求 `X-WB: 1` 头 + cookie）

**鉴权**：启动令牌在 `console/.session`（URL `?k=` 用），口令在 `console/.passcode`（`/login` 用）。owner key 只存在于服务端内存，从不出现在浏览器。

## 5. 文件桥（workbench/）

给「只会读写文件的任意 Agent」用的接口，和内核一样是事件溯源哲学的投影：

| 文件 | 谁写 | 语义 |
|---|---|---|
| `state.json` | 控制台 | 事实日志的**只读投影**（`rev` 单调增，原子换） |
| `AGENTS.md` | 控制台 | 自更新说明：怎么读状态、怎么投意图、调什么 HTTP |
| `intents/<id>.json` | 任何 Agent | **意图**（只追加、文件名即幂等键） |
| `intents/done/`、`rejected/` | 控制台 | 归档 |
| `intents/receipts.ndjson` | 控制台 | 审计 |

## 6. Agent 适配器（plugins/<name>/agent.ts）

一个适配器就是三件事：`command(turn)` 返回 argv、`read(stdout,code,stderr)` 解析最后一条消息和会话、`check()` 体检。

- `dsh-desktop`：真实模型。用 Harness 桌面二进制（`DeepSeek Harness.exe --expose-internals app.asar\dsh\...\cli.js`）+ `ELECTRON_RUN_AS_NODE=1`。API key 从 `~/.agent-autoloop/secrets/deepseek.key` 读，注入子进程环境。解析 `--json` NDJSON（session/final/step_end usage/turn_end error）。
- `command`：任意能打印最后一条消息的命令（`{prompt}` 替换）。
- `deepseek`（内置，未用）：按 `node + node_modules/.../bin.js` 找，桌面安装形态下不成立。

**加一个 Agent**：写 `plugins/<name>/agent.ts`，rules.json 里 `agents.<name>.use` 填它，规则 `to` 指向它。

## 7. 安全边界

| 边界 | 机制 |
|---|---|
| owner key 不进浏览器 | 控制台服务端持有，浏览器只有 cookie |
| 写接口 CSRF | cookie + `X-WB` 自定义头（跨站表单带不了） |
| 公网暴露 | 口令登录（`console/.passcode`）+ 登录限速（5 分钟 6 次） |
| 意图只能低危 | 动作白名单 answer/resolve/stop；禁改编排字段；幂等；限速 20 条/分钟 |
| API key 隔离 | 只在 `~/.agent-autoloop/secrets/deepseek.key`，不进日志/规则/对话 |
| 指令数据分离 | 事件文字只进资料文件，不进提示词；agent/cwd/access 只由本机规则决定 |

## 8. 端口与路径速查

| 项 | 值 |
|---|---|
| 中台 | `http://127.0.0.1:3350` |
| 控制台 | `http://127.0.0.1:51425`（口令在 `console/.passcode`） |
| 桌面 DSH | `http://127.0.0.1:51424`（令牌鉴权，勿公网暴露） |
| 工作区根 | `<repo>` |
| 中台配置 | `~/.agent-autoloop/`（rules.json、config.json、hub.db、secrets/） |

## 9. 扩展点

| 想加什么 | 改哪里 |
|---|---|
| 新 Agent | `agent-autoloop-wb-dsh/plugins/<name>/agent.ts` + rules.json |
| 新规则 | rules.json（`check` 校验，热重载） |
| 新面板 | `console/public/index.html` + `app.js` 渲染函数 + `style.css` |
| 新 HTTP 端点 | `console/server.mjs` 路由 + `agents-doc.mjs` 能力表 |
| 换模型 | 适配器读的模型配置（dsh 走 profile，不经过 rules 的 model 字段） |

## 10. 已知坑（务必记住）

1. **Node 会缓存已导入模块**：改了 `plugins/*`、`console/*.mjs` 要重启对应进程才生效。
2. **中文路径别过 shell**：Windows 控制台码页会毁掉它。配置一律从 UTF-8 文件读，命令行只传 ASCII。
3. **localhost 优先解析到 IPv6**：隧道/反代要用 `127.0.0.1` 而不是 `localhost`，否则 502。
4. **GitHub 走加速器时**，node 要加 `--use-system-ca` 才认证书。
5. **沙箱**：受限环境下 Node 的 `spawn` 不能用管道抓输出（EPERM），改用文件重定向。
6. **`try` 会被旧失败轮次挡住**：先 `stop <run>` 清掉排队中已重试的轮次。
7. **PowerShell 5.1 按 ANSI 读 `.ps1`**：脚本里有中文就必须存成 **UTF-8 带 BOM**。无 BOM 时中文注释变乱码，会把 `param(` 块解析坏，报 `Unexpected token ')'`——桌面通知就是因为这个挂了整条链路。
