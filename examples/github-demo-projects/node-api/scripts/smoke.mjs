import assert from "node:assert/strict";
import { createServer } from "../src/server.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
try {
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  assert.equal(health.status, "UP");
  const ready = await fetch(`http://127.0.0.1:${port}/ready`).then((response) => response.json());
  assert.equal(ready.status, "READY");
  console.log(JSON.stringify({ status: "PASS", checks: ["health", "ready"], port }));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
