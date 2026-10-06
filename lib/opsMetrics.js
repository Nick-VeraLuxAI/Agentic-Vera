/**
 * Lightweight process-wide counters for /metrics and Prometheus (no external deps).
 */

const metrics = {
  tool_invocations_total: 0,
  tool_failures_total: 0,
  tasks_completed_total: 0,
  tasks_failed_total: 0,
  tasks_dead_letter_total: 0,
};

function bumpTool(ok) {
  metrics.tool_invocations_total += 1;
  if (!ok) metrics.tool_failures_total += 1;
}

function bumpTaskOutcome(status) {
  const s = String(status || "");
  if (s === "completed") metrics.tasks_completed_total += 1;
  else if (s === "dead_letter") {
    metrics.tasks_dead_letter_total += 1;
    metrics.tasks_failed_total += 1;
  }
}

function getSnapshot() {
  return { ...metrics };
}

module.exports = {
  bumpTool,
  bumpTaskOutcome,
  getSnapshot,
};
