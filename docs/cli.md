# EvoPilot CLI

> Atomic, scriptable access to the EvoPilot control plane for operators, CI jobs, release scripts, and external AI agents.

This document describes `@evopilot/cli` version `0.1.0`.

The CLI is an adapter over EvoPilot server APIs. It does not bypass RBAC, tenant/workspace scope, approval gates, source-closure preflight, release policy, deployment gates, or audit records. AI agents should use it as a set of atomic commands and let EvoPilot remain the system of record.

MCP-style semantic orchestration is out of scope for this CLI. Agents can still orchestrate workflows by composing CLI commands, but each command remains a server-governed operation.

For scenario-first usage, wrapper commands, and terminal workflow output, start with [docs/cli-guide.md](cli-guide.md). This file is the command reference.

## Fast Path For AI Agents

Use this path when an AI agent needs to connect to an ECS production EvoPilot instance and operate through the CLI.

### 1. Prepare The CLI

From this repository:

```bash
npm install
npm run build
npm run cli -- --version
```

After build, run the CLI with:

```bash
node packages/cli/dist/index.js --help
```

If the package is installed with its binary available on `PATH`, run:

```bash
evopilot --help
evopilot --version
```

### 2. Configure Production Access

Prefer environment variables for automated agents so tokens do not get written to shared project files.

```bash
export EVOPILOT_SERVER="https://evopilot.example.com"
export EVOPILOT_API_TOKEN="<operator-or-admin-token>"
export EVOPILOT_TENANT="tenant-production"
export EVOPILOT_WORKSPACE="workspace-agent-products"
export EVOPILOT_ACTOR="ai-agent-cli"
export EVOPILOT_CONFIG="$PWD/.evopilot-agent-config.json"
```

`EVOPILOT_BASE_URL` is also accepted as a server URL fallback. `--server`, `--token`, `--tenant`, `--workspace`, and `--actor` override both environment variables and saved config.

For username/password login, use:

```bash
evopilot auth login \
  --server "$EVOPILOT_SERVER" \
  --username "<username>" \
  --password "<password>" \
  --config "$EVOPILOT_CONFIG"
```

For short-lived agent sessions, use `--no-save` or pass `EVOPILOT_API_TOKEN` directly.

### 3. Verify The Connection

Agents must verify the control plane before mutating production state.

```bash
evopilot config show --json
evopilot status --json
```

Expected `status --json` signal:

- `health.status` is `UP`.
- `ready.status` is `READY`.
- `summary` is present when a token is configured.
- The command exits with code `0`.

If `summary` is missing, the command may have reached public health endpoints but not an authenticated control-plane session.

### 4. Use JSON For Automation

Automation must use `--json` and parse response fields instead of screen text.

```bash
evopilot worker queue --json
evopilot release current --json
evopilot goal list --json
evopilot audit list --limit 20 --json
```

Treat a non-zero exit code as a stop condition. Do not continue with source closure, merge, deploy, or release gates after a failed command unless a human explicitly decides the recovery path.

## Wrapper Commands

Wrapper commands provide the one-command Goal / Loop Target experience while preserving the atomic server-governed model. They compose existing CLI/API operations and print a Dashboard-like terminal chain by default. Use `--json` for AI agents and CI.

Run a project toward GA:

```bash
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Promote my-agent to GA stable with source closure, deployment evidence, release decision, and blocker review" \
  --until terminal \
  --max-steps 20
```

Run or resume a GlobalGoal:

```bash
evopilot goal run \
  --project my-agent \
  --target my-agent-ga \
  --objective "Promote my-agent to GA stable" \
  --until terminal \
  --max-steps 20
```

Run or resume one LoopRun:

```bash
evopilot loop run \
  --project my-agent \
  --target my-agent-rc \
  --objective "Fix RC release blockers and collect validation evidence" \
  --until blocked-or-complete \
  --max-iterations 10
```

Wrapper commands stop at `human-approval`, `policy-review`, source credential blockers, deploy blockers, `repair`, `NO-GO`, `BLOCKED`, `FAILED`, max-step limits, or `--timeout`. They do not approve human gates by default, do not merge source by default, and do not synthesize `GO` / `NO-GO` in the client.

