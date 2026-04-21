const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

test("enqueueTask idempotency returns same task id", async () => {
  const tmp = path.join(os.tmpdir(), `vera_task_queue_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  process.env.VERA_TASK_QUEUE_FILE = tmp;
  delete require.cache[require.resolve("../orchestration/taskQueue.js")];
  const taskQueue = require("../orchestration/taskQueue.js");

  const a = await taskQueue.enqueueTask("inference", { prompt: "x" }, { idempotencyKey: "idem-1" });
  const b = await taskQueue.enqueueTask("inference", { prompt: "y" }, { idempotencyKey: "idem-1" });
  assert.equal(a, b);

  const c = await taskQueue.enqueueTask("inference", { prompt: "z" }, { idempotencyKey: "idem-2" });
  assert.notEqual(c, a);

  delete process.env.VERA_TASK_QUEUE_FILE;
  try {
    fs.unlinkSync(tmp);
  } catch (_e) {
    /* ignore */
  }
});
