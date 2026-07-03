# Executor Adapter Examples

EvoPilot governs external agent and workflow runtimes through `ExecutorAdapter`. This directory is for reusable adapter examples, not for one-off run logs.

## Reusable Contract

`contract.json` defines the minimum product boundary for an executor adapter:

- declared runtime and adapter id
- server-side or runtime-side credential boundary
- input and output schemas
- failure signature mapping to EvoPilot evidence event types
- trace fields and artifact references sent through `/api/v1/evidence/events`

Adapter examples in this directory are copyable starting points. They are Product Kit assets, not proof that a specific production run succeeded.

## Concrete Examples

| Adapter | Purpose | Status |
|---|---|---|
| `github-actions-adapter.example.json` | Execute validation, repair, and release-blocker workflows through GitHub Actions. | Product example |
| `codex-cli-adapter.example.json` | Run bounded code-change tasks and return patch/validation evidence. | Product example |
| `openai-agents` | Bridge OpenAI Agents SDK runs into EvoPilot executor graph nodes. | Planned |
| `langgraph` | Treat LangGraph apps as a concrete graph executor behind EvoPilot governance. | Planned |
| `crew-ai` | Treat CrewAI task crews as executor nodes with structured evidence output. | Planned |

## How To Use In A Source-to-GA Loop

1. Pick an adapter example that matches the runtime behind the target loop.
2. Replace token refs with server-managed secret names.
3. Keep raw logs, private prompts, and credentials out of evidence events.
4. Send structured runtime status and artifact links to `/api/v1/evidence/events`.
5. Let EvoPilot Discovery and Loop Target decide whether the signal becomes a target.
6. Close the loop through release decision, not through the executor runtime alone.

## Evidence Boundary

- Product Kit: adapter contracts, example schemas, failure signature maps, and reusable workflow glue.
- Evidence Output: run-specific `runId`, `loopId`, executor trace, validation logs, screenshots, and release decision JSON.

The Product Kit can ship in this repository. Evidence Output should be archived per project or release bundle, such as `evidence/production-soak/`.
