#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apiErrorFromResponse, EvoPilotApiError, EvoPilotClient, type EvoPilotResponse } from "@evopilot/client";

interface CliConfig {
  server?: string;
  token?: string;
  tenantId?: string;
  workspaceId?: string;
  actor?: string;
  user?: Record<string, unknown>;
}

interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | boolean | string[]>;
}

interface RuntimeContext {
  args: ParsedArgs;
  configPath: string;
  config: CliConfig;
  client: EvoPilotClient;
  json: boolean;
}

const DEFAULT_SERVER = "http://127.0.0.1:19876";

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (hasFlag(args, "version") || args.positionals[0] === "version") {
    printVersion(hasFlag(args, "json"));
    return 0;
  }
  if (args.positionals.length === 0 || hasFlag(args, "help") || hasFlag(args, "h")) {
    printHelp();
    return 0;
  }

  const configPath = resolveConfigPath(args);
  const config = readConfig(configPath);
  const server = stringOption(args, "server") ?? process.env.EVOPILOT_SERVER ?? process.env.EVOPILOT_BASE_URL ?? config.server ?? DEFAULT_SERVER;
  const token = stringOption(args, "token") ?? process.env.EVOPILOT_API_TOKEN ?? config.token;
  const tenantId = stringOption(args, "tenant") ?? stringOption(args, "tenant-id") ?? process.env.EVOPILOT_TENANT ?? config.tenantId;
  const workspaceId = stringOption(args, "workspace") ?? stringOption(args, "workspace-id") ?? process.env.EVOPILOT_WORKSPACE ?? config.workspaceId;
  const actor = stringOption(args, "actor") ?? process.env.EVOPILOT_ACTOR ?? config.actor;
  const ctx: RuntimeContext = {
    args,
    configPath,
    config,
    client: new EvoPilotClient({ serverUrl: server, token, tenantId, workspaceId, actor }),
    json: hasFlag(args, "json")
  };

  const [group, action, maybeId] = args.positionals;
  try {
    switch (`${group ?? ""}:${action ?? ""}`) {
      case "auth:login":
        return await authLogin(ctx);
      case "auth:token":
        return authToken(ctx);
      case "config:path":
        return configPathCommand(ctx);
      case "config:show":
        return configShow(ctx);
      case "status:":
      case "status:undefined":
        return await status(ctx);
      case "project:register":
        return await projectRegister(ctx);
      case "project:preflight":
        return await projectPreflight(ctx, maybeId);
      case "project:list":
        return await projectList(ctx);
      case "project:credentials":
        if (maybeId !== "set") throw usage("Use: evopilot project credentials set <project-id> [options]");
        return await projectCredentialsSet(ctx, args.positionals[3]);
      case "project:devops":
        if (maybeId === "set") return await projectDevopsSet(ctx, args.positionals[3]);
        if (maybeId === "inspect") return await projectDevopsInspect(ctx, args.positionals[3]);
        if (maybeId === "preflight") return await projectDevopsPreflight(ctx, args.positionals[3]);
        if (maybeId === "clear") return await projectDevopsClear(ctx, args.positionals[3]);
        throw usage("Use: evopilot project devops <set|inspect|preflight|clear> <project-id> [options]");
      case "evidence:push":
        return await evidencePush(ctx);
      case "target:templates":
        return await targetTemplates(ctx);
      case "target:list":
        return await targetList(ctx);
      case "target:create":
        return await targetCreate(ctx);
      case "target:run":
        return await targetRun(ctx);
      case "target:decision":
        return await targetDecision(ctx, maybeId);
      case "goal:create":
        return await goalCreate(ctx);
      case "goal:list":
        return await goalList(ctx);
      case "goal:inspect":
        return await goalInspect(ctx, maybeId);
      case "goal:plan":
        return await goalPlan(ctx, maybeId);
      case "goal:approve-plan":
        return await goalApprovePlan(ctx, maybeId);
      case "goal:targets":
        return await goalTargets(ctx, maybeId);
      case "goal:advance":
        return await goalAdvance(ctx, maybeId);
      case "goal:run":
        return await goalRun(ctx, maybeId);
      case "goal:snapshot":
        return await goalSnapshot(ctx, maybeId);
      case "goal:graph":
        return await goalGraph(ctx, maybeId);
      case "goal:timeline":
        return await goalTimeline(ctx, maybeId);
      case "goal:evidence-matrix":
        return await goalEvidenceMatrix(ctx, maybeId);
      case "goal:final-report":
        return await goalFinalReport(ctx, maybeId);
      case "loop:create":
        return await loopCreate(ctx);
      case "loop:list":
        return await loopList(ctx);
      case "loop:start":
        return await loopAction(ctx, "start", maybeId);
      case "loop:approve":
        return await loopAction(ctx, "approve", maybeId);
      case "loop:run":
        return await loopRun(ctx, maybeId);
      case "source-closure:preflight":
        return await sourceClosurePreflight(ctx, maybeId);
      case "source-closure:execute":
        return await sourceClosureExecute(ctx, maybeId);
      case "source-closure:approve-release":
        return await sourceClosureReviewDecision(ctx, "approve", maybeId);
      case "source-closure:reject-release":
        return await sourceClosureReviewDecision(ctx, "reject", maybeId);
      case "source-closure:merge":
        return await sourceClosureReviewDecision(ctx, "merge", maybeId);
      case "source-closure:auto-merge":
        return await sourceClosureReviewDecision(ctx, "auto-merge", maybeId);
      case "release-run:list":
        return await releaseRunList(ctx);
      case "release-run:inspect":
        return await releaseRunInspect(ctx, maybeId);
      case "release-run:repair-candidates":
        return await releaseRunRepairCandidates(ctx);
      case "release-run:repair":
        return await releaseRunRepair(ctx, maybeId);
      case "release-run:repair-all":
        return await releaseRunRepairAll(ctx);
      case "release-run:finalizers":
        return await releaseRunFinalizers(ctx);
      case "worker:queue":
        return await workerQueue(ctx);
      case "worker:leases":
        return await workerLeases(ctx);
      case "worker:claim":
        return await workerClaim(ctx);
      case "worker:heartbeat":
        return await workerHeartbeat(ctx);
      case "sandbox:proof":
        return await sandboxProof(ctx, maybeId);
      case "sandbox:verify":
        return await sandboxVerify(ctx, maybeId);
      case "replay:checkpoints":
        return await replayCheckpoints(ctx, maybeId);
      case "replay:run":
        return await replayRun(ctx, maybeId);
      case "trace:tree":
        return await traceTree(ctx, maybeId);
      case "trace:events":
        return await traceEvents(ctx, maybeId);
      case "audit:list":
        return await auditList(ctx);
      case "connector:deploy":
        if (maybeId === "list") return await deployConnectorList(ctx);
        if (maybeId === "create") return await deployConnectorCreate(ctx);
        throw usage("Use: evopilot connector deploy <list|create> [options]");
      case "release:current":
        return await releaseCurrent(ctx);
      case "release:decisions":
        return await releaseDecisions(ctx);
      case "release:gate":
        return await releaseGate(ctx);
      default:
        throw usage(`Unknown command: ${args.positionals.join(" ")}`);
    }
  } catch (error) {
    return handleError(error, ctx.json);
  }
}

async function authLogin(ctx: RuntimeContext): Promise<number> {
  const username = requiredOption(ctx.args, "username");
  const password = requiredOption(ctx.args, "password");
  const response = await ctx.client.expectOk(ctx.client.post("/api/v1/auth/login", { username, password }));
  const data = response.data as Record<string, unknown>;
  const token = typeof data.token === "string" ? data.token : undefined;
  if (!token) throw new Error("Login response did not include a token.");
  if (!hasFlag(ctx.args, "no-save")) {
    const user = isRecord(data.user) ? data.user : {};
    writeConfig(ctx.configPath, {
      ...ctx.config,
      server: ctx.client.serverUrl.replace(/\/$/, ""),
      token,
      tenantId: stringField(user, "tenantId") ?? ctx.config.tenantId,
      workspaceId: stringField(user, "workspaceId") ?? ctx.config.workspaceId,
      user
    });
  }
  printOutput(ctx, data, `Logged in as ${username}.`);
  return 0;
}

function authToken(ctx: RuntimeContext): number {
  const token = ctx.client.token ?? ctx.config.token;
  if (!token) throw usage("No token is configured. Run evopilot auth login first or pass --token.");
  printOutput(ctx, { token }, token);
  return 0;
}

function configPathCommand(ctx: RuntimeContext): number {
  printOutput(ctx, { path: ctx.configPath }, ctx.configPath);
  return 0;
}

function configShow(ctx: RuntimeContext): number {
  const data = {
    path: ctx.configPath,
    server: ctx.client.serverUrl.replace(/\/$/, ""),
    tenantId: ctx.client.tenantId,
    workspaceId: ctx.client.workspaceId,
    actor: ctx.client.actor,
    tokenConfigured: Boolean(ctx.client.token)
  };
  const tokenState = data.tokenConfigured ? "present" : "missing";
  printOutput(ctx, data, `config=${data.path} server=${data.server} token=${tokenState}`);
  return 0;
}

async function status(ctx: RuntimeContext): Promise<number> {
  const health = await ctx.client.get("/health");
  const ready = await ctx.client.get("/ready");
  let summary: EvoPilotResponse | undefined;
  if (ctx.client.token) {
    summary = await ctx.client.get("/api/v1/summary");
  }
  const data = {
    server: ctx.client.serverUrl.replace(/\/$/, ""),
    health: health.body,
    ready: ready.body,
    summary: summary?.ok ? summary.data : undefined
  };
  printOutput(ctx, data, `health=${field(data.health, "status") ?? health.status} ready=${field(data.ready, "status") ?? ready.status}`);
  return health.ok && ready.ok && (!summary || summary.ok) ? 0 : 2;
}

