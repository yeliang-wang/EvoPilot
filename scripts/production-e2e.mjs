import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "../packages/server/dist/index.js";
import { startInternalCodeUpgrader } from "./internal-code-upgrader.mjs";
import { startInternalProductCicd } from "./internal-product-cicd.mjs";

loadEnvFile(process.env.EVOPILOT_LLM_ENV_FILE ?? "data/evopilot/llm.env");
loadEnvFile(process.env.EVOPILOT_PRODUCTION_E2E_ENV_FILE ?? "data/evopilot/production-e2e.env");

const required = [];
const missing = required.filter((key) => !configured(key));
if (missing.length > 0) {
  console.error(JSON.stringify({
    status: "BLOCKED",
    reason: "真实生产链路 E2E 缺少 EvoPilot 产品运行配置；不会降级为 mock。",
    missing,
    configFile: process.env.EVOPILOT_PRODUCTION_E2E_ENV_FILE ?? "data/evopilot/production-e2e.env"
  }, null, 2));
  process.exit(2);
}

const port = Number(process.env.EVOPILOT_PRODUCTION_E2E_PORT ?? 19988);
const baseUrl = `http://127.0.0.1:${port}`;
const dataRoot = process.env.EVOPILOT_PRODUCTION_E2E_DATA_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-production-e2e-"));
const projectId = process.env.EVOPILOT_REAL_PROJECT_ID ?? "domainforge-fabric-real-user";
const projectName = process.env.EVOPILOT_REAL_PROJECT_NAME ?? "真实用户生产项目";
const projectRepository = projectRepositoryFromEnv();
assertProjectRegistrationReady(projectRepository);
const internalRuntimes = await startProductInternalRuntimes();

const server = createServer({
  dataRoot,
  runtimeMode: "prod",
  dashboardRoot: "apps/dashboard",
  requireLlm: true,
  tokens: [
    { name: "admin", token: "production-e2e-admin-token", role: "admin" },
    { name: "operator", token: "production-e2e-operator-token", role: "operator" },
    { name: "viewer", token: "production-e2e-viewer-token", role: "viewer" }
  ]
});

await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

