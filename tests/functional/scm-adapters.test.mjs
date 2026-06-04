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
    if (request.url?.startsWith("/api/v4/projects/group%2Fproject/pipelines")) {
      return json(response, [{ id: 1, status: "success", ref: "main", web_url: "http://gitlab/p/1" }]);
    }
    if (request.url === "/api/v4/projects/group%2Fproject/merge_requests" && request.method === "POST") {
      return json(response, { iid: 7, web_url: "http://gitlab/mr/7" });
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
    assert.equal((await adapter.createMergeRequest({ title: "t", description: "d", sourceBranch: "a", targetBranch: "main" })).iid, 7);
    assert.equal(seen.every((item) => item.token === "token"), true);
  } finally {
    await close(server);
  }
});

test("GitHub adapter talks to a real HTTP boundary", async () => {
  const seen = [];
  const server = http.createServer(async (request, response) => {
    seen.push({ method: request.method, url: request.url, auth: request.headers.authorization });
    if (request.url === "/repos/org/repo/commits/main/check-runs") {
      return json(response, { check_runs: [{ name: "ci", status: "completed", conclusion: "success" }] });
    }
    if (request.url === "/repos/org/repo/pulls" && request.method === "POST") {
      return json(response, { number: 3, html_url: "http://github/pr/3" });
    }
    response.writeHead(404);
    response.end();
  });
  await listen(server);
  const port = server.address().port;
  try {
    const adapter = new GitHubHttpAdapter({ apiBaseUrl: `http://127.0.0.1:${port}`, owner: "org", repo: "repo", token: "token" });
    assert.equal((await adapter.listChecks("main"))[0].conclusion, "success");
    assert.equal((await adapter.createPullRequest({ title: "t", body: "b", head: "feature", base: "main" })).number, 3);
    assert.equal(seen.every((item) => item.auth === "Bearer token"), true);
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
