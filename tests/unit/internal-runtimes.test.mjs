import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { isProductImplementationFile, normalizeRepairAttempts, renderEvidenceFile, renderRepairHistory, runGeneratedQualityGate, sanitizeGeneratedContent, startInternalCodeUpgrader } from "../../scripts/internal-code-upgrader.mjs";
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
    assert.ok(completed.implementationFiles.some((file) => isProductImplementationFile(file)));
  } finally {
    await runtime.close();
    process.env.EVOPILOT_RUN_MODE = previousMode;
  }
});

test("内置代码升级执行器规整 LLM 生成文件名和尾部空白", async () => {
  const previousMode = process.env.EVOPILOT_RUN_MODE;
  const previousAllowed = process.env.EVOPILOT_CODE_UPGRADER_ALLOWED_PATHS;
  process.env.EVOPILOT_RUN_MODE = "debug";
  process.env.EVOPILOT_CODE_UPGRADER_ALLOWED_PATHS = "scripts,.evopilot/runtime-upgrades,docs/evopilot-upgrades";
  const repo = await createRepo();
  const runtime = await startInternalCodeUpgrader({ port: 0 });
  try {
    const session = await post(`${runtime.baseUrl}/api/v1/conversations`, {
      repository: { provider: "local-git", root: repo, branch: "main" },
      branchStrategy: {
        sourceBranch: "main",
        upgradeBranch: `evopilot/test-sanitize/${Date.now()}`,
        commitMessage: "test sanitize",
        mergeRequestTitle: "test",
        mergeRequestDescription: "test"
      },
      proposalMarkdown: "# 进化方案\n\n验证尾部空白规整。",
      validationCommands: ["git diff --check HEAD~1..HEAD"]
    });
    const completed = await waitFor(`${runtime.baseUrl}/api/v1/conversations/${encodeURIComponent(session.conversationId)}`);
    assert.equal(completed.status, "SUCCEEDED");
    assert.ok(completed.changedFiles.some((file) => /^\.evopilot\/runtime-upgrades\/.+\.json$/.test(file)));
  } finally {
    await runtime.close();
    process.env.EVOPILOT_RUN_MODE = previousMode;
    if (previousAllowed === undefined) delete process.env.EVOPILOT_CODE_UPGRADER_ALLOWED_PATHS;
    else process.env.EVOPILOT_CODE_UPGRADER_ALLOWED_PATHS = previousAllowed;
  }
});

test("代码升级实现文件分类拒绝证据、说明和普通文档", () => {
  assert.equal(isProductImplementationFile(".evopilot/upgrades/upgrade.md"), false);
  assert.equal(isProductImplementationFile(".evopilot/runtime-upgrades/upgrade.json"), false);
  assert.equal(isProductImplementationFile("docs/evopilot-upgrades/upgrade.md"), false);
  assert.equal(isProductImplementationFile("README.md"), false);
  assert.equal(isProductImplementationFile("src/runtime.py"), true);
  assert.equal(isProductImplementationFile("tests/test_runtime.py"), true);
  assert.equal(isProductImplementationFile("scripts/evopilot_upgrade_guard.json"), true);
  assert.equal(isProductImplementationFile("package.json"), true);
});

test("代码升级提交前质量门禁拒绝语法错误的 Python 生成文件", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-quality-gate-test-"));
  fs.writeFileSync(path.join(repo, "app.py"), "import\nprint('broken')\n", "utf8");
  await assert.rejects(
    () => runGeneratedQualityGate({ repoDir: repo, files: ["app.py"] }),
    /GENERATED_CODE_QUALITY_GATE_FAILED/
  );
});

test("代码升级提交前质量门禁接受合法 Python 与 JSON 生成文件", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-quality-gate-valid-"));
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "app.py"), "print('ok')\n", "utf8");
  fs.writeFileSync(path.join(repo, "scripts", "guard.json"), "{\"enabled\":true}\n", "utf8");
  await runGeneratedQualityGate({ repoDir: repo, files: ["app.py", "scripts/guard.json"] });
});

test("代码升级生成内容规整 Python JSON 标准库残缺引用", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-python-sanitize-"));
  const content = sanitizeGeneratedContent("body = .dumps({'status': 'UP'})\nheader = 'application/'\n", "app.py");
  assert.match(content, /^import json\n/);
  assert.match(content, /body = json\.dumps/);
  assert.match(content, /'application\/json'/);
  fs.writeFileSync(path.join(repo, "app.py"), content, "utf8");
  await runGeneratedQualityGate({ repoDir: repo, files: ["app.py"] });
});

