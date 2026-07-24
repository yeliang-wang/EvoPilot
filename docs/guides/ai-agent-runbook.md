# AI Agent Runbook

> Production runbook for WorkBuddy, Codex, Claude Code, CI jobs, and other AI agents that operate EvoPilot through the CLI.

Use this file as the agent entrypoint. It gives the shortest safe path first, then the atomic fallback commands and the log evidence needed to troubleshoot a production run.

EvoPilot is the system of record. The CLI submits server-governed requests; it does not bypass RBAC, tenant/workspace scope, approval gates, source-closure preflight, release policy, deployment gates, audit records, or final release decisions.

## Goal And Phase Semantics

The user provides a business objective, not a maturity label. A good `--objective` describes the product outcome, for example:

```text
Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent.
```

EvoPilot sets terminal maturity to GA and decomposes the objective through the fixed progression:

```text
Alpha -> Beta -> RC -> GA
```

Each phase has baseline standards, acceptance criteria, required evidence, review capabilities, package outputs, and a GO/NO-GO decision. The active standard set is `evopilot-default/v1`, visible through `evopilot maturity standards list --json` and `evopilot maturity standards inspect <alpha|beta|rc|ga> --json`.

WorkBuddy must show the generated plan to the user before execution. Users may add project-specific GoalTargets or strengthen evidence and review requirements, but they must not delete Alpha/Beta/RC/GA, skip a phase, or remove baseline criteria while claiming standard GA.

## Fast Path

Configure access with environment variables. Prefer env vars over saved config for automated agents.

```bash
export EVOPILOT_SERVER="https://evopilot.example.com"
export EVOPILOT_API_TOKEN="<operator-or-admin-token>"
export EVOPILOT_TENANT="tenant-production"
export EVOPILOT_WORKSPACE="workspace-agent-products"
export EVOPILOT_ACTOR="workbuddy"
export EVOPILOT_CLI_CLIENT="workbuddy"
```

Verify the control plane before making changes:

```bash
evopilot config show --json
evopilot status --json
```

For a first-time GitHub or GitLab project, ask EvoPilot for a checklist before mutating state:

```bash
evopilot project onboard plan github \
  --repo owner/my-agent \
  --id my-agent \
  --branch main \
  --token-ref GITHUB_WRITE_TOKEN_MY_AGENT \
  --execution-mode owned-repository \
  --devops-owner owner \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --ci-required-check test \
  --cd-workflow deploy-prod.yml \
  --deploy-environment production \
  --health-url https://my-agent.example.com/health \
  --template ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --json
```

Read the checklist contract:

```text
schema=evopilot-project-onboarding-checklist/v1
status=READY_TO_ONBOARD | READY_TO_RUN | WAITING_INPUT | BLOCKED
nextAction=store-secret | connect-github-account | connect-gitlab-account | install-github-app | register-project | configure-source-credentials | configure-devops | run-target | repair
```

For GitHub/GitLab DevOps, also read:

```text
executionMode=owned-repository | read-only-public | fork-validated-pr | upstream-authorized
devopsOwner=<github-owner-or-gitlab-namespace>
workflowRepository=<repository-that-runs-ci-cd>
credentialRef=<server-side-secret-ref>
credentialPrincipal=<optional-principal-label>
claimBoundary=working-repo-ci | read-only-analysis | fork-ci-pr | upstream-release
```

The agent must not claim more than `claimBoundary`. In particular, `fork-ci-pr` is not an upstream release.

Writable GitHub/GitLab modes require an execution principal owned by the operator, user, or organization. For third-party open-source upstreams, use an operator-owned fork with `fork-validated-pr`, or use `upstream-authorized` only with maintainer credentials. If no GitHub/GitLab account or group exists, use `read-only-public` and do not claim PR, CI/CD, merge, deploy, or release readiness.

If `nextAction=store-secret`, use the suggested `secret set` command from the checklist only from a trusted shell where the token environment variable is available. If `nextAction=connect-github-account` or `nextAction=connect-gitlab-account`, stop until the operator connects or creates the matching SCM account/group/principal and stores the server-side tokenRef. If `nextAction=register-project`, continue with `project onboard`. If `nextAction=run-target`, continue with `target run`. If `status=BLOCKED`, stop and report `blockers`.

