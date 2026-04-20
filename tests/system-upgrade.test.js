const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

function clear(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

test("admin and memory routes require API key when configured", async () => {
  const previous = process.env.VERA_ADMIN_API_KEY;
  process.env.VERA_ADMIN_API_KEY = "test-key";

  clear("../server.js");
  const { createApp } = require("../server.js");
  const app = createApp({
    brain: {
      send: async () => "ok",
      sendStream: async () => {},
      getModelRoute: () => ({ route: "default" }),
    },
    memoryApi: {
      getFacts: () => [],
      deleteFact: async () => true,
    },
    disableLocalOnly: true,
  });

  const memoryDenied = await request(app).get("/api/memory/longterm");
  assert.equal(memoryDenied.status, 401);

  const memoryAllowed = await request(app).get("/api/memory/longterm").set("x-api-key", "test-key");
  assert.equal(memoryAllowed.status, 200);

  const adminDenied = await request(app).get("/api/admin/backups");
  assert.equal(adminDenied.status, 401);

  const adminAllowed = await request(app)
    .get("/api/admin/backups")
    .set("Authorization", "Bearer test-key");
  assert.equal(adminAllowed.status, 200);

  if (previous === undefined) delete process.env.VERA_ADMIN_API_KEY;
  else process.env.VERA_ADMIN_API_KEY = previous;
});

test("task queue can claim queued task for worker", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vera-task-queue-"));
  const previous = process.env.VERA_TASK_QUEUE_FILE;
  process.env.VERA_TASK_QUEUE_FILE = path.join(root, "tasks.json");

  try {
    clear("../memory/storage.js");
    clear("../orchestration/taskQueue.js");
    const queue = require("../orchestration/taskQueue.js");
    const id = await queue.enqueueTask("inference", { prompt: "hi" });
    const claimed = await queue.claimNextQueuedTask("worker_test");
    assert.equal(claimed.id, id);
    assert.equal(claimed.status, "running");

    const loaded = queue.getTask(id);
    assert.equal(loaded.workerId, "worker_test");
  } finally {
    if (previous === undefined) delete process.env.VERA_TASK_QUEUE_FILE;
    else process.env.VERA_TASK_QUEUE_FILE = previous;
  }
});

test("code_sandbox tool is safely blocked when disabled", async () => {
  const previous = process.env.VERA_SANDBOX_ENABLED;
  process.env.VERA_SANDBOX_ENABLED = "false";
  clear("../tools/codeSandbox.js");
  clear("../tools/runner.js");
  const { runTool } = require("../tools/runner.js");
  const result = await runTool("code_sandbox", {
    language: "python",
    code: "print('hello')",
  });
  assert.equal(result.ok, false);
  assert.match(result.error || "", /Sandbox is disabled/i);
  if (previous === undefined) delete process.env.VERA_SANDBOX_ENABLED;
  else process.env.VERA_SANDBOX_ENABLED = previous;
});

test("code sandbox hardened mode applies strict docker flags", () => {
  clear("../tools/codeSandbox.js");
  const { buildDockerArgs } = require("../tools/codeSandbox.js");
  const profile = {
    image: "python:3.11-alpine",
    runCommand: ["python", "main.py"],
  };
  const args = buildDockerArgs(profile, {
    tempRoot: "/tmp/vera-sandbox-test",
    memoryMb: 512,
    cpuLimit: "1.0",
    hardened: true,
  });
  const joined = args.join(" ");
  assert.match(joined, /--read-only/);
  assert.match(joined, /--user/);
  assert.match(joined, /--tmpfs \/tmp/);
  assert.match(joined, /--security-opt no-new-privileges/);
  assert.match(joined, /--network none/);
});

test("sandbox language profile resolves dedicated image tags", () => {
  const previousPython = process.env.VERA_SANDBOX_IMAGE_PYTHON;
  const previousLock = process.env.VERA_SANDBOX_USE_IMAGE_LOCK;
  process.env.VERA_SANDBOX_IMAGE_PYTHON = "custom-python-sandbox:1";
  process.env.VERA_SANDBOX_USE_IMAGE_LOCK = "false";
  clear("../tools/codeSandbox.js");
  const { languageProfile } = require("../tools/codeSandbox.js");
  const profile = languageProfile("python");
  assert.equal(profile.image, "custom-python-sandbox:1");
  if (previousPython === undefined) delete process.env.VERA_SANDBOX_IMAGE_PYTHON;
  else process.env.VERA_SANDBOX_IMAGE_PYTHON = previousPython;
  if (previousLock === undefined) delete process.env.VERA_SANDBOX_USE_IMAGE_LOCK;
  else process.env.VERA_SANDBOX_USE_IMAGE_LOCK = previousLock;
});

test("strict lock mode rejects missing digests", () => {
  const previousStrict = process.env.VERA_SANDBOX_REQUIRE_LOCK_DIGEST;
  const previousLock = process.env.VERA_SANDBOX_USE_IMAGE_LOCK;
  process.env.VERA_SANDBOX_REQUIRE_LOCK_DIGEST = "true";
  process.env.VERA_SANDBOX_USE_IMAGE_LOCK = "true";
  clear("../tools/codeSandbox.js");
  const { resolveImage } = require("../tools/codeSandbox.js");
  assert.throws(() => resolveImage("python"), /requires digest/i);
  if (previousStrict === undefined) delete process.env.VERA_SANDBOX_REQUIRE_LOCK_DIGEST;
  else process.env.VERA_SANDBOX_REQUIRE_LOCK_DIGEST = previousStrict;
  if (previousLock === undefined) delete process.env.VERA_SANDBOX_USE_IMAGE_LOCK;
  else process.env.VERA_SANDBOX_USE_IMAGE_LOCK = previousLock;
});
