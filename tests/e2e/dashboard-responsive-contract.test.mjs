import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const dashboardOpenApiContract = [
  ["get", "/api/v1/auth/bootstrap"],
  ["post", "/api/v1/auth/login"],
  ["post", "/api/v1/auth/change-password"],
  ["get", "/api/v1/summary"],
  ["get", "/api/v1/service-scorecards"],
  ["get", "/api/v1/projects"],
  ["post", "/api/v1/projects"],
  ["post", "/api/v1/projects/{projectId}/source-credentials"],
  ["get", "/api/v1/projects/{projectId}/source-credentials/preflight"],
  ["post", "/api/v1/projects/{projectId}/source-credentials/preflight"],
  ["get", "/api/v1/release/targets"],
  ["post", "/api/v1/release/targets"],
  ["get", "/api/v1/release/decisions"],
  ["post", "/api/v1/release/evidence"],
  ["get", "/api/v1/goals"],
  ["get", "/api/v1/goals/{goalId}/snapshot"],
  ["get", "/api/v1/loops"],
  ["post", "/api/v1/loops/{loopId}/start"],
  ["post", "/api/v1/loops/{loopId}/resume"],
  ["post", "/api/v1/loops/{loopId}/approve"],
  ["get", "/api/v1/loops/{loopId}/executor-graph"],
  ["get", "/api/v1/loops/{loopId}/trace-tree"],
  ["get", "/api/v1/loops/{loopId}/events"],
  ["post", "/api/v1/loops/{loopId}/sandbox-proof/verify"],
  ["get", "/api/v1/loops/{loopId}/source-closure/plan"],
  ["post", "/api/v1/loops/{loopId}/source-closure/preflight"],
  ["post", "/api/v1/loops/{loopId}/source-closure/execute"],
  ["post", "/api/v1/loops/{loopId}/source-closure/review-decision"],
  ["post", "/api/v1/loops/{loopId}/source-release-runs/{sourceReleaseRunId}/repair"],
  ["post", "/api/v1/loops/{loopId}/time-travel/replay"],
  ["post", "/api/v1/loops/watchdog"],
  ["get", "/api/v1/loop-store"],
  ["get", "/api/v1/loop-store/readiness"],
  ["get", "/api/v1/loop-observability"],
  ["get", "/api/v1/loop-orchestration/presets"],
  ["get", "/api/v1/loop-orchestration/targets"],
  ["post", "/api/v1/loop-orchestration/advance"],
  ["post", "/api/v1/loop-orchestration/autopilot"],
  ["post", "/api/v1/loop-orchestration/instantiate"],
  ["get", "/api/v1/loop-target-runtime/summary"],
  ["post", "/api/v1/loop-target-runtime/discovery/run"],
  ["post", "/api/v1/loop-target-runtime/adversarial-evaluations"],
  ["post", "/api/v1/loop-target-runtime/schedules"],
  ["post", "/api/v1/loop-target-runtime/guardrails/{loopId}/evaluate"],
  ["get", "/api/v1/loop-workers/queue"],
  ["post", "/api/v1/loop-workers/claim"],
  ["get", "/api/v1/source-release-runs"],
  ["get", "/api/v1/source-release-runs/repair-candidates"],
  ["post", "/api/v1/source-release-runs/repair-candidates/repair"],
  ["get", "/api/v1/source-release-deploy-finalizers"],
  ["get", "/api/v1/history"],
  ["get", "/api/v1/tenants"],
  ["post", "/api/v1/tenants"],
  ["get", "/api/v1/workspaces"],
  ["post", "/api/v1/workspaces"],
  ["get", "/api/v1/workspaces/{workspaceId}/usage"],
  ["get", "/api/v1/users"],
  ["post", "/api/v1/users"],
  ["patch", "/api/v1/users/{userId}"],
  ["post", "/api/v1/users/{userId}/reset-password"],
  ["get", "/api/v1/secrets"],
  ["post", "/api/v1/secrets"],
  ["get", "/api/v1/github-app/installations"],
  ["post", "/api/v1/github-app/installations"],
  ["get", "/api/v1/saas/observability"],
  ["get", "/api/v1/connectors/deploy"],
  ["post", "/api/v1/connectors/deploy"],
  ["get", "/api/v1/pipelines"],
  ["get", "/api/v1/code-upgrade-runs"],
  ["get", "/api/v1/code-upgrade-runs/{codeUpgradeRunId}/events"],
  ["post", "/api/v1/reviews/{reviewId}/decision"],
  ["post", "/api/v1/deliveries/{deliveryId}/code-upgrade"],
  ["post", "/api/v1/deliveries/{deliveryId}/schedule"],
  ["post", "/api/v1/deliveries/{deliveryId}/execute"],
  ["get", "/api/v1/evaluation-datasets"],
  ["post", "/api/v1/evidence/events"],
  ["post", "/api/v1/opportunity-drafts"],
  ["get", "/api/v1/rules"]
];

