# Agentic Vera

Local-first assistant server built around **tool loops**, **retrieval-augmented memory**, **checkpointed background tasks**, optional **Docker code sandboxing**, and **route-aware** local model execution.

This repository was split from the Vera offline stack to keep the agentic surface area (brain, tools, orchestration, memory, API) in one place.

## What you get

- **Tool loop**: Model output can trigger registered tools; results are fed back for synthesis (`core/verabrain.js`).
- **Tools**: Search/summarize, nested inference, optional `code_sandbox` (`tools/runner.js`, `tools/tool_config.json`).
- **Memory**: Short-term history, long-term facts, growing retrieval index from chat and uploads (`memory/`).
- **Tasks**: Persisted queue + worker for inference/tool jobs (`orchestration/`, `npm run worker:start`).
- **Router**: Optional heuristics to route prompts to different GGUF paths (`core/modelRouter.js`).
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

Copy `.env.example` to `.env` and tune retrieval, tool iteration limits, router, worker, and optional sandbox variables.

## Origin

Derived from the **Vera Modular-Offline** project; this repo focuses on the agentic execution and operations layers rather than the full upstream binary and build tree.
