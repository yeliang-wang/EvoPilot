import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { GitHubHttpAdapter } from "@evopilot/adapter-github";
import { GitLabHttpAdapter } from "@evopilot/adapter-gitlab";
import { JenkinsClient, type JenkinsConnectorConfig } from "@evopilot/adapter-jenkins";
import { listRepositoryFiles } from "@evopilot/adapter-local-git";
import { OpenHandsClient, type OpenHandsConnectorConfig, type OpenHandsRunStatus } from "@evopilot/adapter-openhands";
import { createLlmClientFromEnv, type LlmGenerateResponse, type LlmTaskClient } from "@evopilot/llm";
import {
  applyReviewDecision,
  createPipelineRun,
  createReleaseReport,
  defaultTriggerRules,
  evidenceEventsFromAgentSignals,
  evidenceEventsFromEvaluationResults,
  evidenceEventsFromFeedback,
  evidenceEventsFromOtlpLogs,
  evidenceEventsFromOtlpTraces,
  evidenceEventsFromSkyWalking,
  pipelineStatusToReleaseStatus,
  runEvolutionCycle,
  type DeliveryPlan,
  type EvidenceBundle,
  type EvolutionTriggerCondition,
  type EvolutionOpportunity,
  type EvolutionPlan,
  type EvolutionTriggerRule,
  type ImpactMap,
  type LearningRecord,
  type PipelineRun,
  type PriorityScore,
  type ProjectProfile,
  type ReleaseReport,
  type ReviewRecord,
  type RuntimeEvidenceEvent
} from "@evopilot/core";
import { domainforgeFabricProfile } from "@evopilot/profile-domainforge-fabric";

export interface EvoPilotServerOptions {
  dataRoot: string;
  profile?: ProjectProfile;
  apiToken?: string;
  tokens?: AuthToken[];
  dashboardRoot?: string;
  deliveryExecutor?: DeliveryExecutor;
  llmClient?: LlmTaskClient;
  requireLlm?: boolean;
  runtimeMode?: EvoPilotRuntimeMode;
  allowAnonymousAdmin?: boolean;
  allowMockIntegrations?: boolean;
  allowSampleData?: boolean;
  autoRegisterProfileProject?: boolean;
  maxBodyBytes?: number;
}

export type EvoPilotRuntimeMode = "prod" | "debug";

interface RuntimeConfig {
  mode: EvoPilotRuntimeMode;
  requireLlm: boolean;
  allowAnonymousAdmin: boolean;
  allowMockIntegrations: boolean;
  allowSampleData: boolean;
  autoRegisterProfileProject: boolean;
}

export type AuthRole = "viewer" | "operator" | "admin";

export interface AuthToken {
  name: string;
  token: string;
  role: AuthRole;
}

export interface DeliveryExecutorResult {
  ciStatus: "PASSED" | "FAILED";
  validationSummary?: string;
}

export type DeliveryExecutor = (args: {
  run: StoredRun;
  delivery: DeliveryPlan;
  plan: EvolutionPlan;
  requestBody: any;
}) => Promise<DeliveryExecutorResult>;

export interface StoredRun {
  id: string;
  evidenceBundle: EvidenceBundle;
  opportunities: EvolutionOpportunity[];
  scores: PriorityScore[];
  impactMaps: ImpactMap[];
  plans: EvolutionPlan[];
  reviews: ReviewRecord[];
  deliveryPlans: DeliveryPlan[];
  pipelineRuns?: PipelineRun[];
  releaseReports: ReleaseReport[];
  learningRecords: LearningRecord[];
}

interface StoredProject {
  id: string;
  name: string;
  profileId: string;
  repository?: ProjectRepositoryRegistration;
  validation: ProjectValidation;
  createdAt: string;
  updatedAt: string;
}

type ProjectRepositoryProvider = "local-git" | "gitlab" | "github";

interface ProjectRepositoryRegistration {
  provider: ProjectRepositoryProvider;
  gitUrl?: string;
  root?: string;
  baseUrl?: string;
  projectId?: string;
  owner?: string;
  repo?: string;
  defaultBranch?: string;
  credentials?: ProjectRepositoryCredentials;
}

interface ProjectRepositoryCredentials {
  username?: string;
  password?: string;
  token?: string;
  tokenRef?: string;
}

interface ProjectValidation {
  status: "VERIFIED" | "FAILED";
  checkedAt: string;
  message: string;
  fileCount?: number;
}

interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface StoredJenkinsConnector extends JenkinsConnectorConfig {
  jobTemplates?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

interface StoredOpenHandsConnector extends OpenHandsConnectorConfig {
  createdAt: string;
  updatedAt: string;
}

interface CodeUpgradeRun {
  id: string;
  projectId: string;
  deliveryPlanId: string;
  planId: string;
  reviewId?: string;
  executor: "openhands";
  status: OpenHandsRunStatus;
  proposalMarkdown: string;
  validationCommands: string[];
  branchStrategy: {
    sourceBranch: string;
    upgradeBranch: string;
    commitMessage: string;
    mergeRequestTitle: string;
    mergeRequestDescription: string;
  };
  openhands: {
    connectorId: string;
    workspaceId?: string;
    conversationId: string;
  };
  artifacts: {
    diffPath?: string;
    branchName?: string;
    commitSha?: string;
    pullRequestUrl?: string;
    changedFiles?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

interface CodeUpgradeEvent {
  id: string;
  codeUpgradeRunId: string;
  timestamp: string;
  source: "agent" | "user" | "environment" | "tool" | "evopilot" | "openhands";
  phase: string;
  level: "info" | "warn" | "error";
  message: string;
  raw?: unknown;
}

interface ScheduledEvolution {
  id: string;
  projectId: string;
  deliveryPlanId: string;
  planId: string;
  executor: "jenkins";
  connectorId: string;
  jobName: string;
  scheduledAt: string;
  status: "SCHEDULED" | "TRIGGERED";
  parameters: Record<string, string>;
  createdAt: string;
  triggeredAt?: string;
  pipelineRunId?: string;
}

interface AuthContext {
  actor: string;
  role: AuthRole;
}

interface RuleMemory {
  id: string;
  userPrompt: string;
  enabled: boolean;
  description: string;
  compiledRule: EvolutionTriggerRule;
  storagePath: string;
  llmTrace?: Record<string, unknown>;
}

interface EvaluationDataset {
  id: string;
  projectId: string;
  name: string;
  source: string;
  status: "REGRESSION_READY" | "EVALUATED" | "NEEDS_LABELING" | "INSUFFICIENT_EVIDENCE";
  severity: "LOW" | "MEDIUM" | "HIGH";
  sampleCount: number;
  metric: string;
  scope: string;
  triggeredAt: string;
}

export function createServer(options: EvoPilotServerOptions): http.Server {
  const store = new FileStore(options.dataRoot);
  const profile = options.profile ?? domainforgeFabricProfile;
  const runtime = resolveRuntimeConfig(options);
  const llmClient = options.llmClient ?? createLlmClientFromEnv();
  const requireLlm = runtime.requireLlm;
  store.ensureRuleMemories(profile.triggerRules ?? defaultTriggerRules);
  const tokens = normalizeTokens(options);
  assertProductionRuntimeIsConfigured(runtime, tokens);
  if (runtime.autoRegisterProfileProject) {
    store.ensureProject({
      id: profile.id,
      name: profile.name,
      profileId: profile.id,
      validation: {
        status: "VERIFIED",
        checkedAt: new Date().toISOString(),
        message: "调试模式内置项目画像已验证"
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (serveDashboard(request, response, url, options.dashboardRoot)) return;
      if (request.method === "GET" && url.pathname === "/health") {
        return writeJson(response, 200, {
          status: "UP",
          service: "evopilot",
          profile: profile.id,
          runtimeMode: runtime.mode,
          dataRoot: options.dataRoot,
          authRequired: tokens.length > 0
        });
      }
      if (request.method === "GET" && url.pathname === "/ready") {
        return writeJson(response, 200, {
          status: store.isReady() ? "READY" : "NOT_READY",
          schemaVersion: store.metadata().schemaVersion
        });
      }
      const auth = authorize(request, tokens, runtime);
      if (!auth) {
        return writeJson(response, 401, { error: "UNAUTHORIZED" });
      }
      if (request.method === "GET" && url.pathname === "/api/v1/summary") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.summary()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/metrics") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeText(response, 200, renderMetrics(store.summary()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/profiles") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope([profile]));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/rules") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listRuleMemories().map((rule) => ({
          id: rule.id,
          prompt: rule.userPrompt,
          enabled: rule.enabled,
          description: "已由 EvoPilot 编译为执行规则，管理员可在 Markdown 规则文件中审查细节。",
          llmTrace: rule.llmTrace
        }))));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/rules/compile") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const userPrompt = String(body.prompt ?? "").trim();
        if (!userPrompt) return writeJson(response, 400, { error: "RULE_PROMPT_REQUIRED" });
        const projectId = String(body.projectId ?? profile.id);
        const compiled = await compileRuleWithLlm({
          projectId,
          userPrompt,
          llmClient,
          requireLlm
        });
        store.writeRuleMemory(compiled.memory);
        store.appendAudit(audit(auth, "rule.compiled", compiled.memory.id, { projectId, llmTrace: compiled.memory.llmTrace }));
        return writeJson(response, 201, envelope({
          id: compiled.memory.id,
          prompt: compiled.memory.userPrompt,
          enabled: compiled.memory.enabled,
          description: compiled.memory.description,
          storagePath: compiled.memory.storagePath,
          llmTrace: compiled.memory.llmTrace
        }));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/evaluation-datasets") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const datasets = store.listEvaluationDatasets();
        if (datasets.length > 0) return writeJson(response, 200, envelope(datasets));
        if (runtime.allowSampleData) return writeJson(response, 200, envelope(defaultEvaluationDatasets()));
        return writeJson(response, 503, { error: "EVALUATION_DATASET_SOURCE_NOT_CONFIGURED" });
      }
      if (request.method === "POST" && url.pathname === "/api/v1/evaluation-datasets") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const input: any[] = Array.isArray(body.datasets) ? body.datasets : Array.isArray(body) ? body : [body];
        const datasets: EvaluationDataset[] = input.map((item: any) => normalizeEvaluationDataset(item, profile.id));
        if (datasets.length === 0) return writeJson(response, 400, { error: "EVALUATION_DATASETS_REQUIRED" });
        store.writeEvaluationDatasets(datasets);
        store.appendAudit(audit(auth, "evaluation-datasets.upserted", datasets.map((dataset) => dataset.id).join(","), { count: datasets.length }));
        return writeJson(response, 201, envelope(datasets));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/opportunity-drafts") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const datasetIds = Array.isArray(body.datasetIds) ? body.datasetIds.map(String) : [];
        const datasetSource = store.listEvaluationDatasets();
        const availableDatasets = datasetSource.length > 0 ? datasetSource : runtime.allowSampleData ? defaultEvaluationDatasets() : [];
        if (availableDatasets.length === 0) return writeJson(response, 503, { error: "EVALUATION_DATASET_SOURCE_NOT_CONFIGURED" });
        const datasets = availableDatasets.filter((dataset) => datasetIds.includes(dataset.id));
        if (datasets.length === 0) return writeJson(response, 400, { error: "EVALUATION_DATASETS_REQUIRED" });
        const title = String(body.title ?? "订单助手端到端响应体验优化").trim();
        const target = String(body.target ?? "端到端响应时间提升 5%，p95 小于 3 秒，RAG 命中率不下降").trim();
        const projectId = String(body.projectId ?? datasets[0]?.projectId ?? profile.id);
        const now = new Date().toISOString();
        const llmDraft = await renderOpportunityDraftMarkdown({ title, target, datasets, llmClient, requireLlm });
        const draft = {
          id: `draft-${Date.now()}`,
          projectId,
          title,
          target,
          datasetIds,
          sampleCount: datasets.reduce((sum, dataset) => sum + dataset.sampleCount, 0),
          triggerSource: "评测集组装 / Trace + RAG + Cost",
          createdAt: now,
          proposalMarkdown: llmDraft.markdown,
          llmTrace: llmDraft.trace
        };
        store.appendAudit(audit(auth, "opportunity-draft.created", draft.id, { projectId, datasetIds }));
        return writeJson(response, 201, envelope(draft));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/connectors/jenkins") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listJenkinsConnectors().map(maskJenkinsConnector)));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/connectors/openhands") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listOpenHandsConnectors().map(maskOpenHandsConnector)));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/schedules") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listSchedules().slice(-20).reverse()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/connectors/jenkins") {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const now = new Date().toISOString();
        const connector: StoredJenkinsConnector = {
          id: requireBodyString(body.id, "JENKINS_CONNECTOR_ID_REQUIRED", runtime, "default"),
          name: String(body.name ?? body.id ?? "生产 CI/CD").trim(),
          baseUrl: String(body.baseUrl ?? "").trim(),
          username: body.username ? String(body.username) : undefined,
          apiToken: body.apiToken ? String(body.apiToken) : undefined,
          jobTemplates: body.jobTemplates && typeof body.jobTemplates === "object" ? body.jobTemplates : undefined,
          createdAt: now,
          updatedAt: now
        };
        if (!connector.id || !connector.baseUrl) return writeJson(response, 400, { error: "JENKINS_CONNECTOR_REQUIRED" });
        store.writeJenkinsConnector(connector);
        store.appendAudit(audit(auth, "jenkins.connector.saved", connector.id, { baseUrl: connector.baseUrl }));
        return writeJson(response, 201, envelope(maskJenkinsConnector(connector)));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/connectors/openhands") {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const now = new Date().toISOString();
        const connector: StoredOpenHandsConnector = {
          id: requireBodyString(body.id, "CODE_UPGRADE_CONNECTOR_ID_REQUIRED", runtime, "default"),
          name: String(body.name ?? body.id ?? "代码升级执行器").trim(),
          baseUrl: String(body.baseUrl ?? "").trim(),
          apiKey: body.apiKey ? String(body.apiKey) : undefined,
          workspaceMode: body.workspaceMode === "remote" ? "remote" : "docker",
          defaultModel: body.defaultModel ? String(body.defaultModel) : undefined,
          createdAt: now,
          updatedAt: now
        };
        if (!connector.id || !connector.baseUrl) return writeJson(response, 400, { error: "OPENHANDS_CONNECTOR_REQUIRED" });
        store.writeOpenHandsConnector(connector);
        store.appendAudit(audit(auth, "openhands.connector.saved", connector.id, { baseUrl: connector.baseUrl, workspaceMode: connector.workspaceMode }));
        return writeJson(response, 201, envelope(maskOpenHandsConnector(connector)));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/projects") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listProjects().map(maskProject)));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/pipelines") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listPipelines().slice(-10).reverse()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/code-upgrade-runs") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listCodeUpgradeRuns().slice(-10).reverse()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/projects") {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const now = new Date().toISOString();
        const repository = normalizeProjectRepository(body);
        const validation = await validateProjectRepository(repository);
        const project: StoredProject = {
          id: String(body.id ?? "").trim(),
          name: String(body.name ?? body.id ?? "").trim(),
          profileId: String(body.profileId ?? profile.id),
          repository,
          validation,
          createdAt: now,
          updatedAt: now
        };
        if (!project.id || !project.name) return writeJson(response, 400, { error: "PROJECT_ID_AND_NAME_REQUIRED" });
        if (project.validation.status !== "VERIFIED") return writeJson(response, 400, { error: "PROJECT_VALIDATION_FAILED", detail: project.validation.message });
        store.writeProject(project);
        store.appendAudit(audit(auth, "project.created", project.id, { provider: repository?.provider, validation: validation.status }));
        return writeJson(response, 201, envelope(maskProject(project)));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/runs") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listRuns()));
      }
      const runMatch = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)$/);
      if (request.method === "GET" && runMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const run = store.readRun(decodeURIComponent(runMatch[1]));
        if (!run) return writeJson(response, 404, { error: "RUN_NOT_FOUND" });
        return writeJson(response, 200, envelope(run));
      }
      const pipelineMatch = url.pathname.match(/^\/api\/v1\/pipelines\/([^/]+)$/);
      if (request.method === "GET" && pipelineMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const pipeline = await refreshPipeline(store, decodeURIComponent(pipelineMatch[1]));
        if (!pipeline) return writeJson(response, 404, { error: "PIPELINE_NOT_FOUND" });
        return writeJson(response, 200, envelope(pipeline));
      }
      const pipelineLogsMatch = url.pathname.match(/^\/api\/v1\/pipelines\/([^/]+)\/logs$/);
      if (request.method === "GET" && pipelineLogsMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const pipeline = await refreshPipeline(store, decodeURIComponent(pipelineLogsMatch[1]));
        if (!pipeline) return writeJson(response, 404, { error: "PIPELINE_NOT_FOUND" });
        return writeText(response, 200, pipeline.logRef?.preview ?? "");
      }
      const pipelineArtifactsMatch = url.pathname.match(/^\/api\/v1\/pipelines\/([^/]+)\/artifacts$/);
      if (request.method === "GET" && pipelineArtifactsMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const pipeline = await refreshPipeline(store, decodeURIComponent(pipelineArtifactsMatch[1]));
        if (!pipeline) return writeJson(response, 404, { error: "PIPELINE_NOT_FOUND" });
        return writeJson(response, 200, envelope(pipeline.artifacts));
      }
      const codeUpgradeRunMatch = url.pathname.match(/^\/api\/v1\/code-upgrade-runs\/([^/]+)$/);
      if (request.method === "GET" && codeUpgradeRunMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const run = await refreshCodeUpgradeRun(store, decodeURIComponent(codeUpgradeRunMatch[1]));
        if (!run) return writeJson(response, 404, { error: "CODE_UPGRADE_RUN_NOT_FOUND" });
        return writeJson(response, 200, envelope(run));
      }
      const codeUpgradeEventsMatch = url.pathname.match(/^\/api\/v1\/code-upgrade-runs\/([^/]+)\/events$/);
      if (request.method === "GET" && codeUpgradeEventsMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const run = await refreshCodeUpgradeRun(store, decodeURIComponent(codeUpgradeEventsMatch[1]));
        if (!run) return writeJson(response, 404, { error: "CODE_UPGRADE_RUN_NOT_FOUND" });
        return writeJson(response, 200, envelope(store.listCodeUpgradeEvents(run.id)));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/runs") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const idempotencyKey = getIdempotencyKey(request);
        if (idempotencyKey) {
          const existing = store.readIdempotency(idempotencyKey);
          if (existing) return writeJson(response, 200, existing);
        }
        const body = await readJson(request, options.maxBodyBytes);
        const now = String(body.now ?? new Date().toISOString());
        const projectId = String(body.projectId ?? profile.id);
        const events = Array.isArray(body.events) ? body.events as RuntimeEvidenceEvent[] : [];
        const files = Array.isArray(body.files) ? body.files.map(String) : [];
        const run = createAndStoreRunFromEvidence({ store, auth, projectId, events, files, now, profile, idempotencyKey, ingestSource: "http-events" });
        const bodyOut = envelope(run);
        if (idempotencyKey) store.writeIdempotency(idempotencyKey, bodyOut);
        return writeJson(response, 201, bodyOut);
      }
      if (request.method === "POST" && url.pathname === "/api/v1/evidence/events") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const now = String(body.now ?? new Date().toISOString());
        const projectId = String(body.projectId ?? profile.id);
        const signals = Array.isArray(body.events) ? body.events : Array.isArray(body.signals) ? body.signals : [];
        const events = evidenceEventsFromAgentSignals(signals, now);
        const files = Array.isArray(body.files) ? body.files.map(String) : [];
        const run = createAndStoreRunFromEvidence({ store, auth, projectId, events, files, now, profile, ingestSource: "agent-sdk" });
        return writeJson(response, 201, envelope({ run, ingestedEvents: events.length, ingestSource: "agent-sdk" }));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/evidence/otlp/v1/traces") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const now = new Date().toISOString();
        const projectId = String(url.searchParams.get("projectId") ?? body.projectId ?? profile.id);
        const events = evidenceEventsFromOtlpTraces(body, now);
        const run = createAndStoreRunFromEvidence({ store, auth, projectId, events, files: [], now, profile, ingestSource: "otlp-traces" });
        return writeJson(response, 201, envelope({ run, ingestedEvents: events.length, ingestSource: "otlp-traces" }));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/evidence/otlp/v1/logs") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const now = new Date().toISOString();
        const projectId = String(url.searchParams.get("projectId") ?? body.projectId ?? profile.id);
        const events = evidenceEventsFromOtlpLogs(body, now);
        const run = createAndStoreRunFromEvidence({ store, auth, projectId, events, files: [], now, profile, ingestSource: "otlp-logs" });
        return writeJson(response, 201, envelope({ run, ingestedEvents: events.length, ingestSource: "otlp-logs" }));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/evidence/skywalking") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const now = String(body.now ?? new Date().toISOString());
        const projectId = String(body.projectId ?? profile.id);
        const events = evidenceEventsFromSkyWalking(body, now);
        const run = createAndStoreRunFromEvidence({ store, auth, projectId, events, files: [], now, profile, ingestSource: "skywalking" });
        return writeJson(response, 201, envelope({ run, ingestedEvents: events.length, ingestSource: "skywalking" }));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/evidence/evaluations") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const now = String(body.now ?? new Date().toISOString());
        const projectId = String(body.projectId ?? profile.id);
        const results = Array.isArray(body.results) ? body.results : [];
        const events = evidenceEventsFromEvaluationResults(results, now);
        const run = createAndStoreRunFromEvidence({ store, auth, projectId, events, files: [], now, profile, ingestSource: "evaluation-results" });
        return writeJson(response, 201, envelope({ run, ingestedEvents: events.length, ingestSource: "evaluation-results" }));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/evidence/feedback") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const now = String(body.now ?? new Date().toISOString());
        const projectId = String(body.projectId ?? profile.id);
        const feedback = Array.isArray(body.feedback) ? body.feedback : Array.isArray(body.items) ? body.items : [];
        const events = evidenceEventsFromFeedback(feedback, now);
        const run = createAndStoreRunFromEvidence({ store, auth, projectId, events, files: [], now, profile, ingestSource: "user-feedback" });
        return writeJson(response, 201, envelope({ run, ingestedEvents: events.length, ingestSource: "user-feedback" }));
      }
      const decisionMatch = url.pathname.match(/^\/api\/v1\/reviews\/([^/]+)\/decision$/);
      if (request.method === "POST" && decisionMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const reviewId = decodeURIComponent(decisionMatch[1]);
        const run = store.findRunByReviewId(reviewId);
        if (!run) return writeJson(response, 404, { error: "REVIEW_NOT_FOUND" });
        const reviewIndex = run.reviews.findIndex((review) => review.id === reviewId);
        const body = await readJson(request, options.maxBodyBytes);
        const updated = applyReviewDecision(run.reviews[reviewIndex], {
          action: normalizeDecisionAction(body.action),
          actor: String(body.actor ?? "user"),
          note: String(body.note ?? ""),
          decidedAt: new Date().toISOString()
        });
        run.reviews[reviewIndex] = updated;
        store.writeRun(run);
        store.appendAudit(audit(auth, "review.decided", reviewId, { action: updated.decisions.at(-1)?.action }));
        return writeJson(response, 200, envelope(updated));
      }
      const executeMatch = url.pathname.match(/^\/api\/v1\/deliveries\/([^/]+)\/execute$/);
      if (request.method === "POST" && executeMatch) {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const deliveryId = decodeURIComponent(executeMatch[1]);
        const run = store.findRunByDeliveryId(deliveryId);
        if (!run) return writeJson(response, 404, { error: "DELIVERY_NOT_FOUND" });
        const delivery = run.deliveryPlans.find((item) => item.id === deliveryId)!;
        const plan = run.plans.find((item) => item.id === delivery.planId)!;
        const review = run.reviews.find((item) => item.planId === plan.id);
        if (delivery.approvalRequired && review?.status !== "USER_CONFIRMED") {
          return writeJson(response, 409, { error: "USER_CONFIRMATION_REQUIRED" });
        }
        const body = await readJson(request, options.maxBodyBytes);
        if (body.executor === "jenkins") {
          const codeUpgrade = store.findSuccessfulCodeUpgrade(delivery.id);
          if (!codeUpgrade) return writeJson(response, 409, { error: "CODE_UPGRADE_REQUIRED" });
          const pipeline = await triggerJenkinsDelivery({ store, auth, run, delivery, plan, body, runtime });
          return writeJson(response, 202, envelope({ pipelineRun: pipeline }));
        }
        if (!runtime.allowMockIntegrations) {
          return writeJson(response, 400, { error: "DELIVERY_EXECUTOR_REQUIRED", detail: "prod 模式只允许通过真实 CI/CD 连接器执行交付。" });
        }
        const execution = options.deliveryExecutor
          ? await options.deliveryExecutor({ run, delivery, plan, requestBody: body })
          : { ciStatus: String(body.ciStatus ?? "PASSED") as "PASSED" | "FAILED" };
        const ciStatus = execution.ciStatus;
        const status: ReleaseReport["status"] = delivery.blockOnCiFailure && ciStatus !== "PASSED" ? "FAILED" : "SUCCEEDED";
        const report = createReleaseReport({
          id: `release-${delivery.id}`,
          projectId: delivery.projectId,
          deliveryPlanId: delivery.id,
          evidenceBundleId: run.evidenceBundle.id,
          version: String(body.version ?? "0.1.0"),
          status,
          validationSummary: execution.validationSummary ?? (status === "SUCCEEDED" ? "CI/CD 与发布后验证已通过。" : "CI 失败，发布已阻断。"),
          releasedAt: status === "SUCCEEDED" ? new Date().toISOString() : undefined
        });
        run.releaseReports.push(report);
        run.learningRecords.push({
          id: `learning-${delivery.id}`,
          projectId: delivery.projectId,
          planId: plan.id,
          prediction: plan.expectedEffect,
          outcome: status === "SUCCEEDED" ? "validated" : "rejected",
          ruleChangesSuggested: status === "SUCCEEDED" ? [] : ["发布前收紧验证契约。"],
          createdAt: new Date().toISOString()
        });
        store.writeRun(run);
        store.appendAudit(audit(auth, "delivery.executed", deliveryId, { status }));
        return writeJson(response, 200, envelope({ releaseReport: report, learningRecords: run.learningRecords }));
      }
      const codeUpgradeMatch = url.pathname.match(/^\/api\/v1\/deliveries\/([^/]+)\/code-upgrade$/);
      if (request.method === "POST" && codeUpgradeMatch) {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const deliveryId = decodeURIComponent(codeUpgradeMatch[1]);
        const run = store.findRunByDeliveryId(deliveryId);
        if (!run) return writeJson(response, 404, { error: "DELIVERY_NOT_FOUND" });
        const delivery = run.deliveryPlans.find((item) => item.id === deliveryId)!;
        const plan = run.plans.find((item) => item.id === delivery.planId)!;
        const review = run.reviews.find((item) => item.planId === plan.id);
        if (delivery.approvalRequired && review?.status !== "USER_CONFIRMED") {
          return writeJson(response, 409, { error: "USER_CONFIRMATION_REQUIRED" });
        }
        const body = await readJson(request, options.maxBodyBytes);
        const codeUpgrade = await startOpenHandsCodeUpgrade({ store, auth, run, delivery, plan, review, body, profile, runtime });
        return writeJson(response, 202, envelope({ codeUpgradeRun: codeUpgrade, events: store.listCodeUpgradeEvents(codeUpgrade.id) }));
      }
      const scheduleMatch = url.pathname.match(/^\/api\/v1\/deliveries\/([^/]+)\/schedule$/);
      if (request.method === "POST" && scheduleMatch) {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const deliveryId = decodeURIComponent(scheduleMatch[1]);
        const run = store.findRunByDeliveryId(deliveryId);
        if (!run) return writeJson(response, 404, { error: "DELIVERY_NOT_FOUND" });
        const delivery = run.deliveryPlans.find((item) => item.id === deliveryId)!;
        const plan = run.plans.find((item) => item.id === delivery.planId)!;
        const review = run.reviews.find((item) => item.planId === plan.id);
        if (delivery.approvalRequired && review?.status !== "USER_CONFIRMED") {
          return writeJson(response, 409, { error: "USER_CONFIRMATION_REQUIRED" });
        }
        const body = await readJson(request, options.maxBodyBytes);
        const connectorId = requireBodyString(body.connectorId, "JENKINS_CONNECTOR_ID_REQUIRED", runtime, "default");
        const connector = store.readJenkinsConnector(connectorId);
        if (!connector) return writeJson(response, 400, { error: "JENKINS_CONNECTOR_NOT_CONFIGURED" });
        const jobName = String(body.job ?? connector.jobTemplates?.[plan.projectId] ?? connector.jobTemplates?.default ?? "");
        if (!jobName) return writeJson(response, 400, { error: "JENKINS_JOB_REQUIRED" });
        const scheduledAt = String(body.scheduledAt ?? "");
        const scheduledTime = new Date(scheduledAt);
        if (Number.isNaN(scheduledTime.getTime())) return writeJson(response, 400, { error: "SCHEDULED_AT_REQUIRED" });
        const successfulCodeUpgrade = store.findSuccessfulCodeUpgrade(delivery.id);
        const parameters = normalizeDeliveryParameters(delivery, plan, body.parameters, successfulCodeUpgrade);
        const schedule: ScheduledEvolution = {
          id: `schedule-${delivery.id}-${Date.now()}`,
          projectId: delivery.projectId,
          deliveryPlanId: delivery.id,
          planId: plan.id,
          executor: "jenkins",
          connectorId,
          jobName,
          scheduledAt: scheduledTime.toISOString(),
          status: "SCHEDULED",
          parameters,
          createdAt: new Date().toISOString()
        };
        if (scheduledTime.getTime() <= Date.now()) {
          const codeUpgrade = store.findSuccessfulCodeUpgrade(delivery.id);
          if (!codeUpgrade) return writeJson(response, 409, { error: "CODE_UPGRADE_REQUIRED" });
          const pipeline = await triggerJenkinsDelivery({ store, auth, run, delivery, plan, body: { ...body, connectorId, job: jobName, parameters }, runtime });
          const triggered: ScheduledEvolution = {
            ...schedule,
            status: "TRIGGERED",
            triggeredAt: new Date().toISOString(),
            pipelineRunId: pipeline.id
          };
          store.writeSchedule(triggered);
          store.appendAudit(audit(auth, "delivery.schedule.triggered", triggered.id, { deliveryId, pipelineRunId: pipeline.id }));
          return writeJson(response, 202, envelope({ schedule: triggered, pipelineRun: pipeline }));
        }
        store.writeSchedule(schedule);
        store.appendAudit(audit(auth, "delivery.scheduled", schedule.id, { deliveryId, scheduledAt: schedule.scheduledAt }));
        return writeJson(response, 201, envelope(schedule));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/audit") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listAudit()));
      }
      return writeJson(response, 404, { error: "NOT_FOUND" });
    } catch (error) {
      if (error instanceof HttpError) return writeJson(response, error.statusCode, { error: error.code, detail: error.detail });
      return writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

class FileStore {
  constructor(private readonly dataRoot: string) {
    fs.mkdirSync(this.dataRoot, { recursive: true });
    fs.mkdirSync(this.runsDir, { recursive: true });
    fs.mkdirSync(this.projectsDir, { recursive: true });
    fs.mkdirSync(path.dirname(this.auditFile), { recursive: true });
    fs.mkdirSync(this.idempotencyDir, { recursive: true });
    fs.mkdirSync(this.rulesDir, { recursive: true });
    fs.mkdirSync(this.jenkinsConnectorsDir, { recursive: true });
    fs.mkdirSync(this.openHandsConnectorsDir, { recursive: true });
    fs.mkdirSync(this.pipelinesDir, { recursive: true });
    fs.mkdirSync(this.evaluationDatasetsDir, { recursive: true });
    fs.mkdirSync(this.codeUpgradeRunsDir, { recursive: true });
    fs.mkdirSync(this.codeUpgradeEventsDir, { recursive: true });
    fs.mkdirSync(this.codeUpgradeArtifactsDir, { recursive: true });
    fs.mkdirSync(this.schedulesDir, { recursive: true });
    this.ensureMetadata();
  }

  get runsDir(): string {
    return path.join(this.dataRoot, "runs");
  }

  get projectsDir(): string {
    return path.join(this.dataRoot, "projects");
  }

  get auditFile(): string {
    return path.join(this.dataRoot, "audit", "audit.jsonl");
  }

  get idempotencyDir(): string {
    return path.join(this.dataRoot, "idempotency");
  }

  get rulesDir(): string {
    return path.join(this.dataRoot, "rules");
  }

  get jenkinsConnectorsDir(): string {
    return path.join(this.dataRoot, "connectors", "jenkins");
  }

  get openHandsConnectorsDir(): string {
    return path.join(this.dataRoot, "connectors", "openhands");
  }

  get pipelinesDir(): string {
    return path.join(this.dataRoot, "pipelines");
  }

  get evaluationDatasetsDir(): string {
    return path.join(this.dataRoot, "evaluation-datasets");
  }

  get codeUpgradeRunsDir(): string {
    return path.join(this.dataRoot, "code-upgrades", "runs");
  }

  get codeUpgradeEventsDir(): string {
    return path.join(this.dataRoot, "code-upgrades", "events");
  }

  get codeUpgradeArtifactsDir(): string {
    return path.join(this.dataRoot, "code-upgrades", "artifacts");
  }

  get schedulesDir(): string {
    return path.join(this.dataRoot, "schedules");
  }

  get metadataFile(): string {
    return path.join(this.dataRoot, "metadata.json");
  }

  ensureMetadata(): void {
    if (!fs.existsSync(this.metadataFile)) {
      atomicWriteJson(this.metadataFile, {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        product: "evopilot"
      });
    }
  }

  metadata(): { schemaVersion: number; createdAt: string; product: string } {
    return JSON.parse(fs.readFileSync(this.metadataFile, "utf8"));
  }

  isReady(): boolean {
    return fs.existsSync(this.metadataFile) && fs.existsSync(this.runsDir) && fs.existsSync(this.projectsDir);
  }

  summary(): object {
    const runs = this.listRuns();
    const reviews = runs.flatMap((run) => run.reviews);
    const releases = runs.flatMap((run) => run.releaseReports);
    const pipelines = this.listPipelines();
    const codeUpgrades = this.listCodeUpgradeRuns();
    return {
      projectCount: this.listProjects().length,
      runCount: runs.length,
      pipelineCount: pipelines.length,
      codeUpgradeCount: codeUpgrades.length,
      runningCodeUpgradeCount: codeUpgrades.filter((item) => item.status === "QUEUED" || item.status === "RUNNING").length,
      runningPipelineCount: pipelines.filter((pipeline) => pipeline.status === "QUEUED" || pipeline.status === "RUNNING").length,
      opportunityCount: runs.reduce((sum, run) => sum + run.opportunities.length, 0),
      pendingReviewCount: reviews.filter((review) => review.status === "USER_CONFIRM_REQUIRED").length,
      confirmedReviewCount: reviews.filter((review) => review.status === "USER_CONFIRMED").length,
      releaseCount: releases.length,
      releaseHealth: releases.length === 0 ? 100 : Math.round((releases.filter((release) => release.status === "SUCCEEDED").length / releases.length) * 100),
      recentRuns: runs.slice(-5).reverse(),
      recentCodeUpgrades: codeUpgrades.slice(-5).reverse(),
      recentPipelines: pipelines.slice(-5).reverse()
    };
  }

  listRuns(): StoredRun[] {
    return fs.readdirSync(this.runsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.runsDir, file), "utf8")) as StoredRun);
  }

  readRun(id: string): StoredRun | undefined {
    const file = path.join(this.runsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8")) as StoredRun;
  }

  writeRun(run: StoredRun): void {
    atomicWriteJson(path.join(this.runsDir, `${run.id}.json`), run);
  }

  listProjects(): StoredProject[] {
    return fs.readdirSync(this.projectsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => this.hydrateProject(JSON.parse(fs.readFileSync(path.join(this.projectsDir, file), "utf8"))));
  }

  readProject(id: string): StoredProject | undefined {
    const file = path.join(this.projectsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return this.hydrateProject(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  writeProject(project: StoredProject): void {
    atomicWriteJson(path.join(this.projectsDir, `${safeFileName(project.id)}.json`), project);
  }

  ensureProject(project: StoredProject): void {
    const file = path.join(this.projectsDir, `${safeFileName(project.id)}.json`);
    if (!fs.existsSync(file)) this.writeProject(project);
  }

  private hydrateProject(project: any): StoredProject {
    return {
      ...project,
      validation: project.validation ?? {
        status: "VERIFIED",
        checkedAt: project.createdAt ?? new Date().toISOString(),
        message: "旧版项目记录已按兼容规则视为已验证"
      },
      updatedAt: project.updatedAt ?? project.createdAt ?? new Date().toISOString()
    } as StoredProject;
  }

  findRunByReviewId(reviewId: string): StoredRun | undefined {
    return this.listRuns().find((run) => run.reviews.some((review) => review.id === reviewId));
  }

  findRunByDeliveryId(deliveryId: string): StoredRun | undefined {
    return this.listRuns().find((run) => run.deliveryPlans.some((delivery) => delivery.id === deliveryId));
  }

  appendAudit(record: AuditRecord): void {
    fs.appendFileSync(this.auditFile, `${JSON.stringify(record)}\n`);
  }

  listAudit(): AuditRecord[] {
    if (!fs.existsSync(this.auditFile)) return [];
    return fs.readFileSync(this.auditFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditRecord);
  }

  readIdempotency(key: string): unknown | undefined {
    const file = path.join(this.idempotencyDir, `${safeFileName(key)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  writeIdempotency(key: string, response: unknown): void {
    atomicWriteJson(path.join(this.idempotencyDir, `${safeFileName(key)}.json`), response);
  }

  listJenkinsConnectors(): StoredJenkinsConnector[] {
    return fs.readdirSync(this.jenkinsConnectorsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.jenkinsConnectorsDir, file), "utf8")) as StoredJenkinsConnector);
  }

  readJenkinsConnector(id: string): StoredJenkinsConnector | undefined {
    const file = path.join(this.jenkinsConnectorsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8")) as StoredJenkinsConnector;
  }

  writeJenkinsConnector(connector: StoredJenkinsConnector): void {
    const existing = this.readJenkinsConnector(connector.id);
    atomicWriteJson(path.join(this.jenkinsConnectorsDir, `${safeFileName(connector.id)}.json`), {
      ...connector,
      createdAt: existing?.createdAt ?? connector.createdAt,
      updatedAt: connector.updatedAt
    });
  }

  listOpenHandsConnectors(): StoredOpenHandsConnector[] {
    return fs.readdirSync(this.openHandsConnectorsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.openHandsConnectorsDir, file), "utf8")) as StoredOpenHandsConnector);
  }

  readOpenHandsConnector(id: string): StoredOpenHandsConnector | undefined {
    const file = path.join(this.openHandsConnectorsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8")) as StoredOpenHandsConnector;
  }

  writeOpenHandsConnector(connector: StoredOpenHandsConnector): void {
    const existing = this.readOpenHandsConnector(connector.id);
    atomicWriteJson(path.join(this.openHandsConnectorsDir, `${safeFileName(connector.id)}.json`), {
      ...connector,
      createdAt: existing?.createdAt ?? connector.createdAt,
      updatedAt: connector.updatedAt
    });
  }

  listPipelines(): PipelineRun[] {
    return fs.readdirSync(this.pipelinesDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.pipelinesDir, file), "utf8")) as PipelineRun);
  }

  readPipeline(id: string): PipelineRun | undefined {
    const file = path.join(this.pipelinesDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8")) as PipelineRun;
  }

  writePipeline(pipeline: PipelineRun): void {
    atomicWriteJson(path.join(this.pipelinesDir, `${safeFileName(pipeline.id)}.json`), pipeline);
    const run = this.findRunByDeliveryId(pipeline.deliveryPlanId);
    if (run) {
      const remaining = (run.pipelineRuns ?? []).filter((item) => item.id !== pipeline.id);
      run.pipelineRuns = [...remaining, pipeline];
      this.writeRun(run);
    }
  }

  listEvaluationDatasets(): EvaluationDataset[] {
    return fs.readdirSync(this.evaluationDatasetsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.evaluationDatasetsDir, file), "utf8")) as EvaluationDataset);
  }

  writeEvaluationDatasets(datasets: EvaluationDataset[]): void {
    for (const dataset of datasets) {
      atomicWriteJson(path.join(this.evaluationDatasetsDir, `${safeFileName(dataset.id)}.json`), dataset);
    }
  }

  listCodeUpgradeRuns(): CodeUpgradeRun[] {
    return fs.readdirSync(this.codeUpgradeRunsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.codeUpgradeRunsDir, file), "utf8")) as CodeUpgradeRun);
  }

  readCodeUpgradeRun(id: string): CodeUpgradeRun | undefined {
    const file = path.join(this.codeUpgradeRunsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8")) as CodeUpgradeRun;
  }

  writeCodeUpgradeRun(run: CodeUpgradeRun): void {
    atomicWriteJson(path.join(this.codeUpgradeRunsDir, `${safeFileName(run.id)}.json`), run);
  }

  findSuccessfulCodeUpgrade(deliveryPlanId: string): CodeUpgradeRun | undefined {
    return this.listCodeUpgradeRuns().find((run) => run.deliveryPlanId === deliveryPlanId && run.status === "SUCCEEDED");
  }

  appendCodeUpgradeEvent(event: CodeUpgradeEvent): void {
    fs.appendFileSync(path.join(this.codeUpgradeEventsDir, `${safeFileName(event.codeUpgradeRunId)}.jsonl`), `${JSON.stringify(event)}\n`);
  }

  writeCodeUpgradeEvents(codeUpgradeRunId: string, events: CodeUpgradeEvent[]): void {
    atomicWriteText(path.join(this.codeUpgradeEventsDir, `${safeFileName(codeUpgradeRunId)}.jsonl`), events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : ""));
  }

  listCodeUpgradeEvents(codeUpgradeRunId: string): CodeUpgradeEvent[] {
    const file = path.join(this.codeUpgradeEventsDir, `${safeFileName(codeUpgradeRunId)}.jsonl`);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CodeUpgradeEvent);
  }

  writeCodeUpgradeDiff(codeUpgradeRunId: string, diff: string): string {
    const file = path.join(this.codeUpgradeArtifactsDir, `${safeFileName(codeUpgradeRunId)}.diff`);
    atomicWriteText(file, diff);
    return file;
  }

  listSchedules(): ScheduledEvolution[] {
    return fs.readdirSync(this.schedulesDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.schedulesDir, file), "utf8")) as ScheduledEvolution);
  }

  writeSchedule(schedule: ScheduledEvolution): void {
    atomicWriteJson(path.join(this.schedulesDir, `${safeFileName(schedule.id)}.json`), schedule);
  }

  ensureRuleMemories(rules: EvolutionTriggerRule[]): void {
    for (const rule of rules) {
      const file = this.ruleFile(rule.id);
      if (!fs.existsSync(file)) atomicWriteText(file, renderRuleMemoryMarkdown(rule));
    }
  }

  writeRuleMemory(memory: RuleMemory): void {
    atomicWriteText(this.ruleFile(memory.id), renderRuleMemoryMarkdown(memory.compiledRule, memory.llmTrace));
  }

  listRuleMemories(): RuleMemory[] {
    return fs.readdirSync(this.rulesDir)
      .filter((file) => file.endsWith(".md"))
      .sort()
      .map((file) => this.readRuleMemory(path.join(this.rulesDir, file)))
      .filter((rule): rule is RuleMemory => rule !== undefined);
  }

  readTriggerRules(fallbackRules: EvolutionTriggerRule[]): EvolutionTriggerRule[] {
    const rules = this.listRuleMemories().map((memory) => memory.compiledRule);
    return rules.length > 0 ? rules : fallbackRules;
  }

  private readRuleMemory(file: string): RuleMemory | undefined {
    const markdown = fs.readFileSync(file, "utf8");
    const jsonBlock = markdown.match(/```json\s*([\s\S]*?)\s*```/);
    const traceBlock = markdown.match(/<!-- evopilot-llm-trace\s*([\s\S]*?)\s*-->/);
    if (!jsonBlock) return undefined;
    const compiledRule = JSON.parse(jsonBlock[1]) as EvolutionTriggerRule;
    const llmTrace = traceBlock ? JSON.parse(traceBlock[1]) as Record<string, unknown> : undefined;
    const userPrompt = extractMarkdownField(markdown, "用户规则") ?? compiledRule.userPrompt ?? compiledRule.name;
    return {
      id: compiledRule.id,
      userPrompt,
      enabled: compiledRule.enabled,
      description: compiledRule.description,
      compiledRule: { ...compiledRule, userPrompt },
      storagePath: file,
      llmTrace
    };
  }

  private ruleFile(id: string): string {
    return path.join(this.rulesDir, `${safeFileName(id)}.md`);
  }
}

function normalizeDecisionAction(value: unknown): ReviewRecord["decisions"][number]["action"] {
  if (value === "accept" || value === "reject" || value === "request-changes" || value === "observe-only") return value;
  throw new Error("Unsupported review decision action");
}

async function startOpenHandsCodeUpgrade(args: {
  store: FileStore;
  auth: AuthContext;
  run: StoredRun;
  delivery: DeliveryPlan;
  plan: EvolutionPlan;
  review?: ReviewRecord;
  body: any;
  profile: ProjectProfile;
  runtime: RuntimeConfig;
}): Promise<CodeUpgradeRun> {
  const { store, auth, delivery, plan, review, body, profile, runtime } = args;
  const connectorId = requireBodyString(body.connectorId, "CODE_UPGRADE_CONNECTOR_ID_REQUIRED", runtime, "default");
  const connector = store.readOpenHandsConnector(connectorId);
  if (!connector) throw new Error("OPENHANDS_CONNECTOR_NOT_CONFIGURED");
  const project = store.readProject(delivery.projectId);
  if (!project?.repository && runtime.mode === "prod") throw new Error("PROJECT_REPOSITORY_NOT_CONFIGURED");
  const proposalMarkdown = String(body.proposalMarkdown ?? body.PROPOSAL_MARKDOWN ?? renderPlanMarkdown(plan));
  const validationCommands = normalizeValidationCommands(body.validationCommands ?? plan.validationContract.commands);
  const branchStrategy = createBranchStrategy({ projectId: delivery.projectId, sourceBranch: project?.repository?.defaultBranch, delivery, plan, body });
  const session = await new OpenHandsClient(connector).startCodeUpgrade({
    projectId: delivery.projectId,
    repository: project?.repository ? {
      provider: project.repository.provider,
      gitUrl: project.repository.gitUrl,
      root: project.repository.root,
      branch: branchStrategy.sourceBranch,
      sourceBranch: branchStrategy.sourceBranch,
      upgradeBranch: branchStrategy.upgradeBranch,
      username: project.repository.credentials?.username,
      password: project.repository.credentials?.password,
      token: project.repository.credentials?.token,
      tokenRef: project.repository.credentials?.tokenRef
    } : undefined,
    branchStrategy,
    proposalMarkdown,
    validationCommands,
    protectedPaths: profile.policy.protectedPaths
  });
  const now = new Date().toISOString();
  const codeUpgrade: CodeUpgradeRun = {
    id: `code-upgrade-${delivery.id}-${Date.now()}`,
    projectId: delivery.projectId,
    deliveryPlanId: delivery.id,
    planId: plan.id,
    reviewId: review?.id,
    executor: "openhands",
    status: session.status,
    proposalMarkdown,
    validationCommands,
    branchStrategy,
    openhands: {
      connectorId,
      workspaceId: session.workspaceId,
      conversationId: session.conversationId
    },
    artifacts: {},
    createdAt: now,
    updatedAt: now
  };
  store.writeCodeUpgradeRun(codeUpgrade);
  store.appendCodeUpgradeEvent({
    id: `event-${codeUpgrade.id}-created`,
    codeUpgradeRunId: codeUpgrade.id,
    timestamp: now,
    source: "evopilot",
    phase: "创建代码升级任务",
    level: "info",
    message: `用户确认进化方案后，EvoPilot 已创建代码升级任务，升级分支：${branchStrategy.upgradeBranch}。`
  });
  store.appendAudit(audit(auth, "code-upgrade.started", codeUpgrade.id, { deliveryId: delivery.id, connectorId, conversationId: session.conversationId, branchStrategy }));
  return refreshCodeUpgradeRun(store, codeUpgrade.id).then((updated) => updated ?? codeUpgrade);
}

function createAndStoreRunFromEvidence(args: {
  store: FileStore;
  auth: AuthContext;
  projectId: string;
  events: RuntimeEvidenceEvent[];
  files: string[];
  now: string;
  profile: ProjectProfile;
  idempotencyKey?: string;
  ingestSource: string;
}): StoredRun {
  const { store, auth, projectId, events, files, now, profile, idempotencyKey, ingestSource } = args;
  const project = store.readProject(projectId);
  if (!project) throw httpError(404, "PROJECT_NOT_FOUND");
  if (project.validation.status !== "VERIFIED") throw httpError(409, "PROJECT_NOT_VERIFIED", project.validation.message);
  if (events.length === 0) throw httpError(400, "EVIDENCE_EVENTS_REQUIRED", "至少需要 1 条进化证据事件");
  const runtimeProfile: ProjectProfile = { ...profile, triggerRules: store.readTriggerRules(profile.triggerRules ?? defaultTriggerRules) };
  const result = runEvolutionCycle({ projectId, profile: runtimeProfile, events, files, now });
  const run: StoredRun = {
    id: result.evidenceBundle.id,
    ...result,
    releaseReports: [],
    learningRecords: []
  };
  store.writeRun(run);
  store.appendAudit(audit(auth, "evidence.ingested", run.id, { projectId, ingestSource, eventCount: events.length }));
  store.appendAudit(audit(auth, "run.created", run.id, { projectId, opportunityCount: run.opportunities.length, idempotencyKey, ingestSource }));
  return run;
}

async function refreshCodeUpgradeRun(store: FileStore, codeUpgradeRunId: string): Promise<CodeUpgradeRun | undefined> {
  const run = store.readCodeUpgradeRun(codeUpgradeRunId);
  if (!run) return undefined;
  if (run.status === "SUCCEEDED" || run.status === "FAILED" || run.status === "CANCELED") return run;
  const connector = store.readOpenHandsConnector(run.openhands.connectorId);
  if (!connector) return run;
  const snapshot = await new OpenHandsClient(connector).readCodeUpgradeSnapshot(run.openhands.conversationId);
  const events = [
    ...store.listCodeUpgradeEvents(run.id).filter((event) => event.source === "evopilot"),
    ...snapshot.events.map((event, index): CodeUpgradeEvent => ({
      id: event.id || `openhands-${run.id}-${index}`,
      codeUpgradeRunId: run.id,
      timestamp: event.timestamp ?? new Date().toISOString(),
      source: event.source ?? "openhands",
      phase: event.phase ?? inferCodeUpgradePhase(event.message),
      level: event.level ?? "info",
      message: event.message,
      raw: event.raw
    }))
  ];
  const updated: CodeUpgradeRun = {
    ...run,
    status: snapshot.status,
    openhands: {
      ...run.openhands,
      workspaceId: snapshot.workspaceId ?? run.openhands.workspaceId
    },
    artifacts: {
      ...run.artifacts,
      diffPath: snapshot.diff ? store.writeCodeUpgradeDiff(run.id, snapshot.diff) : run.artifacts.diffPath,
      branchName: snapshot.branchName ?? run.artifacts.branchName,
      commitSha: snapshot.commitSha ?? run.artifacts.commitSha,
      pullRequestUrl: snapshot.pullRequestUrl ?? run.artifacts.pullRequestUrl,
      changedFiles: snapshot.changedFiles ?? run.artifacts.changedFiles
    },
    updatedAt: new Date().toISOString()
  };
  store.writeCodeUpgradeRun(updated);
  store.writeCodeUpgradeEvents(run.id, dedupeEvents(events));
  return updated;
}

function renderPlanMarkdown(plan: EvolutionPlan): string {
  return [
    `# ${plan.problemStatement}`,
    "",
    "## 为什么需要进化",
    plan.whyEvolutionNeeded,
    "",
    "## 方案",
    plan.proposedApproach,
    "",
    "## 预期效果",
    plan.expectedEffect,
    "",
    "## 风险",
    plan.riskAnalysis,
    "",
    "## 回滚计划",
    plan.rollbackPlan
  ].join("\n");
}

function normalizeValidationCommands(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && "command" in item) return String((item as { command: unknown }).command);
    return "";
  }).filter(Boolean);
}

function inferCodeUpgradePhase(message: string): string {
  if (/方案|plan/i.test(message)) return "读取方案";
  if (/分析|scan|inspect/i.test(message)) return "分析仓库";
  if (/文件|file/i.test(message)) return "定位文件";
  if (/补丁|diff|patch/i.test(message)) return "生成补丁";
  if (/测试|验证|test|check/i.test(message)) return "运行验证";
  return "代码升级";
}

function dedupeEvents(events: CodeUpgradeEvent[]): CodeUpgradeEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function createBranchStrategy(args: { projectId: string; sourceBranch?: string; delivery: DeliveryPlan; plan: EvolutionPlan; body: any }): CodeUpgradeRun["branchStrategy"] {
  const sourceBranch = String(args.body.sourceBranch ?? args.body.targetBranch ?? args.sourceBranch ?? "main").trim();
  const upgradeBranch = String(args.body.upgradeBranch ?? defaultUpgradeBranch(args.projectId, args.plan.id)).trim();
  const title = args.plan.problemStatement || args.plan.proposedApproach || "进化方案";
  return {
    sourceBranch,
    upgradeBranch,
    commitMessage: String(args.body.commitMessage ?? `EvoPilot: ${title}`).trim(),
    mergeRequestTitle: String(args.body.mergeRequestTitle ?? `EvoPilot 进化方案：${title}`).trim(),
    mergeRequestDescription: String(args.body.mergeRequestDescription ?? renderMergeRequestDescription(args.plan, args.delivery)).trim()
  };
}

function defaultUpgradeBranch(projectId: string, planId: string): string {
  return `evopilot/upgrade/${safeGitBranchSegment(projectId)}/${safeGitBranchSegment(planId)}-${Date.now()}`;
}

function safeGitBranchSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^[-/.]+|[-/.]+$/g, "")
    .slice(0, 80) || "change";
}

