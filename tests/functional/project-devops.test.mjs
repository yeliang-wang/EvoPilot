import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../../packages/server/dist/index.js";

test("project devops API configures GitHub Actions and exposes readiness evidence", async () => {
  const github = await startFakeGitHub();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-project-devops-github-"));
  const server = createServer({ dataRoot, runtimeMode: "debug" });
  await listen(server);
  const baseUrl = serverUrl(server);

  try {
    const project = await post(`${baseUrl}/api/v1/projects`, {
      id: "github-agent",
      name: "GitHub Agent",
      repository: {
        provider: "github",
        baseUrl: github.baseUrl,
        owner: "org",
        repo: "repo",
        defaultBranch: "main",
        token: "github-token"
      }
    });
    assert.equal(project.data.id, "github-agent");
    assert.equal(project.data.validation.status, "VERIFIED");

    const configured = await post(`${baseUrl}/api/v1/projects/github-agent/devops`, {
      provider: "github-actions",
      ci: {
        workflow: "ci.yml",
        requiredChecks: ["build", "test"]
      },
      cd: {
        workflow: "deploy-prod.yml",
        environment: "production",
        healthUrl: `${github.baseUrl}/health`
      }
    });
    assert.equal(configured.data.devops.provider, "github-actions");
    assert.equal(configured.data.readiness.status, "READY");
    assert.equal(configured.data.readiness.nextAction, "run-devops");

    const preflight = await post(`${baseUrl}/api/v1/projects/github-agent/devops/preflight`, {});
    assert.equal(preflight.data.schema, "evopilot-project-devops-readiness/v1");
    assert.equal(preflight.data.status, "READY");
    assert.ok(preflight.data.checks.some((check) => check.id === "ci-state" && check.status === "PASS"));

    await post(`${baseUrl}/api/v1/projects`, {
      id: "github-observable-agent",
      name: "GitHub Observable Agent",
      repository: {
        provider: "github",
        baseUrl: github.baseUrl,
        owner: "org",
        repo: "observable",
        defaultBranch: "main",
        token: "github-token"
      }
    });
    const observable = await postRaw(`${baseUrl}/api/v1/projects/github-observable-agent/devops`, {
      provider: "github-actions",
      ci: { workflow: "ci.yml" }
    });
    assert.equal(observable.status, 200);
    assert.equal(observable.body.data.readiness.status, "OBSERVABLE");
    assert.equal(observable.body.data.readiness.nextAction, "inspect-ci");
    const observablePreflight = await postRaw(`${baseUrl}/api/v1/projects/github-observable-agent/devops/preflight`, {});
    assert.equal(observablePreflight.status, 409);
    assert.equal(observablePreflight.body.data.status, "OBSERVABLE");

    const diagnostics = await (await fetch(`${baseUrl}/api/v1/projects/github-agent/diagnostics`)).json();
    assert.equal(diagnostics.data.status, "FAILED");
    assert.ok(diagnostics.data.checks.some((check) => check.name === "CI/CD 连接" && check.detail.includes("github-actions")));

    const evidence = await post(`${baseUrl}/api/v1/release/evidence`, {
      id: "github-devops-evidence",
      projectId: "github-agent",
      releaseTargetId: "ga",
      scenarioMatrix: [{ id: "github-devops-ready", name: "GitHub DevOps Ready", status: "PASS", required: true, evidence: ["devops preflight READY"] }]
    });
    assert.equal(evidence.data.connectedProjects[0].devops.provider, "github-actions");
    assert.ok(evidence.data.serviceInventory.some((item) => item.id === "github-agent-devops" && item.evidence.includes("github-actions")));
  } finally {
    await close(server);
    await github.close();
  }
});

