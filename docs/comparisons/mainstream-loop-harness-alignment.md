# Mainstream Loop Harness Alignment

EvoPilot is not a generic agent framework. It is a Source-to-GA loop control plane that can govern agent frameworks, CI/CD systems, and durable workflow runtimes through explicit evidence and release decisions.

## Product Boundary

This comparison is a Product Kit asset: it defines the capability map EvoPilot must keep proving. It is not Evidence Output. Evidence Output comes from concrete runs: loop IDs, screenshots, traces, release decision JSON, and production-soak reports.

| Capability | EvoPilot Product Evidence | External Baseline |
|---|---|---|
| Durable execution | Loop Runtime, worker lease, watchdog, stop/retry policy | Temporal, DBOS |
| Checkpoint / persistence | loop checkpoints, replay diff, context time travel | LangGraph persistence, durable workflow snapshots |
| Human-in-loop | approval gate, review decision, safe merge boundary | LangGraph interrupts, CrewAI human steps |
| Sandbox | Docker/K8s boundary proof, credential scope, allowed/denied paths | E2B, containerized coding agents |
| Multi-executor coordination | typed executor graph, conditional routing, fan-out/fan-in | LangGraph, AutoGen, CrewAI |
| Streaming trace | trace tree, events stream, executor-step evidence | OpenTelemetry, agent tracing tools |
| Guardrails | adversarial evaluation, cost/token/duration/change guards | OpenAI Agents guardrails, CI policy checks |
| Source-to-production closure | source closure gates, deploy finalizer, release artifacts | GitHub Actions release workflows |
| Release decision | product-native `GO` / `CONDITIONAL-GO` / `NO-GO` | release governance tools and manual approval boards |

## Evidence Rule

For GA claims, each row needs a concrete evidence link: API output, screenshot, case-study step, release decision criterion, or production-soak report. A healthy process, a single CI pass, or a dashboard-only screenshot is not sufficient.
