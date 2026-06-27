import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../../packages/server/dist/index.js";

test("EvoPilot Loop Runtime supports long-task loop engineering controls", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-loop-runtime-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "viewer", token: "viewer-token", role: "viewer" },
      { name: "operator", token: "operator-token", role: "operator" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const graph = await jsonFetch(`${baseUrl}/api/v1/executor-graphs`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "product-evolution-dag",
        name: "Product Evolution DAG",
        mode: "parallel",
        nodes: [
          { id: "plan", type: "llm", name: "Plan", config: { adapterId: "evopilot.llm-context-adapter" } },
          { id: "upgrade", type: "code-upgrader", name: "Upgrade", config: { adapterId: "evopilot.code-upgrader-adapter" } },
          { id: "validate", type: "validator", name: "Validate" },
          { id: "approve", type: "approval", name: "Approve" }
        ],
        edges: [
          { from: "plan", to: "upgrade" },
          { from: "upgrade", to: "validate" },
          { from: "validate", to: "approve" }
        ]
      }
    });
    assert.equal(graph.status, 201);
    assert.equal(graph.body.data.schema, "evopilot-executor-graph/v1");
    assert.equal(graph.body.data.nodes.length, 4);
    assert.equal(graph.body.data.mode, "parallel");

    const storeRuntime = await jsonFetch(`${baseUrl}/api/v1/loop-store`, {
      token: "viewer-token"
    });
    assert.equal(storeRuntime.status, 200);
    assert.equal(storeRuntime.body.data.backend, "file");
    assert.equal(storeRuntime.body.data.recovery, "idempotent-replay");

    const created = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      idempotencyKey: "create-workbuddy-loop",
      body: {
        id: "workbuddy-long-task",
        source: "api",
        projectId: "workbuddy",
        objective: "Continuously evolve WorkBuddy until release readiness passes.",
        executorGraphId: "product-evolution-dag",
        controlPlaneUrl: "http://8.153.72.80",
        sourceClosure: {
          sourceProjectId: "workbuddy",
          repositoryProvider: "github",
          sourceUrl: "https://github.com/example/workbuddy.git",
          sourceBranch: "main",
          targetVersion: "2.0.0",
          releaseStrategy: "github-push",
          requiredGates: ["code-change", "push", "tag", "deploy", "health-ready"],
          deploymentEnvironment: "production"
        },
        sandbox: {
          runtime: "docker",
          image: "ghcr.io/all-hands-ai/runtime:0.59-nikolaik",
          credentialScope: "loop",
          network: "restricted",
          allowedPaths: ["src", "test"],
          deniedPaths: [".env", ".git"]
        },
        stopPolicy: {
          maxIterations: 2,
          maxDurationSeconds: 86400,
          requireApprovalForRelease: true,
          stopOnRepeatedFailure: 2
        },
        retryPolicy: {
          maxAttemptsPerNode: 2,
          backoffSeconds: 1,
          circuitBreakerFailures: 2
        },
        context: { entry: "codex" }
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.schema, "evopilot-loop-run/v1");
    assert.equal(created.body.data.status, "PENDING");
    assert.equal(created.body.data.executorGraphId, "product-evolution-dag");
    assert.equal(created.body.data.controlPlaneUrl, "http://8.153.72.80");
    assert.equal(created.body.data.sourceClosure.repositoryProvider, "github");
    assert.equal(created.body.data.sourceClosure.sourceUrl, "https://github.com/example/workbuddy.git");
    assert.equal(created.body.data.sourceClosure.targetVersion, "2.0.0");
    assert.deepEqual(created.body.data.sourceClosure.requiredGates, ["code-change", "push", "tag", "deploy", "health-ready"]);
    assert.equal(created.body.data.sandbox.runtime, "docker");
    assert.equal(created.body.data.coordination.mode, "parallel");
    assert.equal(created.body.data.trace.executorStepCount, 0);

    const createdAgain = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      idempotencyKey: "create-workbuddy-loop",
      body: {
        id: "workbuddy-long-task-ignored",
        objective: "Idempotency should return original loop."
      }
    });
    assert.equal(createdAgain.status, 200);
    assert.equal(createdAgain.body.data.id, "workbuddy-long-task");

    const started = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/start`, {
      method: "POST",
      token: "operator-token",
      idempotencyKey: "start-workbuddy-loop"
    });
    assert.equal(started.status, 200);
    assert.equal(started.body.data.status, "RUNNING");
    assert.equal(started.body.data.currentIteration, 1);
    assert.equal(started.body.data.evidenceSets[0].validator, "evopilot-loop-runtime");
    assert.ok(started.body.data.iterations[0].executorSteps.every((step) => step.input.adapterId));
    assert.equal(started.body.data.iterations[0].executorSteps[0].input.adapterId, "evopilot.llm-context-adapter");
    assert.equal(started.body.data.iterations[0].executorSteps[1].output.adapterId, "evopilot.code-upgrader-adapter");
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "adapter=evopilot.llm-context-adapter"));
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "adapter=evopilot.code-upgrader-adapter"));
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item.includes("executorBoundary=OpenHands/code-upgrader runtime boundary")));
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "coordinationMode=parallel"));
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "sandboxRuntime=docker"));
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "sourceClosure.provider=github"));
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "sourceClosure.targetVersion=2.0.0"));
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "sourceClosure.requiredGates=code-change,push,tag,deploy,health-ready"));
    assert.equal(started.body.data.iterations[0].executorSteps[0].input.sourceClosure.repositoryProvider, "github");
    assert.equal(started.body.data.iterations[0].executorSteps[1].output.sourceClosure.releaseStrategy, "github-push");
    assert.equal(started.body.data.iterations[0].executorSteps[0].input.sandbox.runtime, "docker");
    assert.equal(started.body.data.trace.executorStepCount, 4);

    const trace = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/trace`, {
      token: "viewer-token"
    });
    assert.equal(trace.status, 200);
    assert.equal(trace.body.data.loopId, "workbuddy-long-task");
    assert.equal(trace.body.data.executorStepCount, 4);

    const observability = await jsonFetch(`${baseUrl}/api/v1/loop-observability`, {
      token: "viewer-token"
    });
    assert.equal(observability.status, 200);
    assert.ok(observability.body.data.some((item) => item.loopId === "workbuddy-long-task"));

    const waiting = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/resume`, {
      method: "POST",
      token: "operator-token",
      body: { evidence: ["real validation evidence collected"] }
    });
    assert.equal(waiting.status, 200);
    assert.equal(waiting.body.data.status, "WAITING_APPROVAL");
    assert.equal(waiting.body.data.approvals[0].status, "PENDING");

    const blockedResume = await fetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/resume`, {
      method: "POST",
      headers: authHeaders("operator-token", true),
      body: JSON.stringify({})
    });
    assert.equal(blockedResume.status, 409);

    const approved = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/approve`, {
      method: "POST",
      token: "operator-token",
      body: { approvalId: waiting.body.data.approvals[0].id }
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.approvals[0].status, "APPROVED");

    const replayed = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/replay`, {
      method: "POST",
      token: "operator-token",
      body: {
        fromIteration: 2,
        contextPatch: { humanEdit: "tighten target loop scope", priority: "persistent-loop-store" },
        evidence: ["human edited context before replay"]
      }
    });
    assert.equal(replayed.status, 200);
    assert.equal(replayed.body.data.currentIteration, 2);
    assert.equal(replayed.body.data.iterations[1].replayOfIterationId, "workbuddy-long-task-iter-2");
    assert.equal(replayed.body.data.iterations[1].contextPatch.humanEdit, "tighten target loop scope");
    assert.equal(replayed.body.data.context.humanEdit, "tighten target loop scope");

    const timeline = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/timeline`, {
      token: "viewer-token"
    });
    assert.equal(timeline.status, 200);
    assert.ok(timeline.body.data.some((event) => event.type === "DECISION"));
    assert.ok(timeline.body.data.some((event) => event.type === "REPLAY"));

    const evidence = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/evidence`, {
      token: "viewer-token"
    });
    assert.equal(evidence.status, 200);
    assert.equal(evidence.body.data.length, 2);

    const artifacts = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/artifacts`, {
      token: "viewer-token"
    });
    assert.equal(artifacts.status, 200);
    assert.ok(artifacts.body.data.length >= 2);

    const heartbeat = await jsonFetch(`${baseUrl}/api/v1/loop-workers/heartbeat`, {
      method: "POST",
      token: "operator-token",
      body: { loopId: "workbuddy-long-task", workerId: "worker-a", leaseSeconds: 1 }
    });
    assert.equal(heartbeat.status, 200);
    assert.equal(heartbeat.body.data.workerId, "worker-a");

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const watchdog = await jsonFetch(`${baseUrl}/api/v1/loops/watchdog`, {
      method: "POST",
      token: "operator-token",
      body: {}
    });
    assert.equal(watchdog.status, 200);
    assert.ok(Array.isArray(watchdog.body.data.recovered));

    const failureLoop = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "repeat-failure-loop",
        objective: "Prove repeated failure circuit breaker.",
        stopPolicy: { maxIterations: 5, stopOnRepeatedFailure: 2, requireApprovalForRelease: false },
        retryPolicy: { circuitBreakerFailures: 1 }
      }
    });
    assert.equal(failureLoop.status, 201);
    const repair = await jsonFetch(`${baseUrl}/api/v1/loops/repeat-failure-loop/start`, {
      method: "POST",
      token: "operator-token",
      body: { forceDecision: "REPAIR" }
    });
    assert.equal(repair.status, 200);
    const blocked = await jsonFetch(`${baseUrl}/api/v1/loops/repeat-failure-loop/resume`, {
      method: "POST",
      token: "operator-token",
      body: { forceDecision: "REPAIR" }
    });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.data.status, "BLOCKED");

    const conversation = await jsonFetch(`${baseUrl}/api/v1/conversations/commands`, {
      method: "POST",
      token: "operator-token",
      body: {
        channel: "wecom",
        conversationId: "chat-1",
        text: "项目 workbuddy 持续推进 GA",
        projectId: "workbuddy",
        targetId: "ga"
      }
    });
    assert.equal(conversation.status, 201);
    assert.equal(conversation.body.data.loop.schema, "evopilot-loop-run/v1");
    assert.equal(conversation.body.data.loop.source, "im");

    const feishu = await jsonFetch(`${baseUrl}/api/v1/im/feishu/webhook`, {
      method: "POST",
      token: "operator-token",
      body: {
        event: {
          message: {
            chat_id: "feishu-chat-1",
            content: JSON.stringify({ text: "项目 workbuddy 持续推进 GA" })
          }
        },
        projectId: "workbuddy",
        targetId: "ga"
      }
    });
    assert.equal(feishu.status, 201);
    assert.equal(feishu.body.data.schema, "evopilot-im-webhook-result/v1");
    assert.equal(feishu.body.data.loop.source, "im");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Loop source closure executes GitHub source writeback gates", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-source-closure-"));
  const github = createFakeSourceClosureGitHubServer();
  const deploy = createFakeDeployConnectorServer();
  await listen(github);
  await listen(deploy);
  const githubPort = github.address().port;
  const deployPort = deploy.address().port;
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
    const project = await jsonFetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "github-source",
        name: "GitHub Source",
        repository: {
          provider: "github",
          baseUrl: `http://127.0.0.1:${githubPort}`,
          owner: "org",
          repo: "repo",
          defaultBranch: "main",
          credentials: { token: "token" }
        }
      }
    });
    assert.equal(project.status, 201);
    assert.equal(project.body.data.validation.status, "VERIFIED");

    const deployConnector = await jsonFetch(`${baseUrl}/api/v1/connectors/deploy`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "prod-webhook",
        name: "Production Webhook",
        url: `http://127.0.0.1:${deployPort}/deploy`,
        token: "deploy-token",
        healthPath: "/health",
        readyPath: "/ready"
      }
    });
    assert.equal(deployConnector.status, 201);
    assert.equal(deployConnector.body.data.tokenConfigured, true);

    const created = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "github-source-loop",
        projectId: "github-source",
        objective: "Close source-to-production release evidence.",
        controlPlaneUrl: baseUrl,
        sourceClosure: {
          sourceProjectId: "github-source",
          repositoryProvider: "github",
          sourceBranch: "main",
          targetVersion: "2.0.0",
          deploymentConnectorId: "prod-webhook",
          requiredGates: ["code-change", "push", "tag", "deploy", "health-ready"]
        }
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.sourceClosure.closureState, "PLANNED");

    const executed = await jsonFetch(`${baseUrl}/api/v1/loops/github-source-loop/source-closure/execute`, {
      method: "POST",
      token: "admin-token",
      body: {
        files: [{ path: "docs/source-closure.md", content: "closed by EvoPilot" }],
        tagName: "v2.0.0",
        deployConnectorId: "prod-webhook"
      }
    });
    assert.equal(executed.status, 200);
    assert.equal(executed.body.data.sourceClosure.closureState, "PROMOTED");
    assert.equal(executed.body.data.sourceClosure.artifacts.branch, "evopilot/github-source-loop-2.0.0");
    assert.equal(executed.body.data.sourceClosure.artifacts.commitSha, "github-commit-sha");
    assert.equal(executed.body.data.sourceClosure.artifacts.pullRequestUrl, "http://github/pr/3");
    assert.equal(executed.body.data.sourceClosure.artifacts.tag, "v2.0.0");
    assert.equal(executed.body.data.sourceClosure.artifacts.deploymentConnectorId, "prod-webhook");
    assert.equal(executed.body.data.sourceClosure.artifacts.deploymentId, "deployment-1");
    assert.equal(executed.body.data.sourceClosure.gateEvidence["code-change"].status, "PASSED");
    assert.equal(executed.body.data.sourceClosure.gateEvidence.push.status, "PASSED");
    assert.equal(executed.body.data.sourceClosure.gateEvidence.tag.status, "PASSED");
    assert.equal(executed.body.data.sourceClosure.gateEvidence.deploy.status, "PASSED");
    assert.ok(executed.body.data.sourceClosure.gateEvidence.deploy.evidence.some((item) => item === "deployConnector=prod-webhook"));
    assert.equal(executed.body.data.sourceClosure.gateEvidence["health-ready"].status, "PASSED");
    assert.ok(executed.body.data.evidenceSets.some((set) => set.validator === "evopilot-source-closure"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await close(github);
    await close(deploy);
  }
});

