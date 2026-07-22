import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createServer } from "../../packages/server/dist/index.js";

test("EvoPilot Loop Runtime supports long-task loop engineering controls", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-loop-runtime-"));
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
    assert.equal(graph.body.data.validation.status, "PASSED");
    assert.equal(graph.body.data.capabilities.typedEdges, true);

    const typedGraph = await jsonFetch(`${baseUrl}/api/v1/executor-graphs`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "typed-release-graph",
        name: "Typed Release Graph",
        mode: "parallel",
        nodes: [
          { id: "plan", type: "llm", name: "Plan", config: { outputSchema: { plan: "object" } } },
          { id: "upgrade", type: "code-upgrader", name: "Upgrade", config: { inputSchema: { plan: "object" } } },
          { id: "validate", type: "validator", name: "Validate" },
          { id: "approve", type: "approval", name: "Approve", config: { subgraphId: "approval/v1" } }
        ],
        edges: [
          { from: "plan", to: "upgrade", type: "sequence", outputSchemaRef: "target-plan/v1" },
          { from: "upgrade", to: "validate", type: "fan-out", condition: "files.length > 0", inputSchemaRef: "code-change/v1" },
          { from: "validate", to: "approve", type: "fan-in", inputSchemaRef: "validation-evidence/v1" }
        ]
      }
    });
    assert.equal(typedGraph.status, 201);
    assert.equal(typedGraph.body.data.validation.status, "PASSED");
    assert.equal(typedGraph.body.data.capabilities.fanOutFanIn, true);
    assert.equal(typedGraph.body.data.capabilities.nestedSubgraphs, true);

    const storeRuntime = await jsonFetch(`${baseUrl}/api/v1/loop-store`, {
      token: "viewer-token"
    });
    assert.equal(storeRuntime.status, 200);
    assert.equal(storeRuntime.body.data.backend, "file");
    assert.equal(storeRuntime.body.data.recovery, "idempotent-replay");

    const storeReadiness = await jsonFetch(`${baseUrl}/api/v1/loop-store/readiness`, {
      token: "viewer-token"
    });
    assert.equal(storeReadiness.status, 200);
    assert.equal(storeReadiness.body.data.schema, "evopilot-loop-store-readiness/v1");
    assert.equal(storeReadiness.body.data.status, "BLOCKED");
    assert.equal(storeReadiness.body.data.postgresRequired, true);
    assert.ok(storeReadiness.body.data.blockers.includes("POSTGRES_LOOP_STORE_NOT_CONFIGURED"));

    const tenants = await jsonFetch(`${baseUrl}/api/v1/tenants`, {
      token: "viewer-token"
    });
    assert.equal(tenants.status, 200);
    assert.ok(tenants.body.data.some((tenant) => tenant.id === "tenant-production" && tenant.status === "ACTIVE"));

    const workspaces = await jsonFetch(`${baseUrl}/api/v1/workspaces`, {
      token: "viewer-token"
    });
    assert.equal(workspaces.status, 200);
    const defaultWorkspace = workspaces.body.data.find((workspace) => workspace.id === "workspace-agent-products");
    assert.ok(defaultWorkspace);
    assert.equal(defaultWorkspace.tenantId, "tenant-production");
    assert.ok(defaultWorkspace.members.some((member) => member.role === "owner"));
    assert.ok(defaultWorkspace.members.some((member) => member.role === "admin"));
    assert.ok(defaultWorkspace.members.some((member) => member.role === "viewer"));

    const invited = await jsonFetch(`${baseUrl}/api/v1/workspaces/workspace-agent-products/invitations`, {
      method: "POST",
      token: "operator-token",
      body: {
        email: "developer@example.com",
        name: "Developer User",
        role: "developer"
      }
    });
    assert.equal(invited.status, 201);
    assert.equal(invited.body.data.invitation.id, "developer-example.com");
    assert.equal(invited.body.data.invitation.role, "developer");
    assert.equal(invited.body.data.invitation.status, "INVITED");

    const activatedMember = await jsonFetch(`${baseUrl}/api/v1/workspaces/workspace-agent-products/members/developer-example.com`, {
      method: "PATCH",
      token: "operator-token",
      body: { status: "ACTIVE", role: "developer" }
    });
    assert.equal(activatedMember.status, 200);
    assert.ok(activatedMember.body.data.members.some((member) => member.id === "developer-example.com" && member.status === "ACTIVE" && member.role === "developer"));

    const isolatedWorkspace = await jsonFetch(`${baseUrl}/api/v1/workspaces`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "isolated-workspace",
        name: "Isolated Workspace"
      }
    });
    assert.equal(isolatedWorkspace.status, 201);
    assert.equal(isolatedWorkspace.body.data.members[0].id, "admin");

    const blockedWorkspaceRead = await jsonFetch(`${baseUrl}/api/v1/workspaces/isolated-workspace`, {
      token: "viewer-token"
    });
    assert.equal(blockedWorkspaceRead.status, 403);

    const privateKeySecret = await jsonFetch(`${baseUrl}/api/v1/secrets`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "github-app-private-key",
        name: "GitHub App Private Key",
        kind: "github-app-private-key",
        value: "-----BEGIN PRIVATE KEY-----\\nlocal-test\\n-----END PRIVATE KEY-----"
      }
    });
    assert.equal(privateKeySecret.status, 201);
    assert.equal(privateKeySecret.body.data.secretRef, "github-app-private-key");
    assert.equal(privateKeySecret.body.data.valueConfigured, true);
    assert.equal(privateKeySecret.body.data.encryption, undefined);
    assert.equal(privateKeySecret.body.data.value, undefined);

    const webhookSecret = await jsonFetch(`${baseUrl}/api/v1/secrets`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "github-webhook-secret",
        name: "GitHub Webhook Secret",
        kind: "github-webhook-secret",
        value: "webhook-secret"
      }
    });
    assert.equal(webhookSecret.status, 201);
    assert.equal(webhookSecret.body.data.secretRef, "github-webhook-secret");

    const githubApp = await jsonFetch(`${baseUrl}/api/v1/github-app/installations`, {
      method: "POST",
      token: "operator-token",
      body: {
        installationId: "12345",
        account: "example-org",
        repositories: ["example-org/workspace-product"],
        permissions: { contents: "write", pull_requests: "write", metadata: "read" },
        privateKeySecretRef: "github-app-private-key",
        webhookSecretRef: "github-webhook-secret"
      }
    });
    assert.equal(githubApp.status, 201);
    assert.equal(githubApp.body.data.schema, "evopilot-github-app-installation/v1");
    assert.equal(githubApp.body.data.status, "READY");
    assert.ok(githubApp.body.data.checks.every((check) => check.status === "PASS"));

    const githubApps = await jsonFetch(`${baseUrl}/api/v1/github-app/installations`, {
      token: "viewer-token"
    });
    assert.equal(githubApps.status, 200);
    assert.ok(githubApps.body.data.some((installation) => installation.id === "github-app-12345" && installation.status === "READY"));

    const acmeTenant = await jsonFetch(`${baseUrl}/api/v1/tenants`, {
      method: "POST",
      token: "admin-token",
      actor: "operator",
      tenantId: "tenant-acme",
      workspaceId: "workspace-acme",
      body: {
        id: "tenant-acme",
        name: "Acme Tenant",
        plan: "SaaS",
        status: "ACTIVE"
      }
    });
    assert.equal(acmeTenant.status, 201);
    assert.equal(acmeTenant.body.data.id, "tenant-acme");
    assert.equal(acmeTenant.body.data.status, "ACTIVE");

    const acmeWorkspace = await jsonFetch(`${baseUrl}/api/v1/workspaces`, {
      method: "POST",
      token: "admin-token",
      actor: "operator",
      tenantId: "tenant-acme",
      workspaceId: "workspace-acme",
      body: {
        id: "workspace-acme",
        tenantId: "tenant-acme",
        name: "Acme Workspace"
      }
    });
    assert.equal(acmeWorkspace.status, 201);
    assert.equal(acmeWorkspace.body.data.tenantId, "tenant-acme");
    assert.ok(acmeWorkspace.body.data.members.some((member) => member.id === "operator" && member.role === "owner"));
    const tenantListAfterAcme = await jsonFetch(`${baseUrl}/api/v1/tenants`, {
      token: "admin-token"
    });
    assert.equal(tenantListAfterAcme.status, 200);
    assert.ok(tenantListAfterAcme.body.data.some((tenant) => tenant.id === "tenant-acme"));

    const acmeSecret = await jsonFetch(`${baseUrl}/api/v1/secrets`, {
      method: "POST",
      token: "operator-token",
      actor: "operator",
      tenantId: "tenant-acme",
      workspaceId: "workspace-acme",
      body: {
        id: "acme-source-token",
        name: "Acme Source Token",
        kind: "github-app-private-key",
        value: "acme-super-secret-token"
      }
    });
    assert.equal(acmeSecret.status, 201);
    assert.equal(acmeSecret.body.data.tenantId, "tenant-acme");
    assert.equal(acmeSecret.body.data.workspaceId, "workspace-acme");
    assert.equal(acmeSecret.body.data.value, undefined);
    assert.equal(acmeSecret.body.data.encryption, undefined);
    assert.equal(JSON.stringify(acmeSecret.body).includes("acme-super-secret-token"), false);

    const acmeWebhookSecret = await jsonFetch(`${baseUrl}/api/v1/secrets`, {
      method: "POST",
      token: "operator-token",
      actor: "operator",
      tenantId: "tenant-acme",
      workspaceId: "workspace-acme",
      body: {
        id: "acme-webhook-secret",
        name: "Acme Webhook Secret",
        kind: "github-webhook-secret",
        value: "acme-webhook-secret-value"
      }
    });
    assert.equal(acmeWebhookSecret.status, 201);
    assert.equal(acmeWebhookSecret.body.data.value, undefined);
    assert.equal(acmeWebhookSecret.body.data.encryption, undefined);

    const acmeGitHubApp = await jsonFetch(`${baseUrl}/api/v1/github-app/installations`, {
      method: "POST",
      token: "operator-token",
      actor: "operator",
      tenantId: "tenant-acme",
      workspaceId: "workspace-acme",
      body: {
        installationId: "67890",
        account: "acme-org",
        repositories: ["acme-org/tenant-product"],
        permissions: { contents: "write", metadata: "read" },
        privateKeySecretRef: "acme-source-token",
        webhookSecretRef: "acme-webhook-secret"
      }
    });
    assert.equal(acmeGitHubApp.status, 201);
    assert.equal(acmeGitHubApp.body.data.tenantId, "tenant-acme");
    assert.equal(acmeGitHubApp.body.data.workspaceId, "workspace-acme");

    const acmeProject = await jsonFetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      token: "admin-token",
      actor: "operator",
      tenantId: "tenant-acme",
      workspaceId: "workspace-acme",
      body: {
        id: "acme-project",
        name: "Acme Project",
        repository: {
          provider: "local-git",
          root: process.cwd(),
          defaultBranch: "main"
        }
      }
    });
    assert.equal(acmeProject.status, 201);
    assert.equal(acmeProject.body.data.tenantId, "tenant-acme");
    assert.equal(acmeProject.body.data.workspaceId, "workspace-acme");

    const acmeLoop = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      actor: "operator",
      tenantId: "tenant-acme",
      workspaceId: "workspace-acme",
      body: {
        id: "acme-loop",
        projectId: "acme-project",
        objective: "Prove acme scoped loop isolation."
      }
    });
    assert.equal(acmeLoop.status, 201);
    assert.equal(acmeLoop.body.data.tenantId, "tenant-acme");
    assert.equal(acmeLoop.body.data.workspaceId, "workspace-acme");

    const acmeReleaseEvidence = await jsonFetch(`${baseUrl}/api/v1/release/evidence`, {
      method: "POST",
      token: "operator-token",
      actor: "operator",
      tenantId: "tenant-acme",
      workspaceId: "workspace-acme",
      body: {
        id: "acme-release-evidence",
        candidate: "acme-release-candidate"
      }
    });
    assert.equal(acmeReleaseEvidence.status, 201);
    assert.equal(acmeReleaseEvidence.body.data.tenantId, "tenant-acme");
    assert.equal(acmeReleaseEvidence.body.data.workspaceId, "workspace-acme");

    const defaultScopedProjects = await jsonFetch(`${baseUrl}/api/v1/projects`, {
      token: "viewer-token"
    });
    assert.equal(defaultScopedProjects.status, 200);
    assert.ok(!defaultScopedProjects.body.data.some((project) => project.id === "acme-project"));

    const defaultScopedLoops = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      token: "viewer-token"
    });
    assert.equal(defaultScopedLoops.status, 200);
    assert.ok(!defaultScopedLoops.body.data.some((loop) => loop.id === "acme-loop"));

    const defaultScopedSecrets = await jsonFetch(`${baseUrl}/api/v1/secrets`, {
      token: "viewer-token"
    });
    assert.equal(defaultScopedSecrets.status, 200);
    assert.ok(!defaultScopedSecrets.body.data.some((secret) => secret.id === "acme-source-token"));
    assert.equal(JSON.stringify(defaultScopedSecrets.body).includes("acme-super-secret-token"), false);

    const defaultScopedGithubApps = await jsonFetch(`${baseUrl}/api/v1/github-app/installations`, {
      token: "viewer-token"
    });
    assert.equal(defaultScopedGithubApps.status, 200);
    assert.ok(!defaultScopedGithubApps.body.data.some((installation) => installation.id === "github-app-67890"));

    const defaultScopedEvidence = await jsonFetch(`${baseUrl}/api/v1/release/evidence`, {
      token: "viewer-token"
    });
    assert.equal(defaultScopedEvidence.status, 200);
    assert.ok(!defaultScopedEvidence.body.data.some((item) => item.id === "acme-release-evidence"));

    const blockedDirectEvidenceRead = await jsonFetch(`${baseUrl}/api/v1/release/evidence/acme-release-evidence`, {
      token: "viewer-token"
    });
    assert.equal(blockedDirectEvidenceRead.status, 403);

    const ownedProject = await jsonFetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "workspace-owned-project",
        name: "Workspace Owned Project",
        repository: {
          provider: "local-git",
          root: process.cwd(),
          defaultBranch: "main"
        }
      }
    });
    assert.equal(ownedProject.status, 201);
    assert.equal(ownedProject.body.data.tenantId, "tenant-production");
    assert.equal(ownedProject.body.data.workspaceId, "workspace-agent-products");

    const movedProject = await jsonFetch(`${baseUrl}/api/v1/projects/workspace-owned-project/ownership`, {
      method: "PATCH",
      token: "admin-token",
      body: {
        tenantId: "tenant-production",
        workspaceId: "isolated-workspace"
      }
    });
    assert.equal(movedProject.status, 200);
    assert.equal(movedProject.body.data.workspaceId, "isolated-workspace");

    const viewerProjects = await jsonFetch(`${baseUrl}/api/v1/projects`, {
      token: "viewer-token"
    });
    assert.equal(viewerProjects.status, 200);
    assert.ok(!viewerProjects.body.data.some((project) => project.id === "workspace-owned-project"));

    const limitedWorkspace = await jsonFetch(`${baseUrl}/api/v1/workspaces`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "limited-workspace",
        name: "Limited Workspace",
        quotas: { projects: 1, loops: 1, evidenceGb: 1 }
      }
    });
    assert.equal(limitedWorkspace.status, 201);
    assert.equal(limitedWorkspace.body.data.quotas.projects, 1);
    assert.equal(limitedWorkspace.body.data.quotas.loops, 1);

    const quotaProject = await jsonFetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "quota-project",
        name: "Quota Project",
        workspaceId: "limited-workspace",
        repository: {
          provider: "local-git",
          root: process.cwd(),
          defaultBranch: "main"
        }
      }
    });
    assert.equal(quotaProject.status, 201);
    assert.equal(quotaProject.body.data.workspaceId, "limited-workspace");

    const blockedQuotaProject = await jsonFetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "quota-project-2",
        name: "Quota Project 2",
        workspaceId: "limited-workspace",
        repository: {
          provider: "local-git",
          root: process.cwd(),
          defaultBranch: "main"
        }
      }
    });
    assert.equal(blockedQuotaProject.status, 429);
    assert.equal(blockedQuotaProject.body.error, "WORKSPACE_PROJECT_QUOTA_EXCEEDED");

    const quotaLoop = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "quota-loop",
        projectId: "quota-project",
        objective: "Prove quota-bound loop creation.",
        workspaceId: "limited-workspace"
      }
    });
    assert.equal(quotaLoop.status, 201);
    assert.equal(quotaLoop.body.data.workspaceId, "limited-workspace");

    const blockedQuotaLoop = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "quota-loop-2",
        projectId: "quota-project",
        objective: "This loop should exceed the workspace quota.",
        workspaceId: "limited-workspace"
      }
    });
    assert.equal(blockedQuotaLoop.status, 429);
    assert.equal(blockedQuotaLoop.body.error, "WORKSPACE_LOOP_QUOTA_EXCEEDED");

    const limitedUsage = await jsonFetch(`${baseUrl}/api/v1/workspaces/limited-workspace/usage`, {
      token: "admin-token"
    });
    assert.equal(limitedUsage.status, 200);
    assert.equal(limitedUsage.body.data.projects.used, 1);
    assert.equal(limitedUsage.body.data.loops.used, 1);
    assert.ok(limitedUsage.body.data.evidence.some((item) => item === "projects=1/1"));

    const saasObservability = await jsonFetch(`${baseUrl}/api/v1/saas/observability`, {
      token: "viewer-token"
    });
    assert.equal(saasObservability.status, 200);
    assert.equal(saasObservability.body.data.schema, "evopilot-saas-observability/v1");
    assert.ok(saasObservability.body.data.tenantCount >= 1);
    assert.ok(saasObservability.body.data.workspaceCount >= 3);
    assert.ok(saasObservability.body.data.secretRefCount >= 3);
    assert.ok(saasObservability.body.data.githubAppReadyCount >= 2);
    assert.equal(saasObservability.body.data.postgresStoreReady, false);
    assert.ok(saasObservability.body.data.blockers.includes("POSTGRES_LOOP_STORE_NOT_CONFIGURED"));

    const metrics = await fetch(`${baseUrl}/api/v1/metrics`, {
      headers: authHeaders("viewer-token")
    });
    assert.equal(metrics.status, 200);
    const metricsText = await metrics.text();
    assert.match(metricsText, /evopilot_saas_workspaces_total \d+/);
    assert.match(metricsText, /evopilot_saas_postgres_store_ready 0/);

    const releaseEvidence = await jsonFetch(`${baseUrl}/api/v1/release/evidence`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "workspace-release-evidence",
        candidate: "workspace-release-candidate"
      }
    });
    assert.equal(releaseEvidence.status, 201);
    assert.equal(releaseEvidence.body.data.tenantId, "tenant-production");
    assert.equal(releaseEvidence.body.data.workspaceId, "workspace-agent-products");
    assert.equal(releaseEvidence.body.data.releaseDecisionId, "decision-workspace-release-evidence");

    const releaseEvidenceList = await jsonFetch(`${baseUrl}/api/v1/release/evidence`, {
      token: "viewer-token"
    });
    assert.equal(releaseEvidenceList.status, 200);
    assert.ok(releaseEvidenceList.body.data.some((item) => item.id === "workspace-release-evidence" && item.tenantId === "tenant-production" && item.workspaceId === "workspace-agent-products"));

    const releaseDecisions = await jsonFetch(`${baseUrl}/api/v1/release/decisions`, {
      token: "viewer-token"
    });
    assert.equal(releaseDecisions.status, 200);
    assert.ok(releaseDecisions.body.data.some((decision) => decision.id === "decision-workspace-release-evidence" && decision.tenantId === "tenant-production" && decision.workspaceId === "workspace-agent-products"));

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
    assert.equal(created.body.data.tenantId, "tenant-production");
    assert.equal(created.body.data.workspaceId, "workspace-agent-products");
    assert.equal(created.body.data.executorGraphId, "product-evolution-dag");
    assert.equal(created.body.data.controlPlaneUrl, "http://8.153.72.80");
    assert.equal(created.body.data.sourceClosure.repositoryProvider, "github");
    assert.equal(created.body.data.sourceClosure.sourceUrl, "https://github.com/example/workbuddy.git");
    assert.equal(created.body.data.sourceClosure.targetVersion, "2.0.0");
    assert.deepEqual(created.body.data.sourceClosure.requiredGates, ["code-change", "push", "tag", "deploy", "health-ready"]);
    assert.equal(created.body.data.sandbox.runtime, "docker");
    assert.equal(created.body.data.sandboxEnforcement.status, "ENFORCED");
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
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "sandbox.enforcement.status=ENFORCED"));
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "sourceClosure.provider=github"));
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "sourceClosure.targetVersion=2.0.0"));
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "sourceClosure.requiredGates=code-change,push,tag,deploy,health-ready"));
    assert.equal(started.body.data.iterations[0].executorSteps[0].input.sourceClosure.repositoryProvider, "github");
    assert.equal(started.body.data.iterations[0].executorSteps[1].output.sourceClosure.releaseStrategy, "github-push");
    assert.equal(started.body.data.iterations[0].executorSteps[0].input.sandbox.runtime, "docker");
    assert.equal(started.body.data.iterations[0].executorSteps[0].input.sandboxEnforcement.status, "ENFORCED");
    assert.equal(started.body.data.trace.executorStepCount, 4);

    const presets = await jsonFetch(`${baseUrl}/api/v1/loop-orchestration/presets`, {
      token: "viewer-token"
    });
    assert.equal(presets.status, 200);
    assert.ok(presets.body.data.some((preset) => preset.id === "source-release-closure"));
    assert.ok(presets.body.data.some((preset) => preset.id === "codex-target-loop"));

    const orchestrated = await jsonFetch(`${baseUrl}/api/v1/loop-orchestration/instantiate`, {
      method: "POST",
      token: "operator-token",
      body: {
        projectId: "workbuddy",
        presetId: "source-release-closure",
        targetVersion: "2.0.1",
        objective: "Create a dashboard-orchestrated source release loop.",
        controlPlaneUrl: baseUrl,
        context: {
          workflowCanvasEditor: {
            routingMode: "fanout-evaluator",
            releaseGate: "deploy-and-rollback",
            humanGate: false,
            visualEditorVersion: "dashboard-workflow-canvas/v1"
          }
        }
      }
    });
    assert.equal(orchestrated.status, 201);
    assert.equal(orchestrated.body.data.context.orchestrationPresetId, "source-release-closure");
    assert.match(orchestrated.body.data.executorGraphId, /^dashboard-workflow-workbuddy-/);
    assert.equal(orchestrated.body.data.context.workflowCanvasEditor.routingMode, "fanout-evaluator");
    assert.equal(orchestrated.body.data.context.workflowCanvasEditor.releaseGate, "deploy-and-rollback");
    assert.equal(orchestrated.body.data.sourceClosure.targetVersion, "2.0.1");
    assert.equal(orchestrated.body.data.sandboxEnforcement.status, "ENFORCED");
    assert.equal(orchestrated.body.data.coordination.mode, "parallel");
    assert.ok(orchestrated.body.data.coordination.nodes.some((node) => node.dependsOn.some((dependency) => dependency.includes("fan-in"))));
    assert.ok(orchestrated.body.data.coordination.nodes.some((node) => node.nodeId === "release" && node.dependsOn.some((dependency) => dependency.includes("conditional"))));

    const orchestratedGraph = await jsonFetch(`${baseUrl}/api/v1/loops/${encodeURIComponent(orchestrated.body.data.id)}/executor-graph`, {
      token: "viewer-token"
    });
    assert.equal(orchestratedGraph.status, 200);
    assert.equal(orchestratedGraph.body.data.loopId, orchestrated.body.data.id);
    assert.equal(orchestratedGraph.body.data.executorGraph.validation.status, "PASSED");
    assert.equal(orchestratedGraph.body.data.executorGraph.capabilities.conditionalRouting, true);
    assert.equal(orchestratedGraph.body.data.executorGraph.capabilities.fanOutFanIn, true);
    assert.equal(orchestratedGraph.body.data.executorGraph.capabilities.nestedSubgraphs, true);
    assert.equal(orchestratedGraph.body.data.executorGraph.capabilities.schemaValidation, true);
    assert.ok(orchestratedGraph.body.data.evidence.some((item) => item === "typedEdges=true"));

    const orchestratedEvents = await jsonFetch(`${baseUrl}/api/v1/loops/${encodeURIComponent(orchestrated.body.data.id)}/events`, {
      token: "viewer-token"
    });
    assert.equal(orchestratedEvents.status, 200);
    const graphEvent = orchestratedEvents.body.data.find((event) => event.type === "executor-graph");
    assert.ok(graphEvent);
    assert.equal(graphEvent.payload.validation.status, "PASSED");
    assert.ok(graphEvent.payload.edges.some((edge) => edge.type === "fan-out"));
    assert.ok(graphEvent.payload.evidence.some((item) => item === "schemaValidation=true"));

    const startedOrchestrated = await jsonFetch(`${baseUrl}/api/v1/loops/${encodeURIComponent(orchestrated.body.data.id)}/start`, {
      method: "POST",
      token: "operator-token",
      body: { decision: "CONTINUE" }
    });
    assert.equal(startedOrchestrated.status, 200);
    assert.equal(startedOrchestrated.body.data.iterations.at(-1).executorSteps[0].input.adapterId, "evopilot.target-contract-adapter");
    assert.ok(startedOrchestrated.body.data.iterations.at(-1).executorSteps.some((step) => step.input.adapterId === "evopilot.discovery-runtime-adapter"));
    assert.ok(startedOrchestrated.body.data.iterations.at(-1).executorSteps.some((step) => step.input.adapterId === "evopilot.adversarial-evaluator-adapter"));
    assert.ok(startedOrchestrated.body.data.iterations.at(-1).executorSteps.some((step) => step.input.adapterId === "evopilot.source-release-adapter"));

    const targets = await jsonFetch(`${baseUrl}/api/v1/loop-orchestration/targets`, {
      token: "viewer-token"
    });
    assert.equal(targets.status, 200);
    assert.ok(targets.body.data.some((target) => target.id === "codex-loop-target-autopilot"));
    assert.ok(targets.body.data.some((target) => target.layer === "sandbox"));
    assert.ok(targets.body.data.every((target) => Array.isArray(target.acceptanceCriteria)));
    for (const id of [
      "discovery-skill-runtime",
      "per-finding-worktree-handoff",
      "adversarial-evaluator-agent",
      "recurring-loop-scheduler",
      "loop-memory-inbox",
      "budget-and-judgment-guardrails",
      "tenant-workspace-model",
      "workspace-rbac-and-invitation",
      "github-app-onboarding",
      "secret-vault-and-credential-boundary",
      "project-workspace-ownership",
      "quota-rate-limit-billing-foundation",
      "worker-queue-and-postgres-store",
      "tenant-aware-release-evidence",
      "multi-tenant-security-regression-suite",
      "saas-production-observability",
      "saas-onboarding-dashboard",
      "saas-field-e2e-source-to-ga",
      "saas-release-matrix",
      "saas-ga-soak-active",
      "saas-ga-release-decision",
      "announce-saas-multi-tenant-ga-stable"
    ]) {
      const target = targets.body.data.find((item) => item.id === id);
      assert.ok(target, `${id} should be exposed as a target-loop backlog item`);
      assert.equal(target.presetId, "codex-target-loop");
      assert.ok(target.acceptanceCriteria.length >= 3);
      assert.equal(target.status, "PENDING");
      assert.equal(target.nextAction, "create-loop");
    }

    const advanced = await jsonFetch(`${baseUrl}/api/v1/loop-orchestration/advance`, {
      method: "POST",
      token: "operator-token",
      body: {
        targetId: "codex-loop-target-autopilot",
        projectId: "workbuddy",
        targetVersion: "2.0.2",
        controlPlaneUrl: baseUrl,
        autoStart: true
      }
    });
    assert.equal(advanced.status, 201);
    assert.equal(advanced.body.data.schema, "evopilot-loop-orchestration-advance/v1");
    assert.equal(advanced.body.data.target.id, "codex-loop-target-autopilot");
    assert.equal(advanced.body.data.target.status, "RUNNING");
    assert.equal(advanced.body.data.action, "start-loop");
    assert.equal(advanced.body.data.loop.context.codexLoopTarget, true);
    assert.equal(advanced.body.data.loop.context.orchestrationTargetId, "codex-loop-target-autopilot");
    assert.equal(advanced.body.data.loop.sourceClosure.targetVersion, "2.0.2");
    assert.equal(advanced.body.data.loop.currentIteration, 1);
    assert.ok(advanced.body.data.evidence.some((item) => item === "target=codex-loop-target-autopilot"));
    assert.ok(advanced.body.data.loop.evidenceSets[0].evidence.some((item) => item === "codexLoopTarget=true"));

    const advancedAgain = await jsonFetch(`${baseUrl}/api/v1/loop-orchestration/advance`, {
      method: "POST",
      token: "operator-token",
      body: {
        targetId: "codex-loop-target-autopilot",
        projectId: "workbuddy",
        autoStart: true
      }
    });
    assert.equal(advancedAgain.status, 201);
    assert.equal(advancedAgain.body.data.loop.id, advanced.body.data.loop.id);
    assert.equal(advancedAgain.body.data.action, "resume-loop");
    assert.equal(advancedAgain.body.data.loop.currentIteration, 2);

    const tenantWorkspaceAdvanced = await jsonFetch(`${baseUrl}/api/v1/loop-orchestration/advance`, {
      method: "POST",
      token: "operator-token",
      body: {
        targetId: "tenant-workspace-model",
        projectId: "workbuddy",
        targetVersion: "saas-tenant-workspace-2026-07-03",
        controlPlaneUrl: baseUrl,
        autoStart: true
      }
    });
    assert.equal(tenantWorkspaceAdvanced.status, 201);
    assert.equal(tenantWorkspaceAdvanced.body.data.target.id, "tenant-workspace-model");
    assert.equal(tenantWorkspaceAdvanced.body.data.target.layer, "context");
    assert.equal(tenantWorkspaceAdvanced.body.data.target.status, "RUNNING");
    assert.equal(tenantWorkspaceAdvanced.body.data.action, "start-loop");
    assert.equal(tenantWorkspaceAdvanced.body.data.loop.context.orchestrationTargetId, "tenant-workspace-model");
    assert.equal(tenantWorkspaceAdvanced.body.data.loop.tenantId, "tenant-production");
    assert.equal(tenantWorkspaceAdvanced.body.data.loop.workspaceId, "workspace-agent-products");
    assert.equal(tenantWorkspaceAdvanced.body.data.loop.sourceClosure.targetVersion, "saas-tenant-workspace-2026-07-03");
    assert.ok(tenantWorkspaceAdvanced.body.data.loop.context.acceptanceCriteria.length >= 3);
    assert.ok(tenantWorkspaceAdvanced.body.data.evidence.some((item) => item === "target=tenant-workspace-model"));
    assert.ok(tenantWorkspaceAdvanced.body.data.target.evidence.some((item) => item === "tenant=tenant-production"));
    assert.ok(tenantWorkspaceAdvanced.body.data.target.evidence.some((item) => item === "workspace=workspace-agent-products"));
    assert.ok(tenantWorkspaceAdvanced.body.data.target.evidence.some((item) => item === "membershipModel=owner,admin,developer,viewer"));

    const discoveryAdvanced = await jsonFetch(`${baseUrl}/api/v1/loop-orchestration/advance`, {
      method: "POST",
      token: "operator-token",
      body: {
        targetId: "discovery-skill-runtime",
        projectId: "workbuddy",
        targetVersion: "2.0.3",
        controlPlaneUrl: baseUrl,
        autoStart: false
      }
    });
    assert.equal(discoveryAdvanced.status, 201);
    assert.equal(discoveryAdvanced.body.data.target.id, "discovery-skill-runtime");
    assert.equal(discoveryAdvanced.body.data.action, "create-loop");
    assert.equal(discoveryAdvanced.body.data.loop.status, "PENDING");
    assert.equal(discoveryAdvanced.body.data.loop.context.orchestrationTargetId, "discovery-skill-runtime");
    assert.equal(discoveryAdvanced.body.data.loop.sourceClosure.targetVersion, "2.0.3");

    const discovered = await jsonFetch(`${baseUrl}/api/v1/loop-target-runtime/discovery/run`, {
      method: "POST",
      token: "operator-token",
      body: {}
    });
    assert.equal(discovered.status, 201);
    assert.ok(discovered.body.data.some((candidate) => candidate.schema === "evopilot-discovery-skill-candidate/v1"));
    assert.ok(discovered.body.data.some((candidate) => candidate.targetId === "discovery-skill-runtime"));
    assert.ok(discovered.body.data.every((candidate) => Array.isArray(candidate.acceptanceCriteria)));

    const handoff = await jsonFetch(`${baseUrl}/api/v1/loop-target-runtime/handoffs`, {
      method: "POST",
      token: "operator-token",
      body: {
        findingId: "finding-discovery-skill-runtime",
        projectId: "workbuddy",
        targetId: "discovery-skill-runtime",
        allowedPaths: ["packages/server/src/index.ts", "tests/functional/loop-runtime.test.mjs"],
        validationCommands: ["npm run check"]
      }
    });
    assert.equal(handoff.status, 201);
    assert.equal(handoff.body.data.schema, "evopilot-finding-worktree-handoff/v1");
    assert.equal(handoff.body.data.targetBranch, "evopilot/finding-discovery-skill-runtime");
    assert.ok(handoff.body.data.validationCommands.includes("npm run check"));

    const adversarial = await jsonFetch(`${baseUrl}/api/v1/loop-target-runtime/adversarial-evaluations`, {
      method: "POST",
      token: "operator-token",
      body: {
        loopId: "workbuddy-long-task",
        targetId: "adversarial-evaluator-agent"
      }
    });
    assert.equal(adversarial.status, 409);
    assert.equal(adversarial.body.data.schema, "evopilot-adversarial-evaluation/v1");
    assert.equal(adversarial.body.data.status, "BLOCK");
    assert.ok(adversarial.body.data.missingEvidence.includes("source-closure-promotion"));

    const schedule = await jsonFetch(`${baseUrl}/api/v1/loop-target-runtime/schedules`, {
      method: "POST",
      token: "operator-token",
      body: {
        projectId: "workbuddy",
        targetId: "recurring-loop-scheduler",
        cadence: "daily",
        maxBudgetUsd: 3,
        triggerRules: ["new-evidence", "release-window-open"]
      }
    });
    assert.equal(schedule.status, 201);
    assert.equal(schedule.body.data.schema, "evopilot-recurring-loop-schedule/v1");
    assert.equal(schedule.body.data.cadence, "daily");
    assert.match(schedule.body.data.idempotencyKey, /recurring:workbuddy:recurring-loop-scheduler:daily/);

    const inbox = await jsonFetch(`${baseUrl}/api/v1/loop-target-runtime/memory-inbox`, {
      token: "viewer-token"
    });
    assert.equal(inbox.status, 200);
    const memoryItem = inbox.body.data.find((item) => item.targetId === "discovery-skill-runtime");
    assert.ok(memoryItem);
    const triaged = await jsonFetch(`${baseUrl}/api/v1/loop-target-runtime/memory-inbox/${memoryItem.id}/triage`, {
      method: "POST",
      token: "operator-token",
      body: { status: "CONVERTED", targetId: "discovery-skill-runtime" }
    });
    assert.equal(triaged.status, 200);
    assert.equal(triaged.body.data.status, "CONVERTED");

    const guardrail = await jsonFetch(`${baseUrl}/api/v1/loop-target-runtime/guardrails/workbuddy-long-task/evaluate`, {
      method: "POST",
      token: "operator-token",
      body: { maxCostUsd: 1, maxTokens: 100000, maxDurationSeconds: 86400, maxChangedFiles: 20, minConfidence: 0.5 }
    });
    assert.equal(guardrail.status, 200);
    assert.equal(guardrail.body.data.schema, "evopilot-budget-judgment-guardrail/v1");
    assert.notEqual(guardrail.body.data.releaseJudgment, "BLOCK");

    const runtimeSummary = await jsonFetch(`${baseUrl}/api/v1/loop-target-runtime/summary`, {
      token: "viewer-token"
    });
    assert.equal(runtimeSummary.status, 200);
    assert.ok(runtimeSummary.body.data.discoveryCandidates.length >= 6);
    assert.ok(runtimeSummary.body.data.findingHandoffs.some((item) => item.id === "handoff-finding-discovery-skill-runtime"));
    assert.ok(runtimeSummary.body.data.adversarialEvaluations.some((item) => item.status === "BLOCK"));
    assert.ok(runtimeSummary.body.data.recurringSchedules.some((item) => item.targetId === "recurring-loop-scheduler"));
    assert.ok(runtimeSummary.body.data.guardrailEvaluations.some((item) => item.loopId === "workbuddy-long-task"));

    const trace = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/trace`, {
      token: "viewer-token"
    });
    assert.equal(trace.status, 200);
    assert.equal(trace.body.data.loopId, "workbuddy-long-task");
    assert.equal(trace.body.data.executorStepCount, 4);

    const sandboxProof = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/sandbox-proof`, {
      token: "viewer-token"
    });
    assert.equal(sandboxProof.status, 200);
    assert.equal(sandboxProof.body.data.schema, "evopilot-loop-sandbox-boundary-proof/v1");
    assert.equal(sandboxProof.body.data.status, "ENFORCED");
    assert.ok(sandboxProof.body.data.executableBoundary.dockerArgs.includes("--read-only"));
    assert.ok(sandboxProof.body.data.checks.some((check) => check.id === "resource-boundary" && check.status === "PASS"));

    const verifiedSandboxProof = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/sandbox-proof/verify`, {
      method: "POST",
      token: "operator-token",
      body: {}
    });
    assert.equal(verifiedSandboxProof.status, 200);
    assert.equal(verifiedSandboxProof.body.data.proof.status, "ENFORCED");
    assert.equal(verifiedSandboxProof.body.data.loop.context.sandboxBoundaryProof.status, "ENFORCED");

    const traceTree = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/trace-tree`, {
      token: "viewer-token"
    });
    assert.equal(traceTree.status, 200);
    assert.equal(traceTree.body.data.schema, "evopilot-loop-trace-tree/v1");
    assert.ok(traceTree.body.data.nodes.some((node) => node.type === "sandbox-proof"));
    assert.ok(traceTree.body.data.nodes.some((node) => node.type === "executor-step"));
    assert.equal(traceTree.body.data.summary.sandboxProofStatus, "ENFORCED");

    const loopEvents = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/events`, {
      token: "viewer-token"
    });
    assert.equal(loopEvents.status, 200);
    assert.ok(loopEvents.body.data.some((event) => event.type === "executor-step"));
    assert.ok(loopEvents.body.data.some((event) => event.type === "sandbox-proof"));

    const eventStream = await fetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/events`, {
      headers: { ...authHeaders("viewer-token"), accept: "text/event-stream" }
    });
    assert.equal(eventStream.status, 200);
    assert.match(eventStream.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.match(await eventStream.text(), /event: sandbox-proof/);

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

    const checkpoints = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/checkpoints`, {
      token: "viewer-token"
    });
    assert.equal(checkpoints.status, 200);
    assert.equal(checkpoints.body.data[0].schema, "evopilot-loop-checkpoint/v1");
    assert.equal(checkpoints.body.data[0].loopId, "workbuddy-long-task");
    assert.ok(checkpoints.body.data[0].replayable);
    assert.ok(Array.isArray(checkpoints.body.data[0].executorOutputs));

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

    const audit = await jsonFetch(`${baseUrl}/api/v1/audit`, {
      token: "viewer-token"
    });
    assert.equal(audit.status, 200);
    assert.ok(audit.body.data.some((record) => record.action === "workspace.invitation.created" && record.tenantId === "tenant-production" && record.workspaceId === "workspace-agent-products"));
    assert.ok(audit.body.data.some((record) => record.action === "workspace.member.updated" && record.metadata.memberId === "developer-example.com"));
    assert.ok(audit.body.data.some((record) => record.action === "project.ownership.updated" && record.metadata.workspaceId === "isolated-workspace"));
    assert.ok(audit.body.data.some((record) => record.action === "secret.created" && record.metadata.kind === "github-app-private-key"));
    assert.ok(audit.body.data.some((record) => record.action === "github-app.installation.upserted" && record.metadata.status === "READY"));

    const timeTravelReplay = await jsonFetch(`${baseUrl}/api/v1/loops/workbuddy-long-task/time-travel/replay`, {
      method: "POST",
      token: "operator-token",
      body: {
        fromIteration: 1,
        contextPatch: { humanWorkbenchEdit: "dashboard checkpoint edit" },
        evidence: ["dashboard time-travel replay"]
      }
    });
    assert.equal(timeTravelReplay.status, 200);
    assert.equal(timeTravelReplay.body.data.replayDiff.schema, "evopilot-loop-replay-diff/v1");
    assert.equal(timeTravelReplay.body.data.replayDiff.fromIteration, 1);
    assert.deepEqual(timeTravelReplay.body.data.replayDiff.contextChangedKeys, ["humanWorkbenchEdit"]);
    assert.equal(timeTravelReplay.body.data.loop.context.humanWorkbenchEdit, "dashboard checkpoint edit");

    const queuedLoop = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "queue-claim-loop",
        objective: "Prove durable worker queue claim.",
        stopPolicy: { maxIterations: 3, requireApprovalForRelease: false }
      }
    });
    assert.equal(queuedLoop.status, 201);
    const queue = await jsonFetch(`${baseUrl}/api/v1/loop-workers/queue`, {
      token: "viewer-token"
    });
    assert.equal(queue.status, 200);
    assert.ok(queue.body.data.some((item) => item.loopId === "queue-claim-loop" && item.claimable));
    const claimed = await jsonFetch(`${baseUrl}/api/v1/loop-workers/claim`, {
      method: "POST",
      token: "operator-token",
      body: { loopId: "queue-claim-loop", workerId: "worker-claim-a", leaseSeconds: 30 }
    });
    assert.equal(claimed.status, 201);
    assert.equal(claimed.body.data.schema, "evopilot-loop-worker-claim/v1");
    assert.equal(claimed.body.data.claimed.loopId, "queue-claim-loop");
    assert.equal(claimed.body.data.claimed.workerLease.workerId, "worker-claim-a");
    assert.equal(claimed.body.data.claimed.sideEffectGuard.duplicateSourceClosureBlocked, false);

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

test("loop store readiness verifies Postgres TCP reachability", async () => {
  const previousBackend = process.env.EVOPILOT_LOOP_STORE_BACKEND;
  const previousDsn = process.env.EVOPILOT_LOOP_STORE_DSN;
  const pgProbe = net.createServer((socket) => socket.end());
  await new Promise((resolve) => pgProbe.listen(0, "127.0.0.1", resolve));
  const pgAddress = pgProbe.address();
  process.env.EVOPILOT_LOOP_STORE_BACKEND = "postgres";
  process.env.EVOPILOT_LOOP_STORE_DSN = `postgres://evopilot:secret@127.0.0.1:${pgAddress.port}/evopilot`;

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-loop-store-postgres-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "viewer", token: "viewer-token", role: "viewer" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const storeReadiness = await jsonFetch(`${baseUrl}/api/v1/loop-store/readiness`, {
      token: "viewer-token"
    });
    assert.equal(storeReadiness.status, 200);
    assert.equal(storeReadiness.body.data.status, "READY");
    assert.equal(storeReadiness.body.data.backend, "postgres");
    assert.equal(storeReadiness.body.data.postgresConfigured, true);
    assert.equal(storeReadiness.body.data.postgresReachable, true);
    assert.deepEqual(storeReadiness.body.data.blockers, []);
    assert.ok(storeReadiness.body.data.evidence.includes("postgresReachable=true"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => pgProbe.close(resolve));
    if (previousBackend === undefined) delete process.env.EVOPILOT_LOOP_STORE_BACKEND;
    else process.env.EVOPILOT_LOOP_STORE_BACKEND = previousBackend;
    if (previousDsn === undefined) delete process.env.EVOPILOT_LOOP_STORE_DSN;
    else process.env.EVOPILOT_LOOP_STORE_DSN = previousDsn;
  }
});

