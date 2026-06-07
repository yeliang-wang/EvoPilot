import assert from "node:assert/strict";
import fs from "node:fs";

const lockPath = "runtimes/runtime-lock.json";
assert.ok(fs.existsSync(lockPath), "runtimes/runtime-lock.json is required");

const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
assert.equal(lock.schemaVersion, 1, "runtime lock schemaVersion must be 1");
assert.ok(Array.isArray(lock.runtimes), "runtime lock must define runtimes");

const strict = process.env.EVOPILOT_REQUIRE_RUNTIME_LOCK === "1";
const results = lock.runtimes.map((runtime) => {
  const digestLocked = /^sha256:[a-f0-9]{64}$/i.test(String(runtime.digest ?? ""));
  const runtimeDigestLocked = runtime.runtimeImage ? /^sha256:[a-f0-9]{64}$/i.test(String(runtime.runtimeDigest ?? "")) : true;
  const sbomReady = runtime.sbom ? fs.existsSync(String(runtime.sbom)) : false;
  const licenseReady = runtime.licenseReport ? fs.existsSync(String(runtime.licenseReport)) : false;
  const vulnerabilityReady = runtime.vulnerabilityReport ? scanReportPassed(String(runtime.vulnerabilityReport)) : false;
  const healthEndpointReady = /^https?:\/\/.+/i.test(String(runtime.healthEndpoint ?? ""));
  const passed = Boolean(digestLocked && runtimeDigestLocked && sbomReady && licenseReady && vulnerabilityReady && healthEndpointReady);
  return {
    id: runtime.id,
    name: runtime.name,
    implementation: runtime.implementation,
    role: runtime.role,
    version: runtime.version,
    image: runtime.image,
    digestLocked,
    runtimeImage: runtime.runtimeImage,
    runtimeDigestLocked,
    sbomReady,
    licenseReady,
    vulnerabilityReady,
    healthEndpointReady,
    required: Boolean(runtime.required),
    passed,
    blocker: runtime.blocker
  };
});

const failed = results.filter((runtime) => runtime.required && !runtime.passed);
if (strict && failed.length > 0) {
  for (const runtime of failed) {
    console.error(`${runtime.id}: 运行时锁定未满足生产要求。digest=${runtime.digestLocked}, runtimeDigest=${runtime.runtimeDigestLocked}, sbom=${runtime.sbomReady}, license=${runtime.licenseReady}, vulnerability=${runtime.vulnerabilityReady}, health=${runtime.healthEndpointReady}`);
  }
  process.exit(1);
}

console.log(JSON.stringify({
  policy: lock.policy,
  strict,
  passed: failed.length === 0,
  results
}, null, 2));

function scanReportPassed(file) {
  if (!fs.existsSync(file)) return false;
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  return report.status === "PASSED";
}
