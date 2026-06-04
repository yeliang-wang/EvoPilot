export type EvidenceSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type EvidenceSource =
  | "agent"
  | "mcp"
  | "tool"
  | "llm"
  | "ci"
  | "cd"
  | "release"
  | "deployment"
  | "observability"
  | "user"
  | "manual";

export type TriggerConditionField =
  | "type"
  | "source"
  | "severity"
  | "module"
  | "attributes.durationMs"
  | "attributes.latencyMs"
  | "attributes.p95LatencyMs";

export type TriggerConditionOperator = "==" | "!=" | ">" | ">=" | "<" | "<=" | "includes";

export interface EvolutionTriggerCondition {
  field: TriggerConditionField;
  operator: TriggerConditionOperator;
  value: string | number;
}

export interface EvolutionTriggerRule {
  id: string;
  name: string;
  description: string;
  userPrompt?: string;
  compiledBy?: "llm" | "system";
  compiledAt?: string;
  enabled: boolean;
  opportunityType: OpportunityType;
  title: string;
  affectedArea: string;
  suggestedDirection: string;
  riskLevel: EvolutionOpportunity["riskLevel"];
  anyOf?: EvolutionTriggerCondition[];
  allOf?: EvolutionTriggerCondition[];
  minMatchingEvents?: number;
}

export interface RuntimeEvidenceEvent {
  id: string;
  type: string;
  source: EvidenceSource;
  timestamp: string;
  severity: EvidenceSeverity;
  message: string;
  traceId?: string;
  module?: string;
  attributes?: Record<string, unknown>;
}

export interface AgentEvidenceSignal {
  id?: string;
  type?: string;
  source?: EvidenceSource;
  timestamp?: string;
  severity?: EvidenceSeverity;
  message?: string;
  traceId?: string;
  sessionId?: string;
  module?: string;
  attributes?: Record<string, unknown>;
}

export interface EvaluationEvidenceSignal {
  id?: string;
  suite?: string;
  caseId?: string;
  status: "PASSED" | "FAILED" | "ERROR" | "SKIPPED" | string;
  score?: number;
  metric?: string;
  message?: string;
  traceId?: string;
  timestamp?: string;
  attributes?: Record<string, unknown>;
}

export interface FeedbackEvidenceSignal {
  id?: string;
  rating?: "positive" | "negative" | "neutral" | string;
  message?: string;
  traceId?: string;
  sessionId?: string;
  userId?: string;
  timestamp?: string;
  attributes?: Record<string, unknown>;
}

export interface EvidenceBundle {
  id: string;
  projectId: string;
  timeWindow: {
    from: string;
    to: string;
  };
  events: RuntimeEvidenceEvent[];
  summary: {
    totalEvents: number;
    severityCounts: Record<EvidenceSeverity, number>;
    sources: EvidenceSource[];
  };
}

export type OpportunityType =
  | "product-gap"
  | "performance-hotspot"
  | "reliability-risk"
  | "tool-failure"
  | "test-gap"
  | "documentation-drift"
  | "cost-risk"
  | "security-risk"
  | "module-boundary-smell"
  | "release-process-risk";