test("production loop llm executor calls real llm client and records usage", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-loop-real-llm-"));
  const previousPrice = process.env.EVOPILOT_LLM_COST_PER_1K_TOKENS_USD;
  process.env.EVOPILOT_LLM_COST_PER_1K_TOKENS_USD = "0.002";
  let callCount = 0;
  let capturedPrompt = "";
  const server = createServer({
    dataRoot,
    runtimeMode: "prod",
    requireLlm: true,
    llmClient: {
      async generate(request) {
        callCount += 1;
        capturedPrompt = request.prompt;
        return {
          requestId: request.requestId ?? "loop-llm-request",
          success: true,
          text: "# Plan\n\nUse tenant and workspace scoped contracts.",
          provider: "zhipu",
          model: "glm-5.1",
          durationMs: 5,
          usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
          resolvedIntent: request.intent,
          resolvedProfile: "deep-reasoning"
        };
      }
    },
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "viewer", token: "viewer-token", role: "viewer" }
    ]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const created = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "tenant-workspace-real-llm",
        projectId: "evopilot-github",
        objective: "Define tenant and workspace model for EvoPilot SaaS.",
        sourceClosure: {
          sourceProjectId: "evopilot-github",
          repositoryProvider: "github",
          sourceUrl: "https://github.com/yeliang-wang/evopilot.git",
          sourceBranch: "main",
          targetVersion: "saas-tenant-workspace",
          releaseStrategy: "github-push"
        }
      }
    });
    assert.equal(created.status, 201);
    const started = await jsonFetch(`${baseUrl}/api/v1/loops/tenant-workspace-real-llm/start`, {
      method: "POST",
      token: "operator-token"
    });
    assert.equal(started.status, 200);
    assert.equal(callCount, 1);
    assert.match(capturedPrompt, /Define tenant and workspace model/);
    const llmStep = started.body.data.iterations[0].executorSteps.find((step) => step.type === "llm");
    assert.equal(llmStep.status, "SUCCEEDED");
    assert.equal(llmStep.output.provider, "zhipu");
    assert.equal(llmStep.output.model, "glm-5.1");
    assert.equal(llmStep.output.totalTokens, 1500);
    assert.equal(llmStep.output.costUsd, 0.003);
    assert.equal(started.body.data.trace.totalTokens, undefined);
    assert.deepEqual(started.body.data.trace.cost, { estimatedUsd: 0.003, totalTokens: 1500 });
    assert.equal(started.body.data.trace.llmUsage.schema, "evopilot-llm-usage-summary/v1");
    assert.equal(started.body.data.trace.llmUsage.provider, "zhipu");
    assert.equal(started.body.data.trace.llmUsage.model, "glm-5.1");
    assert.equal(started.body.data.trace.llmUsage.totalTokens, 1500);
    assert.equal(started.body.data.trace.llmUsage.inputTokens, 1000);
    assert.equal(started.body.data.trace.llmUsage.outputTokens, 500);
    assert.ok(started.body.data.trace.llmUsage.steps.some((step) => step.nodeId === llmStep.nodeId && step.totalTokens === 1500));
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "llm.executionMode=provider"));
    assert.ok(started.body.data.evidenceSets[0].evidence.some((item) => item === "llm.provider=zhipu"));
  } finally {
    if (previousPrice === undefined) delete process.env.EVOPILOT_LLM_COST_PER_1K_TOKENS_USD;
    else process.env.EVOPILOT_LLM_COST_PER_1K_TOKENS_USD = previousPrice;
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
    assert.equal(executed.body.data.sourceReleaseRun.schema, "evopilot-source-release-closure-run/v1");
    assert.equal(executed.body.data.sourceReleaseRun.status, "PROMOTED");
    assert.equal(executed.body.data.sourceReleaseRun.nextAction, "approve-review");
    assert.equal(executed.body.data.sourceReleaseRun.review.status, "PENDING");
    assert.ok(executed.body.data.sourceReleaseRun.capabilities.includes("auditable-release-run"));
    assert.ok(executed.body.data.sourceReleaseRun.capabilities.includes("review-approval"));
    assert.ok(executed.body.data.evidenceSets.some((set) => set.validator === "evopilot-source-closure"));
    const approved = await jsonFetch(`${baseUrl}/api/v1/loops/github-source-loop/source-closure/review-decision`, {
      method: "POST",
      token: "admin-token",
      body: { action: "approve" }
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.sourceReleaseRun.review.status, "APPROVED");
    assert.equal(approved.body.data.sourceReleaseRun.nextAction, "merge-review");
    assert.equal(approved.body.data.sourceReleaseRun.policy.status, "PASS");
    assert.equal(approved.body.data.sourceReleaseRun.policy.autoMerge, false);
    const merged = await jsonFetch(`${baseUrl}/api/v1/loops/github-source-loop/source-closure/review-decision`, {
      method: "POST",
      token: "admin-token",
      body: { action: "merge", postMergeDeploy: true }
    });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.data.sourceReleaseRun.review.status, "MERGED");
    assert.equal(merged.body.data.sourceReleaseRun.policy.status, "PASS");
    assert.equal(merged.body.data.sourceReleaseRun.review.mergeCommitSha, "github-merge-sha");
    assert.equal(merged.body.data.sourceReleaseRun.postMergeDeployment.status, "SUCCEEDED");
    assert.equal(merged.body.data.sourceClosure.artifacts.mergeCommitSha, "github-merge-sha");
    assert.equal(merged.body.data.sourceClosure.artifacts.postMergeDeployStatus, "SUCCEEDED");
    assert.equal(merged.body.data.sourceReleaseRun.nextAction, "promoted");
    const runs = await jsonFetch(`${baseUrl}/api/v1/loops/github-source-loop/source-release-runs`, {
      token: "operator-token"
    });
    assert.equal(runs.status, 200);
    assert.equal(runs.body.data.at(-1).id, executed.body.data.sourceReleaseRun.id);

    const autopilot = await jsonFetch(`${baseUrl}/api/v1/loop-orchestration/autopilot`, {
      method: "POST",
      token: "admin-token",
      body: {
        targetId: "codex-loop-target-autopilot",
        projectId: "github-source",
        targetVersion: "2.2.0",
        deployConnectorId: "prod-webhook",
        controlPlaneUrl: baseUrl,
        approveHumanGate: true,
        autoMerge: true,
        postMergeDeploy: true,
        maxSteps: 8
      }
    });
    assert.equal(autopilot.status, 200);
    assert.equal(autopilot.body.data.schema, "evopilot-loop-orchestration-autopilot/v1");
    assert.equal(autopilot.body.data.status, "SUCCEEDED");
    assert.equal(autopilot.body.data.nextAction, "done");
    assert.equal(autopilot.body.data.target.id, "codex-loop-target-autopilot");
    assert.equal(autopilot.body.data.loop.status, "SUCCEEDED");
    assert.equal(autopilot.body.data.loop.sourceClosure.closureState, "PROMOTED");
    assert.equal(autopilot.body.data.releaseRun.review.status, "MERGED");
    assert.equal(autopilot.body.data.releaseRun.policy.status, "PASS");
    assert.equal(autopilot.body.data.releaseRun.postMergeDeployment.status, "SUCCEEDED");
    assert.ok(autopilot.body.data.stages.some((stage) => stage.id === "safe-auto-merge" && stage.status === "SUCCEEDED"));

    const blockedLoop = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "github-policy-blocked-loop",
        projectId: "github-source",
        objective: "Block unsafe release merge when policy gates are incomplete.",
        controlPlaneUrl: baseUrl,
        sourceClosure: {
          sourceProjectId: "github-source",
          repositoryProvider: "github",
          sourceBranch: "main",
          targetVersion: "2.0.1",
          requiredGates: ["code-change", "push"]
        }
      }
    });
    assert.equal(blockedLoop.status, 201);
    const blockedExecuted = await jsonFetch(`${baseUrl}/api/v1/loops/github-policy-blocked-loop/source-closure/execute`, {
      method: "POST",
      token: "admin-token",
      body: { files: [] }
    });
    assert.equal(blockedExecuted.status, 200);
    assert.equal(blockedExecuted.body.data.sourceReleaseRun.review.status, "PENDING");
    const blockedApproved = await jsonFetch(`${baseUrl}/api/v1/loops/github-policy-blocked-loop/source-closure/review-decision`, {
      method: "POST",
      token: "admin-token",
      body: { action: "approve" }
    });
    assert.equal(blockedApproved.status, 200);
    const blockedMerge = await jsonFetch(`${baseUrl}/api/v1/loops/github-policy-blocked-loop/source-closure/review-decision`, {
      method: "POST",
      token: "admin-token",
      body: { action: "merge" }
    });
    assert.equal(blockedMerge.status, 409);
    assert.equal(blockedMerge.body.error, "SOURCE_CLOSURE_RELEASE_POLICY_BLOCKED");
    const blockedPlan = await jsonFetch(`${baseUrl}/api/v1/loops/github-policy-blocked-loop/source-closure/plan`, {
      token: "operator-token"
    });
    assert.equal(blockedPlan.status, 200);
    assert.equal(blockedPlan.body.data.policy.status, "BLOCKED");
    assert.equal(blockedPlan.body.data.nextAction, "policy-review");
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
if [ "$1" = "stash" ] && [ "$2" = "push" ]; then
  echo "Saved working directory and index state"
  exit 0