async function projectRegister(ctx: RuntimeContext): Promise<number> {
  const id = requiredOption(ctx.args, "id");
  const provider = requiredOption(ctx.args, "provider");
  const repo = stringOption(ctx.args, "repo");
  const ownerRepo = repo?.includes("/") ? repo.split("/") : undefined;
  const body = {
    id,
    name: stringOption(ctx.args, "name") ?? id,
    profileId: stringOption(ctx.args, "profile-id"),
    tenantId: stringOption(ctx.args, "tenant") ?? stringOption(ctx.args, "tenant-id"),
    workspaceId: stringOption(ctx.args, "workspace") ?? stringOption(ctx.args, "workspace-id"),
    repository: {
      provider,
      root: stringOption(ctx.args, "root"),
      gitUrl: stringOption(ctx.args, "git-url") ?? stringOption(ctx.args, "url"),
      baseUrl: stringOption(ctx.args, "base-url"),
      projectId: stringOption(ctx.args, "project-id"),
      owner: stringOption(ctx.args, "owner") ?? ownerRepo?.[0],
      repo: stringOption(ctx.args, "repo-name") ?? ownerRepo?.slice(1).join("/") ?? (!ownerRepo ? repo : undefined),
      defaultBranch: stringOption(ctx.args, "branch") ?? stringOption(ctx.args, "default-branch"),
      username: stringOption(ctx.args, "username"),
      password: stringOption(ctx.args, "password"),
      token: stringOption(ctx.args, "source-token"),
      tokenRef: stringOption(ctx.args, "token-ref")
    }
  };
  const response = await ctx.client.expectOk(ctx.client.post("/api/v1/projects", body, requestOptions(ctx)));
  printOutput(ctx, response.data, `project=${field(response.data, "id")} validation=${nestedField(response.data, ["validation", "status"])}`);
  return 0;
}

async function projectList(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/projects"));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function projectPreflight(ctx: RuntimeContext, id?: string): Promise<number> {
  const projectId = id ?? requiredOption(ctx.args, "project");
  const response = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/source-credentials/preflight`, {}, requestOptions(ctx));
  printOutput(ctx, response.data, `project=${projectId} readiness=${field(response.data, "status") ?? response.status}`);
  return response.ok ? 0 : 2;
}

async function projectCredentialsSet(ctx: RuntimeContext, id?: string): Promise<number> {
  const projectId = id ?? requiredOption(ctx.args, "project");
  const body = {
    username: stringOption(ctx.args, "username"),
    password: stringOption(ctx.args, "password"),
    token: stringOption(ctx.args, "source-token"),
    tokenRef: stringOption(ctx.args, "token-ref"),
    defaultBranch: stringOption(ctx.args, "branch") ?? stringOption(ctx.args, "default-branch"),
    clearInlineToken: hasFlag(ctx.args, "clear-inline-token"),
    clearPassword: hasFlag(ctx.args, "clear-password"),
    clearTokenRef: hasFlag(ctx.args, "clear-token-ref")
  };
  const response = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/source-credentials`, body, requestOptions(ctx));
  printOutput(ctx, response.data, `project=${projectId} readiness=${nestedField(response.data, ["readiness", "status"]) ?? response.status}`);
  return response.ok ? 0 : 2;
}

async function projectDevopsSet(ctx: RuntimeContext, id?: string): Promise<number> {
  const projectId = id ?? requiredOption(ctx.args, "project");
  const cdConfigured = hasAnyOption(ctx.args, [
    "cd-workflow",
    "deploy-workflow",
    "deploy-environment",
    "environment",
    "cd-required-stage",
    "cd-required-job",
    "deploy-input",
    "health-url",
    "ready-url",
    "cd-timeout-seconds",
    "deploy-timeout-seconds"
  ]);
  const body: Record<string, unknown> = {
    provider: requiredOption(ctx.args, "provider"),
    tokenRef: stringOption(ctx.args, "token-ref") ?? stringOption(ctx.args, "devops-token-ref"),
    ci: {
      workflow: stringOption(ctx.args, "ci-workflow") ?? stringOption(ctx.args, "workflow"),
      ref: stringOption(ctx.args, "ci-ref") ?? stringOption(ctx.args, "ref") ?? stringOption(ctx.args, "branch"),
      requiredChecks: [
        ...repeatedOption(ctx.args, "ci-required-check"),
        ...repeatedOption(ctx.args, "required-check")
      ],
      requiredStages: [
        ...repeatedOption(ctx.args, "ci-required-stage"),
        ...repeatedOption(ctx.args, "required-stage")
      ],
      requiredJobs: [
        ...repeatedOption(ctx.args, "ci-required-job"),
        ...repeatedOption(ctx.args, "required-job")
      ],
      timeoutSeconds: numberOption(ctx.args, "ci-timeout-seconds")
    },
    cd: cdConfigured ? {
      workflow: stringOption(ctx.args, "cd-workflow") ?? stringOption(ctx.args, "deploy-workflow"),
      environment: stringOption(ctx.args, "deploy-environment") ?? stringOption(ctx.args, "environment"),
      requiredStages: repeatedOption(ctx.args, "cd-required-stage"),
      requiredJobs: repeatedOption(ctx.args, "cd-required-job"),
      deployInputs: parseKeyValueOptions(repeatedOption(ctx.args, "deploy-input")),
      healthUrl: stringOption(ctx.args, "health-url"),
      readyUrl: stringOption(ctx.args, "ready-url"),
      timeoutSeconds: numberOption(ctx.args, "cd-timeout-seconds") ?? numberOption(ctx.args, "deploy-timeout-seconds")
    } : undefined
  };
  const response = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/devops`, body, requestOptions(ctx));
  printProjectDevopsResult(ctx, "project devops set", projectId, response.data ?? response.body, response.status);
  return response.ok ? 0 : 2;
}

async function projectDevopsInspect(ctx: RuntimeContext, id?: string): Promise<number> {
  const projectId = id ?? requiredOption(ctx.args, "project");
  const response = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/devops`);
  printProjectDevopsResult(ctx, "project devops inspect", projectId, response.data ?? response.body, response.status);
  return response.ok ? 0 : 2;
}

