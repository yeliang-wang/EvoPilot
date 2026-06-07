import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createLlmClientFromEnv } from "../packages/llm/dist/index.js";

const sessions = new Map();

export async function startInternalCodeUpgrader(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = Number(options.port ?? 3000);
  const dataRoot = options.dataRoot ?? process.env.EVOPILOT_CODE_UPGRADER_DATA_ROOT ?? path.join(os.tmpdir(), "evopilot-code-upgrader-runtime");
  fs.mkdirSync(path.join(dataRoot, "sessions"), { recursive: true });
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${host}:${port}`);
      if (request.method === "GET" && url.pathname === "/health") {
        return writeJson(response, 200, { status: "UP", service: "evopilot-code-upgrader" });
      }
      if (request.method === "GET" && url.pathname === "/api/v1/health") {
        return writeJson(response, 200, { status: "UP", service: "evopilot-code-upgrader" });
      }
      if (request.method === "POST" && url.pathname === "/api/v1/conversations") {
        const body = JSON.parse(await readBody(request));
        const id = `upgrade-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const session = {
          workspaceId: `workspace-${id}`,
          conversationId: id,
          status: "RUNNING",
          events: [],
          createdAt: new Date().toISOString(),
          dataRoot
        };
        sessions.set(id, session);
        persistSession(session);
        runUpgrade(id, body, dataRoot).catch((error) => {
          const current = sessions.get(id);
          if (!current) return;
          current.status = "FAILED";
          current.events.push(event("error", "升级失败", error instanceof Error ? error.message : String(error), "environment"));
          current.updatedAt = new Date().toISOString();
          persistSession(current);
        });
        return writeJson(response, 200, publicSession(session));
      }
      const match = url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)$/);
      if (request.method === "GET" && match) {
        const session = sessions.get(decodeURIComponent(match[1]));
        if (!session) return writeJson(response, 404, { error: "SESSION_NOT_FOUND" });
        return writeJson(response, 200, publicSession(session));
      }
      response.writeHead(404);
      response.end("not found");
    } catch (error) {
      writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    baseUrl: `http://${host}:${actualPort}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function runUpgrade(id, body, dataRoot) {
  const session = sessions.get(id);
  if (!session) return;
  const repository = body.repository ?? {};
  const branchStrategy = body.branchStrategy ?? {};
  const sourceBranch = branchStrategy.sourceBranch ?? repository.sourceBranch ?? repository.branch ?? "main";
  const upgradeBranch = branchStrategy.upgradeBranch ?? `evopilot/upgrade/${id}`;
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-code-upgrader-"));
  const repoDir = path.join(workspaceRoot, "repo");
  const askpass = writeAskPass(repository);
  const gitEnv = { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0" };
  try {
    session.events.push(event("info", "读取方案", "已接收 EvoPilot 进化方案和分支策略。"));
    persistSession(session);
    const repoSource = repository.root || repository.gitUrl;
    if (!repoSource) throw new Error("repository.root 或 repository.gitUrl 必须提供");
    session.events.push(event("info", "克隆仓库", `从 ${repository.gitUrl ?? repository.root} 克隆源分支 ${sourceBranch}。`, "tool", { command: "git clone" }));
    await git(["clone", "--branch", sourceBranch, repoSource, repoDir], { env: gitEnv });
    await git(["config", "user.name", "EvoPilot Code Upgrader"], { cwd: repoDir, env: gitEnv });
    await git(["config", "user.email", "evopilot@local"], { cwd: repoDir, env: gitEnv });
    await git(["checkout", "-b", upgradeBranch], { cwd: repoDir, env: gitEnv });
    session.events.push(event("info", "创建分支", `已创建升级分支 ${upgradeBranch}。`, "tool", { command: `git checkout -b ${upgradeBranch}` }));
    persistSession(session);

    const protectedPaths = normalizePathList(body.protectedPaths ?? process.env.EVOPILOT_CODE_UPGRADER_PROTECTED_PATHS);
    const allowedPaths = normalizePathList(body.allowedPaths ?? process.env.EVOPILOT_CODE_UPGRADER_ALLOWED_PATHS ?? "src,app,server,lib,tests,test,scripts,config,package.json,pyproject.toml,requirements.txt,pom.xml,go.mod,Dockerfile,Jenkinsfile,.evopilot/runtime-upgrades,docs/evopilot-upgrades");
    const implementationPlan = await createImplementationPlan({ id, body, repoDir, protectedPaths, allowedPaths, sourceBranch, upgradeBranch });
    session.llmTrace = implementationPlan.llmTrace;
    session.events.push(event("info", "生成升级计划", `已生成 ${implementationPlan.edits.length} 个文件级升级动作。`, "agent", {
      mode: implementationPlan.mode,
      edits: implementationPlan.edits.map((edit) => ({ path: edit.path, reason: edit.reason }))
    }));
    persistSession(session);

    const changedImplementationFiles = [];
    for (const edit of implementationPlan.edits) {
      const relativePath = normalizeRelativePath(edit.path);
      assertAllowedPath(relativePath, allowedPaths, protectedPaths);
      const target = path.join(repoDir, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, sanitizeGeneratedContent(edit.content, relativePath), "utf8");
      changedImplementationFiles.push(relativePath);
      session.events.push(event("info", "写入升级实现", `已写入 ${relativePath}。`, "tool", { file: relativePath, reason: edit.reason }));
    }
    await runGeneratedQualityGateWithRepair({
      id,
      body,
      repoDir,
      env: gitEnv,
      session,
      allowedPaths,
      protectedPaths,
      changedFiles: changedImplementationFiles
    });

    const evidenceDir = path.join(repoDir, ".evopilot", "upgrades");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const evidenceFile = path.join(evidenceDir, `${safeFileName(id)}.md`);
    fs.writeFileSync(evidenceFile, sanitizeGeneratedContent(renderEvidenceFile(body, sourceBranch, upgradeBranch), evidenceFile), "utf8");
    session.events.push(event("info", "写入变更", `已写入代码升级证据文件 ${path.relative(repoDir, evidenceFile)}。`, "tool", { file: path.relative(repoDir, evidenceFile), diffStat: "+1 file" }));

    await git(["add", ".evopilot/upgrades", ...changedImplementationFiles], { cwd: repoDir, env: gitEnv });
    await git(["diff", "--cached", "--check"], { cwd: repoDir, env: gitEnv });
    let cachedFiles = (await git(["diff", "--cached", "--name-only"], { cwd: repoDir, env: gitEnv })).stdout.trim().split(/\r?\n/).filter(Boolean);
    const nonEvidenceFiles = cachedFiles.filter((file) => !file.startsWith(".evopilot/upgrades/"));
    let productImplementationFiles = nonEvidenceFiles.filter(isProductImplementationFile);
    if (productImplementationFiles.length === 0) {
      throw new Error("代码升级没有产生真实项目实现、测试、脚本或配置变更，已阻断提交。仅写入 .evopilot 或 docs/evopilot-upgrades 不能视为生产代码升级。");
    }
    for (const file of cachedFiles) assertAllowedPath(file, [".evopilot/upgrades", ...allowedPaths], protectedPaths);
    await git(["commit", "-m", branchStrategy.commitMessage ?? `EvoPilot: ${id}`], { cwd: repoDir, env: gitEnv });
    let commitSha = (await git(["rev-parse", "HEAD"], { cwd: repoDir, env: gitEnv })).stdout.trim();
    session.events.push(event("info", "提交代码", `已提交升级变更 ${commitSha.slice(0, 12)}。`, "tool", { command: "git commit" }));

    const validationPlan = normalizeValidationPlan(body.validationPlan);
    await preflightValidationRuntime(validationPlan, session);
    const validationCommands = normalizeValidationCommands(body.validationCommands, body.initialUserMessage);
    const repairAttempts = normalizeRepairAttempts();
    const validationRepairHistory = [];
    for (let attempt = 0; ; attempt += 1) {
      try {
        await runValidation({ repoDir, env: gitEnv, session, validationPlan, validationCommands });
        break;
      } catch (error) {
        validationRepairHistory.push({
          attempt: attempt + 1,
          phase: "validation",
          error: error instanceof Error ? error.message : String(error),
          occurredAt: new Date().toISOString()
        });
        if (attempt >= repairAttempts) {
          throw classifiedError(
            "VALIDATION_REPAIR_EXHAUSTED",
            `验证失败自动修复已耗尽 ${repairAttempts} 次，仍未通过。最近失败：${lastRepairError(validationRepairHistory)}`,
            error
          );
        }
        await repairValidationFailure({
          id,
          body,
          repoDir,
          env: gitEnv,
          session,
          error,
          allowedPaths,
          protectedPaths,
          changedFiles: cachedFiles,
          attempt: attempt + 1,
          maxAttempts: repairAttempts,
          repairHistory: validationRepairHistory
        });
        cachedFiles = (await git(["diff", "--name-only", "HEAD~1..HEAD"], { cwd: repoDir, env: gitEnv })).stdout.trim().split(/\r?\n/).filter(Boolean);
        productImplementationFiles = cachedFiles.filter(isProductImplementationFile);
        if (productImplementationFiles.length === 0) throw new Error("自动修复后没有真实项目实现、测试、脚本或配置变更，已阻断。");
      }
    }
    commitSha = (await git(["rev-parse", "HEAD"], { cwd: repoDir, env: gitEnv })).stdout.trim();
    const diff = (await git(["show", "--stat", "--patch", "--find-renames", "--find-copies", "HEAD"], { cwd: repoDir, env: gitEnv })).stdout;

    let pullRequestUrl = branchUrl(repository.gitUrl, upgradeBranch);
    if (repository.gitUrl && repository.provider !== "local-git") {
      const push = await git([
        "push",
        "-o", "merge_request.create",
        "-o", `merge_request.target=${sourceBranch}`,
        "-o", `merge_request.title=${branchStrategy.mergeRequestTitle ?? `EvoPilot ${id}`}`,
        "origin",
        `HEAD:${upgradeBranch}`
      ], { cwd: repoDir, env: gitEnv, allowFailure: true });
      if (push.code !== 0) throw new Error(push.stderr || push.stdout || "git push failed");
      pullRequestUrl = extractUrl(push.stdout + "\n" + push.stderr) ?? mergeRequestNewUrl(repository.gitUrl, sourceBranch, upgradeBranch) ?? pullRequestUrl;
      session.events.push(event("info", "推送分支", `验证通过后已推送升级分支并请求创建合并请求：${pullRequestUrl}`));
    }

    Object.assign(session, {
      status: "SUCCEEDED",
      branchName: upgradeBranch,
      commitSha,
      pullRequestUrl,
      diff,
      changedFiles: cachedFiles,
      implementationFiles: productImplementationFiles,
      workspaceRoot: path.join(dataRoot, "sessions", id),
      updatedAt: new Date().toISOString()
    });
    session.events.push(event("info", "升级完成", "代码升级、分支推送和验证已完成。"));
    persistSession(session);
    persistWorkspaceSnapshot(repoDir, path.join(dataRoot, "sessions", id));
  } finally {
    fs.rmSync(askpass, { force: true });
    if (process.env.EVOPILOT_CODE_UPGRADER_KEEP_WORKSPACE !== "true") fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

async function runGeneratedQualityGateWithRepair({ id, body, repoDir, env, session, allowedPaths, protectedPaths, changedFiles }) {
  const repairAttempts = normalizeRepairAttempts();
  for (let attempt = 0; ; attempt += 1) {
    try {
      await runGeneratedQualityGate({ repoDir, env, session, files: changedFiles });
      return;
    } catch (error) {
      if (attempt >= repairAttempts) throw error;
      try {
        await repairGeneratedFiles({
          id,
          body,
          repoDir,
          env,
          session,
          error,
          allowedPaths,
          protectedPaths,
          changedFiles,
          attempt: attempt + 1,
          maxAttempts: repairAttempts,
          commitMode: "none"
        });
      } catch (repairError) {
        if (attempt + 1 >= repairAttempts) throw repairError;
      }
    }
  }
}

async function createImplementationPlan(args) {
  const llm = createLlmClientFromEnv();
  const fallback = deterministicImplementationPlan(args);
  if (!llm) {
    if (process.env.EVOPILOT_RUN_MODE === "prod") throw new Error("生产模式必须配置真实 LLM 后才能执行代码升级。");
    return fallback;
  }
  const prompt = renderImplementationPlanPrompt(args);
  const response = await llm.generate({
    caller: "evopilot-code-upgrader",
    intent: "structured.extraction",
    profile: "json-extractor",
    jsonObject: true,
    outputContract: "json_object",
    maxOutputTokens: Number(process.env.EVOPILOT_CODE_UPGRADER_LLM_MAX_OUTPUT_TOKENS ?? 16000),
    temperature: 0,
    prompt
  });
  if (!response.success) {
    if (process.env.EVOPILOT_RUN_MODE === "prod") throw new Error(`代码升级 LLM 计划生成失败：${response.errorMessage ?? response.errorCode}`);
    return { ...fallback, llmTrace: toLlmTrace(response), mode: "debug-fallback" };
  }
  const parsed = parseJsonObject(response.text);
  const edits = Array.isArray(parsed.edits) ? parsed.edits.map(normalizeEdit).filter(Boolean) : [];
  if (edits.length === 0) {
    if (process.env.EVOPILOT_RUN_MODE === "prod") throw new Error("代码升级 LLM 未返回有效文件级升级动作。");
    return { ...fallback, llmTrace: toLlmTrace(response), mode: "debug-fallback" };
  }
  return { mode: "llm", edits, llmTrace: toLlmTrace(response) };
}

async function repairValidationFailure(args) {
  await repairGeneratedFiles({ ...args, commitMode: "amend" });
}

async function repairGeneratedFiles({ id, body, repoDir, env, session, error, allowedPaths, protectedPaths, changedFiles, attempt = 1, maxAttempts = 1, commitMode = "none", repairHistory = [] }) {
  const llm = createLlmClientFromEnv();
  if (!llm || process.env.EVOPILOT_RUN_MODE === "prod" && process.env.EVOPILOT_CODE_UPGRADER_DISABLE_REPAIR === "true") {
    throw error;
  }
  const errorText = error instanceof Error ? error.message : String(error);
  const repairTarget = commitMode === "amend" ? "验证失败" : "提交前质量门禁失败";
  session.events.push(event("warn", "自动修复", `${repairTarget}，代码升级器将基于错误日志进行真实 LLM 自修复（第 ${attempt}/${maxAttempts} 次）。`, "agent", { error: errorText.slice(0, 2000) }));
  persistSession(session);
  const files = uniqueStrings(changedFiles.filter((file) => isProductImplementationFile(file))).map((file) => ({
    path: file,
    content: fs.existsSync(path.join(repoDir, file)) ? fs.readFileSync(path.join(repoDir, file), "utf8").slice(0, 12000) : ""
  }));
  const response = await llm.generate({
    caller: "evopilot-code-upgrader",
    intent: "structured.extraction",
    profile: "json-extractor",
    jsonObject: true,
    outputContract: "json_object",
    maxOutputTokens: Number(process.env.EVOPILOT_CODE_UPGRADER_LLM_MAX_OUTPUT_TOKENS ?? 16000),
    temperature: 0,
    prompt: [
      "你是 EvoPilot 代码升级执行器的验证失败修复器。只返回 JSON 对象，不要 Markdown。",
      "目标：根据验证失败日志，对当前已生成文件做最小修复，使验证命令通过。",
      "严格要求：",
      "1. 只能返回 edits 数组。",
      "2. 每个 edit 包含 path、content、reason。",
      "3. path 必须是当前已变更的真实项目文件之一，不能新增无关文件。",
      "4. content 必须是完整文件内容，不是 diff；不能省略、截断或写半行 import / 函数调用。",
      "5. 不允许修改 protectedPaths，不允许只修改 .evopilot 或 docs/evopilot-upgrades。",
      "",
      `任务 ID：${id}`,
      `allowedPaths：${allowedPaths.join(", ")}`,
      `protectedPaths：${protectedPaths.join(", ") || "无"}`,
      "",
      "验证失败日志：",
      errorText.slice(0, 6000),
      "",
      "历史失败与修复轨迹：",
      renderRepairHistory(repairHistory),
      "",
      "当前已生成文件：",
      files.map((file) => [`--- ${file.path} ---`, "```", file.content, "```"].join("\n")).join("\n\n"),
      "",
      "修复策略要求：",
      "- 必须同时满足历史失败日志和当前失败日志，不要在两个断言目标之间来回覆盖。",
      "- 优先修复实现代码；只有当测试断言与进化方案明显冲突时，才允许同步修正测试，但不能降低进化目标。",
      "- 如果失败来自测试互相矛盾，必须统一实现与测试语义，并在 reason 中说明统一后的语义。",
      "- 本轮返回的 edits 必须覆盖所有受影响文件的完整最终版本，保证重新验证可以一次通过。",
      "",
      "原始进化方案：",
      String(body.proposalMarkdown ?? body.initialUserMessage ?? "").slice(0, 8000)
    ].join("\n")
  });
  if (!response.success || !response.text.trim()) throw error;
  const parsed = parseJsonObject(response.text);
  const edits = Array.isArray(parsed.edits) ? parsed.edits.map(normalizeEdit).filter(Boolean) : [];
  if (edits.length === 0) throw error;
  const repairFiles = [];
  for (const edit of edits) {
    const relativePath = normalizeRelativePath(edit.path);
    if (!changedFiles.includes(relativePath)) throw new Error(`自动修复尝试修改未在本次升级中的文件：${relativePath}`);
    assertAllowedPath(relativePath, allowedPaths, protectedPaths);
    if (!isProductImplementationFile(relativePath)) throw new Error(`自动修复文件不是真实项目实现、测试、脚本或配置：${relativePath}`);
    fs.writeFileSync(path.join(repoDir, relativePath), sanitizeGeneratedContent(edit.content, relativePath), "utf8");
    repairFiles.push(relativePath);
    session.events.push(event("info", "自动修复", `已修复 ${relativePath}。`, "tool", { file: relativePath, reason: edit.reason }));
  }
  repairHistory.push({
    attempt,
    phase: commitMode === "amend" ? "validation-repair" : "quality-gate-repair",
    files: repairFiles,
    reasons: edits.map((edit) => edit.reason),
    occurredAt: new Date().toISOString()
  });
  await runGeneratedQualityGate({ repoDir, env, session, files: repairFiles });
  if (commitMode !== "amend") {
    persistSession(session);
    return;
  }
  await git(["add", ...repairFiles], { cwd: repoDir, env });
  await git(["diff", "--cached", "--check"], { cwd: repoDir, env });
  await git(["commit", "--amend", "--no-edit"], { cwd: repoDir, env });
  const commitSha = (await git(["rev-parse", "HEAD"], { cwd: repoDir, env })).stdout.trim();
  session.events.push(event("info", "自动修复", `验证失败修复已合入提交 ${commitSha.slice(0, 12)}，准备重新验证。`, "tool", { command: "git commit --amend" }));
  persistSession(session);
}

function renderImplementationPlanPrompt({ id, body, allowedPaths, protectedPaths, sourceBranch, upgradeBranch }) {
  const codeContext = Array.isArray(body.codeContext) ? body.codeContext : [];
  return [
    "你是 EvoPilot 代码升级执行器中的结构化补丁规划器。只返回 JSON 对象，不要 Markdown。",
    "目标：根据用户确认的进化方案生成可以落地到目标项目仓库的文件级修改。",
    "严格要求：",
    "1. 只能返回 edits 数组。",
    "2. 每个 edit 包含 path、content、reason。",
    "3. path 必须位于 allowedPaths 之一。",
    "4. 不允许修改 protectedPaths。",
    "5. content 必须是完整文件内容，不是 diff；不能省略、截断或写半行 import / 函数调用。",
    "6. 至少生成 1 个真实项目实现、测试、脚本或配置文件变更，不能只写 .evopilot 或 docs/evopilot-upgrades。",
    "7. .evopilot/runtime-upgrades 只作为执行契约，docs/evopilot-upgrades 只作为说明；它们不能替代真实代码升级。",
    "8. 如果修改已有文件，必须基于下面提供的当前代码完整改写，不能凭空猜测文件内容。",
    "",
    `任务 ID：${id}`,
    `源分支：${sourceBranch}`,
    `升级分支：${upgradeBranch}`,
    `allowedPaths：${allowedPaths.join(", ")}`,
    `protectedPaths：${protectedPaths.join(", ") || "无"}`,
    "",
    "建议同时输出：",
    "- 一个真实项目文件，例如 src/、app/、server/、tests/、scripts/、config/ 或项目根配置文件。",
    "- .evopilot/runtime-upgrades/<任务ID>.json，包含 version、taskId、target、changes、validation、createdAt 字段，作为目标项目内可版本化的升级实现契约。",
    "",
    "进化方案：",
    body.proposalMarkdown ?? body.initialUserMessage ?? "",
    "",
    "当前代码上下文：",
    codeContext.length > 0
      ? codeContext.map((file) => [
        `--- ${normalizeRelativePath(file.path)} ---`,
        "```",
        String(file.content ?? "").slice(0, 12000),
        "```"
      ].join("\n")).join("\n\n")
      : "未提供代码上下文。只能新增允许路径内的最小配置或测试文件，不能覆盖未知已有文件。",
    "",
    "返回示例：",
    "{\"edits\":[{\"path\":\"scripts/evopilot_upgrade_guard.json\",\"content\":\"{\\n  \\\"enabled\\\": true\\n}\\n\",\"reason\":\"为项目增加可执行升级配置\"},{\"path\":\".evopilot/runtime-upgrades/example.json\",\"content\":\"{\\n  \\\"version\\\": \\\"1\\\"\\n}\\n\",\"reason\":\"供 CI/CD 消费的升级实现契约\"}]}"
  ].join("\n");
}