export interface EvolutionOpportunity {
  id: string;
  projectId: string;
  title: string;
  type: OpportunityType;
  confidence: number;
  impact: "low" | "medium" | "high";
  affectedArea: string;
  suggestedDirection: string;
  evidenceEventIds: string[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
}

export interface PriorityWeights {
  performance: number;
  reliability: number;
  userExperience: number;
  maintainability: number;
  documentation: number;
  cost: number;
}

export interface PriorityScore {
  opportunityId: string;
  score: number;
  rationale: string[];
}

export interface ImpactMap {
  opportunityId: string;
  confidence: number;
  affectedComponents: string[];
  likelyFiles: string[];
  relatedTests: string[];
  rationale: string;
}

export interface ValidationContract {
  id: string;
  commands: Array<{
    name: string;
    command: string;
    required: boolean;
  }>;
  metrics: Array<{
    name: string;
    operator: ">=" | ">" | "<=" | "<" | "==" | "!=";
    threshold: number | string;
  }>;
  requiredArtifacts: string[];
  successCriteria: string[];
}

export interface EvolutionPlan {
  id: string;
  projectId: string;
  opportunityId: string;
  problemStatement: string;
  whyEvolutionNeeded: string;
  expectedEffect: string;
  proposedApproach: string;
  impactMap: ImpactMap;
  validationContract: ValidationContract;
  riskAnalysis: string;
  rollbackPlan: string;
  automationLevel: "observe-only" | "diagnose-only" | "proposal-only" | "auto-pr-allowed" | "manual-design-required" | "reject";
}

export interface DeliveryPlan {
  id: string;
  projectId: string;
  planId: string;
  targetEnvironment: string;
  releaseWindow?: string;
  rolloutStrategy: "none" | "manual" | "canary" | "blue-green";
  approvalRequired: boolean;
  blockOnCiFailure: boolean;
  postReleaseVerificationRequired: boolean;
}

export type PipelineProvider = "jenkins";
export type PipelineStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "UNKNOWN";
export type PipelineStageStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "UNKNOWN";

export interface PipelineStage {
  id: string;
  name: string;
  status: PipelineStageStatus;
  startedAt?: string;
  durationMs?: number;
  logUrl?: string;
}

export interface PipelineArtifact {
  name: string;
  url: string;
  sizeBytes?: number;
}

export interface PipelineLogRef {
  url?: string;
  preview?: string;
}

export interface PipelineRun {
  id: string;
  projectId: string;
  deliveryPlanId: string;
  provider: PipelineProvider;
  connectorId: string;
  jobName: string;
  status: PipelineStatus;
  queueId?: string;
  buildNumber?: number;
  buildUrl?: string;
  stages: PipelineStage[];
  artifacts: PipelineArtifact[];
  logRef?: PipelineLogRef;
  parameters: Record<string, string>;
  triggeredAt: string;
  updatedAt: string;
}

export interface ReleaseReport {
  id: string;
  projectId: string;
  deliveryPlanId: string;
  version: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "ROLLED_BACK";
  evidenceBundleId: string;
  validationSummary: string;
  releasedAt?: string;
}

export interface LearningRecord {
  id: string;
  projectId: string;
  planId: string;
  prediction: string;
  outcome: "validated" | "partially-validated" | "rejected" | "unknown";
  ruleChangesSuggested: string[];
  createdAt: string;
}

export interface ReviewRecord {
  id: string;
  projectId: string;
  planId: string;
  status: "USER_CONFIRM_REQUIRED" | "USER_CONFIRMED" | "REJECTED" | "CHANGES_REQUESTED";
  summary: string;
  decisions: Array<{
    action: "accept" | "reject" | "request-changes" | "observe-only";
    actor: string;
    note: string;
    decidedAt: string;
  }>;
}

export interface ProjectPolicy {
  protectedPaths: string[];
  weights: PriorityWeights;
  requireUserConfirmation: boolean;
  blockReleaseOnCiFailure: boolean;
  requirePostReleaseVerification: boolean;
}

export interface ProjectProfile {
  id: string;
  name: string;
  description: string;
  policy: ProjectPolicy;
  templates: Record<string, string>;
  triggerRules?: EvolutionTriggerRule[];
}

export const defaultTriggerRules: EvolutionTriggerRule[] = [
  {
    id: "chain-latency-over-3s",
    name: "链路耗时超过 3 秒",
    description: "当运行证据中的 durationMs、latencyMs 或 p95LatencyMs 大于 3000ms 时，触发性能热点演进机会。",
    userPrompt: "所有链路调用小于 3 秒",
    compiledBy: "system",
    enabled: true,
    opportunityType: "performance-hotspot",
    title: "链路性能超过 3 秒阈值",
    affectedArea: "runtime-performance",
    suggestedDirection: "定位链路耗时来源，降低延迟，并增加性能回归检查。",
    riskLevel: "MEDIUM",
    anyOf: [
      { field: "attributes.durationMs", operator: ">", value: 3000 },
      { field: "attributes.latencyMs", operator: ">", value: 3000 },
      { field: "attributes.p95LatencyMs", operator: ">", value: 3000 }
    ]
  },
  {
    id: "performance-latency-signal",
    name: "性能或延迟信号",
    description: "当事件类型包含 performance 或 latency 时，触发性能热点演进机会。",
    userPrompt: "出现性能或延迟信号时提醒优化",
    compiledBy: "system",
    enabled: true,
    opportunityType: "performance-hotspot",
    title: "性能热点需要优化",
    affectedArea: "runtime-performance",
    suggestedDirection: "降低延迟，并增加性能回归检查。",
    riskLevel: "MEDIUM",
    anyOf: [
      { field: "type", operator: "includes", value: "performance" },
      { field: "type", operator: "includes", value: "latency" }
    ]
  },
  {
    id: "product-gap-signal",
    name: "产品能力缺口信号",
    description: "当事件类型包含 product-gap 时，触发产品缺口演进机会。",
    userPrompt: "出现产品能力缺口时创建演进机会",
    compiledBy: "system",
    enabled: true,
    opportunityType: "product-gap",
    title: "产品能力缺口需要演进",
    affectedArea: "agent-capability",
    suggestedDirection: "在保护受控资产的前提下改进 Agent 产品能力。",
    riskLevel: "MEDIUM",
    anyOf: [
      { field: "type", operator: "includes", value: "product-gap" }
    ]
  },
  {
    id: "tool-failure-signal",
    name: "工具失败信号",
    description: "当事件类型包含 tool.failure 或 tool-failure 时，触发工具恢复设计机会。",
    userPrompt: "工具调用失败时创建恢复设计机会",
    compiledBy: "system",
    enabled: true,
    opportunityType: "tool-failure",
    title: "工具失败模式需要恢复设计",
    affectedArea: "tooling",
    suggestedDirection: "增加失败处理、诊断信息和回归覆盖。",
    riskLevel: "MEDIUM",
    anyOf: [
      { field: "type", operator: "includes", value: "tool.failure" },
      { field: "type", operator: "includes", value: "tool-failure" }
    ]
  }
];

export function createEvidenceBundle(args: {
  id: string;
  projectId: string;
  events: RuntimeEvidenceEvent[];
  from: string;
  to: string;
}): EvidenceBundle {
  const severityCounts: Record<EvidenceSeverity, number> = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0
  };
  const sourceSet = new Set<EvidenceSource>();
  for (const event of args.events) {
    severityCounts[event.severity] += 1;
    sourceSet.add(event.source);
  }
  return {
    id: args.id,
    projectId: args.projectId,
    timeWindow: { from: args.from, to: args.to },
    events: args.events,
    summary: {
      totalEvents: args.events.length,
      severityCounts,
      sources: [...sourceSet].sort()
    }
  };
}

