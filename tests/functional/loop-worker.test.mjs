import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { createServer } from "../../packages/server/dist/index.js";

test("Loop worker process advances durable loops and loop soak proves runtime continuity", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-loop-worker-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [{ name: "operator", token: "operator-token", role: "operator" }]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const created = await post(baseUrl, "/api/v1/loops", {
      id: "worker-driven-loop",
      source: "schedule",
      objective: "Worker should advance this long-running loop.",
      stopPolicy: { maxIterations: 2, requireApprovalForRelease: false }
    });
    assert.equal(created.status, "PENDING");

    const worker = await runNodeScript("scripts/loop-worker.mjs", ["--once"], {
      EVOPILOT_BASE_URL: baseUrl,
      EVOPILOT_API_TOKEN: "operator-token",
      EVOPILOT_ACTOR: "operator",
      EVOPILOT_LOOP_WORKER_ID: "test-worker",
      EVOPILOT_LOOP_WORKER_ONCE: "1"
    });
    assert.equal(worker.code, 0, worker.stderr);
    assert.match(worker.stdout, /loop-worker.iteration/);

    const advanced = await get(baseUrl, "/api/v1/loops/worker-driven-loop");
    assert.equal(advanced.currentIteration, 1);
    assert.ok(advanced.artifacts.some((artifact) => artifact.label.includes("sandbox workspace")));
    assert.ok(fs.existsSync(path.join(dataRoot, "loop-workspaces", "worker-driven-loop", "iteration-1", "context")));

    await post(baseUrl, "/api/v1/loops", {
      id: "preferred-worker-loop",
      source: "schedule",
      objective: "Preferred worker should advance only this loop.",
      stopPolicy: { maxIterations: 2, requireApprovalForRelease: false }
    });
    await post(baseUrl, "/api/v1/loops", {
      id: "non-preferred-worker-loop",
      source: "schedule",
      objective: "Preferred worker must not fall back to this loop.",
      stopPolicy: { maxIterations: 2, requireApprovalForRelease: false }
    });
    const preferredWorker = await runNodeScript("scripts/loop-worker.mjs", ["--once"], {
      EVOPILOT_BASE_URL: baseUrl,
      EVOPILOT_API_TOKEN: "operator-token",
      EVOPILOT_ACTOR: "operator",
      EVOPILOT_LOOP_WORKER_ID: "preferred-test-worker",
      EVOPILOT_LOOP_WORKER_LOOP_ID: "preferred-worker-loop",
      EVOPILOT_LOOP_WORKER_ONCE: "1"
    });
    assert.equal(preferredWorker.code, 0, preferredWorker.stderr);
    const preferred = await get(baseUrl, "/api/v1/loops/preferred-worker-loop");
    const nonPreferred = await get(baseUrl, "/api/v1/loops/non-preferred-worker-loop");
    assert.equal(preferred.currentIteration, 1);
    assert.equal(nonPreferred.currentIteration, 0);

    const stalePreferredFallbackWorker = await runNodeScript("scripts/loop-worker.mjs", ["--once"], {
      EVOPILOT_BASE_URL: baseUrl,
      EVOPILOT_API_TOKEN: "operator-token",
      EVOPILOT_ACTOR: "operator",
      EVOPILOT_LOOP_WORKER_ID: "fallback-test-worker",
      EVOPILOT_LOOP_WORKER_LOOP_ID: "preferred-worker-loop",
      EVOPILOT_LOOP_WORKER_ONCE: "1"
    });
    assert.equal(stalePreferredFallbackWorker.code, 0, stalePreferredFallbackWorker.stderr);
    assert.match(stalePreferredFallbackWorker.stdout, /loop-worker.preferred-unavailable/);
    const fallbackAdvanced = await get(baseUrl, "/api/v1/loops/non-preferred-worker-loop");
    assert.equal(fallbackAdvanced.currentIteration, 1);

    await post(baseUrl, "/api/v1/loops", {
      id: "strict-non-preferred-worker-loop",
      source: "schedule",
      objective: "Strict preferred worker must stay idle when the preferred loop is unavailable.",
      stopPolicy: { maxIterations: 2, requireApprovalForRelease: false }
    });
    const strictPreferredWorker = await runNodeScript("scripts/loop-worker.mjs", ["--once"], {
      EVOPILOT_BASE_URL: baseUrl,
      EVOPILOT_API_TOKEN: "operator-token",
      EVOPILOT_ACTOR: "operator",
      EVOPILOT_LOOP_WORKER_ID: "strict-preferred-test-worker",
      EVOPILOT_LOOP_WORKER_LOOP_ID: "preferred-worker-loop",
      EVOPILOT_LOOP_WORKER_STRICT_LOOP_ID: "1",
      EVOPILOT_LOOP_WORKER_ONCE: "1"
    });
    assert.equal(strictPreferredWorker.code, 0, strictPreferredWorker.stderr);
    assert.match(strictPreferredWorker.stdout, /loop-worker.idle/);
    const strictNonPreferred = await get(baseUrl, "/api/v1/loops/strict-non-preferred-worker-loop");
    assert.equal(strictNonPreferred.currentIteration, 0);

    const reportPath = path.join(dataRoot, "loop-soak.jsonl");
    const soak = await runNodeScript("scripts/loop-soak.mjs", [], {
      EVOPILOT_BASE_URL: baseUrl,
      EVOPILOT_API_TOKEN: "operator-token",
      EVOPILOT_ACTOR: "operator",
      EVOPILOT_LOOP_SOAK_SECONDS: "1",
      EVOPILOT_LOOP_SOAK_INTERVAL_SECONDS: "1",
      EVOPILOT_LOOP_SOAK_LOOP_ID: "worker-soak-loop",
      EVOPILOT_LOOP_WORKER_LOOP_ID: "worker-soak-loop",
      EVOPILOT_LOOP_SOAK_REPORT: reportPath,
      EVOPILOT_LOOP_SOAK_MAX_ITERATIONS: "1"
    });
    assert.equal(soak.code, 0, soak.stderr);
    const report = fs.readFileSync(reportPath, "utf8");
    assert.match(report, /"event":"finished"/);
    assert.match(report, /"status":"SUCCEEDED"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function get(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: authHeaders() });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text).data;
}

async function post(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.ok(response.status >= 200 && response.status < 300, text);
  return JSON.parse(text).data;
}

function authHeaders() {
  return {
    authorization: "Bearer operator-token",
    "x-evopilot-actor": "operator"
  };
}

function runNodeScript(script, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