## Agent Operating Contract

AI agents that read this document should follow these rules:

- Use CLI commands as atomic operations. Do not assume a multi-step workflow succeeded unless each command returns success and the server response confirms the state.
- Use `--json` for all machine-read commands.
- Use `--idempotency-key` for mutating commands in CI or agent loops.
- For RC/GA style objectives, create a `GlobalGoal`, generate and approve its server plan, inspect `snapshot` / `graph` / `timeline` / `evidence-matrix`, then call `goal advance` one step at a time.
- Treat `goal advance` as an atomic command. The server chooses the next GoalTarget, binds or advances the related LoopRun, and returns `nextAction`; the CLI does not embed semantic orchestration.
- Run preflight before source closure.
- Do not call `merge` or `auto-merge` unless review approval and release policy are satisfied by server state.
- Do not synthesize a `GO` or `GA stable` conclusion from local tests alone. Read release decisions from `/api/v1/release/decisions` through `release current`, `release decisions`, or `target decision`.
- Do not store secrets in committed files. Prefer env vars, secret references, or `--no-save`.
- Do not assume paths such as `/opt/evopilot` exist on the local machine. ECS deploy connector paths are resolved on the EvoPilot server host.
- Record command outputs and IDs in the agent log: project id, target id, loop id, release run id, release decision id, and audit id.

## Production Safety Boundary

The role required depends on the command:

| Role | Typical CLI Use |
|---|---|
| viewer | `status`, `project list`, `target list`, `goal list`, `goal snapshot`, `goal graph`, `release current`, `release-run list`, `worker queue`, `trace`, `audit list` |
| operator | `goal create`, `goal plan`, `goal approve-plan`, `goal advance`, `loop start`, `loop approve`, `worker claim`, `worker heartbeat`, `sandbox verify`, `replay run`, `release gate` |
| admin | `project register`, `project credentials set`, `target create`, `source-closure execute`, `source-closure merge`, `connector deploy create` |

Production source, merge, deployment, and release operations remain server-governed. The CLI only submits the request.

## ECS Production Notes

For the current self-hosted ECS-style deployment, the server-side checkout is commonly under `/opt/evopilot` and uses `docker-compose.prod.yml`. Treat that as a server-side deployment path, not a local CLI path.

When creating an ECS Docker Compose deploy connector, the `workingDir`, `composeFile`, and `serviceName` are evaluated by the EvoPilot server process:

```bash
evopilot connector deploy create \
  --id ecs-prod \
  --type ecs-docker-compose \
  --working-dir /opt/evopilot \
  --compose-file docker-compose.prod.yml \
  --service-name evopilot-server \
  --git-remote origin \
  --git-branch main \
  --git-pull true \
  --build true \
  --skip-compose-when-unchanged \
  --deploy-lock true \
  --rollback-on-failure true \
  --rollback-on-health-failure true \
  --idempotency-key connector-ecs-prod
```

Do not assume the production checkout is clean. Production hosts may contain local-only files such as `.env.production`, `.evopilot/`, deploy stamps, Docker files, or compose overrides. Deployment commands should preserve server-owned local state unless a human explicitly asks to change it.

## Common Production Workflows

### Inspect Production State

```bash
evopilot status --json
evopilot project list --json
evopilot target list --json
evopilot goal list --json
evopilot release current --json
evopilot worker queue --json
evopilot release-run repair-candidates --json
evopilot audit list --limit 20 --json
```

### Register A Source Project

GitHub project:

```bash
evopilot project register \
  --id my-agent \
  --name "My Agent" \
  --provider github \
  --repo owner/repo \
  --branch main \
  --token-ref GITHUB_TOKEN \
  --idempotency-key project-my-agent \
  --json
```

GitLab project:

```bash
evopilot project register \
  --id my-agent \
  --name "My Agent" \
  --provider gitlab \
  --git-url https://gitlab.example.com/group/my-agent.git \
  --branch main \
  --token-ref GITLAB_TOKEN \
  --idempotency-key project-my-agent \
  --json
```

