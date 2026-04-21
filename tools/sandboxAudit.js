const fs = require("fs");
const path = require("path");

const AUDIT_ENABLED = String(process.env.VERA_SANDBOX_AUDIT || "true").toLowerCase() !== "false";
const AUDIT_FILE =
  process.env.VERA_SANDBOX_AUDIT_FILE || path.join(__dirname, "..", "memory", "sandbox_audit.jsonl");

function ensureDir() {
  const dir = path.dirname(AUDIT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Append one JSON line per sandbox invocation (no raw user code).
 */
function logSandboxExecution(entry = {}) {
  if (!AUDIT_ENABLED) return;
  try {
    ensureDir();
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    });
    fs.appendFileSync(AUDIT_FILE, `${line}\n`, "utf8");
  } catch (err) {
    console.error("⚠️ sandbox audit write failed:", err.message);
  }
}

module.exports = { logSandboxExecution };
