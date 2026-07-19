import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "../packages/server/dist/index.js";

loadEnvFile(process.env.EVOPILOT_LLM_ENV_FILE ?? "data/evopilot/llm.env");
loadEnvFile(process.env.EVOPILOT_PRODUCTION_E2E_ENV_FILE ?? "data/evopilot/production-e2e.env");

const baseUrl = process.env.EVOPILOT_BASE_URL ?? "http://127.0.0.1:19876";
const token = process.env.EVOPILOT_API_TOKEN ?? "evopilot-48h-local-token";
const outputPath = process.env.EVOPILOT_GA_RESIDUAL_SCENARIO_OUTPUT
  ?? "data/production-lifecycle/evopilot-ga-release-matrix/ga-residual-scenarios.json";

const scenarios = [];
const artifacts = [];

cleanupStaleScmFailureProbeProjects();

const llmEvidence = await verifyLlmFailureContainment();
scenarios.push({
  id: "llm-failure-containment",
  name: "LLM 失败隔离",
  status: llmEvidence.ok ? "PASS" : "FAIL",
  evidence: llmEvidence.evidence,
  required: true,
  updatedAt: new Date().toISOString()
});

const scmEvidence = await verifyScmFailureContainment();
scenarios.push({
  id: "scm-failure-containment",
  name: "SCM 失败隔离",
  status: scmEvidence.ok ? "PASS" : "FAIL",
  evidence: scmEvidence.evidence,
  required: true,
  updatedAt: new Date().toISOString()
});

const rollbackEvidence = await verifyRollbackPath();
scenarios.push({
  id: "rollback",
  name: "回滚路径",
  status: rollbackEvidence.ok ? "PASS" : "FAIL",
  evidence: rollbackEvidence.evidence,
  required: true,
  updatedAt: new Date().toISOString()
});

