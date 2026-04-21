const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const { getPluginSchemas } = require("./pluginAugment");

const BASE_SCHEMAS = {
  search_tool: {
    type: "object",
    additionalProperties: true,
    properties: {
      query: { type: "string", minLength: 1 },
      q: { type: "string" },
      topK: { type: "integer", minimum: 1, maximum: 50 },
      maxChars: { type: "integer", minimum: 100, maximum: 50000 },
    },
    anyOf: [{ required: ["query"] }, { required: ["q"] }],
  },
  summary_tool: {
    type: "object",
    additionalProperties: true,
    properties: {
      text: { type: "string", minLength: 1 },
      input: { type: "string" },
    },
    anyOf: [{ required: ["text"] }, { required: ["input"] }],
  },
  local_infer: {
    type: "object",
    additionalProperties: true,
    required: ["prompt"],
    properties: {
      prompt: { type: "string", minLength: 1 },
      modelPath: { type: "string" },
    },
  },
  code_sandbox: {
    type: "object",
    additionalProperties: true,
    required: ["language", "code"],
    properties: {
      language: { type: "string", minLength: 1 },
      code: { type: "string" },
      stdin: { type: "string" },
      timeoutMs: { type: "integer", minimum: 100, maximum: 600000 },
      memoryMb: { type: "integer", minimum: 32, maximum: 8192 },
      cpuLimit: { type: "number" },
      hardened: { type: "boolean" },
    },
  },
  workspace_read: {
    type: "object",
    additionalProperties: true,
    properties: {
      path: { type: "string", minLength: 1 },
      file: { type: "string" },
    },
    anyOf: [{ required: ["path"] }, { required: ["file"] }],
  },
  workspace_list: {
    type: "object",
    additionalProperties: true,
    properties: {
      path: { type: "string" },
    },
  },
  workspace_write: {
    type: "object",
    additionalProperties: true,
    required: ["path"],
    properties: {
      path: { type: "string", minLength: 1 },
      content: { type: "string" },
      approvalId: { type: "string" },
    },
  },
  http_fetch: {
    type: "object",
    additionalProperties: true,
    required: ["url"],
    properties: {
      url: { type: "string", minLength: 1, maxLength: 8192 },
    },
  },
  eval_arithmetic: {
    type: "object",
    additionalProperties: true,
    properties: {
      expression: {},
      expr: {},
      q: {},
    },
    anyOf: [{ required: ["expression"] }, { required: ["expr"] }, { required: ["q"] }],
  },
  system_info: {
    type: "object",
    additionalProperties: true,
    properties: {
      includeEnvKeys: { type: "boolean" },
    },
  },
  coordination_post: {
    type: "object",
    additionalProperties: true,
    required: ["message"],
    properties: {
      message: { type: "string", minLength: 1, maxLength: 10000 },
      toRole: { type: "string" },
      coordinationId: { type: "string" },
    },
  },
};

let ajv;
let validators;

function getValidators() {
  if (!validators) {
    ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    validators = new Map();
    const merged = { ...BASE_SCHEMAS, ...getPluginSchemas() };
    for (const [name, schema] of Object.entries(merged)) {
      if (schema && typeof schema === "object") {
        validators.set(name, ajv.compile(schema));
      }
    }
  }
  return validators;
}

function validateToolArgs(toolName, args) {
  const name = String(toolName || "").trim();
  const data = args != null && typeof args === "object" && !Array.isArray(args) ? args : {};
  const v = getValidators().get(name);
  if (!v) {
    return { ok: true };
  }
  const ok = v(data);
  if (ok) return { ok: true };
  const errs = (v.errors || []).map((e) => `${e.instancePath || "."} ${e.message}`).join("; ");
  return { ok: false, error: errs || "JSON Schema validation failed." };
}

module.exports = {
  validateToolArgs,
  BASE_SCHEMAS,
};
