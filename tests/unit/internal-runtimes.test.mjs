import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { startInternalCodeUpgrader } from "../../scripts/internal-code-upgrader.mjs";
import { startInternalProductCicd } from "../../scripts/internal-product-cicd.mjs";

test("内置代码升级执行器会产生非证据实现文件", async () => {
  const previousMode = process.env.EVOPILOT_RUN_MODE;
  process.env.EVOPILOT_RUN_MODE = "debug";
  const repo = await createRepo();
  const runtime = await startInternalCodeUpgrader({ port: 0 });
  try {
    const session = await post(`${runtime.baseUrl}/api/v1/conversations`, {
      repository: { provider: "local-git", root: repo, branch: "main" },
      branchStrategy: {
        sourceBranch: "main",
        upgradeBranch: `evopilot/test/${Date.now()}`,
        commitMessage: "test upgrade",
        mergeRequestTitle: "test",
        mergeRequestDescription: "test"
      },
      proposalMarkdown: "# 进化方案\n\n增加升级契约。",
      validationCommands: ["git diff --check HEAD~1..HEAD"],
      protectedPaths: ["domains"]
    });
    const completed = await waitFor(`${runtime.baseUrl}/api/v1/conversations/${encodeURIComponent(session.conversationId)}`);
    assert.equal(completed.status, "SUCCEEDED");
    assert.ok(completed.changedFiles.some((file) => file.startsWith(".evopilot/runtime-upgrades/")));
    assert.ok(completed.changedFiles.some((file) => !file.startsWith(".evopilot/upgrades/")));
  } finally {
    await runtime.close();
    process.env.EVOPILOT_RUN_MODE = previousMode;
  }
});

test("内置代码升级执行器拒绝受保护路径", async () => {
  const previousMode = process.env.EVOPILOT_RUN_MODE;
  process.env.EVOPILOT_RUN_MODE = "debug";
  const repo = await createRepo();
  const runtime = await startInternalCodeUpgrader({ port: 0 });
  try {
    const session = await post(`${runtime.baseUrl}/api/v1/conversations`, {
      repository: { provider: "local-git", root: repo, branch: "main" },
      branchStrategy: {
        sourceBranch: "main",
        upgradeBranch: `evopilot/test-protected/${Date.now()}`,
        commitMessage: "test protected",
        mergeRequestTitle: "test",
        mergeRequestDescription: "test"
      },
      proposalMarkdown: "# 进化方案\n\n验证保护路径。",
      protectedPaths: [".evopilot/runtime-upgrades"]
    });
    const completed = await waitFor(`${runtime.baseUrl}/api/v1/conversations/${encodeURIComponent(session.conversationId)}`);
    assert.equal(completed.status, "FAILED");
    assert.match(completed.events.at(-1).message, /受保护路径/);
  } finally {
    await runtime.close();
    process.env.EVOPILOT_RUN_MODE = previousMode;
  }
});

test("产品托管 CI/CD 缺少升级参数时失败", async () => {
  const runtime = await startInternalProductCicd({ port: 0 });
  try {
    const response = await fetch(`${runtime.baseUrl}/job/evopilot-evolution-delivery/buildWithParameters`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ PROJECT_ID: "p1" })
    });
    assert.equal(response.status, 201);
    const queueUrl = response.headers.get("location");
    const queue = await (await fetch(`${queueUrl}api/json`)).json();
    const build = await (await fetch(`${runtime.baseUrl}/job/evopilot-evolution-delivery/${queue.executable.number}/api/json`)).json();
    assert.equal(build.result, "FAILURE");
    const log = await (await fetch(`${runtime.baseUrl}/job/evopilot-evolution-delivery/${queue.executable.number}/consoleText`)).text();
    assert.match(log, /required parameters: failed/);
  } finally {
    await runtime.close();
  }
});

async function createRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-runtime-test-repo-"));
  await run("git", ["init", "-b", "main"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "README.md"), "# test\n", "utf8");
  await run("git", ["add", "README.md"], { cwd: repo });
  await run("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "init"], { cwd: repo });
  return repo;
}

async function waitFor(url) {
  let last;
  for (let i = 0; i < 80; i += 1) {
    last = await (await fetch(url)).json();
    if (["SUCCEEDED", "FAILED", "CANCELED"].includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待运行时任务结束超时：${JSON.stringify(last)}`);
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.ok(response.ok, `${url} failed: ${response.status} ${text}`);
  return JSON.parse(text);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`));
    });
  });
}
