# GitHub Workflow Templates

These templates document how a GitHub repository can call EvoPilot without making GitHub Actions the product boundary. EvoPilot remains the Source-to-GA control plane; GitHub issues, PR comments, and CI failures are input signals.

## Intended Templates

| Template | Trigger | EvoPilot API |
|---|---|---|
| `evopilot-target.yml` | Issue labeled `evopilot-target` | `POST /api/v1/evidence/events` then Discovery |
| `ci-failure-repair.yml` | Failed CI workflow | `POST /api/v1/evidence/events` with `tool.failure` or `ci.failure` |
| `release-blocker.yml` | PR label `release-blocker` | `POST /api/v1/evidence/events` and release guardrail evaluation |
| PR comment commands | `/evopilot discover`, `/evopilot loop target`, `/evopilot release decision` | project, discovery, loop, and release APIs |

Copy the workflow files in this directory into a target repository's `.github/workflows/` directory. Copy `evopilot-target.issue-form.yml` into `.github/ISSUE_TEMPLATE/`.

## Contract

- Treat these workflow files, issue forms, and PR command templates as Product Kit assets.
- Store EvoPilot tokens in GitHub Actions secrets.
- Send only evidence metadata and links; do not send secrets or full private logs.
- Treat generated `runId`, `loopId`, screenshots, release decision JSON, and trace output as Evidence Output.
- Keep these workflow files reusable across demo projects.
