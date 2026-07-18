# Dashboard Integration

> Contract for building custom dashboards on top of EvoPilot.

A Dashboard is a UI client. It does not own EvoPilot domain state and must not infer release verdicts outside the EvoPilot API.

## Boundary

```text
Dashboard UI  ->  EvoPilot HTTP API  ->  EvoPilot domain state
CLI / CI      ->  EvoPilot HTTP API  ->  EvoPilot domain state
```

The Dashboard must not call the EvoPilot CLI, read the database directly, read JSON files under the data root, or use `.codex-evidence` as runtime state.

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
| Login | `POST /api/v1/auth/login` |
| Overview | `GET /api/v1/summary` |
| Projects | `GET /api/v1/projects`, `POST /api/v1/projects` |
| Release targets | `GET /api/v1/release/targets`, `POST /api/v1/release/targets` |
| Global goals | `GET /api/v1/goals`, `POST /api/v1/goals` |
| Goal workflow | `GET /api/v1/goals/{goalId}/run-status`, `snapshot`, `graph`, `timeline`, `evidence-matrix` |
| Goal execution | `POST /api/v1/goals/{goalId}/plan`, `approve-plan`, `advance` |
| Loop runtime | `GET /api/v1/loops`, `POST /api/v1/loops`, `POST /api/v1/loops/{loopId}/start` |
| Source closure | `POST /api/v1/loops/{loopId}/source-closure/preflight`, `execute`, `review-decision` |
| Release verdict | `GET /api/v1/release/decisions` |
| Audit | `GET /api/v1/audit` |

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

## Forbidden Patterns

- Do not store production secrets in the Dashboard repository.
- Do not embed admin tokens in static assets.
- Do not duplicate server release-decision logic in JavaScript.
- Do not call local CLI commands from browser code.
- Do not treat screenshots or local test output as release truth.

## Validation

A custom Dashboard should pass:

```bash
npm run build
npm run check
```

It should also run a smoke test against a real EvoPilot API server:

```bash
curl -fsS "$EVOPILOT_SERVER/health"
curl -fsS "$EVOPILOT_SERVER/ready"
curl -fsS -H "Authorization: Bearer $EVOPILOT_API_TOKEN" "$EVOPILOT_SERVER/api/v1/summary"
```
