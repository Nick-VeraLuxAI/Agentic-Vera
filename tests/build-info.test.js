const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

test("buildInfo exposes prompt fingerprints and llama binary flag", () => {
  clearModule("../core/buildInfo.js");
  const { getPromptFingerprints, isLlamaBinaryPresent } = require("../core/buildInfo.js");
  const fp = getPromptFingerprints();
  assert.match(fp.identity_md_sha256, /^[a-f0-9]{64}$/);
  assert.match(fp.tools_manifest_js_sha256, /^[a-f0-9]{64}$/);
  assert.equal(typeof isLlamaBinaryPresent(), "boolean");
});

test("buildInfo reads memory schema version after migrations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vera-buildinfo-db-"));
  const previousDb = process.env.VERA_MEMORY_DB_PATH;
  process.env.VERA_MEMORY_DB_PATH = path.join(root, "vera_memory.db");
  try {
    clearModule("../memory/db.js");
    const { getDb, closeDbForTests } = require("../memory/db.js");
    getDb();
    clearModule("../core/buildInfo.js");
    const { getMemorySchemaVersion } = require("../core/buildInfo.js");
    const v = getMemorySchemaVersion();
    assert.ok(v != null && v >= 1);
    closeDbForTests();
  } finally {
    if (previousDb === undefined) delete process.env.VERA_MEMORY_DB_PATH;
    else process.env.VERA_MEMORY_DB_PATH = previousDb;
    clearModule("../memory/db.js");
  }
});