fi
if [ "$1" = "stash" ] && [ "$2" = "pop" ]; then
  echo "restored"
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
        preserveLocalPaths: ["Dockerfile"],
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
    assert.ok(executed.body.data.sourceClosure.gateEvidence.deploy.evidence.some((item) => item === "preserveLocalPaths=Dockerfile"));
    assert.ok(executed.body.data.sourceClosure.gateEvidence.deploy.evidence.some((item) => item === "preserveLocalPathsRestored=true"));
    assert.equal(executed.body.data.sourceClosure.gateEvidence["health-ready"].status, "PASSED");
    assert.match(fs.readFileSync(gitLog, "utf8"), /stash push --include-untracked -m evopilot-preserve-ecs-compose -- Dockerfile\npull --ff-only origin main\nstash pop/);
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

test("GitHub source closure reuses an existing open pull request when create returns 422", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-github-pr-reuse-"));
  const github = createExistingPullRequestGitHubServer();
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
  await listen(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const project = await jsonFetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "github-pr-reuse-source",
        name: "GitHub PR Reuse Source",
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

    const created = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "github-pr-reuse-loop",
        projectId: "github-pr-reuse-source",
        objective: "Reuse an already-open source closure PR.",
        controlPlaneUrl: baseUrl,
        sourceClosure: {
          sourceProjectId: "github-pr-reuse-source",
          repositoryProvider: "github",
          sourceBranch: "main",
          targetVersion: "2.5.0",
          requiredGates: ["code-change", "push"]
        }
      }
    });
    assert.equal(created.status, 201);

    const executed = await jsonFetch(`${baseUrl}/api/v1/loops/github-pr-reuse-loop/source-closure/execute`, {
      method: "POST",
      token: "admin-token",
      body: {
        files: [{ path: "docs/source-closure.md", content: "reuse existing PR" }]
      }
    });
    assert.equal(executed.status, 200);
    assert.equal(executed.body.data.sourceClosure.closureState, "PROMOTED");
    assert.equal(executed.body.data.sourceClosure.artifacts.pullRequestNumber, 9);
    assert.equal(executed.body.data.sourceClosure.artifacts.pullRequestUrl, "http://github/pr/9");
    assert.ok(executed.body.data.evidenceSets.at(-1).evidence.some((item) => item === "github.pullRequestReused=true"));
    assert.ok(executed.body.data.evidenceSets.at(-1).evidence.some((item) => item.includes("GitHub request failed: 422")));
  } finally {
    await close(server);
    await close(github);
  }
});

