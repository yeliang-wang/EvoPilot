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
| `goal run` stops at `human-approval` | Server governance requires manual approval | Review evidence and rerun with approved recovery path. |
| `loop run` stops at `policy-review` | Release/source policy blocked automation | Inspect source closure and release run policy blockers. |
| `--timeout` reached | Wrapper stop boundary was reached | Rerun with a longer timeout or continue with atomic commands. |

## Dashboard

| Symptom | Likely Cause | Action |
|---|---|---|
| Dashboard loads but API data is empty | API base URL or proxy is wrong | Check `public/config.js`, Vite proxy, or Nginx `/api` proxy. |
| Login succeeds locally but fails in production | Token/user config differs | Check production `EVOPILOT_USERS` and `EVOPILOT_TOKENS`. |
| Workflow graph shows pending release | No authoritative release decision exists | Read `/api/v1/release/decisions`. |
| Custom Dashboard disagrees with CLI | UI is deriving state client-side | Use `run-status`, `snapshot`, `graph`, and release decisions from the API. |

## Validation Commands

```bash
npm run check
node -e 'JSON.parse(require("fs").readFileSync("docs/openapi.json", "utf8")); console.log("openapi ok")'
npm run cli -- status --json
```
