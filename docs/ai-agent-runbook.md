# AI Agent Runbook

> Production runbook for WorkBuddy, Codex, Claude Code, CI jobs, and other AI agents that operate EvoPilot through the CLI.

Use this file as the agent entrypoint. It gives the shortest safe path first, then the atomic fallback commands and the log evidence needed to troubleshoot a production run.

EvoPilot is the system of record. The CLI submits server-governed requests; it does not bypass RBAC, tenant/workspace scope, approval gates, source-closure preflight, release policy, deployment gates, audit records, or final release decisions.

## Fast Path

Configure access with environment variables. Prefer env vars over saved config for automated agents.

```bash
export EVOPILOT_SERVER="https://evopilot.example.com"
export EVOPILOT_API_TOKEN="<operator-or-admin-token>"
export EVOPILOT_TENANT="tenant-production"
export EVOPILOT_WORKSPACE="workspace-agent-products"
export EVOPILOT_ACTOR="workbuddy"
```

Verify the control plane before making changes:

```bash
evopilot config show --json
evopilot status --json
```

Run one project toward GA with one command:

```bash
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Promote my-agent to GA stable with source closure, deployment evidence, release decision, and blocker review" \
  --until terminal \
  --max-steps 20 \
  --json
```

Run one project toward RC:

```bash
evopilot target run \
  --project my-agent \
  --template rc \
  --objective "Move my-agent to RC with source-readiness, source closure, deploy evidence, and release blocker review" \
  --until terminal \
  --max-steps 20 \
  --json
```

Run an alpha target:

```bash
evopilot target run \
  --project my-agent \
  --template alpha \
  --objective "Reach alpha readiness with a visible goal plan, loop evidence, and blockers listed" \
  --until terminal \
  --max-steps 10 \
  --json
```

## End-To-End GitHub Project Loop Target

Use this section when an AI agent needs to operate a GitHub project from onboarding to a governed Loop Target. The short rule is:

```text
Register or repair project -> preflight source credentials -> run target -> stop on blockers -> inspect release decision
```

The GitHub token is not passed in the daily `target run` command. A writable token must be available to the EvoPilot server process through a server-side environment variable or secret manager, and the project stores only a `tokenRef`.

### Scenario 1: Read-Only Public Repository

Use this when the operator only wants repository analysis, target decomposition, evidence review, or blocker discovery. Public GitHub repositories can be registered without a token:

```bash
evopilot project register \
  --id public-agent \
  --provider github \
  --repo owner/public-agent \
  --branch main \
  --json

evopilot project preflight public-agent --json
```

Expected result:

```json
{
  "status": "READ_ONLY",
  "nextAction": "configure-token-ref"
}
```

Agents may continue with read-only inspection, but must not claim that source writeback, PR, merge, or deployment is ready. A later `target run` may stop at `configure-source-credentials`.

### Scenario 2: Real PR To A Writable Fork Or Repository

Use this when EvoPilot must create branches, commits, and PRs. For open-source upstream repositories, register a fork or a repository where the configured token has write permission. EvoPilot cannot bypass GitHub permissions.

First, the production operator configures a token in the EvoPilot server environment, not in the WorkBuddy command:

```bash
# On the EvoPilot server runtime, for example ECS .env.production or a secret manager.
GITHUB_WRITE_TOKEN_MY_AGENT=<github-token-with-repo-write>
```

Restart the EvoPilot server and workers after changing server-side environment variables. Then register the writable project from any machine that can reach the production control plane:

```bash
evopilot project register \
  --id my-agent \
  --provider github \
  --repo yeliang-wang/my-agent-fork \
  --branch main \
  --token-ref GITHUB_WRITE_TOKEN_MY_AGENT \
  --idempotency-key project-my-agent \
  --json

evopilot project preflight my-agent --json
```

Expected result before a real PR run:

```json
{
  "status": "READY",
  "nextAction": "write-source"
}
```

Only after `READY`, run the one-command target:

```bash
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Promote my-agent to GA stable with source closure, deployment evidence, release decision, and blocker review" \
  --until terminal \
  --max-steps 20 \
  --json
```

### Scenario 3: Repair An Existing Registered Project

Use this when `project list` shows `credentialsConfigured=false`, or `project preflight` returns `READ_ONLY` / `configure-token-ref`.

```bash
evopilot project credentials set my-agent \
  --token-ref GITHUB_WRITE_TOKEN_MY_AGENT \
  --json

evopilot project preflight my-agent --json
```

If the result is still `READ_ONLY`, the tokenRef is stored but the EvoPilot server process cannot resolve the environment variable. Stop and ask the operator to repair the server-side secret or restart the runtime. Do not retry source closure with the same blocker.

### Scenario 4: DevOps, CI, CD, And Release Closure

A successful source-to-release loop needs more than a GitHub token. Agents should verify each boundary before claiming an end-to-end result.