function renderMergeRequestDescription(plan: EvolutionPlan, delivery: DeliveryPlan): string {
  return [
    "## EvoPilot 进化方案",
    "",
    `- Plan ID: ${plan.id}`,
    `- Delivery ID: ${delivery.id}`,
    `- 项目: ${delivery.projectId}`,
    "",
    "### 方案摘要",
    "",
    plan.proposedApproach,
    "",
    "### 验证契约",
    "",
    ...plan.validationContract.commands.map((item) => `- ${item.command}`)
  ].join("\n");
}

async function refreshPipeline(store: FileStore, pipelineId: string): Promise<PipelineRun | undefined> {
  const pipeline = store.readPipeline(pipelineId);
  if (!pipeline) return undefined;
  if (pipeline.provider !== "jenkins") return pipeline;
  const connector = store.readJenkinsConnector(pipeline.connectorId);
  if (!connector) return pipeline;
  if (pipeline.status === "SUCCEEDED" || pipeline.status === "FAILED" || pipeline.status === "CANCELED") return pipeline;
  const snapshot = await new JenkinsClient(connector).readBuildSnapshot(pipeline.jobName, pipeline.queueId, pipeline.buildNumber);
  const updated: PipelineRun = {
    ...pipeline,
    status: snapshot.status,
    buildNumber: snapshot.buildNumber ?? pipeline.buildNumber,
    buildUrl: snapshot.buildUrl ?? pipeline.buildUrl,
    stages: snapshot.stages,
    artifacts: snapshot.artifacts,
    logRef: {
      url: snapshot.buildNumber ? new JenkinsClient(connector).buildConsoleUrl(pipeline.jobName, snapshot.buildNumber) : pipeline.logRef?.url,
      preview: snapshot.logPreview
    },
    updatedAt: new Date().toISOString()
  };
  store.writePipeline(updated);
  finalizePipelineIfNeeded(store, updated);
  return updated;
}

