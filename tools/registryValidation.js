function validateToolRegistry() {
  const { REGISTERED_NAMES } = require("./manifest");
  const { HANDLER_KEYS } = require("./runner");
  const errors = [];

  for (const name of REGISTERED_NAMES) {
    if (!HANDLER_KEYS.has(name)) {
      errors.push(`manifest lists '${name}' but runner has no handler`);
    }
  }
  for (const name of HANDLER_KEYS) {
    if (!REGISTERED_NAMES.has(name)) {
      errors.push(`runner implements '${name}' but it is missing from tools/manifest.js`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateToolRegistryOrThrow() {
  const r = validateToolRegistry();
  if (!r.ok) {
    const err = new Error(`Tool registry misaligned: ${r.errors.join("; ")}`);
    err.details = r.errors;
    throw err;
  }
}

/**
 * Fail fast on boot when manifest and runner disagree.
 */
function validateToolRegistryOrExit() {
  try {
    validateToolRegistryOrThrow();
  } catch (err) {
    console.error("❌", err.message);
    process.exit(1);
  }
}

module.exports = {
  validateToolRegistry,
  validateToolRegistryOrThrow,
  validateToolRegistryOrExit,
};
