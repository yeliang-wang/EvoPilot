import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createServer } from "../../packages/server/dist/index.js";

test("dashboard assets exist and server health is UP", async () => {
  for (const file of ["apps/dashboard/index.html", "apps/dashboard/assets/app.js", "apps/dashboard/assets/styles.css"]) {
    assert.ok(fs.existsSync(file), `${file} should exist`);
  }

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-smoke-"));
  const server = createServer({ dataRoot, runtimeMode: "debug" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "UP");
    assert.equal(body.service, "evopilot");
    const ready = await (await fetch(`${baseUrl}/ready`)).json();
    assert.equal(ready.status, "READY");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("metrics endpoint and request body limit are enforced", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-metrics-"));
  const server = createServer({ dataRoot, apiToken: "token", maxBodyBytes: 20, runtimeMode: "debug" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const metrics = await fetch(`${baseUrl}/api/v1/metrics`, {
      headers: { authorization: "Bearer token" }
    });
    assert.equal(metrics.status, 200);
    const metricsText = await metrics.text();
    assert.match(metricsText, /evopilot_projects_total/);
    assert.match(metricsText, /evopilot_slo_health/);
    assert.match(metricsText, /evopilot_cost_health/);
    assert.match(metricsText, /evopilot_supply_chain_risks_total/);
    assert.match(metricsText, /evopilot_release_readiness_score/);
    assert.match(metricsText, /evopilot_release_blocked_total/);

    const oversized = await fetch(`${baseUrl}/api/v1/runs`, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(100) })
    });
    assert.equal(oversized.status, 500);
    assert.match(await oversized.text(), /超过 20 字节/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("server emits production-grade structured logs with request ids and redaction", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-logs-"));
  const previousLog = console.log;
  const previousError = console.error;
  const stdout = [];
  const stderr = [];
  console.log = (line) => stdout.push(String(line));
  console.error = (line) => stderr.push(String(line));
  const server = createServer({ dataRoot, apiToken: "secret-token", runtimeMode: "debug" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(`${baseUrl}/health?token=should-not-leak`, {
      headers: { "x-request-id": "req-health-log", authorization: "Bearer secret-token" }
    });
    assert.equal(health.status, 200);
    const summary = await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { "x-request-id": "req-summary-log", authorization: "Bearer secret-token" }
    });
    assert.equal(summary.status, 200);
    const unauthorized = await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { "x-request-id": "req-unauthorized-log", authorization: "Bearer wrong-secret" }
    });
    assert.equal(unauthorized.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log = previousLog;
    console.error = previousError;
  }
  const records = stdout.map((line) => JSON.parse(line));
  assert.ok(records.every((record) => record.schema === "evopilot-log/v1"));
  assert.ok(records.some((record) => record.event === "server.configured" && record.version === "1.0.0" && record.severity === "INFO" && record.category === "runtime"));
  const healthLog = records.find((record) => record.event === "http.request.completed" && record.requestId === "req-health-log");
  assert.equal(healthLog.statusCode, 200);
  assert.equal(healthLog.category, "http");
  assert.equal(healthLog.routeGroup, "platform-readiness");
  assert.equal(healthLog.outcome, "success");
  assert.equal(healthLog.correlation.requestId, "req-health-log");
  assert.ok(healthLog.latencyBucket);
  const summaryLog = records.find((record) => record.event === "http.request.completed" && record.requestId === "req-summary-log");
  assert.equal(summaryLog.statusCode, 200);
  assert.equal(summaryLog.tenantId, "tenant-production");
  assert.equal(summaryLog.workspaceId, "workspace-agent-products");
  assert.equal(summaryLog.role, "admin");
  const rejectedLog = records.find((record) => record.event === "http.request.rejected" && record.requestId === "req-unauthorized-log");
  assert.equal(rejectedLog.statusCode, 401);
  assert.equal(rejectedLog.outcome, "rejected");
  assert.equal(rejectedLog.diagnosis.humanActionRequired, true);
  assert.match(rejectedLog.diagnosis.recommendedAction, /Authorization: Bearer \[REDACTED\]/);
  const unauthorizedCompletion = records.find((record) => record.event === "http.request.completed" && record.requestId === "req-unauthorized-log");
  assert.equal(unauthorizedCompletion.statusCode, 401);
  assert.equal(unauthorizedCompletion.diagnosis.likelyCause, "Missing, expired, or invalid EvoPilot API token.");
  assert.equal(stderr.length, 0);
  const allLogs = stdout.join("\n");
  assert.doesNotMatch(allLogs, /secret-token/);
  assert.doesNotMatch(allLogs, /should-not-leak/);
  assert.match(allLogs, /\[REDACTED\]/);
});

test("dashboard login exchanges username and password for scoped session token", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-login-"));
  const server = createServer({
    dataRoot,
    apiToken: "legacy-admin-token",
    users: [
      {
        username: "tenant-admin",
        password: "tenant-password",
        role: "admin",
        tenantId: "tenant-production",
        workspaceId: "workspace-agent-products",
        displayName: "Tenant Admin"
      },
      {
        username: "auditor",
        password: "viewer-password",
        role: "viewer",
        tenantId: "tenant-production",
        workspaceId: "workspace-agent-products",
        displayName: "Audit Viewer"
      }
    ],
    runtimeMode: "debug"
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const failed = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "tenant-admin", password: "wrong" })
    });
    assert.equal(failed.status, 401);
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "tenant-admin", password: "tenant-password" })
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json();
    assert.equal(loginBody.data.user.username, "tenant-admin");
    assert.equal(loginBody.data.user.role, "admin");
    assert.equal(loginBody.data.user.tenantId, "tenant-production");
    assert.equal(loginBody.data.user.workspaceId, "workspace-agent-products");
    assert.equal(loginBody.data.user.password, undefined);
    assert.equal(loginBody.data.user.token, undefined);
    assert.ok(loginBody.data.token);
    const summary = await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    assert.equal(summary.status, 200);

    const createdUser = await fetch(`${baseUrl}/api/v1/users`, {
      method: "POST",
      headers: { authorization: `Bearer ${loginBody.data.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        username: "runtime-user",
        password: "runtime-password",
        role: "viewer",
        tenantId: "tenant-production",
        workspaceId: "workspace-agent-products"
      })
    });
    assert.equal(createdUser.status, 201);
    const runtimeLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "runtime-user", password: "runtime-password" })
    });
    assert.equal(runtimeLogin.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("bootstrap admin, password change, and tenant user management are enforced", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-users-"));
  const server = createServer({ dataRoot, runtimeMode: "debug" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const bootstrap = await (await fetch(`${baseUrl}/api/v1/auth/bootstrap`)).json();
    assert.equal(bootstrap.data.initialized, true);
    assert.equal(bootstrap.data.defaultAdminRequiresPasswordChange, true);

    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json();
    assert.equal(loginBody.data.user.username, "admin");
    assert.equal(loginBody.data.user.platformAdmin, true);
    assert.equal(loginBody.data.user.mustChangePassword, true);
    const adminToken = loginBody.data.token;

    const rejectedDefaultPassword = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "admin", newPassword: "admin" })
    });
    assert.equal(rejectedDefaultPassword.status, 400);

    const changed = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "admin", newPassword: "admin-1234" })
    });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).data.mustChangePassword, false);

    const relogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-1234" })
    });
    assert.equal(relogin.status, 200);
    const activeAdminToken = (await relogin.json()).data.token;

    const tenant = await fetch(`${baseUrl}/api/v1/tenants`, {
      method: "POST",
      headers: { authorization: `Bearer ${activeAdminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ id: "tenant-acme", name: "Acme" })
    });
    assert.equal(tenant.status, 201);

    const workspace = await fetch(`${baseUrl}/api/v1/workspaces`, {
      method: "POST",
      headers: { authorization: `Bearer ${activeAdminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ id: "workspace-acme", tenantId: "tenant-acme", name: "Acme Workspace" })
    });
    assert.equal(workspace.status, 201);

    const tenantAdmin = await fetch(`${baseUrl}/api/v1/users`, {
      method: "POST",
      headers: { authorization: `Bearer ${activeAdminToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        username: "tenant-admin",
        password: "tenant-pass",
        displayName: "Tenant Admin",
        role: "admin",
        tenantId: "tenant-acme",
        workspaceId: "workspace-acme",
        platformAdmin: false
      })
    });
    assert.equal(tenantAdmin.status, 201);
    const tenantAdminBody = await tenantAdmin.json();
    assert.equal(tenantAdminBody.data.platformAdmin, false);
    assert.equal(tenantAdminBody.data.passwordHash, undefined);

    const tenantAdminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "tenant-admin", password: "tenant-pass" })
    });
    assert.equal(tenantAdminLogin.status, 200);
    const tenantToken = (await tenantAdminLogin.json()).data.token;

    const blockedTenantCreate = await fetch(`${baseUrl}/api/v1/tenants`, {
      method: "POST",
      headers: { authorization: `Bearer ${tenantToken}`, "content-type": "application/json" },
      body: JSON.stringify({ id: "tenant-other", name: "Other" })
    });
    assert.equal(blockedTenantCreate.status, 403);

    const tenantUsers = await fetch(`${baseUrl}/api/v1/users`, {
      headers: { authorization: `Bearer ${tenantToken}` }
    });
    assert.equal(tenantUsers.status, 200);
    const tenantUsersBody = await tenantUsers.json();
    assert.ok(tenantUsersBody.data.every((user) => user.tenantId === "tenant-acme" || user.platformAdmin));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("server serves dashboard static files", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-dashboard-"));
  const dashboardRoot = path.resolve("apps/dashboard");
  const server = createServer({ dataRoot, dashboardRoot, runtimeMode: "debug" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /EvoPilot 控制台/);
    const app = await (await fetch(`${baseUrl}/assets/app.js`)).text();
    assert.match(app, /首页/);
    assert.match(app, /接入项目/);
    assert.match(app, /进化观测图/);
    assert.match(app, /项目拓扑/);
    assert.match(app, /已接入/);
    assert.match(app, /OpenTelemetry/);
    assert.match(app, /SkyWalking/);
    assert.match(app, /用户反馈/);
    assert.match(app, /证据策略/);
    assert.match(app, /评测集/);
    assert.match(app, /机会点/);
    assert.match(app, /流水线/);
    assert.match(app, /历史记录/);
    assert.match(app, /CI\/CD 阶段视图/);
    assert.match(app, /触发来源/);
    assert.match(app, /触发时间/);
    assert.match(app, /证据摘要/);
    assert.match(app, /置信度/);
    assert.match(app, /归因/);
    assert.match(app, /治理等级/);
    assert.match(app, /自学习沉淀/);
    assert.match(app, /智能机会洞察/);
    assert.match(app, /智能沉淀/);
    assert.match(app, /学习方式/);
    assert.match(app, /成熟度/);
    assert.match(app, /平均服务分/);
    assert.match(app, /service-scorecards/);
    assert.match(app, /SLO健康/);
    assert.match(app, /错误预算/);
    assert.match(app, /失败策略/);
    assert.match(app, /供应链风险/);
    assert.match(app, /运行时就绪/);
    assert.match(app, /成本健康/);
    assert.match(app, /冻结项目/);
    assert.match(app, /成本优化待执行/);
    assert.match(app, /成本优化/);
    assert.match(app, /发布就绪/);
    assert.match(app, /发布阻断/);
    assert.match(app, /发布证据包/);
    assert.match(app, /GA目标/);
    assert.match(app, /发布结论/);
    assert.match(app, /灰度就绪/);
    assert.match(app, /灰度阻断/);
    assert.match(app, /supplyChainRiskCount/);
    assert.match(app, /runtimeReadyCount/);
    assert.match(app, /costHealth/);
    assert.match(app, /frozenProjectCount/);
    assert.match(app, /costOptimizationReadyCount/);
    assert.match(app, /releaseReadinessScore/);
    assert.match(app, /releaseEvidenceCount/);
    assert.match(app, /releaseTargetCount/);
    assert.match(app, /latestReleaseDecisionStatus/);
    assert.match(app, /canaryReadyCount/);
    assert.match(app, /rolloutBlockedCount/);
    assert.match(app, /查看方案/);
    assert.match(app, /关联评测集/);
    assert.match(app, /形成机会点/);
    assert.match(app, /编辑进化方案/);
    assert.match(app, /Markdown 方案正文/);
    assert.match(app, /提交方案修改/);
    assert.match(app, /代码升级过程/);
    assert.match(app, /根据方案进行代码升级/);
    assert.match(app, /白盒执行/);
    assert.match(app, /查看原始执行事件/);
    assert.match(app, /execution-transcript/);
    assert.match(app, /\/api\/v1\/code-upgrade-runs/);
    assert.match(app, /\/code-upgrade/);
    assert.match(app, /Codex target loop/);
    assert.match(app, /\/api\/v1\/loop-orchestration\/advance/);
    assert.match(app, /一键自动驾驶/);
    assert.match(app, /\/api\/v1\/loop-orchestration\/autopilot/);
    assert.match(app, /Worker Queue Workbench/);
    assert.match(app, /\/api\/v1\/loop-workers\/claim/);
    assert.match(app, /Context Time Travel Workbench/);
    assert.match(app, /\/time-travel\/replay/);
    assert.match(app, /Sandbox Boundary Workbench/);
    assert.match(app, /\/sandbox-proof\/verify/);
    assert.match(app, /Streaming Trace Workbench/);
    assert.match(app, /\/trace-tree/);
    assert.match(app, /Release Closure Runtime/);
    assert.match(app, /\/source-closure\/plan/);
    assert.match(app, /\/source-closure\/review-decision/);
    assert.match(app, /\/api\/v1\/source-release-runs/);
    assert.match(app, /Release Run Auto Repair Workbench/);
    assert.match(app, /\/api\/v1\/source-release-runs\/repair-candidates/);
    assert.match(app, /一键修复队列/);
    assert.match(app, /Deploy Finalizer Workbench/);
    assert.match(app, /\/api\/v1\/source-release-deploy-finalizers/);
    assert.match(app, /批准 Release/);
    assert.match(app, /合并 Release/);
    assert.match(app, /安全自动合并/);
    assert.match(app, /修复 Release Run/);
    assert.match(app, /\/source-release-runs\/\$\{encodeURIComponent\(runId\)\}\/repair/);
    assert.match(app, /Post Merge Deploy/);
    assert.doesNotMatch(app, /OpenHands 白盒执行/);
    assert.doesNotMatch(app, /Jenkins Stage View/);
    assert.doesNotMatch(app, /进化方案 Review/);
    assert.match(app, /确认进化/);
    assert.match(app, /验证并注册/);
    assert.match(app, /Git URL/);
    assert.match(app, /用户名/);
    assert.match(app, /密码/);
    assert.match(app, /Token 环境变量/);
    assert.match(app, /\/api\/v1\/projects/);
    assert.match(app, /\/api\/v1\/evaluation-datasets/);
    assert.match(app, /\/api\/v1\/opportunity-drafts/);
    assert.doesNotMatch(app, /PDF 下载/);
    assert.doesNotMatch(app, /方案详情/);
    assert.doesNotMatch(app, /const navItems = \["总览"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("evaluation datasets and opportunity draft endpoints support dashboard closed loop", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-eval-datasets-"));
  const llmCalls = [];
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    llmClient: {
      async generate(request) {
        llmCalls.push(request);
        if (request.intent === "structured.extraction") {
          return {
            requestId: request.requestId ?? "llm-rule",
            success: true,
            text: JSON.stringify({
              id: "chain-latency-under-3s",
              name: "链路延迟小于 3 秒",
              description: "由真实 LLM 链路编译出的性能触发规则。",
              userPrompt: "所有链路调用小于 3 秒",
              compiledBy: "llm",
              enabled: true,
              opportunityType: "performance-hotspot",
              title: "链路调用超过 3 秒，需要性能优化",
              affectedArea: "runtime-performance",
              suggestedDirection: "增加超时预算、适应度函数和性能回归门禁。",
              riskLevel: "MEDIUM",
              anyOf: [{ field: "attributes.durationMs", operator: ">", value: 3000 }],
              minMatchingEvents: 1
            }),
            provider: "mock-llm",
            model: "mock-model",
            durationMs: 9,
            usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
            resolvedIntent: request.intent,
            resolvedProfile: "json-extractor"
          };
        }
        return {
          requestId: request.requestId ?? "llm-smoke",
          success: true,
          text: "# LLM 生成的进化方案\n\n## 背景\n\n由评测集生成。",
          provider: "mock-llm",
          model: "mock-model",
          durationMs: 12,
          usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
          resolvedIntent: request.intent,
          resolvedProfile: "markdown-writer"
        };
      }
    },
    requireLlm: true,
    tokens: [
      { name: "viewer", token: "viewer-token", role: "viewer" },
      { name: "operator", token: "operator-token", role: "operator" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const datasets = await fetch(`${baseUrl}/api/v1/evaluation-datasets`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(datasets.status, 200);
    const datasetBody = await datasets.json();
    assert.ok(datasetBody.data.length >= 3);
    assert.ok(datasetBody.data.every((item) => item.id && item.projectId && item.sampleCount > 0));

    const draft = await fetch(`${baseUrl}/api/v1/opportunity-drafts`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        datasetIds: datasetBody.data.slice(0, 2).map((item) => item.id),
        title: "订单助手端到端响应体验优化",
        target: "端到端响应时间提升 5%"
      })
    });
    assert.equal(draft.status, 201);
    const draftBody = await draft.json();
    assert.match(draftBody.data.proposalMarkdown, /# LLM 生成的进化方案/);
    assert.equal(draftBody.data.datasetIds.length, 2);
    assert.equal(draftBody.data.llmTrace.mode, "llm");
    assert.equal(draftBody.data.llmTrace.provider, "mock-llm");

    const compiledRule = await fetch(`${baseUrl}/api/v1/rules/compile`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "domainforge-fabric",
        prompt: "所有链路调用小于 3 秒"
      })
    });
    assert.equal(compiledRule.status, 201);
    const ruleBody = await compiledRule.json();
    assert.equal(ruleBody.data.llmTrace.mode, "llm");
    assert.equal(ruleBody.data.llmTrace.provider, "mock-llm");
    const ruleMarkdown = fs.readFileSync(path.join(dataRoot, "rules", "chain-latency-under-3s.md"), "utf8");
    assert.match(ruleMarkdown, /LLM 编译/);
    assert.match(ruleMarkdown, /evopilot-llm-trace/);
    assert.ok(llmCalls.some((call) => call.intent === "structured.extraction"));
    assert.ok(llmCalls.some((call) => call.intent === "plan.generation"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("evolution batch scan productizes opportunity trigger orchestration", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-batches-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    allowSampleData: false,
    tokens: [
      { name: "viewer", token: "viewer-token", role: "viewer" },
      { name: "operator", token: "operator-token", role: "operator" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const run = await fetch(`${baseUrl}/api/v1/runs`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "domainforge-fabric",
        now: "2026-06-07T00:00:00.000Z",
        events: [
          {
            id: "batch-latency-1",
            type: "mcp.call",
            source: "observability",
            timestamp: "2026-06-07T00:00:00.000Z",
            severity: "HIGH",
            message: "链路 p95 超过 3 秒",
            module: "runtime-performance",
            attributes: { durationMs: 4100 }
          }
        ],
        files: ["src/runtime-performance.ts"]
      })
    });
    assert.equal(run.status, 201);

    const scan = await fetch(`${baseUrl}/api/v1/evolution-batches/scan`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "domainforge-fabric",
        maxBatchesPerProject: 1,
        maxDatasetsPerBatch: 3,
        cooldownMinutes: 30
      })
    });
    assert.equal(scan.status, 201);
    const scanBody = await scan.json();
    assert.equal(scanBody.data.created.length, 1);
    assert.equal(scanBody.data.created[0].status, "CANDIDATE");
    assert.equal(scanBody.data.created[0].projectId, "domainforge-fabric");
    assert.equal(scanBody.data.created[0].intent, "standard-evolution");
    assert.ok(scanBody.data.created[0].datasetIds.length >= 1);
    assert.match(scanBody.data.created[0].triggerReason, /新增/);

    const duplicateScan = await fetch(`${baseUrl}/api/v1/evolution-batches/scan`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({ projectId: "domainforge-fabric" })
    });
    assert.equal(duplicateScan.status, 200);
    const duplicateBody = await duplicateScan.json();
    assert.equal(duplicateBody.data.created.length, 0);
    assert.match(duplicateBody.data.skipped[0].reason, /活跃进化批次|冷却窗口|已被进化批次消费/);

    const batchId = scanBody.data.created[0].id;
    const status = await fetch(`${baseUrl}/api/v1/evolution-batches/${encodeURIComponent(batchId)}/status`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({ status: "SUCCEEDED", codeUpgradeRunId: "upgrade-1", pipelineRunId: "pipeline-1" })
    });
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.data.status, "SUCCEEDED");
    assert.equal(statusBody.data.codeUpgradeRunId, "upgrade-1");

    const summary = await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    const summaryBody = await summary.json();
    assert.equal(summaryBody.data.evolutionBatchCount, 1);
    assert.equal(summaryBody.data.successfulEvolutionBatchCount, 1);
    assert.equal(summaryBody.data.activeEvolutionBatchCount, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("evolution batch scan fails stale active batches and releases the project queue", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-stale-batch-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    allowSampleData: false,
    tokens: [
      { name: "viewer", token: "viewer-token", role: "viewer" },
      { name: "operator", token: "operator-token", role: "operator" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const run = await fetch(`${baseUrl}/api/v1/runs`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "domainforge-fabric",
        now: "2026-06-07T00:00:00.000Z",
        events: [
          {
            id: "stale-batch-latency-1",
            type: "mcp.call",
            source: "observability",
            timestamp: "2026-06-07T00:00:00.000Z",
            severity: "HIGH",
            message: "链路 p95 超过 3 秒",
            module: "runtime-performance",
            attributes: { durationMs: 4100 }
          }
        ],
        files: ["src/runtime-performance.ts"]
      })
    });
    assert.equal(run.status, 201);

    const scan = await fetch(`${baseUrl}/api/v1/evolution-batches/scan`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({ projectId: "domainforge-fabric", cooldownMinutes: 0 })
    });
    assert.equal(scan.status, 201);
    const scanBody = await scan.json();
    const batchId = scanBody.data.created[0].id;
    const batchFile = path.join(dataRoot, "evolution-batches", `${batchId}.json`);
    const batch = JSON.parse(fs.readFileSync(batchFile, "utf8"));
    fs.writeFileSync(batchFile, `${JSON.stringify({ ...batch, updatedAt: "2026-06-06T00:00:00.000Z" }, null, 2)}\n`);

    const staleScan = await fetch(`${baseUrl}/api/v1/evolution-batches/scan`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({ projectId: "domainforge-fabric", cooldownMinutes: 0, activeBatchTimeoutMinutes: 1 })
    });
    assert.equal(staleScan.status, 200);
    const staleBody = await staleScan.json();
    assert.match(staleBody.data.skipped[0].reason, /活跃进化批次超过 1 分钟未推进/);

    const failedBatch = await (await fetch(`${baseUrl}/api/v1/evolution-batches/${encodeURIComponent(batchId)}`, {
      headers: { authorization: "Bearer viewer-token" }
    })).json();
    assert.equal(failedBatch.data.status, "FAILED");
    assert.match(failedBatch.data.failureReason, /自动失败/);

    const summary = await (await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { authorization: "Bearer viewer-token" }
    })).json();
    assert.equal(summary.data.activeEvolutionBatchCount, 0);
    assert.equal(summary.data.failedEvolutionBatchCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("evolution trigger orchestration ignores normal evidence and invalid boolean rules", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-normal-trigger-"));
  fs.mkdirSync(path.join(dataRoot, "rules"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "rules", "bad-rag-rule.md"), [
    "# 非法 RAG 规则",
    "",
    "```json",
    JSON.stringify({
      id: "bad-rag-rule",
      projectId: "domainforge-fabric",
      name: "非法 RAG 规则",
      description: "布尔字段不能使用小于等于比较。",
      userPrompt: "RAG 命中率不能下降",
      compiledBy: "llm",
      enabled: true,
      opportunityType: "reliability-risk",
      title: "RAG 命中率下降",
      affectedArea: "rag",
      suggestedDirection: "优化 RAG。",
      riskLevel: "HIGH",
      anyOf: [{ field: "attributes.ragHit", operator: "<=", value: "false" }],
      minMatchingEvents: 1
    }, null, 2),
    "```",
    ""
  ].join("\n"), "utf8");
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    allowSampleData: false,
    tokens: [
      { name: "viewer", token: "viewer-token", role: "viewer" },
      { name: "operator", token: "operator-token", role: "operator" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const run = await fetch(`${baseUrl}/api/v1/runs`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "domainforge-fabric",
        now: "2026-06-07T00:00:00.000Z",
        events: [{
          id: "normal-rag-hit",
          type: "mcp.call",
          source: "mcp",
          timestamp: "2026-06-07T00:00:00.000Z",
          severity: "LOW",
          message: "正常链路，RAG 命中",
          attributes: { durationMs: 80, latencyMs: 80, ragHit: true }
        }]
      })
    });
    assert.equal(run.status, 201);
    const runBody = await run.json();
    assert.equal(runBody.data.opportunities.length, 0);

    const datasets = await fetch(`${baseUrl}/api/v1/evaluation-datasets`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    const datasetsBody = await datasets.json();
    assert.equal(datasets.status, 503);
    assert.equal(datasetsBody.error, "EVALUATION_DATASET_SOURCE_NOT_CONFIGURED");

    const scan = await fetch(`${baseUrl}/api/v1/evolution-batches/scan`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({ projectId: "domainforge-fabric" })
    });
    assert.equal(scan.status, 200);
    const scanBody = await scan.json();
    assert.equal(scanBody.data.created.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("compiled user rules are scoped to their registered project", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-rule-scope-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    llmClient: {
      async generate(request) {
        const projectId = request.metadata.projectId;
        return {
          requestId: request.requestId ?? `llm-${projectId}`,
          success: true,
          text: JSON.stringify({
            id: `${projectId}-latency-rule`,
            name: `${projectId} 链路延迟规则`,
            description: "项目级用户规则。",
            userPrompt: "所有链路调用小于 3 秒",
            compiledBy: "llm",
            enabled: true,
            opportunityType: "performance-hotspot",
            title: `${projectId} 链路性能超过 3 秒阈值`,
            affectedArea: "runtime-performance",
            suggestedDirection: "降低延迟并增加性能回归。",
            riskLevel: "MEDIUM",
            anyOf: [{ field: "attributes.durationMs", operator: ">", value: 3000 }],
            minMatchingEvents: 1
          }),
          provider: "mock-llm",
          model: "mock-model",
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          resolvedIntent: request.intent,
          resolvedProfile: "json-extractor"
        };
      }
    },
    requireLlm: true,
    tokens: [
      { name: "admin", token: "admin-token", role: "admin" },
      { name: "operator", token: "operator-token", role: "operator" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    for (const projectId of ["order-assistant-agent", "knowledge-cs-agent"]) {
      const repoRoot = createSmokeRepo(dataRoot, projectId);
      const registered = await fetch(`${baseUrl}/api/v1/projects`, {
        method: "POST",
        headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
        body: JSON.stringify({
          id: projectId,
          name: projectId,
          repository: {
            provider: "local-git",
            gitUrl: `file://${repoRoot}`,
            root: repoRoot
          }
        })
      });
      assert.equal(registered.status, 201);
      const compiled = await fetch(`${baseUrl}/api/v1/rules/compile`, {
        method: "POST",
        headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
        body: JSON.stringify({ projectId, prompt: "所有链路调用小于 3 秒" })
      });
      assert.equal(compiled.status, 201);
    }
    const run = await fetch(`${baseUrl}/api/v1/runs`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "order-assistant-agent",
        now: "2026-06-07T00:00:00.000Z",
        events: [{
          id: "scope-latency",
          type: "mcp.call",
          source: "observability",
          timestamp: "2026-06-07T00:00:00.000Z",
          severity: "HIGH",
          message: "订单链路超过 3 秒",
          attributes: { durationMs: 3600 }
        }],
        files: ["app.py"]
      })
    });
    assert.equal(run.status, 201);
    const runBody = await run.json();
    const triggeredRuleIds = runBody.data.opportunities.flatMap((opportunity) => opportunity.triggeredRuleIds ?? []);
    assert.ok(triggeredRuleIds.includes("order-assistant-agent-latency-rule"));
    assert.ok(!triggeredRuleIds.includes("knowledge-cs-agent-latency-rule"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function createSmokeRepo(root, name) {
  const repoRoot = path.join(root, name);
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "app.py"), "print('ok')\n");
  execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot, stdio: "ignore" });
  return repoRoot;
}