function finalizePipelineIfNeeded(store: FileStore, pipeline: PipelineRun): void {
  if (pipeline.status !== "SUCCEEDED" && pipeline.status !== "FAILED" && pipeline.status !== "CANCELED") return;
  const run = store.findRunByDeliveryId(pipeline.deliveryPlanId);
  if (!run || run.releaseReports.some((report) => report.deliveryPlanId === pipeline.deliveryPlanId)) return;
  const delivery = run.deliveryPlans.find((item) => item.id === pipeline.deliveryPlanId);
  if (!delivery) return;
  const plan = run.plans.find((item) => item.id === delivery.planId);
  if (!plan) return;
  const releaseStatus = pipelineStatusToReleaseStatus(pipeline.status);
  const report = createReleaseReport({
    id: `release-${delivery.id}`,
    projectId: delivery.projectId,
    deliveryPlanId: delivery.id,
    evidenceBundleId: run.evidenceBundle.id,
    version: pipeline.parameters.VERSION ?? "jenkins",
    status: releaseStatus,
    validationSummary: releaseStatus === "SUCCEEDED" ? "Jenkins 流水线与发布后验证已通过。" : "Jenkins 流水线失败，发布已阻断。",
    releasedAt: releaseStatus === "SUCCEEDED" ? new Date().toISOString() : undefined
  });
  run.releaseReports.push(report);
  run.learningRecords.push({
    id: `learning-${delivery.id}`,
    projectId: delivery.projectId,
    planId: plan.id,
    prediction: plan.expectedEffect,
    outcome: releaseStatus === "SUCCEEDED" ? "validated" : "rejected",
    ruleChangesSuggested: releaseStatus === "SUCCEEDED" ? [] : ["检查 Jenkins 失败阶段，并收紧发布前验证契约。"],
    createdAt: new Date().toISOString()
  });
  store.writeRun(run);
}

