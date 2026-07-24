# EvoPilot CLI Workflows

> Scenario-first CLI usage for project onboarding, Goal/Loop execution, source closure, native DevOps, and release decisions.

Use `--json` for AI agents and CI. Human-readable output is for operators.

## 1. Inspect The Server

```bash
evopilot status --json
evopilot project list --json
evopilot release current --json
evopilot worker queue --json
```

Do not continue to source writeback, deploy, merge, or release actions unless `status --json` confirms an authenticated session.

## 2. Register A GitHub Project

Use a server-side `tokenRef` for real source writeback. The token value must be available to the EvoPilot server process environment or the same tenant/workspace EvoPilot secret vault.

When CI/CD is part of onboarding, declare who owns the DevOps boundary:

```text
--execution-mode owned-repository      same repository owns source and CI/CD
--execution-mode read-only-public      public inspection only; no PR/merge/CI/CD release claim
--execution-mode fork-validated-pr     write and run CI/CD in a fork, then prepare upstream PR evidence
--execution-mode upstream-authorized   maintainer credentials write and run CI/CD in the upstream
```

`--devops-owner` must match the GitHub owner or GitLab namespace that runs GitHub Actions or GitLab CI.

For third-party open-source repositories, this means the operator must bring a GitHub/GitLab execution principal. Use `fork-validated-pr` when the writable repository is an operator-owned fork, or `upstream-authorized` only when a maintainer principal can write to the upstream. If the user has no GitHub/GitLab account or group, register the repository as `read-only-public` and stop before PR, CI/CD, merge, deploy, or release-readiness claims. EvoPilot does not supply a shared official account or generic runner for other people's upstream projects.

Start with a non-mutating checklist. Agents should parse `status`, `nextAction`, `missingInputs`, `blockers`, and `commands` before attempting registration:

```bash
evopilot project onboard plan github \
  --repo <owner>/<repo> \
  --id my-agent \
  --branch main \
  --token-ref GITHUB_TOKEN_MY_AGENT \
  --execution-mode owned-repository \
  --devops-owner <owner> \
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

Store or rotate the token in EvoPilot's server-side secret vault when the operator wants to avoid editing server environment variables:

```bash
evopilot secret set \
  --id GITHUB_TOKEN_MY_AGENT \
  --kind source-token \
  --from-env GITHUB_TOKEN_MY_AGENT \
  --json
```

```bash
evopilot project register \
  --id my-agent \
  --name "My Agent" \
  --provider github \
  --owner <owner> \
  --repo-name <repo> \
  --branch main \
  --token-ref GITHUB_TOKEN_MY_AGENT \
  --json
```

Then verify source credentials:

```bash
evopilot project preflight my-agent --json
evopilot project onboard verify my-agent --template ga --json
```

`READY` means source writeback can proceed. `READ_ONLY` or `BLOCKED` means the agent must stop and repair credentials before claiming PR, merge, or source-closure readiness.

When the checklist or preflight returns `nextAction=connect-github-account` or `nextAction=connect-gitlab-account`, the blocker is not a retry condition. The operator must connect or create the matching GitHub/GitLab account, organization, group, service account, deploy token, or GitHub App principal, then store the server-side tokenRef before rerunning onboarding.

## 3. Register A GitLab Project

Store or rotate the token first:

```bash
evopilot project onboard plan gitlab \
  --base-url https://gitlab.example.com \
  --project-id group/my-agent \
  --id my-agent \
  --branch main \
  --token-ref GITLAB_TOKEN_MY_AGENT \
  --execution-mode owned-repository \
  --devops-owner group \
  --ci-required-stage test \
  --ci-required-job build \
  --cd-required-stage deploy \
  --deploy-environment production \
  --ready-url https://my-agent.example.com/ready \
  --template ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --json
```

```bash
evopilot secret set \
  --id GITLAB_TOKEN_MY_AGENT \
  --kind source-token \
  --from-env GITLAB_TOKEN_MY_AGENT \
  --json
```

```bash
evopilot project register \
  --id my-agent \
  --name "My Agent" \
  --provider gitlab \
  --base-url https://gitlab.example.com \
  --project-id group/my-agent \
  --branch main \
  --token-ref GITLAB_TOKEN_MY_AGENT \
  --json
```

Then verify source credentials:

```bash
evopilot project preflight my-agent --json
```

## 4. Configure Project DevOps

EvoPilot uses repository-native DevOps. GitHub projects use GitHub Actions. GitLab projects use GitLab CI.

GitHub Actions:

```bash
evopilot project devops set my-agent \
  --provider github-actions \
  --execution-mode owned-repository \
  --devops-owner <owner> \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --ci-required-check test \
  --cd-workflow deploy-prod.yml \
  --deploy-environment production \
  --health-url https://my-agent.example.com/health \
  --json