async function projectDevopsPreflight(ctx: RuntimeContext, id?: string): Promise<number> {
  const projectId = id ?? requiredOption(ctx.args, "project");
  const response = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/devops/preflight`, {}, requestOptions(ctx));
  printProjectDevopsResult(ctx, "project devops preflight", projectId, response.data ?? response.body, response.status);
  return response.ok ? 0 : 2;
}

async function projectDevopsClear(ctx: RuntimeContext, id?: string): Promise<number> {
  const projectId = id ?? requiredOption(ctx.args, "project");
  const response = await ctx.client.request("DELETE", `/api/v1/projects/${encodeURIComponent(projectId)}/devops`, requestOptions(ctx));
  printProjectDevopsResult(ctx, "project devops clear", projectId, response.data ?? response.body, response.status);
  return response.ok ? 0 : 2;
}

async function evidencePush(ctx: RuntimeContext): Promise<number> {
  const file = requiredOption(ctx.args, "file");
  const parsed = readJson(file);
  const projectId = stringOption(ctx.args, "project");
  const body = Array.isArray(parsed)
    ? { projectId, events: parsed }
    : isRecord(parsed) && (Array.isArray(parsed.events) || Array.isArray(parsed.signals))
      ? { ...parsed, projectId: projectId ?? parsed.projectId }
      : { projectId, events: [parsed] };
  const response = await ctx.client.expectOk(ctx.client.post("/api/v1/evidence/events", body, requestOptions(ctx)));
  printOutput(ctx, response.data, `ingestedEvents=${field(response.data, "ingestedEvents") ?? 0}`);
  return 0;
}

async function targetTemplates(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/release/targets"));
  const data = response.data;
  const templates = Array.isArray(data)
    ? data.filter((item: unknown) => isRecord(item) && item.scope !== "project")
    : response.data;
  printOutput(ctx, templates, listSummary(templates, "id"));
  return 0;
}

async function targetList(ctx: RuntimeContext): Promise<number> {
  const projectId = stringOption(ctx.args, "project");
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/release/targets"));
  const data = response.data;
  const targets = Array.isArray(data) && projectId
    ? data.filter((item: unknown) => isRecord(item) && item.projectId === projectId)
    : response.data;
  printOutput(ctx, targets, listSummary(targets, "id"));
  return 0;
}

async function targetCreate(ctx: RuntimeContext): Promise<number> {
  const criteriaFile = stringOption(ctx.args, "criteria");
  const projectId = stringOption(ctx.args, "project");
  const templateId = stringOption(ctx.args, "template");
  let body: Record<string, unknown> = criteriaFile ? readJson(criteriaFile) as Record<string, unknown> : {};
  if (templateId) {
    const templates = await ctx.client.expectOk(ctx.client.get("/api/v1/release/targets"));
    const data = templates.data;
    const template = Array.isArray(data)
      ? data.find((item: unknown) => isRecord(item) && item.id === templateId)
      : undefined;
    if (!isRecord(template)) throw usage(`Release target template not found: ${templateId}`);
    body = { ...template, ...body, templateId };
  }
  const id = stringOption(ctx.args, "id") ?? (projectId && templateId ? `${projectId}-${templateId}` : undefined) ?? stringField(body, "id");
  body = {
    ...body,
    id,
    name: stringOption(ctx.args, "name") ?? stringField(body, "name") ?? id,
    scope: stringOption(ctx.args, "scope") ?? (projectId ? "project" : stringField(body, "scope")),
    projectId: projectId ?? stringField(body, "projectId"),
    templateId: templateId ?? stringField(body, "templateId")
  };
  if (!body.id) throw usage("target create requires --id or --project with --template.");
  const response = await ctx.client.expectOk(ctx.client.post("/api/v1/release/targets", body, requestOptions(ctx)));
  printOutput(ctx, response.data, `target=${field(response.data, "id")} scope=${field(response.data, "scope")}`);
  return 0;
}

async function targetRun(ctx: RuntimeContext): Promise<number> {
  const projectId = requiredOption(ctx.args, "project");
  const templateId = stringOption(ctx.args, "template");
  let targetId = stringOption(ctx.args, "target");
  const steps: Array<Record<string, unknown>> = [];
  if (!targetId) {
    if (!templateId) throw usage("target run requires --target or --template.");
    targetId = `${projectId}-${templateId}`;
    const existing = await readReleaseTarget(ctx, targetId);
    if (existing) {
      steps.push({ type: "target.resolved", targetId, status: field(existing, "scope") ?? "project" });
    } else {
      const created = await createProjectReleaseTarget(ctx, projectId, templateId, targetId);
      steps.push({ type: "target.created", targetId: field(created, "id"), templateId });
    }
  }
  const devopsPreflight = await tryProjectDevopsPreflight(ctx, projectId);
  steps.push(devopsPreflight);
  if (hasFlag(ctx.args, "require-devops-ready") && devopsPreflight.status !== "READY") {
    throw usage(`Project DevOps is not READY: ${devopsPreflight.status}`);
  }
  const objective = stringOption(ctx.args, "objective") ?? `Promote ${projectId} to ${templateId ?? targetId} through source closure, deployment evidence, release decision, and blocker review.`;
  return await runGoalWrapper(ctx, {
    command: "target run",
    projectId,
    targetId,
    objective,
    initialSteps: steps
  });
}

async function targetDecision(ctx: RuntimeContext, targetId?: string): Promise<number> {
  const target = targetId ?? requiredOption(ctx.args, "target");
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/release/decisions", {
    query: {
      targetId: target,
      projectId: stringOption(ctx.args, "project")
    }
  }));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function goalCreate(ctx: RuntimeContext): Promise<number> {
  const body = {
    id: stringOption(ctx.args, "id"),
    projectId: requiredOption(ctx.args, "project"),
    releaseTargetId: requiredOption(ctx.args, "target"),
    objective: requiredOption(ctx.args, "objective"),
    tenantId: stringOption(ctx.args, "tenant") ?? stringOption(ctx.args, "tenant-id"),
    workspaceId: stringOption(ctx.args, "workspace") ?? stringOption(ctx.args, "workspace-id")
  };
  const response = await ctx.client.expectOk(ctx.client.post("/api/v1/goals", body, requestOptions(ctx)));
  printOutput(ctx, response.data, `goal=${field(response.data, "id")} status=${field(response.data, "status")} next=plan-goal`);
  return 0;
}

async function goalList(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/goals"));
  const projectId = stringOption(ctx.args, "project");
  const targetId = stringOption(ctx.args, "target");
  const status = stringOption(ctx.args, "status");
  const data = Array.isArray(response.data)
    ? response.data.filter((item: unknown) =>
      (!projectId || field(item, "projectId") === projectId) &&
      (!targetId || field(item, "releaseTargetId") === targetId) &&
      (!status || field(item, "status") === status)
    )
    : response.data;
  printOutput(ctx, data, listSummary(data, "id"));
  return 0;
}

async function goalInspect(ctx: RuntimeContext, id?: string): Promise<number> {
  const goalId = id ?? requiredOption(ctx.args, "goal");
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/goals/${encodeURIComponent(goalId)}`));
  printOutput(ctx, response.data, `goal=${field(response.data, "id")} status=${field(response.data, "status")} plan=${nestedField(response.data, ["plan", "status"])}`);
  return 0;
}

async function goalPlan(ctx: RuntimeContext, id?: string): Promise<number> {
  const goalId = id ?? requiredOption(ctx.args, "goal");
  const response = await ctx.client.expectOk(ctx.client.post(`/api/v1/goals/${encodeURIComponent(goalId)}/plan`, {
    force: hasFlag(ctx.args, "force")
  }, requestOptions(ctx)));
  printOutput(ctx, response.data, `goal=${field(response.data, "id")} plan=${nestedField(response.data, ["plan", "status"])} targets=${nestedField(response.data, ["plan", "targetCount"])}`);
  return 0;
}

async function goalApprovePlan(ctx: RuntimeContext, id?: string): Promise<number> {
  const goalId = id ?? requiredOption(ctx.args, "goal");
  const response = await ctx.client.expectOk(ctx.client.post(`/api/v1/goals/${encodeURIComponent(goalId)}/approve-plan`, {}, requestOptions(ctx)));
  printOutput(ctx, response.data, `goal=${field(response.data, "id")} plan=${nestedField(response.data, ["plan", "status"])} status=${field(response.data, "status")}`);
  return 0;
}

async function goalTargets(ctx: RuntimeContext, id?: string): Promise<number> {
  const goalId = id ?? requiredOption(ctx.args, "goal");
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/goals/${encodeURIComponent(goalId)}/targets`));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function goalAdvance(ctx: RuntimeContext, id?: string): Promise<number> {
  const goalId = id ?? requiredOption(ctx.args, "goal");
  const response = await ctx.client.expectOk(ctx.client.post(`/api/v1/goals/${encodeURIComponent(goalId)}/advance`, {
    autoStart: hasFlag(ctx.args, "no-auto-start") ? false : undefined,
    approveHumanGate: hasFlag(ctx.args, "approve-human-gate"),
    forceDecision: stringOption(ctx.args, "force-decision")
  }, requestOptions(ctx)));
  printOutput(ctx, response.data, `goal=${nestedField(response.data, ["goal", "id"])} status=${field(response.data, "status")} next=${field(response.data, "nextAction")}`);
  return 0;
}

async function goalRun(ctx: RuntimeContext, id?: string): Promise<number> {
  const goalId = id ?? stringOption(ctx.args, "goal");
  if (goalId) {
    return await runGoalWrapper(ctx, {
      command: "goal run",
      goalId,
      initialSteps: [{ type: "goal.resolved", goalId }]
    });
  }
  return await runGoalWrapper(ctx, {
    command: "goal run",
    projectId: requiredOption(ctx.args, "project"),
    targetId: requiredOption(ctx.args, "target"),
    objective: requiredOption(ctx.args, "objective"),
    initialSteps: []
  });
}

async function goalSnapshot(ctx: RuntimeContext, id?: string): Promise<number> {
  const goalId = id ?? requiredOption(ctx.args, "goal");
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/goals/${encodeURIComponent(goalId)}/snapshot`));
  printOutput(ctx, response.data, `goal=${nestedField(response.data, ["goal", "id"])} status=${field(response.data, "status")} progress=${nestedField(response.data, ["progress", "percent"])}%`);
  return 0;
}

async function goalGraph(ctx: RuntimeContext, id?: string): Promise<number> {
  const goalId = id ?? requiredOption(ctx.args, "goal");
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/goals/${encodeURIComponent(goalId)}/graph`));
  printOutput(ctx, response.data, `goal=${field(response.data, "goalId")} nodes=${arrayLength(field(response.data, "nodes"))} edges=${arrayLength(field(response.data, "edges"))}`);
  return 0;
}

async function goalTimeline(ctx: RuntimeContext, id?: string): Promise<number> {
  const goalId = id ?? requiredOption(ctx.args, "goal");
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/goals/${encodeURIComponent(goalId)}/timeline`));
  printOutput(ctx, response.data, listSummary(response.data, "type"));
  return 0;
}

async function goalEvidenceMatrix(ctx: RuntimeContext, id?: string): Promise<number> {
  const goalId = id ?? requiredOption(ctx.args, "goal");
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/goals/${encodeURIComponent(goalId)}/evidence-matrix`));
  printOutput(ctx, response.data, listSummary(response.data, "targetId"));
  return 0;
}

async function goalFinalReport(ctx: RuntimeContext, id?: string): Promise<number> {
  const goalId = id ?? requiredOption(ctx.args, "goal");
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/goals/${encodeURIComponent(goalId)}/final-report`));
  printOutput(ctx, response.data, `goal=${field(response.data, "goalId")} status=${field(response.data, "status")}`);
  return 0;
}

async function loopCreate(ctx: RuntimeContext): Promise<number> {
  const contextFile = stringOption(ctx.args, "context");
  const sourceClosureFile = stringOption(ctx.args, "source-closure");
  const targetId = stringOption(ctx.args, "target");
  const body = {
    id: stringOption(ctx.args, "id"),
    projectId: requiredOption(ctx.args, "project"),
    objective: requiredOption(ctx.args, "objective"),
    source: stringOption(ctx.args, "source") ?? (targetId ? "release-target" : undefined),
    executorGraphId: stringOption(ctx.args, "executor-graph"),
    controlPlaneUrl: stringOption(ctx.args, "control-plane-url"),
    context: {
      ...(contextFile ? readJson(contextFile) as Record<string, unknown> : {}),
      releaseTargetId: targetId
    },
    sourceClosure: sourceClosureFile ? readJson(sourceClosureFile) : undefined
  };
  const response = await ctx.client.expectOk(ctx.client.post("/api/v1/loops", body, requestOptions(ctx)));
  printOutput(ctx, response.data, `loop=${field(response.data, "id")} status=${field(response.data, "status")}`);
  return 0;
}

async function loopList(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/loops"));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function loopAction(ctx: RuntimeContext, action: "start" | "approve", id?: string): Promise<number> {
  const loopId = id ?? requiredOption(ctx.args, "loop");
  const body = action === "start"
    ? { forceDecision: stringOption(ctx.args, "force-decision"), evidence: repeatedOption(ctx.args, "evidence") }
    : { approvalId: stringOption(ctx.args, "approval-id") };
  const response = await ctx.client.expectOk(ctx.client.post(`/api/v1/loops/${encodeURIComponent(loopId)}/${action}`, body, requestOptions(ctx)));
  printOutput(ctx, response.data, `loop=${field(response.data, "id")} status=${field(response.data, "status")}`);
  return 0;
}

