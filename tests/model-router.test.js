const test = require("node:test");
const assert = require("node:assert/strict");

function clear(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

test("model router resolves to default GGUF when only one route", () => {
  const oldPath = process.env.VERA_MODEL_PATH;
  const oldRoutes = process.env.VERA_MODEL_ROUTES;
  delete process.env.VERA_MODEL_ROUTES;
  process.env.VERA_MODEL_PATH = "/models/only.gguf";
  clear("../core/modelRouter.js");
  const { createModelRouter } = require("../core/modelRouter.js");
  const router = createModelRouter();
  const route = router.resolveRoute({ prompt: "please debug this code bug" });
  assert.equal(route.route, "default");
  assert.match(route.reason, /default_route|single_model/);
  assert.equal(route.modelPath, "/models/only.gguf");
  if (oldPath === undefined) delete process.env.VERA_MODEL_PATH;
  else process.env.VERA_MODEL_PATH = oldPath;
  if (oldRoutes === undefined) delete process.env.VERA_MODEL_ROUTES;
  else process.env.VERA_MODEL_ROUTES = oldRoutes;
});

test("model router getStatus lists route map and mode", () => {
  const oldPath = process.env.VERA_MODEL_PATH;
  const oldRoutes = process.env.VERA_MODEL_ROUTES;
  delete process.env.VERA_MODEL_ROUTES;
  process.env.VERA_MODEL_PATH = "/x/model.gguf";
  clear("../core/modelRouter.js");
  const { createModelRouter } = require("../core/modelRouter.js");
  const router = createModelRouter();
  const status = router.getStatus();
  assert.equal(status.mode, "single");
  assert.equal(status.routes.default, "/x/model.gguf");
  if (oldPath === undefined) delete process.env.VERA_MODEL_PATH;
  else process.env.VERA_MODEL_PATH = oldPath;
  if (oldRoutes === undefined) delete process.env.VERA_MODEL_ROUTES;
  else process.env.VERA_MODEL_ROUTES = oldRoutes;
});

test("preferred route header wins when mapped", () => {
  const oldRoutes = process.env.VERA_MODEL_ROUTES;
  process.env.VERA_MODEL_ROUTES = JSON.stringify({
    default: "/a.gguf",
    coder: "/b.gguf",
  });
  clear("../core/modelRouter.js");
  const { createModelRouter } = require("../core/modelRouter.js");
  const router = createModelRouter();
  const route = router.resolveRoute({
    prompt: "hello",
    metadata: { preferredRoute: "coder" },
  });
  assert.equal(route.route, "coder");
  assert.equal(route.modelPath, "/b.gguf");
  assert.equal(route.reason, "preferred_route");
  if (oldRoutes === undefined) delete process.env.VERA_MODEL_ROUTES;
  else process.env.VERA_MODEL_ROUTES = oldRoutes;
});

test("keyword routing selects specialist when routes exist", () => {
  const oldRoutes = process.env.VERA_MODEL_ROUTES;
  process.env.VERA_MODEL_ROUTES = JSON.stringify({
    default: "/a.gguf",
    coder: "/code.gguf",
  });
  clear("../core/modelRouter.js");
  const { createModelRouter } = require("../core/modelRouter.js");
  const router = createModelRouter();
  const route = router.resolveRoute({ prompt: "Please refactor this Python function." });
  assert.equal(route.route, "coder");
  assert.equal(route.modelPath, "/code.gguf");
  assert.equal(route.reason, "keyword_match");
  assert.ok(typeof route.confidence === "number" && route.confidence > 0 && route.confidence <= 1);
  if (oldRoutes === undefined) delete process.env.VERA_MODEL_ROUTES;
  else process.env.VERA_MODEL_ROUTES = oldRoutes;
});

test("audit chain verify passes after append", () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vera-audit-"));
  const prev = process.env.VERA_MEMORY_DB_PATH;
  const prevAudit = process.env.VERA_AUDIT_LOG_ENABLED;
  process.env.VERA_MEMORY_DB_PATH = path.join(root, "m.db");
  process.env.VERA_AUDIT_LOG_ENABLED = "true";
  try {
    delete require.cache[require.resolve("../memory/db.js")];
    delete require.cache[require.resolve("../memory/auditLog.js")];
    const auditLog = require("../memory/auditLog.js");
    auditLog.append({ action: "test.event", resource: "unit", requestId: "t1" });
    const v = auditLog.verifyChain();
    assert.equal(v.ok, true);
    assert.ok(v.rowCount >= 1);
  } finally {
    if (prev === undefined) delete process.env.VERA_MEMORY_DB_PATH;
    else process.env.VERA_MEMORY_DB_PATH = prev;
    if (prevAudit === undefined) delete process.env.VERA_AUDIT_LOG_ENABLED;
    else process.env.VERA_AUDIT_LOG_ENABLED = prevAudit;
    try {
      require("../memory/db.js").closeDbForTests();
    } catch (_e) {
      /* ignore */
    }
    delete require.cache[require.resolve("../memory/db.js")];
    delete require.cache[require.resolve("../memory/auditLog.js")];
    fs.rmSync(root, { recursive: true, force: true });
  }
});
