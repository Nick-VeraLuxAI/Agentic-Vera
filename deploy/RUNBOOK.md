# Operations runbook

## Prerequisites

- Node.js 18+ (global `fetch` for connector tools).
- A local GGUF at `VERA_MODEL_PATH` or paths declared in `VERA_MODEL_ROUTES`.
- SQLite database path `VERA_MEMORY_DB_PATH` (defaults to `memory/vera_memory.db`).

## First-time setup

1. Copy `.env.example` to `.env` and set secrets (`VERA_BACKUP_MANIFEST_HMAC_KEY`, API keys if used).
2. Run `npm ci`.
3. Start the API: `./scripts/prod-up.sh` or `npm start`.

## Health checks

- `GET /health` — process uptime and build fingerprints.
- `GET /ready` — model circuit + memory DB readiness.
- `GET /metrics` — JSON counters, router last decision, task queue snapshot, tool/task ops metrics.
- `GET /metrics/prometheus` — Prometheus text exposition for the same counters.

## Audit trail

- `GET /api/admin/audit` — recent append-only audit events (requires admin API scope).
- `GET /api/admin/audit/verify` — recomputes the SHA-256 row chain; `ok: true` when no tampering detected.

## Memory quality

- `GET /api/memory/review-queue` — beliefs flagged for human review when heuristics detect opposing sentiment on overlapping topics (requires memory API scope).

## Background worker

- Run `npm run worker:start` in a separate process so `agent_run` and other queued tasks complete.

## Connectors (optional)

- **GitHub:** `VERA_GITHUB_TOKEN` + optional `VERA_GITHUB_API_ALLOWLIST` (comma-separated `/repos/...` path prefixes). Tool: `github_api`.
- **Slack:** `VERA_SLACK_INCOMING_WEBHOOK_URL`. Tool: `slack_post`.

## Evaluations

- `npm run evals:run` — loads `evals/golden.json` and, if present, `evals/benchmark-suite.json`. Override with `VERA_EVALS_FILES=path1,path2`.

## Incident response (short)

1. If `/ready` is degraded, check model logs and `VERA_MAX_PENDING_REQUESTS` / circuit settings.
2. If audit verify fails, treat the host as compromised until the DB and access keys are reviewed.
3. For stuck tasks, inspect `task_queue` in `/metrics` and `orchestration/tasks.json` backing store.