function deterministicImplementationPlan({ id, body }) {
  return {
    mode: "deterministic",
    edits: [{
      path: `scripts/evopilot_upgrade_guard_${safeFileName(id)}.json`,
      reason: "生成目标项目内可执行的升级验证配置，供 CI/CD 和运行验证消费。",
      content: JSON.stringify({
        enabled: true,
        taskId: id,
        validation: normalizeValidationCommands(body.validationCommands, body.initialUserMessage),
        createdAt: new Date().toISOString()
      }, null, 2)
    }, {
      path: `.evopilot/runtime-upgrades/${safeFileName(id)}.json`,
      reason: "生成目标项目内可版本化的升级执行契约，供 CI/CD 和审计消费。",
      content: JSON.stringify({
        version: "1.0",
        taskId: id,
        target: "根据 EvoPilot 进化方案执行代码升级",
        changes: [
          "记录用户确认的进化方案",
          "声明代码升级执行入口",
          "向 CI/CD 暴露验证契约"
        ],
        validation: normalizeValidationCommands(body.validationCommands, body.initialUserMessage),
        createdAt: new Date().toISOString()
      }, null, 2)
    }]
  };
}

function writeAskPass(repository) {
  const file = path.join(os.tmpdir(), `evopilot-askpass-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
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

export function renderEvidenceFile(body, sourceBranch, upgradeBranch) {
  return [
    "# EvoPilot 代码升级证据",
    "",
    `- 时间：${new Date().toISOString()}`,
    `- 源分支：${sourceBranch}`,
    `- 升级分支：${upgradeBranch}`,
    "",
    "## 进化方案",
    "",
    body.initialUserMessage ?? ""
  ].join("\n").trimEnd() + "\n";
}

function normalizeValidationCommands(value, prompt = "") {
  if (Array.isArray(value)) {
    const commands = value.map((item) => String(item).trim()).filter(Boolean);
    if (commands.length > 0) return commands;
  }
  return extractValidationCommands(prompt);
}

function normalizeValidationPlan(value) {
  if (!value || typeof value !== "object") return undefined;
  const service = value.service && typeof value.service === "object" && value.service.enabled !== false && value.service.startCommand
    ? {
        enabled: true,
        startCommand: String(value.service.startCommand).trim(),
        host: String(value.service.host ?? "127.0.0.1").trim(),
        port: value.service.port ? Number(value.service.port) : undefined,
        healthPath: String(value.service.healthPath ?? "/health").trim(),
        readyTimeoutSeconds: Math.max(1, Number(value.service.readyTimeoutSeconds ?? 15))
      }
    : undefined;
  return {
    language: normalizeLanguage(value.language),
    installCommands: normalizeCommandList(value.installCommands),
    unitCommands: normalizeCommandList(value.unitCommands),
    service,
    smokeCommands: normalizeCommandList(value.smokeCommands),
    functionalCommands: normalizeCommandList(value.functionalCommands)
  };
}

function normalizeLanguage(value) {
  const text = String(value ?? "generic").trim().toLowerCase();
  if (["python", "node", "java", "go"].includes(text)) return text;
  return "generic";
}

function normalizeCommandList(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/)
      : [];
  return items.map((item) => String(item).trim()).filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))];
}

export function normalizeRepairAttempts() {
  const value = Number(process.env.EVOPILOT_CODE_UPGRADER_REPAIR_ATTEMPTS ?? 4);
  if (!Number.isFinite(value)) return 4;
  return Math.max(0, Math.min(5, Math.trunc(value)));
}

export function renderRepairHistory(history = []) {
  if (!Array.isArray(history) || history.length === 0) return "无。";
  return history.map((item, index) => {
    const title = `#${index + 1} attempt=${item.attempt ?? "unknown"} phase=${item.phase ?? "unknown"} at=${item.occurredAt ?? "unknown"}`;
    const errorText = item.error ? `error:\n${String(item.error).slice(0, 4000)}` : "";
    const files = Array.isArray(item.files) && item.files.length > 0 ? `files: ${item.files.join(", ")}` : "";
    const reasons = Array.isArray(item.reasons) && item.reasons.length > 0 ? `reasons:\n- ${item.reasons.join("\n- ")}` : "";
    return [title, errorText, files, reasons].filter(Boolean).join("\n");
  }).join("\n\n");
}

