const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../server.js");

test("smoke: health, readiness, and metrics endpoints", async () => {
  const app = createApp({
    disableLocalOnly: true,
    brain: {
      send: async () => "ok",
      sendStream: async (message, sessionId, onToken) => {
        onToken("ok");
        onToken("[DONE]");
      },
      getRuntimeStatus: () => ({
        modelReady: true,
        pendingRequests: 0,
        maxPendingRequests: 20,
        queueAvailable: true,
        circuitOpen: false,
      }),
    },
    memoryApi: {
      getFacts: () => [],
      deleteFact: async () => true,
    },
  });

  const health = await request(app).get("/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.status, "ok");

  const ready = await request(app).get("/ready");
  assert.equal(ready.status, 200);

  const metrics = await request(app).get("/metrics");
  assert.equal(metrics.status, 200);
  assert.equal(typeof metrics.body.requests_total, "number");
});
