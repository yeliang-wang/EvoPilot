# EvoPilot CLI

> Command-line access to an EvoPilot control-plane server for operators, CI jobs, release scripts, and AI agents.

The EvoPilot CLI is an HTTP client. It can run on macOS, Windows, Linux, WorkBuddy, Codex, Claude Code, or any environment that can execute Node.js commands and reach the EvoPilot server URL.

The CLI does not start EvoPilot locally and does not bypass server governance. RBAC, tenant/workspace scope, approvals, source-closure preflight, project DevOps, deployment gates, audit records, and release decisions are enforced by the EvoPilot server.

## Install

Production installation uses the published CLI package:

```bash
npm install -g @evopilot/cli
evopilot --version
```

From this repository, use the same CLI package without publishing:

```bash
npm install
npm run cli:build
npm run cli -- --version
```

The package requires Node.js 22 or later.

## Connect

Configure the target EvoPilot server and scope:

```bash
export EVOPILOT_SERVER="https://evopilot.example.com"
export EVOPILOT_API_TOKEN="<operator-or-admin-token>"
export EVOPILOT_TENANT="tenant-production"
export EVOPILOT_WORKSPACE="workspace-agent-products"
export EVOPILOT_ACTOR="workbuddy"
```

`EVOPILOT_BASE_URL` is also accepted as a server URL fallback. Command-line flags override environment variables and saved config:

```bash
evopilot --server "$EVOPILOT_SERVER" --token "$EVOPILOT_API_TOKEN" status --json
```

For username/password login:

```bash
evopilot auth login \
  --server "$EVOPILOT_SERVER" \
  --username "<user>" \
  --password "<password>"
```

The default saved config path is:

```text
~/.evopilot/config.json
```

Use `--config <file>` or `EVOPILOT_CONFIG` for short-lived agent sessions.

## Verify

Always verify the session before changing product state:

```bash
evopilot config show --json
evopilot status --json
```

Expected result:

- `health.status` is `UP`.
- `ready.status` is `READY`.
- `api.schema` is `evopilot-version/v1`.
- `api.apiContractVersion` is `v1`.
- `summary` is present when the token is valid for the requested tenant/workspace.
- Exit code is `0`.

If `summary` is missing, the CLI reached public health endpoints but not an authenticated control-plane session.

## Fast Path

For an already registered project, run toward GA with one wrapper command:

```bash
evopilot target run \
  --project <project-id> \
  --template ga \
  --objective "Promote the project to GA with source closure, native DevOps evidence, deploy evidence, release decision, and blocker review" \
  --until terminal \
  --max-steps 20 \
  --require-source-ready \
  --require-devops-ready \
  --json
```

This prints a server-governed chain covering project, release target, GlobalGoal, GoalTarget, LoopRun, source closure, deploy, release decision, evidence links, blockers, and next action.

## First Project Checklist

For a new project, start with a non-mutating onboarding checklist. This is the recommended entrypoint for WorkBuddy, Codex, Claude Code, and CI agents because it returns `schema`, `status`, `nextAction`, `missingInputs`, `blockers`, and suggested commands before anything is registered:

Declare the DevOps execution boundary whenever the checklist or wrapper configures GitHub Actions or GitLab CI:

- `--execution-mode owned-repository`: EvoPilot writes to and runs CI/CD in the same repository.
- `--execution-mode read-only-public`: EvoPilot can inspect a public upstream, but it must not claim PR, merge, CI/CD, or release readiness.
- `--execution-mode fork-validated-pr`: EvoPilot writes to a fork or working repository, runs CI/CD there, and can only claim fork CI plus an upstream PR.
- `--execution-mode upstream-authorized`: EvoPilot uses maintainer credentials against the upstream repository and can claim upstream release readiness after preflight.

`--devops-owner` is the GitHub owner or GitLab namespace whose account runs the project DevOps. For open-source upstream work, set `--upstream-repo` to the public project and `--working-repo` to the writable fork.

Full writeback, PR/MR, CI/CD, merge, deploy, or release readiness requires a GitHub/GitLab execution principal owned by the operator, user, or organization. For a third-party open-source upstream, the operator must either fork the upstream into a writable account/organization and use `fork-validated-pr`, or provide maintainer-authorized credentials and use `upstream-authorized`. If no GitHub/GitLab account or group exists, use `read-only-public`; EvoPilot will not provide a default platform account or built-in generic DevOps runner.

```bash
evopilot project onboard plan github \
  --repo <owner>/<repo> \
  --id <project-id> \
  --branch main \
  --token-ref GITHUB_TOKEN_<PROJECT> \
  --execution-mode owned-repository \
  --devops-owner <owner> \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --ci-required-check test \
  --cd-workflow deploy-prod.yml \
  --deploy-environment production \
  --health-url https://<app>/health \
  --template ga \
  --objective "Promote <project-id> to GA stable with source closure, native DevOps evidence, deploy evidence, release decision, and blocker review" \
  --json
```

If `nextAction` is `store-secret`, `connect-github-account`, or `connect-gitlab-account`, store the token once on the EvoPilot server or in the current tenant/workspace secret vault after the correct GitHub/GitLab account, organization, group, service account, deploy token, or GitHub App principal exists:

```bash
evopilot secret set \
  --id GITHUB_TOKEN_<PROJECT> \
  --kind source-token \
  --from-env GITHUB_TOKEN_<PROJECT> \
  --json
```

After registration, verify the same checklist against persisted project state:

```bash
evopilot project onboard verify <project-id> --template ga --json
```

For a new GitHub project, onboard the project, bind server-side source credentials, configure GitHub Actions, preflight both boundaries, and run GA in one wrapper:

```bash
evopilot project onboard github \
  --repo <owner>/<repo> \
  --id <project-id> \
  --branch main \
  --token-ref GITHUB_TOKEN_<PROJECT> \
  --execution-mode owned-repository \
  --devops-owner <owner> \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --ci-required-check test \
  --cd-workflow deploy-prod.yml \
  --deploy-environment production \
  --health-url https://<app>/health \
  --template ga \
  --objective "Promote <project-id> to GA stable with source closure, native DevOps evidence, deploy evidence, release decision, and blocker review" \
  --until terminal \
  --max-steps 20 \
  --require-source-ready \
  --require-devops-ready \
  --json
```

For a public upstream with a writable fork:

Precondition: create or use the operator-owned GitHub/GitLab account or organization first, fork the upstream into `--working-repo`, and make sure the `--token-ref` resolves to that principal on the EvoPilot server.

```bash
evopilot project onboard github \
  --repo apache/skywalking \
  --upstream-repo apache/skywalking \
  --working-repo my-org/skywalking-fork \
  --id skywalking-fork \
  --branch main \
  --token-ref GITHUB_TOKEN_SKYWALKING_FORK \
  --execution-mode fork-validated-pr \
  --devops-owner my-org \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --template rc \
  --objective "Validate the fork and open an upstream PR readiness path" \
  --require-source-ready \
  --require-devops-ready \
  --json
```

The JSON and human-readable output include `executionMode`, `repositoryOwner`, `devopsOwner`, `workflowRepository`, `credentialRef`, and `claimBoundary`. Agents must not claim more than the returned `claimBoundary`.

## Documentation

- [Workflows](workflows.md) - one-command and end-to-end scenarios.
- [Commands](commands.md) - command groups and syntax.
- [Automation](automation.md) - WorkBuddy, Codex, Claude Code, and CI rules.
- [AI Agent Runbook](../guides/ai-agent-runbook.md) - production operating runbook for external agents.
