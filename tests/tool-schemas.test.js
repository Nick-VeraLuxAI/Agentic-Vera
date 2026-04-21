const test = require("node:test");
const assert = require("node:assert/strict");
const { validateToolArgs } = require("../tools/toolSchemas.js");
const { runTool } = require("../tools/runner.js");

test("validateToolArgs rejects empty search_tool", () => {
  const r = validateToolArgs("search_tool", {});
  assert.equal(r.ok, false);
});

test("validateToolArgs accepts search_tool with query", () => {
  const r = validateToolArgs("search_tool", { query: "cats" });
  assert.equal(r.ok, true);
});

test("runTool returns validation error for invalid summary_tool", async () => {
  const out = await runTool("summary_tool", {});
  assert.equal(out.ok, false);
  assert.match(out.error, /Invalid arguments/);
});