async function loopRun(ctx: RuntimeContext, id?: string): Promise<number> {
  const startedAt = Date.now();
  const timeoutMs = wrapperTimeoutMs(ctx.args);
  const until = wrapperUntil(ctx.args, "terminal");
  let loopId = id ?? stringOption(ctx.args, "loop");
  const steps: Array<Record<string, unknown>> = [];
  if (!loopId) {
    const contextFile = stringOption(ctx.args, "context");
    const sourceClosureFile = stringOption(ctx.args, "source-closure");
    const targetId = requiredOption(ctx.args, "target");
    const createResponse = await ctx.client.post("/api/v1/loops", {
      id: stringOption(ctx.args, "id"),
      projectId: requiredOption(ctx.args, "project"),
      objective: requiredOption(ctx.args, "objective"),
      source: stringOption(ctx.args, "source") ?? "release-target",
      executorGraphId: stringOption(ctx.args, "executor-graph"),
      controlPlaneUrl: stringOption(ctx.args, "control-plane-url"),
      context: {
        ...(contextFile ? readJson(contextFile) as Record<string, unknown> : {}),
        releaseTargetId: targetId
      },
      sourceClosure: sourceClosureFile ? readJson(sourceClosureFile) : undefined
    }, derivedRequestOptions(ctx, "loop-run-create"));
    if (!createResponse.ok) throw apiErrorFromResponse(createResponse);
    loopId = String(field(createResponse.data, "id") ?? "");
    steps.push({ type: "loop.created", loopId, status: field(createResponse.data, "status") });
  }
  const maxIterations = numberOption(ctx.args, "max-iterations") ?? numberOption(ctx.args, "max-steps") ?? 10;
  const quiet = hasFlag(ctx.args, "quiet");
  let loop: unknown = await readLoop(ctx, loopId);
  printLoopRunStatus(ctx, "loop run", loop, steps, quiet);
  let runIterations = 0;
  for (let index = 0; index < maxIterations && !hasTimedOut(startedAt, timeoutMs) && shouldContinueLoopRun(loop, ctx.args, until); index += 1) {
    runIterations += 1;
    const status = String(field(loop, "status") ?? "");
    if (status === "WAITING_APPROVAL" && hasFlag(ctx.args, "approve-human-gate")) {
      const approved = await ctx.client.post(`/api/v1/loops/${encodeURIComponent(loopId)}/approve`, {
        approvalId: stringOption(ctx.args, "approval-id")
      }, derivedRequestOptions(ctx, `loop-run-approve-${index + 1}`));
      if (!approved.ok) throw apiErrorFromResponse(approved);
      loop = approved.data;
      steps.push({ type: "loop.approved", loopId, status: field(loop, "status"), iteration: field(loop, "currentIteration") });
      printLoopRunStatus(ctx, "loop run", loop, steps, quiet);
    }
    const nextStatus = String(field(loop, "status") ?? "");
    if (!["PENDING", "RUNNING", "BLOCKED"].includes(nextStatus)) break;
    const action = nextStatus === "PENDING" ? "start" : "resume";
    const response = await ctx.client.post(`/api/v1/loops/${encodeURIComponent(loopId)}/${action}`, {
      forceDecision: stringOption(ctx.args, "force-decision"),
      evidence: [`wrapper=loop-run`, `step=${index + 1}`]
    }, derivedRequestOptions(ctx, `loop-run-${action}-${index + 1}`));
    if (!response.ok) throw apiErrorFromResponse(response);
    loop = response.data;
    steps.push({ type: `loop.${action}`, loopId, status: field(loop, "status"), iteration: field(loop, "currentIteration") });
    printLoopRunStatus(ctx, "loop run", loop, steps, quiet);
  }
  if (runIterations >= maxIterations && shouldContinueLoopRun(loop, ctx.args, until)) {
    steps.push({ type: "loop.max-iterations-reached", loopId, maxIterations });
  }
  if (hasTimedOut(startedAt, timeoutMs) && shouldContinueLoopRun(loop, ctx.args, until)) {
    steps.push({ type: "loop.timeout-reached", loopId, timeoutMs });
  }
  const result = {
    schema: "evopilot-cli-loop-run/v1",
    command: "loop run",
    until,
    loop,
    steps,
    result: loopRunResult(loop),
    generatedAt: new Date().toISOString()
  };
  if (ctx.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (quiet) process.stdout.write(formatLoopRunStatus("loop run", loop, steps));
  return loopRunExitCode(loop);
}

async function sourceClosurePreflight(ctx: RuntimeContext, id?: string): Promise<number> {
  const loopId = id ?? requiredOption(ctx.args, "loop");
  const response = await ctx.client.post(`/api/v1/loops/${encodeURIComponent(loopId)}/source-closure/preflight`, {}, requestOptions(ctx));
  printOutput(ctx, response.data, `loop=${loopId} sourceClosurePreflight=${field(response.data, "status") ?? response.status}`);
  return response.ok ? 0 : 2;
}

async function sourceClosureExecute(ctx: RuntimeContext, id?: string): Promise<number> {
  const loopId = id ?? requiredOption(ctx.args, "loop");
  const payloadFile = stringOption(ctx.args, "payload");
  const body = payloadFile ? readJson(payloadFile) as Record<string, unknown> : {
    branchName: stringOption(ctx.args, "branch"),
    commitMessage: stringOption(ctx.args, "message"),
    tagName: stringOption(ctx.args, "tag"),
    createReviewRequest: hasFlag(ctx.args, "create-review"),
    deployConnectorId: stringOption(ctx.args, "deploy-connector"),
    deploymentUrl: stringOption(ctx.args, "deployment-url"),
    healthUrl: stringOption(ctx.args, "health-url"),
    readyUrl: stringOption(ctx.args, "ready-url"),
    allowDirtyWorktree: hasFlag(ctx.args, "allow-dirty-worktree"),
    files: repeatedOption(ctx.args, "write-file").map(parseWriteFile)
  };
  const response = await ctx.client.expectOk(ctx.client.post(`/api/v1/loops/${encodeURIComponent(loopId)}/source-closure/execute`, body, requestOptions(ctx)));
  printOutput(ctx, response.data, `loop=${field(response.data, "id")} closureState=${nestedField(response.data, ["sourceClosure", "closureState"])}`);
  return 0;
}

async function sourceClosureReviewDecision(ctx: RuntimeContext, action: "approve" | "reject" | "merge" | "auto-merge", id?: string): Promise<number> {
  const loopId = id ?? requiredOption(ctx.args, "loop");
  const body = {
    action,
    commitMessage: stringOption(ctx.args, "message"),
    reason: stringOption(ctx.args, "reason"),
    force: hasFlag(ctx.args, "force"),
    forcePolicy: hasFlag(ctx.args, "force-policy"),
    postMergeDeploy: optionalBoolean(ctx.args, "post-merge-deploy")
  };
  const response = await ctx.client.expectOk(ctx.client.post(`/api/v1/loops/${encodeURIComponent(loopId)}/source-closure/review-decision`, body, requestOptions(ctx)));
  printOutput(ctx, response.data, `loop=${field(response.data, "id")} review=${nestedField(response.data, ["sourceReleaseRun", "review", "status"])}`);
  return 0;
}

async function releaseRunList(ctx: RuntimeContext): Promise<number> {
  const loopId = stringOption(ctx.args, "loop");
  const path = loopId ? `/api/v1/loops/${encodeURIComponent(loopId)}/source-release-runs` : "/api/v1/source-release-runs";
  const response = await ctx.client.expectOk(ctx.client.get(path));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function releaseRunInspect(ctx: RuntimeContext, id?: string): Promise<number> {
  const runId = id ?? requiredOption(ctx.args, "run");
  const loopId = stringOption(ctx.args, "loop");
  const path = loopId ? `/api/v1/loops/${encodeURIComponent(loopId)}/source-release-runs` : "/api/v1/source-release-runs";
  const response = await ctx.client.expectOk(ctx.client.get(path));
  const run = Array.isArray(response.data)
    ? response.data.find((item: unknown) => isRecord(item) && item.id === runId)
    : undefined;
  if (!run) throw usage(`Source release run not found: ${runId}`);
  printOutput(ctx, run, `releaseRun=${field(run, "id")} status=${field(run, "status")}`);
  return 0;
}

async function releaseRunRepairCandidates(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/source-release-runs/repair-candidates", {
    query: { includeRepaired: hasFlag(ctx.args, "include-repaired") }
  }));
  printOutput(ctx, response.data, listSummary(response.data, "runId"));
  return 0;
}

async function releaseRunRepair(ctx: RuntimeContext, id?: string): Promise<number> {
  const runId = id ?? requiredOption(ctx.args, "run");
  return releaseRunRepairWithBody(ctx, [runId]);
}

async function releaseRunRepairAll(ctx: RuntimeContext): Promise<number> {
  return releaseRunRepairWithBody(ctx, undefined);
}

async function releaseRunRepairWithBody(ctx: RuntimeContext, runIds?: string[]): Promise<number> {
  const requestFile = stringOption(ctx.args, "repair-request") ?? stringOption(ctx.args, "payload");
  const body = {
    runIds,
    execute: hasFlag(ctx.args, "execute"),
    repairRequest: requestFile ? readJson(requestFile) : undefined
  };
  const response = await ctx.client.expectOk(ctx.client.post("/api/v1/source-release-runs/repair-candidates/repair", body, requestOptions(ctx)));
  printOutput(ctx, response.data, `repaired=${arrayLength(field(response.data, "repaired"))} failed=${arrayLength(field(response.data, "failed"))} skipped=${arrayLength(field(response.data, "skipped"))}`);
  return 0;
}

