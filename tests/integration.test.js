const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../server.js");

function buildTestApp(overrides = {}) {
  const brain = overrides.brain || {
    send: async (prompt) => `echo:${prompt}`,
    sendStream: async (userMessage, sessionId, onToken, controller, rawPromptOverride) => {
      onToken("hello");
      onToken("world");
      onToken("[DONE]");
      return rawPromptOverride || userMessage;
    },
    getModelRoute: () => ({ route: "default" }),
  };

  const memoryApi = overrides.memoryApi || {
    getFacts: () => [{ text: "memory fact" }],
    deleteFact: async () => true,
  };

  return createApp({
    brain,
    memoryApi,
    disableLocalOnly: true,
  });
}

test("POST /api/message returns mocked reply", async () => {
  const app = buildTestApp();
  const response = await request(app)
    .post("/api/message")
    .field("message", "hello")
    .set("x-session-id", "session_1");

  assert.equal(response.status, 200);
  assert.equal(response.body.reply, "echo:hello");
});

test("POST /api/message rejects invalid session id", async () => {
  const app = buildTestApp();
  const response = await request(app)
    .post("/api/message")
    .field("message", "hello")
    .set("x-session-id", "../bad");

  assert.equal(response.status, 400);
  assert.match(response.body.error, /Invalid session ID format/);
});

test("POST /api/message-stream streams SSE tokens", async () => {
  let capturedRawPrompt = null;
  const app = buildTestApp({
    brain: {
      send: async () => "unused",
      sendStream: async (userMessage, sessionId, onToken, controller, rawPromptOverride) => {
        capturedRawPrompt = rawPromptOverride;
        onToken("hello");
        onToken("there");
        onToken("[DONE]");
      },
    },
  });

  const response = await request(app)
    .post("/api/message-stream")
    .field("message", "stream me")
    .set("x-session-id", "session_2");

  assert.equal(response.status, 200);
  assert.equal(capturedRawPrompt, "stream me");
  assert.match(response.text, /data: hello/);
  assert.match(response.text, /data: there/);
  assert.match(response.text, /data: \[DONE\]/);
});

test("POST /api/memory/delete awaits false return and sends 404", async () => {
  const app = buildTestApp({
    memoryApi: {
      getFacts: () => [],
      deleteFact: async () => false,
    },
  });

  const response = await request(app)
    .post("/api/memory/delete")
    .send({ key: "missing-key" });

  assert.equal(response.status, 404);
  assert.match(response.body.error, /Key not found/);
});

test("POST /api/message enforces upload size limits", async () => {
  const app = buildTestApp();
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 1);

  const response = await request(app)
    .post("/api/message")
    .set("x-session-id", "session_3")
    .field("message", "file test")
    .attach("files", oversized, {
      filename: "oversized.pdf",
      contentType: "application/pdf",
    });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /File too large/i);
});

test("POST /api/message extracts text file content", async () => {
  let capturedPrompt = null;
  let capturedOptions = null;
  const app = buildTestApp({
    brain: {
      send: async (prompt, _sessionId, options) => {
        capturedPrompt = prompt;
        capturedOptions = options;
        return "ok";
      },
      sendStream: async () => {},
      getModelRoute: () => ({ route: "file" }),
    },
  });

  const response = await request(app)
    .post("/api/message")
    .set("x-session-id", "session_4")
    .field("message", "summarize this")
    .attach("files", Buffer.from("alpha\nbeta\ngamma", "utf8"), {
      filename: "notes.txt",
      contentType: "text/plain",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.reply, "ok");
  assert.equal(response.headers["x-model-route"], "file");
  assert.equal(capturedOptions?.route?.route, "file");
  assert.match(capturedPrompt || "", /notes\.txt/);
  assert.match(capturedPrompt || "", /alpha/);
});

test("GET /api/router/status returns router observability payload", async () => {
  const app = buildTestApp({
    brain: {
      send: async () => "ok",
      sendStream: async () => {},
      getModelRoute: () => ({ route: "coder", reason: "heuristic_match" }),
      getRuntimeStatus: () => ({
        router: {
          enabled: true,
          defaultModelPath: "/models/default.gguf",
          specialists: {
            coder: { enabled: true, modelPath: "/models/coder.gguf" },
            legal: { enabled: false, modelPath: "/models/default.gguf" },
            file: { enabled: false, modelPath: "/models/default.gguf" },
          },
        },
      }),
    },
  });

  await request(app)
    .post("/api/message")
    .field("message", "debug this code")
    .set("x-session-id", "session_router");

  const response = await request(app).get("/api/router/status");
  assert.equal(response.status, 200);
  assert.equal(response.body.router.enabled, true);
  assert.ok(typeof response.body.routeCounts.default === "number");
  assert.ok(typeof response.body.routeCounts.coder === "number");
});

test("task queue endpoints create and fetch tasks", async () => {
  const app = buildTestApp();

  const createRes = await request(app)
    .post("/api/tasks")
    .send({ type: "fine_tune_job", payload: { dataset: "training/dataset.jsonl" } });

  assert.equal(createRes.status, 202);
  assert.ok(createRes.body.taskId);

  const getRes = await request(app).get(`/api/tasks/${createRes.body.taskId}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.type, "fine_tune_job");
  assert.equal(getRes.body.status, "queued");
  assert.ok(Array.isArray(getRes.body.checkpoints));
});