function lastRepairError(history = []) {
  const errors = history.map((item) => item?.error).filter(Boolean);
  return String(errors.at(-1) ?? "未知").slice(0, 1200);
}

export async function runGeneratedQualityGate({ repoDir, env = process.env, session, files }) {
  const productFiles = uniqueStrings((files ?? []).filter(isProductImplementationFile));
  for (const file of productFiles) {
    const command = generatedQualityGateCommand(file);
    if (!command) continue;
    session?.events?.push(event("info", "提交前质量门禁", `检查生成文件语法：${file}`, "tool", { file, command }));
    await runShell(command, { cwd: repoDir, env }).catch((error) => {
      throw classifiedError("GENERATED_CODE_QUALITY_GATE_FAILED", `生成文件未通过提交前质量门禁：${file}`, error);
    });
  }
  if (productFiles.length > 0) {
    session?.events?.push(event("info", "提交前质量门禁", `已完成 ${productFiles.length} 个生成实现文件的质量检查。`, "tool", { files: productFiles }));
    if (session) persistSession(session);
  }
}

function generatedQualityGateCommand(file) {
  const quoted = shellQuoteSingle(file);
  if (/\.py$/i.test(file)) return `python3 -m py_compile ${quoted}`;
  if (/\.(mjs|cjs|js)$/i.test(file)) return `node --check ${quoted}`;
  if (/\.json$/i.test(file)) return `node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" ${quoted}`;
  if (/\.sh$/i.test(file)) return `bash -n ${quoted}`;
  return undefined;
}

