export interface GitHubAdapterConfig {
  tokenRef?: string;
  token?: string;
  owner: string;
  repo: string;
  apiBaseUrl?: string;
}

export const gitHubAdapterCapability = {
  listFiles: true,
  createPullRequest: true,
  readChecks: true,
  readRef: true,
  createBranch: true,
  upsertFile: true,
  createTag: true,
  mergePullRequest: true
};

export interface GitHubPullRequestDraft {
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface GitHubFileUpsert {
  path: string;
  content: string;
  message: string;
  branch: string;
  sha?: string;
}

export class GitHubHttpAdapter {
  constructor(private readonly config: GitHubAdapterConfig) {}

  async listFiles(ref: string = "main"): Promise<string[]> {
    const response = await this.requestJson<any>("GET", `/git/trees/${encodeURIComponent(ref)}?recursive=1`, undefined, { allowAnonymous: true });
    return (response.tree ?? [])
      .filter((item: any) => item.type === "blob")
      .map((item: any) => String(item.path))
      .sort();
  }

  async createPullRequest(draft: GitHubPullRequestDraft): Promise<{ number: number; htmlUrl?: string }> {
    const response = await this.requestJson<any>("POST", "/pulls", draft);
    return {
      number: Number(response.number),
      htmlUrl: response.html_url ? String(response.html_url) : undefined
    };
  }

  async mergePullRequest(number: number, input: { commitTitle?: string; commitMessage?: string } = {}): Promise<{ sha: string; merged: boolean; message?: string }> {
    const response = await this.requestJson<any>("PUT", `/pulls/${encodeURIComponent(String(number))}/merge`, {
      ...(input.commitTitle ? { commit_title: input.commitTitle } : {}),
      ...(input.commitMessage ? { commit_message: input.commitMessage } : {})
    });
    return {
      sha: String(response.sha ?? ""),
      merged: Boolean(response.merged ?? true),
      message: response.message ? String(response.message) : undefined
    };
  }

  async getRef(ref: string): Promise<{ ref: string; sha: string }> {
    const normalized = ref.startsWith("refs/") ? ref.replace(/^refs\//, "") : ref;
    const response = await this.requestJson<any>("GET", `/git/ref/${encodeURIComponent(normalized)}`);
    return {
      ref: String(response.ref ?? `refs/${normalized}`),
      sha: String(response.object?.sha ?? response.sha ?? "")
    };
  }

  async createBranch(branch: string, sha: string): Promise<{ ref: string; sha: string }> {
    const response = await this.requestJson<any>("POST", "/git/refs", {
      ref: `refs/heads/${branch}`,
      sha
    });
    return {
      ref: String(response.ref ?? `refs/heads/${branch}`),
      sha: String(response.object?.sha ?? sha)
    };
  }

  async upsertFile(file: GitHubFileUpsert): Promise<{ commitSha: string; contentSha?: string; htmlUrl?: string }> {
    const response = await this.requestJson<any>("PUT", `/contents/${file.path.split("/").map(encodeURIComponent).join("/")}`, {
      message: file.message,
      content: Buffer.from(file.content, "utf8").toString("base64"),
      branch: file.branch,
      ...(file.sha ? { sha: file.sha } : {})
    });
    return {
      commitSha: String(response.commit?.sha ?? ""),
      contentSha: response.content?.sha ? String(response.content.sha) : undefined,
      htmlUrl: response.content?.html_url ? String(response.content.html_url) : undefined
    };
  }

  async createTag(tagName: string, sha: string): Promise<{ ref: string; sha: string }> {
    const response = await this.requestJson<any>("POST", "/git/refs", {
      ref: `refs/tags/${tagName}`,
      sha
    });
    return {
      ref: String(response.ref ?? `refs/tags/${tagName}`),
      sha: String(response.object?.sha ?? sha)
    };
  }

  async listChecks(ref: string): Promise<Array<{ name: string; status: string; conclusion?: string }>> {
    const response = await this.requestJson<any>("GET", `/commits/${encodeURIComponent(ref)}/check-runs`);
    return (response.check_runs ?? []).map((check: any) => ({
      name: String(check.name ?? ""),
      status: String(check.status ?? ""),
      conclusion: check.conclusion ? String(check.conclusion) : undefined
    }));
  }

  private async requestJson<T>(method: string, apiPath: string, body?: unknown, options: { allowAnonymous?: boolean } = {}): Promise<T> {
    const token = this.config.token;
    if (!token && !options.allowAnonymous) throw new Error("GitHub token is required");
    const baseUrl = (this.config.apiBaseUrl ?? "https://api.github.com").replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}${apiPath}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
  }
}
