# EvoPilot Control Plane User Guide

> Operate EvoPilot as the API and CLI control plane for AI Agent product evolution.

EvoPilot owns backend state, evidence, GlobalGoal planning, LoopRun execution, source closure, DevOps readiness, release decisions, audit, and logs. The standalone Dashboard is a UI client in `yeliang-wang/evopilot-dashboard`; browser operation docs live in that repository's `docs/` directory.

## Fast Path

1. Connect to the EvoPilot API server.
2. Verify `/health`, `/ready`, and `/api/v1/version`.
3. Use CLI or API to onboard a project.
4. Configure source credential and project DevOps boundary.
5. Run a target or GlobalGoal workflow.
6. Stop on blockers, human gates, credential gaps, or policy review.
7. Read release decisions for `GO`, `CONDITIONAL-GO`, or `NO-GO`.
8. Use audit and structured logs to explain what happened.

## Reader Routing

| Reader | Use This Repo For | Use Dashboard Repo For |
|---|---|---|
| WorkBuddy CLI Agent | CLI install, auth, commands, workflows, JSON output, failure handling | Browser simulation and page operations |
| API integrator | OpenAPI, auth headers, source closure, release decisions | UI navigation and page labels |
| Production operator | API server, worker, logging, deployment, runtime locks | Dashboard static service deployment and UI smoke |
| Digital human | API truth and state semantics | Click-by-click Dashboard operation |

Dashboard operation docs:

- `evopilot-dashboard/docs/README.md`
- `evopilot-dashboard/docs/user-guide.md`
- `evopilot-dashboard/docs/ai-agents/README.md`
- `evopilot-dashboard/docs/workflows/*`

## Control Plane Model

| Layer | EvoPilot Object | Source Of Truth |
|---|---|---|
| Project | `StoredProject` | `/api/v1/projects` |
| Source credentials | source credential readiness | `/api/v1/projects/{projectId}/source-credentials/preflight` |
| DevOps boundary | provider, executionMode, devopsOwner, workflowRepository, claimBoundary | `/api/v1/projects/{projectId}/devops/preflight` |
| Global goal | objective, plan, targets, evidence matrix, final report | `/api/v1/goals/*` |
| Loop runtime | LoopRun, worker lease, trace, sandbox, source closure | `/api/v1/loops/*` |
| Release | release decision, criteria, risks, scenario matrix | `/api/v1/release/decisions` |
| Audit | actor, requestId, action, target, result | `/api/v1/audit`, `/api/v1/history` |

## Connect With CLI

Use HTTP unless your deployment has a TLS reverse proxy:

```bash
export EVOPILOT_SERVER=http://8.153.72.80
export EVOPILOT_TENANT=tenant-production
export EVOPILOT_WORKSPACE=workspace-agent-products
export EVOPILOT_ACTOR=workbuddy
export EVOPILOT_API_TOKEN="<evopilot-bearer-token>"

evopilot --server "$EVOPILOT_SERVER" --token "$EVOPILOT_API_TOKEN" status --json
```

`EVOPILOT_API_TOKEN` is an EvoPilot API bearer token. It is not a GitHub PAT. GitHub/GitLab tokens are project credentials stored server-side and referenced with `tokenRef`.

## Atomic CLI Operations

| Need | Command |
|---|---|
| Check API health and version | `evopilot status --json` |
| List projects | `evopilot project list --json` |
| Plan onboarding without mutation | `evopilot project onboard plan github ... --json` |
| Onboard project | `evopilot project onboard github ... --json` |
| Verify onboarding | `evopilot project onboard verify <project-id> --json` |
| Configure DevOps | `evopilot project devops set <project-id> ... --json` |
| Preflight DevOps | `evopilot project devops preflight <project-id> --json` |
| Run one target wrapper | `evopilot target run --project <id> --template ga ... --json` |
| Inspect release decision | `evopilot release decisions --project <id> --json` |
| Inspect audit | `evopilot audit list --limit 10 --json` |

Full command reference: [CLI Commands](../cli/commands.md).

## One-Command Target Workflow

Use wrapper commands when WorkBuddy or CI should drive a project toward a target:

```bash
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Promote my-agent to GA stable with source closure, CI/CD, deployment evidence, release decision, and blocker review" \
  --until terminal \
  --max-steps 20 \
  --require-source-ready \
  --require-devops-ready \
  --json
```

The command prints server-derived chain, blockers, next action, and release state. AI Agents must read JSON fields, not human-readable terminal text.

Workflow reference: [CLI Workflows](../cli/workflows.md).

## Project Onboarding Boundary

Before mutating project state, ask the server for a plan:

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

For an open-source upstream with a writable fork:

```bash
evopilot project onboard plan github \
  --repo apache/skywalking \
  --upstream-repo apache/skywalking \
  --working-repo my-org/skywalking-fork \
  --id skywalking-fork \
  --token-ref GITHUB_TOKEN_SKYWALKING_FORK \
  --execution-mode fork-validated-pr \
  --devops-owner my-org \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --template rc \
  --json
```

The server response is authoritative for `executionMode`, `devopsOwner`, `workflowRepository`, `credentialRef`, `credentialPrincipal`, and `claimBoundary`.

## DevOps Claim Rules

| Mode | Allowed Claim |
|---|---|
| `owned-repository` | Source writeback and CI/CD in the same owned repository. |
| `read-only-public` | Analysis only. No PR, merge, CI/CD, or release readiness claim. |
| `fork-validated-pr` | Fork CI and upstream PR readiness. No upstream release completion claim. |
| `upstream-authorized` | Upstream writeback and release readiness after maintainer credential preflight. |

Do not infer DevOps ownership from repository URL. Use the server-returned `devopsOwner` and `workflowRepository`.

## Stop Conditions

Automation must stop and report when JSON output contains:

- `status=BLOCKED`
- `nextAction=connect-github-account`
- `nextAction=connect-gitlab-account`
- `nextAction=configure-source-credentials`
- `nextAction=human-approval`
- `nextAction=policy-review`
- `nextAction=repair`
- `claimBoundary=read-only-analysis`
- HTTP `401`, `403`, or `409`

Do not bypass human gates, missing credentials, or release policy blockers.

## Release Truth

Only EvoPilot release decisions can state final release status:

```bash
evopilot release decisions --project my-agent --json
```

Health checks, CI success, source closure success, Dashboard visuals, and CLI progress output are supporting evidence. They do not replace `GET /api/v1/release/decisions`.

## Logs And Audit

Use structured logs and audit for diagnosis:

- `schema=evopilot-log/v1`
- `requestId`
- `tenantId`
- `workspaceId`
- `actor`
- `routeGroup`
- `outcome`
- `errorCode`
- `correlation.goalId`
- `correlation.loopId`
- `correlation.projectId`

Run:

```bash
evopilot audit list --limit 20 --json
```

Operational troubleshooting: [Troubleshooting](../operations/troubleshooting.md).

## Do Not Do

- Do not use GitHub PAT as EvoPilot API token.
- Do not point CLI to `https://<host>:19876` unless that port is actually TLS.
- Do not duplicate Dashboard click-by-click docs in this repository.
- Do not parse human-readable CLI output when JSON is available.
- Do not claim GA/RC/GO from UI state or CI alone.
