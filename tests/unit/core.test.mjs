import assert from "node:assert/strict";
import test from "node:test";
import {
  createEvidenceBundle,
  clusterEvidenceEvents,
  createEvolutionPlan,
  evidenceEventsFromAgentSignals,
  evidenceEventsFromEvaluationResults,
  evidenceEventsFromFeedback,
  evidenceEventsFromOtlpLogs,
  evidenceEventsFromOtlpTraces,
  evidenceEventsFromSkyWalking,
  createImpactMap,
  createValidationContract,
  mineOpportunities,
  runEvolutionCycle,
  scoreOpportunity,
  validateProtectedPaths
} from "../../packages/core/dist/index.js";
import { domainforgeFabricProfile } from "../../packages/profile-domainforge-fabric/dist/index.js";
import { runLocalCi } from "../../packages/adapter-ci/dist/index.js";
import { listRepositoryFiles } from "../../packages/adapter-local-git/dist/index.js";
import { GitLabHttpAdapter } from "../../packages/adapter-gitlab/dist/index.js";
import { GitHubHttpAdapter } from "../../packages/adapter-github/dist/index.js";

test("creates evidence bundle summaries", () => {
  const bundle = createEvidenceBundle({
    id: "bundle-1",
    projectId: "p1",
    from: "2026-06-02T00:00:00.000Z",
    to: "2026-06-02T00:00:00.000Z",
    events: [
      { id: "e1", type: "performance.latency", source: "agent", timestamp: "2026-06-02T00:00:00.000Z", severity: "HIGH", message: "p95 too high" },
      { id: "e2", type: "tool.failure", source: "tool", timestamp: "2026-06-02T00:00:00.000Z", severity: "MEDIUM", message: "tool failed" }
    ]
  });
  assert.equal(bundle.summary.totalEvents, 2);
  assert.equal(bundle.summary.severityCounts.HIGH, 1);
  assert.deepEqual(bundle.summary.sources, ["agent", "tool"]);
});

test("converts supported evidence ingestion formats into runtime events", () => {
  const now = "2026-06-04T00:00:00.000Z";
  const agentEvents = evidenceEventsFromAgentSignals([{ type: "tool.call", traceId: "t1", attributes: { durationMs: 3200 } }], now);
  assert.equal(agentEvents[0].source, "agent");
  assert.equal(agentEvents[0].severity, "HIGH");

  const otlpEvents = evidenceEventsFromOtlpTraces({
    resourceSpans: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "order-agent" } }] },
      scopeSpans: [{
        spans: [{
          traceId: "trace-1",
          spanId: "span-1",
          name: "chat.completions",
          startTimeUnixNano: "1780531200000000000",
          endTimeUnixNano: "1780531204200000000",
          attributes: [{ key: "gen_ai.system", value: { stringValue: "glm" } }]
        }]
      }]
    }]
  }, now);
  assert.equal(otlpEvents[0].type, "llm.call");
  assert.equal(otlpEvents[0].attributes.durationMs, 4200);
  assert.equal(otlpEvents[0].module, "order-agent");

  const logEvents = evidenceEventsFromOtlpLogs({ logs: [{ severityText: "ERROR", body: { stringValue: "工具失败" }, attributes: [{ key: "traceId", value: { stringValue: "t2" } }] }] }, now);
  assert.equal(logEvents[0].type, "log.error");
  assert.equal(logEvents[0].severity, "HIGH");

  const skywalkingEvents = evidenceEventsFromSkyWalking({ spans: [{ traceId: "sw1", spanId: "s1", serviceName: "agent", endpointName: "/chat", latency: 3600 }] }, now);
  assert.equal(skywalkingEvents[0].source, "observability");
  assert.equal(skywalkingEvents[0].attributes.latencyMs, 3600);

  const evalEvents = evidenceEventsFromEvaluationResults([{ suite: "regression", caseId: "c1", status: "FAILED", score: 0.2 }], now);
  assert.equal(evalEvents[0].type, "eval.failed");
  assert.equal(evalEvents[0].severity, "HIGH");

  const feedbackEvents = evidenceEventsFromFeedback([{ rating: "negative", message: "回答太慢", traceId: "t3" }], now);
  assert.equal(feedbackEvents[0].type, "user.feedback.negative");
  assert.equal(feedbackEvents[0].source, "user");
});

