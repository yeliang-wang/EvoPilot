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
    const standards = await jsonFetch(`${baseUrl}/api/v1/maturity/standards`, { token: "viewer-token" });
    assert.equal(standards.status, 200);
    assert.equal(standards.body.data.id, "evopilot-default/v1");
    assert.equal(standards.body.data.terminalMaturity, "ga");
    assert.deepEqual(standards.body.data.phases, ["alpha", "beta", "rc", "ga"]);
    assert.deepEqual(standards.body.data.templates.map((template) => template.phase), ["alpha", "beta", "rc", "ga"]);

    const gaStandard = await jsonFetch(`${baseUrl}/api/v1/maturity/standards/ga`, { token: "viewer-token" });
    assert.equal(gaStandard.status, 200);
    assert.equal(gaStandard.body.data.standardSetId, "evopilot-default/v1");
    assert.ok(gaStandard.body.data.requiredEvidence.includes("architecture-signoff"));
    assert.equal(gaStandard.body.data.overridePolicy.canRemoveBaselineCriteria, false);

    const created = await jsonFetch(`${baseUrl}/api/v1/goals`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "workbuddy-global-goal",
        projectId: "workbuddy",
        releaseTargetId: "ga",
        objective: "WorkBuddy supports tenant-level project onboarding, dynamic loop workflow visibility, task state tracking, and failure repair guidance."
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.schema, "evopilot-global-goal/v1");
    assert.equal(created.body.data.id, "workbuddy-global-goal");
    assert.equal(created.body.data.terminalMaturity, "ga");
    assert.equal(created.body.data.status, "DRAFT");
    assert.equal(created.body.data.plan.status, "MISSING");
    assert.equal(created.body.data.plan.targets.length, 0);
    assert.equal(created.body.data.timeline[0].type, "CREATED");

    const listed = await jsonFetch(`${baseUrl}/api/v1/goals`, { token: "viewer-token" });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.data.some((goal) => goal.id === created.body.data.id));

    const detail = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}`, { token: "viewer-token" });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.objective, "WorkBuddy supports tenant-level project onboarding, dynamic loop workflow visibility, task state tracking, and failure repair guidance.");

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
    assert.equal(planned.body.data.plan.decompositionStrategy, "ga-maturity-ladder");
    assert.equal(planned.body.data.plan.terminalMaturity, "ga");
    assert.deepEqual(planned.body.data.plan.phaseTargets.map((phase) => phase.phase), ["alpha", "beta", "rc", "ga"]);
    assert.ok(planned.body.data.plan.targets.length >= 12);
    assert.ok(planned.body.data.plan.targets.every((target) => target.schema === "evopilot-goal-target/v1"));
    assert.ok(planned.body.data.plan.targets.every((target) => ["alpha", "beta", "rc", "ga"].includes(target.phase)));
    assert.ok(planned.body.data.plan.targets.some((target) => target.id.endsWith("rc-scope-source-closure")));
    assert.ok(planned.body.data.plan.targets.some((target) => target.id.endsWith("ga-phase-package-final-decision")));

    const phasePlan = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/phase-plan`, { token: "viewer-token" });
    assert.equal(phasePlan.status, 200);
    assert.equal(phasePlan.body.data.schema, "evopilot-goal-phase-plan/v1");
    assert.deepEqual(phasePlan.body.data.phases.map((phase) => phase.phase), ["alpha", "beta", "rc", "ga"]);
    assert.equal(phasePlan.body.data.nextAction, "approve-plan");
    assert.equal(phasePlan.body.data.editablePlan.status, "PENDING_USER_CONFIRMATION");

    const phasePackages = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/phase-packages`, { token: "viewer-token" });
    assert.equal(phasePackages.status, 200);
    assert.equal(phasePackages.body.data.length, 4);
    assert.deepEqual(phasePackages.body.data.map((item) => item.phase), ["alpha", "beta", "rc", "ga"]);

    const rcPackage = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/phase-packages/rc`, { token: "viewer-token" });
    assert.equal(rcPackage.status, 200);
    assert.equal(rcPackage.body.data.schema, "evopilot-phase-package/v1");
    assert.equal(rcPackage.body.data.phase, "rc");

    const plannedSnapshot = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(created.body.data.id)}/snapshot`, { token: "viewer-token" });
    assert.equal(plannedSnapshot.status, 200);
    assert.equal(plannedSnapshot.body.data.status, "PLANNED");
    assert.equal(plannedSnapshot.body.data.nextAction, "approve-plan");
    assert.deepEqual(plannedSnapshot.body.data.phases.map((phase) => phase.phase), ["alpha", "beta", "rc", "ga"]);

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
    assert.ok(targets.body.data.length >= 12);
    assert.equal(targets.body.data[0].status, "READY");
    assert.equal(targets.body.data[0].nextAction, "start-target");
    assert.equal(targets.body.data[0].phase, "alpha");
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
    assert.equal(bound.body.data.loop.context.maturityPhase, "alpha");

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

test("GlobalGoal planner always expands business objectives through Alpha, Beta, RC, and GA", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-global-goal-template-"));
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
    const betaTarget = await jsonFetch(`${baseUrl}/api/v1/release/targets`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "workbuddy-beta",
        name: "WorkBuddy Beta",
        scope: "project",
        projectId: "workbuddy",
        templateId: "beta",
        minConnectedProjects: 1,
        minSucceededSoakSeconds: 0,
        minSuccessfulRuns: 1,
        minEvaluationDatasets: 1,
        minOpportunities: 0,
        minSuccessfulEvolutionBatches: 0,
        minSuccessfulCodeUpgrades: 1,
        minSuccessfulPipelines: 1,
        requiredScenarioIds: ["beta-core-flow", "ci-cd-pass", "manual-approval"],
        requireNoHighOpenRisks: true
      }
    });
    assert.equal(betaTarget.status, 201);
    assert.equal(betaTarget.body.data.templateId, "beta");

    const gaTarget = await jsonFetch(`${baseUrl}/api/v1/release/targets`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "workbuddy-ga",
        name: "WorkBuddy GA",
        scope: "project",
        projectId: "workbuddy",
        templateId: "ga",
        minConnectedProjects: 1,
        minSucceededSoakSeconds: 5400,
        requireActiveSoak: true,
        minActiveSoakRunDelta: 1,
        minActiveSoakCodeUpgradeDelta: 1,
        minActiveSoakPipelineDelta: 1,
        minSuccessfulRuns: 1,
        minEvaluationDatasets: 1,
        minOpportunities: 1,
        minSuccessfulEvolutionBatches: 1,
        minSuccessfulCodeUpgrades: 1,
        minSuccessfulPipelines: 1,
        requiredScenarioIds: ["normal-evolution-loop", "source-to-production-closure", "manual-approval"],
        requireNoHighOpenRisks: true
      }
    });
    assert.equal(gaTarget.status, 201);
    assert.equal(gaTarget.body.data.templateId, "ga");

    const betaGoal = await jsonFetch(`${baseUrl}/api/v1/goals`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "workbuddy-beta-global-goal",
        projectId: "workbuddy",
        releaseTargetId: "workbuddy-beta",
        objective: "WorkBuddy provides beta-grade tenant workflow observability for project operators."
      }
    });
    assert.equal(betaGoal.status, 201);
    const betaPlanned = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(betaGoal.body.data.id)}/plan`, {
      method: "POST",
      token: "operator-token",
      body: {}
    });
    assert.equal(betaPlanned.status, 201);
    const betaTargets = betaPlanned.body.data.plan.targets;
    assert.equal(betaPlanned.body.data.plan.decompositionStrategy, "ga-maturity-ladder");
    assert.deepEqual(betaPlanned.body.data.plan.phaseTargets.map((phase) => phase.phase), ["alpha", "beta", "rc", "ga"]);
    assert.ok(betaTargets.some((target) => target.phase === "alpha"));
    assert.ok(betaTargets.some((target) => target.phase === "beta"));
    assert.ok(betaTargets.some((target) => target.phase === "rc"));
    assert.ok(betaTargets.some((target) => target.phase === "ga"));
    assert.ok(targetBySuffix(betaTargets, "rc-scope-source-closure"));
    assert.ok(targetBySuffix(betaTargets, "ga-phase-package-final-decision"));

    const gaGoal = await jsonFetch(`${baseUrl}/api/v1/goals`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "workbuddy-ga-global-goal",
        projectId: "workbuddy",
        releaseTargetId: "workbuddy-ga",
        objective: "WorkBuddy provides GA-grade tenant workflow observability for project operators."
      }
    });
    assert.equal(gaGoal.status, 201);
    const gaPlanned = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(gaGoal.body.data.id)}/plan`, {
      method: "POST",
      token: "operator-token",
      body: {}
    });
    assert.equal(gaPlanned.status, 201);
    const gaTargets = gaPlanned.body.data.plan.targets;
    assert.deepEqual(gaPlanned.body.data.plan.phaseTargets.map((phase) => phase.phase), ["alpha", "beta", "rc", "ga"]);
    assert.ok(targetBySuffix(gaTargets, "alpha-phase-package"));
    assert.ok(targetBySuffix(gaTargets, "beta-phase-package"));
    assert.ok(targetBySuffix(gaTargets, "rc-phase-package"));
    const gaFinalDecision = targetBySuffix(gaTargets, "ga-phase-package-final-decision");
    assert.ok(gaFinalDecision);
    assert.equal(gaFinalDecision.required, true);
    assert.ok(gaFinalDecision.evidence.includes("terminalMaturity=ga"));
    assert.equal(gaPlanned.body.data.plan.requiredTargetCount, gaTargets.length);

    const invalidApply = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(gaGoal.body.data.id)}/plan/apply`, {
      method: "POST",
      token: "operator-token",
      body: {
        plan: {
          targets: gaTargets.filter((target) => target.phase !== "rc")
        }
      }
    });
    assert.equal(invalidApply.status, 400);
    assert.equal(invalidApply.body.error, "GOAL_PLAN_PHASE_TARGETS_REQUIRED");

    const adjustedTarget = {
      ...gaTargets[0],
      acceptanceCriteria: [...gaTargets[0].acceptanceCriteria, "Project-specific onboarding SLO is documented."]
    };
    const exportedShape = {
      ...gaPlanned.body.data.plan,
      phases: gaPlanned.body.data.plan.phaseTargets,
      phaseTargets: undefined,
      targets: [adjustedTarget, ...gaTargets.slice(1)]
    };
    const applied = await jsonFetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(gaGoal.body.data.id)}/plan/apply`, {
      method: "POST",
      token: "operator-token",
      body: {
        plan: exportedShape
      }
    });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.data.plan.status, "PENDING_APPROVAL");
    assert.equal(applied.body.data.plan.editablePlan.status, "PENDING_USER_CONFIRMATION");
    assert.ok(applied.body.data.plan.targets[0].acceptanceCriteria.includes("Project-specific onboarding SLO is documented."));
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

function targetBySuffix(targets, suffix) {
  return targets.find((target) => target.id.endsWith(suffix));
}