export function evidenceEventsFromAgentSignals(signals: AgentEvidenceSignal[], now: string): RuntimeEvidenceEvent[] {
  return signals.map((signal, index) => normalizeEvidenceEvent({
    id: signal.id ?? `agent-signal-${index + 1}`,
    type: signal.type ?? "agent.signal",
    source: signal.source ?? "agent",
    timestamp: signal.timestamp ?? now,
    severity: signal.severity ?? severityFromAttributes(signal.attributes),
    message: signal.message ?? signal.type ?? "Agent 运行信号",
    traceId: signal.traceId,
    module: signal.module,
    attributes: {
      ...(signal.attributes ?? {}),
      sessionId: signal.sessionId
    }
  }, now));
}

export function evidenceEventsFromOtlpTraces(payload: any, now: string): RuntimeEvidenceEvent[] {
  const spans = flattenOtlpSpans(payload);
  return spans.map((span, index) => {
    const attributes = attributesFromOtlp(span.attributes);
    const durationMs = durationMsFromOtlpSpan(span);
    const traceId = stringValue(span.traceId ?? span.trace_id ?? attributes.traceId);
    const statusCode = String(span.status?.code ?? span.statusCode ?? "").toUpperCase();
    return normalizeEvidenceEvent({
      id: stringValue(span.spanId ?? span.span_id) || `otlp-span-${index + 1}`,
      type: inferOtlpEventType(span, attributes),
      source: "observability",
      timestamp: isoFromOtlpTime(span.startTimeUnixNano ?? span.start_time_unix_nano, now),
      severity: statusCode.includes("ERROR") || statusCode === "2" ? "HIGH" : severityFromAttributes({ ...attributes, durationMs }),
      message: stringValue(span.name) || "OpenTelemetry Trace Span",
      traceId,
      module: stringValue(attributes["service.name"] ?? attributes.serviceName ?? attributes["code.namespace"]),
      attributes: {
        ...attributes,
        durationMs,
        latencyMs: attributes.latencyMs ?? durationMs,
        spanKind: span.kind,
        statusCode
      }
    }, now);
  });
}

export function evidenceEventsFromOtlpLogs(payload: any, now: string): RuntimeEvidenceEvent[] {
  const records = flattenOtlpLogs(payload);
  return records.map((record, index) => {
    const attributes = attributesFromOtlp(record.attributes);
    const severityText = String(record.severityText ?? record.severity_text ?? "").toUpperCase();
    const body = primitiveOtlpValue(record.body) ?? record.body;
    return normalizeEvidenceEvent({
      id: stringValue(record.observedTimeUnixNano ?? record.timeUnixNano) || `otlp-log-${index + 1}`,
      type: inferLogEventType(severityText, attributes),
      source: "observability",
      timestamp: isoFromOtlpTime(record.timeUnixNano ?? record.time_unix_nano ?? record.observedTimeUnixNano, now),
      severity: severityFromText(severityText),
      message: typeof body === "string" ? body : JSON.stringify(body ?? "OpenTelemetry Log"),
      traceId: stringValue(record.traceId ?? record.trace_id ?? attributes.traceId),
      module: stringValue(attributes["service.name"] ?? attributes.serviceName),
      attributes
    }, now);
  });
}

