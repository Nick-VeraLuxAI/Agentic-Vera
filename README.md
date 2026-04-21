# Agentic Vera

Local-first assistant server built around **tool loops**, **retrieval-augmented memory** (SQLite as the system of record with legacy JSON import), **checkpointed background tasks** (including multi-step `agent_run` with **LLM outcome verification**), optional **Docker code sandboxing**, **multi-route GGUF routing** (keyword + `x-model-route` header), and **expanded tools** (workspace, arithmetic, gated HTTP fetch, etc.) with a default model from `VERA_MODEL_PATH`.

This repository was split from the Vera offline stack to keep the agentic surface area (brain, tools, orchestration, memory, API) in one place.

## What you get

- **Tool loop**: Model output can trigger registered tools; results are fed back for synthesis (`core/verabrain.js`).
- **Tools**: Search/summarize, nested inference, optional `code_sandbox` (`tools/runner.js`, `tools/tool_config.json`).
- **Memory**: Short-term history, long-term facts, growing retrieval index from chat and uploads (`memory/`).
- **Tasks**: Persisted queue + worker for inference/tool jobs (`orchestration/`, `npm run worker:start`).
- **Full agent loop**: `agent_run` supports **turn-based** (`[AGENT_DONE]`) or **structured plans** (`executionMode: "structured"` with `structuredPlan.steps[]`, programmatic checks, policy budgets, SQLite checkpoints, episodic `[EPISODE:]` lessons) — see `core/agentRunExecutor.js`.
- **Plan synthesis**: `synthesizePlan: true` on an `agent_run` task generates a structured plan via LLM before execution (`core/planSynthesis.js`).
- **Resume**: `resumeRunId` loads the checkpoint from a previous run (turn or structured) and continues.
- **Human write approvals**: `workspace_write` tool + `approval_requests` table; APIs under `/api/agent/approvals/*`. Chat may return **428** with `approvalId` when a write needs approval.
- **Webhooks & cron**: `POST /api/hooks/task` (header `x-vera-webhook-token`) enqueues any task; `VERA_SCHEDULER_ENABLED` + `/api/admin/schedules` for interval-based enqueue (`orchestration/scheduler.js`).
- **Cursor-like chat modes**: HTTP headers `x-interaction-mode: ask|plan|debug|agent` and optional `x-agent-role: orchestrator|planner|coder|reviewer|researcher` (also accepted in JSON body for `/api/message`).
- **Model routing**: Multi-route map via `VERA_MODEL_ROUTES` + keyword hints (`core/modelRouter.js`); override per request with header `x-model-route: <routeId>`. `VERA_MODEL_PATH` is the default GGUF.
- **Hardening**: Request limits, timeouts, circuit breaker around the llama subprocess.

## Prerequisites

1. **Node.js** (LTS recommended).
2. **llama.cpp** `llama-cli` binary at `build/bin/llama-cli` (same layout as upstream llama.cpp after build). The server spawns this process; it is not vendored here.
3. A **GGUF** model file under `models/` (see `.env.example` for `VERA_MODEL_PATH`).

## Quick start

```bash
cp .env.example .env
npm install
npm start
```

Then open the UI (served by the app) or call the HTTP API on port **3000** (localhost-only API defaults; see `server.js`).

## Scripts

| Command | Purpose |
|--------|---------|
| `npm start` | Run the server |
| `npm test` | Node test runner |
| `npm run evals:run` | Golden evals |
| `npm run worker:start` | Task worker |
| `npm run sandbox:prepare-images` | Build sandbox Docker images (if using `code_sandbox`) |

## Configuration

Copy `.env.example` to `.env` and tune retrieval, tool iteration limits, SQLite memory paths, worker, optional API key (`VERA_ADMIN_API_KEY` protects admin, memory, agent APIs, and `agent_run` task enqueue), and sandbox variables.

## CI

GitHub Actions runs `npm ci`, `npm run lint`, and `npm run test:ci` on pushes and pull requests to `main`.

## Origin

Derived from the **Vera Modular-Offline** project; this repo focuses on the agentic execution and operations layers rather than the full upstream binary and build tree.
