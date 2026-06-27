import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../../packages/server/dist/index.js";

test("dashboard product flow covers connected projects, rules, opportunities, confirmation, pipeline, schedule, and history", async () => {
  const openhands = await startFakeOpenHands();
  const jenkins = await startFakeJenkins();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-product-e2e-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    dashboardRoot: path.resolve("apps/dashboard"),
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
    await assertDashboardContract(baseUrl);

    const connector = await postWithToken(`${baseUrl}/api/v1/connectors/jenkins`, {
      id: "default",
      name: "产品 E2E Jenkins",
      baseUrl: jenkins.baseUrl,
      username: "tester",
      apiToken: "secret",
      jobTemplates: { default: "domainforge-fabric-evolution" }
    }, "admin-token");
    assert.equal(connector.data.apiTokenConfigured, true);
    assert.equal(connector.data.apiToken, undefined);
    const openhandsConnector = await postWithToken(`${baseUrl}/api/v1/connectors/openhands`, {
      id: "default",
      name: "产品 E2E OpenHands",
      baseUrl: openhands.baseUrl,
      apiKey: "agent-secret",
      workspaceMode: "docker",
      defaultModel: "test-model"
    }, "admin-token");
    assert.equal(openhandsConnector.data.apiKeyConfigured, true);
    assert.equal(openhandsConnector.data.apiKey, undefined);

    const repoRoot = createLocalProjectRepo(dataRoot, "agent-prod-repo");
    const project = await postWithToken(`${baseUrl}/api/v1/projects`, {
      id: "agent-prod",
      name: "Agent Product",
      profileId: "domainforge-fabric",
      repository: {
        provider: "local-git",
        gitUrl: "file:///agent-prod",
        root: repoRoot,
        username: "agent-user",
        token: "local-token"
      },
      cicd: {
        provider: "jenkins",
        jenkins: {
          mode: "system-default",
          job: "domainforge-fabric-evolution"
        }
      }
    }, "admin-token");
    assert.equal(project.data.id, "agent-prod");
    assert.equal(project.data.validation.status, "VERIFIED");
    assert.equal(project.data.cicd.mode, "system-default");
    assert.equal(project.data.repository.credentialsConfigured, true);
    assert.equal(project.data.repository.credentials, undefined);

    const projects = await getWithToken(`${baseUrl}/api/v1/projects`, "viewer-token");
    assert.ok(projects.data.some((item) => item.id === "domainforge-fabric"));
    assert.ok(projects.data.some((item) => item.id === "agent-prod"));
    assert.equal(projects.data.find((item) => item.id === "agent-prod").repository.token, undefined);

    const rules = await getWithToken(`${baseUrl}/api/v1/rules`, "viewer-token");
    const latencyRule = rules.data.find((rule) => rule.id === "chain-latency-over-3s");
    assert.equal(latencyRule.prompt, "所有链路调用小于 3 秒");
    assert.equal(latencyRule.anyOf, undefined);
    const ruleMarkdown = fs.readFileSync(path.join(dataRoot, "rules", "chain-latency-over-3s.md"), "utf8");
    assert.match(ruleMarkdown, /- 用户规则：所有链路调用小于 3 秒/);
    assert.match(ruleMarkdown, /"attributes.durationMs"/);

    const run = await postWithToken(`${baseUrl}/api/v1/runs`, {
      projectId: "domainforge-fabric",
      now: "2026-06-03T10:00:00.000Z",
      events: [
        {
          id: "trace-1",
          type: "mcp.call",
          source: "mcp",
          timestamp: "2026-06-03T10:00:00.000Z",
          severity: "MEDIUM",
          message: "链路调用耗时超过目标",
          traceId: "trace-prod-1",
          attributes: { durationMs: 3500 }
        },
        {
          id: "tool-1",
          type: "tool.failure",
          source: "tool",
          timestamp: "2026-06-03T10:00:01.000Z",
          severity: "HIGH",
          message: "工具恢复失败",
          module: "tool-recovery"
        }
      ],
      files: [
        "src/runtime-performance.ts",
        "src/tooling/recovery.ts",
        "domains/jsnx/domain.yaml",
        "test/runtime-performance.test.ts"
      ]
    }, "operator-token", "product-e2e-run");
    assert.ok(run.data.opportunities.length >= 2);
    assert.ok(run.data.opportunities.some((item) => item.title === "链路性能超过 3 秒阈值"));
    assert.equal(run.data.reviews[0].status, "USER_CONFIRM_REQUIRED");
    assert.equal(run.data.plans[0].impactMap.likelyFiles.some((file) => file.startsWith("domains/")), false);

    const blockedBeforeConfirmation = await fetch(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/execute`, {
      method: "POST",
      headers: authHeaders("admin-token"),
      body: JSON.stringify({ executor: "jenkins", connectorId: "default" })
    });
    assert.equal(blockedBeforeConfirmation.status, 409);

    const viewerCannotConfirm = await fetch(`${baseUrl}/api/v1/reviews/${encodeURIComponent(run.data.reviews[0].id)}/decision`, {
      method: "POST",
      headers: authHeaders("viewer-token"),
      body: JSON.stringify({ action: "accept", actor: "viewer", note: "should be blocked" })
    });
    assert.equal(viewerCannotConfirm.status, 403);

    const review = await postWithToken(`${baseUrl}/api/v1/reviews/${encodeURIComponent(run.data.reviews[0].id)}/decision`, {
      action: "accept",
      actor: "product-user",
      note: "确认马上进化"
    }, "operator-token");
    assert.equal(review.data.status, "USER_CONFIRMED");

    const blockedBeforeCodeUpgrade = await fetch(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/execute`, {
      method: "POST",
      headers: authHeaders("admin-token"),
      body: JSON.stringify({ executor: "jenkins", connectorId: "default" })
    });
    assert.equal(blockedBeforeCodeUpgrade.status, 409);
    assert.match(await blockedBeforeCodeUpgrade.text(), /CODE_UPGRADE_REQUIRED/);

    const codeUpgrade = await postWithToken(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/code-upgrade`, {
      connectorId: "default",
      proposalMarkdown: "# 降低链路延迟\n\n请增加性能预算和测试。",
      validationCommands: ["npm run check"]
    }, "admin-token");
    assert.equal(codeUpgrade.data.codeUpgradeRun.status, "SUCCEEDED");
    assert.equal(codeUpgrade.data.codeUpgradeRun.branchStrategy.sourceBranch, "main");
    assert.match(codeUpgrade.data.codeUpgradeRun.branchStrategy.upgradeBranch, /^evopilot\/upgrade\/domainforge-fabric\//);
    assert.match(openhands.prompt, /降低链路延迟/);
    assert.match(openhands.prompt, /npm run check/);
    assert.match(openhands.prompt, /源分支：main/);
    assert.match(openhands.prompt, /升级分支：evopilot\/upgrade\/domainforge-fabric\//);
    assert.equal(openhands.body.selected_branch, "main");
    assert.match(openhands.body.initial_user_msg, /升级分支：evopilot\/upgrade\/domainforge-fabric\//);
    const codeUpgradeEvents = await getWithToken(`${baseUrl}/api/v1/code-upgrade-runs/${encodeURIComponent(codeUpgrade.data.codeUpgradeRun.id)}/events`, "viewer-token");
    assert.ok(codeUpgradeEvents.data.some((event) => event.phase === "生成补丁"));
    const codeUpgradeDetail = await getWithToken(`${baseUrl}/api/v1/code-upgrade-runs/${encodeURIComponent(codeUpgrade.data.codeUpgradeRun.id)}`, "viewer-token");
    assert.equal(codeUpgradeDetail.data.artifacts.branchName, "evopilot/upgrade-latency");
    assert.match(fs.readFileSync(codeUpgradeDetail.data.artifacts.diffPath, "utf8"), /performance budget/);

    const pipelineStart = await postWithToken(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/execute`, {
      executor: "jenkins",
      parameters: { VERSION: "1.0.0" }
    }, "admin-token");
    assert.equal(pipelineStart.data.pipelineRun.status, "QUEUED");
    assert.match(jenkins.triggeredBody, /VERSION=1.0.0/);
    assert.match(jenkins.triggeredBody, /SOURCE_BRANCH=main/);
    assert.match(jenkins.triggeredBody, /UPGRADE_BRANCH=evopilot%2Fupgrade-latency/);
    assert.match(jenkins.triggeredBody, /MERGE_REQUEST_URL=https%3A%2F%2Fgit.example.com%2Fagent-prod%2Fpulls%2F1/);

    const pipeline = await getWithToken(`${baseUrl}/api/v1/pipelines/${encodeURIComponent(pipelineStart.data.pipelineRun.id)}`, "viewer-token");
    assert.equal(pipeline.data.status, "SUCCEEDED");
    assert.equal(pipeline.data.buildNumber, 42);
    assert.ok(pipeline.data.stages.some((stage) => stage.name === "功能闭环测试"));

    const logs = await fetch(`${baseUrl}/api/v1/pipelines/${encodeURIComponent(pipeline.data.id)}/logs`, {
      headers: authHeaders("viewer-token")
    });
    assert.equal(logs.status, 200);
    assert.match(await logs.text(), /Pipeline finished successfully/);

    const artifacts = await getWithToken(`${baseUrl}/api/v1/pipelines/${encodeURIComponent(pipeline.data.id)}/artifacts`, "viewer-token");
    assert.equal(artifacts.data[0].name, "release.zip");

    const scheduledRun = await postWithToken(`${baseUrl}/api/v1/runs`, {
      projectId: "domainforge-fabric",
      now: "2026-06-03T11:00:00.000Z",
      events: [{
        id: "trace-2",
        type: "mcp.call",
        source: "mcp",
        timestamp: "2026-06-03T11:00:00.000Z",
        severity: "MEDIUM",
        message: "链路调用耗时超过目标",
        attributes: { durationMs: 3600 }
      }],
      files: ["src/runtime-performance.ts"]
    }, "operator-token", "product-e2e-scheduled-run");
    await postWithToken(`${baseUrl}/api/v1/reviews/${encodeURIComponent(scheduledRun.data.reviews[0].id)}/decision`, {
      action: "accept",
      actor: "product-user",
      note: "确认定时进化"
    }, "operator-token");
    await postWithToken(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(scheduledRun.data.deliveryPlans[0].id)}/code-upgrade`, {
      connectorId: "default",
      proposalMarkdown: "# 定时链路优化",
      validationCommands: ["npm test"]
    }, "admin-token");
    const futureSchedule = await postWithToken(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(scheduledRun.data.deliveryPlans[0].id)}/schedule`, {
      executor: "jenkins",
      scheduledAt: "2099-01-01T00:00:00.000Z",
      parameters: { VERSION: "1.1.0" }
    }, "admin-token");
    assert.equal(futureSchedule.data.status, "SCHEDULED");
    assert.equal(futureSchedule.data.pipelineRunId, undefined);

    const schedules = await getWithToken(`${baseUrl}/api/v1/schedules`, "viewer-token");
    assert.ok(schedules.data.some((item) => item.id === futureSchedule.data.id && item.status === "SCHEDULED"));

    const dueSchedule = await postWithToken(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(scheduledRun.data.deliveryPlans[0].id)}/schedule`, {
      executor: "jenkins",
      scheduledAt: "2000-01-01T00:00:00.000Z",
      parameters: { VERSION: "1.1.1" }
    }, "admin-token");
    assert.equal(dueSchedule.data.schedule.status, "TRIGGERED");
    assert.equal(dueSchedule.data.pipelineRun.status, "QUEUED");

    const runDetail = await getWithToken(`${baseUrl}/api/v1/runs/${encodeURIComponent(run.data.id)}`, "viewer-token");
    assert.equal(runDetail.data.releaseReports[0].status, "SUCCEEDED");
    assert.equal(runDetail.data.releaseReports[0].version, "1.0.0");
    assert.equal(runDetail.data.learningRecords.at(-1).outcome, "validated");

    const summary = await getWithToken(`${baseUrl}/api/v1/summary`, "viewer-token");
    assert.equal(summary.data.releaseHealth, 100);
    assert.ok(summary.data.pipelineCount >= 2);
    assert.ok(summary.data.recentRuns.some((item) => item.releaseReports.length > 0));

    const audit = await getWithToken(`${baseUrl}/api/v1/audit`, "viewer-token");
    for (const action of ["project.created", "run.created", "review.decided", "code-upgrade.started", "jenkins.build.triggered", "delivery.scheduled", "delivery.schedule.triggered"]) {
      assert.ok(audit.data.some((record) => record.action === action), `missing audit action ${action}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await openhands.close();
    await jenkins.close();
  }
});

