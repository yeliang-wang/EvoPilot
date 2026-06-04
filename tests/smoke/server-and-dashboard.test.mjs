import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    assert.match(await metrics.text(), /evopilot_projects_total/);

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
    assert.doesNotMatch(app, /Codex/);
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

test("prod mode disables anonymous admin, sample data, and auto project registration by default", async () => {
  assert.throws(
    () => createServer({ dataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-prod-no-token-")) }),
    /EVOPILOT_PROD_REQUIRES_TOKENS/
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