async function preflightValidationRuntime(plan, session) {
  if (!plan) return;
  const commands = [];
  if (plan.language === "python") commands.push("python3");
  if (plan.language === "node") commands.push("node");
  if (plan.language === "java") commands.push("java");
  if (plan.language === "go") commands.push("go");
  for (const command of commands) {
    session.events.push(event("info", "运行时体检", `检查验证运行时依赖：${command}`, "environment", { command: `command -v ${command}` }));
    await runShell(`command -v ${shellQuoteForDouble(command)}`, { allowFailure: false }).catch((error) => {
      throw classifiedError("RUNTIME_DEPENDENCY_MISSING", `验证运行时缺少依赖 ${command}。请在代码升级器镜像或运行时模板中安装后重试。`, error);
    });
  }
}

async function runValidation({ repoDir, env, session, validationPlan, validationCommands }) {
  if (!validationPlan) {
    for (const command of validationCommands) await runValidationCommand(command, { repoDir, env, session, category: "raw" });
    return;
  }
  for (const command of validationPlan.installCommands ?? []) await runValidationCommand(command, { repoDir, env, session, category: "install" });
  for (const command of validationPlan.unitCommands ?? []) await runValidationCommand(command, { repoDir, env, session, category: "unit" });
  if (validationPlan.service?.enabled) {
    await runServiceValidation({ repoDir, env, session, validationPlan });
  } else {
    for (const command of validationPlan.smokeCommands ?? []) await runValidationCommand(command, { repoDir, env, session, category: "smoke" });
    for (const command of validationPlan.functionalCommands ?? []) await runValidationCommand(command, { repoDir, env, session, category: "functional" });
  }
}