For an already registered project, verify source credentials and native DevOps before invoking a one-command target:

```bash
evopilot project preflight my-agent --json
evopilot project devops preflight my-agent --json
evopilot project llm preflight my-agent --json
evopilot project onboard verify my-agent --template ga --json
```

If the project must use a custom public or private LLM, create the server-side LLM profile before the first loop target. This is normally a one-time trusted setup step:

```bash
export LLM_API_KEY_MY_AGENT="<real-llm-api-key>"

evopilot secret set \
  --id LLM_API_KEY_MY_AGENT \
  --kind llm-key \
  --from-env LLM_API_KEY_MY_AGENT \
  --json

evopilot llm profile set my-agent-llm \
  --provider openai-compatible \
  --base-url https://llm.example.com/v1 \
  --model qwen2.5-coder-32b \
  --api-key-ref LLM_API_KEY_MY_AGENT \
  --json

evopilot llm profile preflight my-agent-llm --json

evopilot project llm set my-agent \
  --profile my-agent-llm \
  --require-llm-ready \
  --json
```

Daily WorkBuddy commands should pass only the LLM profile id, never the raw API key. EvoPilot resolves LLMs in this order:

```text
run override --llm-profile -> project default LLM -> server global default LLM
```

Generate the project phase plan before execution:

```bash
evopilot target plan \
  --project my-agent \
  --template ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --llm-profile my-agent-llm \
  --require-llm-ready \
  --client workbuddy \
  --json
```

EvoPilot returns `evopilot-cli-target-plan/v1` with `goalId`, `terminalMaturity=ga`, `phasePlan.phases[]`, `phasePlan.targets[]`, and `editablePlan`. WorkBuddy should show this plan to the user. If the user wants changes, export, edit, diff, and apply before approval:

```bash
evopilot target plan export <goal-id> --format json > /tmp/my-agent-phase-plan.json
evopilot target plan diff <goal-id> --file /tmp/my-agent-phase-plan.json --json
evopilot target plan apply <goal-id> --file /tmp/my-agent-phase-plan.json --json
evopilot target plan approve <goal-id> --json
```

The plan must still keep Alpha, Beta, RC, and GA. Users can add GoalTargets or strengthen acceptance criteria, required evidence, and review requirements; they cannot skip a phase or remove baseline criteria and still claim standard GA.

Run the approved project goal:

```bash
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --until terminal \
  --max-steps 20 \
  --require-source-ready \
  --require-devops-ready \
  --llm-profile my-agent-llm \
  --require-llm-ready \
  --client workbuddy \
  --json
```

If `target run` is called before approval, it returns `PENDING_PLAN_APPROVAL`, `nextAction=approve-plan`, and exit code `2`. Use `--auto-approve-plan` only when the operator has explicitly allowed unattended acceptance of the generated plan.

After every wrapper command, collect LLM usage before making a success claim:

```text
llmUsage.client.surface
llmUsage.summary.provider
llmUsage.summary.model
llmUsage.summary.totalTokens
llmUsage.summary.inputTokens
llmUsage.summary.outputTokens
llmUsage.summary.creditsConsumed
llmUsage.process.responses[].requestId
llmUsage.server.steps[].loopId
llmUsage.server.steps[].nodeId
llmUsage.server.steps[].totalTokens
```

`llmUsage.summary` is the command-level total. `llmUsage.server.steps[]` is the Loop executor-level evidence. If a run used an LLM but the agent cannot identify provider, model, or token totals, report the run as incomplete evidence instead of claiming completion.

For a new GitHub project, use the onboarding wrapper after the tokenRef is available to the EvoPilot server:

```bash
evopilot project onboard github \
  --repo owner/my-agent \
  --id my-agent \
  --branch main \
  --token-ref GITHUB_WRITE_TOKEN_MY_AGENT \
  --execution-mode owned-repository \
  --devops-owner owner \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --ci-required-check test \
  --cd-workflow deploy-prod.yml \
  --deploy-environment production \
  --health-url https://my-agent.example.com/health \
  --template ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --until terminal \
  --max-steps 20 \
  --require-source-ready \
  --require-devops-ready \
  --llm-profile my-agent-llm \
  --require-llm-ready \
  --client workbuddy \
  --json
```

