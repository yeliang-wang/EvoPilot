# EvoPilot CLI Commands

> Command reference for `@evopilot/cli`.

The CLI uses EvoPilot HTTP APIs. Global flags can be used with any command:

```text
--server <url>              EvoPilot server URL
--token <token>             Bearer token
--tenant <id>               Tenant scope header
--workspace <id>            Workspace scope header
--actor <id>                Actor scope header
--idempotency-key <key>     Idempotency key for mutating commands
--timeout <duration>        Wrapper stop boundary, for example 30s, 10m, or 2h
--until <policy>            Wrapper stop policy: terminal or blocked-or-complete
--require-source-ready      project onboard / target run fails fast unless source credentials are READY
--require-devops-ready      target run fails fast unless project DevOps preflight is READY
--json                      Print JSON response data
--config <file>             Config path, defaults to ~/.evopilot/config.json
```

## Auth

```bash
evopilot auth login --server <url> --username <user> --password <pass>
evopilot auth token
```

`auth login` stores server, token, tenant, workspace, and user metadata unless `--no-save` is used.

## Config

```bash
evopilot config path
evopilot config show
```

## Status

```bash
evopilot status --json
```

Checks `/health`, `/ready`, and authenticated `/api/v1/summary` when a token is configured.
It also reads `/api/v1/version` and returns `cli.version`, `api.serverVersion`, `api.apiContractVersion`, and `api.minimumCliVersion` when the server supports the version endpoint.

## Project

```bash
evopilot project register --id <id> --provider <local-git|github|gitlab> [options]
evopilot project onboard plan <github|gitlab|local-git> [options]
evopilot project onboard <github|gitlab|local-git> [options]
evopilot project onboard verify <project-id> [options]
evopilot project list
evopilot project preflight <project-id>
evopilot project credentials set <project-id> [options]
```

Common register options:

```text
--name <name>
--profile-id <profile-id>
--root <path>
--git-url <url>
--base-url <url>
--project-id <gitlab-project-id>
--owner <github-owner>
--repo <owner/repo>
--repo-name <repo>
--branch <branch>
--username <username>
--password <password>
--source-token <token>
--token-ref <server-side-token-ref>
```

Credential options:

```text
--username <username>
--password <password>
--source-token <token>
--token-ref <server-side-token-ref>
--branch <branch>
--clear-inline-token
--clear-password
--clear-token-ref
```

`project onboard plan` is a non-mutating front-door checklist. It calls `POST /api/v1/onboarding/project/checklist` and returns `evopilot-project-onboarding-checklist/v1` with `status`, `steps`, `sourceCredentials`, `devops`, `missingInputs`, `blockers`, `commands`, `nextAction`, and `requestId`.

Use it before first project registration:

```bash
evopilot project onboard plan github \
  --repo owner/my-agent \
  --id my-agent \
  --token-ref GITHUB_TOKEN_MY_AGENT \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --template ga \
  --json
```

`project onboard verify` replays the same checklist against a persisted project through `GET /api/v1/projects/{projectId}/onboarding-checklist`.

```bash
evopilot project onboard verify my-agent --template ga --json
```

`project onboard` is the mutating wrapper for a new project. It registers the repository, runs source credential preflight, optionally configures repository-native DevOps, runs DevOps preflight, and can continue into `target run` when `--template` is supplied.

By default, `project onboard` returns a white-box result and next action after registration and preflight. Add `--require-source-ready --require-devops-ready` for strict end-to-end automation that must stop before Goal/Loop execution when source writeback or repository-native DevOps is not ready.

Common onboard options:

```text
--id <project-id>
--repo <owner/repo>
--owner <github-owner>
--repo-name <github-repo>
--base-url <gitlab-or-github-api-base-url>
--project-id <gitlab-project-id>
--branch <branch>
--token-ref <server-side-secret-ref>
--ci-workflow <workflow-file>
--ci-required-check <check>
--ci-required-stage <stage>
--ci-required-job <job>
--cd-workflow <workflow-file>
--deploy-environment <environment>
--health-url <url>
--ready-url <url>
--template <experimental|alpha|beta|rc|ga>
--objective <text>
```

## Project DevOps

```bash
evopilot project devops set <project-id> --provider <github-actions|gitlab-ci> [options]
evopilot project devops inspect <project-id>
evopilot project devops preflight <project-id>
evopilot project devops clear <project-id>
```

Common options:

```text
--token-ref <server-side-token-ref>
--ci-workflow <workflow-file>
--ci-ref <ref>
--ci-required-check <check>
--ci-required-stage <stage>
--ci-required-job <job>
--ci-timeout-seconds <seconds>
--cd-workflow <workflow-file>
--deploy-environment <environment>
--cd-required-stage <stage>
--cd-required-job <job>
--deploy-input <key=value>
--health-url <url>
--ready-url <url>
--deploy-timeout-seconds <seconds>
```

## Secrets

```bash
evopilot secret list
evopilot secret set --id <secret-ref> --kind <kind> (--value <value>|--value-file <file>|--from-env <env>)
evopilot secret revoke <secret-ref>
```