export function evidenceEventsFromSkyWalking(payload: any, now: string): RuntimeEvidenceEvent[] {
  const items = Array.isArray(payload?.spans) ? payload.spans : Array.isArray(payload?.segments) ? payload.segments : Array.isArray(payload) ? payload : [];
  return items.map((item: any, index: number) => {
    const durationMs = numberValue(item.durationMs ?? item.latency ?? item.latencyMs ?? item.duration);
    return normalizeEvidenceEvent({
      id: stringValue(item.spanId ?? item.segmentId ?? item.id) || `skywalking-${index + 1}`,
      type: durationMs && durationMs > 0 ? "apm.skywalking.latency" : "apm.skywalking.trace",
      source: "observability",
      timestamp: stringValue(item.timestamp ?? item.startTime) || now,
      severity: item.isError || item.error ? "HIGH" : severityFromAttributes({ durationMs }),
      message: stringValue(item.endpointName ?? item.operationName ?? item.serviceCode ?? item.message) || "SkyWalking 链路信号",
      traceId: stringValue(item.traceId ?? item.trace_id),
      module: stringValue(item.serviceName ?? item.serviceCode),
      attributes: {
        ...objectValue(item.tags),
        durationMs,
        latencyMs: durationMs,
        endpointName: item.endpointName,
        component: item.component
      }
    }, now);
  });
}

export function evidenceEventsFromEvaluationResults(results: EvaluationEvidenceSignal[], now: string): RuntimeEvidenceEvent[] {
  return results.map((result, index) => normalizeEvidenceEvent({
    id: result.id ?? `eval-result-${index + 1}`,
    type: String(result.status).toUpperCase() === "PASSED" ? "eval.passed" : "eval.failed",
    source: "ci",
    timestamp: result.timestamp ?? now,
    severity: String(result.status).toUpperCase() === "PASSED" ? "LOW" : "HIGH",
    message: result.message ?? `${result.suite ?? "评测集"} / ${result.caseId ?? "未命名用例"}：${result.status}`,
    traceId: result.traceId,
    module: result.suite,
    attributes: {
      ...(result.attributes ?? {}),
      suite: result.suite,
      caseId: result.caseId,
      status: result.status,
      score: result.score,
      metric: result.metric
    }
  }, now));
}

export function evidenceEventsFromFeedback(signals: FeedbackEvidenceSignal[], now: string): RuntimeEvidenceEvent[] {
  return signals.map((feedback, index) => {
    const rating = String(feedback.rating ?? "neutral").toLowerCase();
    return normalizeEvidenceEvent({
      id: feedback.id ?? `feedback-${index + 1}`,
      type: rating === "negative" ? "user.feedback.negative" : rating === "positive" ? "user.feedback.positive" : "user.feedback.neutral",
      source: "user",
      timestamp: feedback.timestamp ?? now,
      severity: rating === "negative" ? "HIGH" : "LOW",
      message: feedback.message ?? "用户反馈",
      traceId: feedback.traceId,
      attributes: {
        ...(feedback.attributes ?? {}),
        rating,
        sessionId: feedback.sessionId,
        userId: feedback.userId
      }
    }, now);
  });
}

export function validateProtectedPaths(files: string[], protectedPaths: string[]): string[] {
  const normalized = files.map((file) => file.replace(/\\/g, "/").replace(/^\.\/+/, ""));
  return normalized.filter((file) => protectedPaths.some((pattern) => matchesGlobPrefix(file, pattern)));
}

export function mineOpportunities(bundle: EvidenceBundle, triggerRules: EvolutionTriggerRule[] = defaultTriggerRules): EvolutionOpportunity[] {
  const opportunities: EvolutionOpportunity[] = [];
  const enabledRules = triggerRules.filter((rule) => rule.enabled);
  const reliabilityEvents = bundle.events.filter((event) => event.severity === "HIGH" || event.severity === "CRITICAL");

  for (const rule of enabledRules) {
    const matchedEvents = bundle.events.filter((event) => matchesTriggerRule(event, rule));
    if (matchedEvents.length >= (rule.minMatchingEvents ?? 1)) {
      const alreadyCreated = opportunities.some((opportunity) =>
        opportunity.type === rule.opportunityType && opportunity.affectedArea === rule.affectedArea
      );
      if (alreadyCreated) continue;
      opportunities.push(createOpportunity(bundle, rule.opportunityType, rule.title, matchedEvents, rule.affectedArea, rule.suggestedDirection, rule.riskLevel));
    }
  }
  if (reliabilityEvents.length > 0 && opportunities.length === 0) {
    opportunities.push(createOpportunity(bundle, "reliability-risk", "高严重级别运行信号需要源码影响分析", reliabilityEvents, "runtime-reliability", "分析相关源码模块，并增加可安全回滚的回归覆盖。", "HIGH"));
  }

  return opportunities;
}

