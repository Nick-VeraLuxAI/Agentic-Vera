const test = require("node:test");
const assert = require("node:assert/strict");
const { validateToolRegistry } = require("../tools/registryValidation.js");

test("manifest and runner handlers stay aligned", () => {
  const r = validateToolRegistry();
  assert.equal(r.ok, true, r.errors?.join("; ") || "registry invalid");
});