Secret values are sent to the EvoPilot server once and are not printed back. Source and DevOps `tokenRef` resolution first checks server environment variables, then EvoPilot's secret vault.
Use `--value-file` or `--from-env` for private keys and other values that start with `-`.

Common kinds:

```text
source-token
deploy-token
github-app-private-key
github-webhook-secret
llm-key
generic
```

## GitHub App

```bash
evopilot github-app installation list
evopilot github-app installation set --id <id> --installation-id <github-installation-id> --account <org-or-user> [options]
evopilot github-app installation preflight <id>
```

Common options:

```text
--private-key-secret-ref <secret-ref>
--webhook-secret-ref <secret-ref>
--repository <owner/repo>
--permission <name=value>
```

## Evidence

```bash
evopilot evidence push --project <project-id> --file <events.json>
```

The file must contain a JSON event object or an array of events accepted by EvoPilot evidence ingestion.

## Target

```bash
evopilot target templates
evopilot target list [--project <project-id>]
evopilot target create --project <project-id> --template <experimental|alpha|beta|rc|ga>
evopilot target run --project <project-id> --template <template> --objective <text>
evopilot target decision <target-id> [--project <project-id>]
```

`target run` is the one-command wrapper for a project release target.
Use `--require-source-ready --require-devops-ready` when the run must fail before Goal/Loop execution if PR/merge or repository-native DevOps is not ready.

## Goal

```bash
evopilot goal create --project <id> --target <target-id> --objective <text>
evopilot goal list [--project <id>] [--target <target-id>] [--status <status>]
evopilot goal inspect <goal-id>
evopilot goal plan <goal-id>
evopilot goal approve-plan <goal-id>
evopilot goal targets <goal-id>
evopilot goal advance <goal-id> [--no-auto-start] [--approve-human-gate]
evopilot goal run [<goal-id>] [--project <id> --target <target-id> --objective <text>]
evopilot goal snapshot <goal-id>
evopilot goal graph <goal-id>
evopilot goal timeline <goal-id>
evopilot goal evidence-matrix <goal-id>
evopilot goal final-report <goal-id>
```

`goal advance` advances one server-governed step. It is atomic even when a wrapper command calls it repeatedly.

## Loop

```bash
evopilot loop create --project <id> --target <target-id> --objective <text>
evopilot loop list
evopilot loop start <loop-id>
evopilot loop approve <loop-id>
evopilot loop run [<loop-id>] [--project <id> --target <target-id> --objective <text>]
```

Common loop options:

```text
--source-closure <json-file>
--executor-graph <graph-id>
--force-decision <SUCCEED|BLOCK|FAIL>
--max-iterations <n>
--until <terminal|blocked-or-complete>
```

## Source Closure

```bash
evopilot source-closure preflight <loop-id>
evopilot source-closure execute <loop-id> --write-file <repo-path>:<local-file>
evopilot source-closure approve-release <loop-id>
evopilot source-closure reject-release <loop-id> [--reason <text>]
evopilot source-closure merge <loop-id>
evopilot source-closure auto-merge <loop-id>
```

Common execute options:

```text
--branch <branch>
--message <commit-message>
--write-file <repo-path>:<local-file>
```

## Release Run

```bash
evopilot release-run list [--loop <loop-id>]
evopilot release-run inspect <run-id> [--loop <loop-id>]
evopilot release-run repair-candidates [--include-repaired]
evopilot release-run repair <run-id> [--execute]
evopilot release-run repair-all [--execute]
evopilot release-run finalizers [--status <PENDING|SUCCEEDED|FAILED>]
```

## Worker

```bash
evopilot worker queue
evopilot worker leases
evopilot worker claim --worker-id <id> [--loop <loop-id>]
evopilot worker heartbeat --worker-id <id> --loop <loop-id>
```

## Sandbox

```bash
evopilot sandbox proof <loop-id>
evopilot sandbox verify <loop-id>
```

## Replay

```bash
evopilot replay checkpoints <loop-id>
evopilot replay run <loop-id> [--from-iteration <n>]
```

## Trace

```bash
evopilot trace tree <loop-id>
evopilot trace events <loop-id>
```

## Audit

```bash
evopilot audit list [--limit <n>]
```

## Deploy Connectors

```bash
evopilot connector deploy list
evopilot connector deploy create --id <id> --type <http-webhook|ecs-docker-compose>
```

Common create options:

```text
--url <url>
--connector-token <token>
--token-ref <server-side-token-ref>
--working-dir <server-path>
--compose-file <compose-file>
--service-name <service>
--git-remote <remote>
--health-path <path>
--ready-path <path>
--timeout-seconds <seconds>
```

## Release

```bash
evopilot release gate --project <id> --target <target-id> --scenario <id=PASS>
evopilot release current
evopilot release decisions [--project <id>] [--target <target-id>]
```

Release verdicts must come from EvoPilot release decisions, not from CLI-side inference.
