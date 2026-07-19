import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { GitHubHttpAdapter } from "../../packages/adapter-github/dist/index.js";
import { GitLabHttpAdapter } from "../../packages/adapter-gitlab/dist/index.js";

test("GitLab adapter talks to a real HTTP boundary", async () => {
  const seen = [];
  const server = http.createServer(async (request, response) => {
    seen.push({ method: request.method, url: request.url, token: request.headers["private-token"] });
    if (request.url?.startsWith("/api/v4/projects/group%2Fproject/repository/tree")) {
      return json(response, [{ type: "blob", path: "src/index.ts" }, { type: "tree", path: "src" }]);
    }
    if (request.url === "/api/v4/projects/group%2Fproject/pipeline" && request.method === "POST") {
      return json(response, { id: 2, status: "pending", ref: "main", web_url: "http://gitlab/p/2" });
    }
    if (request.url === "/api/v4/projects/group%2Fproject/pipelines/2/jobs?per_page=100") {
      return json(response, [{ id: 21, name: "build", stage: "test", status: "success", web_url: "http://gitlab/job/21" }]);
    }
    if (request.url?.startsWith("/api/v4/projects/group%2Fproject/pipelines")) {
      return json(response, [{ id: 1, status: "success", ref: "main", web_url: "http://gitlab/p/1" }]);
    }
    if (request.url === "/api/v4/projects/group%2Fproject/merge_requests" && request.method === "POST") {
      return json(response, { iid: 7, web_url: "http://gitlab/mr/7" });
    }
    if (request.url === "/api/v4/projects/group%2Fproject/repository/branches" && request.method === "POST") {
      return json(response, { name: "evopilot/source-closure", web_url: "http://gitlab/branch" });
    }
    if (request.url === "/api/v4/projects/group%2Fproject/repository/commits" && request.method === "POST") {
      return json(response, { id: "gitlab-commit-sha", short_id: "gitlab-c", web_url: "http://gitlab/commit/gitlab-c" });
    }
    if (request.url === "/api/v4/projects/group%2Fproject/repository/tags" && request.method === "POST") {
      return json(response, { name: "v2.0.0", target: "evopilot/source-closure", web_url: "http://gitlab/tag/v2.0.0" });
    }
    response.writeHead(404);
    response.end();
  });
  await listen(server);
  const port = server.address().port;
  try {
    const adapter = new GitLabHttpAdapter({ baseUrl: `http://127.0.0.1:${port}`, projectId: "group/project", token: "token" });
    assert.deepEqual(await adapter.listFiles("main"), ["src/index.ts"]);
    assert.equal((await adapter.listPipelines("main"))[0].status, "success");
    assert.equal((await adapter.triggerPipeline("main", { PLAN_ID: "plan-1" })).id, 2);
    assert.equal((await adapter.listPipelineJobs(2))[0].name, "build");
    assert.equal((await adapter.createMergeRequest({ title: "t", description: "d", sourceBranch: "a", targetBranch: "main" })).iid, 7);
    assert.equal((await adapter.createBranch("evopilot/source-closure", "main")).name, "evopilot/source-closure");
    assert.equal((await adapter.commitFiles({ branch: "evopilot/source-closure", message: "m", actions: [{ action: "create", filePath: "CHANGELOG.md", content: "ok" }] })).id, "gitlab-commit-sha");
    assert.equal((await adapter.createTag("v2.0.0", "evopilot/source-closure")).target, "evopilot/source-closure");
    assert.equal(seen.every((item) => item.token === "token"), true);
  } finally {
    await close(server);
  }
});

