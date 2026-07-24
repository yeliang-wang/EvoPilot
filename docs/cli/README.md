# EvoPilot CLI

> Command-line access to an EvoPilot control-plane server for operators, CI jobs, release scripts, and AI agents.

The EvoPilot CLI is an HTTP client. It can run on macOS, Windows, Linux, WorkBuddy, Codex, Claude Code, or any environment that can execute Node.js commands and reach the EvoPilot server URL.

The CLI does not start EvoPilot locally and does not bypass server governance. RBAC, tenant/workspace scope, approvals, source-closure preflight, project DevOps, deployment gates, audit records, and release decisions are enforced by the EvoPilot server.

## Install

Production installation uses the published CLI package:

```bash
npm install -g @evopilot/cli
evopilot --version
```

From this repository, use the same CLI package without publishing:

```bash
npm install
npm run cli:build
npm run cli -- --version
```

The package requires Node.js 22 or later.

## Connect

Configure the target EvoPilot server and scope:

```bash
export EVOPILOT_SERVER="https://evopilot.example.com"
export EVOPILOT_API_TOKEN="<operator-or-admin-token>"
export EVOPILOT_TENANT="tenant-production"
export EVOPILOT_WORKSPACE="workspace-agent-products"
export EVOPILOT_ACTOR="workbuddy"
export EVOPILOT_CLI_CLIENT="workbuddy"
```

`EVOPILOT_BASE_URL` is also accepted as a server URL fallback. Command-line flags override environment variables and saved config:

```bash
evopilot --server "$EVOPILOT_SERVER" --token "$EVOPILOT_API_TOKEN" status --json
```

For username/password login:

```bash
evopilot auth login \
  --server "$EVOPILOT_SERVER" \
  --username "<user>" \
  --password "<password>"
```

The default saved config path is:

```text
~/.evopilot/config.json
```

Use `--config <file>` or `EVOPILOT_CONFIG` for short-lived agent sessions.

## Verify

Always verify the session before changing product state:

```bash
evopilot config show --json
evopilot status --json
```

Expected result:

- `health.status` is `UP`.
- `ready.status` is `READY`.
- `api.schema` is `evopilot-version/v1`.
- `api.apiContractVersion` is `v1`.
- `summary` is present when the token is valid for the requested tenant/workspace.
- `llmUsage.summary.provider` and `llmUsage.summary.model` identify the LLM visible to the CLI.
- `llmUsage.summary.totalTokens`, `inputTokens`, `outputTokens`, and `creditsConsumed` show token usage.
- Exit code is `0`.

If `summary` is missing, the CLI reached public health endpoints but not an authenticated control-plane session.

## AI Agent Contract

WorkBuddy, Codex, Claude Code, CI jobs, and other agents should treat this file as the CLI entry point. The safe execution contract is:

1. Configure `EVOPILOT_SERVER`, `EVOPILOT_API_TOKEN`, `EVOPILOT_TENANT`, `EVOPILOT_WORKSPACE`, `EVOPILOT_ACTOR`, and `EVOPILOT_CLI_CLIENT`.
2. Run `evopilot status --json`.
3. For a new project, run `evopilot project onboard plan ... --json` before mutating state.
4. Store or repair server-side `tokenRef` values when the checklist asks for it.
5. Verify with `project preflight`, `project devops preflight`, and `project onboard verify`.
6. When the project needs a non-default model, store the LLM key server-side, create an LLM profile, bind it to the project, and run `project llm preflight`.
7. Generate the Goal phase plan with `target plan` or the first `target run`.
8. Export, review, optionally edit, diff, apply, and approve the Alpha -> Beta -> RC -> GA phase plan.
9. Run `target run`, `goal run`, or `loop run` with `--json`.
10. Stop on blockers, human gates, credential gaps, policy review, repair actions, `NO-GO`, `BLOCKED`, `FAILED`, timeouts, or max-step boundaries.
11. Report the server-derived result, release verdict, IDs, LLM provider/model, token totals, and request IDs.

An agent must not parse human-readable output when `--json` is available, must not pass raw GitHub/GitLab tokens in daily wrapper commands, and must not claim a stronger DevOps or release result than the server-returned `claimBoundary` and release decision.

## LLM And Token Visibility

Every wrapper command must expose LLM usage to both humans and AI agents. Use `--client workbuddy` or `EVOPILOT_CLI_CLIENT=workbuddy` when the command is invoked from WorkBuddy; macOS terminal sessions are labeled `mac-terminal` automatically when TTY detection is available.

