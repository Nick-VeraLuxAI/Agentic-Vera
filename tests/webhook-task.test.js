const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

function clear(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

test("webhook accepts shared token and idempotency key", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vera-hook-"));
  const prevQueue = process.env.VERA_TASK_QUEUE_FILE;
  const prevWh = process.env.VERA_WEBHOOK_SECRET;
  const prevSign = process.env.VERA_WEBHOOK_SIGNING_SECRET;
  process.env.VERA_TASK_QUEUE_FILE = path.join(root, "tasks.json");
  const secret = "test_wh_secret";
  process.env.VERA_WEBHOOK_SECRET = secret;
  process.env.VERA_WEBHOOK_SIGNING_SECRET = secret;

  try {
    clear("../orchestration/taskQueue.js");
    clear("../server.js");
    const { createApp } = require("../server.js");
    const app = createApp({
      brain: { send: async () => "ok", getModelRoute: () => ({ route: "default" }) },
      memoryApi: { getFacts: () => [], deleteFact: async () => true },
      disableLocalOnly: true,
    });

    const bodyObj = { type: "inference", payload: { prompt: "ping", sessionId: "hook" } };

    const r1 = await request(app)
      .post("/api/hooks/task")
      .set("x-vera-webhook-token", secret)
      .set("Idempotency-Key", "idem-webhook-1")
      .send(bodyObj);

    assert.equal(r1.status, 202);
    const id1 = r1.body.taskId;

    const r2 = await request(app)
      .post("/api/hooks/task")
      .set("x-vera-webhook-token", secret)
      .set("Idempotency-Key", "idem-webhook-1")
      .send(bodyObj);

    assert.equal(r2.status, 202);
    assert.equal(r2.body.taskId, id1);
  } finally {
    if (prevQueue === undefined) delete process.env.VERA_TASK_QUEUE_FILE;
    else process.env.VERA_TASK_QUEUE_FILE = prevQueue;
    if (prevWh === undefined) delete process.env.VERA_WEBHOOK_SECRET;
    else process.env.VERA_WEBHOOK_SECRET = prevWh;
    if (prevSign === undefined) delete process.env.VERA_WEBHOOK_SIGNING_SECRET;
    else process.env.VERA_WEBHOOK_SIGNING_SECRET = prevSign;
    try {
      fs.rmSync(root, { recursive: true });
    } catch (_e) {
      /* ignore */
    }
  }
});