test("GitHub adapter talks to a real HTTP boundary", async () => {
  const seen = [];
  const server = http.createServer(async (request, response) => {
    seen.push({ method: request.method, url: request.url, auth: request.headers.authorization });
    if (request.url === "/repos/org/repo/git/trees/main?recursive=1") {
      return json(response, { tree: [{ type: "blob", path: "README.md" }, { type: "tree", path: "src" }] });
    }
    if (request.url === "/repos/org/repo/commits/main/check-runs") {
      return json(response, { check_runs: [{ name: "ci", status: "completed", conclusion: "success" }] });
    }
    if (request.url === "/repos/org/repo/actions/workflows/ci.yml/dispatches" && request.method === "POST") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url === "/repos/org/repo/actions/workflows/ci.yml/runs?per_page=20&branch=main" && request.method === "GET") {
      return json(response, { workflow_runs: [{ id: 11, name: "ci", status: "completed", conclusion: "success", head_branch: "main", html_url: "http://github/actions/11" }] });
    }
    if (request.url === "/repos/org/repo/pulls" && request.method === "POST") {
      return json(response, { number: 3, html_url: "http://github/pr/3" });
    }
    if (request.url === "/repos/org/repo/pulls?state=open&head=org%3Afeature&base=main" && request.method === "GET") {
      return json(response, [{ number: 4, html_url: "http://github/pr/4", head: { ref: "feature" }, base: { ref: "main" }, state: "open" }]);
    }
    if (request.url === "/repos/org/repo/git/ref/heads%2Fmain" && request.method === "GET") {
      return json(response, { ref: "refs/heads/main", object: { sha: "base-sha" } });
    }
    if (request.url === "/repos/org/repo/git/refs" && request.method === "POST") {
      return json(response, { ref: "refs/heads/evopilot/source-closure", object: { sha: "base-sha" } });
    }
    if (request.url === "/repos/org/repo/contents/CHANGELOG.md" && request.method === "PUT") {
      return json(response, { commit: { sha: "github-commit-sha" }, content: { sha: "content-sha", html_url: "http://github/blob/CHANGELOG.md" } });
    }
    response.writeHead(404);
    response.end();
  });
  await listen(server);
  const port = server.address().port;
  try {
    const adapter = new GitHubHttpAdapter({ apiBaseUrl: `http://127.0.0.1:${port}`, owner: "org", repo: "repo", token: "token" });
    assert.deepEqual(await adapter.listFiles("main"), ["README.md"]);
    assert.equal((await adapter.listChecks("main"))[0].conclusion, "success");
    await adapter.triggerWorkflowDispatch("ci.yml", "main", { PLAN_ID: "plan-1" });
    assert.equal((await adapter.listWorkflowRuns("ci.yml", "main"))[0].id, 11);
    assert.equal((await adapter.createPullRequest({ title: "t", body: "b", head: "feature", base: "main" })).number, 3);
    assert.equal((await adapter.listPullRequests({ state: "open", head: "feature", base: "main" }))[0].number, 4);
    assert.equal((await adapter.getRef("heads/main")).sha, "base-sha");
    assert.equal((await adapter.createBranch("evopilot/source-closure", "base-sha")).sha, "base-sha");
    assert.equal((await adapter.upsertFile({ path: "CHANGELOG.md", content: "ok", message: "m", branch: "evopilot/source-closure" })).commitSha, "github-commit-sha");
    assert.equal((await adapter.createTag("v2.0.0", "github-commit-sha")).ref, "refs/heads/evopilot/source-closure");
    assert.equal(seen.every((item) => item.auth === "Bearer token"), true);
  } finally {
    await close(server);
  }
});

test("GitHub adapter can list public repository files without a token", async () => {
  const seen = [];
  const server = http.createServer(async (request, response) => {
    seen.push({ method: request.method, url: request.url, auth: request.headers.authorization });
    if (request.url === "/repos/org/public-repo/git/trees/main?recursive=1") {
      return json(response, { tree: [{ type: "blob", path: "package.json" }, { type: "tree", path: "src" }] });
    }
    response.writeHead(404);
    response.end();
  });
  await listen(server);
  const port = server.address().port;
  try {
    const adapter = new GitHubHttpAdapter({ apiBaseUrl: `http://127.0.0.1:${port}`, owner: "org", repo: "public-repo" });
    assert.deepEqual(await adapter.listFiles("main"), ["package.json"]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].auth, undefined);
  } finally {
    await close(server);
  }
});

function json(response, body) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
