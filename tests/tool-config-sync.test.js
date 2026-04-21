const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { buildToolConfigJson } = require("../tools/manifest.js");

test("tool_config.json matches manifest (run npm run tools:sync-config if this fails)", () => {
  const configPath = path.join(__dirname, "..", "tools", "tool_config.json");
  const actual = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const expected = buildToolConfigJson();
  assert.deepEqual(
    actual,
    expected,
    "tools/tool_config.json drifted from tools/manifest.js — run npm run tools:sync-config"
  );
});
