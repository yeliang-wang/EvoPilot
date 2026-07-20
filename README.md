# EvoPilot

> Evidence-driven self-evolution control plane for AI-agent products, with Loop Engineering, human approval, SaaS multi-tenancy, CI/CD delivery, and auditable release decisions.

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6%2B-3178c6)](https://www.typescriptlang.org/)
[![Runtime](https://img.shields.io/badge/runtime-prod%20by%20default-1f7a8c)](#runtime)
[![Dashboard](https://img.shields.io/badge/dashboard-SaaS%20console-1f7a8c)](#dashboard)
[![Release](https://img.shields.io/badge/GA%20Release-V1.0-2ea043)](#release-status)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

EvoPilot helps teams operate AI-agent products as releasable software. It collects real evidence from runtime events, traces, evaluations, CI/CD, source changes, LLM calls, and user feedback; turns that evidence into reviewable evolution opportunities; waits for human approval; then drives code upgrades, delivery, and product-native `GO` / `NO-GO` release decisions.

It is not an agent runtime, a prompt playground, or a generic code generator. Agent runtimes do the work; EvoPilot governs whether the product is ready to evolve and release.

## Release Status

EvoPilot is marked **GA Release V1.0** for its product control plane and Loop Engineering runtime.

As of the **2026-07-07 production validation**, the EvoPilot SaaS multi-tenant deployment has reached **GA stable Release** status:

| Signal | Result |
|---|---:|
| Production user E2E checks | 92 |
| PASS | 88 |
| FAIL | 0 |
| Low-severity WARN | 4 |
| Production health | `UP` |
| Readiness | `READY` |
| Postgres business store | `READY` |
| Real LLM path | GLM-5.1 credits and tokens recorded |

The authoritative release verdict is exposed by:

```http
GET /api/v1/release/decisions
```

Detailed release evidence and deployment checklists live in [docs/reference/release-package.md](docs/reference/release-package.md) and [docs/reference/production-user-e2e.md](docs/reference/production-user-e2e.md).

## Core Capabilities

| Capability | What EvoPilot provides |
|---|---|
| Loop Engineering | Durable loop state, executor graphs, checkpoints, replay, watchdog recovery, worker leases, sandbox proof, and timeline audit. |
| GlobalGoal planning | A white-box goal layer above LoopRun that decomposes RC/GA objectives into ordered GoalTargets, binds each target to governed loops, and exposes progress, blockers, timeline, graph, evidence matrix, and final report. |
| Evidence ingestion | Runtime events, traces, logs, evaluations, release signals, APM-derived data, and user feedback. |
| Human approval | Reviewable proposals before high-risk evolution, source writeback, merge, or release actions. |
| Code upgrades | Bounded code-upgrader execution with allowed paths, validation commands, branch/commit evidence, and source closure. |
| CI/CD delivery | GitHub Actions and GitLab CI native project DevOps, deploy connectors, health gates, and pipeline evidence. |
| Release governance | Per-project release targets, evidence bundles, scenario matrices, risk registers, and `GO` / `CONDITIONAL-GO` / `NO-GO` decisions. |
| SaaS multi-tenancy | Platform admin, tenant admin, tenant user flows, workspace RBAC, tenant-aware evidence, quota foundations, and scoped secrets. |
| Dashboard | Chinese SaaS console for onboarding, projects, loops, approvals, release decisions, observability, tenants, users, and help manual workflows. |

## Quick Start

Prerequisites:

- Node.js 22+
- npm

Run locally:

```bash
npm install
npm run build
npm run server:debug
```

Verify the API:

```text
http://127.0.0.1:19876/health
http://127.0.0.1:19876/ready
```

Run the standalone Dashboard from the sibling repository:

```bash
cd ../evopilot-dashboard
EVOPILOT_API_BASE_URL=http://127.0.0.1:19876 npm run dev
```

Debug mode is for local development and UI validation. Production mode is the default for real operation and requires authentication, real runtime boundaries, and configured LLM/source/CI/CD credentials.

## Dashboard

The dashboard is the primary product surface for operators and tenant users, but it now lives in the standalone `yeliang-wang/evopilot-dashboard` repository. EvoPilot itself focuses on the API server, CLI, domain state, release governance, and execution control plane. The standalone Dashboard consumes EvoPilot APIs and includes the GlobalGoal Cockpit for RC/GA workflow visibility.

| Role | Main workflows |
|---|---|
| Platform admin | Create tenants, manage tenant admins, inspect SaaS readiness, observe cross-tenant release health. |
| Tenant admin | Manage workspace users, bind projects, configure credentials, run target loops, approve source/release actions. |
| Tenant user | Inspect projects, evidence, loop progress, approvals assigned to them, release decisions, and help manual steps. |

The full browser operation guide lives in the standalone Dashboard repository under `docs/`. EvoPilot keeps the API/CLI/control-plane guide in [docs/guides/user-guide.md](docs/guides/user-guide.md).

## Architecture

EvoPilot applies Loop Engineering to product evolution. For larger RC/GA objectives, the GlobalGoal layer sits above LoopRun and turns one global objective into multiple GoalTargets before each target is executed through the governed loop runtime:

```text
GlobalGoal -> GoalTarget -> LoopRun -> Release Decision
                  |
                  v
Sandbox -> Context -> Harness -> Loop
```

| Layer | EvoPilot responsibility |
|---|---|
| Sandbox | Isolated execution boundaries, credential scope, protected paths, and deploy constraints. |
| Context | Durable loop state, evidence, artifacts, checkpoints, and replay context. |
| Harness | API control plane, RBAC, audit, worker leases, approvals, retries, and watchdog recovery. |
| Loop | Continue, stop, retry, approve, source-close, release, or route to humans. |

Architecture details:

- [Continuous Evolution Control Plane](docs/architecture/continuous-evolution-control-plane.md)
- [Loop Runtime Architecture](docs/architecture/loop-runtime.md)
- [ProofOps Target Loop Mode](docs/architecture/proofops-target-loop-mode.md)
- [Mainstream Loop Harness Alignment](docs/examples/comparisons/mainstream-loop-harness-alignment.md)

## Runtime

Common commands:

```bash
npm run build
npm run check
npm run test:e2e:production
npm run release:soak:ga:active
```

Production package commands:

```bash
npm run store:postgres:migrate
npm run store:postgres:backup
npm run store:postgres:restore
```

Docker:

```bash
docker build -t evopilot:1.0.0 .
docker compose up --build
```

Deployment details are in [docs/operations/deployment.md](docs/operations/deployment.md).

## API

Primary API surfaces include:

| Area | Examples |
|---|---|
| Health and readiness | `GET /health`, `GET /ready` |
| Auth and users | `POST /api/v1/auth/login`, `GET /api/v1/users`, `POST /api/v1/users` |
| Projects and evidence | `GET /api/v1/projects`, `POST /api/v1/evidence/events` |
| Project DevOps | `POST /api/v1/projects/{projectId}/devops`, `POST /api/v1/projects/{projectId}/devops/preflight` |
| Global goals | `GET /api/v1/goals`, `POST /api/v1/goals`, `POST /api/v1/goals/{goalId}/plan`, `POST /api/v1/goals/{goalId}/advance`, `GET /api/v1/goals/{goalId}/snapshot` |
| Loops | `POST /api/v1/loops`, `POST /api/v1/loops/{loopId}/start`, `GET /api/v1/loops/{loopId}/timeline` |
| Source closure | `POST /api/v1/loops/{loopId}/source-closure/execute`, `POST /api/v1/loops/{loopId}/source-closure/review-decision` |
| Release | `POST /api/v1/release/evidence`, `GET /api/v1/release/decisions` |
| SaaS | `GET /api/v1/tenants`, `GET /api/v1/workspaces`, `GET /api/v1/saas/observability` |

See [docs/api/README.md](docs/api/README.md) and [docs/api/openapi.json](docs/api/openapi.json) for the full API reference.

## Documentation

Start with the [documentation index](docs/README.md). The main entry points are:

| Reader | Start here |
|---|---|
| New user | [Quick Start](docs/quickstart.md) |
| AI agent or CLI automation | [CLI](docs/cli/README.md) and [AI Agent Runbook](docs/guides/ai-agent-runbook.md) |
| Dashboard integrator | [Dashboard Integration](docs/guides/dashboard-integration.md) |
| API integrator | [API Reference](docs/api/README.md) and [OpenAPI](docs/api/openapi.json) |
| Production operator | [Operations](docs/operations/deployment.md) |
| Architect | [Architecture](docs/architecture/README.md) |

## Repository Layout

```text
packages/core/                          lifecycle, evidence, planning, review, delivery, release models
packages/server/                        control-plane API and optional compatibility static host
packages/llm/                           LLM gateway, routing, compression, metrics
packages/adapter-github/                GitHub adapter
packages/adapter-gitlab/                GitLab adapter
packages/adapter-local-git/             local Git adapter
docs/                                   user, API, deployment, architecture, testing, release docs
examples/                               onboarding and integration examples
scripts/                                E2E, LLM, Postgres store, release, and verification scripts
runtimes/                               managed runtime images, locks, and supply-chain material
tests/                                  unit, smoke, functional, and E2E tests
```

The product Dashboard is maintained separately in `yeliang-wang/evopilot-dashboard`.

## Open Source Governance

EvoPilot uses Apache License 2.0 and includes the standard public-repository governance entry points:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md)
- [NOTICE](NOTICE)
- [LICENSE](LICENSE)

Governance verification:

```bash
npm run verify:oss-governance
```

## License

EvoPilot is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