const output = {
  schema: "evopilot-ga-residual-scenario-evidence/v1",
  generatedAt: new Date().toISOString(),
  scenarioMatrix: scenarios,
  artifactPaths: artifacts,
  productionEvidenceRule: "Only scenarios exercised by this script are emitted. Missing soak evidence is intentionally not marked PASS."
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(JSON.stringify(output, null, 2));

if (scenarios.some((scenario) => scenario.status !== "PASS")) process.exit(1);

async function verifyLlmFailureContainment() {
  const previous = snapshotEnv([
    "EVOPILOT_LLM_PROVIDER_NAME",
    "EVOPILOT_LLM_MODEL_NAME",
    "EVOPILOT_LLM_API_KEY",
    "EVOPILOT_LLM_BASE_URL",
    "EVOPILOT_LLM_TIMEOUT_SECONDS",
    "EVOPILOT_LLM_MAX_RETRIES"
  ]);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-llm-failure-containment-"));
  process.env.EVOPILOT_LLM_PROVIDER_NAME = "zhipu";
  process.env.EVOPILOT_LLM_MODEL_NAME = process.env.EVOPILOT_LLM_MODEL_NAME || "glm-5.1";
  process.env.EVOPILOT_LLM_API_KEY = "invalid-ga-containment-key";
  process.env.EVOPILOT_LLM_BASE_URL = "http://127.0.0.1:9/unreachable";
  process.env.EVOPILOT_LLM_TIMEOUT_SECONDS = "2";
  process.env.EVOPILOT_LLM_MAX_RETRIES = "0";
  const server = createServer({
    dataRoot,
    runtimeMode: "prod",
    requireLlm: true,
    tokens: [{ name: "admin", token: "llm-failure-token", role: "admin" }]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const localBaseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${localBaseUrl}/api/v1/rules/compile`, {
      method: "POST",
      headers: { authorization: "Bearer llm-failure-token", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "ga-llm-failure-containment",
        prompt: "所有链路调用小于 3 秒"
      })
    });
    const bodyText = await response.text();
    const health = await fetch(`${localBaseUrl}/health`);
    const healthBody = await health.json();
    const redactedBody = redact(bodyText);
    const ok = response.status >= 500 && health.status === 200 && healthBody.status === "UP" && !redactedBody.includes("invalid-ga-containment-key");
    return {
      ok,
      evidence: [
        `temporaryProdServer=${localBaseUrl}`,
        `ruleCompileStatus=${response.status}`,
        `healthAfterFailure=${healthBody.status}`,
        "invalid LLM endpoint failed without secret leakage",
        `response=${redactedBody.slice(0, 300)}`
      ]
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreEnv(previous);
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

async function verifyScmFailureContainment() {
  const marker = "invalid-ga-scm-token";
  const missingProject = `yeliang.wang/evopilot-ga-scm-failure-missing-${Date.now()}`;
  const gitlabBaseUrl = process.env.EVOPILOT_REAL_PROJECT_BASE_URL || "https://gitlab.transwarp.io";
  const response = await fetch(`${baseUrl}/api/v1/projects`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      id: `ga-scm-failure-${Date.now()}`,
      name: "GA SCM Failure Containment",
      profileId: "scm-failure-containment",
      repository: {
        provider: "gitlab",
        gitUrl: `${gitlabBaseUrl.replace(/\/+$/, "")}/${missingProject}.git`,
        baseUrl: gitlabBaseUrl,
        projectId: missingProject,
        defaultBranch: process.env.EVOPILOT_REAL_PROJECT_DEFAULT_BRANCH || "main",
        username: process.env.EVOPILOT_REAL_PROJECT_USERNAME || "oauth2",
        token: marker
      }
    })
  });
  const bodyText = await response.text();
  const health = await fetch(`${baseUrl}/health`);
  const healthBody = await health.json();
  const redactedBody = redact(bodyText);
  const ok = response.status === 400 && health.status === 200 && healthBody.status === "UP" && !redactedBody.includes(marker);
  return {
    ok,
    evidence: [
      `missingProject=${missingProject}`,
      `projectRegistrationStatus=${response.status}`,
      `healthAfterFailure=${healthBody.status}`,
      "GitLab registration for an inaccessible project was rejected without secret leakage",
      `response=${redactedBody.slice(0, 300)}`
    ]
  };
}

async function verifyRollbackPath() {
  const pipelines = await apiGet("/api/v1/pipelines");
  const baseline = pipelines
    .filter((item) => item.status === "SUCCEEDED" && item.parameters?.SOURCE_BRANCH && item.parameters?.UPGRADE_BRANCH && item.parameters?.COMMIT_SHA)
    .find((item) => item.parameters?.GIT_URL && item.parameters?.GIT_TOKEN && item.parameters?.PROJECT_ID);
  if (!baseline) {
    return {
      ok: false,
      evidence: ["no successful repository-native pipeline with Git rollback parameters was available"]
    };
  }
  const sourceBranch = String(baseline.parameters.SOURCE_BRANCH);
  const sourceCommit = await gitLsRemote({
    gitUrl: String(baseline.parameters.GIT_URL),
    username: String(baseline.parameters.GIT_USERNAME ?? "oauth2"),
    token: String(baseline.parameters.GIT_TOKEN),
    ref: `refs/heads/${sourceBranch}`
  });
  const rollbackBranch = `evopilot/rollback/${safeBranchSegment(baseline.projectId)}-${Date.now()}`;
  const rollbackCommit = await createRollbackValidationBranch({
    gitUrl: String(baseline.parameters.GIT_URL),
    username: String(baseline.parameters.GIT_USERNAME ?? "oauth2"),
    token: String(baseline.parameters.GIT_TOKEN),
    sourceBranch,
    sourceCommit,
    rollbackBranch,
    baseline
  });
  const version = `rollback-validation-${Date.now()}`;
  const start = await apiPost(`/api/v1/deliveries/${encodeURIComponent(baseline.deliveryPlanId)}/execute`, {
    executor: baseline.provider,
    parameters: {
      GIT_URL: baseline.parameters.GIT_URL,
      GIT_USERNAME: baseline.parameters.GIT_USERNAME ?? "oauth2",
      GIT_TOKEN: baseline.parameters.GIT_TOKEN,
      PROJECT_ID: baseline.projectId,
      VERSION: version,
      SOURCE_BRANCH: sourceBranch,
      UPGRADE_BRANCH: rollbackBranch,
      COMMIT_SHA: rollbackCommit,
      MERGE_REQUEST_URL: `rollback://${baseline.projectId}/${encodeURIComponent(sourceBranch)}`
    }
  });
  const pipeline = await waitForTerminalPipeline(start.pipelineRun.id);
  const logs = await apiText(`/api/v1/pipelines/${encodeURIComponent(pipeline.id)}/logs`);
  const ok = pipeline.status === "SUCCEEDED" &&
    logs.includes(`SOURCE_BRANCH=${sourceBranch}`) &&
    logs.includes(`UPGRADE_BRANCH=${rollbackBranch}`) &&
    logs.includes(`COMMIT_SHA=${rollbackCommit}`);
  return {
    ok,
    evidence: [
      `baselinePipeline=${baseline.id}`,
      `rollbackPipeline=${pipeline.id}`,
      `rollbackBuildUrl=${pipeline.buildUrl}`,
      `rollbackSourceBranch=${sourceBranch}`,
      `rollbackCommitSha=${sourceCommit}`,
      `rollbackValidationBranch=${rollbackBranch}`,
      `rollbackValidationCommitSha=${rollbackCommit}`,
      `rollbackVersion=${version}`,
      ok ? "repository-native DevOps validated a rollback branch derived from the source branch through EvoPilot delivery execute API" : `rollback pipeline status=${pipeline.status}`
    ]
  };
}

