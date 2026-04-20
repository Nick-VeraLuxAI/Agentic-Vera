# Vera Advanced Roadmap (90 Days)

This roadmap executes the full advanced vision in phases with measurable gates.

## Phase 1 (Weeks 1-3): Foundations

- Add long-running task orchestration API with checkpointed state.
- Add evaluation framework (`evals/`) with golden scenarios and score outputs.
- Add route-level observability for specialist routing outcomes.
- Add fine-tune data quality gates (PII redaction, dedup, quality scoring).

Exit criteria:

- Task queue API available and test-covered.
- Evaluation runs in CI and produces report artifact.
- Fine-tune dataset generation reports filtered/deduped stats.

## Phase 2 (Weeks 4-6): Retrieval + Memory Intelligence

- Upgrade retrieval to embedding-backed index with lexical fallback.
- Add citation spans/provenance in responses from retrieval.
- Add contradiction detection and confidence-based fact lifecycle.
- Add session profile + episodic summaries + task-state memory tiers.

Exit criteria:

- Retrieval relevance benchmark improves over baseline.
- Memory contradiction test suite passes.
- Prompt context budget is controlled and deterministic.

## Phase 3 (Weeks 7-9): Multi-Model Orchestration

- Add confidence-scored router (beyond heuristics).
- Add fallback chain and optional voting for critical tasks.
- Add per-route quality metrics and adaptive route tuning.
- Add specialist policy templates (coding, legal, file analysis).

Exit criteria:

- Router quality report available (latency, success, fallback rate).
- Specialist route regressions tracked in eval dashboard.

## Phase 4 (Weeks 10-12): Production Hardening

- Add signed audit logs with tamper-evident chain.
- Add role-scoped authN/authZ for admin and memory APIs.
- Add autoscaling/admission-control policy hooks and SLO alerts.
- Add promotion gates for fine-tune model releases (holdout eval + safety checks).

Exit criteria:

- Security checklist passes.
- SLO dashboard and alerting active.
- Model promotion workflow documented and enforced.