function maskJenkinsConnector(connector: StoredJenkinsConnector): Omit<StoredJenkinsConnector, "apiToken"> & { apiTokenConfigured: boolean } {
  const { apiToken, ...safe } = connector;
  return { ...safe, apiTokenConfigured: Boolean(apiToken) };
}

function maskOpenHandsConnector(connector: StoredOpenHandsConnector): Omit<StoredOpenHandsConnector, "apiKey"> & { apiKeyConfigured: boolean } {
  const { apiKey, ...safe } = connector;
  return { ...safe, apiKeyConfigured: Boolean(apiKey) };
}

function normalizeEvaluationDataset(value: any, defaultProjectId: string): EvaluationDataset {
  const now = new Date().toISOString();
  const id = String(value.id ?? `eval-${Date.now()}-${Math.random().toString(36).slice(2)}`).trim();
  if (!id) throw new Error("EVALUATION_DATASET_ID_REQUIRED");
  return {
    id,
    projectId: String(value.projectId ?? defaultProjectId).trim(),
    name: String(value.name ?? id).trim(),
    source: String(value.source ?? "运行证据").trim(),
    status: normalizeEvaluationDatasetStatus(value.status),
    severity: normalizeEvaluationDatasetSeverity(value.severity),
    sampleCount: Math.max(1, Number(value.sampleCount ?? 1)),
    metric: String(value.metric ?? "待评估").trim(),
    scope: String(value.scope ?? "运行证据").trim(),
    triggeredAt: value.triggeredAt ? new Date(String(value.triggeredAt)).toISOString() : now
  };
}