test("project devops API configures GitLab CI and rejects provider mismatch", async () => {
  const gitlab = await startFakeGitLab();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-project-devops-gitlab-"));
  const server = createServer({ dataRoot, runtimeMode: "debug" });
  await listen(server);
  const baseUrl = serverUrl(server);

  try {
    await post(`${baseUrl}/api/v1/projects`, {
      id: "gitlab-agent",
      name: "GitLab Agent",
      repository: {
        provider: "gitlab",
        baseUrl: gitlab.baseUrl,
        projectId: "group/project",
        defaultBranch: "main",
        token: "gitlab-token"
      }
    });

    const mismatch = await postRaw(`${baseUrl}/api/v1/projects/gitlab-agent/devops`, {
      provider: "github-actions",
      ci: { workflow: "ci.yml" }
    });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.error, "DEVOPS_PROVIDER_PROJECT_MISMATCH");

    const configured = await post(`${baseUrl}/api/v1/projects/gitlab-agent/devops`, {
      provider: "gitlab-ci",
      ci: {
        requiredStages: ["test"],
        requiredJobs: ["build"]
      },
      cd: {
        environment: "production",
        requiredStages: ["deploy"],
        readyUrl: `${gitlab.baseUrl}/ready`
      }
    });
    assert.equal(configured.data.devops.provider, "gitlab-ci");
    assert.equal(configured.data.readiness.status, "READY");

    const inspected = await (await fetch(`${baseUrl}/api/v1/projects/gitlab-agent/devops`)).json();
    assert.equal(inspected.data.provider, "gitlab-ci");

    const cleared = await fetch(`${baseUrl}/api/v1/projects/gitlab-agent/devops`, { method: "DELETE" });
    assert.equal(cleared.status, 200);
    const afterClear = await postRaw(`${baseUrl}/api/v1/projects/gitlab-agent/devops/preflight`, {});
    assert.equal(afterClear.status, 409);
    assert.equal(afterClear.body.data.nextAction, "configure-devops");
  } finally {
    await close(server);
    await gitlab.close();
  }
});

