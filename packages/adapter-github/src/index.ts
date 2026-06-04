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
  readChecks: true
};

export interface GitHubPullRequestDraft {
  title: string;
  body: string;
  head: string;
  base: string;
}

export class GitHubHttpAdapter {
  constructor(private readonly config: GitHubAdapterConfig) {}

  async listFiles(ref: string = "main"): Promise<string[]> {
    const response = await this.requestJson<any>("GET", `/git/trees/${encodeURIComponent(ref)}?recursive=1`);
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

  async listChecks(ref: string): Promise<Array<{ name: string; status: string; conclusion?: string }>> {
    const response = await this.requestJson<any>("GET", `/commits/${encodeURIComponent(ref)}/check-runs`);
    return (response.check_runs ?? []).map((check: any) => ({
      name: String(check.name ?? ""),
      status: String(check.status ?? ""),
      conclusion: check.conclusion ? String(check.conclusion) : undefined
    }));
  }

  private async requestJson<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
    const token = this.config.token;
    if (!token) throw new Error("GitHub token is required");
    const baseUrl = (this.config.apiBaseUrl ?? "https://api.github.com").replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}${apiPath}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
  }
}
