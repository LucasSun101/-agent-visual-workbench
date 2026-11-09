// Node 的 HTTP 服务器，仅此而已：每个请求变成给内核的 web Request，每个回答再发回去。
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { makeHandler } from "./server.ts";

export function serve(port: number, host = "127.0.0.1", { commit = "dev" }: { commit?: string } = {}) {
  const runtime = makeHandler(commit);
  const server = createServer(async (req, res) => {
    const gone = new AbortController();
    res.on("close", () => gone.abort());
    try {
      const body = !["GET", "HEAD"].includes(req.method!) && {
        body: Readable.toWeb(req) as ReadableStream,
        duplex: "half",
      };
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: req.headers as HeadersInit,
        signal: gone.signal,
        ...body,
      });
      const answer = await runtime.handle(request);
      res.writeHead(answer.status, Object.fromEntries(answer.headers));
      if (!answer.body) return void res.end();
      Readable.fromWeb(answer.body as any)
        .on("error", () => res.destroy())
        .pipe(res);
    } catch (error) {
      console.error(error);
      if (res.headersSent) return void res.end();
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "中台出错了" }));
    }
  });
  server.on("close", runtime.close);
  server.listen({ port, host, backlog: 2048 });
  return server;
}
