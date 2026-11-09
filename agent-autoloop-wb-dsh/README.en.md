# Agent Autoloop (WorkBuddy / DeepSeek Edition)

**Let your command-line Agent pick up work in the background and follow it through; it only bothers you with a card when it needs your judgment. Agent backend: WorkBuddy CLI or DeepSeek Harness (dsh), your choice.**

A from-scratch, **Windows-native** Agent automation hub. Architecture and protocol are inspired by [KKKKhazix/agent-autoloop](https://github.com/KKKKhazix/agent-autoloop) (MIT); the code is an independent implementation deeply adapted for Windows.

**English** | [中文](README.md)

## What it does

Command-line agents (WorkBuddy CLI, DeepSeek Harness / dsh, Claude Code, or anything that takes a prompt and prints a final reply) usually run "with a human watching the terminal". This hub schedules work so agents run in the background:

- One Windows machine, one command to run. No cloud server, no open ports.
- One line of config to connect a new agent. No SDK, no modifying agent source.
- Two backends by default: WorkBuddy CLI and DeepSeek Harness (dsh); `init` picks whichever is installed, or `--agent workbuddy|deepseek|claude|codex`.
- No web UI. Cards are pushed to desktop notification or DingTalk/WeCom/Slack/Discord; one command shows the full picture.

## Install

Requirements: **Node.js 22.18+** (24 recommended), **Git for Windows**, and a signed-in CLI agent.

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Install a backend (pick one)

- **WorkBuddy CLI**: bundled with the WorkBuddy/CodeBuddy desktop app; verify with `codebuddy --version`.
- **DeepSeek Harness (recommended, default)**: `npm install -g @deepseek-ai/dsh`, configure an API key; verify with `dsh --version`. The version this project is adapted to is listed under "DeepSeek Harness adaptation" below.

Then run the whole loop end to end with your own agent:

```
agent-autoloop try
```

It asks a question ("pick a color"), you answer with `agent-autoloop answer 1 2`, and it resumes the same conversation to finish. `agent-autoloop status` shows rounds, tokens and cost.

## DeepSeek Harness adaptation

The default agent backend is **DeepSeek Harness (dsh)** via its headless mode. Verified against:

| Item | Version / value | Notes |
| --- | --- | --- |
| dsh | `0.2.1-rc.5` (global `@deepseek-ai/dsh`) | `dsh --profile headless --json "<task>"` one-shot mode |
| Node.js | `24.x` (22.18+ works) | The adapter launches `node + lib/bin.js` directly, bypassing npm's `.cmd` wrapper (Windows cannot `spawn` a `.cmd`, it throws `EINVAL`) |
| headless output | `--json` NDJSON event stream | First line is a `session` event with `sessionId`, last is a `final` event with `text`; `--session-id <id>` resumes a session |
| Protocol | `anthropic-messages` (`/v1/messages`) | `llm-pi-ai` provider in the headless profile |
| API key | `UNITTEC_API_KEY` (or `DEEPSEEK_API_KEY`) | The adapter reads it from the `refs` of `~/.dsh/.credentials.yaml` and injects it; dsh headless does NOT read `~/.dsh/.env` |
| Model | `Qwen3.5-9B-text-nothink` (example: any model on an anthropic-messages-compatible endpoint) | Set via `agent-default-model` in `~/.dsh/profiles/headless/cordis.patch.yml`; any model on an anthropic-messages endpoint works |

**Two adaptation points (why the code changed):**

1. **`.cmd` cannot be spawned directly**: on Windows `node:child_process` cannot spawn npm's `dsh.cmd` (`spawn EINVAL`). The adapter `plugins/deepseek/agent.ts` resolves the real `node.exe + node_modules/@deepseek-ai/dsh/lib/bin.js` and launches it directly.
2. **Receipt fence tolerance**: some models drop the **closing triple backticks** of a ```` ```agent-autoloop ```` block (they `end_turn` right at the end of the JSON). The fence regex in `worker/contract.ts` is now lenient — it accepts everything from the opening fence up to either a closing fence or the end of the text, so a receipt JSON missing the closing backticks is still parsed into an ask card. If a model truncates badly, prefer one that emits the full code block JSON (e.g. `Qwen3.5-9B-text-nothink`).

WorkBuddy CLI remains an optional backend (`init --agent workbuddy`).

## Rules

Edit `%USERPROFILE%\.agent-autoloop\rules.json`. A rule says **what happens, who does it, in which folder**:

```json
{
  "name": "Morning brief",
  "when": { "cron": "0 8 * * *" },
  "to": "wb",
  "cwd": "C:\\Users\\you\\notes",
  "prompt": "整理昨天的笔记和提交，写今天的早报。"
}
```

`"use": "workbuddy"` for WorkBuddy, `"use": "deepseek"` for DeepSeek Harness. Rules can route to different agents.

## The contract with an agent

An agent ends each round with a conclusion on its first line. To ask, notify, close a card, schedule a review or emit an event, it appends a receipt block:

````
Order checked, stock is fine.

```agent-autoloop
{"ask":[{"title":"How to ship?","text":"Either way ships today.","options":["快递","自提"],"key":"shipping"}]}
```
````

## Kernel mechanics

~1800 lines, zero third-party runtime dependencies, no system clock reads, no outbound requests.

- **Hang for free**: while waiting for you, processes exit and nothing runs or costs tokens; when you answer, the same conversation resumes.
- **Event sourcing**: all state derives from an append-only log; log and index commit in one transaction before answering. A killed process loses nothing confirmed; a retry never does anything twice.
- **Instruction/data separation**: external text goes into files as data, never into prompts; only validated types, ids and links go in. Which agent, folder and permissions are decided by your local rules only.
- **Hop circuit breaker**: events triggering events accumulate a hop count that survives questions and reviews; beyond 8 layers it stops dispatching and tells you.

## Windows adaptations (vs. the macOS/Linux original)

- Agent backends are optional: WorkBuddy CLI and DeepSeek Harness (dsh) by default, Claude Code / Codex also usable; pick with `init --agent <name>` or the rule's `use` field.
- `install.ps1` + `agent-autoloop.cmd` shim instead of shell scripts.
- Startup via Task Scheduler (schtasks), falling back to the registry Run key without admin rights.
- Desktop notifications via PowerShell `NotifyIcon` balloon.
- Worker launches agents through a detached Node runner (`worker/runner.mjs`); process liveness via `tasklist`, process-tree stop via `taskkill /T`.
- `~` path expansion, junction-based skill links.

## Docs

- [Install](INSTALL.md) · [Rules & config](skills/agent-autoloop/SKILL.md) · [Plugins](docs/plugins.md) · [Protocol](docs/protocol.md) · [Security](docs/security.md)

[MIT License](LICENSE)