test("代码升级验证修复会携带历史失败和修复轨迹", () => {
  const previousAttempts = process.env.EVOPILOT_CODE_UPGRADER_REPAIR_ATTEMPTS;
  delete process.env.EVOPILOT_CODE_UPGRADER_REPAIR_ATTEMPTS;
  try {
    assert.equal(normalizeRepairAttempts(), 4);
  } finally {
    if (previousAttempts === undefined) delete process.env.EVOPILOT_CODE_UPGRADER_REPAIR_ATTEMPTS;
    else process.env.EVOPILOT_CODE_UPGRADER_REPAIR_ATTEMPTS = previousAttempts;
  }

  const history = renderRepairHistory([
    {
      attempt: 1,
      phase: "validation",
      error: "test_latency_fault_is_capped_and_low_severity failed",
      occurredAt: "2026-06-07T07:06:23.333Z"
    },
    {
      attempt: 1,
      phase: "validation-repair",
      files: ["app.py"],
      reasons: ["修复 latency 注入路径"],
      occurredAt: "2026-06-07T07:06:47.220Z"
    },
    {
      attempt: 2,
      phase: "validation",
      error: "test_external_latency_injection_is_ignored failed",
      occurredAt: "2026-06-07T07:06:56.175Z"
    }
  ]);
  assert.match(history, /test_latency_fault_is_capped_and_low_severity/);
  assert.match(history, /test_external_latency_injection_is_ignored/);
  assert.match(history, /修复 latency 注入路径/);
});

test("代码升级证据 Markdown 写入前会清理行尾空白", () => {
  const evidence = renderEvidenceFile({
    initialUserMessage: "# 方案\n\n**目标可达。** \n\n- 验证项  \n"
  }, "main", "evopilot/test");
  const sanitized = sanitizeGeneratedContent(evidence, ".evopilot/upgrades/upgrade.md");
  assert.doesNotMatch(sanitized, /[ \t]+\n/);
  assert.match(sanitized, /\*\*目标可达。\*\*\n/);
  assert.match(sanitized, /- 验证项\n/);
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

test("内置代码升级执行器按项目运行配置启动服务并执行冒烟与功能验证", async () => {
  const previousMode = process.env.EVOPILOT_RUN_MODE;
  process.env.EVOPILOT_RUN_MODE = "debug";
  const repo = await createPythonServiceRepo();
  const runtime = await startInternalCodeUpgrader({ port: 0 });
  try {
    const servicePort = 49381;
    const session = await post(`${runtime.baseUrl}/api/v1/conversations`, {
      repository: { provider: "local-git", root: repo, branch: "main" },
      branchStrategy: {
        sourceBranch: "main",
        upgradeBranch: `evopilot/test-validation-plan/${Date.now()}`,
        commitMessage: "test validation plan",
        mergeRequestTitle: "test",
        mergeRequestDescription: "test"
      },
      proposalMarkdown: "# 进化方案\n\n验证服务型项目升级。",
      validationPlan: {
        language: "python",
        unitCommands: ["python3 -m unittest discover -s tests -p 'test_*.py'"],
        service: {
          enabled: true,
          startCommand: `python3 app.py --host 127.0.0.1 --port ${servicePort}`,
          host: "127.0.0.1",
          port: servicePort,
          healthPath: "/health",
          readyTimeoutSeconds: 10
        },
        smokeCommands: ["python3 scripts/smoke.py"],
        functionalCommands: ["python3 scripts/functional.py"]
      }
    });
    const completed = await waitFor(`${runtime.baseUrl}/api/v1/conversations/${encodeURIComponent(session.conversationId)}`);
    assert.equal(completed.status, "SUCCEEDED");
    assert.ok(completed.events.some((item) => item.phase === "运行时体检"));
    assert.ok(completed.events.some((item) => item.phase === "启动验证服务"));
    assert.ok(completed.events.some((item) => item.message.includes("冒烟测试")));
    assert.ok(completed.events.some((item) => item.message.includes("功能闭环测试")));
  } finally {
    await runtime.close();
    process.env.EVOPILOT_RUN_MODE = previousMode;
  }
});

test("测试用 Jenkins fixture 缺少升级参数时失败", async () => {
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

async function createPythonServiceRepo() {
  const repo = await createRepo();
  fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "app.py"), `
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.write_json({"status": "UP"})
        else:
            self.send_response(404)
            self.end_headers()
    def do_POST(self):
        self.write_json({"ok": True})
    def log_message(self, fmt, *args):
        return
    def write_json(self, body):
        raw = json.dumps(body).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

parser = argparse.ArgumentParser()
parser.add_argument("--host", default="127.0.0.1")
parser.add_argument("--port", type=int, required=True)
args = parser.parse_args()
ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
`, "utf8");
  fs.writeFileSync(path.join(repo, "tests", "test_app.py"), "import unittest\nclass AppTest(unittest.TestCase):\n    def test_truth(self):\n        self.assertTrue(True)\n", "utf8");
  fs.writeFileSync(path.join(repo, "scripts", "smoke.py"), `
import json
import os
import urllib.request
base = os.environ["AGENT_BASE_URL"]
with urllib.request.urlopen(base + "/health", timeout=5) as response:
    assert json.loads(response.read().decode("utf-8"))["status"] == "UP"
`, "utf8");
  fs.writeFileSync(path.join(repo, "scripts", "functional.py"), `
import json
import os
import urllib.request
base = os.environ["AGENT_BASE_URL"]
request = urllib.request.Request(base + "/chat", data=b"{}", method="POST")
with urllib.request.urlopen(request, timeout=5) as response:
    assert json.loads(response.read().decode("utf-8"))["ok"] is True
`, "utf8");
  await run("git", ["add", "."], { cwd: repo });
  await run("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "python service"], { cwd: repo });
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
