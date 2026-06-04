export interface OpenHandsConnectorConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  workspaceMode?: "docker" | "remote";
  defaultModel?: string;
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
  validationCommands: string[];
  protectedPaths?: string[];
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
    const response = await this.fetchJson("/api/v1/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceMode: this.config.workspaceMode ?? "docker",
        model: this.config.defaultModel,
        repository: request.repository,
        branchStrategy: request.branchStrategy,
        proposalMarkdown: request.proposalMarkdown,
        validationCommands: request.validationCommands,
        protectedPaths: request.protectedPaths ?? [],
        initialUserMessage: renderCodeUpgradePrompt(request)
      })
    });
    return {
      workspaceId: response.workspaceId ? String(response.workspaceId) : undefined,
      conversationId: String(response.conversationId ?? response.id),
      status: normalizeOpenHandsStatus(response.status)
    };
  }

  async readCodeUpgradeSnapshot(conversationId: string): Promise<OpenHandsCodeUpgradeSnapshot> {
    const response = await this.fetchJson(`/api/v1/conversations/${encodeURIComponent(conversationId)}`);
    return {
      workspaceId: response.workspaceId ? String(response.workspaceId) : undefined,
      conversationId: String(response.conversationId ?? response.id ?? conversationId),
      status: normalizeOpenHandsStatus(response.status),
      events: Array.isArray(response.events) ? response.events.map(normalizeOpenHandsEvent) : [],
      diff: response.diff ? String(response.diff) : undefined,
      branchName: response.branchName ? String(response.branchName) : undefined,
      commitSha: response.commitSha ? String(response.commitSha) : undefined,
      pullRequestUrl: response.pullRequestUrl ? String(response.pullRequestUrl) : undefined,
      changedFiles: Array.isArray(response.changedFiles) ? response.changedFiles.map((file: unknown) => String(file)) : undefined
    };
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
    "",
    `项目：${request.projectId}`,
    `源分支：${request.branchStrategy.sourceBranch}`,
    `升级分支：${request.branchStrategy.upgradeBranch}`,
    `提交信息：${request.branchStrategy.commitMessage}`,
    `合并请求标题：${request.branchStrategy.mergeRequestTitle}`,
    `受保护目录：${(request.protectedPaths ?? []).join(", ") || "无"}`,
    "",
    "Git 操作要求：",
    "1. 从源分支拉取最新代码。",
    "2. 创建并切换到升级分支。",
    "3. 完成代码修改后提交并推送升级分支。",
    "4. 创建指向源分支的 Merge Request，并在结果中返回 branchName、commitSha、pullRequestUrl 和 diff。",
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
  if (text === "ERROR") return "FAILED";
  return "RUNNING";
}

function normalizeOpenHandsEvent(event: any): OpenHandsCodeUpgradeEvent {
  return {
    id: String(event.id ?? `event-${Date.now()}`),
    timestamp: event.timestamp ? String(event.timestamp) : undefined,
    source: event.source ? String(event.source) as OpenHandsCodeUpgradeEvent["source"] : "openhands",
    phase: event.phase ? String(event.phase) : undefined,
    level: event.level ? String(event.level) as OpenHandsCodeUpgradeEvent["level"] : "info",
    message: String(event.message ?? event.content ?? ""),
    raw: event
  };
}