async function releaseRunFinalizers(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/source-release-deploy-finalizers", {
    query: { status: stringOption(ctx.args, "status") }
  }));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function workerQueue(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/loop-workers/queue"));
  printOutput(ctx, response.data, listSummary(response.data, "loopId"));
  return 0;
}

async function workerLeases(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/loop-workers/leases"));
  printOutput(ctx, response.data, listSummary(response.data, "loopId"));
  return 0;
}

async function workerClaim(ctx: RuntimeContext): Promise<number> {
  const body = {
    workerId: requiredOption(ctx.args, "worker-id"),
    loopId: stringOption(ctx.args, "loop"),
    leaseSeconds: numberOption(ctx.args, "lease-seconds")
  };
  const response = await ctx.client.expectOk(ctx.client.post("/api/v1/loop-workers/claim", body, requestOptions(ctx)));
  printOutput(ctx, response.data, `worker=${field(response.data, "workerId")} claimed=${nestedField(response.data, ["claimed", "loopId"]) ?? "none"}`);
  return 0;
}

async function workerHeartbeat(ctx: RuntimeContext): Promise<number> {
  const body = {
    loopId: requiredOption(ctx.args, "loop"),
    workerId: requiredOption(ctx.args, "worker-id"),
    leaseSeconds: numberOption(ctx.args, "lease-seconds")
  };
  const response = await ctx.client.expectOk(ctx.client.post("/api/v1/loop-workers/heartbeat", body, requestOptions(ctx)));
  printOutput(ctx, response.data, `worker=${field(response.data, "workerId")} expiresAt=${field(response.data, "expiresAt")}`);
  return 0;
}

async function sandboxProof(ctx: RuntimeContext, id?: string): Promise<number> {
  const loopId = id ?? requiredOption(ctx.args, "loop");
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/loops/${encodeURIComponent(loopId)}/sandbox-proof`));
  printOutput(ctx, response.data, `loop=${loopId} sandbox=${field(response.data, "status")}`);
  return 0;
}

async function sandboxVerify(ctx: RuntimeContext, id?: string): Promise<number> {
  const loopId = id ?? requiredOption(ctx.args, "loop");
  const response = await ctx.client.expectOk(ctx.client.post(`/api/v1/loops/${encodeURIComponent(loopId)}/sandbox-proof/verify`, {}, requestOptions(ctx)));
  printOutput(ctx, response.data, `loop=${nestedField(response.data, ["loop", "id"])} sandbox=${nestedField(response.data, ["proof", "status"])}`);
  return 0;
}

async function replayCheckpoints(ctx: RuntimeContext, id?: string): Promise<number> {
  const loopId = id ?? requiredOption(ctx.args, "loop");
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/loops/${encodeURIComponent(loopId)}/checkpoints`));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function replayRun(ctx: RuntimeContext, id?: string): Promise<number> {
  const loopId = id ?? requiredOption(ctx.args, "loop");
  const patchFile = stringOption(ctx.args, "context-patch") ?? stringOption(ctx.args, "patch");
  const body = {
    fromIteration: numberOption(ctx.args, "from-iteration") ?? numberOption(ctx.args, "iteration") ?? 1,
    contextPatch: patchFile ? readJson(patchFile) : {},
    evidence: repeatedOption(ctx.args, "evidence"),
    forceDecision: stringOption(ctx.args, "force-decision")
  };
  const response = await ctx.client.expectOk(ctx.client.post(`/api/v1/loops/${encodeURIComponent(loopId)}/time-travel/replay`, body, requestOptions(ctx)));
  printOutput(ctx, response.data, `loop=${nestedField(response.data, ["loop", "id"])} replayIteration=${nestedField(response.data, ["replayDiff", "replayIteration"])}`);
  return 0;
}

async function traceTree(ctx: RuntimeContext, id?: string): Promise<number> {
  const loopId = id ?? requiredOption(ctx.args, "loop");
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/loops/${encodeURIComponent(loopId)}/trace-tree`));
  printOutput(ctx, response.data, `loop=${loopId} traceTree=${field(response.data, "schema")}`);
  return 0;
}

async function traceEvents(ctx: RuntimeContext, id?: string): Promise<number> {
  const loopId = id ?? requiredOption(ctx.args, "loop");
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/loops/${encodeURIComponent(loopId)}/events`));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function auditList(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/audit"));
  const limit = numberOption(ctx.args, "limit");
  const data = Array.isArray(response.data) && limit ? response.data.slice(-limit).reverse() : response.data;
  printOutput(ctx, data, listSummary(data, "action"));
  return 0;
}

async function deployConnectorList(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/connectors/deploy"));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function deployConnectorCreate(ctx: RuntimeContext): Promise<number> {
  const payloadFile = stringOption(ctx.args, "payload");
  const body = payloadFile ? readJson(payloadFile) as Record<string, unknown> : {
    id: requiredOption(ctx.args, "id"),
    name: stringOption(ctx.args, "name"),
    type: stringOption(ctx.args, "type"),
    url: stringOption(ctx.args, "url"),
    rollbackUrl: stringOption(ctx.args, "rollback-url"),
    token: stringOption(ctx.args, "connector-token"),
    tokenRef: stringOption(ctx.args, "token-ref"),
    timeoutSeconds: numberOption(ctx.args, "timeout-seconds"),
    workingDir: stringOption(ctx.args, "working-dir"),
    composeFile: stringOption(ctx.args, "compose-file"),
    serviceName: stringOption(ctx.args, "service-name"),
    gitRemote: stringOption(ctx.args, "git-remote"),
    gitBranch: stringOption(ctx.args, "git-branch"),
    gitPull: optionalBoolean(ctx.args, "git-pull"),
    preserveLocalPaths: repeatedOption(ctx.args, "preserve-local-path"),
    build: optionalBoolean(ctx.args, "build"),
    skipComposeWhenUnchanged: hasFlag(ctx.args, "skip-compose-when-unchanged"),
    deployLock: optionalBoolean(ctx.args, "deploy-lock"),
    idempotency: optionalBoolean(ctx.args, "connector-idempotency"),
    rollbackOnFailure: optionalBoolean(ctx.args, "rollback-on-failure"),
    rollbackOnHealthFailure: optionalBoolean(ctx.args, "rollback-on-health-failure"),
    healthPath: stringOption(ctx.args, "health-path"),
    readyPath: stringOption(ctx.args, "ready-path")
  };
  const response = await ctx.client.expectOk(ctx.client.post("/api/v1/connectors/deploy", body, requestOptions(ctx)));
  printOutput(ctx, response.data, `deployConnector=${field(response.data, "id")} type=${field(response.data, "type")}`);
  return 0;
}

async function releaseCurrent(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/release/decisions", { query: { current: true } }));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function releaseDecisions(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/release/decisions", {
    query: {
      targetId: stringOption(ctx.args, "target"),
      projectId: stringOption(ctx.args, "project")
    }
  }));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function releaseGate(ctx: RuntimeContext): Promise<number> {
  const payloadFile = stringOption(ctx.args, "file");
  const body = payloadFile ? readJson(payloadFile) as Record<string, unknown> : {
    id: stringOption(ctx.args, "id"),
    projectId: stringOption(ctx.args, "project"),
    releaseTargetId: requiredOption(ctx.args, "target"),
    candidate: stringOption(ctx.args, "candidate"),
    scenarioMatrix: repeatedOption(ctx.args, "scenario").map(parseScenario)
  };
  const response = await ctx.client.expectOk(ctx.client.post("/api/v1/release/evidence", body, requestOptions(ctx)));
  printOutput(ctx, response.data, `releaseDecision=${field(response.data, "releaseDecisionId")} status=${field(response.data, "status")}`);
  return 0;
}

