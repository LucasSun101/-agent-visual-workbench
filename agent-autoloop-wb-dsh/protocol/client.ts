// 从外面看的中台：接单程序、通道或命令行怎么够到它。这里没有比一个 HTTP 请求更多的东西——
// 这整段就是接入中台的全部所需。
export class HubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function hubClient(url: string, key: string) {
  const base = url.replace(/\/$/, "");
  async function call(
    method: string,
    path: string,
    { token = key, body, timeout = 30 }: { token?: string; body?: unknown; timeout?: number } = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { "content-type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout * 1000),
    });
    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (!response.ok) throw new HubError(response.status, data?.error ?? `中台返回 ${response.status}`);
    return data;
  }
  return {
    // 接单程序的门。
    work({ claim, wait, running, capacity }: { claim: string; wait: number; running: number[]; capacity: boolean }) {
      const query = { claim, wait: String(wait), running: running.join(","), capacity: capacity ? "1" : "0" };
      return call("GET", `/v1/work?${new URLSearchParams(query)}`, { timeout: wait + 30 });
    },
    started: (run: number, token: string, body: { session?: string; link?: string }) =>
      call("POST", `/v1/runs/${run}/started`, { token, body }),
    result: (run: number, token: string, body: unknown) => call("POST", `/v1/runs/${run}/result`, { token, body }),
    // 通道的门。
    nextCard: (wait: number) => call("GET", `/v1/cards/next?wait=${wait}`, { timeout: wait + 30 }),
    delivered: (card: number, version: number, ref: string | null) =>
      call("POST", `/v1/cards/${card}/delivered`, { body: { version, ref } }),
    failed: (card: number, version: number, error: string) =>
      call("POST", `/v1/cards/${card}/failed`, { body: { version, error } }),
    answer: (card: number, body: { choice?: number; text?: string; by?: string; ref?: string }) =>
      call("POST", `/v1/cards/${card}/answer`, { body }),
    // 来源、本人和别处的任务。
    event: (body: unknown) => call("POST", "/v1/events", { body }),
    tell: (body: unknown) => call("POST", "/v1/tell", { body }),
    why: (id: number) => call("GET", `/v1/runs/${id}/why`),
    removeKey: (kind: string, name: string) =>
      call("DELETE", `/v1/keys/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`),
    state: (before?: number) => call("GET", before === undefined ? "/v1/state" : `/v1/state?before=${before}`),
    cancel: (run: number) => call("POST", `/v1/runs/${run}/cancel`, { body: {} }),
    resolve: (card: number, reason: string) => call("POST", `/v1/cards/${card}/resolve`, { body: { reason } }),
  };
}
export type Hub = ReturnType<typeof hubClient>;
