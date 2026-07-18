import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../../packages/server/dist/index.js";

test("GlobalGoal API creates a white-box goal shell with dashboard projections", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-global-goal-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "viewer", token: "viewer-token", role: "viewer" },
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "admin", token: "admin-token", role: "admin" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const created = await jsonFetch(`${baseUrl}/api/v1/goals`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "workbuddy-rc-global-goal",
        projectId: "workbuddy",
        releaseTargetId: "rc",
        objective: "WorkBuddy reaches RC through white-box GoalTargets."
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.schema, "evopilot-global-goal/v1");
    assert.equal(created.body.data.id, "workbuddy-rc-global-goal");
    assert.equal(created.body.data.status, "DRAFT");
    assert.equal(created.body.data.plan.status, "MISSING");
    assert.equal(created.body.data.plan.targets.length, 0);
    assert.equal(created.body.data.timeline[0].type, "CREATED");

    const listed = await jsonFetch(`${baseUrl}/api/v1/goals`, { token: "viewer-token" });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.data.some((goal) => goal.id === created.body.data.id));

    const detail = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}`, { token: "viewer-token" });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.objective, "WorkBuddy reaches RC through white-box GoalTargets.");

    const snapshot = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/snapshot`, { token: "viewer-token" });
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.data.schema, "evopilot-goal-snapshot/v1");
    assert.equal(snapshot.body.data.status, "DRAFT");
    assert.equal(snapshot.body.data.nextAction, "plan-goal");
    assert.equal(snapshot.body.data.progress.totalTargets, 0);
    assert.ok(snapshot.body.data.evidence.includes("plan=MISSING"));

    const graph = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/graph`, { token: "viewer-token" });
    assert.equal(graph.status, 200);
    assert.equal(graph.body.data.schema, "evopilot-goal-graph/v1");
    assert.equal(graph.body.data.nodes.length, 0);
    assert.equal(graph.body.data.edges.length, 0);
    assert.equal(graph.body.data.nextAction, "plan-goal");

    const timeline = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/timeline`, { token: "viewer-token" });
    assert.equal(timeline.status, 200);
    assert.equal(timeline.body.data.length, 1);
    assert.equal(timeline.body.data[0].type, "CREATED");

    const matrix = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/evidence-matrix`, { token: "viewer-token" });
    assert.equal(matrix.status, 200);
    assert.deepEqual(matrix.body.data, []);

    const pendingReport = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/final-report`, { token: "viewer-token" });
    assert.equal(pendingReport.status, 409);
    assert.equal(pendingReport.body.error, "GOAL_FINAL_REPORT_PENDING");

    const blockedAdvance = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/advance`, {
      method: "POST",
      token: "operator-token",
      body: {}
    });
    assert.equal(blockedAdvance.status, 409);
    assert.equal(blockedAdvance.body.data.schema, "evopilot-goal-advance/v1");
    assert.equal(blockedAdvance.body.data.nextAction, "plan-goal");
    assert.equal(blockedAdvance.body.data.stages[0].id, "plan-check");
    assert.equal(blockedAdvance.body.data.stages[0].status, "BLOCKED");

    const planned = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/plan`, {
      method: "POST",
      token: "operator-token",
      body: {}
    });
    assert.equal(planned.status, 201);
    assert.equal(planned.body.data.status, "PLANNED");
    assert.equal(planned.body.data.plan.status, "PENDING_APPROVAL");
    assert.ok(planned.body.data.plan.targets.length >= 5);
    assert.ok(planned.body.data.plan.targets.every((target) => target.schema === "evopilot-goal-target/v1"));
    assert.ok(planned.body.data.plan.targets.some((target) => target.id.endsWith("source-closure-deploy")));

    const plannedSnapshot = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/snapshot`, { token: "viewer-token" });
    assert.equal(plannedSnapshot.status, 200);
    assert.equal(plannedSnapshot.body.data.status, "PLANNED");
    assert.equal(plannedSnapshot.body.data.nextAction, "approve-plan");

    const approved = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/approve-plan`, {
      method: "POST",
      token: "operator-token",
      body: {}
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.status, "APPROVED");
    assert.equal(approved.body.data.plan.status, "APPROVED");
    assert.ok(approved.body.data.plan.approvedAt);

    const targets = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/targets`, { token: "viewer-token" });
    assert.equal(targets.status, 200);
    assert.ok(targets.body.data.length >= 5);
    assert.equal(targets.body.data[0].status, "READY");
    assert.equal(targets.body.data[0].nextAction, "start-target");
    assert.equal(targets.body.data[0].evidence.filter((item) => item.startsWith("goal=")).length, 1);
    assert.equal(targets.body.data[0].evidence.filter((item) => item.startsWith("target=")).length, 1);

    const repeatedTargets = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/targets`, { token: "viewer-token" });
    assert.equal(repeatedTargets.status, 200);
    assert.equal(repeatedTargets.body.data[0].evidence.filter((item) => item.startsWith("goal=")).length, 1);
    assert.equal(repeatedTargets.body.data[0].evidence.filter((item) => item.startsWith("target=")).length, 1);

    const bound = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/advance`, {
      method: "POST",
      token: "operator-token",
      body: { autoStart: false }
    });
    assert.equal(bound.status, 200);
    assert.equal(bound.body.data.schema, "evopilot-goal-advance/v1");
    assert.equal(bound.body.data.stages.some((stage) => stage.id === "loop-bind" && stage.status === "SUCCEEDED"), true);
    assert.ok(bound.body.data.loop.id);
    assert.equal(bound.body.data.loop.status, "PENDING");
    assert.equal(bound.body.data.loop.context.globalGoalId, created.body.data.id);
    assert.equal(bound.body.data.loop.context.goalTargetId, bound.body.data.target.id);

    const advanced = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/advance`, {
      method: "POST",
      token: "operator-token",
      body: {}
    });
    assert.equal(advanced.status, 200);
    assert.equal(advanced.body.data.schema, "evopilot-goal-advance/v1");
    assert.equal(advanced.body.data.loop.id, bound.body.data.loop.id);
    assert.equal(advanced.body.data.loop.currentIteration, 1);
    assert.ok(["RUNNING", "WAITING_APPROVAL", "SUCCEEDED", "FAILED", "BLOCKED"].includes(advanced.body.data.loop.status));
    assert.ok(advanced.body.data.snapshot.progress.totalTargets >= 5);
    assert.ok(advanced.body.data.snapshot.activeTarget);

    const graphAfterAdvance = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/graph`, { token: "viewer-token" });
    assert.equal(graphAfterAdvance.status, 200);
    assert.ok(graphAfterAdvance.body.data.nodes.some((node) => node.loopId === bound.body.data.loop.id));
    assert.ok(graphAfterAdvance.body.data.edges.some((edge) => edge.type === "depends-on"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function jsonFetch(url, { method = "GET", token = "viewer-token", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined
  };
}
