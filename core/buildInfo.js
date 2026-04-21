const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

function sha256File(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch (_err) {
    return null;
  }
}

function getPromptFingerprints() {
  const root = path.join(__dirname, "..");
  return {
    identity_md_sha256: sha256File(path.join(root, "prompts", "identity.md")),
    tools_manifest_js_sha256: sha256File(path.join(root, "tools", "manifest.js")),
  };
}

function getLlamaCliPath() {
  return path.join(__dirname, "..", "build", "bin", "llama-cli");
}

function isLlamaBinaryPresent() {
  try {
    return fs.existsSync(getLlamaCliPath());
  } catch (_err) {
    return false;
  }
}

function getMemorySchemaVersion() {
  try {
    const { getDb } = require("../memory/db");
    const row = getDb().prepare("SELECT MAX(version) AS v FROM schema_migrations").get();
    return row && Number.isFinite(Number(row.v)) ? Number(row.v) : null;
  } catch (_err) {
    return null;
  }
}

module.exports = {
  getPromptFingerprints,
  getLlamaCliPath,
  isLlamaBinaryPresent,
  getMemorySchemaVersion,
};
