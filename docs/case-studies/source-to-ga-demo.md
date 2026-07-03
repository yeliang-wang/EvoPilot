# Case Study: GitHub Demo Project To GA Release

## Status

Template. Fill this file with a real run after executing the Field Evidence Kit against a GitHub demo project.

## Product Boundary

This case study proves EvoPilot's Source-to-GA control plane. The reusable Product Kit includes the demo project payload, sample evidence import, workflow templates, and adapter examples. The Evidence Output from a concrete run includes loop IDs, screenshots, trace transcripts, release decisions, and soak reports.

## Run Record

| Field | Value |
|---|---|
| Project ID | `evopilot-github-demo-node-api` |
| Git URL | `https://github.com/yeliang-wang/evopilot-demo-node-api.git` |
| Evidence run ID | `TBD` |
| Target ID | `TBD` |
| Loop ID | `TBD` |
| Source release run ID | `TBD` |
| Release decision ID | `TBD` |
| Final decision | `TBD: GO / CONDITIONAL-GO / NO-GO` |

## Required Evidence

- project registration validation
- source credential readiness or explicit read-only blocker
- sample or production evidence run
- Discovery candidate and Target Backlog item
- source-to-production loop with executor graph
- worker, sandbox, trace, and replay evidence
- source closure gates: code-change, push, deploy, health-ready
- release decision from `/api/v1/release/decisions`
- audit trail and rollback notes

## Screenshots

Store screenshots from a concrete run in an evidence bundle or `evidence/production-soak/<date>/screenshots/`; do not commit secrets or token-bearing browser state.