test("Loop source closure can deploy through ECS Docker Compose connector", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-ecs-compose-source-closure-"));
  const deployRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-ecs-compose-workdir-"));
  const binDir = path.join(deployRoot, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const gitLog = path.join(deployRoot, "git.log");
  const dockerLog = path.join(deployRoot, "docker.log");
  const pulledMarker = path.join(deployRoot, ".pulled");
  const gitScript = path.join(binDir, "git");
  const dockerScript = path.join(binDir, "docker");
  fs.writeFileSync(gitScript, `#!/bin/sh
echo "$@" >> "${gitLog}"
if [ "$1" = "rev-parse" ]; then
  if [ -f "${pulledMarker}" ]; then
    echo "after-ecs-commit"
  else
    echo "before-ecs-commit"
  fi
  exit 0
fi
if [ "$1" = "pull" ]; then
  touch "${pulledMarker}"
  echo "pulled"
  exit 0
fi
echo "unexpected git command: $@" >&2
exit 2
`);
  fs.writeFileSync(dockerScript, `#!/bin/sh
echo "$@" >> "${dockerLog}"
exit 0
`);
  fs.chmodSync(gitScript, 0o755);
  fs.chmodSync(dockerScript, 0o755);

  const github = createFakeSourceClosureGitHubServer();
  const deploy = createFakeDeployConnectorServer();
  await listen(github);
  await listen(deploy);
  const githubPort = github.address().port;
  const deployPort = deploy.address().port;
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "admin", token: "admin-token", role: "admin" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const project = await jsonFetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "github-ecs-source",
        name: "GitHub ECS Source",
        repository: {
          provider: "github",
          baseUrl: `http://127.0.0.1:${githubPort}`,
          owner: "org",
          repo: "repo",
          defaultBranch: "main",
          credentials: { token: "token" }
        }
      }
    });
    assert.equal(project.status, 201);

    const deployConnector = await jsonFetch(`${baseUrl}/api/v1/connectors/deploy`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "ecs-compose",
        name: "ECS Docker Compose",
        type: "ecs-docker-compose",
        workingDir: deployRoot,
        composeFile: "docker-compose.prod.yml",
        serviceName: "evopilot-server",
        gitCommand: gitScript,
        dockerCommand: dockerScript,
        gitRemote: "origin",
        gitBranch: "main",
        url: `http://127.0.0.1:${deployPort}`,
        healthPath: "/health",
        readyPath: "/ready"
      }
    });
    assert.equal(deployConnector.status, 201);
    assert.equal(deployConnector.body.data.type, "ecs-docker-compose");

    const created = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "github-ecs-loop",
        projectId: "github-ecs-source",
        objective: "Close source to ECS Docker Compose deployment.",
        controlPlaneUrl: baseUrl,
        sourceClosure: {
          sourceProjectId: "github-ecs-source",
          repositoryProvider: "github",
          sourceBranch: "main",
          targetVersion: "2.2.0",
          deploymentConnectorId: "ecs-compose",
          requiredGates: ["code-change", "push", "deploy", "health-ready"]
        }
      }
    });
    assert.equal(created.status, 201);

    const executed = await jsonFetch(`${baseUrl}/api/v1/loops/github-ecs-loop/source-closure/execute`, {
      method: "POST",
      token: "admin-token",
      body: {
        files: [{ path: "docs/source-closure.md", content: "closed by EvoPilot ECS connector" }],
        deployConnectorId: "ecs-compose"
      }
    });
    assert.equal(executed.status, 200);
    assert.equal(executed.body.data.sourceClosure.closureState, "PROMOTED");
    assert.equal(executed.body.data.sourceClosure.artifacts.deploymentConnectorId, "ecs-compose");
    assert.equal(executed.body.data.sourceClosure.artifacts.deploymentId, "after-ecs-commit");
    assert.equal(executed.body.data.sourceClosure.gateEvidence.deploy.status, "PASSED");
    assert.ok(executed.body.data.sourceClosure.gateEvidence.deploy.evidence.some((item) => item === "deployConnectorType=ecs-docker-compose"));
    assert.equal(executed.body.data.sourceClosure.gateEvidence["health-ready"].status, "PASSED");
    assert.match(fs.readFileSync(gitLog, "utf8"), /pull --ff-only origin main/);
    assert.equal(fs.readFileSync(dockerLog, "utf8").trim(), "compose -f docker-compose.prod.yml up -d --build evopilot-server");

    const replayed = await jsonFetch(`${baseUrl}/api/v1/loops/github-ecs-loop/source-closure/execute`, {
      method: "POST",
      token: "admin-token",
      body: {
        files: [{ path: "docs/source-closure.md", content: "closed by EvoPilot ECS connector" }],
        deployConnectorId: "ecs-compose"
      }
    });
    assert.equal(replayed.status, 200);
    assert.equal(replayed.body.data.sourceClosure.gateEvidence.deploy.status, "PASSED");
    assert.ok(replayed.body.data.sourceClosure.gateEvidence.deploy.evidence.some((item) => item === "idempotentReplay=true"));
    assert.equal(fs.readFileSync(dockerLog, "utf8").trim().split("\n").length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await close(github);
    await close(deploy);
  }
});

