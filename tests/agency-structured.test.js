const test = require("node:test");
const assert = require("node:assert/strict");
const { parseStructuredPlan, shouldUseStructuredMode } = require("../core/structuredPlan.js");
const { verifyStepProgrammatic, verifySuccessCriteriaStrings } = require("../core/verificationLadder.js");
const { buildPolicy, createBudgetTracker } = require("../core/agentPolicy.js");

test("parseStructuredPlan accepts steps with objectives", () => {
  const r = parseStructuredPlan({
    version: 1,
    steps: [{ id: "a", objective: "Do the thing" }, { objective: "Second" }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.plan.steps.length, 2);
  assert.equal(r.plan.steps[0].id, "a");
});

test("shouldUseStructuredMode respects executionMode turns", () => {
  assert.equal(
    shouldUseStructuredMode({
      executionMode: "turns",
      plan: { steps: [{ objective: "x" }] },
    }),
    false
  );
  assert.equal(
    shouldUseStructuredMode({
      executionMode: "structured",
      structuredPlan: { steps: [{ objective: "x" }] },
    }),
    true
  );
});

test("verifyStepProgrammatic checks contains and regex", () => {
  const step = {
    checks: { contains: ["hello"], regex: /done/i },
  };
  const ok = verifyStepProgrammatic(step, "hello world DONE");
  assert.equal(ok.ok, true);
  const bad = verifyStepProgrammatic(step, "nope");
  assert.equal(bad.ok, false);
});

test("verifySuccessCriteriaStrings all required", () => {
  const r = verifySuccessCriteriaStrings(["a", "b"], "a and b here");
  assert.equal(r.ok, true);
});

test("policy budget blocks after max invocations", () => {
  const policy = buildPolicy({
    payload: {
      policy: { maxToolInvocations: 2 },
    },
  });
  const b = createBudgetTracker(policy);
  assert.equal(b.beforeTool("search_tool").ok, true);
  assert.equal(b.beforeTool("search_tool").ok, true);
  const third = b.beforeTool("search_tool");
  assert.equal(third.ok, false);
});
