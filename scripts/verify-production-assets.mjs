import assert from "node:assert/strict";
import fs from "node:fs";

const requiredFiles = [
  "Dockerfile",
  "docker-compose.yml",
  ".env.example",
  ".github/workflows/ci.yml",
  "deploy/k8s/deployment.yaml",
  "deploy/k8s/service.yaml",
  "deploy/k8s/pvc.yaml",
  "deploy/k8s/code-upgrader-deployment.yaml",
  "deploy/k8s/code-upgrader-service.yaml",
  "deploy/k8s/secret.example.yaml",
  "docs/openapi.json",
  "docs/evidence-ingestion.md",
  "docs/user-guide.md",
  "docs/production-user-e2e.md",
  "docs/runtime-management.md",
  "docs/architecture/loop-runtime.md",
  "scripts/loop-worker.mjs",
  "scripts/loop-soak.mjs",
  "scripts/verify-runtime-lock.mjs",
  "runtimes/runtime-lock.json"
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(file), `${file} is required`);
}

const openapi = JSON.parse(fs.readFileSync("docs/openapi.json", "utf8"));
assert.equal(openapi.openapi, "3.1.0");
assert.ok(openapi.paths["/api/v1/runs"]);
assert.ok(openapi.paths["/api/v1/evidence/events"]);
assert.ok(openapi.paths["/api/v1/evidence/otlp/v1/traces"]);
assert.ok(openapi.paths["/api/v1/evidence/skywalking"]);
assert.ok(openapi.paths["/api/v1/soak-reports"]);
assert.ok(openapi.paths["/api/v1/release/targets"]);
assert.ok(openapi.paths["/api/v1/release/targets/{targetId}"]);
assert.ok(openapi.paths["/api/v1/release/decisions"]);
assert.ok(openapi.paths["/api/v1/release/evidence"]);
assert.ok(openapi.paths["/api/v1/release/evidence/{evidenceId}"]);
assert.ok(openapi.paths["/api/v1/executor-graphs"]);
assert.ok(openapi.paths["/api/v1/executor-graphs/{graphId}"]);
assert.ok(openapi.paths["/api/v1/loops"]);
assert.ok(openapi.paths["/api/v1/loops/{loopId}"]);
assert.ok(openapi.paths["/api/v1/loops/{loopId}/start"]);
assert.ok(openapi.paths["/api/v1/loops/{loopId}/resume"]);
assert.ok(openapi.paths["/api/v1/loops/{loopId}/replay"]);
assert.ok(openapi.paths["/api/v1/loops/{loopId}/approve"]);
assert.ok(openapi.paths["/api/v1/loops/{loopId}/cancel"]);
assert.ok(openapi.paths["/api/v1/loops/{loopId}/timeline"]);
assert.ok(openapi.paths["/api/v1/loops/{loopId}/evidence"]);
assert.ok(openapi.paths["/api/v1/loops/{loopId}/artifacts"]);
assert.ok(openapi.paths["/api/v1/loops/{loopId}/trace"]);
assert.ok(openapi.paths["/api/v1/loop-store"]);
assert.ok(openapi.paths["/api/v1/loop-observability"]);
assert.ok(openapi.paths["/api/v1/loop-workers/heartbeat"]);
assert.ok(openapi.paths["/api/v1/loop-workers/leases"]);
assert.ok(openapi.paths["/api/v1/loops/watchdog"]);
assert.ok(openapi.paths["/api/v1/im/feishu/webhook"]);
assert.ok(openapi.paths["/api/v1/im/wecom/webhook"]);
assert.ok(openapi.paths["/api/v1/target-loops"]);
assert.ok(openapi.paths["/api/v1/target-loops/{loopId}"]);
assert.ok(openapi.paths["/api/v1/target-loops/{loopId}/approve-plan"]);
assert.ok(openapi.paths["/api/v1/target-loops/{loopId}/resume"]);
assert.ok(openapi.paths["/api/v1/target-loops/{loopId}/final-report"]);
assert.ok(openapi.paths["/api/v1/target-loops/{loopId}/release-actions/{action}/approve"]);
assert.ok(openapi.paths["/api/v1/target-loops/{loopId}/release-actions/{action}/execute"]);
assert.ok(openapi.paths["/api/v1/target-loops/{loopId}/route-remediation"]);
assert.ok(openapi.paths["/api/v1/conversations/commands"]);
assert.ok(openapi.components.securitySchemes.bearerAuth);

const deployment = fs.readFileSync("deploy/k8s/deployment.yaml", "utf8");
assert.match(deployment, /readinessProbe/);
assert.match(deployment, /livenessProbe/);
assert.match(deployment, /persistentVolumeClaim/);

const deploymentDoc = fs.readFileSync("docs/deployment.md", "utf8");
assert.match(deploymentDoc, /生产日志/);
assert.match(deploymentDoc, /http\.request\.completed/);
assert.match(deploymentDoc, /code-upgrade\.status-changed/);
assert.match(deploymentDoc, /EVOPILOT_LOG_LEVEL/);
assert.match(deploymentDoc, /Bearer token 做脱敏/);

const envExample = fs.readFileSync(".env.example", "utf8");
assert.match(envExample, /EVOPILOT_LOG_LEVEL=info/);
assert.match(envExample, /EVOPILOT_LOG_STACK=true/);

const productionE2e = fs.readFileSync("docs/production-user-e2e.md", "utf8");
assert.match(productionE2e, /代码升级执行器必须调用真实 LLM/);
assert.match(productionE2e, /只有代码升级成功后才能触发 CI\/CD/);

const runtime = fs.readFileSync("docs/runtime-management.md", "utf8");
assert.match(runtime, /运行时锁定/);
assert.match(runtime, /verify:runtime-lock:strict/);

const apiDoc = fs.readFileSync("docs/api-reference.md", "utf8");
assert.match(apiDoc, /Loop Runtime/);
assert.match(apiDoc, /ExecutorGraph/);
assert.match(apiDoc, /loop-workers\/heartbeat/);
assert.match(apiDoc, /loop-worker/);
assert.match(apiDoc, /im\/feishu\/webhook/);
assert.match(apiDoc, /ProofOps Target Loop Mode/);
assert.match(apiDoc, /proofops-final-release-report\/v1/);
assert.match(apiDoc, /conversations\/commands/);

const loopRuntimeDoc = fs.readFileSync("docs/architecture/loop-runtime.md", "utf8");
assert.match(loopRuntimeDoc, /Loop Engineering/);
assert.match(loopRuntimeDoc, /worker heartbeat leases/);
assert.match(loopRuntimeDoc, /loop-workspaces/);
assert.match(loopRuntimeDoc, /npm run loop-runtime:check/);

const dashboardApp = fs.readFileSync("apps/dashboard/assets/app.js", "utf8");
assert.match(dashboardApp, /Loop Runtime/);
assert.match(dashboardApp, /\/api\/v1\/loops/);

const lock = JSON.parse(fs.readFileSync("runtimes/runtime-lock.json", "utf8"));
assert.equal(lock.schemaVersion, 1);
assert.ok(lock.runtimes.some((item) => item.implementation === "OpenHands"));
assert.ok(!lock.runtimes.some((item) => item.implementation === "Jenkins"), "Jenkins must remain an external CI/CD connector, not an EvoPilot managed runtime");

console.log("production assets verified");
