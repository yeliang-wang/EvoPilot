import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import test from "node:test";
import { createServer } from "../../packages/server/dist/index.js";

const cliPath = path.resolve("packages/cli/dist/index.js");

test("EvoPilot CLI exposes distribution metadata without a server", async () => {
  assert.ok(fs.existsSync(cliPath), "CLI must be built before functional tests run");

  const help = await runCliText(["--help"]);
  assert.match(help, /evopilot --version/);
  assert.match(help, /evopilot config show/);
  assert.match(help, /evopilot auth token/);
  assert.match(help, /evopilot project list/);
  assert.match(help, /evopilot project devops set/);
  assert.match(help, /evopilot project devops preflight/);
  assert.match(help, /evopilot target list/);
  assert.match(help, /evopilot target decision/);
  assert.match(help, /evopilot goal create/);
  assert.match(help, /evopilot target run/);
  assert.match(help, /evopilot goal run/);
  assert.match(help, /evopilot loop list/);
  assert.match(help, /evopilot loop run/);
  assert.match(help, /evopilot release decisions/);

  const version = await runCliText(["--version"]);
  assert.equal(version.trim(), "0.1.0");

  const versionJson = await runCli(["--version", "--json"]);
  assert.equal(versionJson.name, "@evopilot/cli");
  assert.equal(versionJson.version, "0.1.0");
});

