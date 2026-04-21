/**
 * Layered checks: cheap programmatic first, LLM verifier last (see outcomeVerifier).
 */

function checkContainsAll(text, fragments) {
  const t = String(text || "");
  for (const f of fragments) {
    if (!t.includes(String(f))) return { ok: false, reason: `Missing expected fragment: ${String(f).slice(0, 80)}` };
  }
  return { ok: true };
}

function checkRegex(text, regex) {
  if (!regex || regex instanceof RegExp === false) return { ok: true };
  return regex.test(String(text || ""))
    ? { ok: true }
    : { ok: false, reason: "Reply did not match step regex." };
}

/**
 * @param {{ checks?: object }} step - from structuredPlan
 * @param {string} reply
 */
function verifyStepProgrammatic(step, reply) {
  const checks = step.checks || {};
  if (checks.regexInvalid) {
    return { ok: false, layer: "programmatic", reason: `Invalid regex in plan: ${checks.regexInvalid}` };
  }
  if (Array.isArray(checks.contains) && checks.contains.length) {
    const c = checkContainsAll(reply, checks.contains);
    if (!c.ok) return { ok: false, layer: "programmatic", reason: c.reason };
  }
  if (checks.regex) {
    const r = checkRegex(reply, checks.regex);
    if (!r.ok) return { ok: false, layer: "programmatic", reason: r.reason };
  }
  return { ok: true, layer: "programmatic" };
}

/**
 * Global success criteria: all strings must appear in final reply (or trace).
 */
function verifySuccessCriteriaStrings(criteria, text) {
  if (!Array.isArray(criteria) || !criteria.length) return { ok: true };
  return checkContainsAll(text, criteria.map(String));
}

module.exports = {
  verifyStepProgrammatic,
  verifySuccessCriteriaStrings,
  checkContainsAll,
};