test("Source release run repair re-executes stale failed GitHub closure and reuses existing PR", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-source-release-repair-"));
  const github = createRepairablePullRequestGitHubServer();
  await listen(github.server);
  const githubPort = github.server.address().port;
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "admin", token: "admin-token", role: "admin" }
    ]
  });
  await listen(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const project = await jsonFetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "github-repair-source",
        name: "GitHub Repair Source",
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

    const created = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "github-repair-loop",
        projectId: "github-repair-source",
        objective: "Repair stale failed source release run.",
        controlPlaneUrl: baseUrl,
        sourceClosure: {
          sourceProjectId: "github-repair-source",
          repositoryProvider: "github",
          sourceBranch: "main",
          targetVersion: "2.6.0",
          requiredGates: ["code-change", "push"]
        }
      }
    });
    assert.equal(created.status, 201);

    const failed = await jsonFetch(`${baseUrl}/api/v1/loops/github-repair-loop/source-closure/execute`, {
      method: "POST",
      token: "admin-token",
      body: {
        files: [{ path: "docs/source-closure.md", content: "initial stale failure" }]
      }
    });
    assert.equal(failed.status, 200);
    assert.equal(failed.body.data.sourceClosure.closureState, "FAILED");
    assert.equal(failed.body.data.sourceReleaseRun.status, "FAILED");
    assert.ok(failed.body.data.evidenceSets.at(-1).evidence.some((item) => item.includes("GitHub request failed: 422")));

    const candidates = await jsonFetch(`${baseUrl}/api/v1/source-release-runs/repair-candidates`, {
      token: "operator-token"
    });
    assert.equal(candidates.status, 200);
    assert.equal(candidates.body.data.length, 1);
    assert.equal(candidates.body.data[0].runId, failed.body.data.sourceReleaseRun.id);
    assert.equal(candidates.body.data[0].suggestedAction, "repair-source-closure");
    assert.equal(candidates.body.data[0].repaired, false);

    github.allowReuse = true;
    const repaired = await jsonFetch(`${baseUrl}/api/v1/loops/github-repair-loop/source-release-runs/${encodeURIComponent(failed.body.data.sourceReleaseRun.id)}/repair`, {
      method: "POST",
      token: "admin-token",
      body: {
        files: [{ path: "docs/source-closure.md", content: "repair stale failure" }]
      }
    });
    assert.equal(repaired.status, 200);
    assert.equal(repaired.body.data.originalReleaseRun.id, failed.body.data.sourceReleaseRun.id);
    assert.equal(repaired.body.data.action, "repair-and-execute");
    assert.equal(repaired.body.data.loop.sourceClosure.closureState, "PROMOTED");
    assert.equal(repaired.body.data.releaseRun.status, "PROMOTED");
    assert.equal(repaired.body.data.releaseRun.artifacts.pullRequestNumber, 11);
    assert.ok(repaired.body.data.loop.evidenceSets.some((set) => set.validator === "evopilot-source-release-repair"));
    assert.ok(repaired.body.data.loop.evidenceSets.at(-1).evidence.some((item) => item === "github.pullRequestReused=true"));
    assert.ok(repaired.body.data.loop.evidenceSets.at(-1).evidence.some((item) => item.startsWith("sourceClosure.repairOfReleaseRunId=")));

    const remainingCandidates = await jsonFetch(`${baseUrl}/api/v1/source-release-runs/repair-candidates`, {
      token: "operator-token"
    });
    assert.equal(remainingCandidates.status, 200);
    assert.equal(remainingCandidates.body.data.some((candidate) => candidate.runId === failed.body.data.sourceReleaseRun.id), false);
  } finally {
    await close(server);
    await close(github.server);
  }
});