| Boundary | What EvoPilot Uses | How To Check |
|---|---|---|
| SCM writeback | GitHub token or tokenRef with repository write permission. | `evopilot project preflight <project-id> --json` returns `READY`. |
| Source closure | Loop source-closure contract and release run state. | `evopilot source-closure preflight <loop-id> --json` returns no blockers. |
| CI | GitHub Actions, Jenkins, GitLab CI, or a project connector. | Inspect pipeline or release-run evidence; do not infer from local tests only. |
| CD | Deploy connector such as `ecs-docker-compose`, webhook, K8s, or cloud deployer. | `evopilot connector deploy list --json` shows the required connector. |
| Health gate | Deployment health and readiness URLs or connector-provided probe URLs. | Release run gates include health/ready evidence. |
| Release decision | Product-native release evidence and policy. | `evopilot release decisions --project <project-id> --target <target-id> --json`. |

Common production checks:

```bash
evopilot project preflight my-agent --json
evopilot connector deploy list --json
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Promote my-agent to GA stable with source closure, deployment evidence, release decision, and blocker review" \
  --until terminal \
  --max-steps 20 \
  --json
```

If `target run` stops with `configure-source-credentials`, run `project preflight` and repair tokenRef. If it stops with `repair-deploy-target`, inspect or create the deploy connector. If it stops with `policy-review`, inspect the release run and do not merge until the server-side policy allows it. If it returns `NO-GO`, stop and report the release decision as authoritative.

### Security Rules For Agents

- Do not pass raw GitHub tokens in `target run`.
- Prefer server-side `tokenRef` over inline `--source-token`.
- Do not write secrets to committed files or evidence artifacts.
- Do not continue after `READ_ONLY`, `BLOCKED`, `configure-source-credentials`, or `repair-deploy-target` without explicit operator repair.
- Record the `projectId`, `goalId`, `loopId`, `releaseRunId`, `releaseDecisionId`, and `requestId` from JSON output.

## Command Model

EvoPilot CLI has two layers:

| Layer | Use It For | Examples |
|---|---|---|
| Wrapper commands | One-command project/goal/loop execution for agents and operators. | `target run`, `goal run`, `loop run` |
| Atomic commands | Step-level inspection, recovery, and explicit governance actions. | `goal plan`, `goal approve-plan`, `goal advance`, `source-closure preflight`, `release decisions` |

Wrapper commands compose atomic commands but still stop at server guardrails.

## Wrapper Stop Conditions

Agents must stop and report when any of these are returned:

| Stop Condition | Meaning | Next Action |
|---|---|---|
| `human-approval` | A governed human gate is waiting. | Ask the operator; do not self-approve. |
| `policy-review` | Release or merge policy blocked progress. | Inspect release run policy blockers. |
| `configure-source-credentials` | Source writeback credentials are missing or read-only. | Ask for credential repair. |
| `repair-project` | Project binding is incomplete or invalid. | Inspect project settings and preflight. |
| `repair-deploy-target` | Deploy connector or health/ready target is not valid. | Repair connector settings. |
| `repair` | The loop or release run needs a repair path. | Inspect trace, release runs, and audit. |
| `NO-GO` | Authoritative release verdict is negative. | Stop; do not reinterpret local tests as GA. |
| `BLOCKED` / `FAILED` | EvoPilot cannot continue automatically. | Build an incident pack. |
| `--max-steps` / `--max-iterations` / `--timeout` | Agent-defined boundary reached. | Rerun or switch to atomic inspection. |

## IDs To Record

Always keep these IDs from CLI JSON output when present:

```text
projectId
targetId
releaseTargetId
goalId
activeTargetId
loopId
releaseRunId
releaseDecisionId
requestId
auditId
```

The most useful JSON fields are usually:

```text
schema
command
until
result.exitCode
result.status
result.nextAction
result.goalId
result.activeTargetId
result.latestLoopId
result.releaseDecision
status.goal.id
status.goal.projectId
status.goal.releaseTargetId
status.chain
status.blockers
steps
```

Do not parse human-readable CLI text. Use `--json` and parse fields.

## Atomic Fallback

Use this path when a wrapper stops or when the agent needs white-box step control.

```bash
evopilot target create \
  --project my-agent \
  --template ga \
  --idempotency-key target-my-agent-ga \
  --json

evopilot goal create \
  --project my-agent \
  --target my-agent-ga \
  --objective "Promote my-agent to GA stable with source closure, deployment evidence, release decision, and blocker review" \
  --idempotency-key goal-my-agent-ga \
  --json

evopilot goal plan <goal-id> --json
evopilot goal approve-plan <goal-id> --json

evopilot goal snapshot <goal-id> --json
evopilot goal graph <goal-id> --json
evopilot goal timeline <goal-id> --json
evopilot goal evidence-matrix <goal-id> --json

evopilot goal advance <goal-id> --json
evopilot goal final-report <goal-id> --json
evopilot release decisions --project my-agent --target my-agent-ga --json
evopilot target decision my-agent-ga --project my-agent --json
```

For one concrete LoopRun:

