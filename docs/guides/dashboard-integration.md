# Dashboard Integration

> Contract for building custom dashboards on top of EvoPilot.

A Dashboard is a UI client. It does not own EvoPilot domain state and must not infer release verdicts outside the EvoPilot API.

## Boundary

```text
Dashboard UI  ->  EvoPilot HTTP API  ->  EvoPilot domain state
CLI / CI      ->  EvoPilot HTTP API  ->  EvoPilot domain state
```

The Dashboard must not call the EvoPilot CLI, read the database directly, read JSON files under the data root, or use `.codex-evidence` as runtime state.

## Source Of Truth

Use these files when building or validating a Dashboard integration:

| File | Purpose |
|---|---|
| `docs/api/openapi.json` | Machine-readable API contract. AI agents and generated API clients should read this first. |
| `docs/api/README.md` | Human-readable API behavior, governance rules, examples, and product semantics. |
| `docs/guides/dashboard-integration.md` | Dashboard boundary, required operating surface, deployment shape, and smoke checks. |
| `../evopilot-dashboard/README.md` | Standalone Dashboard run/deploy instructions. |

The standalone Dashboard repository is an API client. If a workflow label, tooltip, or generated client references an endpoint not present in `docs/api/openapi.json`, treat that as a documentation contract bug and fix the docs or the Dashboard label before release.

## Authentication

Every protected API call must include:

```http
Authorization: Bearer <token>
X-EvoPilot-Tenant: <tenant-id>
X-EvoPilot-Workspace: <workspace-id>
X-EvoPilot-Actor: <actor-id>
```

The token and role determine which read and write actions are allowed. A Dashboard must display server-side `403`, `409`, blocker, and human-gate responses instead of hiding them.

## Required API Surfaces

| Workflow | API |
|---|---|
| Login | `GET /api/v1/auth/bootstrap`, `POST /api/v1/auth/login`, `POST /api/v1/auth/change-password` |
| Overview | `GET /api/v1/summary` |
| SaaS control plane | `GET/POST /api/v1/tenants`, `GET/POST /api/v1/workspaces`, `GET /api/v1/workspaces/{workspaceId}/usage`, `GET/POST /api/v1/users`, `PATCH /api/v1/users/{userId}`, `POST /api/v1/users/{userId}/reset-password` |
| Secrets and GitHub App | `GET/POST /api/v1/secrets`, `POST /api/v1/secrets/{secretId}/revoke`, `GET/POST /api/v1/github-app/installations` |
| Projects | `GET /api/v1/projects`, `POST /api/v1/projects`, `POST /api/v1/onboarding/project/checklist`, `GET /api/v1/projects/{projectId}/onboarding-checklist`, `POST /api/v1/projects/{projectId}/source-credentials`, `GET/POST /api/v1/projects/{projectId}/source-credentials/preflight` |
| Deploy connectors | `GET/POST /api/v1/connectors/deploy` |
| Release targets | `GET /api/v1/release/targets`, `POST /api/v1/release/targets` |
| Global goals | `GET /api/v1/goals`, `POST /api/v1/goals` |
| Goal workflow | `GET /api/v1/goals/{goalId}/run-status`, `snapshot`, `graph`, `timeline`, `evidence-matrix` |
| Goal execution | `POST /api/v1/goals/{goalId}/plan`, `approve-plan`, `advance` |
| Loop runtime | `GET /api/v1/loops`, `POST /api/v1/loops`, `POST /api/v1/loops/{loopId}/start`, `resume`, `approve`, `GET /api/v1/loops/{loopId}/executor-graph`, `trace-tree`, `events` |
| Loop orchestration | `GET /api/v1/loop-orchestration/presets`, `targets`, `POST /api/v1/loop-orchestration/instantiate`, `advance`, `autopilot` |
| Loop target runtime | `GET /api/v1/loop-target-runtime/summary`, `POST /api/v1/loop-target-runtime/discovery/run`, `adversarial-evaluations`, `schedules`, `guardrails/{loopId}/evaluate` |
| Worker queue | `GET /api/v1/loop-workers/queue`, `POST /api/v1/loop-workers/claim` |
| Source closure | `GET/POST /api/v1/loops/{loopId}/source-closure/preflight`, `GET /api/v1/loops/{loopId}/source-closure/plan`, `POST /api/v1/loops/{loopId}/source-closure/execute`, `review-decision` |
| Source release repair | `GET /api/v1/source-release-runs`, `GET /api/v1/source-release-runs/repair-candidates`, `POST /api/v1/source-release-runs/repair-candidates/repair`, `POST /api/v1/loops/{loopId}/source-release-runs/{sourceReleaseRunId}/repair` |
| Release verdict | `GET /api/v1/release/decisions` |
| Observability | `GET /api/v1/loop-store`, `GET /api/v1/loop-store/readiness`, `GET /api/v1/loop-observability`, `GET /api/v1/saas/observability`, `GET /api/v1/source-release-deploy-finalizers` |
| Audit | `GET /api/v1/audit`, `GET /api/v1/history` |

