import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type LlmOutputContract =
  | "json_object"
  | "markdown_document"
  | "short_classification"
  | "multi_file_artifact"
  | "engine_package"
  | "plain_text";

export interface LlmGenerateRequest {
  requestId?: string;
  caller?: string;
  intent?: string;
  taskType?: string;
  profile?: string;
  model?: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  jsonObject?: boolean;
  latencyClass?: "interactive" | "batch" | string;
  complexity?: "low" | "medium" | "high" | string;
  outputSize?: "small" | "medium" | "large" | string;
  outputContract?: LlmOutputContract | string;
  metadata?: Record<string, string>;
  runtimeOptions?: Record<string, string>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  creditsConsumed: number;
  creditUnit: "token";
}

export interface LlmGenerateResponse {
  requestId: string;
  success: boolean;
  text: string;
  provider?: string;
  model?: string;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
  finishReason?: string;
  usage?: LlmUsage;
  truncated?: boolean;
  resolvedIntent?: string;
  resolvedProfile?: string;
  preflightUsed?: boolean;
  truncationRetryAttempt?: number;
  finalMaxOutputTokens?: number;
  promptCompressed?: boolean;
  compression?: LlmContextCompressionResult;
}

export interface LlmModelConfig {
  id: string;
  provider?: "openai-compatible" | string;
  providerName?: string;
  apiKey?: string;
  baseUrl: string;
  modelName: string;
  timeoutSeconds?: number;
  maxRetries?: number;
  defaultMaxOutputTokens?: number;
  maxOutputTokens?: number;
  temperature?: number;
  thinking?: {
    type?: string;
  };
}

export interface LlmProfileConfig {
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  thinking?: {
    type?: string;
  };
}

export interface LlmRouteConfig {
  profile?: string;
  preflightProfile?: string;
  fallbackProfile?: string;
}

export interface LlmProxyConfig {
  defaultIntent?: string;
  defaultModel?: string;
  models: Record<string, LlmModelConfig>;
  profiles?: Record<string, LlmProfileConfig>;
  routes?: Record<string, LlmRouteConfig>;
  legacyIntentMappings?: Record<string, string>;
  metrics?: LlmMetricsConfig;
  contextCompression?: LlmContextCompressionConfig;
}

export interface LlmMetricsConfig {
  enabled?: boolean;
  path?: string;
}

export interface LlmContextCompressionConfig {
  enabled?: boolean;
  maxPromptChars?: number;
  headChars?: number;
  tailChars?: number;
}

export interface LlmContextCompressionResult {
  originalChars: number;
  compressedChars: number;
  strategy: "head-tail";
}

export interface ResolvedLlmOptions {
  model: LlmModelConfig;
  maxOutputTokens: number;
  temperature: number;
  thinkingType: string;
  intent: string;
  profile: string;
  preflightRequired: boolean;
  preflightProfile: string;
}

export interface LlmTaskClient {
  generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse>;
}

export class LlmProxyError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    cause?: unknown
  ) {
    super(message);
    this.name = "LlmProxyError";
    if (cause) this.cause = cause;
  }
}

export class LlmProxy implements LlmTaskClient {
  private readonly resolver: ProfileRouteResolver;
  private readonly adapter: OpenAiCompatibleProviderAdapter;
  private readonly metricsWriter: LlmMetricsWriter;

