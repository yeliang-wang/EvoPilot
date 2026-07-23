#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apiErrorFromResponse, EvoPilotApiError, EvoPilotClient, type EvoPilotRequestOptions, type EvoPilotResponse } from "@evopilot/client";

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
  cli: CliRuntimeInfo;
  llmUsage: CliLlmUsageTracker;
}

interface CliRuntimeInfo {
  schema: "evopilot-cli-runtime/v1";
  name: "@evopilot/cli";
  version: string;
  command: string;
  surface: string;
  platform: NodeJS.Platform;
  pid: number;
  tty: boolean;
}

interface CliLlmUsageTracker {
  schema: "evopilot-cli-llm-usage-tracker/v1";
  responses: CliLlmUsageStep[];
  latest?: LlmUsageMeta;
}

interface CliLlmUsageStep {
  label: string;
  requestId?: string;
  provider?: string;
  model?: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  creditsConsumed: number;
  creditUnit: "token";
  cumulativeTotalTokens: number;
}

interface LlmUsageMeta {
  schema?: string;
  configured?: boolean;
  provider?: string;
  model?: string;
  version?: string;
  calls?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  creditsConsumed?: number;
  creditUnit?: "token";
  latest?: Record<string, unknown>;
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
  const cli = cliRuntimeInfo(args);
  const ctx: RuntimeContext = {
    args,
    configPath,
    config,
    client: new EvoPilotClient({ serverUrl: server, token, tenantId, workspaceId, actor, headers: cliRequestHeaders(cli) }),
    json: hasFlag(args, "json"),
    cli,
    llmUsage: {
      schema: "evopilot-cli-llm-usage-tracker/v1",
      responses: []
    }
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
      case "project:onboard":
        if (maybeId === "plan") return await projectOnboardPlan(ctx, args.positionals[3]);
        if (maybeId === "verify") return await projectOnboardVerify(ctx, args.positionals[3]);
        return await projectOnboard(ctx, maybeId);
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
      case "project:llm":
        if (maybeId === "set") return await projectLlmSet(ctx, args.positionals[3]);
        if (maybeId === "inspect") return await projectLlmInspect(ctx, args.positionals[3]);
        if (maybeId === "preflight") return await projectLlmPreflight(ctx, args.positionals[3]);
        if (maybeId === "clear") return await projectLlmClear(ctx, args.positionals[3]);
        throw usage("Use: evopilot project llm <set|inspect|preflight|clear> <project-id> [options]");
      case "llm:profile":
        if (maybeId === "list") return await llmProfileList(ctx);
        if (maybeId === "set") return await llmProfileSet(ctx, args.positionals[3]);
        if (maybeId === "inspect") return await llmProfileInspect(ctx, args.positionals[3]);
        if (maybeId === "preflight") return await llmProfilePreflight(ctx, args.positionals[3]);
        throw usage("Use: evopilot llm profile <list|set|inspect|preflight> [profile-id] [options]");
      case "secret:list":
        return await secretList(ctx);
      case "secret:set":
        return await secretSet(ctx);
      case "secret:revoke":
        return await secretRevoke(ctx, maybeId);
      case "github-app:installation":
        if (maybeId === "list") return await githubAppInstallationList(ctx);
        if (maybeId === "set") return await githubAppInstallationSet(ctx);
        if (maybeId === "preflight") return await githubAppInstallationPreflight(ctx, args.positionals[3]);
        throw usage("Use: evopilot github-app installation <list|set|preflight> [options]");
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
  recordResponseLlmUsage(ctx, "status.health", health);
  const ready = await ctx.client.get("/ready");
  recordResponseLlmUsage(ctx, "status.ready", ready);
  let version: EvoPilotResponse | undefined;
  try {
    version = await ctx.client.get("/api/v1/version");
    recordResponseLlmUsage(ctx, "status.version", version);
  } catch {
    version = undefined;
  }
  let summary: EvoPilotResponse | undefined;
  if (ctx.client.token) {
    summary = await ctx.client.get("/api/v1/summary");
    recordResponseLlmUsage(ctx, "status.summary", summary);
  }
  const data = {
    schema: "evopilot-cli-status/v1",
    server: ctx.client.serverUrl.replace(/\/$/, ""),
    cli: { name: "@evopilot/cli", version: readCliVersion() },
    client: ctx.cli,
    api: version?.ok ? version.data ?? version.body : undefined,
    health: health.body,
    ready: ready.body,
    summary: summary?.ok ? summary.data : undefined,
    llmUsage: cliLlmUsageReport(ctx),
    requestIds: {
      health: health.requestId,
      ready: ready.requestId,
      version: version?.requestId,
      summary: summary?.requestId
    }
  };
  const llmSummary = field(data.llmUsage, "summary");
  printOutput(ctx, data, `health=${field(data.health, "status") ?? health.status} ready=${field(data.ready, "status") ?? ready.status} llm=${field(llmSummary, "provider") ?? "-"}:${field(llmSummary, "model") ?? "-"} tokens=${field(llmSummary, "totalTokens") ?? 0}`);
  return health.ok && ready.ok && (!summary || summary.ok) ? 0 : 2;
}

async function projectRegister(ctx: RuntimeContext): Promise<number> {
  const id = requiredOption(ctx.args, "id");
  const provider = requiredOption(ctx.args, "provider");
  const body = projectRegistrationBody(ctx.args, id, provider);
  const response = await ctx.client.expectOk(ctx.client.post("/api/v1/projects", body, requestOptions(ctx)));
  printOutput(ctx, response.data, `project=${field(response.data, "id")} validation=${nestedField(response.data, ["validation", "status"])}`);
  return 0;
}

async function projectOnboard(ctx: RuntimeContext, providerArg?: string): Promise<number> {
  const provider = providerArg ?? stringOption(ctx.args, "provider");
  if (!provider || !["local-git", "github", "gitlab"].includes(provider)) {
    throw usage("Use: evopilot project onboard <github|gitlab|local-git> [options]");
  }
  enforceProjectDevopsBoundaryOptions(ctx.args, provider, "project onboard");
  const projectId = stringOption(ctx.args, "id") ?? deriveProjectId(ctx.args, provider);
  const steps: Array<Record<string, unknown>> = [];
  const register = await ctx.client.post("/api/v1/projects", projectRegistrationBody(ctx.args, projectId, provider), derivedRequestOptions(ctx, "project-onboard-register"));
  const project = register.data ?? register.body;
  steps.push(attachStepLlmUsage(ctx, {
    type: "project.register",
    projectId,
    httpStatus: register.status,
    requestId: register.requestId,
    status: nestedField(project, ["validation", "status"]) ?? (register.ok ? "VERIFIED" : "FAILED")
  }, "project-onboard-register", register));
  if (!register.ok) {
    return finishProjectOnboard(ctx, projectId, project, undefined, undefined, undefined, steps, 2);
  }

  const sourcePreflight = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/source-credentials/preflight`, {}, derivedRequestOptions(ctx, "project-onboard-source-preflight"));
  const sourceReadiness = sourcePreflight.data ?? sourcePreflight.body;
  steps.push(attachStepLlmUsage(ctx, {
    type: "project.source-credentials.preflight",
    projectId,
    httpStatus: sourcePreflight.status,
    requestId: sourcePreflight.requestId,
    status: field(sourceReadiness, "status"),
    nextAction: field(sourceReadiness, "nextAction"),
    blockers: field(sourceReadiness, "blockers")
  }, "project-onboard-source-preflight", sourcePreflight));
  if (hasFlag(ctx.args, "require-source-ready") && field(sourceReadiness, "status") !== "READY") {
    return finishProjectOnboard(ctx, projectId, project, sourceReadiness, undefined, undefined, steps, 2);
  }

  let devopsResult: unknown;
  if (shouldConfigureProjectDevops(ctx.args, provider)) {
    const devopsProvider = nativeDevopsProvider(provider);
    if (!devopsProvider) throw usage("Project DevOps can only be configured automatically for github or gitlab projects.");
    const devops = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/devops`, buildProjectDevopsBody(ctx.args, devopsProvider), derivedRequestOptions(ctx, "project-onboard-devops-set"));
    devopsResult = devops.data ?? devops.body;
    steps.push(attachStepLlmUsage(ctx, {
      type: "project.devops.set",
      projectId,
      httpStatus: devops.status,
      requestId: devops.requestId,
      provider: nestedField(devopsResult, ["devops", "provider"]) ?? field(devopsResult, "provider"),
      status: nestedField(devopsResult, ["readiness", "status"]) ?? field(devopsResult, "status"),
      nextAction: nestedField(devopsResult, ["readiness", "nextAction"]) ?? field(devopsResult, "nextAction"),
      blockers: nestedField(devopsResult, ["readiness", "blockers"]) ?? field(devopsResult, "blockers")
    }, "project-onboard-devops-set", devops));
    if (!devops.ok && hasFlag(ctx.args, "require-devops-ready")) {
      return finishProjectOnboard(ctx, projectId, project, sourceReadiness, devopsResult, undefined, steps, 2);
    }
  }

  let devopsReadiness: unknown;
  if (stringOption(ctx.args, "execution-mode") === "read-only-public") {
    devopsReadiness = {
      status: "SKIP",
      executionMode: "read-only-public",
      claimBoundary: "read-only-analysis",
      nextAction: "read-only-analysis"
    };
    steps.push({
      type: "project.devops.preflight",
      projectId,
      status: "SKIP",
      nextAction: "read-only-analysis",
      blockers: ["read-only-public does not claim repository-native DevOps readiness"]
    });
  } else {
    const devopsPreflight = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/devops/preflight`, {}, derivedRequestOptions(ctx, "project-onboard-devops-preflight"));
    devopsReadiness = devopsPreflight.data ?? devopsPreflight.body;
    steps.push(attachStepLlmUsage(ctx, {
      type: "project.devops.preflight",
      projectId,
      httpStatus: devopsPreflight.status,
      requestId: devopsPreflight.requestId,
      provider: field(devopsReadiness, "provider"),
      status: field(devopsReadiness, "status"),
      nextAction: field(devopsReadiness, "nextAction"),
      blockers: field(devopsReadiness, "blockers")
    }, "project-onboard-devops-preflight", devopsPreflight));
    if (hasFlag(ctx.args, "require-devops-ready") && field(devopsReadiness, "status") !== "READY") {
      return finishProjectOnboard(ctx, projectId, project, sourceReadiness, devopsReadiness, undefined, steps, 2);
    }
  }

  let llmReadiness: unknown;
  if (stringOption(ctx.args, "llm-profile") || stringOption(ctx.args, "llm-profile-id") || hasFlag(ctx.args, "require-llm-ready")) {
    const llmPreflight = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/llm/preflight`, {}, derivedRequestOptions(ctx, "project-onboard-llm-preflight"));
    llmReadiness = llmPreflight.data ?? llmPreflight.body;
    steps.push(attachStepLlmUsage(ctx, {
      type: "project.llm.preflight",
      projectId,
      httpStatus: llmPreflight.status,
      requestId: llmPreflight.requestId,
      profileId: field(llmReadiness, "profileId"),
      llmProvider: field(llmReadiness, "provider"),
      llmModel: field(llmReadiness, "model"),
      status: field(llmReadiness, "status"),
      nextAction: field(llmReadiness, "nextAction"),
      blockers: field(llmReadiness, "blockers")
    }, "project-onboard-llm-preflight", llmPreflight));
    if (hasFlag(ctx.args, "require-llm-ready") && field(llmReadiness, "status") !== "READY") {
      return finishProjectOnboard(ctx, projectId, project, sourceReadiness, devopsReadiness, llmReadiness, steps, 2);
    }
  }

  const templateId = stringOption(ctx.args, "template");
  if (templateId || hasFlag(ctx.args, "run-target")) {
    if (!templateId) throw usage("project onboard target execution requires --template.");
    const targetId = stringOption(ctx.args, "target") ?? `${projectId}-${templateId}`;
    const existing = await readReleaseTarget(ctx, targetId);
    if (existing) {
      steps.push({ type: "target.resolved", targetId, status: field(existing, "scope") ?? "project" });
    } else {
      const created = await createProjectReleaseTarget(ctx, projectId, templateId, targetId);
      steps.push({ type: "target.created", targetId: field(created, "id"), templateId });
    }
    const objective = stringOption(ctx.args, "objective") ?? `Promote ${projectId} to ${templateId} with source closure, native DevOps evidence, deploy evidence, release decision, and blocker review.`;
    return await runGoalWrapper(ctx, {
      command: "project onboard",
      projectId,
      targetId,
      objective,
      initialSteps: steps
    });
  }

  return finishProjectOnboard(ctx, projectId, project, sourceReadiness, devopsReadiness, llmReadiness, steps, 0);
}