async function assertDashboardContract(baseUrl) {
  const html = await (await fetch(`${baseUrl}/`)).text();
  const app = await (await fetch(`${baseUrl}/assets/app.js`)).text();
  assert.match(html, /EvoPilot 控制台/);
  assert.doesNotMatch(html, /新建评审/);
  const navMatch = app.match(/const navItems = (\[[^\]]+\]);/);
  assert.ok(navMatch, "Dashboard should define first-level navigation explicitly");
  assert.deepEqual(JSON.parse(navMatch[1]), ["首页", "接入项目", "证据策略", "评测集", "机会点", "Loop", "流水线", "历史记录"]);
  for (const label of ["首页", "进化观测图", "项目拓扑", "运行证据", "已接入", "OpenTelemetry", "SkyWalking", "用户反馈", "触发来源", "触发时间", "IP", "证据摘要", "评测集", "Eval Dataset", "Regression Suite", "形成机会点", "关联评测集", "查看方案", "编辑进化方案", "Markdown 方案正文", "提交方案修改", "确认进化", "Loop Runtime", "闭环编排", "创建闭环 Loop", "Target Loop Backlog", "Codex target loop", "推进下一 Target", "/api/v1/loop-orchestration/advance", "Worker Queue Workbench", "Claim 下一 Loop", "/api/v1/loop-workers/claim", "Context Time Travel Workbench", "Replay 并生成 Diff", "/time-travel/replay", "Sandbox Boundary Workbench", "验证 Sandbox Proof", "/sandbox-proof/verify", "Streaming Trace Workbench", "刷新 Trace Tree", "/trace-tree", "/events", "Source Closure Workbench", "Release Closure Runtime", "刷新 Release Run", "/source-closure/plan", "/api/v1/source-release-runs", "source-release-closure-runtime", "Worker", "/api/v1/loops", "代码升级过程", "根据方案进行代码升级", "白盒执行", "查看原始执行事件", "execution-transcript", "CI/CD 阶段视图", "代码升级失败", "历史详情", "注册项目", "验证并注册", "Git URL", "Token 环境变量", "使用系统默认 Jenkins", "使用项目独立 Jenkins", "Jenkins Job", "/api/v1/evaluation-datasets", "/api/v1/opportunity-drafts", "/api/v1/code-upgrade-runs", "/code-upgrade"]) {
    assert.match(app, new RegExp(label));
  }
  assert.doesNotMatch(app, /OpenHands 白盒执行/);
  assert.doesNotMatch(app, /Jenkins Stage View/);
  assert.doesNotMatch(app, /进化方案 Review/);
  assert.doesNotMatch(app, /方案详情/);
  assert.doesNotMatch(app, /PDF 下载/);
  assert.match(app, /postJson\("\/api\/v1\/projects"/);
  assert.match(app, /projectRegistrationPayload/);
  for (const removed of ["总览", "演进计划", "新建评审"]) {
    assert.doesNotMatch(app, new RegExp(removed));
  }
}