function normalizePath(value) {
  return value.replace(/\{[^}]+\}/g, "{}");
}

function openApiHasOperation(openapi, method, targetPath) {
  const normalizedTarget = normalizePath(targetPath);
  return Object.entries(openapi.paths ?? {}).some(([documentedPath, operations]) => {
    return normalizePath(documentedPath) === normalizedTarget && Boolean(operations[method]);
  });
}

test("dashboard integration is documented as a standalone API client contract", () => {
  const integration = fs.readFileSync("docs/guides/dashboard-integration.md", "utf8");
  const deployment = fs.readFileSync("docs/operations/deployment.md", "utf8");
  const readme = fs.readFileSync("README.md", "utf8");

  assert.match(integration, /Dashboard UI\s+->\s+EvoPilot HTTP API\s+->\s+EvoPilot domain state/);
  assert.match(integration, /The Dashboard must not call the EvoPilot CLI/);
  assert.match(integration, /GET \/api\/v1\/release\/decisions/);
  assert.match(integration, /GET \/api\/v1\/goals\/\{goalId\}\/run-status/);
  assert.match(integration, /evopilot-dashboard/);
  assert.match(integration, /\.\.\/evopilot-dashboard\/docs\/README\.md/);
  assert.match(integration, /deploy\/nginx\/evopilot-dashboard\.conf\.example/);
  assert.match(deployment, /Dashboard 已拆分到独立仓库/);
  assert.match(deployment, /Dashboard 仓库 `docs\/`/);
  assert.match(deployment, /compose\.production\.yaml/);
  assert.match(deployment, /evopilot-server:19876/);
  assert.match(readme, /yeliang-wang\/evopilot-dashboard/);
  assert.doesNotMatch(readme, /apps\/dashboard\/\s+Deprecated/);
});

test("dashboard page-operation docs are owned by the standalone dashboard repository when present", () => {
  const dashboardDocs = path.resolve("..", "evopilot-dashboard", "docs", "README.md");
  if (!fs.existsSync(dashboardDocs)) return;

  const docsIndex = fs.readFileSync("docs/README.md", "utf8");
  const userGuide = fs.readFileSync("docs/guides/user-guide.md", "utf8");
  const dashboardDocsIndex = fs.readFileSync(dashboardDocs, "utf8");
  const dashboardAiDocs = fs.readFileSync(path.resolve("..", "evopilot-dashboard", "docs", "ai-agents", "README.md"), "utf8");

  assert.match(docsIndex, /Dashboard UI operation docs live in `yeliang-wang\/evopilot-dashboard`/);
  assert.match(userGuide, /Dashboard operation docs/);
  assert.match(userGuide, /Control Plane Model/);
  assert.doesNotMatch(userGuide, /进入 Dashboard 的“接入项目”/);
  assert.match(dashboardDocsIndex, /Dashboard docs describe UI operations/);
  assert.match(dashboardAiDocs, /WorkBuddy/);
});

test("openapi covers the standalone dashboard operating surface", () => {
  const openapi = JSON.parse(fs.readFileSync("docs/api/openapi.json", "utf8"));
  const missing = dashboardOpenApiContract
    .filter(([method, endpoint]) => !openApiHasOperation(openapi, method, endpoint))
    .map(([method, endpoint]) => `${method.toUpperCase()} ${endpoint}`);

  assert.deepEqual(missing, []);
});

test("local standalone dashboard call sites are covered by openapi when available", () => {
  const dashboardApp = path.resolve("..", "evopilot-dashboard", "assets", "app.js");
  if (!fs.existsSync(dashboardApp)) return;

  const openapi = JSON.parse(fs.readFileSync("docs/api/openapi.json", "utf8"));
  const app = fs.readFileSync(dashboardApp, "utf8");
  const endpoints = new Set();
  const callPatterns = [
    /apiFetch\(\s*([`'"])([\s\S]*?)\1/g,
    /postJson\(\s*([`'"])([\s\S]*?)\1/g,
    /patchJson\(\s*([`'"])([\s\S]*?)\1/g,
    /fetch\(\s*apiUrl\(\s*([`'"])([\s\S]*?)\1\s*\)/g
  ];

  for (const pattern of callPatterns) {
    let match;
    while ((match = pattern.exec(app))) {
      const endpoint = match[2]
        .replace(/\$\{encodeURIComponent\([^)]*\)\}/g, "{id}")
        .replace(/\$\{[^}]+\}/g, "{id}")
        .replace(/\?.*$/, "");
      if (endpoint.startsWith("/api/v1/")) endpoints.add(endpoint);
    }
  }

  const documented = Object.keys(openapi.paths ?? {}).map(normalizePath);
  const missing = [...endpoints]
    .filter((endpoint) => !documented.includes(normalizePath(endpoint)))
    .sort();

  assert.deepEqual(missing, []);
});