```

GitLab CI:

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

Verify:

```bash
evopilot project devops preflight my-agent --json
```

Use `--require-devops-ready` on wrapper commands when the run must fail fast before Goal/Loop execution.

The preflight JSON includes:

```text
executionMode
repositoryOwner
devopsOwner
workflowRepository
credentialRef
credentialPrincipal
claimBoundary
```

For `fork-validated-pr`, `claimBoundary=fork-ci-pr`. This means the workflow can prove fork CI and upstream PR readiness, but not upstream release completion.

## 5. Configure A Project LLM

Use this when a project should run its loop target with a specific public model, private model, or enterprise OpenAI-compatible endpoint instead of the server global default LLM.

Store the API key once in the EvoPilot server-side secret vault:

```bash
export LLM_API_KEY_MY_AGENT="<real-llm-api-key>"

evopilot secret set \
  --id LLM_API_KEY_MY_AGENT \
  --kind llm-key \
  --from-env LLM_API_KEY_MY_AGENT \
  --json
```

Create and verify the LLM profile:

```bash
evopilot llm profile set my-agent-llm \
  --provider openai-compatible \
  --base-url https://llm.example.com/v1 \
  --model qwen2.5-coder-32b \
  --api-key-ref LLM_API_KEY_MY_AGENT \
  --json

evopilot llm profile preflight my-agent-llm --json
```

Bind it to the project:

```bash
evopilot project llm set my-agent \
  --profile my-agent-llm \
  --require-llm-ready \
  --json
```

`project llm preflight` must return `READY` before an agent claims that a custom LLM is usable:

```bash
evopilot project llm preflight my-agent --json
```

Resolution order for wrappers is:

```text
run override --llm-profile -> project default LLM -> server global default LLM
```

## 6. One Command To A Release Target

Use `target run` when the project does not already have a project-scoped release target. EvoPilot resolves or creates the target, creates or resumes a GlobalGoal, generates the server plan, then stops for plan approval unless `--auto-approve-plan` is explicitly supplied.

The CLI does not invent the phase list. `--objective` is the user's business intent, such as enabling a capability or improving a Dashboard lifecycle workflow. EvoPilot treats GA as the terminal maturity and generates a fixed progressive ladder: Alpha -> Beta -> RC -> GA. `--template ga` is the normal compatibility flag for creating the project-scoped release target profile; older template values do not make EvoPilot skip phases or stop before GA.

```bash
evopilot target plan \
  --project my-agent \
  --template ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --client workbuddy \
  --json
```

Review and adjust the returned plan before execution:

```bash
evopilot target plan export <goal-id> --format json > /tmp/my-agent-phase-plan.json
evopilot target plan diff <goal-id> --file /tmp/my-agent-phase-plan.json --json
evopilot target plan apply <goal-id> --file /tmp/my-agent-phase-plan.json --json
evopilot target plan approve <goal-id> --json
evopilot goal phases <goal-id> --json
evopilot goal phase-package <goal-id> --phase alpha --json
```

Then resume execution:

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

Common templates:

```text
ga
```

The maturity standards behind the generated plan are visible through:

```bash
evopilot maturity standards list --json
evopilot maturity standards inspect alpha --json
evopilot maturity standards inspect beta --json
evopilot maturity standards inspect rc --json
evopilot maturity standards inspect ga --json
```

The wrapper result includes LLM and token visibility for summary, process, and executor steps:

```json
{
  "llmUsage": {
    "client": { "surface": "workbuddy", "command": "target run" },
    "summary": {
      "provider": "zhipu",
      "model": "glm-5.1",
      "totalTokens": 1500,
      "inputTokens": 1000,
      "outputTokens": 500,
      "creditsConsumed": 1500
    },
    "process": {
      "responses": [
        { "label": "goal-run-advance-1", "requestId": "..." }
      ]
    },
    "server": {
      "steps": [
        { "loopId": "...", "iteration": 1, "nodeId": "plan", "provider": "zhipu", "model": "glm-5.1", "totalTokens": 1500 }
      ]
    }
  }
}
```

Human-readable wrapper output includes an `LLM Usage` section. Production HTTP logs include the same caller and request-level token delta in `metadata.client` and `metadata.llmUsage`, so an operator can line up CLI `requestId` values with server logs.

## 7. One Command From New Project To Target

Use `project onboard` when the project is not registered yet. This wrapper registers the project, verifies source credentials, configures repository-native DevOps when CI/CD flags are present, verifies DevOps readiness, then optionally runs the target template.

GitHub:

```bash
evopilot project onboard github \
  --repo <owner>/<repo> \
  --id my-agent \
  --branch main \
  --token-ref GITHUB_TOKEN_MY_AGENT \
  --execution-mode owned-repository \
  --devops-owner <owner> \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --ci-required-check test \
  --cd-workflow deploy-prod.yml \
  --deploy-environment production \
  --health-url https://my-agent.example.com/health \
  --llm-profile my-agent-llm \
  --template ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --until terminal \
  --max-steps 20 \
  --require-source-ready \
  --require-devops-ready \
  --require-llm-ready \
  --client workbuddy \
  --json