test("delivery execution uses configured GitHub Actions DevOps by default", async () => {
  const github = await startFakeGitHub();
  const openhands = await startFakeOpenHands();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-project-devops-delivery-"));
  const server = createServer({ dataRoot, runtimeMode: "debug" });
  await listen(server);
  const baseUrl = serverUrl(server);

  try {
    await post(`${baseUrl}/api/v1/projects`, {
      id: "github-delivery-agent",
      name: "GitHub Delivery Agent",
      repository: {
        provider: "github",
        baseUrl: github.baseUrl,
        owner: "org",
        repo: "repo",
        defaultBranch: "main",
        token: "github-token"
      },
      devops: {
        provider: "github-actions",
        ci: {
          workflow: "ci.yml",
          requiredChecks: ["build"]
        }
      }
    });
    await post(`${baseUrl}/api/v1/connectors/openhands`, {
      id: "default",
      name: "Test OpenHands",
      baseUrl: openhands.baseUrl,
      apiKey: "secret"
    });
    const run = await post(`${baseUrl}/api/v1/runs`, {
      projectId: "github-delivery-agent",
      now: "2026-07-19T00:00:00.000Z",
      events: [{
        id: "e1",
        type: "mcp.call",
        source: "mcp",
        timestamp: "2026-07-19T00:00:00.000Z",
        severity: "MEDIUM",
        message: "链路调用耗时超过目标",
        attributes: { durationMs: 3500 }
      }],
      files: ["src/runtime-performance.ts"]
    });
    await post(`${baseUrl}/api/v1/reviews/${encodeURIComponent(run.data.reviews[0].id)}/decision`, {
      action: "accept",
      actor: "tester",
      note: "approve github actions delivery"
    });
    const upgrade = await post(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/code-upgrade`, {
      connectorId: "default",
      proposalMarkdown: "# GitHub Actions delivery",
      validationCommands: ["npm test"]
    });
    assert.equal(upgrade.data.codeUpgradeRun.status, "SUCCEEDED");

    const delivery = await post(`${baseUrl}/api/v1/deliveries/${encodeURIComponent(run.data.deliveryPlans[0].id)}/execute`, {
      parameters: { VERSION: "1.2.3" }
    });
    assert.equal(delivery.data.pipelineRun.provider, "github-actions");
    assert.equal(delivery.data.pipelineRun.status, "SUCCEEDED");
    assert.equal(delivery.data.pipelineRun.parameters.DEVOPS_REF, "evopilot/upgrade");

    const pipeline = await (await fetch(`${baseUrl}/api/v1/pipelines/${encodeURIComponent(delivery.data.pipelineRun.id)}`)).json();
    assert.equal(pipeline.data.status, "SUCCEEDED");
    assert.ok(pipeline.data.logRef.preview.includes("provider=github-actions"));
  } finally {
    await close(server);
    await github.close();
    await openhands.close();
  }
});

async function startFakeGitHub() {
  const server = http.createServer(async (request, response) => {
    if (request.url === "/repos/org/repo/git/trees/main?recursive=1") return json(response, { tree: [{ type: "blob", path: "README.md" }] });
    if (request.url === "/repos/org/observable/git/trees/main?recursive=1") return json(response, { tree: [{ type: "blob", path: "README.md" }] });
    if (request.url === "/repos/org/observable/commits/main/check-runs") return json(response, { check_runs: [] });
    if (request.url?.startsWith("/repos/org/observable/actions/workflows/ci.yml/runs?")) {
      return json(response, { workflow_runs: [{ id: 102, name: "ci", status: "queued", conclusion: null, html_url: "http://github/actions/102" }] });
    }
    if (request.url?.startsWith("/repos/org/repo/commits/") && request.url.endsWith("/check-runs")) {
      return json(response, { check_runs: [
        { name: "build", status: "completed", conclusion: "success" },
        { name: "test", status: "completed", conclusion: "success" }
      ] });
    }
    if (request.url === "/repos/org/repo/actions/workflows/ci.yml/dispatches" && request.method === "POST") {
      await readRequestBody(request);
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url?.startsWith("/repos/org/repo/actions/workflows/ci.yml/runs?")) {
      return json(response, { workflow_runs: [{ id: 101, name: "ci", status: "completed", conclusion: "success", html_url: "http://github/actions/101" }] });
    }
    if (request.url === "/health") return json(response, { status: "UP" });
    response.writeHead(404);
    response.end();
  });
  await listen(server);
  return { baseUrl: serverUrl(server), close: () => close(server) };
}

async function startFakeOpenHands() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/api/v1/conversations") {
      await readRequestBody(request);
      return json(response, { workspaceId: "workspace-1", conversationId: "conversation-1", status: "RUNNING" });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/conversations/conversation-1") {
      return json(response, {
        workspaceId: "workspace-1",
        conversationId: "conversation-1",
        status: "SUCCEEDED",
        events: [
          { id: 1, timestamp: "2026-07-19T00:00:01.000Z", source: "agent", action: "message", message: "validation passed" },
          { id: 2, timestamp: "2026-07-19T00:00:02.000Z", source: "agent", action: "finish", message: JSON.stringify({
            branchName: "evopilot/upgrade",
            commitSha: "abc123",
            pullRequestUrl: "https://github.example/org/repo/pull/1",
            changedFiles: ["src/runtime-performance.ts"],
            diff: "diff --git a/src/runtime-performance.ts b/src/runtime-performance.ts\n+ok\n"
          }) }
        ],
        branchName: "evopilot/upgrade",
        commitSha: "abc123",
        pullRequestUrl: "https://github.example/org/repo/pull/1",
        changedFiles: ["src/runtime-performance.ts"],
        diff: "diff --git a/src/runtime-performance.ts b/src/runtime-performance.ts\n+ok\n"
      });
    }
    response.writeHead(404);
    response.end("not found");
  });
  await listen(server);
  return { baseUrl: serverUrl(server), close: () => close(server) };
}

async function startFakeGitLab() {
  const server = http.createServer(async (request, response) => {
    if (request.url?.startsWith("/api/v4/projects/group%2Fproject/repository/tree")) return json(response, [{ type: "blob", path: "README.md" }]);
    if (request.url?.startsWith("/api/v4/projects/group%2Fproject/pipelines?")) return json(response, [{ id: 201, status: "success", ref: "main", web_url: "http://gitlab/pipelines/201" }]);
    if (request.url === "/api/v4/projects/group%2Fproject/pipelines/201/jobs?per_page=100") {
      return json(response, [
        { id: 1, name: "build", stage: "test", status: "success", web_url: "http://gitlab/jobs/1" },
        { id: 2, name: "deploy", stage: "deploy", status: "success", web_url: "http://gitlab/jobs/2" }
      ]);
    }
    if (request.url === "/ready") return json(response, { status: "READY" });
    response.writeHead(404);
    response.end();
  });
  await listen(server);
  return { baseUrl: serverUrl(server), close: () => close(server) };
}

async function post(url, body) {
  const response = await postRaw(url, body);
  assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response.body));
  return response.body;
}

async function postRaw(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

function json(response, body) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function serverUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
