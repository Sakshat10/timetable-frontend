#!/usr/bin/env node
/**
 * A minimal trusted reverse proxy standing in for nginx / a load balancer in front of Next.js (T5 only).
 * Usage: node e2e/real/front-proxy.mjs <listenPort> <upstreamPort> <overwrite|append>
 *   overwrite: X-Forwarded-For = socket address          (nginx: proxy_set_header X-Forwarded-For $remote_addr)
 *   append:    X-Forwarded-For = <incoming>, <socket>     (nginx: $proxy_add_x_forwarded_for)
 */
import http from "node:http";

const [listenPort, upstreamPort, mode] = process.argv.slice(2);
if (!listenPort || !upstreamPort || !["overwrite", "append"].includes(mode ?? "")) {
  console.error("usage: front-proxy.mjs <listenPort> <upstreamPort> <overwrite|append>");
  process.exit(2);
}

http
  .createServer((req, res) => {
    const client = req.socket.remoteAddress ?? "";
    const headers = { ...req.headers };
    if (mode === "overwrite") headers["x-forwarded-for"] = client;
    else headers["x-forwarded-for"] = headers["x-forwarded-for"] ? `${headers["x-forwarded-for"]}, ${client}` : client;
    const upstream = http.request({ host: "127.0.0.1", port: Number(upstreamPort), method: req.method, path: req.url, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  })
  .listen(Number(listenPort), "::");
