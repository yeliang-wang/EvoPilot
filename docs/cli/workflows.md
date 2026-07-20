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

Start with a non-mutating checklist. Agents should parse `status`, `nextAction`, `missingInputs`, `blockers`, and `commands` before attempting registration:

```bash
evopilot project onboard plan github \
  --repo <owner>/<repo> \
  --id my-agent \
  --branch main \
  --token-ref GITHUB_TOKEN_MY_AGENT \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --ci-required-check test \
  --cd-workflow deploy-prod.yml \
  --deploy-environment production \
  --health-url https://my-agent.example.com/health \
  --template ga \
  --objective "Promote my-agent to GA stable with source closure, native CI/CD, deployment evidence, release decision, and blocker review" \
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

## 3. Register A GitLab Project

Store or rotate the token first:

```bash
evopilot project onboard plan gitlab \
  --base-url https://gitlab.example.com \
  --project-id group/my-agent \
  --id my-agent \
  --branch main \
  --token-ref GITLAB_TOKEN_MY_AGENT \
  --ci-required-stage test \
  --ci-required-job build \
  --cd-required-stage deploy \
  --deploy-environment production \
  --ready-url https://my-agent.example.com/ready \
  --template rc \
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

## 5. One Command To A Release Target

Use `target run` when the project does not already have a project-scoped release target. EvoPilot resolves or creates the target, creates or resumes a GlobalGoal, generates and approves the server plan, then advances GoalTargets one at a time.

```bash
evopilot target run \
  --project my-agent \
  --template ga \
  --objective "Promote my-agent to GA stable with source closure, native CI/CD, deployment evidence, release decision, and blocker review" \
  --until terminal \
  --max-steps 20 \
  --require-source-ready \
  --require-devops-ready \
  --json
```

Common templates:

```text
experimental
alpha
beta
rc
ga
```

## 6. One Command From New Project To Target

Use `project onboard` when the project is not registered yet. This wrapper registers the project, verifies source credentials, configures repository-native DevOps when CI/CD flags are present, verifies DevOps readiness, then optionally runs the target template.

GitHub:

```bash
evopilot project onboard github \
  --repo <owner>/<repo> \
  --id my-agent \
  --branch main \
  --token-ref GITHUB_TOKEN_MY_AGENT \
  --ci-workflow ci.yml \
  --ci-required-check build \
  --ci-required-check test \
  --cd-workflow deploy-prod.yml \
  --deploy-environment production \
  --health-url https://my-agent.example.com/health \
  --template ga \
  --objective "Promote my-agent to GA stable with source closure, native CI/CD, deployment evidence, release decision, and blocker review" \
  --until terminal \
  --max-steps 20 \
  --require-source-ready \
  --require-devops-ready \
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
  --ci-required-stage test \
  --ci-required-job build \
  --cd-required-stage deploy \
  --deploy-environment production \
  --ready-url https://my-agent.example.com/ready \
  --template rc \
  --objective "Promote my-agent to RC with source closure, GitLab CI evidence, deployment evidence, and blocker review" \
  --until terminal \
  --max-steps 20 \
  --require-source-ready \
  --require-devops-ready \
  --json
```

Without `--template`, `project onboard` stops after registration and preflight, returning `evopilot-cli-project-onboard/v1`.

## 7. Run Or Resume A GlobalGoal

Use `goal run` when the release target already exists or a previous GlobalGoal should continue.

```bash
evopilot goal run \
  --project my-agent \
  --target my-agent-ga \
  --objective "Promote my-agent to GA stable" \
  --until terminal \
  --max-steps 20 \
  --json
```

For step-by-step control:

```bash
evopilot goal create --project my-agent --target my-agent-ga --objective "Promote my-agent to GA stable" --json
evopilot goal plan <goal-id> --json
evopilot goal approve-plan <goal-id> --json
evopilot goal advance <goal-id> --json
evopilot goal snapshot <goal-id> --json
evopilot goal graph <goal-id> --json
evopilot goal evidence-matrix <goal-id> --json
```

## 8. Run One LoopRun

Use `loop run` for a narrower loop target.

```bash
evopilot loop run \
  --project my-agent \
  --target my-agent-rc \
  --objective "Fix RC release blockers and collect validation evidence" \
  --until blocked-or-complete \
  --max-iterations 10 \
  --json
```

## 9. Source Closure

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

## 10. Release Decision

Read release decisions from EvoPilot. Do not infer GA from local tests or CI alone.

```bash
evopilot release current --json
evopilot release decisions --project my-agent --target my-agent-ga --json
evopilot target decision my-agent-ga --project my-agent --json
```

## 11. Repair

Inspect release-run repair candidates:

```bash
evopilot release-run repair-candidates --json
evopilot release-run repair <run-id> --execute --json
evopilot release-run repair-all --execute --json
```

If a wrapper command returns `repair`, `repair-project`, `repair-deploy-target`, or `policy-review`, stop the automation and inspect the referenced IDs before retrying.