## End-To-End GitHub Project Loop Target

Use this section when an AI agent needs to operate a GitHub project from onboarding to a governed Loop Target. The short rule is:

```text
Plan onboarding -> store or repair credentials -> register project -> verify checklist -> run target -> stop on blockers -> inspect release decision
```

The GitHub token is not passed in the daily `target run` command. A writable token must be available to the EvoPilot server process through a server-side environment variable or the same tenant/workspace EvoPilot secret vault, and the project stores only a `tokenRef`.

### Scenario 1: Read-Only Public Repository

Use this when the operator only wants repository analysis, target decomposition, evidence review, or blocker discovery. Public GitHub repositories can be registered without a token:

```bash
evopilot project onboard plan github \
  --repo owner/public-agent \
  --id public-agent \
  --branch main \
  --execution-mode read-only-public \
  --json

evopilot project onboard github \
  --repo owner/public-agent \
  --id public-agent \
  --branch main \
  --execution-mode read-only-public \
  --json

evopilot project preflight public-agent --json
```

Expected result:

```json
{
  "status": "READ_ONLY",
  "nextAction": "connect-github-account"
}
```

Agents may continue with read-only inspection, but must not claim that source writeback, PR, merge, or deployment is ready. A later `target run` may stop at `configure-source-credentials`.

### Scenario 2: Real PR To A Writable Owned Repository

Use this when EvoPilot must create branches, commits, PRs, and run CI/CD in a repository owned by the operator. EvoPilot cannot bypass GitHub/GitLab permissions.

First, the production operator configures a token in the EvoPilot server environment or writes it once to EvoPilot's secret vault. Do not pass the raw token in daily `target run` commands.

```bash
# On the EvoPilot server runtime, for example ECS .env.production or a secret manager.
GITHUB_WRITE_TOKEN_MY_AGENT=<github-token-with-repo-write>
```

Restart the EvoPilot server and workers after changing server-side environment variables. Then register the writable project from any machine that can reach the production control plane:

If the operator uses the EvoPilot secret vault instead of environment variables, run this once from a trusted machine or CI secret context:

```bash
evopilot secret set \
  --id GITHUB_WRITE_TOKEN_MY_AGENT \
  --kind source-token \
  --from-env GITHUB_WRITE_TOKEN_MY_AGENT \
  --json
```

Before registration, generate the server-side checklist:

```bash
evopilot project onboard plan github \
  --repo yeliang-wang/my-agent-fork \
  --id my-agent \
  --branch main \
  --token-ref GITHUB_WRITE_TOKEN_MY_AGENT \
  --execution-mode owned-repository \
  --devops-owner yeliang-wang \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --template ga \
  --json
```

```bash
evopilot project register \
  --id my-agent \
  --provider github \
  --repo yeliang-wang/my-agent-fork \
  --branch main \
  --token-ref GITHUB_WRITE_TOKEN_MY_AGENT \
  --idempotency-key project-my-agent \
  --json

evopilot project preflight my-agent --json
evopilot project onboard verify my-agent --template ga --json
```

Expected result before a real PR run:

```json
{
  "status": "READY",
  "nextAction": "write-source"
}
```

Only after `READY`, run the one-command target:

```bash
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --until terminal \
  --max-steps 20 \
  --client workbuddy \
  --json
```

### Scenario 3: Public Upstream With A Writable Fork

Use this when the desired target is an open-source upstream or third-party repository, but the operator only has write permission to a fork. DevOps runs in the fork owner's GitHub/GitLab account.

If the user does not have a GitHub/GitLab account or organization/group, do not continue with this scenario. Ask the user to create or connect one, or fall back to Scenario 1 read-only inspection.

```bash
evopilot project onboard plan github \
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
  --template ga \
  --objective "Add the requested upstream-compatible capability and produce fork CI plus PR readiness evidence" \
  --json
```

