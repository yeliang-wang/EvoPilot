import assert from "node:assert/strict";
import { createServer } from "../src/server.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
try {
  const checkout = await fetch(`http://127.0.0.1:${port}/api/checkout?slow=true`).then((response) => response.json());
  assert.equal(checkout.status, "ACCEPTED");
  assert.equal(checkout.releaseRisk, "latency-budget");
  console.log(JSON.stringify({
    status: "PASS",
    evidence: "checkout latency risk is observable",
    durationMs: checkout.durationMs
  }));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