test("rule compiler asks LLM to repair semantically invalid output before storing", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-invalid-rule-"));
  const responses = [
    {
      id: "bad-cost-rule",
      name: "错误的成本规则",
      description: "错误地输出空成本阈值。",
      userPrompt: "单次调用成本异常时优化模型路由",
      compiledBy: "llm",
      enabled: true,
      opportunityType: "cost-risk",
      title: "成本异常",
      affectedArea: "model-routing",
      suggestedDirection: "优化模型路由。",
      riskLevel: "MEDIUM",
      anyOf: [
        { field: "attributes.costUsd", operator: ">", value: "" }
      ],
      minMatchingEvents: 1
    },
    {
      id: "cost-risk-over-budget",
      name: "成本超过预算触发优化",
      description: "单次调用成本超过预算时触发成本优化。",
      userPrompt: "单次调用成本异常时优化模型路由",
      compiledBy: "llm",
      enabled: true,
      opportunityType: "cost-risk",
      title: "成本超过预算",
      affectedArea: "model-routing",
      suggestedDirection: "优化模型选择、上下文压缩和缓存。",
      riskLevel: "HIGH",
      anyOf: [
        { field: "attributes.costUsd", operator: ">", value: 0.02 }
      ],
      minMatchingEvents: 1
    }
  ];
  let callCount = 0;
  const server = createServer({
    dataRoot,
    runtimeMode: "prod",
    requireLlm: true,
    llmClient: {
      async generate(request) {
        const body = responses[Math.min(callCount, responses.length - 1)];
        callCount += 1;
        return {
          requestId: request.requestId ?? `rule-${callCount}`,
          success: true,
          text: JSON.stringify(body),
          provider: "mock-llm",
          model: "mock-model",
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          resolvedIntent: request.intent,
          resolvedProfile: "json-extractor"
        };
      }
    },
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const compiledRule = await fetch(`${baseUrl}/api/v1/rules/compile`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "agent-a",
        prompt: "单次调用成本异常时优化模型路由"
      })
    });
    assert.equal(compiledRule.status, 201);
    const payload = await compiledRule.json();
    assert.equal(callCount, 2);
    assert.equal(payload.data.llmTrace.mode, "llm-repaired");
    assert.equal(payload.data.llmTrace.repairAttempts.length, 1);
    assert.equal(payload.data.llmTrace.repairAttempts[0].repaired, true);
    assert.equal(fs.existsSync(path.join(dataRoot, "rules", "bad-cost-rule.md")), false);
    const markdown = fs.readFileSync(path.join(dataRoot, "rules", "cost-risk-over-budget.md"), "utf8");
    assert.match(markdown, /"field": "attributes.costUsd"/);
    assert.match(markdown, /"value": 0.02/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rule compiler rejects invalid LLM output after repair attempts are exhausted", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-invalid-rule-final-"));
  let callCount = 0;
  const server = createServer({
    dataRoot,
    runtimeMode: "prod",
    requireLlm: true,
    llmClient: {
      async generate(request) {
        callCount += 1;
        return {
          requestId: request.requestId ?? `invalid-rule-${callCount}`,
          success: true,
          text: JSON.stringify({
            id: "bad-under-3s",
            name: "错误的小于三秒规则",
            description: "错误地把正常状态当成触发条件。",
            userPrompt: "所有链路调用小于 3 秒",
            compiledBy: "llm",
            enabled: true,
            opportunityType: "performance-hotspot",
            title: "错误规则",
            affectedArea: "runtime-performance",
            suggestedDirection: "错误方向",
            riskLevel: "MEDIUM",
            anyOf: [
              { field: "attributes.costUsd", operator: ">", value: "" }
            ],
            minMatchingEvents: 1
          }),
          provider: "mock-llm",
          model: "mock-model",
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          resolvedIntent: request.intent,
          resolvedProfile: "json-extractor"
        };
      }
    },
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const compiledRule = await fetch(`${baseUrl}/api/v1/rules/compile`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "agent-a",
        prompt: "所有链路调用小于 3 秒"
      })
    });
    assert.equal(compiledRule.status, 500);
    assert.equal(callCount, 3);
    assert.match(await compiledRule.text(), /attributes.costUsd 必须使用数值阈值/);
    assert.equal(fs.existsSync(path.join(dataRoot, "rules", "bad-under-3s.md")), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rule compiler applies production guardrails for empty latency threshold", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-empty-threshold-rule-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "prod",
    requireLlm: true,
    llmClient: {
      async generate(request) {
        return {
          requestId: request.requestId ?? "empty-threshold-rule",
          success: true,
          text: JSON.stringify({
            id: "chain-latency-empty-threshold",
            name: "链路耗时规则",
            description: "空阈值输出需要生产护栏规整。",
            userPrompt: "所有链路调用小于 3 秒",
            compiledBy: "llm",
            enabled: true,
            opportunityType: "performance-hotspot",
            title: "链路性能超过 3 秒阈值",
            affectedArea: "runtime-performance",
            suggestedDirection: "优化慢链路。",
            riskLevel: "HIGH",
            anyOf: [
              { field: "attributes.durationMs", operator: ">", value: "" }
            ],
            minMatchingEvents: 1
          }),
          provider: "mock-llm",
          model: "mock-model",
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          resolvedIntent: request.intent,
          resolvedProfile: "json-extractor"
        };
      }
    },
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const compiledRule = await fetch(`${baseUrl}/api/v1/rules/compile`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "agent-a",
        prompt: "所有链路调用小于 3 秒"
      })
    });
    assert.equal(compiledRule.status, 201);
    const markdown = fs.readFileSync(path.join(dataRoot, "rules", "chain-latency-empty-threshold.md"), "utf8");
    assert.match(markdown, /"field": "attributes.durationMs"/);
    assert.match(markdown, /"operator": ">"/);
    assert.match(markdown, /"value": 3000/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rule compiler normalizes Chinese boolean condition values", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-bool-rule-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "prod",
    requireLlm: true,
    llmClient: {
      async generate(request) {
        return {
          requestId: request.requestId ?? "bool-rule",
          success: true,
          text: JSON.stringify({
            id: "rag-miss-rule",
            name: "RAG 未命中规则",
            description: "RAG 未命中时触发可靠性演进。",
            userPrompt: "RAG 未命中时优化召回质量",
            compiledBy: "llm",
            enabled: true,
            opportunityType: "reliability-risk",
            title: "RAG 未命中",
            affectedArea: "rag-quality",
            suggestedDirection: "优化召回、重排和引用质量。",
            riskLevel: "HIGH",
            anyOf: [
              { field: "attributes.ragHit", operator: "==", value: "未命中" }
            ],
            minMatchingEvents: 1
          }),
          provider: "mock-llm",
          model: "mock-model",
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          resolvedIntent: request.intent,
          resolvedProfile: "json-extractor"
        };
      }
    },
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const compiledRule = await fetch(`${baseUrl}/api/v1/rules/compile`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "agent-a",
        prompt: "RAG 未命中时优化召回质量"
      })
    });
    assert.equal(compiledRule.status, 201);
    const markdown = fs.readFileSync(path.join(dataRoot, "rules", "rag-miss-rule.md"), "utf8");
    assert.match(markdown, /"field": "attributes.ragHit"/);
    assert.match(markdown, /"value": "false"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("evidence ingestion endpoints accept agent, OTLP, APM, eval and feedback signals", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-evidence-ingestion-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "viewer", token: "viewer-token", role: "viewer" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const unauthorized = await fetch(`${baseUrl}/api/v1/evidence/events`, { method: "POST" });
    assert.equal(unauthorized.status, 401);

    const agent = await evidencePost(`${baseUrl}/api/v1/evidence/events`, {
      projectId: "domainforge-fabric",
      events: [{ type: "agent.step", message: "链路慢", attributes: { durationMs: 3500 } }]
    });
    assert.equal(agent.data.ingestedEvents, 1);
    assert.ok(agent.data.run.opportunities.some((item) => item.type === "performance-hotspot"));

    const otlp = await evidencePost(`${baseUrl}/api/v1/evidence/otlp/v1/traces?projectId=domainforge-fabric`, {
      resourceSpans: [{
        resource: { attributes: [{ key: "service.name", value: { stringValue: "agent" } }] },
        scopeSpans: [{ spans: [{ traceId: "t1", spanId: "s1", name: "chat", startTimeUnixNano: "1780531200000000000", endTimeUnixNano: "1780531204000000000" }] }]
      }]
    });
    assert.equal(otlp.data.ingestSource, "otlp-traces");
    assert.equal(otlp.data.run.evidenceBundle.events[0].attributes.durationMs, 4000);

    const skywalking = await evidencePost(`${baseUrl}/api/v1/evidence/skywalking`, {
      projectId: "domainforge-fabric",
      spans: [{ traceId: "sw1", spanId: "s1", serviceName: "agent", endpointName: "/chat", latency: 3600 }]
    });
    assert.equal(skywalking.data.ingestSource, "skywalking");

    const evaluations = await evidencePost(`${baseUrl}/api/v1/evidence/evaluations`, {
      projectId: "domainforge-fabric",
      results: [{ suite: "regression", caseId: "latency", status: "FAILED", message: "性能回归" }]
    });
    assert.equal(evaluations.data.ingestSource, "evaluation-results");

    const feedback = await evidencePost(`${baseUrl}/api/v1/evidence/feedback`, {
      projectId: "domainforge-fabric",
      feedback: [{ rating: "negative", message: "响应太慢" }]
    });
    assert.equal(feedback.data.run.evidenceBundle.events[0].source, "user");

    const audit = await fetch(`${baseUrl}/api/v1/audit`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(audit.status, 200);
    assert.ok((await audit.json()).data.some((record) => record.action === "evidence.ingested"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("pipeline list endpoint is viewer protected and initially empty", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-pipeline-smoke-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "viewer", token: "viewer-token", role: "viewer" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const unauthorized = await fetch(`${baseUrl}/api/v1/pipelines`);
    assert.equal(unauthorized.status, 401);
    const pipelines = await fetch(`${baseUrl}/api/v1/pipelines`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(pipelines.status, 200);
    assert.deepEqual((await pipelines.json()).data, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("release evidence endpoint persists release candidate evidence without leaking secrets", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-release-evidence-"));
  const repoRoot = path.join(dataRoot, "connected-project");
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "package.json"), `${JSON.stringify({ name: "connected-project", scripts: { test: "node --version" } }, null, 2)}\n`);
  execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["add", "package.json"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], {
    cwd: repoRoot,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "EvoPilot Test",
      GIT_AUTHOR_EMAIL: "evopilot@example.test",
      GIT_COMMITTER_NAME: "EvoPilot Test",
      GIT_COMMITTER_EMAIL: "evopilot@example.test"
    }
  });
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    allowSampleData: false,
    tokens: [
      { name: "viewer", token: "viewer-token", role: "viewer" },
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "admin", token: "admin-token", role: "admin" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const project = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({
        id: "connected-project",
        name: "Connected Project",
        repository: {
          provider: "local-git",
          root: repoRoot,
          defaultBranch: "main",
          token: "secret-project-token"
        },
        cicd: {
          provider: "jenkins",
          jenkins: {
            mode: "project-override",
            baseUrl: "http://jenkins.internal",
            username: "ci-user",
            apiToken: "secret-jenkins-token",
            job: "connected-project-release"
          }
        }
      })
    });
    assert.equal(project.status, 201);

    const codeUpgrader = await fetch(`${baseUrl}/api/v1/connectors/openhands`, {
      method: "POST",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({
        id: "default",
        name: "Real Code Upgrader",
        baseUrl: "http://code-upgrader.internal",
        apiKey: "secret-openhands-token"
      })
    });
    assert.equal(codeUpgrader.status, 201);

    const run = await fetch(`${baseUrl}/api/v1/runs`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "connected-project",
        events: [{
          id: "release-evidence-latency",
          type: "mcp.call",
          source: "observability",
          timestamp: "2026-06-09T00:00:00.000Z",
          severity: "HIGH",
          message: "真实链路 p95 超过 3 秒",
          attributes: { durationMs: 3900 }
        }],
        files: ["package.json"]
      })
    });
    assert.equal(run.status, 201);

    const soak = await fetch(`${baseUrl}/api/v1/soak-reports`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        id: "release-candidate-soak",
        name: "Release Candidate Soak",
        durationSeconds: 10800,
        status: "SUCCEEDED",
        startedAt: "2026-06-09T00:00:00.000Z",
        finishedAt: "2026-06-09T03:00:00.000Z",
        summary: { runCount: 1 }
      })
    });
    assert.equal(soak.status, 201);

    const codeUpgradeRunsDir = path.join(dataRoot, "code-upgrades", "runs");
    fs.mkdirSync(codeUpgradeRunsDir, { recursive: true });
    fs.writeFileSync(path.join(codeUpgradeRunsDir, "failed-upgrade.json"), `${JSON.stringify({
      id: "failed-upgrade",
      projectId: "connected-project",
      deliveryPlanId: "delivery-plan-failed",
      planId: "plan-failed",
      executor: "openhands",
      status: "FAILED",
      proposalMarkdown: "failed upgrade",
      validationCommands: ["node --version"],
      branchStrategy: {
        sourceBranch: "main",
        upgradeBranch: "evopilot/upgrade/failed",
        commitMessage: "failed",
        mergeRequestTitle: "failed",
        mergeRequestDescription: "failed"
      },
      openhands: { connectorId: "default", conversationId: "failed-conversation" },
      artifacts: {},
      failureReason: "old validation failure",
      createdAt: "2026-06-09T00:30:00.000Z",
      updatedAt: "2026-06-09T00:30:00.000Z"
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(codeUpgradeRunsDir, "successful-upgrade.json"), `${JSON.stringify({
      id: "successful-upgrade",
      projectId: "connected-project",
      deliveryPlanId: "delivery-plan-success",
      planId: "plan-success",
      executor: "openhands",
      status: "SUCCEEDED",
      proposalMarkdown: "successful upgrade",
      validationCommands: ["node --version"],
      branchStrategy: {
        sourceBranch: "main",
        upgradeBranch: "evopilot/upgrade/success",
        commitMessage: "success",
        mergeRequestTitle: "success",
        mergeRequestDescription: "success"
      },
      openhands: { connectorId: "default", conversationId: "success-conversation" },
      artifacts: { branchName: "evopilot/upgrade/success", commitSha: "abc123" },
      createdAt: "2026-06-09T01:00:00.000Z",
      updatedAt: "2026-06-09T01:00:00.000Z"
    }, null, 2)}\n`);

    const evidence = await fetch(`${baseUrl}/api/v1/release/evidence`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        id: "rc-1",
        candidate: "v0.1.0-rc.1",
        artifactPaths: ["/tmp/evopilot-dashboard.png"],
        scenarioMatrix: [
          { id: "llm-failure-containment", name: "LLM 失败隔离", status: "PASS", evidence: ["真实 LLM 超时被阻断"], required: true },
          { id: "scm-failure-containment", name: "SCM 失败隔离", status: "PASS", evidence: ["真实 push 失败未泄露 token"], required: true }
        ]
      })
    });
    assert.equal(evidence.status, 201);
    const body = await evidence.json();
    assert.equal(body.data.id, "rc-1");
    assert.equal(body.data.candidate, "v0.1.0-rc.1");
    assert.equal(body.data.releaseTargetId, "ga");
    assert.equal(body.data.status, "NO-GO");
    assert.equal(body.data.releaseDecisionId, "decision-rc-1");
    assert.ok(body.data.sourceSoakReportIds.includes("release-candidate-soak"));
    assert.ok(body.data.serviceInventory.some((item) => item.type === "code-upgrader" && item.status === "READY"));
    assert.ok(body.data.connectedProjects.some((item) => item.repository.credentialsConfigured === true));
    assert.ok(body.data.scenarioMatrix.some((item) => item.id === "llm-failure-containment" && item.status === "PASS"));
    assert.ok(body.data.riskRegister.some((item) => item.source === "scenario-matrix"));
    assert.equal(body.data.riskRegister.find((item) => item.id === "risk-code-upgrade-failed-upgrade")?.status, "MITIGATED");
    assert.ok(body.data.artifacts.some((item) => item.type === "dashboard"));
    assert.doesNotMatch(JSON.stringify(body.data), /secret-project-token|secret-jenkins-token|secret-openhands-token/);

    const fetched = await fetch(`${baseUrl}/api/v1/release/evidence/rc-1`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(fetched.status, 200);
    assert.equal((await fetched.json()).data.id, "rc-1");

    const firstEvidenceBytes = fs.statSync(path.join(dataRoot, "release-evidence", "rc-1.json")).size;
    const secondEvidence = await fetch(`${baseUrl}/api/v1/release/evidence`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        id: "rc-2",
        candidate: "v0.1.0-rc.2",
        scenarioMatrix: [
          { id: "llm-failure-containment", name: "LLM 失败隔离", status: "PASS", evidence: ["真实 LLM 超时被阻断"], required: true },
          { id: "scm-failure-containment", name: "SCM 失败隔离", status: "PASS", evidence: ["真实 push 失败未泄露 token"], required: true }
        ]
      })
    });
    assert.equal(secondEvidence.status, 201);
    const secondEvidenceBytes = fs.statSync(path.join(dataRoot, "release-evidence", "rc-2.json")).size;
    assert.ok(secondEvidenceBytes < firstEvidenceBytes * 2, `release evidence should not recursively embed previous bundles: first=${firstEvidenceBytes}, second=${secondEvidenceBytes}`);

    const evidenceList = await fetch(`${baseUrl}/api/v1/release/evidence`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(evidenceList.status, 200);
    const evidenceListBody = await evidenceList.json();
    assert.equal(evidenceListBody.data[0].id, "rc-2");
    assert.equal(evidenceListBody.data[0].scenarioSummary.total >= 1, true);
    assert.equal(evidenceListBody.data[0].connectedProjects, undefined);

    const targets = await fetch(`${baseUrl}/api/v1/release/targets`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(targets.status, 200);
    const targetBody = await targets.json();
    assert.ok(targetBody.data.some((target) =>
      target.id === "ga" &&
      target.minConnectedProjects === 5 &&
      target.minSucceededSoakSeconds === 5400 &&
      target.requireActiveSoak === true &&
      target.minActiveSoakRunDelta === 5 &&
      target.minActiveSoakCodeUpgradeDelta === 5 &&
      target.minActiveSoakPipelineDelta === 5 &&
      target.requiredScenarioIds.includes("mainstream-loop-harness-alignment")
    ));

    const decisions = await fetch(`${baseUrl}/api/v1/release/decisions`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(decisions.status, 200);
    const decisionBody = await decisions.json();
    assert.equal(decisionBody.data[0].id, "decision-rc-2");
    assert.equal(decisionBody.data[0].targetId, "ga");
    assert.equal(decisionBody.data[0].status, "NO-GO");
    const connectedProjectCriterion = decisionBody.data[0].criteria.find((criterion) => criterion.id === "min-connected-projects");
    assert.equal(connectedProjectCriterion.target, 5);
    assert.equal(connectedProjectCriterion.status, "FAIL");
    assert.ok(connectedProjectCriterion.actual < connectedProjectCriterion.target);
    const mainstreamCriterion = decisionBody.data[0].criteria.find((criterion) => criterion.id === "mainstream-loop-harness-alignment");
    assert.equal(mainstreamCriterion.status, "FAIL");
    assert.match(mainstreamCriterion.evidence.join("\n"), /LangGraph|Loop Harness/);

    const summary = await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(summary.status, 200);
    const summaryBody = await summary.json();
    assert.equal(summaryBody.data.recentReleaseEvidence[0].id, "rc-2");
    assert.equal(summaryBody.data.recentReleaseEvidence[0].connectedProjects, undefined);
    assert.equal(summaryBody.data.latestReleaseDecision.id, "decision-rc-2");
    assert.equal(summaryBody.data.currentReleaseDecision.id, "decision-rc-2");
    assert.equal(summaryBody.data.releaseTargetCount, 1);

    const saasTarget = await fetch(`${baseUrl}/api/v1/release/targets`, {
      method: "POST",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({
        id: "saas-ga",
        name: "SaaS GA",
        minConnectedProjects: 1,
        minSucceededSoakSeconds: 0,
        minSuccessfulRuns: 0,
        minEvaluationDatasets: 0,
        minOpportunities: 0,
        minSuccessfulEvolutionBatches: 0,
        minSuccessfulCodeUpgrades: 0,
        minSuccessfulPipelines: 0,
        requiredScenarioIds: ["saas-field-e2e-source-to-ga"],
        requireNoHighOpenRisks: false
      })
    });
    assert.equal(saasTarget.status, 201);

    const saasEvidence = await fetch(`${baseUrl}/api/v1/release/evidence`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
      body: JSON.stringify({
        id: "saas-rc-1",
        candidate: "saas-v1.0.0",
        releaseTargetId: "saas-ga",
        scenarioMatrix: [
          { id: "saas-field-e2e-source-to-ga", name: "SaaS Source-to-GA", status: "PASS", evidence: ["promotedSourceToGaLoops=1"], required: true }
        ]
      })
    });
    assert.equal(saasEvidence.status, 201);
    const saasEvidenceBody = await saasEvidence.json();
    assert.equal(saasEvidenceBody.data.releaseTargetId, "saas-ga");
    assert.equal(saasEvidenceBody.data.scenarioMatrix.find((item) => item.id === "normal-evolution-loop").status, "NOT-APPLICABLE");
    assert.equal(saasEvidenceBody.data.scenarioMatrix.find((item) => item.id === "normal-evolution-loop").required, false);

    const currentDecision = await fetch(`${baseUrl}/api/v1/release/decisions?current=true`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(currentDecision.status, 200);
    const currentDecisionBody = await currentDecision.json();
    assert.equal(currentDecisionBody.data.length, 1);
    assert.equal(currentDecisionBody.data[0].targetId, "saas-ga");
    assert.equal(currentDecisionBody.data[0].status, "GO");

    const currentSummary = await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(currentSummary.status, 200);
    const currentSummaryBody = await currentSummary.json();
    assert.equal(currentSummaryBody.data.currentReleaseTargetId, "saas-ga");
    assert.equal(currentSummaryBody.data.currentReleaseDecision.targetId, "saas-ga");
    assert.equal(currentSummaryBody.data.currentReleaseDecision.status, "GO");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("prod mode disables anonymous admin, sample data, and auto project registration by default", async () => {
  assert.throws(
    () => createServer({ dataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-prod-no-token-")) }),
    /EVOPILOT_PROD_REQUIRES_LLM_PROVIDER/
  );
  assert.throws(
    () => createServer({
      dataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-prod-no-llm-")),
      runtimeMode: "prod",
      tokens: [
        { name: "admin", token: "admin-token", role: "admin" }
      ]
    }),
    /EVOPILOT_PROD_REQUIRES_LLM_PROVIDER/
  );

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-prod-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "prod",
    llmClient: {
      async generate(request) {
        return {
          requestId: request.requestId ?? "prod-llm",
          success: true,
          text: "{}",
          provider: "prod-test-llm",
          model: "prod-test-model",
          durationMs: 1
        };
      }
    },
    tokens: [
      { name: "viewer", token: "viewer-token", role: "viewer" },
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "admin", token: "admin-token", role: "admin" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const health = await (await fetch(`${baseUrl}/health`)).json();
    assert.equal(health.runtimeMode, "prod");

    const anonymousSummary = await fetch(`${baseUrl}/api/v1/summary`);
    assert.equal(anonymousSummary.status, 401);

    const summary = await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(summary.status, 200);
    assert.equal((await summary.json()).data.projectCount, 0);

    const datasets = await fetch(`${baseUrl}/api/v1/evaluation-datasets`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(datasets.status, 503);
    assert.match(await datasets.text(), /EVALUATION_DATASET_SOURCE_NOT_CONFIGURED/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function evidencePost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.ok(response.status >= 200 && response.status < 300, `${url} returned ${response.status}: ${text}`);
  return JSON.parse(text);
}
