# EvoPilot CLI Automation

> Operating contract for WorkBuddy, Codex, Claude Code, CI jobs, and release automation.

Automation should treat EvoPilot as the system of record. The CLI submits server-governed requests and prints server state. It must not invent release conclusions, bypass approval gates, or treat local machine state as production state.

## Required Environment

```bash
export EVOPILOT_SERVER="https://evopilot.example.com"
export EVOPILOT_API_TOKEN="<operator-or-admin-token>"
export EVOPILOT_TENANT="tenant-production"
export EVOPILOT_WORKSPACE="workspace-agent-products"
export EVOPILOT_ACTOR="workbuddy"
export EVOPILOT_CLI_CLIENT="workbuddy"
export EVOPILOT_CONFIG="$PWD/.evopilot-agent-config.json"
```

Use a job-local `EVOPILOT_CONFIG` when an agent should not write to `~/.evopilot/config.json`.

## Machine Output

Automation must use `--json` and parse JSON fields:

```bash
evopilot status --json
evopilot project onboard plan github --repo owner/my-agent --id my-agent --token-ref GITHUB_TOKEN_MY_AGENT --execution-mode owned-repository --devops-owner owner --ci-workflow ci.yml --ci-required-check build --template ga --json
evopilot project llm preflight my-agent --json
evopilot target plan --project my-agent --template ga --objective "Enable tenant onboarding and lifecycle workflow visibility" --llm-profile my-agent-llm --client workbuddy --json
evopilot target plan approve <goal-id> --json
evopilot target run --project my-agent --template ga --objective "Enable tenant onboarding and lifecycle workflow visibility" --llm-profile my-agent-llm --require-llm-ready --client workbuddy --json
```

Do not parse human-readable CLI output. Human output may change to improve operator readability.
When humans do read the console output, wrapper commands print the same core chain that Dashboard consumes: scope, project, release target, goal, workflow nodes, next action, evidence endpoints, recent steps, blockers, and `requestId` values for log lookup.

## Required Parse Order

For every `--json` command, automation should parse in this order:

1. `schema`
2. `result.exitCode` or process exit code
3. `status`, `result.status`, and `result.nextAction`
4. `status.blockers`, `blockers`, and `missingInputs`
5. IDs: `projectId`, `releaseTargetId`, `goalId`, `activeTargetId`, `loopId`, `releaseRunId`, `releaseDecisionId`, `requestId`
6. Execution boundary: `executionMode`, `devopsOwner`, `workflowRepository`, `credentialRef`, `credentialPrincipal`, `claimBoundary`
7. LLM boundary: `llm.profileId`, `llm.source`, `llm.provider`, `llm.model`, project LLM readiness, and run override `--llm-profile`
8. Goal phase plan: `phasePlan.phases[]`, `phasePlan.targets[]`, `editablePlan`, `status.nextAction`
9. Release decision fields from EvoPilot release APIs, never local inference
10. `llmUsage.summary`, `llmUsage.process.responses[]`, and `llmUsage.server.steps[]`

Do not continue just because a command printed a workflow graph. Continue only when the JSON status and `nextAction` allow it.

Automation must also parse LLM/token visibility from wrapper commands:

```text
llmUsage.client.surface
llmUsage.summary.provider
llmUsage.summary.model
llmUsage.summary.totalTokens
llmUsage.summary.inputTokens
llmUsage.summary.outputTokens
llmUsage.summary.creditsConsumed
llmUsage.process.responses[].requestId
llmUsage.server.steps[].loopId
llmUsage.server.steps[].nodeId
llmUsage.server.steps[].totalTokens
```

`llmUsage.summary` is the command-level total. `llmUsage.process.responses[]` is the CLI-observed HTTP chain. `llmUsage.server.steps[]` is the server-side Loop executor usage. If a cost-sensitive automation run cannot find `provider`, `model`, or token totals, it must treat the run as incomplete evidence and report the missing fields.

Minimum success report for a wrapper command:

```text
schema=<wrapper-schema>
exitCode=<0-or-nonzero>
status=<server-status>
nextAction=<server-next-action>
projectId=<project-id>
goalId=<goal-id-or-empty>
loopId=<loop-id-or-empty>
releaseDecisionId=<id-or-empty>
claimBoundary=<server-claim-boundary-or-empty>
llm=<provider/model>
tokens=<input/output/total>
requestIds=<comma-separated-request-ids>
```

If any LLM-backed run has `llm=not-visible` or `tokens=0/0/0` after it has executed an LLM step, report incomplete evidence.

## LLM Profile Rules

Automation must treat LLM configuration as a server-side project boundary, not as a CLI-local environment variable. A trusted operator stores the API key once, creates a profile, then binds the project:

```bash
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

evopilot project llm set my-agent \
  --profile my-agent-llm \
  --require-llm-ready \
  --json
```