export function scoreOpportunity(opportunity: EvolutionOpportunity, policy: ProjectPolicy): PriorityScore {
  const typeWeight = {
    "performance-hotspot": policy.weights.performance,
    "reliability-risk": policy.weights.reliability,
    "tool-failure": policy.weights.reliability,
    "product-gap": policy.weights.userExperience,
    "test-gap": policy.weights.maintainability,
    "documentation-drift": policy.weights.documentation,
    "cost-risk": policy.weights.cost,
    "security-risk": policy.weights.reliability,
    "module-boundary-smell": policy.weights.maintainability,
    "release-process-risk": policy.weights.reliability
  } satisfies Record<OpportunityType, number>;
  const impact = opportunity.impact === "high" ? 1 : opportunity.impact === "medium" ? 0.7 : 0.4;
  const riskPenalty = opportunity.riskLevel === "HIGH" ? 0.15 : opportunity.riskLevel === "MEDIUM" ? 0.05 : 0;
  const score = round2((typeWeight[opportunity.type] * 0.55 + opportunity.confidence * 0.25 + impact * 0.20 - riskPenalty) * 100);
  return {
    opportunityId: opportunity.id,
    score,
    rationale: [
      `类型权重=${typeWeight[opportunity.type]}`,
      `置信度=${opportunity.confidence}`,
      `影响=${opportunity.impact}`,
      `风险=${opportunity.riskLevel}`
    ]
  };
}

export function createImpactMap(args: {
  opportunity: EvolutionOpportunity;
  files: string[];
  profile: ProjectProfile;
}): ImpactMap {
  const eligibleFiles = args.files
    .map((file) => file.replace(/\\/g, "/").replace(/^\.\/+/, ""))
    .filter((file) => validateProtectedPaths([file], args.profile.policy.protectedPaths).length === 0)
    .filter((file) => !file.includes("/node_modules/") && !file.startsWith("node_modules/") && !file.includes("/dist/") && !file.startsWith("dist/"));
  const area = args.opportunity.affectedArea.toLowerCase();
  const likelyFiles = eligibleFiles.filter((file) => file.toLowerCase().includes(area)).slice(0, 10);
  const fallbackFiles = likelyFiles.length > 0 ? likelyFiles : eligibleFiles.filter((file) => isLikelyAgentProductFile(file)).slice(0, 5);
  const relatedTests = eligibleFiles.filter((file) => file.includes("test") || file.includes("spec")).slice(0, 10);
  return {
    opportunityId: args.opportunity.id,
    confidence: fallbackFiles.length > 0 ? 0.72 : 0.35,
    affectedComponents: [args.opportunity.affectedArea],
    likelyFiles: fallbackFiles,
    relatedTests,
    rationale: fallbackFiles.length > 0
      ? "已应用项目画像的保护路径策略，并将机会点映射到可修改的项目文件。"
      : "未找到可修改的源码文件；在项目智能配置完成前保持诊断模式。"
  };
}

export function createValidationContract(args: {
  id: string;
  opportunity: EvolutionOpportunity;
  impactMap: ImpactMap;
}): ValidationContract {
  const commands = [
    { name: "build", command: "npm run build", required: true },
    { name: "test", command: "npm test", required: true }
  ];
  const metrics = args.opportunity.type === "performance-hotspot"
    ? [{ name: "p95_latency_improvement", operator: ">=" as const, threshold: 15 }]
    : [{ name: "regression_failures", operator: "==" as const, threshold: 0 }];
  return {
    id: args.id,
    commands,
    metrics,
    requiredArtifacts: ["evidence-bundle", "review-decision"],
    successCriteria: [
      "必需命令全部成功完成。",
      "不修改任何受保护路径。",
      "发布后验证会对比预测效果与实际结果。"
    ]
  };
}

export function createEvolutionPlan(args: {
  id: string;
  projectId: string;
  opportunity: EvolutionOpportunity;
  impactMap: ImpactMap;
  validationContract: ValidationContract;
}): EvolutionPlan {
  const hasImpact = args.impactMap.confidence >= 0.7 && args.impactMap.likelyFiles.length > 0;
  return {
    id: args.id,
    projectId: args.projectId,
    opportunityId: args.opportunity.id,
    problemStatement: args.opportunity.title,
    whyEvolutionNeeded: `证据表明 ${args.opportunity.affectedArea} 存在 ${args.opportunity.type}；如果不处理，将持续影响 Agent 产品质量或交付信心。`,
    expectedEffect: expectedEffectFor(args.opportunity.type),
    proposedApproach: hasImpact
      ? `${args.opportunity.suggestedDirection} 将变更范围控制在最小可修改集合：${args.impactMap.likelyFiles.join(", ")}。`
      : "在源码影响面确认前保持诊断模式。",
    impactMap: args.impactMap,
    validationContract: args.validationContract,
    riskAnalysis: `风险=${args.opportunity.riskLevel}；影响面置信度=${args.impactMap.confidence}。受保护路径继续由项目画像策略阻断。`,
    rollbackPlan: "回滚 PR/MR 提交，恢复上一版 Agent 产品，并记录回滚证据。",
    automationLevel: !hasImpact ? "diagnose-only" : args.opportunity.riskLevel === "LOW" ? "auto-pr-allowed" : "proposal-only"
  };
}

