const test = require("node:test");
const assert = require("node:assert/strict");
const { parseToolCalls, stripToolMarkers } = require("../core/toolProtocol.js");

test("parseToolCalls reads TOOL_CALL wrapper", () => {
  const text = `Answer.\n[TOOL_CALL]{"name":"search_tool","arguments":{"query":"cats"}}[/TOOL_CALL]`;
  const calls = parseToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "search_tool");
  assert.equal(calls[0].arguments.query, "cats");
});

test("parseToolCalls reads fenced json tool_calls array", () => {
  const text = `Here:\n\`\`\`json\n{"tool_calls":[{"name":"summary_tool","args":{"text":"long text"}}]}\n\`\`\``;
  const calls = parseToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "summary_tool");
  assert.equal(calls[0].arguments.text, "long text");
});

test("stripToolMarkers removes wrappers and fences", () => {
  const text = `Hi\n[TOOL_CALL]{"name":"x"}\n[/TOOL_CALL]\n\`\`\`json\n{}\n\`\`\`\nTail`;
  const out = stripToolMarkers(text);
  assert.ok(!out.includes("TOOL_CALL"));
  assert.ok(out.includes("Tail") || out.includes("Hi"));
});