function normalizeEvaluationDatasetStatus(value: unknown): EvaluationDataset["status"] {
  const text = String(value ?? "REGRESSION_READY").toUpperCase();
  if (text === "REGRESSION_READY" || text === "EVALUATED" || text === "NEEDS_LABELING" || text === "INSUFFICIENT_EVIDENCE") return text;
  return "REGRESSION_READY";
}

function normalizeEvaluationDatasetSeverity(value: unknown): EvaluationDataset["severity"] {
  const text = String(value ?? "MEDIUM").toUpperCase();
  if (text === "LOW" || text === "MEDIUM" || text === "HIGH") return text;
  return "MEDIUM";
}

function defaultEvaluationDatasets(): EvaluationDataset[] {
  return [
    {
      id: "eval-latency",
      projectId: "domainforge-fabric",
      name: "高延迟链路问答",
      source: "Trace 聚类",
      status: "REGRESSION_READY",
      severity: "HIGH",
      sampleCount: 428,
      metric: "p95 3.6s",
      scope: "MCP Trace / 订单问答链路",
      triggeredAt: "2026-06-03T09:28:00.000Z"
    },
    {
      id: "eval-tool-recovery",
      projectId: "simple-agent-project",
      name: "工具失败恢复",
      source: "Tool Call",
      status: "NEEDS_LABELING",
      severity: "MEDIUM",
      sampleCount: 96,
      metric: "失败率 8.4%",
      scope: "Tool Call / 恢复路径",
      triggeredAt: "2026-06-03T09:34:00.000Z"
    },
    {
      id: "eval-rag-drift",
      projectId: "domainforge-fabric",
      name: "RAG 引用漂移",
      source: "RAG Context",
      status: "REGRESSION_READY",
      severity: "MEDIUM",
      sampleCount: 171,
      metric: "命中率下降 6.2%",
      scope: "RAG Context / 知识引用",
      triggeredAt: "2026-06-03T09:39:00.000Z"
    },
    {
      id: "eval-cost-latency",
      projectId: "domainforge-fabric",
      name: "成本与延迟异常",
      source: "Cost / Latency",
      status: "EVALUATED",
      severity: "MEDIUM",
      sampleCount: 142,
      metric: "成本 +12%",
      scope: "LLM 调用 / 路由策略",
      triggeredAt: "2026-06-03T09:45:00.000Z"
    },
    {
      id: "eval-feedback",
      projectId: "simple-agent-project",
      name: "用户负反馈聚类",
      source: "用户反馈",
      status: "INSUFFICIENT_EVIDENCE",
      severity: "LOW",
      sampleCount: 18,
      metric: "负反馈 18 条",
      scope: "用户反馈 / 多轮对话",
      triggeredAt: "2026-06-03T09:52:00.000Z"
    }
  ];
}

async function renderOpportunityDraftMarkdown(args: {
  title: string;
  target: string;
  datasets: EvaluationDataset[];
  llmClient?: LlmTaskClient;
  requireLlm?: boolean;
}): Promise<{ markdown: string; trace?: Record<string, unknown> }> {
  if (args.llmClient) {
    const startedAt = new Date().toISOString();
    const response = await args.llmClient.generate({
      caller: "evopilot-server",
      intent: "plan.generation",
      outputContract: "markdown_document",
      latencyClass: "batch",
      complexity: "high",
      outputSize: "large",
      metadata: {
        productFlow: "evaluation-datasets-to-opportunity-draft",
        datasetCount: String(args.datasets.length)
      },
      prompt: [
        "你是 EvoPilot 的软件架构师。",
        "请基于用户选择的评测集生成一份生产可审查的 Markdown 进化方案。",
        "只输出 Markdown，不要输出解释性前后缀。",
        "",
        `机会点标题：${args.title}`,
        `进化目标：${args.target}`,
        "",
        "关联评测集：",
        ...args.datasets.map((dataset) => [
          `- 名称：${dataset.name}`,
          `  项目：${dataset.projectId}`,
          `  来源：${dataset.source}`,
          `  状态：${dataset.status}`,
          `  严重级别：${dataset.severity}`,
          `  样本数：${dataset.sampleCount}`,
          `  指标：${dataset.metric}`,
          `  范围：${dataset.scope}`,
          `  触发时间：${dataset.triggeredAt}`
        ].join("\n")),
        "",
        "必须包含章节：背景、进化目标、架构改造建议、验证计划、风险与回滚。"
      ].join("\n")
    });
    if (response.success && response.text.trim()) {
      return {
        markdown: response.text.trim(),
        trace: {
          mode: "llm",
          provider: response.provider,
          model: response.model,
          durationMs: response.durationMs,
          usage: response.usage,
          resolvedIntent: response.resolvedIntent,
          resolvedProfile: response.resolvedProfile,
          preflightUsed: response.preflightUsed,
          truncated: response.truncated,
          truncationRetryAttempt: response.truncationRetryAttempt,
          finalMaxOutputTokens: response.finalMaxOutputTokens,
          promptCompressed: response.promptCompressed,
          compression: response.compression,
          startedAt
        }
      };
    }
    if (args.requireLlm) {
      throw new Error(`LLM_OPPORTUNITY_DRAFT_FAILED: ${response.errorCode ?? "UNKNOWN"}`);
    }
    return {
      markdown: fallbackOpportunityDraftMarkdown(args),
      trace: {
        mode: "template-fallback",
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        startedAt
      }
    };
  }
  if (args.requireLlm) throw new Error("LLM_REQUIRED_FOR_OPPORTUNITY_DRAFT");
  return {
    markdown: fallbackOpportunityDraftMarkdown(args),
    trace: { mode: "template", reason: "LLM 未配置" }
  };
}

function allowedTriggerField(value: string): EvolutionTriggerCondition["field"] {
  const allowed: EvolutionTriggerCondition["field"][] = ["type", "source", "severity", "module", "attributes.durationMs", "attributes.latencyMs", "attributes.p95LatencyMs"];
  return allowed.includes(value as EvolutionTriggerCondition["field"]) ? value as EvolutionTriggerCondition["field"] : "attributes.durationMs";
}

function allowedTriggerOperator(value: string): EvolutionTriggerCondition["operator"] {
  const allowed: EvolutionTriggerCondition["operator"][] = ["==", "!=", ">", ">=", "<", "<=", "includes"];
  return allowed.includes(value as EvolutionTriggerCondition["operator"]) ? value as EvolutionTriggerCondition["operator"] : ">";
}

function allowedOpportunityType(value: string): EvolutionTriggerRule["opportunityType"] {
  const allowed: EvolutionTriggerRule["opportunityType"][] = ["product-gap", "performance-hotspot", "reliability-risk", "tool-failure", "test-gap", "documentation-drift", "cost-risk", "security-risk", "module-boundary-smell", "release-process-risk"];
  return allowed.includes(value as EvolutionTriggerRule["opportunityType"]) ? value as EvolutionTriggerRule["opportunityType"] : "performance-hotspot";
}

function allowedRiskLevel(value: string): EvolutionOpportunity["riskLevel"] {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" ? value : "MEDIUM";
}

function fallbackOpportunityDraftMarkdown(args: { title: string; target: string; datasets: EvaluationDataset[] }): string {
  return [
    `# ${args.title}`,
    "",
    "## 背景",
    "",
    `该机会点由 ${args.datasets.length} 个评测集共同形成：${args.datasets.map((dataset) => dataset.name).join("、")}。`,
    "",
    "## 进化目标",
    "",
    `- ${args.target}`,
    "",
    "## 架构改造建议",
    "",
    "1. 为关键链路增加预算和适应度函数。",
    "2. 调整 RAG、工具调用和路由策略，避免牺牲回答质量换取速度。",
    "3. 将关联评测集写入 Regression Suite，并作为后续 CI 门禁。",
    "",
    "## 验证计划",
    "",
    "- 单元测试覆盖关键策略。",
    "- 冒烟测试覆盖一次完整 Agent 调用。",
    "- 功能闭环测试覆盖评测集回归。",
    "- CI/CD 通过后进入灰度验证。"
  ].join("\n");
}

function maskProject(project: StoredProject): Omit<StoredProject, "repository"> & { repository?: Omit<ProjectRepositoryRegistration, "credentials"> & { credentialsConfigured: boolean } } {
  const { repository, ...safe } = project;
  return {
    ...safe,
    repository: repository ? {
      provider: repository.provider,
      gitUrl: repository.gitUrl,
      root: repository.root,
      baseUrl: repository.baseUrl,
      projectId: repository.projectId,
      owner: repository.owner,
      repo: repository.repo,
      defaultBranch: repository.defaultBranch,
      credentialsConfigured: Boolean(repository.credentials?.token || repository.credentials?.password || repository.credentials?.tokenRef)
    } : undefined
  };
}

async function compileRuleWithLlm(args: {
  projectId: string;
  userPrompt: string;
  llmClient?: LlmTaskClient;
  requireLlm: boolean;
}): Promise<{ memory: RuleMemory }> {
  if (!args.llmClient) {
    if (args.requireLlm) throw new Error("LLM_REQUIRED_FOR_RULE_COMPILE");
    const rule = fallbackCompiledRule(args.projectId, args.userPrompt, "LLM 未配置，使用模板规则");
    return { memory: ruleMemoryFromCompiledRule(rule, { mode: "template", reason: "LLM 未配置" }) };
  }
  const startedAt = new Date().toISOString();
  const response = await args.llmClient.generate({
    caller: "evopilot-server",
    intent: "structured.extraction",
    outputContract: "json_object",
    jsonObject: true,
    latencyClass: "interactive",
    complexity: "medium",
    outputSize: "medium",
    metadata: {
      productFlow: "prompt-to-executable-rule",
      projectId: args.projectId
    },
    prompt: [
      "你是 EvoPilot 的证据策略编译器。",
      "请把用户的自然语言策略编译成 EvoPilot 可执行 JSON 规则。",
      "只返回 JSON 对象，不要 Markdown。",
      "",
      "字段要求：",
      "- id: kebab-case 字符串",
      "- name: 中文规则名",
      "- description: 中文说明",
      "- userPrompt: 原始用户规则",
      "- compiledBy: 固定为 llm",
      "- enabled: true",
      "- opportunityType: performance-hotspot | reliability-risk | tool-failure | cost-risk | security-risk | test-gap",
      "- title: 触发后形成的机会点标题",
      "- affectedArea: 影响区域",
      "- suggestedDirection: 优化方向",
      "- riskLevel: LOW | MEDIUM | HIGH",
      "- anyOf 或 allOf: 条件数组，field 只能使用 type/source/severity/module/attributes.durationMs/attributes.latencyMs/attributes.p95LatencyMs，operator 只能使用 ==/!=/>/>=/</<=/includes",
      "- minMatchingEvents: 正整数",
      "",
      `项目：${args.projectId}`,
      `用户规则：${args.userPrompt}`
    ].join("\n")
  });
  if (!response.success || !response.text.trim()) {
    if (args.requireLlm) throw new Error(`LLM_RULE_COMPILE_FAILED: ${response.errorCode ?? "UNKNOWN"}`);
    const rule = fallbackCompiledRule(args.projectId, args.userPrompt, response.errorMessage ?? "LLM 调用失败，使用模板规则");
    return { memory: ruleMemoryFromCompiledRule(rule, llmTraceFromResponse("template-fallback", response, startedAt)) };
  }
  try {
    const compiled = normalizeCompiledRule(JSON.parse(extractJsonObject(response.text)), args.projectId, args.userPrompt);
    return { memory: ruleMemoryFromCompiledRule(compiled, llmTraceFromResponse("llm", response, startedAt)) };
  } catch (error) {
    if (args.requireLlm) throw new Error(`LLM_RULE_COMPILE_RESPONSE_INVALID: ${error instanceof Error ? error.message : String(error)}`);
    const rule = fallbackCompiledRule(args.projectId, args.userPrompt, "LLM 返回格式无效，使用模板规则");
    return { memory: ruleMemoryFromCompiledRule(rule, llmTraceFromResponse("template-fallback", response, startedAt)) };
  }
}