  constructor(
    private readonly config: LlmProxyConfig,
    adapter: OpenAiCompatibleProviderAdapter = new OpenAiCompatibleProviderAdapter()
  ) {
    this.resolver = new ProfileRouteResolver(config);
    this.adapter = adapter;
    this.metricsWriter = new LlmMetricsWriter(config.metrics);
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const startedAt = Date.now();
    let normalized: LlmGenerateRequest = {
      ...request,
      requestId: request.requestId?.trim() || randomUUID(),
      metadata: { ...(request.metadata ?? {}) },
      runtimeOptions: { ...(request.runtimeOptions ?? {}) }
    };
    const compression = compressPromptIfNeeded(normalized, this.config.contextCompression);
    normalized = compression.request;
    let finalResponse: LlmGenerateResponse;
    if (!normalized.prompt || !normalized.prompt.trim()) {
      finalResponse = failed(normalized.requestId!, "LLM_REQUEST_EMPTY", "LLM prompt is empty", startedAt);
      this.metricsWriter.write(normalized, withCompression(finalResponse, compression.result));
      return withCompression(finalResponse, compression.result);
    }
    try {
      let options = this.resolver.resolve(normalized);
      let preflightUsed = false;
      if (options.preflightRequired) {
        const decision = await this.preflight(normalized, options);
        if (decision.intent) {
          normalized.intent = decision.intent;
          normalized.metadata!.preflightIntent = decision.intent;
          normalized.metadata!.preflightConfidence = decision.confidence;
          normalized.metadata!.preflightComplexity = decision.complexity;
          normalized.metadata!.preflightRequiresThinking = decision.requiresThinking;
          options = this.resolver.resolve(normalized);
          preflightUsed = true;
        }
      }
      const response = await this.generateWithTruncationPolicy(normalized, options);
      finalResponse = {
        ...response,
        durationMs: Date.now() - startedAt,
        resolvedIntent: options.intent,
        resolvedProfile: options.profile,
        preflightUsed
      };
    } catch (error) {
      if (error instanceof LlmProxyError) {
        finalResponse = failed(normalized.requestId!, error.errorCode, error.message, startedAt);
      } else {
        finalResponse = failed(normalized.requestId!, "LLM_PROXY_ERROR", error instanceof Error ? error.message : String(error), startedAt);
      }
    }
    finalResponse = withCompression(finalResponse, compression.result);
    this.metricsWriter.write(normalized, finalResponse);
    return finalResponse;
  }

  private async generateWithTruncationPolicy(request: LlmGenerateRequest, initialOptions: ResolvedLlmOptions): Promise<LlmGenerateResponse> {
    const policy = outputContractPolicy(request);
    const modelCap = positive(initialOptions.model.maxOutputTokens, policy.retryCapTokens);
    const retryCap = Math.min(policy.retryCapTokens, modelCap);
    let options = initialOptions;
    let last: LlmGenerateResponse | undefined;
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      const response = await this.adapter.generate(request, options);
      response.truncationRetryAttempt = attempt;
      response.finalMaxOutputTokens = options.maxOutputTokens;
      last = response;
      if (!response.truncated) return response;
      const next = nextMaxTokens(options.maxOutputTokens, response, retryCap);
      if (next <= options.maxOutputTokens || attempt >= policy.maxAttempts) break;
      request.maxOutputTokens = next;
      options = this.resolver.resolve(request);
    }
    return {
      requestId: request.requestId ?? "",
      success: false,
      text: "",
      provider: last?.provider,
      model: last?.model,
      durationMs: 0,
      errorCode: "LLM_OUTPUT_TRUNCATED_RETRY_EXHAUSTED",
      errorMessage: "LLM output was truncated and retry budget was exhausted",
      finishReason: last?.finishReason,
      usage: last?.usage,
      truncated: true,
      truncationRetryAttempt: last?.truncationRetryAttempt,
      finalMaxOutputTokens: last?.finalMaxOutputTokens
    };
  }

  private async preflight(original: LlmGenerateRequest, options: ResolvedLlmOptions): Promise<PreflightDecision> {
    if (!options.preflightProfile) return emptyPreflight();
    const request: LlmGenerateRequest = {
      requestId: `${original.requestId}-preflight`,
      caller: "evopilot-llm-gateway",
      intent: "llm.intent.classification",
      profile: options.preflightProfile,
      jsonObject: true,
      prompt: preflightPrompt(original)
    };
    const response = await this.adapter.generate(request, this.resolver.resolve(request));
    return parsePreflightDecision(response.text);
  }
}

