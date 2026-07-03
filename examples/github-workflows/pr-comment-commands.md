# PR Comment Commands

These commands are intended for a GitHub App, bot, or Actions workflow that translates PR comments into EvoPilot API calls.

| Command | Intent | EvoPilot API |
|---|---|---|
| `/evopilot discover` | Ingest current PR and CI evidence, then run Discovery. | `POST /api/v1/evidence/events`, `POST /api/v1/loop-target-runtime/discovery/run` |
| `/evopilot loop target` | Create or advance a target loop for the PR. | `POST /api/v1/loop-orchestration/advance` |
| `/evopilot repair ci` | Send CI failure evidence and route it into repair. | `POST /api/v1/evidence/events` |
| `/evopilot release decision` | Generate or refresh release evidence and decision. | `POST /api/v1/release/evidence`, `GET /api/v1/release/decisions` |

Keep comment handlers small: they should translate GitHub context into evidence, while EvoPilot remains the release-governance control plane.
