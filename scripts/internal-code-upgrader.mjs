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
        return writeJson(response, 200, session);
      }
      const match = url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)$/);
      if (request.method === "GET" && match) {
        const session = sessions.get(decodeURIComponent(match[1]));
        if (!session) return writeJson(response, 404, { error: "SESSION_NOT_FOUND" });
        return writeJson(response, 200, session);
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
    const allowedPaths = normalizePathList(body.allowedPaths ?? process.env.EVOPILOT_CODE_UPGRADER_ALLOWED_PATHS ?? ".evopilot/runtime-upgrades,docs/evopilot-upgrades");
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
      fs.writeFileSync(target, ensureTrailingNewline(edit.content), "utf8");
      changedImplementationFiles.push(relativePath);
      session.events.push(event("info", "写入升级实现", `已写入 ${relativePath}。`, "tool", { file: relativePath, reason: edit.reason }));
    }

    const evidenceDir = path.join(repoDir, ".evopilot", "upgrades");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const evidenceFile = path.join(evidenceDir, `${safeFileName(id)}.md`);
    fs.writeFileSync(evidenceFile, renderEvidenceFile(body, sourceBranch, upgradeBranch), "utf8");
    session.events.push(event("info", "写入变更", `已写入代码升级证据文件 ${path.relative(repoDir, evidenceFile)}。`, "tool", { file: path.relative(repoDir, evidenceFile), diffStat: "+1 file" }));

    await git(["add", ".evopilot/upgrades", ...changedImplementationFiles], { cwd: repoDir, env: gitEnv });
    await git(["diff", "--cached", "--check"], { cwd: repoDir, env: gitEnv });
    const cachedFiles = (await git(["diff", "--cached", "--name-only"], { cwd: repoDir, env: gitEnv })).stdout.trim().split(/\r?\n/).filter(Boolean);
    const nonEvidenceFiles = cachedFiles.filter((file) => !file.startsWith(".evopilot/upgrades/"));
    if (nonEvidenceFiles.length === 0) throw new Error("代码升级没有产生非证据文件变更，已阻断提交。");
    for (const file of cachedFiles) assertAllowedPath(file, [".evopilot/upgrades", ...allowedPaths], protectedPaths);
    await git(["commit", "-m", branchStrategy.commitMessage ?? `EvoPilot: ${id}`], { cwd: repoDir, env: gitEnv });
    const commitSha = (await git(["rev-parse", "HEAD"], { cwd: repoDir, env: gitEnv })).stdout.trim();
    const diff = (await git(["show", "--stat", "--patch", "--find-renames", "--find-copies", "HEAD"], { cwd: repoDir, env: gitEnv })).stdout;
    session.events.push(event("info", "提交代码", `已提交升级变更 ${commitSha.slice(0, 12)}。`, "tool", { command: "git commit" }));

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
      session.events.push(event("info", "推送分支", `已推送升级分支并请求创建合并请求：${pullRequestUrl}`));
    }

    const validationCommands = Array.isArray(body.initialUserMessage) ? [] : extractValidationCommands(body.initialUserMessage);
    for (const command of validationCommands) {
      session.events.push(event("info", "运行验证", `执行验证命令：${command}`, "tool", { command }));
      await runShell(command, { cwd: repoDir, env: gitEnv });
    }

    Object.assign(session, {
      status: "SUCCEEDED",
      branchName: upgradeBranch,
      commitSha,
      pullRequestUrl,
      diff,
      changedFiles: cachedFiles,
      implementationFiles: nonEvidenceFiles,
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
    maxOutputTokens: Number(process.env.EVOPILOT_CODE_UPGRADER_LLM_MAX_OUTPUT_TOKENS ?? 4096),
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

function renderImplementationPlanPrompt({ id, body, allowedPaths, protectedPaths, sourceBranch, upgradeBranch }) {
  return [
    "你是 EvoPilot 代码升级执行器中的结构化补丁规划器。只返回 JSON 对象，不要 Markdown。",
    "目标：根据用户确认的进化方案生成可以落地到目标项目仓库的文件级修改。",
    "严格要求：",
    "1. 只能返回 edits 数组。",
    "2. 每个 edit 包含 path、content、reason。",
    "3. path 必须位于 allowedPaths 之一。",
    "4. 不允许修改 protectedPaths。",
    "5. content 必须是完整文件内容，不是 diff。",
    "6. 至少生成 1 个非 .evopilot/upgrades 的实现文件，供项目 CI/CD 消费。",
    "",
    `任务 ID：${id}`,
    `源分支：${sourceBranch}`,
    `升级分支：${upgradeBranch}`,
    `allowedPaths：${allowedPaths.join(", ")}`,
    `protectedPaths：${protectedPaths.join(", ") || "无"}`,
    "",
    "建议默认文件：.evopilot/runtime-upgrades/<任务ID>.json",
    "该文件应包含 version、taskId、target、changes、validation、createdAt 字段，作为目标项目内可版本化的升级实现契约。",
    "",
    "进化方案：",
    body.proposalMarkdown ?? body.initialUserMessage ?? "",
    "",
    "返回示例：",
    "{\"edits\":[{\"path\":\".evopilot/runtime-upgrades/example.json\",\"content\":\"{\\n  \\\"version\\\": \\\"1\\\"\\n}\\n\",\"reason\":\"供 CI/CD 消费的升级实现契约\"}]}"
  ].join("\n");
}

function deterministicImplementationPlan({ id, body }) {
  return {
    mode: "deterministic",
    edits: [{
      path: `.evopilot/runtime-upgrades/${safeFileName(id)}.json`,
      reason: "生成目标项目内可版本化的升级实现契约，供 CI/CD 和审计消费。",
      content: JSON.stringify({
        version: "1.0",
        taskId: id,
        target: "根据 EvoPilot 进化方案执行代码升级",
        changes: [
          "记录用户确认的进化方案",
          "声明代码升级执行入口",
          "向 CI/CD 暴露验证契约"
        ],
        validation: extractValidationCommands(body.initialUserMessage ?? ""),
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

function renderEvidenceFile(body, sourceBranch, upgradeBranch) {
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
  const filePath = normalizeRelativePath(value.path);
  const content = typeof value.content === "string" ? value.content : "";
  if (!filePath || !content.trim()) return undefined;
  return {
    path: filePath,
    content,
    reason: typeof value.reason === "string" && value.reason.trim() ? value.reason.trim() : "代码升级实现"
  };
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

function isUnder(file, parent) {
  const normalizedParent = normalizeRelativePath(parent);
  if (!normalizedParent) return false;
  return file === normalizedParent || file.startsWith(`${normalizedParent}/`);
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
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
  const runtime = await startInternalCodeUpgrader({ port });
  console.log(`EvoPilot 内置代码升级执行器已监听 ${runtime.baseUrl}`);
}