function normalizeCompiledRule(value: any, projectId: string, userPrompt: string): EvolutionTriggerRule {
  const id = safeFileName(String(value.id ?? `rule-${Date.now()}`).toLowerCase()).replace(/_/g, "-");
  const conditions = (Array.isArray(value.anyOf) ? value.anyOf : Array.isArray(value.allOf) ? value.allOf : [])
    .map((item: any) => ({
      field: allowedTriggerField(String(item.field)),
      operator: allowedTriggerOperator(String(item.operator)),
      value: typeof item.value === "number" ? item.value : String(item.value ?? "")
    }));
  if (conditions.length === 0) {
    conditions.push({ field: "attributes.durationMs", operator: ">", value: 3000 });
  }
  return {
    id,
    name: String(value.name ?? userPrompt).trim(),
    description: String(value.description ?? `项目 ${projectId} 的 LLM 编译证据策略。`).trim(),
    userPrompt,
    compiledBy: "llm",
    compiledAt: new Date().toISOString(),
    enabled: value.enabled !== false,
    opportunityType: allowedOpportunityType(String(value.opportunityType)),
    title: String(value.title ?? "运行证据触发演进机会点").trim(),
    affectedArea: String(value.affectedArea ?? "runtime").trim(),
    suggestedDirection: String(value.suggestedDirection ?? "基于运行证据进行演进优化").trim(),
    riskLevel: allowedRiskLevel(String(value.riskLevel)),
    anyOf: Array.isArray(value.anyOf) || !Array.isArray(value.allOf) ? conditions : undefined,
    allOf: Array.isArray(value.allOf) ? conditions : undefined,
    minMatchingEvents: Math.max(1, Number(value.minMatchingEvents ?? 1))
  };
}

function fallbackCompiledRule(projectId: string, userPrompt: string, reason: string): EvolutionTriggerRule {
  return {
    id: safeFileName(userPrompt.toLowerCase()).replace(/_/g, "-") || `rule-${Date.now()}`,
    name: userPrompt,
    description: `${reason}。项目 ${projectId} 默认按链路耗时超过 3000ms 触发性能优化机会点。`,
    userPrompt,
    compiledBy: "system",
    compiledAt: new Date().toISOString(),
    enabled: true,
    opportunityType: "performance-hotspot",
    title: "链路性能超过阈值，需要生成性能优化机会点",
    affectedArea: "runtime-performance",
    suggestedDirection: "补齐链路超时预算、性能适应度函数和回归验证。",
    riskLevel: "MEDIUM",
    anyOf: [{ field: "attributes.durationMs", operator: ">", value: 3000 }],
    minMatchingEvents: 1
  };
}

function ruleMemoryFromCompiledRule(rule: EvolutionTriggerRule, llmTrace?: Record<string, unknown>): RuleMemory {
  return {
    id: rule.id,
    userPrompt: rule.userPrompt ?? rule.name,
    enabled: rule.enabled,
    description: rule.description,
    compiledRule: rule,
    storagePath: `rules/${safeFileName(rule.id)}.md`,
    llmTrace
  };
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON object not found");
  return text.slice(start, end + 1);
}

function llmTraceFromResponse(mode: string, response: LlmGenerateResponse, startedAt: string): Record<string, unknown> {
  return {
    mode,
    provider: response.provider,
    model: response.model,
    durationMs: response.durationMs,
    usage: response.usage,
    resolvedIntent: response.resolvedIntent,
    resolvedProfile: response.resolvedProfile,
    preflightUsed: response.preflightUsed,
    truncated: response.truncated,
    truncationRetryAttempt: response.truncationRetryAttempt,
    finalMaxOutputTokens: response.finalMaxOutputTokens,
    promptCompressed: response.promptCompressed,
    compression: response.compression,
    errorCode: response.errorCode,
    startedAt
  };
}

function normalizeProjectRepository(body: any): ProjectRepositoryRegistration | undefined {
  const source = body.repository && typeof body.repository === "object" ? body.repository : body;
  const gitUrl = source.gitUrl ?? source.url;
  const parsed = gitUrl ? parseGitUrl(String(gitUrl)) : {};
  const provider = String(source.provider ?? parsed.provider ?? "").trim() as ProjectRepositoryProvider;
  if (provider !== "local-git" && provider !== "gitlab" && provider !== "github") return undefined;
  const repository: ProjectRepositoryRegistration = {
    provider,
    gitUrl: gitUrl ? String(gitUrl).trim() : undefined,
    root: source.root ? String(source.root).trim() : undefined,
    baseUrl: source.baseUrl ? String(source.baseUrl).trim() : parsed.baseUrl,
    projectId: source.projectId ? String(source.projectId).trim() : parsed.projectId,
    owner: source.owner ? String(source.owner).trim() : parsed.owner,
    repo: source.repo ? String(source.repo).trim() : parsed.repo,
    defaultBranch: String(source.defaultBranch ?? "main").trim(),
    credentials: {
      username: source.username ? String(source.username) : undefined,
      password: source.password ? String(source.password) : undefined,
      token: source.token ? String(source.token) : undefined,
      tokenRef: source.tokenRef ? String(source.tokenRef) : undefined
    }
  };
  if (!repository.credentials?.username && body.username) repository.credentials!.username = String(body.username);
  if (!repository.credentials?.password && body.password) repository.credentials!.password = String(body.password);
  if (!repository.credentials?.token && body.token) repository.credentials!.token = String(body.token);
  if (!repository.credentials?.tokenRef && body.tokenRef) repository.credentials!.tokenRef = String(body.tokenRef);
  return repository;
}

async function validateProjectRepository(repository: ProjectRepositoryRegistration | undefined): Promise<ProjectValidation> {
  const checkedAt = new Date().toISOString();
  if (!repository) return { status: "FAILED", checkedAt, message: "必须提供 repository.provider，并且只能是 local-git、gitlab 或 github" };
  try {
    if (repository.provider === "local-git") {
      if (!repository.root) return { status: "FAILED", checkedAt, message: "local-git 接入必须提供 repository.root" };
      const files = listRepositoryFiles({ repoRoot: repository.root });
      return { status: "VERIFIED", checkedAt, message: "本地 Git 项目验证通过", fileCount: files.length };
    }
    if (repository.provider === "gitlab") {
      if (!repository.baseUrl || !repository.projectId) return { status: "FAILED", checkedAt, message: "GitLab 接入必须提供 gitUrl 或 baseUrl + projectId" };
      const token = resolveCredentialToken(repository);
      if (!token) return { status: "FAILED", checkedAt, message: "GitLab 接入必须提供 token、password 或 tokenRef 对应的环境变量" };
      try {
        const files = await new GitLabHttpAdapter({ baseUrl: repository.baseUrl, projectId: repository.projectId, token }).listFiles(repository.defaultBranch ?? "main");
        return { status: "VERIFIED", checkedAt, message: "GitLab API 项目验证通过", fileCount: files.length };
      } catch (error) {
        const gitValidation = await validateGitRemoteAccess(repository);
        if (gitValidation.status === "VERIFIED") return gitValidation;
        const apiMessage = error instanceof Error ? error.message : String(error);
        return { status: "FAILED", checkedAt, message: `GitLab API 验证失败：${apiMessage}；Git HTTPS 验证失败：${gitValidation.message}` };
      }
    }
    if (repository.provider === "github") {
      if (!repository.owner || !repository.repo) return { status: "FAILED", checkedAt, message: "GitHub 接入必须提供 gitUrl 或 owner + repo" };
      const token = resolveCredentialToken(repository);
      if (!token) return { status: "FAILED", checkedAt, message: "GitHub 接入必须提供 token、password 或 tokenRef 对应的环境变量" };
      const files = await new GitHubHttpAdapter({ apiBaseUrl: repository.baseUrl, owner: repository.owner, repo: repository.repo, token }).listFiles(repository.defaultBranch ?? "main");
      return { status: "VERIFIED", checkedAt, message: "GitHub 项目验证通过", fileCount: files.length };
    }
  } catch (error) {
    return { status: "FAILED", checkedAt, message: error instanceof Error ? error.message : String(error) };
  }
  return { status: "FAILED", checkedAt, message: "不支持的项目接入方式" };
}

function resolveCredentialToken(repository: ProjectRepositoryRegistration): string | undefined {
  if (repository.credentials?.token) return repository.credentials.token;
  if (repository.credentials?.tokenRef) return process.env[repository.credentials.tokenRef];
  if (repository.credentials?.password) return repository.credentials.password;
  return undefined;
}

async function validateGitRemoteAccess(repository: ProjectRepositoryRegistration): Promise<ProjectValidation> {
  const checkedAt = new Date().toISOString();
  if (!repository.gitUrl) return { status: "FAILED", checkedAt, message: "缺少 gitUrl，无法执行 Git HTTPS 验证" };
  const password = repository.credentials?.password ?? resolveCredentialToken(repository);
  const username = repository.credentials?.username ?? (password ? "oauth2" : undefined);
  if (!username || !password) return { status: "FAILED", checkedAt, message: "缺少用户名和密码/token，无法执行 Git HTTPS 验证" };
  const askpass = path.join(os.tmpdir(), `evopilot-git-askpass-${process.pid}-${Date.now()}.sh`);
  fs.writeFileSync(askpass, [
    "#!/bin/sh",
    "case \"$1\" in",
    `*Username*) printf '%s\\n' '${shellSingleQuote(username)}' ;;`,
    `*) printf '%s\\n' '${shellSingleQuote(password)}' ;;`,
    "esac",
    ""
  ].join("\n"), { mode: 0o700 });
  try {
    const branch = repository.defaultBranch ?? "main";
    const result = await runGitLsRemote(repository.gitUrl, branch, askpass);
    if (result.code !== 0) return { status: "FAILED", checkedAt, message: result.stderr };
    const refs = result.stdout.split("\n").filter(Boolean);
    if (refs.length === 0) return { status: "FAILED", checkedAt, message: `Git 仓库可访问，但未找到分支 ${branch}` };
    return { status: "VERIFIED", checkedAt, message: "GitLab Git HTTPS 项目验证通过" };
  } finally {
    fs.rmSync(askpass, { force: true });
  }
}