Daily wrapper commands should pass only the profile id:

```bash
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --llm-profile my-agent-llm \
  --require-llm-ready \
  --client workbuddy \
  --json
```

Resolution order:

```text
run override --llm-profile -> project default LLM -> server global default LLM
```

If `llm profile preflight`, `project llm preflight`, or a wrapper LLM preflight returns `BLOCKED`, stop and report `nextAction`. Typical stop actions are:

```text
store-llm-secret
configure-llm-profile
repair-llm-provider
```

Automation must not pass raw LLM API keys in `target run`, `goal run`, `loop run`, or daily `project onboard` commands. It must report the selected profile id when available and must include `llmUsage.summary.provider`, `llmUsage.summary.model`, and token totals in the final run report.

`project onboard plan` and `project onboard verify` are the onboarding control surface for automation. Both print `evopilot-project-onboarding-checklist/v1`; the checklist contains machine-readable `steps`, `missingInputs`, `blockers`, `commands`, and `nextAction`. `plan` does not mutate project state. `verify` reads persisted project state and should return `READY_TO_RUN` before an agent claims that source writeback and repository-native DevOps are ready.

For any GitHub/GitLab DevOps flow, automation must parse and persist these fields from onboarding or `project devops preflight`:

```text
executionMode
repositoryOwner
devopsOwner
workflowRepository
credentialRef
credentialPrincipal
claimBoundary
```

Do not infer them from the repository URL. A public upstream such as `apache/skywalking` may have DevOps executed by `my-org/skywalking-fork`; the correct release claim is only what `claimBoundary` states.

## Exit Codes

Treat non-zero exit codes as stop conditions.

Typical behavior:

- `0`: command succeeded and the server accepted the operation.
- `2`: command reached a governed stop boundary, blocker, failed preflight, timeout, max-step limit, or API error.

After a non-zero exit, inspect the JSON response before retrying.

`project onboard plan` may exit non-zero when the checklist is `BLOCKED`; this is still a valid response for agents. Parse the JSON and follow `nextAction` or `commands` instead of retrying blindly.

## Idempotency

Use `--idempotency-key` for mutating commands in CI or repeated agent loops:

```bash
evopilot goal create \
  --project my-agent \
  --target my-agent-ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --idempotency-key "my-agent-ga-goal-2026-07-20" \
  --json
```

Mutating wrapper commands should use stable job or task identifiers when available.

## Goal Plan Approval Rules

Automation must treat the generated phase plan as a governed artifact. The normal path is:

```bash
evopilot target plan --project my-agent --template ga --objective "Enable tenant onboarding and lifecycle workflow visibility" --json
evopilot target plan export <goal-id> --format json > /tmp/my-agent-phase-plan.json
evopilot target plan diff <goal-id> --file /tmp/my-agent-phase-plan.json --json
evopilot target plan apply <goal-id> --file /tmp/my-agent-phase-plan.json --json
evopilot target plan approve <goal-id> --json
evopilot target run --project my-agent --template ga --objective "Enable tenant onboarding and lifecycle workflow visibility" --json
```

`target run` stops with `result.exitCode=2` and `nextAction=approve-plan` when the plan is still pending. Agents should show the phase plan to the user, not retry blindly. `--auto-approve-plan` is allowed only when the user or organization policy explicitly authorizes unattended acceptance of the generated Alpha -> Beta -> RC -> GA plan.

The plan must preserve Alpha, Beta, RC, and GA. Users may add project-specific GoalTargets or strengthen phase criteria, evidence, and review requirements. Removing baseline criteria or skipping a phase is blocked by the server and must be reported as a plan validation failure.

## Stop Conditions

If a command returns any of these `nextAction` values, the agent must stop and report the blocker:

```text
approve-plan
connect-github-account
connect-gitlab-account
human-approval
policy-review
configure-source-credentials
configure-llm
store-llm-secret
configure-llm-profile
repair-llm-provider
repair-project
repair-deploy-target
repair
```

The agent must also stop on:

```text
NO-GO
BLOCKED
FAILED
timeout
max-steps
max-iterations
```

Do not approve human gates, merge source, or deploy production changes unless the server state and the user's instruction explicitly allow that operation.

`connect-github-account` and `connect-gitlab-account` mean the project needs a user-owned or organization-owned SCM execution principal before writeback or repository-native DevOps can run. Do not retry the same wrapper command until the operator has connected the account/group and stored the tokenRef on the EvoPilot server or tenant/workspace secret vault.

## Token Rules

Do not pass raw GitHub or GitLab tokens in daily `target run`, `goal run`, or `loop run` commands.

Preferred pattern:

1. A production operator stores the real token in the EvoPilot server runtime or secret manager.
2. The token belongs to the GitHub/GitLab account, organization, group, service account, deploy token, or GitHub App principal that owns the target DevOps boundary.
3. The project stores only `tokenRef`.
4. The agent runs `project preflight` and `project devops preflight`.
5. The agent proceeds only when readiness is `READY`.

