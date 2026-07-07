# Contributing to EvoPilot

EvoPilot is a GA Release V1.0 control plane for AI-agent product evolution. Contributions should preserve the product boundary: real evidence, explicit human approval, durable loop state, auditable release decisions, and production-ready dashboard flows.

## Start Here

1. Fork or branch from `main`.
2. Install dependencies:

```bash
npm install
```

3. Build the workspace:

```bash
npm run build
```

4. Run the full local gate before opening a pull request:

```bash
npm run check
```

## Contribution Areas

| Area | Good contribution shape |
|---|---|
| Dashboard | Improves a real operator, tenant admin, or tenant user workflow without adding demo-only UI. |
| Loop Runtime | Preserves durable state, idempotency, evidence, approval gates, and auditability. |
| Release governance | Strengthens target criteria, evidence bundles, release decisions, or risk handling. |
| Integrations | Keeps external systems behind explicit adapter contracts and credential boundaries. |
| Documentation | Matches the current product behavior, includes the fastest successful path, and links to validation commands. |

## Pull Request Expectations

- Explain the user or operator workflow affected by the change.
- Include tests for changed behavior.
- Include dashboard screenshots when the change affects user-facing UI.
- Update README, docs, or help manual content when behavior or workflows change.
- Keep generated evidence, local screenshots, and temporary reports out of the commit unless they are intentional release evidence.

## Validation

Use the smallest useful validation while developing, then run the full gate before review:

```bash
npm run test:unit
npm run test:functional
npm run check
```

For production-path changes, also run the relevant E2E or release evidence command described in the README and docs.

## Security Issues

Do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting for `yeliang-wang/EvoPilot` if available, or contact the maintainers through a private channel. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution is licensed under the Apache License, Version 2.0.