test("Source release run repair queue repairs discovered stale candidates", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-source-release-repair-queue-"));
  const github = createRepairablePullRequestGitHubServer();
  await listen(github.server);
  const githubPort = github.server.address().port;
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "admin", token: "admin-token", role: "admin" }
    ]
  });
  await listen(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await jsonFetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      token: "admin-token",
      body: {
        id: "github-repair-queue-source",
        name: "GitHub Repair Queue Source",
        repository: {
          provider: "github",
          baseUrl: `http://127.0.0.1:${githubPort}`,
          owner: "org",
          repo: "repo",
          defaultBranch: "main",
          credentials: { token: "token" }
        }
      }
    })).status, 201);

    assert.equal((await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "github-repair-queue-loop",
        projectId: "github-repair-queue-source",
        objective: "Queue repair stale failed source release run.",
        controlPlaneUrl: baseUrl,
        sourceClosure: {
          sourceProjectId: "github-repair-queue-source",
          repositoryProvider: "github",
          sourceBranch: "main",
          targetVersion: "2.6.0",
          requiredGates: ["code-change", "push"]
        }
      }
    })).status, 201);

    const failed = await jsonFetch(`${baseUrl}/api/v1/loops/github-repair-queue-loop/source-closure/execute`, {
      method: "POST",
      token: "admin-token",
      body: {
        files: [{ path: "docs/source-closure.md", content: "queue repair stale failure" }]
      }
    });
    assert.equal(failed.status, 200);
    assert.equal(failed.body.data.sourceReleaseRun.status, "FAILED");

    github.allowReuse = true;
    const queue = await jsonFetch(`${baseUrl}/api/v1/source-release-runs/repair-candidates/repair`, {
      method: "POST",
      token: "admin-token",
      body: {
        runIds: [failed.body.data.sourceReleaseRun.id],
        limit: 1,
        files: [{ path: "docs/source-closure.md", content: "queue repair stale failure" }]
      }
    });
    assert.equal(queue.status, 200);
    assert.equal(queue.body.data.repaired.length, 1);
    assert.equal(queue.body.data.failed.length, 0);
    assert.equal(queue.body.data.repaired[0].runId, failed.body.data.sourceReleaseRun.id);
    assert.equal(queue.body.data.repaired[0].status, "PROMOTED");

    const candidates = await jsonFetch(`${baseUrl}/api/v1/source-release-runs/repair-candidates`, { token: "operator-token" });
    assert.equal(candidates.status, 200);
    assert.equal(candidates.body.data.length, 0);
  } finally {
    await close(server);
    await close(github.server);
  }
});