test("ECS Docker Compose deploy connector rolls back after compose failure", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-ecs-compose-rollback-"));
  const deployRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-ecs-compose-rollback-workdir-"));
  const binDir = path.join(deployRoot, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const gitLog = path.join(deployRoot, "git.log");
  const dockerLog = path.join(deployRoot, "docker.log");
  const pulledMarker = path.join(deployRoot, ".pulled");
  const resetMarker = path.join(deployRoot, ".reset");
  const dockerCount = path.join(deployRoot, "docker-count");
  const gitScript = path.join(binDir, "git");
  const dockerScript = path.join(binDir, "docker");
  fs.writeFileSync(gitScript, `#!/bin/sh
echo "$@" >> "${gitLog}"
if [ "$1" = "rev-parse" ]; then
  if [ -f "${pulledMarker}" ]; then
    echo "after-rollback-commit"
  else
    echo "before-rollback-commit"
  fi
  exit 0
fi
if [ "$1" = "pull" ]; then
  touch "${pulledMarker}"
  echo "pulled"
  exit 0
fi
if [ "$1" = "reset" ]; then
  touch "${resetMarker}"
  echo "reset to $3"
  exit 0
fi
echo "unexpected git command: $@" >&2
exit 2
`);
  fs.writeFileSync(dockerScript, `#!/bin/sh
echo "$@" >> "${dockerLog}"
if [ ! -f "${dockerCount}" ]; then
  echo 1 > "${dockerCount}"
  echo "compose failed" >&2
  exit 9
fi
echo "rollback compose succeeded"
exit 0
`);
  fs.chmodSync(gitScript, 0o755);
  fs.chmodSync(dockerScript, 0o755);

  const github = createFakeSourceClosureGitHubServer();
  await listen(github);
  const githubPort = github.address().port;
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "admin", token: "admin-token", role: "admin" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const project = await jsonFetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "github-ecs-rollback-source",
        name: "GitHub ECS Rollback Source",
        repository: {
          provider: "github",
          baseUrl: `http://127.0.0.1:${githubPort}`,
          owner: "org",
          repo: "repo",
          defaultBranch: "main",
          credentials: { token: "token" }
        }
      }
    });
    assert.equal(project.status, 201);

    const deployConnector = await jsonFetch(`${baseUrl}/api/v1/connectors/deploy`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "ecs-compose-rollback",
        name: "ECS Docker Compose Rollback",
        type: "ecs-docker-compose",
        workingDir: deployRoot,
        composeFile: "docker-compose.prod.yml",
        serviceName: "evopilot-server",
        gitCommand: gitScript,
        dockerCommand: dockerScript,
        gitRemote: "origin",
        gitBranch: "main",
        rollbackOnFailure: true,
        url: "http://127.0.0.1:1",
        healthPath: "/health",
        readyPath: "/ready"
      }
    });
    assert.equal(deployConnector.status, 201);
    assert.equal(deployConnector.body.data.rollbackOnFailure, true);
    assert.equal(deployConnector.body.data.deployLock, true);
    assert.equal(deployConnector.body.data.idempotency, true);

    const created = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "github-ecs-rollback-loop",
        projectId: "github-ecs-rollback-source",
        objective: "Rollback a failed ECS Docker Compose deployment.",
        controlPlaneUrl: baseUrl,
        sourceClosure: {
          sourceProjectId: "github-ecs-rollback-source",
          repositoryProvider: "github",
          sourceBranch: "main",
          targetVersion: "2.3.0",
          deploymentConnectorId: "ecs-compose-rollback",
          requiredGates: ["code-change", "push", "deploy", "health-ready"]
        }
      }
    });
    assert.equal(created.status, 201);

    const executed = await jsonFetch(`${baseUrl}/api/v1/loops/github-ecs-rollback-loop/source-closure/execute`, {
      method: "POST",
      token: "admin-token",
      body: {
        files: [{ path: "docs/source-closure.md", content: "closed by EvoPilot rollback connector" }],
        deployConnectorId: "ecs-compose-rollback"
      }
    });
    assert.equal(executed.status, 200);
    assert.equal(executed.body.data.sourceClosure.closureState, "FAILED");
    assert.equal(executed.body.data.sourceClosure.gateEvidence.deploy.status, "FAILED");
    assert.equal(executed.body.data.sourceClosure.gateEvidence["health-ready"].status, "SKIPPED");
    assert.ok(executed.body.data.sourceClosure.gateEvidence.deploy.evidence.some((item) => item === "rollbackStatus=SUCCEEDED"));
    assert.ok(executed.body.data.sourceClosure.gateEvidence.deploy.evidence.some((item) => item.startsWith("deployLock=")));
    assert.match(fs.readFileSync(gitLog, "utf8"), /reset --hard before-rollback-commit/);
    assert.equal(fs.readFileSync(dockerLog, "utf8").trim().split("\n").length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await close(github);
  }
});