test("protected paths are enforced by profile policy", () => {
  assert.deepEqual(validateProtectedPaths(["domains/jsnx/domain.yaml", "src/index.ts"], domainforgeFabricProfile.policy.protectedPaths), ["domains/jsnx/domain.yaml"]);
});

test("opportunity scoring respects performance weight", () => {
  const bundle = createEvidenceBundle({
    id: "bundle-2",
    projectId: "p1",
    from: "now",
    to: "now",
    events: [{ id: "e1", type: "performance.latency", source: "agent", timestamp: "now", severity: "HIGH", message: "slow" }]
  });
  const [opportunity] = mineOpportunities(bundle);
  const score = scoreOpportunity(opportunity, {
    ...domainforgeFabricProfile.policy,
    weights: { performance: 0.9, reliability: 0.1, userExperience: 0.1, maintainability: 0.1, documentation: 0.1, cost: 0.1 }
  });
  assert.ok(score.score > 65);
});

test("trigger rules create performance opportunity when duration exceeds 3 seconds", () => {
  const bundle = createEvidenceBundle({
    id: "bundle-duration",
    projectId: "p1",
    from: "now",
    to: "now",
    events: [{
      id: "e1",
      type: "mcp.call",
      source: "mcp",
      timestamp: "now",
      severity: "MEDIUM",
      message: "slow call",
      attributes: { durationMs: 3500 }
    }]
  });
  const [opportunity] = mineOpportunities(bundle);
  assert.equal(opportunity.type, "performance-hotspot");
  assert.equal(opportunity.title, "链路性能超过 3 秒阈值");
});

test("trigger rules do not create opportunity for low latency low severity signal", () => {
  const bundle = createEvidenceBundle({
    id: "bundle-fast",
    projectId: "p1",
    from: "now",
    to: "now",
    events: [{
      id: "e1",
      type: "mcp.call",
      source: "mcp",
      timestamp: "now",
      severity: "LOW",
      message: "fast call",
      attributes: { durationMs: 1200 }
    }]
  });
  assert.equal(mineOpportunities(bundle).length, 0);
});

test("boolean trigger fields do not match with numeric comparison operators", () => {
  const bundle = createEvidenceBundle({
    id: "bundle-rag-boolean",
    projectId: "p1",
    from: "now",
    to: "now",
    events: [{
      id: "e1",
      type: "mcp.call",
      source: "mcp",
      timestamp: "now",
      severity: "LOW",
      message: "normal rag hit",
      attributes: { durationMs: 80, ragHit: true }
    }]
  });
  const rules = [{
    id: "bad-rag-rule",
    name: "非法 RAG 比较",
    description: "布尔字段不允许小于等于比较。",
    enabled: true,
    opportunityType: "reliability-risk",
    title: "RAG 命中率下降",
    affectedArea: "rag",
    suggestedDirection: "修复 RAG。",
    riskLevel: "HIGH",
    anyOf: [{ field: "attributes.ragHit", operator: "<=", value: "false" }],
    minMatchingEvents: 1
  }];
  assert.equal(mineOpportunities(bundle, rules).length, 0);
});

test("numeric trigger fields do not match empty threshold values", () => {
  const bundle = createEvidenceBundle({
    id: "bundle-empty-threshold",
    projectId: "p1",
    from: "now",
    to: "now",
    events: [{
      id: "e1",
      type: "mcp.call",
      source: "mcp",
      timestamp: "now",
      severity: "LOW",
      message: "normal duration",
      attributes: { durationMs: 80 }
    }]
  });
  const rules = [{
    id: "bad-duration-rule",
    name: "非法耗时阈值",
    description: "数值字段不能使用空字符串阈值。",
    enabled: true,
    opportunityType: "reliability-risk",
    title: "链路耗时异常",
    affectedArea: "runtime",
    suggestedDirection: "优化链路。",
    riskLevel: "HIGH",
    allOf: [{ field: "attributes.durationMs", operator: ">", value: "" }],
    minMatchingEvents: 1
  }];
  assert.equal(mineOpportunities(bundle, rules).length, 0);
});