export function createReviewRecord(plan: EvolutionPlan): ReviewRecord {
  return {
    id: `review-${plan.id}`,
    projectId: plan.projectId,
    planId: plan.id,
    status: "USER_CONFIRM_REQUIRED",
    summary: [
      `计划：${plan.problemStatement}`,
      `预期效果：${plan.expectedEffect}`,
      `验证：${plan.validationContract.successCriteria.join("；")}`,
      `回滚：${plan.rollbackPlan}`
    ].join("\n"),
    decisions: []
  };
}

export function applyReviewDecision(review: ReviewRecord, decision: ReviewRecord["decisions"][number]): ReviewRecord {
  const status = decision.action === "accept"
    ? "USER_CONFIRMED"
    : decision.action === "reject"
      ? "REJECTED"
      : decision.action === "request-changes"
        ? "CHANGES_REQUESTED"
        : "USER_CONFIRM_REQUIRED";
  return {
    ...review,
    status,
    decisions: [...review.decisions, decision]
  };
}

export function createDeliveryPlan(args: {
  id: string;
  projectId: string;
  plan: EvolutionPlan;
  policy: ProjectPolicy;
  targetEnvironment?: string;
}): DeliveryPlan {
  return {
    id: args.id,
    projectId: args.projectId,
    planId: args.plan.id,
    targetEnvironment: args.targetEnvironment ?? "staging",
    rolloutStrategy: args.plan.automationLevel === "auto-pr-allowed" ? "canary" : "manual",
    approvalRequired: args.policy.requireUserConfirmation,
    blockOnCiFailure: args.policy.blockReleaseOnCiFailure,
    postReleaseVerificationRequired: args.policy.requirePostReleaseVerification
  };
}

export function createPipelineRun(args: {
  id: string;
  projectId: string;
  deliveryPlanId: string;
  provider: PipelineProvider;
  connectorId: string;
  jobName: string;
  status?: PipelineStatus;
  queueId?: string;
  buildNumber?: number;
  buildUrl?: string;
  stages?: PipelineStage[];
  artifacts?: PipelineArtifact[];
  logRef?: PipelineLogRef;
  parameters?: Record<string, string>;
  now: string;
}): PipelineRun {
  return {
    id: args.id,
    projectId: args.projectId,
    deliveryPlanId: args.deliveryPlanId,
    provider: args.provider,
    connectorId: args.connectorId,
    jobName: args.jobName,
    status: args.status ?? "QUEUED",
    queueId: args.queueId,
    buildNumber: args.buildNumber,
    buildUrl: args.buildUrl,
    stages: args.stages ?? [],
    artifacts: args.artifacts ?? [],
    logRef: args.logRef,
    parameters: args.parameters ?? {},
    triggeredAt: args.now,
    updatedAt: args.now
  };
}

export function pipelineStatusToReleaseStatus(status: PipelineStatus): ReleaseReport["status"] {
  if (status === "SUCCEEDED") return "SUCCEEDED";
  if (status === "FAILED" || status === "CANCELED") return "FAILED";
  return "RUNNING";
}

export function createReleaseReport(args: {
  id: string;
  projectId: string;
  deliveryPlanId: string;
  evidenceBundleId: string;
  version: string;
  status: ReleaseReport["status"];
  validationSummary: string;
  releasedAt?: string;
}): ReleaseReport {
  return { ...args };
}

export interface EvolutionCycleResult {
  evidenceBundle: EvidenceBundle;
  opportunities: EvolutionOpportunity[];
  scores: PriorityScore[];
  impactMaps: ImpactMap[];
  plans: EvolutionPlan[];
  reviews: ReviewRecord[];
  deliveryPlans: DeliveryPlan[];
}

export function runEvolutionCycle(args: {
  projectId: string;
  profile: ProjectProfile;
  events: RuntimeEvidenceEvent[];
  files: string[];
  now: string;
}): EvolutionCycleResult {
  const evidenceBundle = createEvidenceBundle({
    id: `bundle-${stableId(args.now)}`,
    projectId: args.projectId,
    events: args.events,
    from: args.now,
    to: args.now
  });
  const opportunities = mineOpportunities(evidenceBundle, args.profile.triggerRules ?? defaultTriggerRules);
  const scores = opportunities.map((opportunity) => scoreOpportunity(opportunity, args.profile.policy));
  const impactMaps = opportunities.map((opportunity) => createImpactMap({ opportunity, files: args.files, profile: args.profile }));
  const plans = opportunities.map((opportunity, index) => {
    const impactMap = impactMaps[index];
    const validationContract = createValidationContract({ id: `validation-${opportunity.id}`, opportunity, impactMap });
    return createEvolutionPlan({
      id: `plan-${opportunity.id}`,
      projectId: args.projectId,
      opportunity,
      impactMap,
      validationContract
    });
  });
  const reviews = plans.map(createReviewRecord);
  const deliveryPlans = plans.map((plan) => createDeliveryPlan({
    id: `delivery-${plan.id}`,
    projectId: args.projectId,
    plan,
    policy: args.profile.policy
  }));
  return { evidenceBundle, opportunities, scores, impactMaps, plans, reviews, deliveryPlans };
}

