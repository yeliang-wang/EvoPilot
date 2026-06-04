import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../../packages/server/dist/index.js";

test("runs evidence to review to confirmed delivery to learning closed loop", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-functional-"));
  const server = createServer({ dataRoot, runtimeMode: "debug" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const run = await post(`${baseUrl}/api/v1/runs`, {
      projectId: "domainforge-fabric",
      now: "2026-06-02T00:00:00.000Z",
      events: [
        { id: "e1", type: "performance.latency", source: "agent", timestamp: "2026-06-02T00:00:00.000Z", severity: "HIGH", message: "p95 latency increased", module: "runtime-performance" },
        { id: "e2", type: "tool.failure", source: "tool", timestamp: "2026-06-02T00:00:01.000Z", severity: "MEDIUM", message: "tool failed" }
      ],
      files: [
        "src/runtime-performance.ts",
        "src/tooling/recovery.ts",
        "domains/jsnx/domain.yaml",
        "test/runtime-performance.test.ts"
      ]
    });

    assert.equal(run.data.evidenceBundle.summary.totalEvents, 2);
    assert.ok(run.data.opportunities.length >= 1);
    assert.ok(run.data.plans.length >= 1);
    assert.equal(run.data.reviews[0].status, "USER_CONFIRM_REQUIRED");
    assert.equal(run.data.plans[0].impactMap.likelyFiles.some((file) => file.startsWith("domains/")), false);

    const blocked = await fetch(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "0.1.0", ciStatus: "PASSED" })
    });
    assert.equal(blocked.status, 409);

    const review = await post(`${baseUrl}/api/v1/reviews/${encodeURIComponent(run.data.reviews[0].id)}/decision`, {
      action: "accept",
      actor: "tester",
      note: "functional test approval"
    });
    assert.equal(review.data.status, "USER_CONFIRMED");

    const delivery = await post(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/execute`, {
      version: "0.1.0",
      ciStatus: "PASSED"
    });
    assert.equal(delivery.data.releaseReport.status, "SUCCEEDED");
    assert.equal(delivery.data.learningRecords.at(-1).outcome, "validated");

    const runs = await (await fetch(`${baseUrl}/api/v1/runs`)).json();
    assert.equal(runs.data.length, 1);
    assert.equal(runs.data[0].releaseReports.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("requires token, registers projects, exposes summary and audit", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-auth-"));
  const server = createServer({ dataRoot, apiToken: "test-token", runtimeMode: "debug" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const unauthorized = await fetch(`${baseUrl}/api/v1/summary`);
    assert.equal(unauthorized.status, 401);

    const repoRoot = createLocalProjectRepo(dataRoot, "agent-a-repo");
    const project = await authedPost(`${baseUrl}/api/v1/projects`, {
      id: "agent-a",
      name: "Agent A",
      profileId: "domainforge-fabric",
      repository: {
        provider: "local-git",
        gitUrl: "file:///agent-a",
        root: repoRoot,
        username: "tester",
        password: "local-secret"
      }
    });
    assert.equal(project.data.id, "agent-a");
    assert.equal(project.data.validation.status, "VERIFIED");
    assert.equal(project.data.repository.credentialsConfigured, true);
    assert.equal(project.data.repository.credentials, undefined);

    const summary = await authedGet(`${baseUrl}/api/v1/summary`);
    assert.equal(summary.data.projectCount, 2);

    const audit = await authedGet(`${baseUrl}/api/v1/audit`);
    assert.equal(audit.data.length, 1);
    assert.equal(audit.data[0].action, "project.created");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rejects unverified project registration and blocks downstream runs for unknown projects", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-project-registration-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "admin", token: "admin-token", role: "admin" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const invalidProject = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer admin-token" },
      body: JSON.stringify({
        id: "invalid",
        name: "Invalid",
        repository: { provider: "local-git", root: path.join(dataRoot, "missing") }
      })
    });
    assert.equal(invalidProject.status, 400);
    assert.match(await invalidProject.text(), /PROJECT_VALIDATION_FAILED/);

    const unknownRun = await fetch(`${baseUrl}/api/v1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer operator-token" },
      body: JSON.stringify({
        projectId: "invalid",
        events: [{ id: "e1", type: "performance.latency", source: "agent", timestamp: "now", severity: "HIGH", message: "slow" }],
        files: ["src/runtime-performance.ts"]
      })
    });
    assert.equal(unknownRun.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("enforces RBAC and idempotent run creation", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-rbac-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
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
    const viewerCreate = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer viewer-token" },
      body: JSON.stringify({ id: "blocked", name: "Blocked" })
    });
    assert.equal(viewerCreate.status, 403);

    const runBody = {
      projectId: "domainforge-fabric",
      now: "2026-06-02T00:00:00.000Z",
      events: [{ id: "e1", type: "performance.latency", source: "agent", timestamp: "now", severity: "HIGH", message: "slow" }],
      files: ["src/runtime-performance.ts"]
    };
    const first = await postWithToken(`${baseUrl}/api/v1/runs`, runBody, "operator-token", "same-key");
    const second = await postWithToken(`${baseUrl}/api/v1/runs`, runBody, "operator-token", "same-key");
    assert.equal(first.data.id, second.data.id);

    const summary = await getWithToken(`${baseUrl}/api/v1/summary`, "viewer-token");
    assert.equal(summary.data.runCount, 1);

    const rules = await getWithToken(`${baseUrl}/api/v1/rules`, "viewer-token");
    const latencyRule = rules.data.find((rule) => rule.id === "chain-latency-over-3s");
    assert.equal(latencyRule.prompt, "所有链路调用小于 3 秒");
    assert.equal(latencyRule.anyOf, undefined);

    const unauthorizedRules = await fetch(`${baseUrl}/api/v1/rules`);
    assert.equal(unauthorizedRules.status, 401);

    const operatorDelivery = await fetch(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(first.data.deliveryPlans[0].id)}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer operator-token" },
      body: JSON.stringify({ version: "0.1.0", ciStatus: "PASSED" })
    });
    assert.equal(operatorDelivery.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("stores compiled execution rules as administrator readable markdown", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-rule-memory-"));
  const server = createServer({ dataRoot, runtimeMode: "debug" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const ruleMarkdown = fs.readFileSync(path.join(dataRoot, "rules", "chain-latency-over-3s.md"), "utf8");
    assert.match(ruleMarkdown, /- 用户规则：所有链路调用小于 3 秒/);
    assert.match(ruleMarkdown, /```json/);
    assert.match(ruleMarkdown, /"anyOf"/);

    const rules = await (await fetch(`${baseUrl}/api/v1/rules`)).json();
    assert.equal(rules.data.find((rule) => rule.id === "chain-latency-over-3s").prompt, "所有链路调用小于 3 秒");

    const run = await post(`${baseUrl}/api/v1/runs`, {
      projectId: "domainforge-fabric",
      now: "2026-06-03T00:00:00.000Z",
      events: [{
        id: "e1",
        type: "mcp.call",
        source: "mcp",
        timestamp: "2026-06-03T00:00:00.000Z",
        severity: "MEDIUM",
        message: "链路调用耗时超过目标",
        attributes: { durationMs: 3500 }
      }],
      files: ["src/runtime-performance.ts"]
    });
    assert.equal(run.data.opportunities[0].title, "链路性能超过 3 秒阈值");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("supports run detail API and pluggable delivery executor", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-executor-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    deliveryExecutor: async () => ({
      ciStatus: "FAILED",
      validationSummary: "自定义执行器阻断发布"
    })
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const run = await post(`${baseUrl}/api/v1/runs`, {
      projectId: "domainforge-fabric",
      now: "2026-06-03T00:00:00.000Z",
      events: [{ id: "e1", type: "performance.latency", source: "agent", timestamp: "now", severity: "HIGH", message: "slow" }],
      files: ["src/runtime-performance.ts"]
    });

    const detail = await (await fetch(`${baseUrl}/api/v1/runs/${encodeURIComponent(run.data.id)}`)).json();
    assert.equal(detail.data.id, run.data.id);

    await post(`${baseUrl}/api/v1/reviews/${encodeURIComponent(run.data.reviews[0].id)}/decision`, {
      action: "accept",
      actor: "tester",
      note: "确认失败执行器测试"
    });
    const delivery = await post(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/execute`, {
      version: "0.1.0"
    });
    assert.equal(delivery.data.releaseReport.status, "FAILED");
    assert.equal(delivery.data.releaseReport.validationSummary, "自定义执行器阻断发布");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("triggers Jenkins after review gate and closes delivery from Jenkins pipeline result", async () => {
  const openhands = await startFakeOpenHands();
  const jenkins = await startFakeJenkins();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-jenkins-loop-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
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
    const connector = await postWithToken(`${baseUrl}/api/v1/connectors/jenkins`, {
      id: "default",
      name: "本地测试 Jenkins",
      baseUrl: jenkins.baseUrl,
      username: "tester",
      apiToken: "secret",
      jobTemplates: { default: "domainforge-fabric-evolution" }
    }, "admin-token");
    assert.equal(connector.data.apiTokenConfigured, true);
    assert.equal(connector.data.apiToken, undefined);
    const openhandsConnector = await postWithToken(`${baseUrl}/api/v1/connectors/openhands`, {
      id: "default",
      name: "本地测试 OpenHands",
      baseUrl: openhands.baseUrl,
      apiKey: "secret"
    }, "admin-token");
    assert.equal(openhandsConnector.data.apiKeyConfigured, true);
    assert.equal(openhandsConnector.data.apiKey, undefined);

    const run = await postWithToken(`${baseUrl}/api/v1/runs`, {
      projectId: "domainforge-fabric",
      now: "2026-06-03T00:00:00.000Z",
      events: [{
        id: "e1",
        type: "mcp.call",
        source: "mcp",
        timestamp: "2026-06-03T00:00:00.000Z",
        severity: "MEDIUM",
        message: "链路调用耗时超过目标",
        attributes: { durationMs: 3500 }
      }],
      files: ["src/runtime-performance.ts"]
    }, "operator-token");

    const blocked = await fetch(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer admin-token" },
      body: JSON.stringify({ executor: "jenkins", connectorId: "default" })
    });
    assert.equal(blocked.status, 409);

    await postWithToken(`${baseUrl}/api/v1/reviews/${encodeURIComponent(run.data.reviews[0].id)}/decision`, {
      action: "accept",
      actor: "tester",
      note: "允许触发 Jenkins"
    }, "operator-token");

    const blockedBeforeCodeUpgrade = await fetch(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer admin-token" },
      body: JSON.stringify({ executor: "jenkins", connectorId: "default" })
    });
    assert.equal(blockedBeforeCodeUpgrade.status, 409);
    assert.match(await blockedBeforeCodeUpgrade.text(), /CODE_UPGRADE_REQUIRED/);

    const upgrade = await postWithToken(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/code-upgrade`, {
      connectorId: "default",
      proposalMarkdown: "# 性能优化方案",
      validationCommands: ["npm test"]
    }, "admin-token");
    assert.equal(upgrade.data.codeUpgradeRun.status, "SUCCEEDED");
    assert.match(openhands.prompt, /性能优化方案/);
    const upgradeEvents = await getWithToken(`${baseUrl}/api/v1/code-upgrade-runs/${encodeURIComponent(upgrade.data.codeUpgradeRun.id)}/events`, "viewer-token");
    assert.ok(upgradeEvents.data.some((event) => event.phase === "运行验证"));

    const delivery = await postWithToken(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/execute`, {
      executor: "jenkins",
      connectorId: "default",
      parameters: { VERSION: "0.2.0" }
    }, "admin-token");
    assert.equal(delivery.data.pipelineRun.status, "QUEUED");
    assert.equal(jenkins.triggeredJob, "/job/domainforge-fabric-evolution/buildWithParameters");
    assert.match(jenkins.triggeredBody, /PLAN_ID=/);

    const pipeline = await getWithToken(`${baseUrl}/api/v1/pipelines/${encodeURIComponent(delivery.data.pipelineRun.id)}`, "viewer-token");
    assert.equal(pipeline.data.status, "SUCCEEDED");
    assert.equal(pipeline.data.buildNumber, 42);
    assert.equal(pipeline.data.stages[0].name, "Build");
    assert.equal(pipeline.data.artifacts[0].name, "release.zip");

    const logs = await fetch(`${baseUrl}/api/v1/pipelines/${encodeURIComponent(pipeline.data.id)}/logs`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    assert.equal(logs.status, 200);
    assert.match(await logs.text(), /Pipeline finished successfully/);

    const artifacts = await getWithToken(`${baseUrl}/api/v1/pipelines/${encodeURIComponent(pipeline.data.id)}/artifacts`, "viewer-token");
    assert.equal(artifacts.data[0].name, "release.zip");

    const detail = await getWithToken(`${baseUrl}/api/v1/runs/${encodeURIComponent(run.data.id)}`, "viewer-token");
    assert.equal(detail.data.releaseReports[0].status, "SUCCEEDED");
    assert.equal(detail.data.releaseReports[0].version, "0.2.0");
    assert.equal(detail.data.learningRecords.at(-1).outcome, "validated");

    const audit = await getWithToken(`${baseUrl}/api/v1/audit`, "viewer-token");
    assert.ok(audit.data.some((record) => record.action === "code-upgrade.started"));
    assert.ok(audit.data.some((record) => record.action === "jenkins.build.triggered"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await openhands.close();
    await jenkins.close();
  }
});

test("OTLP trace evidence enters the full evolution delivery loop", async () => {
  const openhands = await startFakeOpenHands();
  const jenkins = await startFakeJenkins();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-otlp-loop-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
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
    await postWithToken(`${baseUrl}/api/v1/connectors/openhands`, {
      id: "default",
      name: "代码升级执行器",
      baseUrl: openhands.baseUrl
    }, "admin-token");
    await postWithToken(`${baseUrl}/api/v1/connectors/jenkins`, {
      id: "default",
      name: "产品托管 CI/CD",
      baseUrl: jenkins.baseUrl,
      jobTemplates: { default: "domainforge-fabric-evolution" }
    }, "admin-token");

    const ingested = await postWithToken(`${baseUrl}/api/v1/evidence/otlp/v1/traces?projectId=domainforge-fabric`, {
      resourceSpans: [{
        resource: { attributes: [{ key: "service.name", value: { stringValue: "domainforge-agent" } }] },
        scopeSpans: [{
          spans: [{
            traceId: "trace-otlp-1",
            spanId: "span-otlp-1",
            name: "agent.chat",
            startTimeUnixNano: "1780531200000000000",
            endTimeUnixNano: "1780531204100000000",
            attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "chat" } }]
          }]
        }]
      }]
    }, "operator-token");
    const run = ingested.data.run;
    assert.equal(ingested.data.ingestSource, "otlp-traces");
    assert.equal(run.evidenceBundle.events[0].attributes.durationMs, 4100);
    assert.equal(run.opportunities[0].type, "performance-hotspot");

    await postWithToken(`${baseUrl}/api/v1/reviews/${encodeURIComponent(run.reviews[0].id)}/decision`, {
      action: "accept",
      actor: "tester",
      note: "OTLP 证据触发后确认执行"
    }, "operator-token");
    await postWithToken(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.deliveryPlans[0].id)}/code-upgrade`, {
      connectorId: "default",
      proposalMarkdown: "# OTLP 触发的性能优化方案",
      validationCommands: ["npm test"]
    }, "admin-token");
    const delivery = await postWithToken(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.deliveryPlans[0].id)}/execute`, {
      executor: "jenkins",
      connectorId: "default",
      parameters: { VERSION: "otlp-e2e" }
    }, "admin-token");
    const pipeline = await getWithToken(`${baseUrl}/api/v1/pipelines/${encodeURIComponent(delivery.data.pipelineRun.id)}`, "viewer-token");
    assert.equal(pipeline.data.status, "SUCCEEDED");
    const detail = await getWithToken(`${baseUrl}/api/v1/runs/${encodeURIComponent(run.id)}`, "viewer-token");
    assert.equal(detail.data.releaseReports[0].status, "SUCCEEDED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await openhands.close();
    await jenkins.close();
  }
});

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.ok(response.status >= 200 && response.status < 300, `${url} returned ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function authedPost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token", "x-evopilot-actor": "tester" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.ok(response.status >= 200 && response.status < 300, `${url} returned ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function authedGet(url) {
  const response = await fetch(url, {
    headers: { authorization: "Bearer test-token", "x-evopilot-actor": "tester" }
  });
  const text = await response.text();
  assert.ok(response.status >= 200 && response.status < 300, `${url} returned ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function postWithToken(url, body, token, idempotencyKey) {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    "x-evopilot-actor": token
  };
  if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.ok(response.status >= 200 && response.status < 300, `${url} returned ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function getWithToken(url, token) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` }
  });
  const text = await response.text();
  assert.ok(response.status >= 200 && response.status < 300, `${url} returned ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function startFakeOpenHands() {
  const state = { prompt: "", baseUrl: "" };
  const server = (await import("node:http")).createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/api/v1/conversations") {
      const body = JSON.parse(await readRequestBody(request));
      state.prompt = String(body.initialUserMessage ?? "");
      return writeFakeJson(response, { workspaceId: "workspace-1", conversationId: "conversation-1", status: "RUNNING" });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/conversations/conversation-1") {
      return writeFakeJson(response, {
        workspaceId: "workspace-1",
        conversationId: "conversation-1",
        status: "SUCCEEDED",
        branchName: "evopilot/upgrade",
        commitSha: "abc123",
        diff: "diff --git a/src/runtime-performance.ts b/src/runtime-performance.ts\n+// upgraded\n",
        events: [
          { id: "oh-1", phase: "读取方案", source: "agent", level: "info", message: "读取方案" },
          { id: "oh-2", phase: "运行验证", source: "tool", level: "info", message: "npm test 通过" }
        ]
      });
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  state.baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    get baseUrl() { return state.baseUrl; },
    get prompt() { return state.prompt; },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function startFakeJenkins() {
  const state = { triggeredJob: "", triggeredBody: "" };
  const server = (await import("node:http")).createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/job/domainforge-fabric-evolution/buildWithParameters") {
      state.triggeredJob = url.pathname;
      state.triggeredBody = await readRequestBody(request);
      response.writeHead(201, { location: `${state.baseUrl}/queue/item/9/` });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/queue/item/9/api/json") {
      return writeFakeJson(response, { executable: { number: 42, url: `${state.baseUrl}/job/domainforge-fabric-evolution/42/` } });
    }
    if (request.method === "GET" && url.pathname === "/job/domainforge-fabric-evolution/42/api/json") {
      return writeFakeJson(response, {
        building: false,
        result: "SUCCESS",
        url: `${state.baseUrl}/job/domainforge-fabric-evolution/42/`,
        artifacts: [{ displayPath: "release.zip", relativePath: "release.zip" }]
      });
    }
    if (request.method === "GET" && url.pathname === "/job/domainforge-fabric-evolution/42/wfapi/describe") {
      return writeFakeJson(response, {
        stages: [
          { id: "1", name: "Build", status: "SUCCESS", durationMillis: 1000 },
          { id: "2", name: "Deploy", status: "SUCCESS", durationMillis: 2000 }
        ]
      });
    }
    if (request.method === "GET" && url.pathname === "/job/domainforge-fabric-evolution/42/consoleText") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("Pipeline finished successfully");
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  state.baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    get baseUrl() { return state.baseUrl; },
    get triggeredJob() { return state.triggeredJob; },
    get triggeredBody() { return state.triggeredBody; },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function writeFakeJson(response, body) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function createLocalProjectRepo(root, name) {
  const repoRoot = path.join(root, name);
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "src", "index.ts"), "export const ok = true;\n");
  return repoRoot;
}
