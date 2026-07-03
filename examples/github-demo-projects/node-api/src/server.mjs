import http from "node:http";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? process.argv.find((arg) => arg.startsWith("--port="))?.split("=")[1] ?? 49318);

export function createServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    if (url.pathname === "/health") return json(response, 200, { status: "UP", service: "evopilot-demo-node-api" });
    if (url.pathname === "/ready") return json(response, 200, { status: "READY" });
    if (url.pathname === "/api/checkout") {
      const slow = url.searchParams.get("slow") === "true";
      return json(response, 200, {
        orderId: "demo-order-001",
        status: "ACCEPTED",
        durationMs: slow ? 3420 : 128,
        releaseRisk: slow ? "latency-budget" : "none"
      });
    }
    return json(response, 404, { error: "NOT_FOUND" });
  });
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(port, host, () => {
    console.log(`evopilot-demo-node-api listening on http://${host}:${port}`);
  });
}
