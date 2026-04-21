/**
 * Budgets and approval gates for agent runs (policy-as-code).
 */

const DEFAULT_SENSITIVE = new Set(["code_sandbox", "http_fetch"]);

function parseEnvNumber(key, fallback) {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

function buildPolicy(task = {}) {
  const p = task.payload?.policy && typeof task.payload.policy === "object" ? task.payload.policy : {};
  const envSensitive = String(process.env.VERA_AGENT_SENSITIVE_TOOLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const sensitive = new Set(envSensitive.length ? envSensitive : DEFAULT_SENSITIVE);

  const approvedSensitive = new Set(
    Array.isArray(task.payload?.approvedSensitiveTools) ? task.payload.approvedSensitiveTools.map(String) : []
  );

  const legacySandboxOk = task.payload?.allowSandbox === true;
  const legacyHttpOk = task.payload?.allowHttpFetch === true;

  return {
    maxToolInvocations: Math.max(1, Number(p.maxToolInvocations ?? parseEnvNumber("VERA_AGENT_MAX_TOOL_INVOCATIONS", 128))),
    maxSandboxRuns: Math.max(0, Number(p.maxSandboxRuns ?? parseEnvNumber("VERA_AGENT_MAX_SANDBOX_RUNS", 8))),
    maxHttpFetch: Math.max(0, Number(p.maxHttpFetch ?? parseEnvNumber("VERA_AGENT_MAX_HTTP_FETCH", 16))),
    sensitiveTools: sensitive,
    approvedSensitive,
    legacySandboxOk,
    legacyHttpOk,
    /** JSON-safe summary for traces */
    toJSON() {
      return {
        maxToolInvocations: this.maxToolInvocations,
        maxSandboxRuns: this.maxSandboxRuns,
        maxHttpFetch: this.maxHttpFetch,
        sensitiveTools: Array.from(sensitive),
        approvedSensitive: Array.from(approvedSensitive),
        legacySandboxOk,
        legacyHttpOk,
      };
    },
  };
}

function createBudgetTracker(policy) {
  let invocations = 0;
  let sandboxRuns = 0;
  let httpFetches = 0;

  function beforeTool(name) {
    const toolName = String(name || "").trim();
    invocations += 1;
    if (invocations > policy.maxToolInvocations) {
      return { ok: false, error: `Tool invocation budget exceeded (${policy.maxToolInvocations}).` };
    }
    if (toolName === "code_sandbox") {
      sandboxRuns += 1;
      if (sandboxRuns > policy.maxSandboxRuns) {
        return { ok: false, error: `code_sandbox budget exceeded (${policy.maxSandboxRuns}).` };
      }
    }
    if (toolName === "http_fetch") {
      httpFetches += 1;
      if (httpFetches > policy.maxHttpFetch) {
        return { ok: false, error: `http_fetch budget exceeded (${policy.maxHttpFetch}).` };
      }
    }
    if (policy.sensitiveTools.has(toolName)) {
      const legacyOk =
        (toolName === "code_sandbox" && policy.legacySandboxOk) || (toolName === "http_fetch" && policy.legacyHttpOk);
      if (!legacyOk && !policy.approvedSensitive.has(toolName)) {
        return {
          ok: false,
          error: `Tool '${toolName}' requires approval: allowSandbox/allowHttpFetch or payload.approvedSensitiveTools.`,
        };
      }
    }
    return { ok: true };
  }

  function snapshot() {
    return { invocations, sandboxRuns, httpFetches };
  }

  return { beforeTool, snapshot };
}

module.exports = {
  buildPolicy,
  createBudgetTracker,
};