async function projectOnboardPlan(ctx: RuntimeContext, providerArg?: string): Promise<number> {
  const provider = providerArg ?? stringOption(ctx.args, "provider");
  if (!provider || !["local-git", "github", "gitlab"].includes(provider)) {
    throw usage("Use: evopilot project onboard plan <github|gitlab|local-git> [options]");
  }
  enforceProjectDevopsBoundaryOptions(ctx.args, provider, "project onboard plan");
  const body = projectOnboardingChecklistBody(ctx.args, provider);
  const response = await ctx.client.post("/api/v1/onboarding/project/checklist", body, requestOptions(ctx));
  const checklist = response.data ?? response.body;
  printProjectOnboardingChecklist(ctx, "project onboard plan", checklist, response.status, response.requestId);
  return onboardingChecklistExitCode(checklist, "plan", response.ok);
}

async function projectOnboardVerify(ctx: RuntimeContext, id?: string): Promise<number> {
  const projectId = id ?? requiredOption(ctx.args, "project");
  const response = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/onboarding-checklist`, {
    ...requestOptions(ctx),
    query: {
      template: stringOption(ctx.args, "template"),
      objective: stringOption(ctx.args, "objective")
    }
  });
  const checklist = response.data ?? response.body;
  printProjectOnboardingChecklist(ctx, "project onboard verify", checklist, response.status, response.requestId);
  return onboardingChecklistExitCode(checklist, "verify", response.ok);
}

function projectRegistrationBody(args: ParsedArgs, id: string, provider: string): Record<string, unknown> {
  return {
    id,
    name: stringOption(args, "name") ?? id,
    profileId: stringOption(args, "profile-id"),
    llmProfileId: stringOption(args, "llm-profile") ?? stringOption(args, "llm-profile-id"),
    tenantId: stringOption(args, "tenant") ?? stringOption(args, "tenant-id"),
    workspaceId: stringOption(args, "workspace") ?? stringOption(args, "workspace-id"),
    repository: projectRepositoryBody(args, provider)
  };
}

function projectOnboardingChecklistBody(args: ParsedArgs, provider: string): Record<string, unknown> {
  const id = optionalDerivedProjectId(args, provider);
  const body: Record<string, unknown> = {
    id,
    name: stringOption(args, "name") ?? id,
    profileId: stringOption(args, "profile-id"),
    tenantId: stringOption(args, "tenant") ?? stringOption(args, "tenant-id"),
    workspaceId: stringOption(args, "workspace") ?? stringOption(args, "workspace-id"),
    repository: projectRepositoryBody(args, provider),
    llmProfileId: stringOption(args, "llm-profile") ?? stringOption(args, "llm-profile-id"),
    requireLlmReady: hasFlag(args, "require-llm-ready"),
    template: stringOption(args, "template"),
    releaseTargetTemplate: stringOption(args, "release-target-template"),
    objective: stringOption(args, "objective"),
    githubAppInstallationId: stringOption(args, "github-app-installation-id") ?? stringOption(args, "github-app-id") ?? stringOption(args, "installation-id")
  };
  const devopsProvider = nativeDevopsProvider(provider);
  if (devopsProvider && shouldConfigureProjectDevops(args, provider)) {
    body.devops = buildProjectDevopsBody(args, devopsProvider);
  }
  return body;
}

function projectRepositoryBody(args: ParsedArgs, provider: string): Record<string, unknown> {
  const repo = stringOption(args, "repo");
  const workingRepo = stringOption(args, "working-repo");
  const registrationRepo = provider === "github" ? workingRepo ?? repo : repo;
  const ownerRepo = registrationRepo?.includes("/") ? registrationRepo.split("/") : undefined;
  const upstreamRepo = stringOption(args, "upstream-repo") ?? (workingRepo ? repo : undefined);
  return {
    provider,
    root: stringOption(args, "root"),
    gitUrl: stringOption(args, "git-url") ?? stringOption(args, "url"),
    baseUrl: stringOption(args, "base-url"),
    projectId: provider === "gitlab" ? workingRepo ?? stringOption(args, "project-id") ?? repo : stringOption(args, "project-id"),
    owner: stringOption(args, "owner") ?? ownerRepo?.[0],
    repo: stringOption(args, "repo-name") ?? ownerRepo?.slice(1).join("/") ?? (!ownerRepo ? registrationRepo : undefined),
    defaultBranch: stringOption(args, "branch") ?? stringOption(args, "default-branch"),
    executionMode: stringOption(args, "execution-mode"),
    upstreamRepo,
    workingRepo,
    claimBoundary: stringOption(args, "claim-boundary"),
    username: stringOption(args, "username"),
    password: stringOption(args, "password"),
    token: stringOption(args, "source-token"),
    tokenRef: stringOption(args, "token-ref")
  };
}

function optionalDerivedProjectId(args: ParsedArgs, provider: string): string | undefined {
  const explicit = stringOption(args, "id");
  if (explicit) return explicit;
  try {
    return deriveProjectId(args, provider);
  } catch (error) {
    if (error instanceof UsageError) return undefined;
    throw error;
  }
}

function deriveProjectId(args: ParsedArgs, provider: string): string {
  if (provider === "github") {
    const repo = stringOption(args, "working-repo") ?? stringOption(args, "repo");
    const ownerRepo = repo?.includes("/") ? repo.split("/") : undefined;
    const owner = stringOption(args, "owner") ?? ownerRepo?.[0];
    const repoName = stringOption(args, "repo-name") ?? ownerRepo?.slice(1).join("-") ?? (!ownerRepo ? repo : undefined);
    const id = safeCliId([owner, repoName].filter(Boolean).join("-"));
    if (id) return id;
  }
  if (provider === "gitlab") {
    const projectId = stringOption(args, "working-repo") ?? stringOption(args, "project-id") ?? stringOption(args, "repo") ?? stringOption(args, "git-url");
    const id = safeCliId(projectId ?? "");
    if (id) return id;
  }
  if (provider === "local-git") {
    const root = stringOption(args, "root");
    const id = root ? safeCliId(path.basename(path.resolve(root))) : undefined;
    if (id) return id;
  }
  throw usage("project onboard requires --id or repository coordinates that can derive a stable project id.");
}

function safeCliId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function nativeDevopsProvider(sourceProvider: string): "github-actions" | "gitlab-ci" | undefined {
  if (sourceProvider === "github") return "github-actions";
  if (sourceProvider === "gitlab") return "gitlab-ci";
  return undefined;
}

function shouldConfigureProjectDevops(args: ParsedArgs, sourceProvider: string): boolean {
  return Boolean(
    nativeDevopsProvider(sourceProvider) &&
    (hasFlag(args, "with-devops") || hasFlag(args, "require-devops-ready") || hasAnyOption(args, [
      "devops-provider",
      "ci-workflow",
      "workflow",
      "ci-ref",
      "ref",
      "ci-required-check",
      "required-check",
      "ci-required-stage",
      "required-stage",
      "ci-required-job",
      "required-job",
      "ci-timeout-seconds",
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
      "deploy-timeout-seconds",
      "devops-token-ref",
      "devops-owner",
      "devops-namespace",
      "workflow-repo",
      "credential-principal"
    ]))
  );
}

function enforceProjectDevopsBoundaryOptions(args: ParsedArgs, sourceProvider: string | undefined, command: string): void {
  const shouldConfigure = sourceProvider ? shouldConfigureProjectDevops(args, sourceProvider) : true;
  if (!shouldConfigure) return;
  const executionMode = stringOption(args, "execution-mode");
  const devopsOwner = stringOption(args, "devops-owner") ?? stringOption(args, "devops-namespace");
  if (!executionMode) {
    throw usage(`${command} DevOps ownership is ambiguous. Add --execution-mode <owned-repository|fork-validated-pr|upstream-authorized|read-only-public> and --devops-owner <github-or-gitlab-account>.`);
  }
  if (!devopsOwner) {
    throw usage(`${command} requires --devops-owner <github-or-gitlab-account> when configuring repository-native DevOps.`);
  }
  if (executionMode === "read-only-public") {
    throw usage(`${command} cannot configure DevOps with --execution-mode read-only-public. Use fork-validated-pr with a working fork, or upstream-authorized with maintainer credentials.`);
  }
  if (executionMode === "fork-validated-pr") {
    if (!stringOption(args, "upstream-repo")) throw usage(`${command} --execution-mode fork-validated-pr requires --upstream-repo <owner/repo-or-group/project>.`);
    if (!stringOption(args, "working-repo")) throw usage(`${command} --execution-mode fork-validated-pr requires --working-repo <owner/repo-or-group/project>.`);
  }
}

function buildProjectDevopsBody(args: ParsedArgs, fallbackProvider?: "github-actions" | "gitlab-ci"): Record<string, unknown> {
  const provider = stringOption(args, "devops-provider") ?? stringOption(args, "provider") ?? fallbackProvider;
  if (!provider) throw usage("project devops set requires --provider <github-actions|gitlab-ci>.");
  const cdConfigured = hasAnyOption(args, [
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
  return {
    provider,
    executionMode: stringOption(args, "execution-mode"),
    devopsOwner: stringOption(args, "devops-owner"),
    devopsNamespace: stringOption(args, "devops-namespace"),
    workingRepo: stringOption(args, "working-repo"),
    upstreamRepo: stringOption(args, "upstream-repo"),
    workflowRepo: stringOption(args, "workflow-repo"),
    credentialPrincipal: stringOption(args, "credential-principal"),
    claimBoundary: stringOption(args, "claim-boundary"),
    tokenRef: stringOption(args, "devops-token-ref") ?? (fallbackProvider ? undefined : stringOption(args, "token-ref")),
    ci: {
      workflow: stringOption(args, "ci-workflow") ?? stringOption(args, "workflow"),
      ref: stringOption(args, "ci-ref") ?? stringOption(args, "ref") ?? stringOption(args, "branch"),
      requiredChecks: [
        ...repeatedOption(args, "ci-required-check"),
        ...repeatedOption(args, "required-check")
      ],
      requiredStages: [
        ...repeatedOption(args, "ci-required-stage"),
        ...repeatedOption(args, "required-stage")
      ],
      requiredJobs: [
        ...repeatedOption(args, "ci-required-job"),
        ...repeatedOption(args, "required-job")
      ],
      timeoutSeconds: numberOption(args, "ci-timeout-seconds")
    },
    cd: cdConfigured ? {
      workflow: stringOption(args, "cd-workflow") ?? stringOption(args, "deploy-workflow"),
      environment: stringOption(args, "deploy-environment") ?? stringOption(args, "environment"),
      requiredStages: repeatedOption(args, "cd-required-stage"),
      requiredJobs: repeatedOption(args, "cd-required-job"),
      deployInputs: parseKeyValueOptions(repeatedOption(args, "deploy-input")),
      healthUrl: stringOption(args, "health-url"),
      readyUrl: stringOption(args, "ready-url"),
      timeoutSeconds: numberOption(args, "cd-timeout-seconds") ?? numberOption(args, "deploy-timeout-seconds")
    } : undefined
  };
}

function buildLlmProfileBody(args: ParsedArgs, profileId: string): Record<string, unknown> {
  return {
    id: profileId,
    name: stringOption(args, "name") ?? profileId,
    provider: stringOption(args, "provider") ?? "openai-compatible",
    providerName: stringOption(args, "provider-name") ?? stringOption(args, "provider") ?? "openai-compatible",
    baseUrl: requiredOption(args, "base-url"),
    modelName: stringOption(args, "model-name") ?? requiredOption(args, "model"),
    apiKeyRef: stringOption(args, "api-key-ref") ?? stringOption(args, "token-ref") ?? requiredOption(args, "api-key-ref"),
    timeoutSeconds: numberOption(args, "timeout-seconds"),
    maxRetries: numberOption(args, "max-retries"),
    defaultMaxOutputTokens: numberOption(args, "default-max-output-tokens"),
    maxOutputTokens: numberOption(args, "max-output-tokens"),
    temperature: numberOption(args, "temperature"),
    thinkingType: stringOption(args, "thinking"),
    status: hasFlag(args, "disabled") ? "DISABLED" : "ACTIVE",
    tenantId: stringOption(args, "tenant") ?? stringOption(args, "tenant-id"),
    workspaceId: stringOption(args, "workspace") ?? stringOption(args, "workspace-id")
  };
}

function finishProjectOnboard(ctx: RuntimeContext, projectId: string, project: unknown, sourceCredentials: unknown, devops: unknown, llm: unknown, steps: Array<Record<string, unknown>>, exitCode: number): number {
  const result = {
    schema: "evopilot-cli-project-onboard/v1",
    projectId,
    project,
    sourceCredentials,
    devops,
    llm,
    steps,
    result: {
      exitCode,
      sourceCredentialStatus: field(sourceCredentials, "status") ?? "UNKNOWN",
      devopsStatus: field(devops, "status") ?? nestedField(devops, ["readiness", "status"]) ?? "UNKNOWN",
      llmStatus: field(llm, "status") ?? "UNKNOWN",
      nextAction: field(llm, "nextAction") ?? field(devops, "nextAction") ?? field(sourceCredentials, "nextAction") ?? "target-run"
    },
    llmUsage: cliLlmUsageReport(ctx),
    generatedAt: new Date().toISOString()
  };
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return exitCode;
  }
  const lines = [
    "EvoPilot Project Onboard",
    `Project    ${projectId}`,
    `Source     ${field(sourceCredentials, "status") ?? "UNKNOWN"}`,
    `DevOps     ${field(devops, "status") ?? nestedField(devops, ["readiness", "status"]) ?? "UNKNOWN"}`,
    `LLM        ${field(llm, "status") ?? "UNKNOWN"}`,
    "",
    "Execution Boundary",
    ...formatExecutionBoundary(readinessLike(devops), project),
    "",
    "Workflow",
    ...formatSteps(steps),
    "",
    "LLM Usage",
    ...formatLlmUsage(undefined, steps),
    "",
    "Next Action",
    String(result.result.nextAction),
    ""
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return exitCode;
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
  enforceProjectDevopsBoundaryOptions(ctx.args, undefined, "project devops set");
  const body = buildProjectDevopsBody(ctx.args);
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

async function llmProfileList(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/llm-profiles"));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function llmProfileSet(ctx: RuntimeContext, id?: string): Promise<number> {
  const profileId = id ?? stringOption(ctx.args, "id") ?? stringOption(ctx.args, "profile");
  if (!profileId) throw usage("llm profile set requires <profile-id> or --id <profile-id>.");
  const body = buildLlmProfileBody(ctx.args, profileId);
  const response = await ctx.client.post("/api/v1/llm-profiles", body, requestOptions(ctx));
  printLlmProfileResult(ctx, "llm profile set", response.data ?? response.body, response.status);
  return response.ok ? 0 : 2;
}

async function llmProfileInspect(ctx: RuntimeContext, id?: string): Promise<number> {
  const profileId = id ?? requiredOption(ctx.args, "profile");
  const response = await ctx.client.get(`/api/v1/llm-profiles/${encodeURIComponent(profileId)}`);
  printLlmProfileResult(ctx, "llm profile inspect", response.data ?? response.body, response.status);
  return response.ok ? 0 : 2;
}

async function llmProfilePreflight(ctx: RuntimeContext, id?: string): Promise<number> {
  const profileId = id ?? requiredOption(ctx.args, "profile");
  const response = await ctx.client.post(`/api/v1/llm-profiles/${encodeURIComponent(profileId)}/preflight`, {}, requestOptions(ctx));
  printLlmProfileResult(ctx, "llm profile preflight", response.data ?? response.body, response.status);
  return response.ok ? 0 : 2;
}

async function projectLlmSet(ctx: RuntimeContext, id?: string): Promise<number> {
  const projectId = id ?? requiredOption(ctx.args, "project");
  const body = {
    profileId: requiredOption(ctx.args, "profile"),
    required: hasFlag(ctx.args, "optional") ? false : true
  };
  const response = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/llm`, body, requestOptions(ctx));
  if (response.ok && hasFlag(ctx.args, "require-llm-ready")) {
    const preflight = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/llm/preflight`, {}, requestOptions(ctx));
    const combined = {
      ...(isRecord(response.data) ? response.data : {}),
      readiness: preflight.data ?? preflight.body,
      preflight: preflight.data ?? preflight.body
    };
    printProjectLlmResult(ctx, "project llm set", projectId, combined, preflight.status);
    return preflight.ok ? 0 : 2;
  }
  printProjectLlmResult(ctx, "project llm set", projectId, response.data ?? response.body, response.status);
  return response.ok ? 0 : 2;
}

async function projectLlmInspect(ctx: RuntimeContext, id?: string): Promise<number> {
  const projectId = id ?? requiredOption(ctx.args, "project");
  const response = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/llm`);
  printProjectLlmResult(ctx, "project llm inspect", projectId, response.data ?? response.body, response.status);
  return response.ok ? 0 : 2;
}

