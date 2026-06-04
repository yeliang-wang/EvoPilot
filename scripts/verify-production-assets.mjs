import assert from "node:assert/strict";
import fs from "node:fs";

const requiredFiles = [
  "Dockerfile",
  "docker-compose.yml",
  ".env.example",
  ".github/workflows/ci.yml",
  "deploy/k8s/deployment.yaml",
  "deploy/k8s/service.yaml",
  "deploy/k8s/pvc.yaml",
  "deploy/k8s/secret.example.yaml",
  "docs/openapi.json",
  "docs/evidence-ingestion.md",
  "docs/user-guide.md",
  "docs/production-user-e2e.md",
  "scripts/internal-code-upgrader.mjs",
  "scripts/internal-product-cicd.mjs"
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(file), `${file} is required`);
}

const openapi = JSON.parse(fs.readFileSync("docs/openapi.json", "utf8"));
assert.equal(openapi.openapi, "3.1.0");
assert.ok(openapi.paths["/api/v1/runs"]);
assert.ok(openapi.paths["/api/v1/evidence/events"]);
assert.ok(openapi.paths["/api/v1/evidence/otlp/v1/traces"]);
assert.ok(openapi.paths["/api/v1/evidence/skywalking"]);
assert.ok(openapi.components.securitySchemes.bearerAuth);

const deployment = fs.readFileSync("deploy/k8s/deployment.yaml", "utf8");
assert.match(deployment, /readinessProbe/);
assert.match(deployment, /livenessProbe/);
assert.match(deployment, /persistentVolumeClaim/);

const productionE2e = fs.readFileSync("docs/production-user-e2e.md", "utf8");
assert.match(productionE2e, /代码升级执行器必须调用真实 LLM/);
assert.match(productionE2e, /只有代码升级成功后才能触发 CI\/CD/);

console.log("production assets verified");
