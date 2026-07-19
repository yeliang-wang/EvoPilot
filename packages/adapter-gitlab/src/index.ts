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
  triggerPipeline: boolean;
  readPipelineJobs: boolean;
  createBranch: boolean;
  commitFiles: boolean;
  createTag: boolean;
  mergeMergeRequest: boolean;
}

export const gitLabAdapterCapability: GitLabAdapterCapability = {
  listFiles: true,
  createMergeRequest: true,
  readPipelines: true,
  triggerPipeline: true,
  readPipelineJobs: true,
  createBranch: true,
  commitFiles: true,
  createTag: true,
  mergeMergeRequest: true
};

export interface GitLabPipeline {
  id: number;
  status: string;
  ref: string;
  webUrl?: string;
}

export interface GitLabPipelineJob {
  id: number;
  name: string;
  stage: string;
  status: string;
  webUrl?: string;
}

export interface GitLabMergeRequestDraft {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
}

export interface GitLabCommitAction {
  action: "create" | "update" | "delete";
  filePath: string;
  content?: string;
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

  async triggerPipeline(ref: string, variables: Record<string, string> = {}): Promise<GitLabPipeline> {
    const response = await this.postJson<any>("/pipeline", {
      ref,
      variables: Object.entries(variables).map(([key, value]) => ({ key, value }))
    });
    return {
      id: Number(response.id),
      status: String(response.status ?? ""),
      ref: String(response.ref ?? ref),
      webUrl: response.web_url ? String(response.web_url) : undefined
    };
  }

  async listPipelineJobs(pipelineId: number): Promise<GitLabPipelineJob[]> {
    const jobs = await this.getJson<any[]>(`/pipelines/${encodeURIComponent(String(pipelineId))}/jobs?per_page=100`);
    return jobs.map((job) => ({
      id: Number(job.id),
      name: String(job.name ?? ""),
      stage: String(job.stage ?? ""),
      status: String(job.status ?? ""),
      webUrl: job.web_url ? String(job.web_url) : undefined
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

  async mergeMergeRequest(iid: number, input: { commitMessage?: string } = {}): Promise<{ id: string; iid: number; mergeCommitSha?: string; webUrl?: string }> {
    const response = await this.requestJson<any>("PUT", `/merge_requests/${encodeURIComponent(String(iid))}/merge`, {
      ...(input.commitMessage ? { merge_commit_message: input.commitMessage } : {})
    });
    return {
      id: String(response.id ?? ""),
      iid: Number(response.iid ?? iid),
      mergeCommitSha: response.merge_commit_sha ? String(response.merge_commit_sha) : undefined,
      webUrl: response.web_url ? String(response.web_url) : undefined
    };
  }

  async createBranch(branch: string, ref: string): Promise<{ name: string; webUrl?: string }> {
    const response = await this.postJson<any>("/repository/branches", {
      branch,
      ref
    });
    return {
      name: String(response.name ?? branch),
      webUrl: response.web_url ? String(response.web_url) : undefined
    };
  }

  async commitFiles(input: { branch: string; message: string; actions: GitLabCommitAction[] }): Promise<{ id: string; shortId?: string; webUrl?: string }> {
    const response = await this.postJson<any>("/repository/commits", {
      branch: input.branch,
      commit_message: input.message,
      actions: input.actions.map((action) => ({
        action: action.action,
        file_path: action.filePath,
        ...(action.content === undefined ? {} : { content: action.content })
      }))
    });
    return {
      id: String(response.id ?? ""),
      shortId: response.short_id ? String(response.short_id) : undefined,
      webUrl: response.web_url ? String(response.web_url) : undefined
    };
  }

  async createTag(tagName: string, ref: string, message?: string): Promise<{ name: string; target?: string; webUrl?: string }> {
    const response = await this.postJson<any>("/repository/tags", {
      tag_name: tagName,
      ref,
      ...(message ? { message } : {})
    });
    return {
      name: String(response.name ?? tagName),
      target: response.target ? String(response.target) : undefined,
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
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}
