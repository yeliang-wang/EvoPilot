# Demo Source Closure Production Blocker

Generated at: 2026-07-03T07:54:51Z

## Result

The EvoPilot production dashboard and API have not reached the final 100% source-to-GA demo scenario for `yeliang-wang/evopilot-demo-node-api`.

The completed portions are real production evidence:

- Demo repo exists and is reachable at `https://github.com/yeliang-wang/evopilot-demo-node-api.git`.
- EvoPilot production registered `evopilot-github-demo-node-api`.
- Project validation is `VERIFIED`.
- Project source credentials are configured.
- Source credential preflight returned `READY`.
- Loop source-closure preflight returned `PASS`.

The blocking portion is GitHub writeback permission:

- EvoPilot production source closure attempted to create branch `evopilot/demo-source-closure-1783064900970`.
- GitHub returned `403 Forbidden`.
- A direct GitHub API permission probe with the same production token could read `main` but failed on `POST /repos/yeliang-wang/evopilot-demo-node-api/git/refs`.
- GitHub's response was `Resource not accessible by personal access token`.

## Evidence Files

- `01-project.json`: production project registration and validation.
- `02-source-credentials-preflight.json`: source credentials resolved and source branch readable.
- `05-source-closure-preflight.json`: non-mutating source-closure readiness passed.
- `06-source-closure-executed.json`: production source closure failed at the writeback gate.

## Diagnosis

The token belongs to the correct GitHub user and the user has push/admin permission on the repository, but the fine-grained PAT itself is not authorized for write operations on this repository. The current EvoPilot GitHub source-closure implementation uses GitHub API token writeback for branch creation, file upsert, pull request creation, and pull request merge. There is no SSH fallback for the `github` provider path.

## External Action Required

Update the fine-grained PAT named `EvoPilot source writeback` so it includes `yeliang-wang/evopilot-demo-node-api` with repository contents write access. GitHub requires email sudo verification before editing the token settings page, so this cannot be completed from the production API or local repo alone.

After the token permission is updated, rerun `.tmp/run-demo-source-closure-e2e.mjs` to produce the final evidence:

- branch written by EvoPilot production source closure,
- release evidence file committed to the demo repo,
- GitHub PR created,
- PR merged by EvoPilot source-closure review decision,
- release evidence created,
- release decision `GO`,
- screenshots captured from production.