test("default rules cover cost, rag, eval, feedback, security, release, and context risks", () => {
  const cases = [
    {
      event: { id: "cost", type: "llm.cost", source: "llm", timestamp: "now", severity: "MEDIUM", message: "cost high", attributes: { costUsd: 0.8 } },
      type: "cost-risk"
    },
    {
      event: { id: "rag", type: "rag.query", source: "agent", timestamp: "now", severity: "MEDIUM", message: "rag miss", attributes: { ragHit: false } },
      type: "reliability-risk"
    },
    {
      event: { id: "eval", type: "eval.failed", source: "ci", timestamp: "now", severity: "HIGH", message: "regression failed", attributes: { score: 0.4 } },
      type: "test-gap"
    },
    {
      event: { id: "feedback", type: "user.feedback.negative", source: "user", timestamp: "now", severity: "MEDIUM", message: "bad answer" },
      type: "product-gap"
    },
    {
      event: { id: "security", type: "security.leak", source: "observability", timestamp: "now", severity: "CRITICAL", message: "secret leaked" },
      type: "security-risk"
    },
    {
      event: { id: "release", type: "release.failed", source: "release", timestamp: "now", severity: "HIGH", message: "canary failed" },
      type: "release-process-risk"
    },
    {
      event: { id: "context", type: "context.compression", source: "llm", timestamp: "now", severity: "MEDIUM", message: "truncated", attributes: { contextTruncated: true } },
      type: "reliability-risk"
    }
  ];
  for (const item of cases) {
    const bundle = createEvidenceBundle({
      id: `bundle-${item.event.id}`,
      projectId: "p1",
      from: "now",
      to: "now",
      events: [item.event]
    });
    assert.ok(mineOpportunities(bundle).some((opportunity) => opportunity.type === item.type), `${item.event.id} should create ${item.type}`);
  }
});

test("clusters aligned trace, eval, and feedback into one higher confidence opportunity", () => {
  const bundle = createEvidenceBundle({
    id: "bundle-clustered",
    projectId: "p1",
    from: "now",
    to: "now",
    events: [
      {
        id: "trace-1",
        type: "mcp.call",
        source: "observability",
        timestamp: "now",
        severity: "HIGH",
        message: "链路耗时 3800ms",
        traceId: "trace-cluster-1",
        module: "agent-runtime",
        attributes: { durationMs: 3800 }
      },
      {
        id: "eval-1",
        type: "eval.failed",
        source: "ci",
        timestamp: "now",
        severity: "HIGH",
        message: "p95 回归失败",
        traceId: "trace-cluster-1",
        module: "latency-suite"
      },
      {
        id: "feedback-1",
        type: "user.feedback.negative",
        source: "user",
        timestamp: "now",
        severity: "HIGH",
        message: "响应太慢",
        traceId: "trace-cluster-1"
      }
    ]
  });
  const clusters = clusterEvidenceEvents(bundle);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].attribution, "latency-regression");
  const [opportunity] = mineOpportunities(bundle);
  assert.equal(opportunity.type, "performance-hotspot");
  assert.deepEqual(opportunity.evidenceEventIds.sort(), ["eval-1", "feedback-1", "trace-1"]);
  assert.equal(opportunity.failureAttribution, "latency-regression");
  assert.ok(opportunity.confidence >= 0.9);
  assert.match(opportunity.confidenceReason, /评测或用户反馈/);
});

