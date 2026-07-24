# EvoPilot CLI Commands

> Command reference for `@evopilot/cli`.

The CLI uses EvoPilot HTTP APIs. Global flags can be used with any command:

```text
--server <url>              EvoPilot server URL
--token <token>             Bearer token
--tenant <id>               Tenant scope header
--workspace <id>            Workspace scope header
--actor <id>                Actor scope header
--client <surface>          Client surface for logs, for example mac-terminal or workbuddy
--idempotency-key <key>     Idempotency key for mutating commands
--timeout <duration>        Wrapper stop boundary, for example 30s, 10m, or 2h
--until <policy>            Wrapper stop policy: terminal or blocked-or-complete
--require-source-ready      project onboard / target run fails fast unless source credentials are READY
--require-devops-ready      target run fails fast unless project DevOps preflight is READY
--execution-mode <mode>     owned-repository | read-only-public | fork-validated-pr | upstream-authorized
--upstream-repo <repo>      Public upstream repository for read-only or fork-validated PR mode
--working-repo <repo>       Writable repository where EvoPilot writes code and runs native DevOps
--devops-owner <account>    GitHub owner or GitLab namespace whose account runs CI/CD
--devops-token-ref <ref>    Optional server-side DevOps tokenRef, otherwise source tokenRef is used
--credential-principal <id> Optional operator-readable principal expected behind the DevOps tokenRef
--llm-profile <id>          LLM profile for project onboarding or this Goal/Loop run
--require-llm-ready         project onboard / target run fails fast unless the selected LLM profile is READY
--auto-approve-plan         Wrapper explicitly approves the generated Alpha/Beta/RC/GA plan before execution
--json                      Print JSON response data
--config <file>             Config path, defaults to ~/.evopilot/config.json
```

## Output Schemas

Use `--json` for AI agents and CI. Human-readable output is for operators and can change.

| Command | JSON Schema | Important Fields |
|---|---|---|
| `status --json` | `evopilot-cli-status/v1` | `health`, `ready`, `api`, `summary`, `client`, `llmUsage` |
| `project onboard plan ... --json` | `evopilot-project-onboarding-checklist/v1` | `status`, `nextAction`, `missingInputs`, `blockers`, `commands`, `sourceCredentials`, `devops`, `llm`, `requestId` |
| `project onboard verify ... --json` | `evopilot-project-onboarding-checklist/v1` | Persisted project readiness, same fields as `plan`, including project LLM readiness |
| `project onboard ... --json` | `evopilot-cli-project-onboard/v1` | `projectId`, `sourceCredentials`, `devops`, `steps`, `result`, `llmUsage`; onboarding does not start Goal/Loop execution |
| `target plan ... --json` | `evopilot-cli-target-plan/v1` | `projectId`, `targetId`, `goalId`, `terminalMaturity`, `phasePlan.phases`, `phasePlan.targets`, `editablePlan`, `llmUsage` |
| `target plan diff ... --json` | `evopilot-cli-target-plan-diff/v1` | `addedTargets`, `removedTargets`, `changedTargets`, `changedPhases`, `baselineGuard` |
| `target run ... --json` | `evopilot-cli-goal-run/v1` | `status`, `steps`, `result`, `llmUsage` |
| `goal run ... --json` | `evopilot-cli-goal-run/v1` | `status`, `steps`, `result`, `llmUsage` |
| `loop run ... --json` | `evopilot-cli-loop-run/v1` | `loop`, `steps`, `result`, `llmUsage` |

Wrapper `result.exitCode=0` means the command reached its governed success boundary. `result.exitCode=2`, a non-zero process exit, or `nextAction` values such as `approve-plan`, `connect-github-account`, `connect-gitlab-account`, `human-approval`, `configure-source-credentials`, `configure-devops`, `policy-review`, `repair`, `BLOCKED`, `FAILED`, or `NO-GO` are stop conditions for automation.

Every wrapper schema includes `llmUsage` with `summary`, `process.responses[]`, and server-side usage evidence when the API returns it. Agents must report provider, model, token totals, and request IDs for LLM-backed runs.

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

`status --json` also returns `client` and `llmUsage`. Automation should read `llmUsage.summary.provider`, `llmUsage.summary.model`, and token fields before starting a cost-sensitive run.

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
--execution-mode <owned-repository|read-only-public|fork-validated-pr|upstream-authorized>
--upstream-repo <owner/repo-or-group/project>
--working-repo <owner/repo-or-group/project>
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
--llm-profile <llm-profile-id>
--require-llm-ready
```

`project onboard plan` is a non-mutating front-door checklist. It calls `POST /api/v1/onboarding/project/checklist` and returns `evopilot-project-onboarding-checklist/v1` with `status`, `steps`, `sourceCredentials`, `devops`, `missingInputs`, `blockers`, `commands`, `nextAction`, and `requestId`.

Writable GitHub/GitLab modes require an execution principal. If the checklist returns `nextAction=connect-github-account` or `nextAction=connect-gitlab-account`, the operator must connect or create the account/organization/group/service principal, fork or authorize the repository as needed, and store the server-side `tokenRef` before rerunning onboarding. Use `read-only-public` when no SCM account exists.

Use it before first project registration:

```bash
evopilot project onboard plan github \
  --repo owner/my-agent \
  --id my-agent \
  --token-ref GITHUB_TOKEN_MY_AGENT \
  --execution-mode owned-repository \
  --devops-owner owner \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --json
