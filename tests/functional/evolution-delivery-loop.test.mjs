import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
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

test("self-learning discovery generates evaluation datasets and opportunity insights from evidence", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-self-learning-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "viewer", token: "viewer-token", role: "viewer" },
      { name: "operator", token: "operator-token", role: "operator" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const run = await postWithToken(`${baseUrl}/api/v1/runs`, {
      projectId: "domainforge-fabric",
      now: "2026-06-04T00:00:00.000Z",
      events: [
        {
          id: "trace-self-1",
          type: "mcp.call",
          source: "observability",
          timestamp: "2026-06-04T00:00:00.000Z",
          severity: "HIGH",
          message: "链路 p95 超过 3 秒",
          traceId: "trace-self-learning",
          module: "runtime-performance",
          attributes: { durationMs: 3900 }
        },
        {
          id: "feedback-self-1",
          type: "user.feedback.negative",
          source: "user",
          timestamp: "2026-06-04T00:00:01.000Z",
          severity: "HIGH",
          message: "用户反馈响应太慢",
          traceId: "trace-self-learning"
        },
        {
          id: "cost-self-1",
          type: "llm.cost",
          source: "observability",
          timestamp: "2026-06-04T00:00:02.000Z",
          severity: "MEDIUM",
          message: "模型调用成本升高",
          traceId: "trace-self-learning",
          module: "runtime-cost",
          attributes: { costUsd: 2.5, totalTokens: 9000 }
        }
      ],
      files: ["src/runtime-performance.ts", "test/runtime-performance.test.ts"]
    }, "operator-token");
    assert.ok(run.data.opportunities[0].confidence >= 0.9);

    const datasets = await getWithToken(`${baseUrl}/api/v1/evaluation-datasets`, "viewer-token");
    assert.ok(datasets.data.some((dataset) =>
      dataset.generatedBy === "self-learning" &&
      dataset.opportunityIds.includes(run.data.opportunities[0].id) &&
      dataset.status === "REGRESSION_READY"
    ));

    const insights = await getWithToken(`${baseUrl}/api/v1/opportunity-insights`, "viewer-token");
    assert.ok(insights.data.some((insight) =>
      insight.source === "self-learning" &&
      insight.datasetIds.length > 0 &&
      insight.score >= 60
    ));

    const scorecards = await getWithToken(`${baseUrl}/api/v1/service-scorecards`, "viewer-token");
    const domainforgeScorecard = scorecards.data.find((scorecard) => scorecard.projectId === "domainforge-fabric");
    assert.ok(domainforgeScorecard.score >= 55);
    assert.ok(domainforgeScorecard.checks.some((check) => check.name === "证据覆盖" && check.status === "PASSED"));
    assert.match(domainforgeScorecard.recommendedAction, /交付闭环|发布后学习|继续积累|建议增强/);

    const sloReports = await getWithToken(`${baseUrl}/api/v1/slo-reports`, "viewer-token");
    const slo = sloReports.data.find((report) => report.projectId === "domainforge-fabric");
    assert.ok(slo.latencyViolationCount >= 1);
    assert.ok(slo.errorBudgetRemaining <= 100);

    const policies = await getWithToken(`${baseUrl}/api/v1/governance/policy-evaluations`, "viewer-token");
    assert.ok(policies.data.some((policy) => policy.name === "SLO 错误预算门禁"));
    assert.ok(policies.data.some((policy) => policy.id === "policy-runtime-supply-chain" && policy.status === "PASSED"));
    assert.ok(policies.data.some((policy) => policy.name === "成本预算门禁" && policy.status !== "PASSED"));

    const supplyChain = await getWithToken(`${baseUrl}/api/v1/supply-chain/reports`, "viewer-token");
    assert.ok(!supplyChain.data.some((report) => report.implementation === "Jenkins"));
    assert.ok(supplyChain.data.some((report) => report.implementation === "OpenHands" && report.status === "READY"));
    assert.ok(supplyChain.data.every((report) => Array.isArray(report.packageArtifacts)));
    assert.ok(supplyChain.data.every((report) => Array.isArray(report.missingArtifacts)));

    const costReports = await getWithToken(`${baseUrl}/api/v1/cost/reports`, "viewer-token");
    const costReport = costReports.data.find((report) => report.projectId === "domainforge-fabric");
    assert.ok(costReport.totalCost >= 2.5);
    assert.ok(costReport.totalTokens >= 9000);
    assert.notEqual(costReport.status, "HEALTHY");

    const readinessReports = await getWithToken(`${baseUrl}/api/v1/release/readiness`, "viewer-token");
    const readiness = readinessReports.data.find((report) => report.projectId === "domainforge-fabric");
    assert.equal(readiness.status, "BLOCKED");
    assert.ok(readiness.gates.some((gate) => gate.name === "运行时供应链" && gate.status === "PASSED"));
    assert.ok(readiness.gates.some((gate) => gate.name === "成本预算" && gate.status === "WARN"));

    const rolloutReports = await getWithToken(`${baseUrl}/api/v1/rollout/strategies`, "viewer-token");
    const rollout = rolloutReports.data.find((report) => report.projectId === "domainforge-fabric");
    assert.equal(rollout.status, "BLOCKED");
    assert.equal(rollout.strategy, "BLOCKED");
    assert.equal(rollout.canaryPercent, 0);
    assert.ok(rollout.gates.some((gate) => gate.name === "发布就绪度" && gate.status === "FAILED"));

    const summary = await getWithToken(`${baseUrl}/api/v1/summary`, "viewer-token");
    assert.equal(summary.data.selfLearningDatasetCount, datasets.data.filter((dataset) => dataset.generatedBy === "self-learning").length);
    assert.ok(summary.data.opportunityInsightCount >= 1);
    assert.ok(summary.data.opportunityInsightQuality >= 60);
    assert.ok(summary.data.averageServiceScore >= 50);
    assert.ok(summary.data.sloHealth <= 100);
    assert.equal(summary.data.failedPolicyCount, 0);
    assert.equal(summary.data.supplyChainRiskCount, 0);
    assert.ok(summary.data.costRiskCount >= 1);
    assert.ok(summary.data.costHealth < 100);
    assert.ok(summary.data.releaseBlockedCount >= 1);
    assert.ok(summary.data.releaseReadinessScore < 100);
    assert.ok(summary.data.rolloutBlockedCount >= 1);
    assert.equal(summary.data.canaryReadyCount, 0);

    const audit = await getWithToken(`${baseUrl}/api/v1/audit`, "viewer-token");
    assert.ok(audit.data.some((record) => record.action === "evaluation-datasets.autogenerated"));
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
    const repoRoot = createLocalProjectRepo(dataRoot, "domainforge-fabric-repo");
    const project = await postWithToken(`${baseUrl}/api/v1/projects`, {
      id: "domainforge-fabric",
      name: "DomainForge Fabric",
      repository: {
        provider: "local-git",
        root: repoRoot,
        defaultBranch: "main"
      },
      cicd: {
        provider: "jenkins",
        jenkins: {
          mode: "project-override",
          baseUrl: jenkins.baseUrl,
          username: "tester",
          apiToken: "secret",
          job: "domainforge-fabric-evolution"
        }
      }
    }, "admin-token");
    assert.equal(project.data.cicd.mode, "project-override");
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
      body: JSON.stringify({ executor: "jenkins" })
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
      body: JSON.stringify({ executor: "jenkins" })
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

test("cost over budget freezes standard evolution but allows cost optimization delivery", async () => {
  const openhands = await startFakeOpenHands();
  const jenkins = await startFakeJenkins();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-cost-freeze-"));
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
    const repoRoot = createLocalProjectRepo(dataRoot, "domainforge-fabric-cost-repo");
    await postWithToken(`${baseUrl}/api/v1/projects`, {
      id: "domainforge-fabric",
      name: "DomainForge Fabric",
      repository: {
        provider: "local-git",
        root: repoRoot,
        defaultBranch: "main"
      },
      cicd: {
        provider: "jenkins",
        jenkins: {
          mode: "project-override",
          baseUrl: jenkins.baseUrl,
          username: "tester",
          apiToken: "secret",
          job: "domainforge-fabric-evolution"
        }
      }
    }, "admin-token");
    await postWithToken(`${baseUrl}/api/v1/connectors/openhands`, {
      id: "default",
      name: "成本优化代码升级执行器",
      baseUrl: openhands.baseUrl
    }, "admin-token");

    const run = await postWithToken(`${baseUrl}/api/v1/runs`, {
      projectId: "domainforge-fabric",
      now: "2026-06-07T00:00:00.000Z",
      events: Array.from({ length: 5 }, (_, index) => ({
        id: `cost-${index}`,
        type: "mcp.call.cost",
        source: "mcp",
        timestamp: `2026-06-07T00:00:0${index}.000Z`,
        severity: "HIGH",
        message: "高成本调用触发预算风险",
        attributes: { durationMs: 3600, latencyMs: 3600, costUsd: 0.6, totalTokens: 9000 }
      })),
      files: ["src/runtime-performance.ts"]
    }, "operator-token");
    assert.ok(run.data.deliveryPlans[0].id);

    const costReports = await getWithToken(`${baseUrl}/api/v1/cost/reports`, "viewer-token");
    const costReport = costReports.data.find((report) => report.projectId === "domainforge-fabric");
    assert.equal(costReport.status, "OVER_BUDGET");

    await postWithToken(`${baseUrl}/api/v1/evaluation-datasets/autogenerate`, {}, "operator-token");
    const scan = await postWithToken(`${baseUrl}/api/v1/evolution-batches/scan`, {
      projectId: "domainforge-fabric",
      minDatasetCount: 1,
      cooldownMinutes: 0
    }, "operator-token");
    assert.equal(scan.data.created.length, 1);
    assert.equal(scan.data.created[0].intent, "cost-optimization");
    assert.ok(scan.data.created[0].datasetIds.length >= 1);

    await postWithToken(`${baseUrl}/api/v1/reviews/${encodeURIComponent(run.data.reviews[0].id)}/decision`, {
      action: "accept",
      actor: "tester",
      note: "超预算后只允许成本优化批次进入代码升级。"
    }, "operator-token");

    const blockedUpgrade = await fetch(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/code-upgrade`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer admin-token" },
      body: JSON.stringify({ connectorId: "default", proposalMarkdown: "# 成本超预算测试" })
    });
    assert.equal(blockedUpgrade.status, 409);
    const blockedUpgradeBody = await blockedUpgrade.json();
    assert.equal(blockedUpgradeBody.error, "EVOLUTION_COST_BUDGET_FROZEN");
    assert.equal(blockedUpgradeBody.costReport.status, "OVER_BUDGET");

    const costOptimizationUpgrade = await postWithToken(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/code-upgrade`, {
      connectorId: "default",
      proposalMarkdown: "# 成本优化方案\n\n优化模型路由、上下文压缩和工具调用次数。",
      validationCommands: ["npm test"],
      batchId: scan.data.created[0].id
    }, "admin-token");
    assert.equal(costOptimizationUpgrade.data.codeUpgradeRun.status, "SUCCEEDED");
    assert.match(openhands.prompt, /成本优化方案/);

    const blockedDelivery = await fetch(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer admin-token" },
      body: JSON.stringify({ executor: "jenkins" })
    });
    assert.equal(blockedDelivery.status, 409);
    const blockedDeliveryBody = await blockedDelivery.json();
    assert.equal(blockedDeliveryBody.error, "EVOLUTION_COST_BUDGET_FROZEN");

    const costOptimizationDelivery = await postWithToken(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/execute`, {
      executor: "jenkins",
      parameters: { VERSION: "cost-optimization-e2e" },
      batchId: scan.data.created[0].id
    }, "admin-token");
    assert.equal(costOptimizationDelivery.data.pipelineRun.status, "QUEUED");
    const pipeline = await getWithToken(`${baseUrl}/api/v1/pipelines/${encodeURIComponent(costOptimizationDelivery.data.pipelineRun.id)}`, "viewer-token");
    assert.equal(pipeline.data.status, "SUCCEEDED");

    const summary = await getWithToken(`${baseUrl}/api/v1/summary`, "viewer-token");
    assert.equal(summary.data.frozenProjectCount, 1);
    assert.equal(summary.data.costOptimizationEvolutionBatchCount, 1);
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
      name: "外部 Jenkins CI/CD",
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

test("opportunity draft generation reads current project code before architectural planning", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-code-aware-draft-"));
  const repoRoot = createGitProjectRepo(dataRoot, "agent-code-aware-repo");
  fs.writeFileSync(path.join(repoRoot, "app.py"), [
    "def call_chain():",
    "    return ['rag_lookup', 'tool_call', 'llm_answer']",
    ""
  ].join("\n"), "utf8");
  execFileSync("git", ["add", "app.py"], { cwd: repoRoot });
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "add app"], { cwd: repoRoot });
  let capturedPrompt = "";
  const server = createServer({
    dataRoot,
    runtimeMode: "prod",
    requireLlm: true,
    llmClient: {
      async generate(request) {
        if (request.intent === "plan.generation") capturedPrompt = request.prompt;
        return {
          success: true,
          text: "# 代码感知进化方案\n\n## 当前代码事实\n\n已读取 app.py。\n\n## 可行性判断\n\n目标需要基于当前调用链拆解。\n\n## 进化目标\n\np95 小于 3 秒。\n\n## 架构改造建议\n\n增加链路预算。\n\n## 修改范围\n\napp.py。\n\n## 验证计划\n\n运行功能闭环。\n\n## 风险与回滚\n\n保留原分支。",
          provider: "test-llm",
          model: "test-model",
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          resolvedIntent: request.intent,
          resolvedProfile: "test"
        };
      }
    },
    tokens: [
      { name: "viewer", token: "viewer-token", role: "viewer" },
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "admin", token: "admin-token", role: "admin" }
    ],
    autoRegisterProfileProject: false
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const project = await postWithToken(`${baseUrl}/api/v1/projects`, {
      id: "agent-code-aware",
      name: "代码感知 Agent",
      repository: {
        provider: "gitlab",
        gitUrl: pathToFileURL(repoRoot).href,
        baseUrl: "http://127.0.0.1:9",
        projectId: "agent/code-aware",
        token: "test-token",
        defaultBranch: "main"
      }
    }, "admin-token");
    assert.equal(project.data.validation.status, "VERIFIED");

    const datasets = await postWithToken(`${baseUrl}/api/v1/evaluation-datasets`, {
      id: "dataset-code-aware-latency",
      projectId: "agent-code-aware",
      name: "调用链 p95 超过 3 秒",
      source: "Trace + Tool Call",
      status: "REGRESSION_READY",
      severity: "HIGH",
      sampleCount: 32,
      metric: "p95LatencyMs=3600",
      scope: "agent.call_chain",
      triggeredAt: "2026-06-06T00:00:00.000Z"
    }, "operator-token");

    const draft = await postWithToken(`${baseUrl}/api/v1/opportunity-drafts`, {
      projectId: "agent-code-aware",
      datasetIds: [datasets.data[0].id],
      title: "调用链延迟优化",
      target: "所有调用链路小于 3 秒"
    }, "operator-token");

    assert.equal(draft.data.codeContext.status, "AVAILABLE");
    assert.equal(draft.data.codeContext.source, "git-clone");
    assert.ok(draft.data.codeContext.selectedFiles.some((file) => file.path === "app.py"));
    assert.match(capturedPrompt, /当前代码上下文/);
    assert.match(capturedPrompt, /文件：app.py/);
    assert.match(capturedPrompt, /rag_lookup/);
    assert.match(capturedPrompt, /可行性判断/);
    assert.match(capturedPrompt, /目标明显不可达/);
    assert.equal(draft.data.llmTrace.mode, "llm");
  } finally {
    await new Promise((resolve) => server.close(resolve));
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
    if (request.method === "POST" && url.pathname === "/api/settings") {
      await readRequestBody(request);
      return writeFakeJson(response, { message: "Settings stored" });
    }
    if (request.method === "POST" && url.pathname === "/api/add-git-providers") {
      await readRequestBody(request);
      return writeFakeJson(response, { status: "ok" });
    }
    if (request.method === "POST" && url.pathname === "/api/conversations") {
      const body = JSON.parse(await readRequestBody(request));
      state.prompt = String(body.initial_user_msg ?? "");
      return writeFakeJson(response, { conversation_id: "conversation-1", status: "ok", conversation_status: "RUNNING" });
    }
    if (request.method === "POST" && url.pathname === "/api/conversations/conversation-1/start") {
      await readRequestBody(request);
      return writeFakeJson(response, { conversation_id: "conversation-1", status: "ok", conversation_status: "RUNNING" });
    }
    if (request.method === "GET" && url.pathname === "/api/conversations/conversation-1") {
      return writeFakeJson(response, { conversation_id: "conversation-1", status: "ok", conversation_status: "RUNNING" });
    }
    if (request.method === "GET" && url.pathname === "/api/conversations/conversation-1/events") {
      return writeFakeJson(response, { events: fakeOpenHandsEvents(), has_more: false });
    }
    if (request.method === "GET" && url.pathname === "/api/conversations/conversation-1/git/changes") {
      return writeFakeJson(response, { files: ["docs/evopilot-upgrades/performance.md"] });
    }
    if (request.method === "GET" && url.pathname === "/api/conversations/conversation-1/git/diff") {
      return writeFakeJson(response, { diff: "diff --git a/docs/evopilot-upgrades/performance.md b/docs/evopilot-upgrades/performance.md\n+upgraded\n" });
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

function fakeOpenHandsEvents() {
  return [
    { id: 1, timestamp: "2026-06-03T10:02:00.000Z", source: "agent", action: "message", message: "读取方案" },
    { id: 2, timestamp: "2026-06-03T10:02:01.000Z", source: "tool", action: "message", message: "npm test 通过" },
    {
      id: 3,
      timestamp: "2026-06-03T10:02:02.000Z",
      source: "agent",
      action: "finish",
      message: JSON.stringify({
        branchName: "evopilot/upgrade",
        commitSha: "abc123",
        pullRequestUrl: "https://git.example.com/agent-prod/merge_requests/1",
        changedFiles: ["docs/evopilot-upgrades/performance.md"],
        diff: "diff --git a/docs/evopilot-upgrades/performance.md b/docs/evopilot-upgrades/performance.md\n+upgraded\n"
      })
    },
    { id: 4, timestamp: "2026-06-03T10:02:03.000Z", source: "environment", observation: "agent_state_changed", message: "", extras: { agent_state: "finished", reason: "" } }
  ];
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

function createGitProjectRepo(root, name) {
  const repoRoot = createLocalProjectRepo(root, name);
  execFileSync("git", ["init", "-b", "main"], { cwd: repoRoot });
  execFileSync("git", ["add", "."], { cwd: repoRoot });
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}