async function runServiceValidation({ repoDir, env, session, validationPlan }) {
  const service = validationPlan.service;
  const host = service.host ?? "127.0.0.1";
  const port = service.port;
  const baseUrl = `http://${host}${port ? `:${port}` : ""}`;
  const healthPath = service.healthPath?.startsWith("/") ? service.healthPath : `/${service.healthPath ?? "health"}`;
  session.events.push(event("info", "启动验证服务", `启动项目服务：${service.startCommand}`, "tool", { command: service.startCommand, healthUrl: `${baseUrl}${healthPath}` }));
  const child = spawn("/bin/sh", ["-lc", service.startCommand], {
    cwd: repoDir,
    env: {
      ...env,
      PORT: port ? String(port) : env.PORT,
      HOST: host,
      AGENT_BASE_URL: baseUrl
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    await waitForServiceReady(`${baseUrl}${healthPath}`, service.readyTimeoutSeconds ?? 15, child).catch((error) => {
      throw classifiedError("SERVICE_NOT_READY", `验证服务未在 ${service.readyTimeoutSeconds ?? 15}s 内就绪：${baseUrl}${healthPath}。请检查项目启动命令、端口和健康检查路径。stdout=${stdout.slice(-500)} stderr=${stderr.slice(-500)}`, error);
    });
    for (const command of validationPlan.smokeCommands ?? []) await runValidationCommand(command, { repoDir, env: { ...env, AGENT_BASE_URL: baseUrl }, session, category: "smoke" });
    for (const command of validationPlan.functionalCommands ?? []) await runValidationCommand(command, { repoDir, env: { ...env, AGENT_BASE_URL: baseUrl }, session, category: "functional" });
  } finally {
    child.kill("SIGTERM");
  }
}

async function waitForServiceReady(healthUrl, timeoutSeconds, child) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`服务进程提前退出，退出码 ${child.exitCode}`);
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      // 等待服务继续启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("service ready timeout");
}

