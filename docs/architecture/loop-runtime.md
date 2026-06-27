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
- `ExecutorAdapter` as the plugin boundary that turns executor graph nodes into structured execution contracts.
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

`POST /api/v1/loops/{loopId}/source-closure/execute` is the executable boundary for GitHub and GitLab repositories. It uses the registered project credentials to create a release branch, commit requested files, open a PR or MR, create a tag when required, invoke a configured deploy connector, probe health/ready endpoints, and write the resulting branch, commit, PR/MR, tag, deployment, gate evidence, audit event, and independent evidence set back into the `LoopRun`. Executor steps also repeat the same `sourceClosure` so a loop cannot silently become a status-only success without a source repository and production-delivery boundary.

Deploy connectors are separate runtime connectors. The first built-in connector type is `http-webhook`: EvoPilot sends a structured deploy request with loop, project, source, branch, commit, tag, PR/MR, environment, and parameters; the external deployer returns deployment and probe URLs. ECS/K8s/cloud rollout implementations should attach behind this connector boundary with their own credentials, idempotency, rollback, and approval semantics instead of being hard-coded into source closure.

The remaining target-loop capabilities are now part of the product runtime:

- `persistent-loop-store`: every loop exposes its active store backend, lock provider, and idempotent recovery contract. File remains the default backend; `EVOPILOT_LOOP_STORE_BACKEND=sqlite|postgres` and `EVOPILOT_LOOP_STORE_DSN` declare the production store contract without leaking credentials.
- `replay-and-human-edit`: `POST /api/v1/loops/{loopId}/replay` truncates execution from a selected iteration, records a context patch, and continues through the same executor graph.
- `sandbox-runtime`: loop creation accepts a `sandbox` policy with `host`, `docker`, or `k8s`, credential scope, network mode, allowed paths, and denied paths. Each executor step records the effective sandbox boundary in evidence.
- `multi-executor-coordination`: executor graphs include `mode: serial|parallel`; loop state records each executor's dependencies, shared context keys, input schema, and output schema.
- `loop-observability`: `GET /api/v1/loop-observability` and `GET /api/v1/loops/{loopId}/trace` expose worker lease, watchdog age, cost summary, executor step counts, and failure signatures for Dashboard and automation.

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