```

`project onboard verify` replays the same checklist against a persisted project through `GET /api/v1/projects/{projectId}/onboarding-checklist`.

```bash
evopilot project onboard verify my-agent --json
```

`project onboard` is the mutating wrapper for a new project. It registers the repository, runs source credential preflight, optionally configures repository-native DevOps, and runs DevOps preflight. It does not start Goal/Loop execution; use `target plan` and `target run` after the project checklist is `READY_TO_RUN`.

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
--execution-mode <owned-repository|read-only-public|fork-validated-pr|upstream-authorized>
--upstream-repo <owner/repo-or-group/project>
--working-repo <owner/repo-or-group/project>
--devops-owner <github-owner-or-gitlab-namespace>
--devops-token-ref <server-side-devops-secret-ref>
--credential-principal <principal>
--ci-workflow <workflow-file>
--ci-required-check <check>
--ci-required-stage <stage>
--ci-required-job <job>
--cd-workflow <workflow-file>
--deploy-environment <environment>
--health-url <url>
--ready-url <url>
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
--execution-mode <owned-repository|fork-validated-pr|upstream-authorized>
--upstream-repo <owner/repo-or-group/project>
--working-repo <owner/repo-or-group/project>
--devops-owner <github-owner-or-gitlab-namespace>
--devops-namespace <gitlab-namespace>
--workflow-repo <owner/repo-or-group/project>
--devops-token-ref <server-side-devops-secret-ref>
--credential-principal <principal>
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

DevOps configuration requires an explicit execution boundary. The CLI blocks ambiguous commands such as `evopilot project onboard github --repo apache/skywalking --with-devops` because it cannot know whether DevOps should run in the public upstream, a fork, or a maintainer-owned namespace.

Execution modes:

| Mode | Use When | Required Principal | Claim Boundary |
|---|---|---|---|
| `owned-repository` | The same GitHub/GitLab owner controls source writeback and CI/CD. | Owner, organization, group, service account, deploy token, or GitHub App principal with write/CI permission. | `working-repo-ci` |
| `read-only-public` | The repository is public and no writable token/account is available. | None. | `read-only-analysis` |
| `fork-validated-pr` | The upstream is public or third-party, and EvoPilot works in a writable fork. | Operator-owned fork account/organization/group that runs CI/CD. | `fork-ci-pr` |
| `upstream-authorized` | A maintainer token can write to and run CI/CD in the upstream. | Upstream maintainer principal. | `upstream-release` |

`project devops preflight` returns `executionMode`, `repositoryOwner`, `devopsOwner`, `workflowRepository`, `credentialRef`, `credentialPrincipal`, and `claimBoundary`. Automation must stop when `status` is not `READY`, and must not claim a stronger result than `claimBoundary`.

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
llm-api-key
generic
```

## LLM Profiles

```bash
evopilot llm profile list
evopilot llm profile set <profile-id> --provider openai-compatible --base-url <url> --model <name> --api-key-ref <secret-ref>
evopilot llm profile inspect <profile-id>
evopilot llm profile preflight <profile-id>
```

Common profile options:

```text
--name <display-name>
--provider openai-compatible
--provider-name <provider-label>
--base-url <openai-compatible-base-url>
--model <model-name>
--model-name <model-name>
--api-key-ref <server-side-secret-ref>
--timeout-seconds <seconds>
--max-retries <n>
--default-max-output-tokens <tokens>
--max-output-tokens <tokens>
--temperature <0..2>
--thinking <type>
--disabled
```

`llm profile set` creates or updates a tenant/workspace-scoped profile. It stores only metadata and a server-side `apiKeyRef`; it does not print the raw key. Before creating a profile, store the key once:

```bash
evopilot secret set \
  --id LLM_API_KEY_QWEN_PRIVATE \
  --kind llm-key \
  --from-env LLM_API_KEY_QWEN_PRIVATE \
  --json
```

`llm profile preflight` returns `evopilot-llm-profile-readiness/v1` with:

```text
profileId
source
status
provider
model
baseUrl
apiKeyRef
checks[]
blockers[]
nextAction
```

Stop when `status` is not `READY`. Typical `nextAction` values are `store-llm-secret`, `configure-llm-profile`, and `repair-llm-provider`.

## Project LLM

```bash
evopilot project llm set <project-id> --profile <llm-profile-id>
evopilot project llm inspect <project-id>
evopilot project llm preflight <project-id>
evopilot project llm clear <project-id>
```

