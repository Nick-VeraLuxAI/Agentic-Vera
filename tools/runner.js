const retrievalMemory = require("../memory/retrievalMemory");
const { runLocalModel } = require("./localInfer");
const { runInSandbox } = require("./codeSandbox");
const approvalQueue = require("../memory/approvalQueue");
const { workspaceRead, workspaceList, workspaceWrite, WORKSPACE_ROOT } = require("./workspaceAccess");
const { httpFetch } = require("./httpFetch");
const { REGISTERED_NAMES } = require("./manifest");
const { validateToolArgs } = require("./toolSchemas");
const { applyPluginHandlers } = require("./pluginAugment");
const { bumpTool } = require("../lib/opsMetrics");

const MAX_SUMMARY_CHARS = Number(process.env.VERA_TOOL_SUMMARY_MAX_CHARS || 400);
const MAX_SYNTHESIS_JSON_CHARS = Number(process.env.VERA_TOOL_SYNTHESIS_MAX_CHARS || 24000);

function summarizeText(text) {
  const input = String(text || "").trim();
  if (!input) return "";
  return input.length <= MAX_SUMMARY_CHARS ? input : `${input.slice(0, MAX_SUMMARY_CHARS)}...`;
}

function evalArithmetic(expression) {
  const s = String(expression || "").trim();
  if (!s) return { ok: false, error: "eval_arithmetic requires expression." };
  if (!/^[-+*/().\d\s]+$/.test(s)) {
    return { ok: false, error: "Only digits, parentheses, and + - * / are allowed." };
  }
  try {
    const fn = new Function(`"use strict"; return (${s})`);
    const v = fn();
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, error: "Result is not a finite number." };
    }
    return { ok: true, value: v };
  } catch (err) {
    return { ok: false, error: err.message || "evaluation failed" };
  }
}

