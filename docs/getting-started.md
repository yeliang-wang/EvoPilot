# Getting Started

> The fastest path to run EvoPilot as an API and CLI control plane.

EvoPilot is the backend control plane for AI Agent product evolution. It owns API state, CLI execution, release governance, evidence, audit, GlobalGoal planning, LoopRun execution, and release decisions. Dashboard UI is a separate client that consumes the EvoPilot API.

## Prerequisites

- Node.js 22+
- npm
- Git

## Run The API Server

```bash
npm install
npm run build

EVOPILOT_PORT=19876 \
EVOPILOT_RUN_MODE=debug \
EVOPILOT_USERS=admin:change-me-admin-password:admin:tenant-production:workspace-agent-products:PlatformAdmin \
EVOPILOT_TOKENS=admin:change-me-admin-token:admin,operator:change-me-operator-token:operator,viewer:change-me-viewer-token:viewer \
npm run server
```

Verify readiness:

```bash
curl -fsS http://127.0.0.1:19876/health
curl -fsS http://127.0.0.1:19876/ready
```

## Use The CLI

```bash
npm run cli -- status \
  --server http://127.0.0.1:19876 \
  --token change-me-admin-token \
  --json
```

Run a project toward a release target with the wrapper command:

```bash
npm run cli -- target run \
  --server http://127.0.0.1:19876 \
  --token change-me-admin-token \
  --project my-agent \
  --template ga \
  --objective "Promote my-agent to GA stable with source closure, deployment evidence, release decision, and blocker review" \
  --max-steps 20 \
  --json
```

See [CLI Manual](cli-manual.md) for guided workflows and [CLI Reference](cli-reference.md) for the full command list.

## Connect A Dashboard

Official Dashboard source lives in `yeliang-wang/evopilot-dashboard`. Any custom Dashboard can connect to EvoPilot when it follows the API, auth, and governance contract.

Read [Dashboard Integration](dashboard-integration.md) before building a custom UI.
