# EvoPilot Loop Runtime

## Status

Accepted

## Context

Loop Engineering requires more than a single agent call. EvoPilot must keep long-running tasks alive across iterations, validate each round independently, persist evidence and artifacts, decide whether to continue or stop, recover from worker interruption, and hand high-risk steps to human approval.

Loop Runtime is the continuity and execution substrate of EvoPilot's continuous evolution control plane. The product model is described in [continuous-evolution-control-plane.md](continuous-evolution-control-plane.md). It is based on the Loop Engineering layers:

- Sandbox: executor boundaries for code upgrade, CI/CD, validators, approval, and release actions.
- Context: durable loop state, evidence sets, artifacts, and cross-iteration timeline.
- Harness: API control plane, RBAC, approval, audit, watchdog, heartbeat leases, and retry/stop policy.
- Loop: repeated continuation decisions with stop, retry, backoff, circuit breaker, remediation, and release verdicts.

## Decision

EvoPilot owns a first-class `Loop Runtime` bounded context.

The runtime introduces:

- `LoopRun` as the durable long-task aggregate.
- `LoopIteration` as the per-round execution record.
- `LoopEvidenceSet` as independent validation output.
- `ExecutorGraph` as the explicit multi-executor orchestration model.
- `ExecutorAdapter` as the plugin boundary that turns typed executor graph nodes and edges into structured execution contracts.
- `LoopStoreRuntime` as the store contract for file, SQLite, or Postgres deployments, including lock-provider and idempotent replay semantics.
- `LoopSandboxPolicy` as the per-loop sandbox contract for host, Docker, or Kubernetes execution boundaries.
- `LoopSourceClosure` as the executable source-to-production state machine binding each target loop to the source repository, branch, target version, release strategy, required gates, gate evidence, SCM artifacts, and deployment environment.
- `ExecutorCoordinationPlan` as the explicit multi-executor input/output schema, dependency, and serial/parallel coordination record.
- `LoopTraceSummary` as the control-plane trace for executor steps, worker lease, watchdog, cost, and failure signatures.
- `StopPolicy` and `RetryPolicy` as data, not hard-coded control flow.
- worker heartbeat leases and watchdog recovery.
- timeline, evidence, artifact, approval, and audit APIs.
- per-step sandbox workspace paths under `loop-workspaces`.
- standalone `loop-worker` and `loop-soak` scripts.
- Feishu and WeCom webhook adapters that create `LoopRun` entries through the same control plane.

Existing release, evolution, conversation, and target-loop entry points can remain product-specific surfaces, but the common execution substrate is `/api/v1/loops`.

`ExecutorAdapter` is the runtime contract between graph orchestration and concrete executors. Each adapter receives the loop, node, iteration, retry context, workspace path, and force-decision policy; it returns a structured status, output, evidence, optional completion time, and optional failure signature. Built-in adapters cover LLM context building, code-upgrader execution, CI validation, independent validation, approval, and release action boundaries. A graph node can pin a specific adapter through `config.adapterId`; otherwise EvoPilot resolves the default adapter for the node type.

Every target loop carries a `sourceClosure` state machine. The contract records the registered source project, repository provider, Git URL or server-local root, branch, target version, release strategy, required gates such as `code-change`, `push`, `tag`, `deploy`, and `health-ready`, deployment environment, `closureState`, per-gate evidence, and SCM artifacts. If the caller does not provide it, EvoPilot derives the source identity from the registered project repository.

`GET|POST /api/v1/loops/{loopId}/source-closure/preflight` is the non-mutating readiness boundary. It verifies project binding, provider support, GitHub/GitLab token or tokenRef resolution, source branch readability, deploy target, and health-ready inputs before any branch or file write. `POST` records `evopilot-source-closure-preflight` evidence and timeline entries, and autopilot runs this gate before source writeback.