async function tryProjectDevopsPreflight(ctx: RuntimeContext, projectId: string): Promise<Record<string, unknown>> {
  try {
    const response = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/devops/preflight`, {}, derivedRequestOptions(ctx, "target-run-devops-preflight"));
    const readiness = isRecord(response.data) ? response.data : undefined;
    return {
      type: "project.devops.preflight",
      projectId,
      httpStatus: response.status,
      status: field(readiness, "status") ?? (response.status === 404 ? "NOT_CONFIGURED" : response.ok ? "READY" : "BLOCKED"),
      nextAction: field(readiness, "nextAction"),
      provider: field(readiness, "provider"),
      blockers: field(readiness, "blockers")
    };
  } catch (error) {
    return {
      type: "project.devops.preflight",
      projectId,
      status: "UNAVAILABLE",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runGoalWrapper(ctx: RuntimeContext, input: {
  command: "goal run" | "target run";
  goalId?: string;
  projectId?: string;
  targetId?: string;
  objective?: string;
  initialSteps: Array<Record<string, unknown>>;
}): Promise<number> {
  const startedAt = Date.now();
  const timeoutMs = wrapperTimeoutMs(ctx.args);
  const until = wrapperUntil(ctx.args, "terminal");
  const steps = [...input.initialSteps];
  const quiet = hasFlag(ctx.args, "quiet");
  const maxSteps = numberOption(ctx.args, "max-steps") ?? 20;
  let goalId = input.goalId;
  if (!goalId) {
    if (!input.projectId || !input.targetId || !input.objective) throw usage(`${input.command} requires a goal id or --project, --target, and --objective.`);
    const existingGoal = hasFlag(ctx.args, "new") ? undefined : await findReusableGoal(ctx, input.projectId, input.targetId, input.objective);
    if (existingGoal) {
      goalId = String(field(existingGoal, "id"));
      steps.push({ type: "goal.resolved", goalId, status: field(existingGoal, "status") });
    } else {
      const created = await createGoalForRun(ctx, input.projectId, input.targetId, input.objective);
      goalId = String(field(created, "id"));
      steps.push({ type: "goal.created", goalId, status: field(created, "status") });
    }
  }

  let status = await readGoalRunStatus(ctx, goalId);
  printGoalRunStatus(ctx, input.command, status, steps, quiet);

  if (hasTimedOut(startedAt, timeoutMs) && shouldContinueGoalRun(status, until)) {
    steps.push({ type: "goal.timeout-reached", goalId, timeoutMs });
    return finishGoalRun(ctx, input.command, status, steps, quiet, 2);
  }

  if (field(status, "nextAction") === "plan-goal" && shouldContinueGoalRun(status, until)) {
    const planned = await ctx.client.post(`/api/v1/goals/${encodeURIComponent(goalId)}/plan`, {
      force: hasFlag(ctx.args, "force-plan")
    }, derivedRequestOptions(ctx, "goal-run-plan"));
    if (!planned.ok) throw apiErrorFromResponse(planned);
    steps.push({ type: "goal.plan-generated", goalId, targetCount: nestedField(planned.data, ["plan", "targetCount"]) });
    status = await readGoalRunStatus(ctx, goalId);
    printGoalRunStatus(ctx, input.command, status, steps, quiet);
  }

  if (hasTimedOut(startedAt, timeoutMs) && shouldContinueGoalRun(status, until)) {
    steps.push({ type: "goal.timeout-reached", goalId, timeoutMs });
    return finishGoalRun(ctx, input.command, status, steps, quiet, 2);
  }

  if (field(status, "nextAction") === "approve-plan" && shouldContinueGoalRun(status, until)) {
    if (hasFlag(ctx.args, "no-auto-approve-plan") || hasFlag(ctx.args, "require-plan-approval")) {
      steps.push({ type: "goal.plan-approval-required", goalId, status: "WAITING_HUMAN" });
      return finishGoalRun(ctx, input.command, status, steps, quiet, 2);
    }
    const approved = await ctx.client.post(`/api/v1/goals/${encodeURIComponent(goalId)}/approve-plan`, {}, derivedRequestOptions(ctx, "goal-run-approve-plan"));
    if (!approved.ok) throw apiErrorFromResponse(approved);
    steps.push({ type: "goal.plan-approved", goalId, targetCount: nestedField(approved.data, ["plan", "targetCount"]) });
    status = await readGoalRunStatus(ctx, goalId);
    printGoalRunStatus(ctx, input.command, status, steps, quiet);
  }

  let advanceCount = 0;
  while (advanceCount < maxSteps && !hasTimedOut(startedAt, timeoutMs) && shouldContinueGoalRun(status, until)) {
    advanceCount += 1;
    const response = await ctx.client.post(`/api/v1/goals/${encodeURIComponent(goalId)}/advance`, {
      autoStart: hasFlag(ctx.args, "no-auto-start") ? false : undefined,
      approveHumanGate: hasFlag(ctx.args, "approve-human-gate"),
      forceDecision: stringOption(ctx.args, "force-decision")
    }, derivedRequestOptions(ctx, `goal-run-advance-${advanceCount}`));
    if (!response.ok && !isRecord(response.data)) throw apiErrorFromResponse(response);
    steps.push({
      type: "goal.advanced",
      goalId,
      httpStatus: response.status,
      status: field(response.data, "status"),
      nextAction: field(response.data, "nextAction"),
      targetId: nestedField(response.data, ["target", "id"]),
      loopId: nestedField(response.data, ["loop", "id"])
    });
    status = await readGoalRunStatus(ctx, goalId);
    printGoalRunStatus(ctx, input.command, status, steps, quiet);
  }

  if (advanceCount >= maxSteps && shouldContinueGoalRun(status, until)) {
    steps.push({ type: "goal.max-steps-reached", goalId, maxSteps });
  }
  const timedOut = hasTimedOut(startedAt, timeoutMs) && shouldContinueGoalRun(status, until);
  if (timedOut) {
    steps.push({ type: "goal.timeout-reached", goalId, timeoutMs });
  }
  return finishGoalRun(ctx, input.command, status, steps, quiet, goalRunExitCode(status, advanceCount >= maxSteps || timedOut));
}

async function finishGoalRun(ctx: RuntimeContext, command: string, status: unknown, steps: Array<Record<string, unknown>>, quiet: boolean, exitCode: number): Promise<number> {
  const result = {
    schema: "evopilot-cli-goal-run/v1",
    command,
    until: wrapperUntil(ctx.args, "terminal"),
    status,
    steps,
    result: goalRunResult(status, exitCode),
    generatedAt: new Date().toISOString()
  };
  if (ctx.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (quiet) process.stdout.write(formatGoalRunStatus(command, status, steps));
  return exitCode;
}

async function readGoalRunStatus(ctx: RuntimeContext, goalId: string): Promise<unknown> {
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/goals/${encodeURIComponent(goalId)}/run-status`));
  return response.data;
}

