import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "../packages/server/dist/index.js";

loadEnvFile(process.env.EVOPILOT_LLM_ENV_FILE ?? "data/evopilot/llm.env");

const port = Number(process.env.EVOPILOT_REAL_LLM_E2E_PORT ?? 19987);
const baseUrl = `http://127.0.0.1:${port}`;
const dataRoot = process.env.EVOPILOT_REAL_LLM_E2E_DATA_ROOT ?? "data/evopilot-real-llm-e2e";

const server = createServer({
  dataRoot,
  runtimeMode: "debug",
  requireLlm: true,
  tokens: [
    { name: "operator", token: "real-llm-operator-token", role: "operator" },
    { name: "viewer", token: "real-llm-viewer-token", role: "viewer" }
  ]
});

await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

try {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);

  const rule = await post("/api/v1/rules/compile", {
    projectId: "domainforge-fabric",
    prompt: "所有链路调用小于 3 秒"
  });
  assert.equal(rule.llmTrace?.mode, "llm");
  assert.equal(rule.llmTrace?.provider, "zhipu");
  assert.equal(rule.llmTrace?.model, "glm-5.1");

  const draft = await post("/api/v1/opportunity-drafts", {
    projectId: "domainforge-fabric",
    datasetIds: ["eval-latency", "eval-rag-drift", "eval-cost-latency"],
    title: "订单助手端到端响应体验优化",
    target: "端到端 p95 小于 3 秒，响应体验提升 5%，RAG 命中率不下降"
  });
  assert.equal(draft.llmTrace?.mode, "llm");
  assert.equal(draft.llmTrace?.provider, "zhipu");
  assert.equal(draft.llmTrace?.model, "glm-5.1");
  assert.match(draft.proposalMarkdown, /#+\s*(背景|进化目标|架构|验证)/);

  console.log(JSON.stringify({
    status: "PASSED",
    provider: draft.llmTrace.provider,
    model: draft.llmTrace.model,
    ruleTrace: rule.llmTrace,
    draftTrace: draft.llmTrace,
    draftPreview: draft.proposalMarkdown.slice(0, 240)
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}

async function post(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "authorization": "Bearer real-llm-operator-token",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.ok(response.ok, `${pathname} failed: ${response.status} ${text}`);
  return JSON.parse(text).data;
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}