```bash
evopilot loop run \
  --project my-agent \
  --target my-agent-rc \
  --objective "Fix RC blockers and collect release evidence" \
  --until blocked-or-complete \
  --max-iterations 10 \
  --json
```

If the loop stops before source closure:

```bash
evopilot trace tree <loop-id> --json
evopilot trace events <loop-id> --json
evopilot worker queue --json
evopilot audit list --limit 50 --json
```

If source closure is involved:

```bash
evopilot project preflight my-agent --json
evopilot source-closure preflight <loop-id> --json
evopilot release-run list --loop <loop-id> --json
evopilot release-run repair-candidates --json
```

## Console Output

Without `--json`, wrapper commands print a Dashboard-like terminal chain:

```text
EvoPilot Goal Run
Command    target run
Scope      tenant-production / workspace-agent-products
Project    my-agent
Target     my-agent-ga
Goal       goal-my-agent-ga-run
Status     RUNNING
Progress   2/6 required (33%)

Workflow
[OK] Project - my-agent
[OK] Release Target - my-agent-ga / GA Release
[RUNNING] GlobalGoal - goal-my-agent-ga-run / 2/6 required targets
[RUNNING] GoalTarget - source-closure-deploy / next=resume-loop
[RUNNING] LoopRun - loop-my-agent-ga-source-closure / iteration=2
[PLANNED] Source Closure - No source release run yet.
[PENDING] CI/CD + Deploy - No deploy finalizer yet.
[PENDING] Release Decision - No product-native release decision yet.
[NOT_READY] Final Report - Generated after GlobalGoal reaches terminal completion.

Next Action
resume-loop / blockers=0

Evidence
- snapshot: /api/v1/goals/<goal-id>/snapshot
- graph: /api/v1/goals/<goal-id>/graph
- evidence matrix: /api/v1/goals/<goal-id>/evidence-matrix
- release decision: pending
```

This output is for humans. Agents should use `--json`.

## Production Logs

EvoPilot server and Loop worker logs use JSON Lines with:

```text
schema=="evopilot-log/v1"
service=="evopilot"
category in ["http","runtime","release","worker","code-upgrade","cicd","audit","system"]
correlation.requestId
correlation.goalId
correlation.loopId
correlation.projectId
correlation.releaseTargetId
correlation.releaseRunId
correlation.releaseDecisionId
tenantId
workspaceId
actor
routeGroup
outcome
errorCode
latencyBucket
diagnosis.summary
diagnosis.likelyCause
diagnosis.recommendedAction
```

Log queries:

```bash
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .correlation.requestId=="<request-id>")'
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .correlation.goalId=="<goal-id>")'
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .correlation.loopId=="<loop-id>")'
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .correlation.releaseRunId=="<release-run-id>")'
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .outcome=="failed")'
journalctl -u evopilot-worker -o cat | jq 'select(.schema=="evopilot-log/v1" and (.event|startswith("loop-worker.")))'
```

If EvoPilot runs in Docker Compose, replace `journalctl` with:

```bash
docker compose -f docker-compose.prod.yml logs --no-color evopilot-server
docker compose -f docker-compose.prod.yml logs --no-color evopilot-loop-worker
```

## Incident Pack

When a production agent cannot continue, collect:

```text
1. Full CLI JSON output from the failed wrapper or atomic command.
2. The HTTP `x-request-id` or `correlation.requestId`.
3. Logs with the same requestId, goalId, loopId, releaseRunId, or releaseDecisionId.
4. `evopilot goal snapshot <goal-id> --json`.
5. `evopilot goal graph <goal-id> --json`.
6. `evopilot goal evidence-matrix <goal-id> --json`.
7. `evopilot trace tree <loop-id> --json` when a loop exists.
8. `evopilot release decisions --project <project-id> --target <target-id> --json`.
9. `evopilot audit list --limit 50 --json`.
10. `/health`, `/ready`, and recent deployment/configuration changes.
```

Ask the diagnosing AI to prioritize `correlation.*`, `tenantId`, `workspaceId`, `routeGroup`, `outcome`, `errorCode`, `latencyBucket`, `diagnosis`, trace tree, release decisions, and audit. Do not infer the release verdict from scattered logs.

## Forbidden Behavior

AI agents must not:

- parse human text when `--json` is available.
- synthesize `GO`, `NO-GO`, `GA stable`, or `RC ready` from local tests alone.
- bypass human gates, source credential blockers, release policy, or deployment gates.
- store tokens, passwords, or credentials in committed files.
- assume `/opt/evopilot` or any ECS path exists on the agent machine.
- mutate the standalone Dashboard repository when the task is EvoPilot backend/CLI operation.
- read or write EvoPilot database files directly.

## References

- [CLI Manual](cli-manual.md)
- [CLI Reference](cli-reference.md)
- [API Reference](api-reference.md)
- [Deployment](deployment.md)
- [Troubleshooting](troubleshooting.md)
- [Dashboard Integration](dashboard-integration.md)