For JSON output, agents must read:

```text
llmUsage.client.surface
llmUsage.summary.provider
llmUsage.summary.model
llmUsage.summary.totalTokens
llmUsage.summary.inputTokens
llmUsage.summary.outputTokens
llmUsage.summary.creditsConsumed
llmUsage.process.responses[]
llmUsage.server.steps[]
```

`llmUsage.summary` is the command-level total. `llmUsage.process.responses[]` is the CLI-observed HTTP chain with `requestId` values. `llmUsage.server.steps[]` is the server-side Loop executor step list, including `loopId`, `iteration`, `nodeId`, `provider`, `model`, `inputTokens`, `outputTokens`, `totalTokens`, and `llmRequestId`.

Human-readable `target run`, `goal run`, `loop run`, and `project onboard` output includes an `LLM Usage` section plus inline token counts in recent `Steps`. Server HTTP logs include the same client surface and request-level LLM token delta under `metadata.client` and `metadata.llmUsage`.

Production metrics are enabled by default. When the API server has `EVOPILOT_DATA_ROOT`, LLM metrics are written to `EVOPILOT_DATA_ROOT/llm-metrics.jsonl` unless `EVOPILOT_LLM_METRICS_PATH` overrides it. Token counts are observability data and remain visible in logs; API tokens, GitHub/GitLab tokens, passwords, API keys, and credential refs remain redacted.

## Custom LLM Profiles

EvoPilot no longer assumes every project must use the server's global default LLM. A tenant/workspace can register public or private OpenAI-compatible models as server-side LLM profiles, bind one profile as a project default, and optionally override it for a single Goal/Loop run.

The raw LLM API key must be stored on the EvoPilot server or in the tenant/workspace secret vault. Daily wrapper commands pass only `--llm-profile <id>`.

One-time setup from a trusted shell:

```bash
export LLM_API_KEY_MY_AGENT="<real-llm-api-key>"

evopilot secret set \
  --id LLM_API_KEY_MY_AGENT \
  --kind llm-key \
  --from-env LLM_API_KEY_MY_AGENT \
  --json

evopilot llm profile set my-agent-llm \
  --provider openai-compatible \
  --base-url https://llm.example.com/v1 \
  --model qwen2.5-coder-32b \
  --api-key-ref LLM_API_KEY_MY_AGENT \
  --json

evopilot llm profile preflight my-agent-llm --json
```

Bind the project default:

```bash
evopilot project llm set my-agent \
  --profile my-agent-llm \
  --require-llm-ready \
  --json

evopilot project llm inspect my-agent --json
evopilot project llm preflight my-agent --json
```

Run with the project default LLM:

```bash
evopilot target run \
  --project my-agent \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and repair guidance for My Agent" \
  --until terminal \
  --max-steps 20 \
  --require-llm-ready \
  --json
```

Override the LLM for one run:

```bash
evopilot target run \
  --project my-agent \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and repair guidance with a private model" \
  --llm-profile my-agent-llm \
  --require-llm-ready \
  --json
```

Resolution order is:

```text
run override --llm-profile -> project default LLM binding -> server global default LLM
```

If `--require-llm-ready` is present and the profile secret cannot be resolved or the provider probe fails, the CLI stops before Loop execution and reports `nextAction=store-llm-secret`, `configure-llm-profile`, or `repair-llm-provider`.

## Wrapper JSON Contract

Wrapper commands return a stable machine-readable envelope:

| Command | Schema | Use |
|---|---|---|
| `target run` | `evopilot-cli-goal-run/v1` | One-command release target execution. |
| `goal run` | `evopilot-cli-goal-run/v1` | Create, resume, or advance a GlobalGoal. |
| `loop run` | `evopilot-cli-loop-run/v1` | Run or resume one LoopRun. |
| `project onboard ...` | `evopilot-cli-project-onboard/v1` | Register a new project, preflight it, and configure native DevOps. It does not start Goal/Loop execution. |
| `project onboard plan` / `verify` | `evopilot-project-onboarding-checklist/v1` | Non-mutating or persisted project readiness checklist. |

Agents should read these paths before claiming success:

```text
schema
command
result.exitCode
result.status
result.nextAction
status.status
status.nextAction
status.chain
status.blockers
status.releaseDecision
steps[].requestId
steps[].llmUsage
llmUsage.summary.provider
llmUsage.summary.model
llmUsage.summary.inputTokens
llmUsage.summary.outputTokens
llmUsage.summary.totalTokens
llmUsage.summary.creditsConsumed
llmUsage.process.responses[].requestId
llmUsage.process.cumulative
llmUsage.server.steps[]
```

