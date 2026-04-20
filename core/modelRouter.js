const path = require("path");

function parseKeywords(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function detectSpecialistContext(text, metadata = {}) {
  const input = `${text || ""} ${metadata.fileSummary || ""}`.toLowerCase();
  const codingHints = ["code", "debug", "stack trace", "typescript", "javascript", "python", "refactor"];
  const legalHints = ["contract", "nda", "liability", "clause", "compliance", "legal"];
  const fileHints = ["pdf", "docx", "image", "attachment", "file"];

  if (codingHints.some((h) => input.includes(h))) return "coder";
  if (legalHints.some((h) => input.includes(h))) return "legal";
  if (fileHints.some((h) => input.includes(h))) return "file";
  return "default";
}

function createModelRouter() {
  const enabled = String(process.env.VERA_ROUTER_ENABLED || "false").toLowerCase() === "true";
  const defaultModelPath = process.env.VERA_MODEL_PATH || path.join(__dirname, "../models/JSON-llama3-fp16.Q4_K_M.gguf");

  const specialists = {
    coder: {
      enabled: Boolean(process.env.VERA_ROUTER_CODER_MODEL),
      modelPath: process.env.VERA_ROUTER_CODER_MODEL || defaultModelPath,
      keywords: parseKeywords(process.env.VERA_ROUTER_CODER_KEYWORDS),
      description: "Coding-heavy prompts and debugging tasks",
    },
    legal: {
      enabled: Boolean(process.env.VERA_ROUTER_LEGAL_MODEL),
      modelPath: process.env.VERA_ROUTER_LEGAL_MODEL || defaultModelPath,
      keywords: parseKeywords(process.env.VERA_ROUTER_LEGAL_KEYWORDS),
      description: "Policy/legal/document interpretation tasks",
    },
    file: {
      enabled: Boolean(process.env.VERA_ROUTER_FILE_MODEL),
      modelPath: process.env.VERA_ROUTER_FILE_MODEL || defaultModelPath,
      keywords: parseKeywords(process.env.VERA_ROUTER_FILE_KEYWORDS),
      description: "File-analysis prompts and extraction follow-ups",
    },
  };

  function resolveRoute({ prompt, metadata = {} }) {
    const selected = detectSpecialistContext(prompt, metadata);
    if (!enabled) {
      return {
        route: "default",
        reason: "router_disabled",
        modelPath: defaultModelPath,
      };
    }
    const specialist = specialists[selected];
    if (!specialist || !specialist.enabled) {
      return {
        route: "default",
        reason: specialist ? "specialist_unconfigured" : "no_match",
        modelPath: defaultModelPath,
      };
    }
    return {
      route: selected,
      reason: "heuristic_match",
      modelPath: specialist.modelPath,
      description: specialist.description,
    };
  }

  function getStatus() {
    return {
      enabled,
      defaultModelPath,
      specialists: {
        coder: { enabled: specialists.coder.enabled, modelPath: specialists.coder.modelPath },
        legal: { enabled: specialists.legal.enabled, modelPath: specialists.legal.modelPath },
        file: { enabled: specialists.file.enabled, modelPath: specialists.file.modelPath },
      },
    };
  }

  return {
    resolveRoute,
    getStatus,
  };
}

module.exports = { createModelRouter };