test("governance keeps medium and high risk evolution in proposal-only mode", () => {
  const bundle = createEvidenceBundle({
    id: "bundle-governance",
    projectId: "p1",
    from: "now",
    to: "now",
    events: [{ id: "e1", type: "performance.latency", source: "agent", timestamp: "now", severity: "HIGH", message: "slow", attributes: { durationMs: 4200 } }]
  });
  const [opportunity] = mineOpportunities(bundle);
  const impactMap = createImpactMap({
    opportunity,
    profile: domainforgeFabricProfile,
    files: ["src/runtime-performance.ts", "test/runtime-performance.test.ts"]
  });
  const validationContract = createValidationContract({ id: "validation-governance", opportunity, impactMap });
  const score = scoreOpportunity(opportunity, domainforgeFabricProfile.policy);
  const plan = createEvolutionPlan({
    id: "plan-governance",
    projectId: "p1",
    opportunity,
    impactMap,
    validationContract,
    score,
    policy: domainforgeFabricProfile.policy
  });
  assert.equal(plan.automationLevel, "proposal-only");
  assert.match(plan.riskAnalysis, /治理等级=proposal-only/);
});

test("validation contract includes performance and semantic regression suites", () => {
  const bundle = createEvidenceBundle({
    id: "bundle-validation",
    projectId: "p1",
    from: "now",
    to: "now",
    events: [{ id: "e1", type: "mcp.call", source: "mcp", timestamp: "now", severity: "MEDIUM", message: "slow", attributes: { durationMs: 3600 } }]
  });
  const [opportunity] = mineOpportunities(bundle);
  const impactMap = createImpactMap({
    opportunity,
    profile: domainforgeFabricProfile,
    files: ["src/runtime-performance.ts", "test/runtime-performance.test.ts"]
  });
  const contract = createValidationContract({ id: "validation-contract", opportunity, impactMap });
  assert.ok(contract.suites.some((suite) => suite.type === "semantic"));
  assert.ok(contract.suites.some((suite) => suite.type === "performance"));
  assert.ok(contract.metrics.some((metric) => metric.name === "p95_latency_ms" && metric.threshold === 3000));
});

test("impact map excludes protected business assets", () => {
  const bundle = createEvidenceBundle({
    id: "bundle-3",
    projectId: "domainforge-fabric",
    from: "now",
    to: "now",
    events: [{ id: "e1", type: "product-gap", source: "mcp", timestamp: "now", severity: "HIGH", message: "gap" }]
  });
  const [opportunity] = mineOpportunities(bundle);
  const impact = createImpactMap({
    opportunity,
    profile: domainforgeFabricProfile,
    files: ["domains/jsnx/roles/a.yaml", "gateways/domainforge-fabric-mcp/src/tools.ts", "test/tools.test.ts"]
  });
  assert.equal(impact.likelyFiles.some((file) => file.startsWith("domains/")), false);
});

test("closed loop creates plans, reviews, and delivery drafts", () => {
  const result = runEvolutionCycle({
    projectId: "domainforge-fabric",
    profile: domainforgeFabricProfile,
    now: "2026-06-02T00:00:00.000Z",
    events: [{ id: "e1", type: "performance.latency", source: "agent", timestamp: "now", severity: "HIGH", message: "slow" }],
    files: ["src/runtime-performance.ts", "test/runtime-performance.test.ts"]
  });
  assert.equal(result.opportunities.length, 1);
  assert.equal(result.plans.length, 1);
  assert.equal(result.reviews[0].status, "USER_CONFIRM_REQUIRED");
  assert.equal(result.deliveryPlans[0].blockOnCiFailure, true);
});

test("local adapters provide real file and CI boundaries", async () => {
  const files = listRepositoryFiles({ repoRoot: process.cwd() });
  assert.ok(files.includes("package.json"));
  const ci = await runLocalCi({
    projectId: "evopilot",
    ref: "local",
    cwd: process.cwd(),
    commands: ["node -e \"process.exit(0)\""]
  });
  assert.equal(ci.status, "PASSED");
});

test("remote SCM adapters fail clearly when token is missing", async () => {
  await assert.rejects(
    () => new GitLabHttpAdapter({ baseUrl: "https://gitlab.example.com", projectId: "group/project" }).listPipelines(),
    /GitLab token is required/
  );
  await assert.rejects(
    () => new GitHubHttpAdapter({ owner: "example", repo: "repo" }).listChecks("main"),
    /GitHub token is required/
  );
});
