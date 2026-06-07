export interface OpenHandsConnectorConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  workspaceMode?: "docker" | "remote";
  defaultModel?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  maxIterations?: number;
  condenserMaxSize?: number;
  gitUserName?: string;
  gitUserEmail?: string;
}

export type OpenHandsRunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export interface OpenHandsRepositoryRef {
  provider: "local-git" | "gitlab" | "github";
  gitUrl?: string;
  root?: string;
  branch?: string;
  sourceBranch?: string;
  upgradeBranch?: string;
  username?: string;
  password?: string;
  token?: string;
  tokenRef?: string;
}

export interface OpenHandsBranchStrategy {
  sourceBranch: string;
  upgradeBranch: string;
  commitMessage: string;
  mergeRequestTitle: string;
  mergeRequestDescription: string;
}

export interface OpenHandsCodeUpgradeRequest {
  projectId: string;
  repository?: OpenHandsRepositoryRef;
  branchStrategy: OpenHandsBranchStrategy;
  proposalMarkdown: string;
  codeContext?: Array<{ path: string; content: string }>;
  validationCommands: string[];
  validationPlan?: OpenHandsValidationPlan;
  allowedPaths?: string[];
  protectedPaths?: string[];
}

export interface OpenHandsValidationPlan {
  language?: "python" | "node" | "java" | "go" | "generic";
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

export interface OpenHandsCodeUpgradeSession {
  workspaceId?: string;
  conversationId: string;
  status: OpenHandsRunStatus;
}

export interface OpenHandsCodeUpgradeEvent {
  id: string;
  timestamp?: string;
  source?: "agent" | "user" | "environment" | "tool" | "openhands";
  phase?: string;
  level?: "info" | "warn" | "error";
  message: string;
  raw?: unknown;
}

export interface OpenHandsCodeUpgradeSnapshot extends OpenHandsCodeUpgradeSession {
  events: OpenHandsCodeUpgradeEvent[];
  diff?: string;
  branchName?: string;
  commitSha?: string;
  pullRequestUrl?: string;
  changedFiles?: string[];
}

export class OpenHandsClient {
  constructor(
    private readonly config: OpenHandsConnectorConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async startCodeUpgrade(request: OpenHandsCodeUpgradeRequest): Promise<OpenHandsCodeUpgradeSession> {
    const managedSession = await this.startManagedCodeUpgrade(request).catch((error) => {
      if (isMissingManagedRuntimeRoute(error)) return undefined;
      throw error;
    });
    if (managedSession) return managedSession;

    await this.configureRuntime(request);
    const response = await this.fetchJson("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repository: request.repository?.provider === "local-git" ? repositorySelector(request.repository) : null,
        selected_branch: request.branchStrategy.sourceBranch,
        initial_user_msg: renderCodeUpgradePrompt(request),
        conversation_instructions: "EvoPilot 托管代码升级运行时。全程必须真实执行，不允许模拟结果；完成后使用 finish 输出机器可解析的 JSON 结果。"
      })
    });
    await this.fetchJson(`/api/conversations/${encodeURIComponent(String(response.conversation_id ?? response.conversationId ?? response.id))}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers_set: null
      })
    });
    return {
      conversationId: String(response.conversation_id ?? response.conversationId ?? response.id),
      status: normalizeOpenHandsStatus(response.conversation_status ?? response.status)
    };
  }

  async readCodeUpgradeSnapshot(conversationId: string): Promise<OpenHandsCodeUpgradeSnapshot> {
    const managedSnapshot = await this.readManagedCodeUpgradeSnapshot(conversationId).catch((error) => {
      if (isMissingManagedRuntimeRoute(error)) return undefined;
      throw error;
    });
    if (managedSnapshot) return managedSnapshot;

    const [conversation, eventResponse, changes, diff] = await Promise.all([
      this.fetchJson(`/api/conversations/${encodeURIComponent(conversationId)}`).catch(() => ({})),
      this.fetchJson(`/api/conversations/${encodeURIComponent(conversationId)}/events?start_id=0&limit=100`).catch(() => ({ events: [] })),
      this.fetchJson(`/api/conversations/${encodeURIComponent(conversationId)}/git/changes`).catch(() => undefined),
      this.fetchJson(`/api/conversations/${encodeURIComponent(conversationId)}/git/diff?path=${encodeURIComponent(".")}`).catch(() => undefined)
    ]);
    const events = Array.isArray(eventResponse.events) ? eventResponse.events.map(normalizeOpenHandsEvent) : [];
    const finish = parseFinishArtifacts(events);
    const status = containsTerminalExecutionError(events) || containsForbiddenLocalFallback(events) ? "FAILED" : statusFromConversationAndEvents(conversation, events);
    return {
      conversationId,
      status,
      events,
      diff: finish.diff ?? stringifyDiff(diff),
      branchName: finish.branchName,
      commitSha: finish.commitSha,
      pullRequestUrl: finish.pullRequestUrl,
      changedFiles: finish.changedFiles ?? changedFilesFromOpenHands(changes)
    };
  }

  private async startManagedCodeUpgrade(request: OpenHandsCodeUpgradeRequest): Promise<OpenHandsCodeUpgradeSession> {
    const response = await this.fetchJson("/api/v1/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repository: request.repository,
        branchStrategy: request.branchStrategy,
        proposalMarkdown: request.proposalMarkdown,
        codeContext: request.codeContext,
        validationCommands: request.validationCommands,
        validationPlan: request.validationPlan,
        allowedPaths: request.allowedPaths,
        protectedPaths: request.protectedPaths,
        initialUserMessage: renderCodeUpgradePrompt(request)
      })
    });
    return {
      workspaceId: response.workspaceId,
      conversationId: String(response.conversationId ?? response.conversation_id ?? response.id),
      status: normalizeOpenHandsStatus(response.status)
    };
  }

  private async readManagedCodeUpgradeSnapshot(conversationId: string): Promise<OpenHandsCodeUpgradeSnapshot> {
    const response = await this.fetchJson(`/api/v1/conversations/${encodeURIComponent(conversationId)}`);
    const events = Array.isArray(response.events) ? response.events.map(normalizeManagedRuntimeEvent) : [];
    return {
      workspaceId: response.workspaceId,
      conversationId: String(response.conversationId ?? conversationId),
      status: normalizeOpenHandsStatus(response.status),
      events,
      diff: typeof response.diff === "string" ? response.diff : undefined,
      branchName: response.branchName,
      commitSha: response.commitSha,
      pullRequestUrl: response.pullRequestUrl,
      changedFiles: Array.isArray(response.changedFiles) ? response.changedFiles.map((file: unknown) => String(file)) : undefined
    };
  }

  private async configureRuntime(request: OpenHandsCodeUpgradeRequest): Promise<void> {
    const providerToken = providerTokenPayload(request.repository);
    if (this.config.llmApiKey || this.config.llmBaseUrl || this.config.llmModel || this.config.defaultModel) {
      await this.fetchJson("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language: "zh-CN",
          agent: "CodeActAgent",
          max_iterations: this.config.maxIterations ?? 80,
          confirmation_mode: false,
          llm_model: toLiteLlmModel(this.config.llmModel ?? this.config.defaultModel),
          llm_api_key: this.config.llmApiKey,
          llm_base_url: this.config.llmBaseUrl,
          enable_default_condenser: true,
          condenser_max_size: this.config.condenserMaxSize ?? 12000,
          git_user_name: this.config.gitUserName ?? "EvoPilot",
          git_user_email: this.config.gitUserEmail ?? "evopilot@local",
          secrets_store: {
            provider_tokens: providerToken ? { [providerToken.provider]: providerToken.token } : {},
            custom_secrets: {
              ...(providerToken ? {
                EVOPILOT_GIT_USERNAME: {
                  value: request.repository?.username ?? "oauth2",
                  description: "EvoPilot 注册项目的 Git 用户名"
                },
                EVOPILOT_GIT_TOKEN: {
                  value: providerToken.token,
                  description: "EvoPilot 注册项目的 Git 访问令牌或密码"
                }
              } : {})
            }
          }
        })
      });
    }
    if (providerToken) {
      await this.upsertSecret("EVOPILOT_GIT_USERNAME", request.repository?.username ?? "oauth2", "EvoPilot 注册项目的 Git 用户名");
      await this.upsertSecret("EVOPILOT_GIT_TOKEN", providerToken.token, "EvoPilot 注册项目的 Git 访问令牌或密码");
      await this.fetchJson("/api/add-git-providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mcp_config: null,
          provider_tokens: {
            [providerToken.provider]: {
              token: providerToken.token,
              user_id: request.repository?.username,
              host: providerToken.host
            }
          }
        })
      }).catch(() => undefined);
    }
  }

  private async upsertSecret(name: string, value: string, description: string): Promise<void> {
    await this.fetchJson(`/api/secrets/${encodeURIComponent(name)}`, {
      method: "DELETE"
    }).catch(() => undefined);
    await this.fetchJson("/api/secrets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, value, description })
    });
  }

  private async fetchJson(pathname: string, init?: RequestInit): Promise<any> {
    const response = await this.fetchFn(this.absolute(pathname), {
      ...init,
      headers: {
        ...this.authHeaders(),
        ...(init?.headers ?? {})
      }
    });
    if (!response.ok) throw new Error(`OpenHands API 失败：${response.status} ${await response.text()}`);
    return response.json();
  }

  private absolute(pathname: string): string {
    return new URL(pathname.replace(/^\/+/, ""), this.config.baseUrl.endsWith("/") ? this.config.baseUrl : `${this.config.baseUrl}/`).toString();
  }

  private authHeaders(): Record<string, string> {
    return this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {};
  }
}

export function renderCodeUpgradePrompt(request: OpenHandsCodeUpgradeRequest): string {
  return [
    "你是 EvoPilot 的代码升级 Agent。",
    "请基于用户确认后的进化方案修改当前项目代码，并保持过程可追踪。",
    "",
    "执行约束：",
    "1. 只修改与进化方案相关的文件。",
    "2. 不修改受保护目录。",
    "3. 修改完成后运行指定验证命令。",
    "4. 输出变更摘要、影响文件、测试结果和 diff。",
    "5. 如果无法完成，说明阻塞原因，不要伪造结果。",
    "6. 所有 execute_bash / 文件编辑 / 浏览器 / Python 工具调用都必须包含 security_risk 参数；项目内 clone、读写、测试、git push 统一标记为 MEDIUM。",
    "",
    `项目：${request.projectId}`,
    `源分支：${request.branchStrategy.sourceBranch}`,
    `升级分支：${request.branchStrategy.upgradeBranch}`,
    `提交信息：${request.branchStrategy.commitMessage}`,
    `合并请求标题：${request.branchStrategy.mergeRequestTitle}`,
    `受保护目录：${(request.protectedPaths ?? []).join(", ") || "无"}`,
    `仓库地址：${request.repository?.gitUrl ?? request.repository?.root ?? "未指定"}`,
    "",
    "Git 操作要求：",
    "1. 必须从注册的远程仓库 clone 或 fetch 源分支；如果 clone/fetch 失败，立刻 finish 输出失败 JSON，不允许继续。",
    "2. 创建并切换到升级分支。",
    "3. 完成代码修改后提交并推送升级分支。",
    "4. 创建指向源分支的 Merge Request。",
    "5. 不要在任何输出中打印 token、密码、Authorization 头或带凭证的 Git URL。",
    "6. 最后调用 finish，并且 finish 文本必须是 JSON：{\"branchName\":\"...\",\"commitSha\":\"...\",\"pullRequestUrl\":\"...\",\"changedFiles\":[\"...\"],\"diff\":\"...\"}。",
    "7. 严禁在 clone/fetch 失败后使用 git init、本地空仓库、示例代码或占位文件替代真实仓库；这会被 EvoPilot 判定为生产失败。",
    "",
    ...(request.repository?.provider === "gitlab" || request.repository?.provider === "github" ? [
      "远程仓库凭据：",
      "- 运行时已注入环境变量 EVOPILOT_GIT_USERNAME 和 EVOPILOT_GIT_TOKEN。",
      "- clone/push 时必须使用临时 GIT_ASKPASS 脚本或 git credential helper 读取环境变量。",
      "- 禁止用 console.log、echo、set -x 或命令参数打印/拼接带凭据 URL。",
      "- 推荐方式：创建 /tmp/evopilot-askpass.sh，按 Git 的 Username/Password 提示分别输出 EVOPILOT_GIT_USERNAME 和 EVOPILOT_GIT_TOKEN，然后设置 GIT_ASKPASS 和 GIT_TERMINAL_PROMPT=0 执行 git clone/push。",
      ""
    ] : []),
    "",
    "验证命令：",
    ...(request.validationCommands.length > 0 ? request.validationCommands.map((command) => `- ${command}`) : ["- 未指定"]),
    "",
    "进化方案 Markdown：",
    request.proposalMarkdown
  ].join("\n");
}

export function normalizeOpenHandsStatus(value: unknown): OpenHandsRunStatus {
  const text = String(value ?? "RUNNING").toUpperCase();
  if (text === "QUEUED" || text === "RUNNING" || text === "SUCCEEDED" || text === "FAILED" || text === "CANCELED") return text;
  if (text === "SUCCESS" || text === "COMPLETED" || text === "COMPLETE") return "SUCCEEDED";
  if (text === "FINISHED" || text === "STOPPED") return "SUCCEEDED";
  if (text === "STARTING" || text === "LOADING") return "RUNNING";
  if (text === "ERROR") return "FAILED";
  return "RUNNING";
}

function normalizeOpenHandsEvent(event: any): OpenHandsCodeUpgradeEvent {
  const state = event.extras?.agent_state;
  const reason = event.extras?.reason;
  const message = event.message ?? event.content ?? reason ?? state ?? "";
  return {
    id: String(event.id ?? `event-${Date.now()}`),
    timestamp: event.timestamp ? String(event.timestamp) : undefined,
    source: event.source ? String(event.source) as OpenHandsCodeUpgradeEvent["source"] : "openhands",
    phase: event.phase ? String(event.phase) : event.action && event.action !== "message" ? String(event.action) : event.observation ? String(event.observation) : undefined,
    level: state === "error" ? "error" : event.level ? String(event.level) as OpenHandsCodeUpgradeEvent["level"] : "info",
    message: String(message),
    raw: event
  };
}

function normalizeManagedRuntimeEvent(event: any): OpenHandsCodeUpgradeEvent {
  return {
    id: String(event.id ?? `event-${Date.now()}`),
    timestamp: event.timestamp ? String(event.timestamp) : undefined,
    source: event.source ? String(event.source) as OpenHandsCodeUpgradeEvent["source"] : "openhands",
    phase: event.phase ? String(event.phase) : undefined,
    level: event.level ? String(event.level) as OpenHandsCodeUpgradeEvent["level"] : "info",
    message: String(event.message ?? ""),
    raw: event.raw ?? event
  };
}

function statusFromConversationAndEvents(conversation: any, events: OpenHandsCodeUpgradeEvent[]): OpenHandsRunStatus {
  const lastState = [...events].reverse().find((event) => event.phase === "agent_state_changed");
  const state = (lastState?.raw as any)?.extras?.agent_state;
  if (state === "finished" || state === "stopped") return "SUCCEEDED";
  if (state === "error") return "FAILED";
  return normalizeOpenHandsStatus(conversation.conversation_status ?? conversation.status);
}

function parseFinishArtifacts(events: OpenHandsCodeUpgradeEvent[]): Partial<Pick<OpenHandsCodeUpgradeSnapshot, "branchName" | "commitSha" | "pullRequestUrl" | "changedFiles" | "diff">> {
  const finish = [...events].reverse().find((event) => (event.raw as any)?.action === "finish" || event.phase === "finish");
  const text = finish?.message?.trim();
  if (!text) return {};
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return {};
  try {
    const parsed = JSON.parse(jsonText);
    return {
      branchName: parsed.branchName ? String(parsed.branchName) : undefined,
      commitSha: parsed.commitSha ? String(parsed.commitSha) : undefined,
      pullRequestUrl: parsed.pullRequestUrl ? String(parsed.pullRequestUrl) : undefined,
      diff: parsed.diff ? String(parsed.diff) : undefined,
      changedFiles: Array.isArray(parsed.changedFiles) ? parsed.changedFiles.map((file: unknown) => String(file)) : undefined
    };
  } catch {
    return {};
  }
}

function stringifyDiff(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value.diff === "string") return value.diff;
  if (typeof value.patch === "string") return value.patch;
  return undefined;
}

function changedFilesFromOpenHands(value: any): string[] | undefined {
  if (!value) return undefined;
  const files = Array.isArray(value) ? value : Array.isArray(value.files) ? value.files : Array.isArray(value.changes) ? value.changes : undefined;
  if (!files) return undefined;
  return files.map((item: any) => String(item.path ?? item.filename ?? item)).filter(Boolean);
}

function repositorySelector(repository?: OpenHandsRepositoryRef): string | null {
  if (!repository) return null;
  if (repository.provider === "local-git") return repository.root ?? null;
  if (!repository.gitUrl) return null;
  const pathname = new URL(repository.gitUrl).pathname.replace(/^\/+/, "").replace(/\.git$/, "");
  return pathname || repository.gitUrl;
}

function gitProvider(repository?: OpenHandsRepositoryRef): "gitlab" | "github" | null {
  if (repository?.provider === "gitlab" || repository?.provider === "github") return repository.provider;
  return null;
}

function providerSet(repository?: OpenHandsRepositoryRef): Array<"gitlab" | "github"> | null {
  const provider = gitProvider(repository);
  return provider ? [provider] : null;
}

function safeHost(value: string): string | undefined {
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function toLiteLlmModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  if (model.includes("/")) return model;
  return `openai/${model}`;
}

function providerTokenPayload(repository?: OpenHandsRepositoryRef): { provider: "gitlab" | "github"; token: string; host: string } | undefined {
  const provider = gitProvider(repository);
  const token = repository?.token || repository?.password;
  const host = repository?.gitUrl ? safeHost(repository.gitUrl) : undefined;
  if (!provider || !token || !host) return undefined;
  return { provider, token, host };
}

function containsForbiddenLocalFallback(events: OpenHandsCodeUpgradeEvent[]): boolean {
  const text = events.map((event) => `${event.message}\n${JSON.stringify((event.raw as any)?.extras?.command ?? "")}`).join("\n");
  return /git\s+init/.test(text) || /Initial commit/.test(text) || /本地空仓库|示例代码|占位文件/.test(text);
}

function containsTerminalExecutionError(events: OpenHandsCodeUpgradeEvent[]): boolean {
  return events.some((event) => {
    const raw = event.raw as any;
    const text = `${event.message}\n${raw?.content ?? ""}`;
    return raw?.observation === "error" && /Missing required parameters|Malformed|security_risk|Tool .* failed/i.test(text);
  });
}

function isMissingManagedRuntimeRoute(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /OpenHands API 失败：404|OpenHands API 失败：405/.test(message);
}