function createOpportunity(
  bundle: EvidenceBundle,
  type: OpportunityType,
  title: string,
  events: RuntimeEvidenceEvent[],
  affectedArea: string,
  suggestedDirection: string,
  riskLevel: EvolutionOpportunity["riskLevel"]
): EvolutionOpportunity {
  return {
    id: `opp-${bundle.id}-${type}`,
    projectId: bundle.projectId,
    title,
    type,
    confidence: events.some((event) => event.severity === "CRITICAL") ? 0.9 : 0.82,
    impact: events.some((event) => event.severity === "CRITICAL" || event.severity === "HIGH") ? "high" : "medium",
    affectedArea,
    suggestedDirection,
    evidenceEventIds: events.map((event) => event.id),
    riskLevel
  };
}

function matchesTriggerRule(event: RuntimeEvidenceEvent, rule: EvolutionTriggerRule): boolean {
  const allOf = rule.allOf ?? [];
  const anyOf = rule.anyOf ?? [];
  const allMatched = allOf.every((condition) => matchesCondition(event, condition));
  const anyMatched = anyOf.length === 0 || anyOf.some((condition) => matchesCondition(event, condition));
  return allMatched && anyMatched;
}

function matchesCondition(event: RuntimeEvidenceEvent, condition: EvolutionTriggerCondition): boolean {
  const actual = valueForConditionField(event, condition.field);
  if (actual === undefined || actual === null) return false;
  if (condition.operator === "includes") return String(actual).includes(String(condition.value));
  if (condition.operator === "==") return String(actual) === String(condition.value);
  if (condition.operator === "!=") return String(actual) !== String(condition.value);
  const left = Number(actual);
  const right = Number(condition.value);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (condition.operator === ">") return left > right;
  if (condition.operator === ">=") return left >= right;
  if (condition.operator === "<") return left < right;
  if (condition.operator === "<=") return left <= right;
  return false;
}

function valueForConditionField(event: RuntimeEvidenceEvent, field: TriggerConditionField): unknown {
  if (field === "type") return event.type;
  if (field === "source") return event.source;
  if (field === "severity") return event.severity;
  if (field === "module") return event.module;
  if (field === "attributes.durationMs") return event.attributes?.durationMs;
  if (field === "attributes.latencyMs") return event.attributes?.latencyMs;
  if (field === "attributes.p95LatencyMs") return event.attributes?.p95LatencyMs;
  return undefined;
}

function expectedEffectFor(type: OpportunityType): string {
  if (type === "performance-hotspot") return "降低 p95 延迟或工具调用耗时，并用发布后指标证明改进效果。";
  if (type === "product-gap") return "提升 Agent 能力覆盖度，减少用户可见的产品缺口。";
  if (type === "tool-failure") return "降低工具失败复发率，并改进诊断能力。";
  return "用源码支撑的验证证据降低运行或交付风险。";
}

function isLikelyAgentProductFile(file: string): boolean {
  return /\.(ts|tsx|js|jsx|py|java|md|yaml|yml|json)$/.test(file);
}

function stableId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "now";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function matchesGlobPrefix(file: string, pattern: string): boolean {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (normalized.endsWith("/**")) {
    return file.startsWith(normalized.slice(0, -3));
  }
  return file === normalized;
}

function normalizeEvidenceEvent(event: RuntimeEvidenceEvent, now: string): RuntimeEvidenceEvent {
  return {
    id: event.id || `evidence-${stableId(`${now}-${Math.random()}`)}`,
    type: event.type || "evidence.signal",
    source: event.source,
    timestamp: event.timestamp || now,
    severity: normalizeSeverity(event.severity),
    message: event.message || event.type || "运行证据",
    traceId: event.traceId,
    module: event.module,
    attributes: Object.fromEntries(Object.entries(event.attributes ?? {}).filter(([, value]) => value !== undefined && value !== ""))
  };
}

function normalizeSeverity(value: unknown): EvidenceSeverity {
  const text = String(value ?? "").toUpperCase();
  if (text === "LOW" || text === "MEDIUM" || text === "HIGH" || text === "CRITICAL") return text;
  return "MEDIUM";
}

