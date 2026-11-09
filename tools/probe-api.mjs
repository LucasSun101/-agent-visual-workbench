// Probe the running hub: /v1/state shape, /v1/stream fact shape, /v1/runs/:id/why.
// Reads keys from ~/.agent-autoloop/config.json but never prints them.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const cfg = JSON.parse(readFileSync(path.join(homedir(), ".agent-autoloop", "config.json"), "utf8"));
const base = cfg.url;
const H = { authorization: `Bearer ${cfg.owner}` };
const show = (v, n = 700) => {
  const s = JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + " …" : s;
};

const state = await (await fetch(`${base}/v1/state`, { headers: H })).json();
console.log("== /v1/state ==");
console.log("top-level keys:", Object.keys(state).join(", "));
console.log("totals:", show(state.totals));
console.log("spending:", show(state.spending));
console.log("lines[0]:", show(state.lines?.[0]));
console.log("agents:", show(state.agents));
console.log("channels:", show(state.channels));
console.log("sources:", show(state.sources));
console.log("cards:", show(state.cards));
console.log("recentCards[0]:", show(state.recentCards?.[0]));
console.log("runs[0] keys:", Object.keys(state.runs?.[0] ?? {}).join(", "));
console.log("runs[0]:", show(state.runs?.[0], 900));
console.log("runs[1]:", show(state.runs?.[1], 500));
console.log("hasMore/nextBefore/unrouted:", state.hasMore, state.nextBefore, show(state.unrouted));
console.log("now/timezone:", state.now, state.timezone);

const why = await (await fetch(`${base}/v1/runs/2/why`, { headers: H })).json();
console.log("\n== /v1/runs/2/why ==");
console.log("keys:", Object.keys(why).join(", "));
console.log("sample:", show(why, 900));

console.log("\n== /v1/stream?after=0 ==");
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), 4000);
try {
  const res = await fetch(`${base}/v1/stream?after=0`, { headers: H, signal: ac.signal });
  console.log("status:", res.status, "content-type:", res.headers.get("content-type"));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    if (text.length > 4000) break;
  }
  const events = text.split("\n\n").filter(Boolean).slice(0, 6);
  for (const e of events) console.log("---\n" + e.slice(0, 500));
} catch (err) {
  console.log("stream ended:", err.name);
} finally {
  clearTimeout(timer);
  ac.abort();
}
