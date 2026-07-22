# Troubleshooting

> Common operational issues for EvoPilot API, CLI, and Dashboard integrations.

## API

| Symptom | Likely Cause | Action |
|---|---|---|
| `401` | Missing or invalid token | Check `Authorization: Bearer <token>` and configured users/tokens. |
| `403` | Role or tenant/workspace scope mismatch | Check role, tenant, workspace, and actor headers. |
| `409` | Business guardrail blocked the action | Read the response body, blockers, `nextAction`, and audit trail. |
| `releaseDecision` is missing | Release evidence has not been submitted | Use release evidence APIs or CLI release commands. |

## CLI

| Symptom | Meaning | Action |
|---|---|---|
| `target run` exits `2` | Goal did not reach terminal completion | Inspect JSON `result`, `steps`, `nextAction`, and `status.blockers`. |
| `project onboard` stops at `connect-github-account` or `connect-gitlab-account` | Writable GitHub/GitLab writeback or native DevOps has no resolvable operator-owned execution principal | Connect or create the account/org/group/service principal, fork or authorize the repository when needed, store the server-side tokenRef, then rerun `project onboard plan` and `project preflight`. |
| `project preflight` returns `READ_ONLY` | Public repository can be inspected but cannot be written | Continue only for `read-only-public` analysis; do not claim PR, CI/CD, merge, deploy, or release readiness. |
| CLI exits with `DevOps ownership is ambiguous` | A GitHub/GitLab DevOps command did not declare who owns CI/CD execution | Add `--execution-mode` and `--devops-owner`; for open-source upstream work also add `--upstream-repo` and `--working-repo`. |
| `project devops preflight` blocks on `devops-owner` | The declared DevOps owner does not match the workflow repository namespace | Inspect `executionMode`, `devopsOwner`, `workflowRepository`, and `claimBoundary`; repair the project DevOps config before running a target wrapper. |
| `status --json` has no `api` object | The CLI reached an older server without `/api/v1/version` | Verify the deployed EvoPilot version before running wrapper commands. |
| `goal run` stops at `human-approval` | Server governance requires manual approval | Review evidence and rerun with approved recovery path. |
| `loop run` stops at `policy-review` | Release/source policy blocked automation | Inspect source closure and release run policy blockers. |
| `--timeout` reached | Wrapper stop boundary was reached | Rerun with a longer timeout or continue with atomic commands. |

## Dashboard

Dashboard 页面级操作和数字人排障入口在 `yeliang-wang/evopilot-dashboard/docs/operations/troubleshooting.md`。本节只覆盖 EvoPilot API 与 Dashboard 集成边界。

| Symptom | Likely Cause | Action |
|---|---|---|
| Dashboard loads but API data is empty | API base URL or proxy is wrong | Check `public/config.js`, Vite proxy, or Nginx `/api` proxy. |
| Login succeeds locally but fails in production | Token/user config differs | Check production `EVOPILOT_USERS` and `EVOPILOT_TOKENS`. |
| Workflow graph shows pending release | No authoritative release decision exists | Read `/api/v1/release/decisions`. |
| Custom Dashboard disagrees with CLI | UI is deriving state client-side | Use `run-status`, `snapshot`, `graph`, and release decisions from the API. |

## Validation Commands

```bash
npm run check
node -e 'JSON.parse(require("fs").readFileSync("docs/api/openapi.json", "utf8")); console.log("openapi ok")'
npm run cli -- status --json
```
