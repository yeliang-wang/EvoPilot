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
  cicd?: ProjectCicdConfiguration;
  runtime?: ProjectRuntimeConfiguration;
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

interface ProjectCicdConfiguration {
  provider: "jenkins";
  mode: "system-default" | "project-override";
  connectorId?: string;
  job?: string;
  parameters?: Record<string, string>;
}

interface ProjectRuntimeConfiguration {
  language: "python" | "node" | "java" | "go" | "generic";
  installCommands?: string[];
  unitCommands?: string[];
  service?: {
    enabled: boolean;
    startCommand: string;
    host?: string;
    port?: number;
    healthPath?: string;
    readyTimeoutSeconds?: number;
  };
  smokeCommands?: string[];
  functionalCommands?: string[];
}

interface ProjectRuntimeDiagnostic {
  projectId: string;
  status: "PASSED" | "WARN" | "FAILED";
  checks: Array<{
    name: string;
    status: "PASSED" | "WARN" | "FAILED";
    detail: string;
    remediation?: string;
  }>;
  recommendedAction: string;
  checkedAt: string;
}

interface ProjectCodeContext {
  status: "AVAILABLE" | "UNAVAILABLE";
  source: "local-git" | "git-clone" | "none";
  projectId: string;
  branch?: string;
  commitSha?: string;
  fileCount: number;
  selectedFiles: Array<{
    path: string;
    content: string;
    truncated: boolean;
  }>;
  summary: string;
  unavailableReason?: string;
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
  failureReason?: string;
  error?: string;
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
  generatedBy?: "manual" | "self-learning";
  evidenceEventIds?: string[];
  opportunityIds?: string[];
  confidence?: number;
  learningSignal?: string;
}

type EvolutionBatchStatus =
  | "CANDIDATE"
  | "DRAFT_READY"
  | "CONFIRMED"
  | "CODE_UPGRADING"
  | "CICD_RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "SKIPPED";

