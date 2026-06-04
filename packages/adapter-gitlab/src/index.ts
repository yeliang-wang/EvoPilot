export interface GitLabAdapterConfig {
  baseUrl: string;
  tokenRef?: string;
  token?: string;
  projectId: string;
}

export interface GitLabAdapterCapability {
  listFiles: boolean;
  createMergeRequest: boolean;
  readPipelines: boolean;
}

export const gitLabAdapterCapability: GitLabAdapterCapability = {
  listFiles: true,
  createMergeRequest: true,
  readPipelines: true
};

export interface GitLabPipeline {
  id: number;
  status: string;
  ref: string;
  webUrl?: string;
}

export interface GitLabMergeRequestDraft {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
}

export class GitLabHttpAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: GitLabAdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  async listFiles(ref: string): Promise<string[]> {
    const files: string[] = [];
    for (let page = 1; ; page += 1) {
      const params = new URLSearchParams({ ref, recursive: "true", per_page: "100", page: String(page) });
      const batch = await this.getJson<Array<{ type: string; path: string }>>(`/repository/tree?${params.toString()}`);
      files.push(...batch.filter((item) => item.type === "blob").map((item) => item.path));
      if (batch.length < 100) break;
    }
    return files;
  }

  async listPipelines(ref?: string): Promise<GitLabPipeline[]> {
    const params = new URLSearchParams({ per_page: "20" });
    if (ref) params.set("ref", ref);
    const pipelines = await this.getJson<any[]>(`/pipelines?${params.toString()}`);
    return pipelines.map((pipeline) => ({
      id: Number(pipeline.id),
      status: String(pipeline.status ?? ""),
      ref: String(pipeline.ref ?? ""),
      webUrl: pipeline.web_url ? String(pipeline.web_url) : undefined
    }));
  }

  async createMergeRequest(draft: GitLabMergeRequestDraft): Promise<{ iid: number; webUrl?: string }> {
    const response = await this.postJson<any>("/merge_requests", {
      title: draft.title,
      description: draft.description,
      source_branch: draft.sourceBranch,
      target_branch: draft.targetBranch
    });
    return {
      iid: Number(response.iid),
      webUrl: response.web_url ? String(response.web_url) : undefined
    };
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.requestJson<T>("GET", path);
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.requestJson<T>("POST", path, body);
  }

  private async requestJson<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
    const token = this.config.token;
    if (!token) throw new Error("GitLab token is required");
    const response = await fetch(`${this.baseUrl}/api/v4/projects/${encodeURIComponent(this.config.projectId)}${apiPath}`, {
      method,
      headers: {
        "PRIVATE-TOKEN": token,
        "content-type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`GitLab request failed: ${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
  }
}
