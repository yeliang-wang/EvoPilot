# GitHub Demo Projects

This directory contains reusable Product Kit assets for onboarding real GitHub projects into EvoPilot. These are not runtime proof artifacts and should not contain one-off `loopId`, screenshot, token, or production log output.

## Evidence Boundary

- Product Kit: reusable demo source, project metadata, expected commands, and onboarding defaults.
- Evidence Output: per-run `runId`, `loopId`, screenshots, trace output, release decision JSON, and soak report.

## Demo Project: Node API

| Field | Value |
|---|---|
| Project ID | `evopilot-github-demo-node-api` |
| Name | `EvoPilot GitHub Demo Node API` |
| Provider | `github` |
| Git URL | `https://github.com/yeliang-wang/evopilot-demo-node-api.git` |
| Default branch | `main` |
| Token ref | `EVOPILOT_GITHUB_TOKEN` |
| CI provider | `github-actions` |
| CI workflow | `ci.yml` |
| Runtime | `node` |
| Unit command | `npm test` |
| Smoke command | `npm run smoke` |
| Functional command | `npm run test:e2e` |

The runnable sample lives in `node-api/`. It uses only Node.js built-ins, so a user can validate it without installing extra packages:

```bash
cd examples/github-demo-projects/node-api
npm test
npm run smoke
npm run test:e2e
```

Dashboard uses the same payload when the operator clicks `Field Evidence Kit -> 预填接入表单` in `项目接入`. The operator still submits the form through `/api/v1/projects`; the kit only removes manual typing from the first run.

## Expected Source-to-GA Path

1. Register the GitHub project through Dashboard `项目接入`.
2. Configure source writeback credentials with a server-side token ref.
3. Import sample evidence through Dashboard `发现与目标`.
4. Run Discovery and confirm a Target Backlog item.
5. Create a source-to-production loop from Dashboard `Loop 执行`.
6. Review release closure and release decision from Dashboard `评估与发布`.
7. Archive the run-specific output under `evidence/production-soak/` or a release evidence bundle.