```

GitLab:

```bash
evopilot project onboard gitlab \
  --base-url https://gitlab.example.com \
  --project-id group/my-agent \
  --id my-agent \
  --branch main \
  --token-ref GITLAB_TOKEN_MY_AGENT \
  --execution-mode owned-repository \
  --devops-owner group \
  --ci-required-stage test \
  --ci-required-job build \
  --cd-required-stage deploy \
  --deploy-environment production \
  --ready-url https://my-agent.example.com/ready \
  --llm-profile my-agent-llm \
  --template ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --until terminal \
  --max-steps 20 \
  --require-source-ready \
  --require-devops-ready \
  --require-llm-ready \
  --client workbuddy \
  --json
```

Without `--template`, `project onboard` stops after registration and preflight, returning `evopilot-cli-project-onboard/v1`.

## 8. Public Upstream With A Writable Fork

Use this mode when the target project is an open-source upstream or any repository that the operator does not directly control. EvoPilot writes code and runs CI/CD in the fork. The upstream still owns merge and release authority.

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
  --llm-profile my-agent-llm \
  --template ga \
  --objective "Add the requested upstream-compatible capability and produce fork CI plus PR readiness evidence" \
  --until terminal \
  --max-steps 20 \
  --require-source-ready \
  --require-devops-ready \
  --require-llm-ready \
  --client workbuddy \
  --json
```

Expected DevOps readiness fields:

```json
{
  "executionMode": "fork-validated-pr",
  "devopsOwner": "my-org",
  "workflowRepository": "my-org/skywalking-fork",
  "claimBoundary": "fork-ci-pr"
}
```

Do not describe this as an upstream release unless the upstream maintainer later authorizes and merges the PR.

## 9. Run Or Resume A GlobalGoal

Use `goal run` when the release target already exists or a previous GlobalGoal should continue.

```bash
evopilot goal run \
  --project my-agent \
  --target my-agent-ga \
  --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" \
  --llm-profile my-agent-llm \
  --require-llm-ready \
  --until terminal \
  --max-steps 20 \
  --client workbuddy \
  --json
```

For step-by-step control:

```bash
evopilot goal create --project my-agent --target my-agent-ga --objective "Enable tenant onboarding, lifecycle workflow visibility, and operator repair guidance for My Agent" --llm-profile my-agent-llm --json
evopilot goal plan <goal-id> --json
evopilot target plan export <goal-id> --format json > /tmp/my-agent-phase-plan.json
evopilot target plan diff <goal-id> --file /tmp/my-agent-phase-plan.json --json
evopilot target plan apply <goal-id> --file /tmp/my-agent-phase-plan.json --json
evopilot goal approve-plan <goal-id> --json
evopilot goal phases <goal-id> --json
evopilot goal phase-package <goal-id> --phase rc --json
evopilot goal advance <goal-id> --json
evopilot goal snapshot <goal-id> --json
evopilot goal graph <goal-id> --json
evopilot goal evidence-matrix <goal-id> --json
```

## 10. Run One LoopRun

Use `loop run` for a narrower loop target.

```bash
evopilot loop run \
  --project my-agent \
  --target my-agent-rc \
  --objective "Fix RC release blockers and collect validation evidence" \
  --llm-profile my-agent-llm \
  --require-llm-ready \
  --until blocked-or-complete \
  --max-iterations 10 \
  --client workbuddy \
  --json
```

## 11. Source Closure

Always preflight before source writeback:

```bash
evopilot source-closure preflight <loop-id> --json
```

Execute a controlled source closure with explicit file content:

```bash
evopilot source-closure execute <loop-id> \
  --branch evopilot/source-closure \
  --message "EvoPilot source closure" \
  --write-file docs/release-evidence.md:/tmp/release-evidence.md \
  --json
```

Release review actions:

```bash
evopilot source-closure approve-release <loop-id> --json
evopilot source-closure merge <loop-id> --json
evopilot source-closure auto-merge <loop-id> --json
```

Only run merge actions when server-side review and release policy are satisfied.

## 12. Release Decision

Read release decisions from EvoPilot. Do not infer GA from local tests or CI alone.

```bash
evopilot release current --json
evopilot release decisions --project my-agent --target my-agent-ga --json
evopilot target decision my-agent-ga --project my-agent --json
```

## 13. Repair

Inspect release-run repair candidates:

```bash
evopilot release-run repair-candidates --json
evopilot release-run repair <run-id> --execute --json
evopilot release-run repair-all --execute --json
```

If a wrapper command returns `repair`, `repair-project`, `repair-deploy-target`, or `policy-review`, stop the automation and inspect the referenced IDs before retrying.