function severityFromText(value: string): EvidenceSeverity {
  if (value.includes("FATAL") || value.includes("CRITICAL")) return "CRITICAL";
  if (value.includes("ERROR") || value.includes("WARN")) return "HIGH";
  if (value.includes("INFO")) return "LOW";
  return "MEDIUM";
}

function severityFromAttributes(attributes: Record<string, unknown> | undefined): EvidenceSeverity {
  const duration = numberValue(attributes?.durationMs ?? attributes?.latencyMs ?? attributes?.p95LatencyMs);
  if (duration !== undefined && duration > 5000) return "CRITICAL";
  if (duration !== undefined && duration > 3000) return "HIGH";
  const status = String(attributes?.status ?? attributes?.statusCode ?? "").toUpperCase();
  if (status.includes("ERROR") || status.includes("FAIL")) return "HIGH";
  return "MEDIUM";
}

function flattenOtlpSpans(payload: any): any[] {
  const result: any[] = [];
  for (const resource of arrayValue(payload?.resourceSpans ?? payload?.resource_spans)) {
    const resourceAttrs = attributesFromOtlp(resource.resource?.attributes);
    for (const scope of arrayValue(resource.scopeSpans ?? resource.instrumentationLibrarySpans ?? resource.scope_spans)) {
      for (const span of arrayValue(scope.spans)) {
        result.push({ ...span, attributes: [...arrayValue(span.attributes), ...otlpAttributesFromObject(resourceAttrs)] });
      }
    }
  }
  if (result.length === 0 && Array.isArray(payload?.spans)) return payload.spans;
  return result;
}

function flattenOtlpLogs(payload: any): any[] {
  const result: any[] = [];
  for (const resource of arrayValue(payload?.resourceLogs ?? payload?.resource_logs)) {
    const resourceAttrs = attributesFromOtlp(resource.resource?.attributes);
    for (const scope of arrayValue(resource.scopeLogs ?? resource.scope_logs)) {
      for (const record of arrayValue(scope.logRecords ?? scope.log_records)) {
        result.push({ ...record, attributes: [...arrayValue(record.attributes), ...otlpAttributesFromObject(resourceAttrs)] });
      }
    }
  }
  if (result.length === 0 && Array.isArray(payload?.logs)) return payload.logs;
  return result;
}

function attributesFromOtlp(attributes: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const item of arrayValue(attributes)) {
    const key = stringValue(item.key);
    if (!key) continue;
    result[key] = primitiveOtlpValue(item.value);
  }
  return result;
}

function otlpAttributesFromObject(value: Record<string, unknown>): any[] {
  return Object.entries(value).map(([key, item]) => ({ key, value: { stringValue: String(item ?? "") } }));
}

function primitiveOtlpValue(value: any): unknown {
  if (!value || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("intValue" in value) return Number(value.intValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("boolValue" in value) return Boolean(value.boolValue);
  if ("bytesValue" in value) return value.bytesValue;
  if ("arrayValue" in value) return arrayValue(value.arrayValue?.values).map(primitiveOtlpValue);
  if ("kvlistValue" in value) return attributesFromOtlp(value.kvlistValue?.values);
  return value;
}

function durationMsFromOtlpSpan(span: any): number | undefined {
  const explicit = numberValue(attributesFromOtlp(span.attributes).durationMs ?? attributesFromOtlp(span.attributes).latencyMs);
  if (explicit !== undefined) return explicit;
  const start = bigintValue(span.startTimeUnixNano ?? span.start_time_unix_nano);
  const end = bigintValue(span.endTimeUnixNano ?? span.end_time_unix_nano);
  if (start !== undefined && end !== undefined && end > start) return Number((end - start) / 1_000_000n);
  return undefined;
}

function inferOtlpEventType(span: any, attributes: Record<string, unknown>): string {
  const system = String(attributes["gen_ai.system"] ?? attributes["db.system"] ?? "").toLowerCase();
  const operation = String(attributes["gen_ai.operation.name"] ?? attributes["rpc.method"] ?? span.name ?? "").toLowerCase();
  if (system || operation.includes("chat") || operation.includes("completion")) return "llm.call";
  if (operation.includes("tool")) return "tool.call";
  return "observability.trace";
}

function inferLogEventType(severityText: string, attributes: Record<string, unknown>): string {
  if (severityText.includes("ERROR")) return "log.error";
  if (String(attributes.eventName ?? attributes["event.name"] ?? "").includes("feedback")) return "user.feedback";
  return "log.signal";
}

function isoFromOtlpTime(value: unknown, fallback: string): string {
  const numeric = bigintValue(value);
  if (numeric === undefined) return fallback;
  return new Date(Number(numeric / 1_000_000n)).toISOString();
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value);
  return text ? text : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function bigintValue(value: unknown): bigint | undefined {
  if (value == null || value === "") return undefined;
  try {
    return BigInt(String(value));
  } catch {
    return undefined;
  }
}
