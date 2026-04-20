const retrievalMemory = require("../memory/retrievalMemory");
const { runLocalModel } = require("./localInfer");
const { runInSandbox } = require("./codeSandbox");

const MAX_SUMMARY_CHARS = Number(process.env.VERA_TOOL_SUMMARY_MAX_CHARS || 400);

function summarizeText(text) {
  const input = String(text || "").trim();
  if (!input) return "";
  return input.length <= MAX_SUMMARY_CHARS ? input : `${input.slice(0, MAX_SUMMARY_CHARS)}...`;
}

async function runTool(name, args = {}) {
  const toolName = String(name || "").trim();
  switch (toolName) {
    case "search_tool": {
      const query = String(args.query || args.q || "").trim();
      if (!query) return { ok: false, error: "search_tool requires query." };
      const results = retrievalMemory.searchRelevant(query, {
        topK: Number(args.topK || 4),
        maxChars: Number(args.maxChars || 2800),
      });
      return { ok: true, results };
    }
    case "summary_tool": {
      const text = String(args.text || args.input || "").trim();
      if (!text) return { ok: false, error: "summary_tool requires text." };
      return { ok: true, summary: summarizeText(text) };
    }
    case "local_infer": {
      const prompt = String(args.prompt || "").trim();
      if (!prompt) return { ok: false, error: "local_infer requires prompt." };
      const reply = await runLocalModel(prompt);
      return { ok: true, reply };
    }
    case "code_sandbox": {
      return runInSandbox({
        language: args.language,
        code: args.code,
        stdin: args.stdin,
        timeoutMs: args.timeoutMs,
        memoryMb: args.memoryMb,
        cpuLimit: args.cpuLimit,
        hardened: args.hardened,
      });
    }
    default:
      return { ok: false, error: `Tool '${toolName}' is not registered.` };
  }
}

module.exports = {
  runTool,
};
