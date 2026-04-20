const test = require("node:test");
const assert = require("node:assert/strict");

function clear(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

test("model router falls back to default when disabled", () => {
  const old = process.env.VERA_ROUTER_ENABLED;
  delete process.env.VERA_ROUTER_ENABLED;
  clear("../core/modelRouter.js");
  const { createModelRouter } = require("../core/modelRouter.js");
  const router = createModelRouter();
  const route = router.resolveRoute({ prompt: "please debug this code bug" });
  assert.equal(route.route, "default");
  assert.equal(route.reason, "router_disabled");
  if (old !== undefined) process.env.VERA_ROUTER_ENABLED = old;
});

test("model router chooses coder when enabled and configured", () => {
  const oldEnabled = process.env.VERA_ROUTER_ENABLED;
  const oldCoder = process.env.VERA_ROUTER_CODER_MODEL;
  process.env.VERA_ROUTER_ENABLED = "true";
  process.env.VERA_ROUTER_CODER_MODEL = "/models/coder.gguf";
  clear("../core/modelRouter.js");
  const { createModelRouter } = require("../core/modelRouter.js");
  const router = createModelRouter();
  const route = router.resolveRoute({ prompt: "debug this typescript stack trace" });
  assert.equal(route.route, "coder");
  assert.equal(route.reason, "heuristic_match");
  assert.equal(route.modelPath, "/models/coder.gguf");
  if (oldEnabled === undefined) delete process.env.VERA_ROUTER_ENABLED;
  else process.env.VERA_ROUTER_ENABLED = oldEnabled;
  if (oldCoder === undefined) delete process.env.VERA_ROUTER_CODER_MODEL;
  else process.env.VERA_ROUTER_CODER_MODEL = oldCoder;
});