`POST /api/v1/loops/{loopId}/source-closure/execute` is the executable boundary for GitHub, GitLab, and local Git repositories. It uses the registered project credentials or local `repository.root` to create a release branch, commit requested files, open a PR or MR for remote providers, create a tag when required, invoke a configured deploy connector, probe health/ready endpoints, and write the resulting branch, commit, PR/MR or local review URL, tag, deployment, rollback, gate evidence, audit event, and independent evidence set back into the `LoopRun`. Each execution also persists an `evopilot-source-release-closure-run/v1` record under `GET /api/v1/source-release-runs`, with stages, review status, release policy status, safe auto-merge state, post-merge deployment status, merge status, next action, capabilities, source ref, artifacts, and status. `GET /api/v1/source-release-runs/repair-candidates` and `POST /api/v1/source-release-runs/repair-candidates/repair` turn failed or stale release runs into a durable repair queue. Repair candidates are derived from persisted release-run state, not from Dashboard-only memory, and a repair attempt re-enters the same source-closure executor path so SCM, deployment, policy, audit, and evidence semantics remain identical to the original release. `POST /api/v1/loops/{loopId}/source-closure/review-decision` is the approval, policy, and merge boundary: it records approve/reject decisions, evaluates release policy gates before merge, blocks unsafe merges with persisted blockers, calls GitHub PR merge, GitLab MR merge, or local `git merge --no-ff`, writes the merge commit back into the same release run, and can run deploy/health closure again after merge. Executor steps also repeat the same `sourceClosure` so a loop cannot silently become a status-only success without a source repository and production-delivery boundary.

Deploy connectors are separate runtime connectors. The built-in connector types are `http-webhook` and `ecs-docker-compose`. The webhook connector sends a structured deploy request with loop, project, source, branch, commit, tag, PR/MR, environment, and parameters; the external deployer returns deployment and probe URLs, and can expose a `rollbackUrl` for health-failure rollback. The ECS Docker Compose connector executes a bounded server-side sequence in a configured `workingDir`: read the current commit, optionally `git pull --ff-only`, read the deployed commit, then run `docker compose -f <composeFile> up -d --build [serviceName]`. Commands are passed as argument arrays rather than shell strings, and command output is stored as deploy evidence. ECS connectors default to a file lock under `.evopilot/deploy-locks`, an idempotency stamp under `.evopilot/deploy-stamps`, rollback on compose failure, and rollback on post-deploy health/ready failure by resetting to the pre-deploy commit and rerunning compose. K8s/cloud rollout implementations should attach behind this connector boundary with their own credentials, idempotency, rollback, and approval semantics instead of being hard-coded into source closure.

Dashboard loop orchestration is a productized control plane surface, not a separate script. `GET /api/v1/loop-orchestration/presets` exposes standard closed-loop presets and `POST /api/v1/loop-orchestration/instantiate` creates a source-to-production loop with a typed executor graph, Docker sandbox enforcement, worker/watchdog continuity, source closure, deployment connector binding, and health-ready rollback semantics.

Target-loop backlog is the next control-plane layer above a single LoopRun. `GET /api/v1/loop-orchestration/targets` maps product-evolution work into Sandbox, Context, Harness, and Loop targets with acceptance criteria, status, next action, and evidence. `POST /api/v1/loop-orchestration/advance` creates or advances a Codex-backed target loop and stops at explicit human approval or source-closure boundaries. `POST /api/v1/loop-orchestration/autopilot` is the bounded production self-evolution autopilot: it advances the target, optionally stops at human approval, executes source closure, applies release policy, runs safe auto-merge, and records post-merge deploy closure as one staged product resource. This keeps the long-task loop state inside EvoPilot while allowing Codex to act as an executor rather than the system of record.

Context time travel, release repair, worker failover, sandbox proof, and streaming trace inspection are also control-plane surfaces, not side scripts. `GET /api/v1/loops/{loopId}/checkpoints` derives replayable checkpoints from durable iterations, and `POST /api/v1/loops/{loopId}/time-travel/replay` records edited context plus replay diff evidence before continuing through the same executor graph. Release Run Auto Repair Workbench reads `repair-candidates`, supports single-row and batch repair, and removes a candidate only after a subsequent run reaches a non-failed terminal state such as `PROMOTED`. `GET /api/v1/loop-workers/queue` and `POST /api/v1/loop-workers/claim` expose the durable queue, worker lease renewal, expired-lease failover, crash-resume readiness, and duplicate source-closure side-effect guard to Dashboard and automation. `GET /api/v1/loops/{loopId}/sandbox-proof` generates executable Docker/K8s boundary proof, and `POST /api/v1/loops/{loopId}/sandbox-proof/verify` writes boundary verification evidence into the loop. `GET /api/v1/loops/{loopId}/trace-tree` and `GET /api/v1/loops/{loopId}/events` expose trace trees, JSON event lists, and SSE streams for checkpoint, executor-step, cost, failure-group, replay-diff, and sandbox-proof events.