If the checklist says `register-project`, run the same command with `project onboard`:

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
  --template ga \
  --objective "Add the requested upstream-compatible capability and produce fork CI plus PR readiness evidence" \
  --require-source-ready \
  --require-devops-ready \
  --client workbuddy \
  --json
```

Expected readiness boundary:

```json
{
  "executionMode": "fork-validated-pr",
  "devopsOwner": "my-org",
  "workflowRepository": "my-org/skywalking-fork",
  "claimBoundary": "fork-ci-pr"
}
```

The agent may report fork CI and upstream PR readiness. It must not claim upstream merge, upstream deployment, or upstream release completion.

### Scenario 4: Upstream Maintainer Authorized

Use this only when the operator has a maintainer token for the upstream repository and wants EvoPilot to write and run CI/CD directly there:

```bash
evopilot project onboard github \
  --repo apache/skywalking \
  --id skywalking-upstream \
  --branch main \
  --token-ref GITHUB_TOKEN_APACHE_SKYWALKING_MAINTAINER \
  --execution-mode upstream-authorized \
  --devops-owner apache \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --template ga \
  --objective "Add the requested upstream capability and collect maintainer-authorized source and CI evidence" \
  --require-source-ready \
  --require-devops-ready \
  --client workbuddy \
  --json
```

The agent may claim upstream release readiness only after source and DevOps preflight both return `READY`, and only within the maintainer token's scope.

### Scenario 5: Repair An Existing Registered Project

Use this when `project list` shows `credentialsConfigured=false`, or `project preflight` returns `READ_ONLY`, `connect-github-account`, `connect-gitlab-account`, or legacy `configure-token-ref`.

```bash
evopilot project credentials set my-agent \
  --token-ref GITHUB_WRITE_TOKEN_MY_AGENT \
  --json

evopilot project preflight my-agent --json
```

If the result is still `READ_ONLY`, the tokenRef is stored but the EvoPilot server cannot resolve the environment variable or secret vault record. Stop and ask the operator to repair the server-side secret or restart the runtime. Do not retry source closure with the same blocker.

### Scenario 6: DevOps, CI, CD, And Release Closure

A successful source-to-release loop needs more than a GitHub token. Agents should verify each boundary before claiming an end-to-end result. EvoPilot's production path is repository-native DevOps: GitHub projects use GitHub Actions; GitLab projects use GitLab CI.

| Boundary | What EvoPilot Uses | How To Check |
|---|---|---|
| SCM writeback | GitHub token or tokenRef with repository write permission. | `evopilot project preflight <project-id> --json` returns `READY`. |
| Source closure | Loop source-closure contract and release run state. | `evopilot source-closure preflight <loop-id> --json` returns no blockers. |
| CI | Project DevOps config: GitHub Actions or GitLab CI. | `evopilot project devops preflight <project-id> --json` returns `READY`; inspect pipeline evidence after execution. |
| CD | Project DevOps CD workflow, deploy connector such as `ecs-docker-compose`, webhook, K8s, or cloud deployer. | `project devops preflight` and `connector deploy list` show the required boundary. |
| LLM | Project default LLM profile or per-run `--llm-profile` override. | `evopilot project llm preflight <project-id> --json` and wrapper `llmUsage.summary` show provider/model/tokens. |
| Health gate | Deployment health and readiness URLs or connector-provided probe URLs. | Release run gates include health/ready evidence. |
| Release decision | Product-native release evidence and policy. | `evopilot release decisions --project <project-id> --target <target-id> --json`. |

Configure GitHub Actions:

```bash
evopilot project devops set my-agent \
  --provider github-actions \
  --execution-mode owned-repository \
  --devops-owner yeliang-wang \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --ci-required-check test \
  --cd-workflow deploy-prod.yml \
  --deploy-environment production \
  --health-url https://my-agent.example.com/health \
  --json
```

Configure GitLab CI:

```bash
evopilot project devops set my-agent \
  --provider gitlab-ci \
  --execution-mode owned-repository \
  --devops-owner group \
  --ci-required-stage test \
  --ci-required-job build \
  --cd-required-stage deploy \
  --deploy-environment production \
  --ready-url https://my-agent.example.com/ready \
  --json
