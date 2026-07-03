import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("field evidence kit ships a runnable Node API demo project", () => {
  const packageJsonPath = path.join(root, "examples/github-demo-projects/node-api/package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  assert.equal(packageJson.name, "evopilot-demo-node-api");
  assert.equal(packageJson.scripts.test, "node --test tests/*.test.mjs");
  assert.equal(packageJson.scripts.smoke, "node scripts/smoke.mjs");
  assert.equal(packageJson.scripts["test:e2e"], "node scripts/e2e.mjs");

  for (const file of [
    "src/server.mjs",
    "tests/server.test.mjs",
    "scripts/smoke.mjs",
    "scripts/e2e.mjs"
  ]) {
    assert.ok(fs.existsSync(path.join(root, "examples/github-demo-projects/node-api", file)), `${file} should exist`);
  }
});

test("field evidence kit GitHub workflows call the real EvoPilot evidence API", () => {
  const workflowDir = path.join(root, "examples/github-workflows");
  for (const file of [
    "evopilot-target.yml",
    "ci-failure-repair.yml",
    "release-blocker.yml"
  ]) {
    const content = fs.readFileSync(path.join(workflowDir, file), "utf8");
    assert.match(content, /EVOPILOT_URL/);
    assert.match(content, /EVOPILOT_TOKEN/);
    assert.match(content, /\/api\/v1\/evidence\/events/);
  }

  const commands = fs.readFileSync(path.join(workflowDir, "pr-comment-commands.md"), "utf8");
  assert.match(commands, /\/evopilot discover/);
  assert.match(commands, /\/evopilot loop target/);
  assert.match(commands, /\/evopilot release decision/);
});

test("executor adapter examples define credential, schema, failure, and evidence boundaries", () => {
  const adapterDir = path.join(root, "examples/executor-adapters");
  const contract = JSON.parse(fs.readFileSync(path.join(adapterDir, "contract.json"), "utf8"));
  assert.ok(contract.required.includes("credentialBoundary"));
  assert.ok(contract.required.includes("failureSignatureMap"));
  assert.equal(contract.properties.evidence.properties.eventEndpoint.const, "/api/v1/evidence/events");

  for (const file of [
    "github-actions-adapter.example.json",
    "codex-cli-adapter.example.json"
  ]) {
    const adapter = JSON.parse(fs.readFileSync(path.join(adapterDir, file), "utf8"));
    assert.ok(adapter.adapterId);
    assert.ok(adapter.credentialBoundary.tokenRefs.length >= 1);
    assert.ok(adapter.inputSchema.required.length >= 1);
    assert.ok(adapter.outputSchema.required.length >= 1);
    assert.ok(adapter.failureSignatureMap.length >= 1);
    assert.equal(adapter.evidence.eventEndpoint, "/api/v1/evidence/events");
  }
});

test("field evidence docs keep product kit separate from per-run evidence output", () => {
  for (const file of [
    "examples/github-demo-projects/README.md",
    "examples/github-workflows/README.md",
    "examples/executor-adapters/README.md",
    "docs/case-studies/source-to-ga-demo.md",
    "docs/comparisons/mainstream-loop-harness-alignment.md",
    "evidence/production-soak/README.md"
  ]) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(content, /Product Kit/);
    assert.match(content, /Evidence Output/);
  }
});