The remaining target-loop capabilities are now part of the product runtime:

- `persistent-loop-store`: every loop exposes its active store backend, lock provider, and idempotent recovery contract. File remains the default backend; `EVOPILOT_LOOP_STORE_BACKEND=sqlite|postgres` and `EVOPILOT_LOOP_STORE_DSN` declare the production store contract without leaking credentials.
- `replay-and-human-edit`: `POST /api/v1/loops/{loopId}/replay` truncates execution from a selected iteration, records a context patch, and continues through the same executor graph. Dashboard time travel adds checkpoint inspection and replay diff through first-class APIs.
- `durable-worker-queue`: queue and claim APIs make worker claim/renew/failover explicit and expose source-closure side-effect protection before a worker resumes a loop.
- `sandbox-runtime`: loop creation accepts a `sandbox` policy with `host`, `docker`, or `k8s`, credential scope, network mode, allowed paths, denied paths, and resource limits. Loop state records `sandboxEnforcement`: Docker/K8s produce `ENFORCED` when the boundary is configured, host produces `POLICY_ONLY`, and invalid hard-boundary configuration produces `FAILED` and blocks non-approval executor nodes. Sandbox proof translates the policy into Docker args or a K8s Job manifest plus runtime/network/credential/path/resource checks.
- `multi-executor-coordination`: executor graphs include `mode: serial|parallel`; typed edges support `sequence`, `conditional`, `fan-out`, and `fan-in`, with schema refs and condition strings. Loop state records each executor's dependencies, shared context keys, input schema, output schema, and edge semantics.
- `loop-observability`: `GET /api/v1/loop-observability`, `GET /api/v1/loops/{loopId}/trace`, `GET /api/v1/loops/{loopId}/trace-tree`, and `GET /api/v1/loops/{loopId}/events` expose worker lease, watchdog age, cost summary, executor step counts, per-node cost/tokens, checkpoint/time-travel inspection, replay diff, SSE event streams, and failure signatures for Dashboard and automation.

Loop Runtime does not own the whole product decision. Evidence ingestion, opportunity discovery, governance policy, and release decision APIs remain product-control-plane concerns. Runtime loops coordinate executors and preserve long-task continuity so those product decisions can be carried through safely.

## Alternatives

Keep extending target-loop APIs directly.

This would keep short-term changes smaller, but every new scenario would duplicate state, approval, retry, and observability rules.

Adopt a generic external agent framework as the runtime.

This would improve general multi-agent scheduling, but EvoPilot needs product-native release governance, CI/CD evidence, approval, audit, and project lifecycle semantics. External frameworks can be executors, not the control plane.

## Consequences

EvoPilot can now model long tasks independently of a specific release or maturity target. Codex, IM adapters, schedules, runtime signals, evolution batches, and release goals can all create loop runs.

The runtime is still intentionally conservative: it does not pretend to execute arbitrary unsafe actions without approval, and it does not replace concrete executors such as code-upgrader or Jenkins. It records and governs their collaboration.

## Validation

Use:

```bash
npm run loop-runtime:check
npm run loop:soak
```

The gate verifies executor graph creation, ExecutorAdapter resolution, loop creation, store runtime metadata, idempotent create/start/resume, replay with context edit, sandbox policy evidence, multi-executor coordination schemas, loop trace, observability aggregation, approval blocking, timeline, evidence, artifacts, heartbeat lease, watchdog, repeated-failure blocking, conversation command loop creation, worker-driven loop advancement, sandbox workspace creation, and IM webhook loop creation.