async function runValidationCommand(command, { repoDir, env, session, category }) {
  session.events.push(event("info", "运行验证", `执行${validationCategoryName(category)}：${command}`, "tool", { command, category }));
  await runShell(command, { cwd: repoDir, env }).catch((error) => {
    throw classifiedError("VALIDATION_COMMAND_FAILED", `${validationCategoryName(category)}失败：${command}`, error);
  });
}

function validationCategoryName(category) {
  return {
    install: "依赖安装",
    unit: "单元测试",
    smoke: "冒烟测试",
    functional: "功能闭环测试",
    raw: "验证命令"
  }[category] ?? "验证命令";
}

function classifiedError(code, message, cause) {
  const error = new Error(`${code}: ${message}${cause instanceof Error ? `\n${cause.message}` : ""}`);
  error.code = code;
  return error;
}

function shellQuoteForDouble(value) {
  return String(value).replace(/["\\$`]/g, "\\$&");
}

function extractValidationCommands(prompt = "") {
  const marker = "验证命令：";
  const index = prompt.indexOf(marker);
  if (index < 0) return ["git diff --check HEAD~1..HEAD"];
  const lines = prompt.slice(index + marker.length).split("\n");
  const commands = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!line.trim().startsWith("- ")) break;
    const command = line.trim().slice(2).trim();
    if (command && command !== "未指定") commands.push(command);
  }
  return commands.length > 0 ? commands : ["git diff --check HEAD~1..HEAD"];
}