interface EvolutionBatch {
  id: string;
  projectId: string;
  status: EvolutionBatchStatus;
  triggerReason: string;
  datasetIds: string[];
  opportunityIds: string[];
  ruleIds: string[];
  confidence: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  priorityScore: number;
  evidenceWindow: {
    from: string;
    to: string;
  };
  watermarks: {
    datasetTriggeredAt: string;
    opportunityRunId?: string;
  };
  draftId?: string;
  reviewId?: string;
  deliveryPlanId?: string;
  codeUpgradeRunId?: string;
  pipelineRunId?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

interface EvolutionFreezeDiagnostic {
  projectId: string;
  reason: string;
  costReport?: CostReport;
}

interface ProjectEvolutionCursor {
  projectId: string;
  lastProcessedDatasetTriggeredAt?: string;
  lastProcessedDatasetIds: string[];
  lastSuccessfulEvolutionAt?: string;
  lastFailedEvolutionAt?: string;
  cooldownUntil?: string;
  activeBatchId?: string;
  updatedAt: string;
}

interface OpportunityInsight {
  id: string;
  projectId: string;
  title: string;
  category: string;
  score: number;
  confidence: number;
  source: "self-learning";
  evidenceCount: number;
  datasetIds: string[];
  opportunityIds: string[];
  rationale: string[];
  recommendedAction: string;
  generatedAt: string;
}

interface ServiceScorecard {
  projectId: string;
  projectName: string;
  score: number;
  level: "优秀" | "良好" | "待改进" | "高风险";
  evidenceCoverage: number;
  governanceCoverage: number;
  deliveryCoverage: number;
  learningCoverage: number;
  checks: Array<{
    name: string;
    status: "PASSED" | "WARN" | "FAILED";
    detail: string;
  }>;
  recommendedAction: string;
  updatedAt: string;
}

interface SloReport {
  projectId: string;
  targetAvailability: number;
  observedHealth: number;
  errorBudgetRemaining: number;
  latencyViolationCount: number;
  failedReleaseCount: number;
  status: "HEALTHY" | "BURNING" | "EXHAUSTED";
  recommendedAction: string;
  updatedAt: string;
}

interface GovernancePolicyEvaluation {
  id: string;
  name: string;
  status: "PASSED" | "WARN" | "FAILED";
  severity: "LOW" | "MEDIUM" | "HIGH";
  scope: string;
  rationale: string;
  recommendedAction: string;
  evaluatedAt: string;
}

interface SupplyChainReport {
  id: string;
  name: string;
  implementation?: string;
  role?: string;
  version?: string;
  image?: string;
  digest?: string;
  runtimeImage?: string;
  runtimeDigest?: string;
  required: boolean;
  sourceUrl: string;
  path: string;
  buildCommand?: string;
  packageArtifacts: string[];
  missingArtifacts: string[];
  status: "READY" | "MISSING" | "INCOMPLETE";
  riskLevel: "LOW" | "HIGH";
  rationale: string;
  recommendedAction: string;
  evaluatedAt: string;
}

interface CostReport {
  projectId: string;
  totalCost: number;
  totalTokens: number;
  highCostEventCount: number;
  status: "HEALTHY" | "WATCH" | "OVER_BUDGET";
  recommendedAction: string;
  updatedAt: string;
}

interface ReleaseReadinessReport {
  projectId: string;
  status: "READY" | "NEEDS_APPROVAL" | "BLOCKED";
  score: number;
  recommendedAction: string;
  gates: Array<{
    name: string;
    status: "PASSED" | "WARN" | "FAILED";
    detail: string;
  }>;
  evaluatedAt: string;
}

interface RolloutStrategyReport {
  projectId: string;
  strategy: "CANARY" | "MANUAL_APPROVAL" | "BLOCKED";
  status: "READY" | "NEEDS_APPROVAL" | "BLOCKED";
  canaryPercent: number;
  rollbackReady: boolean;
  recommendedAction: string;
  gates: Array<{
    name: string;
    status: "PASSED" | "WARN" | "FAILED";
    detail: string;
  }>;
  evaluatedAt: string;
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
      if (request.method === "GET" && url.pathname === "/api/v1/service-scorecards") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.computeServiceScorecards()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/slo-reports") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.computeSloReports()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/governance/policy-evaluations") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.evaluateGovernancePolicies()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/supply-chain/reports") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.computeSupplyChainReports()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/runtimes") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.computeSupplyChainReports()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/cost/reports") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.computeCostReports()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/release/readiness") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.computeReleaseReadinessReports()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/rollout/strategies") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.computeRolloutStrategyReports()));
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
      if (request.method === "POST" && url.pathname === "/api/v1/evaluation-datasets/autogenerate") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const datasets = store.autogenerateEvaluationDatasets();
        store.appendAudit(audit(auth, "evaluation-datasets.autogenerated", datasets.map((dataset) => dataset.id).join(","), { count: datasets.length }));
        return writeJson(response, 201, envelope(datasets));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/opportunity-insights") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.discoverOpportunityInsights()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/evolution-batches") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listEvolutionBatches().slice(-50).reverse()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/evolution-batches/scan") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const result = store.scanEvolutionBatches({
          projectId: body.projectId ? String(body.projectId) : undefined,
          maxBatchesPerProject: body.maxBatchesPerProject === undefined ? 1 : Number(body.maxBatchesPerProject),
          maxDatasetsPerBatch: body.maxDatasetsPerBatch === undefined ? 4 : Number(body.maxDatasetsPerBatch),
          minDatasetCount: body.minDatasetCount === undefined ? 1 : Number(body.minDatasetCount),
          cooldownMinutes: body.cooldownMinutes === undefined ? 30 : Number(body.cooldownMinutes),
          dryRun: Boolean(body.dryRun)
        });
        for (const batch of result.created) {
          store.appendAudit(audit(auth, "evolution-batch.created", batch.id, { projectId: batch.projectId, datasetIds: batch.datasetIds, opportunityIds: batch.opportunityIds }));
        }
        return writeJson(response, result.created.length > 0 ? 201 : 200, envelope(result));
      }
      const batchMatch = url.pathname.match(/^\/api\/v1\/evolution-batches\/([^/]+)$/);
      if (request.method === "GET" && batchMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const batch = store.readEvolutionBatch(decodeURIComponent(batchMatch[1]));
        if (!batch) return writeJson(response, 404, { error: "EVOLUTION_BATCH_NOT_FOUND" });
        return writeJson(response, 200, envelope(batch));
      }
      const batchStatusMatch = url.pathname.match(/^\/api\/v1\/evolution-batches\/([^/]+)\/status$/);
      if (request.method === "POST" && batchStatusMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const batchId = decodeURIComponent(batchStatusMatch[1]);
        const body = await readJson(request, options.maxBodyBytes);
        const updated = store.updateEvolutionBatch(batchId, {
          status: normalizeEvolutionBatchStatus(body.status),
          draftId: body.draftId ? String(body.draftId) : undefined,
          reviewId: body.reviewId ? String(body.reviewId) : undefined,
          deliveryPlanId: body.deliveryPlanId ? String(body.deliveryPlanId) : undefined,
          codeUpgradeRunId: body.codeUpgradeRunId ? String(body.codeUpgradeRunId) : undefined,
          pipelineRunId: body.pipelineRunId ? String(body.pipelineRunId) : undefined,
          failureReason: body.failureReason ? String(body.failureReason) : undefined
        });
        if (!updated) return writeJson(response, 404, { error: "EVOLUTION_BATCH_NOT_FOUND" });
        store.appendAudit(audit(auth, "evolution-batch.status-updated", updated.id, { projectId: updated.projectId, status: updated.status }));
        return writeJson(response, 200, envelope(updated));
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
        const project = store.readProject(projectId);
        const codeContext = await collectProjectCodeContext({ project, runtime, profile });
        if (runtime.mode === "prod" && codeContext.status !== "AVAILABLE") {
          return writeJson(response, 409, { error: "PROJECT_CODE_CONTEXT_NOT_AVAILABLE", detail: codeContext.unavailableReason });
        }
        const now = new Date().toISOString();
        const llmDraft = await renderOpportunityDraftMarkdown({ title, target, datasets, project, codeContext, llmClient, requireLlm });
        const draft = {
          id: `draft-${Date.now()}`,
          projectId,
          title,
          target,
          datasetIds,
          sampleCount: datasets.reduce((sum, dataset) => sum + dataset.sampleCount, 0),
          triggerSource: "评测集组装 / Trace + RAG + Cost",
          createdAt: now,
          codeContext: maskProjectCodeContext(codeContext),
          proposalMarkdown: llmDraft.markdown,
          llmTrace: llmDraft.trace
        };
        store.appendAudit(audit(auth, "opportunity-draft.created", draft.id, { projectId, datasetIds, codeContextStatus: codeContext.status, codeContextFiles: codeContext.fileCount }));
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
          defaultModel: body.defaultModel ? String(body.defaultModel) : process.env.EVOPILOT_CODE_UPGRADER_MODEL ?? process.env.EVOPILOT_LLM_MODEL_NAME,
          llmModel: body.llmModel ? String(body.llmModel) : process.env.EVOPILOT_CODE_UPGRADER_LLM_MODEL ?? process.env.EVOPILOT_CODE_UPGRADER_MODEL ?? process.env.EVOPILOT_LLM_MODEL_NAME,
          llmBaseUrl: body.llmBaseUrl ? String(body.llmBaseUrl) : process.env.EVOPILOT_CODE_UPGRADER_LLM_BASE_URL ?? process.env.EVOPILOT_LLM_BASE_URL,
          llmApiKey: body.llmApiKey ? String(body.llmApiKey) : process.env.EVOPILOT_CODE_UPGRADER_LLM_API_KEY ?? process.env.EVOPILOT_LLM_API_KEY,
          maxIterations: body.maxIterations ? Number(body.maxIterations) : Number(process.env.EVOPILOT_CODE_UPGRADER_MAX_ITERATIONS ?? 80),
          condenserMaxSize: body.condenserMaxSize ? Number(body.condenserMaxSize) : Number(process.env.EVOPILOT_CODE_UPGRADER_CONDENSER_MAX_SIZE ?? 12000),
          gitUserName: body.gitUserName ? String(body.gitUserName) : process.env.EVOPILOT_CODE_UPGRADER_GIT_USER_NAME ?? "EvoPilot",
          gitUserEmail: body.gitUserEmail ? String(body.gitUserEmail) : process.env.EVOPILOT_CODE_UPGRADER_GIT_USER_EMAIL ?? "evopilot@local",
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
      const projectDiagnosticsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/diagnostics$/);
      if (request.method === "GET" && projectDiagnosticsMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const project = store.readProject(decodeURIComponent(projectDiagnosticsMatch[1]));
        if (!project) return writeJson(response, 404, { error: "PROJECT_NOT_FOUND" });
        return writeJson(response, 200, envelope(await diagnoseProjectRuntime({ store, project, runtime })));
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
        const projectId = String(body.id ?? "").trim();
        const repository = normalizeProjectRepository(body);
        const validation = await validateProjectRepository(repository);
        const cicd = normalizeProjectCicd(body, projectId);
        const projectRuntime = normalizeProjectRuntime(body);
        const project: StoredProject = {
          id: projectId,
          name: String(body.name ?? body.id ?? "").trim(),
          profileId: String(body.profileId ?? profile.id),
          repository,
          cicd: cicd.projectCicd,
          runtime: projectRuntime,
          validation,
          createdAt: now,
          updatedAt: now
        };
        if (!project.id || !project.name) return writeJson(response, 400, { error: "PROJECT_ID_AND_NAME_REQUIRED" });
        if (project.validation.status !== "VERIFIED") return writeJson(response, 400, { error: "PROJECT_VALIDATION_FAILED", detail: project.validation.message });
        if (cicd.connector) store.writeJenkinsConnector(cicd.connector);
        store.writeProject(project);
        store.appendAudit(audit(auth, "project.created", project.id, { provider: repository?.provider, validation: validation.status, cicdMode: project.cicd?.mode }));
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
        const freeze = store.projectEvolutionFreezeDiagnostic(delivery.projectId);
        if (freeze) {
          store.appendAudit(audit(auth, "delivery.blocked-by-cost-freeze", deliveryId, { projectId: delivery.projectId, reason: freeze.reason }));
          return writeJson(response, 409, { error: "EVOLUTION_COST_BUDGET_FROZEN", detail: freeze.reason, costReport: freeze.costReport });
        }
        if (delivery.approvalRequired && review?.status !== "USER_CONFIRMED") {
          return writeJson(response, 409, { error: "USER_CONFIRMATION_REQUIRED" });
        }
        const body = await readJson(request, options.maxBodyBytes);
        if (body.executor === "jenkins") {
          const codeUpgrade = store.findSuccessfulCodeUpgrade(delivery.id);
          if (!codeUpgrade) return writeJson(response, 409, { error: "CODE_UPGRADE_REQUIRED" });
          const pipeline = await triggerJenkinsDelivery({ store, auth, run, delivery, plan, body, runtime });
          if (body.batchId) {
            store.updateEvolutionBatch(String(body.batchId), {
              status: "CICD_RUNNING",
              deliveryPlanId: delivery.id,
              pipelineRunId: pipeline.id
            });
          }
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
        const freeze = store.projectEvolutionFreezeDiagnostic(delivery.projectId);
        if (freeze) {
          store.appendAudit(audit(auth, "code-upgrade.blocked-by-cost-freeze", deliveryId, { projectId: delivery.projectId, reason: freeze.reason }));
          return writeJson(response, 409, { error: "EVOLUTION_COST_BUDGET_FROZEN", detail: freeze.reason, costReport: freeze.costReport });
        }
        if (delivery.approvalRequired && review?.status !== "USER_CONFIRMED") {
          return writeJson(response, 409, { error: "USER_CONFIRMATION_REQUIRED" });
        }
        const body = await readJson(request, options.maxBodyBytes);
        const codeUpgrade = await startOpenHandsCodeUpgrade({ store, auth, run, delivery, plan, review, body, profile, runtime });
        if (body.batchId) {
          store.updateEvolutionBatch(String(body.batchId), {
            status: "CODE_UPGRADING",
            reviewId: review?.id,
            deliveryPlanId: delivery.id,
            codeUpgradeRunId: codeUpgrade.id
          });
        }
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
        const freeze = store.projectEvolutionFreezeDiagnostic(delivery.projectId);
        if (freeze) {
          store.appendAudit(audit(auth, "delivery.schedule.blocked-by-cost-freeze", deliveryId, { projectId: delivery.projectId, reason: freeze.reason }));
          return writeJson(response, 409, { error: "EVOLUTION_COST_BUDGET_FROZEN", detail: freeze.reason, costReport: freeze.costReport });
        }
        if (delivery.approvalRequired && review?.status !== "USER_CONFIRMED") {
          return writeJson(response, 409, { error: "USER_CONFIRMATION_REQUIRED" });
        }
        const body = await readJson(request, options.maxBodyBytes);
        const resolved = resolveJenkinsDeliveryTarget({ store, plan, body, runtime });
        if (resolved.error) return writeJson(response, resolved.statusCode, resolved.error);
        const connectorId = resolved.connectorId!;
        const jobName = resolved.jobName!;
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
    fs.mkdirSync(this.evolutionBatchesDir, { recursive: true });
    fs.mkdirSync(this.evolutionCursorsDir, { recursive: true });
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

  get evolutionBatchesDir(): string {
    return path.join(this.dataRoot, "evolution-batches");
  }

  get evolutionCursorsDir(): string {
    return path.join(this.dataRoot, "evolution-cursors");
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
    const datasets = this.listEvaluationDatasets();
    const batches = this.listEvolutionBatches();
    const insights = this.discoverOpportunityInsights();
    const learnedReleases = runs.flatMap((run) => run.learningRecords);
    const scorecards = this.computeServiceScorecards();
    const sloReports = this.computeSloReports();
    const policyEvaluations = this.evaluateGovernancePolicies();
    const supplyChainReports = this.computeSupplyChainReports();
    const costReports = this.computeCostReports();
    const releaseReadiness = this.computeReleaseReadinessReports();
    const rolloutStrategies = this.computeRolloutStrategyReports();
    return {
      projectCount: this.listProjects().length,
      runCount: runs.length,
      pipelineCount: pipelines.length,
      evaluationDatasetCount: datasets.length,
      evolutionBatchCount: batches.length,
      activeEvolutionBatchCount: batches.filter((batch) => ["CANDIDATE", "DRAFT_READY", "CONFIRMED", "CODE_UPGRADING", "CICD_RUNNING"].includes(batch.status)).length,
      successfulEvolutionBatchCount: batches.filter((batch) => batch.status === "SUCCEEDED").length,
      failedEvolutionBatchCount: batches.filter((batch) => batch.status === "FAILED").length,
      selfLearningDatasetCount: datasets.filter((dataset) => dataset.generatedBy === "self-learning").length,
      opportunityInsightCount: insights.length,
      opportunityInsightQuality: insights.length === 0 ? 0 : Math.round(insights.reduce((sum, insight) => sum + insight.score, 0) / insights.length),
      learningRecordCount: learnedReleases.length,
      serviceScorecardCount: scorecards.length,
      averageServiceScore: scorecards.length === 0 ? 0 : Math.round(scorecards.reduce((sum, scorecard) => sum + scorecard.score, 0) / scorecards.length),
      sloHealth: sloReports.length === 0 ? 100 : Math.round(sloReports.reduce((sum, report) => sum + report.observedHealth, 0) / sloReports.length),
      errorBudgetRemaining: sloReports.length === 0 ? 100 : Math.round(sloReports.reduce((sum, report) => sum + report.errorBudgetRemaining, 0) / sloReports.length),
      failedPolicyCount: policyEvaluations.filter((policy) => policy.status === "FAILED").length,
      supplyChainRiskCount: supplyChainReports.filter((report) => report.status !== "READY").length,
      costRiskCount: costReports.filter((report) => report.status !== "HEALTHY").length,
      costHealth: costReports.length === 0 ? 100 : Math.round(costReports.reduce((sum, report) => sum + costHealthScore(report.status), 0) / costReports.length),
      releaseReadyCount: releaseReadiness.filter((report) => report.status === "READY").length,
      releaseBlockedCount: releaseReadiness.filter((report) => report.status === "BLOCKED").length,
      releaseReadinessScore: releaseReadiness.length === 0 ? 100 : Math.round(releaseReadiness.reduce((sum, report) => sum + report.score, 0) / releaseReadiness.length),
      canaryReadyCount: rolloutStrategies.filter((report) => report.strategy === "CANARY" && report.status === "READY").length,
      rolloutBlockedCount: rolloutStrategies.filter((report) => report.status === "BLOCKED").length,
      codeUpgradeCount: codeUpgrades.length,
      runningCodeUpgradeCount: codeUpgrades.filter((item) => item.status === "QUEUED" || item.status === "RUNNING").length,
      runningPipelineCount: pipelines.filter((pipeline) => pipeline.status === "QUEUED" || pipeline.status === "RUNNING").length,
      opportunityCount: runs.reduce((sum, run) => sum + run.opportunities.length, 0),
      pendingReviewCount: reviews.filter((review) => review.status === "USER_CONFIRM_REQUIRED").length,
      confirmedReviewCount: reviews.filter((review) => review.status === "USER_CONFIRMED").length,
      releaseCount: releases.length,
      releaseHealth: releases.length === 0 ? 100 : Math.round((releases.filter((release) => release.status === "SUCCEEDED").length / releases.length) * 100),
      recentRuns: runs.slice(-5).reverse(),
      recentOpportunityInsights: insights.slice(0, 5),
      serviceScorecards: scorecards,
      sloReports,
      policyEvaluations,
      supplyChainReports,
      costReports,
      releaseReadiness,
      rolloutStrategies,
      recentCodeUpgrades: codeUpgrades.slice(-5).reverse(),
      recentPipelines: pipelines.slice(-5).reverse(),
      recentEvolutionBatches: batches.slice(-5).reverse()
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

  autogenerateEvaluationDatasets(): EvaluationDataset[] {
    const datasets = this.listRuns().flatMap((run) => evaluationDatasetsFromRun(run));
    this.writeEvaluationDatasets(datasets);
    return datasets;
  }

  discoverOpportunityInsights(): OpportunityInsight[] {
    const datasets = this.listEvaluationDatasets();
    const runs = this.listRuns();
    const insights = new Map<string, OpportunityInsight>();
    for (const run of runs) {
      for (const opportunity of run.opportunities) {
        const relatedDatasets = datasets.filter((dataset) =>
          dataset.projectId === opportunity.projectId &&
          ((dataset.opportunityIds ?? []).includes(opportunity.id) || dataset.scope.includes(opportunity.affectedArea) || dataset.learningSignal === opportunity.failureAttribution)
        );
        const score = opportunityInsightScore(opportunity, relatedDatasets, run);
        const key = `${opportunity.projectId}:${opportunity.type}:${opportunity.affectedArea}`;
        const existing = insights.get(key);
        const insight: OpportunityInsight = {
          id: `insight-${safeFileName(key)}`,
          projectId: opportunity.projectId,
          title: opportunity.title,
          category: opportunity.failureAttribution ?? opportunity.type,
          score,
          confidence: opportunity.confidence,
          source: "self-learning",
          evidenceCount: opportunity.evidenceEventIds.length,
          datasetIds: relatedDatasets.map((dataset) => dataset.id),
          opportunityIds: [opportunity.id],
          rationale: [
            opportunity.evidenceSummary ?? "由运行证据自动发现。",
            `机会置信度 ${Math.round(opportunity.confidence * 100)}%。`,
            relatedDatasets.length > 0 ? `已沉淀 ${relatedDatasets.length} 个评测集。` : "尚未沉淀评测集，建议自动生成。",
            run.learningRecords.length > 0 ? `已有 ${run.learningRecords.length} 条发布后学习记录。` : "尚无发布后学习记录。"
          ],
          recommendedAction: relatedDatasets.length > 0 ? "基于关联评测集生成进化方案，并进入人工确认。" : "先自动沉淀 Eval Dataset，再形成机会点方案。",
          generatedAt: new Date().toISOString()
        };
        if (existing) {
          existing.score = Math.max(existing.score, insight.score);
          existing.confidence = Math.max(existing.confidence, insight.confidence);
          existing.evidenceCount += insight.evidenceCount;
          existing.datasetIds = [...new Set([...existing.datasetIds, ...insight.datasetIds])];
          existing.opportunityIds = [...new Set([...existing.opportunityIds, ...insight.opportunityIds])];
          existing.rationale = [...new Set([...existing.rationale, ...insight.rationale])].slice(0, 6);
        } else {
          insights.set(key, insight);
        }
      }
    }
    return [...insights.values()].sort((left, right) => right.score - left.score);
  }

  computeServiceScorecards(): ServiceScorecard[] {
    const projects = this.listProjects();
    const runs = this.listRuns();
    const datasets = this.listEvaluationDatasets();
    const pipelines = this.listPipelines();
    const codeUpgrades = this.listCodeUpgradeRuns();
    const now = new Date().toISOString();
    return projects.map((project) => {
      const projectRuns = runs.filter((run) => run.evidenceBundle.projectId === project.id);
      const projectDatasets = datasets.filter((dataset) => dataset.projectId === project.id);
      const projectPipelines = pipelines.filter((pipeline) => pipeline.projectId === project.id);
      const projectUpgrades = codeUpgrades.filter((upgrade) => upgrade.projectId === project.id);
      const learningRecords = projectRuns.flatMap((run) => run.learningRecords);
      const evidenceCoverage = projectRuns.length > 0 ? 100 : 0;
      const governanceCoverage = projectRuns.some((run) => run.reviews.length > 0 && run.deliveryPlans.length > 0) ? 100 : projectRuns.length > 0 ? 55 : 0;
      const deliveryCoverage = projectPipelines.length > 0 || projectUpgrades.length > 0 ? 100 : projectRuns.length > 0 ? 45 : 0;
      const learningCoverage = learningRecords.length > 0 ? 100 : projectDatasets.some((dataset) => dataset.generatedBy === "self-learning") ? 60 : 0;
      const validationScore = project.validation.status === "VERIFIED" ? 100 : 0;
      const score = Math.round(validationScore * 0.2 + evidenceCoverage * 0.25 + governanceCoverage * 0.2 + deliveryCoverage * 0.2 + learningCoverage * 0.15);
      const checks: ServiceScorecard["checks"] = [
        { name: "项目注册验证", status: project.validation.status === "VERIFIED" ? "PASSED" : "FAILED", detail: project.validation.message },
        { name: "证据覆盖", status: evidenceCoverage >= 100 ? "PASSED" : "WARN", detail: projectRuns.length > 0 ? `已有 ${projectRuns.length} 次证据运行` : "尚未接入运行证据" },
        { name: "治理闭环", status: governanceCoverage >= 100 ? "PASSED" : governanceCoverage > 0 ? "WARN" : "FAILED", detail: governanceCoverage >= 100 ? "已生成评审和交付计划" : "缺少评审或交付计划" },
        { name: "交付闭环", status: deliveryCoverage >= 100 ? "PASSED" : deliveryCoverage > 0 ? "WARN" : "FAILED", detail: deliveryCoverage >= 100 ? "已有代码升级或流水线记录" : "尚无交付执行记录" },
        { name: "自学习闭环", status: learningCoverage >= 100 ? "PASSED" : learningCoverage > 0 ? "WARN" : "FAILED", detail: learningRecords.length > 0 ? `已有 ${learningRecords.length} 条发布后学习` : projectDatasets.length > 0 ? "已有自学习评测集，尚无发布后学习" : "尚未形成学习资产" }
      ];
      return {
        projectId: project.id,
        projectName: project.name,
        score,
        level: serviceScoreLevel(score),
        evidenceCoverage,
        governanceCoverage,
        deliveryCoverage,
        learningCoverage,
        checks,
        recommendedAction: serviceScoreRecommendedAction(score, checks),
        updatedAt: now
      };
    }).sort((left, right) => right.score - left.score);
  }

  computeSloReports(): SloReport[] {
    const projects = this.listProjects();
    const runs = this.listRuns();
    const now = new Date().toISOString();
    return projects.map((project) => {
      const projectRuns = runs.filter((run) => run.evidenceBundle.projectId === project.id);
      const releases = projectRuns.flatMap((run) => run.releaseReports);
      const failedReleaseCount = releases.filter((release) => release.status === "FAILED" || release.status === "ROLLED_BACK").length;
      const latencyViolationCount = projectRuns.flatMap((run) => run.evidenceBundle.events).filter((event) =>
        Number(event.attributes?.durationMs ?? event.attributes?.latencyMs ?? event.attributes?.p95LatencyMs ?? 0) > 3000
      ).length;
      const totalSignals = Math.max(1, projectRuns.reduce((sum, run) => sum + run.evidenceBundle.events.length, 0) + releases.length);
      const violationRate = (latencyViolationCount + failedReleaseCount * 2) / totalSignals;
      const observedHealth = Math.max(0, Math.round((1 - Math.min(1, violationRate)) * 100));
      const targetAvailability = 99;
      const errorBudgetRemaining = Math.max(0, Math.round(100 - violationRate * 100));
      const status: SloReport["status"] = errorBudgetRemaining <= 0 ? "EXHAUSTED" : errorBudgetRemaining < 50 ? "BURNING" : "HEALTHY";
      return {
        projectId: project.id,
        targetAvailability,
        observedHealth,
        errorBudgetRemaining,
        latencyViolationCount,
        failedReleaseCount,
        status,
        recommendedAction: status === "HEALTHY" ? "保持当前发布节奏。" : status === "BURNING" ? "暂停自动进化，优先处理高分机会点。" : "冻结发布并触发人工评审。",
        updatedAt: now
      };
    });
  }

  evaluateGovernancePolicies(): GovernancePolicyEvaluation[] {
    const now = new Date().toISOString();
    const scorecards = this.computeServiceScorecards();
    const sloReports = this.computeSloReports();
    const thirdPartyReports = this.computeSupplyChainReports();
    const costReports = this.computeCostReports();
    const evaluations: GovernancePolicyEvaluation[] = [];
    for (const scorecard of scorecards) {
      evaluations.push({
        id: `policy-scorecard-${safeFileName(scorecard.projectId)}`,
        name: "项目成熟度门禁",
        status: scorecard.score >= 75 ? "PASSED" : scorecard.score >= 55 ? "WARN" : "FAILED",
        severity: scorecard.score >= 75 ? "LOW" : scorecard.score >= 55 ? "MEDIUM" : "HIGH",
        scope: scorecard.projectId,
        rationale: `当前成熟度 ${scorecard.score}，等级 ${scorecard.level}。`,
        recommendedAction: scorecard.recommendedAction,
        evaluatedAt: now
      });
    }
    for (const report of sloReports) {
      evaluations.push({
        id: `policy-slo-${safeFileName(report.projectId)}`,
        name: "SLO 错误预算门禁",
        status: report.status === "HEALTHY" ? "PASSED" : report.status === "BURNING" ? "WARN" : "FAILED",
        severity: report.status === "HEALTHY" ? "LOW" : report.status === "BURNING" ? "MEDIUM" : "HIGH",
        scope: report.projectId,
        rationale: `错误预算剩余 ${report.errorBudgetRemaining}%，延迟违规 ${report.latencyViolationCount} 次，失败发布 ${report.failedReleaseCount} 次。`,
        recommendedAction: report.recommendedAction,
        evaluatedAt: now
      });
    }
    for (const report of costReports) {
      evaluations.push({
        id: `policy-cost-${safeFileName(report.projectId)}`,
        name: "成本预算门禁",
        status: report.status === "HEALTHY" ? "PASSED" : report.status === "WATCH" ? "WARN" : "FAILED",
        severity: report.status === "HEALTHY" ? "LOW" : report.status === "WATCH" ? "MEDIUM" : "HIGH",
        scope: report.projectId,
        rationale: `累计成本 ${report.totalCost.toFixed(4)}，Token ${report.totalTokens}，高成本事件 ${report.highCostEventCount} 次。`,
        recommendedAction: report.recommendedAction,
        evaluatedAt: now
      });
    }
    const missingThirdParty = thirdPartyReports.filter((report) => report.required && report.status !== "READY").length;
    evaluations.push({
      id: "policy-runtime-supply-chain",
      name: "运行时供应链门禁",
      status: missingThirdParty === 0 ? "PASSED" : "FAILED",
      severity: missingThirdParty === 0 ? "LOW" : "HIGH",
      scope: "platform",
      rationale: missingThirdParty === 0 ? "必需运行时版本、镜像、Digest、SBOM、许可证和漏洞报告已锁定。" : `有 ${missingThirdParty} 个必需运行时未满足生产供应链锁定。`,
      recommendedAction: missingThirdParty === 0 ? "保持运行时锁定并纳入发布门禁。" : "补齐 runtime-lock 中的 Digest、SBOM、许可证报告和漏洞扫描报告后再执行生产发布。",
      evaluatedAt: now
    });
    return evaluations.sort((left, right) => policySeverityRank(right.severity) - policySeverityRank(left.severity));
  }

  computeSupplyChainReports(): SupplyChainReport[] {
    return readRuntimeLock().map((item) => {
      const packageArtifacts = [item.sbom, item.licenseReport, item.vulnerabilityReport].filter(Boolean).map(String);
      const missingArtifacts = packageArtifacts.filter((artifact: string) => !fs.existsSync(path.resolve(artifact)));
      const digestReady = /^sha256:[a-f0-9]{64}$/i.test(String(item.digest ?? ""));
      const runtimeDigestReady = item.runtimeImage ? /^sha256:[a-f0-9]{64}$/i.test(String(item.runtimeDigest ?? "")) : true;
      const vulnerabilityReady = item.vulnerabilityReport ? vulnerabilityReportPassed(String(item.vulnerabilityReport)) : false;
      const healthEndpointReady = /^https?:\/\/.+/i.test(String(item.healthEndpoint ?? ""));
      const finalStatus: SupplyChainReport["status"] = digestReady && runtimeDigestReady && missingArtifacts.length === 0 && vulnerabilityReady && healthEndpointReady ? "READY" : "INCOMPLETE";
      return {
        id: String(item.id ?? safeFileName(String(item.name ?? "third-party"))),
        name: String(item.name ?? item.id ?? "第三方组件"),
        implementation: item.implementation ? String(item.implementation) : undefined,
        role: item.role ? String(item.role) : undefined,
        version: item.version ? String(item.version) : undefined,
        image: item.image ? String(item.image) : undefined,
        digest: item.digest ? String(item.digest) : undefined,
        runtimeImage: item.runtimeImage ? String(item.runtimeImage) : undefined,
        runtimeDigest: item.runtimeDigest ? String(item.runtimeDigest) : undefined,
        required: Boolean(item.required),
        sourceUrl: String(item.sourceUrl ?? item.image ?? ""),
        path: String(item.healthEndpoint ?? ""),
        buildCommand: undefined,
        packageArtifacts,
        missingArtifacts,
        status: finalStatus,
        riskLevel: finalStatus === "READY" ? "LOW" : "HIGH",
        rationale: finalStatus === "READY" ? "运行时版本、镜像、Digest、SBOM、许可证、漏洞报告和健康端点已满足生产锁定。" : String(item.blocker ?? "运行时供应链锁定不完整。"),
        recommendedAction: finalStatus === "READY" ? "纳入常规发布门禁。" : `补齐 ${item.name ?? item.id} 的 Digest、SBOM、许可证、漏洞扫描或健康配置。`,
        evaluatedAt: new Date().toISOString()
      };
    });
  }

  computeCostReports(): CostReport[] {
    const runs = this.listRuns();
    const projects = this.listProjects();
    const now = new Date().toISOString();
    return projects.map((project) => {
      const events = runs
        .filter((run) => run.evidenceBundle.projectId === project.id)
        .flatMap((run) => run.evidenceBundle.events);
      const totalCost = events.reduce((sum, event) => sum + eventCost(event), 0);
      const totalTokens = events.reduce((sum, event) => sum + eventTokens(event), 0);
      const highCostEventCount = events.filter((event) => eventCost(event) >= 0.5 || eventTokens(event) >= 8000 || /cost|成本/i.test(`${event.type} ${event.message}`)).length;
      const status: CostReport["status"] = totalCost >= 10 || highCostEventCount >= 5 ? "OVER_BUDGET" : totalCost >= 2 || highCostEventCount > 0 ? "WATCH" : "HEALTHY";
      return {
        projectId: project.id,
        totalCost: Number(totalCost.toFixed(6)),
        totalTokens,
        highCostEventCount,
        status,
        recommendedAction: status === "HEALTHY" ? "保持当前模型路由和预算策略。" : status === "WATCH" ? "把高成本样本纳入评测集，并检查模型路由。" : "冻结自动进化，优先生成成本优化机会点。",
        updatedAt: now
      };
    });
  }

  projectEvolutionFreezeDiagnostic(projectId: string): EvolutionFreezeDiagnostic | undefined {
    const costReport = this.computeCostReports().find((report) => report.projectId === projectId);
    if (costReport?.status !== "OVER_BUDGET") return undefined;
    return {
      projectId,
      costReport,
      reason: `项目 ${projectId} 成本预算已超限：累计成本 ${costReport.totalCost}，Token ${costReport.totalTokens}，高成本事件 ${costReport.highCostEventCount} 次。已冻结自动进化，只允许沉淀成本优化机会点和人工治理。`
    };
  }

  computeReleaseReadinessReports(): ReleaseReadinessReport[] {
    const projects = this.listProjects();
    const runs = this.listRuns();
    const codeUpgrades = this.listCodeUpgradeRuns();
    const pipelines = this.listPipelines();
    const sloByProject = new Map(this.computeSloReports().map((report) => [report.projectId, report]));
    const costByProject = new Map(this.computeCostReports().map((report) => [report.projectId, report]));
    const supplyChainBlocked = this.computeSupplyChainReports().some((report) => report.required && report.status !== "READY");
    const now = new Date().toISOString();
    return projects.map((project) => {
      const projectRuns = runs.filter((run) => run.evidenceBundle.projectId === project.id);
      const confirmedReviewCount = projectRuns.flatMap((run) => run.reviews).filter((review) => review.status === "USER_CONFIRMED").length;
      const successfulUpgradeCount = codeUpgrades.filter((upgrade) => upgrade.projectId === project.id && upgrade.status === "SUCCEEDED").length;
      const successfulPipelineCount = pipelines.filter((pipeline) => pipeline.projectId === project.id && pipeline.status === "SUCCEEDED").length;
      const slo = sloByProject.get(project.id);
      const cost = costByProject.get(project.id);
      const gates: ReleaseReadinessReport["gates"] = [
        {
          name: "用户确认",
          status: confirmedReviewCount > 0 ? "PASSED" : projectRuns.length > 0 ? "WARN" : "FAILED",
          detail: confirmedReviewCount > 0 ? `已有 ${confirmedReviewCount} 个确认方案` : "尚无用户确认方案"
        },
        {
          name: "代码升级",
          status: successfulUpgradeCount > 0 ? "PASSED" : codeUpgrades.some((upgrade) => upgrade.projectId === project.id) ? "WARN" : "FAILED",
          detail: successfulUpgradeCount > 0 ? "代码升级已成功" : "尚无成功代码升级"
        },
        {
          name: "CI/CD",
          status: successfulPipelineCount > 0 ? "PASSED" : pipelines.some((pipeline) => pipeline.projectId === project.id) ? "WARN" : "FAILED",
          detail: successfulPipelineCount > 0 ? "流水线已成功" : "尚无成功流水线"
        },
        {
          name: "SLO 错误预算",
          status: slo?.status === "HEALTHY" ? "PASSED" : slo?.status === "BURNING" ? "WARN" : "FAILED",
          detail: `错误预算剩余 ${slo?.errorBudgetRemaining ?? 100}%`
        },
        {
          name: "成本预算",
          status: cost?.status === "HEALTHY" ? "PASSED" : cost?.status === "WATCH" ? "WARN" : "FAILED",
          detail: `成本 ${cost?.totalCost ?? 0}，Token ${cost?.totalTokens ?? 0}`
        },
        {
          name: "运行时供应链",
          status: supplyChainBlocked ? "FAILED" : "PASSED",
          detail: supplyChainBlocked ? "仍有必需运行时未满足供应链锁定" : "必需运行时供应链锁定已通过"
        }
      ];
      const score = Math.round(gates.reduce((sum, gate) => sum + gateScore(gate.status), 0) / gates.length);
      const failedCount = gates.filter((gate) => gate.status === "FAILED").length;
      const warnCount = gates.filter((gate) => gate.status === "WARN").length;
      const status: ReleaseReadinessReport["status"] = failedCount > 0 ? "BLOCKED" : warnCount > 0 ? "NEEDS_APPROVAL" : "READY";
      return {
        projectId: project.id,
        status,
        score,
        recommendedAction: status === "READY" ? "允许进入灰度、A/B 或正式发布。" : status === "NEEDS_APPROVAL" ? "需要负责人确认灰度范围和回滚策略。" : `先修复：${gates.find((gate) => gate.status === "FAILED")?.name ?? "发布门禁"}。`,
        gates,
        evaluatedAt: now
      };
    });
  }

  computeRolloutStrategyReports(): RolloutStrategyReport[] {
    const readiness = this.computeReleaseReadinessReports();
    const sloByProject = new Map(this.computeSloReports().map((report) => [report.projectId, report]));
    const costByProject = new Map(this.computeCostReports().map((report) => [report.projectId, report]));
    const now = new Date().toISOString();
    return readiness.map((report) => {
      const slo = sloByProject.get(report.projectId);
      const cost = costByProject.get(report.projectId);
      const rollbackGate = report.gates.find((gate) => gate.name === "CI/CD")?.status === "PASSED" &&
        report.gates.find((gate) => gate.name === "代码升级")?.status === "PASSED";
      const gates: RolloutStrategyReport["gates"] = [
        {
          name: "发布就绪度",
          status: report.status === "READY" ? "PASSED" : report.status === "NEEDS_APPROVAL" ? "WARN" : "FAILED",
          detail: `发布就绪度 ${report.score}，状态 ${report.status}`
        },
        {
          name: "SLO 灰度窗口",
          status: (slo?.errorBudgetRemaining ?? 100) >= 70 ? "PASSED" : (slo?.errorBudgetRemaining ?? 100) >= 40 ? "WARN" : "FAILED",
          detail: `错误预算剩余 ${slo?.errorBudgetRemaining ?? 100}%`
        },
        {
          name: "成本灰度窗口",
          status: cost?.status === "HEALTHY" ? "PASSED" : cost?.status === "WATCH" ? "WARN" : "FAILED",
          detail: `成本状态 ${cost?.status ?? "HEALTHY"}`
        },
        {
          name: "回滚准备",
          status: rollbackGate ? "PASSED" : "FAILED",
          detail: rollbackGate ? "代码升级和 CI/CD 记录可追溯，可执行回滚。" : "缺少成功代码升级或 CI/CD 记录，不能自动灰度。"
        }
      ];
      const failedCount = gates.filter((gate) => gate.status === "FAILED").length;
      const warnCount = gates.filter((gate) => gate.status === "WARN").length;
      const status: RolloutStrategyReport["status"] = failedCount > 0 ? "BLOCKED" : warnCount > 0 ? "NEEDS_APPROVAL" : "READY";
      const strategy: RolloutStrategyReport["strategy"] = status === "READY" ? "CANARY" : status === "NEEDS_APPROVAL" ? "MANUAL_APPROVAL" : "BLOCKED";
      const canaryPercent = strategy === "CANARY" ? 10 : strategy === "MANUAL_APPROVAL" ? 1 : 0;
      return {
        projectId: report.projectId,
        strategy,
        status,
        canaryPercent,
        rollbackReady: rollbackGate,
        recommendedAction: strategy === "CANARY" ? "从 10% Canary 开始，观察 SLO、成本和用户反馈。" : strategy === "MANUAL_APPROVAL" ? "仅允许 1% 灰度，并要求负责人确认回滚窗口。" : `先修复：${gates.find((gate) => gate.status === "FAILED")?.name ?? "灰度门禁"}。`,
        gates,
        evaluatedAt: now
      };
    });
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

  listEvolutionBatches(): EvolutionBatch[] {
    return fs.readdirSync(this.evolutionBatchesDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.evolutionBatchesDir, file), "utf8")) as EvolutionBatch);
  }

  readEvolutionBatch(id: string): EvolutionBatch | undefined {
    const file = path.join(this.evolutionBatchesDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8")) as EvolutionBatch;
  }

  writeEvolutionBatch(batch: EvolutionBatch): void {
    atomicWriteJson(path.join(this.evolutionBatchesDir, `${safeFileName(batch.id)}.json`), batch);
  }

  updateEvolutionBatch(id: string, patch: Partial<EvolutionBatch>): EvolutionBatch | undefined {
    const existing = this.readEvolutionBatch(id);
    if (!existing) return undefined;
    const now = new Date().toISOString();
    const updated: EvolutionBatch = {
      ...existing,
      ...definedOnly(patch),
      updatedAt: now
    };
    this.writeEvolutionBatch(updated);
    const cursor = this.readEvolutionCursor(updated.projectId);
    if (updated.status === "SUCCEEDED") {
      this.writeEvolutionCursor({
        ...(cursor ?? defaultEvolutionCursor(updated.projectId)),
        activeBatchId: undefined,
        cooldownUntil: undefined,
        lastSuccessfulEvolutionAt: now,
        updatedAt: now
      });
    } else if (updated.status === "FAILED" || updated.status === "SKIPPED") {
      this.writeEvolutionCursor({
        ...(cursor ?? defaultEvolutionCursor(updated.projectId)),
        activeBatchId: undefined,
        lastFailedEvolutionAt: now,
        updatedAt: now
      });
    } else if (["CONFIRMED", "CODE_UPGRADING", "CICD_RUNNING"].includes(updated.status)) {
      this.writeEvolutionCursor({
        ...(cursor ?? defaultEvolutionCursor(updated.projectId)),
        activeBatchId: updated.id,
        updatedAt: now
      });
    }
    return updated;
  }

  readEvolutionCursor(projectId: string): ProjectEvolutionCursor | undefined {
    const file = path.join(this.evolutionCursorsDir, `${safeFileName(projectId)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8")) as ProjectEvolutionCursor;
  }

  writeEvolutionCursor(cursor: ProjectEvolutionCursor): void {
    atomicWriteJson(path.join(this.evolutionCursorsDir, `${safeFileName(cursor.projectId)}.json`), cursor);
  }

  scanEvolutionBatches(options: {
    projectId?: string;
    maxBatchesPerProject: number;
    maxDatasetsPerBatch: number;
    minDatasetCount: number;
    cooldownMinutes: number;
    dryRun: boolean;
  }): { created: EvolutionBatch[]; skipped: Array<{ projectId: string; reason: string }>; dryRun: boolean } {
    const now = new Date().toISOString();
    const projects = this.listProjects().filter((project) => !options.projectId || project.id === options.projectId);
    const datasets = this.listEvaluationDatasets();
    const runs = this.listRuns();
    const created: EvolutionBatch[] = [];
    const skipped: Array<{ projectId: string; reason: string }> = [];
    for (const project of projects) {
      const freeze = this.projectEvolutionFreezeDiagnostic(project.id);
      if (freeze) {
        skipped.push({ projectId: project.id, reason: freeze.reason });
        continue;
      }
      const cursor = this.readEvolutionCursor(project.id) ?? defaultEvolutionCursor(project.id);
      if (cursor.activeBatchId) {
        const active = this.readEvolutionBatch(cursor.activeBatchId);
        if (active && ["CANDIDATE", "DRAFT_READY", "CONFIRMED", "CODE_UPGRADING", "CICD_RUNNING"].includes(active.status)) {
          skipped.push({ projectId: project.id, reason: `仍有活跃进化批次 ${active.id}` });
          continue;
        }
      }
      if (cursor.cooldownUntil && cursor.cooldownUntil > now) {
        skipped.push({ projectId: project.id, reason: `处于冷却窗口，直到 ${cursor.cooldownUntil}` });
        continue;
      }
      const projectDatasets = datasets
        .filter((dataset) => dataset.projectId === project.id)
        .filter((dataset) => isDatasetAfterCursor(dataset, cursor))
        .filter((dataset) => isActionableEvaluationDataset(dataset, runs))
        .sort((left, right) => batchDatasetRank(right) - batchDatasetRank(left) || left.triggeredAt.localeCompare(right.triggeredAt));
      if (projectDatasets.length < Math.max(1, options.minDatasetCount)) {
        skipped.push({ projectId: project.id, reason: `新增评测集数量不足：${projectDatasets.length}` });
        continue;
      }
      const existingDatasetIds = new Set(this.listEvolutionBatches().filter((batch) => batch.projectId === project.id).flatMap((batch) => batch.datasetIds));
      const freshDatasets = projectDatasets.filter((dataset) => !existingDatasetIds.has(dataset.id));
      if (freshDatasets.length < Math.max(1, options.minDatasetCount)) {
        skipped.push({ projectId: project.id, reason: "新增评测集已被进化批次消费" });
        continue;
      }
      for (const group of groupDatasetsForBatches(freshDatasets, options.maxDatasetsPerBatch).slice(0, Math.max(1, options.maxBatchesPerProject))) {
        const batch = createEvolutionBatchFromDatasets(project.id, group, runs, now);
        created.push(batch);
        if (!options.dryRun) {
          this.writeEvolutionBatch(batch);
          this.writeEvolutionCursor({
            projectId: project.id,
            lastProcessedDatasetTriggeredAt: batch.watermarks.datasetTriggeredAt,
            lastProcessedDatasetIds: batch.datasetIds,
            cooldownUntil: new Date(Date.now() + Math.max(0, options.cooldownMinutes) * 60 * 1000).toISOString(),
            activeBatchId: batch.id,
            lastSuccessfulEvolutionAt: cursor.lastSuccessfulEvolutionAt,
            lastFailedEvolutionAt: cursor.lastFailedEvolutionAt,
            updatedAt: now
          });
        }
      }
    }
    return { created, skipped, dryRun: options.dryRun };
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

  readTriggerRules(fallbackRules: EvolutionTriggerRule[], projectId?: string): EvolutionTriggerRule[] {
    const persistedRules = this.listRuleMemories()
      .map((memory) => memory.compiledRule)
      .filter((rule) => rule.enabled && isRuleInScope(rule, projectId) && isExecutableRuleValid(rule));
    const merged = new Map<string, EvolutionTriggerRule>();
    for (const rule of fallbackRules.filter((rule) => rule.enabled && isRuleInScope(rule, projectId) && isExecutableRuleValid(rule))) merged.set(rule.id, rule);
    for (const rule of persistedRules) merged.set(rule.id, rule);
    return [...merged.values()];
  }

  private readRuleMemory(file: string): RuleMemory | undefined {
    const markdown = fs.readFileSync(file, "utf8");
    const jsonBlock = markdown.match(/```json\s*([\s\S]*?)\s*```/);
    const traceBlock = markdown.match(/<!-- evopilot-llm-trace\s*([\s\S]*?)\s*-->/);
    if (!jsonBlock) return undefined;
    const compiledRule = JSON.parse(jsonBlock[1]) as EvolutionTriggerRule;
    const llmTrace = traceBlock ? JSON.parse(traceBlock[1]) as Record<string, unknown> : undefined;
    const userPrompt = extractMarkdownField(markdown, "用户规则") ?? compiledRule.userPrompt ?? compiledRule.name;
    const scopedRule = {
      ...compiledRule,
      projectId: compiledRule.projectId ?? inferRuleProjectId(compiledRule.id),
      userPrompt
    };
    return {
      id: scopedRule.id,
      userPrompt,
      enabled: scopedRule.enabled,
      description: scopedRule.description,
      compiledRule: scopedRule,
      storagePath: file,
      llmTrace
    };
  }

  private ruleFile(id: string): string {
    return path.join(this.rulesDir, `${safeFileName(id)}.md`);
  }
}

function defaultEvolutionCursor(projectId: string): ProjectEvolutionCursor {
  return {
    projectId,
    lastProcessedDatasetIds: [],
    updatedAt: new Date().toISOString()
  };
}

function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function normalizeEvolutionBatchStatus(value: unknown): EvolutionBatchStatus {
  const allowed: EvolutionBatchStatus[] = ["CANDIDATE", "DRAFT_READY", "CONFIRMED", "CODE_UPGRADING", "CICD_RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"];
  if (allowed.includes(value as EvolutionBatchStatus)) return value as EvolutionBatchStatus;
  throw httpError(400, "EVOLUTION_BATCH_STATUS_INVALID", `不支持的进化批次状态：${String(value)}`);
}

function isDatasetAfterCursor(dataset: EvaluationDataset, cursor: ProjectEvolutionCursor): boolean {
  if (!cursor.lastProcessedDatasetTriggeredAt) return true;
  if (dataset.triggeredAt > cursor.lastProcessedDatasetTriggeredAt) return true;
  return dataset.triggeredAt === cursor.lastProcessedDatasetTriggeredAt && !cursor.lastProcessedDatasetIds.includes(dataset.id);
}

function batchDatasetRank(dataset: EvaluationDataset): number {
  const severity = ({ HIGH: 40, MEDIUM: 24, LOW: 10 })[dataset.severity];
  const status = ({ REGRESSION_READY: 28, EVALUATED: 18, NEEDS_LABELING: 8, INSUFFICIENT_EVIDENCE: 0 })[dataset.status];
  const samples = Math.min(20, dataset.sampleCount);
  const confidence = Math.round((dataset.confidence ?? 0.5) * 12);
  return severity + status + samples + confidence;
}

function groupDatasetsForBatches(datasets: EvaluationDataset[], maxDatasetsPerBatch: number): EvaluationDataset[][] {
  const limit = Math.max(1, maxDatasetsPerBatch);
  const grouped = new Map<string, EvaluationDataset[]>();
  for (const dataset of datasets) {
    const key = `${dataset.learningSignal ?? dataset.metric}:${dataset.scope.split("/")[0].trim()}`;
    grouped.set(key, [...(grouped.get(key) ?? []), dataset]);
  }
  return [...grouped.values()]
    .map((items) => items.sort((left, right) => batchDatasetRank(right) - batchDatasetRank(left)).slice(0, limit))
    .sort((left, right) => right.reduce((sum, item) => sum + batchDatasetRank(item), 0) - left.reduce((sum, item) => sum + batchDatasetRank(item), 0));
}

function createEvolutionBatchFromDatasets(projectId: string, datasets: EvaluationDataset[], runs: StoredRun[], now: string): EvolutionBatch {
  const opportunityIds = [...new Set(datasets.flatMap((dataset) => dataset.opportunityIds ?? []))];
  const opportunities = runs
    .filter((run) => run.evidenceBundle.projectId === projectId)
    .flatMap((run) => run.opportunities.map((opportunity) => ({ run, opportunity })))
    .filter((item) => opportunityIds.includes(item.opportunity.id));
  const ruleIds = [...new Set(opportunities.flatMap((item) => item.opportunity.triggeredRuleIds ?? []))];
  const riskLevel = highestRisk(opportunities.map((item) => item.opportunity.riskLevel), datasets.map((dataset) => dataset.severity));
  const confidence = Math.max(...datasets.map((dataset) => dataset.confidence ?? 0.5), ...opportunities.map((item) => item.opportunity.confidence), 0.5);
  const priorityScore = Math.min(100, Math.round(
    datasets.reduce((sum, dataset) => sum + batchDatasetRank(dataset), 0) / Math.max(1, datasets.length)
  ));
  const first = datasets.reduce((min, dataset) => dataset.triggeredAt < min ? dataset.triggeredAt : min, datasets[0].triggeredAt);
  const last = datasets.reduce((max, dataset) => dataset.triggeredAt > max ? dataset.triggeredAt : max, datasets[0].triggeredAt);
  const primaryOpportunity = opportunities.sort((left, right) => right.opportunity.confidence - left.opportunity.confidence)[0];
  return {
    id: `batch-${safeFileName(projectId)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    status: "CANDIDATE",
    triggerReason: buildEvolutionBatchTriggerReason(datasets, primaryOpportunity?.opportunity),
    datasetIds: datasets.map((dataset) => dataset.id),
    opportunityIds,
    ruleIds,
    confidence: Number(confidence.toFixed(3)),
    riskLevel,
    priorityScore,
    evidenceWindow: { from: first, to: last },
    watermarks: {
      datasetTriggeredAt: last,
      opportunityRunId: primaryOpportunity?.run.id
    },
    createdAt: now,
    updatedAt: now
  };
}

function buildEvolutionBatchTriggerReason(datasets: EvaluationDataset[], opportunity?: EvolutionOpportunity): string {
  const severeCount = datasets.filter((dataset) => dataset.severity === "HIGH").length;
  const regressionCount = datasets.filter((dataset) => dataset.status === "REGRESSION_READY").length;
  const scopes = [...new Set(datasets.map((dataset) => dataset.scope.split("/")[0].trim()).filter(Boolean))].slice(0, 3);
  const base = opportunity?.title ?? (scopes.join("、") || "运行证据触发进化");
  return `${base}；新增 ${datasets.length} 个评测集，其中高严重级别 ${severeCount} 个、可回归 ${regressionCount} 个。`;
}

function highestRisk(opportunityRisks: Array<EvolutionOpportunity["riskLevel"]>, datasetSeverities: Array<EvaluationDataset["severity"]>): EvolutionBatch["riskLevel"] {
  if (opportunityRisks.includes("HIGH") || datasetSeverities.includes("HIGH")) return "HIGH";
  if (opportunityRisks.includes("MEDIUM") || datasetSeverities.includes("MEDIUM")) return "MEDIUM";
  return "LOW";
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
  const validationPlan = resolveProjectValidationPlan(project, body);
  const validationCommands = validationPlanToCommands(validationPlan, normalizeValidationCommands(body.validationCommands ?? plan.validationContract.commands));
  const diagnostic = await diagnoseProjectRuntime({ store, project, runtime });
  const blockingDiagnostic = codeUpgradeBlockingDiagnostic(diagnostic);
  if (blockingDiagnostic) throw new Error(`PROJECT_RUNTIME_DIAGNOSTIC_FAILED: ${blockingDiagnostic.remediation ?? blockingDiagnostic.detail}`);
  const codeContext = await collectProjectCodeContext({ project, runtime, profile });
  if (runtime.mode === "prod" && codeContext.status !== "AVAILABLE") {
    throw new Error(`PROJECT_CODE_CONTEXT_UNAVAILABLE: ${codeContext.unavailableReason ?? codeContext.summary}`);
  }
  const allowedPaths = inferCodeUpgradeAllowedPaths(codeContext);
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
    codeContext: codeContext.status === "AVAILABLE" ? codeContext.selectedFiles : undefined,
    validationCommands,
    validationPlan,
    allowedPaths,
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

function codeUpgradeBlockingDiagnostic(diagnostic: ProjectRuntimeDiagnostic): ProjectRuntimeDiagnostic["checks"][number] | undefined {
  return diagnostic.checks.find((check) => check.status === "FAILED" && [
    "项目注册验证",
    "服务验证编排",
    "代码升级运行时"
  ].includes(check.name));
}

function inferCodeUpgradeAllowedPaths(codeContext: ProjectCodeContext): string[] {
  const base = new Set([".evopilot/runtime-upgrades", "docs/evopilot-upgrades"]);
  if (codeContext.status !== "AVAILABLE") return [...base];
  for (const file of codeContext.selectedFiles) {
    const pathName = normalizeRelativePathForPolicy(file.path);
    if (!pathName || pathName.startsWith("docs/") || pathName.startsWith(".evopilot/")) continue;
    const first = pathName.split("/")[0];
    if (["node_modules", "dist", "build", "target", ".git", ".venv", "__pycache__"].includes(first)) continue;
    if (pathName.includes("/")) base.add(first);
    else base.add(pathName);
  }
  for (const fallback of ["src", "app", "server", "lib", "tests", "test", "scripts", "config", "package.json", "pyproject.toml", "requirements.txt", "pom.xml", "go.mod", "Dockerfile", "Jenkinsfile"]) {
    base.add(fallback);
  }
  return [...base];
}

function normalizeRelativePathForPolicy(value: string): string {
  const normalized = String(value ?? "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized === "." || normalized.includes("\0")) return "";
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (parts.includes("..")) return "";
  return parts.join("/");
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
  const runtimeProfile: ProjectProfile = { ...profile, triggerRules: store.readTriggerRules(profile.triggerRules ?? defaultTriggerRules, projectId) };
  const result = runEvolutionCycle({ projectId, profile: runtimeProfile, events, files, now });
  const run: StoredRun = {
    id: result.evidenceBundle.id,
    ...result,
    releaseReports: [],
    learningRecords: []
  };
  store.writeRun(run);
  store.writeEvaluationDatasets(evaluationDatasetsFromRun(run));
  store.appendAudit(audit(auth, "evidence.ingested", run.id, { projectId, ingestSource, eventCount: events.length }));
  store.appendAudit(audit(auth, "run.created", run.id, { projectId, opportunityCount: run.opportunities.length, idempotencyKey, ingestSource }));
  store.appendAudit(audit(auth, "evaluation-datasets.autogenerated", run.id, { projectId, count: run.opportunities.length }));
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
    failureReason: terminalCodeUpgradeFailureReason(snapshot.status, events) ?? run.failureReason,
    error: terminalCodeUpgradeError(snapshot.status, events) ?? run.error,
    updatedAt: new Date().toISOString()
  };
  store.writeCodeUpgradeRun(updated);
  store.writeCodeUpgradeEvents(run.id, dedupeEvents(events));
  return updated;
}

function terminalCodeUpgradeFailureReason(status: OpenHandsRunStatus, events: CodeUpgradeEvent[]): string | undefined {
  if (status !== "FAILED" && status !== "CANCELED") return undefined;
  const terminal = [...events].reverse().find((event) => event.level === "error" || /失败|failed|error/i.test(event.message));
  const message = terminal?.message?.trim();
  if (!message) return `代码升级${status === "CANCELED" ? "已取消" : "失败"}`;
  return message.length > 500 ? `${message.slice(0, 500)}...` : message;
}

function terminalCodeUpgradeError(status: OpenHandsRunStatus, events: CodeUpgradeEvent[]): string | undefined {
  if (status !== "FAILED" && status !== "CANCELED") return undefined;
  const terminal = [...events].reverse().find((event) => event.level === "error" || /失败|failed|error/i.test(event.message));
  const raw = terminal?.raw;
  if (raw && typeof raw === "object" && "message" in raw && typeof (raw as { message?: unknown }).message === "string") {
    return (raw as { message: string }).message.slice(0, 4000);
  }
  return terminal?.message?.slice(0, 4000);
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

function maskOpenHandsConnector(connector: StoredOpenHandsConnector): Omit<StoredOpenHandsConnector, "apiKey" | "llmApiKey"> & { apiKeyConfigured: boolean; llmApiKeyConfigured: boolean } {
  const { apiKey, llmApiKey, ...safe } = connector;
  return { ...safe, apiKeyConfigured: Boolean(apiKey), llmApiKeyConfigured: Boolean(llmApiKey) };
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
    triggeredAt: value.triggeredAt ? new Date(String(value.triggeredAt)).toISOString() : now,
    generatedBy: value.generatedBy === "self-learning" ? "self-learning" : "manual",
    evidenceEventIds: Array.isArray(value.evidenceEventIds) ? value.evidenceEventIds.map(String) : undefined,
    opportunityIds: Array.isArray(value.opportunityIds) ? value.opportunityIds.map(String) : undefined,
    confidence: value.confidence === undefined ? undefined : Math.max(0, Math.min(1, Number(value.confidence))),
    learningSignal: value.learningSignal ? String(value.learningSignal) : undefined
  };
}

function evaluationDatasetsFromRun(run: StoredRun): EvaluationDataset[] {
  return run.opportunities.filter((opportunity) => isActionableOpportunity(opportunity, run)).map((opportunity) => {
    const firstEvent = run.evidenceBundle.events.find((event) => opportunity.evidenceEventIds.includes(event.id));
    const status: EvaluationDataset["status"] = opportunity.confidence >= 0.85 ? "REGRESSION_READY" : opportunity.confidence >= 0.72 ? "EVALUATED" : "NEEDS_LABELING";
    const severity: EvaluationDataset["severity"] = opportunity.riskLevel === "HIGH" || opportunity.impact === "high" ? "HIGH" : opportunity.riskLevel === "MEDIUM" ? "MEDIUM" : "LOW";
    const metric = metricFromOpportunity(opportunity);
    return {
      id: `eval-${safeFileName(`${run.id}-${opportunity.type}-${opportunity.affectedArea}`)}`,
      projectId: opportunity.projectId,
      name: datasetNameForOpportunity(opportunity),
      source: sourceForOpportunityDataset(opportunity, firstEvent),
      status,
      severity,
      sampleCount: Math.max(1, opportunity.evidenceEventIds.length),
      metric,
      scope: `${opportunity.affectedArea} / ${opportunity.failureAttribution ?? opportunity.type}`,
      triggeredAt: firstEvent?.timestamp ?? run.evidenceBundle.timeWindow.to,
      generatedBy: "self-learning",
      evidenceEventIds: opportunity.evidenceEventIds,
      opportunityIds: [opportunity.id],
      confidence: opportunity.confidence,
      learningSignal: opportunity.failureAttribution ?? opportunity.type
    };
  });
}

function datasetNameForOpportunity(opportunity: EvolutionOpportunity): string {
  if (opportunity.failureAttribution === "latency-regression") return `${opportunity.affectedArea} 性能回归样本`;
  if (opportunity.failureAttribution === "tool-recovery") return `${opportunity.affectedArea} 工具恢复样本`;
  if (opportunity.failureAttribution === "rag-quality") return `${opportunity.affectedArea} RAG 质量样本`;
  if (opportunity.failureAttribution === "cost-regression") return `${opportunity.affectedArea} 成本回归样本`;
  if (opportunity.failureAttribution === "security-risk") return `${opportunity.affectedArea} 安全回归样本`;
  return `${opportunity.affectedArea} 进化回归样本`;
}

function sourceForOpportunityDataset(opportunity: EvolutionOpportunity, event?: RuntimeEvidenceEvent): string {
  if (event?.source === "observability") return "Trace / Log 智能聚类";
  if (event?.source === "tool") return "Tool Call 智能聚类";
  if (event?.source === "user") return "用户反馈智能聚类";
  if (event?.source === "ci") return "Eval / CI 智能聚类";
  if (opportunity.failureAttribution === "rag-quality") return "RAG Context 智能聚类";
  if (opportunity.failureAttribution === "cost-regression") return "Cost / Latency 智能聚类";
  return "运行证据智能聚类";
}

function metricFromOpportunity(opportunity: EvolutionOpportunity): string {
  if (opportunity.baseline) {
    return `${opportunity.baseline.metric} ${opportunity.baseline.current}${opportunity.baseline.unit} / 目标 ${opportunity.baseline.target}${opportunity.baseline.unit}`;
  }
  return `置信度 ${Math.round(opportunity.confidence * 100)}%`;
}

function isActionableOpportunity(opportunity: EvolutionOpportunity, run: StoredRun): boolean {
  const relatedEvents = run.evidenceBundle.events.filter((event) => opportunity.evidenceEventIds.includes(event.id));
  if (relatedEvents.some((event) => event.severity !== "LOW")) return true;
  if (opportunity.baseline && opportunity.baseline.status !== "normal") return true;
  return false;
}

function isActionableEvaluationDataset(dataset: EvaluationDataset, runs: StoredRun[]): boolean {
  const opportunityIds = new Set(dataset.opportunityIds ?? []);
  const relatedRuns = runs.filter((run) => run.evidenceBundle.projectId === dataset.projectId && run.opportunities.some((opportunity) => opportunityIds.has(opportunity.id)));
  if (relatedRuns.length === 0) return dataset.severity !== "LOW" && dataset.status !== "INSUFFICIENT_EVIDENCE";
  return relatedRuns.some((run) => run.opportunities
    .filter((opportunity) => opportunityIds.has(opportunity.id))
    .some((opportunity) => isActionableOpportunity(opportunity, run)));
}

function opportunityInsightScore(opportunity: EvolutionOpportunity, datasets: EvaluationDataset[], run: StoredRun): number {
  const impact = opportunity.impact === "high" ? 28 : opportunity.impact === "medium" ? 18 : 10;
  const confidence = Math.round(opportunity.confidence * 25);
  const datasetScore = Math.min(18, datasets.length * 6);
  const evidenceScore = Math.min(14, opportunity.evidenceEventIds.length * 3);
  const learningScore = Math.min(15, run.learningRecords.length * 5);
  const riskPenalty = opportunity.riskLevel === "HIGH" ? 5 : 0;
  return Math.max(0, Math.min(100, impact + confidence + datasetScore + evidenceScore + learningScore - riskPenalty));
}

function serviceScoreLevel(score: number): ServiceScorecard["level"] {
  if (score >= 90) return "优秀";
  if (score >= 75) return "良好";
  if (score >= 55) return "待改进";
  return "高风险";
}

function serviceScoreRecommendedAction(score: number, checks: ServiceScorecard["checks"]): string {
  const failed = checks.find((check) => check.status === "FAILED");
  const warn = checks.find((check) => check.status === "WARN");
  if (failed) return `优先补齐：${failed.name}。`;
  if (warn) return `建议增强：${warn.name}。`;
  if (score >= 90) return "保持当前闭环，并扩大自动化等级。";
  return "继续积累发布后学习记录。";
}

function readRuntimeLock(): any[] {
  const lockPath = path.resolve("runtimes/runtime-lock.json");
  if (!fs.existsSync(lockPath)) return [];
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  return Array.isArray(lock.runtimes) ? lock.runtimes : [];
}

function vulnerabilityReportPassed(file: string): boolean {
  if (!fs.existsSync(path.resolve(file))) return false;
  const report = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  return report.status === "PASSED";
}

function policySeverityRank(severity: GovernancePolicyEvaluation["severity"]): number {
  return ({ LOW: 1, MEDIUM: 2, HIGH: 3 })[severity];
}

function eventCost(event: RuntimeEvidenceEvent): number {
  const attrs = event.attributes ?? {};
  return Math.max(0, Number(
    attrs.costUsd ??
    attrs.cost ??
    attrs.llmCost ??
    attrs.estimatedCostUsd ??
    attrs.costDelta ??
    0
  ));
}

function eventTokens(event: RuntimeEvidenceEvent): number {
  const attrs = event.attributes ?? {};
  return Math.max(0, Math.round(Number(
    attrs.totalTokens ??
    attrs.tokenCount ??
    attrs.tokens ??
    attrs.inputTokens ??
    0
  ) + Number(attrs.outputTokens ?? 0)));
}

function costHealthScore(status: CostReport["status"]): number {
  if (status === "HEALTHY") return 100;
  if (status === "WATCH") return 70;
  return 30;
}

function gateScore(status: "PASSED" | "WARN" | "FAILED"): number {
  if (status === "PASSED") return 100;
  if (status === "WARN") return 65;
  return 0;
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
  project?: StoredProject;
  codeContext?: ProjectCodeContext;
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
        datasetCount: String(args.datasets.length),
        codeContextStatus: args.codeContext?.status ?? "UNAVAILABLE",
        codeContextFileCount: String(args.codeContext?.fileCount ?? 0)
      },
      prompt: [
        "你是 EvoPilot 的软件架构师。",
        "请基于用户选择的评测集、当前项目代码基线和项目运行配置，生成一份生产可审查的 Markdown 进化方案。",
        "必须先判断机会点目标与当前代码事实是否匹配；如果目标明显不可达，必须给出阶段化目标或不可达原因，不允许假装可以达成。",
        "只输出 Markdown，不要输出解释性前后缀。",
        "",
        `机会点标题：${args.title}`,
        `进化目标：${args.target}`,
        `项目：${args.project?.id ?? args.datasets[0]?.projectId ?? "unknown"}`,
        `仓库分支：${args.codeContext?.branch ?? args.project?.repository?.defaultBranch ?? "unknown"}`,
        "",
        "当前代码上下文：",
        renderCodeContextForPrompt(args.codeContext),
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
        "必须包含章节：背景、当前代码事实、可行性判断、进化目标、架构改造建议、修改范围、验证计划、风险与回滚。"
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
  const allowed: EvolutionTriggerCondition["field"][] = [
    "type",
    "source",
    "severity",
    "module",
    "attributes.durationMs",
    "attributes.latencyMs",
    "attributes.p95LatencyMs",
    "attributes.costUsd",
    "attributes.totalTokens",
    "attributes.ragHit",
    "attributes.score",
    "attributes.errorRate",
    "attributes.rollbackCount",
    "attributes.contextTruncated"
  ];
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

async function collectProjectCodeContext(args: {
  project?: StoredProject;
  runtime: RuntimeConfig;
  profile: ProjectProfile;
}): Promise<ProjectCodeContext> {
  const project = args.project;
  if (!project) return unavailableProjectCodeContext("unknown", "项目未注册，无法读取当前代码基线。");
  if (!project.repository) return unavailableProjectCodeContext(project.id, "项目未配置 Git 仓库，无法读取当前代码基线。");
  if (project.validation.status !== "VERIFIED") return unavailableProjectCodeContext(project.id, `项目注册未验证通过：${project.validation.message}`);

  if (project.repository.provider === "local-git") {
    if (!project.repository.root) return unavailableProjectCodeContext(project.id, "local-git 项目缺少 repository.root。");
    return collectCodeContextFromWorktree({ project, repoRoot: project.repository.root, source: "local-git", profile: args.profile });
  }

  if (!project.repository.gitUrl) return unavailableProjectCodeContext(project.id, "远程 Git 项目缺少 gitUrl，无法克隆当前代码基线。");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `evopilot-code-context-${safeFileName(project.id)}-`));
  const repoRoot = path.join(tempRoot, "repo");
  const askpass = writeGitAskPass(project.repository);
  try {
    const branch = project.repository.defaultBranch ?? "main";
    const result = await runGitCommand(["clone", "--depth", "1", "--branch", branch, project.repository.gitUrl, repoRoot], {
      env: { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0" }
    });
    if (result.code !== 0) return unavailableProjectCodeContext(project.id, `克隆当前代码基线失败：${result.stderr || result.stdout}`);
    return await collectCodeContextFromWorktree({ project, repoRoot, source: "git-clone", profile: args.profile });
  } finally {
    fs.rmSync(askpass, { force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function unavailableProjectCodeContext(projectId: string, reason: string): ProjectCodeContext {
  return {
    status: "UNAVAILABLE",
    source: "none",
    projectId,
    fileCount: 0,
    selectedFiles: [],
    summary: reason,
    unavailableReason: reason
  };
}

async function collectCodeContextFromWorktree(args: {
  project: StoredProject;
  repoRoot: string;
  source: ProjectCodeContext["source"];
  profile: ProjectProfile;
}): Promise<ProjectCodeContext> {
  if (!fs.existsSync(args.repoRoot)) return unavailableProjectCodeContext(args.project.id, `代码目录不存在：${args.repoRoot}`);
  const branch = await gitOutput(["-C", args.repoRoot, "rev-parse", "--abbrev-ref", "HEAD"]).catch(() => args.project.repository?.defaultBranch ?? "unknown");
  const commitSha = await gitOutput(["-C", args.repoRoot, "rev-parse", "HEAD"]).catch(() => undefined);
  const trackedFiles = await listTrackedFiles(args.repoRoot);
  const selectedPaths = selectCodeContextFiles(trackedFiles, args.profile.policy.protectedPaths);
  const selectedFiles = selectedPaths.map((relativePath) => readContextFile(args.repoRoot, relativePath)).filter(Boolean) as ProjectCodeContext["selectedFiles"];
  if (selectedFiles.length === 0) return unavailableProjectCodeContext(args.project.id, "当前代码基线没有可用于架构分析的文本文件。");
  return {
    status: "AVAILABLE",
    source: args.source,
    projectId: args.project.id,
    branch: branch?.trim() || args.project.repository?.defaultBranch,
    commitSha: commitSha?.trim(),
    fileCount: trackedFiles.length,
    selectedFiles,
    summary: `已读取 ${selectedFiles.length} 个关键文件，仓库共 ${trackedFiles.length} 个受 Git 跟踪文件。`
  };
}

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  const gitFiles = await gitOutput(["-C", repoRoot, "ls-files"]).catch(() => "");
  const files = gitFiles.split("\n").map((item) => item.trim()).filter(Boolean);
  if (files.length > 0) return files;
  return listFilesRecursive(repoRoot)
    .map((file) => path.relative(repoRoot, file).replace(/\\/g, "/"))
    .filter((file) => !file.startsWith(".git/"));
}

function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".venv" || entry.name === "dist" || entry.name === "build") continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function selectCodeContextFiles(files: string[], protectedPaths: string[]): string[] {
  const textFiles = files
    .filter((file) => isContextTextFile(file))
    .filter((file) => !protectedPaths.some((protectedPath) => isUnder(file, protectedPath)))
    .filter((file) => !/(^|\/)(node_modules|dist|build|target|\.git|\.venv|__pycache__)\//.test(file));
  const priority = (file: string): number => {
    const name = path.basename(file).toLowerCase();
    if (["readme.md", "package.json", "pyproject.toml", "requirements.txt", "pom.xml", "go.mod", "dockerfile", "jenkinsfile"].includes(name)) return 0;
    if (/^(app|main|server|index)\.(py|js|ts|mjs|java|go)$/.test(name)) return 1;
    if (file.startsWith("src/") || file.startsWith("app/") || file.startsWith("server/")) return 2;
    if (file.startsWith("tests/") || file.startsWith("test/") || file.startsWith("scripts/")) return 3;
    if (file.startsWith("docs/")) return 4;
    return 5;
  };
  return textFiles.sort((a, b) => priority(a) - priority(b) || a.localeCompare(b)).slice(0, 10);
}

function isContextTextFile(file: string): boolean {
  const lower = file.toLowerCase();
  return /\.(md|txt|json|ya?ml|toml|ini|properties|py|js|ts|mjs|cjs|java|go|xml|gradle|sh|sql)$/.test(lower) ||
    ["dockerfile", "jenkinsfile", "makefile"].includes(path.basename(lower));
}

function readContextFile(repoRoot: string, relativePath: string): ProjectCodeContext["selectedFiles"][number] | undefined {
  const fullPath = path.resolve(repoRoot, relativePath);
  if (!isUnderPath(fullPath, repoRoot) || !fs.existsSync(fullPath)) return undefined;
  const stat = fs.statSync(fullPath);
  if (!stat.isFile() || stat.size > 512 * 1024) return undefined;
  const raw = fs.readFileSync(fullPath, "utf8");
  const limit = 2500;
  return {
    path: relativePath,
    content: raw.length > limit ? raw.slice(0, limit) : raw,
    truncated: raw.length > limit
  };
}

function renderCodeContextForPrompt(context?: ProjectCodeContext): string {
  if (!context || context.status !== "AVAILABLE") return `- 状态：不可用\n- 原因：${context?.unavailableReason ?? "未采集代码上下文"}`;
  return [
    "- 状态：可用",
    `- 来源：${context.source}`,
    `- 分支：${context.branch ?? "unknown"}`,
    `- 提交：${context.commitSha ?? "unknown"}`,
    `- 摘要：${context.summary}`,
    "",
    ...context.selectedFiles.flatMap((file) => [
      `### 文件：${file.path}${file.truncated ? "（已截断）" : ""}`,
      "```",
      file.content,
      "```",
      ""
    ])
  ].join("\n");
}

function maskProjectCodeContext(context: ProjectCodeContext): Omit<ProjectCodeContext, "selectedFiles"> & { selectedFiles: Array<{ path: string; truncated: boolean; characters: number }> } {
  return {
    ...context,
    selectedFiles: context.selectedFiles.map((file) => ({
      path: file.path,
      truncated: file.truncated,
      characters: file.content.length
    }))
  };
}

function writeGitAskPass(repository: ProjectRepositoryRegistration): string {
  const password = repository.credentials?.password ?? resolveCredentialToken(repository) ?? "";
  const username = repository.credentials?.username ?? (password ? "oauth2" : "git");
  const askpass = path.join(os.tmpdir(), `evopilot-git-askpass-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  fs.writeFileSync(askpass, [
    "#!/bin/sh",
    "case \"$1\" in",
    `*Username*) printf '%s\\n' '${shellSingleQuote(username)}' ;;`,
    `*) printf '%s\\n' '${shellSingleQuote(password)}' ;;`,
    "esac",
    ""
  ].join("\n"), { mode: 0o700 });
  return askpass;
}

async function gitOutput(args: string[]): Promise<string> {
  const result = await runGitCommand(args);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

async function runGitCommand(args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn("git", args, {
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise<number>((resolve) => child.on("close", resolve));
  return { code, stdout, stderr: stderr.trim() };
}

function isUnderPath(childPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isUnder(file: string, prefix: string): boolean {
  const normalizedFile = file.replace(/\\/g, "/").replace(/^\/+/, "");
  const normalizedPrefix = prefix.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  return normalizedFile === normalizedPrefix || normalizedFile.startsWith(`${normalizedPrefix}/`);
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

function normalizeProjectRuntime(body: any): ProjectRuntimeConfiguration | undefined {
  const source = body.runtime && typeof body.runtime === "object" ? body.runtime : undefined;
  if (!source) return undefined;
  const language = normalizeRuntimeLanguage(source.language);
  const serviceSource = source.service && typeof source.service === "object" ? source.service : undefined;
  const service = serviceSource?.enabled === false || !serviceSource?.startCommand ? undefined : {
    enabled: true,
    startCommand: String(serviceSource.startCommand).trim(),
    host: serviceSource.host ? String(serviceSource.host).trim() : "127.0.0.1",
    port: serviceSource.port ? Number(serviceSource.port) : undefined,
    healthPath: serviceSource.healthPath ? String(serviceSource.healthPath).trim() : "/health",
    readyTimeoutSeconds: serviceSource.readyTimeoutSeconds ? Number(serviceSource.readyTimeoutSeconds) : 15
  };
  return {
    language,
    installCommands: normalizeCommandList(source.installCommands),
    unitCommands: normalizeCommandList(source.unitCommands),
    service,
    smokeCommands: normalizeCommandList(source.smokeCommands),
    functionalCommands: normalizeCommandList(source.functionalCommands)
  };
}

function normalizeRuntimeLanguage(value: unknown): ProjectRuntimeConfiguration["language"] {
  const text = String(value ?? "generic").trim().toLowerCase();
  if (text === "python" || text === "node" || text === "java" || text === "go") return text;
  return "generic";
}

function normalizeCommandList(value: unknown): string[] | undefined {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/)
      : [];
  const commands = items.map((item) => String(item).trim()).filter(Boolean);
  return commands.length > 0 ? commands : undefined;
}

function resolveProjectValidationPlan(project: StoredProject | undefined, body: any): ProjectRuntimeConfiguration | undefined {
  const explicit = normalizeProjectRuntime(body);
  return explicit ?? project?.runtime;
}

function validationPlanToCommands(plan: ProjectRuntimeConfiguration | undefined, fallback: string[]): string[] {
  if (!plan) return fallback;
  return [
    ...(plan.installCommands ?? []),
    ...(plan.unitCommands ?? []),
    ...(plan.smokeCommands ?? []),
    ...(plan.functionalCommands ?? [])
  ].filter(Boolean);
}

async function diagnoseProjectRuntime(args: { store: FileStore; project: StoredProject | undefined; runtime: RuntimeConfig }): Promise<ProjectRuntimeDiagnostic> {
  const checkedAt = new Date().toISOString();
  const project = args.project;
  const checks: ProjectRuntimeDiagnostic["checks"] = [];
  if (!project) {
    return { projectId: "unknown", status: "FAILED", checks: [{ name: "项目注册", status: "FAILED", detail: "项目不存在" }], recommendedAction: "先完成项目注册。", checkedAt };
  }
  checks.push({
    name: "项目注册验证",
    status: project.validation.status === "VERIFIED" ? "PASSED" : "FAILED",
    detail: project.validation.message,
    remediation: project.validation.status === "VERIFIED" ? undefined : "重新注册项目并验证 Git 凭证、URL 和默认分支。"
  });
  checks.push({
    name: "项目运行配置",
    status: project.runtime ? "PASSED" : "WARN",
    detail: project.runtime ? `语言：${project.runtime.language}` : "未配置项目启动、健康检查和验证命令，生产执行会退回方案自带验证命令。",
    remediation: project.runtime ? undefined : "在项目注册中配置 runtime：语言、单元测试、服务启动、health、smoke、functional。"
  });
  if (project.runtime?.service?.enabled) {
    checks.push({
      name: "服务验证编排",
      status: project.runtime.service.startCommand && project.runtime.service.healthPath ? "PASSED" : "FAILED",
      detail: `启动命令：${project.runtime.service.startCommand || "未配置"}；健康检查：${project.runtime.service.healthPath || "未配置"}`,
      remediation: "配置可在升级工作区内启动的服务命令，例如 python3 app.py --host 127.0.0.1 --port 49318。"
    });
  }
  const codeUpgradeConnector = args.store.readOpenHandsConnector("default");
  checks.push({
    name: "代码升级运行时",
    status: codeUpgradeConnector?.baseUrl ? "PASSED" : "FAILED",
    detail: codeUpgradeConnector?.baseUrl ? `已配置：${codeUpgradeConnector.baseUrl}` : "未配置代码升级运行时连接器。",
    remediation: "配置 EvoPilot 托管代码升级运行时连接器。"
  });
  const cicd = project.cicd?.provider === "jenkins" ? project.cicd : undefined;
  const jenkinsConnector = cicd?.connectorId ? args.store.readJenkinsConnector(cicd.connectorId) : undefined;
  checks.push({
    name: "CI/CD 连接",
    status: cicd?.job && jenkinsConnector?.baseUrl ? "PASSED" : "FAILED",
    detail: cicd?.job && jenkinsConnector?.baseUrl ? `Jenkins：${jenkinsConnector.baseUrl}；Job：${cicd.job}` : "项目未完整配置 Jenkins 连接器和 Job。",
    remediation: "在项目注册中配置项目级 Jenkins 地址、凭证和 Job。"
  });
  const status = checks.some((check) => check.status === "FAILED") ? "FAILED" : checks.some((check) => check.status === "WARN") ? "WARN" : "PASSED";
  return {
    projectId: project.id,
    status,
    checks,
    recommendedAction: status === "PASSED" ? "运行时体检通过，可以进入代码升级和 CI/CD。" : checks.find((check) => check.status !== "PASSED")?.remediation ?? "补齐项目运行配置。",
    checkedAt
  };
}

function normalizeProjectCicd(body: any, projectId: string): { projectCicd?: ProjectCicdConfiguration; connector?: StoredJenkinsConnector } {
  const source = body.cicd && typeof body.cicd === "object" ? body.cicd : undefined;
  const jenkins = source?.jenkins && typeof source.jenkins === "object" ? source.jenkins : source;
  if (!source || source.provider === "none" || jenkins?.provider === "none") return {};
  const provider = String(source.provider ?? jenkins?.provider ?? "jenkins");
  if (provider !== "jenkins") return {};
  const mode = jenkins?.mode === "project-override" || jenkins?.baseUrl ? "project-override" : "system-default";
  const explicitConnectorId = jenkins?.connectorId ? String(jenkins.connectorId).trim() : undefined;
  const job = jenkins?.job ? String(jenkins.job).trim() : undefined;
  const parameters = jenkins?.parameters && typeof jenkins.parameters === "object" ? normalizeStringMap(jenkins.parameters) : undefined;
  if (mode === "system-default") {
    return {
      projectCicd: {
        provider: "jenkins",
        mode,
        connectorId: explicitConnectorId,
        job,
        parameters
      }
    };
  }
  const connectorId = explicitConnectorId ?? `project-${safeFileName(projectId)}-jenkins`;
  const connector: StoredJenkinsConnector | undefined = jenkins?.baseUrl ? {
    id: connectorId,
    name: String(jenkins.name ?? `${projectId} Jenkins`).trim(),
    baseUrl: String(jenkins.baseUrl).trim(),
    username: jenkins.username ? String(jenkins.username) : undefined,
    apiToken: jenkins.apiToken ? String(jenkins.apiToken) : undefined,
    jobTemplates: {
      ...(job ? { [projectId]: job, default: job } : {}),
      ...(jenkins.jobTemplates && typeof jenkins.jobTemplates === "object" ? normalizeStringMap(jenkins.jobTemplates) : {})
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } : undefined;
  return {
    projectCicd: {
      provider: "jenkins",
      mode,
      connectorId,
      job,
      parameters
    },
    connector
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
      "- anyOf 或 allOf: 条件数组，field 只能使用 type/source/severity/module/attributes.durationMs/attributes.latencyMs/attributes.p95LatencyMs/attributes.costUsd/attributes.totalTokens/attributes.ragHit/attributes.score/attributes.errorRate/attributes.rollbackCount/attributes.contextTruncated，operator 只能使用 ==/!=/>/>=/</<=/includes",
      "- 注意：用户说“小于 3 秒”表示超过 3000ms 时触发风险，不能编译成 attributes.durationMs <= 3000。",
      "- 注意：RAG 命中率、工具失败、上下文截断必须使用 type/source/module 或对应 attributes 字段，不能塞进 attributes.durationMs。",
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
  const attempts: Array<{ attempt: number; provider?: string; model?: string; error?: string; repaired: boolean }> = [];
  let lastResponse = response;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const compiled = normalizeCompiledRule(JSON.parse(extractJsonObject(lastResponse.text)), args.projectId, args.userPrompt);
      validateExecutableRule(compiled);
      return {
        memory: ruleMemoryFromCompiledRule(compiled, {
          ...llmTraceFromResponse(attempt === 1 ? "llm" : "llm-repaired", lastResponse, startedAt),
          repairAttempts: attempts
        })
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ attempt, provider: lastResponse.provider, model: lastResponse.model, error: message, repaired: false });
      if (attempt >= 3) break;
      const repairResponse = await args.llmClient.generate({
        caller: "evopilot-server",
        intent: "structured.extraction",
        outputContract: "json_object",
        jsonObject: true,
        latencyClass: "interactive",
        complexity: "medium",
        outputSize: "medium",
        metadata: {
          productFlow: "prompt-to-executable-rule-repair",
          projectId: args.projectId,
          repairAttempt: String(attempt)
        },
        prompt: buildRuleCompileRepairPrompt({
          projectId: args.projectId,
          userPrompt: args.userPrompt,
          previousJson: lastResponse.text,
          validationError: message
        })
      });
      if (!repairResponse.success || !repairResponse.text.trim()) {
        attempts.push({
          attempt: attempt + 1,
          provider: repairResponse.provider,
          model: repairResponse.model,
          error: repairResponse.errorMessage ?? repairResponse.errorCode ?? "LLM 修正规则失败",
          repaired: false
        });
        lastResponse = repairResponse;
        break;
      }
      attempts[attempts.length - 1] = { ...attempts[attempts.length - 1], repaired: true };
      lastResponse = repairResponse;
    }
  }
  if (args.requireLlm) {
    const message = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown");
    throw new Error(`LLM_RULE_COMPILE_RESPONSE_INVALID: ${message}`);
  }
  const rule = fallbackCompiledRule(args.projectId, args.userPrompt, "LLM 返回格式无效，使用模板规则");
  return { memory: ruleMemoryFromCompiledRule(rule, llmTraceFromResponse("template-fallback", lastResponse, startedAt)) };
}

function buildRuleCompileRepairPrompt(args: { projectId: string; userPrompt: string; previousJson: string; validationError: string }): string {
  return [
    "你是 EvoPilot 的证据策略编译器。上一次输出的 JSON 未通过生产执行校验。",
    "请基于校验错误修正 JSON，只返回 JSON 对象，不要 Markdown。",
    "",
    "硬性规则：",
    "- attributes.durationMs/attributes.latencyMs/attributes.p95LatencyMs 必须使用数值阈值。",
    "- 用户说“小于 3 秒”表示目标状态，触发条件必须表达超过 3000ms 的风险，例如 attributes.durationMs > 3000。",
    "- attributes.ragHit 和 attributes.contextTruncated 是布尔字段，只能使用 == 或 !=，值只能是 true 或 false。",
    "- 工具失败优先用 type == tool.failure 或 source == tool，不要把工具失败塞进耗时字段。",
    "- 保持 projectId、userPrompt 与用户意图一致。",
    "",
    `项目：${args.projectId}`,
    `用户规则：${args.userPrompt}`,
    `校验错误：${args.validationError}`,
    "上一次 JSON：",
    args.previousJson
  ].join("\n");
}

function normalizeCompiledRule(value: any, projectId: string, userPrompt: string): EvolutionTriggerRule {
  const id = safeFileName(String(value.id ?? `rule-${Date.now()}`).toLowerCase()).replace(/_/g, "-");
  const anyOf = Array.isArray(value.anyOf) ? value.anyOf.map(normalizeTriggerCondition).filter(Boolean) as EvolutionTriggerCondition[] : undefined;
  const allOf = Array.isArray(value.allOf) ? value.allOf.map(normalizeTriggerCondition).filter(Boolean) as EvolutionTriggerCondition[] : undefined;
  const conditions = (anyOf ?? allOf ?? []);
  if (conditions.length === 0) {
    conditions.push({ field: "attributes.durationMs", operator: ">", value: 3000 });
  }
  const useAllOf = Array.isArray(value.allOf) && !Array.isArray(value.anyOf);
  const rule: EvolutionTriggerRule = {
    id,
    projectId,
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
    anyOf: useAllOf ? undefined : conditions,
    allOf: useAllOf ? conditions : undefined,
    minMatchingEvents: Math.max(1, Number(value.minMatchingEvents ?? 1))
  };
  return applyExecutableRuleGuardrails(rule);
}

function normalizeTriggerCondition(item: any): EvolutionTriggerCondition | undefined {
  if (!item || typeof item !== "object") return undefined;
  const field = allowedTriggerField(String(item.field));
  const operator = allowedTriggerOperator(String(item.operator));
  const rawValue = item.value;
  const value = (field === "attributes.ragHit" || field === "attributes.contextTruncated")
    ? normalizeBooleanConditionValue(rawValue)
    : typeof rawValue === "number" ? rawValue : typeof rawValue === "boolean" ? String(rawValue) : String(rawValue ?? "");
  return { field, operator, value };
}

function normalizeBooleanConditionValue(value: unknown): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return value === 0 ? "false" : "true";
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "y", "1", "是", "命中", "已命中", "hit", "matched", "enabled", "on"].includes(text)) return "true";
  if (["false", "no", "n", "0", "否", "未命中", "未匹配", "miss", "missed", "disabled", "off", "未截断"].includes(text)) return "false";
  if (/未命中|没有命中|未匹配|miss|false|否/.test(text)) return "false";
  if (/命中|matched|hit|true|是/.test(text)) return "true";
  if (/未截断|没有截断|not truncated/.test(text)) return "false";
  if (/截断|truncated/.test(text)) return "true";
  return text;
}

function applyExecutableRuleGuardrails(rule: EvolutionTriggerRule): EvolutionTriggerRule {
  const latencyTargetMs = inferLatencyTargetMs(rule.userPrompt ?? rule.name);
  const normalize = (condition: EvolutionTriggerCondition): EvolutionTriggerCondition => {
    const isLatencyField = ["attributes.durationMs", "attributes.latencyMs", "attributes.p95LatencyMs"].includes(condition.field);
    if (isLatencyField && latencyTargetMs) {
      if (!isNumericLike(condition.value) || ((condition.operator === "<" || condition.operator === "<=") && Number(condition.value) >= latencyTargetMs)) {
        return { ...condition, operator: ">", value: latencyTargetMs };
      }
    }
    if ((condition.field === "attributes.ragHit" || condition.field === "attributes.contextTruncated") && !["==", "!="].includes(condition.operator) && ["true", "false"].includes(String(condition.value))) {
      return { ...condition, operator: "==" };
    }
    return condition;
  };
  return {
    ...rule,
    anyOf: rule.anyOf?.map(normalize),
    allOf: rule.allOf?.map(normalize)
  };
}

function inferLatencyTargetMs(prompt: string): number | undefined {
  const text = prompt.replace(/\s+/g, "");
  const seconds = text.match(/(?:小于|低于|不超过|少于|控制在|超过|大于|高于)(\d+(?:\.\d+)?)秒/);
  if (seconds) return Math.round(Number(seconds[1]) * 1000);
  const milliseconds = text.match(/(?:小于|低于|不超过|少于|控制在|超过|大于|高于)(\d+(?:\.\d+)?)(?:ms|毫秒)/i);
  if (milliseconds) return Math.round(Number(milliseconds[1]));
  return undefined;
}

function validateExecutableRule(rule: EvolutionTriggerRule): void {
  const conditions = [...(rule.anyOf ?? []), ...(rule.allOf ?? [])];
  if (conditions.length === 0) throw new Error("规则必须包含至少一个执行条件");
  const errors: string[] = [];
  for (const condition of conditions) {
    if (condition.field.startsWith("attributes.durationMs") || condition.field.startsWith("attributes.latencyMs") || condition.field.startsWith("attributes.p95LatencyMs")) {
      if (!["<", "<=", ">", ">=", "==", "!="].includes(condition.operator)) errors.push(`耗时字段不能使用 ${condition.operator}`);
      if (!isNumericLike(condition.value)) errors.push(`耗时字段必须使用数值阈值，当前为 ${JSON.stringify(condition.value)}`);
    }
    if ((condition.field === "attributes.costUsd" || condition.field === "attributes.totalTokens" || condition.field === "attributes.score" || condition.field === "attributes.errorRate" || condition.field === "attributes.rollbackCount") && !isNumericLike(condition.value)) {
      errors.push(`${condition.field} 必须使用数值阈值`);
    }
    if (condition.field === "attributes.ragHit" || condition.field === "attributes.contextTruncated") {
      if (!["==", "!="].includes(condition.operator)) errors.push(`${condition.field} 只能使用 == 或 !=，不能使用 ${condition.operator}`);
      if (!["true", "false"].includes(String(condition.value))) errors.push(`${condition.field} 必须使用 true/false`);
    }
  }
  const prompt = String(rule.userPrompt ?? rule.name);
  if (/小于\s*3\s*秒|低于\s*3\s*秒|不超过\s*3\s*秒/.test(prompt)) {
    for (const condition of conditions) {
      if (["attributes.durationMs", "attributes.latencyMs", "attributes.p95LatencyMs"].includes(condition.field) && (condition.operator === "<" || condition.operator === "<=") && Number(condition.value) >= 3000) {
        errors.push("用户目标是小于 3 秒，触发条件应表达超过 3000ms 的风险，不能用 <= 3000 作为触发条件");
      }
    }
  }
  if (rule.allOf && hasContradictoryAllOf(rule.allOf)) errors.push("allOf 条件存在明显互相矛盾");
  if (errors.length > 0) throw new Error(errors.join("；"));
}

function isNumericLike(value: string | number): boolean {
  if (typeof value === "string" && value.trim() === "") return false;
  return Number.isFinite(Number(value));
}

function hasContradictoryAllOf(conditions: EvolutionTriggerCondition[]): boolean {
  const byField = new Map<string, EvolutionTriggerCondition[]>();
  for (const condition of conditions) {
    const list = byField.get(condition.field) ?? [];
    list.push(condition);
    byField.set(condition.field, list);
  }
  for (const list of byField.values()) {
    const equals = list.filter((item) => item.operator === "==").map((item) => String(item.value));
    if (new Set(equals).size > 1) return true;
    for (const eq of equals) {
      if (list.some((item) => item.operator === "!=" && String(item.value) === eq)) return true;
    }
    const numeric = list.filter((item) => isNumericLike(item.value));
    for (const gt of numeric.filter((item) => item.operator === ">" || item.operator === ">=")) {
      for (const lt of numeric.filter((item) => item.operator === "<" || item.operator === "<=")) {
        const left = Number(gt.value);
        const right = Number(lt.value);
        if (left > right || (left === right && (gt.operator === ">" || lt.operator === "<"))) return true;
      }
    }
  }
  return false;
}

function isExecutableRuleValid(rule: EvolutionTriggerRule): boolean {
  try {
    validateExecutableRule(rule);
    return true;
  } catch {
    return false;
  }
}

function isRuleInScope(rule: EvolutionTriggerRule, projectId?: string): boolean {
  return !rule.projectId || !projectId || rule.projectId === projectId;
}

function inferRuleProjectId(ruleId: string): string | undefined {
  for (const knownProjectId of ["order-assistant-agent", "knowledge-cs-agent", "domainforge-fabric"]) {
    if (ruleId === knownProjectId || ruleId.startsWith(`${knownProjectId}-`)) return knownProjectId;
  }
  return undefined;
}

function fallbackCompiledRule(projectId: string, userPrompt: string, reason: string): EvolutionTriggerRule {
  return {
    id: safeFileName(userPrompt.toLowerCase()).replace(/_/g, "-") || `rule-${Date.now()}`,
    projectId,
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
  const resolved = resolveJenkinsDeliveryTarget({ store, plan, body, runtime });
  if (resolved.error) throw new HttpError(resolved.statusCode, String(resolved.error.error), resolved.error.detail ? String(resolved.error.detail) : undefined);
  const connector = resolved.connector!;
  const jobName = resolved.jobName!;
  const codeUpgrade = store.findSuccessfulCodeUpgrade(delivery.id);
  const project = store.readProject(plan.projectId);
  const parameters = normalizeDeliveryParameters(delivery, plan, {
    ...(project?.cicd?.parameters ?? {}),
    ...(body.parameters && typeof body.parameters === "object" ? body.parameters : {})
  }, codeUpgrade);
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

function resolveJenkinsDeliveryTarget(args: {
  store: FileStore;
  plan: EvolutionPlan;
  body: any;
  runtime: RuntimeConfig;
}): {
  connectorId?: string;
  connector?: StoredJenkinsConnector;
  jobName?: string;
  statusCode: number;
  error?: { error: string; detail?: string; projectId?: string };
} {
  const { store, plan, body, runtime } = args;
  const project = store.readProject(plan.projectId);
  const projectCicd = project?.cicd?.provider === "jenkins" ? project.cicd : undefined;
  const requestedConnectorId = body.connectorId ? String(body.connectorId).trim() : undefined;
  const connectorId = requestedConnectorId ?? projectCicd?.connectorId ?? (runtime.mode === "debug" ? "default" : undefined);
  if (!connectorId) {
    return {
      statusCode: 409,
      error: {
        error: "CICD_NOT_CONFIGURED",
        detail: "当前项目没有配置项目级 Jenkins，也没有可用的系统默认 Jenkins。代码升级可以完成，但不能进入 CI/CD。",
        projectId: plan.projectId
      }
    };
  }
  const connector = store.readJenkinsConnector(connectorId);
  if (!connector) {
    return {
      statusCode: 400,
      error: {
        error: requestedConnectorId ? "CICD_CONNECTOR_NOT_FOUND" : "CICD_NOT_CONFIGURED",
        detail: `未找到 Jenkins 连接器：${connectorId}`,
        projectId: plan.projectId
      }
    };
  }
  const jobName = String(body.job ?? projectCicd?.job ?? connector.jobTemplates?.[plan.projectId] ?? connector.jobTemplates?.default ?? "").trim();
  if (!jobName) {
    return {
      statusCode: 400,
      error: {
        error: "CICD_JOB_NOT_CONFIGURED",
        detail: `项目 ${plan.projectId} 没有配置 Jenkins Job，且连接器 ${connector.id} 没有默认 Job。`,
        projectId: plan.projectId
      }
    };
  }
  return { connectorId: connector.id, connector, jobName, statusCode: 200 };
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
    `evopilot_release_health ${summary.releaseHealth}`,
    "# TYPE evopilot_slo_health gauge",
    `evopilot_slo_health ${summary.sloHealth ?? 100}`,
    "# TYPE evopilot_cost_health gauge",
    `evopilot_cost_health ${summary.costHealth ?? 100}`,
    "# TYPE evopilot_supply_chain_risks_total gauge",
    `evopilot_supply_chain_risks_total ${summary.supplyChainRiskCount ?? 0}`,
    "# TYPE evopilot_release_readiness_score gauge",
    `evopilot_release_readiness_score ${summary.releaseReadinessScore ?? 100}`,
    "# TYPE evopilot_release_blocked_total gauge",
    `evopilot_release_blocked_total ${summary.releaseBlockedCount ?? 0}`
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