Use `requestId`, `goalId`, `loopId`, `releaseRunId`, and `releaseDecisionId` to line up CLI output with Dashboard state and production logs.

## Command Layers

| Layer | Commands | When To Use |
|---|---|---|
| Wrapper | `project onboard`, `target run`, `goal run`, `loop run` | WorkBuddy, CI, and operators need one command that advances until terminal, blocked, timeout, or max-step boundary. |
| Planning | `maturity standards list`, `maturity standards inspect`, `target plan`, `target plan export`, `target plan diff`, `target plan apply`, `target plan approve`, `goal phases`, `goal phase-package` | A user or AI agent needs to review or adjust the generated Alpha/Beta/RC/GA plan before execution. |
| Atomic | `project preflight`, `project devops preflight`, `goal plan`, `goal approve-plan`, `goal advance`, `source-closure preflight`, `release decisions`, `audit list`, `trace tree` | A wrapper stopped, an agent needs white-box inspection, or a human must approve a governed action. |

Wrappers compose atomic operations but remain server-governed. They do not approve human gates, bypass source credential preflight, bypass DevOps ownership, or fabricate release decisions.

## Maturity Ladder

The CLI does not ask users to choose a terminal maturity. `--objective` is a business outcome, for example "Enable tenant onboarding and lifecycle workflow visibility." EvoPilot treats GA as the governed terminal maturity and decomposes the objective through the fixed ladder:

```text
Alpha -> Beta -> RC -> GA
```

Each phase has a versioned server standard under `evopilot-default/v1`:

| Phase | Standard Focus |
|---|---|
| Alpha | Source readability, bootstrap/smoke path, architecture map, risk register, no release claim. |
| Beta | Passed Alpha package, core E2E evidence, repository-native CI, critical tests, basic docs, limited-trial risk closure. |
| RC | Passed Beta package, scope freeze, source closure, repeated native CI/CD, deploy health, rollback/repair, security and architecture review. |
| GA | Passed RC package, stability/soak, observability, runbook, release notes, user docs, security governance, architecture signoff, final `ReleaseDecision=GO`. |

The built-in standard set is versioned in `standards/maturity/evopilot-default/v1/`. Later versions can add or strengthen standards without changing the CLI contract. Users may add project-specific GoalTargets, required evidence, or review requirements, but they cannot delete Alpha/Beta/RC/GA or remove baseline criteria and still claim standard GA.

Inspect the active standards:

```bash
evopilot maturity standards list --json
evopilot maturity standards inspect ga --json
```

## Fast Path

For an already registered project, generate the server-owned Alpha/Beta/RC/GA plan first:

```bash
evopilot target plan \
  --project <project-id> \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for this project" \
  --client workbuddy \
  --json
```

The plan command creates or reuses a project release target and GlobalGoal, then returns `evopilot-cli-target-plan/v1` with `terminalMaturity=ga`, `phasePlan.phases[]`, `phasePlan.targets[]`, and `editablePlan`.

Review and approve the generated Alpha -> Beta -> RC -> GA plan:

```bash
evopilot target plan export <goal-id> --format json > /tmp/evopilot-phase-plan.json
evopilot target plan diff <goal-id> --file /tmp/evopilot-phase-plan.json --json
evopilot target plan apply <goal-id> --file /tmp/evopilot-phase-plan.json --json
evopilot target plan approve <goal-id> --json
```

Then resume the wrapper:

```bash
evopilot target run \
  --project <project-id> \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for this project" \
  --until terminal \
  --max-steps 20 \
  --require-source-ready \
  --require-devops-ready \
  --llm-profile <llm-profile-id> \
  --require-llm-ready \
  --client workbuddy \
  --json
```

If the plan is not approved, `target run` stops at `PENDING_PLAN_APPROVAL` with `nextAction=approve-plan` and exit code `2`. Use `--auto-approve-plan` only for controlled automation where the generated plan may be accepted without a separate user review. The console prints a server-governed chain covering project, release target, GlobalGoal, Alpha/Beta/RC/GA phases, GoalTarget, LoopRun, source closure, deploy, release decision, evidence links, blockers, next action, LLM provider/model, command-level token totals, and step-level token usage.

## First Project Checklist

