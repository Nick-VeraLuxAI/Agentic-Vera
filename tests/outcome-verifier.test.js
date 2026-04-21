const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyAgentOutcome } = require("../core/outcomeVerifier.js");

test("verifyAgentOutcome parses satisfied from mock LLM output", async () => {
  const mockInfer = async () =>
    '{"satisfied": true, "confidence": 0.9, "reason": "Goal met.", "unmetCriteria": []}';
  const r = await verifyAgentOutcome(
    {
      goal: "Say hello",
      lastReply: "Hello!",
      successCriteria: [],
      modelPath: "/tmp/fake.gguf",
    },
    mockInfer
  );
  assert.equal(r.ok, true);
  assert.equal(r.satisfied, true);
  assert.equal(r.confidence, 0.9);
});

test("verifyAgentOutcome handles invalid JSON from model", async () => {
  const mockInfer = async () => "not json";
  const r = await verifyAgentOutcome(
    {
      goal: "x",
      lastReply: "y",
      successCriteria: [],
    },
    mockInfer
  );
  assert.equal(r.ok, false);
  assert.equal(r.satisfied, false);
});