async function projectLlmPreflight(ctx: RuntimeContext, id?: string): Promise<number> {
  const projectId = id ?? requiredOption(ctx.args, "project");
  const response = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/llm/preflight`, {}, requestOptions(ctx));
  printProjectLlmResult(ctx, "project llm preflight", projectId, response.data ?? response.body, response.status);
  return response.ok ? 0 : 2;
}

async function projectLlmClear(ctx: RuntimeContext, id?: string): Promise<number> {
  const projectId = id ?? requiredOption(ctx.args, "project");
  const response = await ctx.client.request("DELETE", `/api/v1/projects/${encodeURIComponent(projectId)}/llm`, requestOptions(ctx));
  printProjectLlmResult(ctx, "project llm clear", projectId, response.data ?? response.body, response.status);
  return response.ok ? 0 : 2;
}

async function secretList(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/secrets"));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function secretSet(ctx: RuntimeContext): Promise<number> {
  const id = stringOption(ctx.args, "id") ?? stringOption(ctx.args, "secret-ref") ?? stringOption(ctx.args, "name");
  if (!id) throw usage("secret set requires --id <secret-ref>.");
  const value = secretValueFromArgs(ctx.args);
  const body = {
    id,
    name: stringOption(ctx.args, "name") ?? id,
    kind: stringOption(ctx.args, "kind") ?? "source-token",
    value,
    tenantId: stringOption(ctx.args, "tenant") ?? stringOption(ctx.args, "tenant-id"),
    workspaceId: stringOption(ctx.args, "workspace") ?? stringOption(ctx.args, "workspace-id")
  };
  const response = await ctx.client.post("/api/v1/secrets", body, requestOptions(ctx));
  printOutput(ctx, response.data ?? response.body, `secret=${field(response.data, "secretRef") ?? field(response.data, "id") ?? id} status=${field(response.data, "status") ?? response.status}`);
  return response.ok ? 0 : 2;
}

async function secretRevoke(ctx: RuntimeContext, id?: string): Promise<number> {
  const secretId = id ?? requiredOption(ctx.args, "id");
  const response = await ctx.client.post(`/api/v1/secrets/${encodeURIComponent(secretId)}/revoke`, {}, requestOptions(ctx));
  printOutput(ctx, response.data ?? response.body, `secret=${secretId} status=${field(response.data, "status") ?? response.status}`);
  return response.ok ? 0 : 2;
}

async function githubAppInstallationList(ctx: RuntimeContext): Promise<number> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/github-app/installations"));
  printOutput(ctx, response.data, listSummary(response.data, "id"));
  return 0;
}

async function githubAppInstallationSet(ctx: RuntimeContext): Promise<number> {
  const body = {
    id: stringOption(ctx.args, "id"),
    installationId: requiredOption(ctx.args, "installation-id"),
    account: requiredOption(ctx.args, "account"),
    privateKeySecretRef: stringOption(ctx.args, "private-key-secret-ref"),
    webhookSecretRef: stringOption(ctx.args, "webhook-secret-ref"),
    repositories: [
      ...repeatedOption(ctx.args, "repository"),
      ...repeatedOption(ctx.args, "repo")
    ],
    permissions: parseKeyValuePairs(repeatedOption(ctx.args, "permission"), "--permission"),
    tenantId: stringOption(ctx.args, "tenant") ?? stringOption(ctx.args, "tenant-id"),
    workspaceId: stringOption(ctx.args, "workspace") ?? stringOption(ctx.args, "workspace-id")
  };
  const response = await ctx.client.post("/api/v1/github-app/installations", body, requestOptions(ctx));
  printOutput(ctx, response.data ?? response.body, `githubApp=${field(response.data, "id") ?? body.id ?? body.installationId} status=${field(response.data, "status") ?? response.status}`);
  return response.ok ? 0 : 2;
}

async function githubAppInstallationPreflight(ctx: RuntimeContext, id?: string): Promise<number> {
  const installationId = id ?? requiredOption(ctx.args, "id");
  const response = await ctx.client.post(`/api/v1/github-app/installations/${encodeURIComponent(installationId)}/preflight`, {}, requestOptions(ctx));
  printOutput(ctx, response.data ?? response.body, `githubApp=${installationId} status=${field(response.data, "status") ?? response.status}`);
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
  const sourcePreflight = await tryProjectSourceCredentialPreflight(ctx, projectId);
  steps.push(sourcePreflight);
  if (hasFlag(ctx.args, "require-source-ready") && sourcePreflight.status !== "READY") {
    throw usage(`Project source credentials are not READY: ${sourcePreflight.status}`);
  }
  const devopsPreflight = await tryProjectDevopsPreflight(ctx, projectId);
  steps.push(devopsPreflight);
  if (hasFlag(ctx.args, "require-devops-ready") && devopsPreflight.status !== "READY") {
    throw usage(`Project DevOps is not READY: ${devopsPreflight.status}`);
  }
  const llmPreflight = await tryLlmReadinessPreflight(ctx, projectId);
  steps.push(llmPreflight);
  if (hasFlag(ctx.args, "require-llm-ready") && llmPreflight.status !== "READY") {
    throw usage(`Project LLM is not READY: ${llmPreflight.status}`);
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
    llmProfileId: stringOption(ctx.args, "llm-profile") ?? stringOption(ctx.args, "llm-profile-id"),
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
    llmProfileId: stringOption(ctx.args, "llm-profile") ?? stringOption(ctx.args, "llm-profile-id"),
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
      llmProfileId: stringOption(ctx.args, "llm-profile") ?? stringOption(ctx.args, "llm-profile-id"),
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
    steps.push(attachStepLlmUsage(ctx, { type: "loop.created", loopId, status: field(createResponse.data, "status") }, "loop-run-create", createResponse));
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
      steps.push(attachStepLlmUsage(ctx, { type: "loop.approved", loopId, status: field(loop, "status"), iteration: field(loop, "currentIteration") }, `loop-run-approve-${index + 1}`, approved));
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
    steps.push(attachStepLlmUsage(ctx, { type: `loop.${action}`, loopId, status: field(loop, "status"), iteration: field(loop, "currentIteration") }, `loop-run-${action}-${index + 1}`, response));
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
    llmUsage: cliLlmUsageReport(ctx, nestedField(loop, ["trace", "llmUsage"])),
    generatedAt: new Date().toISOString()
  };
  if (ctx.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (quiet) process.stdout.write(formatLoopRunStatus("loop run", loop, steps, ctx.cli));
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

async function tryProjectSourceCredentialPreflight(ctx: RuntimeContext, projectId: string): Promise<Record<string, unknown>> {
  try {
    const response = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/source-credentials/preflight`, {}, derivedRequestOptions(ctx, "target-run-source-preflight"));
    const readiness = isRecord(response.data) ? response.data : undefined;
    return attachStepLlmUsage(ctx, {
      type: "project.source-credentials.preflight",
      projectId,
      httpStatus: response.status,
      requestId: response.requestId,
      status: field(readiness, "status") ?? (response.ok ? "READY" : "BLOCKED"),
      nextAction: field(readiness, "nextAction"),
      provider: field(readiness, "provider"),
      blockers: field(readiness, "blockers")
    }, "target-run-source-preflight", response);
  } catch (error) {
    return {
      type: "project.source-credentials.preflight",
      projectId,
      status: "UNAVAILABLE",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function tryProjectDevopsPreflight(ctx: RuntimeContext, projectId: string): Promise<Record<string, unknown>> {
  try {
    const response = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/devops/preflight`, {}, derivedRequestOptions(ctx, "target-run-devops-preflight"));
    const readiness = isRecord(response.data) ? response.data : undefined;
    return attachStepLlmUsage(ctx, {
      type: "project.devops.preflight",
      projectId,
      httpStatus: response.status,
      requestId: response.requestId,
      status: field(readiness, "status") ?? (response.status === 404 ? "NOT_CONFIGURED" : response.ok ? "READY" : "BLOCKED"),
      nextAction: field(readiness, "nextAction"),
      provider: field(readiness, "provider"),
      executionMode: field(readiness, "executionMode"),
      devopsOwner: field(readiness, "devopsOwner"),
      workflowRepository: field(readiness, "workflowRepository"),
      credentialRef: field(readiness, "credentialRef"),
      claimBoundary: field(readiness, "claimBoundary"),
      blockers: field(readiness, "blockers")
    }, "target-run-devops-preflight", response);
  } catch (error) {
    return {
      type: "project.devops.preflight",
      projectId,
      status: "UNAVAILABLE",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function tryLlmReadinessPreflight(ctx: RuntimeContext, projectId: string): Promise<Record<string, unknown>> {
  const profileId = stringOption(ctx.args, "llm-profile") ?? stringOption(ctx.args, "llm-profile-id");
  try {
    const response = profileId
      ? await ctx.client.post(`/api/v1/llm-profiles/${encodeURIComponent(profileId)}/preflight`, {}, derivedRequestOptions(ctx, "target-run-llm-profile-preflight"))
      : await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/llm/preflight`, {}, derivedRequestOptions(ctx, "target-run-project-llm-preflight"));
    const readiness = isRecord(response.data) ? response.data : undefined;
    return attachStepLlmUsage(ctx, {
      type: profileId ? "llm.profile.preflight" : "project.llm.preflight",
      projectId,
      profileId: profileId ?? field(readiness, "profileId"),
      httpStatus: response.status,
      requestId: response.requestId,
      status: field(readiness, "status") ?? (response.ok ? "READY" : "BLOCKED"),
      nextAction: field(readiness, "nextAction"),
      llmProvider: field(readiness, "provider"),
      llmModel: field(readiness, "model"),
      blockers: field(readiness, "blockers")
    }, profileId ? "target-run-llm-profile-preflight" : "target-run-project-llm-preflight", response);
  } catch (error) {
    return {
      type: "project.llm.preflight",
      projectId,
      profileId,
      status: "UNAVAILABLE",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runGoalWrapper(ctx: RuntimeContext, input: {
  command: "goal run" | "target run" | "project onboard";
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
    steps.push(attachStepLlmUsage(ctx, { type: "goal.plan-generated", goalId, requestId: planned.requestId, targetCount: nestedField(planned.data, ["plan", "targetCount"]) }, "goal-run-plan", planned));
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
    steps.push(attachStepLlmUsage(ctx, { type: "goal.plan-approved", goalId, requestId: approved.requestId, targetCount: nestedField(approved.data, ["plan", "targetCount"]) }, "goal-run-approve-plan", approved));
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
    steps.push(attachStepLlmUsage(ctx, {
      type: "goal.advanced",
      goalId,
      httpStatus: response.status,
      requestId: response.requestId,
      status: field(response.data, "status"),
      nextAction: field(response.data, "nextAction"),
      targetId: nestedField(response.data, ["target", "id"]),
      loopId: nestedField(response.data, ["loop", "id"])
    }, `goal-run-advance-${advanceCount}`, response));
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
    llmUsage: cliLlmUsageReport(ctx, field(status, "llmUsage")),
    generatedAt: new Date().toISOString()
  };
  if (ctx.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (quiet) process.stdout.write(formatGoalRunStatus(command, status, steps, ctx.cli));
  return exitCode;
}

async function readGoalRunStatus(ctx: RuntimeContext, goalId: string): Promise<unknown> {
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/goals/${encodeURIComponent(goalId)}/run-status`));
  recordResponseLlmUsage(ctx, "goal-run-status", response);
  return response.data;
}

async function readLoop(ctx: RuntimeContext, loopId: string): Promise<unknown> {
  const response = await ctx.client.expectOk(ctx.client.get(`/api/v1/loops/${encodeURIComponent(loopId)}`));
  recordResponseLlmUsage(ctx, "loop-read", response);
  return response.data;
}

async function readReleaseTarget(ctx: RuntimeContext, targetId: string): Promise<unknown | undefined> {
  const response = await ctx.client.get(`/api/v1/release/targets/${encodeURIComponent(targetId)}`);
  recordResponseLlmUsage(ctx, "release-target-read", response);
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
  recordResponseLlmUsage(ctx, "target-run-create-target", response);
  if (!response.ok) throw apiErrorFromResponse(response);
  return response.data;
}

async function createGoalForRun(ctx: RuntimeContext, projectId: string, targetId: string, objective: string): Promise<unknown> {
  const response = await ctx.client.post("/api/v1/goals", {
    id: stringOption(ctx.args, "goal-id"),
    projectId,
    releaseTargetId: targetId,
    objective,
    llmProfileId: stringOption(ctx.args, "llm-profile") ?? stringOption(ctx.args, "llm-profile-id")
  }, derivedRequestOptions(ctx, "goal-run-create-goal"));
  recordResponseLlmUsage(ctx, "goal-run-create-goal", response);
  if (!response.ok) throw apiErrorFromResponse(response);
  return response.data;
}

async function findReusableGoal(ctx: RuntimeContext, projectId: string, targetId: string, objective: string): Promise<unknown | undefined> {
  const response = await ctx.client.expectOk(ctx.client.get("/api/v1/goals"));
  const reusableStatuses = new Set(["DRAFT", "PLANNED", "APPROVED", "RUNNING", "WAITING_HUMAN", "BLOCKED"]);
  const requestedLlmProfileId = stringOption(ctx.args, "llm-profile") ?? stringOption(ctx.args, "llm-profile-id");
  return Array.isArray(response.data)
    ? response.data.find((item: unknown) =>
      isRecord(item) &&
      item.projectId === projectId &&
      item.releaseTargetId === targetId &&
      item.objective === objective &&
      (!requestedLlmProfileId || nestedField(item, ["llm", "profileId"]) === requestedLlmProfileId) &&
      reusableStatuses.has(String(item.status))
    )
    : undefined;
}

function derivedRequestOptions(ctx: RuntimeContext, suffix: string): EvoPilotRequestOptions {
  const base = stringOption(ctx.args, "idempotency-key");
  return {
    idempotencyKey: base ? `${base}:${suffix}` : undefined,
    headers: { "x-evopilot-cli-step": suffix }
  };
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
  process.stdout.write(formatGoalRunStatus(command, status, steps, ctx.cli));
}

function printLoopRunStatus(ctx: RuntimeContext, command: string, loop: unknown, steps: Array<Record<string, unknown>>, quiet: boolean): void {
  if (ctx.json || quiet) return;
  process.stdout.write(formatLoopRunStatus(command, loop, steps, ctx.cli));
}

function formatGoalRunStatus(command: string, status: unknown, steps: Array<Record<string, unknown>>, cli?: CliRuntimeInfo): string {
  const lines = [
    "EvoPilot Goal Run",
    `Command    ${command}`,
    `Client     ${cli?.surface ?? "-"} (${cli?.name ?? "@evopilot/cli"} ${cli?.version ?? "-"})`,
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
    "LLM Usage",
    ...formatLlmUsage(field(status, "llmUsage"), steps),
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

function formatLoopRunStatus(command: string, loop: unknown, steps: Array<Record<string, unknown>>, cli?: CliRuntimeInfo): string {
  const lines = [
    "EvoPilot Loop Run",
    `Command    ${command}`,
    `Client     ${cli?.surface ?? "-"} (${cli?.name ?? "@evopilot/cli"} ${cli?.version ?? "-"})`,
    `Project    ${field(loop, "projectId") ?? "-"}`,
    `Target     ${nestedField(loop, ["context", "releaseTargetId"]) ?? "-"}`,
    `Loop       ${field(loop, "id") ?? "-"}`,
    `Status     ${field(loop, "status") ?? "-"}`,
    `Iteration  ${field(loop, "currentIteration") ?? 0}`,
    "",
    "Workflow",
    `[${field(loop, "projectId") ? "OK" : "PENDING"}] Project -> [${nestedField(loop, ["context", "releaseTargetId"]) ? "OK" : "PENDING"}] Target -> [${field(loop, "status") ?? "PENDING"}] LoopRun -> [${nestedField(loop, ["sourceClosure", "closureState"]) ?? "PENDING"}] Source Closure`,
    "",
    "LLM Usage",
    ...formatLlmUsage(nestedField(loop, ["trace", "llmUsage"]), steps),
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
    "Execution Boundary",
    ...formatExecutionBoundary(readiness, devops),
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

function printLlmProfileResult(ctx: RuntimeContext, command: string, data: unknown, httpStatus: number): void {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const readiness = isRecord(field(data, "readiness")) ? field(data, "readiness") : data;
  const checks = Array.isArray(field(readiness, "checks")) ? field(readiness, "checks") as unknown[] : [];
  const blockers = Array.isArray(field(readiness, "blockers")) ? field(readiness, "blockers") as unknown[] : [];
  const lines = [
    "EvoPilot LLM Profile",
    `Command    ${command}`,
    `HTTP       ${httpStatus}`,
    `Profile    ${field(data, "id") ?? field(readiness, "profileId") ?? "-"}`,
    `Provider   ${field(data, "providerName") ?? field(readiness, "provider") ?? "-"}`,
    `Model      ${field(data, "modelName") ?? field(readiness, "model") ?? "-"}`,
    `Base URL   ${field(data, "baseUrl") ?? field(readiness, "baseUrl") ?? "-"}`,
    `API Key    ${field(data, "apiKeyRef") ?? field(readiness, "apiKeyRef") ?? "-"}`,
    `Status     ${field(readiness, "status") ?? field(data, "status") ?? (httpStatus >= 200 && httpStatus < 300 ? "OK" : `HTTP_${httpStatus}`)}`,
    "",
    "Workflow",
    ...formatReadinessChecks(checks),
    "",
    "Next Action",
    String(field(readiness, "nextAction") ?? "run-loop"),
    "",
    "Blockers",
    ...(blockers.length > 0 ? blockers.map((item) => `- ${String(item)}`) : ["- none"]),
    ""
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printProjectLlmResult(ctx: RuntimeContext, command: string, projectId: string, data: unknown, httpStatus: number): void {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const readiness = isRecord(field(data, "readiness")) ? field(data, "readiness") : data;
  const selection = field(data, "selection");
  const checks = Array.isArray(field(readiness, "checks")) ? field(readiness, "checks") as unknown[] : [];
  const blockers = Array.isArray(field(readiness, "blockers")) ? field(readiness, "blockers") as unknown[] : [];
  const lines = [
    "EvoPilot Project LLM",
    `Command    ${command}`,
    `HTTP       ${httpStatus}`,
    `Project    ${projectId}`,
    `Profile    ${field(selection, "profileId") ?? field(readiness, "profileId") ?? "-"}`,
    `Source     ${field(selection, "source") ?? field(readiness, "source") ?? "-"}`,
    `Provider   ${field(selection, "provider") ?? field(readiness, "provider") ?? "-"}`,
    `Model      ${field(selection, "model") ?? field(readiness, "model") ?? "-"}`,
    `Status     ${field(readiness, "status") ?? (httpStatus >= 200 && httpStatus < 300 ? "OK" : `HTTP_${httpStatus}`)}`,
    "",
    "Workflow",
    ...formatReadinessChecks(checks),
    "",
    "Next Action",
    String(field(readiness, "nextAction") ?? "run-loop"),
    "",
    "Blockers",
    ...(blockers.length > 0 ? blockers.map((item) => `- ${String(item)}`) : ["- none"]),
    ""
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printProjectOnboardingChecklist(ctx: RuntimeContext, command: string, data: unknown, httpStatus: number, requestId?: string): void {
  const output = attachRequestId(data, requestId);
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  const steps = Array.isArray(field(output, "steps")) ? field(output, "steps") as unknown[] : [];
  const missingInputs = Array.isArray(field(output, "missingInputs")) ? field(output, "missingInputs") as unknown[] : [];
  const blockers = Array.isArray(field(output, "blockers")) ? field(output, "blockers") as unknown[] : [];
  const commands = Array.isArray(field(output, "commands")) ? field(output, "commands") as unknown[] : [];
  const repository = field(output, "repository");
  const devops = field(output, "devops");
  const lines = [
    "EvoPilot Project Onboarding",
    `Command    ${command}`,
    `HTTP       ${httpStatus}`,
    `Request    ${requestId ?? "-"}`,
    `Scope      ${field(output, "tenantId") ?? "-"} / ${field(output, "workspaceId") ?? "-"}`,
    `Project    ${field(output, "projectId") ?? "-"}`,
    `Provider   ${field(output, "provider") ?? "-"}`,
    `Status     ${field(output, "status") ?? "UNKNOWN"}`,
    "",
    "Execution Boundary",
    ...formatExecutionBoundary(devops, repository),
    "",
    "Workflow",
    ...formatOnboardingSteps(steps),
    "",
    "Next Action",
    String(field(output, "nextAction") ?? "unknown"),
    "",
    "Missing Inputs",
    ...(missingInputs.length > 0 ? missingInputs.map((item) => `- ${String(item)}`) : ["- none"]),
    "",
    "Blockers",
    ...(blockers.length > 0 ? blockers.map((item) => `- ${String(item)}`) : ["- none"]),
    "",
    "Suggested Commands",
    ...formatOnboardingCommands(commands),
    ""
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function onboardingChecklistExitCode(data: unknown, mode: "plan" | "verify", ok: boolean): number {
  const status = String(field(data, "status") ?? "");
  if (!ok || status === "BLOCKED") return 2;
  if (mode === "verify" && status !== "READY_TO_RUN") return 2;
  return 0;
}

function readinessLike(value: unknown): unknown {
  return isRecord(field(value, "readiness")) ? field(value, "readiness") : value;
}

function formatExecutionBoundary(primary: unknown, fallback?: unknown): string[] {
  const repository = field(fallback, "repository") ?? fallback;
  const topology = field(repository, "topology");
  const boundary = field(primary, "boundary");
  const working = field(topology, "working") ?? field(boundary, "workflowRepository");
  const upstream = field(topology, "upstream");
  const mode = field(primary, "executionMode") ?? field(boundary, "executionMode") ?? field(topology, "executionMode");
  const claim = field(primary, "claimBoundary") ?? field(boundary, "claimBoundary") ?? field(topology, "claimBoundary");
  const owner = field(primary, "devopsOwner") ?? field(boundary, "owner") ?? field(repository, "owner");
  const workflow = field(primary, "workflowRepository") ?? field(boundary, "repository") ?? cliRepositoryName(working) ?? cliRepositoryName(repository);
  const credentialRef = field(primary, "credentialRef") ?? field(boundary, "credentialRef") ?? field(primary, "tokenRef") ?? field(repository, "tokenRef");
  const principal = field(primary, "credentialPrincipal") ?? field(boundary, "expectedPrincipal");
  return [
    `Mode       ${mode ?? "-"}`,
    `Working    ${cliRepositoryName(working) ?? cliRepositoryName(repository) ?? "-"}`,
    `Upstream   ${cliRepositoryName(upstream) ?? "-"}`,
    `DevOps     owner=${owner ?? "-"} workflow=${workflow ?? "-"}`,
    `Credential ${credentialRef ?? "-"}${principal ? ` principal=${principal}` : ""}`,
    `Claim      ${claim ?? "-"}`
  ];
}

function cliRepositoryName(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const provider = field(value, "provider");
  const owner = field(value, "owner");
  const repo = field(value, "repo");
  const projectId = field(value, "projectId");
  if (provider === "github" && typeof owner === "string" && typeof repo === "string") return `${owner}/${repo}`;
  if (provider === "gitlab" && typeof projectId === "string") return projectId;
  if (typeof owner === "string" && typeof repo === "string") return `${owner}/${repo}`;
  if (typeof projectId === "string") return projectId;
  return undefined;
}

function formatDevopsChecks(checks: unknown[]): string[] {
  return formatReadinessChecks(checks);
}

function formatReadinessChecks(checks: unknown[]): string[] {
  if (checks.length === 0) return ["[SKIP] No readiness checks returned."];
  return checks.map((item) => {
    const status = String(field(item, "status") ?? "SKIP");
    const evidence = Array.isArray(field(item, "evidence")) ? (field(item, "evidence") as unknown[]).join("; ") : "";
    return `[${status}] ${field(item, "id") ?? "check"} - ${evidence}`;
  });
}

function formatOnboardingSteps(steps: unknown[]): string[] {
  if (steps.length === 0) return ["[PENDING] No onboarding checklist returned."];
  return steps.map((item) => {
    const status = String(field(item, "status") ?? "SKIP");
    const required = field(item, "required") === true ? "required" : "optional";
    const evidence = Array.isArray(field(item, "evidence")) ? (field(item, "evidence") as unknown[]).slice(0, 2).join("; ") : "";
    return `[${status}] ${field(item, "id") ?? "step"} - ${field(item, "label") ?? ""} (${required})${field(item, "nextAction") ? ` next=${field(item, "nextAction")}` : ""}${evidence ? ` evidence=${evidence}` : ""}`;
  });
}

function formatOnboardingCommands(commands: unknown[]): string[] {
  if (commands.length === 0) return ["- none"];
  return commands.map((item) => `- ${field(item, "id") ?? "command"}: ${field(item, "command") ?? ""}${field(item, "requiresHuman") ? " [human]" : ""}`);
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
  return steps.slice(-8).map((step) => `- ${step.type ?? "step"}${step.status ? ` status=${step.status}` : ""}${step.httpStatus ? ` http=${step.httpStatus}` : ""}${step.provider ? ` provider=${step.provider}` : ""}${step.profileId ? ` llmProfile=${step.profileId}` : ""}${step.llmProvider ? ` llmProvider=${step.llmProvider}` : ""}${step.llmModel ? ` llmModel=${step.llmModel}` : ""}${step.executionMode ? ` mode=${step.executionMode}` : ""}${step.devopsOwner ? ` devopsOwner=${step.devopsOwner}` : ""}${step.workflowRepository ? ` workflowRepo=${step.workflowRepository}` : ""}${step.claimBoundary ? ` claim=${step.claimBoundary}` : ""}${step.nextAction ? ` next=${step.nextAction}` : ""}${step.projectId ? ` project=${step.projectId}` : ""}${step.targetId ? ` target=${step.targetId}` : ""}${step.goalId ? ` goal=${step.goalId}` : ""}${step.loopId ? ` loop=${step.loopId}` : ""}${step.requestId ? ` request=${step.requestId}` : ""}${formatInlineStepLlmUsage(field(step, "llmUsage"))}${Array.isArray(step.blockers) && step.blockers.length > 0 ? ` blockers=${step.blockers.length}` : ""}`);
}

function formatInlineStepLlmUsage(value: unknown): string {
  if (!isRecord(value)) return "";
  return ` llm=${field(value, "provider") ?? "-"}:${field(value, "model") ?? "-"} tokens=${field(value, "totalTokens") ?? 0} cumulative=${field(value, "cumulativeTotalTokens") ?? 0}`;
}

function formatLlmUsage(summary: unknown, cliSteps: Array<Record<string, unknown>> = []): string[] {
  const stepSummary = isRecord(summary) ? summary : undefined;
  const cliUsageSteps = cliSteps
    .map((step) => field(step, "llmUsage"))
    .filter((item): item is Record<string, unknown> => isRecord(item));
  const serverSteps = Array.isArray(field(stepSummary, "steps")) ? field(stepSummary, "steps") as unknown[] : [];
  const provider = field(stepSummary, "provider") ?? cliUsageSteps.find((step) => field(step, "provider"))?.provider ?? "-";
  const model = field(stepSummary, "model") ?? cliUsageSteps.find((step) => field(step, "model"))?.model ?? "-";
  const totalTokens = usageValue(field(stepSummary, "totalTokens")) || cliUsageSteps.reduce((sum, step) => sum + usageValue(field(step, "totalTokens")), 0);
  const inputTokens = usageValue(field(stepSummary, "inputTokens")) || cliUsageSteps.reduce((sum, step) => sum + usageValue(field(step, "inputTokens")), 0);
  const outputTokens = usageValue(field(stepSummary, "outputTokens")) || cliUsageSteps.reduce((sum, step) => sum + usageValue(field(step, "outputTokens")), 0);
  const creditsConsumed = usageValue(field(stepSummary, "creditsConsumed")) || cliUsageSteps.reduce((sum, step) => sum + usageValue(field(step, "creditsConsumed")), 0);
  const calls = usageValue(field(stepSummary, "calls")) || cliUsageSteps.reduce((sum, step) => sum + usageValue(field(step, "calls")), 0);
  const lines = [
    `Provider   ${provider}`,
    `Model      ${model}`,
    `Tokens     total=${totalTokens} input=${inputTokens} output=${outputTokens} credits=${creditsConsumed} calls=${calls}`
  ];
  const usageSteps = serverSteps.length > 0 ? serverSteps : cliUsageSteps;
  if (usageSteps.length === 0) return [...lines, "Step Usage", "- no LLM step recorded in this command"];
  return [
    ...lines,
    "Step Usage",
    ...usageSteps.slice(-8).map((step) => `- ${field(step, "loopId") ?? field(step, "label") ?? "step"}${field(step, "iteration") ? ` iter=${field(step, "iteration")}` : ""}${field(step, "nodeId") ? ` node=${field(step, "nodeId")}` : ""}${field(step, "llmProfileId") ? ` profile=${field(step, "llmProfileId")}` : ""} provider=${field(step, "provider") ?? "-"} model=${field(step, "model") ?? "-"} tokens=${field(step, "totalTokens") ?? 0} input=${field(step, "inputTokens") ?? 0} output=${field(step, "outputTokens") ?? 0} request=${field(step, "llmRequestId") ?? field(step, "requestId") ?? "-"}`)
  ];
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

function requestOptions(ctx: RuntimeContext): EvoPilotRequestOptions {
  return {
    idempotencyKey: stringOption(ctx.args, "idempotency-key"),
    headers: { "x-evopilot-cli-step": ctx.cli.command || "atomic-command" }
  };
}

function cliRuntimeInfo(args: ParsedArgs): CliRuntimeInfo {
  const version = readCliVersion();
  const command = args.positionals.join(" ") || (hasFlag(args, "version") ? "version" : "help");
  return {
    schema: "evopilot-cli-runtime/v1",
    name: "@evopilot/cli",
    version,
    command,
    surface: detectCliSurface(args),
    platform: process.platform,
    pid: process.pid,
    tty: Boolean(process.stdout.isTTY)
  };
}

function detectCliSurface(args: ParsedArgs): string {
  const explicit = stringOption(args, "client") ?? stringOption(args, "client-surface") ?? process.env.EVOPILOT_CLI_CLIENT ?? process.env.EVOPILOT_CLIENT_SURFACE;
  if (explicit) return safeHeaderValue(explicit);
  if (process.env.WORKBUDDY || process.env.WORKBUDDY_SESSION_ID || process.env.WORKBUDDY_WORKSPACE_ID) return "workbuddy";
  if (process.env.CI) return "ci";
  if (process.platform === "darwin" && process.stdout.isTTY) return "mac-terminal";
  if (process.stdout.isTTY) return "terminal";
  return "agent-or-script";
}

function cliRequestHeaders(cli: CliRuntimeInfo): Record<string, string> {
  return {
    "user-agent": `${cli.name}/${cli.version} (${cli.surface})`,
    "x-evopilot-client": cli.name,
    "x-evopilot-client-surface": cli.surface,
    "x-evopilot-cli-command": cli.command,
    "x-evopilot-cli-version": cli.version,
    "x-evopilot-cli-platform": cli.platform,
    "x-evopilot-cli-pid": String(cli.pid),
    "x-evopilot-cli-tty": String(cli.tty)
  };
}

function safeHeaderValue(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
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
  return parseKeyValuePairs(values, "--deploy-input");
}

function parseKeyValuePairs(values: string[], optionName: string): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0) throw usage(`${optionName} must use <key>=<value>.`);
    result[value.slice(0, separator)] = value.slice(separator + 1);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function secretValueFromArgs(args: ParsedArgs): string {
  const inline = stringOption(args, "value");
  if (inline !== undefined) return inline;
  const file = stringOption(args, "value-file");
  if (file) return fs.readFileSync(file, "utf8").trim();
  const envName = stringOption(args, "from-env");
  if (envName) {
    const value = process.env[envName];
    if (value) return value;
    throw usage(`Environment variable ${envName} is not set.`);
  }
  throw usage("secret set requires --value, --value-file, or --from-env.");
}

function attachStepLlmUsage(ctx: RuntimeContext, step: Record<string, unknown>, label: string, response: EvoPilotResponse): Record<string, unknown> {
  const usage = recordResponseLlmUsage(ctx, label, response);
  return usage ? { ...step, llmUsage: usage } : step;
}

function recordResponseLlmUsage(ctx: RuntimeContext, label: string, response: EvoPilotResponse): CliLlmUsageStep | undefined {
  const current = responseLlmMeta(response);
  if (!current) return undefined;
  const previous = ctx.llmUsage.latest;
  const usage: CliLlmUsageStep = {
    label,
    requestId: response.requestId,
    provider: current.provider ?? stringField(current.latest, "provider"),
    model: current.model ?? stringField(current.latest, "model"),
    calls: usageDelta(current.calls, previous?.calls),
    inputTokens: usageDelta(current.inputTokens, previous?.inputTokens),
    outputTokens: usageDelta(current.outputTokens, previous?.outputTokens),
    totalTokens: usageDelta(current.totalTokens, previous?.totalTokens),
    creditsConsumed: usageDelta(current.creditsConsumed, previous?.creditsConsumed ?? previous?.totalTokens),
    creditUnit: "token",
    cumulativeTotalTokens: usageValue(current.totalTokens)
  };
  ctx.llmUsage.latest = current;
  ctx.llmUsage.responses.push(usage);
  return usage;
}

function responseLlmMeta(response: EvoPilotResponse | undefined): LlmUsageMeta | undefined {
  const meta = field(response?.body, "meta");
  const llm = field(meta, "llm");
  return isRecord(llm) ? llm as LlmUsageMeta : undefined;
}

function cliLlmUsageReport(ctx: RuntimeContext, serverSummary?: unknown): Record<string, unknown> {
  const server = isRecord(serverSummary) ? serverSummary : undefined;
  const observed = summarizeObservedCliUsage(ctx.llmUsage.responses);
  const latest = ctx.llmUsage.latest;
  const summary = {
    provider: field(server, "provider") ?? observed.provider ?? latest?.provider,
    model: field(server, "model") ?? observed.model ?? latest?.model,
    calls: Math.max(usageValue(field(server, "calls")), usageValue(observed.calls)),
    inputTokens: Math.max(usageValue(field(server, "inputTokens")), usageValue(observed.inputTokens)),
    outputTokens: Math.max(usageValue(field(server, "outputTokens")), usageValue(observed.outputTokens)),
    totalTokens: Math.max(usageValue(field(server, "totalTokens")), usageValue(observed.totalTokens)),
    creditsConsumed: Math.max(usageValue(field(server, "creditsConsumed")), usageValue(observed.creditsConsumed)),
    creditUnit: "token",
    costUsd: usageValue(field(server, "costUsd"))
  };
  return {
    schema: "evopilot-cli-llm-usage/v1",
    client: ctx.cli,
    summary,
    process: {
      responses: ctx.llmUsage.responses,
      cumulative: latest ? {
        provider: latest.provider,
        model: latest.model,
        calls: usageValue(latest.calls),
        inputTokens: usageValue(latest.inputTokens),
        outputTokens: usageValue(latest.outputTokens),
        totalTokens: usageValue(latest.totalTokens),
        creditsConsumed: usageValue(latest.creditsConsumed),
        creditUnit: latest.creditUnit ?? "token",
        latest: latest.latest
      } : undefined
    },
    server
  };
}

function summarizeObservedCliUsage(steps: CliLlmUsageStep[]): Record<string, string | number | undefined> {
  const providers = uniqueStrings(steps.map((step) => step.provider).filter((value): value is string => Boolean(value)));
  const models = uniqueStrings(steps.map((step) => step.model).filter((value): value is string => Boolean(value)));
  return {
    provider: providers.length === 1 ? providers[0] : providers.length > 1 ? "mixed" : undefined,
    model: models.length === 1 ? models[0] : models.length > 1 ? "mixed" : undefined,
    calls: steps.reduce((sum, step) => sum + step.calls, 0),
    inputTokens: steps.reduce((sum, step) => sum + step.inputTokens, 0),
    outputTokens: steps.reduce((sum, step) => sum + step.outputTokens, 0),
    totalTokens: steps.reduce((sum, step) => sum + step.totalTokens, 0),
    creditsConsumed: steps.reduce((sum, step) => sum + step.creditsConsumed, 0)
  };
}

function usageDelta(current: unknown, previous: unknown): number {
  if (previous === undefined) return 0;
  return Math.max(0, usageValue(current) - usageValue(previous));
}

function usageValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function printOutput(ctx: RuntimeContext, data: unknown, text: string): void {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    process.stdout.write(`${text}\n`);
  }
}

function attachRequestId(data: unknown, requestId?: string): unknown {
  if (!requestId || !isRecord(data) || data.requestId) return data;
  return { ...data, requestId };
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
  evopilot project onboard plan <github|gitlab|local-git> [options]
  evopilot project onboard <github|gitlab|local-git> [options]
  evopilot project onboard verify <project-id>
  evopilot project list
  evopilot project preflight <project-id>
  evopilot project credentials set <project-id> [--token-ref <env>]
  evopilot project devops set <project-id> --provider <github-actions|gitlab-ci> [options]
  evopilot project devops inspect <project-id>
  evopilot project devops preflight <project-id>
  evopilot project devops clear <project-id>
  evopilot project llm set <project-id> --profile <llm-profile-id>
  evopilot project llm inspect <project-id>
  evopilot project llm preflight <project-id>
  evopilot project llm clear <project-id>
  evopilot secret list
  evopilot secret set --id <secret-ref> --kind <source-token|deploy-token|llm-key|llm-api-key|github-app-private-key|github-webhook-secret> (--value <value>|--value-file <file>|--from-env <env>)
  evopilot secret revoke <secret-ref>
  evopilot llm profile list
  evopilot llm profile set <profile-id> --provider openai-compatible --base-url <url> --model <name> --api-key-ref <secret-ref>
  evopilot llm profile inspect <profile-id>
  evopilot llm profile preflight <profile-id>
  evopilot github-app installation list
  evopilot github-app installation set --installation-id <id> --account <org> [--repository <owner/repo>] [--permission <name=value>]
  evopilot github-app installation preflight <id>
  evopilot evidence push --project <id> --file <events.json>
  evopilot target templates
  evopilot target list
  evopilot target create --project <id> --template <experimental|alpha|beta|rc|ga>
  evopilot target run --project <id> --template <experimental|alpha|beta|rc|ga> --objective <text> [--llm-profile <id>] [--max-steps <n>] [--timeout <duration>]
  evopilot target decision <target-id> [--project <id>]
  evopilot goal create --project <id> --target <target-id> --objective <text>
  evopilot goal run [<goal-id>] [--project <id> --target <target-id> --objective <text>] [--llm-profile <id>] [--max-steps <n>] [--timeout <duration>]
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
  evopilot loop create --project <id> --target <target-id> --objective <text> [--llm-profile <id>]
  evopilot loop list
  evopilot loop run [<loop-id>] [--project <id> --target <target-id> --objective <text>] [--llm-profile <id>] [--max-iterations <n>] [--timeout <duration>]
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
  --client <surface>          Client surface for logs, for example mac-terminal or workbuddy
  --idempotency-key <key>     Idempotency key for mutating commands
  --timeout <duration>        Wrapper stop boundary, for example 30s, 10m, or 2h
  --until <policy>            Wrapper stop policy: terminal or blocked-or-complete
  --require-source-ready      project onboard fails fast unless source credential preflight is READY
  --require-devops-ready      target run fails fast unless project DevOps preflight is READY
  --require-llm-ready         project onboard / target run fails fast unless LLM profile preflight is READY
  --llm-profile <id>          LLM profile for this project onboarding or new Goal/Loop run
  --execution-mode <mode>     DevOps boundary: owned-repository, fork-validated-pr, upstream-authorized, or read-only-public
  --upstream-repo <repo>      Upstream GitHub/GitLab repository for public read-only or fork-validated PR mode
  --working-repo <repo>       Writable GitHub/GitLab repository where EvoPilot runs source writeback and native CI/CD
  --devops-owner <account>    GitHub owner or GitLab namespace whose CI/CD account executes the project DevOps
  --devops-token-ref <ref>    Server-side secret ref for the CI/CD executor; falls back to source tokenRef when omitted
  --credential-principal <id> Optional human-readable principal expected behind the DevOps tokenRef
  --json                      Print JSON response data
  --config <file>             Config path, defaults to ~/.evopilot/config.json

Project DevOps examples:
  evopilot project onboard plan github --repo org/my-agent --id my-agent --token-ref GITHUB_TOKEN_MY_AGENT --execution-mode owned-repository --devops-owner org --ci-workflow ci.yml --ci-required-check build --template ga --objective "Promote my-agent to GA stable" --json
  evopilot project onboard verify my-agent --template ga --json
  evopilot project onboard github --repo org/my-agent --id my-agent --token-ref GITHUB_TOKEN_MY_AGENT --execution-mode owned-repository --devops-owner org --ci-workflow ci.yml --ci-required-check build --template ga --objective "Promote my-agent to GA stable" --require-source-ready --require-devops-ready
  evopilot project onboard github --repo apache/skywalking --upstream-repo apache/skywalking --working-repo my-org/skywalking-fork --id skywalking-fork --token-ref GITHUB_TOKEN_SKYWALKING_FORK --execution-mode fork-validated-pr --devops-owner my-org --ci-workflow ci.yml --ci-required-check build --template rc --objective "Validate fork before upstream PR" --json
  evopilot secret set --id LLM_API_KEY_QWEN_PRIVATE --kind llm-key --from-env LLM_API_KEY_QWEN_PRIVATE --json
  evopilot llm profile set qwen-private --provider openai-compatible --base-url https://llm.example.com/v1 --model qwen2.5-coder-32b --api-key-ref LLM_API_KEY_QWEN_PRIVATE --json
  evopilot project llm set my-agent --profile qwen-private --require-llm-ready --json
  evopilot target run --project my-agent --template ga --objective "Promote my-agent to GA stable" --llm-profile qwen-private --require-llm-ready --json
  evopilot project devops set my-agent --provider github-actions --execution-mode owned-repository --devops-owner org --ci-workflow ci.yml --ci-required-check build --ci-required-check test --cd-workflow deploy-prod.yml --deploy-environment production --health-url https://app.example.com/health
  evopilot project devops set my-agent --provider gitlab-ci --execution-mode owned-repository --devops-owner group --ci-required-stage test --ci-required-job build --cd-required-stage deploy --deploy-environment production --ready-url https://app.example.com/ready
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
