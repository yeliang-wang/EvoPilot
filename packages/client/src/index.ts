export interface EvoPilotClientOptions {
  serverUrl: string;
  token?: string;
  tenantId?: string;
  workspaceId?: string;
  actor?: string;
  headers?: Record<string, string>;
}

export interface EvoPilotRequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export interface EvoPilotResponse<T = unknown> {
  status: number;
  ok: boolean;
  headers: Headers;
  requestId?: string;
  body: T;
  data: unknown;
}

export class EvoPilotApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "EvoPilotApiError";
    this.status = status;
    this.body = body;
  }
}

export class EvoPilotClient {
  readonly serverUrl: string;
  readonly token?: string;
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly actor?: string;
  readonly headers: Record<string, string>;
  lastResponse?: EvoPilotResponse;

  constructor(options: EvoPilotClientOptions) {
    this.serverUrl = normalizeServerUrl(options.serverUrl);
    this.token = options.token;
    this.tenantId = options.tenantId;
    this.workspaceId = options.workspaceId;
    this.actor = options.actor;
    this.headers = options.headers ?? {};
  }

  async get<T = unknown>(path: string, options: EvoPilotRequestOptions = {}): Promise<EvoPilotResponse<T>> {
    return this.request<T>("GET", path, options);
  }

  async post<T = unknown>(path: string, body?: unknown, options: Omit<EvoPilotRequestOptions, "body"> = {}): Promise<EvoPilotResponse<T>> {
    return this.request<T>("POST", path, { ...options, body: body ?? {} });
  }

  async patch<T = unknown>(path: string, body?: unknown, options: Omit<EvoPilotRequestOptions, "body"> = {}): Promise<EvoPilotResponse<T>> {
    return this.request<T>("PATCH", path, { ...options, body: body ?? {} });
  }

  async request<T = unknown>(method: string, path: string, options: EvoPilotRequestOptions = {}): Promise<EvoPilotResponse<T>> {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, this.serverUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers = new Headers({ ...this.headers, ...(options.headers ?? {}) });
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    if (this.tenantId) headers.set("x-evopilot-tenant", this.tenantId);
    if (this.workspaceId) headers.set("x-evopilot-workspace", this.workspaceId);
    if (this.actor) headers.set("x-evopilot-actor", this.actor);
    if (options.idempotencyKey) headers.set("x-idempotency-key", options.idempotencyKey);

    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(stripUndefined(options.body));
    }

    const response = await fetch(url, { method, headers, body });
    const parsed = await parseResponseBody(response);
    const result = {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      requestId: response.headers.get("x-request-id") ?? undefined,
      body: parsed as T,
      data: isRecord(parsed) && "data" in parsed ? parsed.data : undefined
    };
    this.lastResponse = result;
    return result;
  }

  async expectOk<T = unknown>(response: Promise<EvoPilotResponse<T>>): Promise<EvoPilotResponse<T>> {
    const resolved = await response;
    if (!resolved.ok) throw apiErrorFromResponse(resolved);
    return resolved;
  }
}

export function apiErrorFromResponse(response: EvoPilotResponse): EvoPilotApiError {
  const body = response.body;
  const error = isRecord(body) && typeof body.error === "string" ? body.error : `HTTP_${response.status}`;
  const detail = isRecord(body) && body.detail ? `: ${String(body.detail)}` : "";
  return new EvoPilotApiError(`${error}${detail}`, response.status, body);
}

function normalizeServerUrl(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "http://127.0.0.1:19876";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return JSON.parse(text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = stripUndefined(child);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