try {
  await assertHealth();
  await registerExternalConnectors();
  await registerRealProject();
  const rule = await compileRuleWithRealLlm();
  const run = await createRunFromRealEvidence();
  const datasets = await createEvaluationDatasetsFromRun(run);
  const draft = await createOpportunityDraftWithRealLlm(datasets);
  const review = await post(`/api/v1/reviews/${encodeURIComponent(run.reviews[0].id)}/decision`, {
    action: "accept",
    actor: "production-user",
    note: "生产 E2E 确认进化方案"
  }, "operator");
  assert.equal(review.status, "USER_CONFIRMED");

  const codeUpgrade = await post(`/api/v1/deliveries/${encodeURIComponent(run.deliveryPlans[0].id)}/code-upgrade`, {
    connectorId: "default",
    proposalMarkdown: draft.proposalMarkdown,
    validationCommands: validationCommands()
  }, "admin");
  const codeUpgradeRun = await waitForCodeUpgrade(codeUpgrade.codeUpgradeRun.id);
  assert.equal(codeUpgradeRun.status, "SUCCEEDED", `代码升级未成功：${JSON.stringify(codeUpgradeRun)}`);
  assert.ok(codeUpgradeRun.artifacts?.branchName, "代码升级没有返回升级分支");
  assert.ok(codeUpgradeRun.artifacts?.commitSha, "代码升级没有返回提交 SHA");
  assert.ok(codeUpgradeRun.artifacts?.pullRequestUrl, "代码升级没有返回 MR/PR 地址");
  const changedFiles = codeUpgradeRun.artifacts?.changedFiles ?? [];
  assert.ok(changedFiles.some((file) => !file.startsWith(".evopilot/upgrades/")), `代码升级只产生证据文件：${JSON.stringify(changedFiles)}`);
  assert.ok(changedFiles.some((file) => file.startsWith(".evopilot/runtime-upgrades/") || file.startsWith("docs/evopilot-upgrades/")), `代码升级没有产生可被项目 CI/CD 消费的升级实现文件：${JSON.stringify(changedFiles)}`);
  await assertRemoteBranchExists(projectRepository, codeUpgradeRun.artifacts.branchName);

  const pipelineStart = await post(`/api/v1/deliveries/${encodeURIComponent(run.deliveryPlans[0].id)}/execute`, {
    executor: "jenkins",
    connectorId: "default",
    job: productJenkinsJob(),
    parameters: {
      VERSION: `production-e2e-${Date.now()}`,
      PROJECT_ID: projectId
    }
  }, "admin");
  const pipeline = await waitForPipeline(pipelineStart.pipelineRun.id);
  assert.equal(pipeline.status, "SUCCEEDED", `CI/CD 未成功：${JSON.stringify(pipeline)}`);
  assert.equal(pipeline.parameters.SOURCE_BRANCH, projectRepository.defaultBranch);
  assert.equal(pipeline.parameters.UPGRADE_BRANCH, codeUpgradeRun.artifacts.branchName);
  assert.equal(pipeline.parameters.COMMIT_SHA, codeUpgradeRun.artifacts.commitSha);
  assert.equal(pipeline.parameters.MERGE_REQUEST_URL, codeUpgradeRun.artifacts.pullRequestUrl);
  const pipelineLog = await getText(`/api/v1/pipelines/${encodeURIComponent(pipeline.id)}/logs`, "viewer");
  assert.match(pipelineLog, new RegExp(escapeRegExp(codeUpgradeRun.artifacts.branchName)));
  assert.match(pipelineLog, new RegExp(escapeRegExp(codeUpgradeRun.artifacts.commitSha)));

  const detail = await get(`/api/v1/runs/${encodeURIComponent(run.id)}`, "viewer");
  const audit = await get("/api/v1/audit", "viewer");
  const requiredAudit = ["project.created", "rule.compiled", "evaluation-datasets.upserted", "opportunity-draft.created", "run.created", "review.decided", "code-upgrade.started", "jenkins.build.triggered"];
  for (const action of requiredAudit) {
    assert.ok(audit.some((record) => record.action === action), `缺少审计事件：${action}`);
  }

  console.log(JSON.stringify({
    status: "PASSED",
    mode: "non-mock-production-chain",
    project: { id: projectId, name: projectName, repository: maskProjectRepository(projectRepository) },
    llm: {
      rule: rule.llmTrace,
      opportunityDraft: draft.llmTrace
    },
    codeUpgrade: {
      id: codeUpgradeRun.id,
      status: codeUpgradeRun.status,
      artifacts: codeUpgradeRun.artifacts
    },
    pipeline: {
      id: pipeline.id,
      status: pipeline.status,
      buildNumber: pipeline.buildNumber,
      buildUrl: pipeline.buildUrl,
      stages: pipeline.stages
    },
    releaseReports: detail.releaseReports,
    dataRoot
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const blocked = classifyProductionBlocker(message);
  if (blocked) {
    console.error(JSON.stringify(blocked, null, 2));
    process.exitCode = 2;
  } else {
    throw error;
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await closeProductInternalRuntimes(internalRuntimes);
}

async function assertHealth() {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  const ready = await fetch(`${baseUrl}/ready`);
  assert.equal(ready.status, 200);
}

async function registerExternalConnectors() {
  await post("/api/v1/connectors/openhands", {
    id: "default",
    name: "生产代码升级执行器",
    baseUrl: codeUpgraderBaseUrl(),
    apiKey: envFirst("EVOPILOT_CODE_UPGRADER_API_KEY", "EVOPILOT_REAL_OPENHANDS_API_KEY"),
    workspaceMode: envFirst("EVOPILOT_CODE_UPGRADER_WORKSPACE_MODE", "EVOPILOT_REAL_OPENHANDS_WORKSPACE_MODE") ?? "docker",
    defaultModel: envFirst("EVOPILOT_CODE_UPGRADER_MODEL", "EVOPILOT_REAL_OPENHANDS_MODEL", "EVOPILOT_LLM_MODEL_NAME")
  }, "admin");
  await post("/api/v1/connectors/jenkins", {
    id: "default",
    name: "EvoPilot 产品 CI/CD",
    baseUrl: productJenkinsBaseUrl(),
    username: envFirst("EVOPILOT_PRODUCT_JENKINS_USERNAME", "EVOPILOT_REAL_JENKINS_USERNAME"),
    apiToken: envFirst("EVOPILOT_PRODUCT_JENKINS_API_TOKEN", "EVOPILOT_REAL_JENKINS_API_TOKEN"),
    jobTemplates: {
      default: productJenkinsJob(),
      [projectId]: productJenkinsJob()
    }
  }, "admin");
}

async function registerRealProject() {
  const project = await post("/api/v1/projects", {
    id: projectId,
    name: projectName,
    profileId: "domainforge-fabric",
    repository: projectRepository
  }, "admin");
  assert.equal(project.validation.status, "VERIFIED");
}

async function compileRuleWithRealLlm() {
  const rule = await post("/api/v1/rules/compile", {
    projectId,
    prompt: "所有链路调用小于 3 秒"
  }, "operator");
  assert.equal(rule.llmTrace?.mode, "llm");
  assert.equal(rule.llmTrace?.provider, "zhipu");
  assert.equal(rule.llmTrace?.model, "glm-5.1");
  return rule;
}

async function createOpportunityDraftWithRealLlm(datasets) {
  const draft = await post("/api/v1/opportunity-drafts", {
    projectId,
    datasetIds: datasets.map((dataset) => dataset.id),
    title: "订单助手端到端响应体验优化",
    target: "端到端 p95 小于 3 秒，响应体验提升 5%，RAG 命中率不下降"
  }, "operator");
  assert.equal(draft.llmTrace?.mode, "llm");
  assert.equal(draft.llmTrace?.provider, "zhipu");
  assert.equal(draft.llmTrace?.model, "glm-5.1");
  assert.match(draft.proposalMarkdown, /#+\s*(?:\d+[.、]\s*)?(背景|进化目标|架构|验证)/);
  return draft;
}

async function createRunFromRealEvidence() {
  const run = await post("/api/v1/runs", {
    projectId,
    now: new Date().toISOString(),
    events: [
      {
        id: `trace-${Date.now()}`,
        type: "agent.trace",
        source: "agent",
        timestamp: new Date().toISOString(),
        severity: "HIGH",
        message: "真实用户会话端到端链路超过 3 秒",
        traceId: `prod-trace-${Date.now()}`,
        module: "order-assistant",
        attributes: {
          durationMs: 3680,
          latencyMs: 3680,
          p95LatencyMs: 3600,
          ip: "10.24.8.31",
          userFeedback: "响应慢"
        }
      }
    ],
    files: [
      "runtimes/domainforge-fabric-mcp/src/tools.ts",
      "runtimes/domainforge-fabric-service/src/main/java/io/transwarp/domainforge/fabric",
      "tests/e2e"
    ]
  }, "operator");
  assert.ok(run.opportunities.length > 0, "真实证据没有形成机会点");
  assert.equal(run.reviews[0].status, "USER_CONFIRM_REQUIRED");
  return run;
}

async function createEvaluationDatasetsFromRun(run) {
  const triggeredAt = new Date().toISOString();
  const datasets = [
    {
      id: `eval-${run.id}-latency`,
      projectId,
      name: "真实链路延迟回归集",
      source: "Trace / Latency 聚类",
      status: "REGRESSION_READY",
      severity: "HIGH",
      sampleCount: run.evidenceBundle.summary.totalEvents,
      metric: "p95 3.6s，超过 3 秒目标",
      scope: "订单助手端到端链路",
      triggeredAt
    },
    {
      id: `eval-${run.id}-feedback`,
      projectId,
      name: "真实用户负反馈评测集",
      source: "用户反馈",
      status: "EVALUATED",
      severity: "MEDIUM",
      sampleCount: 1,
      metric: "用户反馈：响应慢",
      scope: "生产用户会话",
      triggeredAt
    },
    {
      id: `eval-${run.id}-regression`,
      projectId,
      name: "升级回归验证集",
      source: "Regression Suite",
      status: "REGRESSION_READY",
      severity: "MEDIUM",
      sampleCount: Math.max(1, run.opportunities.length),
      metric: "机会点覆盖率 100%",
      scope: "代码升级后 CI 语义回归",
      triggeredAt
    }
  ];
  const stored = await post("/api/v1/evaluation-datasets", { datasets }, "operator");
  assert.equal(stored.length, datasets.length);
  return stored;
}

async function waitForCodeUpgrade(id) {
  return waitForTerminal(`/api/v1/code-upgrade-runs/${encodeURIComponent(id)}`, "代码升级", (item) => ["SUCCEEDED", "FAILED", "CANCELED"].includes(item.status));
}

async function waitForPipeline(id) {
  return waitForTerminal(`/api/v1/pipelines/${encodeURIComponent(id)}`, "CI/CD", (item) => ["SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN"].includes(item.status));
}

async function assertRemoteBranchExists(repository, branch) {
  if (repository.provider === "local-git") return;
  const askpass = writeAskPass(repository);
  try {
    const gitEnv = { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0" };
    const result = await run("git", ["ls-remote", "--heads", repository.gitUrl, branch], { env: gitEnv });
    assert.match(result.stdout, new RegExp(escapeRegExp(branch)), `远端分支不存在：${branch}`);
  } finally {
    fs.rmSync(askpass, { force: true });
  }
}

async function waitForTerminal(pathname, label, done) {
  const timeoutMs = Number(process.env.EVOPILOT_PRODUCTION_E2E_TIMEOUT_MS ?? 15 * 60 * 1000);
  const pollMs = Number(process.env.EVOPILOT_PRODUCTION_E2E_POLL_MS ?? 5000);
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await get(pathname, "viewer");
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`${label} 等待超时：${JSON.stringify(last)}`);
}

function validationCommands() {
  return (process.env.EVOPILOT_REAL_VALIDATION_COMMANDS ?? "npm run check")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function projectRepositoryFromEnv() {
  return {
    provider: process.env.EVOPILOT_REAL_PROJECT_PROVIDER ?? "local-git",
    gitUrl: optionalEnv("EVOPILOT_REAL_PROJECT_GIT_URL"),
    root: optionalEnv("EVOPILOT_REAL_PROJECT_ROOT"),
    baseUrl: optionalEnv("EVOPILOT_REAL_PROJECT_BASE_URL"),
    projectId: optionalEnv("EVOPILOT_REAL_PROJECT_REMOTE_ID"),
    owner: optionalEnv("EVOPILOT_REAL_PROJECT_OWNER"),
    repo: optionalEnv("EVOPILOT_REAL_PROJECT_REPO"),
    defaultBranch: process.env.EVOPILOT_REAL_PROJECT_DEFAULT_BRANCH ?? process.env.EVOPILOT_REAL_PROJECT_BRANCH ?? "main",
    username: optionalEnv("EVOPILOT_REAL_PROJECT_USERNAME"),
    password: optionalEnv("EVOPILOT_REAL_PROJECT_PASSWORD"),
    token: optionalEnv("EVOPILOT_REAL_PROJECT_TOKEN"),
    tokenRef: optionalEnv("EVOPILOT_REAL_PROJECT_TOKEN_REF")
  };
}

function assertProjectRegistrationReady(repository) {
  if (!["local-git", "gitlab", "github"].includes(repository.provider)) {
    throw new Error(`EVOPILOT_REAL_PROJECT_PROVIDER 只能是 local-git、gitlab 或 github，当前为：${repository.provider}`);
  }
  if (repository.provider === "local-git") {
    assert.ok(repository.root, "local-git 项目注册必须配置 EVOPILOT_REAL_PROJECT_ROOT");
    assert.ok(fs.existsSync(repository.root), `真实项目目录不存在：${repository.root}`);
    assert.ok(fs.existsSync(path.join(repository.root, ".git")), `真实项目必须是 Git 仓库：${repository.root}`);
    return;
  }
  const hasCredential = Boolean(repository.token || repository.password || repository.tokenRef);
  assert.ok(hasCredential, `${repository.provider} 项目注册必须配置 EVOPILOT_REAL_PROJECT_TOKEN、EVOPILOT_REAL_PROJECT_PASSWORD 或 EVOPILOT_REAL_PROJECT_TOKEN_REF`);
  if (repository.provider === "gitlab") {
    assert.ok(repository.gitUrl || (repository.baseUrl && repository.projectId), "GitLab 项目注册必须配置 EVOPILOT_REAL_PROJECT_GIT_URL 或 EVOPILOT_REAL_PROJECT_BASE_URL + EVOPILOT_REAL_PROJECT_REMOTE_ID");
  }
  if (repository.provider === "github") {
    assert.ok(repository.gitUrl || (repository.owner && repository.repo), "GitHub 项目注册必须配置 EVOPILOT_REAL_PROJECT_GIT_URL 或 EVOPILOT_REAL_PROJECT_OWNER + EVOPILOT_REAL_PROJECT_REPO");
  }
}

function optionalEnv(key) {
  return process.env[key]?.trim() || undefined;
}

function configured(key) {
  if (process.env[key]?.trim()) return true;
  if (key === "EVOPILOT_CODE_UPGRADER_BASE_URL") return Boolean(process.env.EVOPILOT_REAL_OPENHANDS_BASE_URL?.trim());
  if (key === "EVOPILOT_PRODUCT_JENKINS_BASE_URL") return Boolean(process.env.EVOPILOT_REAL_JENKINS_BASE_URL?.trim());
  if (key === "EVOPILOT_PRODUCT_JENKINS_JOB") return Boolean(process.env.EVOPILOT_REAL_JENKINS_JOB?.trim());
  return false;
}

function envFirst(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function productJenkinsBaseUrl() {
  return envFirst("EVOPILOT_PRODUCT_JENKINS_BASE_URL", "EVOPILOT_REAL_JENKINS_BASE_URL") ?? "http://127.0.0.1:8080";
}

function productJenkinsJob() {
  return envFirst("EVOPILOT_PRODUCT_JENKINS_JOB", "EVOPILOT_REAL_JENKINS_JOB") ?? "evopilot-evolution-delivery";
}

function codeUpgraderBaseUrl() {
  return envFirst("EVOPILOT_CODE_UPGRADER_BASE_URL", "EVOPILOT_REAL_OPENHANDS_BASE_URL") ?? "http://127.0.0.1:3000";
}

async function startProductInternalRuntimes() {
  if (String(process.env.EVOPILOT_START_INTERNAL_RUNTIMES ?? "true").toLowerCase() === "false") return [];
  const runtimes = [];
  runtimes.push(await startInternalCodeUpgrader({ port: portFromUrl(codeUpgraderBaseUrl(), 3000) }));
  runtimes.push(await startInternalProductCicd({ port: portFromUrl(productJenkinsBaseUrl(), 8080) }));
  return runtimes;
}

async function closeProductInternalRuntimes(runtimes) {
  for (const runtime of runtimes.reverse()) {
    await runtime.close();
  }
}

function portFromUrl(value, fallback) {
  try {
    const url = new URL(value);
    return Number(url.port || (url.protocol === "https:" ? 443 : 80));
  } catch {
    return fallback;
  }
}

function maskProjectRepository(repository) {
  return {
    provider: repository.provider,
    gitUrl: repository.gitUrl,
    root: repository.root,
    baseUrl: repository.baseUrl,
    projectId: repository.projectId,
    owner: repository.owner,
    repo: repository.repo,
    defaultBranch: repository.defaultBranch,
    credentialsConfigured: Boolean(repository.token || repository.password || repository.tokenRef)
  };
}

function classifyProductionBlocker(message) {
  if (/\/code-upgrade failed: 500 .*fetch failed/.test(message) || /OPENHANDS|code-upgrade/i.test(message) && /fetch failed/.test(message)) {
    return {
      status: "BLOCKED",
      reason: "EvoPilot 内置代码升级执行器未启动或不可达；不会降级为 mock。",
      component: "code-upgrader",
      expectedBaseUrl: codeUpgraderBaseUrl(),
      detail: message
    };
  }
  if (/jenkins|pipeline|CI\/CD/i.test(message) && /fetch failed/.test(message)) {
    return {
      status: "BLOCKED",
      reason: "EvoPilot 产品托管 CI/CD 运行时未启动或不可达；不会降级为 mock。",
      component: "product-cicd",
      expectedBaseUrl: productJenkinsBaseUrl(),
      expectedJob: productJenkinsJob(),
      detail: message
    };
  }
  return undefined;
}

async function post(pathname, body, role) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${token(role)}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.ok(response.ok, `${pathname} failed: ${response.status} ${text}`);
  return JSON.parse(text).data;
}

async function get(pathname, role) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { "authorization": `Bearer ${token(role)}` }
  });
  const text = await response.text();
  assert.ok(response.ok, `${pathname} failed: ${response.status} ${text}`);
  return JSON.parse(text).data;
}

async function getText(pathname, role) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { "authorization": `Bearer ${token(role)}` }
  });
  const text = await response.text();
  assert.ok(response.ok, `${pathname} failed: ${response.status} ${text}`);
  return text;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      const result = { code, stdout, stderr };
      if (code === 0 || options.allowFailure) resolve(result);
      else reject(new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`));
    });
  });
}

function writeAskPass(repository) {
  const file = path.join(os.tmpdir(), `evopilot-e2e-askpass-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  const username = repository.username || (repository.token ? "oauth2" : "git");
  const password = repository.password || repository.token || "";
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

function shellQuote(value) {
  return String(value).replace(/'/g, "'\\''");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function token(role) {
  return {
    admin: "production-e2e-admin-token",
    operator: "production-e2e-operator-token",
    viewer: "production-e2e-viewer-token"
  }[role];
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}