Local Git project:

```bash
evopilot project register \
  --id my-agent \
  --name "My Agent" \
  --provider local-git \
  --root /path/on/evopilot-server/my-agent \
  --branch main \
  --idempotency-key project-my-agent \
  --json
```

For `local-git`, the path is resolved on the EvoPilot server host, not on the agent machine.

Verify credentials before any source writeback:

```bash
evopilot project preflight my-agent --json
```

`READY` means EvoPilot can perform the governed source operation. `READ_ONLY` or `BLOCKED` means the agent must stop or request credential repair.

### Create A Release Target

List templates:

```bash
evopilot target templates --json
```

Create project-scoped targets:

```bash
evopilot target create --project my-agent --template beta --idempotency-key target-my-agent-beta --json
evopilot target create --project my-agent --template rc --idempotency-key target-my-agent-rc --json
evopilot target create --project my-agent --template ga --idempotency-key target-my-agent-ga --json
```

Use custom criteria:

```bash
evopilot target create \
  --project my-agent \
  --id my-agent-ga-2026-q3 \
  --criteria release-targets/ga.json \
  --idempotency-key target-my-agent-ga-2026-q3 \
  --json
```

Release targets are project governance objects. The built-in `experimental`, `alpha`, `beta`, `rc`, and `ga` templates are not verdicts.

### Create And Advance A GlobalGoal

Use a GlobalGoal when the user objective is broader than one LoopRun, for example "take this project to RC" or "reach GA with evidence". The release target defines the governance profile; the GlobalGoal decomposes that objective into ordered GoalTargets; each GoalTarget may bind to a LoopRun.

Create the goal:

```bash
evopilot goal create \
  --project my-agent \
  --target my-agent-rc \
  --objective "Move my-agent to RC through source closure, deploy evidence, release decision, and blocker review" \
  --idempotency-key goal-my-agent-rc \
  --json
```

Generate and approve the server plan:

```bash
evopilot goal plan <goal-id> --json
evopilot goal approve-plan <goal-id> --json
```

Inspect the white-box state before advancing:

```bash
evopilot goal inspect <goal-id> --json
evopilot goal targets <goal-id> --json
evopilot goal snapshot <goal-id> --json
evopilot goal graph <goal-id> --json
evopilot goal timeline <goal-id> --json
evopilot goal evidence-matrix <goal-id> --json
```

Advance one atomic server-governed step:

```bash
evopilot goal advance <goal-id> --json
```

Useful variants:

```bash
evopilot goal advance <goal-id> --no-auto-start --json
evopilot goal advance <goal-id> --approve-human-gate --json
evopilot goal advance <goal-id> --force-decision <decision> --json
```

Agents should parse `status`, `nextAction`, `target`, `loop`, `snapshot`, and `stages` from the JSON response. Common `nextAction` values include `plan-goal`, `approve-plan`, `start-target`, `resume-loop`, `human-approval`, `configure-source-credentials`, `repair-project`, `repair-deploy-target`, `policy-review`, `release-decision`, `view-final-report`, `done`, and `repair`. Stop at `human-approval`, `repair`, `policy-review`, or credential/deploy/project repair actions unless a human has explicitly authorized the recovery path.

Read the completion report only after the goal reaches a terminal state:

```bash
evopilot goal final-report <goal-id> --json
```

### Push Evidence

Events array:

```json
[
  {
    "type": "agent.step",
    "source": "ai-agent",
    "message": "p95 latency exceeded target",
    "attributes": { "durationMs": 3500 }
  }
]
```

Push:

```bash
evopilot evidence push \
  --project my-agent \
  --file evidence/events.json \
  --idempotency-key evidence-my-agent-2026-07-10T030000Z \
  --json
```

The file can also contain a full request body with `projectId`, `events`, `signals`, `files`, and `now`.

### Create And Start A Loop