test("Post-merge deploy finalizer reconciles source release state after server restart", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-source-release-finalizer-"));
  const probe = http.createServer((request, response) => {
    if (request.url === "/health") return json(response, { status: "UP" });
    if (request.url === "/ready") return json(response, { status: "READY" });
    response.writeHead(404);
    response.end();
  });
  await listen(probe);
  const probePort = probe.address().port;
  const firstServer = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "admin", token: "admin-token", role: "admin" }
    ]
  });
  await listen(firstServer);
  const firstBaseUrl = `http://127.0.0.1:${firstServer.address().port}`;
  try {
    const created = await jsonFetch(`${firstBaseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "self-deploy-finalizer-loop",
        projectId: "evopilot",
        objective: "Finalize self deploy after process restart.",
        controlPlaneUrl: `http://127.0.0.1:${probePort}`,
        sourceClosure: {
          sourceProjectId: "evopilot",
          repositoryProvider: "github",
          sourceBranch: "main",
          targetVersion: "2.3.0",
          deploymentConnectorId: "ecs-compose",
          requiredGates: ["deploy", "health-ready"]
        }
      }
    });
    assert.equal(created.status, 201);
  } finally {
    await close(firstServer);
  }

  const now = new Date().toISOString();
  const finalizersDir = path.join(dataRoot, "source-release-deploy-finalizers");
  fs.mkdirSync(finalizersDir, { recursive: true });
  fs.writeFileSync(path.join(finalizersDir, "self-deploy-finalizer-loop-release-run-1.json"), JSON.stringify({
    schema: "evopilot-source-release-deploy-finalizer/v1",
    id: "self-deploy-finalizer-loop-release-run-1",
    loopId: "self-deploy-finalizer-loop",
    releaseRunId: "release-run-1",
    deployConnectorId: "ecs-compose",
    actor: "admin",
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
    artifacts: {
      mergeCommitSha: "merged-sha",
      commitSha: "merged-sha",
      reviewStatus: "MERGED",
      mergedAt: now,
      mergedBy: "admin",
      policyStatus: "PASS",
      policyEvaluatedAt: now,
      deploymentConnectorId: "ecs-compose",
      deploymentId: "self-deploy-1",
      deploymentUrl: `http://127.0.0.1:${probePort}`,
      healthUrl: `http://127.0.0.1:${probePort}/health`,
      readyUrl: `http://127.0.0.1:${probePort}/ready`
    },
    deploymentEnvironment: "production",
    healthUrl: `http://127.0.0.1:${probePort}/health`,
    readyUrl: `http://127.0.0.1:${probePort}/ready`,
    attempts: 0,
    maxAttempts: 3,
    evidence: ["postMergeDeployFinalizer=PENDING", "postMergeDeployConnector=ecs-compose"]
  }, null, 2));

  const secondServer = createServer({
    dataRoot,
    runtimeMode: "debug",
    tokens: [
      { name: "operator", token: "operator-token", role: "operator" },
      { name: "admin", token: "admin-token", role: "admin" }
    ]
  });
  await listen(secondServer);
  const secondBaseUrl = `http://127.0.0.1:${secondServer.address().port}`;
  try {
    const finalizers = await waitFor(async () => {
      const result = await jsonFetch(`${secondBaseUrl}/api/v1/source-release-deploy-finalizers`, { token: "operator-token" });
      assert.equal(result.status, 200);
      const finalizer = result.body.data.find((item) => item.id === "self-deploy-finalizer-loop-release-run-1");
      return finalizer?.status === "SUCCEEDED" ? result : undefined;
    });
    assert.equal(finalizers.body.data.find((item) => item.id === "self-deploy-finalizer-loop-release-run-1").attempts, 1);

    const loop = await jsonFetch(`${secondBaseUrl}/api/v1/loops/self-deploy-finalizer-loop`, { token: "operator-token" });
    assert.equal(loop.status, 200);
    assert.equal(loop.body.data.sourceClosure.closureState, "PROMOTED");
    assert.equal(loop.body.data.sourceClosure.artifacts.postMergeDeployStatus, "SUCCEEDED");
    assert.equal(loop.body.data.sourceClosure.gateEvidence.deploy.status, "PASSED");
    assert.equal(loop.body.data.sourceClosure.gateEvidence["health-ready"].status, "PASSED");
    assert.ok(loop.body.data.evidenceSets.some((set) => set.validator === "evopilot-source-release-deploy-finalizer"));

    const runs = await jsonFetch(`${secondBaseUrl}/api/v1/loops/self-deploy-finalizer-loop/source-release-runs`, { token: "operator-token" });
    assert.equal(runs.status, 200);
    assert.equal(runs.body.data.at(-1).id, "release-run-1");
    assert.equal(runs.body.data.at(-1).status, "PROMOTED");
    assert.equal(runs.body.data.at(-1).postMergeDeployment.status, "SUCCEEDED");
    assert.ok(runs.body.data.at(-1).capabilities.includes("durable-post-merge-deploy-finalizer"));
  } finally {
    await close(secondServer);
    await close(probe);
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

test("ECS Docker Compose deploy connector rolls back after health-ready failure", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-ecs-health-rollback-"));
  const deployRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-ecs-health-rollback-workdir-"));
  const binDir = path.join(deployRoot, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const gitLog = path.join(deployRoot, "git.log");
  const dockerLog = path.join(deployRoot, "docker.log");
  const pulledMarker = path.join(deployRoot, ".pulled");
  const resetMarker = path.join(deployRoot, ".reset");
  const gitScript = path.join(binDir, "git");
  const dockerScript = path.join(binDir, "docker");
  fs.writeFileSync(gitScript, `#!/bin/sh
echo "$@" >> "${gitLog}"
if [ "$1" = "rev-parse" ]; then
  if [ -f "${pulledMarker}" ]; then
    echo "after-health-commit"
  else
    echo "before-health-commit"
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
echo "compose succeeded"
exit 0
`);
  fs.chmodSync(gitScript, 0o755);
  fs.chmodSync(dockerScript, 0o755);

  const github = createFakeSourceClosureGitHubServer();
  const failingProbe = http.createServer((request, response) => {
    if (request.url === "/health" || request.url === "/ready") {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "DOWN" }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await listen(github);
  await listen(failingProbe);
  const githubPort = github.address().port;
  const probePort = failingProbe.address().port;
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
        id: "github-ecs-health-rollback-source",
        name: "GitHub ECS Health Rollback Source",
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
        id: "ecs-compose-health-rollback",
        name: "ECS Docker Compose Health Rollback",
        type: "ecs-docker-compose",
        workingDir: deployRoot,
        composeFile: "docker-compose.prod.yml",
        serviceName: "evopilot-server",
        gitCommand: gitScript,
        dockerCommand: dockerScript,
        gitRemote: "origin",
        gitBranch: "main",
        rollbackOnHealthFailure: true,
        url: `http://127.0.0.1:${probePort}`,
        healthPath: "/health",
        readyPath: "/ready"
      }
    });
    assert.equal(deployConnector.status, 201);
    assert.equal(deployConnector.body.data.rollbackOnHealthFailure, true);

    const created = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "github-ecs-health-rollback-loop",
        projectId: "github-ecs-health-rollback-source",
        objective: "Rollback a deployed ECS Docker Compose service when health-ready fails.",
        controlPlaneUrl: baseUrl,
        sourceClosure: {
          sourceProjectId: "github-ecs-health-rollback-source",
          repositoryProvider: "github",
          sourceBranch: "main",
          targetVersion: "2.4.0",
          deploymentConnectorId: "ecs-compose-health-rollback",
          requiredGates: ["code-change", "push", "deploy", "health-ready"]
        }
      }
    });
    assert.equal(created.status, 201);

    const executed = await jsonFetch(`${baseUrl}/api/v1/loops/github-ecs-health-rollback-loop/source-closure/execute`, {
      method: "POST",
      token: "admin-token",
      body: {
        files: [{ path: "docs/source-closure.md", content: "closed by EvoPilot health rollback connector" }],
        deployConnectorId: "ecs-compose-health-rollback"
      }
    });
    assert.equal(executed.status, 200);
    assert.equal(executed.body.data.sourceClosure.closureState, "ROLLED_BACK");
    assert.equal(executed.body.data.sourceClosure.gateEvidence.deploy.status, "PASSED");
    assert.equal(executed.body.data.sourceClosure.gateEvidence["health-ready"].status, "FAILED");
    assert.ok(executed.body.data.sourceClosure.gateEvidence["health-ready"].evidence.some((item) => item === "rollbackStatus=SUCCEEDED"));
    assert.ok(executed.body.data.sourceClosure.gateEvidence["health-ready"].evidence.some((item) => item === "rollbackTargetCommit=before-health-commit"));
    assert.match(fs.readFileSync(gitLog, "utf8"), /reset --hard before-health-commit/);
    assert.equal(fs.readFileSync(dockerLog, "utf8").trim().split("\n").length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await close(github);
    await close(failingProbe);
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
    assert.equal(executed.body.data.sourceReleaseRun.provider, "gitlab");
    assert.ok(executed.body.data.sourceReleaseRun.capabilities.includes("gitlab-merge-request"));
    const approved = await jsonFetch(`${baseUrl}/api/v1/loops/gitlab-source-loop/source-closure/review-decision`, {
      method: "POST",
      token: "admin-token",
      body: { action: "approve" }
    });
    assert.equal(approved.status, 200);
    const merged = await jsonFetch(`${baseUrl}/api/v1/loops/gitlab-source-loop/source-closure/review-decision`, {
      method: "POST",
      token: "admin-token",
      body: { action: "merge" }
    });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.data.sourceReleaseRun.review.status, "MERGED");
    assert.equal(merged.body.data.sourceReleaseRun.review.mergeCommitSha, "gitlab-merge-sha");
    const plan = await jsonFetch(`${baseUrl}/api/v1/loops/gitlab-source-loop/source-closure/plan`, {
      token: "operator-token"
    });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.data.status, "PROMOTED");
    assert.equal(plan.body.data.review.status, "MERGED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await close(gitlab);
  }
});