```

Common production checks before a one-command target:

```bash
evopilot project preflight my-agent --json
evopilot project devops preflight my-agent --json
evopilot project llm preflight my-agent --json
evopilot connector deploy list --json
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --until terminal \
  --max-steps 20 \
  --require-devops-ready \
  --require-llm-ready \
  --client workbuddy \
  --json
```

If `project devops preflight` returns `BLOCKED`, repair provider, tokenRef, workflow, required checks/jobs, or project binding before running the target. If it returns `OBSERVABLE`, current CI evidence is not green; an agent may inspect but must not claim release readiness. If `project llm preflight` returns `BLOCKED`, repair the server-side LLM key, profile, or provider before starting the Loop. If `target run` stops with `configure-source-credentials`, run `project preflight` and repair tokenRef. If it stops with `repair-deploy-target`, inspect or create the deploy connector. If it stops with `policy-review`, inspect the release run and do not merge until the server-side policy allows it. If it returns `NO-GO`, stop and report the release decision as authoritative.

### Security Rules For Agents

- Do not pass raw GitHub tokens in `target run`.
- Do not pass raw LLM API keys in `target run`, `goal run`, or `loop run`; use `--llm-profile`.
- Prefer server-side `tokenRef` over inline `--source-token`.
- Do not write secrets to committed files or evidence artifacts.
- Do not continue after `READ_ONLY`, `BLOCKED`, `configure-source-credentials`, `configure-devops`, or `repair-deploy-target` without explicit operator repair.
- Record the `projectId`, `goalId`, `loopId`, `releaseRunId`, `releaseDecisionId`, and `requestId` from JSON output.

## Command Model

EvoPilot CLI has two layers:

| Layer | Use It For | Examples |
|---|---|---|
| Wrapper commands | One-command project/goal/loop execution for agents and operators. | `target run`, `goal run`, `loop run` |
| Atomic commands | Step-level inspection, recovery, and explicit governance actions. | `goal plan`, `goal approve-plan`, `goal advance`, `source-closure preflight`, `release decisions` |

Wrapper commands compose atomic commands but still stop at server guardrails.

## Wrapper Stop Conditions

Agents must stop and report when any of these are returned:

| Stop Condition | Meaning | Next Action |
|---|---|---|
| `connect-github-account` | GitHub writeback or GitHub Actions requires a GitHub account/org/service principal. | Connect or create the account, fork or authorize the repo as needed, store tokenRef, then rerun preflight. |
| `connect-gitlab-account` | GitLab writeback or GitLab CI requires a GitLab account/group/deploy principal. | Connect or create the group/principal, fork or authorize the project as needed, store tokenRef, then rerun preflight. |
| `human-approval` | A governed human gate is waiting. | Ask the operator; do not self-approve. |
| `policy-review` | Release or merge policy blocked progress. | Inspect release run policy blockers. |
| `configure-source-credentials` | Source writeback credentials are missing or read-only. | Ask for credential repair. |
| `configure-devops` | Project GitHub Actions/GitLab CI contract is missing or invalid. | Run `project devops set` or ask the operator to repair tokenRef/workflow/checks. |
| `configure-llm` | No usable project or global LLM is selected for a required LLM run. | Create or bind an LLM profile, then run `project llm preflight`. |
| `store-llm-secret` | The selected profile's `apiKeyRef` cannot be resolved by the server. | Store the API key server-side with `secret set --kind llm-key`, then rerun preflight. |
| `configure-llm-profile` | LLM profile metadata is missing or incomplete. | Run `llm profile set` with provider, base URL, model, and apiKeyRef. |
| `repair-llm-provider` | The provider probe failed. | Repair endpoint, model, key, network, timeout, or provider compatibility. |
| `repair-project` | Project binding is incomplete or invalid. | Inspect project settings and preflight. |
| `repair-deploy-target` | Deploy connector or health/ready target is not valid. | Repair connector settings. |
| `repair` | The loop or release run needs a repair path. | Inspect trace, release runs, and audit. |
| `NO-GO` | Authoritative release verdict is negative. | Stop; do not reinterpret local tests as GA. |
| `BLOCKED` / `FAILED` | EvoPilot cannot continue automatically. | Build an incident pack. |
| `--max-steps` / `--max-iterations` / `--timeout` | Agent-defined boundary reached. | Rerun or switch to atomic inspection. |

## IDs To Record

Always keep these IDs from CLI JSON output when present:

```text
projectId
targetId
releaseTargetId
goalId
activeTargetId
loopId
releaseRunId
releaseDecisionId
requestId
auditId
```

The most useful JSON fields are usually:

```text
schema
command
until
result.exitCode
result.status
result.nextAction
result.goalId
result.activeTargetId
result.latestLoopId
result.releaseDecision
status.goal.id
status.goal.projectId
status.goal.releaseTargetId
status.chain
status.blockers
steps
llmUsage.summary.provider
llmUsage.summary.model
llmUsage.summary.inputTokens
llmUsage.summary.outputTokens
llmUsage.summary.totalTokens
llmUsage.summary.creditsConsumed
llmUsage.process.responses[].requestId
llmUsage.server.steps[]
```

Do not parse human-readable CLI text. Use `--json` and parse fields.

## Atomic Fallback

Use this path when a wrapper stops or when the agent needs white-box step control.

```bash
evopilot target create \
  --project my-agent \
  --template ga \
  --idempotency-key target-my-agent-ga \
  --json