export class ProfileRouteResolver {
  constructor(private readonly config: LlmProxyConfig) {}

  resolve(request: LlmGenerateRequest): ResolvedLlmOptions {
    const intent = this.resolveIntent(request);
    const route = this.config.routes?.[intent];
    const preflightRequired = shouldPreflight(request, intent, route);
    const preflightProfile = trim(route?.preflightProfile);
    let profileId = request.caller === "evopilot-llm-gateway" ? trim(request.profile) : "";
    if (!profileId && route) {
      profileId = preflightRequired && route.fallbackProfile ? trim(route.fallbackProfile) : trim(route.profile);
      if (!profileId) profileId = trim(route.fallbackProfile);
    }
    const profile = profileId ? this.config.profiles?.[profileId] : undefined;
    let modelId = trim(request.model) || trim(profile?.model) || trim(this.config.defaultModel) || "default";
    const model = this.config.models[modelId];
    if (!model) throw new LlmProxyError("LLM_MODEL_NOT_FOUND", `LLM model not found: ${modelId}`);
    let maxOutputTokens = positive(request.maxOutputTokens, profile?.maxOutputTokens, model.defaultMaxOutputTokens, 8192);
    if (model.maxOutputTokens && maxOutputTokens > model.maxOutputTokens) maxOutputTokens = model.maxOutputTokens;
    const temperature = request.temperature ?? profile?.temperature ?? model.temperature ?? 0.2;
    const thinkingType = trim(request.runtimeOptions?.thinking) || trim(profile?.thinking?.type) || trim(model.thinking?.type) || "disabled";
    return { model, maxOutputTokens, temperature, thinkingType, intent, profile: profileId, preflightRequired, preflightProfile };
  }

  resolveIntent(request: LlmGenerateRequest): string {
    const intent = trim(request.intent);
    if (intent) return this.config.legacyIntentMappings?.[intent] ?? intent;
    const taskType = trim(request.taskType);
    if (taskType) {
      const mapped = this.config.legacyIntentMappings?.[taskType];
      if (mapped) return mapped;
      if (this.config.routes?.[taskType]) return taskType;
    }
    return trim(this.config.defaultIntent) || "auto";
  }
}

export class OpenAiCompatibleProviderAdapter {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async generate(request: LlmGenerateRequest, options: ResolvedLlmOptions): Promise<LlmGenerateResponse> {
    const model = options.model;
    if (!model.apiKey?.trim()) throw new LlmProxyError("LLM_API_KEY_MISSING", `LLM apiKey is empty for model ${model.id}`);
    if (!model.baseUrl?.trim()) throw new LlmProxyError("LLM_BASE_URL_MISSING", `LLM baseUrl is empty for model ${model.id}`);
    let lastError: unknown;
    const attempts = Math.max(1, model.maxRetries ?? 1);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.generateOnce(request, options);
      } catch (error) {
        lastError = error;
        if (!(error instanceof LlmProxyError) || !isRetryable(error) || attempt >= attempts) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new LlmProxyError("LLM_PROVIDER_ERROR", "LLM provider call failed");
  }