test("Loop source closure executes local-git source writeback gates", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-local-source-closure-"));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-local-source-repo-"));
  git(repoRoot, ["init"]);
  git(repoRoot, ["config", "user.name", "Fixture"]);
  git(repoRoot, ["config", "user.email", "fixture@example.com"]);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# fixture\n");
  git(repoRoot, ["add", "README.md"]);
  git(repoRoot, ["commit", "-m", "initial"]);
  const defaultBranch = git(repoRoot, ["branch", "--show-current"]).trim();
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
        id: "local-source",
        name: "Local Source",
        repository: {
          provider: "local-git",
          root: repoRoot,
          defaultBranch
        }
      }
    });
    assert.equal(project.status, 201);
    assert.equal(project.body.data.validation.status, "VERIFIED");

    const created = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "local-source-loop",
        projectId: "local-source",
        objective: "Close local source release evidence.",
        controlPlaneUrl: baseUrl,
        sourceClosure: {
          sourceProjectId: "local-source",
          repositoryProvider: "local-git",
          sourceBranch: defaultBranch,
          targetVersion: "2.2.0",
          requiredGates: ["code-change", "push", "tag"]
        }
      }
    });
    assert.equal(created.status, 201);

    const executed = await jsonFetch(`${baseUrl}/api/v1/loops/local-source-loop/source-closure/execute`, {
      method: "POST",
      token: "admin-token",
      body: {
        files: [{ path: "docs/source-closure.md", content: "closed by local EvoPilot" }],
        tagName: "v2.2.0"
      }
    });
    assert.equal(executed.status, 200);
    assert.equal(executed.body.data.sourceClosure.closureState, "PROMOTED");
    assert.equal(executed.body.data.sourceClosure.artifacts.branch, "evopilot/local-source-loop-2.2.0");
    assert.equal(executed.body.data.sourceClosure.artifacts.tag, "v2.2.0");
    assert.equal(executed.body.data.sourceClosure.gateEvidence.push.status, "PASSED");
    assert.equal(executed.body.data.sourceReleaseRun.provider, "local-git");
    assert.ok(executed.body.data.sourceReleaseRun.capabilities.includes("local-git-commit"));
    assert.equal(fs.readFileSync(path.join(repoRoot, "docs", "source-closure.md"), "utf8"), "closed by local EvoPilot");
    assert.equal(git(repoRoot, ["tag", "--list", "v2.2.0"]).trim(), "v2.2.0");
    const approved = await jsonFetch(`${baseUrl}/api/v1/loops/local-source-loop/source-closure/review-decision`, {
      method: "POST",
      token: "admin-token",
      body: { action: "approve" }
    });
    assert.equal(approved.status, 200);
    const merged = await jsonFetch(`${baseUrl}/api/v1/loops/local-source-loop/source-closure/review-decision`, {
      method: "POST",
      token: "admin-token",
      body: { action: "merge" }
    });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.data.sourceReleaseRun.review.status, "MERGED");
    assert.match(merged.body.data.sourceReleaseRun.review.mergeCommitSha, /^[0-9a-f]+$/);
    assert.equal(git(repoRoot, ["branch", "--show-current"]).trim(), defaultBranch);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Loop source closure preflight blocks GitHub writeback without credentials", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-source-closure-preflight-"));
  const github = createFakeSourceClosureGitHubServer();
  await listen(github);
  const githubPort = github.address().port;
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
        id: "github-public-source",
        name: "GitHub Public Source",
        repository: {
          provider: "github",
          baseUrl: `http://127.0.0.1:${githubPort}`,
          owner: "org",
          repo: "repo",
          defaultBranch: "main"
        }
      }
    });
    assert.equal(project.status, 201);
    assert.equal(project.body.data.validation.status, "VERIFIED");
    assert.equal(project.body.data.repository.credentialsConfigured, false);

    const loop = await jsonFetch(`${baseUrl}/api/v1/loops`, {
      method: "POST",
      token: "operator-token",
      body: {
        id: "github-preflight-loop",
        projectId: "github-public-source",
        objective: "Preflight source closure before writeback.",
        controlPlaneUrl: baseUrl,
        sourceClosure: {
          sourceProjectId: "github-public-source",
          repositoryProvider: "github",
          sourceBranch: "main",
          targetVersion: "2.4.0",
          requiredGates: ["code-change", "push", "deploy", "health-ready"]
        }
      }
    });
    assert.equal(loop.status, 201);

    const preflight = await jsonFetch(`${baseUrl}/api/v1/loops/github-preflight-loop/source-closure/preflight`, {
      method: "POST",
      token: "operator-token"
    });
    assert.equal(preflight.status, 409);
    assert.equal(preflight.body.data.schema, "evopilot-source-closure-preflight/v1");
    assert.equal(preflight.body.data.status, "FAIL");
    assert.equal(preflight.body.data.nextAction, "repair-credentials");
    assert.ok(preflight.body.data.blockers.some((blocker) => blocker === "credentials:SOURCE_CLOSURE_TOKEN_REQUIRED"));
    assert.ok(preflight.body.data.checks.some((check) => check.id === "credentials" && check.status === "FAIL"));

    const storedLoop = await jsonFetch(`${baseUrl}/api/v1/loops/github-preflight-loop`, { token: "viewer-token" });
    assert.equal(storedLoop.status, 200);
    assert.ok(storedLoop.body.data.evidenceSets.some((set) =>
      set.validator === "evopilot-source-closure-preflight" &&
      set.status === "FAIL" &&
      set.evidence.some((item) => item === "sourceClosure.preflight.blocker=credentials:SOURCE_CLOSURE_TOKEN_REQUIRED")
    ));

    const autopilot = await jsonFetch(`${baseUrl}/api/v1/loop-orchestration/autopilot`, {
      method: "POST",
      token: "admin-token",
      body: {
        targetId: "codex-loop-target-autopilot",
        projectId: "github-public-source",
        targetVersion: "2.4.1",
        controlPlaneUrl: baseUrl,
        approveHumanGate: true,
        autoMerge: true,
        maxSteps: 8
      }
    });
    assert.equal(autopilot.status, 409);
    assert.equal(autopilot.body.data.status, "BLOCKED");
    assert.equal(autopilot.body.data.nextAction, "configure-source-credentials");
    assert.equal(autopilot.body.data.externalBlocker.schema, "evopilot-external-blocker/v1");
    assert.equal(autopilot.body.data.externalBlocker.type, "source-credential");
    assert.equal(autopilot.body.data.externalBlocker.recovery.route, "project-source-credentials");
    assert.ok(autopilot.body.data.stages.some((stage) => stage.id === "source-preflight" && stage.status === "BLOCKED"));
    assert.ok(autopilot.body.data.stages.some((stage) => stage.id === "external-blocker" && stage.status === "BLOCKED"));
    assert.ok(!autopilot.body.data.stages.some((stage) => stage.id === "source-closure"));
    assert.equal(autopilot.body.data.releaseRun, undefined);

    const targets = await jsonFetch(`${baseUrl}/api/v1/loop-orchestration/targets`, { token: "viewer-token" });
    assert.equal(targets.status, 200);
    const codexTarget = targets.body.data.find((target) => target.id === "codex-loop-target-autopilot");
    assert.equal(codexTarget.status, "BLOCKED");
    assert.equal(codexTarget.nextAction, "configure-source-credentials");
    assert.equal(codexTarget.externalBlocker.type, "source-credential");
    assert.ok(codexTarget.evidence.some((item) => item === "externalBlocker.type=source-credential"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await close(github);
  }
});