test("Loop source closure executes GitLab source writeback gates", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-gitlab-source-closure-"));
  const gitlab = createFakeSourceClosureGitLabServer();
  await listen(gitlab);
  const gitlabPort = gitlab.address().port;
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "admin", token: "admin-token", role: "admin" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const project = await jsonFetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "gitlab-source",
        name: "GitLab Source",
        repository: {
          provider: "gitlab",
          baseUrl: `http://127.0.0.1:${gitlabPort}`,
          projectId: "group/project",
          defaultBranch: "main",
          credentials: { token: "token" }
        }
      }
    });
    assert.equal(project.status, 201);
    assert.equal(project.body.data.validation.status, "VERIFIED");

    const created = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "gitlab-source-loop",
        projectId: "gitlab-source",
        objective: "Close GitLab source release evidence.",
        controlPlaneUrl: baseUrl,
        sourceClosure: {
          sourceProjectId: "gitlab-source",
          repositoryProvider: "gitlab",
          sourceBranch: "main",
          targetVersion: "2.1.0",
          requiredGates: ["code-change", "push", "tag", "deploy", "health-ready"]
        }
      }
    });
    assert.equal(created.status, 201);

    const executed = await jsonFetch(`${baseUrl}/api/v1/loops/gitlab-source-loop/source-closure/execute`, {
      method: "POST",
      token: "admin-token",
      body: {
        files: [{ path: "docs/source-closure.md", content: "closed by EvoPilot GitLab" }],
        tagName: "v2.1.0"
      }
    });
    assert.equal(executed.status, 200);
    assert.equal(executed.body.data.sourceClosure.closureState, "PROMOTED");
    assert.equal(executed.body.data.sourceClosure.artifacts.commitSha, "gitlab-commit-sha");
    assert.equal(executed.body.data.sourceClosure.artifacts.mergeRequestUrl, "http://gitlab/mr/7");
    assert.equal(executed.body.data.sourceClosure.artifacts.tag, "v2.1.0");
    assert.equal(executed.body.data.sourceClosure.gateEvidence["health-ready"].status, "PASSED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await close(gitlab);
  }
});

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...authHeaders(options.token, Boolean(options.body)),
      ...(options.idempotencyKey ? { "x-idempotency-key": options.idempotencyKey } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json();
  return { status: response.status, body };
}

