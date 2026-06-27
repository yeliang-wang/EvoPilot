import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createServer } from "../../packages/server/dist/index.js";

const execFileAsync = promisify(execFile);

test("self-loop script registers EvoPilot, ingests evidence, and creates a bounded loop", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-self-loop-data-"));
  const repoRoot = createLocalEvoPilotRepo(dataRoot, "evopilot-repo");
  const server = createServer({ dataRoot, apiToken: "self-loop-token", runtimeMode: "debug" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await runSelfLoopScript({ baseUrl, repoRoot });
    assert.equal(result.schema, "evopilot-self-loop-result/v1");
    assert.equal(result.projectId, "evopilot-self");
    assert.equal(result.repositoryProvider, "local-git");
    assert.equal(result.projectValidation.status, "VERIFIED");
    assert.equal(result.ingestedEvents, 1);
    assert.equal(result.loopId, "evopilot-self-executor-adapter-contract");
    assert.equal(result.loopStatus, "PENDING");
    assert.equal(result.started, false);
    assert.deepEqual(result.safetyBoundary.validationCommands, [
      "npm run loop-runtime:check",
      "npm run check",
      "git diff --check"
    ]);

    const projects = await get(baseUrl, "/api/v1/projects");
    const project = projects.find((item) => item.id === "evopilot-self");
    assert.equal(project.repository.provider, "local-git");
    assert.equal(project.repository.root, repoRoot);

    const loop = await get(baseUrl, "/api/v1/loops/evopilot-self-executor-adapter-contract");
    assert.equal(loop.projectId, "evopilot-self");
    assert.equal(loop.stopPolicy.maxIterations, 2);
    assert.equal(loop.stopPolicy.requireApprovalForRelease, true);
    assert.equal(loop.context.safetyBoundary.approvalRequired, true);
    assert.ok(loop.context.safetyBoundary.allowedPaths.includes("packages/server"));
    assert.ok(loop.context.safetyBoundary.nonGoals.some((item) => item.includes("No automatic merge")));

    const idempotent = await runSelfLoopScript({ baseUrl, repoRoot });
    assert.equal(idempotent.projectId, "evopilot-self");
    assert.equal(idempotent.loopId, "evopilot-self-executor-adapter-contract");
    assert.equal(idempotent.loopStatus, "PENDING");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("self-loop script can register a production remote GitHub target", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-self-loop-github-data-"));
  const github = await startFakeGitHub();
  const previousToken = process.env.EVOPILOT_SELF_TEST_GITHUB_TOKEN;
  process.env.EVOPILOT_SELF_TEST_GITHUB_TOKEN = "github-token";
  const server = createServer({ dataRoot, apiToken: "self-loop-token", runtimeMode: "debug" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await runSelfLoopScript({
      baseUrl,
      repoRoot: process.cwd(),
      env: {
        EVOPILOT_SELF_REPOSITORY_PROVIDER: "github",
        EVOPILOT_SELF_GITHUB_OWNER: "yeliang-wang",
        EVOPILOT_SELF_GITHUB_REPO: "EvoPilot",
        EVOPILOT_SELF_GITHUB_API_BASE_URL: github.baseUrl,
        EVOPILOT_SELF_GITHUB_TOKEN_REF: "EVOPILOT_SELF_TEST_GITHUB_TOKEN"
      }
    });

    assert.equal(result.repositoryProvider, "github");
    assert.equal(result.projectValidation.status, "VERIFIED");
    assert.equal(github.requests.length, 1);
    assert.equal(github.requests[0].authorization, "Bearer github-token");

    const projects = await get(baseUrl, "/api/v1/projects");
    const project = projects.find((item) => item.id === "evopilot-self");
    assert.equal(project.repository.provider, "github");
    assert.equal(project.repository.owner, "yeliang-wang");
    assert.equal(project.repository.repo, "EvoPilot");
    assert.equal(project.repository.credentialsConfigured, true);
  } finally {
    if (previousToken === undefined) delete process.env.EVOPILOT_SELF_TEST_GITHUB_TOKEN;
    else process.env.EVOPILOT_SELF_TEST_GITHUB_TOKEN = previousToken;
    await new Promise((resolve) => server.close(resolve));
    await github.close();
  }
});

test("self-loop script can start one controlled runtime iteration when explicitly requested", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-self-loop-start-data-"));
  const repoRoot = createLocalEvoPilotRepo(dataRoot, "evopilot-repo");
  const server = createServer({ dataRoot, apiToken: "self-loop-token", runtimeMode: "debug" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await runSelfLoopScript({
      baseUrl,
      repoRoot,
      env: {
        EVOPILOT_SELF_LOOP_ID: "evopilot-self-started-loop",
        EVOPILOT_SELF_LOOP_START: "1"
      }
    });
    assert.equal(result.loopId, "evopilot-self-started-loop");
    assert.equal(result.loopStatus, "RUNNING");
    assert.equal(result.started, true);

    const loop = await get(baseUrl, "/api/v1/loops/evopilot-self-started-loop");
    assert.equal(loop.currentIteration, 1);
    assert.equal(loop.evidenceSets.length, 1);
    assert.ok(loop.evidenceSets[0].evidence.some((item) => item.includes("Controlled self-loop started")));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function runSelfLoopScript({ baseUrl, repoRoot, env = {} }) {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/evopilot-self-loop.mjs"], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    env: {
      ...process.env,
      EVOPILOT_BASE_URL: baseUrl,
      EVOPILOT_API_TOKEN: "self-loop-token",
      EVOPILOT_SELF_REPO_ROOT: repoRoot,
      ...env
    },
    encoding: "utf8"
  });
  return JSON.parse(stdout);
}

async function get(baseUrl, endpoint) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: { authorization: "Bearer self-loop-token" }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.data;
}

function createLocalEvoPilotRepo(root, name) {
  const repoRoot = path.join(root, name);
  fs.mkdirSync(path.join(repoRoot, "packages", "server", "src"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "docs", "architecture"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ name: "evopilot", type: "module" }, null, 2));
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# EvoPilot\n");
  fs.writeFileSync(path.join(repoRoot, "docs", "user-guide.md"), "# User Guide\n");
  fs.writeFileSync(path.join(repoRoot, "docs", "architecture", "loop-runtime.md"), "# Loop Runtime\n");
  fs.writeFileSync(path.join(repoRoot, "packages", "server", "src", "index.ts"), "export const ok = true;\n");
  return repoRoot;
}

async function startFakeGitHub() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    if (request.method === "GET" && request.url === "/repos/yeliang-wang/EvoPilot/git/trees/main?recursive=1") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        tree: [
          { type: "blob", path: "package.json" },
          { type: "blob", path: "README.md" },
          { type: "blob", path: "packages/server/src/index.ts" }
        ]
      }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
