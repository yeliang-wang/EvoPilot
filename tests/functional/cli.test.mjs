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
  assert.match(help, /evopilot project onboard plan/);
  assert.match(help, /evopilot project onboard/);
  assert.match(help, /evopilot project onboard verify/);
  assert.match(help, /evopilot project devops set/);
  assert.match(help, /evopilot project devops preflight/);
  assert.match(help, /evopilot llm profile set/);
  assert.match(help, /evopilot project llm set/);
  assert.match(help, /evopilot maturity standards list/);
  assert.match(help, /evopilot target plan/);
  assert.match(help, /evopilot target plan approve/);
  assert.match(help, /--llm-profile/);
  assert.match(help, /--auto-approve-plan/);
  assert.match(help, /--execution-mode/);
  assert.match(help, /--devops-owner/);
  assert.match(help, /evopilot secret set/);
  assert.match(help, /evopilot github-app installation set/);
  assert.match(help, /evopilot target list/);
  assert.match(help, /evopilot target decision/);
  assert.match(help, /evopilot goal create/);
  assert.match(help, /evopilot target run/);
  assert.match(help, /evopilot goal run/);
  assert.match(help, /evopilot loop list/);
  assert.match(help, /evopilot loop run/);
  assert.match(help, /evopilot release decisions/);
  assert.doesNotMatch(help, /--template/);
  assert.doesNotMatch(help, /target templates/);

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
    const sourceSecret = await runCli([
      "secret", "set",
      "--id", "GITHUB_TOKEN_CLI_AGENT",
      "--kind", "source-token",
      "--value", "github-token",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(sourceSecret.secretRef, "GITHUB_TOKEN_CLI_AGENT");
    assert.equal(sourceSecret.valueConfigured, true);
    assert.equal(Object.hasOwn(sourceSecret, "encryption"), false);

    const secrets = await runCli(["secret", "list", "--config", configPath, "--json"]);
    assert.ok(secrets.some((secret) => secret.secretRef === "GITHUB_TOKEN_CLI_AGENT"));

    const plan = await runCli([
      "project", "onboard", "plan", "github",
      "--id", "github-cli-agent",
      "--base-url", github.baseUrl,
      "--repo", "org/repo",
      "--branch", "main",
      "--token-ref", "GITHUB_TOKEN_CLI_AGENT",
      "--execution-mode", "owned-repository",
      "--devops-owner", "org",
      "--ci-workflow", "ci.yml",
      "--ci-required-check", "build",
      "--ci-required-check", "test",
      "--cd-workflow", "deploy-prod.yml",
      "--deploy-environment", "production",
      "--health-url", `${github.baseUrl}/health`,
      "--objective", "Support tenant-level project onboarding and full lifecycle Goal Loop workflow visibility",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(plan.schema, "evopilot-project-onboarding-checklist/v1");
    assert.equal(plan.mode, "plan");
    assert.equal(plan.status, "READY_TO_ONBOARD");
    assert.equal(plan.nextAction, "register-project");
    assert.equal(plan.repository.topology.executionMode, "owned-repository");
    assert.equal(plan.devops.executionMode, "owned-repository");
    assert.equal(plan.devops.devopsOwner, "org");
    assert.equal(plan.devops.workflowRepository, "org/repo");
    assert.equal(plan.devops.claimBoundary, "working-repo-ci");
    assert.ok(plan.requestId);
    assert.ok(plan.steps.some((step) => step.id === "secret" && step.status === "PASS"));
    assert.ok(plan.steps.some((step) => step.id === "source-credentials" && step.status === "PASS"));
    assert.ok(plan.steps.some((step) => step.id === "devops" && step.status === "PASS"));
    assert.ok(plan.commands.some((command) => command.id === "project-onboard" && command.command.includes("evopilot project onboard github") && command.command.includes("--devops-owner org")));
    assert.equal(plan.commands.some((command) => command.command.includes("--template")), false);
    assert.equal(plan.commands.some((command) => command.id === "target-run"), false);

    const forkPlan = await runCli([
      "project", "onboard", "plan", "github",
      "--id", "skywalking-fork",
      "--base-url", github.baseUrl,
      "--repo", "apache/skywalking",
      "--upstream-repo", "apache/skywalking",
      "--working-repo", "yeliang-wang/skywalking-fork",
      "--branch", "main",
      "--token-ref", "GITHUB_TOKEN_CLI_AGENT",
      "--execution-mode", "fork-validated-pr",
      "--devops-owner", "yeliang-wang",
      "--ci-workflow", "ci.yml",
      "--ci-required-check", "build",
      "--objective", "Provide fork-validated upstream PR readiness with native CI evidence and blocker reporting",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(forkPlan.repository.owner, "yeliang-wang");
    assert.equal(forkPlan.repository.topology.executionMode, "fork-validated-pr");
    assert.equal(forkPlan.repository.topology.upstream.owner, "apache");
    assert.equal(forkPlan.devops.devopsOwner, "yeliang-wang");
    assert.equal(forkPlan.devops.workflowRepository, "yeliang-wang/skywalking-fork");
    assert.equal(forkPlan.devops.claimBoundary, "fork-ci-pr");

    const forkWithoutPrincipal = await runCli([
      "project", "onboard", "plan", "github",
      "--id", "skywalking-no-principal",
      "--base-url", github.baseUrl,
      "--repo", "apache/skywalking",
      "--upstream-repo", "apache/skywalking",
      "--working-repo", "yeliang-wang/skywalking-fork",
      "--branch", "main",
      "--execution-mode", "fork-validated-pr",
      "--devops-owner", "yeliang-wang",
      "--ci-workflow", "ci.yml",
      "--ci-required-check", "build",
      "--objective", "Provide fork-validated upstream PR readiness with native CI evidence and blocker reporting",
      "--config", configPath,
      "--json"
    ], { status: 2 });
    assert.equal(forkWithoutPrincipal.status, "BLOCKED");
    assert.equal(forkWithoutPrincipal.nextAction, "connect-github-account");
    assert.ok(forkWithoutPrincipal.missingInputs.includes("github-account-or-org-principal"));
    assert.ok(forkWithoutPrincipal.missingInputs.includes("server-side-token-ref"));
    assert.ok(forkWithoutPrincipal.commands.some((command) => command.id === "connect-github-account" && command.command.includes("evopilot secret set")));

    const readOnlyPlan = await runCli([
      "project", "onboard", "plan", "github",
      "--id", "skywalking-readonly-cli",
      "--base-url", github.baseUrl,
      "--repo", "apache/skywalking",
      "--execution-mode", "read-only-public",
      "--objective", "Inspect SkyWalking and report blockers without writeback",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(readOnlyPlan.status, "READY_TO_ONBOARD");
    assert.equal(readOnlyPlan.nextAction, "register-project");
    assert.equal(readOnlyPlan.repository.topology.executionMode, "read-only-public");
    assert.equal(readOnlyPlan.repository.topology.claimBoundary, "read-only-analysis");
    assert.equal(readOnlyPlan.sourceCredentials.status, "READ_ONLY");
    assert.equal(readOnlyPlan.devops, undefined);
    assert.equal(readOnlyPlan.missingInputs.includes("server-side-token-ref"), false);
    assert.equal(readOnlyPlan.missingInputs.includes("github-account-or-org-principal"), false);
    assert.ok(readOnlyPlan.commands.some((command) => command.id === "project-onboard" && !command.command.includes("--token-ref") && !command.command.includes("--require-devops-ready")));

    const ambiguous = await runCliErrorText([
      "project", "onboard", "plan", "github",
      "--id", "ambiguous-skywalking",
      "--base-url", github.baseUrl,
      "--repo", "apache/skywalking",
      "--with-devops",
      "--ci-workflow", "ci.yml",
      "--config", configPath,
      "--json"
    ], 64);
    assert.match(ambiguous, /DevOps ownership is ambiguous/);

    const planText = await runCliText([
      "project", "onboard", "plan", "github",
      "--id", "github-cli-agent",
      "--base-url", github.baseUrl,
      "--repo", "org/repo",
      "--branch", "main",
      "--token-ref", "GITHUB_TOKEN_CLI_AGENT",
      "--execution-mode", "owned-repository",
      "--devops-owner", "org",
      "--ci-workflow", "ci.yml",
      "--ci-required-check", "build",
      "--ci-required-check", "test",
      "--config", configPath
    ]);
    assert.match(planText, /EvoPilot Project Onboarding/);
    assert.match(planText, /Execution Boundary/);
    assert.match(planText, /Mode\s+owned-repository/);
    assert.match(planText, /owner=org/);
    assert.match(planText, /Workflow/);
    assert.match(planText, /Next Action/);
    assert.match(planText, /Suggested Commands/);
    assert.match(planText, /Request\s+/);

    const project = await runCli([
      "project", "onboard", "github",
      "--id", "github-cli-agent",
      "--base-url", github.baseUrl,
      "--repo", "org/repo",
      "--branch", "main",
      "--token-ref", "GITHUB_TOKEN_CLI_AGENT",
      "--execution-mode", "owned-repository",
      "--devops-owner", "org",
      "--ci-workflow", "ci.yml",
      "--ci-required-check", "build",
      "--ci-required-check", "test",
      "--cd-workflow", "deploy-prod.yml",
      "--deploy-environment", "production",
      "--health-url", `${github.baseUrl}/health`,
      "--config", configPath,
      "--json"
    ]);
    assert.equal(project.schema, "evopilot-cli-project-onboard/v1");
    assert.equal(project.project.id, "github-cli-agent");
    assert.equal(project.project.repository.provider, "github");
    assert.equal(project.project.repository.topology.executionMode, "owned-repository");
    assert.equal(project.sourceCredentials.status, "READY");
    assert.equal(project.devops.status, "READY");
    assert.equal(project.devops.devopsOwner, "org");
    assert.equal(project.devops.claimBoundary, "working-repo-ci");
    assert.ok(project.steps.some((step) => step.type === "project.source-credentials.preflight" && step.requestId));

    const verify = await runCli([
      "project", "onboard", "verify", "github-cli-agent",
      "--objective", "Support tenant-level project onboarding and full lifecycle Goal Loop workflow visibility",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(verify.schema, "evopilot-project-onboarding-checklist/v1");
    assert.equal(verify.mode, "inspect");
    assert.equal(verify.status, "READY_TO_RUN");
    assert.equal(verify.nextAction, "run-target");
    assert.ok(verify.steps.some((step) => step.id === "project" && step.status === "PASS"));
    assert.ok(verify.commands.some((command) => command.id === "target-plan" && command.command.includes("evopilot target plan")));
    assert.ok(verify.commands.some((command) => command.id === "target-run" && command.command.includes("--require-source-ready")));
    assert.equal(verify.commands.some((command) => command.command.includes("--template")), false);

    const preflightText = await runCliText([
      "project", "devops", "preflight", "github-cli-agent",
      "--config", configPath
    ]);
    assert.match(preflightText, /EvoPilot Project DevOps/);
    assert.match(preflightText, /Provider   github-actions/);
    assert.match(preflightText, /Execution Boundary/);
    assert.match(preflightText, /owner=org/);
    assert.match(preflightText, /Claim\s+working-repo-ci/);
    assert.match(preflightText, /\[PASS\] ci-state/);

    const inspected = await runCli(["project", "devops", "inspect", "github-cli-agent", "--config", configPath, "--json"]);
    assert.equal(inspected.provider, "github-actions");
    assert.equal(inspected.boundary.owner, "org");

    const privateKeyFile = path.join(dataRoot, "github-app-private-key.pem");
    fs.writeFileSync(privateKeyFile, "-----BEGIN PRIVATE KEY-----\ncli-test\n-----END PRIVATE KEY-----\n");
    const privateKey = await runCli([
      "secret", "set",
      "--id", "GH_APP_PRIVATE_KEY",
      "--kind", "github-app-private-key",
      "--value-file", privateKeyFile,
      "--config", configPath,
      "--json"
    ]);
    assert.equal(privateKey.kind, "github-app-private-key");
    const webhookSecret = await runCli([
      "secret", "set",
      "--id", "GH_APP_WEBHOOK",
      "--kind", "github-webhook-secret",
      "--value", "webhook-secret",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(webhookSecret.kind, "github-webhook-secret");

    const installation = await runCli([
      "github-app", "installation", "set",
      "--id", "gh-app-cli",
      "--installation-id", "12345",
      "--account", "org",
      "--repository", "org/repo",
      "--private-key-secret-ref", "GH_APP_PRIVATE_KEY",
      "--webhook-secret-ref", "GH_APP_WEBHOOK",
      "--permission", "contents=write",
      "--permission", "pull_requests=write",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(installation.id, "gh-app-cli");
    assert.equal(installation.status, "READY");

    const appPreflight = await runCli(["github-app", "installation", "preflight", "gh-app-cli", "--config", configPath, "--json"]);
    assert.equal(appPreflight.status, "READY");
    assert.equal(appPreflight.nextAction, "use-installation");

    const revoked = await runCli(["secret", "revoke", "GH_APP_WEBHOOK", "--config", configPath, "--json"]);
    assert.equal(revoked.status, "REVOKED");

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
  const profileLlm = await startFakeOpenAiLlmForCli();
  let llmCallCount = 0;

  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    llmClient: {
      async generate(request) {
        llmCallCount += 1;
        return {
          requestId: request.requestId ?? `cli-llm-${llmCallCount}`,
          success: true,
          text: "# CLI LLM plan\n\nVisible token usage for CLI and WorkBuddy.",
          provider: "cli-test-llm",
          model: "cli-test-model",
          durationMs: 4,
          usage: { inputTokens: 7, outputTokens: 5, totalTokens: 12 },
          resolvedIntent: request.intent,
          resolvedProfile: "test-profile"
        };
      }
    },
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
    assert.equal(status.schema, "evopilot-cli-status/v1");
    assert.equal(status.cli.name, "@evopilot/cli");
    assert.equal(status.api.schema, "evopilot-version/v1");
    assert.equal(status.api.apiContractVersion, "v1");
    assert.equal(status.health.status, "UP");
    assert.equal(status.ready.status, "READY");
    assert.equal(status.client.surface, "agent-or-script");
    assert.equal(status.llmUsage.summary.totalTokens, 0);
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

    const llmSecret = await runCli([
      "secret", "set",
      "--id", "LLM_API_KEY_QWEN_PRIVATE",
      "--kind", "llm-key",
      "--value", "fake-llm-token",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(llmSecret.secretRef, "LLM_API_KEY_QWEN_PRIVATE");
    assert.equal(llmSecret.kind, "llm-key");

    const llmProfile = await runCli([
      "llm", "profile", "set", "qwen-private",
      "--provider", "openai-compatible",
      "--base-url", profileLlm.baseUrl,
      "--model", "qwen-private-test",
      "--api-key-ref", "LLM_API_KEY_QWEN_PRIVATE",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(llmProfile.id, "qwen-private");
    assert.equal(llmProfile.modelName, "qwen-private-test");
    assert.equal(llmProfile.apiKeyRef, "LLM_API_KEY_QWEN_PRIVATE");
    assert.equal(llmProfile.apiKeyConfigured, true);

    const llmProfiles = await runCli(["llm", "profile", "list", "--config", configPath, "--json"]);
    assert.ok(llmProfiles.some((profile) => profile.id === "qwen-private"));

    const inspectedLlmProfile = await runCli(["llm", "profile", "inspect", "qwen-private", "--config", configPath, "--json"]);
    assert.equal(inspectedLlmProfile.id, "qwen-private");

    const llmProfilePreflight = await runCli(["llm", "profile", "preflight", "qwen-private", "--config", configPath, "--json"]);
    assert.equal(llmProfilePreflight.status, "READY");
    assert.equal(llmProfilePreflight.provider, "openai-compatible");
    assert.equal(llmProfilePreflight.model, "qwen-private-test");
    assert.ok(profileLlm.calls >= 1);

    const projectLlm = await runCli([
      "project", "llm", "set", "cli-agent",
      "--profile", "qwen-private",
      "--require-llm-ready",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(projectLlm.llm.profileId, "qwen-private");
    assert.equal(projectLlm.readiness.status, "READY");

    const projectLlmInspect = await runCli(["project", "llm", "inspect", "cli-agent", "--config", configPath, "--json"]);
    assert.equal(projectLlmInspect.selection.profileId, "qwen-private");
    assert.equal(projectLlmInspect.selection.source, "project-default");

    const projectLlmPreflight = await runCli(["project", "llm", "preflight", "cli-agent", "--config", configPath, "--json"]);
    assert.equal(projectLlmPreflight.status, "READY");

    const maturityStandards = await runCli(["maturity", "standards", "list", "--config", configPath, "--json"]);
    assert.equal(maturityStandards.schema, "evopilot-maturity-standard-set/v1");
    assert.deepEqual(maturityStandards.phases, ["alpha", "beta", "rc", "ga"]);
    assert.equal(maturityStandards.terminalMaturity, "ga");

    const rcStandard = await runCli(["maturity", "standards", "inspect", "rc", "--config", configPath, "--json"]);
    assert.equal(rcStandard.phase, "rc");
    assert.ok(rcStandard.reviewCapabilities.includes("architecture"));

    const devopsMismatch = await runCli([
      "project", "devops", "set", "cli-agent",
      "--provider", "github-actions",
      "--execution-mode", "owned-repository",
      "--devops-owner", "org",
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

    const removedTemplateTargetRun = await runCliErrorText([
      "target", "run",
      "--project", "cli-agent",
      "--template", "ga",
      "--objective", "Old template parameter should be rejected",
      "--config", configPath
    ], 64);
    assert.match(removedTemplateTargetRun, /target run does not accept --template/);

    const removedTemplateOnboard = await runCliErrorText([
      "project", "onboard", "github",
      "--repo", "org/repo",
      "--id", "github-cli-agent",
      "--template", "ga",
      "--config", configPath
    ], 64);
    assert.match(removedTemplateOnboard, /project onboard does not accept --template/);

    const target = await runCli(["target", "create", "--project", "cli-agent", "--config", configPath, "--json"]);
    assert.equal(target.id, "cli-agent-ga");
    assert.equal(target.scope, "project");
    assert.equal(target.projectId, "cli-agent");
    assert.equal(target.templateId, "ga");

    const goal = await runCli([
      "goal", "create",
      "--id", "cli-agent-ga-global-goal",
      "--project", "cli-agent",
      "--target", "cli-agent-ga",
      "--objective", "CLI Agent provides visible GoalTargets for tenant operators and AI agents",
      "--idempotency-key", "goal-cli-agent-ga",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(goal.schema, "evopilot-global-goal/v1");
    assert.equal(goal.id, "cli-agent-ga-global-goal");
    assert.equal(goal.status, "DRAFT");
    assert.equal(goal.plan.status, "MISSING");

    const goals = await runCli(["goal", "list", "--project", "cli-agent", "--target", "cli-agent-ga", "--config", configPath, "--json"]);
    assert.ok(goals.some((item) => item.id === goal.id));

    const inspectedGoal = await runCli(["goal", "inspect", goal.id, "--config", configPath, "--json"]);
    assert.equal(inspectedGoal.id, goal.id);
    assert.equal(inspectedGoal.objective, "CLI Agent provides visible GoalTargets for tenant operators and AI agents");

    const goalSnapshotBeforePlan = await runCli(["goal", "snapshot", goal.id, "--config", configPath, "--json"]);
    assert.equal(goalSnapshotBeforePlan.status, "DRAFT");
    assert.equal(goalSnapshotBeforePlan.nextAction, "plan-goal");

    const goalPlan = await runCli(["goal", "plan", goal.id, "--config", configPath, "--json"]);
    assert.equal(goalPlan.id, goal.id);
    assert.equal(goalPlan.status, "PLANNED");
    assert.equal(goalPlan.plan.status, "PENDING_APPROVAL");
    assert.equal(goalPlan.plan.decompositionStrategy, "ga-maturity-ladder");
    assert.deepEqual(goalPlan.plan.phaseTargets.map((phase) => phase.phase), ["alpha", "beta", "rc", "ga"]);
    assert.ok(goalPlan.plan.targets.length >= 12);

    const goalPhasesBeforeApprove = await runCli(["goal", "phases", goal.id, "--config", configPath, "--json"]);
    assert.deepEqual(goalPhasesBeforeApprove.map((phase) => phase.phase), ["alpha", "beta", "rc", "ga"]);
    assert.ok(goalPhasesBeforeApprove.every((phase) => phase.status === "PENDING"));

    const alphaPackageBeforeApprove = await runCli(["goal", "phase-package", goal.id, "--phase", "alpha", "--config", configPath, "--json"]);
    assert.equal(alphaPackageBeforeApprove.schema, "evopilot-phase-package/v1");
    assert.equal(alphaPackageBeforeApprove.phase, "alpha");

    const exportedPlanFile = path.join(dataRoot, "exported-plan.json");
    const exportedPlanText = await runCliText(["target", "plan", "export", goal.id, "--format", "json", "--config", configPath]);
    fs.writeFileSync(exportedPlanFile, exportedPlanText);
    const exportedPlan = JSON.parse(exportedPlanText);
    assert.equal(exportedPlan.schema, "evopilot-goal-phase-plan/v1");
    assert.deepEqual(exportedPlan.phases.map((phase) => phase.phase), ["alpha", "beta", "rc", "ga"]);

    exportedPlan.phases[0].acceptanceCriteria.push("CLI-specific Alpha phase review evidence is documented.");
    exportedPlan.targets[0].acceptanceCriteria.push("CLI-specific operator visibility SLO is documented.");
    fs.writeFileSync(exportedPlanFile, JSON.stringify(exportedPlan, null, 2));
    const planDiff = await runCli(["target", "plan", "diff", goal.id, "--file", exportedPlanFile, "--config", configPath, "--json"]);
    assert.ok(planDiff.changedTargets.includes(exportedPlan.targets[0].id));
    assert.equal(planDiff.baselineGuard.skipPhaseAllowed, false);

    const appliedPlan = await runCli(["target", "plan", "apply", goal.id, "--file", exportedPlanFile, "--config", configPath, "--json"]);
    assert.equal(appliedPlan.plan.status, "PENDING_APPROVAL");
    assert.ok(appliedPlan.plan.phaseTargets[0].acceptanceCriteria.includes("CLI-specific Alpha phase review evidence is documented."));
    assert.ok(appliedPlan.plan.targets[0].acceptanceCriteria.includes("CLI-specific operator visibility SLO is documented."));

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
    assert.equal(goalRunJson.llmUsage.client.surface, "agent-or-script");
    assert.equal(goalRunJson.llmUsage.summary.totalTokens, 0);

    const goalTimeoutJson = await runCli(["goal", "run", goal.id, "--timeout", "0s", "--config", configPath, "--json"], { status: 2 });
    assert.equal(goalTimeoutJson.schema, "evopilot-cli-goal-run/v1");
    assert.ok(goalTimeoutJson.steps.some((step) => step.type === "goal.timeout-reached"));

    const goalRunText = await runCliText(["goal", "run", goal.id, "--max-steps", "0", "--config", configPath], { status: 2 });
    assert.match(goalRunText, /EvoPilot Goal Run/);
    assert.match(goalRunText, /Workflow/);
    assert.match(goalRunText, /LLM Usage/);
    assert.match(goalRunText, /Next Action/);
    assert.match(goalRunText, /Evidence/);

    const targetPlanJson = await runCli([
      "target", "plan",
      "--project", "cli-agent",
      "--objective", "Expose tenant workflow state, phase packages, blockers, next actions, and LLM token usage to operators",
      "--llm-profile", "qwen-private",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(targetPlanJson.schema, "evopilot-cli-target-plan/v1");
    assert.equal(targetPlanJson.command, "target plan");
    assert.equal(targetPlanJson.terminalMaturity, "ga");
    assert.equal(targetPlanJson.phasePlan.schema, "evopilot-goal-phase-plan/v1");
    assert.deepEqual(targetPlanJson.phasePlan.phases.map((phase) => phase.phase), ["alpha", "beta", "rc", "ga"]);
    assert.equal(targetPlanJson.result.nextAction, "approve-plan");

    const targetRunJson = await runCli([
      "target", "run",
      "--project", "cli-agent",
      "--objective", "Expose tenant workflow state, phase packages, blockers, next actions, and LLM token usage to operators",
      "--llm-profile", "qwen-private",
      "--require-llm-ready",
      "--until", "terminal",
      "--config", configPath,
      "--json"
    ], { status: 2 });
    assert.equal(targetRunJson.schema, "evopilot-cli-goal-run/v1");
    assert.equal(targetRunJson.command, "target run");
    assert.equal(targetRunJson.until, "terminal");
    assert.equal(targetRunJson.status.goal.projectId, "cli-agent");
    assert.equal(targetRunJson.status.goal.releaseTargetId, "cli-agent-ga");
    assert.equal(targetRunJson.status.goal.llm.profileId, "qwen-private");
    assert.equal(targetRunJson.status.goal.plan.status, "PENDING_APPROVAL");
    assert.deepEqual(targetRunJson.status.goal.plan.phaseTargets.map((phase) => phase.phase), ["alpha", "beta", "rc", "ga"]);
    assert.ok(targetRunJson.steps.some((step) => step.type === "goal.plan-approval-required" && step.nextAction === "approve-plan"));
    assert.ok(targetRunJson.steps.some((step) => step.type === "llm.profile.preflight" && step.status === "READY"));

    const targetRunAutoApproved = await runCli([
      "target", "run",
      "--project", "cli-agent",
      "--objective", "Expose tenant workflow state, phase packages, blockers, next actions, and LLM token usage to operators",
      "--llm-profile", "qwen-private",
      "--require-llm-ready",
      "--auto-approve-plan",
      "--max-steps", "0",
      "--config", configPath,
      "--json"
    ], { status: 2 });
    assert.equal(targetRunAutoApproved.status.goal.plan.status, "APPROVED");
    assert.ok(targetRunAutoApproved.steps.some((step) => step.type === "goal.plan-approved"));

    const loopTimeoutJson = await runCli([
      "loop", "run",
      "--project", "cli-agent",
      "--target", "cli-agent-ga",
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
      "--target", "cli-agent-ga",
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
    assert.equal(loopRunJson.loop.llm.profileId, "qwen-private");
    assert.equal(loopRunJson.loop.status, "SUCCEEDED");
    assert.equal(loopRunJson.llmUsage.summary.provider, "openai-compatible");
    assert.equal(loopRunJson.llmUsage.summary.model, "qwen-private-test");
    assert.equal(loopRunJson.llmUsage.summary.totalTokens, 24);
    assert.equal(loopRunJson.llmUsage.server.steps[0].llmProfileId, "qwen-private");
    assert.equal(loopRunJson.llmUsage.server.steps[0].totalTokens, 24);
    assert.ok(loopRunJson.llmUsage.process.responses.some((step) => step.label === "loop-run-start-1"));

    const loopRunText = await runCliText([
      "loop", "run",
      "--project", "cli-agent",
      "--target", "cli-agent-ga",
      "--objective", "CLI wrapper loop run prints visible token usage",
      "--force-decision", "SUCCEED",
      "--max-iterations", "1",
      "--client", "workbuddy",
      "--config", configPath
    ]);
    assert.match(loopRunText, /LLM Usage/);
    assert.match(loopRunText, /Client\s+workbuddy/);
    assert.match(loopRunText, /Provider\s+openai-compatible/);
    assert.match(loopRunText, /Model\s+qwen-private-test/);
    assert.match(loopRunText, /Tokens\s+total=24/);

    const blockedLoopRunJson = await runCli([
      "loop", "run",
      "--project", "cli-agent",
      "--target", "cli-agent-ga",
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
      targetVersion: "cli-ga",
      releaseStrategy: "local-git-commit",
      requiredGates: ["code-change", "push"],
      deploymentEnvironment: "test"
    }));

    const loop = await runCli([
      "loop", "create",
      "--project", "cli-agent",
      "--target", "cli-agent-ga",
      "--objective", "Drive CLI beta source closure",
      "--source-closure", sourceClosureFile,
      "--idempotency-key", "cli-ga-loop",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(loop.projectId, "cli-agent");
    assert.equal(loop.context.releaseTargetId, "cli-agent-ga");
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
      "--branch", "evopilot/cli-ga",
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
      "--target", "cli-agent-ga",
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
      "--target", "cli-agent-ga",
      "--scenario", "beta-core-flow=PASS",
      "--scenario", "ci-cd-pass=PASS",
      "--scenario", "manual-approval=PASS",
      "--config", configPath,
      "--json"
    ]);
    assert.equal(releaseGate.projectId, "cli-agent");
    assert.equal(releaseGate.releaseTargetId, "cli-agent-ga");
    assert.ok(releaseGate.releaseDecisionId);

    const decisions = await runCli(["release", "decisions", "--project", "cli-agent", "--target", "cli-agent-ga", "--config", configPath, "--json"]);
    assert.ok(decisions.some((decision) => decision.id === releaseGate.releaseDecisionId));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await profileLlm.close();
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

function runCliErrorText(args, status) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== status) {
        reject(new Error(`CLI failed with unexpected status:\nargs=${args.join(" ")}\nexit=${code}\nstdout=${stdout}\nstderr=${stderr}`));
        return;
      }
      resolve(`${stdout}${stderr}`);
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
    if (request.url === "/repos/apache/skywalking/git/trees/main?recursive=1") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ tree: [{ type: "blob", path: "README.md" }] }));
      return;
    }
    if (request.url === "/repos/yeliang-wang/skywalking-fork/git/trees/main?recursive=1") {
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
    if (request.url === "/repos/org/repo/actions/workflows/ci.yml/runs?per_page=20&branch=main") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ workflow_runs: [
        { id: 101, name: "CI", status: "completed", conclusion: "success", head_branch: "main", html_url: "https://github.example/org/repo/actions/runs/101" }
      ] }));
      return;
    }
    if (request.url === "/repos/yeliang-wang/skywalking-fork/commits/main/check-runs") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ check_runs: [
        { name: "build", status: "completed", conclusion: "success" }
      ] }));
      return;
    }
    if (request.url === "/repos/yeliang-wang/skywalking-fork/actions/workflows/ci.yml/runs?per_page=20&branch=main") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ workflow_runs: [
        { id: 102, name: "CI", status: "completed", conclusion: "success", head_branch: "main", html_url: "https://github.example/yeliang-wang/skywalking-fork/actions/runs/102" }
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

async function startFakeOpenAiLlmForCli() {
  const state = { calls: 0 };
  const server = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/chat/completions") {
      state.calls += 1;
      let body = "";
      for await (const chunk of request) body += chunk;
      const parsed = body ? JSON.parse(body) : {};
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: `fake-llm-${state.calls}`,
        object: "chat.completion",
        model: parsed.model ?? "qwen-private-test",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "# Qwen private plan\n\nProfile-selected loop execution is visible."
          },
          finish_reason: "stop"
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 14,
          total_tokens: 24
        }
      }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    get calls() {
      return state.calls;
    },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