test("Project source credential control plane separates public read-only from writeback ready", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-source-credential-control-plane-"));
  const github = createFakeSourceClosureGitHubServer();
  await listen(github);
  const githubPort = github.address().port;
  const tokenRef = "EVOPILOT_TEST_GITHUB_WRITE_TOKEN";
  const previousToken = process.env[tokenRef];
  delete process.env[tokenRef];
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
        id: "github-credential-control",
        name: "GitHub Credential Control",
        repository: {
          provider: "github",
          baseUrl: `http://127.0.0.1:${githubPort}`,
          owner: "org",
          repo: "repo",
          defaultBranch: "main"
        }
      }
    });
    assert.equal(project.status, 201);
    assert.equal(project.body.data.validation.status, "VERIFIED");
    assert.equal(project.body.data.repository.credentialsConfigured, false);

    const readOnly = await jsonFetch(`${baseUrl}/api/v1/projects/github-credential-control/source-credentials/preflight`, {
      method: "POST",
      token: "operator-token"
    });
    assert.equal(readOnly.status, 409);
    assert.equal(readOnly.body.data.schema, "evopilot-source-credential-readiness/v1");
    assert.equal(readOnly.body.data.status, "READ_ONLY");
    assert.equal(readOnly.body.data.nextAction, "connect-github-account");
    assert.ok(readOnly.body.data.blockers.includes("token-resolution:SOURCE_CREDENTIAL_TOKEN_REQUIRED"));

    const unresolved = await jsonFetch(`${baseUrl}/api/v1/projects/github-credential-control/source-credentials`, {
      method: "POST",
      token: "admin-token",
      body: { tokenRef }
    });
    assert.equal(unresolved.status, 409);
    assert.equal(unresolved.body.data.project.repository.credentialMode, "tokenRef");
    assert.equal(unresolved.body.data.project.repository.tokenRef, tokenRef);
    assert.equal(unresolved.body.data.project.repository.tokenRefResolved, false);
    assert.equal(unresolved.body.data.readiness.status, "READ_ONLY");
    assert.equal(unresolved.body.data.readiness.nextAction, "connect-github-account");

    process.env[tokenRef] = "write-token";
    const ready = await jsonFetch(`${baseUrl}/api/v1/projects/github-credential-control/source-credentials`, {
      method: "POST",
      token: "admin-token",
      body: { tokenRef }
    });
    assert.equal(ready.status, 200);
    assert.equal(ready.body.data.project.repository.credentialsConfigured, true);
    assert.equal(ready.body.data.project.repository.tokenRefResolved, true);
    assert.equal(ready.body.data.readiness.status, "READY");
    assert.equal(ready.body.data.readiness.nextAction, "write-source");
    assert.ok(ready.body.data.readiness.checks.some((check) => check.id === "writeback-policy" && check.status === "PASS"));
  } finally {
    if (previousToken === undefined) delete process.env[tokenRef];
    else process.env[tokenRef] = previousToken;
    await new Promise((resolve) => server.close(resolve));
    await close(github);
  }
});

test("Loop autopilot persists failed GitHub source closure as release-run evidence", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-autopilot-source-closure-failure-"));
  const github = createFailingSourceClosureGitHubServer();
  await listen(github);
  const githubPort = github.address().port;
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
        id: "github-source-failure",
        name: "GitHub Source Failure",
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

    const autopilot = await jsonFetch(`${baseUrl}/api/v1/loop-orchestration/autopilot`, {
      method: "POST",
      token: "admin-token",
      body: {
        targetId: "codex-loop-target-autopilot",
        projectId: "github-source-failure",
        targetVersion: "2.3.0",
        controlPlaneUrl: baseUrl,
        approveHumanGate: true,
        autoMerge: true,
        maxSteps: 8
      }
    });
    assert.equal(autopilot.status, 409);
    assert.equal(autopilot.body.data.status, "FAILED");
    assert.equal(autopilot.body.data.nextAction, "source-closure");
    assert.equal(autopilot.body.data.loop.status, "SUCCEEDED");
    assert.equal(autopilot.body.data.loop.sourceClosure.closureState, "FAILED");
    assert.equal(autopilot.body.data.releaseRun.status, "FAILED");
    assert.equal(autopilot.body.data.releaseRun.nextAction, "failed");
    assert.ok(autopilot.body.data.releaseRun.stages.some((stage) => stage.gate === "code-change" && stage.status === "FAILED"));
    assert.ok(autopilot.body.data.stages.some((stage) => stage.id === "source-closure" && stage.status === "FAILED"));
    assert.ok(autopilot.body.data.stages.some((stage) => stage.evidence.some((item) => item.includes("GitHub request failed: 422"))));
    assert.ok(!autopilot.body.data.stages.some((stage) => stage.id === "safe-auto-merge"));

    const runs = await jsonFetch(`${baseUrl}/api/v1/loops/${encodeURIComponent(autopilot.body.data.loop.id)}/source-release-runs`, {
      token: "viewer-token"
    });
    assert.equal(runs.status, 200);
    assert.equal(runs.body.data.at(-1).status, "FAILED");
    assert.equal(runs.body.data.at(-1).id, autopilot.body.data.releaseRun.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await close(github);
  }
});

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...authHeaders(options.token, Boolean(options.body), options),
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
    if ((request.url === "/repos/org/repo/contents/docs/source-closure.md" || request.url?.startsWith("/repos/org/repo/contents/.evopilot/source-closures/")) && request.method === "PUT") {
      return json(response, { commit: { sha: "github-commit-sha" }, content: { html_url: "http://github/blob/docs/source-closure.md" } });
    }
    if (request.url === "/repos/org/repo/pulls" && request.method === "POST") {
      return json(response, { number: 3, html_url: "http://github/pr/3" });
    }
    if (request.url === "/repos/org/repo/pulls/3/merge" && request.method === "PUT") {
      return json(response, { sha: "github-merge-sha", merged: true, message: "Pull Request successfully merged" });
    }
    response.writeHead(404);
    response.end();
  });
}

function createExistingPullRequestGitHubServer() {
  return http.createServer(async (request, response) => {
    if (request.url === "/repos/org/repo/git/trees/main?recursive=1") {
      return json(response, { tree: [{ type: "blob", path: "README.md" }] });
    }
    if (request.url === "/repos/org/repo/git/ref/heads%2Fmain" && request.method === "GET") {
      return json(response, { ref: "refs/heads/main", object: { sha: "base-sha" } });
    }
    if (request.url === "/repos/org/repo/git/refs" && request.method === "POST") {
      return json(response, { message: "Reference already exists" }, 422);
    }
    if (request.url === "/repos/org/repo/contents/docs/source-closure.md" && request.method === "PUT") {
      return json(response, { commit: { sha: "github-reuse-commit-sha" }, content: { html_url: "http://github/blob/docs/source-closure.md" } });
    }
    if (request.url === "/repos/org/repo/pulls" && request.method === "POST") {
      return json(response, { message: "Validation Failed", errors: [{ resource: "PullRequest", code: "custom", message: "A pull request already exists" }] }, 422);
    }
    if (request.url === "/repos/org/repo/pulls?state=open&head=org%3Aevopilot%2Fgithub-pr-reuse-loop-2.5.0&base=main" && request.method === "GET") {
      return json(response, [{
        number: 9,
        html_url: "http://github/pr/9",
        head: { ref: "evopilot/github-pr-reuse-loop-2.5.0" },
        base: { ref: "main" },
        state: "open"
      }]);
    }
    response.writeHead(404);
    response.end();
  });
}

function createRepairablePullRequestGitHubServer() {
  const fixture = {
    allowReuse: false,
    server: http.createServer(async (request, response) => {
      if (request.url === "/repos/org/repo/git/trees/main?recursive=1") {
        return json(response, { tree: [{ type: "blob", path: "README.md" }] });
      }
      if (request.url === "/repos/org/repo/git/ref/heads%2Fmain" && request.method === "GET") {
        return json(response, { ref: "refs/heads/main", object: { sha: "base-sha" } });
      }
      if (request.url === "/repos/org/repo/git/refs" && request.method === "POST") {
        return json(response, { message: "Reference already exists" }, 422);
      }
      if (request.url === "/repos/org/repo/contents/docs/source-closure.md" && request.method === "PUT") {
        return json(response, { commit: { sha: "github-repair-commit-sha" }, content: { html_url: "http://github/blob/docs/source-closure.md" } });
      }
      if (request.url === "/repos/org/repo/pulls" && request.method === "POST") {
        return json(response, { message: "Validation Failed", errors: [{ resource: "PullRequest", code: "custom", message: "A pull request already exists" }] }, 422);
      }
      if (request.url?.startsWith("/repos/org/repo/pulls?state=open&head=org%3Aevopilot%2Fgithub-repair-") && request.url.endsWith("-2.6.0&base=main") && request.method === "GET") {
        const head = new URL(`http://127.0.0.1${request.url}`).searchParams.get("head")?.split(":").at(-1) ?? "evopilot/github-repair-loop-2.6.0";
        return json(response, fixture.allowReuse ? [{
          number: 11,
          html_url: "http://github/pr/11",
          head: { ref: head },
          base: { ref: "main" },
          state: "open"
        }] : []);
      }
      response.writeHead(404);
      response.end();
    })
  };
  return fixture;
}

function createFailingSourceClosureGitHubServer() {
  return http.createServer(async (request, response) => {
    if (request.url === "/repos/org/repo/git/trees/main?recursive=1") {
      return json(response, { tree: [{ type: "blob", path: "README.md" }] });
    }
    if (request.url === "/repos/org/repo/git/ref/heads%2Fmain" && request.method === "GET") {
      return json(response, { ref: "refs/heads/main", object: { sha: "base-sha" } });
    }
    if (request.url === "/repos/org/repo/git/refs" && request.method === "POST") {
      return json(response, { ref: "refs/heads/evopilot/failing", object: { sha: "base-sha" } });
    }
    if (request.url?.startsWith("/repos/org/repo/contents/.evopilot/source-closures/") && request.method === "PUT") {
      return json(response, { message: "GitHub write rejected by branch protection" }, 422);
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
    if (request.url === "/api/v4/projects/group%2Fproject/merge_requests/7/merge" && request.method === "PUT") {
      return json(response, { id: "mr-7", iid: 7, merge_commit_sha: "gitlab-merge-sha", web_url: "http://gitlab/mr/7" });
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

function json(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function waitFor(probe, timeoutMs = 2000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await probe();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (lastError) throw lastError;
  throw new Error("Timed out waiting for condition.");
}

function authHeaders(token, json = false, scope = {}) {
  return {
    authorization: `Bearer ${token}`,
    ...(scope.actor ? { "x-evopilot-actor": scope.actor } : {}),
    ...(scope.tenantId ? { "x-evopilot-tenant": scope.tenantId } : {}),
    ...(scope.workspaceId ? { "x-evopilot-workspace": scope.workspaceId } : {}),
    ...(json ? { "content-type": "application/json" } : {})
  };
}
