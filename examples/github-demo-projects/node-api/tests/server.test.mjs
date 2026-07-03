import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

test("health, ready, and checkout endpoints return product evidence signals", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const health = await getJson(port, "/health");
    assert.equal(health.status, "UP");
    const ready = await getJson(port, "/ready");
    assert.equal(ready.status, "READY");
    const checkout = await getJson(port, "/api/checkout?slow=true");
    assert.equal(checkout.releaseRisk, "latency-budget");
    assert.equal(checkout.durationMs, 3420);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function getJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  assert.equal(response.status, 200);
  return response.json();
}
