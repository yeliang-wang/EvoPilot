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
  --require-source-ready \
  --require-devops-ready \
  --json
```

For a new GitHub or GitLab project, ask for the onboarding checklist before mutating state:

```bash
npm run cli -- project onboard plan github \
  --server http://127.0.0.1:19876 \
  --token change-me-admin-token \
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

Then use `project onboard` after the server can resolve the tokenRef, or provide `--template` to continue directly into the target wrapper. See [CLI Workflows](cli/workflows.md).

## Configure A Project LLM

Use the server global LLM for quick local validation. For a real project, register an explicit LLM profile before running the target:

```bash
export LLM_API_KEY_MY_AGENT="<real-llm-api-key>"

npm run cli -- secret set \
  --server http://127.0.0.1:19876 \
  --token change-me-admin-token \
  --id LLM_API_KEY_MY_AGENT \
  --kind llm-key \
  --from-env LLM_API_KEY_MY_AGENT \
  --json

npm run cli -- llm profile set my-agent-llm \
  --server http://127.0.0.1:19876 \
  --token change-me-admin-token \
  --provider openai-compatible \
  --base-url https://llm.example.com/v1 \
  --model qwen2.5-coder-32b \
  --api-key-ref LLM_API_KEY_MY_AGENT \
  --json

npm run cli -- project llm set my-agent \
  --server http://127.0.0.1:19876 \
  --token change-me-admin-token \
  --profile my-agent-llm \
  --require-llm-ready \
  --json
```

Wrapper commands can then use the project default or override it:

```bash
npm run cli -- target run \
  --server http://127.0.0.1:19876 \
  --token change-me-admin-token \
  --project my-agent \
  --template ga \
  --objective "Promote my-agent to GA stable" \
  --llm-profile my-agent-llm \
  --require-llm-ready \
  --json
```

See [CLI](cli/README.md) for setup, [CLI Workflows](cli/workflows.md) for guided scenarios, and [CLI Commands](cli/commands.md) for the full command list.

## Connect A Dashboard

Official Dashboard source lives in `yeliang-wang/evopilot-dashboard`. Any custom Dashboard can connect to EvoPilot when it follows the API, auth, and governance contract.

Read [Dashboard Integration](guides/dashboard-integration.md) before building a custom UI.
Read `evopilot-dashboard/docs/README.md` for Dashboard page operations, digital human simulation, and browser workflow docs.