`GET /api/v1/release/decisions` is the authoritative release verdict. A Dashboard can show progress, but it must not claim GA, RC, `GO`, or `NO-GO` from UI-side heuristics.

## Workflow Projection

For a white-box Goal/Loop workflow, prefer `run-status`:

```bash
curl -fsS \
  -H "Authorization: Bearer $EVOPILOT_API_TOKEN" \
  -H "X-EvoPilot-Tenant: $EVOPILOT_TENANT" \
  -H "X-EvoPilot-Workspace: $EVOPILOT_WORKSPACE" \
  "$EVOPILOT_SERVER/api/v1/goals/$GOAL_ID/run-status"
```

Use the response fields as UI contract:

| Field | UI Use |
|---|---|
| `chain` | Workflow graph nodes |
| `nextAction` | Primary call to action |
| `blockers` | Stop reasons and required human action |
| `activeTarget` | Current GoalTarget |
| `latestLoop` | Bound LoopRun |
| `evidenceMatrix` | Acceptance and evidence table |
| `releaseDecision` | Release verdict summary |
| `finalReport` | Terminal report state |

## Deployment Modes

Recommended production shape:

```text
/       -> evopilot-dashboard
/api/*  -> evopilot-api
```

This keeps browser calls same-origin and avoids exposing extra CORS surface. If the Dashboard uses a different origin, the EvoPilot API must explicitly allow that origin and headers.

The official standalone Dashboard repository provides this shape through its `compose.yaml`:

```bash
cd /opt/evopilot-dashboard
EVOPILOT_DOCKER_NETWORK=evopilot_default \
EVOPILOT_API_BASE_URL=http://evopilot-server:19876 \
EVOPILOT_DASHBOARD_PORT=8080 \
docker compose -f compose.production.yaml up -d --build
```

Use the Dashboard service health endpoint separately from EvoPilot readiness:

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:19876/ready
```

When a host-level Nginx owns the public port, use `deploy/nginx/evopilot-dashboard.conf.example` from the Dashboard repository so public `/` serves the Dashboard while public `/api/*` stays bound to EvoPilot API.

## Forbidden Patterns

- Do not store production secrets in the Dashboard repository.
- Do not embed admin tokens in static assets.
- Do not duplicate server release-decision logic in JavaScript.
- Do not call local CLI commands from browser code.
- Do not treat screenshots or local test output as release truth.

## Validation

Validate the split locally before changing API docs or Dashboard call sites:

```bash
cd /Users/wangyejing/project/harness/EvoPilot
npm run build
EVOPILOT_RUN_MODE=debug \
EVOPILOT_TOKENS='admin:local-admin-token:admin,operator:local-operator-token:operator,viewer:local-viewer-token:viewer' \
npm run server
```

In another terminal:

```bash
cd /Users/wangyejing/project/harness/evopilot-dashboard
EVOPILOT_API_BASE_URL=http://127.0.0.1:19876 npm run dev -- --port 5174
```

Smoke the Dashboard proxy path instead of only calling EvoPilot directly:

```bash
curl -fsS http://127.0.0.1:5174/health
curl -fsS http://127.0.0.1:5174/ready
curl -i http://127.0.0.1:5174/api/v1/summary
curl -fsS \
  -H "Authorization: Bearer local-admin-token" \
  -H "X-EvoPilot-Tenant: tenant-production" \
  -H "X-EvoPilot-Workspace: workspace-agent-products" \
  http://127.0.0.1:5174/api/v1/summary
```

Expected result: `/health` and `/ready` return 200, unauthenticated `/api/v1/summary` returns 401, and the authenticated Dashboard proxy request returns 200.

The EvoPilot repository should pass:

```bash
npm run build
node --test tests/e2e/dashboard-responsive-contract.test.mjs
```

The Dashboard repository should pass:

```bash
npm run build
npm run check
```

`tests/e2e/dashboard-responsive-contract.test.mjs` verifies `docs/api/openapi.json` covers the Dashboard operating surface. When the sibling `../evopilot-dashboard` checkout exists, it also scans the Dashboard `assets/app.js` call sites and fails if any `/api/v1/*` path is missing from OpenAPI.

A custom Dashboard should also run a smoke test against a real EvoPilot API server:

```bash
curl -fsS "$EVOPILOT_SERVER/health"
curl -fsS "$EVOPILOT_SERVER/ready"
curl -fsS -H "Authorization: Bearer $EVOPILOT_API_TOKEN" "$EVOPILOT_SERVER/api/v1/summary"
```
