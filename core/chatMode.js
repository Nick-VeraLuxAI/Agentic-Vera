const fs = require("fs");
const path = require("path");

const VALID = new Set(["ask", "plan", "debug", "agent"]);

const MODE_DIR = path.join(__dirname, "../prompts/modes");

function normalizeInteractionMode(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (VALID.has(s)) return s;
  return "agent";
}

function loadModeBlock(mode) {
  const m = normalizeInteractionMode(mode);
  try {
    const file = path.join(MODE_DIR, `${m}.md`);
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, "utf8").trim();
    }
  } catch (_e) {
    /* ignore */
  }
  return "";
}

/** Tool-loop iterations cap by mode (ask = minimal autonomy). */
function toolIterationsForMode(mode) {
  const m = normalizeInteractionMode(mode);
  const envKey = `VERA_MODE_${m.toUpperCase()}_TOOL_ITERATIONS`;
  const fromEnv = Number(process.env[envKey]);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;
  const defaults = { ask: 1, plan: 2, debug: 6, agent: Number(process.env.VERA_TOOL_MAX_ITERATIONS || 4) };
  return defaults[m] ?? 4;
}

module.exports = {
  normalizeInteractionMode,
  loadModeBlock,
  toolIterationsForMode,
  VALID,
};