function normalizeEdit(value) {
  if (!value || typeof value !== "object") return undefined;
  const filePath = normalizeGeneratedEditPath(value.path);
  const content = typeof value.content === "string" ? value.content : "";
  if (!filePath || !content.trim()) return undefined;
  return {
    path: filePath,
    content,
    reason: typeof value.reason === "string" && value.reason.trim() ? value.reason.trim() : "代码升级实现"
  };
}

function normalizeGeneratedEditPath(value) {
  const filePath = normalizeRelativePath(value);
  if (!filePath) return "";
  if (filePath.startsWith(".evopilot/runtime-upgrades/")) {
    const trimmed = filePath.replace(/[.]+$/g, "");
    if (!path.extname(trimmed)) return `${trimmed}.json`;
    return trimmed;
  }
  return filePath;
}

function parseJsonObject(text) {
  const raw = String(text ?? "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(json);
}

function toLlmTrace(response) {
  return {
    mode: "llm",
    provider: response.provider,
    model: response.model,
    durationMs: response.durationMs,
    usage: response.usage,
    finishReason: response.finishReason,
    resolvedIntent: response.resolvedIntent,
    resolvedProfile: response.resolvedProfile,
    preflightUsed: response.preflightUsed,
    truncated: response.truncated,
    truncationRetryAttempt: response.truncationRetryAttempt,
    finalMaxOutputTokens: response.finalMaxOutputTokens,
    promptCompressed: response.promptCompressed,
    compression: response.compression
  };
}

function normalizePathList(value) {
  if (Array.isArray(value)) return value.map(normalizeRelativePath).filter(Boolean);
  if (value === undefined || value === null || value === "undefined" || value === "null") return [];
  return String(value ?? "")
    .split(",")
    .map(normalizeRelativePath)
    .filter(Boolean);
}

function normalizeRelativePath(value) {
  const normalized = String(value ?? "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized === "." || normalized.includes("\0")) return "";
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (parts.includes("..")) return "";
  return parts.join("/");
}

function assertAllowedPath(file, allowedPaths, protectedPaths) {
  const relative = normalizeRelativePath(file);
  if (!relative) throw new Error(`非法文件路径：${file}`);
  for (const protectedPath of protectedPaths) {
    if (isUnder(relative, protectedPath)) throw new Error(`升级尝试修改受保护路径：${relative}`);
  }
  if (allowedPaths.length > 0 && !allowedPaths.some((allowedPath) => isUnder(relative, allowedPath))) {
    throw new Error(`升级文件不在允许路径内：${relative}`);
  }
}

export function isProductImplementationFile(file) {
  const relative = normalizeRelativePath(file);
  if (!relative) return false;
  if (relative.startsWith(".evopilot/")) return false;
  if (relative.startsWith("docs/evopilot-upgrades/")) return false;
  if (relative.startsWith("docs/")) return false;
  if (/(^|\/)(readme|changelog|license)(\.[^/]*)?$/i.test(relative)) return false;
  return /(^|\/)(src|app|server|lib|tests?|scripts|config)\//.test(relative) ||
    /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|requirements\.txt|pom\.xml|build\.gradle|settings\.gradle|go\.mod|go\.sum|Dockerfile|Jenkinsfile|Makefile)$/i.test(relative) ||
    /\.(py|js|ts|mjs|cjs|java|go|sh|json|ya?ml|toml|properties|xml|gradle|sql)$/i.test(relative);
}

function isUnder(file, parent) {
  const normalizedParent = normalizeRelativePath(parent);
  if (!normalizedParent) return false;
  return file === normalizedParent || file.startsWith(`${normalizedParent}/`);
}

export function sanitizeGeneratedContent(value, file = "") {
  const normalized = String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutBrokenBareImports = normalized
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "import") return false;
      if (/^from\s+\S+\s+import\s*$/.test(trimmed)) return false;
      return true;
    })
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
  const withoutTrailingWhitespace = /\.py$/i.test(file)
    ? sanitizeGeneratedPythonContent(withoutBrokenBareImports)
    : withoutBrokenBareImports;
  return `${withoutTrailingWhitespace.trimEnd()}\n`;
}