Example:

```bash
evopilot secret set \
  --id GITHUB_TOKEN_MY_AGENT \
  --kind source-token \
  --from-env GITHUB_TOKEN_MY_AGENT \
  --json

evopilot project credentials set my-agent \
  --token-ref GITHUB_TOKEN_MY_AGENT \
  --json

evopilot project preflight my-agent --json
```

If the result is `READ_ONLY` or `BLOCKED`, stop and ask the operator to repair server-side credentials.

For new projects, an agent can use the onboarding wrapper after the tokenRef exists:

```bash
evopilot project onboard plan github \
  --repo owner/my-agent \
  --id my-agent \
  --token-ref GITHUB_TOKEN_MY_AGENT \
  --execution-mode owned-repository \
  --devops-owner owner \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --template ga \
  --json
```

If the checklist returns `nextAction=store-secret`, run `secret set` from a trusted environment first. If it returns `nextAction=register-project`, continue with the mutating wrapper:

```bash
evopilot project onboard github \
  --repo owner/my-agent \
  --id my-agent \
  --token-ref GITHUB_TOKEN_MY_AGENT \
  --execution-mode owned-repository \
  --devops-owner owner \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --template ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --require-source-ready \
  --require-devops-ready \
  --json
```

## Native DevOps Rules

GitHub projects use GitHub Actions. GitLab projects use GitLab CI.

EvoPilot does not provide a default shared DevOps account or generic runner for third-party repositories. For a public upstream, use the operator's fork/account for `fork-validated-pr`, use maintainer credentials for `upstream-authorized`, or stay in `read-only-public`.

DevOps configuration commands must declare ownership:

```bash
evopilot project devops set my-agent \
  --provider github-actions \
  --execution-mode owned-repository \
  --devops-owner owner \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --json
```

The CLI intentionally rejects ambiguous DevOps setup. If an agent sees a usage error that mentions DevOps ownership, regenerate the command with `--execution-mode` and `--devops-owner`; for public upstream work also include `--upstream-repo` and `--working-repo`.

Before a release wrapper:

```bash
evopilot project devops preflight my-agent --json
```

If the result is not `READY`, either repair the project DevOps configuration or run the wrapper without claiming end-to-end release readiness. Use `--require-devops-ready` when release readiness must be enforced.

Claim rules by execution mode:

| executionMode | Agent May Claim | Agent Must Not Claim |
|---|---|---|
| `owned-repository` | Source writeback and native CI/CD in the owned working repository after READY preflight. | Third-party upstream release authority. |
| `read-only-public` | Repository inspection, analysis, blocker discovery. | PR, merge, CI/CD readiness, deployment, or release completion. |
| `fork-validated-pr` | Fork CI plus upstream PR readiness. | Upstream merge or upstream release completion. |
| `upstream-authorized` | Upstream writeback and release readiness after READY preflight. | Any action outside the token principal's permission scope. |

## Release Verdict Rules

Only EvoPilot release decisions can produce authoritative `GO`, `CONDITIONAL-GO`, or `NO-GO` conclusions:

```bash
evopilot release current --json
evopilot release decisions --project my-agent --target my-agent-ga --json
evopilot target decision my-agent-ga --project my-agent --json
```

Do not claim GA stable from:

- local tests alone
- CI success alone
- dashboard screenshots alone
- human-readable CLI text alone

## IDs To Record

Keep these IDs from JSON output when present:

```text
projectId
releaseTargetId
goalId
goalTargetId
loopId
sourceReleaseRunId
pipelineRunId
releaseDecisionId
auditId
requestId
```

These IDs are required for incident reports, release reviews, and replay.

## Incident Pack

When reporting a failed automation run, include:

- full CLI JSON output
- command line with secrets redacted
- exit code
- `EVOPILOT_SERVER`
- tenant/workspace/actor
- project and target IDs
- loop, release run, and release decision IDs
- relevant audit IDs
- production log `requestId` or `correlation` fields when available
- `llmUsage.summary` and any non-zero `llmUsage.server.steps[]`
- the CLI client surface, for example `workbuddy`, `mac-terminal`, `ci`, or `agent-or-script`

Do not include raw tokens, passwords, deploy secrets, or unredacted `Authorization` headers.

## Log Correlation

CLI wrapper output exposes `llmUsage.process.responses[].requestId` and recent `steps[].requestId`. EvoPilot structured logs expose the same request under `correlation.requestId`. When the CLI sends `--client workbuddy` or `EVOPILOT_CLI_CLIENT=workbuddy`, server logs also include caller metadata under `metadata.client` and request-level LLM token deltas under `metadata.llmUsage`.

Use these fields to prove that terminal CLI output, Dashboard state, and production server logs describe the same run.