async function runGitLsRemote(gitUrl: string, branch: string, askpass: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn("git", ["ls-remote", "--heads", gitUrl, branch], {
    env: { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise<number>((resolve) => child.on("close", resolve));
  return { code, stdout, stderr: stderr.trim() || `git ls-remote 退出码 ${code}` };
}

function shellSingleQuote(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function parseGitUrl(gitUrl: string): Partial<ProjectRepositoryRegistration> {
  const normalized = gitUrl.replace(/\.git$/, "");
  const sshMatch = normalized.match(/^git@([^:]+):(.+)\/([^/]+)$/);
  if (sshMatch) return parsedRepositoryFromHost(sshMatch[1], sshMatch[2], sshMatch[3]);
  try {
    const url = new URL(normalized);
    const parts = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length >= 2) return parsedRepositoryFromHost(url.hostname, parts.slice(0, -1).join("/"), parts.at(-1) ?? "");
  } catch {
    return {};
  }
  return {};
}

function parsedRepositoryFromHost(host: string, namespace: string, repo: string): Partial<ProjectRepositoryRegistration> {
  const owner = namespace.split("/")[0] ?? namespace;
  if (host === "github.com" || host.endsWith(".github.com")) {
    return { provider: "github", owner, repo, baseUrl: host === "github.com" ? undefined : `https://${host}` };
  }
  return {
    provider: "gitlab",
    projectId: `${namespace}/${repo}`,
    baseUrl: `https://${host}`
  };
}

async function triggerJenkinsDelivery(args: {
  store: FileStore;
  auth: AuthContext;
  run: StoredRun;
  delivery: DeliveryPlan;
  plan: EvolutionPlan;
  body: any;
  runtime: RuntimeConfig;
}): Promise<PipelineRun> {
  const { store, auth, run, delivery, plan, body, runtime } = args;
  const connectorId = requireBodyString(body.connectorId, "JENKINS_CONNECTOR_ID_REQUIRED", runtime, "default");
  const connector = store.readJenkinsConnector(connectorId);
  if (!connector) throw new Error("JENKINS_CONNECTOR_NOT_CONFIGURED");
  const jobName = String(body.job ?? connector.jobTemplates?.[plan.projectId] ?? connector.jobTemplates?.default ?? "");
  if (!jobName) throw new Error("JENKINS_JOB_REQUIRED");
  const codeUpgrade = store.findSuccessfulCodeUpgrade(delivery.id);
  const parameters = normalizeDeliveryParameters(delivery, plan, body.parameters, codeUpgrade);
  const queued = await new JenkinsClient(connector).triggerBuild({ jobName, parameters });
  const now = new Date().toISOString();
  const pipeline = createPipelineRun({
    id: `pipeline-${delivery.id}-${Date.now()}`,
    projectId: delivery.projectId,
    deliveryPlanId: delivery.id,
    provider: "jenkins",
    connectorId: connector.id,
    jobName,
    queueId: queued.queueId,
    buildUrl: queued.queueUrl,
    parameters,
    now
  });
  store.writePipeline(pipeline);
  run.pipelineRuns = [...(run.pipelineRuns ?? []).filter((item) => item.id !== pipeline.id), pipeline];
  store.writeRun(run);
  store.appendAudit(audit(auth, "jenkins.build.triggered", pipeline.id, { deliveryId: delivery.id, jobName, queueId: queued.queueId }));
  return pipeline;
}

function normalizeDeliveryParameters(delivery: DeliveryPlan, plan: EvolutionPlan, parameters: unknown, codeUpgrade?: CodeUpgradeRun): Record<string, string> {
  return normalizeStringMap({
    PLAN_ID: plan.id,
    DELIVERY_ID: delivery.id,
    PROJECT_ID: delivery.projectId,
    TARGET_ENV: delivery.targetEnvironment,
    SOURCE_BRANCH: codeUpgrade?.branchStrategy.sourceBranch,
    UPGRADE_BRANCH: codeUpgrade?.artifacts.branchName ?? codeUpgrade?.branchStrategy.upgradeBranch,
    COMMIT_SHA: codeUpgrade?.artifacts.commitSha,
    MERGE_REQUEST_URL: codeUpgrade?.artifacts.pullRequestUrl,
    ...(parameters && typeof parameters === "object" ? parameters as Record<string, unknown> : {})
  });
}

function normalizeStringMap(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "").map(([key, item]) => [key, String(item)]));
}

function renderRuleMemoryMarkdown(rule: EvolutionTriggerRule, llmTrace?: Record<string, unknown>): string {
  const compiledRule = {
    ...rule,
    compiledBy: rule.compiledBy ?? "system",
    compiledAt: rule.compiledAt ?? new Date().toISOString()
  };
  return [
    `# ${rule.name}`,
    "",
    `- 规则 ID：${rule.id}`,
    `- 用户规则：${rule.userPrompt ?? rule.name}`,
    `- 状态：${rule.enabled ? "已启用" : "已停用"}`,
    `- 编译方式：${compiledRule.compiledBy === "llm" ? "LLM 编译" : "系统内置"}`,
    "",
    "## 管理员说明",
    "",
    rule.description,
    "",
    "## 执行规则",
    "",
    "下面的 JSON 由系统读取执行。管理员可以打开本文件审查规则，但应通过 EvoPilot 规则编译流程修改，避免手工编辑导致语义和结构不一致。",
    "",
    "```json",
    JSON.stringify(compiledRule, null, 2),
    "```",
    ...(llmTrace ? [
      "",
      "<!-- evopilot-llm-trace",
      JSON.stringify(llmTrace, null, 2),
      "-->"
    ] : []),
    ""
  ].join("\n");
}

function extractMarkdownField(markdown: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^- ${escaped}：(.+)$`, "m"));
  return match?.[1]?.trim();
}

async function readJson(request: http.IncomingMessage, maxBodyBytes: number = 1024 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBodyBytes) throw new Error(`请求体超过 ${maxBodyBytes} 字节`);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function envelope<T>(data: T): { data: T } {
  return { data };
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly detail?: string
  ) {
    super(code);
  }
}

function httpError(statusCode: number, code: string, detail?: string): HttpError {
  return new HttpError(statusCode, code, detail);
}

function writeJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function writeText(response: http.ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

function renderMetrics(summary: any): string {
  return [
    "# TYPE evopilot_projects_total gauge",
    `evopilot_projects_total ${summary.projectCount}`,
    "# TYPE evopilot_runs_total gauge",
    `evopilot_runs_total ${summary.runCount}`,
    "# TYPE evopilot_code_upgrades_total gauge",
    `evopilot_code_upgrades_total ${summary.codeUpgradeCount ?? 0}`,
    "# TYPE evopilot_running_code_upgrades_total gauge",
    `evopilot_running_code_upgrades_total ${summary.runningCodeUpgradeCount ?? 0}`,
    "# TYPE evopilot_opportunities_total gauge",
    `evopilot_opportunities_total ${summary.opportunityCount}`,
    "# TYPE evopilot_pending_reviews_total gauge",
    `evopilot_pending_reviews_total ${summary.pendingReviewCount}`,
    "# TYPE evopilot_release_health gauge",
    `evopilot_release_health ${summary.releaseHealth}`
  ].join("\n");
}

function resolveRuntimeConfig(options: EvoPilotServerOptions): RuntimeConfig {
  const envMode = String(process.env.EVOPILOT_RUN_MODE ?? process.env.EVOPILOT_MODE ?? "").trim().toLowerCase();
  const debugEnabled = parseBoolean(process.env.EVOPILOT_DEBUG, false);
  const mode: EvoPilotRuntimeMode = options.runtimeMode ?? (envMode === "debug" || debugEnabled ? "debug" : "prod");
  const debug = mode === "debug";
  return {
    mode,
    requireLlm: options.requireLlm ?? parseBoolean(process.env.EVOPILOT_REQUIRE_LLM, !debug),
    allowAnonymousAdmin: options.allowAnonymousAdmin ?? parseBoolean(process.env.EVOPILOT_ALLOW_ANONYMOUS_ADMIN, debug),
    allowMockIntegrations: options.allowMockIntegrations ?? parseBoolean(process.env.EVOPILOT_ALLOW_MOCK_INTEGRATIONS, debug),
    allowSampleData: options.allowSampleData ?? parseBoolean(process.env.EVOPILOT_ALLOW_SAMPLE_DATA, debug),
    autoRegisterProfileProject: options.autoRegisterProfileProject ?? parseBoolean(process.env.EVOPILOT_AUTO_REGISTER_PROFILE_PROJECT, debug)
  };
}

function assertProductionRuntimeIsConfigured(runtime: RuntimeConfig, tokens: AuthToken[]): void {
  if (runtime.mode !== "prod") return;
  if (runtime.allowAnonymousAdmin) throw new Error("EVOPILOT_PROD_FORBIDS_ANONYMOUS_ADMIN");
  if (runtime.allowMockIntegrations) throw new Error("EVOPILOT_PROD_FORBIDS_MOCK_INTEGRATIONS");
  if (!runtime.requireLlm) throw new Error("EVOPILOT_PROD_REQUIRES_LLM");
  if (tokens.length === 0) throw new Error("EVOPILOT_PROD_REQUIRES_TOKENS");
}

function requireBodyString(value: unknown, errorCode: string, runtime: RuntimeConfig, debugFallback?: string): string {
  const normalized = value === undefined || value === null ? "" : String(value).trim();
  if (normalized) return normalized;
  if (runtime.mode === "debug" && debugFallback) return debugFallback;
  throw new Error(errorCode);
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function normalizeTokens(options: EvoPilotServerOptions): AuthToken[] {
  if (options.tokens) return options.tokens;
  if (options.apiToken) return [{ name: "admin", token: options.apiToken, role: "admin" }];
  return [];
}

function authorize(request: http.IncomingMessage, tokens: AuthToken[], runtime: RuntimeConfig): AuthContext | undefined {
  if (tokens.length === 0) {
    if (!runtime.allowAnonymousAdmin) return undefined;
    return { actor: String(request.headers["x-evopilot-actor"] ?? "system"), role: "admin" };
  }
  const value = String(request.headers.authorization ?? "");
  const token = value.startsWith("Bearer ") ? value.slice("Bearer ".length) : "";
  const matched = tokens.find((item) => item.token === token);
  if (!matched) return undefined;
  return { actor: String(request.headers["x-evopilot-actor"] ?? matched.name), role: matched.role };
}

function hasRole(context: AuthContext, required: AuthRole): boolean {
  const rank: Record<AuthRole, number> = { viewer: 1, operator: 2, admin: 3 };
  return rank[context.role] >= rank[required];
}

function audit(context: AuthContext, action: string, target: string, metadata?: Record<string, unknown>): AuditRecord {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    actor: context.actor,
    action,
    target,
    timestamp: new Date().toISOString(),
    metadata
  };
}

function getIdempotencyKey(request: http.IncomingMessage): string | undefined {
  const value = request.headers["x-idempotency-key"];
  const key = Array.isArray(value) ? value[0] : value;
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

function atomicWriteJson(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function atomicWriteText(file: string, value: string): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, value, "utf8");
  fs.renameSync(tmp, file);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 160) || "key";
}

function serveDashboard(request: http.IncomingMessage, response: http.ServerResponse, url: URL, dashboardRoot: string | undefined): boolean {
  if (!dashboardRoot || request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname === "/health") return false;
  const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const absolute = path.resolve(dashboardRoot, relative);
  const root = path.resolve(dashboardRoot);
  if (!absolute.startsWith(root) || !fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) return false;
  const ext = path.extname(absolute);
  const contentType = ext === ".html" ? "text/html; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : ext === ".js" ? "text/javascript; charset=utf-8" : "application/octet-stream";
  response.writeHead(200, { "content-type": contentType });
  response.end(fs.readFileSync(absolute));
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  loadEnvFile(process.env.EVOPILOT_ENV_FILE ?? path.resolve("data/evopilot/evopilot.env"));
  const dataRoot = process.env.EVOPILOT_DATA_ROOT ?? path.resolve("data/evopilot");
  loadEnvFile(process.env.EVOPILOT_LLM_ENV_FILE ?? path.join(dataRoot, "llm.env"));
  const port = Number(process.env.EVOPILOT_PORT ?? "19876");
  const host = process.env.EVOPILOT_HOST ?? "127.0.0.1";
  const dashboardRoot = process.env.EVOPILOT_DASHBOARD_ROOT ?? path.resolve("apps/dashboard");
  const tokens = parseEnvTokens(process.env.EVOPILOT_TOKENS);
  const apiToken = process.env.EVOPILOT_API_TOKEN;
  const server = createServer({ dataRoot, dashboardRoot, apiToken, tokens }).listen(port, host, () => {
    const runtimeMode = process.env.EVOPILOT_RUN_MODE ?? process.env.EVOPILOT_MODE ?? (parseBoolean(process.env.EVOPILOT_DEBUG, false) ? "debug" : "prod");
    console.log(`EvoPilot 服务已监听 http://${host}:${port}，运行模式：${runtimeMode}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    const value = raw.replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseEnvTokens(value: string | undefined): AuthToken[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((item) => {
    const [name, token, role] = item.split(":");
    if (!name || !token || (role !== "viewer" && role !== "operator" && role !== "admin")) {
      throw new Error("EVOPILOT_TOKENS 条目必须使用 name:token:role 格式");
    }
    return { name, token, role };
  });
}
