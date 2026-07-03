# EvoPilot Autopilot Source Closure

Loop: target-github-app-onboarding-1783082780789
Target: github-app-onboarding
Target title: GitHub App Onboarding
Objective: Replace ad hoc repository tokens with a GitHub App onboarding flow that supports installation, repository selection, least-privilege permissions, webhook verification, and installation-token lifecycle.
Provider: github
Source branch: main
Target version: saas-github-app-onboarding-2026-07-03

## Acceptance Criteria
- Users can connect a GitHub App installation and select repositories without pasting long-lived personal tokens into the dashboard.
- Webhook signature verification, installation-token refresh, and repository permission checks are captured as auditable evidence.
- Loop source closure can resolve writeback credentials from the installation while preserving least privilege and revocation.

## Autopilot Evidence
- production-self-evolution-autopilot=true
- sourceClosure.requiredGates=code-change,push,deploy,health-ready
- sandbox=docker/restricted/loop
- coordination=parallel/5 executors