For a new project, start with a non-mutating onboarding checklist. This is the recommended entrypoint for WorkBuddy, Codex, Claude Code, and CI agents because it returns `schema`, `status`, `nextAction`, `missingInputs`, `blockers`, and suggested commands before anything is registered:

Declare the DevOps execution boundary whenever the checklist or wrapper configures GitHub Actions or GitLab CI:

- `--execution-mode owned-repository`: EvoPilot writes to and runs CI/CD in the same repository.
- `--execution-mode read-only-public`: EvoPilot can inspect a public upstream, but it must not claim PR, merge, CI/CD, or release readiness.
- `--execution-mode fork-validated-pr`: EvoPilot writes to a fork or working repository, runs CI/CD there, and can only claim fork CI plus an upstream PR.
- `--execution-mode upstream-authorized`: EvoPilot uses maintainer credentials against the upstream repository and can claim upstream release readiness after preflight.

`--devops-owner` is the GitHub owner or GitLab namespace whose account runs the project DevOps. For open-source upstream work, set `--upstream-repo` to the public project and `--working-repo` to the writable fork.

Full writeback, PR/MR, CI/CD, merge, deploy, or release readiness requires a GitHub/GitLab execution principal owned by the operator, user, or organization. For a third-party open-source upstream, the operator must either fork the upstream into a writable account/organization and use `fork-validated-pr`, or provide maintainer-authorized credentials and use `upstream-authorized`. If no GitHub/GitLab account or group exists, use `read-only-public`; EvoPilot will not provide a default platform account or built-in generic DevOps runner.

```bash
evopilot project onboard plan github \
  --repo <owner>/<repo> \
  --id <project-id> \
  --branch main \
  --token-ref GITHUB_TOKEN_<PROJECT> \
  --execution-mode owned-repository \
  --devops-owner <owner> \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --ci-required-check test \
  --cd-workflow deploy-prod.yml \
  --deploy-environment production \
  --health-url https://<app>/health \
  --llm-profile <llm-profile-id> \
  --require-llm-ready \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for <project-id>" \
  --json
```

If `nextAction` is `store-secret`, `connect-github-account`, or `connect-gitlab-account`, store the token once on the EvoPilot server or in the current tenant/workspace secret vault after the correct GitHub/GitLab account, organization, group, service account, deploy token, or GitHub App principal exists:

```bash
evopilot secret set \
  --id GITHUB_TOKEN_<PROJECT> \
  --kind source-token \
  --from-env GITHUB_TOKEN_<PROJECT> \
  --json
```

After registration, verify the same checklist against persisted project state:

```bash
evopilot project onboard verify <project-id> --json
```

For a new GitHub project, onboard the project, bind server-side source credentials, configure GitHub Actions, and preflight both boundaries:

```bash
evopilot project onboard github \
  --repo <owner>/<repo> \
  --id <project-id> \
  --branch main \
  --token-ref GITHUB_TOKEN_<PROJECT> \
  --execution-mode owned-repository \
  --devops-owner <owner> \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --ci-required-check test \
  --cd-workflow deploy-prod.yml \
  --deploy-environment production \
  --health-url https://<app>/health \
  --llm-profile <llm-profile-id> \
  --require-source-ready \
  --require-devops-ready \
  --require-llm-ready \
  --json
```

After `project onboard verify` returns `READY_TO_RUN`, use the `target plan` and `target run` flow above with the user's business objective.

For a public upstream with a writable fork:

Precondition: create or use the operator-owned GitHub/GitLab account or organization first, fork the upstream into `--working-repo`, and make sure the `--token-ref` resolves to that principal on the EvoPilot server.

```bash
evopilot project onboard github \
  --repo apache/skywalking \
  --upstream-repo apache/skywalking \
  --working-repo my-org/skywalking-fork \
  --id skywalking-fork \
  --branch main \
  --token-ref GITHUB_TOKEN_SKYWALKING_FORK \
  --execution-mode fork-validated-pr \
  --devops-owner my-org \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --require-source-ready \
  --require-devops-ready \
  --json
```

The JSON and human-readable output include `executionMode`, `repositoryOwner`, `devopsOwner`, `workflowRepository`, `credentialRef`, and `claimBoundary`. Agents must not claim more than the returned `claimBoundary`.

## Documentation

- [Workflows](workflows.md) - one-command and end-to-end scenarios.
- [Commands](commands.md) - command groups and syntax.
- [Automation](automation.md) - WorkBuddy, Codex, Claude Code, and CI rules.
- [AI Agent Runbook](../guides/ai-agent-runbook.md) - production operating runbook for external agents.
