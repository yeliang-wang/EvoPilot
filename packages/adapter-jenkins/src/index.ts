export interface JenkinsConnectorConfig {
  id: string;
  name: string;
  baseUrl: string;
  username?: string;
  apiToken?: string;
}

export type JenkinsPipelineStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "UNKNOWN";
export type JenkinsStageStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "UNKNOWN";

export interface JenkinsPipelineStage {
  id: string;
  name: string;
  status: JenkinsStageStatus;
  startedAt?: string;
  durationMs?: number;
  logUrl?: string;
}

export interface JenkinsPipelineArtifact {
  name: string;
  url: string;
  sizeBytes?: number;
}

export interface JenkinsBuildRequest {
  jobName: string;
  parameters?: Record<string, string>;
}

export interface JenkinsQueuedBuild {
  queueId?: string;
  queueUrl?: string;
}

export interface JenkinsBuildSnapshot {
  status: JenkinsPipelineStatus;
  buildNumber?: number;
  buildUrl?: string;
  stages: JenkinsPipelineStage[];
  artifacts: JenkinsPipelineArtifact[];
  logPreview?: string;
}

export class JenkinsClient {
  constructor(
    private readonly config: JenkinsConnectorConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async triggerBuild(request: JenkinsBuildRequest): Promise<JenkinsQueuedBuild> {
    const endpoint = request.parameters && Object.keys(request.parameters).length > 0 ? "buildWithParameters" : "build";
    const url = this.urlForJob(request.jobName, endpoint);
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(request.parameters ?? {})
    });
    if (!response.ok && response.status !== 201) {
      throw new Error(`Jenkins 触发失败：${response.status} ${await response.text()}`);
    }
    const location = response.headers.get("location") ?? undefined;
    return {
      queueUrl: location,
      queueId: location ? location.replace(/\/$/, "").split("/").at(-1) : undefined
    };
  }

  async readBuildSnapshot(jobName: string, queueId?: string, buildNumber?: number): Promise<JenkinsBuildSnapshot> {
    const executable = buildNumber ? { number: buildNumber, url: this.urlForJob(jobName, `${buildNumber}/`) } : await this.readQueueExecutable(queueId);
    if (!executable?.number) {
      return { status: "QUEUED", stages: [], artifacts: [] };
    }
    const [build, stages, logPreview] = await Promise.all([
      this.readBuild(jobName, executable.number),
      this.readStages(jobName, executable.number),
      this.readConsole(jobName, executable.number)
    ]);
    return {
      status: normalizeJenkinsBuildStatus(build),
      buildNumber: executable.number,
      buildUrl: build.url ?? executable.url,
      stages,
      artifacts: Array.isArray(build.artifacts) ? build.artifacts.map((artifact: any) => ({
        name: String(artifact.displayPath ?? artifact.fileName ?? artifact.relativePath),
        url: new URL(`artifact/${artifact.relativePath}`, build.url ?? executable.url).toString()
      })) : [],
      logPreview
    };
  }

  buildConsoleUrl(jobName: string, buildNumber: number): string {
    return this.urlForJob(jobName, `${buildNumber}/console`);
  }

  private async readQueueExecutable(queueId: string | undefined): Promise<{ number: number; url: string } | undefined> {
    if (!queueId) return undefined;
    const response = await this.fetchJson(this.absolute(`/queue/item/${encodeURIComponent(queueId)}/api/json`));
    return response.executable?.number ? { number: Number(response.executable.number), url: String(response.executable.url) } : undefined;
  }

  private async readBuild(jobName: string, buildNumber: number): Promise<any> {
    return this.fetchJson(this.urlForJob(jobName, `${buildNumber}/api/json`));
  }

  private async readStages(jobName: string, buildNumber: number): Promise<JenkinsPipelineStage[]> {
    try {
      const response = await this.fetchJson(this.urlForJob(jobName, `${buildNumber}/wfapi/describe`));
      if (!Array.isArray(response.stages)) return [];
      return response.stages.map((stage: any) => ({
        id: String(stage.id ?? stage.name),
        name: String(stage.name ?? stage.id),
        status: normalizeJenkinsStageStatus(stage.status),
        startedAt: stage.startTimeMillis ? new Date(Number(stage.startTimeMillis)).toISOString() : undefined,
        durationMs: typeof stage.durationMillis === "number" ? stage.durationMillis : undefined
      }));
    } catch {
      return [];
    }
  }

  private async readConsole(jobName: string, buildNumber: number): Promise<string> {
    const response = await this.fetchFn(this.urlForJob(jobName, `${buildNumber}/consoleText`), {
      headers: this.authHeaders()
    });
    if (!response.ok) return "";
    return (await response.text()).split("\n").slice(-20).join("\n");
  }

  private async fetchJson(url: string): Promise<any> {
    const response = await this.fetchFn(url, { headers: this.authHeaders() });
    if (!response.ok) throw new Error(`Jenkins API 失败：${response.status} ${await response.text()}`);
    return response.json();
  }

  private urlForJob(jobName: string, suffix: string): string {
    const jobPath = jobName.split("/").filter(Boolean).map((part) => `job/${encodeURIComponent(part)}`).join("/");
    return this.absolute(`/${jobPath}/${suffix}`);
  }

  private absolute(pathname: string): string {
    return new URL(pathname.replace(/^\/+/, ""), this.config.baseUrl.endsWith("/") ? this.config.baseUrl : `${this.config.baseUrl}/`).toString();
  }

  private authHeaders(): Record<string, string> {
    if (!this.config.username || !this.config.apiToken) return {};
    return {
      authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.apiToken}`).toString("base64")}`
    };
  }
}

export function normalizeJenkinsBuildStatus(build: { building?: boolean; result?: string | null }): JenkinsPipelineStatus {
  if (build.building) return "RUNNING";
  if (build.result === "SUCCESS") return "SUCCEEDED";
  if (build.result === "FAILURE" || build.result === "UNSTABLE") return "FAILED";
  if (build.result === "ABORTED") return "CANCELED";
  if (build.result === null || build.result === undefined) return "RUNNING";
  return "UNKNOWN";
}

export function normalizeJenkinsStageStatus(value: unknown): JenkinsStageStatus {
  if (value === "SUCCESS") return "SUCCEEDED";
  if (value === "FAILED" || value === "FAILURE") return "FAILED";
  if (value === "PAUSED_PENDING_INPUT" || value === "IN_PROGRESS") return "RUNNING";
  if (value === "NOT_EXECUTED") return "SKIPPED";
  return "UNKNOWN";
}