test("EvoPilot CLI configures project DevOps for GitHub Actions", async () => {
  assert.ok(fs.existsSync(cliPath), "CLI must be built before functional tests run");

  const github = await startFakeGitHubForCli();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-cli-devops-"));
  const configPath = path.join(dataRoot, "cli-config.json");
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    users: [
      {
        username: "tenant-admin",
        password: "tenant-password",
        role: "admin",
        tenantId: "tenant-production",
        workspaceId: "workspace-agent-products",
        displayName: "Tenant Admin"
      }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await runCli([
      "auth", "login",
      "--server", baseUrl,
      "--username", "tenant-admin",
      "--password", "tenant-password",
      "--config", configPath,
      "--json"
    ]);
    const project = await runCli([
      "project", "register",
      "--id", "github-cli-agent",
      "--provider", "github",
      "--base-url", github.baseUrl,
      "--owner", "org",
      "--repo-name", "repo",
      "--branch", "main",
      "--source-token", "github-token",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(project.id, "github-cli-agent");
    assert.equal(project.repository.provider, "github");

    const configured = await runCli([
      "project", "devops", "set", "github-cli-agent",
      "--provider", "github-actions",
      "--ci-workflow", "ci.yml",
      "--ci-required-check", "build",
      "--ci-required-check", "test",
      "--cd-workflow", "deploy-prod.yml",
      "--deploy-environment", "production",
      "--health-url", `${github.baseUrl}/health`,
      "--config", configPath,
      "--json"
    ]);
    assert.equal(configured.devops.provider, "github-actions");
    assert.equal(configured.readiness.status, "READY");

    const preflightText = await runCliText([
      "project", "devops", "preflight", "github-cli-agent",
      "--config", configPath
    ]);
    assert.match(preflightText, /EvoPilot Project DevOps/);
    assert.match(preflightText, /Provider   github-actions/);
    assert.match(preflightText, /\[PASS\] ci-state/);

    const inspected = await runCli(["project", "devops", "inspect", "github-cli-agent", "--config", configPath, "--json"]);
    assert.equal(inspected.provider, "github-actions");

    const cleared = await runCli(["project", "devops", "clear", "github-cli-agent", "--config", configPath, "--json"]);
    assert.equal(cleared.cleared, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await github.close();
  }
});

test("EvoPilot CLI drives the atomic Source-to-GA control-plane path", async () => {
  assert.ok(fs.existsSync(cliPath), "CLI must be built before functional tests run");

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-cli-data-"));
  const configPath = path.join(dataRoot, "cli-config.json");
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-cli-repo-"));
  createGitRepository(repoRoot);

  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    users: [
      {
        username: "tenant-admin",
        password: "tenant-password",
        role: "admin",
        tenantId: "tenant-production",
        workspaceId: "workspace-agent-products",
        displayName: "Tenant Admin"
      }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const login = await runCli([
      "auth", "login",
      "--server", baseUrl,
      "--username", "tenant-admin",
      "--password", "tenant-password",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(login.user.username, "tenant-admin");
    assert.ok(login.token);

    const savedToken = await runCli(["auth", "token", "--config", configPath, "--json"]);
    assert.equal(savedToken.token, login.token);

    const savedConfigPath = await runCli(["config", "path", "--config", configPath, "--json"]);
    assert.equal(savedConfigPath.path, configPath);

    const savedConfig = await runCli(["config", "show", "--config", configPath, "--json"]);
    assert.equal(savedConfig.path, configPath);
    assert.equal(savedConfig.server, baseUrl);
    assert.equal(savedConfig.tenantId, "tenant-production");
    assert.equal(savedConfig.workspaceId, "workspace-agent-products");
    assert.equal(savedConfig.tokenConfigured, true);
    assert.equal(Object.hasOwn(savedConfig, "token"), false);

    const status = await runCli(["status", "--config", configPath, "--json"]);
    assert.equal(status.health.status, "UP");
    assert.equal(status.ready.status, "READY");
    assert.ok(status.summary);

    const project = await runCli([
      "project", "register",
      "--id", "cli-agent",
      "--name", "CLI Agent",
      "--provider", "local-git",
      "--root", repoRoot,
      "--branch", "main",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(project.id, "cli-agent");
    assert.equal(project.validation.status, "VERIFIED");

    const sourceCredentials = await runCli(["project", "preflight", "cli-agent", "--config", configPath, "--json"]);
    assert.equal(sourceCredentials.status, "READY");
    assert.equal(sourceCredentials.provider, "local-git");

    const devopsMismatch = await runCli([
      "project", "devops", "set", "cli-agent",
      "--provider", "github-actions",
      "--ci-workflow", "ci.yml",
      "--config", configPath,
      "--json"
    ], { status: 2 });
    assert.equal(devopsMismatch.error, "DEVOPS_PROVIDER_PROJECT_MISMATCH");

    const evidenceFile = path.join(dataRoot, "events.json");
    fs.writeFileSync(evidenceFile, JSON.stringify([
      {
        type: "agent.step",
        source: "agent",
        message: "CLI evidence path exceeded latency target",
        attributes: { durationMs: 3500 }
      }
    ]));
    const evidence = await runCli(["evidence", "push", "--project", "cli-agent", "--file", evidenceFile, "--config", configPath, "--json"]);
    assert.equal(evidence.ingestedEvents, 1);
    assert.equal(evidence.ingestSource, "agent-sdk");

    const target = await runCli(["target", "create", "--project", "cli-agent", "--template", "beta", "--config", configPath, "--json"]);
    assert.equal(target.id, "cli-agent-beta");
    assert.equal(target.scope, "project");
    assert.equal(target.projectId, "cli-agent");
    assert.equal(target.templateId, "beta");

    const goal = await runCli([
      "goal", "create",
      "--id", "cli-agent-beta-global-goal",
      "--project", "cli-agent",
      "--target", "cli-agent-beta",
      "--objective", "CLI Agent reaches beta through visible GoalTargets",
      "--idempotency-key", "goal-cli-agent-beta",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(goal.schema, "evopilot-global-goal/v1");
    assert.equal(goal.id, "cli-agent-beta-global-goal");
    assert.equal(goal.status, "DRAFT");
    assert.equal(goal.plan.status, "MISSING");

    const goals = await runCli(["goal", "list", "--project", "cli-agent", "--target", "cli-agent-beta", "--config", configPath, "--json"]);
    assert.ok(goals.some((item) => item.id === goal.id));

    const inspectedGoal = await runCli(["goal", "inspect", goal.id, "--config", configPath, "--json"]);
    assert.equal(inspectedGoal.id, goal.id);
    assert.equal(inspectedGoal.objective, "CLI Agent reaches beta through visible GoalTargets");

    const goalSnapshotBeforePlan = await runCli(["goal", "snapshot", goal.id, "--config", configPath, "--json"]);
    assert.equal(goalSnapshotBeforePlan.status, "DRAFT");
    assert.equal(goalSnapshotBeforePlan.nextAction, "plan-goal");

    const goalPlan = await runCli(["goal", "plan", goal.id, "--config", configPath, "--json"]);
    assert.equal(goalPlan.id, goal.id);
    assert.equal(goalPlan.status, "PLANNED");
    assert.equal(goalPlan.plan.status, "PENDING_APPROVAL");
    assert.ok(goalPlan.plan.targets.length >= 4);

    const approvedGoal = await runCli(["goal", "approve-plan", goal.id, "--config", configPath, "--json"]);
    assert.equal(approvedGoal.status, "APPROVED");
    assert.equal(approvedGoal.plan.status, "APPROVED");

    const goalTargets = await runCli(["goal", "targets", goal.id, "--config", configPath, "--json"]);
    assert.ok(goalTargets.some((item) => item.id.endsWith("source-readiness")));
    assert.equal(goalTargets[0].status, "READY");

    const goalGraph = await runCli(["goal", "graph", goal.id, "--config", configPath, "--json"]);
    assert.equal(goalGraph.schema, "evopilot-goal-graph/v1");
    assert.equal(goalGraph.goalId, goal.id);
    assert.ok(goalGraph.nodes.length >= 4);
    assert.ok(goalGraph.edges.length >= 1);

    const goalTimeline = await runCli(["goal", "timeline", goal.id, "--config", configPath, "--json"]);
    assert.ok(goalTimeline.some((item) => item.type === "CREATED"));
    assert.ok(goalTimeline.some((item) => item.type === "PLAN_APPROVED"));

    const goalMatrix = await runCli(["goal", "evidence-matrix", goal.id, "--config", configPath, "--json"]);
    assert.equal(goalMatrix.length, goalTargets.length);
    assert.ok(goalMatrix.every((row) => Array.isArray(row.acceptanceCriteria)));

    const goalAdvance = await runCli(["goal", "advance", goal.id, "--no-auto-start", "--config", configPath, "--json"]);
    assert.equal(goalAdvance.schema, "evopilot-goal-advance/v1");
    assert.equal(goalAdvance.goal.id, goal.id);
    assert.equal(goalAdvance.loop.status, "PENDING");
    assert.equal(goalAdvance.loop.context.globalGoalId, goal.id);

    const goalRunStatusResponse = await fetch(`${baseUrl}/api/v1/goals/${encodeURIComponent(goal.id)}/run-status`, {
      headers: { authorization: `Bearer ${login.token}` }
    });
    assert.equal(goalRunStatusResponse.status, 200);
    const goalRunStatus = await goalRunStatusResponse.json();
    assert.equal(goalRunStatus.data.schema, "evopilot-goal-run-status/v1");
    assert.equal(goalRunStatus.data.goal.id, goal.id);
    assert.ok(goalRunStatus.data.chain.some((node) => node.id === "loop-run"));

    const goalRunJson = await runCli(["goal", "run", goal.id, "--max-steps", "0", "--config", configPath, "--json"], { status: 2 });
    assert.equal(goalRunJson.schema, "evopilot-cli-goal-run/v1");
    assert.equal(goalRunJson.until, "terminal");
    assert.equal(goalRunJson.status.schema, "evopilot-goal-run-status/v1");
    assert.equal(goalRunJson.status.goal.id, goal.id);
    assert.ok(goalRunJson.status.chain.some((node) => node.id === "goal-target"));

    const goalTimeoutJson = await runCli(["goal", "run", goal.id, "--timeout", "0s", "--config", configPath, "--json"], { status: 2 });
    assert.equal(goalTimeoutJson.schema, "evopilot-cli-goal-run/v1");
    assert.ok(goalTimeoutJson.steps.some((step) => step.type === "goal.timeout-reached"));

    const goalRunText = await runCliText(["goal", "run", goal.id, "--max-steps", "0", "--config", configPath], { status: 2 });
    assert.match(goalRunText, /EvoPilot Goal Run/);
    assert.match(goalRunText, /Workflow/);
    assert.match(goalRunText, /Next Action/);
    assert.match(goalRunText, /Evidence/);

    const targetRunJson = await runCli([
      "target", "run",
      "--project", "cli-agent",
      "--template", "alpha",
      "--objective", "CLI wrapper target run reaches alpha visibility",
      "--until", "terminal",
      "--max-steps", "0",
      "--config", configPath,
      "--json"
    ], { status: 2 });
    assert.equal(targetRunJson.schema, "evopilot-cli-goal-run/v1");
    assert.equal(targetRunJson.command, "target run");
    assert.equal(targetRunJson.until, "terminal");
    assert.equal(targetRunJson.status.goal.projectId, "cli-agent");
    assert.equal(targetRunJson.status.goal.releaseTargetId, "cli-agent-alpha");

    const loopTimeoutJson = await runCli([
      "loop", "run",
      "--project", "cli-agent",
      "--target", "cli-agent-beta",
      "--objective", "CLI wrapper loop run exposes timeout stop boundary",
      "--timeout", "0s",
      "--config", configPath,
      "--json"
    ], { status: 2 });
    assert.equal(loopTimeoutJson.schema, "evopilot-cli-loop-run/v1");
    assert.ok(loopTimeoutJson.steps.some((step) => step.type === "loop.timeout-reached"));

    const loopRunJson = await runCli([
      "loop", "run",
      "--project", "cli-agent",
      "--target", "cli-agent-beta",
      "--objective", "CLI wrapper loop run succeeds visibly",
      "--force-decision", "SUCCEED",
      "--max-iterations", "1",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(loopRunJson.schema, "evopilot-cli-loop-run/v1");
    assert.equal(loopRunJson.command, "loop run");
    assert.equal(loopRunJson.until, "terminal");
    assert.equal(loopRunJson.loop.projectId, "cli-agent");
    assert.equal(loopRunJson.loop.status, "SUCCEEDED");

    const blockedLoopRunJson = await runCli([
      "loop", "run",
      "--project", "cli-agent",
      "--target", "cli-agent-beta",
      "--objective", "CLI wrapper loop run stops when blocked-or-complete is requested",
      "--force-decision", "BLOCK",
      "--until", "blocked-or-complete",
      "--max-iterations", "5",
      "--config", configPath,
      "--json"
    ], { status: 2 });
    assert.equal(blockedLoopRunJson.schema, "evopilot-cli-loop-run/v1");
    assert.equal(blockedLoopRunJson.until, "blocked-or-complete");
    assert.equal(blockedLoopRunJson.loop.status, "BLOCKED");
    assert.equal(blockedLoopRunJson.steps.filter((step) => step.type === "loop.start" || step.type === "loop.resume").length, 1);

    const sourceClosureFile = path.join(dataRoot, "source-closure.json");
    fs.writeFileSync(sourceClosureFile, JSON.stringify({
      sourceProjectId: "cli-agent",
      repositoryProvider: "local-git",
      sourceUrl: repoRoot,
      sourceBranch: "main",
      targetVersion: "cli-beta",
      releaseStrategy: "local-git-commit",
      requiredGates: ["code-change", "push"],
      deploymentEnvironment: "test"
    }));

    const loop = await runCli([
      "loop", "create",
      "--project", "cli-agent",
      "--target", "cli-agent-beta",
      "--objective", "Drive CLI beta source closure",
      "--source-closure", sourceClosureFile,
      "--idempotency-key", "cli-beta-loop",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(loop.projectId, "cli-agent");
    assert.equal(loop.context.releaseTargetId, "cli-agent-beta");
    assert.equal(loop.sourceClosure.sourceProjectId, "cli-agent");

    const started = await runCli(["loop", "start", loop.id, "--config", configPath, "--json"]);
    assert.equal(started.id, loop.id);
    assert.ok(["RUNNING", "WAITING_APPROVAL", "SUCCEEDED", "FAILED"].includes(started.status));

    const sourcePreflight = await runCli(["source-closure", "preflight", loop.id, "--config", configPath, "--json"]);
    assert.equal(sourcePreflight.status, "PASS");

    const releaseEvidence = path.join(dataRoot, "release-evidence.md");
    fs.writeFileSync(releaseEvidence, "# CLI release evidence\n\nSource closure evidence from the CLI functional test.\n");
    const closure = await runCli([
      "source-closure", "execute", loop.id,
      "--branch", "evopilot/cli-beta",
      "--message", "EvoPilot CLI source closure",
      "--write-file", `docs/release-evidence.md:${releaseEvidence}`,
      "--config", configPath,
      "--json"
    ]);
    assert.equal(closure.id, loop.id);
    assert.ok(["PROMOTED", "SUCCEEDED"].includes(closure.sourceClosure.closureState));
    assert.equal(closure.sourceReleaseRun.status, "PROMOTED");

    const releaseRunsByLoop = await runCli(["release-run", "list", "--loop", loop.id, "--config", configPath, "--json"]);
    assert.ok(releaseRunsByLoop.some((run) => run.id === closure.sourceReleaseRun.id));

    const releaseRuns = await runCli(["release-run", "list", "--config", configPath, "--json"]);
    assert.ok(releaseRuns.some((run) => run.id === closure.sourceReleaseRun.id));

    const inspectedReleaseRun = await runCli(["release-run", "inspect", closure.sourceReleaseRun.id, "--loop", loop.id, "--config", configPath, "--json"]);
    assert.equal(inspectedReleaseRun.id, closure.sourceReleaseRun.id);
    assert.equal(inspectedReleaseRun.loopId, loop.id);

    const approvedReleaseRun = await runCli(["source-closure", "approve-release", loop.id, "--config", configPath, "--json"]);
    assert.equal(approvedReleaseRun.sourceReleaseRun.id, closure.sourceReleaseRun.id);
    assert.equal(approvedReleaseRun.sourceReleaseRun.review.status, "APPROVED");

    const repairCandidates = await runCli(["release-run", "repair-candidates", "--config", configPath, "--json"]);
    assert.ok(Array.isArray(repairCandidates));

    const repairQueue = await runCli(["release-run", "repair-all", "--config", configPath, "--json"]);
    assert.equal(repairQueue.schema, "evopilot-source-release-repair-queue/v1");
    assert.ok(Array.isArray(repairQueue.repaired));
    assert.ok(Array.isArray(repairQueue.failed));
    assert.ok(Array.isArray(repairQueue.skipped));

    const finalizers = await runCli(["release-run", "finalizers", "--config", configPath, "--json"]);
    assert.ok(Array.isArray(finalizers));

    const workerLoop = await runCli([
      "loop", "create",
      "--project", "cli-agent",
      "--target", "cli-agent-beta",
      "--objective", "Claim CLI worker queue",
      "--idempotency-key", "cli-worker-loop",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(workerLoop.status, "PENDING");

    const workerQueue = await runCli(["worker", "queue", "--config", configPath, "--json"]);
    assert.ok(workerQueue.some((item) => item.loopId === workerLoop.id && item.claimable === true));

    const workerClaim = await runCli([
      "worker", "claim",
      "--worker-id", "cli-worker",
      "--loop", workerLoop.id,
      "--lease-seconds", "60",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(workerClaim.workerId, "cli-worker");
    assert.equal(workerClaim.claimed.loopId, workerLoop.id);

    const workerHeartbeat = await runCli([
      "worker", "heartbeat",
      "--worker-id", "cli-worker",
      "--loop", workerLoop.id,
      "--lease-seconds", "60",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(workerHeartbeat.workerId, "cli-worker");
    assert.ok(workerHeartbeat.expiresAt);

    const workerLeases = await runCli(["worker", "leases", "--config", configPath, "--json"]);
    assert.ok(workerLeases.some((item) => item.loopId === workerLoop.id && item.workerLease?.workerId === "cli-worker"));

    const sandboxProof = await runCli(["sandbox", "proof", loop.id, "--config", configPath, "--json"]);
    assert.equal(sandboxProof.schema, "evopilot-loop-sandbox-boundary-proof/v1");
    assert.equal(sandboxProof.loopId, loop.id);
    assert.ok(["ENFORCED", "POLICY_ONLY", "FAILED"].includes(sandboxProof.status));

    const sandboxVerification = await runCli(["sandbox", "verify", loop.id, "--config", configPath, "--json"]);
    assert.equal(sandboxVerification.loop.id, loop.id);
    assert.equal(sandboxVerification.proof.loopId, loop.id);

    const checkpoints = await runCli(["replay", "checkpoints", loop.id, "--config", configPath, "--json"]);
    assert.ok(checkpoints.some((checkpoint) => checkpoint.loopId === loop.id && checkpoint.replayable === true));

    const contextPatchFile = path.join(dataRoot, "replay-context.json");
    fs.writeFileSync(contextPatchFile, JSON.stringify({ cliReplayTarget: "phase-2-functional" }));
    const replay = await runCli([
      "replay", "run", loop.id,
      "--from-iteration", "1",
      "--context-patch", contextPatchFile,
      "--evidence", "cli replay functional evidence",
      "--force-decision", "SUCCEED",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(replay.loop.id, loop.id);
    assert.equal(replay.replayDiff.loopId, loop.id);
    assert.ok(replay.replayDiff.contextChangedKeys.includes("cliReplayTarget"));

    const traceTree = await runCli(["trace", "tree", loop.id, "--config", configPath, "--json"]);
    assert.equal(traceTree.schema, "evopilot-loop-trace-tree/v1");
    assert.equal(traceTree.loopId, loop.id);
    assert.ok(traceTree.nodes.some((node) => node.id === loop.id));

    const traceEvents = await runCli(["trace", "events", loop.id, "--config", configPath, "--json"]);
    assert.ok(traceEvents.some((event) => event.loopId === loop.id));

    const deployConnector = await runCli([
      "connector", "deploy", "create",
      "--id", "cli-webhook",
      "--type", "http-webhook",
      "--url", "http://127.0.0.1:1/deploy",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(deployConnector.id, "cli-webhook");
    assert.equal(deployConnector.type, "http-webhook");

    const deployConnectors = await runCli(["connector", "deploy", "list", "--config", configPath, "--json"]);
    assert.ok(deployConnectors.some((connector) => connector.id === "cli-webhook"));

    const auditRecords = await runCli(["audit", "list", "--limit", "10", "--config", configPath, "--json"]);
    assert.ok(auditRecords.some((record) => record.action === "deploy.connector.saved"));

    const releaseGate = await runCli([
      "release", "gate",
      "--project", "cli-agent",
      "--target", "cli-agent-beta",
      "--scenario", "beta-core-flow=PASS",
      "--scenario", "ci-cd-pass=PASS",
      "--scenario", "manual-approval=PASS",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(releaseGate.projectId, "cli-agent");
    assert.equal(releaseGate.releaseTargetId, "cli-agent-beta");
    assert.ok(releaseGate.releaseDecisionId);

    const decisions = await runCli(["release", "decisions", "--project", "cli-agent", "--target", "cli-agent-beta", "--config", configPath, "--json"]);
    assert.ok(decisions.some((decision) => decision.id === releaseGate.releaseDecisionId));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const expected = options.status ?? 0;
      if (code !== expected) {
        reject(new Error(`CLI failed:\nargs=${args.join(" ")}\nexit=${code}\nstdout=${stdout}\nstderr=${stderr}`));
        return;
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : {});
      } catch (error) {
        reject(new Error(`CLI returned invalid JSON:\nargs=${args.join(" ")}\nstdout=${stdout}\nstderr=${stderr}\n${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

function runCliText(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const expected = options.status ?? 0;
      if (code !== expected) {
        reject(new Error(`CLI failed:\nargs=${args.join(" ")}\nexit=${code}\nstdout=${stdout}\nstderr=${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function createGitRepository(repoRoot) {
  fs.mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# CLI Agent\n");
  execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["checkout", "-b", "main"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "evopilot-cli@example.com"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "EvoPilot CLI"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial commit"], { cwd: repoRoot, stdio: "ignore" });
}

async function startFakeGitHubForCli() {
  const server = http.createServer(async (request, response) => {
    if (request.url === "/repos/org/repo/git/trees/main?recursive=1") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ tree: [{ type: "blob", path: "README.md" }] }));
      return;
    }
    if (request.url === "/repos/org/repo/commits/main/check-runs") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ check_runs: [
        { name: "build", status: "completed", conclusion: "success" },
        { name: "test", status: "completed", conclusion: "success" }
      ] }));
      return;
    }
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "UP" }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
