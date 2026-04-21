const { AsyncLocalStorage } = require("async_hooks");

const traceStore = new AsyncLocalStorage();

/**
 * Opt-in JSON lines to stdout for log aggregation (set VERA_STRUCTURED_LOGS=true).
 * Use runWithTrace / getTraceId for correlation (x-trace-id or x-request-id).
 */
function getTraceContext() {
  return traceStore.getStore() || {};
}

function getTraceId() {
  const ctx = getTraceContext();
  return ctx.traceId || ctx.requestId || null;
}

function runWithTrace(ctx, fn) {
  const base =
    typeof ctx === "string"
      ? { traceId: ctx || `tr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` }
      : { ...ctx };
  if (!base.traceId) {
    base.traceId = base.requestId || `tr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  return traceStore.run(base, fn);
}

function slog(level, event, data = {}) {
  if (String(process.env.VERA_STRUCTURED_LOGS || "").toLowerCase() !== "true") {
    return;
  }
  const tc = getTraceContext();
  const line = JSON.stringify({
    level,
    event,
    ts: new Date().toISOString(),
    traceId: tc.traceId || tc.requestId,
    requestId: tc.requestId,
    ...data,
  });
  console.log(line);
}

module.exports = { slog, getTraceContext, getTraceId, runWithTrace };
