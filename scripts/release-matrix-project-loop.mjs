import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

loadEnvFile(process.env.EVOPILOT_LLM_ENV_FILE ?? "data/evopilot/llm.env");
loadEnvFile(process.env.EVOPILOT_PRODUCTION_E2E_ENV_FILE ?? "data/evopilot/production-e2e.env");

const baseUrl = process.env.EVOPILOT_BASE_URL ?? "http://127.0.0.1:19876";
const token = process.env.EVOPILOT_API_TOKEN ?? "evopilot-48h-local-token";
const projectPrefix = process.env.EVOPILOT_RELEASE_MATRIX_PROJECT_PREFIX ?? "prs-";
const projectIds = (process.env.EVOPILOT_RELEASE_MATRIX_PROJECT_IDS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const projectLimit = Number(process.env.EVOPILOT_RELEASE_MATRIX_PROJECT_LIMIT ?? 0);
const timeoutMs = Number(process.env.EVOPILOT_RELEASE_MATRIX_TIMEOUT_MS ?? 20 * 60 * 1000);
const pollMs = Number(process.env.EVOPILOT_RELEASE_MATRIX_POLL_MS ?? 5000);
const projectAttempts = Math.max(1, Math.min(5, Number(process.env.EVOPILOT_RELEASE_MATRIX_PROJECT_ATTEMPTS ?? 3)));
const gitlabBaseUrl = envFirst("EVOPILOT_RELEASE_MATRIX_GITLAB_BASE_URL", "EVOPILOT_REAL_PROJECT_BASE_URL") ?? "https://gitlab.transwarp.io";
const gitlabToken = envFirst("EVOPILOT_RELEASE_MATRIX_GITLAB_TOKEN", "EVOPILOT_REAL_PROJECT_TOKEN") ?? "";
const gitlabUsername = envFirst("EVOPILOT_RELEASE_MATRIX_GITLAB_USERNAME", "EVOPILOT_REAL_PROJECT_USERNAME") ?? "oauth2";
const gitlabNamespaceId = envFirst("EVOPILOT_RELEASE_MATRIX_GITLAB_NAMESPACE_ID") ?? "";
const validationCommands = (process.env.EVOPILOT_RELEASE_MATRIX_VALIDATION_COMMANDS ?? "npm run validate")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const projects = (await get("/api/v1/projects"))
  .filter((project) => project.id.startsWith(projectPrefix))
  .filter((project) => projectIds.length === 0 || projectIds.includes(project.id))
  .sort((left, right) => left.id.localeCompare(right.id))
  .slice(0, projectLimit > 0 ? projectLimit : undefined);

if (projects.length === 0) {
  throw new Error(`未发现 ${projectPrefix} 开头的生产代表性项目，不能生成 release matrix 项目级证据。`);
}

const results = [];
for (const project of projects) {
  results.push(await exerciseProjectWithRetry(await ensureRepositoryNativeDevops(project)));
}

const failed = results.filter((item) => item.status !== "PASSED");
const output = {
  status: failed.length === 0 ? "PASSED" : "BLOCKED",
  mode: "product-api-driven-release-matrix-project-loop",
  projectPrefix,
  projectIds,
  projectLimit: projectLimit > 0 ? projectLimit : undefined,
  projectCount: projects.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results
};

console.log(JSON.stringify(output, null, 2));
if (failed.length > 0) process.exit(2);

async function exerciseProjectWithRetry(project) {
  const attempts = [];
  for (let attempt = 1; attempt <= projectAttempts; attempt += 1) {
    const result = await exerciseProject(project, attempt);
    attempts.push({
      attempt,
      status: result.status,
      blocker: result.blocker,
      codeUpgradeRunId: result.codeUpgradeRunId,
      pipelineRunId: result.pipelineRunId
    });
    if (result.status === "PASSED") {
      return {
        ...result,
        attempts
      };
    }
  }
  return {
    ...attempts.at(-1),
    projectId: project.id,
    status: "BLOCKED",
    attempts
  };
}

async function exerciseProject(project, attempt = 1) {
  const startedAt = new Date().toISOString();
  try {
    assert.equal(project.validation?.status, "VERIFIED", `${project.id} 项目注册未验证通过`);
    assert.ok(project.repository?.provider, `${project.id} 缺少 repository.provider`);
    assert.ok(project.devops?.provider === "github-actions" || project.devops?.provider === "gitlab-ci", `${project.id} 缺少 GitHub Actions/GitLab CI DevOps 配置`);

    const run = await post("/api/v1/runs", {
      projectId: project.id,
      now: new Date().toISOString(),
      events: representativeEvents(project),
      files: representativeFiles(project)
    });
    assert.ok(run.opportunities.length > 0, `${project.id} 没有从真实代表性事件形成机会点`);
    assert.equal(run.reviews[0].status, "USER_CONFIRM_REQUIRED");

    const review = await post(`/api/v1/reviews/${encodeURIComponent(run.reviews[0].id)}/decision`, {
      action: "accept",
      actor: "release-matrix-governor",
      note: `确认 ${project.id} 代表性项目进入 GA release matrix 闭环。`
    });
    assert.equal(review.status, "USER_CONFIRMED");

    const codeUpgrade = await post(`/api/v1/deliveries/${encodeURIComponent(run.deliveryPlans[0].id)}/code-upgrade`, {
      connectorId: "default",
      proposalMarkdown: proposalMarkdown(project),
      validationCommands
    });
    const codeUpgradeRun = await waitForTerminal(
      `/api/v1/code-upgrade-runs/${encodeURIComponent(codeUpgrade.codeUpgradeRun.id)}`,
      `${project.id} code upgrade`,
      (item) => ["SUCCEEDED", "FAILED", "CANCELED"].includes(item.status)
    );
    assert.equal(codeUpgradeRun.status, "SUCCEEDED", `${project.id} 代码升级未成功：${JSON.stringify(codeUpgradeRun)}`);
    assert.ok((codeUpgradeRun.artifacts?.changedFiles ?? []).some((file) => !file.startsWith(".evopilot/upgrades/")), `${project.id} 代码升级没有产生项目实现变更`);

    const pipelineStart = await post(`/api/v1/deliveries/${encodeURIComponent(run.deliveryPlans[0].id)}/execute`, {
      executor: project.devops.provider,
      parameters: {
        GIT_URL: project.repository?.gitUrl,
        GIT_USERNAME: gitlabUsername,
        GIT_TOKEN: gitlabToken,
        PROJECT_ID: project.id,
        VERSION: `ga-matrix-${Date.now()}`
      }
    });
    const pipeline = await waitForTerminal(
      `/api/v1/pipelines/${encodeURIComponent(pipelineStart.pipelineRun.id)}`,
      `${project.id} native DevOps pipeline`,
      (item) => ["SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN"].includes(item.status)
    );
    assert.equal(pipeline.status, "SUCCEEDED", `${project.id} CI/CD 未成功：${JSON.stringify(pipeline)}`);

    return {
      projectId: project.id,
      status: "PASSED",
      startedAt,
      finishedAt: new Date().toISOString(),
      attempt,
      runId: run.id,
      reviewId: review.id,
      codeUpgradeRunId: codeUpgradeRun.id,
      codeUpgradeStatus: codeUpgradeRun.status,
      changedFiles: codeUpgradeRun.artifacts?.changedFiles ?? [],
      pipelineRunId: pipeline.id,
      pipelineStatus: pipeline.status,
      buildUrl: pipeline.buildUrl,
      evidence: [
        "POST /api/v1/runs generated opportunities",
        "POST /api/v1/reviews/{id}/decision confirmed user gate",
        "POST /api/v1/deliveries/{id}/code-upgrade produced implementation changes",
        "POST /api/v1/deliveries/{id}/execute reached repository-native DevOps SUCCEEDED"
      ]
    };
  } catch (error) {
    return {
      projectId: project.id,
      status: "BLOCKED",
      attempt,
      startedAt,
      finishedAt: new Date().toISOString(),
      blocker: error instanceof Error ? error.message : String(error)
    };
  }
}

async function ensureRepositoryNativeDevops(project) {
  if (project.devops?.provider === "github-actions" || project.devops?.provider === "gitlab-ci") return project;
  if (project.repository?.provider !== "local-git") {
    const provider = project.repository?.provider === "github" ? "github-actions" : project.repository?.provider === "gitlab" ? "gitlab-ci" : undefined;
    assert.ok(provider, `${project.id} 只能绑定 GitHub Actions 或 GitLab CI DevOps`);
    return await post(`/api/v1/projects/${encodeURIComponent(project.id)}/devops`, releaseMatrixDevops(provider)).then((result) => result.project);
  }
  if (!gitlabToken) return project;
  const root = project.repository?.root;
  if (!root || !fs.existsSync(root)) return project;

  const remote = await ensureGitlabProject(project);
  const defaultBranch = await pushLocalRepository(root, remote.httpUrl, project.id);
  const registered = await post("/api/v1/projects", {
    id: project.id,
    name: project.name,
    profileId: project.profileId,
    repository: {
      provider: "gitlab",
      gitUrl: remote.httpUrl,
      baseUrl: gitlabBaseUrl,
      projectId: remote.pathWithNamespace,
      defaultBranch,
      username: gitlabUsername,
      token: gitlabToken
    },
    devops: releaseMatrixDevops("gitlab-ci", defaultBranch)
  });
  assert.equal(registered.validation?.status, "VERIFIED", `${project.id} GitLab 注册未验证通过：${registered.validation?.message}`);
  return registered;
}

async function ensureGitlabProject(project) {
  const pathName = safePath(`octopus-${project.id}`);
  const existing = await gitlabJson(`/api/v4/projects/${encodeURIComponent(`${gitlabNamespacePath()}/${pathName}`)}`, { allow404: true });
  if (existing && !existing.error) {
    return { id: existing.id, httpUrl: existing.http_url_to_repo, pathWithNamespace: existing.path_with_namespace };
  }
  const namespaceId = gitlabNamespaceId || await resolveGitlabNamespaceId();
  const created = await gitlabJson("/api/v4/projects", {
    method: "POST",
    body: {
      name: pathName,
      path: pathName,
      namespace_id: namespaceId,
      visibility: process.env.EVOPILOT_RELEASE_MATRIX_GITLAB_VISIBILITY ?? "internal",
      initialize_with_readme: false
    }
  });
  return { id: created.id, httpUrl: created.http_url_to_repo, pathWithNamespace: created.path_with_namespace };
}

async function resolveGitlabNamespaceId() {
  const namespaces = await gitlabJson("/api/v4/namespaces?per_page=100");
  const user = await gitlabJson("/api/v4/user");
  const namespace = namespaces.find((item) => item.kind === "user" && item.path === user.username) ?? namespaces.find((item) => item.kind === "user");
  if (!namespace) throw new Error("无法解析用于生产代表性项目的 GitLab namespace。");
  return namespace.id;
}

function gitlabNamespacePath() {
  return process.env.EVOPILOT_RELEASE_MATRIX_GITLAB_NAMESPACE_PATH ?? "yeliang.wang";
}

async function gitlabJson(pathname, options = {}) {
  const response = await fetch(`${gitlabBaseUrl.replace(/\/+$/, "")}${pathname}`, {
    method: options.method ?? "GET",
    headers: {
      "PRIVATE-TOKEN": gitlabToken,
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  if (options.allow404 && response.status === 404) return { error: "NOT_FOUND" };
  assert.ok(response.ok, `${pathname} failed: ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function pushLocalRepository(root, httpUrl, projectId) {
  const askpass = writeAskPass();
  const env = { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0" };
  const branch = process.env.EVOPILOT_RELEASE_MATRIX_SOURCE_BRANCH?.trim()
    || `release-matrix-${safePath(projectId)}-${Date.now()}`;
  try {
    await run("git", ["remote", "remove", "octopus-release-matrix"], { cwd: root, env, allowFailure: true });
    await run("git", ["remote", "add", "octopus-release-matrix", httpUrl], { cwd: root, env });
    await run("git", ["push", "-u", "octopus-release-matrix", `main:refs/heads/${branch}`], { cwd: root, env });
    return branch;
  } finally {
    fs.rmSync(askpass, { force: true });
  }
}

function writeAskPass() {
  const file = path.join(process.env.TMPDIR ?? "/tmp", `evopilot-gitlab-askpass-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  fs.writeFileSync(file, [
    "#!/bin/sh",
    "case \"$1\" in",
    `*Username*) printf '%s\\n' '${shellQuote(gitlabUsername || "oauth2")}' ;;`,
    `*) printf '%s\\n' '${shellQuote(gitlabToken)}' ;;`,
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
      if (code === 0 || options.allowFailure) resolve(result);
      else reject(new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`));
    });
  });
}

function representativeEvents(project) {
  const now = new Date().toISOString();
  return [
    {
      id: `${project.id}-ga-latency-${Date.now()}`,
      type: "agent.trace",
      source: "production-representative-sandbox",
      timestamp: now,
      severity: "HIGH",
      message: `${project.name} 代表性生产链路超过 GA 阈值，需要产品级进化闭环。`,
      traceId: `${project.id}-trace-${Date.now()}`,
      module: project.profileId ?? project.id,
      attributes: {
        durationMs: 3650,
        latencyMs: 3650,
        p95LatencyMs: 3600,
        releaseMatrixProject: true
      }
    }
  ];
}

function representativeFiles(project) {
  const root = project.repository?.root;
  if (!root || !fs.existsSync(root)) return ["src", "tests", "package.json"];
  return ["src", "tests", "package.json"].filter((item) => fs.existsSync(path.join(root, item)));
}

function proposalMarkdown(project) {
  return [
    `# ${project.name} GA Release Matrix Upgrade`,
    "",
    "## Goal",
    "",
    "Use the registered production representative project to prove EvoPilot can drive a full project-level evolution loop through code upgrade and repository-native CI/CD.",
    "",
    "## Required Change",
    "",
    "- Add or adjust a small production-facing implementation or test artifact under the existing project source tree.",
    "- Keep the change inside the repository's allowed implementation, test, script, or configuration paths.",
    "- Preserve existing validation commands and make `npm run validate` pass.",
    "",
    "## Evidence",
    "",
    `- Project ID: ${project.id}`,
    `- Repository provider: ${project.repository?.provider}`,
    `- DevOps provider: ${project.devops?.provider ?? "not-configured"}`
  ].join("\n");
}

function releaseMatrixDevops(provider, ref) {
  if (provider === "github-actions") {
    return {
      provider,
      ci: {
        workflow: envFirst("EVOPILOT_RELEASE_MATRIX_GITHUB_WORKFLOW", "EVOPILOT_REAL_PROJECT_CI_WORKFLOW") ?? "ci.yml",
        ref,
        requiredChecks: listEnv("EVOPILOT_RELEASE_MATRIX_GITHUB_REQUIRED_CHECKS", "EVOPILOT_REAL_PROJECT_REQUIRED_CHECKS"),
        timeoutSeconds: Number(process.env.EVOPILOT_RELEASE_MATRIX_CI_TIMEOUT_SECONDS ?? 1800)
      }
    };
  }
  return {
    provider: "gitlab-ci",
    ci: {
      ref,
      requiredStages: (envFirst("EVOPILOT_RELEASE_MATRIX_GITLAB_REQUIRED_STAGES", "EVOPILOT_REAL_PROJECT_REQUIRED_STAGES") ?? "test")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      requiredJobs: listEnv("EVOPILOT_RELEASE_MATRIX_GITLAB_REQUIRED_JOBS", "EVOPILOT_REAL_PROJECT_REQUIRED_JOBS"),
      timeoutSeconds: Number(process.env.EVOPILOT_RELEASE_MATRIX_CI_TIMEOUT_SECONDS ?? 1800)
    }
  };
}

function safePath(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function shellQuote(value) {
  return String(value).replace(/'/g, "'\\''");
}

async function waitForTerminal(pathname, label, done) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await get(pathname);
    if (done(last)) return last;
    await sleep(pollMs);
  }
  throw new Error(`${label} 等待超时：${JSON.stringify(last)}`);
}

async function get(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const text = await response.text();
  assert.ok(response.ok, `${pathname} failed: ${response.status} ${text}`);
  return JSON.parse(text).data;
}

async function post(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.ok(response.ok, `${pathname} failed: ${response.status} ${text}`);
  return JSON.parse(text).data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function envFirst(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function listEnv(...keys) {
  const value = envFirst(...keys) ?? "";
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