```bash
evopilot loop create \
  --project my-agent \
  --target my-agent-rc \
  --objective "Fix RC release blockers" \
  --idempotency-key loop-my-agent-rc \
  --json
```

Start or approve:

```bash
evopilot loop start <loop-id> --json
evopilot loop approve <loop-id> --json
```

### Run Source Closure

Create a source-closure file for a production release loop:

```json
{
  "sourceProjectId": "my-agent",
  "repositoryProvider": "github",
  "sourceBranch": "main",
  "targetVersion": "my-agent-rc",
  "releaseStrategy": "github-push",
  "requiredGates": ["code-change", "push", "deploy", "health-ready"],
  "deploymentEnvironment": "production",
  "deploymentConnectorId": "ecs-prod"
}
```

Create the loop with the source-closure contract:

```bash
evopilot loop create \
  --project my-agent \
  --target my-agent-rc \
  --objective "Close source and production gates for my-agent RC" \
  --source-closure source-closure.json \
  --idempotency-key loop-my-agent-rc-source-closure \
  --json
```

Preflight:

```bash
evopilot source-closure preflight <loop-id> --json
```

Execute only after preflight passes:

```bash
evopilot source-closure execute <loop-id> \
  --branch evopilot/my-agent-rc \
  --message "EvoPilot source closure for my-agent RC" \
  --deploy-connector ecs-prod \
  --health-url https://evopilot.example.com/health \
  --ready-url https://evopilot.example.com/ready \
  --write-file docs/release-evidence.md:./release-evidence.md \
  --idempotency-key source-closure-my-agent-rc \
  --json
```

For advanced execution payloads:

```bash
evopilot source-closure execute <loop-id> --payload source-closure-execute.json --json
```

Review decisions:

```bash
evopilot source-closure approve-release <loop-id> --json
evopilot source-closure reject-release <loop-id> --reason "release evidence is incomplete" --json
evopilot source-closure merge <loop-id> --message "Merge EvoPilot release closure" --json
evopilot source-closure auto-merge <loop-id> --post-merge-deploy false --json
```

Merge and auto-merge are still guarded by server-side review status, release policy, SCM capabilities, and post-merge deploy checks.

### Inspect And Repair Release Runs

```bash
evopilot release-run list --json
evopilot release-run list --loop <loop-id> --json
evopilot release-run inspect <run-id> --loop <loop-id> --json
evopilot release-run finalizers --json
evopilot release-run finalizers --status PENDING --json
```

Repair commands operate on server-discovered repair candidates:

```bash
evopilot release-run repair-candidates --json
evopilot release-run repair-candidates --include-repaired --json
evopilot release-run repair <run-id> --json
evopilot release-run repair-all --json
evopilot release-run repair-all --execute --repair-request repair.json --json
```

A healthy promoted run normally produces an empty repair queue.

### Operate Loop Runtime

Worker queue and lease:

```bash
evopilot worker queue --json
evopilot worker leases --json
evopilot worker claim --worker-id ai-agent-worker --json
evopilot worker claim --worker-id ai-agent-worker --loop <loop-id> --lease-seconds 120 --json
evopilot worker heartbeat --worker-id ai-agent-worker --loop <loop-id> --lease-seconds 120 --json
```

Sandbox proof:

```bash
evopilot sandbox proof <loop-id> --json
evopilot sandbox verify <loop-id> --json
```

Replay and trace:

```bash
evopilot replay checkpoints <loop-id> --json
evopilot replay run <loop-id> --from-iteration 1 --context-patch replay-context.json --json
evopilot trace tree <loop-id> --json
evopilot trace events <loop-id> --json
```

Audit:

```bash
evopilot audit list --limit 20 --json
```

### Generate A Release Gate Decision

```bash
evopilot release gate \
  --project my-agent \
  --target my-agent-rc \
  --scenario beta-core-flow=PASS \
  --scenario ci-cd-pass=PASS \
  --scenario manual-approval=PASS \
  --idempotency-key release-gate-my-agent-rc \
  --json
```

Read release decisions:

```bash
evopilot release current --json
evopilot release decisions --project my-agent --target my-agent-rc --json
evopilot target decision my-agent-rc --project my-agent --json
```

## Configuration Reference

Login stores local config at `~/.evopilot/config.json` unless `--no-save` or a custom `--config` path is used.

```bash
evopilot auth login \
  --server http://127.0.0.1:19876 \
  --username tenant-admin \
  --password change-me
```

Inspect local configuration without exposing the token:

```bash
evopilot config path
evopilot config show
evopilot config show --json
```

Print the configured token only when needed:

```bash
evopilot auth token
evopilot auth token --json
```

Global flags:

```text
--server <url>
--token <token>
--tenant <tenant-id>
--workspace <workspace-id>
--actor <member-id>
--idempotency-key <key>
--json
--config <file>
```

The CLI sends tenant/workspace/actor as EvoPilot scope headers and sends mutating idempotency keys as `X-Idempotency-Key`.

## Command Reference

```text
auth login
auth token
config path
config show
version
status
project register
project list
project preflight
project credentials set
evidence push
target templates
target list
target create
target run
target decision
goal create
goal list
goal inspect
goal plan
goal approve-plan
goal targets
goal advance
goal run
goal snapshot
goal graph
goal timeline
goal evidence-matrix
goal final-report
loop create
loop list
loop start
loop approve
loop run
source-closure preflight
source-closure execute
source-closure approve-release
source-closure reject-release
source-closure merge
source-closure auto-merge
release-run list
release-run inspect
release-run repair-candidates
release-run repair
release-run repair-all
release-run finalizers
worker queue
worker leases
worker claim
worker heartbeat
sandbox proof
sandbox verify
replay checkpoints
replay run
trace tree
trace events
audit list
connector deploy list
connector deploy create
release gate
release current
release decisions
```

## Troubleshooting

| Symptom | Meaning | Action |
|---|---|---|
| `status` shows health but no `summary` | The server is reachable, but the session is unauthenticated or unauthorized. | Check `EVOPILOT_API_TOKEN`, login config, tenant/workspace, and role. |
| `project preflight` returns `READ_ONLY` | EvoPilot can read but cannot write source. | Configure token or tokenRef with `project credentials set`. |
| `project preflight` returns `BLOCKED` | Source credentials or project binding are not ready. | Read blockers in JSON, then repair credentials or project registration. |
| `goal advance` returns `plan-goal` | The GlobalGoal does not have an approved plan. | Run `goal plan`, review the generated GoalTargets, then run `goal approve-plan`. |
| `goal advance` returns `human-approval` | The active GoalTarget is waiting at a governed human gate. | Stop automation or rerun with `--approve-human-gate` only after explicit approval. |
| `goal final-report` returns pending | The GlobalGoal is not terminal yet. | Inspect `goal snapshot`, `goal graph`, and `goal evidence-matrix` to find the active target or blocker. |
| `source-closure preflight` fails | Server-side source/deploy/health gates are not ready. | Do not execute closure; repair the blocker first. |
| `release-run repair-candidates` is empty | No currently repairable failed release run exists. | Inspect latest release run and release decisions. |
| `worker queue` shows `claimable=true` | A loop is ready for a worker to advance. | Claim it with a worker id or ensure production worker is running. |
| `worker queue` shows terminal source-closure guard | The loop has already passed or blocked source closure side effects. | Inspect `release-run list --loop <loop-id>` before retrying. |
| `merge` or `auto-merge` returns policy error | Release policy blocked the merge. | Stop and inspect release-run policy blockers. |
| ECS connector fails with path errors | `workingDir` is wrong on the EvoPilot server host. | Verify the server-side checkout path and compose file. |

## Validation

The CLI implementation is covered by the functional test suite:

```bash
npm run build -w @evopilot/cli
node --test tests/functional/global-goal.test.mjs
node --test tests/functional/cli.test.mjs
npm run test:functional
npm run check
```

The full `npm run check` path builds all workspaces, runs unit/smoke/functional/e2e tests, verifies production assets, verifies open-source governance, and runs `npm audit --audit-level=high`.