evopilot project preflight my-agent --json
evopilot project devops preflight my-agent --json

evopilot goal create \
  --project my-agent \
  --target my-agent-ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --idempotency-key goal-my-agent-ga \
  --json

evopilot goal plan <goal-id> --json
evopilot target plan export <goal-id> --format json > /tmp/my-agent-phase-plan.json
evopilot target plan diff <goal-id> --file /tmp/my-agent-phase-plan.json --json
evopilot target plan apply <goal-id> --file /tmp/my-agent-phase-plan.json --json
evopilot goal approve-plan <goal-id> --json
evopilot goal phases <goal-id> --json
evopilot goal phase-package <goal-id> --phase alpha --json

evopilot goal snapshot <goal-id> --json
evopilot goal graph <goal-id> --json
evopilot goal timeline <goal-id> --json
evopilot goal evidence-matrix <goal-id> --json

evopilot goal advance <goal-id> --json
evopilot goal final-report <goal-id> --json
evopilot release decisions --project my-agent --target my-agent-ga --json
evopilot target decision my-agent-ga --project my-agent --json
```

For one concrete LoopRun:

```bash
evopilot loop run \
  --project my-agent \
  --target my-agent-rc \
  --objective "Fix RC blockers and collect release evidence" \
  --until blocked-or-complete \
  --max-iterations 10 \
  --client workbuddy \
  --json
```

If the loop stops before source closure:

```bash
evopilot trace tree <loop-id> --json
evopilot trace events <loop-id> --json
evopilot worker queue --json
evopilot audit list --limit 50 --json
```

If source closure is involved:

```bash
evopilot project preflight my-agent --json
evopilot source-closure preflight <loop-id> --json
evopilot release-run list --loop <loop-id> --json
evopilot release-run repair-candidates --json
```

## Console Output

Without `--json`, wrapper commands print a Dashboard-like terminal chain:

```text
EvoPilot Goal Run
Command    target run
Scope      tenant-production / workspace-agent-products
Project    my-agent
Target     my-agent-ga
Goal       goal-my-agent-ga-run
Status     RUNNING
Progress   2/6 required (33%)

Workflow
[OK] Project - my-agent
[OK] Release Target - my-agent-ga / GA Release
[RUNNING] GlobalGoal - goal-my-agent-ga-run / 2/6 required targets
[RUNNING] GoalTarget - source-closure-deploy / next=resume-loop
[RUNNING] LoopRun - loop-my-agent-ga-source-closure / iteration=2
[PLANNED] Source Closure - No source release run yet.
[PENDING] CI/CD + Deploy - No deploy finalizer yet.
[PENDING] Release Decision - No product-native release decision yet.
[NOT_READY] Final Report - Generated after GlobalGoal reaches terminal completion.

