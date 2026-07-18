# EvoPilot CLI Guide

> Operator and AI-agent guide for running EvoPilot Goal and Loop targets from the command line.

Use this guide when WorkBuddy, Codex, Claude Code, CI jobs, release scripts, or an operator needs a fast path into an EvoPilot production control plane. The command reference remains in [docs/cli.md](cli.md).

## Fastest Path

Configure the target control plane:

```bash
export EVOPILOT_SERVER="https://evopilot.example.com"
export EVOPILOT_API_TOKEN="<operator-or-admin-token>"
export EVOPILOT_TENANT="tenant-production"
export EVOPILOT_WORKSPACE="workspace-agent-products"
export EVOPILOT_ACTOR="ai-agent-cli"
```

Verify the session before changing product state:

```bash
evopilot config show --json
evopilot status --json
```

Run one project toward GA with the wrapper command:

```bash
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Promote my-agent to GA stable with source closure, deployment evidence, release decision, and blocker review" \
  --until terminal \
  --max-steps 20
```

The command prints the same product chain the Dashboard exposes: project, release target, GlobalGoal, active GoalTarget, LoopRun, source closure, deploy, release decision, final report, evidence links, blockers, and next action.

## CLI Capability Model

EvoPilot CLI has two command layers.

| Layer | Purpose | Examples |
|---|---|---|
| Atomic commands | Low-level, scriptable, server-governed operations. | `target create`, `goal create`, `goal plan`, `goal advance`, `release current` |
| Wrapper commands | One command starts or resumes a Goal or Loop target by composing atomic operations. | `target run`, `goal run`, `loop run` |

Wrapper commands do not bypass server governance. They stop at human approval, policy review, source credential blockers, deploy blockers, repair actions, `NO-GO`, `BLOCKED`, `FAILED`, `--max-steps`, or `--timeout` boundaries.

## Wrapper Commands

### Run A Project To GA

Use `target run` when the project does not already have a project-scoped release target. EvoPilot resolves or creates the target, creates or resumes a GlobalGoal, generates and approves the server plan, then advances one GoalTarget at a time.

```bash
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Promote my-agent to GA stable with source closure, deployment evidence, release decision, and blocker review" \
  --until terminal \
  --max-steps 20
```

Use `--json` when an AI agent needs machine output:

```bash
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Promote my-agent to GA stable with source closure, deployment evidence, release decision, and blocker review" \
  --until terminal \
  --max-steps 20 \
  --json
```

### Run An Existing GlobalGoal

Use `goal run` when the release target already exists or a previous GlobalGoal should be resumed.

```bash
evopilot goal run \
  --project my-agent \
  --target my-agent-ga \
  --objective "Promote my-agent to GA stable" \
  --until terminal \
  --max-steps 20
```

Resume by id:

```bash
evopilot goal run goal-my-agent-ga-run --max-steps 20
```

### Run One LoopRun

Use `loop run` when the work is one concrete LoopRun rather than a GlobalGoal decomposed into GoalTargets.

```bash
evopilot loop run \
  --project my-agent \
  --target my-agent-rc \
  --objective "Fix RC release blockers and collect validation evidence" \
  --until blocked-or-complete \
  --max-iterations 10
```

Resume by id:

```bash
evopilot loop run loop-my-agent-rc --max-iterations 10
```

## What Wrapper Commands Do

A wrapper command may perform these server-governed steps:

1. Resolve or create the project release target.
2. Create or resume a GlobalGoal.
3. Generate the goal plan.
4. Approve the goal plan unless `--no-auto-approve-plan` or `--require-plan-approval` is set.
5. Advance one GoalTarget at a time.
6. Bind GoalTargets to LoopRuns.
7. Read `run-status`, `snapshot`, `graph`, `timeline`, `evidence-matrix`, and release decisions.
8. Stop at terminal, blocked, human approval, policy review, credential repair, deploy repair, release decision, or `NO-GO`.

Wrapper commands do not:

- bypass RBAC, tenant scope, or workspace scope.
- approve human gates by default.
- merge source changes without server approval.
- treat local tests or CI alone as GA.
- synthesize `GO` / `NO-GO` in the CLI.
- hide blockers from the operator.

## Console Output

Human-readable wrapper output is the default. It is designed to be a terminal version of the Dashboard workflow.

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
[RUNNING] GoalTarget - goal-my-agent-ga-run-source-closure-deploy / next=resume-loop
[RUNNING] LoopRun - goal-goal-my-agent-ga-run-source-closure-deploy-178... / iteration=2
[PLANNED] Source Closure - No source release run yet.
[PENDING] CI/CD + Deploy - No deploy finalizer yet.
[PENDING] Release Decision - No product-native release decision yet.
[NOT_READY] Final Report - Generated after GlobalGoal reaches terminal completion.

Next Action
resume-loop / blockers=0

Evidence
- snapshot: /api/v1/goals/goal-my-agent-ga-run/snapshot
- graph: /api/v1/goals/goal-my-agent-ga-run/graph
- evidence matrix: /api/v1/goals/goal-my-agent-ga-run/evidence-matrix
- release decision: pending

Result
RUNNING
```

Use `--quiet` to print only the final terminal summary. Use `--json` for automation.

## Equivalent Atomic Flow

The wrapper command is a product shortcut. The equivalent atomic flow is:

```bash
evopilot target create --project my-agent --template ga --idempotency-key target-my-agent-ga --json

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
evopilot goal evidence-matrix <goal-id> --json

evopilot goal advance <goal-id> --json
evopilot goal advance <goal-id> --json
evopilot goal advance <goal-id> --json

evopilot goal final-report <goal-id> --json
evopilot release current --json
```

AI agents should prefer the wrapper command for the first attempt and fall back to atomic commands when they need explicit step-level control.

## AI Agent Contract

AI agents must:

- use `--json` for machine parsing.
- record `projectId`, `targetId`, `goalId`, `activeTargetId`, `loopId`, `releaseRunId`, `releaseDecisionId`, and `auditId` when present.
- treat non-zero exit codes as stop conditions.
- stop on `human-approval`, `policy-review`, `configure-source-credentials`, `repair-project`, `repair-deploy-target`, `repair`, `BLOCKED`, `FAILED`, and `NO-GO`.
- read release verdicts from `release current`, `release decisions`, `target decision`, or `/api/v1/release/decisions`.

AI agents must not parse human-readable text, store secrets in committed files, assume ECS server paths exist locally, approve high-risk gates without explicit human instruction, or claim GA from local tests alone.

## Troubleshooting

| Symptom | Meaning | Action |
|---|---|---|
| `status` has health but no `summary` | The session is not authenticated. | Check token, server, tenant, and workspace. |
| `target run` stops at `configure-source-credentials` | Source writeback credentials are missing or read-only. | Configure project credentials, then rerun the same command. |
| `goal run` stops at `approve-plan` | Plan approval was required. | Review `goal graph` and `goal evidence-matrix`, then approve. |
| `goal run` stops at `human-approval` | A governed LoopRun is waiting for approval. | Approve only after a human review. |
| `goal run` stops at `policy-review` | Release policy blocked merge or promotion. | Inspect release run policy blockers. |
| `goal run` exits 2 after `--max-steps` | The run made progress but did not reach a terminal completion. | Rerun with the same arguments or inspect `run-status`. |
| `goal run` or `loop run` exits 2 after `--timeout` | The wrapper reached its operator-defined stop boundary before terminal completion. | Rerun with a longer timeout or inspect the JSON `steps` array for `timeout-reached`. |
| `release decision` is pending | The goal has not produced a product-native release verdict. | Run the required release evidence and read `/api/v1/release/decisions`. |
