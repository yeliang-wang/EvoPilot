# Architecture

> EvoPilot is an API and CLI control plane for governed AI Agent product evolution.

## Product Split

```text
AI Agent / CI / Operator
        |
        v
EvoPilot CLI  --->  EvoPilot API Server  ---> Evidence / Audit / Release State
                         ^
                         |
                 EvoPilot Dashboard
```

EvoPilot owns the domain model and execution state. The Dashboard is a replaceable UI client that consumes the API.

## Bounded Contexts

| Context | Responsibility |
|---|---|
| Project | Registered products, source credentials, workspace ownership |
| Evidence | Runtime signals, trace/log/eval ingestion, evidence bundles |
| GlobalGoal | Goal decomposition into GoalTargets, progress, graph, timeline, final report |
| Loop Runtime | LoopRun execution, worker leases, sandbox proof, trace, events, replay |
| Source Closure | Writeback, review decision, merge/promotion gates |
| Release Governance | ReleaseTarget profiles and authoritative release decisions |
| CLI Adapter | Atomic commands and wrapper commands over the API |
| Dashboard Adapter | Visual workflow and operations UI over the API |

## Key Rule

The Dashboard can visualize and request actions, but only EvoPilot API state can decide what happened. Release conclusions come from release decisions, not UI inference.

Deep architecture notes remain in:

- [Continuous Evolution Control Plane](architecture/continuous-evolution-control-plane.md)
- [Loop Runtime](architecture/loop-runtime.md)
- [ProofOps Target Loop Mode](architecture/proofops-target-loop-mode.md)