async function readLoop(ctx: RuntimeContext, loopId: string): Promise<unknown> {
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/loops/${encodeURIComponent(loopId)}`));
  return response.data;
}

async function readReleaseTarget(ctx: RuntimeContext, targetId: string): Promise<unknown | undefined> {
  const response = await ctx.client.get(`/api/v1/release/targets/${encodeURIComponent(targetId)}`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw apiErrorFromResponse(response);
  return response.data;
}

async function createProjectReleaseTarget(ctx: RuntimeContext, projectId: string, templateId: string, targetId: string): Promise<unknown> {
  const templates = await ctx.client.expectOk(ctx.client.get("/api/v1/release/targets"));
  const template = Array.isArray(templates.data)
    ? templates.data.find((item: unknown) => isRecord(item) && item.id === templateId)
    : undefined;
  if (!isRecord(template)) throw usage(`Release target template not found: ${templateId}`);
  const response = await ctx.client.post("/api/v1/release/targets", {
    ...template,
    id: targetId,
    name: `${projectId} ${String(field(template, "name") ?? templateId)}`,
    scope: "project",
    projectId,
    templateId
  }, derivedRequestOptions(ctx, "target-run-create-target"));
  if (!response.ok) throw apiErrorFromResponse(response);
  return response.data;
}

async function createGoalForRun(ctx: RuntimeContext, projectId: string, targetId: string, objective: string): Promise<unknown> {
  const response = await ctx.client.post("/api/v1/goals", {
    id: stringOption(ctx.args, "goal-id") ?? stringOption(ctx.args, "id"),
    projectId,
    releaseTargetId: targetId,
    objective
  }, derivedRequestOptions(ctx, "goal-run-create-goal"));
  if (!response.ok) throw apiErrorFromResponse(response);
  return response.data;
}

async function findReusableGoal(ctx: RuntimeContext, projectId: string, targetId: string, objective: string): Promise<unknown | undefined> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/goals"));
  const reusableStatuses = new Set(["DRAFT", "PLANNED", "APPROVED", "RUNNING", "WAITING_HUMAN", "BLOCKED"]);
  return Array.isArray(response.data)
    ? response.data.find((item: unknown) =>
      isRecord(item) &&
      item.projectId === projectId &&
      item.releaseTargetId === targetId &&
      item.objective === objective &&
      reusableStatuses.has(String(item.status))
    )
    : undefined;
}

function derivedRequestOptions(ctx: RuntimeContext, suffix: string): { idempotencyKey?: string } {
  const base = stringOption(ctx.args, "idempotency-key");
  return { idempotencyKey: base ? `${base}:${suffix}` : undefined };
}

function wrapperTimeoutMs(args: ParsedArgs): number | undefined {
  const timeout = durationOptionMs(args, "timeout");
  if (timeout !== undefined) return timeout;
  const timeoutSeconds = numberOption(args, "timeout-seconds");
  return timeoutSeconds === undefined ? undefined : Math.max(0, timeoutSeconds * 1000);
}

function durationOptionMs(args: ParsedArgs, name: string): number | undefined {
  const value = stringOption(args, name);
  if (value === undefined) return undefined;
  return parseDurationMs(value, name);
}

function parseDurationMs(value: string, optionName: string): number {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(ms|s|m|min|h)?$/);
  if (!match) throw usage(`Option --${optionName} must be a duration such as 30s, 10m, 2h, or a bare number of seconds.`);
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) throw usage(`Option --${optionName} must be a non-negative duration.`);
  const unit = match[2] ?? "s";
  const multiplier = unit === "ms" ? 1
    : unit === "s" ? 1000
      : unit === "m" || unit === "min" ? 60_000
        : 3_600_000;
  return Math.ceil(amount * multiplier);
}

function hasTimedOut(startedAt: number, timeoutMs?: number): boolean {
  return timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs;
}

type WrapperUntil = "terminal" | "blocked-or-complete";

function wrapperUntil(args: ParsedArgs, fallback: WrapperUntil): WrapperUntil {
  const value = stringOption(args, "until");
  if (value === undefined) return fallback;
  if (value === "terminal" || value === "blocked-or-complete") return value;
  throw usage("Option --until must be one of terminal or blocked-or-complete.");
}

function shouldContinueGoalRun(status: unknown, until: WrapperUntil): boolean {
  const goalStatus = String(field(status, "status") ?? "");
  const nextAction = String(field(status, "nextAction") ?? "");
  if (until === "blocked-or-complete" && ["COMPLETED", "BLOCKED", "FAILED", "WAITING_HUMAN"].includes(goalStatus)) return false;
  if (["COMPLETED", "BLOCKED", "FAILED", "WAITING_HUMAN"].includes(goalStatus)) return false;
  return !new Set([
    "human-approval",
    "configure-source-credentials",
    "repair-project",
    "repair-deploy-target",
    "policy-review",
    "release-decision",
    "view-final-report",
    "done",
    "repair"
  ]).has(nextAction);
}

function shouldContinueLoopRun(loop: unknown, args: ParsedArgs, until: WrapperUntil): boolean {
  const status = String(field(loop, "status") ?? "");
  if (until === "blocked-or-complete" && status === "BLOCKED") return false;
  if (status === "WAITING_APPROVAL" && !hasFlag(args, "approve-human-gate")) return false;
  return status === "PENDING" || status === "RUNNING" || status === "BLOCKED" || (status === "WAITING_APPROVAL" && hasFlag(args, "approve-human-gate"));
}

function goalRunExitCode(status: unknown, maxStepsReached: boolean): number {
  if (maxStepsReached) return 2;
  const goalStatus = String(field(status, "status") ?? "");
  const releaseDecisionStatus = String(nestedField(status, ["releaseDecision", "status"]) ?? "");
  if (releaseDecisionStatus === "NO-GO") return 2;
  return goalStatus === "COMPLETED" ? 0 : 2;
}

function loopRunExitCode(loop: unknown): number {
  return String(field(loop, "status") ?? "") === "SUCCEEDED" ? 0 : 2;
}

function goalRunResult(status: unknown, exitCode: number): Record<string, unknown> {
  return {
    exitCode,
    status: field(status, "status"),
    nextAction: field(status, "nextAction"),
    goalId: nestedField(status, ["goal", "id"]),
    activeTargetId: nestedField(status, ["activeTarget", "id"]),
    latestLoopId: nestedField(status, ["latestLoop", "id"]),
    releaseDecision: nestedField(status, ["releaseDecision", "status"]) ?? "PENDING"
  };
}

function loopRunResult(loop: unknown): Record<string, unknown> {
  return {
    exitCode: loopRunExitCode(loop),
    loopId: field(loop, "id"),
    status: field(loop, "status"),
    iteration: field(loop, "currentIteration"),
    sourceClosure: nestedField(loop, ["sourceClosure", "closureState"])
  };
}

function printGoalRunStatus(ctx: RuntimeContext, command: string, status: unknown, steps: Array<Record<string, unknown>>, quiet: boolean): void {
  if (ctx.json || quiet) return;
  process.stdout.write(formatGoalRunStatus(command, status, steps));
}

function printLoopRunStatus(ctx: RuntimeContext, command: string, loop: unknown, steps: Array<Record<string, unknown>>, quiet: boolean): void {
  if (ctx.json || quiet) return;
  process.stdout.write(formatLoopRunStatus(command, loop, steps));
}

function formatGoalRunStatus(command: string, status: unknown, steps: Array<Record<string, unknown>>): string {
  const lines = [
    "EvoPilot Goal Run",
    `Command    ${command}`,
    `Scope      ${nestedField(status, ["scope", "tenantId"]) ?? "-"} / ${nestedField(status, ["scope", "workspaceId"]) ?? "-"}`,
    `Project    ${nestedField(status, ["goal", "projectId"]) ?? "-"}`,
    `Target     ${nestedField(status, ["goal", "releaseTargetId"]) ?? "-"}`,
    `Goal       ${nestedField(status, ["goal", "id"]) ?? "-"}`,
    `Status     ${field(status, "status") ?? "-"}`,
    `Progress   ${nestedField(status, ["snapshot", "progress", "completedTargets"]) ?? 0}/${nestedField(status, ["snapshot", "progress", "requiredTargets"]) ?? 0} required (${nestedField(status, ["snapshot", "progress", "percent"]) ?? 0}%)`,
    "",
    "Workflow",
    ...formatChain(field(status, "chain")),
    "",
    "Next Action",
    `${field(status, "nextAction") ?? "unknown"}${field(status, "blockers") ? ` / blockers=${arrayLength(field(status, "blockers"))}` : ""}`,
    "",
    "Evidence",
    `- snapshot: /api/v1/goals/${nestedField(status, ["goal", "id"]) ?? "<goal-id>"}/snapshot`,
    `- graph: /api/v1/goals/${nestedField(status, ["goal", "id"]) ?? "<goal-id>"}/graph`,
    `- evidence matrix: /api/v1/goals/${nestedField(status, ["goal", "id"]) ?? "<goal-id>"}/evidence-matrix`,
    `- release decision: ${nestedField(status, ["releaseDecision", "id"]) ?? "pending"}`,
    "",
    "Steps",
    ...formatSteps(steps),
    "",
    "Result",
    String(field(status, "status") ?? "UNKNOWN"),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

function formatLoopRunStatus(command: string, loop: unknown, steps: Array<Record<string, unknown>>): string {
  const lines = [
    "EvoPilot Loop Run",
    `Command    ${command}`,
    `Project    ${field(loop, "projectId") ?? "-"}`,
    `Target     ${nestedField(loop, ["context", "releaseTargetId"]) ?? "-"}`,
    `Loop       ${field(loop, "id") ?? "-"}`,
    `Status     ${field(loop, "status") ?? "-"}`,
    `Iteration  ${field(loop, "currentIteration") ?? 0}`,
    "",
    "Workflow",
    `[${field(loop, "projectId") ? "OK" : "PENDING"}] Project -> [${nestedField(loop, ["context", "releaseTargetId"]) ? "OK" : "PENDING"}] Target -> [${field(loop, "status") ?? "PENDING"}] LoopRun -> [${nestedField(loop, ["sourceClosure", "closureState"]) ?? "PENDING"}] Source Closure`,
    "",
    "Next Action",
    loopNextAction(loop),
    "",
    "Evidence",
    `- loop: /api/v1/loops/${field(loop, "id") ?? "<loop-id>"}`,
    `- trace: /api/v1/loops/${field(loop, "id") ?? "<loop-id>"}/trace-tree`,
    `- events: /api/v1/loops/${field(loop, "id") ?? "<loop-id>"}/events`,
    "",
    "Steps",
    ...formatSteps(steps),
    "",
    "Result",
    String(field(loop, "status") ?? "UNKNOWN"),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

function printProjectDevopsResult(ctx: RuntimeContext, command: string, projectId: string, data: unknown, httpStatus: number): void {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const readiness = isRecord(field(data, "readiness")) ? field(data, "readiness") : data;
  const devops = isRecord(field(data, "devops")) ? field(data, "devops") : data;
  const checks = Array.isArray(field(readiness, "checks")) ? field(readiness, "checks") as unknown[] : [];
  const blockers = Array.isArray(field(readiness, "blockers")) ? field(readiness, "blockers") as unknown[] : [];
  const lines = [
    "EvoPilot Project DevOps",
    `Command    ${command}`,
    `Project    ${projectId}`,
    `Provider   ${field(readiness, "provider") ?? field(devops, "provider") ?? "-"}`,
    `Status     ${field(readiness, "status") ?? (httpStatus >= 200 && httpStatus < 300 ? "OK" : `HTTP_${httpStatus}`)}`,
    "",
    "Workflow",
    ...formatDevopsChecks(checks),
    "",
    "Next Action",
    String(field(readiness, "nextAction") ?? (blockers.length > 0 ? "repair" : "run-devops")),
    "",
    "Evidence",
    `- devops: /api/v1/projects/${projectId}/devops`,
    `- preflight: /api/v1/projects/${projectId}/devops/preflight`,
    `- pipelines: /api/v1/pipelines?project=${projectId}`,
    "",
    "Blockers",
    ...(blockers.length > 0 ? blockers.map((item) => `- ${String(item)}`) : ["- none"]),
    ""
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function formatDevopsChecks(checks: unknown[]): string[] {
  if (checks.length === 0) return ["[SKIP] No readiness checks returned."];
  return checks.map((item) => {
    const status = String(field(item, "status") ?? "SKIP");
    const evidence = Array.isArray(field(item, "evidence")) ? (field(item, "evidence") as unknown[]).join("; ") : "";
    return `[${status}] ${field(item, "id") ?? "check"} - ${evidence}`;
  });
}

function formatChain(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return ["[PENDING] No chain projection available."];
  return value.map((item: unknown) => {
    const status = String(field(item, "status") ?? "PENDING");
    return `[${status}] ${field(item, "label") ?? field(item, "id") ?? "node"} - ${field(item, "detail") ?? ""}`;
  });
}

function formatSteps(steps: Array<Record<string, unknown>>): string[] {
  if (steps.length === 0) return ["- none"];
  return steps.slice(-8).map((step) => `- ${step.type ?? "step"}${step.status ? ` status=${step.status}` : ""}${step.httpStatus ? ` http=${step.httpStatus}` : ""}${step.provider ? ` provider=${step.provider}` : ""}${step.nextAction ? ` next=${step.nextAction}` : ""}${step.projectId ? ` project=${step.projectId}` : ""}${step.targetId ? ` target=${step.targetId}` : ""}${step.goalId ? ` goal=${step.goalId}` : ""}${step.loopId ? ` loop=${step.loopId}` : ""}${Array.isArray(step.blockers) && step.blockers.length > 0 ? ` blockers=${step.blockers.length}` : ""}`);
}

function loopNextAction(loop: unknown): string {
  const status = String(field(loop, "status") ?? "");
  if (status === "PENDING") return "start-loop";
  if (status === "WAITING_APPROVAL") return "human-approval";
  if (status === "RUNNING" || status === "BLOCKED") return "resume-loop";
  if (status === "SUCCEEDED" && nestedField(loop, ["sourceClosure", "closureState"]) !== "PROMOTED") return "source-closure";
  if (status === "SUCCEEDED") return "done";
  return "repair";
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean | string[]> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("-")) {
      positionals.push(item);
      continue;
    }
    if (item === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    const normalized = item.replace(/^-+/, "");
    const [rawKey, inlineValue] = normalized.split(/=(.*)/s).filter((part) => part !== undefined);
    const key = shortOption(rawKey);
    const value = inlineValue !== undefined ? inlineValue
      : argv[index + 1] && !argv[index + 1].startsWith("-") ? argv[++index]
        : true;
    addOption(options, key, value);
  }
  return { positionals, options };
}

function shortOption(key: string): string {
  return ({ h: "help", j: "json" } as Record<string, string>)[key] ?? key;
}

function addOption(options: Record<string, string | boolean | string[]>, key: string, value: string | boolean): void {
  const existing = options[key];
  if (existing === undefined) {
    options[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(String(value));
  } else {
    options[key] = [String(existing), String(value)];
  }
}

function requestOptions(ctx: RuntimeContext): { idempotencyKey?: string } {
  return { idempotencyKey: stringOption(ctx.args, "idempotency-key") };
}

function requiredOption(args: ParsedArgs, name: string): string {
  const value = stringOption(args, name);
  if (!value) throw usage(`Missing required option --${name}.`);
  return value;
}

function stringOption(args: ParsedArgs, name: string): string | undefined {
  const value = args.options[name];
  if (Array.isArray(value)) return value.at(-1);
  if (typeof value === "string") return value;
  return undefined;
}

function repeatedOption(args: ParsedArgs, name: string): string[] {
  const value = args.options[name];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return [];
}

function numberOption(args: ParsedArgs, name: string): number | undefined {
  const value = stringOption(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw usage(`Option --${name} must be a number.`);
  return parsed;
}

function optionalBoolean(args: ParsedArgs, name: string): boolean | undefined {
  const value = args.options[name];
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw usage(`Option --${name} must be true or false.`);
}

function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.options[name] === true || args.options[name] === "true";
}

function hasAnyOption(args: ParsedArgs, names: string[]): boolean {
  return names.some((name) => args.options[name] !== undefined);
}

function resolveConfigPath(args: ParsedArgs): string {
  return stringOption(args, "config") ?? process.env.EVOPILOT_CONFIG ?? path.join(os.homedir(), ".evopilot", "config.json");
}

function readConfig(file: string): CliConfig {
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfig(file: string, config: CliConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function readJson(file: string): unknown {
  const content = file === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(file, "utf8");
  return JSON.parse(content);
}

function parseWriteFile(value: string): { path: string; content: string } {
  const separator = value.indexOf(":");
  if (separator <= 0) throw usage("--write-file must use <repo-path>:<local-content-file>.");
  const repoPath = value.slice(0, separator);
  const contentFile = value.slice(separator + 1);
  return { path: repoPath, content: fs.readFileSync(contentFile, "utf8") };
}

function parseScenario(value: string): { id: string; name: string; status: string; evidence: string[]; required: boolean } {
  const [id, status = "PASS"] = value.split("=");
  if (!id) throw usage("--scenario must use <id>=<PASS|FAIL|NOT-RUN|NOT-APPLICABLE>.");
  return {
    id,
    name: id,
    status: status.toUpperCase(),
    evidence: [`cli scenario ${id}=${status.toUpperCase()}`],
    required: true
  };
}

function parseKeyValueOptions(values: string[]): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0) throw usage("--deploy-input must use <key>=<value>.");
    result[value.slice(0, separator)] = value.slice(separator + 1);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function printOutput(ctx: RuntimeContext, data: unknown, text: string): void {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    process.stdout.write(`${text}\n`);
  }
}

function listSummary(value: unknown, fieldName: string): string {
  if (!Array.isArray(value)) return "ok";
  if (value.length === 0) return "No records.";
  return value
    .map((item) => isRecord(item) ? String(item[fieldName] ?? item.name ?? JSON.stringify(item)) : String(item))
    .join("\n");
}

function handleError(error: unknown, json: boolean): number {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    const body = error instanceof EvoPilotApiError ? error.body : undefined;
    process.stderr.write(`${JSON.stringify({ error: message, body }, null, 2)}\n`);
  } else {
    process.stderr.write(`error: ${message}\n`);
  }
  return error instanceof UsageError ? 64 : 1;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function usage(message: string): UsageError {
  return new UsageError(message);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function nestedField(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    current = field(current, key);
  }
  return current;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function stringField(value: unknown, key: string): string | undefined {
  const result = field(value, key);
  return typeof result === "string" ? result : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printVersion(json: boolean): void {
  const data = { name: "@evopilot/cli", version: readCliVersion() };
  process.stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : `${data.version}\n`);
}

function readCliVersion(): string {
  try {
    const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof packageJson.version === "string" ? packageJson.version : "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function printHelp(): void {
  process.stdout.write(`EvoPilot CLI

Usage:
  evopilot --version
  evopilot auth login --server <url> --username <user> --password <pass>
  evopilot auth token
  evopilot config path
  evopilot config show
  evopilot status [--json]
  evopilot project register --id <id> --provider <local-git|github|gitlab> [options]
  evopilot project list
  evopilot project preflight <project-id>
  evopilot project credentials set <project-id> [--token-ref <env>]
  evopilot project devops set <project-id> --provider <github-actions|gitlab-ci> [options]
  evopilot project devops inspect <project-id>
  evopilot project devops preflight <project-id>
  evopilot project devops clear <project-id>
  evopilot evidence push --project <id> --file <events.json>
  evopilot target templates
  evopilot target list
  evopilot target create --project <id> --template <experimental|alpha|beta|rc|ga>
  evopilot target run --project <id> --template <experimental|alpha|beta|rc|ga> --objective <text> [--max-steps <n>] [--timeout <duration>]
  evopilot target decision <target-id> [--project <id>]
  evopilot goal create --project <id> --target <target-id> --objective <text>
  evopilot goal run [<goal-id>] [--project <id> --target <target-id> --objective <text>] [--max-steps <n>] [--timeout <duration>]
  evopilot goal list [--project <id>] [--target <target-id>] [--status <status>]
  evopilot goal inspect <goal-id>
  evopilot goal plan <goal-id>
  evopilot goal approve-plan <goal-id>
  evopilot goal targets <goal-id>
  evopilot goal advance <goal-id> [--no-auto-start] [--approve-human-gate]
  evopilot goal snapshot <goal-id>
  evopilot goal graph <goal-id>
  evopilot goal timeline <goal-id>
  evopilot goal evidence-matrix <goal-id>
  evopilot goal final-report <goal-id>
  evopilot loop create --project <id> --target <target-id> --objective <text>
  evopilot loop list
  evopilot loop run [<loop-id>] [--project <id> --target <target-id> --objective <text>] [--max-iterations <n>] [--timeout <duration>]
  evopilot loop start <loop-id>
  evopilot loop approve <loop-id>
  evopilot source-closure preflight <loop-id>
  evopilot source-closure execute <loop-id> --write-file <repo-path>:<local-file>
  evopilot source-closure approve-release <loop-id>
  evopilot source-closure reject-release <loop-id> [--reason <text>]
  evopilot source-closure merge <loop-id>
  evopilot source-closure auto-merge <loop-id>
  evopilot release-run list [--loop <loop-id>]
  evopilot release-run inspect <run-id> [--loop <loop-id>]
  evopilot release-run repair-candidates [--include-repaired]
  evopilot release-run repair <run-id> [--execute]
  evopilot release-run repair-all [--execute]
  evopilot release-run finalizers [--status <PENDING|SUCCEEDED|FAILED>]
  evopilot worker queue
  evopilot worker leases
  evopilot worker claim --worker-id <id> [--loop <loop-id>]
  evopilot worker heartbeat --worker-id <id> --loop <loop-id>
  evopilot sandbox proof <loop-id>
  evopilot sandbox verify <loop-id>
  evopilot replay checkpoints <loop-id>
  evopilot replay run <loop-id> [--from-iteration <n>]
  evopilot trace tree <loop-id>
  evopilot trace events <loop-id>
  evopilot audit list [--limit <n>]
  evopilot connector deploy list
  evopilot connector deploy create --id <id> --type <http-webhook|ecs-docker-compose>
  evopilot release gate --project <id> --target <target-id> --scenario <id=PASS>
  evopilot release current
  evopilot release decisions [--project <id>] [--target <target-id>]

Global options:
  --server <url>              EvoPilot server URL
  --token <token>             Bearer token
  --tenant <id>               Tenant scope header
  --workspace <id>            Workspace scope header
  --actor <id>                Actor scope header
  --idempotency-key <key>     Idempotency key for mutating commands
  --timeout <duration>        Wrapper stop boundary, for example 30s, 10m, or 2h
  --until <policy>            Wrapper stop policy: terminal or blocked-or-complete
  --require-devops-ready      target run fails fast unless project DevOps preflight is READY
  --json                      Print JSON response data
  --config <file>             Config path, defaults to ~/.evopilot/config.json

Project DevOps examples:
  evopilot project devops set my-agent --provider github-actions --ci-workflow ci.yml --ci-required-check build --ci-required-check test --cd-workflow deploy-prod.yml --deploy-environment production --health-url https://app.example.com/health
  evopilot project devops set my-agent --provider gitlab-ci --ci-required-stage test --ci-required-job build --cd-required-stage deploy --deploy-environment production --ready-url https://app.example.com/ready
`);
}

main(process.argv.slice(2)).then((code) => {
  exitAfterFlush(code);
}).catch((error) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  exitAfterFlush(1);
});

function exitAfterFlush(code: number): void {
  const streams = [process.stdout, process.stderr].filter((stream) => stream.writableLength > 0);
  if (streams.length === 0) {
    process.exit(code);
    return;
  }
  let pending = streams.length;
  for (const stream of streams) {
    stream.write("", () => {
      pending -= 1;
      if (pending === 0) process.exit(code);
    });
  }
}