function sanitizeGeneratedPythonContent(value) {
  let content = value
    .replace(/(^|[^\w])\.(dumps|loads|JSONDecodeError)\b/g, "$1json.$2")
    .replace(/(['"])application\/\1/g, "$1application/json$1");
  if (/\bjson\.(dumps|loads|JSONDecodeError)\b/.test(content) && !/^\s*(import\s+json|from\s+json\s+import\s+)/m.test(content)) {
    content = `import json\n${content}`;
  }
  return content;
}

function persistSession(session) {
  if (!session?.dataRoot) return;
  const file = path.join(session.dataRoot, "sessions", `${safeFileName(session.conversationId)}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(session, null, 2), "utf8");
}

function persistWorkspaceSnapshot(repoDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const head = path.join(targetDir, "HEAD.diff");
  const files = path.join(targetDir, "changed-files.txt");
  try {
    fs.writeFileSync(head, "", "utf8");
    fs.writeFileSync(files, "", "utf8");
  } catch {
    // 持久化快照不影响已经完成的代码升级结果。
  }
}

function publicSession(session) {
  if (!session) return session;
  return {
    workspaceId: session.workspaceId,
    conversationId: session.conversationId,
    status: session.status,
    events: session.events ?? [],
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    llmTrace: session.llmTrace,
    branchName: session.branchName,
    commitSha: session.commitSha,
    pullRequestUrl: session.pullRequestUrl,
    changedFiles: session.changedFiles,
    implementationFiles: session.implementationFiles,
    diff: session.diff,
    workspaceRoot: session.workspaceRoot
  };
}

function git(args, options = {}) {
  return run("git", args, options);
}

function runShell(command, options = {}) {
  return run("/bin/sh", ["-lc", command], options);
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

function event(level, phase, message, source = "agent", raw) {
  return {
    id: `event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    source,
    phase,
    level,
    message,
    raw
  };
}

function branchUrl(gitUrl, branch) {
  if (!gitUrl) return undefined;
  return gitUrl.replace(/\.git$/, "").replace(/\/$/, "") + `/-/tree/${encodeURIComponent(branch)}`;
}

function mergeRequestNewUrl(gitUrl, sourceBranch, upgradeBranch) {
  if (!gitUrl) return undefined;
  const root = gitUrl.replace(/\.git$/, "").replace(/\/$/, "");
  return `${root}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(upgradeBranch)}&merge_request%5Btarget_branch%5D=${encodeURIComponent(sourceBranch)}`;
}

function extractUrl(text) {
  return text.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, "");
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 120) || "upgrade";
}

function shellQuote(value) {
  return String(value).replace(/'/g, "'\\''");
}

function shellQuoteSingle(value) {
  return `'${shellQuote(value)}'`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8") || "{}"));
    request.on("error", reject);
  });
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.EVOPILOT_CODE_UPGRADER_PORT ?? 3000);
  const host = process.env.EVOPILOT_CODE_UPGRADER_HOST ?? "0.0.0.0";
  const runtime = await startInternalCodeUpgrader({ host, port });
  console.log(`EvoPilot 内置代码升级执行器已监听 ${runtime.baseUrl}`);
}