async function postWithToken(url, body, token, idempotencyKey) {
  const headers = authHeaders(token);
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
    headers: authHeaders(token)
  });
  const text = await response.text();
  assert.ok(response.status >= 200 && response.status < 300, `${url} returned ${response.status}: ${text}`);
  return JSON.parse(text);
}

function authHeaders(token) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    "x-evopilot-actor": token
  };
}

async function startFakeOpenHands() {
  const state = {
    prompt: "",
    body: {},
    baseUrl: ""
  };
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
      state.body = body;
      state.prompt = String(body.initial_user_msg ?? "");
      return writeFakeJson(response, {
        conversation_id: "conversation-1",
        status: "ok",
        conversation_status: "RUNNING"
      });
    }
    if (request.method === "POST" && url.pathname === "/api/conversations/conversation-1/start") {
      await readRequestBody(request);
      return writeFakeJson(response, { conversation_id: "conversation-1", status: "ok", conversation_status: "RUNNING" });
    }
    if (request.method === "GET" && url.pathname === "/api/conversations/conversation-1") {
      return writeFakeJson(response, { conversation_id: "conversation-1", status: "ok", conversation_status: "RUNNING" });
    }
    if (request.method === "GET" && url.pathname === "/api/conversations/conversation-1/events") {
      return writeFakeJson(response, {
        events: [
          { id: 1, timestamp: "2026-06-03T10:02:00.000Z", source: "agent", action: "message", message: "读取用户确认的 Markdown 方案" },
          { id: 2, timestamp: "2026-06-03T10:02:01.000Z", source: "agent", action: "message", message: "扫描注册仓库并分析影响文件" },
          { id: 3, timestamp: "2026-06-03T10:02:02.000Z", source: "tool", action: "message", message: "生成性能预算补丁" },
          { id: 4, timestamp: "2026-06-03T10:02:03.000Z", source: "tool", action: "message", message: "npm run check 通过" },
          { id: 5, timestamp: "2026-06-03T10:02:04.000Z", source: "agent", action: "finish", message: JSON.stringify({ branchName: "evopilot/upgrade-latency", commitSha: "abc123", pullRequestUrl: "https://git.example.com/agent-prod/pulls/1", changedFiles: ["docs/evopilot-upgrades/performance.md"], diff: "diff --git a/docs/evopilot-upgrades/performance.md b/docs/evopilot-upgrades/performance.md\n+performance budget\n" }) },
          { id: 6, timestamp: "2026-06-03T10:02:05.000Z", source: "environment", observation: "agent_state_changed", message: "", extras: { agent_state: "finished", reason: "" } }
        ],
        has_more: false
      });
    }
    if (request.method === "GET" && url.pathname === "/api/conversations/conversation-1/git/changes") {
      return writeFakeJson(response, { files: ["docs/evopilot-upgrades/performance.md"] });
    }
    if (request.method === "GET" && url.pathname === "/api/conversations/conversation-1/git/diff") {
      return writeFakeJson(response, { diff: "diff --git a/docs/evopilot-upgrades/performance.md b/docs/evopilot-upgrades/performance.md\n+performance budget\n" });
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
    get body() { return state.body; },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function startFakeJenkins() {
  const state = { triggeredBody: "" };
  const server = (await import("node:http")).createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/job/domainforge-fabric-evolution/buildWithParameters") {
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
          { id: "1", name: "方案装配", status: "SUCCESS", durationMillis: 1000 },
          { id: "2", name: "代码生成", status: "SUCCESS", durationMillis: 2000 },
          { id: "3", name: "单元测试", status: "SUCCESS", durationMillis: 3000 },
          { id: "4", name: "冒烟测试", status: "SUCCESS", durationMillis: 4000 },
          { id: "5", name: "功能闭环测试", status: "SUCCESS", durationMillis: 5000 },
          { id: "6", name: "质量报告", status: "SUCCESS", durationMillis: 1000 }
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
