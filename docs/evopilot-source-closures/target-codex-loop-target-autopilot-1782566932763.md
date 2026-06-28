# EvoPilot Autopilot Source Closure

Loop: target-codex-loop-target-autopilot-1782566932763
Target: codex-loop-target-autopilot
Target title: Codex Loop Target Autopilot
Objective: Let EvoPilot keep a prioritized target backlog, create the next Codex-backed target loop, and advance it through start, resume, human stop, and source closure states.
Provider: github
Source branch: main
Target version: target-codex-loop-target-autopilot-2026-06-27

## Acceptance Criteria
- Dashboard and API expose target backlog with status and next action.
- Advance API creates or advances the next target loop idempotently.
- Loop evidence records Codex executor intent, independent validation, source closure, and stop condition.

## Autopilot Evidence
- production-self-evolution-autopilot=true
- sourceClosure.requiredGates=code-change,push,deploy,health-ready
- sandbox=docker/restricted/loop
- coordination=parallel/5 executors
