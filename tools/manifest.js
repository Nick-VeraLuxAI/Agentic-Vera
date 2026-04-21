const { augmentManifest, buildRegisteredNames } = require("./pluginAugment");

/**
 * Built-in tools (plugins under /plugins are merged at load time).
 */
const BASE_TOOL_MANIFEST = [
  {
    name: "search_tool",
    description: "Search the user's indexed memories and uploaded documents (lexical + embedding similarity).",
    argsHint: '{ "query": string, "topK"?: number }',
  },
  {
    name: "summary_tool",
    description: "Truncate/summarize a long text to a short excerpt for the context window.",
    argsHint: '{ "text": string }',
  },
  {
    name: "local_infer",
    description: "Run a follow-up prompt on the local model (use sparingly; expensive). Uses the active route's GGUF when invoked from the main assistant.",
    argsHint: '{ "prompt": string }',
  },
  {
    name: "code_sandbox",
    description: "Execute untrusted code in an isolated Docker sandbox (only when explicitly needed).",
    argsHint: '{ "language": string, "code": string, ... }',
  },
  {
    name: "workspace_read",
    description: "Read a UTF-8 text file under VERA_WORKSPACE_ROOT (path traversal blocked).",
    argsHint: '{ "path": string }',
  },
  {
    name: "workspace_list",
    description: "List files and subdirectories under a path within VERA_WORKSPACE_ROOT.",
    argsHint: '{ "path"?: string }',
  },
  {
    name: "workspace_write",
    description: "Write UTF-8 text to a path under VERA_WORKSPACE_ROOT (may require human approval + approvalId).",
    argsHint: '{ "path": string, "content": string, "approvalId"?: string }',
  },
  {
    name: "http_fetch",
    description: "HTTP GET for allowlisted hosts only (disabled unless VERA_HTTP_FETCH_ENABLED=true).",
    argsHint: '{ "url": string }',
  },
  {
    name: "eval_arithmetic",
    description: "Evaluate a numeric arithmetic expression with + - * / and parentheses (no variables).",
    argsHint: '{ "expression": string }',
  },
  {
    name: "system_info",
    description: "Read-only process/workspace metadata (Node version, platform, workspace root).",
    argsHint: '{ "includeEnvKeys"?: boolean }',
  },
  {
    name: "coordination_post",
    description:
      "Post a message to the multi-agent coordination bus (same coordinationId as the active agent run). Visible to other runs/steps sharing that session.",
    argsHint: '{ "message": string, "toRole"?: string, "coordinationId"?: string }',
  },
];

const TOOL_MANIFEST = augmentManifest(BASE_TOOL_MANIFEST);
const REGISTERED_NAMES = buildRegisteredNames(BASE_TOOL_MANIFEST.map((t) => t.name));

function buildToolConfigJson() {
  const out = {};
  for (const t of TOOL_MANIFEST) {
    out[t.name] = t.description;
  }
  return out;
}

function formatToolAwarenessBlock() {
  const lines = TOOL_MANIFEST.map((t) => `- ${t.name}: ${t.description}`);
  return `Available tools (only these exist — do not invent others):\n${lines.join("\n")}`;
}

function formatToolProtocolBlock() {
  return [
    "How to call tools:",
    '1) Preferred: wrap JSON in [TOOL_CALL]...[/TOOL_CALL] with a single object: {"name":"<tool>","arguments":{...}}',
    "2) Alternative: a fenced JSON block ```json containing {\"tool_calls\":[{\"name\":\"...\",\"arguments\":{}}]}",
    "3) End the user-facing answer without raw JSON when you are done; use [AGENT_DONE] only in background agent runs when the goal is fully satisfied.",
    "Arguments may use \"arguments\" or \"args\" (both accepted).",
  ].join("\n");
}

module.exports = {
  TOOL_MANIFEST,
  REGISTERED_NAMES,
  buildToolConfigJson,
  formatToolAwarenessBlock,
  formatToolProtocolBlock,
};