function createFakeSourceClosureGitHubServer() {
  return http.createServer(async (request, response) => {
    if (request.url === "/repos/org/repo/git/trees/main?recursive=1") {
      return json(response, { tree: [{ type: "blob", path: "README.md" }] });
    }
    if (request.url === "/repos/org/repo/git/ref/heads%2Fmain" && request.method === "GET") {
      return json(response, { ref: "refs/heads/main", object: { sha: "base-sha" } });
    }
    if (request.url === "/repos/org/repo/git/refs" && request.method === "POST") {
      return json(response, { ref: "refs/heads/evopilot/github-source-loop-2.0.0", object: { sha: "base-sha" } });
    }
    if (request.url === "/repos/org/repo/contents/docs/source-closure.md" && request.method === "PUT") {
      return json(response, { commit: { sha: "github-commit-sha" }, content: { html_url: "http://github/blob/docs/source-closure.md" } });
    }
    if (request.url === "/repos/org/repo/pulls" && request.method === "POST") {
      return json(response, { number: 3, html_url: "http://github/pr/3" });
    }
    response.writeHead(404);
    response.end();
  });
}

function createFakeSourceClosureGitLabServer() {
  return http.createServer(async (request, response) => {
    if (request.url?.startsWith("/api/v4/projects/group%2Fproject/repository/tree")) {
      return json(response, [{ type: "blob", path: "README.md" }]);
    }
    if (request.url === "/api/v4/projects/group%2Fproject/repository/branches" && request.method === "POST") {
      return json(response, { name: "evopilot/gitlab-source-loop-2.1.0", web_url: "http://gitlab/branch" });
    }
    if (request.url === "/api/v4/projects/group%2Fproject/repository/commits" && request.method === "POST") {
      return json(response, { id: "gitlab-commit-sha", short_id: "gitlab-c", web_url: "http://gitlab/commit/gitlab-c" });
    }
    if (request.url === "/api/v4/projects/group%2Fproject/merge_requests" && request.method === "POST") {
      return json(response, { iid: 7, web_url: "http://gitlab/mr/7" });
    }
    if (request.url === "/api/v4/projects/group%2Fproject/repository/tags" && request.method === "POST") {
      return json(response, { name: "v2.1.0", target: "gitlab-commit-sha", web_url: "http://gitlab/tag/v2.1.0" });
    }
    response.writeHead(404);
    response.end();
  });
}

function createFakeDeployConnectorServer() {
  return http.createServer(async (request, response) => {
    if (request.url === "/deploy" && request.method === "POST") {
      assert.equal(request.headers.authorization, "Bearer deploy-token");
      return json(response, {
        deploymentId: "deployment-1",
        deploymentUrl: `http://${request.headers.host}`,
        statusUrl: `http://${request.headers.host}/deployments/deployment-1`,
        healthUrl: `http://${request.headers.host}/health`,
        readyUrl: `http://${request.headers.host}/ready`
      });
    }
    if (request.url === "/health") {
      return json(response, { status: "UP" });
    }
    if (request.url === "/ready") {
      return json(response, { status: "READY" });
    }
    response.writeHead(404);
    response.end();
  });
}

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

function authHeaders(token, json = false) {
  return {
    authorization: `Bearer ${token}`,
    ...(json ? { "content-type": "application/json" } : {})
  };
}