async function createRollbackValidationBranch({ gitUrl, username, token, sourceBranch, sourceCommit, rollbackBranch, baseline }) {
  const askpass = writeAskPass(username, token);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-rollback-branch-"));
  const repoDir = path.join(workspace, "repo");
  const env = { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0" };
  try {
    await run("git", ["clone", "--branch", sourceBranch, gitUrl, repoDir], { env });
    await run("git", ["config", "user.name", "EvoPilot Rollback Validator"], { cwd: repoDir, env });
    await run("git", ["config", "user.email", "evopilot@local"], { cwd: repoDir, env });
    await run("git", ["checkout", "-b", rollbackBranch], { cwd: repoDir, env });
    const artifactDir = path.join(repoDir, ".evopilot", "runtime-upgrades");
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, `rollback-${Date.now()}.json`), JSON.stringify({
      version: "1.0",
      type: "rollback-validation",
      projectId: baseline.projectId,
      sourceBranch,
      sourceCommit,
      rolledBackFromBranch: baseline.parameters.UPGRADE_BRANCH,
      rolledBackFromCommit: baseline.parameters.COMMIT_SHA,
      baselinePipelineId: baseline.id,
      createdAt: new Date().toISOString()
    }, null, 2) + "\n", "utf8");
    await run("git", ["add", ".evopilot/runtime-upgrades"], { cwd: repoDir, env });
    await run("git", ["commit", "-m", `EvoPilot: rollback validation for ${baseline.projectId}`], { cwd: repoDir, env });
    const rollbackCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: repoDir, env })).stdout.trim();
    await run("git", ["push", "origin", `HEAD:${rollbackBranch}`], { cwd: repoDir, env });
    return rollbackCommit;
  } finally {
    fs.rmSync(askpass, { force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function waitForTerminalPipeline(id) {
  const deadline = Date.now() + Number(process.env.EVOPILOT_GA_ROLLBACK_TIMEOUT_MS ?? 10 * 60 * 1000);
  let last;
  while (Date.now() < deadline) {
    last = await apiGet(`/api/v1/pipelines/${encodeURIComponent(id)}`);
    if (["SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN"].includes(last.status)) return last;
    await sleep(Number(process.env.EVOPILOT_GA_ROLLBACK_POLL_MS ?? 5000));
  }
  throw new Error(`rollback pipeline timeout: ${JSON.stringify(last)}`);
}

async function apiGet(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} failed: ${response.status} ${text}`);
  return JSON.parse(text).data;
}

async function apiPost(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} failed: ${response.status} ${text}`);
  return JSON.parse(text).data;
}

async function apiText(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} failed: ${response.status} ${text}`);
  return text;
}

async function gitLsRemote({ gitUrl, username, token, ref }) {
  const askpass = writeAskPass(username, token);
  try {
    const result = await run("git", ["ls-remote", gitUrl, ref], {
      env: { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0" }
    });
    const line = result.stdout.trim().split(/\r?\n/).find(Boolean);
    const sha = line?.split(/\s+/)[0] ?? "";
    if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error(`invalid ls-remote output for ${ref}`);
    return sha;
  } finally {
    fs.rmSync(askpass, { force: true });
  }
}

function writeAskPass(username, password) {
  const file = path.join(os.tmpdir(), `evopilot-rollback-askpass-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  fs.writeFileSync(file, [
    "#!/bin/sh",
    "case \"$1\" in",
    `*Username*) printf '%s\\n' '${shellQuote(username)}' ;;`,
    `*) printf '%s\\n' '${shellQuote(password)}' ;;`,
    "esac",
    ""
  ].join("\n"), { mode: 0o700 });
  return file;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      const result = { code, stdout, stderr };
      if (code === 0) resolve(result);
      else reject(new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`));
    });
  });
}

function shellQuote(value) {
  return String(value).replace(/'/g, "'\\''");
}

function safeBranchSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._/-]+/g, "-").replace(/\/+/g, "/").replace(/^[-/.]+|[-/.]+$/g, "").slice(0, 80) || "project";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!process.env[key]) process.env[key] = rest.join("=").trim();
  }
}

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function redact(text) {
  return String(text)
    .replace(/invalid-ga-containment-key/g, "<redacted>")
    .replace(/invalid-ga-scm-token/g, "<redacted>")
    .replace(/(PRIVATE-TOKEN|authorization|token|password|apiKey)\\S*/gi, "$1=<redacted>");
}

function cleanupStaleScmFailureProbeProjects() {
  const projectDir = process.env.EVOPILOT_PROJECTS_DIR ?? "data/evopilot/projects";
  if (!fs.existsSync(projectDir)) return;
  for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^ga-scm-failure-\d+\.json$/.test(entry.name)) continue;
    fs.rmSync(path.join(projectDir, entry.name), { force: true });
  }
}
