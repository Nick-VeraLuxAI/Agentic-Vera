/**
 * Executable structured plans for agent_run (separate from free-form chat "plans").
 */

function normalizeStep(raw, idx) {
  if (!raw || typeof raw !== "object") return null;
  const objective = String(raw.objective || raw.goal || raw.description || "").trim();
  if (!objective) return null;
  return {
    id: String(raw.id || `step_${idx + 1}`),
    objective,
    role: raw.role ? String(raw.role).trim() : "",
    checks: normalizeChecks(raw.checks || raw.verify),
    maxRetries: Math.min(5, Math.max(0, Number(raw.maxRetries ?? 1))),
  };
}

function normalizeChecks(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  if (Array.isArray(raw.contains)) {
    out.contains = raw.contains.map((s) => String(s));
  } else if (raw.contains != null) {
    out.contains = [String(raw.contains)];
  }
  if (raw.regex != null) {
    try {
      out.regex = new RegExp(String(raw.regex), raw.flags || "");
    } catch (_e) {
      out.regexInvalid = String(raw.regex);
    }
  }
  if (raw.jsonPath != null && raw.jsonEquals != null) {
    out.jsonPath = String(raw.jsonPath);
    out.jsonEquals = raw.jsonEquals;
  }
  return out;
}

/**
 * @param {unknown} raw - from task.payload.structuredPlan or task.payload.plan
 */
function parseStructuredPlan(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "structuredPlan must be an object with steps[]." };
  }
  const stepsIn = raw.steps;
  if (!Array.isArray(stepsIn) || stepsIn.length === 0) {
    return { ok: false, error: "structuredPlan.steps must be a non-empty array." };
  }
  const steps = [];
  for (let i = 0; i < stepsIn.length; i += 1) {
    const s = normalizeStep(stepsIn[i], i);
    if (!s) return { ok: false, error: `Invalid step at index ${i}.` };
    steps.push(s);
  }
  return {
    ok: true,
    plan: {
      version: Number(raw.version) || 1,
      goal: String(raw.goal || "").trim(),
      steps,
    },
  };
}

function shouldUseStructuredMode(payload) {
  if (payload?.executionMode === "structured") return true;
  const p = payload?.plan;
  if (p && typeof p === "object" && Array.isArray(p.steps) && p.steps.length > 0) {
    return payload?.executionMode !== "turns";
  }
  if (payload?.structuredPlan && typeof payload.structuredPlan === "object") return true;
  return false;
}

function extractStructuredPayload(payload) {
  if (payload.structuredPlan && typeof payload.structuredPlan === "object") {
    return parseStructuredPlan(payload.structuredPlan);
  }
  if (payload.plan && typeof payload.plan === "object" && Array.isArray(payload.plan.steps)) {
    return parseStructuredPlan(payload.plan);
  }
  return parseStructuredPlan(null);
}

module.exports = {
  parseStructuredPlan,
  shouldUseStructuredMode,
  extractStructuredPayload,
};