const handlers = {
  async search_tool(args = {}) {
    const query = String(args.query || args.q || "").trim();
    if (!query) return { ok: false, error: "search_tool requires query." };
    const results = await retrievalMemory.searchRelevantAsync(query, {
      topK: Number(args.topK || 4),
      maxChars: Number(args.maxChars || 2800),
    });
    return { ok: true, results };
  },

  async summary_tool(args = {}) {
    const text = String(args.text || args.input || "").trim();
    if (!text) return { ok: false, error: "summary_tool requires text." };
    return { ok: true, summary: summarizeText(text) };
  },

  async local_infer(args = {}, ctx = {}) {
    const prompt = String(args.prompt || "").trim();
    if (!prompt) return { ok: false, error: "local_infer requires prompt." };
    const modelPath = args.modelPath || ctx.modelPath;
    const reply = await runLocalModel(prompt, { modelPath });
    return { ok: true, reply };
  },

  async code_sandbox(args = {}) {
    return runInSandbox({
      language: args.language,
      code: args.code,
      stdin: args.stdin,
      timeoutMs: args.timeoutMs,
      memoryMb: args.memoryMb,
      cpuLimit: args.cpuLimit,
      hardened: args.hardened,
    });
  },

  async workspace_read(args = {}) {
    const rel = String(args.path || args.file || "").trim();
    if (!rel) return { ok: false, error: "workspace_read requires path." };
    return workspaceRead(rel);
  },

  async workspace_list(args = {}) {
    const rel = String(args.path || ".").trim() || ".";
    return workspaceList(rel);
  },

  async workspace_write(args = {}, ctx = {}) {
    const rel = String(args.path || "").trim();
    if (!rel) return { ok: false, error: "workspace_write requires path." };
    const enabled = String(process.env.VERA_WORKSPACE_WRITE_ENABLED || "false").toLowerCase() === "true";
    if (!enabled) return { ok: false, error: "workspace_write disabled (set VERA_WORKSPACE_WRITE_ENABLED=true)." };
    const content = args.content != null ? String(args.content) : "";
    const requireHuman =
      ctx.requireHumanApproval === true ||
      String(process.env.VERA_WORKSPACE_WRITE_REQUIRE_APPROVAL || "true").toLowerCase() === "true";
    const aid = args.approvalId ? String(args.approvalId).trim() : "";
    if (requireHuman && !aid) {
      const id = approvalQueue.createRequest({
        tool: "workspace_write",
        args: { path: rel, contentLength: Buffer.byteLength(content, "utf8") },
        runId: ctx.runId || null,
        taskId: ctx.taskId || null,
      });
      return { ok: false, approvalRequired: true, approvalId: id, message: "Human approval required." };
    }
    if (aid) {
      const consumed = await approvalQueue.consumeIfApproved(aid);
      if (!consumed) return { ok: false, error: "Invalid or unapproved approvalId." };
    }
    return workspaceWrite(rel, content);
  },

  async http_fetch(args = {}) {
    const url = String(args.url || "").trim();
    if (!url) return { ok: false, error: "http_fetch requires url." };
    return httpFetch(url);
  },

  async eval_arithmetic(args = {}) {
    const expression = args.expression ?? args.expr ?? args.q;
    const r = evalArithmetic(expression);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, value: r.value };
  },

  async system_info(args = {}) {
    return {
      ok: true,
      workspaceRoot: WORKSPACE_ROOT,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      includeEnvKeys: args.includeEnvKeys === true ? Object.keys(process.env).sort().slice(0, 80) : undefined,
    };
  },

  async coordination_post(args = {}, ctx = {}) {
    const agentCoordination = require("../memory/agentCoordination");
    const coordId = String(args.coordinationId || ctx.coordinationId || "").trim();
    const message = String(args.message || "").trim();
    if (!coordId || !message) {
      return { ok: false, error: "coordination_post requires coordinationId (or active agent run) and message." };
    }
    const toRole = args.toRole != null ? String(args.toRole).trim() : "all";
    const fromRole = ctx.agentRole || "agent";
    agentCoordination.appendMessage(coordId, fromRole, toRole, ctx.runId || null, message);
    return { ok: true, posted: true, coordinationId: coordId };
  },

  async github_api(args = {}) {
    const token = String(process.env.VERA_GITHUB_TOKEN || "").trim();
    if (!token) {
      return { ok: false, error: "Set VERA_GITHUB_TOKEN to enable github_api (repo-scoped fine-grained PAT recommended)." };
    }
    const apiPath = String(args.path || "").trim();
    if (!apiPath.startsWith("/")) {
      return { ok: false, error: 'github_api.path must start with / (e.g. "/repos/owner/repo/issues").' };
    }
    const allow = String(process.env.VERA_GITHUB_API_ALLOWLIST || "").trim();
    if (allow && allow !== "*") {
      const allowed = allow.split(",").some((prefix) => {
        const p = prefix.trim();
        return p && apiPath.startsWith(p);
      });
      if (!allowed) {
        return { ok: false, error: "Path not allowed by VERA_GITHUB_API_ALLOWLIST." };
      }
    }
    const url = new URL(`https://api.github.com${apiPath}`);
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Agentic-Vera",
      },
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (_e) {
      body = text;
    }
    return { ok: res.ok, status: res.status, body };
  },

  async slack_post(args = {}) {
    const wh = String(process.env.VERA_SLACK_INCOMING_WEBHOOK_URL || "").trim();
    if (!wh) {
      return { ok: false, error: "Set VERA_SLACK_INCOMING_WEBHOOK_URL to enable slack_post (Incoming Webhook URL)." };
    }
    const text = String(args.text || args.message || "").trim();
    if (!text) {
      return { ok: false, error: "slack_post requires text or message." };
    }
    const res = await fetch(wh, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 4000) }),
    });
    const t = await res.text();
    return { ok: res.ok, status: res.status, response: t.slice(0, 500) };
  },
};

applyPluginHandlers(handlers);

const HANDLER_KEYS = new Set(Object.keys(handlers));

async function runTool(name, args = {}, ctx = {}) {
  const toolName = String(name || "").trim();
  if (!REGISTERED_NAMES.has(toolName)) {
    return { ok: false, error: `Tool '${toolName}' is not registered. See tools/manifest.js.` };
  }
  if (!HANDLER_KEYS.has(toolName)) {
    return { ok: false, error: `Tool '${toolName}' has no handler implementation.` };
  }
  const schemaCheck = validateToolArgs(toolName, args);
  if (!schemaCheck.ok) {
    return { ok: false, error: `Invalid arguments for '${toolName}': ${schemaCheck.error}` };
  }
  try {
    const out = await handlers[toolName](args, ctx);
    bumpTool(Boolean(out && out.ok));
    return out;
  } catch (err) {
    bumpTool(false);
    const msg = err && err.message ? err.message : String(err);
    console.error(`❌ Tool '${toolName}' threw:`, msg);
    return { ok: false, error: msg, tool: toolName };
  }
}

module.exports = {
  runTool,
  REGISTERED_NAMES,
  HANDLER_KEYS,
  MAX_SYNTHESIS_JSON_CHARS,
};
