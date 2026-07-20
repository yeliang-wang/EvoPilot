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
export EVOPILOT_CONFIG="$PWD/.evopilot-agent-config.json"
```

Use a job-local `EVOPILOT_CONFIG` when an agent should not write to `~/.evopilot/config.json`.

## Machine Output

Automation must use `--json` and parse JSON fields:

```bash
evopilot status --json
evopilot project onboard plan github --repo owner/my-agent --id my-agent --token-ref GITHUB_TOKEN_MY_AGENT --ci-workflow ci.yml --ci-required-check build --template ga --json
evopilot target run --project my-agent --template ga --objective "..." --json
```

Do not parse human-readable CLI output. Human output may change to improve operator readability.
When humans do read the console output, wrapper commands print the same core chain that Dashboard consumes: scope, project, release target, goal, workflow nodes, next action, evidence endpoints, recent steps, blockers, and `requestId` values for log lookup.

`project onboard plan` and `project onboard verify` are the onboarding control surface for automation. Both print `evopilot-project-onboarding-checklist/v1`; the checklist contains machine-readable `steps`, `missingInputs`, `blockers`, `commands`, and `nextAction`. `plan` does not mutate project state. `verify` reads persisted project state and should return `READY_TO_RUN` before an agent claims that source writeback and repository-native DevOps are ready.

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
  --objective "Promote my-agent to GA" \
  --idempotency-key "my-agent-ga-goal-2026-07-20" \
  --json
```

Mutating wrapper commands should use stable job or task identifiers when available.

## Stop Conditions

If a command returns any of these `nextAction` values, the agent must stop and report the blocker:

```text
human-approval
policy-review
configure-source-credentials
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

## Token Rules

Do not pass raw GitHub or GitLab tokens in daily `target run`, `goal run`, or `loop run` commands.

Preferred pattern:

1. A production operator stores the real token in the EvoPilot server runtime or secret manager.
2. The project stores only `tokenRef`.
3. The agent runs `project preflight` and `project devops preflight`.
4. The agent proceeds only when readiness is `READY`.

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
  --ci-workflow ci.yml \
  --ci-required-check build \
  --template ga \
  --objective "Promote my-agent to GA stable" \
  --require-source-ready \
  --require-devops-ready \
  --json
```

## Native DevOps Rules

GitHub projects use GitHub Actions. GitLab projects use GitLab CI.

Before a release wrapper:

```bash
evopilot project devops preflight my-agent --json
```

If the result is not `READY`, either repair the project DevOps configuration or run the wrapper without claiming end-to-end release readiness. Use `--require-devops-ready` when release readiness must be enforced.

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

Do not include raw tokens, passwords, deploy secrets, or unredacted `Authorization` headers.