  requestBody(request: LlmGenerateRequest, options: ResolvedLlmOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options.model.modelName,
      temperature: options.temperature,
      max_tokens: options.maxOutputTokens,
      messages: [{ role: "user", content: request.prompt ?? "" }]
    };
    if (options.thinkingType) body.thinking = { type: options.thinkingType };
    if (request.jsonObject) body.response_format = { type: "json_object" };
    return body;
  }

  private async generateOnce(request: LlmGenerateRequest, options: ResolvedLlmOptions): Promise<LlmGenerateResponse> {
    const model = options.model;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, model.timeoutSeconds ?? 300) * 1000);
    try {
      const response = await this.fetchFn(endpoint(model.baseUrl), {
        method: "POST",
        headers: {
          "accept": "application/json",
          "authorization": `Bearer ${model.apiKey}`,
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify(this.requestBody(request, options)),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw new LlmProxyError(httpErrorCode(response.status), `LLM provider call failed: status=${response.status}, body=${SecretMasker.mask(text)}`);
      return parseProviderResponse(request.requestId ?? "", model, text);
    } catch (error) {
      if (error instanceof LlmProxyError) throw error;
      throw new LlmProxyError("LLM_PROVIDER_ERROR", "LLM provider call failed", error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class SecretMasker {
  static mask(value: string): string {
    return String(value ?? "")
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer ***")
      .replace(/([A-Za-z0-9]{8,}\.[A-Za-z0-9._-]{8,})/g, "***")
      .replace(/(api(?:[_-]?key|Key)[\"']?\s*[:=]\s*[\"']?)[^\"',}\s]+/g, "$1***");
  }
}

export class LlmMetricsWriter {
  constructor(private readonly config: LlmMetricsConfig | undefined) {}

  write(request: LlmGenerateRequest, response: LlmGenerateResponse): void {
    if (this.config?.enabled === false) return;
    const metricsPath = resolveMetricsPath(trim(this.config?.path) || trim(process.env.EVOPILOT_LLM_METRICS_PATH));
    if (!metricsPath) return;
    const record = {
      recordedAt: new Date().toISOString(),
      requestId: response.requestId,
      caller: request.caller ?? "",
      intent: request.intent ?? "",
      taskType: request.taskType ?? "",
      profile: request.profile ?? "",
      latencyClass: request.latencyClass ?? "",
      complexity: request.complexity ?? "",
      outputSize: request.outputSize ?? "",
      outputContract: request.outputContract ?? "",
      resolvedIntent: response.resolvedIntent ?? "",
      resolvedProfile: response.resolvedProfile ?? "",
      preflightUsed: response.preflightUsed === true,
      provider: response.provider ?? "",
      model: response.model ?? "",
      promptChars: request.prompt?.length ?? 0,
      resultChars: response.text?.length ?? 0,
      promptCompressed: response.promptCompressed === true,
      compression: response.compression,
      durationMs: response.durationMs,
      status: response.success ? "SUCCEEDED" : "FAILED",
      errorCode: response.errorCode ?? "",
      finishReason: response.finishReason ?? "",
      truncated: response.truncated === true,
      truncationRetryAttempt: response.truncationRetryAttempt ?? 0,
      finalMaxOutputTokens: response.finalMaxOutputTokens ?? 0,
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
      totalTokens: response.usage?.totalTokens ?? 0,
      creditsConsumed: response.usage?.creditsConsumed ?? response.usage?.totalTokens ?? 0,
      creditUnit: response.usage?.creditUnit ?? "token"
    };
    writeMetricsRecord(metricsPath, record);
  }
}

export function createLlmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProxyConfig | undefined {
  const baseUrl = env.EVOPILOT_LLM_BASE_URL?.trim();
  const apiKey = env.EVOPILOT_LLM_API_KEY?.trim();
  const modelName = env.EVOPILOT_LLM_MODEL_NAME?.trim();
  if (!baseUrl || !apiKey || !modelName) return undefined;
  const providerName = env.EVOPILOT_LLM_PROVIDER_NAME?.trim() || "openai-compatible";
  return {
    defaultIntent: "auto",
    defaultModel: "general",
    models: {
      general: {
        id: "general",
        provider: "openai-compatible",
        providerName,
        baseUrl,
        apiKey,
        modelName,
        timeoutSeconds: Number(env.EVOPILOT_LLM_TIMEOUT_SECONDS ?? 300),
        maxRetries: Number(env.EVOPILOT_LLM_MAX_RETRIES ?? 1),
        defaultMaxOutputTokens: Number(env.EVOPILOT_LLM_DEFAULT_MAX_OUTPUT_TOKENS ?? 8192),
        maxOutputTokens: Number(env.EVOPILOT_LLM_MAX_OUTPUT_TOKENS ?? 12288),
        temperature: Number(env.EVOPILOT_LLM_TEMPERATURE ?? 0.2),
        thinking: { type: env.EVOPILOT_LLM_THINKING ?? "disabled" }
      }
    },
    profiles: {
      "structure-fast": { model: "general", maxOutputTokens: 1536, temperature: 0.1, thinking: { type: "disabled" } },
      "document-fast": { model: "general", maxOutputTokens: 4096, temperature: 0.2, thinking: { type: "disabled" } },
      "document-generation": { model: "general", maxOutputTokens: 4096, temperature: 0.2, thinking: { type: "disabled" } },
      "reasoning-risk": { model: "general", maxOutputTokens: 8192, temperature: 0.15, thinking: { type: env.EVOPILOT_LLM_DEEP_THINKING ?? "enabled" } },
      "deep-reasoning": { model: "general", maxOutputTokens: 8192, temperature: 0.15, thinking: { type: env.EVOPILOT_LLM_DEEP_THINKING ?? "enabled" } },
      "fast-classifier": { model: "general", maxOutputTokens: 512, temperature: 0, thinking: { type: "disabled" } },
      "markdown-writer": { model: "general", maxOutputTokens: 8192, temperature: 0.2, thinking: { type: env.EVOPILOT_LLM_DEEP_THINKING ?? "enabled" } },
      "json-extractor": { model: "general", maxOutputTokens: 1536, temperature: 0.1, thinking: { type: "disabled" } }
    },
    routes: {
      "structured.extraction": { profile: "structure-fast" },
      "structured.matching": { profile: "structure-fast" },
      "structured.summarization": { profile: "structure-fast" },
      "risk.diagnosis": { profile: "deep-reasoning" },
      "report.generation": { profile: "document-generation" },
      "document.generation": { profile: "document-generation" },
      "plan.generation": { profile: "deep-reasoning" },
      "compliance.review": { profile: "deep-reasoning" },
      "reasoning.task": { profile: "deep-reasoning" },
      "agent.brainstorm": { profile: "deep-reasoning" },
      auto: { preflightProfile: "fast-classifier", fallbackProfile: "document-generation" }
    },
    legacyIntentMappings: {
      "execution.skill": "report.generation",
      "execution.structured": "structured.extraction",
      "execution.document": "report.generation",
      "execution.reasoning": "reasoning.task",
      "execution.toolReasoning": "reasoning.task",
      "scenario.authoring": "plan.generation",
      "scenario.definition": "plan.generation",
      "scenario.convergence": "structured.matching",
      "evolution.matching": "structured.matching",
      "evolution.proposal": "plan.generation",
      "domain.evolution.matching": "structured.matching",
      "domain.evolution.proposal": "plan.generation"
    },
    metrics: {
      enabled: parseBoolean(env.EVOPILOT_LLM_METRICS_ENABLED, true),
      path: resolveMetricsPath(env.EVOPILOT_LLM_METRICS_PATH, env)
    },
    contextCompression: {
      enabled: parseBoolean(env.EVOPILOT_LLM_CONTEXT_COMPRESSION_ENABLED, true),
      maxPromptChars: Number(env.EVOPILOT_LLM_CONTEXT_MAX_PROMPT_CHARS ?? 24000),
      headChars: Number(env.EVOPILOT_LLM_CONTEXT_HEAD_CHARS ?? 12000),
      tailChars: Number(env.EVOPILOT_LLM_CONTEXT_TAIL_CHARS ?? 8000)
    }
  };
}

export function createLlmClientFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProxy | undefined {
  const config = createLlmConfigFromEnv(env);
  return config ? new LlmProxy(config) : undefined;
}

function parseProviderResponse(requestId: string, model: LlmModelConfig, responseBody: string): LlmGenerateResponse {
  let root: any;
  try {
    root = JSON.parse(responseBody || "{}");
  } catch (error) {
    throw new LlmProxyError("LLM_PROVIDER_RESPONSE_INVALID", "LLM provider response is not valid JSON", error);
  }
  const choice = Array.isArray(root.choices) ? root.choices[0] ?? {} : {};
  const finishReason = String(choice.finish_reason ?? "");
  return {
    requestId,
    success: true,
    text: content(choice.message?.content),
    provider: model.providerName || model.provider || "openai-compatible",
    model: model.modelName,
    durationMs: 0,
    finishReason,
    truncated: isTruncated(finishReason),
    usage: parseUsage(root.usage)
  };
}

function content(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) return String(part.text ?? "");
      if (part && typeof part === "object" && "content" in part) return String(part.content ?? "");
      return "";
    }).join("");
  }
  return value == null ? "" : String(value);
}

function parseUsage(value: any): LlmUsage {
  const input = Number(value?.prompt_tokens ?? value?.input_tokens ?? 0);
  const output = Number(value?.completion_tokens ?? value?.output_tokens ?? 0);
  const total = Number(value?.total_tokens ?? input + output);
  return { inputTokens: input, outputTokens: output, totalTokens: total, creditsConsumed: total, creditUnit: "token" };
}

function resolveMetricsPath(value: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const metricsPath = value?.trim();
  if (!metricsPath) return undefined;
  if (path.isAbsolute(metricsPath)) return metricsPath;
  const dataRoot = env.EVOPILOT_DATA_ROOT?.trim();
  if (!dataRoot) return metricsPath;
  const normalized = metricsPath.replace(/^data\/evopilot\/?/, "");
  return path.join(dataRoot, normalized || "llm-metrics.jsonl");
}

function preflightPrompt(request: LlmGenerateRequest): string {
  const prompt = request.prompt.length > 2000 ? request.prompt.slice(0, 2000) : request.prompt;
  return [
    "你是 EvoPilot 的 LLM intent classifier。只返回 JSON 对象，不要 Markdown。",
    "可选 intent: structured.extraction, structured.matching, structured.summarization, risk.diagnosis, document.generation, plan.generation, compliance.review, reasoning.task。",
    "返回字段: intent, complexity(low|medium|high), requiresThinking(true|false), confidence(0-1), reason。",
    "metadata:",
    `- caller: ${request.caller ?? ""}`,
    `- taskType: ${request.taskType ?? ""}`,
    `- latencyClass: ${request.latencyClass ?? ""}`,
    `- complexity: ${request.complexity ?? ""}`,
    `- outputSize: ${request.outputSize ?? ""}`,
    `- outputContract: ${request.outputContract ?? ""}`,
    "promptSummary:",
    prompt
  ].join("\n");
}

interface PreflightDecision {
  intent: string;
  complexity: string;
  requiresThinking: string;
  confidence: string;
}

function parsePreflightDecision(text: string): PreflightDecision {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const json = start >= 0 && end > start ? text.slice(start, end + 1) : text;
    const data = JSON.parse(json);
    return {
      intent: trim(data.intent),
      complexity: trim(data.complexity),
      requiresThinking: trim(data.requiresThinking),
      confidence: trim(data.confidence)
    };
  } catch {
    return emptyPreflight();
  }
}

function emptyPreflight(): PreflightDecision {
  return { intent: "", complexity: "", requiresThinking: "", confidence: "" };
}

function outputContractPolicy(request: LlmGenerateRequest): { retryCapTokens: number; maxAttempts: number } {
  const contract = (request.outputContract || request.metadata?.outputContract || (request.jsonObject ? "json_object" : "")).toLowerCase();
  if (contract === "short_classification") return { retryCapTokens: 512, maxAttempts: 1 };
  if (contract === "markdown_document") return { retryCapTokens: 12288, maxAttempts: 2 };
  if (contract === "json_object") return { retryCapTokens: 12288, maxAttempts: 4 };
  if (["multi_file_artifact", "sql_bundle", "engine_package", "delivery_package"].includes(contract)) return { retryCapTokens: 12288, maxAttempts: 4 };
  return { retryCapTokens: 12288, maxAttempts: 4 };
}

function nextMaxTokens(current: number, response: LlmGenerateResponse, cap: number): number {
  let base = current > 0 ? current : response.usage?.outputTokens ?? 0;
  if (base <= 0) base = 4096;
  if (base < 4096) return Math.min(cap, 4096);
  if (base < 8192) return Math.min(cap, 8192);
  if (base < 12288) return Math.min(cap, 12288);
  return base;
}

function endpoint(baseUrl: string): string {
  let normalized = baseUrl.trim();
  while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function failed(requestId: string, errorCode: string, errorMessage: string, startedAt: number): LlmGenerateResponse {
  return { requestId, success: false, text: "", durationMs: Date.now() - startedAt, errorCode, errorMessage };
}

function shouldPreflight(request: LlmGenerateRequest, intent: string, route: LlmRouteConfig | undefined): boolean {
  if (!route?.preflightProfile) return false;
  if (intent.toLowerCase() === "auto") return true;
  const confidence = request.metadata?.intentConfidence;
  if (!confidence) return false;
  const value = Number(confidence);
  return Number.isFinite(value) && value < 0.7;
}

function isRetryable(error: LlmProxyError): boolean {
  return error.errorCode === "LLM_RATE_LIMITED" || error.errorCode === "LLM_PROVIDER_UNAVAILABLE";
}

function httpErrorCode(status: number): string {
  if (status === 429) return "LLM_RATE_LIMITED";
  if (status >= 500) return "LLM_PROVIDER_UNAVAILABLE";
  return `LLM_PROVIDER_HTTP_${status}`;
}

function isTruncated(finishReason: string): boolean {
  return ["length", "max_tokens"].includes(finishReason.trim().toLowerCase());
}

function positive(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (Number.isFinite(value) && Number(value) > 0) return Number(value);
  }
  return 0;
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function compressPromptIfNeeded(request: LlmGenerateRequest, config: LlmContextCompressionConfig | undefined): { request: LlmGenerateRequest; result?: LlmContextCompressionResult } {
  if (request.runtimeOptions?.contextCompression === "disabled") return { request };
  if (config?.enabled === false) return { request };
  const prompt = request.prompt ?? "";
  const maxPromptChars = positive(config?.maxPromptChars, 24000);
  if (prompt.length <= maxPromptChars) return { request };
  const headChars = Math.min(positive(config?.headChars, 12000), maxPromptChars);
  const tailChars = Math.min(positive(config?.tailChars, 8000), Math.max(1000, maxPromptChars - headChars));
  const head = prompt.slice(0, headChars);
  const tail = prompt.slice(-tailChars);
  const omitted = prompt.length - head.length - tail.length;
  const compressed = [
    head.trimEnd(),
    "",
    `[EvoPilot 上下文压缩：中间 ${omitted} 个字符已压缩省略；保留头部任务定义和尾部最新证据。]`,
    "",
    tail.trimStart()
  ].join("\n");
  return {
    request: {
      ...request,
      prompt: compressed,
      metadata: {
        ...(request.metadata ?? {}),
        contextCompressed: "true",
        originalPromptChars: String(prompt.length),
        compressedPromptChars: String(compressed.length)
      }
    },
    result: {
      originalChars: prompt.length,
      compressedChars: compressed.length,
      strategy: "head-tail"
    }
  };
}

function withCompression(response: LlmGenerateResponse, compression?: LlmContextCompressionResult): LlmGenerateResponse {
  return compression ? { ...response, promptCompressed: true, compression } : response;
}

function writeMetricsRecord(file: string, record: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}
