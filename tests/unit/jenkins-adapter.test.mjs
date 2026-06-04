import assert from "node:assert/strict";
import test from "node:test";
import { createPipelineRun, pipelineStatusToReleaseStatus } from "../../packages/core/dist/index.js";
import { JenkinsClient, normalizeJenkinsBuildStatus, normalizeJenkinsStageStatus } from "../../packages/adapter-jenkins/dist/index.js";

test("pipeline model maps Jenkins terminal status to release status", () => {
  const run = createPipelineRun({
    id: "pipeline-1",
    projectId: "p1",
    deliveryPlanId: "delivery-1",
    provider: "jenkins",
    connectorId: "default",
    jobName: "agent-evolution",
    now: "2026-06-03T00:00:00.000Z"
  });
  assert.equal(run.status, "QUEUED");
  assert.equal(pipelineStatusToReleaseStatus("SUCCEEDED"), "SUCCEEDED");
  assert.equal(pipelineStatusToReleaseStatus("FAILED"), "FAILED");
  assert.equal(pipelineStatusToReleaseStatus("RUNNING"), "RUNNING");
});

test("Jenkins adapter normalizes build and stage statuses", () => {
  assert.equal(normalizeJenkinsBuildStatus({ building: true, result: null }), "RUNNING");
  assert.equal(normalizeJenkinsBuildStatus({ building: false, result: "SUCCESS" }), "SUCCEEDED");
  assert.equal(normalizeJenkinsBuildStatus({ building: false, result: "FAILURE" }), "FAILED");
  assert.equal(normalizeJenkinsBuildStatus({ building: false, result: "ABORTED" }), "CANCELED");
  assert.equal(normalizeJenkinsStageStatus("SUCCESS"), "SUCCEEDED");
  assert.equal(normalizeJenkinsStageStatus("IN_PROGRESS"), "RUNNING");
});

test("Jenkins adapter triggers parameterized job and reads build snapshot", async () => {
  const requests = [];
  const client = new JenkinsClient({
    id: "default",
    name: "测试 Jenkins",
    baseUrl: "http://jenkins.local/",
    username: "u",
    apiToken: "t"
  }, async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/job/folder/job/agent-evolution/buildWithParameters") {
      return new Response("", { status: 201, headers: { location: "http://jenkins.local/queue/item/7/" } });
    }
    if (pathname === "/queue/item/7/api/json") {
      return json({ executable: { number: 42, url: "http://jenkins.local/job/folder/job/agent-evolution/42/" } });
    }
    if (pathname === "/job/folder/job/agent-evolution/42/api/json") {
      return json({
        building: false,
        result: "SUCCESS",
        url: "http://jenkins.local/job/folder/job/agent-evolution/42/",
        artifacts: [{ displayPath: "release.zip", relativePath: "release.zip" }]
      });
    }
    if (pathname === "/job/folder/job/agent-evolution/42/wfapi/describe") {
      return json({ stages: [{ id: "1", name: "Build", status: "SUCCESS", durationMillis: 1200 }] });
    }
    if (pathname === "/job/folder/job/agent-evolution/42/consoleText") {
      return new Response("build ok", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });

  const queued = await client.triggerBuild({ jobName: "folder/agent-evolution", parameters: { PLAN_ID: "plan-1" } });
  assert.equal(queued.queueId, "7");
  const snapshot = await client.readBuildSnapshot("folder/agent-evolution", queued.queueId);
  assert.equal(snapshot.status, "SUCCEEDED");
  assert.equal(snapshot.buildNumber, 42);
  assert.equal(snapshot.stages[0].name, "Build");
  assert.equal(snapshot.artifacts[0].name, "release.zip");
  assert.match(snapshot.logPreview, /build ok/);
  assert.equal(requests[0].init.headers.authorization, "Basic dTp0");
});

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
