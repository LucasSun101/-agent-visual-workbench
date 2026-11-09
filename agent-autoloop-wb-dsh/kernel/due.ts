// 每件事下一个需要时钟的时刻：定时、复查、重试、卡片重发、接单程序失联、租约到期。
// 外壳只维护一个定时器，对准最早的那个，所以什么都不用轮询。
import { rows, type Row, type View } from "./evolve.ts";
import { configuration, waitingOn, workers } from "./query.ts";

export const MINUTE = 60_000;
/** 这个时间段内被看到过，就真的在；那它不再提起的一轮就是真的没动静了。 */
export const WORKER_FRESH = 2 * MINUTE;
/** 一轮被接住后，接单程序多久不提它，就算有疑问。 */
export const RUN_LEASE = 5 * MINUTE;
/** 活等一个不来的接单程序多久，主人会听到。 */
export const OFFLINE_AFTER = 10 * MINUTE;

export function deadlines(view: View, now: number) {
  const due: Record<string, Row> = {};
  const add = (kind: string, key: string, at: number) => {
    due[`${kind}:${key}`] = { kind, key, at };
  };
  const scheduled = (rule: string) => configuration(view).rules.some((known) => known.name === rule && "cron" in known.when);
  for (const schedule of rows(view, "schedules")) {
    if (scheduled(schedule.rule)) add("cron", schedule.rule, Date.parse(schedule.next_at));
  }
  for (const timer of rows(view, "timers", { event_id: null })) {
    if (timer.event_id === null) add("later", String(timer.id), Date.parse(timer.at));
  }
  for (const run of rows(view, "runs", { state: "queued" })) {
    const notBefore = Date.parse(run.not_before);
    if (run.state === "queued" && notBefore > now) add("retry", String(run.id), notBefore);
  }
  for (const delivery of rows(view, "deliveries", { given_up: 0, not_before: { not: null } })) {
    const notBefore = Date.parse(delivery.not_before);
    if (!delivery.given_up && delivery.not_before && notBefore > now) {
      add("delivery", `${delivery.card_id}:${delivery.channel}`, notBefore);
    }
  }
  for (const worker of workers(view)) {
    const seen = view.get("seen", `worker:${worker}`);
    const waiting = waitingOn(view, worker, now);
    if (!waiting.length) continue;
    const offlineKey = `worker:${worker}:offline:${seen ? seen.seen_at : "never"}`;
    // 清扫严格在各时限之后做，所以多加一毫秒。
    if (!rows(view, "cards", { key: offlineKey, state: "open" }).length) {
      add("offline", worker, Math.max(now, Date.parse(seen?.seen_at ?? waiting[0].created_at) + OFFLINE_AFTER + 1));
    }
    if (!seen || now - Date.parse(seen.seen_at) > WORKER_FRESH) continue;
    for (const run of waiting.filter((run) => run.state === "claimed")) {
      const at = Math.max(now, Date.parse(run.seen_at) + RUN_LEASE + 1);
      if (at <= Date.parse(seen.seen_at) + WORKER_FRESH) add("lease", String(run.id), at);
    }
  }
  return due;
}
