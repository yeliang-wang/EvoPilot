import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("dashboard integration is documented as a standalone API client contract", () => {
  const integration = fs.readFileSync("docs/dashboard-integration.md", "utf8");
  const deployment = fs.readFileSync("docs/deployment.md", "utf8");
  const readme = fs.readFileSync("README.md", "utf8");

  assert.match(integration, /Dashboard UI\s+->\s+EvoPilot HTTP API\s+->\s+EvoPilot domain state/);
  assert.match(integration, /The Dashboard must not call the EvoPilot CLI/);
  assert.match(integration, /GET \/api\/v1\/release\/decisions/);
  assert.match(integration, /GET \/api\/v1\/goals\/\{goalId\}\/run-status/);
  assert.match(integration, /evopilot-dashboard/);
  assert.match(integration, /deploy\/nginx\/evopilot-dashboard\.conf\.example/);
  assert.match(deployment, /Dashboard 已拆分到独立仓库/);
  assert.match(deployment, /compose\.production\.yaml/);
  assert.match(deployment, /evopilot-server:19876/);
  assert.match(readme, /yeliang-wang\/evopilot-dashboard/);
  assert.doesNotMatch(readme, /apps\/dashboard\/\s+Deprecated/);
});
