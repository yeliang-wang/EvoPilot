# Security Policy

EvoPilot governs AI-agent product evolution, tenant/workspace access, credentials, LLM usage, release evidence, and production deployment boundaries. Security reports should be handled privately.

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.x | Yes |
| Earlier versions | No |

## Reporting a Vulnerability

Do not disclose vulnerabilities in public GitHub issues or discussions.

Use GitHub private vulnerability reporting for `yeliang-wang/EvoPilot` if it is available. If private reporting is not available, contact the repository maintainers through an existing private channel and include:

- affected version or commit
- reproduction steps
- impact and affected tenant/workspace boundary, if known
- whether credentials, LLM calls, source writeback, CI/CD, or deployment paths are involved
- any logs or evidence with secrets removed

## Handling Expectations

Maintainers should acknowledge a report privately, validate impact, prepare a fix, and publish release notes after users have a reasonable upgrade path. Public disclosure should not include secrets, exploit-ready instructions, or tenant data.

## Security Baseline

Security-sensitive changes should preserve:

- authenticated dashboard access
- tenant and workspace RBAC boundaries
- credential storage through secret references or scoped configuration
- audit records for approval, source writeback, and release actions
- clear evidence when LLM calls, tokens, credits, CI/CD, or deployment actions are executed