Next Action
resume-loop / blockers=0

Evidence
- snapshot: /api/v1/goals/<goal-id>/snapshot
- graph: /api/v1/goals/<goal-id>/graph
- evidence matrix: /api/v1/goals/<goal-id>/evidence-matrix
- release decision: pending

LLM Usage
Provider   zhipu
Model      glm-5.1
Tokens     total=1500 input=1000 output=500 credits=1500 calls=1
Step Usage
- loop-my-agent-ga-source-closure iter=1 node=plan provider=zhipu model=glm-5.1 tokens=1500 input=1000 output=500 request=<llm-request-id>
```

This output is for humans. Agents should use `--json`.

## Production Logs

EvoPilot server and Loop worker logs use JSON Lines with:

```text
schema=="evopilot-log/v1"
service=="evopilot"
category in ["http","runtime","release","worker","code-upgrade","cicd","audit","system"]
correlation.requestId
correlation.goalId
correlation.loopId
correlation.projectId
correlation.releaseTargetId
correlation.releaseRunId
correlation.releaseDecisionId
tenantId
workspaceId
actor
routeGroup
outcome
errorCode
latencyBucket
diagnosis.summary
diagnosis.likelyCause
diagnosis.recommendedAction
metadata.client.surface
metadata.llmUsage.request.totalTokens
```

Log queries:

```bash
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .correlation.requestId=="<request-id>")'
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .correlation.goalId=="<goal-id>")'
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .correlation.loopId=="<loop-id>")'
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .correlation.releaseRunId=="<release-run-id>")'
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and (.event=="project.devops.preflight" or .event=="devops.pipeline.triggered"))'
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .outcome=="failed")'
journalctl -u evopilot-worker -o cat | jq 'select(.schema=="evopilot-log/v1" and (.event|startswith("loop-worker.")))'
```

If EvoPilot runs in Docker Compose, replace `journalctl` with:

```bash
docker compose -f docker-compose.prod.yml logs --no-color evopilot-server
docker compose -f docker-compose.prod.yml logs --no-color evopilot-loop-worker
```

## Incident Pack

When a production agent cannot continue, collect:

```text
1. Full CLI JSON output from the failed wrapper or atomic command.
2. The HTTP `x-request-id` or `correlation.requestId`.
3. Logs with the same requestId, goalId, loopId, releaseRunId, or releaseDecisionId.
4. `evopilot goal snapshot <goal-id> --json`.
5. `evopilot goal graph <goal-id> --json`.
6. `evopilot goal evidence-matrix <goal-id> --json`.
7. `evopilot trace tree <loop-id> --json` when a loop exists.
8. `evopilot release decisions --project <project-id> --target <target-id> --json`.
9. `evopilot audit list --limit 50 --json`.
10. `/health`, `/ready`, and recent deployment/configuration changes.
```

Ask the diagnosing AI to prioritize `correlation.*`, `tenantId`, `workspaceId`, `routeGroup`, `outcome`, `errorCode`, `latencyBucket`, `diagnosis`, trace tree, release decisions, and audit. Do not infer the release verdict from scattered logs.

## Forbidden Behavior

AI agents must not:

- parse human text when `--json` is available.
- synthesize `GO`, `NO-GO`, `GA stable`, or `RC ready` from local tests alone.
- bypass human gates, source credential blockers, release policy, or deployment gates.
- store tokens, passwords, or credentials in committed files.
- assume `/opt/evopilot` or any ECS path exists on the agent machine.
- mutate the standalone Dashboard repository when the task is EvoPilot backend/CLI operation.
- read or write EvoPilot database files directly.

## References

- [CLI](../cli/README.md)
- [CLI Workflows](../cli/workflows.md)
- [CLI Commands](../cli/commands.md)
- [CLI Automation](../cli/automation.md)
- [API Reference](../api/README.md)
- [Deployment](../operations/deployment.md)
- [Troubleshooting](../operations/troubleshooting.md)
- [Dashboard Integration](dashboard-integration.md)