`project llm set` binds a project default LLM profile. Add `--require-llm-ready` to fail fast if the profile cannot resolve its key or provider probe:

```bash
evopilot project llm set my-agent \
  --profile qwen-private \
  --require-llm-ready \
  --json
```

Goal and Loop creation resolve the LLM in this order:

```text
--llm-profile override -> project default profile -> global server default LLM
```

Use `project llm clear` only when the project should fall back to the global server default LLM.

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

## Maturity Standards

```bash
evopilot maturity standards list
evopilot maturity standards inspect <alpha|beta|rc|ga|standard-id>
```

`maturity standards list` returns the active versioned maturity set. The default standard set is `evopilot-default/v1` and the terminal maturity is GA. `inspect` returns one `evopilot-maturity-standard-template/v1` with baseline rules, acceptance criteria, required evidence, review capabilities, package outputs, GO/NO-GO rules, and override policy.

## Target

```bash
evopilot target list [--project <project-id>]
evopilot target create --project <project-id> [--id <target-id>] [--criteria <target.json>]
evopilot target plan --project <project-id> --objective <business-goal>
evopilot target plan export <goal-id> [--format json|yaml]
evopilot target plan diff <goal-id> --file <plan.json>
evopilot target plan apply <goal-id> --file <plan.json>
evopilot target plan approve <goal-id>
evopilot target run --project <project-id> --objective <business-goal>
evopilot target decision <target-id> [--project <project-id>]
```

`target plan` creates or reuses the project release target and GlobalGoal, generates the server plan, and returns the Alpha -> Beta -> RC -> GA phase plan for user review. `target plan export` writes the same plan shape that `target plan apply` accepts, so a user or WorkBuddy can edit project-specific targets or strengthen phase criteria, run `diff`, apply the proposal, and then approve it.

`target run` is the one-command wrapper for a project release target. It requires a business `--objective`; do not write the objective as "promote to GA" unless that is the actual business outcome. The terminal maturity is GA, and EvoPilot always expands the goal through Alpha, Beta, RC, and GA. If the plan is not approved, the wrapper stops at `PENDING_PLAN_APPROVAL` and returns `nextAction=approve-plan`; use `--auto-approve-plan` only when policy allows unattended plan acceptance.

Use `--require-source-ready --require-devops-ready` when the run must fail before Goal/Loop execution if PR/merge or repository-native DevOps is not ready.
Use `--llm-profile <id>` to override the project default LLM for this run, and `--require-llm-ready` to stop before Loop execution if the selected profile is blocked.

The CLI does not accept maturity-template parameters for `target plan`, `target run`, or `project onboard`. GA is the fixed terminal maturity. The server generates the Alpha -> Beta -> RC -> GA phase plan from the business `--objective`, the active maturity standard set, and project release evidence.

`target run`, `goal run`, `loop run`, and `project onboard` wrapper output includes command-level and step-level LLM visibility:

```text
llmUsage.client.surface
llmUsage.summary.provider
llmUsage.summary.model
llmUsage.summary.totalTokens
llmUsage.summary.inputTokens
llmUsage.summary.outputTokens
llmUsage.summary.creditsConsumed
llmUsage.process.responses[].requestId
llmUsage.server.steps[].nodeId
llmUsage.server.steps[].totalTokens
```

Use `--client workbuddy` or `EVOPILOT_CLI_CLIENT=workbuddy` when WorkBuddy invokes the CLI. EvoPilot HTTP logs store the same caller under `metadata.client.surface` and request token deltas under `metadata.llmUsage.request.totalTokens`.

## Goal

```bash
evopilot goal create --project <id> --target <target-id> --objective <text>
evopilot goal list [--project <id>] [--target <target-id>] [--status <status>]
evopilot goal inspect <goal-id>
evopilot goal plan <goal-id>
evopilot goal approve-plan <goal-id>
evopilot goal targets <goal-id>
evopilot goal phases <goal-id>
evopilot goal phase-package <goal-id> --phase <alpha|beta|rc|ga>
evopilot goal advance <goal-id> [--no-auto-start] [--approve-human-gate]
evopilot goal run [<goal-id>] [--project <id> --target <target-id> --objective <text>]
evopilot goal snapshot <goal-id>
evopilot goal graph <goal-id>
evopilot goal timeline <goal-id>
evopilot goal evidence-matrix <goal-id>
evopilot goal final-report <goal-id>
```

`goal phases` returns the current Alpha/Beta/RC/GA phase projection. `goal phase-package` returns the phase package with target summary, acceptance criteria, required evidence, blockers, review capabilities, package outputs, and GO/NO-GO decision.
`goal advance` advances one server-governed step. It is atomic even when a wrapper command calls it repeatedly.
`goal create` and `goal run` accept `--llm-profile <id>` for run-level LLM selection.

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
--llm-profile <llm-profile-id>
--require-llm-ready
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
