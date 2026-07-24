import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LlmProxy,
  OpenAiCompatibleProviderAdapter,
  ProfileRouteResolver,
  SecretMasker,
  createLlmConfigFromEnv
} from "../../packages/llm/dist/index.js";

test("LLM gateway resolves profile and calls OpenAI-compatible provider", async () => {
  const calls = [];
  const proxy = new LlmProxy(testConfig("http://llm.local"), new OpenAiCompatibleProviderAdapter(async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)), authorization: init.headers.authorization });
    return jsonResponse({
      choices: [{ finish_reason: "stop", message: { content: "# 进化方案\n\n已生成。" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    });
  }));

  const response = await proxy.generate({
    intent: "plan.generation",
    outputContract: "markdown_document",
    prompt: "生成 EvoPilot 进化方案"
  });

  assert.equal(response.success, true);
  assert.equal(response.text, "# 进化方案\n\n已生成。");
  assert.equal(response.provider, "unit-provider");
  assert.equal(response.model, "unit-model");
  assert.equal(response.resolvedProfile, "markdown-writer");
  assert.equal(response.usage.totalTokens, 15);
  assert.equal(response.usage.creditsConsumed, 15);
  assert.equal(response.usage.creditUnit, "token");
  assert.equal(calls[0].url, "http://llm.local/chat/completions");
  assert.equal(calls[0].authorization, "Bearer unit-key");
  assert.equal(calls[0].body.model, "unit-model");
  assert.equal(calls[0].body.max_tokens, 2048);
});

test("LLM gateway retries truncated output according to output contract", async () => {
  let attempt = 0;
  const proxy = new LlmProxy(testConfig("http://llm.local"), new OpenAiCompatibleProviderAdapter(async () => {
    attempt += 1;
    if (attempt === 1) {
      return jsonResponse({
        choices: [{ finish_reason: "length", message: { content: "partial" } }],
        usage: { prompt_tokens: 20, completion_tokens: 1024, total_tokens: 1044 }
      });
    }
    return jsonResponse({
      choices: [{ finish_reason: "stop", message: { content: "complete" } }],
      usage: { prompt_tokens: 20, completion_tokens: 32, total_tokens: 52 }
    });
  }));

  const response = await proxy.generate({
    intent: "plan.generation",
    outputContract: "markdown_document",
    maxOutputTokens: 1024,
    prompt: "生成长方案"
  });

  assert.equal(response.success, true);
  assert.equal(response.text, "complete");
  assert.equal(response.truncationRetryAttempt, 2);
  assert.equal(response.finalMaxOutputTokens, 4096);
});

test("LLM route resolver maps intent aliases and masker hides secrets", () => {
  const resolver = new ProfileRouteResolver({
    defaultIntent: "auto",
    defaultModel: "general",
    models: { general: { id: "general", baseUrl: "http://llm.local", apiKey: "unit-key", modelName: "unit-model" } },
    profiles: { "json-extractor": { model: "general", maxOutputTokens: 256 } },
    routes: { "structured.extraction": { profile: "json-extractor" } },
    intentAliases: { json_task: "structured.extraction" }
  });

  const resolved = resolver.resolve({ taskType: "json_task", prompt: "{}" });
  assert.equal(resolved.intent, "structured.extraction");
  assert.equal(resolved.profile, "json-extractor");
  assert.equal(resolved.maxOutputTokens, 256);
  assert.equal(SecretMasker.mask("Authorization: Bearer abcdefghijklmnop"), "Authorization: Bearer ***");
  assert.equal(SecretMasker.mask('{"apiKey":"secret-value"}'), '{"apiKey":"***"}');
});

test("LLM env config aligns domainforge generic routes and thinking profiles", () => {
  const config = createLlmConfigFromEnv({
    EVOPILOT_LLM_PROVIDER_NAME: "zhipu",
    EVOPILOT_LLM_BASE_URL: "https://llm.local/v1",
    EVOPILOT_LLM_MODEL_NAME: "glm-5.1",
    EVOPILOT_LLM_API_KEY: "unit-key"
  });
  const resolver = new ProfileRouteResolver(config);

  const plan = resolver.resolve({ intent: "plan.generation", prompt: "生成方案" });
  assert.equal(plan.profile, "deep-reasoning");
  assert.equal(plan.thinkingType, "enabled");
  assert.equal(plan.maxOutputTokens, 8192);

  const extraction = resolver.resolve({ intent: "structured.extraction", prompt: "{}" });
  assert.equal(extraction.profile, "structure-fast");
  assert.equal(extraction.thinkingType, "disabled");
  assert.equal(extraction.maxOutputTokens, 1536);

  const aliased = resolver.resolve({ taskType: "evolution.proposal", prompt: "生成方案" });
  assert.equal(aliased.intent, "plan.generation");
  assert.equal(aliased.profile, "deep-reasoning");
});

test("LLM env config defaults metrics path under data root", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-llm-default-metrics-"));
  const config = createLlmConfigFromEnv({
    EVOPILOT_DATA_ROOT: dataRoot,
    EVOPILOT_LLM_PROVIDER_NAME: "zhipu",
    EVOPILOT_LLM_BASE_URL: "https://llm.local/v1",
    EVOPILOT_LLM_MODEL_NAME: "glm-5.1",
    EVOPILOT_LLM_API_KEY: "unit-key"
  });

  assert.equal(config.metrics.enabled, true);
  assert.equal(config.metrics.path, path.join(dataRoot, "llm-metrics.jsonl"));
});

test("LLM gateway records metrics and compresses long context", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-llm-metrics-"));
  const metricsPath = path.join(dir, "llm.jsonl");
  const calls = [];
  const proxy = new LlmProxy({
    ...testConfig("http://llm.local"),
    metrics: { enabled: true, path: metricsPath },
    contextCompression: { enabled: true, maxPromptChars: 80, headChars: 30, tailChars: 30 }
  }, new OpenAiCompatibleProviderAdapter(async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return jsonResponse({
      choices: [{ finish_reason: "stop", message: { content: "ok" } }],
      usage: { prompt_tokens: 80, completion_tokens: 2, total_tokens: 82 }
    });
  }));

  const response = await proxy.generate({
    intent: "plan.generation",
    outputContract: "engine_package",
    prompt: `HEAD-${"a".repeat(120)}-TAIL`
  });

  assert.equal(response.success, true);
  assert.equal(response.promptCompressed, true);
  assert.equal(response.compression.strategy, "head-tail");
  assert.match(calls[0].body.messages[0].content, /上下文压缩/);
  const metric = JSON.parse(fs.readFileSync(metricsPath, "utf8").trim());
  assert.equal(metric.promptCompressed, true);
  assert.equal(metric.totalTokens, 82);
  assert.equal(metric.creditsConsumed, 82);
  assert.equal(metric.creditUnit, "token");
  assert.equal(metric.outputContract, "engine_package");
  assert.equal(metric.finalMaxOutputTokens, 2048);
});

function testConfig(baseUrl) {
  return {
    defaultIntent: "auto",
    defaultModel: "general",
    models: {
      general: {
        id: "general",
        provider: "openai-compatible",
        providerName: "unit-provider",
        baseUrl,
        apiKey: "unit-key",
        modelName: "unit-model",
        defaultMaxOutputTokens: 1024,
        maxOutputTokens: 8192,
        temperature: 0.2,
        thinking: { type: "disabled" }
      }
    },
    profiles: {
      "markdown-writer": { model: "general", maxOutputTokens: 2048, temperature: 0.1 }
    },
    routes: {
      "plan.generation": { profile: "markdown-writer" }
    }
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
