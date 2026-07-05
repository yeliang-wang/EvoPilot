import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { GitHubHttpAdapter, type GitHubPullRequestDraft } from "@evopilot/adapter-github";
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
  users?: AuthUser[];
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
  proofOpsCoreContractPath?: string;
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
  tenantId?: string;
  workspaceId?: string;
  displayName?: string;
  platformAdmin?: boolean;
  mustChangePassword?: boolean;
}

export interface AuthUser {
  username: string;
  password: string;
  role: AuthRole;
  tenantId: string;
  workspaceId: string;
  displayName?: string;
  token?: string;
  status?: "ACTIVE" | "SUSPENDED";
  platformAdmin?: boolean;
  mustChangePassword?: boolean;
}

const DEFAULT_TENANT_ID = "tenant-production";
const DEFAULT_WORKSPACE_ID = "workspace-agent-products";

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
  tenantId: string;
  workspaceId: string;
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
  writableRoots?: string[];
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

interface SourceCredentialReadiness {
  schema: "evopilot-source-credential-readiness/v1";
  projectId: string;
  provider: ProjectRepositoryProvider | "unknown";
  status: "READY" | "READ_ONLY" | "BLOCKED";
  checks: Array<{
    id: "project" | "provider" | "credential-ref" | "token-resolution" | "source-branch" | "writeback-policy";
    status: "PASS" | "FAIL" | "SKIP";
    evidence: string[];
    required: boolean;
  }>;
  blockers: string[];
  capabilities: string[];
  nextAction: "write-source" | "configure-token-ref" | "repair-project" | "use-local-git";
  checkedAt: string;
}

interface LoopExternalBlocker {
  schema: "evopilot-external-blocker/v1";
  id: string;
  type: "source-credential" | "deploy-target" | "project-binding" | "policy" | "unknown";
  status: "WAITING_HUMAN" | "BLOCKED";
  targetId?: string;
  loopId?: string;
  projectId?: string;
  provider?: ProjectRepositoryProvider | "unknown";
  nextAction: "configure-source-credentials" | "repair-project" | "repair-deploy-target" | "policy-review" | "repair";
  blockers: string[];
  evidence: string[];
  recovery: {
    route: "project-source-credentials" | "deploy-connectors" | "project-settings" | "release-policy" | "loop-repair";
    api?: string;
    dashboardAction?: string;
  };
  createdAt: string;
}

interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  target: string;
  tenantId: string;
  workspaceId: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

type LogLevel = "debug" | "info" | "warn" | "error";
type LogSeverity = "DEBUG" | "INFO" | "WARN" | "ERROR";
type LogCategory = "http" | "auth" | "runtime" | "release" | "worker" | "code-upgrade" | "cicd" | "audit" | "system";
type LogOutcome = "success" | "rejected" | "failed" | "blocked";

interface LogRecord {
  timestamp?: string;
  level: LogLevel;
  schema?: "evopilot-log/v1";
  severity?: LogSeverity;
  service?: "evopilot";
  version?: "1.0.0";
  event: string;
  category?: LogCategory;
  requestId?: string;
  tenantId?: string;
  workspaceId?: string;
  actor?: string;
  role?: AuthRole;
  action?: string;
  target?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  latencyBucket?: string;
  routeGroup?: string;
  outcome?: LogOutcome;
  correlation?: {
    requestId?: string;
    traceId?: string;
    spanId?: string;
    parentRequestId?: string;
    loopId?: string;
    projectId?: string;
    releaseDecisionId?: string;
    releaseRunId?: string;
  };
  diagnosis?: {
    summary?: string;
    likelyCause?: string;
    recommendedAction?: string;
    retriable?: boolean;
    humanActionRequired?: boolean;
  };
  error?: string;
  errorCode?: string;
  stack?: string;
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

interface StoredDeployConnector {
  id: string;
  name: string;
  type: "http-webhook" | "ecs-docker-compose";
  url?: string;
  rollbackUrl?: string;
  method?: "POST";
  token?: string;
  tokenRef?: string;
  headers?: Record<string, string>;
  timeoutSeconds: number;
  workingDir?: string;
  composeFile?: string;
  serviceName?: string;
  gitRemote?: string;
  gitBranch?: string;
  gitPull?: boolean;
  preserveLocalPaths?: string[];
  build?: boolean;
  skipComposeWhenUnchanged?: boolean;
  deployLock?: boolean;
  idempotency?: boolean;
  rollbackOnFailure?: boolean;
  rollbackOnHealthFailure?: boolean;
  gitCommand?: string;
  dockerCommand?: string;
  healthPath?: string;
  readyPath?: string;
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
  tenantId: string;
  workspaceId: string;
  platformAdmin?: boolean;
  mustChangePassword?: boolean;
}

type WorkspaceMemberRole = "owner" | "admin" | "developer" | "viewer";

interface TenantRecord {
  schema: "evopilot-tenant/v1";
  id: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED";
  plan: string;
  createdAt: string;
  updatedAt: string;
}

interface UserRecord {
  schema: "evopilot-user/v1";
  id: string;
  username: string;
  displayName: string;
  role: AuthRole;
  tenantId: string;
  workspaceId: string;
  status: "ACTIVE" | "SUSPENDED";
  platformAdmin: boolean;
  mustChangePassword: boolean;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

interface WorkspaceRecord {
  schema: "evopilot-workspace/v1";
  id: string;
  tenantId: string;
  name: string;
  status: "ACTIVE" | "BOUNDARY_DRAFT" | "SUSPENDED";
  members: Array<{
    id: string;
    name: string;
    role: WorkspaceMemberRole;
    status: "ACTIVE" | "INVITED" | "SUSPENDED";
  }>;
  quotas: {
    loops: number;
    projects: number;
    evidenceGb: number;
  };
  createdAt: string;
  updatedAt: string;
}

type SecretKind = "github-app-private-key" | "github-webhook-secret" | "source-token" | "deploy-token" | "llm-key" | "generic";

interface SecretRecord {
  schema: "evopilot-secret/v1";
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  kind: SecretKind;
  status: "ACTIVE" | "REVOKED";
  version: number;
  encryption: {
    algorithm: "aes-256-gcm";
    iv: string;
    tag: string;
    ciphertext: string;
  };
  createdAt: string;
  updatedAt: string;
  rotatedAt?: string;
  revokedAt?: string;
}

interface GitHubAppInstallationRecord {
  schema: "evopilot-github-app-installation/v1";
  id: string;
  tenantId: string;
  workspaceId: string;
  installationId: string;
  account: string;
  repositories: string[];
  permissions: Record<string, string>;
  privateKeySecretRef?: string;
  webhookSecretRef?: string;
  status: "READY" | "BLOCKED" | "REVOKED";
  checks: Array<{ id: string; status: "PASS" | "FAIL"; evidence: string[] }>;
  createdAt: string;
  updatedAt: string;
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
  intent?: "standard-evolution" | "cost-optimization";
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

interface SoakReport {
  id: string;
  name: string;
  durationSeconds: number;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "STOPPED";
  startedAt: string;
  finishedAt?: string;
  summary?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

type ReleaseScenarioStatus = "PASS" | "FAIL" | "NOT-RUN" | "NOT-APPLICABLE";

interface ReleaseScenarioResult {
  id: string;
  name: string;
  status: ReleaseScenarioStatus;
  evidence: string[];
  required: boolean;
  updatedAt: string;
}

interface ReleaseRisk {
  id: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  source: string;
  status: "OPEN" | "MITIGATED" | "ACCEPTED";
  summary: string;
  evidence: string[];
  recommendedAction: string;
}

interface ReleaseEvidenceBundle {
  id: string;
  tenantId: string;
  workspaceId: string;
  candidate: string;
  status: "GO" | "CONDITIONAL-GO" | "NO-GO";
  releaseTargetId?: string;
  releaseDecisionId?: string;
  generatedAt: string;
  summary: Record<string, unknown>;
  sourceSoakReportIds: string[];
  serviceInventory: Array<{
    id: string;
    type: "evopilot" | "code-upgrader" | "ci" | "connected-project";
    name: string;
    status: "READY" | "WARN" | "BLOCKED";
    endpoint?: string;
    evidence: string;
  }>;
  connectedProjects: Array<{
    id: string;
    name: string;
    repository?: Omit<ProjectRepositoryRegistration, "credentials"> & { credentialsConfigured: boolean };
    cicd?: ProjectCicdConfiguration;
    validation: ProjectValidation;
    releaseReadiness?: ReleaseReadinessReport;
    rolloutStrategy?: RolloutStrategyReport;
  }>;
  scenarioMatrix: ReleaseScenarioResult[];
  riskRegister: ReleaseRisk[];
  artifacts: Array<{
    type: "soak-report" | "pipeline" | "code-upgrade" | "dashboard" | "log" | "other";
    label: string;
    path?: string;
    url?: string;
    status?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface ReleaseEvidenceListItem {
  id: string;
  tenantId: string;
  workspaceId: string;
  candidate: string;
  status: ReleaseEvidenceBundle["status"];
  releaseTargetId?: string;
  releaseDecisionId?: string;
  generatedAt: string;
  summary: {
    projectCount: number;
    runCount: number;
    releaseReadinessScore: number;
    releaseBlockedCount: number;
    rolloutBlockedCount: number;
    releaseDecisionCount: number;
    latestReleaseDecisionId?: string;
  };
  scenarioSummary: {
    total: number;
    passed: number;
    failed: number;
    notRun: number;
    requiredFailed: number;
  };
  riskSummary: {
    total: number;
    open: number;
    highOpen: number;
  };
  createdAt: string;
  updatedAt: string;
}

interface ReleaseTargetProfile {
  id: string;
  name: string;
  description: string;
  minConnectedProjects: number;
  minSucceededSoakSeconds: number;
  requireActiveSoak?: boolean;
  minActiveSoakRunDelta?: number;
  minActiveSoakCodeUpgradeDelta?: number;
  minActiveSoakPipelineDelta?: number;
  minSuccessfulRuns: number;
  minEvaluationDatasets: number;
  minOpportunities: number;
  minSuccessfulEvolutionBatches: number;
  minSuccessfulCodeUpgrades: number;
  minSuccessfulPipelines: number;
  requiredScenarioIds: string[];
  requireNoHighOpenRisks: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ReleaseDecisionCriterion {
  id: string;
  name: string;
  status: "PASS" | "FAIL";
  actual: number | string | boolean;
  target: number | string | boolean;
  evidence: string[];
  required: boolean;
}

interface ReleaseDecision {
  id: string;
  tenantId: string;
  workspaceId: string;
  candidate: string;
  targetId: string;
  evidenceBundleId: string;
  status: "GO" | "CONDITIONAL-GO" | "NO-GO";
  generatedAt: string;
  criteria: ReleaseDecisionCriterion[];
  summary: Record<string, unknown>;
  scenarioMatrix: ReleaseScenarioResult[];
  riskRegister: ReleaseRisk[];
  createdAt: string;
  updatedAt: string;
}

interface ProofOpsCoreContract {
  schema: "proofops-core-contract/v1";
  version: string;
  decisionVocabulary: string[];
  productionReleaseEvidenceRule: string;
  finalReportSchema: "proofops-final-release-report/v1";
  targets?: Array<{ id: string; title?: string; requiredEvidence?: string[] }>;
}

type TargetLoopStatus = "PENDING_PLAN_APPROVAL" | "RUNNING" | "GO" | "NO-GO" | "BLOCKED";
type TargetEvidenceStatus = "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";

interface TargetLoopEvidenceRow {
  capability: string;
  scenario: string;
  requiredEvidence: string;
  status: TargetEvidenceStatus;
  required: boolean;
  blocker: string;
  nextRepairAction: string;
  evidence: string[];
}

interface TargetLoopDecisionStep {
  phase: string;
  rule: string;
  decision: "continue" | "repair blocker" | "block" | "release";
  rationale: string;
  nextAction: string;
  evidence: string[];
}

interface TargetLoopRun {
  schema: "evopilot-proofops-target-loop/v1";
  id: string;
  projectId: string;
  targetId: string;
  releaseTarget: string;
  mode: "proofops-target-loop";
  status: TargetLoopStatus;
  targetPlan: {
    finalGoal: string;
    phaseGoals: string[];
    acceptanceCriteria: string[];
    finalDecision: Array<"GO" | "CONDITIONAL-GO" | "NO-GO" | "BLOCKED">;
    source: "proofops-core-compatible";
    proofOpsCoreVersion?: string;
  };
  targetPlanConfirmation: {
    status: "pending" | "confirmed";
    confirmedAt?: string;
    confirmedBy?: string;
    instruction: string;
  };
  evidenceMatrix: TargetLoopEvidenceRow[];
  decisionChain: TargetLoopDecisionStep[];
  releaseDecision?: {
    id: string;
    status: ReleaseDecision["status"];
    evidenceBundleId: string;
    targetReached: boolean;
    failedCriteria: number;
    highOpenRisks: number;
  };
  finalReport?: {
    schema: "proofops-final-release-report/v1";
    projectId: string;
    releaseTarget: string;
    lifecycleId: string;
    terminalReason: string;
    generatedAt: string;
    targetPlan: TargetLoopRun["targetPlan"];
    targetPlanConfirmation: TargetLoopRun["targetPlanConfirmation"];
    releaseDecision?: TargetLoopRun["releaseDecision"];
    finalTargetSummary: {
      finalGoal: string;
      finalDecision: string;
      targetReached: boolean;
      latestCoverage: {
        required: number;
        passed: number;
        failedOrBlocked: number;
      };
      blocker: string;
      conclusion: string;
    };
    coverageMatrix: TargetLoopEvidenceRow[];
    decisionChain: TargetLoopDecisionStep[];
    productionReleaseRule: string;
  };
  releaseActions: Array<{
    action: string;
    status: "PENDING_APPROVAL" | "APPROVED" | "EXECUTED";
    approvedAt?: string;
    approvedBy?: string;
    executedAt?: string;
    executedBy?: string;
  }>;
  remediationRequests: Array<{
    id: string;
    status: "ROUTED" | "RESOLVED";
    blocker: string;
    routedTo: "evopilot";
    createdAt: string;
    resolvedAt?: string;
  }>;
  artifacts: {
    finalReportJson?: string;
    sourceReleaseEvidenceBundleId?: string;
  };
  createdAt: string;
  updatedAt: string;
}

type LoopRunStatus = "PENDING" | "RUNNING" | "WAITING_APPROVAL" | "BLOCKED" | "SUCCEEDED" | "FAILED" | "CANCELLED";
type LoopTriggerSource = "api" | "im" | "schedule" | "runtime-signal" | "release-target" | "evolution-batch";
type LoopDecision = "CONTINUE" | "REPAIR" | "BLOCK" | "WAIT_APPROVAL" | "SUCCEED" | "FAIL";
type ExecutorNodeType = "llm" | "code-upgrader" | "ci" | "validator" | "approval" | "release-action";
type LoopStoreBackendType = "file" | "sqlite" | "postgres";
type LoopExecutorMode = "serial" | "parallel";
type LoopSandboxRuntimeType = "host" | "docker" | "k8s";
type LoopSourceClosureState = "PLANNED" | "CODE_CHANGED" | "PUSHED" | "TAGGED" | "DEPLOYED" | "HEALTH_READY" | "HEALTH_FAILED" | "ROLLED_BACK" | "PROMOTED" | "FAILED";
type LoopSourceClosureGate = "code-change" | "push" | "tag" | "deploy" | "health-ready";
type SourceReleaseClosureStage = LoopSourceClosureGate | "review" | "policy" | "merge";
type SourceReleaseReviewStatus = "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED" | "MERGED";
type SourceReleasePolicyStatus = "PASS" | "BLOCKED";
type SourceReleasePostMergeDeployStatus = "NOT_REQUIRED" | "SUCCEEDED" | "FAILED" | "ROLLED_BACK";
const REPAIRABLE_SOURCE_RELEASE_RUN_STATUSES: LoopSourceClosureState[] = ["FAILED", "HEALTH_FAILED", "ROLLED_BACK"];

interface SourceReleaseClosureRun {
  schema: "evopilot-source-release-closure-run/v1";
  id: string;
  loopId: string;
  projectId: string;
  sourceProjectId: string;
  tenantId: string;
  workspaceId: string;
  provider: LoopSourceClosure["repositoryProvider"];
  releaseStrategy: LoopSourceClosure["releaseStrategy"];
  sourceRef: {
    sourceUrl?: string;
    sourceRoot?: string;
    sourceBranch: string;
    releaseBranch?: string;
  };
  targetVersion?: string;
  deploymentEnvironment?: string;
  status: LoopSourceClosureState;
  stages: Array<{
    gate: SourceReleaseClosureStage;
    label: string;
    status: "PENDING" | "PASSED" | "FAILED" | "SKIPPED";
    evidence: string[];
    checkedAt?: string;
  }>;
  artifacts: LoopSourceClosure["artifacts"];
  review: {
    status: SourceReleaseReviewStatus;
    reviewUrl?: string;
    approvedBy?: string;
    approvedAt?: string;
    rejectedBy?: string;
    rejectedAt?: string;
    mergedBy?: string;
    mergedAt?: string;
    mergeCommitSha?: string;
  };
  policy: {
    status: SourceReleasePolicyStatus;
    evaluatedAt?: string;
    autoMerge: boolean;
    blockers: string[];
    checks: Array<{
      id: string;
      status: "PASS" | "FAIL";
      evidence: string[];
      required: boolean;
    }>;
  };
  postMergeDeployment?: {
    status: SourceReleasePostMergeDeployStatus;
    deployedAt?: string;
    deployedBy?: string;
    deploymentId?: string;
    deploymentUrl?: string;
    healthUrl?: string;
    readyUrl?: string;
    evidence: string[];
  };
  capabilities: string[];
  nextAction: "write-source" | "open-review" | "approve-review" | "policy-review" | "merge-review" | "tag" | "deploy" | "probe-health" | "rollback" | "promoted" | "failed";
  createdAt: string;
  updatedAt: string;
  actor?: string;
}

interface SourceReleaseDeployFinalizer {
  schema: "evopilot-source-release-deploy-finalizer/v1";
  id: string;
  loopId: string;
  releaseRunId?: string;
  deployConnectorId: string;
  actor: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  createdAt: string;
  updatedAt: string;
  artifacts: LoopSourceClosure["artifacts"];
  deploymentEnvironment?: string;
  healthUrl?: string;
  readyUrl?: string;
  attempts: number;
  maxAttempts: number;
  evidence: string[];
  lastError?: string;
}

interface SourceClosurePreflightResult {
  schema: "evopilot-source-closure-preflight/v1";
  loopId: string;
  projectId: string;
  sourceProjectId: string;
  provider: LoopSourceClosure["repositoryProvider"];
  status: "PASS" | "FAIL";
  blockers: string[];
  checks: Array<{
    id: "project-binding" | "provider" | "credentials" | "source-branch" | "deploy-target" | "health-ready";
    status: "PASS" | "FAIL" | "SKIP";
    evidence: string[];
    required: boolean;
  }>;
  capabilities: string[];
  nextAction: "write-source" | "repair-credentials" | "repair-project" | "repair-deploy-target";
  createdAt: string;
}

interface SourceReleaseRunRepairCandidate {
  schema: "evopilot-source-release-repair-candidate/v1";
  id: string;
  loopId: string;
  runId: string;
  projectId: string;
  sourceProjectId: string;
  provider: LoopSourceClosure["repositoryProvider"];
  status: LoopSourceClosureState;
  reason: string;
  suggestedAction: "repair-source-closure" | "inspect-existing-repair";
  latestForLoop: boolean;
  repaired: boolean;
  supersededByRunId?: string;
  ageSeconds: number;
  evidence: string[];
  createdAt: string;
}

interface SourceReleaseRunRepairQueueResult {
  schema: "evopilot-source-release-repair-queue/v1";
  repaired: Array<{
    runId: string;
    loopId: string;
    status: LoopSourceClosureState;
    action: "repair-and-execute" | "repair-intent";
    repairedRunId: string;
  }>;
  failed: Array<{
    runId: string;
    loopId: string;
    error: string;
  }>;
  skipped: Array<{
    runId: string;
    loopId: string;
    reason: string;
  }>;
}

interface LoopStopPolicy {
  maxIterations: number;
  maxDurationSeconds: number;
  requireApprovalForRelease: boolean;
  stopOnRepeatedFailure: number;
}

interface LoopRetryPolicy {
  maxAttemptsPerNode: number;
  backoffSeconds: number;
  circuitBreakerFailures: number;
}

interface ExecutorNode {
  id: string;
  type: ExecutorNodeType;
  name: string;
  config: Record<string, unknown>;
}

interface ExecutorEdge {
  from: string;
  to: string;
  type: "sequence" | "conditional" | "fan-out" | "fan-in";
  condition?: string;
  inputSchemaRef?: string;
  outputSchemaRef?: string;
}

interface ExecutorGraph {
  schema: "evopilot-executor-graph/v1";
  id: string;
  name: string;
  nodes: ExecutorNode[];
  edges: ExecutorEdge[];
  mode: LoopExecutorMode;
  validation: {
    status: "PASSED" | "FAILED";
    evidence: string[];
  };
  capabilities: {
    typedEdges: boolean;
    conditionalRouting: boolean;
    fanOutFanIn: boolean;
    nestedSubgraphs: boolean;
    schemaValidation: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

interface ExecutorStepResult {
  nodeId: string;
  type: ExecutorNodeType;
  status: "SKIPPED" | "SUCCEEDED" | "FAILED" | "WAITING_APPROVAL";
  startedAt: string;
  completedAt?: string;
  attempt: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  evidence: string[];
  failureSignature?: string;
}

interface LoopSandboxPolicy {
  runtime: LoopSandboxRuntimeType;
  image?: string;
  namespace?: string;
  credentialScope: "none" | "loop" | "project";
  network: "disabled" | "restricted" | "enabled";
  allowedPaths: string[];
  deniedPaths: string[];
  resourceLimits: {
    cpu: string;
    memoryMb: number;
    pids: number;
  };
}

interface LoopSandboxEnforcement {
  status: "ENFORCED" | "POLICY_ONLY" | "FAILED";
  runtime: LoopSandboxRuntimeType;
  evidence: string[];
  restrictions: {
    network: LoopSandboxPolicy["network"];
    credentialScope: LoopSandboxPolicy["credentialScope"];
    allowedPaths: string[];
    deniedPaths: string[];
  };
}

interface LoopSandboxBoundaryProof {
  schema: "evopilot-loop-sandbox-boundary-proof/v1";
  loopId: string;
  runtime: LoopSandboxRuntimeType;
  status: LoopSandboxEnforcement["status"];
  executableBoundary: {
    dockerArgs?: string[];
    k8sManifest?: Record<string, unknown>;
    workspaceMount: string;
    networkMode: string;
    credentialMode: string;
    readOnlyRootFilesystem: boolean;
    resourceLimits: LoopSandboxPolicy["resourceLimits"];
  };
  checks: Array<{
    id: string;
    status: "PASS" | "FAIL" | "WARN";
    evidence: string[];
  }>;
  blocksNonHumanExecutors: boolean;
  createdAt: string;
}

interface LoopSourceClosure {
  sourceProjectId: string;
  repositoryProvider: ProjectRepositoryProvider | "unknown";
  sourceUrl?: string;
  sourceRoot?: string;
  sourceBranch: string;
  controlPlaneUrl?: string;
  targetVersion?: string;
  releaseStrategy: "none" | "github-push" | "gitlab-merge-request" | "local-git-commit";
  requiredGates: LoopSourceClosureGate[];
  deploymentEnvironment?: string;
  deploymentConnectorId?: string;
  closureState: LoopSourceClosureState;
  gateEvidence: Partial<Record<LoopSourceClosureGate, {
    status: "PENDING" | "PASSED" | "FAILED" | "SKIPPED";
    evidence: string[];
    checkedAt: string;
  }>>;
  artifacts: {
    branch?: string;
    commitSha?: string;
    mergeCommitSha?: string;
    pullRequestUrl?: string;
    pullRequestNumber?: number;
    mergeRequestUrl?: string;
    mergeRequestIid?: number;
    reviewStatus?: SourceReleaseReviewStatus;
    approvedAt?: string;
    approvedBy?: string;
    rejectedAt?: string;
    rejectedBy?: string;
    mergedAt?: string;
    mergedBy?: string;
    policyStatus?: SourceReleasePolicyStatus;
    policyBlockers?: string[];
    policyEvaluatedAt?: string;
    autoMerge?: boolean;
    postMergeDeployStatus?: SourceReleasePostMergeDeployStatus;
    postMergeDeployAt?: string;
    postMergeDeployBy?: string;
    tag?: string;
    deploymentConnectorId?: string;
    deploymentId?: string;
    deploymentUrl?: string;
    deployStatusUrl?: string;
    healthUrl?: string;
    readyUrl?: string;
    executedAt?: string;
    executedBy?: string;
  };
}

interface ExecutorCoordinationPlan {
  mode: LoopExecutorMode;
  sharedContextKeys: string[];
  nodes: Array<{
    nodeId: string;
    type: ExecutorNodeType;
    adapterId?: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    dependsOn: string[];
  }>;
}

interface LoopStoreRuntime {
  backend: LoopStoreBackendType;
  dsn?: string;
  durable: boolean;
  lockProvider: "file-lease" | "sqlite-transaction" | "postgres-advisory-lock";
  recovery: "idempotent-replay";
}

interface LoopTraceSummary {
  id: string;
  loopId: string;
  status: LoopRunStatus;
  currentIteration: number;
  executorStepCount: number;
  failedStepCount: number;
  workerLease?: LoopWorkerLease;
  watchdog: {
    expiredLease: boolean;
    ageSeconds: number;
  };
  cost: {
    estimatedUsd: number;
    totalTokens: number;
  };
  failureSignatures: Array<{
    signature: string;
    count: number;
  }>;
  updatedAt: string;
}

interface ExecutorAdapterExecutionInput {
  node: ExecutorNode;
  loop: LoopRun;
  iterationIndex: number;
  attempt: number;
  previousFailureCount: number;
  forceDecision?: LoopDecision;
  workspaceRoot: string;
  nodeWorkspace: string;
  coordination: ExecutorCoordinationPlan;
  sandbox: LoopSandboxPolicy;
  sandboxEnforcement: LoopSandboxEnforcement;
  now: string;
  llmClient?: LlmTaskClient;
  requireLlm: boolean;
}

interface ExecutorAdapterExecutionOutput {
  status: ExecutorStepResult["status"];
  output: Record<string, unknown>;
  evidence: string[];
  completedAt?: string;
  failureSignature?: string;
}

interface ExecutorAdapter {
  id: string;
  nodeType: ExecutorNodeType;
  execute(input: ExecutorAdapterExecutionInput): ExecutorAdapterExecutionOutput | Promise<ExecutorAdapterExecutionOutput>;
}

interface LoopEvidenceSet {
  id: string;
  loopRunId: string;
  iterationId: string;
  validator: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  evidence: string[];
  artifacts: LoopArtifact[];
  createdAt: string;
}

interface LoopArtifact {
  id: string;
  type: "plan" | "diff" | "ci-log" | "report" | "approval" | "generic";
  label: string;
  path?: string;
  url?: string;
  createdAt: string;
}

interface LoopTimelineEvent {
  id: string;
  type: "CREATED" | "STARTED" | "ITERATION" | "EVIDENCE" | "DECISION" | "APPROVAL" | "HEARTBEAT" | "LEASE" | "WATCHDOG" | "REPLAY" | "CANCELLED";
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface LoopWorkerLease {
  workerId: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

interface LoopWorkerQueueItem {
  loopId: string;
  status: LoopRunStatus;
  objective: string;
  currentIteration: number;
  maxIterations: number;
  claimable: boolean;
  leaseExpired: boolean;
  workerLease?: LoopWorkerLease;
  sideEffectGuard: {
    sourceClosureState: LoopSourceClosureState;
    duplicateSourceClosureBlocked: boolean;
  };
  nextAction: "claim" | "renew" | "wait-approval" | "source-closure" | "blocked";
}

interface LoopWorkerQueueClaim {
  schema: "evopilot-loop-worker-claim/v1";
  workerId: string;
  claimed?: LoopWorkerQueueItem;
  queue: LoopWorkerQueueItem[];
  evidence: string[];
  createdAt: string;
}

interface LoopIteration {
  id: string;
  loopRunId: string;
  index: number;
  startedAt: string;
  completedAt?: string;
  executorSteps: ExecutorStepResult[];
  evidenceSetId?: string;
  decision: LoopDecision;
  rationale: string;
  replayOfIterationId?: string;
  contextPatch?: Record<string, unknown>;
  traceId: string;
}

interface LoopCheckpoint {
  schema: "evopilot-loop-checkpoint/v1";
  id: string;
  loopId: string;
  iterationIndex: number;
  iterationId: string;
  status: LoopRunStatus;
  decision: LoopDecision;
  contextSnapshot: Record<string, unknown>;
  contextPatch?: Record<string, unknown>;
  evidenceSetId?: string;
  executorOutputs: Array<{
    nodeId: string;
    status: ExecutorStepResult["status"];
    output: Record<string, unknown>;
    failureSignature?: string;
  }>;
  replayable: boolean;
  createdAt: string;
}

interface LoopReplayDiff {
  schema: "evopilot-loop-replay-diff/v1";
  loopId: string;
  fromIteration: number;
  previousIterationId?: string;
  replayIterationId?: string;
  contextChangedKeys: string[];
  executorOutputChanges: Array<{
    nodeId: string;
    beforeStatus?: ExecutorStepResult["status"];
    afterStatus?: ExecutorStepResult["status"];
    beforeOutput?: Record<string, unknown>;
    afterOutput?: Record<string, unknown>;
    changed: boolean;
  }>;
  evidence: string[];
  createdAt: string;
}

interface LoopStreamEvent {
  schema: "evopilot-loop-stream-event/v1";
  id: string;
  loopId: string;
  type: "timeline" | "executor-step" | "checkpoint" | "worker-lease" | "watchdog" | "cost" | "failure-group" | "replay-diff" | "sandbox-proof" | "executor-graph";
  timestamp: string;
  label: string;
  payload: Record<string, unknown>;
}

interface LoopTraceTree {
  schema: "evopilot-loop-trace-tree/v1";
  loopId: string;
  root: {
    id: string;
    label: string;
    status: LoopRunStatus;
  };
  nodes: Array<{
    id: string;
    parentId?: string;
    type: "loop" | "iteration" | "executor-step" | "checkpoint" | "worker-lease" | "failure-group" | "replay-diff" | "sandbox-proof" | "executor-graph";
    label: string;
    status: string;
    costUsd?: number;
    tokens?: number;
    evidence: string[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: "contains" | "emits" | "replays" | "fails-with" | "guards";
  }>;
  summary: {
    checkpointCount: number;
    eventCount: number;
    failureGroupCount: number;
    replayDiffCount: number;
    sandboxProofStatus: LoopSandboxEnforcement["status"];
  };
  createdAt: string;
}

interface LoopRun {
  schema: "evopilot-loop-run/v1";
  id: string;
  source: LoopTriggerSource;
  projectId: string;
  tenantId: string;
  workspaceId: string;
  objective: string;
  status: LoopRunStatus;
  currentIteration: number;
  executorGraphId: string;
  controlPlaneUrl?: string;
  sourceClosure: LoopSourceClosure;
  stopPolicy: LoopStopPolicy;
  retryPolicy: LoopRetryPolicy;
  context: Record<string, unknown>;
  store: LoopStoreRuntime;
  sandbox: LoopSandboxPolicy;
  sandboxEnforcement: LoopSandboxEnforcement;
  coordination: ExecutorCoordinationPlan;
  trace: LoopTraceSummary;
  iterations: LoopIteration[];
  evidenceSets: LoopEvidenceSet[];
  artifacts: LoopArtifact[];
  approvals: Array<{
    id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    reason: string;
    requestedAt: string;
    decidedAt?: string;
    decidedBy?: string;
  }>;
  workerLease?: LoopWorkerLease;
  timeline: LoopTimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

type LoopOrchestrationTargetStatus = "PENDING" | "RUNNING" | "WAITING_HUMAN" | "DONE" | "BLOCKED";

interface LoopOrchestrationTarget {
  id: string;
  title: string;
  layer: "sandbox" | "context" | "harness" | "loop";
  presetId: string;
  objective: string;
  acceptanceCriteria: string[];
  status: LoopOrchestrationTargetStatus;
  loopId?: string;
  nextAction: "create-loop" | "start-loop" | "resume-loop" | "human-approval" | "source-closure" | "configure-source-credentials" | "repair-project" | "repair-deploy-target" | "policy-review" | "done" | "repair";
  evidence: string[];
  externalBlocker?: LoopExternalBlocker;
}

interface LoopOrchestrationAdvanceResult {
  schema: "evopilot-loop-orchestration-advance/v1";
  target: LoopOrchestrationTarget;
  loop?: LoopRun;
  action: LoopOrchestrationTarget["nextAction"];
  advanced: boolean;
  evidence: string[];
  createdAt: string;
}

interface LoopOrchestrationAutopilotResult {
  schema: "evopilot-loop-orchestration-autopilot/v1";
  status: "SUCCEEDED" | "BLOCKED" | "FAILED";
  target: LoopOrchestrationTarget;
  loop?: LoopRun;
  releaseRun?: SourceReleaseClosureRun;
  stages: Array<{
    id: "advance" | "iterate" | "human-gate" | "source-preflight" | "external-blocker" | "source-closure" | "safe-auto-merge";
    status: "SUCCEEDED" | "SKIPPED" | "BLOCKED" | "FAILED";
    detail: string;
    evidence: string[];
  }>;
  nextAction: "done" | "human-approval" | "source-closure" | "configure-source-credentials" | "repair-project" | "repair-deploy-target" | "policy-review" | "repair";
  externalBlocker?: LoopExternalBlocker;
  evidence: string[];
  createdAt: string;
}

interface DiscoverySkillCandidate {
  schema: "evopilot-discovery-skill-candidate/v1";
  id: string;
  projectId: string;
  targetId: string;
  title: string;
  source: "repository" | "trace" | "evaluation" | "production" | "manual";
  confidence: number;
  affectedFiles: string[];
  acceptanceCriteria: string[];
  evidence: string[];
  status: "CANDIDATE" | "ACCEPTED" | "REJECTED" | "CONVERTED";
  createdAt: string;
  updatedAt: string;
}

interface FindingWorktreeHandoff {
  schema: "evopilot-finding-worktree-handoff/v1";
  id: string;
  findingId: string;
  projectId: string;
  provider: ProjectRepositoryProvider | "unknown";
  workspaceRoot: string;
  sourceBranch: string;
  targetBranch: string;
  allowedPaths: string[];
  validationCommands: string[];
  rollbackRef?: string;
  status: "ALLOCATED" | "RESUMABLE" | "ARCHIVED";
  evidence: string[];
  createdAt: string;
  updatedAt: string;
}

interface AdversarialEvaluation {
  schema: "evopilot-adversarial-evaluation/v1";
  id: string;
  loopId?: string;
  projectId: string;
  targetId?: string;
  status: "PASS" | "WARN" | "BLOCK";
  checkedInputs: string[];
  missingEvidence: string[];
  failureSignatures: string[];
  suggestedActions: string[];
  evidence: string[];
  createdAt: string;
}

interface RecurringLoopSchedule {
  schema: "evopilot-recurring-loop-schedule/v1";
  id: string;
  projectId: string;
  targetId: string;
  cadence: "manual" | "hourly" | "daily" | "weekly";
  maxBudgetUsd: number;
  triggerRules: string[];
  status: "ACTIVE" | "PAUSED" | "BLOCKED";
  lastRunAt?: string;
  nextRunAt: string;
  idempotencyKey: string;
  evidence: string[];
  createdAt: string;
  updatedAt: string;
}

interface LoopMemoryInboxItem {
  schema: "evopilot-loop-memory-inbox-item/v1";
  id: string;
  projectId: string;
  type: "finding" | "evaluation" | "feedback" | "release-learning" | "operator-note";
  title: string;
  body: string;
  status: "NEW" | "ACCEPTED" | "MERGED" | "SNOOZED" | "REJECTED" | "CONVERTED";
  targetId?: string;
  provenance: string[];
  evidence: string[];
  createdAt: string;
  updatedAt: string;
}

interface LoopGuardrailEvaluation {
  schema: "evopilot-budget-judgment-guardrail/v1";
  id: string;
  loopId: string;
  projectId: string;
  status: "PASS" | "WARN" | "BLOCK";
  budgets: {
    maxCostUsd: number;
    maxTokens: number;
    maxDurationSeconds: number;
    maxChangedFiles: number;
    minConfidence: number;
  };
  actual: {
    costUsd: number;
    tokens: number;
    durationSeconds: number;
    changedFiles: number;
    confidence: number;
  };
  releaseJudgment: "ALLOW" | "HUMAN_REVIEW" | "BLOCK";
  blockers: string[];
  evidence: string[];
  createdAt: string;
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
  const profile = options.profile ?? domainforgeFabricProfile;
  const runtime = resolveRuntimeConfig(options);
  const llmClient = options.llmClient ?? createLlmClientFromEnv();
  const requireLlm = runtime.requireLlm;
  const tokens = normalizeTokens(options);
  const store = new FileStore(options.dataRoot, { llmClient, requireLlm });
  store.ensureBootstrapAdmin();
  const users = normalizeUsers(options, tokens, runtime, store);
  const authTokens = mergeUserTokens(tokens, users);
  const explicitAuthConfigured = tokens.length > 0 || Boolean(options.users?.length) || Boolean(parseEnvUsers(process.env.EVOPILOT_USERS)?.length);
  assertProductionRuntimeIsConfigured(runtime, authTokens, llmClient);
  const proofOpsCore = loadProofOpsCoreContract(options.proofOpsCoreContractPath);
  store.ensureRuleMemories(profile.triggerRules ?? defaultTriggerRules);
  if (runtime.autoRegisterProfileProject) {
    store.ensureProject({
      id: profile.id,
      name: profile.name,
      profileId: profile.id,
      tenantId: DEFAULT_TENANT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      validation: {
        status: "VERIFIED",
        checkedAt: new Date().toISOString(),
        message: "调试模式内置项目画像已验证"
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  logInfo("server.configured", {
    metadata: {
      runtimeMode: runtime.mode,
      dataRoot: options.dataRoot,
      authRequired: authTokens.length > 0,
      loginEnabled: users.length > 0,
      profileId: profile.id,
      dashboardEnabled: Boolean(options.dashboardRoot)
    }
  });
  void reconcilePendingSourceReleaseDeployFinalizers(store).catch((error) => logError("source-release.deploy-finalizer.reconcile-failed", error));

  return http.createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestId = requestHeader(request, "x-request-id") || randomUUID();
    const traceId = requestHeader(request, "traceparent")?.split("-")[1] || requestHeader(request, "x-trace-id");
    const parentRequestId = requestHeader(request, "x-parent-request-id");
    let requestAuth: AuthContext | undefined;
    response.setHeader("x-request-id", requestId);
    let url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      const statusCode = response.statusCode;
      logInfo("http.request.completed", {
        requestId,
        tenantId: requestAuth?.tenantId,
        workspaceId: requestAuth?.workspaceId,
        actor: requestAuth?.actor,
        role: requestAuth?.role,
        method: request.method,
        path: url.pathname,
        statusCode,
        durationMs,
        latencyBucket: latencyBucket(durationMs),
        routeGroup: routeGroup(url.pathname),
        outcome: httpOutcome(statusCode),
        correlation: {
          requestId,
          traceId,
          parentRequestId,
          loopId: url.searchParams.get("loopId") ?? undefined,
          projectId: url.searchParams.get("projectId") ?? undefined,
          releaseDecisionId: url.searchParams.get("releaseDecisionId") ?? undefined,
          releaseRunId: url.searchParams.get("releaseRunId") ?? undefined
        },
        diagnosis: diagnosisForHttpStatus(statusCode),
        metadata: {
          query: redactUrlSearch(url.searchParams),
          userAgent: requestHeader(request, "user-agent")
        }
      });
    });
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
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
      if (request.method === "GET" && url.pathname === "/api/v1/auth/bootstrap") {
        return writeJson(response, 200, envelope({
          initialized: store.listUsers(undefined, true).some((user) => user.platformAdmin),
          defaultAdminRequiresPasswordChange: Boolean(store.readUser("admin")?.mustChangePassword)
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/auth/login") {
        const body = await readJson(request, options.maxBodyBytes) as Record<string, unknown>;
        const username = optionalTrimmedString(body.username);
        const password = body.password === undefined || body.password === null ? "" : String(body.password);
        const liveUsers = normalizeUsers(options, tokens, runtime, store);
        const matched = liveUsers.find((user) => user.username === username && verifyPassword(password, user.password));
        if (!matched) {
          logWarn("auth.login.rejected", {
            requestId,
            category: "auth",
            outcome: "rejected",
            errorCode: "INVALID_CREDENTIALS",
            error: "INVALID_CREDENTIALS",
            metadata: { username: username ?? "" }
          });
          return writeJson(response, 401, { error: "INVALID_CREDENTIALS", detail: "用户名或密码错误" });
        }
        if (matched.status === "SUSPENDED") {
          return writeJson(response, 403, { error: "USER_SUSPENDED", detail: "账号已停用，请联系管理员" });
        }
        const persisted = store.readUser(matched.username);
        if (persisted) {
          store.writeUser({ ...persisted, lastLoginAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        }
        logInfo("auth.login.succeeded", {
          requestId,
          category: "auth",
          tenantId: matched.tenantId,
          workspaceId: matched.workspaceId,
          actor: matched.username,
          role: matched.role
        });
        return writeJson(response, 200, envelope({
          token: userSessionToken(matched),
          user: publicUser(matched)
        }));
      }
      const auth = authorize(request, mergeUserTokens(tokens, normalizeUsers(options, tokens, runtime, store)), runtime, !explicitAuthConfigured);
      requestAuth = auth ?? undefined;
      if (!auth) {
        logWarn("http.request.rejected", {
          requestId,
          method: request.method,
          path: url.pathname,
          statusCode: 401,
          routeGroup: routeGroup(url.pathname),
          outcome: "rejected",
          errorCode: "UNAUTHORIZED",
          error: "UNAUTHORIZED",
          correlation: { requestId, traceId, parentRequestId },
          diagnosis: diagnosisForHttpStatus(401)
        });
        return writeJson(response, 401, { error: "UNAUTHORIZED" });
      }
      if (request.method === "POST" && url.pathname === "/api/v1/auth/change-password") {
        const user = store.readUser(auth.actor);
        if (!user) return writeJson(response, 404, { error: "USER_NOT_FOUND" });
        const body = await readJson(request, options.maxBodyBytes) as Record<string, unknown>;
        const currentPassword = body.currentPassword === undefined || body.currentPassword === null ? "" : String(body.currentPassword);
        const nextPassword = body.newPassword === undefined || body.newPassword === null ? "" : String(body.newPassword);
        if (!verifyPassword(currentPassword, user.passwordHash)) return writeJson(response, 403, { error: "CURRENT_PASSWORD_INVALID" });
        if (nextPassword.trim().length < 4) return writeJson(response, 400, { error: "PASSWORD_TOO_SHORT" });
        if (user.username === "admin" && nextPassword === "admin") return writeJson(response, 400, { error: "DEFAULT_ADMIN_PASSWORD_FORBIDDEN" });
        const updated = store.writeUser({ ...user, passwordHash: hashPassword(nextPassword), mustChangePassword: false, updatedAt: new Date().toISOString() });
        store.appendAudit(audit(auth, "user.password.changed", updated.id, { selfService: true }));
        return writeJson(response, 200, envelope(publicUser(authUserFromRecord(updated))));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/summary") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.summary()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/metrics") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeText(response, 200, renderMetrics(store.summary(), store.saasObservability()));
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
          activeBatchTimeoutMinutes: body.activeBatchTimeoutMinutes === undefined ? 120 : Number(body.activeBatchTimeoutMinutes),
          dryRun: Boolean(body.dryRun)
        });
        for (const batch of result.created) {
          store.appendAudit(audit(auth, "evolution-batch.created", batch.id, { projectId: batch.projectId, datasetIds: batch.datasetIds, opportunityIds: batch.opportunityIds }));
        }
        return writeJson(response, result.created.length > 0 ? 201 : 200, envelope(result));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/soak-reports") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listSoakReports().slice(-50).reverse()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/soak-reports") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const report = store.writeSoakReport({
          id: body.id ? String(body.id) : undefined,
          name: body.name ? String(body.name) : undefined,
          durationSeconds: Number(body.durationSeconds ?? 0),
          status: normalizeSoakReportStatus(body.status),
          startedAt: body.startedAt ? String(body.startedAt) : undefined,
          finishedAt: body.finishedAt ? String(body.finishedAt) : undefined,
          summary: isRecord(body.summary) ? body.summary : undefined
        });
        store.appendAudit(audit(auth, "soak-report.upserted", report.id, { status: report.status, durationSeconds: report.durationSeconds }));
        return writeJson(response, 201, envelope(report));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/release/targets") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listReleaseTargets()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/release/targets") {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const target = store.writeReleaseTarget(normalizeReleaseTarget(body));
        store.appendAudit(audit(auth, "release-target.upserted", target.id, { minConnectedProjects: target.minConnectedProjects, requiredScenarioIds: target.requiredScenarioIds }));
        return writeJson(response, 201, envelope(target));
      }
      const releaseTargetMatch = url.pathname.match(/^\/api\/v1\/release\/targets\/([^/]+)$/);
      if (request.method === "GET" && releaseTargetMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const target = store.readReleaseTarget(decodeURIComponent(releaseTargetMatch[1]));
        if (!target) return writeJson(response, 404, { error: "RELEASE_TARGET_NOT_FOUND" });
        return writeJson(response, 200, envelope(target));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/release/decisions") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const targetId = optionalTrimmedString(url.searchParams.get("targetId"));
        const currentOnly = url.searchParams.get("current") === "true";
        const decisions = store.listReleaseDecisions()
          .filter((decision) => canAccessScopedResource(auth, decision.tenantId, decision.workspaceId))
          .filter((decision) => !targetId || decision.targetId === targetId);
        if (currentOnly) {
          const current = currentReleaseDecision(decisions);
          return writeJson(response, 200, envelope(current ? [current] : []));
        }
        return writeJson(response, 200, envelope(decisions
          .slice(-20)
          .reverse()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/tenants") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const tenants = auth.platformAdmin ? store.listTenants() : store.listTenants().filter((tenant) => tenant.id === auth.tenantId);
        return writeJson(response, 200, envelope(tenants));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/tenants") {
        if (!auth.platformAdmin) return writeJson(response, 403, { error: "PLATFORM_ADMIN_REQUIRED" });
        const body = await readJson(request, options.maxBodyBytes);
        const now = new Date().toISOString();
        const tenantId = safeFileName(optionalTrimmedString(body.id) ?? optionalTrimmedString(body.name) ?? `tenant-${Date.now()}`);
        const tenant = store.writeTenant({
          schema: "evopilot-tenant/v1",
          id: tenantId,
          name: optionalTrimmedString(body.name) ?? tenantId,
          status: normalizeTenantStatus(body.status),
          plan: optionalTrimmedString(body.plan) ?? "SaaS",
          createdAt: store.readTenant(tenantId)?.createdAt ?? now,
          updatedAt: now
        });
        store.appendAudit(audit(auth, "tenant.upserted", tenant.id, { status: tenant.status, plan: tenant.plan }));
        return writeJson(response, 201, envelope(tenant));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/users") {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const tenantId = auth.platformAdmin ? optionalTrimmedString(url.searchParams.get("tenantId")) : auth.tenantId;
        return writeJson(response, 200, envelope(store.listUsers(tenantId, true).map(maskUser)));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/users") {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes) as Record<string, unknown>;
        const username = optionalTrimmedString(body.username);
        const password = body.password === undefined || body.password === null ? "change-me" : String(body.password);
        if (!username) return writeJson(response, 400, { error: "USERNAME_REQUIRED" });
        if (store.readUser(username)) return writeJson(response, 409, { error: "USER_ALREADY_EXISTS" });
        const tenantId = safeFileName(optionalTrimmedString(body.tenantId) ?? auth.tenantId);
        if (!auth.platformAdmin && tenantId !== auth.tenantId) return writeJson(response, 403, { error: "TENANT_FORBIDDEN" });
        const workspaceId = safeFileName(optionalTrimmedString(body.workspaceId) ?? auth.workspaceId);
        const workspace = store.readWorkspace(workspaceId);
        if (workspace && workspace.tenantId !== tenantId) return writeJson(response, 409, { error: "USER_WORKSPACE_TENANT_MISMATCH" });
        const platformAdmin = Boolean(auth.platformAdmin && Boolean(body.platformAdmin));
        if (!auth.platformAdmin && platformAdmin) return writeJson(response, 403, { error: "PLATFORM_ADMIN_REQUIRED" });
        const now = new Date().toISOString();
        const user = store.writeUser({
          schema: "evopilot-user/v1",
          id: safeFileName(username),
          username,
          displayName: optionalTrimmedString(body.displayName) ?? username,
          role: normalizeAuthRole(body.role, "viewer"),
          tenantId,
          workspaceId,
          status: normalizeUserStatus(body.status),
          platformAdmin,
          mustChangePassword: body.mustChangePassword === undefined ? true : Boolean(body.mustChangePassword),
          passwordHash: hashPassword(password),
          createdAt: now,
          updatedAt: now
        });
        store.appendAudit(audit(auth, "user.created", user.id, { tenantId: user.tenantId, workspaceId: user.workspaceId, role: user.role, platformAdmin: user.platformAdmin }));
        return writeJson(response, 201, envelope(maskUser(user)));
      }
      const userMatch = url.pathname.match(/^\/api\/v1\/users\/([^/]+)$/);
      if (request.method === "PATCH" && userMatch) {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const user = store.readUser(decodeURIComponent(userMatch[1]));
        if (!user) return writeJson(response, 404, { error: "USER_NOT_FOUND" });
        if (!auth.platformAdmin && user.tenantId !== auth.tenantId) return writeJson(response, 403, { error: "TENANT_FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes) as Record<string, unknown>;
        const nextTenantId = safeFileName(optionalTrimmedString(body.tenantId) ?? user.tenantId);
        if (!auth.platformAdmin && nextTenantId !== auth.tenantId) return writeJson(response, 403, { error: "TENANT_FORBIDDEN" });
        const nextPlatformAdmin = body.platformAdmin === undefined ? user.platformAdmin : Boolean(body.platformAdmin);
        if (!auth.platformAdmin && nextPlatformAdmin !== user.platformAdmin) return writeJson(response, 403, { error: "PLATFORM_ADMIN_REQUIRED" });
        const updated = store.writeUser({
          ...user,
          displayName: optionalTrimmedString(body.displayName) ?? user.displayName,
          role: body.role === undefined ? user.role : normalizeAuthRole(body.role, user.role),
          tenantId: nextTenantId,
          workspaceId: safeFileName(optionalTrimmedString(body.workspaceId) ?? user.workspaceId),
          status: body.status === undefined ? user.status : normalizeUserStatus(body.status),
          platformAdmin: nextPlatformAdmin,
          mustChangePassword: body.mustChangePassword === undefined ? user.mustChangePassword : Boolean(body.mustChangePassword),
          updatedAt: new Date().toISOString()
        });
        store.appendAudit(audit(auth, "user.updated", updated.id, { tenantId: updated.tenantId, workspaceId: updated.workspaceId, role: updated.role, status: updated.status, platformAdmin: updated.platformAdmin }));
        return writeJson(response, 200, envelope(maskUser(updated)));
      }
      const resetPasswordMatch = url.pathname.match(/^\/api\/v1\/users\/([^/]+)\/reset-password$/);
      if (request.method === "POST" && resetPasswordMatch) {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const user = store.readUser(decodeURIComponent(resetPasswordMatch[1]));
        if (!user) return writeJson(response, 404, { error: "USER_NOT_FOUND" });
        if (!auth.platformAdmin && user.tenantId !== auth.tenantId) return writeJson(response, 403, { error: "TENANT_FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes) as Record<string, unknown>;
        const nextPassword = body.password === undefined || body.password === null ? "change-me" : String(body.password);
        if (nextPassword.trim().length < 4) return writeJson(response, 400, { error: "PASSWORD_TOO_SHORT" });
        const updated = store.writeUser({ ...user, passwordHash: hashPassword(nextPassword), mustChangePassword: true, updatedAt: new Date().toISOString() });
        store.appendAudit(audit(auth, "user.password.reset", updated.id, { tenantId: updated.tenantId, workspaceId: updated.workspaceId }));
        return writeJson(response, 200, envelope(maskUser(updated)));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/workspaces") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const tenantId = auth.platformAdmin ? optionalTrimmedString(url.searchParams.get("tenantId")) ?? auth.tenantId : auth.tenantId;
        return writeJson(response, 200, envelope(store.listWorkspaces(tenantId)));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/secrets") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listSecrets(auth.tenantId, auth.workspaceId).map(maskSecret)));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/secrets") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const tenantId = safeFileName(optionalTrimmedString(body.tenantId) ?? auth.tenantId);
        const workspaceId = safeFileName(optionalTrimmedString(body.workspaceId) ?? auth.workspaceId);
        const workspace = store.readWorkspace(workspaceId);
        if (!workspace) return writeJson(response, 404, { error: "WORKSPACE_NOT_FOUND" });
        if (!canAccessWorkspace(auth, workspace, "admin")) return writeJson(response, 403, { error: "WORKSPACE_FORBIDDEN" });
        if (workspace.tenantId !== tenantId) return writeJson(response, 409, { error: "SECRET_WORKSPACE_TENANT_MISMATCH" });
        const value = optionalTrimmedString(body.value);
        if (!value) return writeJson(response, 400, { error: "SECRET_VALUE_REQUIRED" });
        const now = new Date().toISOString();
        const id = safeFileName(optionalTrimmedString(body.id) ?? optionalTrimmedString(body.name) ?? `secret-${Date.now()}`);
        const existing = store.readSecret(id);
        const secret = store.writeSecret({
          schema: "evopilot-secret/v1",
          id,
          tenantId,
          workspaceId,
          name: optionalTrimmedString(body.name) ?? id,
          kind: normalizeSecretKind(body.kind),
          status: "ACTIVE",
          version: existing ? existing.version + 1 : 1,
          encryption: encryptSecretValue(value),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          rotatedAt: existing ? now : undefined
        });
        store.appendAudit(audit(auth, existing ? "secret.rotated" : "secret.created", secret.id, { kind: secret.kind, version: secret.version }));
        return writeJson(response, existing ? 200 : 201, envelope(maskSecret(secret)));
      }
      const secretRevokeMatch = url.pathname.match(/^\/api\/v1\/secrets\/([^/]+)\/revoke$/);
      if (request.method === "POST" && secretRevokeMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const secret = store.readSecret(decodeURIComponent(secretRevokeMatch[1]));
        if (!secret) return writeJson(response, 404, { error: "SECRET_NOT_FOUND" });
        const workspace = store.readWorkspace(secret.workspaceId);
        if (!workspace || !canAccessWorkspace(auth, workspace, "admin")) return writeJson(response, 403, { error: "WORKSPACE_FORBIDDEN" });
        const updated = store.writeSecret({ ...secret, status: "REVOKED", revokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        store.appendAudit(audit(auth, "secret.revoked", updated.id, { kind: updated.kind, version: updated.version }));
        return writeJson(response, 200, envelope(maskSecret(updated)));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/github-app/installations") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listGitHubAppInstallations(auth.tenantId, auth.workspaceId).map(maskGitHubAppInstallation)));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/github-app/installations") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const tenantId = safeFileName(optionalTrimmedString(body.tenantId) ?? auth.tenantId);
        const workspaceId = safeFileName(optionalTrimmedString(body.workspaceId) ?? auth.workspaceId);
        const workspace = store.readWorkspace(workspaceId);
        if (!workspace) return writeJson(response, 404, { error: "WORKSPACE_NOT_FOUND" });
        if (!canAccessWorkspace(auth, workspace, "admin")) return writeJson(response, 403, { error: "WORKSPACE_FORBIDDEN" });
        if (workspace.tenantId !== tenantId) return writeJson(response, 409, { error: "GITHUB_APP_WORKSPACE_TENANT_MISMATCH" });
        const now = new Date().toISOString();
        const installationId = requireBodyString(body.installationId, "GITHUB_APP_INSTALLATION_ID_REQUIRED", runtime);
        const id = safeFileName(optionalTrimmedString(body.id) ?? `github-app-${installationId}`);
        const draft = {
          privateKeySecretRef: optionalTrimmedString(body.privateKeySecretRef),
          webhookSecretRef: optionalTrimmedString(body.webhookSecretRef),
          repositories: Array.isArray(body.repositories) ? body.repositories.map(String).filter(Boolean) : [],
          permissions: isRecord(body.permissions) ? Object.fromEntries(Object.entries(body.permissions).map(([key, value]) => [key, String(value)])) : {}
        };
        const checks = githubAppInstallationChecks(store, tenantId, workspaceId, draft);
        const installation = store.writeGitHubAppInstallation({
          schema: "evopilot-github-app-installation/v1",
          id,
          tenantId,
          workspaceId,
          installationId,
          account: requireBodyString(body.account, "GITHUB_APP_ACCOUNT_REQUIRED", runtime),
          repositories: draft.repositories,
          permissions: draft.permissions,
          privateKeySecretRef: draft.privateKeySecretRef,
          webhookSecretRef: draft.webhookSecretRef,
          status: checks.every((check) => check.status === "PASS") ? "READY" : "BLOCKED",
          checks,
          createdAt: store.readGitHubAppInstallation(id)?.createdAt ?? now,
          updatedAt: now
        });
        store.appendAudit(audit(auth, "github-app.installation.upserted", installation.id, {
          installationId: installation.installationId,
          status: installation.status,
          repositories: installation.repositories.length
        }));
        return writeJson(response, installation.status === "READY" ? 201 : 409, envelope(maskGitHubAppInstallation(installation)));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/workspaces") {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const now = new Date().toISOString();
        const workspaceId = safeFileName(optionalTrimmedString(body.id) ?? optionalTrimmedString(body.name) ?? `workspace-${Date.now()}`);
        const tenantId = safeFileName(optionalTrimmedString(body.tenantId) ?? auth.tenantId);
        if (!auth.platformAdmin && tenantId !== auth.tenantId) return writeJson(response, 403, { error: "TENANT_FORBIDDEN" });
        const workspace: WorkspaceRecord = {
          schema: "evopilot-workspace/v1",
          id: workspaceId,
          tenantId,
          name: optionalTrimmedString(body.name) ?? workspaceId,
          status: normalizeWorkspaceStatus(body.status),
          members: [
            {
              id: safeFileName(auth.actor),
              name: auth.actor,
              role: "owner",
              status: "ACTIVE"
            }
          ],
          quotas: normalizeWorkspaceQuotas(body.quotas),
          createdAt: now,
          updatedAt: now
        };
        store.ensureTenant(workspace.tenantId, optionalTrimmedString(body.tenantName) ?? workspace.tenantId);
        store.writeWorkspace(workspace);
        store.appendAudit(audit(auth, "workspace.created", workspace.id, { tenantId: workspace.tenantId, memberCount: workspace.members.length }));
        return writeJson(response, 201, envelope(workspace));
      }
      const workspaceMatch = url.pathname.match(/^\/api\/v1\/workspaces\/([^/]+)$/);
      if (request.method === "GET" && workspaceMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const workspace = store.readWorkspace(decodeURIComponent(workspaceMatch[1]));
        if (!workspace) return writeJson(response, 404, { error: "WORKSPACE_NOT_FOUND" });
        if (!canAccessWorkspace(auth, workspace, "viewer")) return writeJson(response, 403, { error: "WORKSPACE_FORBIDDEN" });
        return writeJson(response, 200, envelope(workspace));
      }
      const workspaceInviteMatch = url.pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/invitations$/);
      if (request.method === "POST" && workspaceInviteMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const workspace = store.readWorkspace(decodeURIComponent(workspaceInviteMatch[1]));
        if (!workspace) return writeJson(response, 404, { error: "WORKSPACE_NOT_FOUND" });
        if (!canAccessWorkspace(auth, workspace, "admin")) return writeJson(response, 403, { error: "WORKSPACE_FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const role = normalizeWorkspaceMemberRole(body.role, "viewer");
        const memberId = safeFileName(optionalTrimmedString(body.id) ?? optionalTrimmedString(body.email) ?? optionalTrimmedString(body.name) ?? `invite-${Date.now()}`);
        const member = {
          id: memberId,
          name: optionalTrimmedString(body.name) ?? optionalTrimmedString(body.email) ?? memberId,
          role,
          status: "INVITED" as const
        };
        const updated = store.writeWorkspace({
          ...workspace,
          members: [...workspace.members.filter((item) => item.id !== memberId), member],
          updatedAt: new Date().toISOString()
        });
        store.appendAudit(audit(auth, "workspace.invitation.created", updated.id, { memberId, role }));
        return writeJson(response, 201, envelope({ workspace: updated, invitation: member }));
      }
      const workspaceMemberMatch = url.pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/members\/([^/]+)$/);
      if (request.method === "PATCH" && workspaceMemberMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const workspace = store.readWorkspace(decodeURIComponent(workspaceMemberMatch[1]));
        if (!workspace) return writeJson(response, 404, { error: "WORKSPACE_NOT_FOUND" });
        if (!canAccessWorkspace(auth, workspace, "admin")) return writeJson(response, 403, { error: "WORKSPACE_FORBIDDEN" });
        const memberId = safeFileName(decodeURIComponent(workspaceMemberMatch[2]));
        const body = await readJson(request, options.maxBodyBytes);
        const member = workspace.members.find((item) => item.id === memberId);
        if (!member) return writeJson(response, 404, { error: "WORKSPACE_MEMBER_NOT_FOUND" });
        const nextRole = body.role === undefined ? member.role : normalizeWorkspaceMemberRole(body.role, member.role);
        const nextStatus = body.status === undefined ? member.status : normalizeWorkspaceMemberStatus(body.status, member.status);
        const nextMembers = workspace.members.map((item) => item.id === memberId ? { ...item, role: nextRole, status: nextStatus } : item);
        if (!nextMembers.some((item) => item.role === "owner" && item.status === "ACTIVE")) {
          return writeJson(response, 409, { error: "WORKSPACE_REQUIRES_ACTIVE_OWNER" });
        }
        const updated = store.writeWorkspace({
          ...workspace,
          members: nextMembers,
          updatedAt: new Date().toISOString()
        });
        store.appendAudit(audit(auth, "workspace.member.updated", updated.id, { memberId, role: nextRole, status: nextStatus }));
        return writeJson(response, 200, envelope(updated));
      }
      const workspaceUsageMatch = url.pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/usage$/);
      if (request.method === "GET" && workspaceUsageMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const workspace = store.readWorkspace(decodeURIComponent(workspaceUsageMatch[1]));
        if (!workspace) return writeJson(response, 404, { error: "WORKSPACE_NOT_FOUND" });
        if (!canAccessWorkspace(auth, workspace, "viewer")) return writeJson(response, 403, { error: "WORKSPACE_FORBIDDEN" });
        return writeJson(response, 200, envelope(workspaceUsage(store, workspace)));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/executor-graphs") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listExecutorGraphs()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/executor-graphs") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const graph = store.writeExecutorGraph(normalizeExecutorGraph(body));
        store.appendAudit(audit(auth, "executor-graph.upserted", graph.id, { nodeCount: graph.nodes.length, edgeCount: graph.edges.length }));
        return writeJson(response, 201, envelope(graph));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-store") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.loopStoreRuntime()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-store/readiness") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(await loopStoreReadiness(store.loopStoreRuntime(), { verifyConnection: true })));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/saas/observability") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.saasObservability()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-observability") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listLoopTraces().slice(-50).reverse()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-orchestration/presets") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(loopOrchestrationPresets(store)));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-orchestration/targets") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(loopOrchestrationTargets(store)));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/loop-orchestration/advance") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const result = await advanceLoopOrchestrationTarget(store, auth.actor, {
          targetId: optionalTrimmedString(body.targetId),
          projectId: optionalTrimmedString(body.projectId),
          targetVersion: optionalTrimmedString(body.targetVersion),
          objective: optionalTrimmedString(body.objective),
          controlPlaneUrl: optionalTrimmedString(body.controlPlaneUrl),
          deployConnectorId: optionalTrimmedString(body.deployConnectorId),
          autoStart: body.autoStart !== false
        });
        store.appendAudit(audit(auth, "loop-orchestration.advanced", result.target.id, { action: result.action, loopId: result.loop?.id, advanced: result.advanced }));
        return writeJson(response, result.advanced ? 201 : 200, envelope(result));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/loop-orchestration/autopilot") {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const result = await runLoopOrchestrationAutopilot(store, auth.actor, body);
        store.appendAudit(audit(auth, "loop-orchestration.autopilot", result.target.id, {
          status: result.status,
          loopId: result.loop?.id,
          nextAction: result.nextAction,
          releaseRunId: result.releaseRun?.id
        }));
        return writeJson(response, result.status === "SUCCEEDED" ? 200 : 409, envelope(result));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-target-runtime/summary") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.loopTargetRuntimeSummary()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/loop-target-runtime/discovery/run") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const candidates = store.runDiscoverySkillRuntime(optionalTrimmedString(body.projectId));
        store.appendAudit(audit(auth, "loop-target-runtime.discovery-run", "discovery-skill-runtime", { candidateCount: candidates.length, projectId: body.projectId }));
        return writeJson(response, 201, envelope(candidates));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-target-runtime/discovery/candidates") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listDiscoverySkillCandidates().slice(-100).reverse()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/loop-target-runtime/handoffs") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const handoff = store.allocateFindingWorktreeHandoff({
          findingId: optionalTrimmedString(body.findingId),
          projectId: optionalTrimmedString(body.projectId),
          targetId: optionalTrimmedString(body.targetId),
          allowedPaths: Array.isArray(body.allowedPaths) ? body.allowedPaths.map(String) : undefined,
          validationCommands: Array.isArray(body.validationCommands) ? body.validationCommands.map(String) : undefined
        });
        store.appendAudit(audit(auth, "loop-target-runtime.handoff-allocated", handoff.id, { projectId: handoff.projectId, targetBranch: handoff.targetBranch }));
        return writeJson(response, 201, envelope(handoff));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-target-runtime/handoffs") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listFindingWorktreeHandoffs().slice(-100).reverse()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/loop-target-runtime/adversarial-evaluations") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const evaluation = store.runAdversarialEvaluation({
          loopId: optionalTrimmedString(body.loopId),
          projectId: optionalTrimmedString(body.projectId),
          targetId: optionalTrimmedString(body.targetId)
        });
        store.appendAudit(audit(auth, "loop-target-runtime.adversarial-evaluated", evaluation.id, { status: evaluation.status, loopId: evaluation.loopId }));
        return writeJson(response, evaluation.status === "BLOCK" ? 409 : 201, envelope(evaluation));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-target-runtime/adversarial-evaluations") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listAdversarialEvaluations().slice(-100).reverse()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/loop-target-runtime/schedules") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const schedule = store.upsertRecurringLoopSchedule({
          id: optionalTrimmedString(body.id),
          projectId: optionalTrimmedString(body.projectId),
          targetId: optionalTrimmedString(body.targetId),
          cadence: optionalTrimmedString(body.cadence),
          maxBudgetUsd: body.maxBudgetUsd === undefined ? undefined : Number(body.maxBudgetUsd),
          triggerRules: Array.isArray(body.triggerRules) ? body.triggerRules.map(String) : undefined
        });
        store.appendAudit(audit(auth, "loop-target-runtime.schedule-upserted", schedule.id, { cadence: schedule.cadence, nextRunAt: schedule.nextRunAt }));
        return writeJson(response, 201, envelope(schedule));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-target-runtime/schedules") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listRecurringLoopSchedules().slice(-100).reverse()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-target-runtime/memory-inbox") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listLoopMemoryInboxItems().slice(-100).reverse()));
      }
      const memoryInboxTriageMatch = url.pathname.match(/^\/api\/v1\/loop-target-runtime\/memory-inbox\/([^/]+)\/triage$/);
      if (request.method === "POST" && memoryInboxTriageMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const status = normalizeMemoryInboxStatus(body.status);
        const item = store.triageLoopMemoryInboxItem(decodeURIComponent(memoryInboxTriageMatch[1]), status, optionalTrimmedString(body.targetId));
        if (!item) return writeJson(response, 404, { error: "MEMORY_INBOX_ITEM_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop-target-runtime.memory-triaged", item.id, { status: item.status, targetId: item.targetId }));
        return writeJson(response, 200, envelope(item));
      }
      const guardrailEvaluateMatch = url.pathname.match(/^\/api\/v1\/loop-target-runtime\/guardrails\/([^/]+)\/evaluate$/);
      if (request.method === "POST" && guardrailEvaluateMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const evaluation = store.evaluateBudgetAndJudgmentGuardrails(decodeURIComponent(guardrailEvaluateMatch[1]), isRecord(body) ? body : {});
        if (!evaluation) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop-target-runtime.guardrail-evaluated", evaluation.id, { status: evaluation.status, releaseJudgment: evaluation.releaseJudgment }));
        return writeJson(response, evaluation.status === "BLOCK" ? 409 : 200, envelope(evaluation));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-target-runtime/guardrails") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listGuardrailEvaluations().slice(-100).reverse()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/loop-orchestration/instantiate") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const preset = loopOrchestrationPresets(store).find((item) => item.id === String(body.presetId ?? "source-release-closure"));
        if (!preset) return writeJson(response, 404, { error: "LOOP_ORCHESTRATION_PRESET_NOT_FOUND" });
        const projectId = safeFileName(String(body.projectId ?? "evopilot"));
        const project = store.readProject(projectId);
        const deployConnectorId = optionalTrimmedString(body.deployConnectorId)
          ?? (store.listDeployConnectors().length === 1 ? store.listDeployConnectors()[0].id : undefined);
        const graph = store.writeExecutorGraph(executorGraphFromLoopOrchestrationRequest(body, preset.id));
        const workflowContext = workflowCanvasContextFromRequest(body);
        const loop = store.createLoop({
          id: body.id ? String(body.id) : undefined,
          source: "api",
          projectId,
          tenantId: auth.tenantId,
          workspaceId: auth.workspaceId,
          objective: optionalTrimmedString(body.objective) ?? preset.defaultObjective,
          executorGraphId: graph.id,
          controlPlaneUrl: optionalTrimmedString(body.controlPlaneUrl) ?? preset.controlPlaneUrl,
          sourceClosure: {
            sourceProjectId: projectId,
            repositoryProvider: project?.repository?.provider ?? "unknown",
            sourceBranch: optionalTrimmedString(body.sourceBranch) ?? project?.repository?.defaultBranch ?? "main",
            targetVersion: optionalTrimmedString(body.targetVersion) ?? preset.defaultTargetVersion,
            deploymentConnectorId: deployConnectorId,
            deploymentEnvironment: optionalTrimmedString(body.deploymentEnvironment) ?? "production",
            requiredGates: ["code-change", "push", "deploy", "health-ready"]
          },
          sandbox: {
            runtime: "docker",
            network: "restricted",
            credentialScope: "loop",
            allowedPaths: ["src", "packages", "apps", "docs", "tests"],
            deniedPaths: [".env", ".env.*", ".git", "node_modules"]
          },
          stopPolicy: {
            maxIterations: Number(body.maxIterations ?? 8),
            maxDurationSeconds: Number(body.maxDurationSeconds ?? 24 * 60 * 60),
            requireApprovalForRelease: true,
            stopOnRepeatedFailure: 2
          },
          retryPolicy: {
            maxAttemptsPerNode: 2,
            backoffSeconds: 5,
            circuitBreakerFailures: 2
          },
          context: {
            orchestrationPresetId: preset.id,
            dashboardWorkbench: true,
            ...(workflowContext ? { workflowCanvasEditor: workflowContext } : {}),
            unattendedProof: {
              watchdog: true,
              workerLease: true,
              sourceClosure: true,
              deployRollback: true
            }
          }
        });
        store.appendAudit(audit(auth, "loop-orchestration.instantiated", loop.id, {
          presetId: preset.id,
          projectId,
          executorGraphId: graph.id,
          graphValidation: graph.validation.status,
          graphCapabilities: graph.capabilities
        }));
        return writeJson(response, 201, envelope(loop));
      }
      const executorGraphMatch = url.pathname.match(/^\/api\/v1\/executor-graphs\/([^/]+)$/);
      if (request.method === "GET" && executorGraphMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const graph = store.readExecutorGraph(decodeURIComponent(executorGraphMatch[1]));
        if (!graph) return writeJson(response, 404, { error: "EXECUTOR_GRAPH_NOT_FOUND" });
        return writeJson(response, 200, envelope(graph));
      }
      const loopExecutorGraphMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/executor-graph$/);
      if (request.method === "GET" && loopExecutorGraphMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const loop = store.readLoop(decodeURIComponent(loopExecutorGraphMatch[1]));
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        const graph = store.readExecutorGraph(loop.executorGraphId);
        if (!graph) return writeJson(response, 404, { error: "EXECUTOR_GRAPH_NOT_FOUND" });
        return writeJson(response, 200, envelope({
          loopId: loop.id,
          executorGraph: graph,
          coordination: loop.coordination,
          validation: graph.validation,
          capabilities: graph.capabilities,
          evidence: [
            `loop=${loop.id}`,
            `executorGraph=${graph.id}`,
            `nodes=${graph.nodes.length}`,
            `edges=${graph.edges.length}`,
            `validation=${graph.validation.status}`,
            `typedEdges=${graph.capabilities.typedEdges}`,
            `conditionalRouting=${graph.capabilities.conditionalRouting}`,
            `fanOutFanIn=${graph.capabilities.fanOutFanIn}`,
            `nestedSubgraphs=${graph.capabilities.nestedSubgraphs}`,
            `schemaValidation=${graph.capabilities.schemaValidation}`
          ]
        }));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loops") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listLoops()
          .filter((loop) => canAccessScopedResource(auth, loop.tenantId, loop.workspaceId))
          .slice(-50)
          .reverse()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/loops") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const idempotencyKey = getIdempotencyKey(request);
        if (idempotencyKey) {
          const existing = store.readIdempotency(`loop:create:${idempotencyKey}`);
          if (existing) return writeJson(response, 200, existing);
        }
        const body = await readJson(request, options.maxBodyBytes);
        const objective = String(body.objective ?? "").trim();
        if (!objective) return writeJson(response, 400, { error: "LOOP_OBJECTIVE_REQUIRED" });
        const projectId = body.projectId ? safeFileName(String(body.projectId)) : "evopilot";
        const project = store.readProject(projectId);
        const tenantId = safeFileName(optionalTrimmedString(body.tenantId) ?? project?.tenantId ?? auth.tenantId);
        const workspaceId = safeFileName(optionalTrimmedString(body.workspaceId) ?? project?.workspaceId ?? auth.workspaceId);
        const workspace = store.readWorkspace(workspaceId);
        if (!workspace) return writeJson(response, 404, { error: "WORKSPACE_NOT_FOUND" });
        if (!canAccessWorkspace(auth, workspace, "developer")) return writeJson(response, 403, { error: "WORKSPACE_FORBIDDEN" });
        const usage = workspaceUsage(store, workspace);
        if (usage.loops.used >= usage.loops.limit) {
          return writeJson(response, 429, { error: "WORKSPACE_LOOP_QUOTA_EXCEEDED", detail: usage });
        }
        const loop = store.createLoop({
          id: body.id ? String(body.id) : undefined,
          source: normalizeLoopTriggerSource(body.source),
          projectId,
          tenantId,
          workspaceId,
          objective,
          executorGraphId: body.executorGraphId ? String(body.executorGraphId) : undefined,
          controlPlaneUrl: body.controlPlaneUrl ? String(body.controlPlaneUrl) : undefined,
          sourceClosure: isRecord(body.sourceClosure) ? body.sourceClosure : undefined,
          stopPolicy: isRecord(body.stopPolicy) ? body.stopPolicy : undefined,
          retryPolicy: isRecord(body.retryPolicy) ? body.retryPolicy : undefined,
          sandbox: isRecord(body.sandbox) ? body.sandbox : undefined,
          context: isRecord(body.context) ? body.context : undefined
        });
        store.appendAudit(audit(auth, "loop.created", loop.id, { source: loop.source, projectId: loop.projectId, executorGraphId: loop.executorGraphId }));
        const bodyOut = envelope(loop);
        if (idempotencyKey) store.writeIdempotency(`loop:create:${idempotencyKey}`, bodyOut);
        return writeJson(response, 201, bodyOut);
      }
      const loopStartMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/start$/);
      if (request.method === "POST" && loopStartMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const idempotencyKey = getIdempotencyKey(request);
        if (idempotencyKey) {
          const existing = store.readIdempotency(`loop:start:${decodeURIComponent(loopStartMatch[1])}:${idempotencyKey}`);
          if (existing) return writeJson(response, 200, existing);
        }
        const body = await readJson(request, options.maxBodyBytes);
        const loop = await store.startLoop(decodeURIComponent(loopStartMatch[1]), auth.actor, {
          forceDecision: normalizeLoopDecision(body.forceDecision),
          evidence: Array.isArray(body.evidence) ? body.evidence.map(String) : undefined
        });
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop.started", loop.id, { status: loop.status, iteration: loop.currentIteration }));
        const bodyOut = envelope(loop);
        if (idempotencyKey) store.writeIdempotency(`loop:start:${loop.id}:${idempotencyKey}`, bodyOut);
        return writeJson(response, 200, bodyOut);
      }
      const loopResumeMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/resume$/);
      if (request.method === "POST" && loopResumeMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const idempotencyKey = getIdempotencyKey(request);
        if (idempotencyKey) {
          const existing = store.readIdempotency(`loop:resume:${decodeURIComponent(loopResumeMatch[1])}:${idempotencyKey}`);
          if (existing) return writeJson(response, 200, existing);
        }
        const body = await readJson(request, options.maxBodyBytes);
        const loop = await store.resumeLoop(decodeURIComponent(loopResumeMatch[1]), auth.actor, {
          forceDecision: normalizeLoopDecision(body.forceDecision),
          evidence: Array.isArray(body.evidence) ? body.evidence.map(String) : undefined
        });
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop.resumed", loop.id, { status: loop.status, iteration: loop.currentIteration }));
        const bodyOut = envelope(loop);
        if (idempotencyKey) store.writeIdempotency(`loop:resume:${loop.id}:${idempotencyKey}`, bodyOut);
        return writeJson(response, 200, bodyOut);
      }
      const loopReplayMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/replay$/);
      if (request.method === "POST" && loopReplayMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const loop = await store.replayLoop(decodeURIComponent(loopReplayMatch[1]), auth.actor, {
          fromIteration: Number(body.fromIteration ?? body.iteration ?? 1),
          contextPatch: isRecord(body.contextPatch) ? body.contextPatch : isRecord(body.context) ? body.context : undefined,
          evidence: Array.isArray(body.evidence) ? body.evidence.map(String) : undefined,
          artifacts: Array.isArray(body.artifacts) ? body.artifacts.map(normalizeLoopArtifact) : undefined,
          forceDecision: normalizeLoopDecision(body.forceDecision)
        });
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop.replayed", loop.id, { status: loop.status, iteration: loop.currentIteration }));
        return writeJson(response, 200, envelope(loop));
      }
      const loopCheckpointsMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/checkpoints$/);
      if (request.method === "GET" && loopCheckpointsMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const checkpoints = store.listLoopCheckpoints(decodeURIComponent(loopCheckpointsMatch[1]));
        if (!checkpoints) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        return writeJson(response, 200, envelope(checkpoints));
      }
      const loopTimeTravelReplayMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/time-travel\/replay$/);
      if (request.method === "POST" && loopTimeTravelReplayMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const result = await store.replayLoopWithDiff(decodeURIComponent(loopTimeTravelReplayMatch[1]), auth.actor, {
          fromIteration: Number(body.fromIteration ?? body.iteration ?? 1),
          contextPatch: isRecord(body.contextPatch) ? body.contextPatch : isRecord(body.context) ? body.context : undefined,
          evidence: Array.isArray(body.evidence) ? body.evidence.map(String) : undefined,
          artifacts: Array.isArray(body.artifacts) ? body.artifacts.map(normalizeLoopArtifact) : undefined,
          forceDecision: normalizeLoopDecision(body.forceDecision)
        });
        if (!result) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop.time-travel-replayed", result.loop.id, {
          fromIteration: result.replayDiff.fromIteration,
          changedExecutorOutputs: result.replayDiff.executorOutputChanges.filter((item) => item.changed).length
        }));
        return writeJson(response, 200, envelope(result));
      }
      const loopApproveMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/approve$/);
      if (request.method === "POST" && loopApproveMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const loop = store.approveLoop(decodeURIComponent(loopApproveMatch[1]), auth.actor, body.approvalId ? String(body.approvalId) : undefined);
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop.approved", loop.id, { status: loop.status }));
        return writeJson(response, 200, envelope(loop));
      }
      const loopCancelMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/cancel$/);
      if (request.method === "POST" && loopCancelMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const loop = store.cancelLoop(decodeURIComponent(loopCancelMatch[1]), auth.actor, body.reason ? String(body.reason) : undefined);
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop.cancelled", loop.id, { status: loop.status }));
        return writeJson(response, 200, envelope(loop));
      }
      const loopTimelineMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/timeline$/);
      if (request.method === "GET" && loopTimelineMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const loop = store.readLoop(decodeURIComponent(loopTimelineMatch[1]));
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        return writeJson(response, 200, envelope(loop.timeline));
      }
      const loopEvidenceMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/evidence$/);
      if (request.method === "GET" && loopEvidenceMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const loop = store.readLoop(decodeURIComponent(loopEvidenceMatch[1]));
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        return writeJson(response, 200, envelope(loop.evidenceSets));
      }
      const loopArtifactsMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/artifacts$/);
      if (request.method === "GET" && loopArtifactsMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const loop = store.readLoop(decodeURIComponent(loopArtifactsMatch[1]));
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        return writeJson(response, 200, envelope(loop.artifacts));
      }
      const loopTraceMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/trace$/);
      if (request.method === "GET" && loopTraceMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const loop = store.readLoop(decodeURIComponent(loopTraceMatch[1]));
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        return writeJson(response, 200, envelope(loop.trace));
      }
      const loopTraceTreeMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/trace-tree$/);
      if (request.method === "GET" && loopTraceTreeMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const tree = store.readLoopTraceTree(decodeURIComponent(loopTraceTreeMatch[1]));
        if (!tree) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        return writeJson(response, 200, envelope(tree));
      }
      const loopEventsMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/events$/);
      if (request.method === "GET" && loopEventsMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const events = store.listLoopStreamEvents(decodeURIComponent(loopEventsMatch[1]));
        if (!events) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        if (String(request.headers.accept ?? "").includes("text/event-stream")) return writeEventStream(response, events);
        return writeJson(response, 200, envelope(events));
      }
      const loopSandboxProofMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/sandbox-proof$/);
      if (request.method === "GET" && loopSandboxProofMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const proof = store.readLoopSandboxProof(decodeURIComponent(loopSandboxProofMatch[1]));
        if (!proof) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        return writeJson(response, 200, envelope(proof));
      }
      const loopSandboxProofVerifyMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/sandbox-proof\/verify$/);
      if (request.method === "POST" && loopSandboxProofVerifyMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const result = store.verifyLoopSandboxProof(decodeURIComponent(loopSandboxProofVerifyMatch[1]), auth.actor);
        if (!result) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop.sandbox-proof-verified", result.loop.id, { status: result.proof.status, runtime: result.proof.runtime }));
        return writeJson(response, 200, envelope(result));
      }
      const loopSourceClosureExecuteMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/source-closure\/execute$/);
      if (request.method === "POST" && loopSourceClosureExecuteMatch) {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const result = await executeLoopSourceClosure(store, decodeURIComponent(loopSourceClosureExecuteMatch[1]), auth.actor, body);
        if (!result) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop.source-closure-executed", result.loop.id, {
          provider: result.loop.sourceClosure.repositoryProvider,
          closureState: result.loop.sourceClosure.closureState,
          branch: result.loop.sourceClosure.artifacts.branch,
          tag: result.loop.sourceClosure.artifacts.tag,
          releaseRunId: result.releaseRun.id
        }));
        return writeJson(response, 200, envelope({ ...result.loop, sourceReleaseRun: result.releaseRun }));
      }
      const loopSourceClosureReviewDecisionMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/source-closure\/review-decision$/);
      if (request.method === "POST" && loopSourceClosureReviewDecisionMatch) {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const result = await applySourceClosureReviewDecision(store, decodeURIComponent(loopSourceClosureReviewDecisionMatch[1]), auth.actor, body);
        if (!result) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop.source-closure-review-decided", result.loop.id, {
          action: result.action,
          provider: result.loop.sourceClosure.repositoryProvider,
          reviewStatus: result.releaseRun.review.status,
          mergeCommitSha: result.releaseRun.review.mergeCommitSha,
          releaseRunId: result.releaseRun.id
        }));
        return writeJson(response, 200, envelope({ ...result.loop, sourceReleaseRun: result.releaseRun }));
      }
      const loopSourceClosurePlanMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/source-closure\/plan$/);
      if (request.method === "GET" && loopSourceClosurePlanMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const loop = store.readLoop(decodeURIComponent(loopSourceClosurePlanMatch[1]));
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        const latestRun = store.listSourceReleaseClosureRuns(loop.id).at(-1);
        return writeJson(response, 200, envelope(latestRun ?? buildSourceReleaseClosureRun(loop)));
      }
      const sourceReleaseRunRepairMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/source-release-runs\/([^/]+)\/repair$/);
      if (request.method === "POST" && sourceReleaseRunRepairMatch) {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const result = await repairSourceReleaseRun(store, decodeURIComponent(sourceReleaseRunRepairMatch[1]), decodeURIComponent(sourceReleaseRunRepairMatch[2]), auth.actor, body);
        if (!result) return writeJson(response, 404, { error: "SOURCE_RELEASE_RUN_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop.source-release-run-repaired", result.loop.id, {
          originalReleaseRunId: result.originalReleaseRun.id,
          releaseRunId: result.releaseRun.id,
          closureState: result.loop.sourceClosure.closureState
        }));
        return writeJson(response, 200, envelope(result));
      }
      const loopSourceClosurePreflightMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/source-closure\/preflight$/);
      if ((request.method === "GET" || request.method === "POST") && loopSourceClosurePreflightMatch) {
        if (!hasRole(auth, request.method === "POST" ? "operator" : "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const result = await preflightLoopSourceClosure(store, decodeURIComponent(loopSourceClosurePreflightMatch[1]), {
          actor: auth.actor,
          persist: request.method === "POST"
        });
        if (!result) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop.source-closure-preflight", result.loopId, {
          status: result.status,
          provider: result.provider,
          blockers: result.blockers
        }));
        return writeJson(response, result.status === "PASS" ? 200 : 409, envelope(result));
      }
      const loopSourceReleaseRunsMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)\/source-release-runs$/);
      if (request.method === "GET" && loopSourceReleaseRunsMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listSourceReleaseClosureRuns(decodeURIComponent(loopSourceReleaseRunsMatch[1]))));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/source-release-runs") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listSourceReleaseClosureRuns()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/source-release-runs/repair-candidates") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const includeRepaired = url.searchParams.get("includeRepaired") === "true";
        return writeJson(response, 200, envelope(discoverSourceReleaseRunRepairCandidates(store, { includeRepaired })));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/source-release-runs/repair-candidates/repair") {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const result = await repairSourceReleaseRunCandidates(store, auth.actor, body);
        store.appendAudit(audit(auth, "source-release-run-repair-queue.executed", "source-release-runs", {
          repaired: result.repaired.length,
          failed: result.failed.length,
          skipped: result.skipped.length
        }));
        return writeJson(response, 200, envelope(result));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/source-release-deploy-finalizers") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const status = optionalTrimmedString(url.searchParams.get("status"))?.toUpperCase() as SourceReleaseDeployFinalizer["status"] | undefined;
        const filter = status === "PENDING" || status === "SUCCEEDED" || status === "FAILED" ? status : undefined;
        return writeJson(response, 200, envelope(store.listSourceReleaseDeployFinalizers(filter)));
      }
      const loopMatch = url.pathname.match(/^\/api\/v1\/loops\/([^/]+)$/);
      if (request.method === "GET" && loopMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const loop = store.readLoop(decodeURIComponent(loopMatch[1]));
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        return writeJson(response, 200, envelope(loop));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/loop-workers/heartbeat") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const loopId = String(body.loopId ?? "").trim();
        const workerId = String(body.workerId ?? "").trim();
        if (!loopId || !workerId) return writeJson(response, 400, { error: "LOOP_WORKER_HEARTBEAT_REQUIRED" });
        const loop = store.heartbeatLoop(loopId, workerId, body.leaseSeconds === undefined ? 120 : Number(body.leaseSeconds));
        if (!loop) return writeJson(response, 404, { error: "LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "loop-worker.heartbeat", loop.id, { workerId, expiresAt: loop.workerLease?.expiresAt }));
        return writeJson(response, 200, envelope(loop.workerLease));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-workers/leases") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listLoopLeases()));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/loop-workers/queue") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listLoopWorkerQueue()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/loop-workers/claim") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const workerId = String(body.workerId ?? "").trim();
        if (!workerId) return writeJson(response, 400, { error: "LOOP_WORKER_ID_REQUIRED" });
        const result = store.claimNextLoop(workerId, body.leaseSeconds === undefined ? 120 : Number(body.leaseSeconds), new Date(), optionalTrimmedString(body.loopId));
        store.appendAudit(audit(auth, "loop-worker.claimed", result.claimed?.loopId ?? "none", {
          workerId: result.workerId,
          claimed: result.claimed?.loopId
        }));
        return writeJson(response, result.claimed ? 201 : 200, envelope(result));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/loops/watchdog") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const result = store.runLoopWatchdog();
        store.appendAudit(audit(auth, "loop-watchdog.ran", "loops", { recovered: result.recovered.length, blocked: result.blocked.length }));
        return writeJson(response, 200, envelope(result));
      }
      if (request.method === "POST" && (url.pathname === "/api/v1/im/feishu/webhook" || url.pathname === "/api/v1/im/wecom/webhook")) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const channel = url.pathname.includes("feishu") ? "feishu" : "wecom";
        const command = parseConversationCommand({
          channel,
          conversationId: extractImConversationId(body, channel),
          text: extractImText(body),
          projectId: body.projectId,
          targetId: body.targetId,
          finalGoal: body.finalGoal
        });
        const runtimeLoop = store.createLoop({
          source: "im",
          projectId: command.projectId,
          objective: command.finalGoal ?? `${command.projectId} reaches ${command.targetId.toUpperCase()} through EvoPilot Loop Runtime.`,
          context: { channel, rawWebhookType: body.type ?? body.msgtype ?? body.event?.message?.message_type, conversationId: command.conversationId, text: command.text }
        });
        store.appendAudit(audit(auth, `im.${channel}.loop-created`, runtimeLoop.id, { conversationId: command.conversationId }));
        return writeJson(response, 201, envelope({
          schema: "evopilot-im-webhook-result/v1",
          channel,
          conversationId: command.conversationId,
          message: `Created EvoPilot loop ${runtimeLoop.id} from ${channel} webhook.`,
          loop: runtimeLoop
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/conversations/commands") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const command = parseConversationCommand(body);
        if (command.kind === "create-target-loop") {
          const runtimeLoop = store.createLoop({
            source: "im",
            projectId: command.projectId,
            objective: command.finalGoal ?? `${command.projectId} reaches ${command.targetId.toUpperCase()} through EvoPilot Loop Runtime.`,
            context: {
              channel: command.channel,
              conversationId: command.conversationId,
              text: command.text,
              targetId: command.targetId
            }
          });
          const loop = store.createTargetLoop({
            projectId: command.projectId,
            targetId: command.targetId,
            finalGoal: command.finalGoal,
            candidate: command.candidate,
            proofOpsCore
          });
          store.appendAudit(audit(auth, "conversation.target-loop-created", loop.id, {
            channel: command.channel,
            conversationId: command.conversationId,
            text: command.text,
            runtimeLoopId: runtimeLoop.id
          }));
          return writeJson(response, 201, envelope({
            schema: "evopilot-conversation-command-result/v1",
            channel: command.channel,
            conversationId: command.conversationId,
            message: `Created EvoPilot loop ${runtimeLoop.id} and target loop ${loop.id}; target plan approval is required before guarded execution.`,
            loop: runtimeLoop,
            targetLoop: loop
          }));
        }
        return writeJson(response, 400, { error: "CONVERSATION_COMMAND_UNSUPPORTED" });
      }
      if (request.method === "GET" && url.pathname === "/api/v1/target-loops") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listTargetLoops().slice(-50).reverse()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/target-loops") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const loop = store.createTargetLoop({
          projectId: body.projectId ? String(body.projectId) : undefined,
          targetId: body.targetId ? String(body.targetId) : undefined,
          finalGoal: body.finalGoal ? String(body.finalGoal) : undefined,
          candidate: body.candidate ? String(body.candidate) : undefined,
          proofOpsCore
        });
        store.appendAudit(audit(auth, "target-loop.created", loop.id, { projectId: loop.projectId, targetId: loop.targetId }));
        return writeJson(response, 201, envelope(loop));
      }
      const targetLoopMatch = url.pathname.match(/^\/api\/v1\/target-loops\/([^/]+)$/);
      if (request.method === "GET" && targetLoopMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const loop = store.readTargetLoop(decodeURIComponent(targetLoopMatch[1]));
        if (!loop) return writeJson(response, 404, { error: "TARGET_LOOP_NOT_FOUND" });
        return writeJson(response, 200, envelope(loop));
      }
      const targetLoopApproveMatch = url.pathname.match(/^\/api\/v1\/target-loops\/([^/]+)\/approve-plan$/);
      if (request.method === "POST" && targetLoopApproveMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const loop = store.approveTargetLoopPlan(decodeURIComponent(targetLoopApproveMatch[1]), auth.actor);
        if (!loop) return writeJson(response, 404, { error: "TARGET_LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "target-loop.plan-approved", loop.id, { targetId: loop.targetId }));
        return writeJson(response, 200, envelope(loop));
      }
      const targetLoopResumeMatch = url.pathname.match(/^\/api\/v1\/target-loops\/([^/]+)\/resume$/);
      if (request.method === "POST" && targetLoopResumeMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const loop = store.runTargetLoop(decodeURIComponent(targetLoopResumeMatch[1]), {
          scenarioMatrix: normalizeScenarioMatrix(body.scenarioMatrix),
          artifactPaths: Array.isArray(body.artifactPaths) ? body.artifactPaths.map(String) : []
        });
        if (!loop) return writeJson(response, 404, { error: "TARGET_LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "target-loop.resumed", loop.id, { status: loop.status, releaseDecision: loop.releaseDecision?.id }));
        return writeJson(response, 200, envelope(loop));
      }
      const targetLoopReportMatch = url.pathname.match(/^\/api\/v1\/target-loops\/([^/]+)\/final-report$/);
      if (request.method === "GET" && targetLoopReportMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const loop = store.readTargetLoop(decodeURIComponent(targetLoopReportMatch[1]));
        if (!loop) return writeJson(response, 404, { error: "TARGET_LOOP_NOT_FOUND" });
        if (!loop.finalReport) return writeJson(response, 409, { error: "TARGET_LOOP_FINAL_REPORT_PENDING" });
        return writeJson(response, 200, envelope(loop.finalReport));
      }
      const targetLoopReleaseActionMatch = url.pathname.match(/^\/api\/v1\/target-loops\/([^/]+)\/release-actions\/([^/]+)\/approve$/);
      if (request.method === "POST" && targetLoopReleaseActionMatch) {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const loop = store.approveTargetLoopReleaseAction(
          decodeURIComponent(targetLoopReleaseActionMatch[1]),
          decodeURIComponent(targetLoopReleaseActionMatch[2]),
          auth.actor
        );
        if (!loop) return writeJson(response, 404, { error: "TARGET_LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "target-loop.release-action-approved", loop.id, { action: targetLoopReleaseActionMatch[2] }));
        return writeJson(response, 200, envelope(loop));
      }
      const targetLoopReleaseExecuteMatch = url.pathname.match(/^\/api\/v1\/target-loops\/([^/]+)\/release-actions\/([^/]+)\/execute$/);
      if (request.method === "POST" && targetLoopReleaseExecuteMatch) {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const loop = store.executeTargetLoopReleaseAction(
          decodeURIComponent(targetLoopReleaseExecuteMatch[1]),
          decodeURIComponent(targetLoopReleaseExecuteMatch[2]),
          auth.actor
        );
        if (!loop) return writeJson(response, 404, { error: "TARGET_LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "target-loop.release-action-executed", loop.id, { action: targetLoopReleaseExecuteMatch[2] }));
        return writeJson(response, 200, envelope(loop));
      }
      const targetLoopRemediationMatch = url.pathname.match(/^\/api\/v1\/target-loops\/([^/]+)\/route-remediation$/);
      if (request.method === "POST" && targetLoopRemediationMatch) {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const loop = store.routeTargetLoopRemediation(
          decodeURIComponent(targetLoopRemediationMatch[1]),
          body.blocker ? String(body.blocker) : undefined
        );
        if (!loop) return writeJson(response, 404, { error: "TARGET_LOOP_NOT_FOUND" });
        store.appendAudit(audit(auth, "target-loop.remediation-routed", loop.id, { remediationCount: loop.remediationRequests.length }));
        return writeJson(response, 200, envelope(loop));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/release/evidence") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listReleaseEvidenceSummaries()
          .filter((bundle) => canAccessScopedResource(auth, bundle.tenantId, bundle.workspaceId))
          .slice(-20)
          .reverse()));
      }
      if (request.method === "POST" && url.pathname === "/api/v1/release/evidence") {
        if (!hasRole(auth, "operator")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const bundle = store.generateReleaseEvidenceBundle({
          id: body.id ? String(body.id) : undefined,
          tenantId: optionalTrimmedString(body.tenantId) ?? auth.tenantId,
          workspaceId: optionalTrimmedString(body.workspaceId) ?? auth.workspaceId,
          candidate: body.candidate ? String(body.candidate) : undefined,
          releaseTargetId: body.releaseTargetId ? String(body.releaseTargetId) : undefined,
          scenarioMatrix: normalizeScenarioMatrix(body.scenarioMatrix),
          artifactPaths: Array.isArray(body.artifactPaths) ? body.artifactPaths.map(String) : []
        });
        store.appendAudit(audit(auth, "release-evidence.generated", bundle.id, { status: bundle.status, candidate: bundle.candidate }));
        return writeJson(response, 201, envelope(bundle));
      }
      const releaseEvidenceMatch = url.pathname.match(/^\/api\/v1\/release\/evidence\/([^/]+)$/);
      if (request.method === "GET" && releaseEvidenceMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const bundle = store.readReleaseEvidenceBundle(decodeURIComponent(releaseEvidenceMatch[1]));
        if (!bundle) return writeJson(response, 404, { error: "RELEASE_EVIDENCE_NOT_FOUND" });
        if (!canAccessScopedResource(auth, bundle.tenantId, bundle.workspaceId)) return writeJson(response, 403, { error: "RELEASE_EVIDENCE_FORBIDDEN" });
        return writeJson(response, 200, envelope(bundle));
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
      if (request.method === "GET" && url.pathname === "/api/v1/connectors/deploy") {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        return writeJson(response, 200, envelope(store.listDeployConnectors().map(maskDeployConnector)));
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
      if (request.method === "POST" && url.pathname === "/api/v1/connectors/deploy") {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const body = await readJson(request, options.maxBodyBytes);
        const now = new Date().toISOString();
        const connectorType = body.type === "ecs-docker-compose" ? "ecs-docker-compose" : "http-webhook";
        const connector: StoredDeployConnector = {
          id: requireBodyString(body.id, "DEPLOY_CONNECTOR_ID_REQUIRED", runtime, "default"),
          name: String(body.name ?? body.id ?? "生产部署连接器").trim(),
          type: connectorType,
          url: body.url || body.webhookUrl ? String(body.url ?? body.webhookUrl).trim() : undefined,
          rollbackUrl: body.rollbackUrl ? String(body.rollbackUrl).trim() : undefined,
          method: connectorType === "http-webhook" ? "POST" : undefined,
          token: body.token ? String(body.token) : undefined,
          tokenRef: body.tokenRef ? String(body.tokenRef) : undefined,
          headers: body.headers && typeof body.headers === "object" ? normalizeStringMap(body.headers) : undefined,
          timeoutSeconds: Math.max(1, Math.min(300, Number(body.timeoutSeconds ?? 30))),
          workingDir: body.workingDir ? String(body.workingDir).trim() : undefined,
          composeFile: body.composeFile ? String(body.composeFile).trim() : connectorType === "ecs-docker-compose" ? "docker-compose.yml" : undefined,
          serviceName: body.serviceName ? String(body.serviceName).trim() : undefined,
          gitRemote: body.gitRemote ? String(body.gitRemote).trim() : "origin",
          gitBranch: body.gitBranch ? String(body.gitBranch).trim() : "main",
          gitPull: body.gitPull === undefined ? connectorType === "ecs-docker-compose" : Boolean(body.gitPull),
          preserveLocalPaths: normalizeStringList(body.preserveLocalPaths, []),
          build: body.build === undefined ? true : Boolean(body.build),
          skipComposeWhenUnchanged: Boolean(body.skipComposeWhenUnchanged),
          deployLock: body.deployLock === undefined ? connectorType === "ecs-docker-compose" : Boolean(body.deployLock),
          idempotency: body.idempotency === undefined ? connectorType === "ecs-docker-compose" : Boolean(body.idempotency),
          rollbackOnFailure: body.rollbackOnFailure === undefined ? connectorType === "ecs-docker-compose" : Boolean(body.rollbackOnFailure),
          rollbackOnHealthFailure: body.rollbackOnHealthFailure === undefined ? connectorType === "ecs-docker-compose" : Boolean(body.rollbackOnHealthFailure),
          gitCommand: body.gitCommand ? String(body.gitCommand).trim() : "git",
          dockerCommand: body.dockerCommand ? String(body.dockerCommand).trim() : "docker",
          healthPath: body.healthPath ? String(body.healthPath) : undefined,
          readyPath: body.readyPath ? String(body.readyPath) : undefined,
          createdAt: now,
          updatedAt: now
        };
        if (!connector.id) return writeJson(response, 400, { error: "DEPLOY_CONNECTOR_REQUIRED" });
        if (connector.type === "http-webhook" && !connector.url) return writeJson(response, 400, { error: "DEPLOY_CONNECTOR_URL_REQUIRED" });
        if (connector.type === "ecs-docker-compose" && !connector.workingDir) return writeJson(response, 400, { error: "DEPLOY_CONNECTOR_WORKING_DIR_REQUIRED" });
        store.writeDeployConnector(connector);
        store.appendAudit(audit(auth, "deploy.connector.saved", connector.id, { type: connector.type, url: connector.url, workingDir: connector.workingDir }));
        return writeJson(response, 201, envelope(maskDeployConnector(connector)));
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
        return writeJson(response, 200, envelope(store.listProjects()
          .filter((project) => canAccessScopedResource(auth, project.tenantId, project.workspaceId))
          .map(maskProject)));
      }
      const projectOwnershipMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/ownership$/);
      if (request.method === "PATCH" && projectOwnershipMatch) {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const project = store.readProject(decodeURIComponent(projectOwnershipMatch[1]));
        if (!project) return writeJson(response, 404, { error: "PROJECT_NOT_FOUND" });
        const body = await readJson(request, options.maxBodyBytes);
        const tenantId = safeFileName(optionalTrimmedString(body.tenantId) ?? project.tenantId);
        const workspaceId = safeFileName(optionalTrimmedString(body.workspaceId) ?? project.workspaceId);
        const workspace = store.readWorkspace(workspaceId);
        if (!workspace) return writeJson(response, 404, { error: "WORKSPACE_NOT_FOUND" });
        if (workspace.tenantId !== tenantId) return writeJson(response, 409, { error: "PROJECT_WORKSPACE_TENANT_MISMATCH" });
        const updated = {
          ...project,
          tenantId,
          workspaceId,
          updatedAt: new Date().toISOString()
        };
        store.writeProject(updated);
        store.appendAudit(audit(auth, "project.ownership.updated", updated.id, {
          fromTenantId: project.tenantId,
          fromWorkspaceId: project.workspaceId,
          tenantId,
          workspaceId
        }));
        return writeJson(response, 200, envelope(maskProject(updated)));
      }
      const projectDiagnosticsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/diagnostics$/);
      if (request.method === "GET" && projectDiagnosticsMatch) {
        if (!hasRole(auth, "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const project = store.readProject(decodeURIComponent(projectDiagnosticsMatch[1]));
        if (!project) return writeJson(response, 404, { error: "PROJECT_NOT_FOUND" });
        if (!canAccessScopedResource(auth, project.tenantId, project.workspaceId)) return writeJson(response, 403, { error: "PROJECT_FORBIDDEN" });
        return writeJson(response, 200, envelope(await diagnoseProjectRuntime({ store, project, runtime })));
      }
      const projectSourceCredentialMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/source-credentials$/);
      if (request.method === "POST" && projectSourceCredentialMatch) {
        if (!hasRole(auth, "admin")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const project = store.readProject(decodeURIComponent(projectSourceCredentialMatch[1]));
        if (!project) return writeJson(response, 404, { error: "PROJECT_NOT_FOUND" });
        if (!canAccessScopedResource(auth, project.tenantId, project.workspaceId)) return writeJson(response, 403, { error: "PROJECT_FORBIDDEN" });
        if (!project.repository) return writeJson(response, 409, { error: "PROJECT_REPOSITORY_NOT_CONFIGURED" });
        const body = await readJson(request, options.maxBodyBytes);
        const updated = updateProjectSourceCredentials(project, body);
        updated.validation = await validateProjectRepository(updated.repository);
        updated.updatedAt = new Date().toISOString();
        store.writeProject(updated);
        const readiness = await checkSourceCredentialReadiness(updated);
        store.appendAudit(audit(auth, "project.source-credentials.updated", updated.id, {
          provider: updated.repository?.provider,
          tokenRefConfigured: Boolean(updated.repository?.credentials?.tokenRef),
          tokenConfigured: Boolean(updated.repository?.credentials?.token || updated.repository?.credentials?.password),
          readiness: readiness.status,
          blockers: readiness.blockers
        }));
        return writeJson(response, readiness.status === "READY" ? 200 : 409, envelope({ project: maskProject(updated), readiness }));
      }
      const projectSourceCredentialPreflightMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/source-credentials\/preflight$/);
      if ((request.method === "GET" || request.method === "POST") && projectSourceCredentialPreflightMatch) {
        if (!hasRole(auth, request.method === "POST" ? "operator" : "viewer")) return writeJson(response, 403, { error: "FORBIDDEN" });
        const project = store.readProject(decodeURIComponent(projectSourceCredentialPreflightMatch[1]));
        if (!project) return writeJson(response, 404, { error: "PROJECT_NOT_FOUND" });
        if (!canAccessScopedResource(auth, project.tenantId, project.workspaceId)) return writeJson(response, 403, { error: "PROJECT_FORBIDDEN" });
        const readiness = await checkSourceCredentialReadiness(project);
        if (request.method === "POST") {
          store.appendAudit(audit(auth, "project.source-credentials-preflight", project.id, {
            provider: project.repository?.provider,
            readiness: readiness.status,
            blockers: readiness.blockers
          }));
        }
        return writeJson(response, readiness.status === "READY" ? 200 : 409, envelope(readiness));
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
        const tenantId = safeFileName(optionalTrimmedString(body.tenantId) ?? auth.tenantId);
        const workspaceId = safeFileName(optionalTrimmedString(body.workspaceId) ?? auth.workspaceId);
        const workspace = store.readWorkspace(workspaceId);
        if (!workspace) return writeJson(response, 404, { error: "WORKSPACE_NOT_FOUND" });
        if (workspace.tenantId !== tenantId) return writeJson(response, 409, { error: "PROJECT_WORKSPACE_TENANT_MISMATCH" });
        const usage = workspaceUsage(store, workspace);
        if (usage.projects.used >= usage.projects.limit) {
          return writeJson(response, 429, { error: "WORKSPACE_PROJECT_QUOTA_EXCEEDED", detail: usage });
        }
        const repository = normalizeProjectRepository(body);
        const validation = await validateProjectRepository(repository);
        const cicd = normalizeProjectCicd(body, projectId);
        const projectRuntime = normalizeProjectRuntime(body);
        const project: StoredProject = {
          id: projectId,
          name: String(body.name ?? body.id ?? "").trim(),
          profileId: String(body.profileId ?? profile.id),
          tenantId,
          workspaceId,
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
        const body = await readJson(request, options.maxBodyBytes);
        const freeze = store.projectEvolutionFreezeDiagnostic(delivery.projectId);
        if (freeze && !store.isCostOptimizationDeliveryAllowed(delivery, body)) {
          store.appendAudit(audit(auth, "delivery.blocked-by-cost-freeze", deliveryId, { projectId: delivery.projectId, reason: freeze.reason }));
          return writeJson(response, 409, { error: "EVOLUTION_COST_BUDGET_FROZEN", detail: freeze.reason, costReport: freeze.costReport });
        }
        if (delivery.approvalRequired && review?.status !== "USER_CONFIRMED") {
          return writeJson(response, 409, { error: "USER_CONFIRMATION_REQUIRED" });
        }
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
        const body = await readJson(request, options.maxBodyBytes);
        const freeze = store.projectEvolutionFreezeDiagnostic(delivery.projectId);
        if (freeze && !store.isCostOptimizationDeliveryAllowed(delivery, body)) {
          store.appendAudit(audit(auth, "code-upgrade.blocked-by-cost-freeze", deliveryId, { projectId: delivery.projectId, reason: freeze.reason }));
          return writeJson(response, 409, { error: "EVOLUTION_COST_BUDGET_FROZEN", detail: freeze.reason, costReport: freeze.costReport });
        }
        if (delivery.approvalRequired && review?.status !== "USER_CONFIRMED") {
          return writeJson(response, 409, { error: "USER_CONFIRMATION_REQUIRED" });
        }
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
        const body = await readJson(request, options.maxBodyBytes);
        const freeze = store.projectEvolutionFreezeDiagnostic(delivery.projectId);
        if (freeze && !store.isCostOptimizationDeliveryAllowed(delivery, body)) {
          store.appendAudit(audit(auth, "delivery.schedule.blocked-by-cost-freeze", deliveryId, { projectId: delivery.projectId, reason: freeze.reason }));
          return writeJson(response, 409, { error: "EVOLUTION_COST_BUDGET_FROZEN", detail: freeze.reason, costReport: freeze.costReport });
        }
        if (delivery.approvalRequired && review?.status !== "USER_CONFIRMED") {
          return writeJson(response, 409, { error: "USER_CONFIRMATION_REQUIRED" });
        }
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
      if (error instanceof HttpError) {
        logWarn("http.request.rejected", {
          requestId,
          tenantId: requestAuth?.tenantId,
          workspaceId: requestAuth?.workspaceId,
          actor: requestAuth?.actor,
          role: requestAuth?.role,
          method: request.method,
          path: url.pathname,
          statusCode: error.statusCode,
          routeGroup: routeGroup(url.pathname),
          outcome: httpOutcome(error.statusCode),
          errorCode: error.code,
          error: error.detail ?? error.code,
          correlation: { requestId, traceId, parentRequestId },
          diagnosis: diagnosisForHttpStatus(error.statusCode, error.code)
        });
        return writeJson(response, error.statusCode, { error: error.code, detail: error.detail, requestId });
      }
      logError("http.request.failed", error, {
        requestId,
        tenantId: requestAuth?.tenantId,
        workspaceId: requestAuth?.workspaceId,
        actor: requestAuth?.actor,
        role: requestAuth?.role,
        method: request.method,
        path: url.pathname,
        statusCode: 500,
        routeGroup: routeGroup(url.pathname),
        outcome: "failed",
        correlation: { requestId, traceId, parentRequestId },
        diagnosis: diagnosisForHttpStatus(500)
      });
      return writeJson(response, 500, { error: error instanceof Error ? error.message : String(error), requestId });
    }
  });
}

class FileStore {
  constructor(
    private readonly dataRoot: string,
    private readonly executionRuntime: { llmClient?: LlmTaskClient; requireLlm?: boolean } = {}
  ) {
    fs.mkdirSync(this.dataRoot, { recursive: true });
    fs.mkdirSync(this.tenantsDir, { recursive: true });
    fs.mkdirSync(this.workspacesDir, { recursive: true });
    fs.mkdirSync(this.usersDir, { recursive: true });
    fs.mkdirSync(this.secretsDir, { recursive: true });
    fs.mkdirSync(this.githubAppInstallationsDir, { recursive: true });
    fs.mkdirSync(this.runsDir, { recursive: true });
    fs.mkdirSync(this.projectsDir, { recursive: true });
    fs.mkdirSync(path.dirname(this.auditFile), { recursive: true });
    fs.mkdirSync(this.idempotencyDir, { recursive: true });
    fs.mkdirSync(this.rulesDir, { recursive: true });
    fs.mkdirSync(this.jenkinsConnectorsDir, { recursive: true });
    fs.mkdirSync(this.openHandsConnectorsDir, { recursive: true });
    fs.mkdirSync(this.deployConnectorsDir, { recursive: true });
    fs.mkdirSync(this.pipelinesDir, { recursive: true });
    fs.mkdirSync(this.evaluationDatasetsDir, { recursive: true });
    fs.mkdirSync(this.codeUpgradeRunsDir, { recursive: true });
    fs.mkdirSync(this.codeUpgradeEventsDir, { recursive: true });
    fs.mkdirSync(this.codeUpgradeArtifactsDir, { recursive: true });
    fs.mkdirSync(this.schedulesDir, { recursive: true });
    fs.mkdirSync(this.evolutionBatchesDir, { recursive: true });
    fs.mkdirSync(this.evolutionCursorsDir, { recursive: true });
    fs.mkdirSync(this.soakReportsDir, { recursive: true });
    fs.mkdirSync(this.releaseEvidenceDir, { recursive: true });
    fs.mkdirSync(this.releaseTargetsDir, { recursive: true });
    fs.mkdirSync(this.releaseDecisionsDir, { recursive: true });
    fs.mkdirSync(this.sourceReleaseRunsDir, { recursive: true });
    fs.mkdirSync(this.sourceReleaseDeployFinalizersDir, { recursive: true });
    fs.mkdirSync(this.targetLoopsDir, { recursive: true });
    fs.mkdirSync(this.loopsDir, { recursive: true });
    fs.mkdirSync(this.loopWorkspacesDir, { recursive: true });
    fs.mkdirSync(this.executorGraphsDir, { recursive: true });
    fs.mkdirSync(this.discoveryCandidatesDir, { recursive: true });
    fs.mkdirSync(this.findingHandoffsDir, { recursive: true });
    fs.mkdirSync(this.adversarialEvaluationsDir, { recursive: true });
    fs.mkdirSync(this.recurringLoopSchedulesDir, { recursive: true });
    fs.mkdirSync(this.loopMemoryInboxDir, { recursive: true });
    fs.mkdirSync(this.guardrailEvaluationsDir, { recursive: true });
    this.ensureMetadata();
    this.ensureDefaultTenantWorkspace();
  }

  get tenantsDir(): string {
    return path.join(this.dataRoot, "tenants");
  }

  get workspacesDir(): string {
    return path.join(this.dataRoot, "workspaces");
  }

  get usersDir(): string {
    return path.join(this.dataRoot, "users");
  }

  get secretsDir(): string {
    return path.join(this.dataRoot, "secrets");
  }

  get githubAppInstallationsDir(): string {
    return path.join(this.dataRoot, "github-app-installations");
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

  get deployConnectorsDir(): string {
    return path.join(this.dataRoot, "connectors", "deploy");
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

  get soakReportsDir(): string {
    return path.join(this.dataRoot, "soak-reports");
  }

  get releaseEvidenceDir(): string {
    return path.join(this.dataRoot, "release-evidence");
  }

  get releaseTargetsDir(): string {
    return path.join(this.dataRoot, "release-targets");
  }

  get releaseDecisionsDir(): string {
    return path.join(this.dataRoot, "release-decisions");
  }

  get sourceReleaseRunsDir(): string {
    return path.join(this.dataRoot, "source-release-runs");
  }

  get sourceReleaseDeployFinalizersDir(): string {
    return path.join(this.dataRoot, "source-release-deploy-finalizers");
  }

  get targetLoopsDir(): string {
    return path.join(this.dataRoot, "target-loops");
  }

  get loopsDir(): string {
    return path.join(this.dataRoot, "loops");
  }

  get loopWorkspacesDir(): string {
    return path.join(this.dataRoot, "loop-workspaces");
  }

  get executorGraphsDir(): string {
    return path.join(this.dataRoot, "executor-graphs");
  }

  get discoveryCandidatesDir(): string {
    return path.join(this.dataRoot, "loop-target-runtime", "discovery-candidates");
  }

  get findingHandoffsDir(): string {
    return path.join(this.dataRoot, "loop-target-runtime", "finding-handoffs");
  }

  get adversarialEvaluationsDir(): string {
    return path.join(this.dataRoot, "loop-target-runtime", "adversarial-evaluations");
  }

  get recurringLoopSchedulesDir(): string {
    return path.join(this.dataRoot, "loop-target-runtime", "recurring-schedules");
  }

  get loopMemoryInboxDir(): string {
    return path.join(this.dataRoot, "loop-target-runtime", "memory-inbox");
  }

  get guardrailEvaluationsDir(): string {
    return path.join(this.dataRoot, "loop-target-runtime", "guardrail-evaluations");
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

  loopStoreRuntime(): LoopStoreRuntime {
    return normalizeLoopStoreRuntime();
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
    const freezes = this.computeEvolutionFreezes();
    const insights = this.discoverOpportunityInsights();
    const learnedReleases = runs.flatMap((run) => run.learningRecords);
    const scorecards = this.computeServiceScorecards();
    const sloReports = this.computeSloReports();
    const policyEvaluations = this.evaluateGovernancePolicies();
    const supplyChainReports = this.computeSupplyChainReports();
    const costReports = this.computeCostReports();
    const releaseReadiness = this.computeReleaseReadinessReports();
    const rolloutStrategies = this.computeRolloutStrategyReports();
    const releaseDecisions = this.listReleaseDecisions();
    const latestDecision = releaseDecisions.slice(-1)[0];
    const currentDecision = currentReleaseDecision(releaseDecisions);
    return {
      projectCount: this.listProjects().length,
      runCount: runs.length,
      pipelineCount: pipelines.length,
      evaluationDatasetCount: datasets.length,
      evolutionBatchCount: batches.length,
      activeEvolutionBatchCount: batches.filter((batch) => ["CANDIDATE", "DRAFT_READY", "CONFIRMED", "CODE_UPGRADING", "CICD_RUNNING"].includes(batch.status)).length,
      costOptimizationEvolutionBatchCount: batches.filter((batch) => batch.intent === "cost-optimization").length,
      successfulEvolutionBatchCount: batches.filter((batch) => batch.status === "SUCCEEDED").length,
      failedEvolutionBatchCount: batches.filter((batch) => batch.status === "FAILED").length,
      frozenProjectCount: freezes.length,
      evolutionFreezes: freezes,
      costOptimizationReadyCount: batches.filter((batch) => batch.intent === "cost-optimization" && ["CANDIDATE", "DRAFT_READY", "CONFIRMED"].includes(batch.status)).length,
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
      recentRuns: runs.slice(-5).reverse().map(sanitizeRunForSummary),
      recentOpportunityInsights: insights.slice(0, 5),
      serviceScorecards: scorecards,
      sloReports,
      policyEvaluations,
      supplyChainReports,
      costReports,
      releaseReadiness,
      rolloutStrategies,
      recentCodeUpgrades: codeUpgrades.slice(-5).reverse(),
      recentPipelines: pipelines.slice(-5).reverse().map(sanitizePipelineRun),
      recentEvolutionBatches: batches.slice(-5).reverse(),
      recentSoakReports: this.listSoakReports().slice(-5).reverse(),
      recentReleaseEvidence: this.listReleaseEvidenceSummaries().slice(-5).reverse(),
      releaseTargetCount: this.listReleaseTargets().length,
      releaseDecisionCount: releaseDecisions.length,
      latestReleaseDecision: latestDecision,
      currentReleaseDecision: currentDecision,
      currentReleaseTargetId: currentDecision?.targetId ?? "saas-ga",
      targetLoopCount: this.listTargetLoops().length,
      latestTargetLoop: this.listTargetLoops().slice(-1)[0],
      discoveryCandidateCount: this.listDiscoverySkillCandidates().length,
      memoryInboxCount: this.listLoopMemoryInboxItems().filter((item) => item.status === "NEW" || item.status === "ACCEPTED").length,
      recurringLoopScheduleCount: this.listRecurringLoopSchedules().length,
      latestGuardrailEvaluation: this.listGuardrailEvaluations().slice(-1)[0]
    };
  }

  saasObservability(): object {
    const tenants = this.listTenants();
    const workspaces = this.listWorkspaces();
    const projects = this.listProjects();
    const loops = this.listLoops();
    const secrets = this.listSecrets();
    const githubApps = this.listGitHubAppInstallations();
    const releaseDecisions = this.listReleaseDecisions();
    const releaseEvidence = this.listReleaseEvidenceSummaries();
    const loopTraces = this.listLoopTraces();
    const queue = this.listLoopWorkerQueue();
    const storeReadiness = loopStoreReadinessSnapshot(this.loopStoreRuntime());
    const sourceReleaseRuns = this.listSourceReleaseClosureRuns();
    const latestSaasGoDecision = latestSaasGoReleaseDecision(releaseDecisions);
    const latestSaasGoAt = latestSaasGoDecision ? Date.parse(latestSaasGoDecision.generatedAt) : undefined;
    const quotaBlocked = workspaces
      .map((workspace) => workspaceUsage(this, workspace))
      .filter((usage) => usage.projects.remaining === 0 || usage.loops.remaining === 0 || usage.evidenceGb.remaining === 0);
    const credentialBlocked = githubApps.filter((installation) => installation.status !== "READY");
    const runningLoops = loops.filter((loop) => loop.status === "RUNNING").length;
    const blockedLoops = loops.filter((loop) => isOpenBlockedLoop(loop, sourceReleaseRuns, latestSaasGoAt)).length;
    const queueClaimable = queue.filter((item) => item.claimable).length;
    const blockers = [
      ...storeReadiness.blockers,
      ...credentialBlocked.map((installation) => `GITHUB_APP_BLOCKED:${installation.id}`),
      ...quotaBlocked.map((usage) => `WORKSPACE_QUOTA_EXHAUSTED:${usage.workspaceId}`)
    ];
    return {
      schema: "evopilot-saas-observability/v1",
      status: blockers.length === 0 ? "READY" : "BLOCKED",
      tenantCount: tenants.length,
      workspaceCount: workspaces.length,
      projectCount: projects.length,
      loopCount: loops.length,
      runningLoopCount: runningLoops,
      blockedLoopCount: blockedLoops,
      secretRefCount: secrets.length,
      githubAppInstallationCount: githubApps.length,
      githubAppReadyCount: githubApps.filter((installation) => installation.status === "READY").length,
      releaseEvidenceCount: releaseEvidence.length,
      releaseDecisionCount: releaseDecisions.length,
      loopTraceCount: loopTraces.length,
      queueClaimableCount: queueClaimable,
      queueLeasedCount: queue.length - queueClaimable,
      postgresStoreReady: storeReadiness.status === "READY",
      quotaBlockedWorkspaceCount: quotaBlocked.length,
      credentialBlockedCount: credentialBlocked.length,
      blockers,
      evidence: [
        `tenants=${tenants.length}`,
        `workspaces=${workspaces.length}`,
        `projects=${projects.length}`,
        `loops=${loops.length}`,
        `runningLoops=${runningLoops}`,
        `blockedLoops=${blockedLoops}`,
        `secretRefs=${secrets.length}`,
        `githubAppsReady=${githubApps.filter((installation) => installation.status === "READY").length}/${githubApps.length}`,
        `queueClaimable=${queueClaimable}`,
        `postgresStoreReady=${storeReadiness.status === "READY"}`
      ],
      evaluatedAt: new Date().toISOString()
    };
  }

  loopTargetRuntimeSummary(): object {
    return {
      discoveryCandidates: this.listDiscoverySkillCandidates().slice(-20).reverse(),
      findingHandoffs: this.listFindingWorktreeHandoffs().slice(-20).reverse(),
      adversarialEvaluations: this.listAdversarialEvaluations().slice(-20).reverse(),
      recurringSchedules: this.listRecurringLoopSchedules().slice(-20).reverse(),
      memoryInbox: this.listLoopMemoryInboxItems().slice(-50).reverse(),
      guardrailEvaluations: this.listGuardrailEvaluations().slice(-20).reverse()
    };
  }

  listDiscoverySkillCandidates(): DiscoverySkillCandidate[] {
    return readJsonDir<DiscoverySkillCandidate>(this.discoveryCandidatesDir);
  }

  writeDiscoverySkillCandidate(candidate: DiscoverySkillCandidate): DiscoverySkillCandidate {
    atomicWriteJson(path.join(this.discoveryCandidatesDir, `${safeFileName(candidate.id)}.json`), candidate);
    return candidate;
  }

  runDiscoverySkillRuntime(projectId?: string): DiscoverySkillCandidate[] {
    const now = new Date().toISOString();
    const projects = projectId ? this.listProjects().filter((project) => project.id === safeFileName(projectId)) : this.listProjects();
    const selectedProjects = projects.length > 0 ? projects : [this.readProject("evopilot") ?? syntheticEvoPilotProject()];
    const definitions = loopOrchestrationTargetDefinitions().filter((target) => [
      "discovery-skill-runtime",
      "per-finding-worktree-handoff",
      "adversarial-evaluator-agent",
      "recurring-loop-scheduler",
      "loop-memory-inbox",
      "budget-and-judgment-guardrails",
      "tenant-workspace-model",
      "github-app-onboarding",
      "secret-vault-and-credential-boundary",
      "workspace-rbac-and-invitation",
      "project-workspace-ownership",
      "quota-rate-limit-billing-foundation",
      "worker-queue-and-postgres-store",
      "tenant-aware-release-evidence",
      "multi-tenant-security-regression-suite",
      "saas-production-observability",
      "saas-onboarding-dashboard",
      "saas-field-e2e-source-to-ga",
      "saas-release-matrix",
      "saas-ga-soak-active",
      "saas-ga-release-decision",
      "announce-saas-multi-tenant-ga-stable"
    ].includes(target.id));
    const insights = this.discoverOpportunityInsights();
    const traces = this.listLoopTraces();
    const datasets = this.listEvaluationDatasets();
    const candidates: DiscoverySkillCandidate[] = [];
    for (const project of selectedProjects) {
      for (const target of definitions) {
        const projectInsights = insights.filter((insight) => insight.projectId === project.id);
        const candidate: DiscoverySkillCandidate = {
          schema: "evopilot-discovery-skill-candidate/v1",
          id: `candidate-${safeFileName(project.id)}-${safeFileName(target.id)}`,
          projectId: project.id,
          targetId: target.id,
          title: target.title,
          source: project.repository ? "repository" : projectInsights.length > 0 ? "production" : "manual",
          confidence: Math.min(0.95, 0.55 + projectInsights.length * 0.08 + traces.filter((trace) => trace.loopId.includes(project.id)).length * 0.03),
          affectedFiles: discoveryAffectedFilesForTarget(target.id, project),
          acceptanceCriteria: target.acceptanceCriteria,
          evidence: [
            `project=${project.id}`,
            `provider=${project.repository?.provider ?? "unknown"}`,
            `repository=${project.repository?.gitUrl ?? project.repository?.root ?? sourceUrlFromRepository(project.repository) ?? "unconfigured"}`,
            `insightCount=${projectInsights.length}`,
            `evaluationDatasetCount=${datasets.filter((dataset) => dataset.projectId === project.id).length}`,
            `traceCount=${traces.filter((trace) => trace.loopId.includes(project.id)).length}`
          ],
          status: "CANDIDATE",
          createdAt: this.listDiscoverySkillCandidates().find((item) => item.id === `candidate-${safeFileName(project.id)}-${safeFileName(target.id)}`)?.createdAt ?? now,
          updatedAt: now
        };
        candidates.push(this.writeDiscoverySkillCandidate(candidate));
        this.writeLoopMemoryInboxItem(memoryInboxItemFromDiscoveryCandidate(candidate));
      }
    }
    return candidates;
  }

  listFindingWorktreeHandoffs(): FindingWorktreeHandoff[] {
    return readJsonDir<FindingWorktreeHandoff>(this.findingHandoffsDir);
  }

  writeFindingWorktreeHandoff(handoff: FindingWorktreeHandoff): FindingWorktreeHandoff {
    atomicWriteJson(path.join(this.findingHandoffsDir, `${safeFileName(handoff.id)}.json`), handoff);
    return handoff;
  }

  allocateFindingWorktreeHandoff(input: {
    findingId?: string;
    projectId?: string;
    targetId?: string;
    allowedPaths?: string[];
    validationCommands?: string[];
  }): FindingWorktreeHandoff {
    const now = new Date().toISOString();
    const projectId = safeFileName(String(input.projectId ?? "evopilot"));
    const project = this.readProject(projectId);
    const findingId = safeFileName(String(input.findingId ?? input.targetId ?? `finding-${Date.now()}`));
    const sourceBranch = project?.repository?.defaultBranch ?? "main";
    const targetBranch = `evopilot/${findingId}`;
    const workspaceRoot = path.join(this.loopWorkspacesDir, "findings", findingId);
    fs.mkdirSync(workspaceRoot, { recursive: true });
    return this.writeFindingWorktreeHandoff({
      schema: "evopilot-finding-worktree-handoff/v1",
      id: `handoff-${findingId}`,
      findingId,
      projectId,
      provider: project?.repository?.provider ?? "unknown",
      workspaceRoot,
      sourceBranch,
      targetBranch,
      allowedPaths: normalizeStringList(input.allowedPaths, ["packages", "apps", "docs", "tests"]),
      validationCommands: normalizeStringList(input.validationCommands, ["npm run check"]),
      rollbackRef: sourceBranch,
      status: "ALLOCATED",
      evidence: [
        `workspaceRoot=${workspaceRoot}`,
        `sourceBranch=${sourceBranch}`,
        `targetBranch=${targetBranch}`,
        `provider=${project?.repository?.provider ?? "unknown"}`
      ],
      createdAt: now,
      updatedAt: now
    });
  }

  listAdversarialEvaluations(): AdversarialEvaluation[] {
    return readJsonDir<AdversarialEvaluation>(this.adversarialEvaluationsDir);
  }

  writeAdversarialEvaluation(evaluation: AdversarialEvaluation): AdversarialEvaluation {
    atomicWriteJson(path.join(this.adversarialEvaluationsDir, `${safeFileName(evaluation.id)}.json`), evaluation);
    return evaluation;
  }

  runAdversarialEvaluation(input: { loopId?: string; projectId?: string; targetId?: string }): AdversarialEvaluation {
    const now = new Date().toISOString();
    const loop = input.loopId ? this.readLoop(input.loopId) : undefined;
    const projectId = safeFileName(String(input.projectId ?? loop?.projectId ?? "evopilot"));
    const latestDecision = this.listReleaseDecisions().slice(-1)[0];
    const missingEvidence = [
      ...(loop && loop.iterations.length > 0 ? [] : ["loop-iteration-evidence"]),
      ...(loop?.sourceClosure.closureState === "PROMOTED" ? [] : ["source-closure-promotion"]),
      ...(latestDecision ? [] : ["release-decision"])
    ];
    const failureSignatures = loop?.trace.failureSignatures.map((item) => item.signature) ?? [];
    const status: AdversarialEvaluation["status"] = missingEvidence.includes("source-closure-promotion") ? "BLOCK" : missingEvidence.length > 0 || failureSignatures.length > 0 ? "WARN" : "PASS";
    return this.writeAdversarialEvaluation({
      schema: "evopilot-adversarial-evaluation/v1",
      id: `adv-${safeFileName(input.loopId ?? projectId)}-${Date.now()}`,
      loopId: loop?.id,
      projectId,
      targetId: input.targetId,
      status,
      checkedInputs: ["proposed-diff", "tests", "runtime-evidence", "budget-impact", "release-gates"],
      missingEvidence,
      failureSignatures,
      suggestedActions: status === "PASS" ? ["continue-source-closure"] : ["route-policy-review", "collect-missing-evidence", "replay-or-repair-loop"],
      evidence: [
        `project=${projectId}`,
        `loop=${loop?.id ?? "not-bound"}`,
        `iterations=${loop?.iterations.length ?? 0}`,
        `releaseDecision=${latestDecision?.id ?? "missing"}`,
        `sourceClosure=${loop?.sourceClosure.closureState ?? "unknown"}`
      ],
      createdAt: now
    });
  }

  listRecurringLoopSchedules(): RecurringLoopSchedule[] {
    return readJsonDir<RecurringLoopSchedule>(this.recurringLoopSchedulesDir);
  }

  writeRecurringLoopSchedule(schedule: RecurringLoopSchedule): RecurringLoopSchedule {
    atomicWriteJson(path.join(this.recurringLoopSchedulesDir, `${safeFileName(schedule.id)}.json`), schedule);
    return schedule;
  }

  upsertRecurringLoopSchedule(input: { id?: string; projectId?: string; targetId?: string; cadence?: string; maxBudgetUsd?: number; triggerRules?: string[] }): RecurringLoopSchedule {
    const now = new Date().toISOString();
    const projectId = safeFileName(String(input.projectId ?? "evopilot"));
    const targetId = safeFileName(String(input.targetId ?? "discovery-skill-runtime"));
    const id = safeFileName(String(input.id ?? `schedule-${projectId}-${targetId}`));
    const existing = this.listRecurringLoopSchedules().find((item) => item.id === id);
    const cadence = normalizeRecurringCadence(input.cadence);
    return this.writeRecurringLoopSchedule({
      schema: "evopilot-recurring-loop-schedule/v1",
      id,
      projectId,
      targetId,
      cadence,
      maxBudgetUsd: Math.max(0, Number(input.maxBudgetUsd ?? existing?.maxBudgetUsd ?? 5)),
      triggerRules: normalizeStringList(input.triggerRules, existing?.triggerRules ?? ["new-evidence", "release-window-open", "budget-pass"]),
      status: "ACTIVE",
      lastRunAt: existing?.lastRunAt,
      nextRunAt: nextRunAtForCadence(cadence, now),
      idempotencyKey: `recurring:${projectId}:${targetId}:${cadence}`,
      evidence: [`cadence=${cadence}`, `project=${projectId}`, `target=${targetId}`],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
  }

  listLoopMemoryInboxItems(): LoopMemoryInboxItem[] {
    return readJsonDir<LoopMemoryInboxItem>(this.loopMemoryInboxDir);
  }

  writeLoopMemoryInboxItem(item: LoopMemoryInboxItem): LoopMemoryInboxItem {
    const existing = this.listLoopMemoryInboxItems().find((entry) => entry.id === item.id);
    atomicWriteJson(path.join(this.loopMemoryInboxDir, `${safeFileName(item.id)}.json`), {
      ...item,
      createdAt: existing?.createdAt ?? item.createdAt,
      updatedAt: item.updatedAt
    });
    return item;
  }

  triageLoopMemoryInboxItem(id: string, status: LoopMemoryInboxItem["status"], targetId?: string): LoopMemoryInboxItem | undefined {
    const existing = this.listLoopMemoryInboxItems().find((item) => item.id === safeFileName(id));
    if (!existing) return undefined;
    return this.writeLoopMemoryInboxItem({
      ...existing,
      status,
      targetId: targetId ?? existing.targetId,
      updatedAt: new Date().toISOString()
    });
  }

  listGuardrailEvaluations(): LoopGuardrailEvaluation[] {
    return readJsonDir<LoopGuardrailEvaluation>(this.guardrailEvaluationsDir);
  }

  writeGuardrailEvaluation(evaluation: LoopGuardrailEvaluation): LoopGuardrailEvaluation {
    atomicWriteJson(path.join(this.guardrailEvaluationsDir, `${safeFileName(evaluation.id)}.json`), evaluation);
    return evaluation;
  }

  evaluateBudgetAndJudgmentGuardrails(loopId: string, input: Record<string, unknown> = {}): LoopGuardrailEvaluation | undefined {
    const loop = this.readLoop(loopId);
    if (!loop) return undefined;
    const now = new Date().toISOString();
    const budgets = {
      maxCostUsd: Math.max(0, Number(input.maxCostUsd ?? loop.context?.maxCostUsd ?? 5)),
      maxTokens: Math.max(0, Number(input.maxTokens ?? loop.context?.maxTokens ?? 100000)),
      maxDurationSeconds: Math.max(1, Number(input.maxDurationSeconds ?? loop.stopPolicy.maxDurationSeconds)),
      maxChangedFiles: Math.max(1, Number(input.maxChangedFiles ?? 20)),
      minConfidence: Math.max(0, Math.min(1, Number(input.minConfidence ?? 0.7)))
    };
    const durationSeconds = Math.max(0, Math.round((Date.now() - Date.parse(loop.createdAt)) / 1000));
    const changedFiles = new Set(loop.artifacts.map((artifact) => artifact.path).filter(Boolean)).size;
    const confidence = loop.evidenceSets.some((set) => set.status === "FAIL") ? 0.35 : loop.status === "SUCCEEDED" ? 0.9 : 0.65;
    const actual = {
      costUsd: loop.trace.cost.estimatedUsd,
      tokens: loop.trace.cost.totalTokens,
      durationSeconds,
      changedFiles,
      confidence
    };
    const blockers = [
      actual.costUsd > budgets.maxCostUsd ? `costUsd>${budgets.maxCostUsd}` : "",
      actual.tokens > budgets.maxTokens ? `tokens>${budgets.maxTokens}` : "",
      actual.durationSeconds > budgets.maxDurationSeconds ? `durationSeconds>${budgets.maxDurationSeconds}` : "",
      actual.changedFiles > budgets.maxChangedFiles ? `changedFiles>${budgets.maxChangedFiles}` : "",
      actual.confidence < budgets.minConfidence ? `confidence<${budgets.minConfidence}` : ""
    ].filter(Boolean);
    const status: LoopGuardrailEvaluation["status"] = blockers.length > 0 ? "BLOCK" : actual.confidence < 0.85 ? "WARN" : "PASS";
    return this.writeGuardrailEvaluation({
      schema: "evopilot-budget-judgment-guardrail/v1",
      id: `guardrail-${safeFileName(loop.id)}-${Date.now()}`,
      loopId: loop.id,
      projectId: loop.projectId,
      status,
      budgets,
      actual,
      releaseJudgment: status === "PASS" ? "ALLOW" : status === "WARN" ? "HUMAN_REVIEW" : "BLOCK",
      blockers,
      evidence: [
        `loop=${loop.id}`,
        `status=${loop.status}`,
        `costUsd=${actual.costUsd}`,
        `tokens=${actual.tokens}`,
        `durationSeconds=${actual.durationSeconds}`,
        `confidence=${actual.confidence}`
      ],
      createdAt: now
    });
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

  ensureDefaultTenantWorkspace(): void {
    const now = new Date().toISOString();
    if (!fs.existsSync(path.join(this.tenantsDir, `${DEFAULT_TENANT_ID}.json`))) {
      this.writeTenant({
        schema: "evopilot-tenant/v1",
        id: DEFAULT_TENANT_ID,
        name: "EvoPilot Production Tenant",
        status: "ACTIVE",
        plan: "Self-hosted SaaS",
        createdAt: now,
        updatedAt: now
      });
    }
    if (!fs.existsSync(path.join(this.workspacesDir, `${DEFAULT_WORKSPACE_ID}.json`))) {
      this.writeWorkspace({
        schema: "evopilot-workspace/v1",
        id: DEFAULT_WORKSPACE_ID,
        tenantId: DEFAULT_TENANT_ID,
        name: "Agent Products Workspace",
        status: "BOUNDARY_DRAFT",
        members: [
          { id: "owner", name: "Owner", role: "owner", status: "ACTIVE" },
          { id: "operator", name: "Operator", role: "admin", status: "ACTIVE" },
          { id: "viewer", name: "Viewer", role: "viewer", status: "ACTIVE" }
        ],
        quotas: {
          loops: 120,
          projects: 20,
          evidenceGb: 100
        },
        createdAt: now,
        updatedAt: now
      });
    }
  }

  listTenants(): TenantRecord[] {
    return fs.readdirSync(this.tenantsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.tenantsDir, file), "utf8")) as TenantRecord);
  }

  readTenant(id: string): TenantRecord | undefined {
    const file = path.join(this.tenantsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8")) as TenantRecord;
  }

  writeTenant(tenant: TenantRecord): TenantRecord {
    atomicWriteJson(path.join(this.tenantsDir, `${safeFileName(tenant.id)}.json`), tenant);
    return tenant;
  }

  ensureBootstrapAdmin(): UserRecord {
    const existing = this.listUsers(undefined, true);
    const platformAdmin = existing.find((user) => user.platformAdmin && user.status === "ACTIVE");
    if (platformAdmin) return platformAdmin;
    const now = new Date().toISOString();
    return this.writeUser({
      schema: "evopilot-user/v1",
      id: "admin",
      username: "admin",
      displayName: "Platform Admin",
      role: "admin",
      tenantId: DEFAULT_TENANT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      status: "ACTIVE",
      platformAdmin: true,
      mustChangePassword: true,
      passwordHash: hashPassword("admin"),
      createdAt: now,
      updatedAt: now
    });
  }

  listUsers(tenantId?: string, includeSuspended = true): UserRecord[] {
    return fs.readdirSync(this.usersDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => this.hydrateUser(JSON.parse(fs.readFileSync(path.join(this.usersDir, file), "utf8"))))
      .filter((user) => (!tenantId || user.tenantId === tenantId || user.platformAdmin) && (includeSuspended || user.status === "ACTIVE"));
  }

  readUser(idOrUsername: string): UserRecord | undefined {
    const id = safeFileName(idOrUsername);
    const file = path.join(this.usersDir, `${id}.json`);
    if (fs.existsSync(file)) return this.hydrateUser(JSON.parse(fs.readFileSync(file, "utf8")));
    return this.listUsers(undefined, true).find((user) => user.username === idOrUsername);
  }

  writeUser(user: UserRecord): UserRecord {
    const hydrated = this.hydrateUser(user);
    atomicWriteJson(path.join(this.usersDir, `${safeFileName(hydrated.id)}.json`), hydrated);
    return hydrated;
  }

  private hydrateUser(user: any): UserRecord {
    const now = new Date().toISOString();
    const username = String(user.username ?? user.id ?? `user-${Date.now()}`).trim();
    const id = safeFileName(String(user.id ?? username));
    const role: AuthRole = user.role === "admin" || user.role === "operator" || user.role === "viewer" ? user.role : "viewer";
    const passwordHash = String(user.passwordHash ?? hashPassword(String(user.password ?? "")));
    return {
      schema: "evopilot-user/v1",
      id,
      username,
      displayName: String(user.displayName ?? user.name ?? username),
      role,
      tenantId: safeFileName(String(user.tenantId ?? DEFAULT_TENANT_ID)),
      workspaceId: safeFileName(String(user.workspaceId ?? DEFAULT_WORKSPACE_ID)),
      status: user.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
      platformAdmin: Boolean(user.platformAdmin),
      mustChangePassword: Boolean(user.mustChangePassword),
      passwordHash,
      createdAt: String(user.createdAt ?? now),
      updatedAt: String(user.updatedAt ?? user.createdAt ?? now),
      lastLoginAt: user.lastLoginAt ? String(user.lastLoginAt) : undefined
    };
  }

  ensureTenant(id: string, name = id): TenantRecord {
    const existing = this.readTenant(id);
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.writeTenant({
      schema: "evopilot-tenant/v1",
      id: safeFileName(id),
      name,
      status: "ACTIVE",
      plan: "SaaS",
      createdAt: now,
      updatedAt: now
    });
  }

  listWorkspaces(tenantId?: string): WorkspaceRecord[] {
    return fs.readdirSync(this.workspacesDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => this.hydrateWorkspace(JSON.parse(fs.readFileSync(path.join(this.workspacesDir, file), "utf8"))))
      .filter((workspace) => !tenantId || workspace.tenantId === tenantId);
  }

  readWorkspace(id: string): WorkspaceRecord | undefined {
    const file = path.join(this.workspacesDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return this.hydrateWorkspace(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  writeWorkspace(workspace: WorkspaceRecord): WorkspaceRecord {
    const hydrated = this.hydrateWorkspace(workspace);
    atomicWriteJson(path.join(this.workspacesDir, `${safeFileName(hydrated.id)}.json`), hydrated);
    return hydrated;
  }

  private hydrateWorkspace(workspace: any): WorkspaceRecord {
    const now = new Date().toISOString();
    return {
      schema: "evopilot-workspace/v1",
      id: safeFileName(String(workspace.id ?? DEFAULT_WORKSPACE_ID)),
      tenantId: safeFileName(String(workspace.tenantId ?? DEFAULT_TENANT_ID)),
      name: String(workspace.name ?? workspace.id ?? DEFAULT_WORKSPACE_ID),
      status: normalizeWorkspaceStatus(workspace.status),
      members: Array.isArray(workspace.members) ? workspace.members.map((member: any) => ({
        id: safeFileName(String(member.id ?? member.name ?? `member-${Date.now()}`)),
        name: String(member.name ?? member.id ?? "Member"),
        role: normalizeWorkspaceMemberRole(member.role, "viewer"),
        status: normalizeWorkspaceMemberStatus(member.status, "ACTIVE")
      })) : [],
      quotas: normalizeWorkspaceQuotas(workspace.quotas),
      createdAt: String(workspace.createdAt ?? now),
      updatedAt: String(workspace.updatedAt ?? workspace.createdAt ?? now)
    };
  }

  listSecrets(tenantId?: string, workspaceId?: string): SecretRecord[] {
    return fs.readdirSync(this.secretsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => this.hydrateSecret(JSON.parse(fs.readFileSync(path.join(this.secretsDir, file), "utf8"))))
      .filter((secret) => (!tenantId || secret.tenantId === tenantId) && (!workspaceId || secret.workspaceId === workspaceId));
  }

  readSecret(id: string): SecretRecord | undefined {
    const file = path.join(this.secretsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return this.hydrateSecret(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  writeSecret(secret: SecretRecord): SecretRecord {
    const hydrated = this.hydrateSecret(secret);
    atomicWriteJson(path.join(this.secretsDir, `${safeFileName(hydrated.id)}.json`), hydrated);
    return hydrated;
  }

  private hydrateSecret(secret: any): SecretRecord {
    const now = new Date().toISOString();
    return {
      schema: "evopilot-secret/v1",
      id: safeFileName(String(secret.id ?? `secret-${Date.now()}`)),
      tenantId: safeFileName(String(secret.tenantId ?? DEFAULT_TENANT_ID)),
      workspaceId: safeFileName(String(secret.workspaceId ?? DEFAULT_WORKSPACE_ID)),
      name: String(secret.name ?? secret.id ?? "Secret"),
      kind: normalizeSecretKind(secret.kind),
      status: String(secret.status ?? "ACTIVE").toUpperCase() === "REVOKED" ? "REVOKED" : "ACTIVE",
      version: clampPositiveInteger(secret.version, 1),
      encryption: secret.encryption,
      createdAt: String(secret.createdAt ?? now),
      updatedAt: String(secret.updatedAt ?? secret.createdAt ?? now),
      rotatedAt: optionalTrimmedString(secret.rotatedAt),
      revokedAt: optionalTrimmedString(secret.revokedAt)
    };
  }

  listGitHubAppInstallations(tenantId?: string, workspaceId?: string): GitHubAppInstallationRecord[] {
    return fs.readdirSync(this.githubAppInstallationsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => this.hydrateGitHubAppInstallation(JSON.parse(fs.readFileSync(path.join(this.githubAppInstallationsDir, file), "utf8"))))
      .filter((installation) => (!tenantId || installation.tenantId === tenantId) && (!workspaceId || installation.workspaceId === workspaceId));
  }

  readGitHubAppInstallation(id: string): GitHubAppInstallationRecord | undefined {
    const file = path.join(this.githubAppInstallationsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return this.hydrateGitHubAppInstallation(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  writeGitHubAppInstallation(installation: GitHubAppInstallationRecord): GitHubAppInstallationRecord {
    const hydrated = this.hydrateGitHubAppInstallation(installation);
    atomicWriteJson(path.join(this.githubAppInstallationsDir, `${safeFileName(hydrated.id)}.json`), hydrated);
    return hydrated;
  }

  private hydrateGitHubAppInstallation(installation: any): GitHubAppInstallationRecord {
    const now = new Date().toISOString();
    const checks = Array.isArray(installation.checks) ? installation.checks : [];
    return {
      schema: "evopilot-github-app-installation/v1",
      id: safeFileName(String(installation.id ?? installation.installationId ?? `github-app-${Date.now()}`)),
      tenantId: safeFileName(String(installation.tenantId ?? DEFAULT_TENANT_ID)),
      workspaceId: safeFileName(String(installation.workspaceId ?? DEFAULT_WORKSPACE_ID)),
      installationId: String(installation.installationId ?? ""),
      account: String(installation.account ?? ""),
      repositories: Array.isArray(installation.repositories) ? installation.repositories.map(String) : [],
      permissions: isRecord(installation.permissions) ? Object.fromEntries(Object.entries(installation.permissions).map(([key, value]) => [key, String(value)])) : {},
      privateKeySecretRef: optionalTrimmedString(installation.privateKeySecretRef),
      webhookSecretRef: optionalTrimmedString(installation.webhookSecretRef),
      status: installation.status === "READY" || installation.status === "REVOKED" ? installation.status : "BLOCKED",
      checks: checks.map((check: any) => ({
        id: String(check.id ?? "unknown"),
        status: check.status === "PASS" ? "PASS" : "FAIL",
        evidence: Array.isArray(check.evidence) ? check.evidence.map(String) : []
      })),
      createdAt: String(installation.createdAt ?? now),
      updatedAt: String(installation.updatedAt ?? installation.createdAt ?? now)
    };
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
      tenantId: safeFileName(String(project.tenantId ?? DEFAULT_TENANT_ID)),
      workspaceId: safeFileName(String(project.workspaceId ?? DEFAULT_WORKSPACE_ID)),
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
    logInfo("audit.recorded", {
      actor: record.actor,
      action: record.action,
      target: record.target,
      metadata: record.metadata
    });
  }

  listAudit(): AuditRecord[] {
    if (!fs.existsSync(this.auditFile)) return [];
    return fs.readFileSync(this.auditFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => this.hydrateAuditRecord(JSON.parse(line)));
  }

  private hydrateAuditRecord(record: any): AuditRecord {
    return {
      ...record,
      tenantId: safeFileName(String(record.tenantId ?? DEFAULT_TENANT_ID)),
      workspaceId: safeFileName(String(record.workspaceId ?? DEFAULT_WORKSPACE_ID))
    } as AuditRecord;
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

  listDeployConnectors(): StoredDeployConnector[] {
    return fs.readdirSync(this.deployConnectorsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => this.hydrateDeployConnector(JSON.parse(fs.readFileSync(path.join(this.deployConnectorsDir, file), "utf8"))));
  }

  readDeployConnector(id: string): StoredDeployConnector | undefined {
    const file = path.join(this.deployConnectorsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return this.hydrateDeployConnector(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  writeDeployConnector(connector: StoredDeployConnector): void {
    const existing = this.readDeployConnector(connector.id);
    atomicWriteJson(path.join(this.deployConnectorsDir, `${safeFileName(connector.id)}.json`), {
      ...connector,
      createdAt: existing?.createdAt ?? connector.createdAt,
      updatedAt: connector.updatedAt
    });
  }

  private hydrateDeployConnector(value: any): StoredDeployConnector {
    const connector = value as StoredDeployConnector;
    if (connector.type !== "ecs-docker-compose") return connector;
    return {
      ...connector,
      composeFile: connector.composeFile ?? "docker-compose.yml",
      gitRemote: connector.gitRemote ?? "origin",
      gitBranch: connector.gitBranch ?? "main",
      gitPull: connector.gitPull ?? true,
      preserveLocalPaths: normalizeStringList(connector.preserveLocalPaths, []),
      build: connector.build ?? true,
      skipComposeWhenUnchanged: connector.skipComposeWhenUnchanged ?? false,
      deployLock: connector.deployLock ?? true,
      idempotency: connector.idempotency ?? true,
      rollbackOnFailure: connector.rollbackOnFailure ?? true,
      rollbackOnHealthFailure: connector.rollbackOnHealthFailure ?? true,
      gitCommand: connector.gitCommand ?? "git",
      dockerCommand: connector.dockerCommand ?? "docker"
    };
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
      const latestSuccessfulReleaseAt = releases
        .filter((release) => release.status === "SUCCEEDED" && release.releasedAt)
        .map((release) => Date.parse(release.releasedAt as string))
        .filter((timestamp) => Number.isFinite(timestamp))
        .sort((left, right) => right - left)[0];
      const isAfterLatestSuccessfulRelease = (timestamp: string): boolean => {
        if (!Number.isFinite(latestSuccessfulReleaseAt)) return true;
        const parsed = Date.parse(timestamp);
        return !Number.isFinite(parsed) || parsed > latestSuccessfulReleaseAt;
      };
      const failedReleaseCount = releases.filter((release) =>
        (release.status === "FAILED" || release.status === "ROLLED_BACK") &&
        isAfterLatestSuccessfulRelease(release.releasedAt ?? runFinishedAt(projectRuns, release.evidenceBundleId))
      ).length;
      const successfulReleaseCount = releases.filter((release) => release.status === "SUCCEEDED").length;
      const latencyViolationCount = projectRuns.flatMap((run) => run.evidenceBundle.events).filter((event) =>
        isAfterLatestSuccessfulRelease(event.timestamp) &&
        Number(event.attributes?.durationMs ?? event.attributes?.latencyMs ?? event.attributes?.p95LatencyMs ?? 0) > 3000
      ).length;
      const totalSignals = Math.max(1, projectRuns.reduce((sum, run) => sum + run.evidenceBundle.events.length, 0) + successfulReleaseCount * 5 + failedReleaseCount * 2);
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
      reason: `项目 ${projectId} 成本预算已超限：累计成本 ${costReport.totalCost}，Token ${costReport.totalTokens}，高成本事件 ${costReport.highCostEventCount} 次。已冻结普通自动进化，只允许成本优化型进化继续进入代码升级和 CI/CD。`
    };
  }

  computeEvolutionFreezes(): EvolutionFreezeDiagnostic[] {
    return this.listProjects()
      .map((project) => this.projectEvolutionFreezeDiagnostic(project.id))
      .filter((item): item is EvolutionFreezeDiagnostic => item !== undefined);
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

  isCostOptimizationDeliveryAllowed(delivery: DeliveryPlan, body: any): boolean {
    const batchId = typeof body?.batchId === "string" ? body.batchId : undefined;
    if (!batchId) return false;
    const batch = this.readEvolutionBatch(batchId);
    return batch?.projectId === delivery.projectId && batch.intent === "cost-optimization";
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
    activeBatchTimeoutMinutes: number;
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
      const cursor = this.readEvolutionCursor(project.id) ?? defaultEvolutionCursor(project.id);
      if (cursor.activeBatchId) {
        const active = this.readEvolutionBatch(cursor.activeBatchId);
        if (active && ["CANDIDATE", "DRAFT_READY", "CONFIRMED", "CODE_UPGRADING", "CICD_RUNNING"].includes(active.status)) {
          if (isStaleEvolutionBatch(active, now, options.activeBatchTimeoutMinutes)) {
            const failureReason = `活跃进化批次超过 ${options.activeBatchTimeoutMinutes} 分钟未推进，已自动失败以释放项目进化队列。`;
            if (!options.dryRun) this.updateEvolutionBatch(active.id, { status: "FAILED", failureReason });
            skipped.push({ projectId: project.id, reason: failureReason });
          } else {
            skipped.push({ projectId: project.id, reason: `仍有活跃进化批次 ${active.id}` });
            continue;
          }
        } else if (active) {
          this.writeEvolutionCursor({
            ...cursor,
            activeBatchId: undefined,
            updatedAt: now
          });
        } else {
          this.writeEvolutionCursor({
            ...cursor,
            activeBatchId: undefined,
            updatedAt: now
          });
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
      const candidateDatasets = freeze ? projectDatasets.filter((dataset) => isCostOptimizationDataset(dataset, runs)) : projectDatasets;
      if (freeze && candidateDatasets.length === 0) {
        skipped.push({ projectId: project.id, reason: `${freeze.reason} 当前没有新的成本优化评测集可执行。` });
        continue;
      }
      if (candidateDatasets.length < Math.max(1, options.minDatasetCount)) {
        skipped.push({ projectId: project.id, reason: `新增${freeze ? "成本优化" : ""}评测集数量不足：${candidateDatasets.length}` });
        continue;
      }
      const existingDatasetIds = new Set(this.listEvolutionBatches().filter((batch) => batch.projectId === project.id).flatMap((batch) => batch.datasetIds));
      const freshDatasets = candidateDatasets.filter((dataset) => !existingDatasetIds.has(dataset.id));
      if (freshDatasets.length < Math.max(1, options.minDatasetCount)) {
        skipped.push({ projectId: project.id, reason: `新增${freeze ? "成本优化" : ""}评测集已被进化批次消费` });
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

  listSoakReports(): SoakReport[] {
    return fs.readdirSync(this.soakReportsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.soakReportsDir, file), "utf8")) as SoakReport);
  }

  writeSoakReport(input: Partial<SoakReport> & { name?: string; durationSeconds?: number; status?: SoakReport["status"] }): SoakReport {
    const now = new Date().toISOString();
    const id = safeFileName(String(input.id ?? `soak-${Date.now()}`));
    const previous = this.readSoakReport(id);
    const report: SoakReport = {
      id,
      name: String(input.name ?? previous?.name ?? "生产级持续验证"),
      durationSeconds: Number(input.durationSeconds ?? previous?.durationSeconds ?? 0),
      status: input.status ?? previous?.status ?? "RUNNING",
      startedAt: String(input.startedAt ?? previous?.startedAt ?? now),
      finishedAt: input.finishedAt ?? previous?.finishedAt,
      summary: input.summary ?? previous?.summary,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    };
    atomicWriteJson(path.join(this.soakReportsDir, `${id}.json`), report);
    return report;
  }

  readSoakReport(id: string): SoakReport | undefined {
    const file = path.join(this.soakReportsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8")) as SoakReport;
  }

  listReleaseEvidenceBundles(): ReleaseEvidenceBundle[] {
    return fs.readdirSync(this.releaseEvidenceDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => this.hydrateReleaseEvidenceBundle(JSON.parse(fs.readFileSync(path.join(this.releaseEvidenceDir, file), "utf8"))));
  }

  listReleaseEvidenceSummaries(): ReleaseEvidenceListItem[] {
    return this.listReleaseEvidenceBundles().map((bundle) => releaseEvidenceListItem(bundle));
  }

  readReleaseEvidenceBundle(id: string): ReleaseEvidenceBundle | undefined {
    const file = path.join(this.releaseEvidenceDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return this.hydrateReleaseEvidenceBundle(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  writeReleaseEvidenceBundle(bundle: ReleaseEvidenceBundle): ReleaseEvidenceBundle {
    const hydrated = this.hydrateReleaseEvidenceBundle(bundle);
    atomicWriteJson(path.join(this.releaseEvidenceDir, `${safeFileName(hydrated.id)}.json`), hydrated);
    return hydrated;
  }

  private hydrateReleaseEvidenceBundle(bundle: any): ReleaseEvidenceBundle {
    return {
      ...bundle,
      tenantId: safeFileName(String(bundle.tenantId ?? DEFAULT_TENANT_ID)),
      workspaceId: safeFileName(String(bundle.workspaceId ?? DEFAULT_WORKSPACE_ID))
    } as ReleaseEvidenceBundle;
  }

  listReleaseTargets(): ReleaseTargetProfile[] {
    const persisted = fs.readdirSync(this.releaseTargetsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.releaseTargetsDir, file), "utf8")) as ReleaseTargetProfile);
    if (persisted.some((target) => target.id === "ga")) return persisted;
    return [defaultGAReleaseTarget(), ...persisted];
  }

  readReleaseTarget(id: string): ReleaseTargetProfile | undefined {
    const safeId = safeFileName(id);
    const file = path.join(this.releaseTargetsDir, `${safeId}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as ReleaseTargetProfile;
    if (safeId === "ga") return defaultGAReleaseTarget();
    return undefined;
  }

  writeReleaseTarget(target: ReleaseTargetProfile): ReleaseTargetProfile {
    atomicWriteJson(path.join(this.releaseTargetsDir, `${safeFileName(target.id)}.json`), target);
    return target;
  }

  listReleaseDecisions(): ReleaseDecision[] {
    return fs.readdirSync(this.releaseDecisionsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => this.hydrateReleaseDecision(JSON.parse(fs.readFileSync(path.join(this.releaseDecisionsDir, file), "utf8"))))
      .sort((left, right) => Date.parse(left.generatedAt) - Date.parse(right.generatedAt));
  }

  readReleaseDecision(id: string): ReleaseDecision | undefined {
    const file = path.join(this.releaseDecisionsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return this.hydrateReleaseDecision(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  writeReleaseDecision(decision: ReleaseDecision): ReleaseDecision {
    const hydrated = this.hydrateReleaseDecision(decision);
    atomicWriteJson(path.join(this.releaseDecisionsDir, `${safeFileName(hydrated.id)}.json`), hydrated);
    return hydrated;
  }

  private hydrateReleaseDecision(decision: any): ReleaseDecision {
    return {
      ...decision,
      tenantId: safeFileName(String(decision.tenantId ?? DEFAULT_TENANT_ID)),
      workspaceId: safeFileName(String(decision.workspaceId ?? DEFAULT_WORKSPACE_ID))
    } as ReleaseDecision;
  }

  listSourceReleaseClosureRuns(loopId?: string): SourceReleaseClosureRun[] {
    const runs = fs.readdirSync(this.sourceReleaseRunsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => this.hydrateSourceReleaseClosureRun(JSON.parse(fs.readFileSync(path.join(this.sourceReleaseRunsDir, file), "utf8"))))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    return loopId ? runs.filter((run) => run.loopId === loopId) : runs;
  }

  readSourceReleaseClosureRun(id: string): SourceReleaseClosureRun | undefined {
    const file = path.join(this.sourceReleaseRunsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return this.hydrateSourceReleaseClosureRun(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  writeSourceReleaseClosureRun(run: SourceReleaseClosureRun): SourceReleaseClosureRun {
    const hydrated = this.hydrateSourceReleaseClosureRun(run);
    atomicWriteJson(path.join(this.sourceReleaseRunsDir, `${safeFileName(hydrated.id)}.json`), hydrated);
    return hydrated;
  }

  private hydrateSourceReleaseClosureRun(run: any): SourceReleaseClosureRun {
    const loop = run.loopId ? this.readLoop(String(run.loopId)) : undefined;
    const project = run.projectId ? this.readProject(String(run.projectId)) : undefined;
    return {
      ...run,
      tenantId: safeFileName(String(run.tenantId ?? loop?.tenantId ?? project?.tenantId ?? DEFAULT_TENANT_ID)),
      workspaceId: safeFileName(String(run.workspaceId ?? loop?.workspaceId ?? project?.workspaceId ?? DEFAULT_WORKSPACE_ID))
    } as SourceReleaseClosureRun;
  }

  listSourceReleaseDeployFinalizers(status?: SourceReleaseDeployFinalizer["status"]): SourceReleaseDeployFinalizer[] {
    const finalizers = fs.readdirSync(this.sourceReleaseDeployFinalizersDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.sourceReleaseDeployFinalizersDir, file), "utf8")) as SourceReleaseDeployFinalizer)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    return status ? finalizers.filter((finalizer) => finalizer.status === status) : finalizers;
  }

  readSourceReleaseDeployFinalizer(id: string): SourceReleaseDeployFinalizer | undefined {
    const file = path.join(this.sourceReleaseDeployFinalizersDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8")) as SourceReleaseDeployFinalizer;
  }

  writeSourceReleaseDeployFinalizer(finalizer: SourceReleaseDeployFinalizer): SourceReleaseDeployFinalizer {
    atomicWriteJson(path.join(this.sourceReleaseDeployFinalizersDir, `${safeFileName(finalizer.id)}.json`), finalizer);
    return finalizer;
  }

  listTargetLoops(): TargetLoopRun[] {
    return fs.readdirSync(this.targetLoopsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.targetLoopsDir, file), "utf8")) as TargetLoopRun)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }

  readTargetLoop(id: string): TargetLoopRun | undefined {
    const file = path.join(this.targetLoopsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8")) as TargetLoopRun;
  }

  writeTargetLoop(loop: TargetLoopRun): TargetLoopRun {
    atomicWriteJson(path.join(this.targetLoopsDir, `${safeFileName(loop.id)}.json`), loop);
    return loop;
  }

  listExecutorGraphs(): ExecutorGraph[] {
    const persisted = fs.readdirSync(this.executorGraphsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => normalizeExecutorGraph(JSON.parse(fs.readFileSync(path.join(this.executorGraphsDir, file), "utf8"))));
    if (persisted.some((graph) => graph.id === "default-loop-engineering")) return persisted;
    return [defaultExecutorGraph(), ...persisted];
  }

  readExecutorGraph(id: string): ExecutorGraph | undefined {
    const safeId = safeFileName(id);
    const file = path.join(this.executorGraphsDir, `${safeId}.json`);
    if (fs.existsSync(file)) return normalizeExecutorGraph(JSON.parse(fs.readFileSync(file, "utf8")));
    if (safeId === "default-loop-engineering") return defaultExecutorGraph();
    return undefined;
  }

  writeExecutorGraph(graph: ExecutorGraph): ExecutorGraph {
    atomicWriteJson(path.join(this.executorGraphsDir, `${safeFileName(graph.id)}.json`), graph);
    return graph;
  }

  listLoops(): LoopRun[] {
    return fs.readdirSync(this.loopsDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => this.hydrateLoop(JSON.parse(fs.readFileSync(path.join(this.loopsDir, file), "utf8"))))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }

  readLoop(id: string): LoopRun | undefined {
    const file = path.join(this.loopsDir, `${safeFileName(id)}.json`);
    if (!fs.existsSync(file)) return undefined;
    return this.hydrateLoop(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  writeLoop(loop: LoopRun): LoopRun {
    const hydrated = this.hydrateLoop(loop);
    atomicWriteJson(path.join(this.loopsDir, `${safeFileName(hydrated.id)}.json`), hydrated);
    return hydrated;
  }

  listLoopTraces(): LoopTraceSummary[] {
    return this.listLoops().map((loop) => loop.trace);
  }

  readLoopSandboxProof(loopId: string): LoopSandboxBoundaryProof | undefined {
    const loop = this.readLoop(loopId);
    if (!loop) return undefined;
    return buildLoopSandboxBoundaryProof(loop);
  }

  verifyLoopSandboxProof(loopId: string, actor: string): { loop: LoopRun; proof: LoopSandboxBoundaryProof } | undefined {
    const loop = this.readLoop(loopId);
    if (!loop) return undefined;
    const proof = buildLoopSandboxBoundaryProof(loop);
    const now = new Date().toISOString();
    const updated = this.writeLoop({
      ...loop,
      context: {
        ...loop.context,
        sandboxBoundaryProof: {
          status: proof.status,
          verifiedAt: now,
          verifiedBy: actor,
          checkCount: proof.checks.length
        }
      },
      timeline: [
        ...loop.timeline,
        loopTimelineEvent("EVIDENCE", `Sandbox boundary proof ${proof.status} for ${proof.runtime}.`, {
          runtime: proof.runtime,
          status: proof.status,
          checks: proof.checks.map((check) => `${check.id}:${check.status}`)
        })
      ],
      updatedAt: now
    });
    return { loop: updated, proof };
  }

  readLoopTraceTree(loopId: string): LoopTraceTree | undefined {
    const loop = this.readLoop(loopId);
    if (!loop) return undefined;
    return buildLoopTraceTree(loop, this.readExecutorGraph(loop.executorGraphId));
  }

  listLoopStreamEvents(loopId: string): LoopStreamEvent[] | undefined {
    const loop = this.readLoop(loopId);
    if (!loop) return undefined;
    return buildLoopStreamEvents(loop, this.readExecutorGraph(loop.executorGraphId));
  }

  listLoopCheckpoints(loopId: string): LoopCheckpoint[] | undefined {
    const loop = this.readLoop(loopId);
    if (!loop) return undefined;
    return buildLoopCheckpoints(loop);
  }

  async replayLoopWithDiff(id: string, actor: string, input: {
    fromIteration: number;
    contextPatch?: Record<string, unknown>;
    evidence?: string[];
    artifacts?: LoopArtifact[];
    forceDecision?: LoopDecision;
  }): Promise<{ loop: LoopRun; checkpoint?: LoopCheckpoint; replayDiff: LoopReplayDiff } | undefined> {
    const before = this.readLoop(id);
    if (!before) return undefined;
    const fromIteration = Math.max(1, Math.floor(Number(input.fromIteration) || 1));
    const checkpoint = buildLoopCheckpoints(before).find((item) => item.iterationIndex === fromIteration);
    const replayed = await this.replayLoop(id, actor, input);
    if (!replayed) return undefined;
    return {
      loop: replayed,
      checkpoint,
      replayDiff: buildLoopReplayDiff(before, replayed, fromIteration, input.contextPatch ?? {})
    };
  }

  listLoopWorkerQueue(now = new Date()): LoopWorkerQueueItem[] {
    return this.listLoops()
      .filter((loop) => ["PENDING", "RUNNING", "WAITING_APPROVAL", "BLOCKED", "SUCCEEDED"].includes(loop.status))
      .map((loop) => loopWorkerQueueItem(loop, now))
      .sort((left, right) => Number(right.claimable) - Number(left.claimable) || left.loopId.localeCompare(right.loopId));
  }

  claimNextLoop(workerId: string, leaseSeconds = 120, now = new Date(), preferredLoopId?: string): LoopWorkerQueueClaim {
    const safeWorkerId = safeFileName(workerId || "evopilot-worker");
    const queue = this.listLoopWorkerQueue(now);
    const preferredId = preferredLoopId ? safeFileName(preferredLoopId) : "";
    const candidate = (preferredId ? queue.find((item) => item.loopId === preferredId && item.claimable) : undefined)
      ?? queue.find((item) => item.claimable);
    let claimed: LoopWorkerQueueItem | undefined;
    if (candidate) {
      this.heartbeatLoop(candidate.loopId, safeWorkerId, leaseSeconds);
      const loop = this.readLoop(candidate.loopId);
      if (loop) claimed = loopWorkerQueueItem(loop, new Date());
    }
    const refreshedQueue = this.listLoopWorkerQueue(new Date());
    return {
      schema: "evopilot-loop-worker-claim/v1",
      workerId: safeWorkerId,
      claimed,
      queue: refreshedQueue,
      evidence: [
        `worker=${safeWorkerId}`,
        `claimable=${queue.filter((item) => item.claimable).length}`,
        claimed ? `claimed=${claimed.loopId}` : "claimed=none",
        "duplicateSideEffectGuard=sourceClosureState"
      ],
      createdAt: new Date().toISOString()
    };
  }

  private hydrateLoop(loop: any): LoopRun {
    const graph = this.readExecutorGraph(String(loop.executorGraphId ?? "default-loop-engineering")) ?? defaultExecutorGraph();
    const project = this.readProject(String(loop.projectId ?? "evopilot"));
    const tenantId = safeFileName(String(loop.tenantId ?? project?.tenantId ?? DEFAULT_TENANT_ID));
    const workspaceId = safeFileName(String(loop.workspaceId ?? project?.workspaceId ?? DEFAULT_WORKSPACE_ID));
    const hydrated: LoopRun = {
      ...loop,
      schema: "evopilot-loop-run/v1",
      source: normalizeLoopTriggerSource(loop.source),
      tenantId,
      workspaceId,
      status: normalizeLoopRunStatus(loop.status),
      currentIteration: Number.isFinite(Number(loop.currentIteration)) ? Number(loop.currentIteration) : 0,
      executorGraphId: String(loop.executorGraphId ?? graph.id),
      stopPolicy: normalizeLoopStopPolicy(loop.stopPolicy),
      retryPolicy: normalizeLoopRetryPolicy(loop.retryPolicy),
      context: isRecord(loop.context) ? loop.context : {},
      sourceClosure: normalizeLoopSourceClosure(loop.sourceClosure ?? loop.context?.sourceClosure, project, loop.controlPlaneUrl),
      store: normalizeLoopStoreRuntime(loop.store),
      sandbox: normalizeLoopSandboxPolicy(loop.sandbox ?? loop.context?.sandbox),
      sandboxEnforcement: evaluateLoopSandboxEnforcement(normalizeLoopSandboxPolicy(loop.sandbox ?? loop.context?.sandbox)),
      coordination: normalizeExecutorCoordinationPlan(graph),
      iterations: Array.isArray(loop.iterations) ? loop.iterations.map((iteration: any) => hydrateLoopIteration(iteration)) : [],
      evidenceSets: Array.isArray(loop.evidenceSets) ? loop.evidenceSets : [],
      artifacts: Array.isArray(loop.artifacts) ? loop.artifacts : [],
      approvals: Array.isArray(loop.approvals) ? loop.approvals : [],
      timeline: Array.isArray(loop.timeline) ? loop.timeline : [],
      createdAt: String(loop.createdAt ?? new Date().toISOString()),
      updatedAt: String(loop.updatedAt ?? loop.createdAt ?? new Date().toISOString())
    };
    return {
      ...hydrated,
      trace: buildLoopTraceSummary(hydrated)
    };
  }

  createLoop(input: {
    id?: string;
    source?: LoopTriggerSource;
    projectId?: string;
    objective: string;
    executorGraphId?: string;
    controlPlaneUrl?: string;
    tenantId?: string;
    workspaceId?: string;
    sourceClosure?: Partial<LoopSourceClosure>;
    stopPolicy?: Partial<LoopStopPolicy>;
    retryPolicy?: Partial<LoopRetryPolicy>;
    sandbox?: Partial<LoopSandboxPolicy>;
    context?: Record<string, unknown>;
  }): LoopRun {
    const now = new Date().toISOString();
    const projectId = safeFileName(String(input.projectId ?? "evopilot"));
    const project = this.readProject(projectId);
    const tenantId = safeFileName(String(input.tenantId ?? project?.tenantId ?? DEFAULT_TENANT_ID));
    const workspaceId = safeFileName(String(input.workspaceId ?? project?.workspaceId ?? DEFAULT_WORKSPACE_ID));
    const id = safeFileName(input.id ?? `loop-${projectId}-${Date.now()}`);
    const graph = this.readExecutorGraph(input.executorGraphId ?? "default-loop-engineering") ?? defaultExecutorGraph();
    if (graph.id !== "default-loop-engineering") this.writeExecutorGraph(graph);
    const loop: LoopRun = {
      schema: "evopilot-loop-run/v1",
      id,
      source: input.source ?? "api",
      projectId,
      tenantId,
      workspaceId,
      objective: input.objective,
      status: "PENDING",
      currentIteration: 0,
      executorGraphId: graph.id,
      controlPlaneUrl: input.controlPlaneUrl,
      sourceClosure: normalizeLoopSourceClosure(input.sourceClosure ?? input.context?.sourceClosure, project, input.controlPlaneUrl),
      stopPolicy: normalizeLoopStopPolicy(input.stopPolicy),
      retryPolicy: normalizeLoopRetryPolicy(input.retryPolicy),
      context: input.context ?? {},
      store: normalizeLoopStoreRuntime(),
      sandbox: normalizeLoopSandboxPolicy(input.sandbox ?? input.context?.sandbox),
      sandboxEnforcement: evaluateLoopSandboxEnforcement(normalizeLoopSandboxPolicy(input.sandbox ?? input.context?.sandbox)),
      coordination: normalizeExecutorCoordinationPlan(graph),
      trace: emptyLoopTraceSummary(id, now),
      iterations: [],
      evidenceSets: [],
      artifacts: [],
      approvals: [],
      timeline: [loopTimelineEvent("CREATED", `Loop ${id} created from ${input.source ?? "api"}.`, { objective: input.objective, projectId, tenantId, workspaceId, sourceClosure: normalizeLoopSourceClosure(input.sourceClosure ?? input.context?.sourceClosure, project, input.controlPlaneUrl) })],
      createdAt: now,
      updatedAt: now
    };
    return this.writeLoop(loop);
  }

  async startLoop(id: string, actor: string, input: { forceDecision?: LoopDecision; evidence?: string[]; artifacts?: LoopArtifact[] } = {}): Promise<LoopRun | undefined> {
    const loop = this.readLoop(id);
    if (!loop) return undefined;
    if (loop.status === "CANCELLED" || loop.status === "SUCCEEDED" || loop.status === "FAILED") return loop;
    return await this.runLoopIteration({
      loop: {
        ...loop,
        status: "RUNNING",
        timeline: [...loop.timeline, loopTimelineEvent("STARTED", `Loop started by ${actor}.`)]
      },
      actor,
      ...input
    });
  }

  async resumeLoop(id: string, actor: string, input: { forceDecision?: LoopDecision; evidence?: string[]; artifacts?: LoopArtifact[] } = {}): Promise<LoopRun | undefined> {
    const loop = this.readLoop(id);
    if (!loop) return undefined;
    if (loop.status === "WAITING_APPROVAL" && loop.approvals.some((approval) => approval.status === "PENDING")) {
      throw httpError(409, "LOOP_APPROVAL_REQUIRED", "Loop requires approval before it can resume.");
    }
    if (["CANCELLED", "SUCCEEDED", "FAILED"].includes(loop.status)) return loop;
    return await this.runLoopIteration({ loop: { ...loop, status: "RUNNING" }, actor, ...input });
  }

  async replayLoop(id: string, actor: string, input: {
    fromIteration: number;
    contextPatch?: Record<string, unknown>;
    evidence?: string[];
    artifacts?: LoopArtifact[];
    forceDecision?: LoopDecision;
  }): Promise<LoopRun | undefined> {
    const loop = this.readLoop(id);
    if (!loop) return undefined;
    const fromIteration = Math.max(1, Math.floor(Number(input.fromIteration) || 1));
    const keptIterations = loop.iterations.filter((iteration) => iteration.index < fromIteration);
    const keptEvidenceSetIds = new Set(keptIterations.map((iteration) => iteration.evidenceSetId).filter(Boolean));
    const keptEvidenceSets = loop.evidenceSets.filter((set) => keptEvidenceSetIds.has(set.id));
    const replayContextPatch = input.contextPatch ?? {};
    const replayBase: LoopRun = {
      ...loop,
      status: "RUNNING",
      currentIteration: keptIterations.length,
      iterations: keptIterations,
      evidenceSets: keptEvidenceSets,
      context: {
        ...loop.context,
        ...replayContextPatch,
        replay: {
          fromIteration,
          requestedBy: actor,
          requestedAt: new Date().toISOString(),
          contextPatchKeys: Object.keys(replayContextPatch)
        }
      },
      timeline: [
        ...loop.timeline,
        loopTimelineEvent("REPLAY", `Loop replayed from iteration ${fromIteration} by ${actor}.`, { fromIteration, contextPatchKeys: Object.keys(replayContextPatch) })
      ],
      updatedAt: new Date().toISOString()
    };
    return await this.runLoopIteration({
      loop: replayBase,
      actor,
      forceDecision: input.forceDecision,
      evidence: [
        `replayFromIteration=${fromIteration}`,
        ...Object.keys(replayContextPatch).map((key) => `contextEdited=${key}`),
        ...(input.evidence ?? [])
      ],
      artifacts: input.artifacts,
      replayOfIterationId: loop.iterations.find((iteration) => iteration.index === fromIteration)?.id,
      contextPatch: replayContextPatch
    });
  }

  approveLoop(id: string, actor: string, approvalId?: string): LoopRun | undefined {
    const loop = this.readLoop(id);
    if (!loop) return undefined;
    const pending = loop.approvals.find((approval) => approval.status === "PENDING" && (!approvalId || approval.id === approvalId));
    if (!pending) throw httpError(409, "LOOP_APPROVAL_NOT_PENDING", "No pending loop approval is available.");
    const now = new Date().toISOString();
    return this.writeLoop({
      ...loop,
      status: "RUNNING",
      approvals: loop.approvals.map((approval) => approval.id === pending.id ? { ...approval, status: "APPROVED", decidedAt: now, decidedBy: actor } : approval),
      timeline: [...loop.timeline, loopTimelineEvent("APPROVAL", `Approval ${pending.id} granted by ${actor}.`, { approvalId: pending.id })],
      updatedAt: now
    });
  }

  cancelLoop(id: string, actor: string, reason?: string): LoopRun | undefined {
    const loop = this.readLoop(id);
    if (!loop) return undefined;
    const now = new Date().toISOString();
    return this.writeLoop({
      ...loop,
      status: "CANCELLED",
      timeline: [...loop.timeline, loopTimelineEvent("CANCELLED", reason || `Loop cancelled by ${actor}.`)],
      updatedAt: now
    });
  }

  heartbeatLoop(loopId: string, workerId: string, leaseSeconds = 120): LoopRun | undefined {
    const loop = this.readLoop(loopId);
    if (!loop) return undefined;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const lease: LoopWorkerLease = {
      workerId: safeFileName(workerId),
      acquiredAt: loop.workerLease?.workerId === safeFileName(workerId) ? loop.workerLease.acquiredAt : now,
      heartbeatAt: now,
      expiresAt: new Date(nowMs + Math.max(15, leaseSeconds) * 1000).toISOString()
    };
    return this.writeLoop({
      ...loop,
      workerLease: lease,
      timeline: [...loop.timeline, loopTimelineEvent("HEARTBEAT", `Worker ${lease.workerId} heartbeat accepted.`, { expiresAt: lease.expiresAt })],
      updatedAt: now
    });
  }

  listLoopLeases(): Array<{ loopId: string; status: LoopRunStatus; workerLease?: LoopWorkerLease }> {
    return this.listLoops().map((loop) => ({ loopId: loop.id, status: loop.status, workerLease: loop.workerLease }));
  }

  runLoopWatchdog(now = new Date()): { recovered: LoopRun[]; blocked: LoopRun[] } {
    const recovered: LoopRun[] = [];
    const blocked: LoopRun[] = [];
    for (const loop of this.listLoops()) {
      if (loop.status !== "RUNNING" && loop.status !== "PENDING") continue;
      const leaseExpired = loop.workerLease?.expiresAt ? Date.parse(loop.workerLease.expiresAt) < now.getTime() : false;
      const ageSeconds = (now.getTime() - Date.parse(loop.createdAt)) / 1000;
      if (loop.status === "RUNNING" && leaseExpired) {
        const updated = this.writeLoop({
          ...loop,
          status: "PENDING",
          workerLease: undefined,
          timeline: [...loop.timeline, loopTimelineEvent("WATCHDOG", "Expired worker lease released; loop can be resumed by another worker.")],
          updatedAt: now.toISOString()
        });
        recovered.push(updated);
      } else if (ageSeconds > loop.stopPolicy.maxDurationSeconds) {
        const updated = this.writeLoop({
          ...loop,
          status: "BLOCKED",
          timeline: [...loop.timeline, loopTimelineEvent("WATCHDOG", "Loop blocked by maxDurationSeconds stop policy.", { maxDurationSeconds: loop.stopPolicy.maxDurationSeconds })],
          updatedAt: now.toISOString()
        });
        blocked.push(updated);
      }
    }
    return { recovered, blocked };
  }

  private async runLoopIteration(args: {
    loop: LoopRun;
    actor: string;
    forceDecision?: LoopDecision;
    evidence?: string[];
    artifacts?: LoopArtifact[];
    replayOfIterationId?: string;
    contextPatch?: Record<string, unknown>;
  }): Promise<LoopRun> {
    const graph = this.readExecutorGraph(args.loop.executorGraphId) ?? defaultExecutorGraph();
    const now = new Date().toISOString();
    const nextIndex = args.loop.currentIteration + 1;
    const startedAt = now;
    const iterationWorkspace = path.join(this.loopWorkspacesDir, safeFileName(args.loop.id), `iteration-${nextIndex}`);
    fs.mkdirSync(iterationWorkspace, { recursive: true });
    const steps = await Promise.all(graph.nodes.map((node, index) => executeLoopNode({
      node,
      loop: args.loop,
      iterationIndex: nextIndex,
      attempt: 1,
      previousFailureCount: countRecentLoopFailure(args.loop),
      forceDecision: args.forceDecision,
      workspaceRoot: iterationWorkspace,
      coordination: normalizeExecutorCoordinationPlan(graph),
      sandbox: args.loop.sandbox,
      sandboxEnforcement: evaluateLoopSandboxEnforcement(args.loop.sandbox),
      now: new Date(Date.now() + index).toISOString(),
      llmClient: this.executionRuntime.llmClient,
      requireLlm: this.executionRuntime.requireLlm === true
    })));
    const failedSteps = steps.filter((step) => step.status === "FAILED");
    const waitingApproval = steps.some((step) => step.status === "WAITING_APPROVAL");
    const evidenceStatus: LoopEvidenceSet["status"] = failedSteps.length > 0 ? "FAIL" : waitingApproval ? "BLOCKED" : "PASS";
    const iterationId = `${args.loop.id}-iter-${nextIndex}`;
    const artifacts = [
      ...(args.artifacts ?? []),
      loopArtifact("generic", `Iteration ${nextIndex} sandbox workspace`, iterationWorkspace),
      loopArtifact("report", `Iteration ${nextIndex} report`, path.join(this.loopsDir, `${safeFileName(args.loop.id)}.json`))
    ];
    const evidenceSet: LoopEvidenceSet = {
      id: `${iterationId}-evidence`,
      loopRunId: args.loop.id,
      iterationId,
      validator: "evopilot-loop-runtime",
      status: evidenceStatus,
      evidence: [
        `executorGraph=${graph.id}`,
        `executorGraph.validation=${graph.validation.status}`,
        `executorGraph.nodes=${graph.nodes.length}`,
        `executorGraph.edges=${graph.edges.length}`,
        `executorGraph.capabilities=${Object.entries(graph.capabilities).filter(([, enabled]) => enabled).map(([key]) => key).join(",")}`,
        `iteration=${nextIndex}`,
        `sourceClosure.project=${args.loop.sourceClosure.sourceProjectId}`,
        `sourceClosure.provider=${args.loop.sourceClosure.repositoryProvider}`,
        `sourceClosure.ref=${args.loop.sourceClosure.sourceUrl ?? args.loop.sourceClosure.sourceRoot ?? "unknown"}`,
        `sourceClosure.branch=${args.loop.sourceClosure.sourceBranch}`,
        `sourceClosure.releaseStrategy=${args.loop.sourceClosure.releaseStrategy}`,
        `sourceClosure.requiredGates=${args.loop.sourceClosure.requiredGates.join(",")}`,
        `sourceClosure.targetVersion=${args.loop.sourceClosure.targetVersion ?? "unspecified"}`,
        `sourceClosure.deploymentEnvironment=${args.loop.sourceClosure.deploymentEnvironment ?? "production"}`,
        ...evaluateLoopSandboxEnforcement(args.loop.sandbox).evidence,
        ...steps.flatMap((step) => step.evidence),
        ...(args.evidence ?? [])
      ],
      artifacts,
      createdAt: new Date().toISOString()
    };
    const decision = decideLoopIteration(args.loop, nextIndex, steps, evidenceSet, args.forceDecision);
    const approval = decision === "WAIT_APPROVAL"
      ? {
          id: `approval-${args.loop.id}-${nextIndex}`,
          status: "PENDING" as const,
          reason: "Loop reached a release or high-risk approval gate.",
          requestedAt: new Date().toISOString()
        }
      : undefined;
    const iteration: LoopIteration = {
      id: iterationId,
      loopRunId: args.loop.id,
      index: nextIndex,
      startedAt,
      completedAt: new Date().toISOString(),
      executorSteps: steps,
      evidenceSetId: evidenceSet.id,
      decision,
      rationale: loopDecisionRationale(decision, failedSteps),
      replayOfIterationId: args.replayOfIterationId,
      contextPatch: args.contextPatch,
      traceId: `trace-${safeFileName(args.loop.id)}-${nextIndex}`
    };
    const status = loopStatusFromDecision(decision);
    const updated: LoopRun = {
      ...args.loop,
      status,
      currentIteration: nextIndex,
      iterations: [...args.loop.iterations, iteration],
      evidenceSets: [...args.loop.evidenceSets, evidenceSet],
      artifacts: [...args.loop.artifacts, ...artifacts],
      approvals: approval ? [...args.loop.approvals, approval] : args.loop.approvals,
      timeline: [
        ...args.loop.timeline,
        loopTimelineEvent("ITERATION", `Iteration ${nextIndex} completed with ${decision}.`, { iterationId }),
        loopTimelineEvent("EVIDENCE", `Evidence set ${evidenceSet.id} collected with ${evidenceSet.status}.`, { evidenceSetId: evidenceSet.id }),
        loopTimelineEvent("DECISION", `Decision ${decision}: ${loopDecisionRationale(decision, failedSteps)}.`)
      ],
      updatedAt: new Date().toISOString()
    };
    return this.writeLoop(updated);
  }

  createTargetLoop(input: { projectId?: string; targetId?: string; finalGoal?: string; candidate?: string; proofOpsCore?: ProofOpsCoreContract }): TargetLoopRun {
    const now = new Date().toISOString();
    const targetId = safeFileName(String(input.targetId ?? "ga"));
    const target = this.readReleaseTarget(targetId) ?? releaseTargetFromProofOpsCore(targetId, input.proofOpsCore) ?? defaultGAReleaseTarget();
    const projectId = safeFileName(String(input.projectId ?? "evopilot"));
    const id = safeFileName(String(input.candidate ?? `target-loop-${projectId}-${target.id}-${Date.now()}`));
    const targetPlan = buildProofOpsTargetPlan({ target, projectId, finalGoal: input.finalGoal, proofOpsCore: input.proofOpsCore });
    return this.writeTargetLoop({
      schema: "evopilot-proofops-target-loop/v1",
      id,
      projectId,
      targetId: target.id,
      releaseTarget: target.name,
      mode: "proofops-target-loop",
      status: "PENDING_PLAN_APPROVAL",
      targetPlan,
      targetPlanConfirmation: {
        status: "pending",
        instruction: "Review and confirm this ProofOps target plan before EvoPilot starts the target loop."
      },
      evidenceMatrix: target.requiredScenarioIds.map((scenario) => ({
        capability: "release-target",
        scenario,
        requiredEvidence: `Scenario ${scenario} must pass for ${target.id}.`,
        status: "NOT_RUN",
        required: true,
        blocker: "",
        nextRepairAction: "Run the target loop and collect real release evidence.",
        evidence: []
      })),
      decisionChain: [],
      releaseActions: [],
      remediationRequests: [],
      artifacts: {},
      createdAt: now,
      updatedAt: now
    });
  }

  approveTargetLoopPlan(id: string, actor: string): TargetLoopRun | undefined {
    const loop = this.readTargetLoop(id);
    if (!loop) return undefined;
    return this.writeTargetLoop({
      ...loop,
      targetPlanConfirmation: {
        status: "confirmed",
        confirmedAt: new Date().toISOString(),
        confirmedBy: actor,
        instruction: "ProofOps target plan confirmed through EvoPilot target-loop approval gate."
      },
      updatedAt: new Date().toISOString()
    });
  }

  runTargetLoop(id: string, input: { scenarioMatrix?: ReleaseScenarioResult[]; artifactPaths?: string[] } = {}): TargetLoopRun | undefined {
    const loop = this.readTargetLoop(id);
    if (!loop) return undefined;
    if (loop.targetPlanConfirmation.status !== "confirmed") {
      throw httpError(409, "TARGET_LOOP_PLAN_NOT_CONFIRMED", "ProofOps target loop requires target plan confirmation before execution.");
    }
    const bundle = this.generateReleaseEvidenceBundle({
      id: `target-loop-evidence-${loop.id}`,
      candidate: loop.id,
      releaseTargetId: loop.targetId,
      scenarioMatrix: input.scenarioMatrix,
      artifactPaths: input.artifactPaths
    });
    const decision = this.readReleaseDecision(bundle.releaseDecisionId ?? "");
    const criteria = decision?.criteria ?? [];
    const matrix = criteria.map((criterion) => ({
      capability: "release-criterion",
      scenario: criterion.id,
      requiredEvidence: criterion.name,
      status: criterion.status === "PASS" ? "PASS" as const : "FAIL" as const,
      required: criterion.required,
      blocker: criterion.status === "PASS" ? "" : `${criterion.actual} does not meet ${criterion.target}`,
      nextRepairAction: criterion.status === "PASS" ? "continue" : "Route blocker to EvoPilot remediation, then resume this target loop.",
      evidence: criterion.evidence
    }));
    const failedRequired = matrix.filter((row) => row.required && row.status !== "PASS");
    const releaseDecision = decision ? {
      id: decision.id,
      status: decision.status,
      evidenceBundleId: decision.evidenceBundleId,
      targetReached: decision.status === "GO",
      failedCriteria: Number(decision.summary.failedCriteria ?? failedRequired.length),
      highOpenRisks: Number(decision.summary.highOpenRisks ?? 0)
    } : undefined;
    const decisionChain = matrix.map((row) => ({
      phase: row.scenario,
      rule: row.requiredEvidence,
      decision: row.status === "PASS" ? "continue" as const : "repair blocker" as const,
      rationale: row.status === "PASS" ? "Required release target evidence passed." : row.blocker,
      nextAction: row.nextRepairAction,
      evidence: row.evidence
    }));
    const finalReport = buildProofOpsFinalReport({
      loop,
      matrix,
      decisionChain,
      releaseDecision
    });
    const updated: TargetLoopRun = {
      ...loop,
      status: releaseDecision?.status === "GO" ? "GO" : failedRequired.length > 0 ? "NO-GO" : "BLOCKED",
      evidenceMatrix: matrix,
      decisionChain,
      releaseDecision,
      finalReport,
      artifacts: {
        finalReportJson: path.join(this.targetLoopsDir, `${safeFileName(loop.id)}.json`),
        sourceReleaseEvidenceBundleId: bundle.id
      },
      updatedAt: new Date().toISOString()
    };
    return this.writeTargetLoop(updated);
  }

  approveTargetLoopReleaseAction(id: string, action: string, actor: string): TargetLoopRun | undefined {
    const loop = this.readTargetLoop(id);
    if (!loop) return undefined;
    if (loop.status !== "GO") throw httpError(409, "TARGET_LOOP_NOT_GO", "Release actions require a GO target loop decision.");
    const normalizedAction = safeFileName(action);
    const existing = loop.releaseActions.filter((item) => item.action !== normalizedAction);
    return this.writeTargetLoop({
      ...loop,
      releaseActions: [
        ...existing,
        {
          action: normalizedAction,
          status: "APPROVED",
          approvedAt: new Date().toISOString(),
          approvedBy: actor
        }
      ],
      updatedAt: new Date().toISOString()
    });
  }

  executeTargetLoopReleaseAction(id: string, action: string, actor: string): TargetLoopRun | undefined {
    const loop = this.readTargetLoop(id);
    if (!loop) return undefined;
    const normalizedAction = safeFileName(action);
    const actionRecord = loop.releaseActions.find((item) => item.action === normalizedAction);
    if (!actionRecord || actionRecord.status !== "APPROVED") {
      throw httpError(409, "TARGET_LOOP_RELEASE_ACTION_NOT_APPROVED", "Release action execution requires prior approval.");
    }
    return this.writeTargetLoop({
      ...loop,
      releaseActions: loop.releaseActions.map((item) => item.action === normalizedAction
        ? { ...item, status: "EXECUTED" as const, executedAt: new Date().toISOString(), executedBy: actor }
        : item),
      updatedAt: new Date().toISOString()
    });
  }

  routeTargetLoopRemediation(id: string, blocker?: string): TargetLoopRun | undefined {
    const loop = this.readTargetLoop(id);
    if (!loop) return undefined;
    const firstBlocker = blocker || loop.evidenceMatrix.find((row) => row.status !== "PASS" && row.required)?.blocker || "Target loop blocker requires EvoPilot remediation.";
    const now = new Date().toISOString();
    return this.writeTargetLoop({
      ...loop,
      remediationRequests: [
        ...loop.remediationRequests,
        {
          id: `remediation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          status: "ROUTED",
          blocker: firstBlocker,
          routedTo: "evopilot",
          createdAt: now
        }
      ],
      updatedAt: now
    });
  }

  generateReleaseEvidenceBundle(input: {
    id?: string;
    tenantId?: string;
    workspaceId?: string;
    candidate?: string;
    releaseTargetId?: string;
    scenarioMatrix?: ReleaseScenarioResult[];
    artifactPaths?: string[];
  }): ReleaseEvidenceBundle {
    const now = new Date().toISOString();
    const id = safeFileName(input.id ?? `release-evidence-${Date.now()}`);
    const tenantId = safeFileName(String(input.tenantId ?? DEFAULT_TENANT_ID));
    const workspaceId = safeFileName(String(input.workspaceId ?? DEFAULT_WORKSPACE_ID));
    const releaseTargetId = input.releaseTargetId ?? "ga";
    const target = this.readReleaseTarget(releaseTargetId) ?? defaultGAReleaseTarget();
    const summary = compactReleaseEvidenceSummary(this.summary() as Record<string, unknown>);
    const projects = this.listProjects().filter((project) => project.tenantId === tenantId && project.workspaceId === workspaceId);
    const scopedProjectIds = new Set(projects.map((project) => project.id));
    const soakReports = this.listSoakReports();
    const pipelines = this.listPipelines().filter((pipeline) => scopedProjectIds.has(pipeline.projectId));
    const codeUpgrades = this.listCodeUpgradeRuns().filter((upgrade) => scopedProjectIds.has(upgrade.projectId));
    const sourceReleaseRuns = this.listSourceReleaseClosureRuns()
      .filter((run) => scopedProjectIds.has(run.projectId) && run.tenantId === tenantId && run.workspaceId === workspaceId);
    const scenarioMatrix = alignScenarioMatrixToReleaseTarget(
      mergeScenarioMatrix(defaultReleaseScenarioMatrix({ pipelines, codeUpgrades, projects, summary, now }), input.scenarioMatrix ?? [], now),
      target,
      now
    );
    const promotedSourceReleaseProjectIds = new Set(sourceReleaseRuns
      .filter((run) => run.status === "PROMOTED")
      .map((run) => run.projectId));
    const saasSourceToGaPassed = releaseTargetId === "saas-ga" &&
      scenarioMatrix.some((scenario) => scenario.id === "saas-field-e2e-source-to-ga" && scenario.status === "PASS") &&
      promotedSourceReleaseProjectIds.size > 0;
    const riskProjectIds = saasSourceToGaPassed ? promotedSourceReleaseProjectIds : scopedProjectIds;
    const readiness = this.computeReleaseReadinessReports().filter((report) => riskProjectIds.has(report.projectId));
    const rollout = this.computeRolloutStrategyReports().filter((report) => riskProjectIds.has(report.projectId));
    const policyEvaluations = this.evaluateGovernancePolicies().filter((evaluation) => riskProjectIds.has(evaluation.scope));
    const riskRegister = this.buildReleaseRiskRegister({ policyEvaluations, readiness, rollout, pipelines, codeUpgrades, sourceReleaseRuns, scenarioMatrix, releaseTargetId, requiredScenarioIds: target.requiredScenarioIds });
    const targetRequiredScenarios = new Set(target.requiredScenarioIds);
    const failedRequiredScenarioCount = scenarioMatrix.filter((scenario) => targetRequiredScenarios.has(scenario.id) && scenario.required && (scenario.status === "FAIL" || scenario.status === "NOT-RUN")).length;
    const openHighRiskCount = riskRegister.filter((risk) => risk.status === "OPEN" && (risk.severity === "HIGH" || risk.severity === "CRITICAL")).length;
    const status: ReleaseEvidenceBundle["status"] = failedRequiredScenarioCount > 0 || openHighRiskCount > 0
      ? "NO-GO"
      : riskRegister.some((risk) => risk.status === "OPEN") || scenarioMatrix.some((scenario) => scenario.status === "NOT-APPLICABLE")
        ? "CONDITIONAL-GO"
        : "GO";
    const bundle: ReleaseEvidenceBundle = {
      id,
      tenantId,
      workspaceId,
      candidate: input.candidate ?? `candidate-${now}`,
      status,
      releaseTargetId,
      generatedAt: now,
      summary,
      sourceSoakReportIds: soakReports.map((report) => report.id),
      serviceInventory: this.buildServiceInventory(projects),
      connectedProjects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        repository: maskProject(project).repository,
        cicd: project.cicd,
        validation: project.validation,
        releaseReadiness: readiness.find((report) => report.projectId === project.id),
        rolloutStrategy: rollout.find((report) => report.projectId === project.id)
      })),
      scenarioMatrix,
      riskRegister,
      artifacts: [
        ...soakReports.map((report) => ({
          type: "soak-report" as const,
          label: report.name,
          path: path.join(this.soakReportsDir, `${safeFileName(report.id)}.json`),
          status: report.status
        })),
        ...pipelines.slice(-20).map((pipeline) => ({
          type: "pipeline" as const,
          label: `${pipeline.projectId} ${pipeline.jobName}`,
          url: pipeline.buildUrl,
          status: pipeline.status
        })),
        ...codeUpgrades.slice(-20).map((upgrade) => ({
          type: "code-upgrade" as const,
          label: `${upgrade.projectId} ${upgrade.id}`,
          path: upgrade.artifacts.diffPath,
          url: upgrade.artifacts.pullRequestUrl,
          status: upgrade.status
        })),
        ...(input.artifactPaths ?? []).map((artifactPath) => ({
          type: inferReleaseArtifactType(artifactPath),
          label: path.basename(artifactPath),
          path: artifactPath
        }))
      ],
      createdAt: now,
      updatedAt: now
    };
    const decision = this.generateReleaseDecision({ target, evidenceBundle: bundle, scenarioMatrix, riskRegister, summary, now });
    const releaseBundle = {
      ...bundle,
      status: decision.status,
      releaseDecisionId: decision.id
    };
    this.writeReleaseDecision(decision);
    return this.writeReleaseEvidenceBundle(releaseBundle);
  }

  private generateReleaseDecision(args: {
    target: ReleaseTargetProfile;
    evidenceBundle: ReleaseEvidenceBundle;
    scenarioMatrix: ReleaseScenarioResult[];
    riskRegister: ReleaseRisk[];
    summary: Record<string, unknown>;
    now: string;
  }): ReleaseDecision {
    const { target, evidenceBundle, scenarioMatrix, riskRegister, summary, now } = args;
    const soakReports = this.listSoakReports();
    const succeededSoakSeconds = soakReports
      .filter((report) => report.status === "SUCCEEDED")
      .reduce((sum, report) => sum + report.durationSeconds, 0);
    const activeSucceededSoakSeconds = soakReports
      .filter((report) => report.status === "SUCCEEDED" && isActiveSoakReport(report, target))
      .reduce((sum, report) => sum + report.durationSeconds, 0);
    const requiredSoakSeconds = target.requireActiveSoak ? activeSucceededSoakSeconds : succeededSoakSeconds;
    const successfulCodeUpgrades = this.listCodeUpgradeRuns().filter((upgrade) => upgrade.status === "SUCCEEDED").length;
    const successfulPipelines = this.listPipelines().filter((pipeline) => pipeline.status === "SUCCEEDED").length;
    const highOpenRiskCount = riskRegister.filter((risk) => risk.status === "OPEN" && (risk.severity === "HIGH" || risk.severity === "CRITICAL")).length;
    const criteria: ReleaseDecisionCriterion[] = [
      numericCriterion("min-connected-projects", "最少接入项目数", this.listProjects().length, target.minConnectedProjects, [`connectedProjects=${this.listProjects().length}`]),
      numericCriterion("min-succeeded-soak-seconds", target.requireActiveSoak ? "有负载成功持续验证时长" : "成功持续验证时长", requiredSoakSeconds, target.minSucceededSoakSeconds, [
        `succeededSoakSeconds=${succeededSoakSeconds}`,
        `activeSucceededSoakSeconds=${activeSucceededSoakSeconds}`,
        `requireActiveSoak=${Boolean(target.requireActiveSoak)}`
      ]),
      numericCriterion("min-successful-runs", "成功证据运行数", Number(summary.runCount ?? 0), target.minSuccessfulRuns, [`runs=${summary.runCount ?? 0}`]),
      numericCriterion("min-evaluation-datasets", "评测集数量", Number(summary.evaluationDatasetCount ?? 0), target.minEvaluationDatasets, [`datasets=${summary.evaluationDatasetCount ?? 0}`]),
      numericCriterion("min-opportunities", "机会点数量", Number(summary.opportunityCount ?? 0), target.minOpportunities, [`opportunities=${summary.opportunityCount ?? 0}`]),
      numericCriterion("min-successful-evolution-batches", "成功进化批次数", Number(summary.successfulEvolutionBatchCount ?? 0), target.minSuccessfulEvolutionBatches, [`successfulBatches=${summary.successfulEvolutionBatchCount ?? 0}`]),
      numericCriterion("min-successful-code-upgrades", "成功代码升级数", successfulCodeUpgrades, target.minSuccessfulCodeUpgrades, [`successfulCodeUpgrades=${successfulCodeUpgrades}`]),
      numericCriterion("min-successful-pipelines", "成功 CI/CD 数", successfulPipelines, target.minSuccessfulPipelines, [`successfulPipelines=${successfulPipelines}`]),
      booleanCriterion("required-scenarios", "必跑场景全部通过", target.requiredScenarioIds.every((id) => scenarioMatrix.some((scenario) => scenario.id === id && scenario.status === "PASS")), true, target.requiredScenarioIds.map((id) => {
        const scenario = scenarioMatrix.find((item) => item.id === id);
        return `${id}=${scenario?.status ?? "MISSING"}`;
      })),
      booleanCriterion("mainstream-loop-harness-alignment", "主流 Loop Harness 对齐证据", !target.requiredScenarioIds.includes("mainstream-loop-harness-alignment") || scenarioMatrix.some((scenario) => scenario.id === "mainstream-loop-harness-alignment" && scenario.status === "PASS"), true, [
        target.requiredScenarioIds.includes("mainstream-loop-harness-alignment")
          ? scenarioMatrix.find((scenario) => scenario.id === "mainstream-loop-harness-alignment")?.evidence.join("; ") ?? "missing mainstream-loop-harness-alignment scenario"
          : "not required by release target"
      ]),
      booleanCriterion("no-high-open-risks", "无高危未关闭风险", target.requireNoHighOpenRisks ? highOpenRiskCount === 0 : true, true, [`highOpenRisks=${highOpenRiskCount}`])
    ];
    const failedRequired = criteria.filter((criterion) => criterion.required && criterion.status === "FAIL");
    const openMediumRiskCount = riskRegister.filter((risk) => risk.status === "OPEN" && risk.severity === "MEDIUM").length;
    const status: ReleaseDecision["status"] = failedRequired.length > 0
      ? "NO-GO"
      : openMediumRiskCount > 0
        ? "CONDITIONAL-GO"
        : "GO";
    return {
      id: `decision-${safeFileName(evidenceBundle.id)}`,
      tenantId: evidenceBundle.tenantId,
      workspaceId: evidenceBundle.workspaceId,
      candidate: evidenceBundle.candidate,
      targetId: target.id,
      evidenceBundleId: evidenceBundle.id,
      status,
      generatedAt: now,
      criteria,
      summary: {
        passedCriteria: criteria.filter((criterion) => criterion.status === "PASS").length,
        failedCriteria: failedRequired.length,
        openRisks: riskRegister.filter((risk) => risk.status === "OPEN").length,
        highOpenRisks: highOpenRiskCount
      },
      scenarioMatrix,
      riskRegister,
      createdAt: now,
      updatedAt: now
    };
  }

  private buildServiceInventory(projects: StoredProject[]): ReleaseEvidenceBundle["serviceInventory"] {
    const jenkins = this.listJenkinsConnectors().map(maskJenkinsConnector);
    const openhands = this.listOpenHandsConnectors().map(maskOpenHandsConnector);
    return [
      {
        id: "evopilot-api",
        type: "evopilot",
        name: "EvoPilot API",
        status: this.isReady() ? "READY" : "BLOCKED",
        evidence: this.isReady() ? "metadata、runs、projects 存储目录已就绪。" : "存储目录或 metadata 不完整。"
      },
      ...openhands.map((connector) => ({
        id: connector.id,
        type: "code-upgrader" as const,
        name: connector.name,
        status: connector.baseUrl ? "READY" as const : "BLOCKED" as const,
        endpoint: connector.baseUrl,
        evidence: connector.baseUrl ? `代码升级连接器已配置，apiKeyConfigured=${connector.apiKeyConfigured}。` : "代码升级连接器缺少 baseUrl。"
      })),
      ...jenkins.map((connector) => ({
        id: connector.id,
        type: "ci" as const,
        name: connector.name,
        status: connector.baseUrl ? "READY" as const : "BLOCKED" as const,
        endpoint: connector.baseUrl,
        evidence: connector.baseUrl ? `CI/CD 连接器已配置，apiTokenConfigured=${connector.apiTokenConfigured}。` : "CI/CD 连接器缺少 baseUrl。"
      })),
      ...projects.map((project) => ({
        id: project.id,
        type: "connected-project" as const,
        name: project.name,
        status: project.validation.status === "VERIFIED" ? "READY" as const : "BLOCKED" as const,
        endpoint: project.repository?.gitUrl ?? project.repository?.root ?? project.repository?.baseUrl,
        evidence: project.validation.message
      }))
    ];
  }

  private buildReleaseRiskRegister(args: {
    policyEvaluations: GovernancePolicyEvaluation[];
    readiness: ReleaseReadinessReport[];
    rollout: RolloutStrategyReport[];
    pipelines: PipelineRun[];
    codeUpgrades: CodeUpgradeRun[];
    sourceReleaseRuns: SourceReleaseClosureRun[];
    scenarioMatrix: ReleaseScenarioResult[];
    releaseTargetId: string;
    requiredScenarioIds: string[];
  }): ReleaseRisk[] {
    const risks: ReleaseRisk[] = [];
    const projectsWithPromotedSourceRelease = new Set(args.sourceReleaseRuns
      .filter((run) => run.status === "PROMOTED")
      .map((run) => run.projectId));
    const sourceToGaEvidenceSatisfiesProjectClosure = args.releaseTargetId === "saas-ga" &&
      args.scenarioMatrix.some((scenario) => scenario.id === "saas-field-e2e-source-to-ga" && scenario.status === "PASS");
    for (const policy of args.policyEvaluations.filter((item) => item.status !== "PASSED")) {
      if (sourceToGaEvidenceSatisfiesProjectClosure && projectsWithPromotedSourceRelease.has(policy.scope)) continue;
      risks.push({
        id: `risk-policy-${safeFileName(policy.id)}`,
        severity: policy.severity,
        source: "governance-policy",
        status: "OPEN",
        summary: `${policy.name} 未通过：${policy.rationale}`,
        evidence: [policy.scope],
        recommendedAction: policy.recommendedAction
      });
    }
    for (const report of args.readiness.filter((item) => item.status === "BLOCKED")) {
      if (sourceToGaEvidenceSatisfiesProjectClosure && projectsWithPromotedSourceRelease.has(report.projectId)) continue;
      const failedGate = report.gates.find((gate) => gate.status === "FAILED");
      risks.push({
        id: `risk-readiness-${safeFileName(report.projectId)}`,
        severity: "HIGH",
        source: "release-readiness",
        status: "OPEN",
        summary: `${report.projectId} 发布就绪阻断：${failedGate?.name ?? "未知门禁"}`,
        evidence: report.gates.map((gate) => `${gate.name}:${gate.status}:${gate.detail}`),
        recommendedAction: report.recommendedAction
      });
    }
    for (const report of args.rollout.filter((item) => item.status === "BLOCKED")) {
      if (sourceToGaEvidenceSatisfiesProjectClosure && projectsWithPromotedSourceRelease.has(report.projectId)) continue;
      risks.push({
        id: `risk-rollout-${safeFileName(report.projectId)}`,
        severity: "HIGH",
        source: "rollout-strategy",
        status: "OPEN",
        summary: `${report.projectId} 灰度策略阻断：${report.strategy}`,
        evidence: report.gates.map((gate) => `${gate.name}:${gate.status}:${gate.detail}`),
        recommendedAction: report.recommendedAction
      });
    }
    for (const pipeline of args.pipelines.filter((item) => item.status === "FAILED" || item.status === "CANCELED")) {
      risks.push({
        id: `risk-pipeline-${safeFileName(pipeline.id)}`,
        severity: "MEDIUM",
        source: "ci-cd",
        status: hasLaterSuccessfulPipeline(pipeline, args.pipelines) ? "MITIGATED" : "OPEN",
        summary: `${pipeline.projectId} 流水线 ${pipeline.jobName} ${pipeline.status}`,
        evidence: [pipeline.buildUrl ?? pipeline.id],
        recommendedAction: "确认失败流水线已被批次状态记录，且后续成功流水线释放队列。"
      });
    }
    for (const upgrade of args.codeUpgrades.filter((item) => item.status === "FAILED" || item.status === "CANCELED")) {
      risks.push({
        id: `risk-code-upgrade-${safeFileName(upgrade.id)}`,
        severity: "MEDIUM",
        source: "code-upgrade",
        status: hasLaterSuccessfulCodeUpgrade(upgrade, args.codeUpgrades) ? "MITIGATED" : "OPEN",
        summary: `${upgrade.projectId} 代码升级失败：${upgrade.failureReason ?? upgrade.error ?? upgrade.status}`,
        evidence: [upgrade.artifacts.pullRequestUrl ?? upgrade.artifacts.diffPath ?? upgrade.id],
        recommendedAction: "确认代码升级失败不会触发 CI/CD，并释放或失败对应进化批次。"
      });
    }
    const targetRequiredScenarios = new Set(args.requiredScenarioIds);
    for (const scenario of args.scenarioMatrix.filter((item) => targetRequiredScenarios.has(item.id) && item.required && (item.status === "FAIL" || item.status === "NOT-RUN"))) {
      risks.push({
        id: `risk-scenario-${safeFileName(scenario.id)}`,
        severity: "HIGH",
        source: "scenario-matrix",
        status: "OPEN",
        summary: `${scenario.name} 场景未通过：${scenario.status}`,
        evidence: scenario.evidence,
        recommendedAction: "补跑真实场景或修复产品能力后重新生成发布证据。"
      });
    }
    return dedupeReleaseRisks(risks);
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

function defaultExecutorGraph(): ExecutorGraph {
  const now = new Date().toISOString();
  return {
    schema: "evopilot-executor-graph/v1",
    id: "default-loop-engineering",
    name: "Default Loop Engineering Graph",
    nodes: [
      { id: "context", type: "llm", name: "Context Builder", config: { output: "loop context and next action hypothesis" } },
      { id: "remediate", type: "code-upgrader", name: "Remediation Executor", config: { optional: true } },
      { id: "ci", type: "ci", name: "CI/CD Validator", config: { optional: true } },
      { id: "validate", type: "validator", name: "Independent Evidence Validator", config: { independent: true } },
      { id: "approval", type: "approval", name: "Human Approval Gate", config: { requiredForRelease: true } }
    ],
    edges: [
      { from: "context", to: "remediate", type: "sequence", outputSchemaRef: "loop-context/v1" },
      { from: "remediate", to: "ci", type: "conditional", condition: "codeChanged == true", inputSchemaRef: "code-diff/v1", outputSchemaRef: "ci-request/v1" },
      { from: "ci", to: "validate", type: "fan-in", inputSchemaRef: "ci-result/v1", outputSchemaRef: "validation-evidence/v1" },
      { from: "validate", to: "approval", type: "sequence", condition: "releaseRisk != low", inputSchemaRef: "validation-evidence/v1" }
    ],
    mode: "serial",
    validation: {
      status: "PASSED",
      evidence: ["nodeIds=unique", "edges=typed", "schemas=declared", "nestedSubgraphs=allowed"]
    },
    capabilities: {
      typedEdges: true,
      conditionalRouting: true,
      fanOutFanIn: true,
      nestedSubgraphs: true,
      schemaValidation: true
    },
    createdAt: now,
    updatedAt: now
  };
}

function executorGraphFromLoopOrchestrationRequest(body: any, presetId: string): ExecutorGraph {
  const context = workflowCanvasContextFromRequest(body);
  if (!context) return selfEvolutionExecutorGraph();
  const routingMode = context.routingMode;
  const releaseGate = context.releaseGate;
  const humanGate = context.humanGate;
  const graphId = `dashboard-workflow-${safeFileName(String(body.projectId ?? "evopilot"))}-${Date.now()}`;
  return normalizeExecutorGraph({
    id: graphId,
    name: `Dashboard Workflow Canvas (${routingMode})`,
    mode: routingMode === "fanout-evaluator" ? "parallel" : "serial",
    nodes: [
      {
        id: "target",
        type: "llm",
        name: "Target Contract",
        config: {
          adapterId: "evopilot.target-contract-adapter",
          presetId,
          inputSchema: { objective: "string", projectId: "string" },
          outputSchema: { targetContract: "object", acceptanceCriteria: "array" },
          visualRole: "target"
        }
      },
      {
        id: "discovery",
        type: "validator",
        name: "Discovery Evidence",
        config: {
          adapterId: "evopilot.discovery-runtime-adapter",
          inputSchema: { targetContract: "object" },
          outputSchema: { findings: "array", datasets: "array" },
          visualRole: "discovery"
        }
      },
      {
        id: "executor",
        type: "code-upgrader",
        name: "Executor Runtime",
        config: {
          adapterId: "evopilot.code-upgrader-adapter",
          inputSchema: { findings: "array" },
          outputSchema: { files: "array", artifacts: "array" },
          visualRole: "executor"
        }
      },
      {
        id: "evaluator",
        type: "validator",
        name: "Adversarial Evaluator",
        config: {
          adapterId: "evopilot.adversarial-evaluator-adapter",
          inputSchema: { files: "array", artifacts: "array" },
          outputSchema: { guardrails: "array", decision: "string" },
          visualRole: "evaluator"
        }
      },
      {
        id: "human-gate",
        type: "approval",
        name: "Human Gate",
        config: {
          requiredForRelease: true,
          policy: humanGate ? "human-first" : "conditional",
          inputSchema: { decision: "string", guardrails: "array" },
          outputSchema: { approval: "object" },
          visualRole: "human-gate"
        }
      },
      {
        id: "release",
        type: "release-action",
        name: "Release Closure",
        config: {
          adapterId: "evopilot.source-release-adapter",
          subgraphId: "source-closure/v1",
          releaseGate,
          inputSchema: { approval: "object", artifacts: "array" },
          outputSchema: { sourceClosure: "object", deployment: "object" },
          visualRole: "release"
        }
      }
    ],
    edges: [
      { from: "target", to: "discovery", type: "sequence", outputSchemaRef: "target-contract/v1" },
      { from: "discovery", to: "executor", type: routingMode === "fanout-evaluator" ? "fan-out" : "sequence", condition: routingMode === "fanout-evaluator" ? "findings.length > 0" : undefined, inputSchemaRef: "discovery-findings/v1", outputSchemaRef: "code-change-request/v1" },
      { from: "executor", to: "evaluator", type: routingMode === "fanout-evaluator" ? "fan-out" : "sequence", condition: routingMode === "fanout-evaluator" ? "files.length > 0" : undefined, inputSchemaRef: "code-change-result/v1", outputSchemaRef: "evaluation-request/v1" },
      { from: "evaluator", to: "human-gate", type: "conditional", condition: humanGate ? "always" : "releaseRisk != low || releaseGate != review-only", inputSchemaRef: "evaluation-result/v1", outputSchemaRef: "approval-request/v1" },
      { from: "executor", to: "release", type: "conditional", condition: releaseGate === "review-only" ? "approval.status == APPROVED" : "sourceClosure.requiredGates includes deploy", inputSchemaRef: "code-change-result/v1", outputSchemaRef: "source-closure-request/v1" },
      { from: "human-gate", to: "release", type: "fan-in", inputSchemaRef: "approval-result/v1", outputSchemaRef: "source-release-request/v1" }
    ]
  });
}

function workflowCanvasContextFromRequest(body: any): {
  routingMode: "policy-gated" | "fanout-evaluator" | "human-first";
  releaseGate: "source-closure" | "review-only" | "deploy-and-rollback";
  humanGate: boolean;
  visualEditorVersion: string;
} | undefined {
  if (!isRecord(body?.context) || !isRecord(body.context.workflowCanvasEditor)) return undefined;
  const value = body.context.workflowCanvasEditor;
  const routingMode = normalizeWorkflowRoutingMode(value.routingMode);
  const releaseGate = normalizeWorkflowReleaseGate(value.releaseGate);
  return {
    routingMode,
    releaseGate,
    humanGate: value.humanGate === true || routingMode === "human-first",
    visualEditorVersion: String(value.visualEditorVersion ?? "dashboard-workflow-canvas/v1")
  };
}

function normalizeWorkflowRoutingMode(value: unknown): "policy-gated" | "fanout-evaluator" | "human-first" {
  const mode = String(value ?? "policy-gated").trim();
  if (mode === "fanout-evaluator" || mode === "human-first") return mode;
  return "policy-gated";
}

function normalizeWorkflowReleaseGate(value: unknown): "source-closure" | "review-only" | "deploy-and-rollback" {
  const gate = String(value ?? "source-closure").trim();
  if (gate === "review-only" || gate === "deploy-and-rollback") return gate;
  return "source-closure";
}

function selfEvolutionExecutorGraph(): ExecutorGraph {
  return normalizeExecutorGraph({
    id: "dashboard-source-release-closure",
    name: "Dashboard Source Release Closure",
    mode: "parallel",
    nodes: [
      { id: "plan", type: "llm", name: "Plan Target Loop", config: { adapterId: "evopilot.llm-context-adapter", outputSchema: { plan: "object" } } },
      { id: "upgrade", type: "code-upgrader", name: "Apply Source Change", config: { adapterId: "evopilot.code-upgrader-adapter", inputSchema: { plan: "object" }, outputSchema: { files: "array" } } },
      { id: "validate", type: "validator", name: "Validate Evidence", config: { independent: true, inputSchema: { files: "array", ci: "object" } } },
      { id: "release", type: "release-action", name: "Prepare Source Closure", config: { requiresApproval: true, subgraphId: "source-closure/v1" } },
      { id: "approval", type: "approval", name: "Human Release Approval", config: { requiredForRelease: true } }
    ],
    edges: [
      { from: "plan", to: "upgrade", type: "sequence", outputSchemaRef: "target-loop-plan/v1" },
      { from: "upgrade", to: "validate", type: "fan-out", condition: "files.length > 0", inputSchemaRef: "code-change/v1", outputSchemaRef: "validation-request/v1" },
      { from: "upgrade", to: "release", type: "conditional", condition: "sourceClosure.requiredGates includes deploy", inputSchemaRef: "code-change/v1", outputSchemaRef: "source-closure-request/v1" },
      { from: "validate", to: "approval", type: "fan-in", inputSchemaRef: "validation-evidence/v1" },
      { from: "release", to: "approval", type: "fan-in", inputSchemaRef: "source-closure-request/v1" }
    ]
  });
}

function loopOrchestrationPresets(store: FileStore): Array<{
  id: string;
  name: string;
  defaultObjective: string;
  defaultTargetVersion: string;
  controlPlaneUrl?: string;
  capabilities: string[];
  ready: boolean;
  evidence: string[];
}> {
  const deployConnectors = store.listDeployConnectors();
  return [{
    id: "source-release-closure",
    name: "Source to Production Closure",
    defaultObjective: "Evolve the selected project through source change, validation, deployment, health-ready probe, and rollback-aware release closure.",
    defaultTargetVersion: `loop-${new Date().toISOString().slice(0, 10)}`,
    controlPlaneUrl: process.env.EVOPILOT_CONTROL_PLANE_URL,
    capabilities: [
      "github-or-gitlab-source",
      "typed-executor-graph",
      "docker-sandbox-enforcement",
      "worker-lease-watchdog",
      "deploy-connector",
      "health-ready-rollback"
    ],
    ready: deployConnectors.length > 0,
    evidence: [
      `deployConnectorCount=${deployConnectors.length}`,
      `executorGraph=${selfEvolutionExecutorGraph().id}`,
      `graphValidation=${selfEvolutionExecutorGraph().validation.status}`,
      "dashboardWorkbench=true"
    ]
  }, {
    id: "codex-target-loop",
    name: "Codex Target Loop Autopilot",
    defaultObjective: "Drive the next EvoPilot product target through Codex executor planning, source change, independent validation, source closure, and production health evidence.",
    defaultTargetVersion: `codex-loop-${new Date().toISOString().slice(0, 10)}`,
    controlPlaneUrl: process.env.EVOPILOT_CONTROL_PLANE_URL,
    capabilities: [
      "target-backlog",
      "codex-executor",
      "auto-advance",
      "independent-validation",
      "human-stop-condition",
      "source-to-production-closure"
    ],
    ready: deployConnectors.length > 0,
    evidence: [
      `deployConnectorCount=${deployConnectors.length}`,
      "targetBacklog=productized",
      "advanceApi=/api/v1/loop-orchestration/advance",
      "codexLoopTarget=true"
    ]
  }];
}

function loopOrchestrationTargetDefinitions(): Array<Omit<LoopOrchestrationTarget, "status" | "loopId" | "nextAction" | "evidence">> {
  return [
    {
      id: "codex-loop-target-autopilot",
      title: "Codex Loop Target Autopilot",
      layer: "loop",
      presetId: "codex-target-loop",
      objective: "Let EvoPilot keep a prioritized target backlog, create the next Codex-backed target loop, and advance it through start, resume, human stop, and source closure states.",
      acceptanceCriteria: [
        "Dashboard and API expose target backlog with status and next action.",
        "Advance API creates or advances the next target loop idempotently.",
        "Loop evidence records Codex executor intent, independent validation, source closure, and stop condition."
      ]
    },
    {
      id: "context-time-travel-workbench",
      title: "Context Time Travel Workbench",
      layer: "context",
      presetId: "codex-target-loop",
      objective: "Make replay, editable context, checkpoint inspection, and replay diff available as a reusable workbench for every connected project.",
      acceptanceCriteria: [
        "Users can inspect checkpoints and replay from a selected iteration.",
        "Context edits are persisted as auditable artifacts.",
        "Replay diff compares old and new executor outputs."
      ]
    },
    {
      id: "harness-worker-failover",
      title: "Harness Worker Failover",
      layer: "harness",
      presetId: "codex-target-loop",
      objective: "Turn worker lease, queue claim, watchdog recovery, and duplicate side-effect prevention into production-grade harness controls.",
      acceptanceCriteria: [
        "Workers claim and renew durable leases.",
        "Expired leases are recovered by watchdog without duplicate source closure.",
        "Dashboard shows queue pressure and failover evidence."
      ]
    },
    {
      id: "sandbox-hard-boundary-proof",
      title: "Sandbox Hard Boundary Proof",
      layer: "sandbox",
      presetId: "codex-target-loop",
      objective: "Prove Docker/K8s sandbox enforcement with network, credential, path, and resource restrictions as first-class loop evidence.",
      acceptanceCriteria: [
        "Sandbox policy maps to an executable Docker/K8s boundary.",
        "Credential and path restrictions are tested and recorded.",
        "Failed sandbox enforcement blocks non-human executor nodes."
      ]
    },
    {
      id: "discovery-skill-runtime",
      title: "Discovery Skill Runtime",
      layer: "context",
      presetId: "codex-target-loop",
      objective: "Turn repository, trace, evaluation, and production signal discovery into a reusable skill runtime that proposes target loops with evidence instead of relying on manual backlog curation.",
      acceptanceCriteria: [
        "Connected GitHub, GitLab, and local directory projects expose a discovery skill contract with inputs, outputs, confidence, and evidence sources.",
        "Discovery output can create or update target-loop candidates with acceptance criteria, affected files, and runtime evidence links.",
        "Dashboard shows discovery provenance so users can distinguish product signals, code signals, and manually entered targets."
      ]
    },
    {
      id: "per-finding-worktree-handoff",
      title: "Per Finding Worktree Handoff",
      layer: "harness",
      presetId: "codex-target-loop",
      objective: "Give every selected finding an isolated worktree or branch handoff with bounded files, validation commands, source-closure metadata, and resumable executor context.",
      acceptanceCriteria: [
        "Each finding can allocate an isolated worktree, release branch, or executor workspace without contaminating other loop targets.",
        "Handoff payload includes allowed paths, validation commands, source branch, target branch, and rollback metadata.",
        "Failed or interrupted handoffs can be resumed, reassigned, or archived with artifacts and audit evidence."
      ]
    },
    {
      id: "adversarial-evaluator-agent",
      title: "Adversarial Evaluator Agent",
      layer: "harness",
      presetId: "codex-target-loop",
      objective: "Add an independent adversarial evaluator that challenges proposed code changes, release evidence, and target completion claims before merge or deployment.",
      acceptanceCriteria: [
        "Evaluator receives the proposed diff, tests, runtime evidence, budget impact, and release gates as structured input.",
        "Evaluator can return PASS, WARN, or BLOCK with failure signatures, missing evidence, and suggested replay or repair actions.",
        "Autopilot treats evaluator BLOCK as a policy-review or human-approval stop condition rather than self-approving the release."
      ]
    },
    {
      id: "recurring-loop-scheduler",
      title: "Recurring Loop Scheduler",
      layer: "loop",
      presetId: "codex-target-loop",
      objective: "Support recurring target-loop schedules driven by time windows, evidence thresholds, release cadence, and budget guardrails.",
      acceptanceCriteria: [
        "Users can define recurring loop schedules with project scope, target preset, cadence, trigger rules, and max budget.",
        "Scheduler records due, skipped, blocked, and executed runs with idempotency keys and next-run timestamps.",
        "Schedules respect human gates, source-credential blockers, release freezes, and active incident windows."
      ]
    },
    {
      id: "loop-memory-inbox",
      title: "Loop Memory Inbox",
      layer: "context",
      presetId: "codex-target-loop",
      objective: "Provide a product memory inbox where prior findings, user feedback, failed evaluations, release learnings, and operator notes can be triaged into future target loops.",
      acceptanceCriteria: [
        "Memory inbox stores typed items from evaluations, traces, release decisions, user feedback, and manual notes.",
        "Users can accept, merge, snooze, reject, or convert inbox items into target-loop backlog entries.",
        "Converted targets retain memory provenance and can be used by discovery, planning, replay, and evaluator agents."
      ]
    },
    {
      id: "budget-and-judgment-guardrails",
      title: "Budget and Judgment Guardrails",
      layer: "loop",
      presetId: "codex-target-loop",
      objective: "Make cost, token, time, blast-radius, confidence, and release-judgment guardrails explicit stop conditions for every autonomous loop.",
      acceptanceCriteria: [
        "Loop plans declare max cost, token, time, file-change, and deployment-risk budgets before execution.",
        "Runtime records per-node cost, confidence, blast-radius, and policy judgment evidence for each iteration.",
        "Autopilot blocks or routes to human review when budget, confidence, or release-judgment thresholds are exceeded."
      ]
    },
    {
      id: "tenant-workspace-model",
      title: "Tenant Workspace Model",
      layer: "context",
      presetId: "codex-target-loop",
      objective: "Define the tenant, workspace, membership, role, project ownership, and evidence scoping model required before EvoPilot can be opened as a cloud service.",
      acceptanceCriteria: [
        "Tenant, organization or workspace, user membership, role, and project ownership contracts are explicit and versioned.",
        "Projects, credentials, loop runs, source release runs, audit records, and release evidence can be queried and scoped by tenant or workspace.",
        "Migration preserves single-tenant self-hosted mode while making tenantId and workspaceId mandatory at the cloud boundary."
      ]
    },
    {
      id: "github-app-onboarding",
      title: "GitHub App Onboarding",
      layer: "harness",
      presetId: "codex-target-loop",
      objective: "Replace ad hoc repository tokens with a GitHub App onboarding flow that supports installation, repository selection, least-privilege permissions, webhook verification, and installation-token lifecycle.",
      acceptanceCriteria: [
        "Users can connect a GitHub App installation and select repositories without pasting long-lived personal tokens into the dashboard.",
        "Webhook signature verification, installation-token refresh, and repository permission checks are captured as auditable evidence.",
        "Loop source closure can resolve writeback credentials from the installation while preserving least privilege and revocation."
      ]
    },
    {
      id: "workspace-rbac-and-invitation",
      title: "Workspace RBAC and Invitation",
      layer: "harness",
      presetId: "codex-target-loop",
      objective: "Make workspace membership, invitation, role assignment, scoped API access, and audit attribution production-ready for a multi-tenant SaaS control plane.",
      acceptanceCriteria: [
        "Owner, admin, developer, and viewer permissions are enforced for workspace reads, writes, approvals, and release actions.",
        "Workspace invitations, membership state, role changes, and access revocation are recorded as auditable events.",
        "Cross-workspace and cross-tenant access attempts are denied with explicit blocker evidence instead of falling through to global data."
      ]
    },
    {
      id: "secret-vault-and-credential-boundary",
      title: "Secret Vault and Credential Boundary",
      layer: "harness",
      presetId: "codex-target-loop",
      objective: "Make secret storage, token references, rotation, revocation, and no-plaintext logging a first-class production boundary for multi-tenant EvoPilot.",
      acceptanceCriteria: [
        "Credentials are stored and referenced through encrypted secret refs instead of plaintext project payloads.",
        "API responses, dashboard views, loop evidence, and logs never echo secret values.",
        "Rotation, revocation, audit trail, and credential preflight status are visible to operators and enforced before source closure."
      ]
    },
    {
      id: "project-workspace-ownership",
      title: "Project Workspace Ownership",
      layer: "context",
      presetId: "codex-target-loop",
      objective: "Make every GitHub, GitLab, and local Git project belong to an explicit workspace with scoped credentials, loops, source closures, release evidence, and audit history.",
      acceptanceCriteria: [
        "Project registration requires a workspace boundary and preserves compatibility for existing single-tenant self-hosted projects.",
        "Project lists, credentials, loop runs, release runs, and audit history are filtered by workspace scope.",
        "Moving, archiving, or deleting a project preserves release evidence and produces auditable ownership evidence."
      ]
    },
    {
      id: "quota-rate-limit-billing-foundation",
      title: "Quota Rate Limit Billing Foundation",
      layer: "loop",
      presetId: "codex-target-loop",
      objective: "Introduce the usage accounting, plan, quota, rate limit, and budget stop-condition foundation needed for EvoPilot to behave like a cloud service.",
      acceptanceCriteria: [
        "Loop runtime records usage for projects, tenants, workspaces, source operations, tokens, time, and release attempts.",
        "Plans and quotas can cap loop concurrency, execution duration, source closure, and deployment actions.",
        "Budget and rate-limit stops are surfaced as product-visible next actions instead of generic execution failures."
      ]
    },
    {
      id: "worker-queue-and-postgres-store",
      title: "Worker Queue and Postgres Store",
      layer: "loop",
      presetId: "codex-target-loop",
      objective: "Move cloud execution toward durable Postgres-backed state, queued workers, retry control, backup, restore, and migration contracts.",
      acceptanceCriteria: [
        "Projects, loops, releases, credentials, audits, target backlog, schedules, and memory records have durable relational ownership boundaries.",
        "Worker queue execution supports retry, lease recovery, idempotency, and horizontal scaling without duplicate side effects.",
        "Backup, restore, and migration procedures are documented and validated against representative production data."
      ]
    },
    {
      id: "tenant-aware-release-evidence",
      title: "Tenant Aware Release Evidence",
      layer: "context",
      presetId: "codex-target-loop",
      objective: "Scope release decisions, source release runs, artifacts, deployment proof, and audit replay by tenant and workspace so SaaS users can trust evidence boundaries.",
      acceptanceCriteria: [
        "Release decisions, source release runs, pull requests, merge commits, deployments, artifacts, and audit records carry tenant and workspace scope.",
        "Dashboard and API can replay release evidence for one workspace without exposing unrelated tenant data.",
        "Missing or mismatched tenant/workspace evidence blocks GA release promotion for SaaS targets."
      ]
    },
    {
      id: "multi-tenant-security-regression-suite",
      title: "Multi Tenant Security Regression Suite",
      layer: "harness",
      presetId: "codex-target-loop",
      objective: "Build the regression suite that proves tenant isolation, credential redaction, RBAC, scoped API tokens, and release-evidence boundaries before SaaS GA.",
      acceptanceCriteria: [
        "Tests cover cross-tenant read and write denial for projects, loops, credentials, release evidence, and audit records.",
        "Credential leakage tests prove secrets are not returned through API responses, dashboard state, traces, logs, or release artifacts.",
        "Regression evidence is required by the SaaS GA release target and fails the target when any isolation scenario is missing."
      ]
    },
    {
      id: "saas-production-observability",
      title: "SaaS Production Observability",
      layer: "harness",
      presetId: "codex-target-loop",
      objective: "Harden public production operation with domain, HTTPS, ingress controls, logs, metrics, alerts, status, and incident evidence suitable for external SaaS users.",
      acceptanceCriteria: [
        "Production exposes EvoPilot through a managed domain and HTTPS ingress with documented security boundaries.",
        "Health, readiness, loop execution, release closure, queue pressure, quota, and credential blockers emit metrics and structured logs.",
        "Alerts, status evidence, and incident runbooks exist for externally visible service degradation."
      ]
    },
    {
      id: "saas-onboarding-dashboard",
      title: "SaaS Onboarding Dashboard",
      layer: "context",
      presetId: "codex-target-loop",
      objective: "Compress first-run cloud onboarding into a guided path that connects GitHub, selects a repository, chooses a target, starts the first loop, and reaches a release conclusion.",
      acceptanceCriteria: [
        "A new workspace can complete GitHub connection, repository selection, target choice, and first loop start from one guided dashboard path.",
        "The dashboard shows the active loop stage, blocker, evidence, and release conclusion without forcing users through separate feature pages.",
        "Team invitation and role visibility are available before the workspace is treated as SaaS-ready."
      ]
    },
    {
      id: "saas-field-e2e-source-to-ga",
      title: "SaaS Field E2E Source to GA",
      layer: "loop",
      presetId: "codex-target-loop",
      objective: "Run a real workspace-scoped Source-to-GA journey from GitHub App onboarding through loop execution, PR, CI/CD, deploy, release decision, and audit replay.",
      acceptanceCriteria: [
        "A workspace completes GitHub App repository onboarding and starts a Source-to-GA loop without plaintext source credentials.",
        "The loop produces PR, CI/CD, deployment, health, release decision, and audit evidence under the same workspace boundary.",
        "The field E2E transcript and screenshots are archived as reusable SaaS GA release evidence."
      ]
    },
    {
      id: "saas-release-matrix",
      title: "SaaS Release Matrix",
      layer: "loop",
      presetId: "codex-target-loop",
      objective: "Define and execute the SaaS GA scenario matrix covering new tenants, workspaces, migrations, missing credentials, RBAC denial, worker recovery, release repair, audit replay, and quota blockers.",
      acceptanceCriteria: [
        "The release matrix includes new tenant, new workspace, single-tenant migration, GitHub App onboarding, credential blocker, RBAC denial, worker crash, release repair, audit replay, and quota blocker scenarios.",
        "Each required scenario has executable evidence, owner, status, blocker, and repair action.",
        "SaaS GA release decisions fail when any required matrix scenario is missing or blocked."
      ]
    },
    {
      id: "saas-ga-soak-active",
      title: "SaaS GA Active Soak",
      layer: "loop",
      presetId: "codex-target-loop",
      objective: "Run an active multi-tenant soak with representative projects, workspaces, source closures, workers, release evidence, and no high open risks.",
      acceptanceCriteria: [
        "At least two tenants, three workspaces, five projects, and five successful Source-to-GA loops are exercised under active workload.",
        "Active soak covers worker queue, credential resolution, release repair, audit replay, quota handling, and production observability.",
        "The soak report records duration, deltas, failures, residual risks, and release-decision evidence for the SaaS GA target."
      ]
    },
    {
      id: "saas-ga-release-decision",
      title: "SaaS GA Release Decision",
      layer: "loop",
      presetId: "codex-target-loop",
      objective: "Create an independent saas-ga release target and require a product-native GO decision before the SaaS multi-tenant version can be called GA stable.",
      acceptanceCriteria: [
        "A saas-ga or multi-tenant-ga release target exists with criteria for tenant model, workspace RBAC, GitHub App, vault, quota, Postgres store, observability, field E2E, release matrix, and active soak.",
        "GET /api/v1/release/decisions for the SaaS target returns GO only when all required SaaS criteria and scenarios pass.",
        "The release decision is separate from the existing ga target so core control-plane GA cannot be mistaken for SaaS multi-tenant GA."
      ]
    },
    {
      id: "announce-saas-multi-tenant-ga-stable",
      title: "Announce SaaS Multi Tenant GA Stable",
      layer: "loop",
      presetId: "codex-target-loop",
      objective: "Promote the SaaS multi-tenant version only after the saas-ga release decision is GO and the public product surfaces reference that evidence.",
      acceptanceCriteria: [
        "README, Dashboard, release evidence, release notes, and version tag point to the SaaS GA decision rather than the generic ga target.",
        "The announcement includes the target ID, decision ID, release matrix summary, active soak evidence, and residual risk status.",
        "The release is not announced when the SaaS GA decision is CONDITIONAL-GO, NO-GO, missing, or only backed by dashboard/UI evidence."
      ]
    }
  ];
}

function loopOrchestrationTargets(store: FileStore): LoopOrchestrationTarget[] {
  const loops = store.listLoops();
  return loopOrchestrationTargetDefinitions().map((target) => {
    const loop = loops
      .filter((item) => item.context?.orchestrationTargetId === target.id)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
    const externalBlocker = loop ? inferLoopExternalBlocker(target, loop) : undefined;
    const status = externalBlocker ? "BLOCKED" : loop ? targetStatusFromLoop(loop) : "PENDING";
    return {
      ...target,
      status,
      loopId: loop?.id,
      nextAction: externalBlocker?.nextAction ?? nextTargetAction(loop),
      evidence: externalBlocker ? [...targetEvidence(target, loop), ...externalBlockerEvidence(externalBlocker)] : targetEvidence(target, loop),
      externalBlocker
    };
  });
}

async function advanceLoopOrchestrationTarget(store: FileStore, actor: string, input: {
  targetId?: string;
  projectId?: string;
  targetVersion?: string;
  objective?: string;
  controlPlaneUrl?: string;
  deployConnectorId?: string;
  autoStart?: boolean;
}): Promise<LoopOrchestrationAdvanceResult> {
  const targets = loopOrchestrationTargets(store);
  const target = input.targetId
    ? targets.find((item) => item.id === input.targetId)
    : targets.find((item) => item.status === "PENDING" || item.status === "RUNNING" || item.status === "BLOCKED") ?? targets[0];
  if (!target) throw httpError(404, "LOOP_ORCHESTRATION_TARGET_NOT_FOUND", "No loop orchestration target is available.");
  let loop = target.loopId ? store.readLoop(target.loopId) : undefined;
  let action = target.nextAction;
  let advanced = false;
  const evidence = [`target=${target.id}`, `layer=${target.layer}`, `preset=${target.presetId}`];
  if (!loop) {
    loop = createOrchestrationTargetLoop(store, target, input);
    action = input.autoStart === false ? "create-loop" : "start-loop";
    advanced = true;
    evidence.push(`loopCreated=${loop.id}`);
  }
  if (input.autoStart !== false && loop.status === "PENDING") {
    loop = await store.startLoop(loop.id, actor, {
      evidence: [
        `orchestrationTarget=${target.id}`,
        "codexLoopTarget=true",
        "advanceMode=auto-start"
      ]
    }) ?? loop;
    action = "start-loop";
    advanced = true;
  } else if (input.autoStart !== false && (loop.status === "RUNNING" || loop.status === "BLOCKED")) {
    loop = await store.resumeLoop(loop.id, actor, {
      evidence: [
        `orchestrationTarget=${target.id}`,
        "codexLoopTarget=true",
        "advanceMode=auto-resume"
      ]
    }) ?? loop;
    action = "resume-loop";
    advanced = true;
  } else if (loop.status === "WAITING_APPROVAL") {
    action = "human-approval";
    evidence.push("stopCondition=human-approval");
  } else if (loop.status === "SUCCEEDED" && loop.sourceClosure.closureState !== "PROMOTED") {
    action = "source-closure";
    evidence.push("nextGate=source-closure");
  } else if (loop.status === "SUCCEEDED") {
    action = "done";
    evidence.push("targetStatus=done");
  }
  const externalBlocker = inferLoopExternalBlocker(target, loop);
  const refreshedTarget = {
    ...target,
    status: externalBlocker ? "BLOCKED" : targetStatusFromLoop(loop),
    loopId: loop.id,
    nextAction: externalBlocker?.nextAction ?? nextTargetAction(loop),
    evidence: externalBlocker
      ? [...targetEvidence(target, loop), ...externalBlockerEvidence(externalBlocker)]
      : targetEvidence(target, loop),
    externalBlocker
  };
  return {
    schema: "evopilot-loop-orchestration-advance/v1",
    target: refreshedTarget,
    loop,
    action,
    advanced,
    evidence,
    createdAt: new Date().toISOString()
  };
}

async function runLoopOrchestrationAutopilot(store: FileStore, actor: string, body: unknown): Promise<LoopOrchestrationAutopilotResult> {
  const request = isRecord(body) ? body : {};
  const stages: LoopOrchestrationAutopilotResult["stages"] = [];
  const evidence: string[] = ["autopilot=production-self-evolution"];
  const maxSteps = Math.min(12, Math.max(1, Math.floor(Number(request.maxSteps ?? 8))));
  let loop: LoopRun | undefined;
  let releaseRun: SourceReleaseClosureRun | undefined;
  let target: LoopOrchestrationTarget | undefined;

  const pushStage = (stage: LoopOrchestrationAutopilotResult["stages"][number]) => {
    stages.push(stage);
    evidence.push(`stage.${stage.id}=${stage.status}`, ...stage.evidence);
  };

  try {
    const advanced = await advanceLoopOrchestrationTarget(store, actor, {
      targetId: optionalTrimmedString(request.targetId),
      projectId: optionalTrimmedString(request.projectId),
      targetVersion: optionalTrimmedString(request.targetVersion),
      objective: optionalTrimmedString(request.objective),
      controlPlaneUrl: optionalTrimmedString(request.controlPlaneUrl),
      deployConnectorId: optionalTrimmedString(request.deployConnectorId),
      autoStart: request.autoStart !== false
    });
    target = advanced.target;
    loop = advanced.loop;
    pushStage({
      id: "advance",
      status: "SUCCEEDED",
      detail: `Target advanced with action ${advanced.action}.`,
      evidence: advanced.evidence
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = loopOrchestrationTargets(store)[0];
    if (!fallback) throw error;
    target = fallback;
    pushStage({ id: "advance", status: "FAILED", detail: message, evidence: [`error=${message}`] });
    return finalizeLoopOrchestrationAutopilot({ status: "FAILED", target, loop, releaseRun, stages, evidence, nextAction: "repair" });
  }

  if (!loop) return finalizeLoopOrchestrationAutopilot({ status: "FAILED", target, loop, releaseRun, stages, evidence, nextAction: "repair" });

  let iterated = false;
  for (let step = 0; step < maxSteps; step += 1) {
    loop = store.readLoop(loop.id) ?? loop;
    if (loop.status === "SUCCEEDED" || loop.status === "FAILED" || loop.status === "CANCELLED") break;
    if (loop.status === "WAITING_APPROVAL") {
      if (request.approveHumanGate === true) {
        const approved = store.approveLoop(loop.id, actor);
        loop = approved ?? loop;
        pushStage({
          id: "human-gate",
          status: "SUCCEEDED",
          detail: "Pending loop approval was explicitly approved by autopilot request.",
          evidence: [`approvedBy=${actor}`, "approveHumanGate=true"]
        });
        loop = await store.resumeLoop(loop.id, actor, {
          forceDecision: "SUCCEED",
          evidence: ["autopilotHumanGateApproved=true", `autopilotActor=${actor}`]
        }) ?? loop;
        iterated = true;
        continue;
      }
      pushStage({
        id: "human-gate",
        status: "BLOCKED",
        detail: "Loop reached a human approval gate; autopilot stopped before source release.",
        evidence: ["approveHumanGate=false", `pendingApprovals=${loop.approvals.filter((approval) => approval.status === "PENDING").length}`]
      });
      return finalizeLoopOrchestrationAutopilot({ status: "BLOCKED", target, loop, releaseRun, stages, evidence, nextAction: "human-approval" });
    }
    if (loop.status === "PENDING") {
      loop = await store.startLoop(loop.id, actor, { evidence: ["autopilot.iterate=start"] }) ?? loop;
      iterated = true;
      continue;
    }
    if (loop.status === "RUNNING" || loop.status === "BLOCKED") {
      loop = await store.resumeLoop(loop.id, actor, { evidence: ["autopilot.iterate=resume"] }) ?? loop;
      iterated = true;
      continue;
    }
    break;
  }
  pushStage({
    id: "iterate",
    status: loop.status === "SUCCEEDED" ? "SUCCEEDED" : iterated ? "BLOCKED" : "SKIPPED",
    detail: `Loop status is ${loop.status} after bounded autopilot iteration.`,
    evidence: [`loopStatus=${loop.status}`, `iteration=${loop.currentIteration}`, `maxSteps=${maxSteps}`]
  });

  if (loop.status !== "SUCCEEDED") {
    return finalizeLoopOrchestrationAutopilot({ status: "BLOCKED", target, loop, releaseRun, stages, evidence, nextAction: loop.status === "WAITING_APPROVAL" ? "human-approval" : "repair" });
  }

  const shouldExecuteClosure = request.executeSourceClosure !== false && loop.sourceClosure.closureState !== "PROMOTED";
  if (shouldExecuteClosure) {
    const preflight = await preflightLoopSourceClosure(store, loop.id, { actor, persist: true });
    if (!preflight || preflight.status !== "PASS") {
      loop = store.readLoop(loop.id) ?? loop;
      const externalBlocker = buildExternalBlockerFromPreflight(preflight, target, loop);
      const detail = preflight
        ? `Source closure preflight failed: ${preflight.blockers.join(", ") || "unknown blocker"}.`
        : "Source closure preflight failed because the loop was not found.";
      pushStage({
        id: "source-preflight",
        status: externalBlocker ? "BLOCKED" : "FAILED",
        detail,
        evidence: [
          `preflight=${preflight?.status ?? "MISSING"}`,
          `nextAction=${preflight?.nextAction ?? "repair-project"}`,
          ...(preflight?.blockers ?? []).map((blocker) => `blocker=${blocker}`)
        ]
      });
      if (externalBlocker) {
        pushStage({
          id: "external-blocker",
          status: "BLOCKED",
          detail: `External blocker requires ${externalBlocker.nextAction}.`,
          evidence: [
            `externalBlocker=${externalBlocker.id}`,
            `type=${externalBlocker.type}`,
            `route=${externalBlocker.recovery.route}`,
            ...externalBlocker.blockers.map((blocker) => `blocker=${blocker}`)
          ]
        });
        return finalizeLoopOrchestrationAutopilot({
          status: "BLOCKED",
          target,
          loop,
          releaseRun,
          stages,
          evidence,
          nextAction: externalBlocker.nextAction,
          externalBlocker
        });
      }
      return finalizeLoopOrchestrationAutopilot({ status: "FAILED", target, loop, releaseRun, stages, evidence, nextAction: "source-closure" });
    }
    pushStage({
      id: "source-preflight",
      status: "SUCCEEDED",
      detail: "Source closure preflight passed.",
      evidence: [
        `preflight=${preflight.status}`,
        `nextAction=${preflight.nextAction}`,
        ...preflight.checks.map((check) => `${check.id}=${check.status}`)
      ]
    });
    try {
      const sourceClosure = await executeLoopSourceClosure(store, loop.id, actor, {
        files: normalizeSourceClosureFiles(request.files).length > 0 ? normalizeSourceClosureFiles(request.files) : defaultAutopilotSourceClosureFiles(loop, target),
        tagName: optionalTrimmedString(request.tagName),
        deployConnectorId: optionalTrimmedString(request.deployConnectorId),
        deploymentUrl: optionalTrimmedString(request.deploymentUrl),
        healthUrl: optionalTrimmedString(request.healthUrl),
        readyUrl: optionalTrimmedString(request.readyUrl),
        createReviewRequest: request.createReviewRequest !== false,
        commitMessage: optionalTrimmedString(request.commitMessage) ?? `EvoPilot autopilot source closure for ${loop.id}`
      });
      loop = sourceClosure?.loop ?? loop;
      releaseRun = sourceClosure?.releaseRun;
      const sourceClosureEvidence = [
        `closureState=${loop.sourceClosure.closureState}`,
        `releaseRun=${releaseRun?.id ?? "none"}`,
        ...sourceClosureFailedEvidence(loop.sourceClosure)
      ];
      pushStage({
        id: "source-closure",
        status: loop.sourceClosure.closureState === "PROMOTED" ? "SUCCEEDED" : loop.sourceClosure.closureState === "FAILED" ? "FAILED" : "BLOCKED",
        detail: `Source closure reached ${loop.sourceClosure.closureState}.`,
        evidence: sourceClosureEvidence
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      loop = store.readLoop(loop.id) ?? loop;
      releaseRun = store.listSourceReleaseClosureRuns(loop.id).at(-1) ?? releaseRun;
      pushStage({ id: "source-closure", status: "FAILED", detail: message, evidence: [`error=${message}`] });
      return finalizeLoopOrchestrationAutopilot({ status: "FAILED", target, loop, releaseRun, stages, evidence, nextAction: "source-closure" });
    }
  } else {
    releaseRun = store.listSourceReleaseClosureRuns(loop.id).at(-1);
    pushStage({ id: "source-closure", status: "SKIPPED", detail: `Source closure is ${loop.sourceClosure.closureState}.`, evidence: [`closureState=${loop.sourceClosure.closureState}`] });
  }

  if (request.autoMerge === false) {
    return finalizeLoopOrchestrationAutopilot({ status: "BLOCKED", target, loop, releaseRun, stages, evidence, nextAction: "policy-review" });
  }

  if (loop.sourceClosure.closureState !== "PROMOTED") {
    return finalizeLoopOrchestrationAutopilot({
      status: loop.sourceClosure.closureState === "FAILED" ? "FAILED" : "BLOCKED",
      target,
      loop,
      releaseRun,
      stages,
      evidence,
      nextAction: "source-closure"
    });
  }

  try {
    const decision = await applySourceClosureReviewDecision(store, loop.id, actor, {
      action: "auto-merge",
      autoMerge: true,
      postMergeDeploy: request.postMergeDeploy !== false,
      commitMessage: optionalTrimmedString(request.mergeCommitMessage) ?? `EvoPilot safe auto-merge ${loop.id}`
    });
    loop = decision?.loop ?? loop;
    releaseRun = decision?.releaseRun ?? releaseRun;
    pushStage({
      id: "safe-auto-merge",
      status: releaseRun?.review?.status === "MERGED" ? "SUCCEEDED" : "BLOCKED",
      detail: `Release review is ${releaseRun?.review?.status ?? "UNKNOWN"} and policy is ${releaseRun?.policy?.status ?? "UNKNOWN"}.`,
      evidence: [
        `review=${releaseRun?.review?.status ?? "UNKNOWN"}`,
        `policy=${releaseRun?.policy?.status ?? "UNKNOWN"}`,
        `postMergeDeploy=${releaseRun?.postMergeDeployment?.status ?? "UNKNOWN"}`
      ]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loop = store.readLoop(loop.id) ?? loop;
    releaseRun = store.listSourceReleaseClosureRuns(loop.id).at(-1) ?? releaseRun;
    pushStage({
      id: "safe-auto-merge",
      status: "BLOCKED",
      detail: message,
      evidence: [`error=${message}`, `policy=${releaseRun?.policy?.status ?? "UNKNOWN"}`]
    });
    return finalizeLoopOrchestrationAutopilot({ status: "BLOCKED", target, loop, releaseRun, stages, evidence, nextAction: "policy-review" });
  }

  return finalizeLoopOrchestrationAutopilot({
    status: releaseRun?.review?.status === "MERGED" ? "SUCCEEDED" : "BLOCKED",
    target,
    loop,
    releaseRun,
    stages,
    evidence,
    nextAction: releaseRun?.review?.status === "MERGED" ? "done" : "policy-review"
  });
}

function finalizeLoopOrchestrationAutopilot(input: {
  status: LoopOrchestrationAutopilotResult["status"];
  target: LoopOrchestrationTarget;
  loop?: LoopRun;
  releaseRun?: SourceReleaseClosureRun;
  stages: LoopOrchestrationAutopilotResult["stages"];
  evidence: string[];
  nextAction: LoopOrchestrationAutopilotResult["nextAction"];
  externalBlocker?: LoopExternalBlocker;
}): LoopOrchestrationAutopilotResult {
  return {
    schema: "evopilot-loop-orchestration-autopilot/v1",
    status: input.status,
    target: input.externalBlocker ? {
      ...input.target,
      status: "BLOCKED",
      nextAction: input.externalBlocker.nextAction,
      externalBlocker: input.externalBlocker,
      evidence: [...input.target.evidence, ...externalBlockerEvidence(input.externalBlocker)]
    } : input.target,
    loop: input.loop,
    releaseRun: input.releaseRun,
    stages: input.stages,
    nextAction: input.nextAction,
    externalBlocker: input.externalBlocker,
    evidence: input.evidence,
    createdAt: new Date().toISOString()
  };
}

function buildExternalBlockerFromPreflight(preflight: SourceClosurePreflightResult | undefined, target: LoopOrchestrationTarget, loop: LoopRun): LoopExternalBlocker | undefined {
  if (!preflight || preflight.status === "PASS") return undefined;
  const now = new Date().toISOString();
  if (preflight.nextAction === "repair-credentials") {
    return {
      schema: "evopilot-external-blocker/v1",
      id: `${loop.id}-source-credential-blocker`,
      type: "source-credential",
      status: "WAITING_HUMAN",
      targetId: target.id,
      loopId: loop.id,
      projectId: preflight.sourceProjectId,
      provider: preflight.provider,
      nextAction: "configure-source-credentials",
      blockers: preflight.blockers,
      evidence: [
        `preflight=${preflight.status}`,
        `preflightNextAction=${preflight.nextAction}`,
        ...preflight.checks.flatMap((check) => [`${check.id}=${check.status}`, ...check.evidence])
      ],
      recovery: {
        route: "project-source-credentials",
        api: `/api/v1/projects/${encodeURIComponent(preflight.sourceProjectId)}/source-credentials/preflight`,
        dashboardAction: "接入项目 -> 验证写回凭据"
      },
      createdAt: now
    };
  }
  if (preflight.nextAction === "repair-deploy-target") {
    return {
      schema: "evopilot-external-blocker/v1",
      id: `${loop.id}-deploy-target-blocker`,
      type: "deploy-target",
      status: "WAITING_HUMAN",
      targetId: target.id,
      loopId: loop.id,
      projectId: preflight.sourceProjectId,
      provider: preflight.provider,
      nextAction: "repair-deploy-target",
      blockers: preflight.blockers,
      evidence: [`preflight=${preflight.status}`, `preflightNextAction=${preflight.nextAction}`],
      recovery: { route: "deploy-connectors", dashboardAction: "部署连接器 -> 配置健康检查" },
      createdAt: now
    };
  }
  if (preflight.nextAction === "repair-project") {
    return {
      schema: "evopilot-external-blocker/v1",
      id: `${loop.id}-project-binding-blocker`,
      type: "project-binding",
      status: "WAITING_HUMAN",
      targetId: target.id,
      loopId: loop.id,
      projectId: preflight.sourceProjectId,
      provider: preflight.provider,
      nextAction: "repair-project",
      blockers: preflight.blockers,
      evidence: [`preflight=${preflight.status}`, `preflightNextAction=${preflight.nextAction}`],
      recovery: { route: "project-settings", dashboardAction: "接入项目 -> 修复仓库配置" },
      createdAt: now
    };
  }
  return undefined;
}

function externalBlockerEvidence(blocker: LoopExternalBlocker): string[] {
  return [
    `externalBlocker=${blocker.id}`,
    `externalBlocker.type=${blocker.type}`,
    `externalBlocker.status=${blocker.status}`,
    `externalBlocker.nextAction=${blocker.nextAction}`,
    `externalBlocker.route=${blocker.recovery.route}`,
    ...blocker.blockers.map((item) => `externalBlocker.blocker=${item}`)
  ];
}

function inferLoopExternalBlocker(target: Pick<LoopOrchestrationTarget, "id">, loop: LoopRun): LoopExternalBlocker | undefined {
  if (loop.sourceClosure.closureState === "PROMOTED") return undefined;
  const preflightEvidence = [...loop.evidenceSets].reverse().find((set) =>
    set.validator === "evopilot-source-closure-preflight" &&
    set.status === "FAIL" &&
    set.evidence.some((item) => item === "sourceClosure.preflight=FAIL")
  );
  if (!preflightEvidence) return undefined;
  const blockers = preflightEvidence.evidence
    .filter((item) => item.startsWith("sourceClosure.preflight.blocker="))
    .map((item) => item.replace("sourceClosure.preflight.blocker=", ""));
  const nextAction = preflightEvidence.evidence
    .find((item) => item.startsWith("sourceClosure.preflight.nextAction="))
    ?.replace("sourceClosure.preflight.nextAction=", "");
  if (nextAction === "repair-credentials" || blockers.some((blocker) => blocker.includes("credentials") || blocker.includes("token"))) {
    return {
      schema: "evopilot-external-blocker/v1",
      id: `${loop.id}-source-credential-blocker`,
      type: "source-credential",
      status: "WAITING_HUMAN",
      targetId: target.id,
      loopId: loop.id,
      projectId: loop.sourceClosure.sourceProjectId,
      provider: loop.sourceClosure.repositoryProvider,
      nextAction: "configure-source-credentials",
      blockers,
      evidence: preflightEvidence.evidence,
      recovery: {
        route: "project-source-credentials",
        api: `/api/v1/projects/${encodeURIComponent(loop.sourceClosure.sourceProjectId)}/source-credentials/preflight`,
        dashboardAction: "接入项目 -> 验证写回凭据"
      },
      createdAt: preflightEvidence.createdAt
    };
  }
  if (nextAction === "repair-deploy-target") {
    return {
      schema: "evopilot-external-blocker/v1",
      id: `${loop.id}-deploy-target-blocker`,
      type: "deploy-target",
      status: "WAITING_HUMAN",
      targetId: target.id,
      loopId: loop.id,
      projectId: loop.sourceClosure.sourceProjectId,
      provider: loop.sourceClosure.repositoryProvider,
      nextAction: "repair-deploy-target",
      blockers,
      evidence: preflightEvidence.evidence,
      recovery: { route: "deploy-connectors", dashboardAction: "部署连接器 -> 配置健康检查" },
      createdAt: preflightEvidence.createdAt
    };
  }
  if (nextAction === "repair-project") {
    return {
      schema: "evopilot-external-blocker/v1",
      id: `${loop.id}-project-binding-blocker`,
      type: "project-binding",
      status: "WAITING_HUMAN",
      targetId: target.id,
      loopId: loop.id,
      projectId: loop.sourceClosure.sourceProjectId,
      provider: loop.sourceClosure.repositoryProvider,
      nextAction: "repair-project",
      blockers,
      evidence: preflightEvidence.evidence,
      recovery: { route: "project-settings", dashboardAction: "接入项目 -> 修复仓库配置" },
      createdAt: preflightEvidence.createdAt
    };
  }
  return undefined;
}

function sourceClosureFailedEvidence(closure: LoopSourceClosure): string[] {
  return Object.entries(closure.gateEvidence)
    .filter(([, row]) => row?.status === "FAILED")
    .flatMap(([gate, row]) => [`failedGate=${gate}`, ...(row?.evidence ?? []).map((item) => `failedEvidence=${item}`)]);
}

function defaultAutopilotSourceClosureFiles(loop: LoopRun, target: LoopOrchestrationTarget): Array<{ path: string; content: string }> {
  return [{
    path: `docs/evopilot-source-closures/${safeFileName(loop.id)}.md`,
    content: [
      `# EvoPilot Autopilot Source Closure`,
      ``,
      `Loop: ${loop.id}`,
      `Target: ${target.id}`,
      `Target title: ${target.title}`,
      `Objective: ${loop.objective}`,
      `Provider: ${loop.sourceClosure.repositoryProvider}`,
      `Source branch: ${loop.sourceClosure.sourceBranch}`,
      `Target version: ${loop.sourceClosure.targetVersion ?? "unspecified"}`,
      ``,
      `## Acceptance Criteria`,
      ...target.acceptanceCriteria.map((item) => `- ${item}`),
      ``,
      `## Autopilot Evidence`,
      `- production-self-evolution-autopilot=true`,
      `- sourceClosure.requiredGates=${loop.sourceClosure.requiredGates.join(",")}`,
      `- sandbox=${loop.sandbox.runtime}/${loop.sandbox.network}/${loop.sandbox.credentialScope}`,
      `- coordination=${loop.coordination.mode}/${loop.coordination.nodes.length} executors`,
      ``
    ].join("\n")
  }];
}

function createOrchestrationTargetLoop(store: FileStore, target: LoopOrchestrationTarget, input: {
  projectId?: string;
  targetVersion?: string;
  objective?: string;
  controlPlaneUrl?: string;
  deployConnectorId?: string;
}): LoopRun {
  const projectId = safeFileName(String(input.projectId ?? "evopilot-github"));
  const project = store.readProject(projectId);
  const deployConnectorId = input.deployConnectorId
    ?? (store.listDeployConnectors().length === 1 ? store.listDeployConnectors()[0].id : undefined);
  const graph = store.writeExecutorGraph(selfEvolutionExecutorGraph());
  return store.createLoop({
    id: `target-${target.id}-${Date.now()}`,
    source: "api",
    projectId,
    objective: input.objective ?? target.objective,
    executorGraphId: graph.id,
    controlPlaneUrl: input.controlPlaneUrl,
    sourceClosure: {
      sourceProjectId: projectId,
      repositoryProvider: project?.repository?.provider ?? "unknown",
      sourceBranch: project?.repository?.defaultBranch ?? "main",
      targetVersion: input.targetVersion ?? `target-${target.id}-${new Date().toISOString().slice(0, 10)}`,
      deploymentConnectorId: deployConnectorId,
      deploymentEnvironment: "production",
      requiredGates: ["code-change", "push", "deploy", "health-ready"]
    },
    sandbox: {
      runtime: "docker",
      network: "restricted",
      credentialScope: "loop",
      allowedPaths: ["packages", "apps", "docs", "tests", "scripts"],
      deniedPaths: [".env", ".env.*", ".git", "node_modules"]
    },
    stopPolicy: {
      maxIterations: 6,
      maxDurationSeconds: 24 * 60 * 60,
      requireApprovalForRelease: true,
      stopOnRepeatedFailure: 2
    },
    retryPolicy: {
      maxAttemptsPerNode: 2,
      backoffSeconds: 5,
      circuitBreakerFailures: 2
    },
    context: {
      orchestrationPresetId: target.presetId,
      orchestrationTargetId: target.id,
      targetLayer: target.layer,
      codexLoopTarget: true,
      acceptanceCriteria: target.acceptanceCriteria,
      dashboardWorkbench: true,
      unattendedProof: {
        watchdog: true,
        workerLease: true,
        independentValidation: true,
        sourceClosure: true,
        deployRollback: true
      }
    }
  });
}

function targetStatusFromLoop(loop?: LoopRun): LoopOrchestrationTargetStatus {
  if (!loop) return "PENDING";
  const externalBlocker = inferLoopExternalBlocker({ id: loop.context?.orchestrationTargetId ? String(loop.context.orchestrationTargetId) : "unknown" }, loop);
  if (externalBlocker) return "BLOCKED";
  if (loop.status === "SUCCEEDED" && loop.sourceClosure.closureState === "PROMOTED") return "DONE";
  if (loop.status === "WAITING_APPROVAL") return "WAITING_HUMAN";
  if (loop.status === "FAILED" || loop.status === "CANCELLED" || loop.status === "BLOCKED") return "BLOCKED";
  return "RUNNING";
}

function nextTargetAction(loop?: LoopRun): LoopOrchestrationTarget["nextAction"] {
  if (!loop) return "create-loop";
  const externalBlocker = inferLoopExternalBlocker({ id: loop.context?.orchestrationTargetId ? String(loop.context.orchestrationTargetId) : "unknown" }, loop);
  if (externalBlocker) return externalBlocker.nextAction;
  if (loop.status === "PENDING") return "start-loop";
  if (loop.status === "WAITING_APPROVAL") return "human-approval";
  if (loop.status === "RUNNING" || loop.status === "BLOCKED") return "resume-loop";
  if (loop.status === "SUCCEEDED" && loop.sourceClosure.closureState !== "PROMOTED") return "source-closure";
  if (loop.status === "SUCCEEDED") return "done";
  return "repair";
}

function targetEvidence(target: Pick<LoopOrchestrationTarget, "id" | "layer" | "acceptanceCriteria">, loop?: LoopRun): string[] {
  const externalBlocker = loop ? inferLoopExternalBlocker(target, loop) : undefined;
  return [
    `target=${target.id}`,
    `layer=${target.layer}`,
    `acceptanceCriteria=${target.acceptanceCriteria.length}`,
    loop ? `loop=${loop.id}` : "loop=not-created",
    loop ? `tenant=${loop.tenantId}` : `tenant=${DEFAULT_TENANT_ID}`,
    loop ? `workspace=${loop.workspaceId}` : `workspace=${DEFAULT_WORKSPACE_ID}`,
    target.id === "tenant-workspace-model" ? "membershipModel=owner,admin,developer,viewer" : "membershipModel=not-targeted",
    loop ? `loopStatus=${loop.status}` : "loopStatus=PENDING",
    loop ? `iteration=${loop.currentIteration}/${loop.stopPolicy.maxIterations}` : "iteration=0",
    loop ? `sourceClosure=${loop.sourceClosure.closureState}` : "sourceClosure=not-started",
    loop ? `sandboxEnforcement=${loop.sandboxEnforcement.status}` : "sandboxEnforcement=pending",
    loop?.trace ? `executorSteps=${loop.trace.executorStepCount}` : "executorSteps=0",
    externalBlocker ? `externalBlocker=${externalBlocker.id}` : "externalBlocker=none"
  ];
}

function normalizeLoopStopPolicy(input?: Partial<LoopStopPolicy>): LoopStopPolicy {
  return {
    maxIterations: clampPositiveInteger(input?.maxIterations, 3),
    maxDurationSeconds: clampPositiveInteger(input?.maxDurationSeconds, 24 * 60 * 60),
    requireApprovalForRelease: input?.requireApprovalForRelease ?? true,
    stopOnRepeatedFailure: clampPositiveInteger(input?.stopOnRepeatedFailure, 2)
  };
}

function normalizeLoopRetryPolicy(input?: Partial<LoopRetryPolicy>): LoopRetryPolicy {
  return {
    maxAttemptsPerNode: clampPositiveInteger(input?.maxAttemptsPerNode, 2),
    backoffSeconds: clampPositiveInteger(input?.backoffSeconds, 30),
    circuitBreakerFailures: clampPositiveInteger(input?.circuitBreakerFailures, 2)
  };
}

function normalizeLoopRunStatus(value: unknown): LoopRunStatus {
  const status = String(value ?? "PENDING");
  if (["PENDING", "RUNNING", "WAITING_APPROVAL", "BLOCKED", "SUCCEEDED", "FAILED", "CANCELLED"].includes(status)) return status as LoopRunStatus;
  return "PENDING";
}

function normalizeLoopStoreRuntime(input?: Partial<LoopStoreRuntime>): LoopStoreRuntime {
  const envBackend = String(process.env.EVOPILOT_LOOP_STORE_BACKEND ?? "").toLowerCase();
  const backend = normalizeLoopStoreBackend(input?.backend ?? envBackend);
  const dsn = input?.dsn ?? process.env.EVOPILOT_LOOP_STORE_DSN;
  return {
    backend,
    dsn: dsn ? maskDsn(String(dsn)) : undefined,
    durable: true,
    lockProvider: backend === "postgres" ? "postgres-advisory-lock" : backend === "sqlite" ? "sqlite-transaction" : "file-lease",
    recovery: "idempotent-replay"
  };
}

async function loopStoreReadiness(runtime: LoopStoreRuntime, options: { verifyConnection?: boolean } = {}): Promise<{
  schema: "evopilot-loop-store-readiness/v1";
  status: "READY" | "BLOCKED";
  backend: LoopStoreBackendType;
  postgresRequired: boolean;
  postgresConfigured: boolean;
  postgresReachable?: boolean;
  lockProvider: LoopStoreRuntime["lockProvider"];
  recovery: LoopStoreRuntime["recovery"];
  blockers: string[];
  evidence: string[];
  evaluatedAt: string;
}> {
  const postgresConfigured = runtime.backend === "postgres" && Boolean(runtime.dsn);
  const postgresRequired = true;
  const reachable = postgresConfigured && options.verifyConnection ? await probePostgresDsn(runtime.dsn) : undefined;
  const blockers = !postgresConfigured
    ? ["POSTGRES_LOOP_STORE_NOT_CONFIGURED"]
    : reachable === false
      ? ["POSTGRES_LOOP_STORE_UNREACHABLE"]
      : [];
  return {
    schema: "evopilot-loop-store-readiness/v1",
    status: blockers.length === 0 ? "READY" : "BLOCKED",
    backend: runtime.backend,
    postgresRequired,
    postgresConfigured,
    postgresReachable: reachable,
    lockProvider: runtime.lockProvider,
    recovery: runtime.recovery,
    blockers,
    evidence: [
      `backend=${runtime.backend}`,
      `dsnConfigured=${Boolean(runtime.dsn)}`,
      `lockProvider=${runtime.lockProvider}`,
      `recovery=${runtime.recovery}`,
      reachable === undefined ? `postgresReadiness=${postgresConfigured ? "READY" : "BLOCKED"}` : `postgresReachable=${reachable}`
    ],
    evaluatedAt: new Date().toISOString()
  };
}

function loopStoreReadinessSnapshot(runtime: LoopStoreRuntime): {
  schema: "evopilot-loop-store-readiness/v1";
  status: "READY" | "BLOCKED";
  backend: LoopStoreBackendType;
  postgresRequired: boolean;
  postgresConfigured: boolean;
  lockProvider: LoopStoreRuntime["lockProvider"];
  recovery: LoopStoreRuntime["recovery"];
  blockers: string[];
  evidence: string[];
  evaluatedAt: string;
} {
  const postgresConfigured = runtime.backend === "postgres" && Boolean(runtime.dsn);
  const blockers = postgresConfigured ? [] : ["POSTGRES_LOOP_STORE_NOT_CONFIGURED"];
  return {
    schema: "evopilot-loop-store-readiness/v1",
    status: blockers.length === 0 ? "READY" : "BLOCKED",
    backend: runtime.backend,
    postgresRequired: true,
    postgresConfigured,
    lockProvider: runtime.lockProvider,
    recovery: runtime.recovery,
    blockers,
    evidence: [
      `backend=${runtime.backend}`,
      `dsnConfigured=${Boolean(runtime.dsn)}`,
      `lockProvider=${runtime.lockProvider}`,
      `recovery=${runtime.recovery}`,
      postgresConfigured ? "postgresReadiness=READY" : "postgresReadiness=BLOCKED"
    ],
    evaluatedAt: new Date().toISOString()
  };
}

async function probePostgresDsn(maskedDsn: string | undefined): Promise<boolean> {
  const endpoint = parsePostgresEndpoint(maskedDsn);
  if (!endpoint) return false;
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function parsePostgresEndpoint(maskedDsn: string | undefined): { host: string; port: number } | undefined {
  if (!maskedDsn) return undefined;
  try {
    const url = new URL(maskedDsn);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return undefined;
    return { host: url.hostname, port: Number(url.port || 5432) };
  } catch {
    return undefined;
  }
}

function normalizeLoopStoreBackend(value: unknown): LoopStoreBackendType {
  const backend = String(value ?? "file").toLowerCase();
  if (backend === "sqlite" || backend === "postgres") return backend;
  return "file";
}

function latestSaasGoReleaseDecision(decisions: ReleaseDecision[]): ReleaseDecision | undefined {
  return decisions
    .filter((decision) => decision.status === "GO" && /saas|multi-tenant/i.test(`${decision.id} ${decision.targetId}`))
    .sort((left, right) => Date.parse(left.generatedAt) - Date.parse(right.generatedAt))
    .at(-1);
}

function currentReleaseDecision(decisions: ReleaseDecision[]): ReleaseDecision | undefined {
  const ordered = [...decisions].sort((left, right) => Date.parse(left.generatedAt) - Date.parse(right.generatedAt));
  return ordered
    .filter((decision) => decision.targetId === "saas-ga")
    .at(-1) ?? ordered.at(-1);
}

function isOpenBlockedLoop(loop: LoopRun, sourceReleaseRuns: SourceReleaseClosureRun[], latestSaasGoAt?: number): boolean {
  if (loop.status !== "BLOCKED" && loop.status !== "FAILED") return false;
  if (["PROMOTED", "SUCCEEDED"].includes(String(loop.sourceClosure?.closureState))) return false;
  const loopTime = Date.parse(loop.updatedAt ?? loop.createdAt ?? "");
  if (latestSaasGoAt !== undefined && Number.isFinite(latestSaasGoAt) && Number.isFinite(loopTime) && loopTime <= latestSaasGoAt) return false;
  return !sourceReleaseRuns.some((run) => {
    if (!["PROMOTED", "SUCCEEDED"].includes(run.status)) return false;
    const sameLoop = run.loopId === loop.id;
    const sameProject = run.projectId === loop.projectId;
    if (!sameLoop && !sameProject) return false;
    const runTime = Date.parse(run.updatedAt ?? run.createdAt ?? "");
    return Number.isFinite(runTime) && (!Number.isFinite(loopTime) || runTime >= loopTime);
  });
}

function maskDsn(value: string): string {
  return value.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:[REDACTED]@");
}

function normalizeLoopSandboxPolicy(input?: Partial<LoopSandboxPolicy> | unknown): LoopSandboxPolicy {
  const value = isRecord(input) ? input : {};
  const runtime = normalizeLoopSandboxRuntime(value.runtime);
  const network = normalizeSandboxNetwork(value.network);
  const credentialScope = normalizeCredentialScope(value.credentialScope);
  const resourceLimits = normalizeSandboxResourceLimits(value.resourceLimits);
  return {
    runtime,
    image: value.image ? String(value.image) : runtime === "docker" ? "ghcr.io/all-hands-ai/runtime:0.59-nikolaik" : undefined,
    namespace: value.namespace ? safeFileName(String(value.namespace)) : runtime === "k8s" ? "evopilot-sandbox" : undefined,
    credentialScope,
    network,
    allowedPaths: Array.isArray(value.allowedPaths) ? value.allowedPaths.map(String) : [".evopilot/runtime-upgrades", "docs/evopilot-upgrades", "src", "test"],
    deniedPaths: Array.isArray(value.deniedPaths) ? value.deniedPaths.map(String) : [".env", ".env.*", "node_modules", ".git"],
    resourceLimits
  };
}

function evaluateLoopSandboxEnforcement(policy: LoopSandboxPolicy): LoopSandboxEnforcement {
  const evidence = [
    `sandbox.enforcement.runtime=${policy.runtime}`,
    `sandbox.enforcement.network=${policy.network}`,
    `sandbox.enforcement.credentialScope=${policy.credentialScope}`,
    `sandbox.enforcement.allowedPaths=${policy.allowedPaths.join(",")}`,
    `sandbox.enforcement.deniedPaths=${policy.deniedPaths.join(",")}`,
    `sandbox.enforcement.resources=cpu:${policy.resourceLimits.cpu},memory:${policy.resourceLimits.memoryMb}Mi,pids:${policy.resourceLimits.pids}`
  ];
  if (policy.runtime === "host") {
    return {
      status: "POLICY_ONLY",
      runtime: policy.runtime,
      evidence: [...evidence, "sandbox.enforcement.status=POLICY_ONLY", "sandbox.enforcement.reason=host runtime cannot provide hard isolation"],
      restrictions: {
        network: policy.network,
        credentialScope: policy.credentialScope,
        allowedPaths: policy.allowedPaths,
        deniedPaths: policy.deniedPaths
      }
    };
  }
  const missingBoundary = policy.runtime === "docker" && !policy.image
    ? "docker image missing"
    : policy.runtime === "k8s" && !policy.namespace
      ? "k8s namespace missing"
      : "";
  if (missingBoundary) {
    return {
      status: "FAILED",
      runtime: policy.runtime,
      evidence: [...evidence, "sandbox.enforcement.status=FAILED", `sandbox.enforcement.failure=${missingBoundary}`],
      restrictions: {
        network: policy.network,
        credentialScope: policy.credentialScope,
        allowedPaths: policy.allowedPaths,
        deniedPaths: policy.deniedPaths
      }
    };
  }
  return {
    status: "ENFORCED",
    runtime: policy.runtime,
    evidence: [...evidence, "sandbox.enforcement.status=ENFORCED", `sandbox.enforcement.boundary=${policy.runtime === "docker" ? policy.image : policy.namespace}`],
    restrictions: {
      network: policy.network,
      credentialScope: policy.credentialScope,
      allowedPaths: policy.allowedPaths,
      deniedPaths: policy.deniedPaths
    }
  };
}

function normalizeLoopSandboxRuntime(value: unknown): LoopSandboxRuntimeType {
  const runtime = String(value ?? "host").toLowerCase();
  if (runtime === "docker" || runtime === "k8s") return runtime;
  return "host";
}

function normalizeLoopSourceClosure(input: unknown, project?: StoredProject, controlPlaneUrl?: string): LoopSourceClosure {
  const value = isRecord(input) ? input : {};
  const repository = project?.repository;
  const provider = normalizeSourceClosureRepositoryProvider(value.repositoryProvider ?? repository?.provider);
  const sourceProjectId = safeFileName(String(value.sourceProjectId ?? project?.id ?? "evopilot"));
  const sourceBranch = String(value.sourceBranch ?? repository?.defaultBranch ?? "main").trim() || "main";
  const sourceUrl = value.sourceUrl
    ? String(value.sourceUrl).trim()
    : repository?.gitUrl ?? sourceUrlFromRepository(repository);
  const sourceRoot = value.sourceRoot
    ? String(value.sourceRoot).trim()
    : repository?.root;
  return {
    sourceProjectId,
    repositoryProvider: provider,
    sourceUrl: sourceUrl || undefined,
    sourceRoot: sourceRoot || undefined,
    sourceBranch,
    controlPlaneUrl: value.controlPlaneUrl ? String(value.controlPlaneUrl).trim() : controlPlaneUrl,
    targetVersion: value.targetVersion ? String(value.targetVersion).trim() : undefined,
    releaseStrategy: normalizeSourceClosureReleaseStrategy(value.releaseStrategy, provider),
    requiredGates: normalizeSourceClosureGates(value.requiredGates),
    deploymentEnvironment: value.deploymentEnvironment ? String(value.deploymentEnvironment).trim() : "production",
    deploymentConnectorId: optionalTrimmedString(value.deploymentConnectorId),
    closureState: normalizeSourceClosureState(value.closureState),
    gateEvidence: normalizeSourceClosureGateEvidence(value.gateEvidence),
    artifacts: normalizeSourceClosureArtifacts(value.artifacts)
  };
}

function normalizeSourceClosureState(value: unknown): LoopSourceClosureState {
  const state = String(value ?? "PLANNED").trim().toUpperCase();
  if (["PLANNED", "CODE_CHANGED", "PUSHED", "TAGGED", "DEPLOYED", "HEALTH_READY", "HEALTH_FAILED", "ROLLED_BACK", "PROMOTED", "FAILED"].includes(state)) {
    return state as LoopSourceClosureState;
  }
  return "PLANNED";
}

function normalizeSourceClosureRepositoryProvider(value: unknown): LoopSourceClosure["repositoryProvider"] {
  const provider = String(value ?? "unknown").trim();
  if (provider === "local-git" || provider === "gitlab" || provider === "github") return provider;
  return "unknown";
}

function normalizeSourceClosureReleaseStrategy(value: unknown, provider: LoopSourceClosure["repositoryProvider"]): LoopSourceClosure["releaseStrategy"] {
  const strategy = String(value ?? "").trim();
  if (strategy === "github-push" || strategy === "gitlab-merge-request" || strategy === "local-git-commit" || strategy === "none") return strategy;
  if (provider === "github") return "github-push";
  if (provider === "gitlab") return "gitlab-merge-request";
  if (provider === "local-git") return "local-git-commit";
  return "none";
}

function normalizeSourceClosureGates(value: unknown): LoopSourceClosure["requiredGates"] {
  const allowed = new Set<LoopSourceClosureGate>(["code-change", "push", "tag", "deploy", "health-ready"]);
  const gates = Array.isArray(value) ? value.map(String).filter((item): item is LoopSourceClosureGate => allowed.has(item as LoopSourceClosureGate)) : [];
  return gates.length > 0 ? [...new Set(gates)] : ["code-change", "push", "deploy", "health-ready"];
}

function normalizeSourceClosureGateEvidence(value: unknown): LoopSourceClosure["gateEvidence"] {
  if (!isRecord(value)) return {};
  const evidence: LoopSourceClosure["gateEvidence"] = {};
  for (const gate of ["code-change", "push", "tag", "deploy", "health-ready"] as const) {
    const row = value[gate];
    if (!isRecord(row)) continue;
    const status = String(row.status ?? "PENDING").toUpperCase();
    evidence[gate] = {
      status: status === "PASSED" || status === "FAILED" || status === "SKIPPED" ? status : "PENDING",
      evidence: Array.isArray(row.evidence) ? row.evidence.map(String) : [],
      checkedAt: String(row.checkedAt ?? new Date().toISOString())
    };
  }
  return evidence;
}

function normalizeSourceClosureArtifacts(value: unknown): LoopSourceClosure["artifacts"] {
  if (!isRecord(value)) return {};
  return {
    branch: optionalTrimmedString(value.branch),
    commitSha: optionalTrimmedString(value.commitSha),
    mergeCommitSha: optionalTrimmedString(value.mergeCommitSha),
    pullRequestUrl: optionalTrimmedString(value.pullRequestUrl),
    pullRequestNumber: optionalNumber(value.pullRequestNumber),
    mergeRequestUrl: optionalTrimmedString(value.mergeRequestUrl),
    mergeRequestIid: optionalNumber(value.mergeRequestIid),
    reviewStatus: normalizeSourceReleaseReviewStatus(value.reviewStatus),
    approvedAt: optionalTrimmedString(value.approvedAt),
    approvedBy: optionalTrimmedString(value.approvedBy),
    rejectedAt: optionalTrimmedString(value.rejectedAt),
    rejectedBy: optionalTrimmedString(value.rejectedBy),
    mergedAt: optionalTrimmedString(value.mergedAt),
    mergedBy: optionalTrimmedString(value.mergedBy),
    policyStatus: normalizeSourceReleasePolicyStatus(value.policyStatus),
    policyBlockers: Array.isArray(value.policyBlockers) ? value.policyBlockers.map(String) : undefined,
    policyEvaluatedAt: optionalTrimmedString(value.policyEvaluatedAt),
    autoMerge: value.autoMerge === true,
    postMergeDeployStatus: normalizeSourceReleasePostMergeDeployStatus(value.postMergeDeployStatus),
    postMergeDeployAt: optionalTrimmedString(value.postMergeDeployAt),
    postMergeDeployBy: optionalTrimmedString(value.postMergeDeployBy),
    tag: optionalTrimmedString(value.tag),
    deploymentConnectorId: optionalTrimmedString(value.deploymentConnectorId),
    deploymentId: optionalTrimmedString(value.deploymentId),
    deploymentUrl: optionalTrimmedString(value.deploymentUrl),
    deployStatusUrl: optionalTrimmedString(value.deployStatusUrl),
    healthUrl: optionalTrimmedString(value.healthUrl),
    readyUrl: optionalTrimmedString(value.readyUrl),
    executedAt: optionalTrimmedString(value.executedAt),
    executedBy: optionalTrimmedString(value.executedBy)
  };
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function normalizeSourceReleaseReviewStatus(value: unknown): SourceReleaseReviewStatus | undefined {
  const status = String(value ?? "").trim().toUpperCase();
  if (status === "NOT_REQUIRED" || status === "PENDING" || status === "APPROVED" || status === "REJECTED" || status === "MERGED") return status;
  return undefined;
}

function normalizeSourceReleasePolicyStatus(value: unknown): SourceReleasePolicyStatus | undefined {
  const status = String(value ?? "").trim().toUpperCase();
  if (status === "PASS" || status === "BLOCKED") return status;
  return undefined;
}

function normalizeSourceReleasePostMergeDeployStatus(value: unknown): SourceReleasePostMergeDeployStatus | undefined {
  const status = String(value ?? "").trim().toUpperCase();
  if (status === "NOT_REQUIRED" || status === "SUCCEEDED" || status === "FAILED" || status === "ROLLED_BACK") return status;
  return undefined;
}

function optionalTrimmedString(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function normalizeWorkspaceStatus(value: unknown): WorkspaceRecord["status"] {
  const status = String(value ?? "").trim().toUpperCase();
  if (status === "ACTIVE" || status === "BOUNDARY_DRAFT" || status === "SUSPENDED") return status;
  return "ACTIVE";
}

function normalizeTenantStatus(value: unknown): TenantRecord["status"] {
  const status = String(value ?? "").trim().toUpperCase();
  if (status === "ACTIVE" || status === "SUSPENDED") return status;
  return "ACTIVE";
}

function normalizeWorkspaceMemberRole(value: unknown, fallback: WorkspaceMemberRole): WorkspaceMemberRole {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === "owner" || role === "admin" || role === "developer" || role === "viewer") return role;
  return fallback;
}

function normalizeWorkspaceMemberStatus(value: unknown, fallback: WorkspaceRecord["members"][number]["status"]): WorkspaceRecord["members"][number]["status"] {
  const status = String(value ?? "").trim().toUpperCase();
  if (status === "ACTIVE" || status === "INVITED" || status === "SUSPENDED") return status;
  return fallback;
}

function normalizeWorkspaceQuotas(value: unknown): WorkspaceRecord["quotas"] {
  const source = isRecord(value) ? value : {};
  return {
    loops: clampPositiveInteger(source.loops, 120),
    projects: clampPositiveInteger(source.projects, 20),
    evidenceGb: clampPositiveInteger(source.evidenceGb, 100)
  };
}

function normalizeSecretKind(value: unknown): SecretKind {
  const kind = String(value ?? "").trim();
  if (kind === "github-app-private-key" || kind === "github-webhook-secret" || kind === "source-token" || kind === "deploy-token" || kind === "llm-key" || kind === "generic") return kind;
  return "generic";
}

function normalizeAuthRole(value: unknown, fallback: AuthRole): AuthRole {
  const role = String(value ?? "").trim();
  if (role === "viewer" || role === "operator" || role === "admin") return role;
  return fallback;
}

function normalizeUserStatus(value: unknown): UserRecord["status"] {
  return String(value ?? "").trim() === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
}

function canAccessWorkspace(auth: AuthContext, workspace: WorkspaceRecord, required: WorkspaceMemberRole): boolean {
  if (auth.platformAdmin) return true;
  if (workspace.tenantId !== auth.tenantId) return false;
  const member = workspace.members.find((item) => item.id === auth.actor && item.status === "ACTIVE");
  if (!member) return false;
  const rank: Record<WorkspaceMemberRole, number> = { viewer: 1, developer: 2, admin: 3, owner: 4 };
  return rank[member.role] >= rank[required];
}

function canAccessScopedResource(auth: AuthContext, tenantId: string, workspaceId: string): boolean {
  if (auth.platformAdmin) return true;
  return auth.tenantId === tenantId && auth.workspaceId === workspaceId;
}

function secretEncryptionKey(): Buffer {
  const material = process.env.EVOPILOT_SECRET_MASTER_KEY || "evopilot-debug-local-secret-master-key";
  return createHash("sha256").update(material).digest();
}

function encryptSecretValue(value: string): SecretRecord["encryption"] {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decryptSecretValue(secret: SecretRecord): string {
  const decipher = createDecipheriv("aes-256-gcm", secretEncryptionKey(), Buffer.from(secret.encryption.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.encryption.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.encryption.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function maskSecret(secret: SecretRecord): Omit<SecretRecord, "encryption"> & { secretRef: string; valueConfigured: boolean } {
  const { encryption, ...safe } = secret;
  return {
    ...safe,
    secretRef: secret.id,
    valueConfigured: Boolean(encryption?.ciphertext)
  };
}

function githubAppInstallationChecks(store: FileStore, tenantId: string, workspaceId: string, installation: Pick<GitHubAppInstallationRecord, "privateKeySecretRef" | "webhookSecretRef" | "repositories" | "permissions">): GitHubAppInstallationRecord["checks"] {
  const privateKey = installation.privateKeySecretRef ? store.readSecret(installation.privateKeySecretRef) : undefined;
  const webhookSecret = installation.webhookSecretRef ? store.readSecret(installation.webhookSecretRef) : undefined;
  const privateKeyReady = privateKey && privateKey.status === "ACTIVE" && privateKey.kind === "github-app-private-key" && privateKey.tenantId === tenantId && privateKey.workspaceId === workspaceId;
  const webhookSecretReady = webhookSecret && webhookSecret.status === "ACTIVE" && webhookSecret.kind === "github-webhook-secret" && webhookSecret.tenantId === tenantId && webhookSecret.workspaceId === workspaceId;
  return [
    {
      id: "private-key-secret-ref",
      status: privateKeyReady ? "PASS" : "FAIL",
      evidence: [installation.privateKeySecretRef ? `secretRef=${installation.privateKeySecretRef}` : "secretRef=missing"]
    },
    {
      id: "webhook-secret-ref",
      status: webhookSecretReady ? "PASS" : "FAIL",
      evidence: [installation.webhookSecretRef ? `secretRef=${installation.webhookSecretRef}` : "secretRef=missing"]
    },
    {
      id: "repository-selection",
      status: installation.repositories.length > 0 ? "PASS" : "FAIL",
      evidence: [`repositories=${installation.repositories.length}`]
    },
    {
      id: "least-privilege-permissions",
      status: Object.keys(installation.permissions).length > 0 ? "PASS" : "FAIL",
      evidence: Object.entries(installation.permissions).map(([key, value]) => `${key}=${value}`)
    }
  ];
}

function maskGitHubAppInstallation(installation: GitHubAppInstallationRecord): GitHubAppInstallationRecord {
  return installation;
}

function workspaceUsage(store: FileStore, workspace: WorkspaceRecord): {
  schema: "evopilot-workspace-usage/v1";
  tenantId: string;
  workspaceId: string;
  projects: { used: number; limit: number; remaining: number };
  loops: { used: number; limit: number; remaining: number };
  evidenceGb: { used: number; limit: number; remaining: number };
  evidence: string[];
  evaluatedAt: string;
} {
  const projectsUsed = store.listProjects().filter((project) => project.tenantId === workspace.tenantId && project.workspaceId === workspace.id).length;
  const workspaceLoops = store.listLoops().filter((loop) => loop.tenantId === workspace.tenantId && loop.workspaceId === workspace.id);
  const loopsUsed = workspaceLoops.length;
  const evidenceBytes = Buffer.byteLength(JSON.stringify(workspaceLoops.flatMap((loop) => loop.evidenceSets)), "utf8");
  const evidenceGbUsed = Number((evidenceBytes / (1024 * 1024 * 1024)).toFixed(6));
  return {
    schema: "evopilot-workspace-usage/v1",
    tenantId: workspace.tenantId,
    workspaceId: workspace.id,
    projects: {
      used: projectsUsed,
      limit: workspace.quotas.projects,
      remaining: Math.max(0, workspace.quotas.projects - projectsUsed)
    },
    loops: {
      used: loopsUsed,
      limit: workspace.quotas.loops,
      remaining: Math.max(0, workspace.quotas.loops - loopsUsed)
    },
    evidenceGb: {
      used: evidenceGbUsed,
      limit: workspace.quotas.evidenceGb,
      remaining: Math.max(0, Number((workspace.quotas.evidenceGb - evidenceGbUsed).toFixed(6)))
    },
    evidence: [
      `tenant=${workspace.tenantId}`,
      `workspace=${workspace.id}`,
      `projects=${projectsUsed}/${workspace.quotas.projects}`,
      `loops=${loopsUsed}/${workspace.quotas.loops}`,
      `evidenceGb=${evidenceGbUsed}/${workspace.quotas.evidenceGb}`
    ],
    evaluatedAt: new Date().toISOString()
  };
}

function readJsonDir<T>(dir: string): T[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as T);
}

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  const list = Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
  return list.length > 0 ? [...new Set(list)] : fallback;
}

function discoveryAffectedFilesForTarget(targetId: string, project: StoredProject): string[] {
  const repositoryHint = project.repository?.provider === "local-git" ? project.repository.root : project.repository?.gitUrl ?? sourceUrlFromRepository(project.repository);
  const base = repositoryHint ? [`repository:${repositoryHint}`] : [];
  if (targetId === "tenant-workspace-model") return [...base, "packages/server/src/index.ts", "packages/core/src/index.ts", "docs/architecture/loop-runtime.md", "docs/api.md"];
  if (targetId === "workspace-rbac-and-invitation") return [...base, "packages/server/src/index.ts", "docs/api.md", "docs/user-guide.md"];
  if (targetId === "github-app-onboarding" || targetId === "secret-vault-and-credential-boundary") return [...base, "packages/server/src/index.ts", "apps/dashboard/assets/app.js", "docs/api.md"];
  if (targetId === "project-workspace-ownership" || targetId === "tenant-aware-release-evidence") return [...base, "packages/server/src/index.ts", "apps/dashboard/assets/app.js", "docs/architecture/loop-runtime.md"];
  if (targetId === "quota-rate-limit-billing-foundation" || targetId === "worker-queue-and-postgres-store") return [...base, "packages/core/src/index.ts", "packages/server/src/index.ts", "docs/architecture/loop-runtime.md"];
  if (targetId === "multi-tenant-security-regression-suite") return [...base, "tests/functional/loop-runtime.test.mjs", "tests/smoke/server-and-dashboard.test.mjs", "docs/api.md"];
  if (targetId === "saas-production-observability") return [...base, "packages/server/src/index.ts", "docs/deployment.md", "docs/architecture/loop-runtime.md"];
  if (targetId === "saas-onboarding-dashboard") return [...base, "apps/dashboard/assets/app.js", "apps/dashboard/assets/styles.css", "docs/user-guide.md"];
  if (targetId === "saas-field-e2e-source-to-ga") return [...base, "tests/e2e/dashboard-product-flow.test.mjs", "evidence/production-soak", "docs/user-guide.md"];
  if (targetId === "saas-release-matrix" || targetId === "saas-ga-soak-active") return [...base, "scripts/release-matrix-project-loop.mjs", "scripts/loop-soak.mjs", "evidence/production-soak"];
  if (targetId === "saas-ga-release-decision" || targetId === "announce-saas-multi-tenant-ga-stable") return [...base, "packages/server/src/index.ts", "README.md", "templates/release-readiness-review.md"];
  if (targetId === "discovery-skill-runtime" || targetId === "loop-memory-inbox") return [...base, "packages/server/src/index.ts", "apps/dashboard/assets/app.js"];
  if (targetId === "per-finding-worktree-handoff" || targetId === "adversarial-evaluator-agent") return [...base, "packages/server/src/index.ts", "tests/functional/loop-runtime.test.mjs"];
  return [...base, "docs/architecture/loop-runtime.md", "docs/user-guide.md"];
}

function memoryInboxItemFromDiscoveryCandidate(candidate: DiscoverySkillCandidate): LoopMemoryInboxItem {
  const now = new Date().toISOString();
  return {
    schema: "evopilot-loop-memory-inbox-item/v1",
    id: `memory-${safeFileName(candidate.id)}`,
    projectId: candidate.projectId,
    type: "finding",
    title: candidate.title,
    body: candidate.acceptanceCriteria.join("\n"),
    status: "NEW",
    targetId: candidate.targetId,
    provenance: [`discoveryCandidate=${candidate.id}`, `source=${candidate.source}`],
    evidence: candidate.evidence,
    createdAt: now,
    updatedAt: now
  };
}

function normalizeRecurringCadence(value: unknown): RecurringLoopSchedule["cadence"] {
  const cadence = String(value ?? "manual").toLowerCase();
  if (cadence === "hourly" || cadence === "daily" || cadence === "weekly") return cadence;
  return "manual";
}

function nextRunAtForCadence(cadence: RecurringLoopSchedule["cadence"], nowIso: string): string {
  const now = Date.parse(nowIso);
  const deltaMs = cadence === "hourly" ? 60 * 60 * 1000 : cadence === "daily" ? 24 * 60 * 60 * 1000 : cadence === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 0;
  return new Date(now + deltaMs).toISOString();
}

function normalizeMemoryInboxStatus(value: unknown): LoopMemoryInboxItem["status"] {
  const status = String(value ?? "ACCEPTED").trim().toUpperCase();
  if (status === "NEW" || status === "ACCEPTED" || status === "MERGED" || status === "SNOOZED" || status === "REJECTED" || status === "CONVERTED") return status;
  return "ACCEPTED";
}

function sourceUrlFromRepository(repository?: ProjectRepositoryRegistration): string | undefined {
  if (!repository) return undefined;
  if (repository.gitUrl) return repository.gitUrl;
  if (repository.provider === "github" && repository.owner && repository.repo) return `https://github.com/${repository.owner}/${repository.repo}.git`;
  if (repository.provider === "gitlab" && repository.baseUrl && repository.projectId) return `${repository.baseUrl.replace(/\/+$/, "")}/${repository.projectId}.git`;
  return undefined;
}

function syntheticEvoPilotProject(): StoredProject {
  const now = new Date().toISOString();
  return {
    id: "evopilot",
    name: "EvoPilot",
    profileId: "evopilot",
    tenantId: DEFAULT_TENANT_ID,
    workspaceId: DEFAULT_WORKSPACE_ID,
    repository: {
      provider: "github",
      owner: "yeliang-wang",
      repo: "EvoPilot",
      gitUrl: "https://github.com/yeliang-wang/EvoPilot.git",
      defaultBranch: "main"
    },
    validation: {
      status: "VERIFIED",
      checkedAt: now,
      message: "Synthetic EvoPilot self-project used when no project has been registered yet."
    },
    createdAt: now,
    updatedAt: now
  };
}

function normalizeSandboxNetwork(value: unknown): LoopSandboxPolicy["network"] {
  const network = String(value ?? "restricted").toLowerCase();
  if (network === "disabled" || network === "enabled") return network;
  return "restricted";
}

function normalizeCredentialScope(value: unknown): LoopSandboxPolicy["credentialScope"] {
  const scope = String(value ?? "loop").toLowerCase();
  if (scope === "none" || scope === "project") return scope;
  return "loop";
}

function normalizeSandboxResourceLimits(value: unknown): LoopSandboxPolicy["resourceLimits"] {
  const record = isRecord(value) ? value : {};
  return {
    cpu: String(record.cpu ?? "1"),
    memoryMb: clampPositiveInteger(record.memoryMb ?? record.memoryMB, 2048),
    pids: clampPositiveInteger(record.pids, 256)
  };
}

function normalizeExecutorCoordinationPlan(graph: ExecutorGraph): ExecutorCoordinationPlan {
  const mode = normalizeLoopExecutorMode(graph.mode);
  return {
    mode,
    sharedContextKeys: ["loopId", "projectId", "objective", "evidence", "artifacts", "sourceClosure", "sandboxEnforcement"],
    nodes: graph.nodes.map((node) => ({
      nodeId: node.id,
      type: node.type,
      adapterId: typeof node.config.adapterId === "string" ? String(node.config.adapterId) : undefined,
      inputSchema: {
        loopId: "string",
        iteration: "number",
        context: "object",
        dependencies: "array"
      },
      outputSchema: {
        status: "SUCCEEDED|FAILED|WAITING_APPROVAL|SKIPPED",
        output: "object",
        evidence: "array",
        failureSignature: "string?"
      },
      dependsOn: graph.edges.filter((edge) => edge.to === node.id).map((edge) => `${edge.from}:${edge.type}${edge.condition ? `?${edge.condition}` : ""}`)
    }))
  };
}

function normalizeLoopExecutorMode(value: unknown): LoopExecutorMode {
  return String(value ?? "serial").toLowerCase() === "parallel" ? "parallel" : "serial";
}

function emptyLoopTraceSummary(loopId: string, now: string): LoopTraceSummary {
  return {
    id: `trace-${safeFileName(loopId)}`,
    loopId,
    status: "PENDING",
    currentIteration: 0,
    executorStepCount: 0,
    failedStepCount: 0,
    watchdog: {
      expiredLease: false,
      ageSeconds: 0
    },
    cost: {
      estimatedUsd: 0,
      totalTokens: 0
    },
    failureSignatures: [],
    updatedAt: now
  };
}

function buildLoopTraceSummary(loop: LoopRun): LoopTraceSummary {
  const steps = loop.iterations.flatMap((iteration) => iteration.executorSteps ?? []);
  const failureCounts = new Map<string, number>();
  for (const step of steps) {
    if (step.failureSignature) failureCounts.set(step.failureSignature, (failureCounts.get(step.failureSignature) ?? 0) + 1);
  }
  const totalTokens = steps.reduce((sum, step) => sum + Number(step.output.totalTokens ?? step.output.tokens ?? 0), 0);
  const costFromSteps = steps.reduce((sum, step) => sum + Number(step.output.costUsd ?? 0), 0);
  const ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(loop.createdAt)) / 1000));
  const leaseExpiry = loop.workerLease?.expiresAt ? Date.parse(loop.workerLease.expiresAt) : Number.NaN;
  return {
    id: `trace-${safeFileName(loop.id)}`,
    loopId: loop.id,
    status: loop.status,
    currentIteration: loop.currentIteration,
    executorStepCount: steps.length,
    failedStepCount: steps.filter((step) => step.status === "FAILED").length,
    workerLease: loop.workerLease,
    watchdog: {
      expiredLease: Number.isFinite(leaseExpiry) ? leaseExpiry < Date.now() : false,
      ageSeconds
    },
    cost: {
      estimatedUsd: Number(costFromSteps.toFixed(6)),
      totalTokens
    },
    failureSignatures: [...failureCounts.entries()].map(([signature, count]) => ({ signature, count })).sort((left, right) => right.count - left.count),
    updatedAt: loop.updatedAt
  };
}

function buildLoopSandboxBoundaryProof(loop: LoopRun): LoopSandboxBoundaryProof {
  const policy = loop.sandbox;
  const enforcement = evaluateLoopSandboxEnforcement(policy);
  const workspaceMount = `/workspace/${safeFileName(loop.id)}`;
  const dockerArgs = policy.runtime === "docker" ? [
    "docker",
    "run",
    "--rm",
    "--read-only",
    "--network",
    policy.network === "enabled" ? "bridge" : "none",
    "--cpus",
    policy.resourceLimits.cpu,
    "--memory",
    `${policy.resourceLimits.memoryMb}m`,
    "--pids-limit",
    String(policy.resourceLimits.pids),
    "--env",
    `EVOPILOT_CREDENTIAL_SCOPE=${policy.credentialScope}`,
    "--volume",
    `${workspaceMount}:/workspace:rw`,
    policy.image ?? "missing-image",
    "sh",
    "-lc",
    sandboxBoundaryProbeScript(policy)
  ] : undefined;
  const k8sManifest = policy.runtime === "k8s" ? sandboxK8sManifest(loop, policy) : undefined;
  const checks = sandboxBoundaryChecks(policy, enforcement);
  return {
    schema: "evopilot-loop-sandbox-boundary-proof/v1",
    loopId: loop.id,
    runtime: policy.runtime,
    status: enforcement.status,
    executableBoundary: {
      dockerArgs,
      k8sManifest,
      workspaceMount,
      networkMode: policy.network === "enabled" ? "egress-enabled" : "egress-blocked",
      credentialMode: policy.credentialScope,
      readOnlyRootFilesystem: policy.runtime !== "host",
      resourceLimits: policy.resourceLimits
    },
    checks,
    blocksNonHumanExecutors: enforcement.status === "FAILED",
    createdAt: new Date().toISOString()
  };
}

function sandboxBoundaryChecks(policy: LoopSandboxPolicy, enforcement: LoopSandboxEnforcement): LoopSandboxBoundaryProof["checks"] {
  return [{
    id: "runtime-boundary",
    status: enforcement.status === "ENFORCED" ? "PASS" : enforcement.status === "FAILED" ? "FAIL" : "WARN",
    evidence: enforcement.evidence
  }, {
    id: "network-boundary",
    status: policy.network === "enabled" ? "WARN" : "PASS",
    evidence: [`network=${policy.network}`, policy.network === "enabled" ? "egress allowed by policy" : "egress blocked or restricted by policy"]
  }, {
    id: "credential-boundary",
    status: policy.credentialScope === "project" ? "WARN" : "PASS",
    evidence: [`credentialScope=${policy.credentialScope}`, policy.credentialScope === "none" ? "no credentials mounted" : `credentials scoped to ${policy.credentialScope}`]
  }, {
    id: "path-boundary",
    status: policy.deniedPaths.length > 0 && policy.allowedPaths.length > 0 ? "PASS" : "FAIL",
    evidence: [`allowedPaths=${policy.allowedPaths.join(",")}`, `deniedPaths=${policy.deniedPaths.join(",")}`]
  }, {
    id: "resource-boundary",
    status: policy.resourceLimits.memoryMb > 0 && policy.resourceLimits.pids > 0 ? "PASS" : "FAIL",
    evidence: [`cpu=${policy.resourceLimits.cpu}`, `memoryMb=${policy.resourceLimits.memoryMb}`, `pids=${policy.resourceLimits.pids}`]
  }];
}

function sandboxBoundaryProbeScript(policy: LoopSandboxPolicy): string {
  return [
    "set -e",
    "test -d /workspace",
    policy.deniedPaths.map((item) => `test ! -e /workspace/${shellSafePath(item)}`).join(" && ") || "true",
    "echo evopilot-sandbox-boundary-ok"
  ].join("; ");
}

function sandboxK8sManifest(loop: LoopRun, policy: LoopSandboxPolicy): Record<string, unknown> {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: safeFileName(`evopilot-${loop.id}`),
      namespace: policy.namespace
    },
    spec: {
      template: {
        spec: {
          restartPolicy: "Never",
          containers: [{
            name: "executor",
            image: policy.image ?? "ghcr.io/all-hands-ai/runtime:0.59-nikolaik",
            command: ["sh", "-lc", sandboxBoundaryProbeScript(policy)],
            env: [{ name: "EVOPILOT_CREDENTIAL_SCOPE", value: policy.credentialScope }],
            securityContext: {
              readOnlyRootFilesystem: true,
              allowPrivilegeEscalation: false
            },
            resources: {
              limits: {
                cpu: policy.resourceLimits.cpu,
                memory: `${policy.resourceLimits.memoryMb}Mi`
              }
            }
          }]
        }
      }
    }
  };
}

function buildLoopCheckpoints(loop: LoopRun): LoopCheckpoint[] {
  return loop.iterations.map((iteration) => ({
    schema: "evopilot-loop-checkpoint/v1",
    id: `${safeFileName(loop.id)}-checkpoint-${iteration.index}`,
    loopId: loop.id,
    iterationIndex: iteration.index,
    iterationId: iteration.id,
    status: loop.status,
    decision: iteration.decision,
    contextSnapshot: {
      ...loop.context,
      ...(iteration.contextPatch ?? {}),
      checkpoint: {
        iteration: iteration.index,
        traceId: iteration.traceId,
        evidenceSetId: iteration.evidenceSetId
      }
    },
    contextPatch: iteration.contextPatch,
    evidenceSetId: iteration.evidenceSetId,
    executorOutputs: iteration.executorSteps.map((step) => ({
      nodeId: step.nodeId,
      status: step.status,
      output: step.output,
      failureSignature: step.failureSignature
    })),
    replayable: !["CANCELLED"].includes(loop.status),
    createdAt: iteration.completedAt ?? iteration.startedAt
  }));
}

function buildLoopReplayDiff(before: LoopRun, after: LoopRun, fromIteration: number, contextPatch: Record<string, unknown>): LoopReplayDiff {
  const previous = before.iterations.find((iteration) => iteration.index === fromIteration);
  const replayed = after.iterations.find((iteration) => iteration.index === fromIteration);
  const nodeIds = new Set([
    ...(previous?.executorSteps ?? []).map((step) => step.nodeId),
    ...(replayed?.executorSteps ?? []).map((step) => step.nodeId)
  ]);
  const executorOutputChanges = [...nodeIds].map((nodeId) => {
    const beforeStep = previous?.executorSteps.find((step) => step.nodeId === nodeId);
    const afterStep = replayed?.executorSteps.find((step) => step.nodeId === nodeId);
    const beforeOutput = beforeStep?.output;
    const afterOutput = afterStep?.output;
    const changed = beforeStep?.status !== afterStep?.status || stableJson(beforeOutput) !== stableJson(afterOutput);
    return {
      nodeId,
      beforeStatus: beforeStep?.status,
      afterStatus: afterStep?.status,
      beforeOutput,
      afterOutput,
      changed
    };
  });
  return {
    schema: "evopilot-loop-replay-diff/v1",
    loopId: before.id,
    fromIteration,
    previousIterationId: previous?.id,
    replayIterationId: replayed?.id,
    contextChangedKeys: Object.keys(contextPatch),
    executorOutputChanges,
    evidence: [
      `fromIteration=${fromIteration}`,
      `contextChangedKeys=${Object.keys(contextPatch).join(",") || "none"}`,
      `changedExecutorOutputs=${executorOutputChanges.filter((item) => item.changed).length}`
    ],
    createdAt: new Date().toISOString()
  };
}

function buildLoopTraceTree(loop: LoopRun, executorGraph?: ExecutorGraph): LoopTraceTree {
  const graph = executorGraph ?? defaultExecutorGraph();
  const nodes: LoopTraceTree["nodes"] = [{
    id: loop.id,
    type: "loop",
    label: loop.objective,
    status: loop.status,
    evidence: [`project=${loop.projectId}`, `source=${loop.source}`, `sourceClosure=${loop.sourceClosure.closureState}`]
  }];
  const edges: LoopTraceTree["edges"] = [];
  nodes.push({
    id: `${loop.id}:executor-graph`,
    parentId: loop.id,
    type: "executor-graph",
    label: graph.name,
    status: graph.validation.status,
    evidence: executorGraphEvidence(graph)
  });
  edges.push({ from: loop.id, to: `${loop.id}:executor-graph`, type: "guards" });
  for (const iteration of loop.iterations) {
    const iterationNodeId = iteration.id;
    nodes.push({
      id: iterationNodeId,
      parentId: loop.id,
      type: "iteration",
      label: `Iteration ${iteration.index}`,
      status: iteration.decision,
      evidence: [`traceId=${iteration.traceId}`, `evidenceSet=${iteration.evidenceSetId ?? "none"}`]
    });
    edges.push({ from: loop.id, to: iterationNodeId, type: "contains" });
    for (const step of iteration.executorSteps) {
      const stepNodeId = `${iteration.id}:${step.nodeId}`;
      nodes.push({
        id: stepNodeId,
        parentId: iterationNodeId,
        type: "executor-step",
        label: `${step.type}:${step.nodeId}`,
        status: step.status,
        costUsd: Number(step.output.costUsd ?? 0),
        tokens: Number(step.output.totalTokens ?? step.output.tokens ?? 0),
        evidence: step.evidence.slice(0, 12)
      });
      edges.push({ from: iterationNodeId, to: stepNodeId, type: "emits" });
      if (step.failureSignature) edges.push({ from: stepNodeId, to: `failure:${step.failureSignature}`, type: "fails-with" });
    }
    if (iteration.replayOfIterationId) edges.push({ from: iteration.replayOfIterationId, to: iterationNodeId, type: "replays" });
  }
  for (const checkpoint of buildLoopCheckpoints(loop)) {
    nodes.push({
      id: checkpoint.id,
      parentId: checkpoint.iterationId,
      type: "checkpoint",
      label: `Checkpoint ${checkpoint.iterationIndex}`,
      status: checkpoint.decision,
      evidence: [`replayable=${checkpoint.replayable}`, `executorOutputs=${checkpoint.executorOutputs.length}`]
    });
    edges.push({ from: checkpoint.iterationId, to: checkpoint.id, type: "contains" });
  }
  for (const failure of loop.trace.failureSignatures) {
    nodes.push({
      id: `failure:${failure.signature}`,
      parentId: loop.id,
      type: "failure-group",
      label: failure.signature,
      status: String(failure.count),
      evidence: [`count=${failure.count}`]
    });
  }
  if (loop.workerLease) {
    nodes.push({
      id: `${loop.id}:worker-lease`,
      parentId: loop.id,
      type: "worker-lease",
      label: loop.workerLease.workerId,
      status: loop.trace.watchdog.expiredLease ? "EXPIRED" : "ACTIVE",
      evidence: [`heartbeatAt=${loop.workerLease.heartbeatAt}`, `expiresAt=${loop.workerLease.expiresAt}`]
    });
    edges.push({ from: loop.id, to: `${loop.id}:worker-lease`, type: "guards" });
  }
  nodes.push({
    id: `${loop.id}:sandbox-proof`,
    parentId: loop.id,
    type: "sandbox-proof",
    label: `${loop.sandbox.runtime} sandbox`,
    status: loop.sandboxEnforcement.status,
    evidence: loop.sandboxEnforcement.evidence
  });
  edges.push({ from: loop.id, to: `${loop.id}:sandbox-proof`, type: "guards" });
  const replayDiffCount = loop.iterations.filter((iteration) => iteration.replayOfIterationId || iteration.contextPatch).length;
  return {
    schema: "evopilot-loop-trace-tree/v1",
    loopId: loop.id,
    root: {
      id: loop.id,
      label: loop.objective,
      status: loop.status
    },
    nodes,
    edges,
    summary: {
      checkpointCount: loop.iterations.length,
      eventCount: buildLoopStreamEvents(loop, graph).length,
      failureGroupCount: loop.trace.failureSignatures.length,
      replayDiffCount,
      sandboxProofStatus: loop.sandboxEnforcement.status
    },
    createdAt: new Date().toISOString()
  };
}

function buildLoopStreamEvents(loop: LoopRun, executorGraph?: ExecutorGraph): LoopStreamEvent[] {
  const events: LoopStreamEvent[] = [];
  const graph = executorGraph ?? defaultExecutorGraph();
  events.push({
    schema: "evopilot-loop-stream-event/v1",
    id: `${loop.id}:executor-graph`,
    loopId: loop.id,
    type: "executor-graph",
    timestamp: loop.createdAt,
    label: `Executor graph ${graph.id}`,
    payload: {
      graphId: graph.id,
      name: graph.name,
      mode: graph.mode,
      nodes: graph.nodes.map((node) => ({ id: node.id, type: node.type, name: node.name, visualRole: node.config.visualRole })),
      edges: graph.edges,
      validation: graph.validation,
      capabilities: graph.capabilities,
      evidence: executorGraphEvidence(graph)
    }
  });
  for (const event of loop.timeline) {
    events.push({
      schema: "evopilot-loop-stream-event/v1",
      id: event.id,
      loopId: loop.id,
      type: event.type === "WATCHDOG" ? "watchdog" : "timeline",
      timestamp: event.timestamp,
      label: event.message,
      payload: event.metadata ?? {}
    });
  }
  for (const iteration of loop.iterations) {
    for (const step of iteration.executorSteps) {
      events.push({
        schema: "evopilot-loop-stream-event/v1",
        id: `${iteration.id}:${step.nodeId}`,
        loopId: loop.id,
        type: "executor-step",
        timestamp: step.completedAt ?? step.startedAt,
        label: `${step.type}:${step.nodeId}:${step.status}`,
        payload: {
          iteration: iteration.index,
          status: step.status,
          failureSignature: step.failureSignature,
          costUsd: step.output.costUsd ?? 0,
          tokens: step.output.totalTokens ?? step.output.tokens ?? 0
        }
      });
    }
    if (iteration.replayOfIterationId || iteration.contextPatch) {
      events.push({
        schema: "evopilot-loop-stream-event/v1",
        id: `${iteration.id}:replay-diff`,
        loopId: loop.id,
        type: "replay-diff",
        timestamp: iteration.completedAt ?? iteration.startedAt,
        label: `Replay diff for iteration ${iteration.index}`,
        payload: {
          replayOfIterationId: iteration.replayOfIterationId,
          contextChangedKeys: Object.keys(iteration.contextPatch ?? {})
        }
      });
    }
  }
  for (const checkpoint of buildLoopCheckpoints(loop)) {
    events.push({
      schema: "evopilot-loop-stream-event/v1",
      id: checkpoint.id,
      loopId: loop.id,
      type: "checkpoint",
      timestamp: checkpoint.createdAt,
      label: `Checkpoint ${checkpoint.iterationIndex}`,
      payload: { checkpoint }
    });
  }
  if (loop.workerLease) {
    events.push({
      schema: "evopilot-loop-stream-event/v1",
      id: `${loop.id}:worker-lease`,
      loopId: loop.id,
      type: "worker-lease",
      timestamp: loop.workerLease.heartbeatAt,
      label: `Worker lease ${loop.workerLease.workerId}`,
      payload: { workerLease: loop.workerLease }
    });
  }
  events.push({
    schema: "evopilot-loop-stream-event/v1",
    id: `${loop.id}:cost`,
    loopId: loop.id,
    type: "cost",
    timestamp: loop.trace.updatedAt,
    label: "Loop cost summary",
    payload: loop.trace.cost
  });
  for (const failure of loop.trace.failureSignatures) {
    events.push({
      schema: "evopilot-loop-stream-event/v1",
      id: `${loop.id}:failure:${safeFileName(failure.signature)}`,
      loopId: loop.id,
      type: "failure-group",
      timestamp: loop.trace.updatedAt,
      label: failure.signature,
      payload: failure
    });
  }
  events.push({
    schema: "evopilot-loop-stream-event/v1",
    id: `${loop.id}:sandbox-proof`,
    loopId: loop.id,
    type: "sandbox-proof",
    timestamp: loop.updatedAt,
    label: `Sandbox proof ${loop.sandboxEnforcement.status}`,
    payload: { proof: buildLoopSandboxBoundaryProof(loop) }
  });
  return events.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function loopWorkerQueueItem(loop: LoopRun, now: Date): LoopWorkerQueueItem {
  const leaseExpiry = loop.workerLease?.expiresAt ? Date.parse(loop.workerLease.expiresAt) : Number.NaN;
  const leaseExpired = Number.isFinite(leaseExpiry) ? leaseExpiry < now.getTime() : false;
  const duplicateSourceClosureBlocked = loop.sourceClosure.closureState !== "PLANNED" && loop.sourceClosure.closureState !== "FAILED";
  const waitingApproval = loop.status === "WAITING_APPROVAL";
  const terminal = ["FAILED", "CANCELLED"].includes(loop.status) || (loop.status === "SUCCEEDED" && loop.sourceClosure.closureState === "PROMOTED");
  const claimable = !terminal && !waitingApproval && (loop.status === "PENDING" || loop.status === "BLOCKED" || !loop.workerLease || leaseExpired);
  return {
    loopId: loop.id,
    status: loop.status,
    objective: loop.objective,
    currentIteration: loop.currentIteration,
    maxIterations: loop.stopPolicy.maxIterations,
    claimable,
    leaseExpired,
    workerLease: loop.workerLease,
    sideEffectGuard: {
      sourceClosureState: loop.sourceClosure.closureState,
      duplicateSourceClosureBlocked
    },
    nextAction: waitingApproval
      ? "wait-approval"
      : loop.status === "SUCCEEDED" && loop.sourceClosure.closureState !== "PROMOTED"
        ? "source-closure"
        : claimable
          ? "claim"
          : loop.workerLease
            ? "renew"
            : "blocked"
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(isRecord(value) ? value : {}).sort());
}

function shellSafePath(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9._/-]/g, "");
}

function hydrateLoopIteration(iteration: any): LoopIteration {
  return {
    ...iteration,
    executorSteps: Array.isArray(iteration.executorSteps) ? iteration.executorSteps : [],
    decision: normalizeLoopDecision(iteration.decision) ?? "CONTINUE",
    rationale: String(iteration.rationale ?? "Legacy iteration hydrated by EvoPilot."),
    traceId: String(iteration.traceId ?? `trace-${safeFileName(String(iteration.loopRunId ?? "loop"))}-${iteration.index ?? 0}`)
  } as LoopIteration;
}

function clampPositiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function normalizeExecutorGraph(value: any): ExecutorGraph {
  if (!isRecord(value)) throw httpError(400, "EXECUTOR_GRAPH_INVALID", "Executor graph must be an object.");
  const now = new Date().toISOString();
  const id = safeFileName(String(value.id ?? `executor-graph-${Date.now()}`));
  const nodes = Array.isArray(value.nodes) ? value.nodes.map(normalizeExecutorNode) : [];
  if (nodes.length === 0) throw httpError(400, "EXECUTOR_GRAPH_NODES_REQUIRED", "Executor graph requires at least one node.");
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(value.edges) ? value.edges : [])
    .map((edge: any) => normalizeExecutorEdge(edge))
    .filter((edge: ExecutorEdge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const validation = validateExecutorGraph({ nodes, edges, mode: normalizeLoopExecutorMode(value.mode) });
  return {
    schema: "evopilot-executor-graph/v1",
    id,
    name: String(value.name ?? id),
    nodes,
    edges,
    mode: normalizeLoopExecutorMode(value.mode),
    validation,
    capabilities: executorGraphCapabilities(nodes, edges),
    createdAt: String(value.createdAt ?? now),
    updatedAt: now
  };
}

function normalizeExecutorEdge(value: any): ExecutorEdge {
  const edge = isRecord(value) ? value : {};
  const type = normalizeExecutorEdgeType(edge.type);
  return {
    from: safeFileName(String(edge.from ?? "")),
    to: safeFileName(String(edge.to ?? "")),
    type,
    condition: optionalTrimmedString(edge.condition),
    inputSchemaRef: optionalTrimmedString(edge.inputSchemaRef),
    outputSchemaRef: optionalTrimmedString(edge.outputSchemaRef)
  };
}

function normalizeExecutorEdgeType(value: unknown): ExecutorEdge["type"] {
  const type = String(value ?? "sequence").trim();
  if (type === "conditional" || type === "fan-out" || type === "fan-in") return type;
  return "sequence";
}

function validateExecutorGraph(graph: { nodes: ExecutorNode[]; edges: ExecutorEdge[]; mode: LoopExecutorMode }): ExecutorGraph["validation"] {
  const evidence: string[] = [];
  const nodeIds = graph.nodes.map((node) => node.id);
  const duplicateIds = nodeIds.filter((id, index) => nodeIds.indexOf(id) !== index);
  if (duplicateIds.length > 0) evidence.push(`duplicateNodeIds=${[...new Set(duplicateIds)].join(",")}`);
  else evidence.push("nodeIds=unique");
  const danglingEdges = graph.edges.filter((edge) => !nodeIds.includes(edge.from) || !nodeIds.includes(edge.to));
  if (danglingEdges.length > 0) evidence.push(`danglingEdges=${danglingEdges.map((edge) => `${edge.from}->${edge.to}`).join(",")}`);
  else evidence.push("edges=valid");
  const untypedEdges = graph.edges.filter((edge) => !edge.type);
  if (untypedEdges.length > 0) evidence.push(`untypedEdges=${untypedEdges.length}`);
  else evidence.push("edges=typed");
  const schemaEdges = graph.edges.filter((edge) => edge.inputSchemaRef || edge.outputSchemaRef);
  evidence.push(`schemaEdges=${schemaEdges.length}/${graph.edges.length}`);
  const conditionalEdges = graph.edges.filter((edge) => edge.type === "conditional");
  const conditionalWithoutExpression = conditionalEdges.filter((edge) => !edge.condition);
  if (conditionalWithoutExpression.length > 0) evidence.push(`conditionalEdgesMissingCondition=${conditionalWithoutExpression.length}`);
  else evidence.push("conditionalRouting=validated");
  const fanOut = graph.edges.some((edge) => edge.type === "fan-out");
  const fanIn = graph.edges.some((edge) => edge.type === "fan-in");
  evidence.push(`fanOut=${fanOut}`, `fanIn=${fanIn}`, `mode=${graph.mode}`);
  const failed = duplicateIds.length > 0 || danglingEdges.length > 0 || conditionalWithoutExpression.length > 0;
  return {
    status: failed ? "FAILED" : "PASSED",
    evidence
  };
}

function executorGraphCapabilities(nodes: ExecutorNode[], edges: ExecutorEdge[]): ExecutorGraph["capabilities"] {
  return {
    typedEdges: edges.every((edge) => Boolean(edge.type)),
    conditionalRouting: edges.some((edge) => edge.type === "conditional"),
    fanOutFanIn: edges.some((edge) => edge.type === "fan-out") || edges.some((edge) => edge.type === "fan-in"),
    nestedSubgraphs: nodes.some((node) => Boolean((node.config as Record<string, unknown>).subgraphId)),
    schemaValidation: edges.some((edge) => Boolean(edge.inputSchemaRef || edge.outputSchemaRef)) || nodes.some((node) => Boolean(node.config.inputSchema || node.config.outputSchema))
  };
}

function executorGraphEvidence(graph: ExecutorGraph): string[] {
  return [
    `executorGraph=${graph.id}`,
    `graphMode=${graph.mode}`,
    `graphNodes=${graph.nodes.length}`,
    `graphEdges=${graph.edges.length}`,
    `graphValidation=${graph.validation.status}`,
    `typedEdges=${graph.capabilities.typedEdges}`,
    `conditionalRouting=${graph.capabilities.conditionalRouting}`,
    `fanOutFanIn=${graph.capabilities.fanOutFanIn}`,
    `nestedSubgraphs=${graph.capabilities.nestedSubgraphs}`,
    `schemaValidation=${graph.capabilities.schemaValidation}`,
    ...graph.validation.evidence.map((item) => `graph.${item}`)
  ];
}

function normalizeLoopArtifact(value: unknown): LoopArtifact {
  const item = isRecord(value) ? value : {};
  return loopArtifact(
    normalizeLoopArtifactType(item.type),
    String(item.label ?? "Loop artifact"),
    item.path ? String(item.path) : undefined,
    item.url ? String(item.url) : undefined
  );
}

function normalizeLoopArtifactType(value: unknown): LoopArtifact["type"] {
  const type = String(value ?? "generic");
  if (["plan", "diff", "ci-log", "report", "approval", "generic"].includes(type)) return type as LoopArtifact["type"];
  return "generic";
}

function normalizeExecutorNode(value: any): ExecutorNode {
  if (!isRecord(value)) throw httpError(400, "EXECUTOR_NODE_INVALID", "Executor graph node must be an object.");
  const type = normalizeExecutorNodeType(value.type);
  const id = safeFileName(String(value.id ?? `${type}-${Date.now()}`));
  return {
    id,
    type,
    name: String(value.name ?? id),
    config: isRecord(value.config) ? value.config : {}
  };
}

function normalizeExecutorNodeType(value: unknown): ExecutorNodeType {
  const type = String(value ?? "");
  if (["llm", "code-upgrader", "ci", "validator", "approval", "release-action"].includes(type)) return type as ExecutorNodeType;
  throw httpError(400, "EXECUTOR_NODE_TYPE_INVALID", `Unsupported executor node type: ${type}`);
}

function normalizeLoopTriggerSource(value: unknown): LoopTriggerSource {
  const source = String(value ?? "api");
  if (["api", "im", "schedule", "runtime-signal", "release-target", "evolution-batch"].includes(source)) return source as LoopTriggerSource;
  return "api";
}

function normalizeLoopDecision(value: unknown): LoopDecision | undefined {
  const decision = String(value ?? "").toUpperCase();
  if (["CONTINUE", "REPAIR", "BLOCK", "WAIT_APPROVAL", "SUCCEED", "FAIL"].includes(decision)) return decision as LoopDecision;
  return undefined;
}

class ExecutorAdapterRegistry {
  private readonly adaptersById = new Map<string, ExecutorAdapter>();
  private readonly adaptersByType = new Map<ExecutorNodeType, ExecutorAdapter>();

  constructor(adapters: ExecutorAdapter[]) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: ExecutorAdapter): void {
    this.adaptersById.set(adapter.id, adapter);
    this.adaptersByType.set(adapter.nodeType, adapter);
  }

  resolve(node: ExecutorNode): ExecutorAdapter {
    const configuredAdapterId = typeof node.config.adapterId === "string" ? node.config.adapterId.trim() : "";
    if (configuredAdapterId) {
      const adapter = this.adaptersById.get(configuredAdapterId);
      if (!adapter) throw new Error(`EXECUTOR_ADAPTER_NOT_FOUND:${configuredAdapterId}`);
      if (adapter.nodeType !== node.type) throw new Error(`EXECUTOR_ADAPTER_TYPE_MISMATCH:${configuredAdapterId}:${node.type}`);
      return adapter;
    }
    const adapter = this.adaptersByType.get(node.type);
    if (!adapter) throw new Error(`EXECUTOR_ADAPTER_TYPE_NOT_REGISTERED:${node.type}`);
    return adapter;
  }
}

function createExecutorAdapterRegistry(): ExecutorAdapterRegistry {
  return new ExecutorAdapterRegistry([
    createLlmContextExecutorAdapter("evopilot.llm-context-adapter"),
    createPolicyAwareExecutorAdapter("evopilot.code-upgrader-adapter", "code-upgrader"),
    createPolicyAwareExecutorAdapter("evopilot.ci-adapter", "ci"),
    createPolicyAwareExecutorAdapter("evopilot.validator-adapter", "validator"),
    createPolicyAwareExecutorAdapter("evopilot.approval-adapter", "approval"),
    createPolicyAwareExecutorAdapter("evopilot.release-action-adapter", "release-action")
  ]);
}

function createLlmContextExecutorAdapter(id: string): ExecutorAdapter {
  return {
    id,
    nodeType: "llm",
    async execute(input) {
      const policyResult = policyBlockedExecutorResult(id, "llm", input);
      if (policyResult) return policyResult;
      if (!input.llmClient) {
        if (input.requireLlm) {
          return failedExecutorResult(id, "llm", input, "LLM_REQUIRED_FOR_LOOP_EXECUTOR", "LLM provider is not configured for loop executor.");
        }
        return policyAwareExecutorSuccess(id, "llm", input, {
          result: "llm skipped because no provider is configured in debug mode",
          executionMode: "debug-no-provider"
        }, ["llm.executionMode=debug-no-provider"]);
      }
      const started = Date.parse(input.now);
      const response = await input.llmClient.generate({
        caller: "evopilot-loop-runtime",
        intent: "plan.generation",
        outputContract: "markdown_document",
        latencyClass: "batch",
        complexity: "high",
        outputSize: "large",
        metadata: {
          productFlow: "loop-executor",
          loopId: input.loop.id,
          nodeId: input.node.id,
          projectId: input.loop.projectId,
          executorGraphId: input.loop.executorGraphId,
          sourceProjectId: input.loop.sourceClosure.sourceProjectId,
          sourceProvider: input.loop.sourceClosure.repositoryProvider
        },
        prompt: loopLlmExecutorPrompt(input)
      });
      const totalTokens = Number(response.usage?.totalTokens ?? 0);
      const costUsd = estimateLlmCostUsd(totalTokens);
      const commonOutput = {
        workspacePath: input.nodeWorkspace,
        executorBoundary: executorBoundaryLabel(input.node.type),
        adapterId: id,
        coordinationMode: input.coordination.mode,
        sandboxRuntime: input.sandbox.runtime,
        credentialScope: input.sandbox.credentialScope,
        network: input.sandbox.network,
        sandboxEnforcement: input.sandboxEnforcement.status,
        sourceClosure: input.loop.sourceClosure,
        provider: response.provider,
        model: response.model,
        totalTokens,
        tokens: totalTokens,
        costUsd,
        durationMs: response.durationMs,
        resolvedIntent: response.resolvedIntent,
        resolvedProfile: response.resolvedProfile,
        llmRequestId: response.requestId,
        finishReason: response.finishReason,
        truncated: response.truncated === true
      };
      if (!response.success) {
        return {
          status: "FAILED",
          completedAt: new Date(started + Math.max(1, response.durationMs ?? 1)).toISOString(),
          output: {
            ...commonOutput,
            reason: response.errorMessage ?? response.errorCode ?? "LLM executor failed",
            errorCode: response.errorCode,
            errorMessage: response.errorMessage
          },
          evidence: [
            ...executorAdapterEvidence(id, "llm", input),
            "llm.executionMode=provider",
            `llm.provider=${response.provider ?? "unknown"}`,
            `llm.model=${response.model ?? "unknown"}`,
            `llm.totalTokens=${totalTokens}`,
            `llm.costUsd=${costUsd}`,
            `llm.success=false`,
            `status=FAILED`
          ],
          failureSignature: `llm:${response.errorCode ?? "provider-failed"}`
        };
      }
      return {
        status: "SUCCEEDED",
        completedAt: new Date(started + Math.max(1, response.durationMs ?? 1)).toISOString(),
        output: {
          ...commonOutput,
          result: "llm provider completed",
          planMarkdown: response.text,
          usage: response.usage
        },
        evidence: [
          ...executorAdapterEvidence(id, "llm", input),
          "llm.executionMode=provider",
          `llm.provider=${response.provider ?? "unknown"}`,
          `llm.model=${response.model ?? "unknown"}`,
          `llm.totalTokens=${totalTokens}`,
          `llm.costUsd=${costUsd}`,
          `llm.success=true`,
          `status=SUCCEEDED`
        ]
      };
    }
  };
}

function policyBlockedExecutorResult(id: string, nodeType: ExecutorNodeType, input: ExecutorAdapterExecutionInput): ExecutorAdapterExecutionOutput | undefined {
  const blockedByCircuit = input.previousFailureCount >= input.loop.retryPolicy.circuitBreakerFailures && input.node.type !== "approval";
  const blockedBySandbox = input.sandboxEnforcement.status === "FAILED" && input.node.type !== "approval";
  const forcedFailure = input.forceDecision === "FAIL" || input.forceDecision === "BLOCK" || input.forceDecision === "REPAIR";
  const waitingApproval = input.node.type === "approval" && input.loop.stopPolicy.requireApprovalForRelease && input.iterationIndex >= input.loop.stopPolicy.maxIterations;
  if (waitingApproval) {
    return {
      status: "WAITING_APPROVAL",
      output: executorOutputBase(id, input, {
        reason: "approval gate reached"
      }),
      evidence: [...executorAdapterEvidence(id, nodeType, input), "status=WAITING_APPROVAL"]
    };
  }
  if (!blockedByCircuit && !blockedBySandbox && !forcedFailure) return undefined;
  return failedExecutorResult(
    id,
    nodeType,
    input,
    blockedBySandbox ? "SANDBOX_ENFORCEMENT_FAILED" : "LOOP_POLICY_BLOCKED",
    blockedBySandbox ? "sandbox enforcement failed" : "loop policy blocked execution",
    blockedBySandbox ? `${input.node.type}:sandbox-enforcement-failed` : `${input.node.type}:policy-or-forced-failure`
  );
}

function failedExecutorResult(
  id: string,
  nodeType: ExecutorNodeType,
  input: ExecutorAdapterExecutionInput,
  errorCode: string,
  reason: string,
  failureSignature = `${input.node.type}:${errorCode.toLowerCase()}`
): ExecutorAdapterExecutionOutput {
  return {
    status: "FAILED",
    completedAt: new Date(Date.parse(input.now) + 1).toISOString(),
    output: executorOutputBase(id, input, { reason, errorCode }),
    evidence: [...executorAdapterEvidence(id, nodeType, input), `errorCode=${errorCode}`, "status=FAILED"],
    failureSignature
  };
}

function policyAwareExecutorSuccess(
  id: string,
  nodeType: ExecutorNodeType,
  input: ExecutorAdapterExecutionInput,
  extraOutput: Record<string, unknown> = {},
  extraEvidence: string[] = []
): ExecutorAdapterExecutionOutput {
  return {
    status: "SUCCEEDED",
    completedAt: new Date(Date.parse(input.now) + 1).toISOString(),
    output: executorOutputBase(id, input, {
      result: `${input.node.type} completed`,
      ...extraOutput
    }),
    evidence: [...executorAdapterEvidence(id, nodeType, input), ...extraEvidence, "status=SUCCEEDED"]
  };
}

function executorOutputBase(id: string, input: ExecutorAdapterExecutionInput, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...extra,
    workspacePath: input.nodeWorkspace,
    executorBoundary: executorBoundaryLabel(input.node.type),
    adapterId: id,
    coordinationMode: input.coordination.mode,
    sandboxRuntime: input.sandbox.runtime,
    credentialScope: input.sandbox.credentialScope,
    network: input.sandbox.network,
    sandboxEnforcement: input.sandboxEnforcement.status,
    sourceClosure: input.loop.sourceClosure
  };
}

function executorAdapterEvidence(id: string, nodeType: ExecutorNodeType, input: ExecutorAdapterExecutionInput): string[] {
  return [
    `adapter=${id}`,
    `adapterNodeType=${nodeType}`,
    `executorBoundary=${executorBoundaryLabel(input.node.type)}`,
    `coordinationMode=${input.coordination.mode}`,
    `sandboxRuntime=${input.sandbox.runtime}`,
    `sandboxNetwork=${input.sandbox.network}`,
    `sandboxEnforcement=${input.sandboxEnforcement.status}`,
    `credentialScope=${input.sandbox.credentialScope}`,
    `sourceProjectId=${input.loop.sourceClosure.sourceProjectId}`,
    `sourceProvider=${input.loop.sourceClosure.repositoryProvider}`,
    `sourceRef=${input.loop.sourceClosure.sourceUrl ?? input.loop.sourceClosure.sourceRoot ?? "unknown"}`,
    `sourceBranch=${input.loop.sourceClosure.sourceBranch}`,
    `releaseStrategy=${input.loop.sourceClosure.releaseStrategy}`,
    `requiredGates=${input.loop.sourceClosure.requiredGates.join(",")}`,
    `targetVersion=${input.loop.sourceClosure.targetVersion ?? "unspecified"}`,
    `deploymentEnvironment=${input.loop.sourceClosure.deploymentEnvironment ?? "production"}`
  ];
}

function createPolicyAwareExecutorAdapter(id: string, nodeType: ExecutorNodeType): ExecutorAdapter {
  return {
    id,
    nodeType,
    execute(input) {
      return policyBlockedExecutorResult(id, nodeType, input) ?? policyAwareExecutorSuccess(id, nodeType, input);
    }
  };
}

function loopLlmExecutorPrompt(input: ExecutorAdapterExecutionInput): string {
  return [
    "# EvoPilot Loop Executor Plan",
    "",
    "You are the real LLM executor for an EvoPilot production loop. Produce a concise Markdown plan that can be audited by the control plane.",
    "",
    "## Loop",
    `- loopId: ${input.loop.id}`,
    `- projectId: ${input.loop.projectId}`,
    `- objective: ${input.loop.objective}`,
    `- currentIteration: ${input.iterationIndex}`,
    `- executorGraphId: ${input.loop.executorGraphId}`,
    "",
    "## Source Closure",
    `- sourceProjectId: ${input.loop.sourceClosure.sourceProjectId}`,
    `- provider: ${input.loop.sourceClosure.repositoryProvider}`,
    `- sourceRef: ${input.loop.sourceClosure.sourceUrl ?? input.loop.sourceClosure.sourceRoot ?? "unknown"}`,
    `- branch: ${input.loop.sourceClosure.sourceBranch}`,
    `- targetVersion: ${input.loop.sourceClosure.targetVersion ?? "unspecified"}`,
    `- requiredGates: ${input.loop.sourceClosure.requiredGates.join(", ")}`,
    `- releaseStrategy: ${input.loop.sourceClosure.releaseStrategy}`,
    "",
    "## Runtime Boundary",
    `- sandboxRuntime: ${input.sandbox.runtime}`,
    `- sandboxNetwork: ${input.sandbox.network}`,
    `- credentialScope: ${input.sandbox.credentialScope}`,
    `- sandboxEnforcement: ${input.sandboxEnforcement.status}`,
    "",
    "## Required Output",
    "- Current code/product facts implied by the loop context.",
    "- Execution plan for this iteration.",
    "- Expected code, validation, release, and evidence gates.",
    "- Risks, blockers, and required human approval points.",
    "- Keep it actionable and specific; do not claim that code was changed unless a downstream executor actually changes it.",
    "",
    "## Context",
    JSON.stringify(input.loop.context ?? {}, null, 2)
  ].join("\n");
}

function estimateLlmCostUsd(totalTokens: number): number {
  const pricePerThousand = Number(process.env.EVOPILOT_LLM_COST_PER_1K_TOKENS_USD ?? "0");
  if (!Number.isFinite(pricePerThousand) || pricePerThousand <= 0 || totalTokens <= 0) return 0;
  return Number(((totalTokens / 1000) * pricePerThousand).toFixed(6));
}

async function executeLoopNode(args: {
  node: ExecutorNode;
  loop: LoopRun;
  iterationIndex: number;
  attempt: number;
  previousFailureCount: number;
  forceDecision?: LoopDecision;
  workspaceRoot: string;
  coordination: ExecutorCoordinationPlan;
  sandbox: LoopSandboxPolicy;
  sandboxEnforcement: LoopSandboxEnforcement;
  now: string;
  llmClient?: LlmTaskClient;
  requireLlm: boolean;
}): Promise<ExecutorStepResult> {
  const workspacePath = path.join(args.workspaceRoot, safeFileName(args.node.id));
  fs.mkdirSync(workspacePath, { recursive: true });
  const nodeCoordination = args.coordination.nodes.find((node) => node.nodeId === args.node.id);
  const baseEvidence = [
    `node=${args.node.id}`,
    `type=${args.node.type}`,
    `attempt=${args.attempt}`,
    `objective=${args.loop.objective}`,
    `executorGraph=${args.loop.executorGraphId}`,
    `coordinationMode=${args.coordination.mode}`,
    `workspace=${workspacePath}`,
    `dependsOn=${nodeCoordination?.dependsOn.join(",") ?? ""}`,
    `inputSchema=${JSON.stringify(nodeCoordination?.inputSchema ?? {})}`,
    `outputSchema=${JSON.stringify(nodeCoordination?.outputSchema ?? {})}`,
    `allowedPaths=${args.sandbox.allowedPaths.join(",")}`,
    `deniedPaths=${args.sandbox.deniedPaths.join(",")}`
  ];
  const adapter = createExecutorAdapterRegistry().resolve(args.node);
  const adapterResult = await adapter.execute({
    node: args.node,
    loop: args.loop,
    iterationIndex: args.iterationIndex,
    attempt: args.attempt,
    previousFailureCount: args.previousFailureCount,
    forceDecision: args.forceDecision,
    workspaceRoot: args.workspaceRoot,
    nodeWorkspace: workspacePath,
    coordination: args.coordination,
    sandbox: args.sandbox,
    sandboxEnforcement: args.sandboxEnforcement,
    now: args.now,
    llmClient: args.llmClient,
    requireLlm: args.requireLlm
  });
  return {
    nodeId: args.node.id,
    type: args.node.type,
    status: adapterResult.status,
    startedAt: args.now,
    completedAt: adapterResult.completedAt,
    attempt: args.attempt,
    input: {
      loopId: args.loop.id,
      iteration: args.iterationIndex,
      adapterId: adapter.id,
      nodeConfig: args.node.config,
      schema: nodeCoordination?.inputSchema,
      dependsOn: nodeCoordination?.dependsOn ?? [],
      sharedContextKeys: args.coordination.sharedContextKeys,
      sandbox: args.sandbox,
      sandboxEnforcement: args.sandboxEnforcement,
      sourceClosure: args.loop.sourceClosure
    },
    output: adapterResult.output,
    evidence: [...baseEvidence, ...adapterResult.evidence],
    failureSignature: adapterResult.failureSignature
  };
}

async function executeLoopSourceClosure(store: FileStore, loopId: string, actor: string, body: unknown): Promise<{ loop: LoopRun; releaseRun: SourceReleaseClosureRun } | undefined> {
  const loop = store.readLoop(loopId);
  if (!loop) return undefined;
  const project = store.readProject(loop.sourceClosure.sourceProjectId) ?? store.readProject(loop.projectId);
  const request = isRecord(body) ? body : {};
  const now = new Date().toISOString();
  const files = normalizeSourceClosureFiles(request.files);
  const branch = optionalTrimmedString(request.branchName) ?? optionalTrimmedString(request.branch) ?? defaultClosureBranch(loop);
  const commitMessage = optionalTrimmedString(request.commitMessage) ?? `EvoPilot source closure for ${loop.id}`;
  const tagName = optionalTrimmedString(request.tagName) ?? (loop.sourceClosure.targetVersion ? `v${loop.sourceClosure.targetVersion.replace(/^v/, "")}` : undefined);
  const deployConnectorId = optionalTrimmedString(request.deployConnectorId) ?? optionalTrimmedString(request.deploymentConnectorId) ?? loop.sourceClosure.deploymentConnectorId;
  let deploymentUrl = optionalTrimmedString(request.deploymentUrl) ?? loop.sourceClosure.controlPlaneUrl;
  let healthUrl = optionalTrimmedString(request.healthUrl) ?? (deploymentUrl ? `${deploymentUrl.replace(/\/+$/, "")}/health` : undefined);
  let readyUrl = optionalTrimmedString(request.readyUrl) ?? (deploymentUrl ? `${deploymentUrl.replace(/\/+$/, "")}/ready` : undefined);
  const gateEvidence: LoopSourceClosure["gateEvidence"] = { ...loop.sourceClosure.gateEvidence };
  const artifacts: LoopSourceClosure["artifacts"] = {
    ...loop.sourceClosure.artifacts,
    branch,
    deploymentConnectorId: deployConnectorId,
    deploymentUrl,
    healthUrl,
    readyUrl,
    executedAt: now,
    executedBy: actor
  };
  let closureState: LoopSourceClosureState = "PLANNED";
  const evidence: string[] = [
    `sourceClosure.provider=${loop.sourceClosure.repositoryProvider}`,
    `sourceClosure.branch=${loop.sourceClosure.sourceBranch}`,
    `sourceClosure.releaseBranch=${branch}`,
    ...(optionalTrimmedString(request.repairOfReleaseRunId) ? [`sourceClosure.repairOfReleaseRunId=${optionalTrimmedString(request.repairOfReleaseRunId)}`] : [])
  ];
  let releaseRun = store.writeSourceReleaseClosureRun(buildSourceReleaseClosureRun({
    ...loop,
    sourceClosure: normalizeLoopSourceClosure({
      ...loop.sourceClosure,
      deploymentConnectorId: deployConnectorId,
      gateEvidence,
      artifacts
    }, project, loop.controlPlaneUrl)
  }, actor));

  try {
    if (loop.sourceClosure.repositoryProvider === "github") {
      if (!project?.repository || project.repository.provider !== "github") throw httpError(409, "SOURCE_CLOSURE_PROJECT_NOT_GITHUB", "Loop source project is not a GitHub repository.");
      const token = repositoryToken(project.repository);
      if (!token) throw httpError(409, "SOURCE_CLOSURE_TOKEN_REQUIRED", "GitHub source closure requires a project token or tokenRef.");
      if (!project.repository.owner || !project.repository.repo) throw httpError(409, "SOURCE_CLOSURE_GITHUB_COORDINATES_REQUIRED", "GitHub source closure requires owner and repo.");
      const adapter = new GitHubHttpAdapter({
        apiBaseUrl: project.repository.baseUrl,
        owner: project.repository.owner,
        repo: project.repository.repo,
        token
      });
      const baseRef = await adapter.getRef(`heads/${loop.sourceClosure.sourceBranch}`);
      await ignoreAlreadyExists(() => adapter.createBranch(branch, baseRef.sha));
      artifacts.commitSha = baseRef.sha;
      markGate(gateEvidence, "push", "PASSED", [`branch=${branch}`, `baseSha=${baseRef.sha}`], now);
      evidence.push(`github.branch=${branch}`, `github.baseSha=${baseRef.sha}`);
      for (const file of files) {
        const written = await adapter.upsertFile({ ...file, branch, message: commitMessage });
        artifacts.commitSha = written.commitSha || artifacts.commitSha;
        if (written.htmlUrl) evidence.push(`github.fileUrl=${written.htmlUrl}`);
      }
      if (files.length > 0) {
        closureState = "CODE_CHANGED";
        markGate(gateEvidence, "code-change", "PASSED", files.map((file) => `file=${file.path}`), now);
      }
      if (request.createReviewRequest !== false) {
        const prDraft = {
          title: optionalTrimmedString(request.pullRequestTitle) ?? `EvoPilot source closure: ${loop.objective}`,
          body: optionalTrimmedString(request.pullRequestBody) ?? `Loop ${loop.id} source-to-production closure evidence.`,
          head: branch,
          base: loop.sourceClosure.sourceBranch
        };
        const pr = await createOrReuseGitHubPullRequest(adapter, prDraft);
        artifacts.pullRequestUrl = pr.htmlUrl;
        artifacts.pullRequestNumber = pr.number;
        artifacts.reviewStatus = "PENDING";
        evidence.push(
          `github.pullRequest=${pr.htmlUrl ?? pr.number}`,
          ...(pr.reused ? ["github.pullRequestReused=true", ...(pr.evidence ?? [])] : [])
        );
      } else {
        artifacts.reviewStatus = "NOT_REQUIRED";
      }
      if (tagName && loop.sourceClosure.requiredGates.includes("tag")) {
        await ignoreAlreadyExists(() => adapter.createTag(tagName, artifacts.commitSha ?? baseRef.sha));
        artifacts.tag = tagName;
        closureState = "TAGGED";
        markGate(gateEvidence, "tag", "PASSED", [`tag=${tagName}`, `target=${artifacts.commitSha ?? baseRef.sha}`], now);
      }
    } else if (loop.sourceClosure.repositoryProvider === "gitlab") {
      if (!project?.repository || project.repository.provider !== "gitlab") throw httpError(409, "SOURCE_CLOSURE_PROJECT_NOT_GITLAB", "Loop source project is not a GitLab repository.");
      const token = repositoryToken(project.repository);
      if (!token) throw httpError(409, "SOURCE_CLOSURE_TOKEN_REQUIRED", "GitLab source closure requires a project token or tokenRef.");
      if (!project.repository.baseUrl || !project.repository.projectId) throw httpError(409, "SOURCE_CLOSURE_GITLAB_COORDINATES_REQUIRED", "GitLab source closure requires baseUrl and projectId.");
      const adapter = new GitLabHttpAdapter({
        baseUrl: project.repository.baseUrl,
        projectId: project.repository.projectId,
        token
      });
      await ignoreAlreadyExists(() => adapter.createBranch(branch, loop.sourceClosure.sourceBranch));
      markGate(gateEvidence, "push", "PASSED", [`branch=${branch}`, `base=${loop.sourceClosure.sourceBranch}`], now);
      evidence.push(`gitlab.branch=${branch}`);
      if (files.length > 0) {
        const commit = await adapter.commitFiles({
          branch,
          message: commitMessage,
          actions: files.map((file) => ({ action: "create", filePath: file.path, content: file.content }))
        });
        artifacts.commitSha = commit.id;
        closureState = "CODE_CHANGED";
        markGate(gateEvidence, "code-change", "PASSED", files.map((file) => `file=${file.path}`), now);
        evidence.push(`gitlab.commit=${commit.webUrl ?? commit.id}`);
      }
      if (request.createReviewRequest !== false) {
        const mr = await adapter.createMergeRequest({
          title: optionalTrimmedString(request.mergeRequestTitle) ?? `EvoPilot source closure: ${loop.objective}`,
          description: optionalTrimmedString(request.mergeRequestDescription) ?? `Loop ${loop.id} source-to-production closure evidence.`,
          sourceBranch: branch,
          targetBranch: loop.sourceClosure.sourceBranch
        });
        artifacts.mergeRequestUrl = mr.webUrl;
        artifacts.mergeRequestIid = mr.iid;
        artifacts.reviewStatus = "PENDING";
        evidence.push(`gitlab.mergeRequest=${mr.webUrl ?? mr.iid}`);
      } else {
        artifacts.reviewStatus = "NOT_REQUIRED";
      }
      if (tagName && loop.sourceClosure.requiredGates.includes("tag")) {
        const tag = await ignoreAlreadyExists(() => adapter.createTag(tagName, branch, `EvoPilot closure tag for ${loop.id}`));
        artifacts.tag = tagName;
        closureState = "TAGGED";
        markGate(gateEvidence, "tag", "PASSED", [`tag=${tagName}`, `target=${tag?.target ?? branch}`], now);
      }
    } else if (loop.sourceClosure.repositoryProvider === "local-git") {
      if (!project?.repository || project.repository.provider !== "local-git") throw httpError(409, "SOURCE_CLOSURE_PROJECT_NOT_LOCAL_GIT", "Loop source project is not a local Git repository.");
      const localResult = await executeLocalGitSourceClosure(project.repository, {
        loop,
        files,
        branch,
        commitMessage,
        tagName,
        allowDirtyWorktree: request.allowDirtyWorktree === true
      });
      artifacts.branch = branch;
      artifacts.commitSha = localResult.commitSha;
      artifacts.pullRequestUrl = localResult.reviewUrl;
      artifacts.reviewStatus = request.createReviewRequest === false ? "NOT_REQUIRED" : "PENDING";
      markGate(gateEvidence, "push", "PASSED", localResult.branchEvidence, now);
      evidence.push(...localResult.evidence);
      if (files.length > 0) {
        closureState = "CODE_CHANGED";
        markGate(gateEvidence, "code-change", "PASSED", files.map((file) => `file=${file.path}`), now);
      }
      if (tagName && loop.sourceClosure.requiredGates.includes("tag")) {
        artifacts.tag = tagName;
        closureState = "TAGGED";
        markGate(gateEvidence, "tag", "PASSED", [`tag=${tagName}`, `target=${localResult.commitSha}`], now);
      }
    } else {
      throw httpError(409, "SOURCE_CLOSURE_PROVIDER_UNSUPPORTED", "Automatic source closure supports GitHub, GitLab, and local-git repositories.");
    }

    if (loop.sourceClosure.requiredGates.includes("deploy")) {
      if (deployConnectorId) {
        const deployResult = await executeDeployConnector(store, deployConnectorId, {
          loop,
          actor,
          artifacts,
          parameters: isRecord(request.deployParameters) ? request.deployParameters : {}
        });
        artifacts.deploymentConnectorId = deployConnectorId;
        artifacts.deploymentId = deployResult.deploymentId;
        artifacts.deploymentUrl = deployResult.deploymentUrl ?? artifacts.deploymentUrl;
        artifacts.deployStatusUrl = deployResult.statusUrl;
        artifacts.healthUrl = deployResult.healthUrl ?? artifacts.healthUrl;
        artifacts.readyUrl = deployResult.readyUrl ?? artifacts.readyUrl;
        deploymentUrl = artifacts.deploymentUrl;
        healthUrl = artifacts.healthUrl;
        readyUrl = artifacts.readyUrl;
        markGate(gateEvidence, "deploy", deployResult.status === "SUCCEEDED" ? "PASSED" : "FAILED", deployResult.evidence, new Date().toISOString());
        closureState = deployResult.status === "SUCCEEDED" ? "DEPLOYED" : "FAILED";
      } else if (deploymentUrl) {
        markGate(gateEvidence, "deploy", "PASSED", [`deploymentUrl=${deploymentUrl}`, "deployConnector=not-configured"], now);
        closureState = closureState === "TAGGED" ? "DEPLOYED" : closureState;
      } else {
        markGate(gateEvidence, "deploy", "PENDING", ["deploymentUrl missing"], now);
      }
    }
    if (loop.sourceClosure.requiredGates.includes("health-ready")) {
      if (gateEvidence.deploy?.status === "FAILED") {
        markGate(gateEvidence, "health-ready", "SKIPPED", ["deploy gate failed"], new Date().toISOString());
        closureState = "FAILED";
      } else {
        const checks = await probeHealthReady(healthUrl, readyUrl);
        if (checks.passed) {
          markGate(gateEvidence, "health-ready", "PASSED", checks.evidence, new Date().toISOString());
          closureState = "HEALTH_READY";
        } else {
          let rollbackEvidence: string[] = [];
          let rollbackSucceeded = false;
          if (deployConnectorId) {
            const rollbackResult = await rollbackDeployConnector(store, deployConnectorId, {
              loop,
              actor,
              artifacts,
              parameters: isRecord(request.deployParameters) ? request.deployParameters : {},
              reason: "health-ready failed",
              healthEvidence: checks.evidence
            });
            rollbackEvidence = rollbackResult.evidence;
            rollbackSucceeded = rollbackResult.status === "SUCCEEDED";
          }
          markGate(gateEvidence, "health-ready", "FAILED", [...checks.evidence, ...rollbackEvidence], new Date().toISOString());
          closureState = rollbackSucceeded ? "ROLLED_BACK" : "HEALTH_FAILED";
        }
      }
    }
    if (requiredSourceClosureGatesPassed(loop.sourceClosure.requiredGates, gateEvidence)) {
      closureState = "PROMOTED";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markGate(gateEvidence, nextPendingGate(loop.sourceClosure.requiredGates, gateEvidence), "FAILED", [message], new Date().toISOString());
    closureState = "FAILED";
    evidence.push(`sourceClosure.error=${message}`);
  }

  const updatedClosure = normalizeLoopSourceClosure({
    ...loop.sourceClosure,
    deploymentConnectorId: deployConnectorId,
    closureState,
    gateEvidence,
    artifacts
  }, project, loop.controlPlaneUrl);
  const updatedLoop = store.writeLoop({
    ...loop,
    sourceClosure: updatedClosure,
    evidenceSets: [
      ...loop.evidenceSets,
      {
        id: `${loop.id}-source-closure-${Date.now()}`,
        loopRunId: loop.id,
        iterationId: loop.iterations.at(-1)?.id ?? `${loop.id}-source-closure`,
        validator: "evopilot-source-closure",
        status: sourceClosureEvidenceStatus(closureState),
        evidence: [
          ...evidence,
          ...Object.entries(updatedClosure.gateEvidence).flatMap(([gate, row]) => [
            `sourceClosure.gate.${gate}=${row?.status ?? "PENDING"}`,
            ...(row?.evidence ?? [])
          ])
        ],
        artifacts: [],
        createdAt: new Date().toISOString()
      }
    ],
    timeline: [
      ...loop.timeline,
      loopTimelineEvent("EVIDENCE", `Source closure executed with state ${closureState}.`, {
        provider: updatedClosure.repositoryProvider,
        branch: updatedClosure.artifacts.branch,
        commitSha: updatedClosure.artifacts.commitSha,
        tag: updatedClosure.artifacts.tag
      })
    ],
    updatedAt: new Date().toISOString()
  });
  releaseRun = store.writeSourceReleaseClosureRun(buildSourceReleaseClosureRun(updatedLoop, actor, releaseRun.id, releaseRun.createdAt));
  return { loop: updatedLoop, releaseRun };
}

async function applySourceClosureReviewDecision(store: FileStore, loopId: string, actor: string, body: unknown): Promise<{ loop: LoopRun; releaseRun: SourceReleaseClosureRun; action: string } | undefined> {
  const loop = store.readLoop(loopId);
  if (!loop) return undefined;
  const project = store.readProject(loop.sourceClosure.sourceProjectId) ?? store.readProject(loop.projectId);
  const request = isRecord(body) ? body : {};
  const action = String(request.action ?? "approve").trim().toLowerCase();
  if (action !== "approve" && action !== "reject" && action !== "merge" && action !== "auto-merge") throw httpError(400, "SOURCE_CLOSURE_REVIEW_ACTION_INVALID", "action must be approve, reject, merge, or auto-merge.");
  const now = new Date().toISOString();
  const artifacts: LoopSourceClosure["artifacts"] = { ...loop.sourceClosure.artifacts };
  const evidence: string[] = [
    `sourceClosure.reviewAction=${action}`,
    `sourceClosure.provider=${loop.sourceClosure.repositoryProvider}`
  ];

  if (action === "approve" || action === "auto-merge") {
    artifacts.reviewStatus = "APPROVED";
    artifacts.approvedAt = now;
    artifacts.approvedBy = actor;
    evidence.push(`approvedBy=${actor}`);
  }
  if (action === "reject") {
    artifacts.reviewStatus = "REJECTED";
    artifacts.rejectedAt = now;
    artifacts.rejectedBy = actor;
    evidence.push(`rejectedBy=${actor}`);
  }
  if (action === "merge" || action === "auto-merge") {
    if (artifacts.reviewStatus !== "APPROVED" && request.force !== true) {
      throw httpError(409, "SOURCE_CLOSURE_REVIEW_NOT_APPROVED", "Release review must be approved before merge unless force=true.");
    }
    artifacts.autoMerge = action === "auto-merge" || request.autoMerge === true;
    const policy = evaluateSourceReleasePolicy(loop, artifacts, {
      autoMerge: artifacts.autoMerge === true,
      forcePolicy: request.forcePolicy === true
    });
    artifacts.policyStatus = policy.status;
    artifacts.policyBlockers = policy.blockers;
    artifacts.policyEvaluatedAt = policy.evaluatedAt;
    evidence.push(...policy.checks.flatMap((check) => [`policy.${check.id}=${check.status}`, ...check.evidence]));
    if (policy.status === "BLOCKED" && request.forcePolicy !== true) {
      const blockedClosure = normalizeLoopSourceClosure({
        ...loop.sourceClosure,
        artifacts
      }, project, loop.controlPlaneUrl);
      const blockedLoop = store.writeLoop({
        ...loop,
        sourceClosure: blockedClosure,
        evidenceSets: [
          ...loop.evidenceSets,
          {
            id: `${loop.id}-source-policy-${Date.now()}`,
            loopRunId: loop.id,
            iterationId: loop.iterations.at(-1)?.id ?? `${loop.id}-source-policy`,
            validator: "evopilot-source-release-policy",
            status: "FAIL",
            evidence: [`policyStatus=BLOCKED`, ...policy.blockers.map((blocker) => `policyBlocker=${blocker}`), ...evidence],
            artifacts: [],
            createdAt: now
          }
        ],
        timeline: [
          ...loop.timeline,
          loopTimelineEvent("DECISION", "Source release policy blocked merge.", {
            provider: blockedClosure.repositoryProvider,
            policyStatus: "BLOCKED",
            blockers: policy.blockers
          })
        ],
        updatedAt: now
      });
      const latestRun = store.listSourceReleaseClosureRuns(loop.id).at(-1);
      store.writeSourceReleaseClosureRun(buildSourceReleaseClosureRun(blockedLoop, actor, latestRun?.id, latestRun?.createdAt));
      throw httpError(409, "SOURCE_CLOSURE_RELEASE_POLICY_BLOCKED", `Release policy blocked merge: ${policy.blockers.join("; ")}`);
    }
    const merge = await mergeSourceClosureReview(project, loop, artifacts, actor, optionalTrimmedString(request.commitMessage));
    artifacts.reviewStatus = "MERGED";
    artifacts.mergedAt = now;
    artifacts.mergedBy = actor;
    artifacts.mergeCommitSha = merge.mergeCommitSha;
    evidence.push(...merge.evidence);
    if (request.postMergeDeploy !== false) {
      const latestRun = store.listSourceReleaseClosureRuns(loop.id).at(-1);
      const postMergeDeploy = await executePostMergeDeployment(store, loop, project, artifacts, actor, request, latestRun?.id);
      artifacts.postMergeDeployStatus = postMergeDeploy.status;
      artifacts.postMergeDeployAt = postMergeDeploy.deployedAt;
      artifacts.postMergeDeployBy = actor;
      evidence.push(...postMergeDeploy.evidence);
    }
  }

  const updatedClosure = normalizeLoopSourceClosure({
    ...loop.sourceClosure,
    artifacts
  }, project, loop.controlPlaneUrl);
  const updatedLoop = store.writeLoop({
    ...loop,
    sourceClosure: updatedClosure,
    evidenceSets: [
      ...loop.evidenceSets,
      {
        id: `${loop.id}-source-review-${Date.now()}`,
        loopRunId: loop.id,
        iterationId: loop.iterations.at(-1)?.id ?? `${loop.id}-source-review`,
        validator: "evopilot-source-release-review",
        status: action === "reject" ? "FAIL" : "PASS",
        evidence,
        artifacts: [],
        createdAt: now
      }
    ],
    timeline: [
      ...loop.timeline,
      loopTimelineEvent(action === "reject" ? "DECISION" : "EVIDENCE", `Source release review ${action} recorded.`, {
        provider: updatedClosure.repositoryProvider,
        reviewStatus: updatedClosure.artifacts.reviewStatus,
        mergeCommitSha: updatedClosure.artifacts.mergeCommitSha
      })
    ],
    updatedAt: now
  });
  const latestRun = store.listSourceReleaseClosureRuns(loop.id).at(-1);
  const releaseRun = store.writeSourceReleaseClosureRun(buildSourceReleaseClosureRun(updatedLoop, actor, latestRun?.id, latestRun?.createdAt));
  return { loop: updatedLoop, releaseRun, action };
}

async function repairSourceReleaseRun(store: FileStore, loopId: string, releaseRunId: string, actor: string, body: unknown): Promise<{ loop: LoopRun; releaseRun: SourceReleaseClosureRun; originalReleaseRun: SourceReleaseClosureRun; action: "repair-and-execute" | "repair-intent" } | undefined> {
  const loop = store.readLoop(loopId);
  const originalReleaseRun = store.readSourceReleaseClosureRun(releaseRunId);
  if (!loop || !originalReleaseRun || originalReleaseRun.loopId !== loopId) return undefined;
  const request = isRecord(body) ? body : {};
  const now = new Date().toISOString();
  const project = store.readProject(loop.sourceClosure.sourceProjectId) ?? store.readProject(loop.projectId);
  const gateEvidence: LoopSourceClosure["gateEvidence"] = { ...loop.sourceClosure.gateEvidence };
  for (const gate of loop.sourceClosure.requiredGates) {
    if (gateEvidence[gate]?.status === "FAILED") {
      markGate(gateEvidence, gate, "PENDING", [
        `sourceReleaseRepair=queued`,
        `originalReleaseRunId=${releaseRunId}`,
        ...(gateEvidence[gate]?.evidence ?? []).slice(-2)
      ], now);
    }
  }
  const artifacts: LoopSourceClosure["artifacts"] = {
    ...loop.sourceClosure.artifacts,
    policyStatus: undefined,
    policyBlockers: undefined,
    policyEvaluatedAt: undefined,
    postMergeDeployStatus: undefined
  };
  const repairedClosure = normalizeLoopSourceClosure({
    ...loop.sourceClosure,
    closureState: "PLANNED",
    gateEvidence,
    artifacts
  }, project, loop.controlPlaneUrl);
  const repairedLoop = store.writeLoop({
    ...loop,
    sourceClosure: repairedClosure,
    evidenceSets: [
      ...loop.evidenceSets,
      {
        id: `${loop.id}-source-release-repair-${Date.now()}`,
        loopRunId: loop.id,
        iterationId: loop.iterations.at(-1)?.id ?? `${loop.id}-source-release-repair`,
        validator: "evopilot-source-release-repair",
        status: "PASS",
        evidence: [
          "sourceReleaseRepair=QUEUED",
          `originalReleaseRunId=${releaseRunId}`,
          `originalStatus=${originalReleaseRun.status}`,
          `executeSourceClosure=${request.executeSourceClosure !== false}`
        ],
        artifacts: [],
        createdAt: now
      }
    ],
    timeline: [
      ...loop.timeline,
      loopTimelineEvent("DECISION", "Source release run repair queued.", {
        originalReleaseRunId: releaseRunId,
        originalStatus: originalReleaseRun.status
      })
    ],
    updatedAt: now
  });
  if (request.executeSourceClosure === false) {
    const releaseRun = store.writeSourceReleaseClosureRun(buildSourceReleaseClosureRun(repairedLoop, actor));
    return { loop: repairedLoop, releaseRun, originalReleaseRun, action: "repair-intent" };
  }
  const execution = await executeLoopSourceClosure(store, loopId, actor, {
    ...request,
    repairOfReleaseRunId: releaseRunId,
    files: Array.isArray(request.files) ? request.files : []
  });
  if (!execution) return undefined;
  return { loop: execution.loop, releaseRun: execution.releaseRun, originalReleaseRun, action: "repair-and-execute" };
}

function discoverSourceReleaseRunRepairCandidates(store: FileStore, options: { includeRepaired?: boolean } = {}): SourceReleaseRunRepairCandidate[] {
  const runs = store.listSourceReleaseClosureRuns();
  const latestRunByLoop = new Map<string, SourceReleaseClosureRun>();
  for (const run of runs) latestRunByLoop.set(run.loopId, run);
  const repairedRunIds = discoverRepairedSourceReleaseRunIds(store);
  const nowMs = Date.now();
  return runs
    .filter((run) => REPAIRABLE_SOURCE_RELEASE_RUN_STATUSES.includes(run.status))
    .map((run) => {
      const latestRun = latestRunByLoop.get(run.loopId);
      const repaired = repairedRunIds.has(run.id);
      const failedStages = run.stages
        .filter((stage) => stage.status === "FAILED")
        .map((stage) => `${stage.gate}:${stage.evidence.at(-1) ?? "failed"}`);
      const blockers = [
        ...(run.policy?.blockers ?? []).map((blocker) => `policy:${blocker}`),
        ...(run.postMergeDeployment?.status === "FAILED" || run.postMergeDeployment?.status === "ROLLED_BACK"
          ? [`post-merge-deploy:${run.postMergeDeployment.evidence.at(-1) ?? run.postMergeDeployment.status}`]
          : [])
      ];
      return {
        schema: "evopilot-source-release-repair-candidate/v1",
        id: `source-release-repair-candidate-${safeFileName(run.id)}`,
        loopId: run.loopId,
        runId: run.id,
        projectId: run.projectId,
        sourceProjectId: run.sourceProjectId,
        provider: run.provider,
        status: run.status,
        reason: failedStages[0] ?? blockers[0] ?? `source release run status ${run.status}`,
        suggestedAction: repaired ? "inspect-existing-repair" : "repair-source-closure",
        latestForLoop: latestRun?.id === run.id,
        repaired,
        supersededByRunId: latestRun && latestRun.id !== run.id ? latestRun.id : undefined,
        ageSeconds: Math.max(0, Math.floor((nowMs - Date.parse(run.createdAt)) / 1000)),
        evidence: [...failedStages, ...blockers].slice(0, 6),
        createdAt: run.createdAt
      } satisfies SourceReleaseRunRepairCandidate;
    })
    .filter((candidate) => options.includeRepaired || !candidate.repaired)
    .sort((left, right) => Number(right.latestForLoop) - Number(left.latestForLoop) || Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

function discoverRepairedSourceReleaseRunIds(store: FileStore): Set<string> {
  const repaired = new Set<string>();
  for (const loop of store.listLoops()) {
    for (const set of loop.evidenceSets ?? []) {
      for (const item of set.evidence ?? []) {
        const text = String(item);
        for (const prefix of ["originalReleaseRunId=", "sourceClosure.repairOfReleaseRunId="]) {
          if (text.startsWith(prefix)) repaired.add(text.slice(prefix.length));
        }
      }
    }
  }
  return repaired;
}

async function repairSourceReleaseRunCandidates(store: FileStore, actor: string, body: unknown): Promise<SourceReleaseRunRepairQueueResult> {
  const request = isRecord(body) ? body : {};
  const requestedRunIds = Array.isArray(request.runIds) ? request.runIds.map((id) => String(id).trim()).filter(Boolean) : [];
  const includeRepaired = request.includeRepaired === true;
  const candidates = discoverSourceReleaseRunRepairCandidates(store, { includeRepaired });
  const selected = requestedRunIds.length > 0
    ? requestedRunIds.map((runId) => candidates.find((candidate) => candidate.runId === runId) ?? buildSkippedRepairCandidate(store, runId))
    : candidates;
  const limit = Math.max(1, Math.min(25, Number(request.limit ?? selected.length) || selected.length));
  const result: SourceReleaseRunRepairQueueResult = {
    schema: "evopilot-source-release-repair-queue/v1",
    repaired: [],
    failed: [],
    skipped: []
  };
  for (const candidate of selected.slice(0, limit)) {
    if (!candidate) continue;
    if (candidate.repaired && !includeRepaired) {
      result.skipped.push({ runId: candidate.runId, loopId: candidate.loopId, reason: "already repaired" });
      continue;
    }
    if (candidate.suggestedAction !== "repair-source-closure") {
      result.skipped.push({ runId: candidate.runId, loopId: candidate.loopId, reason: candidate.suggestedAction });
      continue;
    }
    try {
      const loop = store.readLoop(candidate.loopId);
      const version = loop?.sourceClosure.targetVersion;
      const repair = await repairSourceReleaseRun(store, candidate.loopId, candidate.runId, actor, {
        ...request,
        files: Array.isArray(request.files) ? request.files : [{
          path: `docs/evopilot-source-closures/${candidate.loopId}-auto-repair.md`,
          content: [
            `# EvoPilot Source Release Auto Repair: ${candidate.loopId}`,
            "",
            `Original release run: ${candidate.runId}`,
            `Original status: ${candidate.status}`,
            `Reason: ${candidate.reason}`,
            `Target version: ${version ?? "unspecified"}`,
            `Generated at: ${new Date().toISOString()}`,
            "",
            "This file records Dashboard or API queued source release run repair evidence."
          ].join("\n")
        }]
      });
      if (!repair) {
        result.failed.push({ runId: candidate.runId, loopId: candidate.loopId, error: "SOURCE_RELEASE_RUN_NOT_FOUND" });
        continue;
      }
      result.repaired.push({
        runId: candidate.runId,
        loopId: candidate.loopId,
        status: repair.releaseRun.status,
        action: repair.action,
        repairedRunId: repair.releaseRun.id
      });
    } catch (error) {
      result.failed.push({ runId: candidate.runId, loopId: candidate.loopId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

function buildSkippedRepairCandidate(store: FileStore, runId: string): SourceReleaseRunRepairCandidate | undefined {
  const run = store.readSourceReleaseClosureRun(runId);
  if (!run) return undefined;
  return {
    schema: "evopilot-source-release-repair-candidate/v1",
    id: `source-release-repair-candidate-${safeFileName(run.id)}`,
    loopId: run.loopId,
    runId: run.id,
    projectId: run.projectId,
    sourceProjectId: run.sourceProjectId,
    provider: run.provider,
    status: run.status,
    reason: REPAIRABLE_SOURCE_RELEASE_RUN_STATUSES.includes(run.status) ? "not in active repair queue" : `status ${run.status} is not repairable`,
    suggestedAction: REPAIRABLE_SOURCE_RELEASE_RUN_STATUSES.includes(run.status) ? "repair-source-closure" : "inspect-existing-repair",
    latestForLoop: false,
    repaired: true,
    ageSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(run.createdAt)) / 1000)),
    evidence: [],
    createdAt: run.createdAt
  };
}

async function mergeSourceClosureReview(project: StoredProject | undefined, loop: LoopRun, artifacts: LoopSourceClosure["artifacts"], actor: string, commitMessage?: string): Promise<{ mergeCommitSha?: string; evidence: string[] }> {
  if (loop.sourceClosure.repositoryProvider === "github") {
    if (!project?.repository || project.repository.provider !== "github") throw httpError(409, "SOURCE_CLOSURE_PROJECT_NOT_GITHUB", "Loop source project is not a GitHub repository.");
    const token = repositoryToken(project.repository);
    if (!token) throw httpError(409, "SOURCE_CLOSURE_TOKEN_REQUIRED", "GitHub merge requires a project token or tokenRef.");
    if (!project.repository.owner || !project.repository.repo) throw httpError(409, "SOURCE_CLOSURE_GITHUB_COORDINATES_REQUIRED", "GitHub merge requires owner and repo.");
    if (!artifacts.pullRequestNumber) throw httpError(409, "SOURCE_CLOSURE_PULL_REQUEST_NUMBER_REQUIRED", "GitHub merge requires pullRequestNumber.");
    const adapter = new GitHubHttpAdapter({
      apiBaseUrl: project.repository.baseUrl,
      owner: project.repository.owner,
      repo: project.repository.repo,
      token
    });
    const result = await adapter.mergePullRequest(artifacts.pullRequestNumber, {
      commitTitle: commitMessage ?? `EvoPilot merge ${loop.id}`
    });
    return {
      mergeCommitSha: result.sha || artifacts.commitSha,
      evidence: [
        `github.pullRequestNumber=${artifacts.pullRequestNumber}`,
        `github.mergeCommitSha=${result.sha || (artifacts.commitSha ?? "")}`,
        `github.merged=${result.merged}`,
        `mergedBy=${actor}`
      ]
    };
  }
  if (loop.sourceClosure.repositoryProvider === "gitlab") {
    if (!project?.repository || project.repository.provider !== "gitlab") throw httpError(409, "SOURCE_CLOSURE_PROJECT_NOT_GITLAB", "Loop source project is not a GitLab repository.");
    const token = repositoryToken(project.repository);
    if (!token) throw httpError(409, "SOURCE_CLOSURE_TOKEN_REQUIRED", "GitLab merge requires a project token or tokenRef.");
    if (!project.repository.baseUrl || !project.repository.projectId) throw httpError(409, "SOURCE_CLOSURE_GITLAB_COORDINATES_REQUIRED", "GitLab merge requires baseUrl and projectId.");
    if (!artifacts.mergeRequestIid) throw httpError(409, "SOURCE_CLOSURE_MERGE_REQUEST_IID_REQUIRED", "GitLab merge requires mergeRequestIid.");
    const adapter = new GitLabHttpAdapter({
      baseUrl: project.repository.baseUrl,
      projectId: project.repository.projectId,
      token
    });
    const result = await adapter.mergeMergeRequest(artifacts.mergeRequestIid, {
      commitMessage: commitMessage ?? `EvoPilot merge ${loop.id}`
    });
    return {
      mergeCommitSha: result.mergeCommitSha || artifacts.commitSha,
      evidence: [
        `gitlab.mergeRequestIid=${artifacts.mergeRequestIid}`,
        `gitlab.mergeCommitSha=${result.mergeCommitSha || (artifacts.commitSha ?? "")}`,
        ...(result.webUrl ? [`gitlab.mergeRequest=${result.webUrl}`] : []),
        `mergedBy=${actor}`
      ]
    };
  }
  if (loop.sourceClosure.repositoryProvider === "local-git") {
    if (!project?.repository || project.repository.provider !== "local-git") throw httpError(409, "SOURCE_CLOSURE_PROJECT_NOT_LOCAL_GIT", "Loop source project is not a local Git repository.");
    return mergeLocalGitSourceClosure(project.repository, loop, artifacts, commitMessage ?? `EvoPilot merge ${loop.id}`, actor);
  }
  throw httpError(409, "SOURCE_CLOSURE_PROVIDER_UNSUPPORTED", "Review merge supports GitHub, GitLab, and local-git repositories.");
}

async function createOrReuseGitHubPullRequest(adapter: GitHubHttpAdapter, draft: GitHubPullRequestDraft): Promise<{ number: number; htmlUrl?: string; reused?: boolean; evidence?: string[] }> {
  try {
    return await adapter.createPullRequest(draft);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const existing = (await adapter.listPullRequests({ state: "open", head: draft.head, base: draft.base }))[0];
    if (!existing) throw error;
    return {
      number: existing.number,
      htmlUrl: existing.htmlUrl,
      reused: true,
      evidence: [
        `github.pullRequestCreateError=${message}`,
        `github.pullRequestHead=${draft.head}`,
        `github.pullRequestBase=${draft.base}`
      ]
    };
  }
}

function evaluateSourceReleasePolicy(loop: LoopRun, artifacts: LoopSourceClosure["artifacts"], options: {
  autoMerge: boolean;
  forcePolicy: boolean;
}): SourceReleaseClosureRun["policy"] & { evaluatedAt: string } {
  const closure = loop.sourceClosure;
  const evaluatedAt = new Date().toISOString();
  const checks: SourceReleaseClosureRun["policy"]["checks"] = [];
  const addCheck = (id: string, passed: boolean, evidence: string[], required = true) => {
    checks.push({ id, status: passed ? "PASS" : "FAIL", evidence, required });
  };
  const failedGates = closure.requiredGates.filter((gate) => closure.gateEvidence[gate]?.status === "FAILED");
  const unpassedGates = closure.requiredGates.filter((gate) => closure.gateEvidence[gate]?.status !== "PASSED");
  addCheck("required-gates", unpassedGates.length === 0, [
    `requiredGates=${closure.requiredGates.join(",") || "none"}`,
    `unpassedGates=${unpassedGates.join(",") || "none"}`
  ]);
  addCheck("no-failed-gates", failedGates.length === 0, [`failedGates=${failedGates.join(",") || "none"}`]);
  addCheck("closure-promoted", closure.closureState === "PROMOTED", [`closureState=${closure.closureState}`]);
  addCheck("review-approved", artifacts.reviewStatus === "APPROVED" || artifacts.reviewStatus === "MERGED" || artifacts.reviewStatus === "NOT_REQUIRED", [`reviewStatus=${artifacts.reviewStatus ?? "UNKNOWN"}`]);
  addCheck("source-commit", Boolean(artifacts.commitSha), [`commitSha=${artifacts.commitSha ?? "missing"}`]);
  if (closure.repositoryProvider === "github") {
    addCheck("github-review-artifact", Boolean(artifacts.pullRequestNumber || artifacts.pullRequestUrl), [
      `pullRequestNumber=${artifacts.pullRequestNumber ?? "missing"}`,
      `pullRequestUrl=${artifacts.pullRequestUrl ?? "missing"}`
    ]);
  }
  if (closure.repositoryProvider === "gitlab") {
    addCheck("gitlab-review-artifact", Boolean(artifacts.mergeRequestIid || artifacts.mergeRequestUrl), [
      `mergeRequestIid=${artifacts.mergeRequestIid ?? "missing"}`,
      `mergeRequestUrl=${artifacts.mergeRequestUrl ?? "missing"}`
    ]);
  }
  if (closure.requiredGates.includes("deploy")) {
    addCheck("deploy-ready", closure.gateEvidence.deploy?.status === "PASSED", [`deployStatus=${closure.gateEvidence.deploy?.status ?? "PENDING"}`]);
  }
  if (closure.requiredGates.includes("health-ready")) {
    addCheck("health-ready", closure.gateEvidence["health-ready"]?.status === "PASSED", [`healthReadyStatus=${closure.gateEvidence["health-ready"]?.status ?? "PENDING"}`]);
  }
  addCheck("force-policy", !options.forcePolicy, [`forcePolicy=${options.forcePolicy}`], false);
  const blockers = checks
    .filter((check) => check.required && check.status === "FAIL")
    .map((check) => `${check.id}:${check.evidence.join("|")}`);
  return {
    status: blockers.length === 0 ? "PASS" : "BLOCKED",
    evaluatedAt,
    autoMerge: options.autoMerge,
    blockers,
    checks
  };
}

async function executePostMergeDeployment(store: FileStore, loop: LoopRun, project: StoredProject | undefined, artifacts: LoopSourceClosure["artifacts"], actor: string, request: Record<string, unknown>, releaseRunId?: string): Promise<{
  status: SourceReleasePostMergeDeployStatus;
  deployedAt: string;
  evidence: string[];
}> {
  const deployedAt = new Date().toISOString();
  if (!loop.sourceClosure.requiredGates.includes("deploy")) {
    return { status: "NOT_REQUIRED", deployedAt, evidence: ["postMergeDeploy=NOT_REQUIRED", "deployGate=not-required"] };
  }
  const deployConnectorId = optionalTrimmedString(request.deployConnectorId) ?? optionalTrimmedString(request.deploymentConnectorId) ?? artifacts.deploymentConnectorId ?? loop.sourceClosure.deploymentConnectorId;
  if (!deployConnectorId) {
    return { status: "NOT_REQUIRED", deployedAt, evidence: ["postMergeDeploy=NOT_REQUIRED", "deploymentConnectorId=missing"] };
  }
  const deploymentArtifacts: LoopSourceClosure["artifacts"] = {
    ...artifacts,
    commitSha: artifacts.mergeCommitSha ?? artifacts.commitSha,
    deploymentConnectorId: deployConnectorId
  };
  const finalizer = store.writeSourceReleaseDeployFinalizer({
    schema: "evopilot-source-release-deploy-finalizer/v1",
    id: `${loop.id}-${releaseRunId ?? "latest"}-${Date.now()}`,
    loopId: loop.id,
    releaseRunId,
    deployConnectorId,
    actor,
    status: "PENDING",
    createdAt: deployedAt,
    updatedAt: deployedAt,
    artifacts: deploymentArtifacts,
    deploymentEnvironment: loop.sourceClosure.deploymentEnvironment ?? "production",
    healthUrl: deploymentArtifacts.healthUrl,
    readyUrl: deploymentArtifacts.readyUrl,
    attempts: 0,
    maxAttempts: 3,
    evidence: [
      "postMergeDeployFinalizer=PENDING",
      `postMergeDeployConnector=${deployConnectorId}`,
      `releaseRunId=${releaseRunId ?? "latest"}`
    ]
  });
  const deployResult = await executeDeployConnector(store, deployConnectorId, {
    loop: {
      ...loop,
      sourceClosure: normalizeLoopSourceClosure({
        ...loop.sourceClosure,
        artifacts: deploymentArtifacts
      }, project, loop.controlPlaneUrl)
    },
    actor,
    artifacts: deploymentArtifacts,
    parameters: {
      ...(isRecord(request.deployParameters) ? request.deployParameters : {}),
      releaseKey: `${loop.id}:${deploymentArtifacts.commitSha ?? "no-merge-commit"}:post-merge:${loop.sourceClosure.targetVersion ?? "no-target-version"}`
    }
  });
  artifacts.deploymentConnectorId = deployConnectorId;
  artifacts.deploymentId = deployResult.deploymentId;
  artifacts.deploymentUrl = deployResult.deploymentUrl ?? artifacts.deploymentUrl;
  artifacts.deployStatusUrl = deployResult.statusUrl ?? artifacts.deployStatusUrl;
  artifacts.healthUrl = deployResult.healthUrl ?? artifacts.healthUrl;
  artifacts.readyUrl = deployResult.readyUrl ?? artifacts.readyUrl;
  const health = await probeHealthReady(artifacts.healthUrl, artifacts.readyUrl);
  const deployOk = deployResult.status === "SUCCEEDED";
  const healthOk = health.passed;
  const rollbackEvidence: string[] = [];
  let status: SourceReleasePostMergeDeployStatus = deployOk && healthOk ? "SUCCEEDED" : "FAILED";
  if (deployOk && !healthOk) {
    const rollbackResult = await rollbackDeployConnector(store, deployConnectorId, {
      loop,
      actor,
      artifacts,
      parameters: isRecord(request.deployParameters) ? request.deployParameters : {},
      reason: "post-merge health-ready failed",
      healthEvidence: health.evidence
    });
    rollbackEvidence.push(...rollbackResult.evidence);
    status = rollbackResult.status === "SUCCEEDED" ? "ROLLED_BACK" : "FAILED";
  }
  const evidence = [
    `postMergeDeploy=${status}`,
    `postMergeDeployConnector=${deployConnectorId}`,
    ...deployResult.evidence,
    ...health.evidence,
    ...rollbackEvidence
  ];
  store.writeSourceReleaseDeployFinalizer({
    ...finalizer,
    status: status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
    updatedAt: new Date().toISOString(),
    artifacts: { ...deploymentArtifacts, ...artifacts },
    healthUrl: artifacts.healthUrl,
    readyUrl: artifacts.readyUrl,
    attempts: 1,
    evidence: [
      ...finalizer.evidence,
      ...evidence,
      status === "SUCCEEDED" ? "postMergeDeployFinalizer=SUCCEEDED" : "postMergeDeployFinalizer=FAILED"
    ]
  });
  return {
    status,
    deployedAt,
    evidence
  };
}

async function reconcilePendingSourceReleaseDeployFinalizers(store: FileStore): Promise<SourceReleaseDeployFinalizer[]> {
  const reconciled: SourceReleaseDeployFinalizer[] = [];
  for (const pending of store.listSourceReleaseDeployFinalizers("PENDING")) {
    const loop = store.readLoop(pending.loopId);
    const now = new Date().toISOString();
    if (!loop) {
      reconciled.push(store.writeSourceReleaseDeployFinalizer({
        ...pending,
        status: "FAILED",
        attempts: pending.attempts + 1,
        updatedAt: now,
        lastError: "LOOP_NOT_FOUND",
        evidence: [...pending.evidence, "postMergeDeployFinalizer=FAILED", "loop=missing"]
      }));
      continue;
    }
    const artifacts: LoopSourceClosure["artifacts"] = {
      ...loop.sourceClosure.artifacts,
      ...pending.artifacts,
      deploymentConnectorId: pending.deployConnectorId,
      postMergeDeployBy: pending.actor
    };
    const healthUrl = pending.healthUrl ?? artifacts.healthUrl;
    const readyUrl = pending.readyUrl ?? artifacts.readyUrl;
    const checks = await probeHealthReady(healthUrl, readyUrl);
    const attempts = pending.attempts + 1;
    if (!checks.passed && attempts < pending.maxAttempts) {
      reconciled.push(store.writeSourceReleaseDeployFinalizer({
        ...pending,
        attempts,
        updatedAt: now,
        healthUrl,
        readyUrl,
        evidence: [...pending.evidence, ...checks.evidence, `postMergeDeployFinalizerAttempt=${attempts}`],
        lastError: "health-ready probe failed"
      }));
      continue;
    }
    const gateEvidence: LoopSourceClosure["gateEvidence"] = { ...loop.sourceClosure.gateEvidence };
    const deployEvidence = [
      `postMergeDeployFinalizer=${checks.passed ? "SUCCEEDED" : "FAILED"}`,
      `postMergeDeployConnector=${pending.deployConnectorId}`,
      ...checks.evidence
    ];
    markGate(gateEvidence, "deploy", checks.passed ? "PASSED" : "FAILED", [
      ...(gateEvidence.deploy?.evidence ?? []),
      ...deployEvidence
    ], now);
    if (loop.sourceClosure.requiredGates.includes("health-ready")) {
      markGate(gateEvidence, "health-ready", checks.passed ? "PASSED" : "FAILED", [
        ...(gateEvidence["health-ready"]?.evidence ?? []),
        ...checks.evidence
      ], now);
    }
    artifacts.postMergeDeployStatus = checks.passed ? "SUCCEEDED" : "FAILED";
    artifacts.postMergeDeployAt = now;
    artifacts.postMergeDeployBy = pending.actor;
    artifacts.healthUrl = healthUrl;
    artifacts.readyUrl = readyUrl;
    const closureState: LoopSourceClosureState = checks.passed && requiredSourceClosureGatesPassed(loop.sourceClosure.requiredGates, gateEvidence) ? "PROMOTED" : "FAILED";
    const project = store.readProject(loop.sourceClosure.sourceProjectId) ?? store.readProject(loop.projectId);
    const updatedClosure = normalizeLoopSourceClosure({
      ...loop.sourceClosure,
      closureState,
      gateEvidence,
      artifacts
    }, project, loop.controlPlaneUrl);
    const updatedLoop = store.writeLoop({
      ...loop,
      sourceClosure: updatedClosure,
      evidenceSets: [
        ...loop.evidenceSets,
        {
          id: `${loop.id}-post-merge-deploy-finalizer-${Date.now()}`,
          loopRunId: loop.id,
          iterationId: loop.iterations.at(-1)?.id ?? `${loop.id}-post-merge-deploy-finalizer`,
          validator: "evopilot-source-release-deploy-finalizer",
          status: checks.passed ? "PASS" : "FAIL",
          evidence: deployEvidence,
          artifacts: [],
          createdAt: now
        }
      ],
      timeline: [
        ...loop.timeline,
        loopTimelineEvent(checks.passed ? "EVIDENCE" : "DECISION", `Post-merge deploy finalizer reconciled as ${artifacts.postMergeDeployStatus}.`, {
          deployConnectorId: pending.deployConnectorId,
          releaseRunId: pending.releaseRunId,
          closureState
        })
      ],
      updatedAt: now
    });
    const latestRun = store.listSourceReleaseClosureRuns(loop.id).at(-1);
    store.writeSourceReleaseClosureRun(buildSourceReleaseClosureRun(updatedLoop, pending.actor, pending.releaseRunId ?? latestRun?.id, latestRun?.createdAt));
    reconciled.push(store.writeSourceReleaseDeployFinalizer({
      ...pending,
      status: checks.passed ? "SUCCEEDED" : "FAILED",
      attempts,
      updatedAt: now,
      artifacts,
      healthUrl,
      readyUrl,
      evidence: [...pending.evidence, ...deployEvidence],
      lastError: checks.passed ? undefined : "health-ready probe failed"
    }));
  }
  return reconciled;
}

function normalizeSourceClosureFiles(value: unknown): Array<{ path: string; content: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((file) => ({
      path: String(file.path ?? "").trim(),
      content: String(file.content ?? "")
    }))
    .filter((file) => file.path && !file.path.startsWith("/") && !file.path.includes(".."));
}

async function preflightLoopSourceClosure(store: FileStore, loopId: string, options: { actor: string; persist?: boolean }): Promise<SourceClosurePreflightResult | undefined> {
  const loop = store.readLoop(loopId);
  if (!loop) return undefined;
  const project = store.readProject(loop.sourceClosure.sourceProjectId) ?? store.readProject(loop.projectId);
  const closure = loop.sourceClosure;
  const checks: SourceClosurePreflightResult["checks"] = [];
  const now = new Date().toISOString();

  const addCheck = (check: SourceClosurePreflightResult["checks"][number]) => {
    checks.push(check);
  };

  addCheck({
    id: "project-binding",
    status: project?.repository ? "PASS" : "FAIL",
    required: true,
    evidence: project?.repository
      ? [`project=${project.id}`, `repositoryProvider=${project.repository.provider}`]
      : [`sourceProject=${closure.sourceProjectId}`, "repository=missing"]
  });

  const providerSupported = closure.repositoryProvider === "github" || closure.repositoryProvider === "gitlab" || closure.repositoryProvider === "local-git";
  addCheck({
    id: "provider",
    status: providerSupported ? "PASS" : "FAIL",
    required: true,
    evidence: [`provider=${closure.repositoryProvider}`, `releaseStrategy=${closure.releaseStrategy}`]
  });

  if (project?.repository?.provider === "github") {
    const token = repositoryToken(project.repository);
    addCheck({
      id: "credentials",
      status: token ? "PASS" : "FAIL",
      required: true,
      evidence: [
        token ? "tokenResolved=true" : "SOURCE_CLOSURE_TOKEN_REQUIRED",
        project.repository.credentials?.tokenRef ? `tokenRef=${project.repository.credentials.tokenRef}` : "tokenRef=missing",
        project.repository.credentials?.tokenRef ? `tokenRefResolved=${Boolean(process.env[project.repository.credentials.tokenRef])}` : "tokenRefResolved=false"
      ]
    });
    if (token && project.repository.owner && project.repository.repo) {
      try {
        const files = await new GitHubHttpAdapter({
          apiBaseUrl: project.repository.baseUrl,
          owner: project.repository.owner,
          repo: project.repository.repo,
          token
        }).listFiles(closure.sourceBranch);
        addCheck({ id: "source-branch", status: "PASS", required: true, evidence: [`branch=${closure.sourceBranch}`, `fileCount=${files.length}`] });
      } catch (error) {
        addCheck({ id: "source-branch", status: "FAIL", required: true, evidence: [`branch=${closure.sourceBranch}`, error instanceof Error ? error.message : String(error)] });
      }
    } else {
      addCheck({ id: "source-branch", status: "SKIP", required: true, evidence: [`branch=${closure.sourceBranch}`, "credentials-or-coordinates-missing"] });
    }
  } else if (project?.repository?.provider === "gitlab") {
    const token = repositoryToken(project.repository);
    addCheck({
      id: "credentials",
      status: token ? "PASS" : "FAIL",
      required: true,
      evidence: [
        token ? "tokenResolved=true" : "SOURCE_CLOSURE_TOKEN_REQUIRED",
        project.repository.credentials?.tokenRef ? `tokenRef=${project.repository.credentials.tokenRef}` : "tokenRef=missing",
        project.repository.credentials?.tokenRef ? `tokenRefResolved=${Boolean(process.env[project.repository.credentials.tokenRef])}` : "tokenRefResolved=false"
      ]
    });
    if (token && project.repository.baseUrl && project.repository.projectId) {
      try {
        const files = await new GitLabHttpAdapter({
          baseUrl: project.repository.baseUrl,
          projectId: project.repository.projectId,
          token
        }).listFiles(closure.sourceBranch);
        addCheck({ id: "source-branch", status: "PASS", required: true, evidence: [`branch=${closure.sourceBranch}`, `fileCount=${files.length}`] });
      } catch (error) {
        addCheck({ id: "source-branch", status: "FAIL", required: true, evidence: [`branch=${closure.sourceBranch}`, error instanceof Error ? error.message : String(error)] });
      }
    } else {
      addCheck({ id: "source-branch", status: "SKIP", required: true, evidence: [`branch=${closure.sourceBranch}`, "credentials-or-coordinates-missing"] });
    }
  } else if (project?.repository?.provider === "local-git") {
    const root = project.repository.root ? path.resolve(project.repository.root) : "";
    const rootOk = Boolean(root && fs.existsSync(root) && fs.statSync(root).isDirectory());
    addCheck({ id: "credentials", status: "PASS", required: false, evidence: ["local-git-credentials=not-required"] });
    addCheck({ id: "source-branch", status: rootOk ? "PASS" : "FAIL", required: true, evidence: [`root=${root || "missing"}`, rootOk ? "rootExists=true" : "rootExists=false"] });
  } else {
    addCheck({ id: "credentials", status: "FAIL", required: true, evidence: ["repository=missing-or-provider-mismatch"] });
    addCheck({ id: "source-branch", status: "SKIP", required: true, evidence: [`branch=${closure.sourceBranch}`, "repository=missing-or-provider-mismatch"] });
  }

  const deployRequired = closure.requiredGates.includes("deploy");
  const deployConnector = closure.deploymentConnectorId ? store.readDeployConnector(closure.deploymentConnectorId) : undefined;
  const deploymentUrl = closure.artifacts.deploymentUrl ?? closure.controlPlaneUrl ?? loop.controlPlaneUrl;
  addCheck({
    id: "deploy-target",
    status: !deployRequired || deployConnector || deploymentUrl ? "PASS" : "FAIL",
    required: deployRequired,
    evidence: [
      `deployRequired=${deployRequired}`,
      closure.deploymentConnectorId ? `deployConnector=${closure.deploymentConnectorId}` : "deployConnector=missing",
      deployConnector ? `deployConnectorType=${deployConnector.type}` : "deployConnectorResolved=false",
      deploymentUrl ? `deploymentUrl=${deploymentUrl}` : "deploymentUrl=missing"
    ]
  });

  const healthRequired = closure.requiredGates.includes("health-ready");
  addCheck({
    id: "health-ready",
    status: !healthRequired || closure.artifacts.healthUrl || closure.artifacts.readyUrl || deploymentUrl ? "PASS" : "FAIL",
    required: healthRequired,
    evidence: [
      `healthReadyRequired=${healthRequired}`,
      closure.artifacts.healthUrl ? `healthUrl=${closure.artifacts.healthUrl}` : "healthUrl=derived-or-missing",
      closure.artifacts.readyUrl ? `readyUrl=${closure.artifacts.readyUrl}` : "readyUrl=derived-or-missing"
    ]
  });

  const blockers = checks
    .filter((check) => check.required && check.status !== "PASS")
    .flatMap((check) => check.evidence.some((item) => item === "SOURCE_CLOSURE_TOKEN_REQUIRED")
      ? [`${check.id}:SOURCE_CLOSURE_TOKEN_REQUIRED`]
      : [`${check.id}:${check.status}`]);
  const result: SourceClosurePreflightResult = {
    schema: "evopilot-source-closure-preflight/v1",
    loopId: loop.id,
    projectId: loop.projectId,
    sourceProjectId: closure.sourceProjectId,
    provider: closure.repositoryProvider,
    status: blockers.length === 0 ? "PASS" : "FAIL",
    blockers,
    checks,
    capabilities: [
      "non-mutating-source-closure-preflight",
      `${closure.repositoryProvider}-credential-check`,
      "branch-readiness-check",
      "deploy-target-check",
      "autopilot-preflight-gate"
    ],
    nextAction: blockers.some((blocker) => blocker.includes("credentials")) ? "repair-credentials"
      : blockers.some((blocker) => blocker.includes("project") || blocker.includes("provider") || blocker.includes("source-branch")) ? "repair-project"
        : blockers.some((blocker) => blocker.includes("deploy") || blocker.includes("health")) ? "repair-deploy-target"
          : "write-source",
    createdAt: now
  };

  if (options.persist) {
    store.writeLoop({
      ...loop,
      evidenceSets: [
        ...loop.evidenceSets,
        {
          id: `${loop.id}-source-closure-preflight-${Date.now()}`,
          loopRunId: loop.id,
          iterationId: loop.iterations.at(-1)?.id ?? `${loop.id}-source-closure-preflight`,
          validator: "evopilot-source-closure-preflight",
          status: result.status === "PASS" ? "PASS" : "FAIL",
          evidence: [
            `sourceClosure.preflight=${result.status}`,
            `sourceClosure.preflight.nextAction=${result.nextAction}`,
            ...result.blockers.map((blocker) => `sourceClosure.preflight.blocker=${blocker}`),
            ...result.checks.flatMap((check) => [`sourceClosure.preflight.${check.id}=${check.status}`, ...check.evidence])
          ],
          artifacts: [],
          createdAt: now
        }
      ],
      timeline: [
        ...loop.timeline,
        loopTimelineEvent("EVIDENCE", `Source closure preflight ${result.status}.`, {
          provider: closure.repositoryProvider,
          blockers: result.blockers,
          nextAction: result.nextAction
        })
      ],
      updatedAt: now
    });
  }

  return result;
}

function buildSourceReleaseClosureRun(loop: LoopRun, actor?: string, id?: string, createdAt?: string): SourceReleaseClosureRun {
  const now = new Date().toISOString();
  const closure = loop.sourceClosure;
  const runId = id ?? `${loop.id}-source-release-${Date.now()}`;
  return {
    schema: "evopilot-source-release-closure-run/v1",
    id: runId,
    loopId: loop.id,
    projectId: loop.projectId,
    sourceProjectId: closure.sourceProjectId,
    tenantId: loop.tenantId,
    workspaceId: loop.workspaceId,
    provider: closure.repositoryProvider,
    releaseStrategy: closure.releaseStrategy,
    sourceRef: {
      sourceUrl: closure.sourceUrl,
      sourceRoot: closure.sourceRoot,
      sourceBranch: closure.sourceBranch,
      releaseBranch: closure.artifacts.branch
    },
    targetVersion: closure.targetVersion,
    deploymentEnvironment: closure.deploymentEnvironment ?? "production",
    status: closure.closureState,
    stages: buildSourceReleaseClosureStages(closure),
    artifacts: closure.artifacts,
    review: sourceReleaseReviewState(closure),
    policy: sourceReleasePolicyState(closure),
    postMergeDeployment: sourceReleasePostMergeDeploymentState(closure),
    capabilities: sourceReleaseClosureCapabilities(closure),
    nextAction: sourceReleaseClosureNextAction(closure),
    createdAt: createdAt ?? now,
    updatedAt: now,
    actor
  };
}

function buildSourceReleaseClosureStages(closure: LoopSourceClosure): SourceReleaseClosureRun["stages"] {
  const gateStages = closure.requiredGates.map((gate) => {
    const row = closure.gateEvidence[gate];
    return {
      gate,
      label: sourceClosureGateLabel(gate),
      status: row?.status ?? "PENDING",
      evidence: row?.evidence ?? [],
      checkedAt: row?.checkedAt
    };
  });
  const review = sourceReleaseReviewState(closure);
  const policy = sourceReleasePolicyState(closure);
  return [
    ...gateStages,
    {
      gate: "review",
      label: "Approve release review",
      status: review.status === "REJECTED" ? "FAILED" : review.status === "APPROVED" || review.status === "MERGED" || review.status === "NOT_REQUIRED" ? "PASSED" : "PENDING",
      evidence: [
        `reviewStatus=${review.status}`,
        ...(review.reviewUrl ? [`reviewUrl=${review.reviewUrl}`] : []),
        ...(review.approvedBy ? [`approvedBy=${review.approvedBy}`] : []),
        ...(review.rejectedBy ? [`rejectedBy=${review.rejectedBy}`] : [])
      ],
      checkedAt: review.approvedAt ?? review.rejectedAt
    },
    {
      gate: "policy",
      label: "Evaluate release policy",
      status: policy.evaluatedAt ? policy.status === "PASS" ? "PASSED" : "FAILED" : "PENDING",
      evidence: [
        `policyStatus=${policy.status}`,
        `autoMerge=${policy.autoMerge}`,
        ...policy.blockers.map((blocker) => `policyBlocker=${blocker}`)
      ],
      checkedAt: policy.evaluatedAt
    },
    {
      gate: "merge",
      label: "Merge release review",
      status: review.status === "MERGED" || review.status === "NOT_REQUIRED" ? "PASSED" : review.status === "REJECTED" ? "SKIPPED" : "PENDING",
      evidence: [
        `reviewStatus=${review.status}`,
        ...(review.mergeCommitSha ? [`mergeCommitSha=${review.mergeCommitSha}`] : []),
        ...(review.mergedBy ? [`mergedBy=${review.mergedBy}`] : [])
      ],
      checkedAt: review.mergedAt
    }
  ];
}

function sourceReleaseReviewState(closure: LoopSourceClosure): SourceReleaseClosureRun["review"] {
  const artifacts = closure.artifacts;
  const reviewUrl = artifacts.pullRequestUrl ?? artifacts.mergeRequestUrl;
  const status = artifacts.reviewStatus ?? (reviewUrl ? "PENDING" : "NOT_REQUIRED");
  return {
    status,
    reviewUrl,
    approvedBy: artifacts.approvedBy,
    approvedAt: artifacts.approvedAt,
    rejectedBy: artifacts.rejectedBy,
    rejectedAt: artifacts.rejectedAt,
    mergedBy: artifacts.mergedBy,
    mergedAt: artifacts.mergedAt,
    mergeCommitSha: artifacts.mergeCommitSha
  };
}

function sourceReleasePolicyState(closure: LoopSourceClosure): SourceReleaseClosureRun["policy"] {
  const artifacts = closure.artifacts;
  const status = artifacts.policyStatus ?? "PASS";
  return {
    status,
    evaluatedAt: artifacts.policyEvaluatedAt,
    autoMerge: artifacts.autoMerge === true,
    blockers: artifacts.policyBlockers ?? [],
    checks: [
      {
        id: "policy-state",
        status: status === "PASS" ? "PASS" : "FAIL",
        evidence: [
          `policyStatus=${status}`,
          ...(artifacts.policyBlockers ?? []).map((blocker) => `policyBlocker=${blocker}`)
        ],
        required: true
      }
    ]
  };
}

function sourceReleasePostMergeDeploymentState(closure: LoopSourceClosure): SourceReleaseClosureRun["postMergeDeployment"] {
  const artifacts = closure.artifacts;
  if (!artifacts.postMergeDeployStatus) return undefined;
  return {
    status: artifacts.postMergeDeployStatus,
    deployedAt: artifacts.postMergeDeployAt,
    deployedBy: artifacts.postMergeDeployBy,
    deploymentId: artifacts.deploymentId,
    deploymentUrl: artifacts.deploymentUrl,
    healthUrl: artifacts.healthUrl,
    readyUrl: artifacts.readyUrl,
    evidence: [
      `postMergeDeploy=${artifacts.postMergeDeployStatus}`,
      ...(artifacts.deploymentId ? [`deploymentId=${artifacts.deploymentId}`] : []),
      ...(artifacts.deploymentUrl ? [`deploymentUrl=${artifacts.deploymentUrl}`] : [])
    ]
  };
}

function sourceClosureGateLabel(gate: SourceReleaseClosureStage): string {
  return {
    "code-change": "Write source change",
    push: "Create release branch",
    tag: "Create release tag",
    deploy: "Deploy to environment",
    "health-ready": "Probe health and ready",
    review: "Approve release review",
    policy: "Evaluate release policy",
    merge: "Merge release review"
  }[gate];
}

function sourceReleaseClosureCapabilities(closure: LoopSourceClosure): string[] {
  return [
    `${closure.repositoryProvider}-source`,
    closure.releaseStrategy,
    "branch-commit-review",
    "review-approval",
    "release-policy-gate",
    "safe-auto-merge",
    "merge-tracking",
    "post-merge-deploy-closure",
    "durable-post-merge-deploy-finalizer",
    ...(closure.requiredGates.includes("tag") ? ["version-tag"] : []),
    ...(closure.requiredGates.includes("deploy") ? ["deploy-connector"] : []),
    ...(closure.requiredGates.includes("health-ready") ? ["health-ready-probe"] : []),
    "auditable-release-run"
  ];
}

function sourceReleaseClosureNextAction(closure: LoopSourceClosure): SourceReleaseClosureRun["nextAction"] {
  const review = sourceReleaseReviewState(closure);
  if (review.status === "REJECTED") return "failed";
  if (closure.artifacts.policyStatus === "BLOCKED") return "policy-review";
  if (review.status === "PENDING") return "approve-review";
  if (review.status === "APPROVED") return "merge-review";
  if (closure.closureState === "PROMOTED") return "promoted";
  if (closure.closureState === "FAILED" || closure.closureState === "HEALTH_FAILED") return "failed";
  if (closure.closureState === "ROLLED_BACK") return "rollback";
  const gate = nextPendingGate(closure.requiredGates, closure.gateEvidence);
  if (gate === "code-change") return "write-source";
  if (gate === "push") return "open-review";
  if (gate === "tag") return "tag";
  if (gate === "deploy") return "deploy";
  return "probe-health";
}

async function executeLocalGitSourceClosure(repository: ProjectRepositoryRegistration, input: {
  loop: LoopRun;
  files: Array<{ path: string; content: string }>;
  branch: string;
  commitMessage: string;
  tagName?: string;
  allowDirtyWorktree: boolean;
}): Promise<{ commitSha: string; reviewUrl: string; branchEvidence: string[]; evidence: string[] }> {
  if (!repository.root) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_ROOT_REQUIRED", "local-git source closure requires repository.root.");
  const root = path.resolve(repository.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_ROOT_NOT_FOUND", `local-git root not found: ${root}`);
  const commandResults: Array<{ name: string; exitCode: number; output: string }> = [];
  const status = await runBoundedCommand({ command: "git", args: ["status", "--porcelain"], cwd: root, timeoutSeconds: 30 });
  commandResults.push({ name: "git status", exitCode: status.exitCode, output: status.output });
  if (status.exitCode !== 0) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_STATUS_FAILED", status.output);
  if (!input.allowDirtyWorktree && status.output.trim()) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_DIRTY", "local-git source closure requires a clean worktree unless allowDirtyWorktree=true.");
  const branchExists = await runBoundedCommand({ command: "git", args: ["rev-parse", "--verify", input.branch], cwd: root, timeoutSeconds: 30 });
  commandResults.push({ name: "git rev-parse branch", exitCode: branchExists.exitCode, output: branchExists.output });
  const switchArgs = branchExists.exitCode === 0 ? ["switch", input.branch] : ["switch", "-c", input.branch];
  const switched = await runBoundedCommand({ command: "git", args: switchArgs, cwd: root, timeoutSeconds: 30 });
  commandResults.push({ name: "git switch", exitCode: switched.exitCode, output: switched.output });
  if (switched.exitCode !== 0) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_SWITCH_FAILED", switched.output);
  for (const file of input.files) {
    const target = path.resolve(root, file.path);
    if (!isUnderPath(target, root)) throw httpError(400, "SOURCE_CLOSURE_FILE_OUTSIDE_ROOT", `Refusing to write outside repository root: ${file.path}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content);
  }
  if (input.files.length > 0) {
    const add = await runBoundedCommand({ command: "git", args: ["add", "--", ...input.files.map((file) => file.path)], cwd: root, timeoutSeconds: 30 });
    commandResults.push({ name: "git add", exitCode: add.exitCode, output: add.output });
    if (add.exitCode !== 0) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_ADD_FAILED", add.output);
    const commit = await runBoundedCommand({
      command: "git",
      args: ["-c", "user.name=EvoPilot", "-c", "user.email=evopilot@local", "commit", "-m", input.commitMessage],
      cwd: root,
      timeoutSeconds: 60
    });
    commandResults.push({ name: "git commit", exitCode: commit.exitCode, output: commit.output });
    if (commit.exitCode !== 0 && !commit.output.includes("nothing to commit")) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_COMMIT_FAILED", commit.output);
  }
  const head = await runBoundedCommand({ command: "git", args: ["rev-parse", "--short", "HEAD"], cwd: root, timeoutSeconds: 30 });
  commandResults.push({ name: "git rev-parse head", exitCode: head.exitCode, output: head.output });
  if (head.exitCode !== 0) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_HEAD_FAILED", head.output);
  const commitSha = head.output.trim().split(/\s+/)[0];
  if (input.tagName) {
    const tag = await runBoundedCommand({ command: "git", args: ["tag", input.tagName, commitSha], cwd: root, timeoutSeconds: 30 });
    commandResults.push({ name: "git tag", exitCode: tag.exitCode, output: tag.output });
    if (tag.exitCode !== 0 && !tag.output.includes("already exists")) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_TAG_FAILED", tag.output);
  }
  return {
    commitSha,
    reviewUrl: `${pathToFileURL(root).href}#${encodeURIComponent(input.branch)}`,
    branchEvidence: [`branch=${input.branch}`, `localRoot=${root}`, `commitSha=${commitSha}`],
    evidence: [
      `localGit.root=${root}`,
      `localGit.branch=${input.branch}`,
      `localGit.commit=${commitSha}`,
      ...commandEvidence(commandResults)
    ]
  };
}

async function mergeLocalGitSourceClosure(repository: ProjectRepositoryRegistration, loop: LoopRun, artifacts: LoopSourceClosure["artifacts"], commitMessage: string, actor: string): Promise<{ mergeCommitSha?: string; evidence: string[] }> {
  if (!repository.root) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_ROOT_REQUIRED", "local-git merge requires repository.root.");
  const root = path.resolve(repository.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_ROOT_NOT_FOUND", `local-git root not found: ${root}`);
  const branch = artifacts.branch;
  if (!branch) throw httpError(409, "SOURCE_CLOSURE_RELEASE_BRANCH_REQUIRED", "local-git merge requires a release branch.");
  const commandResults: Array<{ name: string; exitCode: number; output: string }> = [];
  const status = await runBoundedCommand({ command: "git", args: ["status", "--porcelain"], cwd: root, timeoutSeconds: 30 });
  commandResults.push({ name: "git status", exitCode: status.exitCode, output: status.output });
  if (status.exitCode !== 0) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_STATUS_FAILED", status.output);
  if (status.output.trim()) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_DIRTY", "local-git merge requires a clean worktree.");
  const sourceBranch = loop.sourceClosure.sourceBranch;
  const checkout = await runBoundedCommand({ command: "git", args: ["switch", sourceBranch], cwd: root, timeoutSeconds: 30 });
  commandResults.push({ name: "git switch source", exitCode: checkout.exitCode, output: checkout.output });
  if (checkout.exitCode !== 0) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_SWITCH_FAILED", checkout.output);
  const merge = await runBoundedCommand({
    command: "git",
    args: ["-c", "user.name=EvoPilot", "-c", "user.email=evopilot@local", "merge", "--no-ff", branch, "-m", commitMessage],
    cwd: root,
    timeoutSeconds: 60
  });
  commandResults.push({ name: "git merge", exitCode: merge.exitCode, output: merge.output });
  if (merge.exitCode !== 0 && !merge.output.includes("Already up to date")) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_MERGE_FAILED", merge.output);
  const head = await runBoundedCommand({ command: "git", args: ["rev-parse", "--short", "HEAD"], cwd: root, timeoutSeconds: 30 });
  commandResults.push({ name: "git rev-parse merged head", exitCode: head.exitCode, output: head.output });
  if (head.exitCode !== 0) throw httpError(409, "SOURCE_CLOSURE_LOCAL_GIT_HEAD_FAILED", head.output);
  const mergeCommitSha = head.output.trim().split(/\s+/)[0];
  return {
    mergeCommitSha,
    evidence: [
      `localGit.root=${root}`,
      `localGit.sourceBranch=${sourceBranch}`,
      `localGit.releaseBranch=${branch}`,
      `localGit.mergeCommit=${mergeCommitSha}`,
      `mergedBy=${actor}`,
      ...commandEvidence(commandResults)
    ]
  };
}

function defaultClosureBranch(loop: LoopRun): string {
  const version = loop.sourceClosure.targetVersion ? `-${safeFileName(loop.sourceClosure.targetVersion)}` : "";
  return `evopilot/${safeFileName(loop.id)}${version}`;
}

function repositoryToken(repository: ProjectRepositoryRegistration): string | undefined {
  if (repository.credentials?.token) return repository.credentials.token;
  if (repository.credentials?.password) return repository.credentials.password;
  if (repository.credentials?.tokenRef) return process.env[repository.credentials.tokenRef];
  return undefined;
}

async function executeDeployConnector(store: FileStore, connectorId: string, input: {
  loop: LoopRun;
  actor: string;
  artifacts: LoopSourceClosure["artifacts"];
  parameters: Record<string, unknown>;
}): Promise<{
  status: "SUCCEEDED" | "FAILED";
  deploymentId?: string;
  deploymentUrl?: string;
  statusUrl?: string;
  healthUrl?: string;
  readyUrl?: string;
  evidence: string[];
}> {
  const connector = store.readDeployConnector(connectorId);
  if (!connector) throw httpError(409, "DEPLOY_CONNECTOR_NOT_FOUND", `Deploy connector ${connectorId} is not configured.`);
  if (connector.type === "ecs-docker-compose") {
    return executeEcsDockerComposeDeploy(connector, input);
  }
  const token = connector.token ?? (connector.tokenRef ? process.env[connector.tokenRef] : undefined);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, connector.timeoutSeconds) * 1000);
  const payload = {
    schema: "evopilot-deploy-request/v1",
    loopId: input.loop.id,
    projectId: input.loop.projectId,
    actor: input.actor,
    objective: input.loop.objective,
    targetVersion: input.loop.sourceClosure.targetVersion,
    deploymentEnvironment: input.loop.sourceClosure.deploymentEnvironment ?? "production",
    sourceClosure: {
      sourceProjectId: input.loop.sourceClosure.sourceProjectId,
      repositoryProvider: input.loop.sourceClosure.repositoryProvider,
      sourceUrl: input.loop.sourceClosure.sourceUrl,
      sourceRoot: input.loop.sourceClosure.sourceRoot,
      sourceBranch: input.loop.sourceClosure.sourceBranch,
      releaseStrategy: input.loop.sourceClosure.releaseStrategy
    },
    artifacts: {
      branch: input.artifacts.branch,
      commitSha: input.artifacts.commitSha,
      tag: input.artifacts.tag,
      pullRequestUrl: input.artifacts.pullRequestUrl,
      mergeRequestUrl: input.artifacts.mergeRequestUrl
    },
    parameters: input.parameters
  };
  const webhookUrl = connector.url;
  if (!webhookUrl) throw httpError(409, "DEPLOY_CONNECTOR_URL_REQUIRED", `Deploy connector ${connectorId} does not have a webhook URL.`);
  try {
    const response = await fetch(webhookUrl, {
      method: connector.method ?? "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(connector.headers ?? {})
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    const body = parseOptionalJson(text);
    const deploymentUrl = optionalTrimmedString(body?.deploymentUrl) ?? optionalTrimmedString(body?.url);
    const healthUrl = optionalTrimmedString(body?.healthUrl) ?? joinUrlPath(deploymentUrl, connector.healthPath);
    const readyUrl = optionalTrimmedString(body?.readyUrl) ?? joinUrlPath(deploymentUrl, connector.readyPath);
    const deploymentId = optionalTrimmedString(body?.deploymentId) ?? optionalTrimmedString(body?.id);
    const statusUrl = optionalTrimmedString(body?.statusUrl);
    return {
      status: response.ok ? "SUCCEEDED" : "FAILED",
      deploymentId,
      deploymentUrl,
      statusUrl,
      healthUrl,
      readyUrl,
      evidence: [
        `deployConnector=${connector.id}`,
        `deployConnectorType=${connector.type}`,
        `deployStatus=${response.status}`,
        ...(deploymentId ? [`deploymentId=${deploymentId}`] : []),
        ...(deploymentUrl ? [`deploymentUrl=${deploymentUrl}`] : []),
        ...(statusUrl ? [`deployStatusUrl=${statusUrl}`] : []),
        ...(healthUrl ? [`healthUrl=${healthUrl}`] : []),
        ...(readyUrl ? [`readyUrl=${readyUrl}`] : [])
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "FAILED",
      evidence: [`deployConnector=${connector.id}`, `deployError=${message}`]
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function rollbackDeployConnector(store: FileStore, connectorId: string, input: {
  loop: LoopRun;
  actor: string;
  artifacts: LoopSourceClosure["artifacts"];
  parameters: Record<string, unknown>;
  reason: string;
  healthEvidence: string[];
}): Promise<{ status: "SUCCEEDED" | "FAILED" | "SKIPPED"; evidence: string[] }> {
  const connector = store.readDeployConnector(connectorId);
  if (!connector) {
    return {
      status: "FAILED",
      evidence: [`rollbackConnector=${connectorId}`, "rollbackFailure=deploy connector not configured"]
    };
  }
  const evidence = [
    `rollbackConnector=${connector.id}`,
    `rollbackConnectorType=${connector.type}`,
    `rollbackReason=${input.reason}`
  ];
  if (connector.rollbackOnHealthFailure === false) {
    return {
      status: "SKIPPED",
      evidence: [...evidence, "rollbackStatus=SKIPPED", "rollbackOnHealthFailure=false"]
    };
  }
  if (connector.type === "ecs-docker-compose") {
    return rollbackEcsDockerComposeConnector(connector, input, evidence);
  }
  return rollbackWebhookDeployConnector(connector, input, evidence);
}

async function rollbackEcsDockerComposeConnector(connector: StoredDeployConnector, input: {
  loop: LoopRun;
  actor: string;
  artifacts: LoopSourceClosure["artifacts"];
  parameters: Record<string, unknown>;
  reason: string;
  healthEvidence: string[];
}, evidence: string[]): Promise<{ status: "SUCCEEDED" | "FAILED"; evidence: string[] }> {
  if (!connector.workingDir) {
    return { status: "FAILED", evidence: [...evidence, "rollbackStatus=FAILED", "rollbackFailure=workingDir missing"] };
  }
  const workingDir = path.resolve(connector.workingDir);
  if (!fs.existsSync(workingDir) || !fs.statSync(workingDir).isDirectory()) {
    return { status: "FAILED", evidence: [...evidence, "rollbackStatus=FAILED", `rollbackFailure=workingDir not found: ${workingDir}`] };
  }
  const stamp = readEcsDeployStamp(workingDir, connector);
  if (!stamp?.beforeCommit) {
    return { status: "FAILED", evidence: [...evidence, "rollbackStatus=FAILED", "rollbackFailure=deploy stamp missing beforeCommit"] };
  }
  const timeoutSeconds = Math.max(1, connector.timeoutSeconds || 120);
  const gitCommand = connector.gitCommand || "git";
  const dockerCommand = connector.dockerCommand || "docker";
  const composeArgs = ["compose", "-f", connector.composeFile || "docker-compose.yml", "up", "-d"];
  if (connector.build !== false) composeArgs.push("--build");
  if (connector.serviceName) composeArgs.push(connector.serviceName);
  const commandResults: Array<{ name: string; exitCode: number; output: string }> = [];
  const status = await rollbackEcsDockerComposeDeploy({
    connector,
    gitCommand,
    dockerCommand,
    composeArgs,
    workingDir,
    timeoutSeconds,
    beforeCommit: stamp.beforeCommit,
    commandResults
  });
  return {
    status,
    evidence: [
      ...evidence,
      `rollbackTargetCommit=${stamp.beforeCommit}`,
      `rollbackReleaseKey=${stamp.releaseKey}`,
      `rollbackStatus=${status}`,
      ...commandEvidence(commandResults)
    ]
  };
}

async function rollbackWebhookDeployConnector(connector: StoredDeployConnector, input: {
  loop: LoopRun;
  actor: string;
  artifacts: LoopSourceClosure["artifacts"];
  parameters: Record<string, unknown>;
  reason: string;
  healthEvidence: string[];
}, evidence: string[]): Promise<{ status: "SUCCEEDED" | "FAILED" | "SKIPPED"; evidence: string[] }> {
  if (!connector.rollbackUrl) {
    return { status: "SKIPPED", evidence: [...evidence, "rollbackStatus=SKIPPED", "rollbackUrl=not-configured"] };
  }
  const token = connector.token ?? (connector.tokenRef ? process.env[connector.tokenRef] : undefined);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, connector.timeoutSeconds) * 1000);
  try {
    const response = await fetch(connector.rollbackUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(connector.headers ?? {})
      },
      body: JSON.stringify({
        schema: "evopilot-deploy-rollback/v1",
        loopId: input.loop.id,
        projectId: input.loop.projectId,
        actor: input.actor,
        reason: input.reason,
        targetVersion: input.loop.sourceClosure.targetVersion,
        deploymentEnvironment: input.loop.sourceClosure.deploymentEnvironment ?? "production",
        artifacts: input.artifacts,
        healthEvidence: input.healthEvidence,
        parameters: input.parameters
      })
    });
    const text = await response.text();
    const body = parseOptionalJson(text);
    const rollbackId = optionalTrimmedString(body?.rollbackId) ?? optionalTrimmedString(body?.id);
    return {
      status: response.ok ? "SUCCEEDED" : "FAILED",
      evidence: [
        ...evidence,
        `rollbackStatus=${response.ok ? "SUCCEEDED" : "FAILED"}`,
        `rollbackHttpStatus=${response.status}`,
        ...(rollbackId ? [`rollbackId=${rollbackId}`] : [])
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "FAILED", evidence: [...evidence, "rollbackStatus=FAILED", `rollbackError=${message}`] };
  } finally {
    clearTimeout(timeout);
  }
}

async function executeEcsDockerComposeDeploy(connector: StoredDeployConnector, input: {
  loop: LoopRun;
  actor: string;
  artifacts: LoopSourceClosure["artifacts"];
  parameters: Record<string, unknown>;
}): Promise<{
  status: "SUCCEEDED" | "FAILED";
  deploymentId?: string;
  deploymentUrl?: string;
  statusUrl?: string;
  healthUrl?: string;
  readyUrl?: string;
  evidence: string[];
}> {
  if (!connector.workingDir) throw httpError(409, "ECS_DEPLOY_WORKING_DIR_REQUIRED", "ECS Docker Compose deploy connector requires workingDir.");
  const workingDir = path.resolve(connector.workingDir);
  if (!fs.existsSync(workingDir) || !fs.statSync(workingDir).isDirectory()) {
    throw httpError(409, "ECS_DEPLOY_WORKING_DIR_NOT_FOUND", `Deploy workingDir does not exist: ${workingDir}`);
  }
  const timeoutSeconds = Math.max(1, connector.timeoutSeconds || 120);
  const gitCommand = connector.gitCommand || "git";
  const dockerCommand = connector.dockerCommand || "docker";
  const composeFile = connector.composeFile || "docker-compose.yml";
  const serviceName = connector.serviceName;
  const gitRemote = connector.gitRemote || "origin";
  const gitBranch = connector.gitBranch || "main";
  const commandResults: Array<{ name: string; exitCode: number; output: string }> = [];
  const evidence = [
    `deployConnector=${connector.id}`,
    `deployConnectorType=${connector.type}`,
    `workingDir=${workingDir}`,
    `composeFile=${composeFile}`,
    ...(serviceName ? [`serviceName=${serviceName}`] : []),
    ...(input.artifacts.commitSha ? [`sourceCommit=${input.artifacts.commitSha}`] : []),
    ...(input.artifacts.tag ? [`sourceTag=${input.artifacts.tag}`] : [])
  ];
  const releaseKey = ecsDeployReleaseKey(input);
  evidence.push(`releaseKey=${releaseKey}`);
  const lock = connector.deployLock === false ? undefined : acquireEcsDeployLock(workingDir, connector, input, releaseKey);
  if (connector.deployLock !== false && !lock) {
    return ecsDeployResult(connector, "FAILED", evidence, commandResults, undefined, "deploy lock is already held");
  }
  if (lock) evidence.push(`deployLock=${lock.file}`);
  try {
    const before = await runBoundedCommand({
      command: gitCommand,
      args: ["rev-parse", "--short", "HEAD"],
      cwd: workingDir,
      timeoutSeconds
    });
    commandResults.push({ name: "git rev-parse", exitCode: before.exitCode, output: before.output });
    if (before.exitCode !== 0) {
      return ecsDeployResult(connector, "FAILED", evidence, commandResults, undefined, "git rev-parse failed");
    }
    const beforeCommit = before.output.trim().split(/\s+/)[0];
    evidence.push(`beforeCommit=${beforeCommit}`);
    const previousStamp = connector.idempotency === false ? undefined : readEcsDeployStamp(workingDir, connector);
    if (previousStamp?.releaseKey === releaseKey) {
      evidence.push("idempotentReplay=true", `idempotentDeploymentId=${previousStamp.deploymentId}`);
      return ecsDeployResult(connector, "SUCCEEDED", evidence, commandResults, previousStamp.deploymentId);
    }
    if (connector.gitPull !== false) {
      const preserved = await preserveEcsLocalPaths({
        connector,
        gitCommand,
        workingDir,
        timeoutSeconds,
        commandResults
      });
      if (preserved.status === "FAILED") {
        return ecsDeployResult(connector, "FAILED", evidence, commandResults, beforeCommit, preserved.failure);
      }
      evidence.push(...preserved.evidence);
      const pull = await runBoundedCommand({
        command: gitCommand,
        args: ["pull", "--ff-only", gitRemote, gitBranch],
        cwd: workingDir,
        timeoutSeconds
      });
      commandResults.push({ name: "git pull", exitCode: pull.exitCode, output: pull.output });
      if (pull.exitCode !== 0) {
        return ecsDeployResult(connector, "FAILED", evidence, commandResults, beforeCommit, "git pull failed");
      }
      const restored = await restoreEcsLocalPaths({
        gitCommand,
        workingDir,
        timeoutSeconds,
        commandResults,
        stashCreated: preserved.stashCreated
      });
      if (restored.status === "FAILED") {
        return ecsDeployResult(connector, "FAILED", evidence, commandResults, beforeCommit, restored.failure);
      }
      evidence.push(...restored.evidence);
    }
    const after = await runBoundedCommand({
      command: gitCommand,
      args: ["rev-parse", "--short", "HEAD"],
      cwd: workingDir,
      timeoutSeconds
    });
    commandResults.push({ name: "git rev-parse after", exitCode: after.exitCode, output: after.output });
    if (after.exitCode !== 0) {
      return ecsDeployResult(connector, "FAILED", evidence, commandResults, beforeCommit, "git rev-parse after failed");
    }
    const afterCommit = after.output.trim().split(/\s+/)[0];
    evidence.push(`afterCommit=${afterCommit}`);
    if (connector.skipComposeWhenUnchanged === true && afterCommit === beforeCommit) {
      evidence.push("composeSkipped=unchanged");
      if (connector.idempotency !== false) {
        writeEcsDeployStamp(workingDir, connector, {
          releaseKey,
          deploymentId: afterCommit,
          beforeCommit,
          afterCommit,
          loopId: input.loop.id,
          updatedAt: new Date().toISOString()
        });
        evidence.push("idempotencyStamp=written");
      }
      return ecsDeployResult(connector, "SUCCEEDED", evidence, commandResults, afterCommit);
    }
    const composeArgs = ["compose", "-f", composeFile, "up", "-d"];
    if (connector.build !== false) composeArgs.push("--build");
    if (serviceName) composeArgs.push(serviceName);
    const compose = await runBoundedCommand({
      command: dockerCommand,
      args: composeArgs,
      cwd: workingDir,
      timeoutSeconds
    });
    commandResults.push({ name: "docker compose up", exitCode: compose.exitCode, output: compose.output });
    if (compose.exitCode !== 0) {
      if (connector.rollbackOnFailure !== false) {
        const rollbackStatus = await rollbackEcsDockerComposeDeploy({
          connector,
          gitCommand,
          dockerCommand,
          composeArgs,
          workingDir,
          timeoutSeconds,
          beforeCommit,
          commandResults
        });
        evidence.push(`rollbackStatus=${rollbackStatus}`);
      }
      return ecsDeployResult(connector, "FAILED", evidence, commandResults, afterCommit, "docker compose up failed");
    }
    if (connector.idempotency !== false) {
      writeEcsDeployStamp(workingDir, connector, {
        releaseKey,
        deploymentId: afterCommit,
        beforeCommit,
        afterCommit,
        loopId: input.loop.id,
        updatedAt: new Date().toISOString()
      });
      evidence.push("idempotencyStamp=written");
    }
    return ecsDeployResult(connector, "SUCCEEDED", evidence, commandResults, afterCommit);
  } finally {
    if (lock) releaseEcsDeployLock(lock);
  }
}

async function rollbackEcsDockerComposeDeploy(args: {
  connector: StoredDeployConnector;
  gitCommand: string;
  dockerCommand: string;
  composeArgs: string[];
  workingDir: string;
  timeoutSeconds: number;
  beforeCommit: string;
  commandResults: Array<{ name: string; exitCode: number; output: string }>;
}): Promise<"SUCCEEDED" | "FAILED"> {
  const reset = await runBoundedCommand({
    command: args.gitCommand,
    args: ["reset", "--hard", args.beforeCommit],
    cwd: args.workingDir,
    timeoutSeconds: args.timeoutSeconds
  });
  args.commandResults.push({ name: "rollback git reset", exitCode: reset.exitCode, output: reset.output });
  if (reset.exitCode !== 0) return "FAILED";
  const compose = await runBoundedCommand({
    command: args.dockerCommand,
    args: args.composeArgs,
    cwd: args.workingDir,
    timeoutSeconds: args.timeoutSeconds
  });
  args.commandResults.push({ name: "rollback docker compose up", exitCode: compose.exitCode, output: compose.output });
  return compose.exitCode === 0 ? "SUCCEEDED" : "FAILED";
}

async function preserveEcsLocalPaths(args: {
  connector: StoredDeployConnector;
  gitCommand: string;
  workingDir: string;
  timeoutSeconds: number;
  commandResults: Array<{ name: string; exitCode: number; output: string }>;
}): Promise<{ status: "SUCCEEDED" | "FAILED"; stashCreated: boolean; evidence: string[]; failure?: string }> {
  const paths = normalizeStringList(args.connector.preserveLocalPaths, []);
  if (paths.length === 0) return { status: "SUCCEEDED", stashCreated: false, evidence: [] };
  const stash = await runBoundedCommand({
    command: args.gitCommand,
    args: ["stash", "push", "--include-untracked", "-m", `evopilot-preserve-${args.connector.id}`, "--", ...paths],
    cwd: args.workingDir,
    timeoutSeconds: args.timeoutSeconds
  });
  args.commandResults.push({ name: "git stash preserve-local-paths", exitCode: stash.exitCode, output: stash.output });
  if (stash.exitCode !== 0) {
    return { status: "FAILED", stashCreated: false, evidence: [`preserveLocalPaths=${paths.join(",")}`], failure: "git stash preserve-local-paths failed" };
  }
  const stashCreated = !/No local changes to save/i.test(stash.output);
  return {
    status: "SUCCEEDED",
    stashCreated,
    evidence: [
      `preserveLocalPaths=${paths.join(",")}`,
      `preserveLocalPathsStashed=${stashCreated}`
    ]
  };
}

async function restoreEcsLocalPaths(args: {
  gitCommand: string;
  workingDir: string;
  timeoutSeconds: number;
  commandResults: Array<{ name: string; exitCode: number; output: string }>;
  stashCreated: boolean;
}): Promise<{ status: "SUCCEEDED" | "FAILED"; evidence: string[]; failure?: string }> {
  if (!args.stashCreated) return { status: "SUCCEEDED", evidence: ["preserveLocalPathsRestored=false"] };
  const pop = await runBoundedCommand({
    command: args.gitCommand,
    args: ["stash", "pop"],
    cwd: args.workingDir,
    timeoutSeconds: args.timeoutSeconds
  });
  args.commandResults.push({ name: "git stash pop preserve-local-paths", exitCode: pop.exitCode, output: pop.output });
  if (pop.exitCode !== 0) {
    return { status: "FAILED", evidence: ["preserveLocalPathsRestored=false"], failure: "git stash pop preserve-local-paths failed" };
  }
  return { status: "SUCCEEDED", evidence: ["preserveLocalPathsRestored=true"] };
}

function ecsDeployReleaseKey(input: {
  loop: LoopRun;
  artifacts: LoopSourceClosure["artifacts"];
  parameters: Record<string, unknown>;
}): string {
  const explicit = optionalTrimmedString(input.parameters.releaseKey) ?? optionalTrimmedString(input.parameters.idempotencyKey);
  if (explicit) return explicit;
  return [
    input.loop.id,
    input.artifacts.commitSha ?? "no-source-commit",
    input.artifacts.tag ?? "no-tag",
    input.loop.sourceClosure.targetVersion ?? "no-target-version"
  ].join(":");
}

function ecsDeployRuntimeDir(workingDir: string, child: string): string {
  return path.join(workingDir, ".evopilot", child);
}

function acquireEcsDeployLock(
  workingDir: string,
  connector: StoredDeployConnector,
  input: { loop: LoopRun; actor: string },
  releaseKey: string
): { file: string } | undefined {
  const lockDir = ecsDeployRuntimeDir(workingDir, "deploy-locks");
  fs.mkdirSync(lockDir, { recursive: true });
  const file = path.join(lockDir, `${safeFileName(connector.id)}.lock`);
  try {
    const fd = fs.openSync(file, "wx");
    fs.writeFileSync(fd, JSON.stringify({
      connectorId: connector.id,
      loopId: input.loop.id,
      actor: input.actor,
      releaseKey,
      pid: process.pid,
      createdAt: new Date().toISOString()
    }, null, 2));
    fs.closeSync(fd);
    return { file };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
}

function releaseEcsDeployLock(lock: { file: string }): void {
  try {
    fs.unlinkSync(lock.file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

interface EcsDeployStamp {
  releaseKey: string;
  deploymentId: string;
  beforeCommit: string;
  afterCommit: string;
  loopId: string;
  updatedAt: string;
}

function ecsDeployStampFile(workingDir: string, connector: StoredDeployConnector): string {
  const stampDir = ecsDeployRuntimeDir(workingDir, "deploy-stamps");
  fs.mkdirSync(stampDir, { recursive: true });
  return path.join(stampDir, `${safeFileName(connector.id)}.json`);
}

function readEcsDeployStamp(workingDir: string, connector: StoredDeployConnector): EcsDeployStamp | undefined {
  const file = ecsDeployStampFile(workingDir, connector);
  if (!fs.existsSync(file)) return undefined;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return isRecord(value)
      && typeof value.releaseKey === "string"
      && typeof value.deploymentId === "string"
      && typeof value.beforeCommit === "string"
      && typeof value.afterCommit === "string"
      && typeof value.loopId === "string"
      && typeof value.updatedAt === "string"
      ? {
        releaseKey: value.releaseKey,
        deploymentId: value.deploymentId,
        beforeCommit: value.beforeCommit,
        afterCommit: value.afterCommit,
        loopId: value.loopId,
        updatedAt: value.updatedAt
      }
      : undefined;
  } catch {
    return undefined;
  }
}

function writeEcsDeployStamp(workingDir: string, connector: StoredDeployConnector, stamp: EcsDeployStamp): void {
  atomicWriteJson(ecsDeployStampFile(workingDir, connector), stamp);
}

function ecsDeployResult(
  connector: StoredDeployConnector,
  status: "SUCCEEDED" | "FAILED",
  evidence: string[],
  commandResults: Array<{ name: string; exitCode: number; output: string }>,
  deploymentId?: string,
  failure?: string
): {
  status: "SUCCEEDED" | "FAILED";
  deploymentId?: string;
  deploymentUrl?: string;
  statusUrl?: string;
  healthUrl?: string;
  readyUrl?: string;
  evidence: string[];
} {
  const deploymentUrl = connector.url;
  const healthUrl = joinUrlPath(deploymentUrl, connector.healthPath);
  const readyUrl = joinUrlPath(deploymentUrl, connector.readyPath);
  return {
    status,
    deploymentId,
    deploymentUrl,
    healthUrl,
    readyUrl,
    evidence: [
      ...evidence,
      `deployStatus=${status}`,
      ...(deploymentId ? [`deploymentId=${deploymentId}`] : []),
      ...(deploymentUrl ? [`deploymentUrl=${deploymentUrl}`] : []),
      ...(healthUrl ? [`healthUrl=${healthUrl}`] : []),
      ...(readyUrl ? [`readyUrl=${readyUrl}`] : []),
      ...(failure ? [`deployFailure=${failure}`] : []),
      ...commandEvidence(commandResults)
    ]
  };
}

function commandEvidence(commandResults: Array<{ name: string; exitCode: number; output: string }>): string[] {
  return commandResults.flatMap((result) => [
    `command.${safeFileName(result.name)}.exitCode=${result.exitCode}`,
    `command.${safeFileName(result.name)}.output=${truncateText(result.output, 500)}`
  ]);
}

function sourceClosureEvidenceStatus(state: LoopSourceClosureState): "PASS" | "FAIL" {
  return ["PROMOTED", "HEALTH_READY", "DEPLOYED", "TAGGED", "PUSHED", "CODE_CHANGED"].includes(state) ? "PASS" : "FAIL";
}

async function runBoundedCommand(args: { command: string; args: string[]; cwd: string; timeoutSeconds: number }): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(args.command, args.args, {
      cwd: args.cwd,
      shell: false,
      env: process.env
    });
    let output = "";
    const timer = setTimeout(() => {
      timedOut = true;
      output += "\n[evopilot] command timed out";
      child.kill("SIGTERM");
    }, Math.max(1, args.timeoutSeconds) * 1000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: 127, output: error.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: timedOut ? 124 : Number(code ?? 0), output: truncateText(output, 4000) });
    });
  });
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...[truncated]`;
}

function parseOptionalJson(text: string): any | undefined {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function joinUrlPath(baseUrl: string | undefined, suffix: string | undefined): string | undefined {
  if (!baseUrl || !suffix) return undefined;
  return `${baseUrl.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

async function ignoreAlreadyExists<T>(operation: () => Promise<T>): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/409|422|already exists|already_exist|already/i.test(message)) return undefined;
    throw error;
  }
}

function markGate(gateEvidence: LoopSourceClosure["gateEvidence"], gate: LoopSourceClosureGate, status: NonNullable<LoopSourceClosure["gateEvidence"][LoopSourceClosureGate]>["status"], evidence: string[], checkedAt: string): void {
  gateEvidence[gate] = { status, evidence, checkedAt };
}

function nextPendingGate(requiredGates: LoopSourceClosureGate[], gateEvidence: LoopSourceClosure["gateEvidence"]): LoopSourceClosureGate {
  return requiredGates.find((gate) => gateEvidence[gate]?.status !== "PASSED") ?? requiredGates[0] ?? "code-change";
}

function requiredSourceClosureGatesPassed(requiredGates: LoopSourceClosureGate[], gateEvidence: LoopSourceClosure["gateEvidence"]): boolean {
  return requiredGates.every((gate) => gateEvidence[gate]?.status === "PASSED" || gateEvidence[gate]?.status === "SKIPPED");
}

async function probeHealthReady(healthUrl?: string, readyUrl?: string): Promise<{ passed: boolean; evidence: string[] }> {
  const targets = [healthUrl, readyUrl].filter((item): item is string => Boolean(item));
  if (targets.length === 0) return { passed: false, evidence: ["healthUrl and readyUrl missing"] };
  const evidence: string[] = [];
  let passed = true;
  for (const target of targets) {
    try {
      const response = await fetch(target, { method: "GET" });
      evidence.push(`${target}=${response.status}`);
      if (!response.ok) passed = false;
    } catch (error) {
      passed = false;
      evidence.push(`${target}=${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { passed, evidence };
}

function executorBoundaryLabel(type: ExecutorNodeType): string {
  return ({
    llm: "EvoPilot LLM gateway boundary",
    "code-upgrader": "OpenHands/code-upgrader runtime boundary",
    ci: "Jenkins CI/CD connector boundary",
    validator: "independent validation boundary",
    approval: "human approval boundary",
    "release-action": "guarded release action boundary"
  })[type];
}

function decideLoopIteration(loop: LoopRun, nextIndex: number, steps: ExecutorStepResult[], evidenceSet: LoopEvidenceSet, forceDecision?: LoopDecision): LoopDecision {
  if (forceDecision === "REPAIR" || forceDecision === "FAIL") {
    const recentFailureCount = countRecentLoopFailure(loop) + 1;
    return recentFailureCount >= loop.stopPolicy.stopOnRepeatedFailure ? "BLOCK" : forceDecision;
  }
  if (forceDecision) return forceDecision;
  if (steps.some((step) => step.status === "WAITING_APPROVAL")) return "WAIT_APPROVAL";
  const failureCount = steps.filter((step) => step.status === "FAILED").length;
  if (failureCount > 0) {
    const recentFailureCount = countRecentLoopFailure(loop) + 1;
    return recentFailureCount >= loop.stopPolicy.stopOnRepeatedFailure ? "BLOCK" : "REPAIR";
  }
  if (evidenceSet.status === "PASS" && nextIndex >= loop.stopPolicy.maxIterations) return "SUCCEED";
  return "CONTINUE";
}

function countRecentLoopFailure(loop: LoopRun): number {
  let count = 0;
  for (const iteration of [...loop.iterations].reverse()) {
    if (iteration.decision === "REPAIR" || iteration.decision === "BLOCK" || iteration.decision === "FAIL") count += 1;
    else break;
  }
  return count;
}

function loopStatusFromDecision(decision: LoopDecision): LoopRunStatus {
  if (decision === "SUCCEED") return "SUCCEEDED";
  if (decision === "FAIL") return "FAILED";
  if (decision === "BLOCK") return "BLOCKED";
  if (decision === "WAIT_APPROVAL") return "WAITING_APPROVAL";
  return "RUNNING";
}

function loopDecisionRationale(decision: LoopDecision, failedSteps: ExecutorStepResult[]): string {
  if (decision === "CONTINUE") return "Loop evidence passed and stop policy has not been reached";
  if (decision === "SUCCEED") return "Loop reached objective stop policy with passing evidence";
  if (decision === "WAIT_APPROVAL") return "Human approval is required before release or high-risk continuation";
  if (decision === "REPAIR") return failedSteps[0]?.failureSignature ?? "Executor failure requires remediation";
  if (decision === "BLOCK") return "Repeated failure or stop policy blocked further automatic execution";
  return "Loop failed by explicit decision";
}

function loopTimelineEvent(type: LoopTimelineEvent["type"], message: string, metadata?: Record<string, unknown>): LoopTimelineEvent {
  return {
    id: `loop-event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    message,
    timestamp: new Date().toISOString(),
    metadata
  };
}

function loopArtifact(type: LoopArtifact["type"], label: string, artifactPath?: string, url?: string): LoopArtifact {
  return {
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    label,
    path: artifactPath,
    url,
    createdAt: new Date().toISOString()
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

function normalizeSoakReportStatus(value: unknown): SoakReport["status"] {
  const allowed: SoakReport["status"][] = ["RUNNING", "SUCCEEDED", "FAILED", "STOPPED"];
  if (allowed.includes(value as SoakReport["status"])) return value as SoakReport["status"];
  if (value === undefined || value === null || value === "") return "RUNNING";
  throw httpError(400, "SOAK_REPORT_STATUS_INVALID", `不支持的持续验证状态：${String(value)}`);
}

function normalizeReleaseTarget(value: unknown): ReleaseTargetProfile {
  if (!isRecord(value)) throw httpError(400, "RELEASE_TARGET_INVALID", "发布目标必须是对象。");
  const now = new Date().toISOString();
  const existing = value.id === "ga" ? defaultGAReleaseTarget() : undefined;
  const id = safeFileName(String(value.id ?? existing?.id ?? ""));
  if (!id) throw httpError(400, "RELEASE_TARGET_ID_REQUIRED", "发布目标必须包含 id。");
  const requiredScenarioIds = Array.isArray(value.requiredScenarioIds)
    ? value.requiredScenarioIds.map(String).map(safeFileName).filter(Boolean)
    : existing?.requiredScenarioIds ?? defaultGAReleaseTarget().requiredScenarioIds;
  return {
    id,
    name: String(value.name ?? existing?.name ?? id),
    description: String(value.description ?? existing?.description ?? "自定义发布目标"),
    minConnectedProjects: nonNegativeInteger(value.minConnectedProjects, existing?.minConnectedProjects ?? 1),
    minSucceededSoakSeconds: nonNegativeInteger(value.minSucceededSoakSeconds, existing?.minSucceededSoakSeconds ?? 0),
    requireActiveSoak: value.requireActiveSoak === undefined ? existing?.requireActiveSoak ?? false : Boolean(value.requireActiveSoak),
    minActiveSoakRunDelta: nonNegativeInteger(value.minActiveSoakRunDelta, existing?.minActiveSoakRunDelta ?? 1),
    minActiveSoakCodeUpgradeDelta: nonNegativeInteger(value.minActiveSoakCodeUpgradeDelta, existing?.minActiveSoakCodeUpgradeDelta ?? 1),
    minActiveSoakPipelineDelta: nonNegativeInteger(value.minActiveSoakPipelineDelta, existing?.minActiveSoakPipelineDelta ?? 1),
    minSuccessfulRuns: nonNegativeInteger(value.minSuccessfulRuns, existing?.minSuccessfulRuns ?? 1),
    minEvaluationDatasets: nonNegativeInteger(value.minEvaluationDatasets, existing?.minEvaluationDatasets ?? 1),
    minOpportunities: nonNegativeInteger(value.minOpportunities, existing?.minOpportunities ?? 1),
    minSuccessfulEvolutionBatches: nonNegativeInteger(value.minSuccessfulEvolutionBatches, existing?.minSuccessfulEvolutionBatches ?? 1),
    minSuccessfulCodeUpgrades: nonNegativeInteger(value.minSuccessfulCodeUpgrades, existing?.minSuccessfulCodeUpgrades ?? 1),
    minSuccessfulPipelines: nonNegativeInteger(value.minSuccessfulPipelines, existing?.minSuccessfulPipelines ?? 1),
    requiredScenarioIds,
    requireNoHighOpenRisks: value.requireNoHighOpenRisks === undefined ? existing?.requireNoHighOpenRisks ?? true : Boolean(value.requireNoHighOpenRisks),
    createdAt: value.createdAt ? String(value.createdAt) : existing?.createdAt ?? now,
    updatedAt: now
  };
}

function defaultGAReleaseTarget(): ReleaseTargetProfile {
  const now = "1970-01-01T00:00:00.000Z";
  return {
    id: "ga",
    name: "GA Release",
    description: "EvoPilot 生产 GA 发布目标，供 AI 或外部工具执行场景验证 loop 时作为统一判定标准。",
    minConnectedProjects: 5,
    minSucceededSoakSeconds: 90 * 60,
    requireActiveSoak: true,
    minActiveSoakRunDelta: 5,
    minActiveSoakCodeUpgradeDelta: 5,
    minActiveSoakPipelineDelta: 5,
    minSuccessfulRuns: 5,
    minEvaluationDatasets: 10,
    minOpportunities: 5,
    minSuccessfulEvolutionBatches: 5,
    minSuccessfulCodeUpgrades: 5,
    minSuccessfulPipelines: 5,
    requiredScenarioIds: [
      "normal-evolution-loop",
      "ci-cd-failure-recovery",
      "llm-failure-containment",
      "scm-failure-containment",
      "cost-slo-governance",
      "manual-approval",
      "multi-project-isolation",
      "restart-recovery",
      "rollback",
      "data-governance",
      "mainstream-loop-harness-alignment"
    ],
    requireNoHighOpenRisks: true,
    createdAt: now,
    updatedAt: now
  };
}

function releaseTargetFromProofOpsCore(targetId: string, proofOpsCore?: ProofOpsCoreContract): ReleaseTargetProfile | undefined {
  const coreTarget = proofOpsCore?.targets?.find((item) => item.id === targetId);
  if (!coreTarget) return undefined;
  const now = new Date().toISOString();
  return {
    id: safeFileName(coreTarget.id),
    name: coreTarget.title ?? coreTarget.id.toUpperCase(),
    description: `ProofOps Core target ${coreTarget.id} imported into EvoPilot ProofOps Mode.`,
    minConnectedProjects: targetId === "ga" ? 5 : 1,
    minSucceededSoakSeconds: targetId === "ga" ? 5400 : 0,
    requireActiveSoak: targetId === "ga",
    minActiveSoakRunDelta: targetId === "ga" ? 5 : 0,
    minActiveSoakCodeUpgradeDelta: targetId === "ga" ? 5 : 0,
    minActiveSoakPipelineDelta: targetId === "ga" ? 5 : 0,
    minSuccessfulRuns: targetId === "ga" ? 5 : 1,
    minEvaluationDatasets: targetId === "ga" ? 10 : 0,
    minOpportunities: targetId === "ga" ? 5 : 0,
    minSuccessfulEvolutionBatches: targetId === "ga" ? 5 : 0,
    minSuccessfulCodeUpgrades: targetId === "ga" ? 5 : 0,
    minSuccessfulPipelines: targetId === "ga" ? 5 : 0,
    requiredScenarioIds: [],
    requireNoHighOpenRisks: targetId === "ga",
    createdAt: now,
    updatedAt: now
  };
}

function buildProofOpsTargetPlan(args: {
  target: ReleaseTargetProfile;
  projectId: string;
  finalGoal?: string;
  proofOpsCore?: ProofOpsCoreContract;
}): TargetLoopRun["targetPlan"] {
  const { target, projectId } = args;
  const coreRequiredEvidence = args.proofOpsCore?.targets?.find((item) => item.id === target.id)?.requiredEvidence ?? [];
  return {
    finalGoal: args.finalGoal ?? `${projectId} reaches ${target.name} through a ProofOps target loop with real-boundary evidence.`,
    phaseGoals: [
      `target-readiness: confirm ${target.id} target plan and acceptance criteria`,
      "evidence-matrix: collect required release criteria and scenario evidence",
      "remediation-loop: route failed criteria to EvoPilot remediation and verification",
      "release-decision: produce GO, CONDITIONAL-GO, NO-GO, or BLOCKED with audit evidence"
    ],
    acceptanceCriteria: [
      `connectedProjects >= ${target.minConnectedProjects}`,
      `successfulRuns >= ${target.minSuccessfulRuns}`,
      `successfulEvolutionBatches >= ${target.minSuccessfulEvolutionBatches}`,
      `successfulCodeUpgrades >= ${target.minSuccessfulCodeUpgrades}`,
      `successfulPipelines >= ${target.minSuccessfulPipelines}`,
      `requiredScenarios pass: ${target.requiredScenarioIds.join(", ")}`,
      ...(coreRequiredEvidence.length > 0 ? coreRequiredEvidence : []),
      args.proofOpsCore?.productionReleaseEvidenceRule ?? "mock, fake, stub, simulator, fixture-only, demo-only, smoke-only, or chat-only evidence is not accepted as release evidence"
    ],
    finalDecision: ["GO", "CONDITIONAL-GO", "NO-GO", "BLOCKED"],
    source: "proofops-core-compatible",
    proofOpsCoreVersion: args.proofOpsCore?.version
  };
}

function buildProofOpsFinalReport(args: {
  loop: TargetLoopRun;
  matrix: TargetLoopEvidenceRow[];
  decisionChain: TargetLoopDecisionStep[];
  releaseDecision?: TargetLoopRun["releaseDecision"];
}): NonNullable<TargetLoopRun["finalReport"]> {
  const required = args.matrix.filter((row) => row.required);
  const passed = required.filter((row) => row.status === "PASS");
  const failedOrBlocked = required.filter((row) => row.status !== "PASS");
  const finalDecision = args.releaseDecision?.status ?? "BLOCKED";
  const targetReached = args.releaseDecision?.targetReached === true;
  return {
    schema: "proofops-final-release-report/v1",
    projectId: args.loop.projectId,
    releaseTarget: args.loop.releaseTarget,
    lifecycleId: args.loop.id,
    terminalReason: targetReached ? "release-target-reached" : "target-loop-not-reached",
    generatedAt: new Date().toISOString(),
    targetPlan: args.loop.targetPlan,
    targetPlanConfirmation: args.loop.targetPlanConfirmation,
    releaseDecision: args.releaseDecision,
    finalTargetSummary: {
      finalGoal: args.loop.targetPlan.finalGoal,
      finalDecision,
      targetReached,
      latestCoverage: {
        required: required.length,
        passed: passed.length,
        failedOrBlocked: failedOrBlocked.length
      },
      blocker: failedOrBlocked[0]?.blocker ?? "",
      conclusion: targetReached
        ? `${args.loop.releaseTarget} target reached.`
        : `${args.loop.releaseTarget} target not reached; route blockers through EvoPilot remediation and resume the target loop.`
    },
    coverageMatrix: args.matrix,
    decisionChain: args.decisionChain,
    productionReleaseRule: args.loop.targetPlan.acceptanceCriteria.find((item) => item.startsWith("No mock")) ?? "No mock, fake, stub, simulator, fixture-only, demo-only, smoke-only, or chat-only evidence is counted as production release proof."
  };
}

function loadProofOpsCoreContract(configuredPath?: string): ProofOpsCoreContract | undefined {
  const candidates = [
    configuredPath,
    process.env.EVOPILOT_PROOFOPS_CORE_CONTRACT,
    "/Users/wangyejing/github/ProofOps/dist/proofops-core-contract.json"
  ].filter((item): item is string => Boolean(item));
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as ProofOpsCoreContract;
      if (parsed.schema === "proofops-core-contract/v1") return parsed;
    } catch {
      continue;
    }
  }
  return undefined;
}

function parseConversationCommand(body: any): {
  kind: "create-target-loop";
  channel: string;
  conversationId: string;
  text: string;
  projectId: string;
  targetId: string;
  finalGoal?: string;
  candidate?: string;
} {
  const text = String(body.text ?? "").trim();
  if (!text) throw httpError(400, "CONVERSATION_TEXT_REQUIRED", "conversation command text is required");
  const targetId = safeFileName(String(body.targetId ?? inferTargetIdFromText(text) ?? "ga"));
  const projectId = safeFileName(String(body.projectId ?? inferProjectIdFromText(text) ?? "default-project"));
  return {
    kind: "create-target-loop",
    channel: String(body.channel ?? "codex"),
    conversationId: String(body.conversationId ?? `conversation-${Date.now()}`),
    text,
    projectId,
    targetId,
    finalGoal: body.finalGoal ? String(body.finalGoal) : `${projectId} reaches ${targetId.toUpperCase()} through EvoPilot ProofOps Mode.`,
    candidate: body.candidate ? String(body.candidate) : undefined
  };
}

function extractImText(body: any): string {
  const candidates = [
    body.text,
    body.content,
    body.event?.message?.content,
    body.event?.message?.text,
    body.message?.content,
    body.message?.text
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed.text === "string") return parsed.text;
        if (typeof parsed.content === "string") return parsed.content;
      } catch {
        return candidate;
      }
    }
  }
  return "";
}

function extractImConversationId(body: any, channel: string): string {
  return String(
    body.conversationId ??
    body.event?.message?.chat_id ??
    body.event?.message?.message_id ??
    body.chat_id ??
    body.msgid ??
    `${channel}-${Date.now()}`
  );
}

function inferTargetIdFromText(text: string): string | undefined {
  const normalized = text.toLowerCase();
  for (const target of ["demo-to-alpha", "alpha", "beta", "rc", "ga"]) {
    if (normalized.includes(target)) return target;
  }
  if (text.includes("发布") || text.includes("成熟度")) return "ga";
  return undefined;
}

function inferProjectIdFromText(text: string): string | undefined {
  const match = text.match(/(?:project|项目|产品)\s*[:：]?\s*([A-Za-z0-9_-]+)/);
  return match?.[1];
}

function numericCriterion(id: string, name: string, actual: number, target: number, evidence: string[]): ReleaseDecisionCriterion {
  return { id, name, status: actual >= target ? "PASS" : "FAIL", actual, target, evidence, required: true };
}

function booleanCriterion(id: string, name: string, actual: boolean, target: boolean, evidence: string[]): ReleaseDecisionCriterion {
  return { id, name, status: actual === target ? "PASS" : "FAIL", actual, target, evidence, required: true };
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeScenarioMatrix(value: unknown): ReleaseScenarioResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const now = new Date().toISOString();
  return value.map((item: any) => {
    const id = safeFileName(String(item.id ?? item.name ?? ""));
    if (!id) throw httpError(400, "RELEASE_SCENARIO_ID_REQUIRED", "发布场景必须包含 id 或 name。");
    return {
      id,
      name: String(item.name ?? id),
      status: normalizeReleaseScenarioStatus(item.status),
      evidence: Array.isArray(item.evidence) ? item.evidence.map(String) : item.evidence ? [String(item.evidence)] : [],
      required: item.required === undefined ? true : Boolean(item.required),
      updatedAt: item.updatedAt ? String(item.updatedAt) : now
    };
  });
}

function normalizeReleaseScenarioStatus(value: unknown): ReleaseScenarioStatus {
  const allowed: ReleaseScenarioStatus[] = ["PASS", "FAIL", "NOT-RUN", "NOT-APPLICABLE"];
  if (allowed.includes(value as ReleaseScenarioStatus)) return value as ReleaseScenarioStatus;
  throw httpError(400, "RELEASE_SCENARIO_STATUS_INVALID", `不支持的发布场景状态：${String(value)}`);
}

function defaultReleaseScenarioMatrix(args: {
  pipelines: PipelineRun[];
  codeUpgrades: CodeUpgradeRun[];
  projects: StoredProject[];
  summary: Record<string, unknown>;
  now: string;
}): ReleaseScenarioResult[] {
  const { pipelines, codeUpgrades, projects, summary, now } = args;
  const succeededPipelineCount = pipelines.filter((pipeline) => pipeline.status === "SUCCEEDED").length;
  const failedPipelineCount = pipelines.filter((pipeline) => pipeline.status === "FAILED").length;
  const successfulUpgradeCount = codeUpgrades.filter((upgrade) => upgrade.status === "SUCCEEDED").length;
  const projectCount = projects.length;
  const frozenProjectCount = Number(summary.frozenProjectCount ?? 0);
  const activeBatchCount = Number(summary.activeEvolutionBatchCount ?? 0);
  const successfulBatchCount = Number(summary.successfulEvolutionBatchCount ?? 0);
  const governanceHealthy = Number(summary.failedPolicyCount ?? 0) === 0 &&
    Number(summary.sloHealth ?? 100) >= 99 &&
    Number(summary.errorBudgetRemaining ?? 100) >= 70 &&
    Number(summary.costHealth ?? 100) >= 90 &&
    Number(summary.releaseBlockedCount ?? 0) === 0 &&
    Number(summary.rolloutBlockedCount ?? 0) === 0;
  const normalLoopPassed = Number(summary.runCount ?? 0) > 0 &&
    Number(summary.evaluationDatasetCount ?? 0) > 0 &&
    Number(summary.opportunityCount ?? 0) > 0 &&
    successfulUpgradeCount > 0 &&
    succeededPipelineCount > 0 &&
    successfulBatchCount > 0;
  return [
    scenario("normal-evolution-loop", "正常进化闭环", normalLoopPassed ? "PASS" : "NOT-RUN", [
      `runs=${summary.runCount ?? 0}`,
      `datasets=${summary.evaluationDatasetCount ?? 0}`,
      `opportunities=${summary.opportunityCount ?? 0}`,
      `successfulCodeUpgrades=${successfulUpgradeCount}`,
      `successfulPipelines=${succeededPipelineCount}`,
      `successfulBatches=${successfulBatchCount}`
    ], true, now),
    scenario("ci-cd-failure-recovery", "CI/CD 失败恢复", failedPipelineCount > 0 ? "PASS" : "NOT-RUN", [
      `failedPipelines=${failedPipelineCount}`,
      `laterSuccessfulPipelines=${pipelines.filter((pipeline) => pipeline.status === "SUCCEEDED" && pipelines.some((failed) => failed.status === "FAILED" && failed.projectId === pipeline.projectId && failed.triggeredAt <= pipeline.triggeredAt)).length}`
    ], true, now),
    scenario("llm-failure-containment", "LLM 失败隔离", "NOT-RUN", ["未从当前持久化数据中发现 LLM 失败隔离证据。"], true, now),
    scenario("scm-failure-containment", "SCM 失败隔离", "NOT-RUN", ["未从当前持久化数据中发现 SCM 失败隔离证据。"], true, now),
    scenario("cost-slo-governance", "成本/SLO 治理", governanceHealthy || frozenProjectCount > 0 || Number(summary.releaseBlockedCount ?? 0) > 0 || Number(summary.rolloutBlockedCount ?? 0) > 0 ? "PASS" : "NOT-RUN", [
      `frozenProjects=${frozenProjectCount}`,
      `releaseBlocked=${summary.releaseBlockedCount ?? 0}`,
      `rolloutBlocked=${summary.rolloutBlockedCount ?? 0}`,
      `failedPolicies=${summary.failedPolicyCount ?? 0}`,
      `sloHealth=${summary.sloHealth ?? 100}`,
      `errorBudgetRemaining=${summary.errorBudgetRemaining ?? 100}`,
      `costHealth=${summary.costHealth ?? 100}`
    ], true, now),
    scenario("manual-approval", "人工审批门禁", Number(summary.confirmedReviewCount ?? 0) > 0 || Number(summary.pendingReviewCount ?? 0) > 0 ? "PASS" : "NOT-RUN", [
      `confirmedReviews=${summary.confirmedReviewCount ?? 0}`,
      `pendingReviews=${summary.pendingReviewCount ?? 0}`
    ], true, now),
    scenario("multi-project-isolation", "多项目隔离", projectCount >= 2 && Number(summary.runCount ?? 0) >= projectCount ? "PASS" : "NOT-RUN", [
      `projects=${projectCount}`,
      `runs=${summary.runCount ?? 0}`
    ], true, now),
    scenario("restart-recovery", "重启恢复", activeBatchCount === 0 && Number(summary.failedEvolutionBatchCount ?? 0) >= 0 ? "PASS" : "NOT-RUN", [
      `activeBatches=${activeBatchCount}`,
      `failedBatches=${summary.failedEvolutionBatchCount ?? 0}`
    ], true, now),
    scenario("rollback", "回滚路径", "NOT-RUN", ["未从当前持久化数据中发现真实 rollback 证据。"], true, now),
    scenario("data-governance", "数据治理", Number(summary.projectCount ?? 0) >= 0 && Array.isArray(summary.recentSoakReports) ? "PASS" : "NOT-RUN", [
      `soakReports=${Array.isArray(summary.recentSoakReports) ? summary.recentSoakReports.length : 0}`,
      "release evidence is generated without secrets"
    ], true, now),
    scenario("mainstream-loop-harness-alignment", "主流 Loop Harness 对齐", "NOT-RUN", [
      "未提供 LangGraph/CrewAI/AutoGen/OpenAI Agents SDK/E2B/Temporal/DBOS 等主流 Agent/Loop Harness 对齐证据。",
      "GA stable 需要证明 durable execution、checkpoint/persistence、human-in-loop、sandbox、multi-executor coordination、streaming trace、guardrails 和 source-to-production closure 已覆盖。"
    ], true, now)
  ];
}

function scenario(id: string, name: string, status: ReleaseScenarioStatus, evidence: string[], required: boolean, updatedAt: string): ReleaseScenarioResult {
  return { id, name, status, evidence, required, updatedAt };
}

function mergeScenarioMatrix(defaults: ReleaseScenarioResult[], overrides: ReleaseScenarioResult[], now: string): ReleaseScenarioResult[] {
  const merged = new Map(defaults.map((item) => [item.id, item]));
  for (const override of overrides) {
    const existing = merged.get(override.id);
    merged.set(override.id, {
      ...existing,
      ...override,
      name: override.name ?? existing?.name ?? override.id,
      evidence: [...new Set([...(existing?.evidence ?? []), ...override.evidence])],
      required: override.required,
      updatedAt: override.updatedAt ?? now
    });
  }
  return [...merged.values()];
}

function alignScenarioMatrixToReleaseTarget(matrix: ReleaseScenarioResult[], target: ReleaseTargetProfile, now: string): ReleaseScenarioResult[] {
  const requiredScenarioIds = new Set(target.requiredScenarioIds);
  if (target.id === "ga") return matrix.map((item) => ({ ...item, required: requiredScenarioIds.has(item.id) || item.required }));
  return matrix.map((item) => {
    if (requiredScenarioIds.has(item.id)) return { ...item, required: true };
    return {
      ...item,
      status: item.status === "PASS" ? "PASS" : "NOT-APPLICABLE",
      required: false,
      evidence: [
        ...item.evidence,
        `notApplicableForTarget=${target.id}`,
        "legacy GA scenario is retained for audit history but is not a release blocker for the current SaaS multi-tenant target"
      ],
      updatedAt: item.updatedAt ?? now
    };
  });
}

function releaseEvidenceListItem(bundle: ReleaseEvidenceBundle): ReleaseEvidenceListItem {
  const summary = bundle.summary ?? {};
  return {
    id: bundle.id,
    tenantId: bundle.tenantId,
    workspaceId: bundle.workspaceId,
    candidate: bundle.candidate,
    status: bundle.status,
    releaseTargetId: bundle.releaseTargetId,
    releaseDecisionId: bundle.releaseDecisionId,
    generatedAt: bundle.generatedAt,
    summary: {
      projectCount: Number(summary.projectCount ?? 0),
      runCount: Number(summary.runCount ?? 0),
      releaseReadinessScore: Number(summary.releaseReadinessScore ?? 0),
      releaseBlockedCount: Number(summary.releaseBlockedCount ?? 0),
      rolloutBlockedCount: Number(summary.rolloutBlockedCount ?? 0),
      releaseDecisionCount: Number(summary.releaseDecisionCount ?? 0),
      latestReleaseDecisionId: isRecord(summary.latestReleaseDecision) ? String(summary.latestReleaseDecision.id ?? "") || undefined : undefined
    },
    scenarioSummary: {
      total: bundle.scenarioMatrix.length,
      passed: bundle.scenarioMatrix.filter((scenarioItem) => scenarioItem.status === "PASS").length,
      failed: bundle.scenarioMatrix.filter((scenarioItem) => scenarioItem.status === "FAIL").length,
      notRun: bundle.scenarioMatrix.filter((scenarioItem) => scenarioItem.status === "NOT-RUN").length,
      requiredFailed: bundle.scenarioMatrix.filter((scenarioItem) => scenarioItem.required && (scenarioItem.status === "FAIL" || scenarioItem.status === "NOT-RUN")).length
    },
    riskSummary: {
      total: bundle.riskRegister.length,
      open: bundle.riskRegister.filter((risk) => risk.status === "OPEN").length,
      highOpen: bundle.riskRegister.filter((risk) => risk.status === "OPEN" && (risk.severity === "HIGH" || risk.severity === "CRITICAL")).length
    },
    createdAt: bundle.createdAt,
    updatedAt: bundle.updatedAt
  };
}

function sanitizeRunForSummary(run: StoredRun): StoredRun {
  return {
    ...run,
    pipelineRuns: run.pipelineRuns?.map(sanitizePipelineRun)
  };
}

function sanitizePipelineRun(pipeline: PipelineRun): PipelineRun {
  return {
    ...pipeline,
    parameters: redactSensitiveRecord(pipeline.parameters),
    logRef: pipeline.logRef
      ? {
          ...pipeline.logRef,
          preview: pipeline.logRef.preview ? redactSensitiveText(pipeline.logRef.preview) : undefined
        }
      : undefined
  };
}

function compactReleaseEvidenceSummary(summary: Record<string, unknown>): Record<string, unknown> {
  const scalarKeys = [
    "projectCount",
    "runCount",
    "pipelineCount",
    "evaluationDatasetCount",
    "evolutionBatchCount",
    "activeEvolutionBatchCount",
    "costOptimizationEvolutionBatchCount",
    "successfulEvolutionBatchCount",
    "failedEvolutionBatchCount",
    "frozenProjectCount",
    "costOptimizationReadyCount",
    "selfLearningDatasetCount",
    "opportunityInsightCount",
    "opportunityInsightQuality",
    "learningRecordCount",
    "serviceScorecardCount",
    "averageServiceScore",
    "sloHealth",
    "errorBudgetRemaining",
    "failedPolicyCount",
    "supplyChainRiskCount",
    "costRiskCount",
    "costHealth",
    "releaseReadyCount",
    "releaseBlockedCount",
    "releaseReadinessScore",
    "canaryReadyCount",
    "rolloutBlockedCount",
    "codeUpgradeCount",
    "runningCodeUpgradeCount",
    "runningPipelineCount",
    "opportunityCount",
    "pendingReviewCount",
    "confirmedReviewCount",
    "releaseCount",
    "releaseHealth",
    "releaseTargetCount",
    "releaseDecisionCount"
  ];
  const compact: Record<string, unknown> = {};
  for (const key of scalarKeys) compact[key] = summary[key];
  for (const key of [
    "evolutionFreezes",
    "recentOpportunityInsights",
    "serviceScorecards",
    "sloReports",
    "policyEvaluations",
    "supplyChainReports",
    "costReports",
    "releaseReadiness",
    "rolloutStrategies",
    "recentEvolutionBatches",
    "recentSoakReports",
    "recentReleaseEvidence",
    "latestReleaseDecision"
  ]) {
    if (summary[key] !== undefined) compact[key] = summary[key];
  }
  return JSON.parse(JSON.stringify(compact, (_key, value) => {
    if (typeof value === "string") return redactSensitiveText(value);
    return value;
  })) as Record<string, unknown>;
}

function redactSensitiveRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [
    key,
    isSensitiveKey(key) ? "[REDACTED]" : redactSensitiveText(value)
  ]));
}

function isSensitiveKey(key: string): boolean {
  return /token|password|secret|credential|apikey|api_key/i.test(key);
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(/glpat-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(token|password|secret|credential|api[_-]?key)([=:\s]+)([^\\s"',}]+)/gi, "$1$2[REDACTED]");
}

function runFinishedAt(runs: StoredRun[], evidenceBundleId: string): string {
  return runs.find((run) => run.evidenceBundle.id === evidenceBundleId)?.evidenceBundle.timeWindow.to ?? new Date(0).toISOString();
}

function isActiveSoakReport(report: SoakReport, target: ReleaseTargetProfile): boolean {
  if (!target.requireActiveSoak) return true;
  const summary = report.summary ?? {};
  if (summary.requireActivity !== true) return false;
  const activity = isRecord(summary.activity) ? summary.activity : {};
  const runDelta = Number(activity.runDelta ?? 0);
  const codeUpgradeDelta = Number(activity.codeUpgradeDelta ?? 0);
  const pipelineDelta = Number(activity.pipelineDelta ?? 0);
  return runDelta >= (target.minActiveSoakRunDelta ?? 1) &&
    codeUpgradeDelta >= (target.minActiveSoakCodeUpgradeDelta ?? 1) &&
    pipelineDelta >= (target.minActiveSoakPipelineDelta ?? 1);
}

function hasLaterSuccessfulPipeline(failed: PipelineRun, pipelines: PipelineRun[]): boolean {
  return pipelines.some((pipeline) =>
    pipeline.projectId === failed.projectId &&
    pipeline.status === "SUCCEEDED" &&
    Date.parse(pipeline.triggeredAt) >= Date.parse(failed.triggeredAt)
  );
}

function hasLaterSuccessfulCodeUpgrade(failed: CodeUpgradeRun, upgrades: CodeUpgradeRun[]): boolean {
  return upgrades.some((upgrade) =>
    upgrade.projectId === failed.projectId &&
    upgrade.status === "SUCCEEDED" &&
    Date.parse(upgrade.updatedAt) >= Date.parse(failed.updatedAt)
  );
}

function dedupeReleaseRisks(risks: ReleaseRisk[]): ReleaseRisk[] {
  const seen = new Map<string, ReleaseRisk>();
  for (const risk of risks) {
    const existing = seen.get(risk.id);
    if (!existing) {
      seen.set(risk.id, risk);
      continue;
    }
    existing.evidence = [...new Set([...existing.evidence, ...risk.evidence])];
    existing.severity = releaseRiskRank(risk.severity) > releaseRiskRank(existing.severity) ? risk.severity : existing.severity;
    existing.status = existing.status === "OPEN" || risk.status === "OPEN" ? "OPEN" : existing.status;
  }
  return [...seen.values()].sort((left, right) => releaseRiskRank(right.severity) - releaseRiskRank(left.severity) || left.id.localeCompare(right.id));
}

function releaseRiskRank(severity: ReleaseRisk["severity"]): number {
  return ({ LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 })[severity];
}

function inferReleaseArtifactType(artifactPath: string): ReleaseEvidenceBundle["artifacts"][number]["type"] {
  if (/\.(png|jpg|jpeg|webp)$/i.test(artifactPath)) return "dashboard";
  if (/\.(log|jsonl|txt)$/i.test(artifactPath)) return "log";
  return "other";
}

function isDatasetAfterCursor(dataset: EvaluationDataset, cursor: ProjectEvolutionCursor): boolean {
  if (!cursor.lastProcessedDatasetTriggeredAt) return true;
  if (dataset.triggeredAt > cursor.lastProcessedDatasetTriggeredAt) return true;
  return dataset.triggeredAt === cursor.lastProcessedDatasetTriggeredAt && !cursor.lastProcessedDatasetIds.includes(dataset.id);
}

function isStaleEvolutionBatch(batch: EvolutionBatch, now: string, timeoutMinutes: number): boolean {
  const timeoutMs = Math.max(1, timeoutMinutes) * 60 * 1000;
  const lastProgressMs = Date.parse(batch.updatedAt || batch.createdAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(lastProgressMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - lastProgressMs >= timeoutMs;
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
    intent: datasets.every((dataset) => isCostOptimizationDataset(dataset, runs)) ? "cost-optimization" : "standard-evolution",
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

function isCostOptimizationDataset(dataset: EvaluationDataset, runs: StoredRun[]): boolean {
  if (dataset.learningSignal === "cost-regression") return true;
  if (/cost|成本|token/i.test(`${dataset.name} ${dataset.metric} ${dataset.scope}`)) return true;
  const opportunityIds = new Set(dataset.opportunityIds ?? []);
  return runs
    .filter((run) => run.evidenceBundle.projectId === dataset.projectId)
    .flatMap((run) => run.opportunities)
    .filter((opportunity) => opportunityIds.has(opportunity.id))
    .some((opportunity) => opportunity.type === "cost-risk" || opportunity.failureAttribution === "cost-regression");
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
  const { store, auth, run, delivery, plan, review, body, profile, runtime } = args;
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
  const codeContext = await collectProjectCodeContext({ project, runtime, profile, focusFiles: codeUpgradeFocusFiles(run) });
  if (runtime.mode === "prod" && codeContext.status !== "AVAILABLE") {
    throw new Error(`PROJECT_CODE_CONTEXT_UNAVAILABLE: ${codeContext.unavailableReason ?? codeContext.summary}`);
  }
  const allowedPaths = inferCodeUpgradeAllowedPaths(codeContext, codeUpgradeFocusFiles(run));
  const branchStrategy = createBranchStrategy({ projectId: delivery.projectId, sourceBranch: project?.repository?.defaultBranch, delivery, plan, body });
  logInfo("code-upgrade.starting", {
    actor: auth.actor,
    target: delivery.id,
    metadata: {
      projectId: delivery.projectId,
      connectorId,
      planId: plan.id,
      reviewId: review?.id,
      sourceBranch: branchStrategy.sourceBranch,
      upgradeBranch: branchStrategy.upgradeBranch,
      validationCommandCount: validationCommands.length,
      allowedPaths
    }
  });
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
  logInfo("code-upgrade.started", {
    actor: auth.actor,
    target: codeUpgrade.id,
    metadata: {
      projectId: codeUpgrade.projectId,
      deliveryPlanId: delivery.id,
      connectorId,
      conversationId: session.conversationId,
      status: codeUpgrade.status
    }
  });
  return refreshCodeUpgradeRun(store, codeUpgrade.id).then((updated) => updated ?? codeUpgrade);
}

function codeUpgradeBlockingDiagnostic(diagnostic: ProjectRuntimeDiagnostic): ProjectRuntimeDiagnostic["checks"][number] | undefined {
  return diagnostic.checks.find((check) => check.status === "FAILED" && [
    "项目注册验证",
    "服务验证编排",
    "代码升级运行时"
  ].includes(check.name));
}

function inferCodeUpgradeAllowedPaths(codeContext: ProjectCodeContext, focusFiles: string[] = []): string[] {
  const base = new Set([".evopilot/runtime-upgrades", "docs/evopilot-upgrades"]);
  for (const file of focusFiles) {
    const pathName = normalizeRelativePathForPolicy(file);
    if (!pathName || pathName.startsWith("docs/") || pathName.startsWith(".evopilot/")) continue;
    const first = pathName.split("/")[0];
    if (["node_modules", "dist", "build", "target", ".git", ".venv", "__pycache__"].includes(first)) continue;
    if (pathName.includes("/")) base.add(first);
    else base.add(pathName);
  }
  if (codeContext.status !== "AVAILABLE") return [...base];
  for (const root of codeContext.writableRoots ?? []) base.add(root);
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

function codeUpgradeFocusFiles(run: StoredRun): string[] {
  return uniqueNormalizedPaths(run.impactMaps.flatMap((impactMap) => [
    ...impactMap.likelyFiles,
    ...impactMap.relatedTests
  ]));
}

function uniqueNormalizedPaths(paths: string[]): string[] {
  return [...new Set(paths.map(normalizeRelativePathForPolicy).filter(Boolean))];
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
  if (updated.status !== run.status) {
    logInfo("code-upgrade.status-changed", {
      target: updated.id,
      metadata: {
        projectId: updated.projectId,
        deliveryPlanId: updated.deliveryPlanId,
        previousStatus: run.status,
        status: updated.status,
        conversationId: updated.openhands.conversationId,
        changedFileCount: updated.artifacts.changedFiles?.length ?? 0,
        commitSha: updated.artifacts.commitSha,
        pullRequestUrl: updated.artifacts.pullRequestUrl,
        failureReason: updated.failureReason,
        error: updated.error
      }
    });
  }
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

function maskDeployConnector(connector: StoredDeployConnector): Omit<StoredDeployConnector, "token"> & { tokenConfigured: boolean } {
  const { token, ...safe } = connector;
  return { ...safe, tokenConfigured: Boolean(token || connector.tokenRef) };
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
  focusFiles?: string[];
}): Promise<ProjectCodeContext> {
  const project = args.project;
  if (!project) return unavailableProjectCodeContext("unknown", "项目未注册，无法读取当前代码基线。");
  if (!project.repository) return unavailableProjectCodeContext(project.id, "项目未配置 Git 仓库，无法读取当前代码基线。");
  if (project.validation.status !== "VERIFIED") return unavailableProjectCodeContext(project.id, `项目注册未验证通过：${project.validation.message}`);

  if (project.repository.provider === "local-git") {
    if (!project.repository.root) return unavailableProjectCodeContext(project.id, "local-git 项目缺少 repository.root。");
    return collectCodeContextFromWorktree({ project, repoRoot: project.repository.root, source: "local-git", profile: args.profile, focusFiles: args.focusFiles });
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
    return await collectCodeContextFromWorktree({ project, repoRoot, source: "git-clone", profile: args.profile, focusFiles: args.focusFiles });
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
  focusFiles?: string[];
}): Promise<ProjectCodeContext> {
  if (!fs.existsSync(args.repoRoot)) return unavailableProjectCodeContext(args.project.id, `代码目录不存在：${args.repoRoot}`);
  const branch = await gitOutput(["-C", args.repoRoot, "rev-parse", "--abbrev-ref", "HEAD"]).catch(() => args.project.repository?.defaultBranch ?? "unknown");
  const commitSha = await gitOutput(["-C", args.repoRoot, "rev-parse", "HEAD"]).catch(() => undefined);
  const trackedFiles = await listTrackedFiles(args.repoRoot);
  const selectedPaths = selectCodeContextFiles(trackedFiles, args.profile.policy.protectedPaths, args.focusFiles);
  const selectedFiles = selectedPaths.map((relativePath) => readContextFile(args.repoRoot, relativePath)).filter(Boolean) as ProjectCodeContext["selectedFiles"];
  if (selectedFiles.length === 0) return unavailableProjectCodeContext(args.project.id, "当前代码基线没有可用于架构分析的文本文件。");
  const writableRoots = inferWritableCodeRoots(trackedFiles, args.profile.policy.protectedPaths);
  return {
    status: "AVAILABLE",
    source: args.source,
    projectId: args.project.id,
    branch: branch?.trim() || args.project.repository?.defaultBranch,
    commitSha: commitSha?.trim(),
    fileCount: trackedFiles.length,
    writableRoots,
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

function selectCodeContextFiles(files: string[], protectedPaths: string[], focusFiles: string[] = []): string[] {
  const textFiles = files
    .filter((file) => isContextTextFile(file))
    .filter((file) => !protectedPaths.some((protectedPath) => isUnder(file, protectedPath)))
    .filter((file) => !/(^|\/)(node_modules|dist|build|target|\.git|\.venv|__pycache__)\//.test(file));
  const available = new Set(textFiles);
  const focused = uniqueNormalizedPaths(focusFiles)
    .filter((file) => available.has(file))
    .slice(0, 6);
  const priority = (file: string): number => {
    const name = path.basename(file).toLowerCase();
    if (["readme.md", "package.json", "pyproject.toml", "requirements.txt", "pom.xml", "go.mod", "dockerfile", "jenkinsfile"].includes(name)) return 0;
    if (/^(app|main|server|index)\.(py|js|ts|mjs|java|go)$/.test(name)) return 1;
    if (file.startsWith("src/") || file.startsWith("app/") || file.startsWith("server/")) return 2;
    if (file.startsWith("tests/") || file.startsWith("test/") || file.startsWith("scripts/")) return 3;
    if (file.startsWith("docs/")) return 4;
    return 5;
  };
  const general = textFiles
    .filter((file) => !focused.includes(file))
    .sort((a, b) => priority(a) - priority(b) || a.localeCompare(b))
    .slice(0, 10 - focused.length);
  return [...focused, ...general];
}

function inferWritableCodeRoots(files: string[], protectedPaths: string[]): string[] {
  const denied = new Set([".git", ".github", ".idea", ".vscode", ".venv", "__pycache__", "build", "dist", "docs", "node_modules", "target"]);
  const roots = new Map<string, { sourceLike: boolean; buildLike: boolean }>();
  for (const file of files.map(normalizeRelativePathForPolicy).filter(Boolean)) {
    if (protectedPaths.some((protectedPath) => isUnder(file, protectedPath))) continue;
    const [root, ...rest] = file.split("/");
    if (!root || denied.has(root) || rest.length === 0) continue;
    const name = rest.at(-1)?.toLowerCase() ?? "";
    const state = roots.get(root) ?? { sourceLike: false, buildLike: false };
    state.sourceLike ||= rest.includes("src") || rest.includes("app") || rest.includes("server") || rest.includes("lib") || rest.includes("tests") || rest.includes("test");
    state.buildLike ||= ["package.json", "pom.xml", "pyproject.toml", "requirements.txt", "go.mod", "build.gradle", "settings.gradle", "dockerfile", "jenkinsfile"].includes(name);
    roots.set(root, state);
  }
  return [...roots.entries()]
    .filter(([, state]) => state.sourceLike || state.buildLike)
    .map(([root]) => root)
    .sort();
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

async function checkSourceCredentialReadiness(project: StoredProject): Promise<SourceCredentialReadiness> {
  const checkedAt = new Date().toISOString();
  const repository = project.repository;
  const checks: SourceCredentialReadiness["checks"] = [];
  const addCheck = (check: SourceCredentialReadiness["checks"][number]) => checks.push(check);

  addCheck({
    id: "project",
    status: repository ? "PASS" : "FAIL",
    required: true,
    evidence: repository ? [`project=${project.id}`] : [`project=${project.id}`, "repository=missing"]
  });

  const provider = repository?.provider ?? "unknown";
  const remoteProvider = provider === "github" || provider === "gitlab";
  const supported = remoteProvider || provider === "local-git";
  addCheck({
    id: "provider",
    status: supported ? "PASS" : "FAIL",
    required: true,
    evidence: [`provider=${provider}`]
  });

  if (!repository) {
    return sourceCredentialReadinessResult(project.id, provider, checks, checkedAt);
  }

  if (repository.provider === "local-git") {
    const root = repository.root ? path.resolve(repository.root) : "";
    const rootOk = Boolean(root && fs.existsSync(root) && fs.statSync(root).isDirectory());
    addCheck({ id: "credential-ref", status: "SKIP", required: false, evidence: ["local-git-token=not-required"] });
    addCheck({ id: "token-resolution", status: "SKIP", required: false, evidence: ["local-git-token=not-required"] });
    addCheck({ id: "source-branch", status: rootOk ? "PASS" : "FAIL", required: true, evidence: [`root=${root || "missing"}`, rootOk ? "rootExists=true" : "rootExists=false"] });
    addCheck({ id: "writeback-policy", status: rootOk ? "PASS" : "FAIL", required: true, evidence: ["writeback=local-git"] });
    return sourceCredentialReadinessResult(project.id, repository.provider, checks, checkedAt);
  }

  const token = resolveCredentialToken(repository);
  const credentialMode = repository.credentials?.tokenRef ? "tokenRef" : repository.credentials?.token ? "inline-token" : repository.credentials?.password ? "password" : "none";
  addCheck({
    id: "credential-ref",
    status: credentialMode === "none" ? "FAIL" : "PASS",
    required: true,
    evidence: [
      `credentialMode=${credentialMode}`,
      repository.credentials?.tokenRef ? `tokenRef=${repository.credentials.tokenRef}` : "tokenRef=missing"
    ]
  });
  addCheck({
    id: "token-resolution",
    status: token ? "PASS" : "FAIL",
    required: true,
    evidence: [
      token ? "tokenResolved=true" : "SOURCE_CREDENTIAL_TOKEN_REQUIRED",
      repository.credentials?.tokenRef ? `tokenRefResolved=${Boolean(process.env[repository.credentials.tokenRef])}` : "tokenRefResolved=false"
    ]
  });

  if (repository.provider === "github") {
    if (token && repository.owner && repository.repo) {
      try {
        const files = await new GitHubHttpAdapter({ apiBaseUrl: repository.baseUrl, owner: repository.owner, repo: repository.repo, token }).listFiles(repository.defaultBranch ?? "main");
        addCheck({ id: "source-branch", status: "PASS", required: true, evidence: [`branch=${repository.defaultBranch ?? "main"}`, `fileCount=${files.length}`] });
      } catch (error) {
        addCheck({ id: "source-branch", status: "FAIL", required: true, evidence: [`branch=${repository.defaultBranch ?? "main"}`, error instanceof Error ? error.message : String(error)] });
      }
    } else {
      addCheck({ id: "source-branch", status: "SKIP", required: true, evidence: [`branch=${repository.defaultBranch ?? "main"}`, "credentials-or-coordinates-missing"] });
    }
  } else if (repository.provider === "gitlab") {
    if (token && repository.baseUrl && repository.projectId) {
      try {
        const files = await new GitLabHttpAdapter({ baseUrl: repository.baseUrl, projectId: repository.projectId, token }).listFiles(repository.defaultBranch ?? "main");
        addCheck({ id: "source-branch", status: "PASS", required: true, evidence: [`branch=${repository.defaultBranch ?? "main"}`, `fileCount=${files.length}`] });
      } catch (error) {
        addCheck({ id: "source-branch", status: "FAIL", required: true, evidence: [`branch=${repository.defaultBranch ?? "main"}`, error instanceof Error ? error.message : String(error)] });
      }
    } else {
      addCheck({ id: "source-branch", status: "SKIP", required: true, evidence: [`branch=${repository.defaultBranch ?? "main"}`, "credentials-or-coordinates-missing"] });
    }
  } else {
    addCheck({ id: "source-branch", status: "SKIP", required: true, evidence: ["repository=unsupported-provider"] });
  }

  addCheck({
    id: "writeback-policy",
    status: token && remoteProvider ? "PASS" : "FAIL",
    required: true,
    evidence: [
      `provider=${repository.provider}`,
      token ? "sourceWriteback=enabled" : "sourceWriteback=read-only",
      "requiredScopes=repo-or-project-write"
    ]
  });

  return sourceCredentialReadinessResult(project.id, repository.provider, checks, checkedAt);
}

function sourceCredentialReadinessResult(projectId: string, provider: ProjectRepositoryProvider | "unknown", checks: SourceCredentialReadiness["checks"], checkedAt: string): SourceCredentialReadiness {
  const blockers = checks
    .filter((check) => check.required && check.status !== "PASS")
    .flatMap((check) => check.evidence.some((item) => item === "SOURCE_CREDENTIAL_TOKEN_REQUIRED")
      ? [`${check.id}:SOURCE_CREDENTIAL_TOKEN_REQUIRED`]
      : [`${check.id}:${check.status}`]);
  const status: SourceCredentialReadiness["status"] = blockers.length === 0 ? "READY"
    : blockers.every((blocker) => blocker.includes("credential") || blocker.includes("token") || blocker.includes("source-branch:SKIP") || blocker.includes("writeback-policy")) ? "READ_ONLY"
      : "BLOCKED";
  return {
    schema: "evopilot-source-credential-readiness/v1",
    projectId,
    provider,
    status,
    checks,
    blockers,
    capabilities: [
      "github-gitlab-tokenref-readiness",
      "public-repository-readonly-detection",
      "source-writeback-preflight",
      "dashboard-credential-control-plane",
      "secret-value-masking"
    ],
    nextAction: status === "READY" ? "write-source"
      : provider === "local-git" ? "use-local-git"
        : blockers.some((blocker) => blocker.includes("project") || blocker.includes("provider") || blocker.includes("source-branch:FAIL")) ? "repair-project"
          : "configure-token-ref",
    checkedAt
  };
}

function updateProjectSourceCredentials(project: StoredProject, body: any): StoredProject {
  const repository = project.repository;
  if (!repository) return project;
  const source = body.repository && typeof body.repository === "object" ? body.repository : body;
  const credentials = source.credentials && typeof source.credentials === "object" ? source.credentials : source;
  const nextCredentials: ProjectRepositoryCredentials = {
    ...repository.credentials,
    username: optionalTrimmedString(credentials.username) ?? repository.credentials?.username,
    password: optionalTrimmedString(credentials.password) ?? repository.credentials?.password,
    token: optionalTrimmedString(credentials.token) ?? repository.credentials?.token,
    tokenRef: optionalTrimmedString(credentials.tokenRef) ?? repository.credentials?.tokenRef
  };
  if (credentials.clearInlineToken === true) delete nextCredentials.token;
  if (credentials.clearPassword === true) delete nextCredentials.password;
  if (credentials.clearTokenRef === true) delete nextCredentials.tokenRef;
  return {
    ...project,
    repository: {
      ...repository,
      defaultBranch: optionalTrimmedString(source.defaultBranch) ?? repository.defaultBranch,
      credentials: Object.values(nextCredentials).some(Boolean) ? nextCredentials : undefined
    }
  };
}

function maskProject(project: StoredProject): Omit<StoredProject, "repository"> & { repository?: Omit<ProjectRepositoryRegistration, "credentials"> & { credentialsConfigured: boolean; credentialMode: string; tokenRef?: string; tokenRefResolved?: boolean } } {
  const { repository, ...safe } = project;
  const credentialMode = repository?.credentials?.tokenRef ? "tokenRef"
    : repository?.credentials?.token ? "inline-token"
      : repository?.credentials?.password ? "password"
        : "none";
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
      credentialsConfigured: Boolean(repository.credentials?.token || repository.credentials?.password || repository.credentials?.tokenRef),
      credentialMode,
      tokenRef: repository.credentials?.tokenRef,
      tokenRefResolved: repository.credentials?.tokenRef ? Boolean(process.env[repository.credentials.tokenRef]) : undefined
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
  const nestedCredentials = source.credentials && typeof source.credentials === "object" ? source.credentials : {};
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
      username: source.username ? String(source.username) : nestedCredentials.username ? String(nestedCredentials.username) : undefined,
      password: source.password ? String(source.password) : nestedCredentials.password ? String(nestedCredentials.password) : undefined,
      token: source.token ? String(source.token) : nestedCredentials.token ? String(nestedCredentials.token) : undefined,
      tokenRef: source.tokenRef ? String(source.tokenRef) : nestedCredentials.tokenRef ? String(nestedCredentials.tokenRef) : undefined
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
      try {
        const files = await new GitHubHttpAdapter({ apiBaseUrl: repository.baseUrl, owner: repository.owner, repo: repository.repo, token }).listFiles(repository.defaultBranch ?? "main");
        return { status: "VERIFIED", checkedAt, message: token ? "GitHub 项目验证通过" : "GitHub 公开项目验证通过", fileCount: files.length };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!token && /GitHub request failed: (401|403|404)/.test(message)) {
          return { status: "FAILED", checkedAt, message: `GitHub 公开项目验证失败：${message}；私有仓库必须提供 token、password 或 tokenRef 对应的环境变量` };
        }
        return { status: "FAILED", checkedAt, message: `GitHub 项目验证失败：${message}` };
      }
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
  logInfo("jenkins.build.triggering", {
    actor: auth.actor,
    target: delivery.id,
    metadata: {
      projectId: delivery.projectId,
      connectorId: connector.id,
      jobName,
      deliveryPlanId: delivery.id,
      codeUpgradeRunId: codeUpgrade?.id
    }
  });
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
  logInfo("jenkins.build.triggered", {
    actor: auth.actor,
    target: pipeline.id,
    metadata: {
      projectId: pipeline.projectId,
      deliveryPlanId: delivery.id,
      connectorId: connector.id,
      jobName,
      queueId: queued.queueId,
      buildUrl: pipeline.buildUrl
    }
  });
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

function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

function logDebug(event: string, record: Omit<LogRecord, "level" | "event"> = {}): void {
  writeLog({ ...record, level: "debug", event });
}

function logInfo(event: string, record: Omit<LogRecord, "level" | "event"> = {}): void {
  writeLog({ ...record, level: "info", event });
}

function logWarn(event: string, record: Omit<LogRecord, "level" | "event"> = {}): void {
  writeLog({ ...record, level: "warn", event });
}

function logError(event: string, error: unknown, record: Omit<LogRecord, "level" | "event" | "error" | "stack"> = {}): void {
  writeLog({
    ...record,
    level: "error",
    event,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
}

function logSeverity(level: LogLevel): LogSeverity {
  const severities: Record<LogLevel, LogSeverity> = { debug: "DEBUG", info: "INFO", warn: "WARN", error: "ERROR" };
  return severities[level];
}

function logCategory(event: string): LogCategory {
  if (event.startsWith("http.")) return "http";
  if (event.startsWith("audit.")) return "audit";
  if (event.startsWith("code-upgrade.")) return "code-upgrade";
  if (event.startsWith("jenkins.")) return "cicd";
  if (event.startsWith("loop-worker.")) return "worker";
  if (event.includes("release")) return "release";
  if (event.includes("auth")) return "auth";
  if (event.startsWith("server.") || event.startsWith("process.")) return "runtime";
  return "system";
}

function routeGroup(pathname: string): string {
  if (pathname === "/health" || pathname === "/ready") return "platform-readiness";
  if (pathname.startsWith("/api/v1/tenants")) return "tenant-control-plane";
  if (pathname.startsWith("/api/v1/workspaces")) return "workspace-control-plane";
  if (pathname.startsWith("/api/v1/loops") || pathname.includes("loop-")) return "loop-runtime";
  if (pathname.includes("release")) return "release-governance";
  if (pathname.includes("evidence") || pathname.includes("audit")) return "evidence-audit";
  if (pathname.includes("code-upgrade")) return "code-upgrade";
  if (pathname.includes("jenkins") || pathname.includes("delivery")) return "cicd";
  return pathname.startsWith("/api/") ? "api" : "dashboard";
}

function latencyBucket(durationMs: number): string {
  if (durationMs < 50) return "<50ms";
  if (durationMs < 200) return "50-199ms";
  if (durationMs < 1000) return "200-999ms";
  if (durationMs < 5000) return "1-4s";
  return "5s+";
}

function httpOutcome(statusCode: number): LogOutcome {
  if (statusCode >= 500) return "failed";
  if (statusCode === 409 || statusCode === 423 || statusCode === 429) return "blocked";
  if (statusCode >= 400) return "rejected";
  return "success";
}

function diagnosisForHttpStatus(statusCode: number, errorCode?: string): LogRecord["diagnosis"] | undefined {
  if (statusCode < 400) return undefined;
  if (statusCode === 401) {
    return {
      summary: "Request rejected before authorization.",
      likelyCause: "Missing, expired, or invalid EvoPilot API token.",
      recommendedAction: "Verify Authorization: Bearer token, EVOPILOT_TOKENS, and tenant/workspace scope before retrying.",
      retriable: true,
      humanActionRequired: true
    };
  }
  if (statusCode === 403) {
    return {
      summary: "Request authenticated but blocked by RBAC or tenant/workspace scope.",
      likelyCause: errorCode ?? "FORBIDDEN",
      recommendedAction: "Check the role matrix, workspace membership, and requested tenant/workspace ownership.",
      retriable: false,
      humanActionRequired: true
    };
  }
  if (statusCode === 404) {
    return {
      summary: "Requested route or resource was not found.",
      likelyCause: errorCode ?? "NOT_FOUND",
      recommendedAction: "Confirm the API path, resource id, and whether the selected workspace can access it.",
      retriable: false,
      humanActionRequired: true
    };
  }
  if (statusCode === 409) {
    return {
      summary: "Business guardrail or consistency check blocked the request.",
      likelyCause: errorCode ?? "CONFLICT",
      recommendedAction: "Inspect response detail, release blockers, workspace boundary, and audit records before retrying.",
      retriable: false,
      humanActionRequired: true
    };
  }
  if (statusCode === 429) {
    return {
      summary: "Request was rate limited or quota constrained.",
      likelyCause: errorCode ?? "RATE_LIMITED",
      recommendedAction: "Check tenant quota, worker concurrency, and retry after the configured backoff window.",
      retriable: true,
      humanActionRequired: false
    };
  }
  if (statusCode >= 500) {
    return {
      summary: "Unhandled server error during request processing.",
      likelyCause: errorCode ?? "SERVER_ERROR",
      recommendedAction: "Collect logs with the same correlation.requestId, inspect stack traces, loop/release ids, and recent deploy changes.",
      retriable: true,
      humanActionRequired: true
    };
  }
  return {
    summary: "Request was rejected by HTTP validation.",
    likelyCause: errorCode ?? `HTTP_${statusCode}`,
    recommendedAction: "Review request payload, role, tenant/workspace scope, and the response error detail.",
    retriable: false,
    humanActionRequired: true
  };
}

function writeLog(record: LogRecord): void {
  if (!shouldLog(record.level)) return;
  const normalized: LogRecord = {
    timestamp: record.timestamp ?? new Date().toISOString(),
    schema: "evopilot-log/v1",
    service: "evopilot",
    version: "1.0.0",
    severity: logSeverity(record.level),
    category: record.category ?? logCategory(record.event),
    ...record,
    correlation: record.correlation ? redactLogValue(record.correlation) as LogRecord["correlation"] : undefined,
    diagnosis: record.diagnosis ? redactLogValue(record.diagnosis) as LogRecord["diagnosis"] : undefined,
    metadata: record.metadata ? redactLogValue(record.metadata) as Record<string, unknown> : undefined,
    error: record.error ? redactSensitiveText(record.error) : undefined,
    stack: includeLogStack() && record.stack ? redactSensitiveText(record.stack) : undefined
  };
  const line = JSON.stringify(removeUndefined(normalized));
  if (record.level === "error") console.error(line);
  else console.log(line);
}

function shouldLog(level: LogLevel): boolean {
  const configured = (process.env.EVOPILOT_LOG_LEVEL ?? "info").toLowerCase();
  const ranks: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = ranks[configured as LogLevel] ?? ranks.info;
  return ranks[level] >= threshold;
}

function includeLogStack(): boolean {
  return parseBoolean(process.env.EVOPILOT_LOG_STACK, true);
}

function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (!value || typeof value !== "object") return typeof value === "string" ? redactSensitiveText(value) : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    if (/token|password|secret|authorization|apiKey|credential/i.test(key)) return [key, "[REDACTED]"];
    return [key, redactLogValue(entry)];
  }));
}

function removeUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function requestHeader(request: http.IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function redactUrlSearch(params: URLSearchParams): Record<string, string> | undefined {
  const entries = [...params.entries()];
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([key, value]) => [
    key,
    /token|password|secret|authorization|apiKey|credential/i.test(key) ? "[REDACTED]" : value
  ]));
}

function writeJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function writeEventStream(response: http.ServerResponse, events: LoopStreamEvent[]): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  for (const event of events) {
    response.write(`id: ${event.id}\n`);
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  response.end();
}

function writeText(response: http.ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

function renderMetrics(summary: any, saasObservability?: any): string {
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
    `evopilot_release_blocked_total ${summary.releaseBlockedCount ?? 0}`,
    "# TYPE evopilot_saas_tenants_total gauge",
    `evopilot_saas_tenants_total ${saasObservability?.tenantCount ?? 0}`,
    "# TYPE evopilot_saas_workspaces_total gauge",
    `evopilot_saas_workspaces_total ${saasObservability?.workspaceCount ?? 0}`,
    "# TYPE evopilot_saas_running_loops_total gauge",
    `evopilot_saas_running_loops_total ${saasObservability?.runningLoopCount ?? 0}`,
    "# TYPE evopilot_saas_blocked_loops_total gauge",
    `evopilot_saas_blocked_loops_total ${saasObservability?.blockedLoopCount ?? 0}`,
    "# TYPE evopilot_saas_github_app_ready_total gauge",
    `evopilot_saas_github_app_ready_total ${saasObservability?.githubAppReadyCount ?? 0}`,
    "# TYPE evopilot_saas_credential_blockers_total gauge",
    `evopilot_saas_credential_blockers_total ${saasObservability?.credentialBlockedCount ?? 0}`,
    "# TYPE evopilot_saas_quota_blocked_workspaces_total gauge",
    `evopilot_saas_quota_blocked_workspaces_total ${saasObservability?.quotaBlockedWorkspaceCount ?? 0}`,
    "# TYPE evopilot_saas_postgres_store_ready gauge",
    `evopilot_saas_postgres_store_ready ${saasObservability?.postgresStoreReady ? 1 : 0}`
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

function assertProductionRuntimeIsConfigured(runtime: RuntimeConfig, tokens: AuthToken[], llmClient?: LlmTaskClient): void {
  if (runtime.mode !== "prod") return;
  if (runtime.allowAnonymousAdmin) throw new Error("EVOPILOT_PROD_FORBIDS_ANONYMOUS_ADMIN");
  if (runtime.allowMockIntegrations) throw new Error("EVOPILOT_PROD_FORBIDS_MOCK_INTEGRATIONS");
  if (!runtime.requireLlm) throw new Error("EVOPILOT_PROD_REQUIRES_LLM");
  if (tokens.length === 0) throw new Error("EVOPILOT_PROD_REQUIRES_TOKENS");
  if (!llmClient) throw new Error("EVOPILOT_PROD_REQUIRES_LLM_PROVIDER");
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

function normalizeUsers(options: EvoPilotServerOptions, tokens: AuthToken[], runtime: RuntimeConfig, store: FileStore): AuthUser[] {
  const merged = new Map<string, AuthUser>();
  const addUsers = (users: AuthUser[]) => {
    for (const user of users) {
      merged.set(user.username, { ...user, platformAdmin: user.platformAdmin ?? user.role === "admin", status: user.status ?? "ACTIVE" });
    }
  };
  addUsers(store.listUsers(undefined, false).map(authUserFromRecord));
  const envUsers = parseEnvUsers(process.env.EVOPILOT_USERS);
  if (envUsers?.length) addUsers(envUsers);
  if (options.users) addUsers(options.users);
  if (runtime.mode === "debug") {
    addUsers(tokens.map((token) => ({
      username: token.name,
      password: token.token,
      role: token.role,
      tenantId: token.tenantId ?? DEFAULT_TENANT_ID,
      workspaceId: token.workspaceId ?? DEFAULT_WORKSPACE_ID,
      displayName: token.displayName ?? token.name,
      token: token.token,
      status: "ACTIVE",
      platformAdmin: token.role === "admin"
    })));
  }
  return [...merged.values()];
}

function mergeUserTokens(tokens: AuthToken[], users: AuthUser[]): AuthToken[] {
  const merged = new Map<string, AuthToken>();
  for (const token of tokens) merged.set(token.token, token);
  for (const user of users) {
    const token = userSessionToken(user);
    if (merged.has(token)) continue;
    merged.set(token, {
      name: user.username,
      token,
      role: user.role,
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      displayName: user.displayName,
      platformAdmin: user.platformAdmin,
      mustChangePassword: user.mustChangePassword
    });
  }
  return [...merged.values()];
}

function userSessionToken(user: AuthUser): string {
  if (user.token) return user.token;
  return createHash("sha256")
    .update(["evopilot-session-v1", user.username, user.password, user.role, user.tenantId, user.workspaceId, user.platformAdmin ? "platform" : "tenant"].join(":"))
    .digest("hex");
}

function publicUser(user: AuthUser): Omit<AuthUser, "password" | "token"> {
  const { password: _password, token: _token, ...safe } = user;
  return safe;
}

function authUserFromRecord(user: UserRecord): AuthUser {
  return {
    username: user.username,
    password: user.passwordHash,
    role: user.role,
    tenantId: user.tenantId,
    workspaceId: user.workspaceId,
    displayName: user.displayName,
    status: user.status,
    platformAdmin: user.platformAdmin,
    mustChangePassword: user.mustChangePassword
  };
}

function maskUser(user: UserRecord): Omit<UserRecord, "passwordHash"> {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

function hashPassword(password: string): string {
  return `sha256:${createHash("sha256").update(`evopilot-user-password:${password}`).digest("hex")}`;
}

function verifyPassword(input: string, stored: string): boolean {
  if (stored.startsWith("sha256:")) return hashPassword(input) === stored;
  return input === stored;
}

function requestScope(request: http.IncomingMessage): Pick<AuthContext, "tenantId" | "workspaceId"> {
  const tenantId = optionalTrimmedString(request.headers["x-evopilot-tenant"]) ?? DEFAULT_TENANT_ID;
  const workspaceId = optionalTrimmedString(request.headers["x-evopilot-workspace"]) ?? DEFAULT_WORKSPACE_ID;
  return {
    tenantId: safeFileName(tenantId),
    workspaceId: safeFileName(workspaceId)
  };
}

function authorize(request: http.IncomingMessage, tokens: AuthToken[], runtime: RuntimeConfig, allowAnonymousFallback = false): AuthContext | undefined {
  const requestedScope = requestScope(request);
  const value = String(request.headers.authorization ?? "");
  if (allowAnonymousFallback && runtime.allowAnonymousAdmin && !value) {
    return { actor: String(request.headers["x-evopilot-actor"] ?? "system"), role: "admin", platformAdmin: true, ...requestedScope };
  }
  if (tokens.length === 0) {
    if (!runtime.allowAnonymousAdmin) return undefined;
    return { actor: String(request.headers["x-evopilot-actor"] ?? "system"), role: "admin", platformAdmin: true, ...requestedScope };
  }
  const token = value.startsWith("Bearer ") ? value.slice("Bearer ".length) : "";
  const matched = tokens.find((item) => item.token === token);
  if (!matched) return undefined;
  const scope = {
    tenantId: matched.tenantId ?? requestedScope.tenantId,
    workspaceId: matched.workspaceId ?? requestedScope.workspaceId
  };
  return {
    actor: String(request.headers["x-evopilot-actor"] ?? matched.name),
    role: matched.role,
    platformAdmin: matched.platformAdmin ?? matched.role === "admin",
    mustChangePassword: matched.mustChangePassword,
    ...scope
  };
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
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
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
  const users = parseEnvUsers(process.env.EVOPILOT_USERS);
  const apiToken = process.env.EVOPILOT_API_TOKEN;
  const server = createServer({ dataRoot, dashboardRoot, apiToken, tokens, users }).listen(port, host, () => {
    const runtimeMode = process.env.EVOPILOT_RUN_MODE ?? process.env.EVOPILOT_MODE ?? (parseBoolean(process.env.EVOPILOT_DEBUG, false) ? "debug" : "prod");
    logInfo("server.started", {
      metadata: {
        url: `http://${host}:${port}`,
        host,
        port,
        runtimeMode,
        dataRoot,
        dashboardRoot,
        authConfigured: Boolean(apiToken || tokens?.length || users?.length),
        loginEnabled: Boolean(users?.length)
      }
    });
  });
  process.on("uncaughtException", (error) => {
    logError("process.uncaught-exception", error);
  });
  process.on("unhandledRejection", (reason) => {
    logError("process.unhandled-rejection", reason);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      logWarn("server.stopping", { metadata: { signal } });
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

function parseEnvUsers(value: string | undefined): AuthUser[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((item) => {
    const [username, password, role, tenantId = DEFAULT_TENANT_ID, workspaceId = DEFAULT_WORKSPACE_ID, displayName, platformAdminRaw] = item.split(":");
    if (!username || !password || (role !== "viewer" && role !== "operator" && role !== "admin")) {
      throw new Error("EVOPILOT_USERS 条目必须使用 username:password:role[:tenantId[:workspaceId[:displayName]]] 格式");
    }
    return {
      username,
      password,
      role,
      tenantId: safeFileName(tenantId),
      workspaceId: safeFileName(workspaceId),
      displayName: displayName || username,
      status: "ACTIVE",
      platformAdmin: platformAdminRaw === undefined ? role === "admin" : parseBoolean(platformAdminRaw, role === "admin")
    };
  });
}
