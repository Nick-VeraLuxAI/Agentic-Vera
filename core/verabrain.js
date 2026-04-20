const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const memory = require("../memory/memoryController");
const retrievalMemory = require("../memory/retrievalMemory");
const { createModelRouter } = require("./modelRouter");
const { runTool } = require("../tools/runner");

const DEFAULT_MODEL_PATH = process.env.VERA_MODEL_PATH || path.join(__dirname, "../models/JSON-llama3-fp16.Q4_K_M.gguf");
const MAIN_BINARY = path.join(__dirname, "../build/bin/llama-cli");
const MAX_PENDING_REQUESTS = Number(process.env.VERA_MAX_PENDING_REQUESTS || 20);
const MAX_PENDING_REQUESTS_PER_ROUTE = Number(process.env.VERA_MAX_PENDING_REQUESTS_PER_ROUTE || MAX_PENDING_REQUESTS);
const REQUEST_TIMEOUT_MS = Number(process.env.VERA_REQUEST_TIMEOUT_MS || 90000);
const MAX_RESTARTS_PER_WINDOW = Number(process.env.VERA_MAX_RESTARTS_PER_WINDOW || 5);
const RESTART_WINDOW_MS = Number(process.env.VERA_RESTART_WINDOW_MS || 60000);
const CIRCUIT_OPEN_MS = Number(process.env.VERA_CIRCUIT_OPEN_MS || 30000);
const MAX_HISTORY_TURNS = Number(process.env.VERA_SHORT_TERM_HISTORY_TURNS || 4);
const MAX_TOOL_ITERATIONS = Number(process.env.VERA_TOOL_MAX_ITERATIONS || 2);
const ROUTER = createModelRouter();

const sessionStates = new Map();
let pendingRequestsTotal = 0;

function resolveModelPath(rawModelPath) {
  const candidate = String(rawModelPath || DEFAULT_MODEL_PATH);
  return path.isAbsolute(candidate) ? candidate : path.resolve(__dirname, "..", candidate);
}

function normalizeRoute(route = {}) {
  const routeName = String(route.route || "default");
  const modelPath = resolveModelPath(route.modelPath || DEFAULT_MODEL_PATH);
  return {
    route: routeName,
    reason: route.reason || "unspecified",
    modelPath,
    description: route.description,
  };
}

function routeKey(route) {
  return `${route.route}:${route.modelPath}`;
}

function ensureSessionState(route) {
  const key = routeKey(route);
  if (sessionStates.has(key)) {
    const existing = sessionStates.get(key);
    existing.route = route;
    return existing;
  }
  const state = {
    key,
    route,
    child: null,
    hasInitializedVera: false,
    isReady: false,
    isStarting: false,
    lastReply: "",
    pendingRequests: 0,
    requestQueue: Promise.resolve(),
    restartCountInWindow: 0,
    restartWindowStartedAt: 0,
    circuitOpenUntil: 0,
  };
  sessionStates.set(key, state);
  return state;
}

function busyError() {
  const err = new Error("Model is overloaded. Please retry shortly.");
  err.statusCode = 503;
  err.retryAfterSeconds = 3;
  return err;
}

function unavailableError(retryAfterSeconds = 3) {
  const err = new Error("Model is unavailable. Please retry shortly.");
  err.statusCode = 503;
  err.retryAfterSeconds = Math.max(1, Number(retryAfterSeconds) || 1);
  return err;
}

function buildToolAwareness() {
  try {
    const configPath = path.join(__dirname, "../tools/tool_config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const entries = Object.entries(config).map(([name, desc]) => `- ${name}: ${desc}`);
    return `Available Tools:\n${entries.join("\n")}`;
  } catch (err) {
    console.warn("⚠️ Failed to read tool_config.json:", err);
    return "Available Tools:\n- No tool descriptions loaded.";
  }
}

function cleanReply(rawText) {
  let text = String(rawText || "").replace(/<\/s>/g, "").replace(/\s+/g, " ").trim();
  const parts = text.split(/<\|start_header_id\|>assistant<\|end_header_id\|>/i);
  if (parts.length > 1) text = parts[1].trim();
  for (const marker of [
    "assistant",
    "Please provide a clear question",
    "I'm ready to help",
    "Let me know if you need anything else",
    "I'm still waiting",
    "I'll wait for a clear question",
  ]) {
    const idx = text.indexOf(marker);
    if (idx > 10) {
      text = text.slice(0, idx).trim();
      break;
    }
  }
  return text;
}

function buildPrompt(userInput, options = {}) {
  const { retrievedContexts = [], previousHistory = [], relevantFacts = [] } = options;
  const historyBlock = previousHistory.length
    ? `Recent conversation:\n${previousHistory.map((m) => `${m.role}: ${m.content}`).join("\n")}\n\n`
    : "";
  const contextBlock = retrievedContexts.length
    ? `Relevant prior context:\n${retrievedContexts.map((c, idx) => `(${idx + 1}) [${c.source}] ${c.text}`).join("\n\n")}\n\n`
    : "";
  const factsBlock = relevantFacts.length
    ? `Potentially relevant known facts:\n${relevantFacts
        .map((f) => `- ${f.subject || f.value || f.original || JSON.stringify(f)}`)
        .join("\n")}\n\n`
    : "";
  return `${historyBlock}${factsBlock}${contextBlock}${userInput}`.trim();
}

function parseToolCalls(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const matches = [];

  const tagged = raw.match(/\[TOOL_CALL\]([\s\S]*?)\[\/TOOL_CALL\]/gi) || [];
  for (const block of tagged) {
    const payload = block.replace(/\[TOOL_CALL\]|\[\/TOOL_CALL\]/gi, "").trim();
    try {
      const parsed = JSON.parse(payload);
      if (parsed && parsed.name) matches.push(parsed);
    } catch (_err) {
      // ignore malformed tool payloads
    }
  }

  if (matches.length) return matches;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.tool_calls)) {
      return parsed.tool_calls.filter((call) => call && call.name);
    }
  } catch (_err) {
    // ignore non-JSON output
  }
  return [];
}

function stripToolMarkers(text) {
  return String(text || "").replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/gi, "").trim();
}

async function runToolLoop(basePrompt, firstReply) {
  let workingReply = String(firstReply || "");
  for (let step = 0; step < MAX_TOOL_ITERATIONS; step += 1) {
    const toolCalls = parseToolCalls(workingReply);
    if (!toolCalls.length) break;

    const toolResults = [];
    for (const call of toolCalls) {
      const result = await runTool(call.name, call.arguments || {});
      toolResults.push({
        name: call.name,
        result,
      });
    }

    const synthesisPrompt = `
${basePrompt}

Tool execution results:
${JSON.stringify(toolResults, null, 2)}

Use tool results to answer the user. Do not emit tool call payloads in your final answer.
`.trim();

    workingReply = cleanReply(await runTool("local_infer", { prompt: synthesisPrompt }).then((x) => x.reply || ""));
    if (!workingReply) break;
  }
  return stripToolMarkers(workingReply);
}

function emitTokens(text, onToken) {
  String(text || "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .forEach((token) => onToken(token));
}

function scheduleRestart(state, reason = "unknown") {
  state.isReady = false;
  state.child = null;
  const now = Date.now();

  if (!state.restartWindowStartedAt || now - state.restartWindowStartedAt > RESTART_WINDOW_MS) {
    state.restartWindowStartedAt = now;
    state.restartCountInWindow = 0;
  }
  state.restartCountInWindow += 1;

  if (state.restartCountInWindow > MAX_RESTARTS_PER_WINDOW) {
    state.circuitOpenUntil = now + CIRCUIT_OPEN_MS;
    console.error(`❌ Restart circuit open for route=${state.route.route} (${reason}). Cooling down ${CIRCUIT_OPEN_MS}ms.`);
    return;
  }

  const delay = Math.min(15000, 500 * 2 ** (state.restartCountInWindow - 1));
  setTimeout(() => {
    startSession(state.route).catch((err) => {
      console.error(`❌ Restart attempt failed for route=${state.route.route}:`, err.message);
    });
  }, delay);
}

async function initializeVera(state) {
  if (state.hasInitializedVera || !state.child) return;
  state.hasInitializedVera = true;
  try {
    const identityPath = path.join(__dirname, "../prompts/identity.md");
    const identityText = fs.readFileSync(identityPath, "utf-8").trim();
    const toolAwareness = buildToolAwareness();
    const facts = await memory.getAllMemory("default");
    const formattedFacts =
      facts.longTerm
        .map((f) => `- (${f.type}) ${f.subject || f.value || f.original || JSON.stringify(f)}`)
        .join("\n") || "- None yet.";
    const fullInit = `
<|begin_of_text|>
<|start_header_id|>system<|end_header_id|>
${identityText}

${toolAwareness}

Known facts about the user:
${formattedFacts}

<|eot_id|>`.trim();
    state.child.stdin.write(fullInit + "\n");
  } catch (err) {
    console.error("❌ Failed to initialize Vera:", err);
  }
}

async function startSession(routeInput) {
  const route = normalizeRoute(routeInput || { route: "default", modelPath: DEFAULT_MODEL_PATH, reason: "startup_default" });
  const state = ensureSessionState(route);
  if (state.child || state.isStarting) return state;
  if (Date.now() < state.circuitOpenUntil) return state;

  state.isStarting = true;
  const args = [
    "--model",
    route.modelPath,
    "--n-predict",
    "1024",
    "--temp",
    "0.7",
    "--top-p",
    "0.95",
    "--top-k",
    "40",
    "--threads",
    "8",
  ];

  try {
    console.log(`🧠 Launching persistent session (route=${route.route})...`);
    const child = spawn(MAIN_BINARY, args);
    child.stdin.setDefaultEncoding("utf-8");
    child.stdout.setEncoding("utf-8");

    child.on("error", (err) => {
      console.error(`❌ Model spawn error for route=${route.route}:`, err);
      scheduleRestart(state, "spawn_error");
    });

    child.stderr.on("data", (data) => {
      console.error(`🔥 LLM stderr [${route.route}]:`, data.toString());
    });

    child.on("exit", (code, signal) => {
      console.warn(`⚠️ LLM exited route=${route.route} (code=${code}, signal=${signal}).`);
      scheduleRestart(state, "exit");
    });

    state.child = child;
    state.isReady = true;
    state.restartCountInWindow = 0;
    await initializeVera(state);
    return state;
  } finally {
    state.isStarting = false;
  }
}

function enqueueRequest(state, task) {
  if (pendingRequestsTotal >= MAX_PENDING_REQUESTS || state.pendingRequests >= MAX_PENDING_REQUESTS_PER_ROUTE) {
    return Promise.reject(busyError());
  }
  pendingRequestsTotal += 1;
  state.pendingRequests += 1;
  const run = state.requestQueue
    .then(() => task())
    .finally(() => {
      pendingRequestsTotal = Math.max(0, pendingRequestsTotal - 1);
      state.pendingRequests = Math.max(0, state.pendingRequests - 1);
    });
  state.requestQueue = run.catch(() => {});
  return run;
}

function resolveRouteForRequest(prompt, options = {}) {
  if (options.route && options.route.modelPath) {
    return normalizeRoute(options.route);
  }
  if (options.route && options.route.route) {
    return normalizeRoute({
      ...options.route,
      modelPath: options.route.modelPath || DEFAULT_MODEL_PATH,
    });
  }
  if (options.modelPath) {
    return normalizeRoute({ route: "default", modelPath: options.modelPath, reason: "explicit_model_path" });
  }
  return normalizeRoute(ROUTER.resolveRoute({ prompt, metadata: options.metadata || {} }));
}

async function sendStream(userMessage, sessionId = "default", onToken, controller = {}, rawPromptOverride = null, options = {}) {
  const promptSource = rawPromptOverride || userMessage;
  const route = resolveRouteForRequest(promptSource, options);
  const state = await startSession(route);
  if (!state.isReady || !state.child || Date.now() < state.circuitOpenUntil) {
    const retryAfter = Math.ceil((state.circuitOpenUntil - Date.now()) / 1000);
    throw unavailableError(retryAfter);
  }

  return enqueueRequest(state, async () => {
    const allMemory = await memory.getAllMemory(sessionId);
    const previousHistory = Array.isArray(allMemory.shortTerm) ? allMemory.shortTerm.slice(-MAX_HISTORY_TURNS * 2) : [];
    await memory.processUserMessage(userMessage, sessionId);
    const relevantFacts = await memory.getRelevantFacts(userMessage);
    const trimmed = [...previousHistory, { role: "user", content: userMessage }].slice(-MAX_HISTORY_TURNS * 2);

    const retrievedContexts = retrievalMemory.searchRelevant(userMessage, {
      topK: Number(process.env.VERA_RETRIEVAL_TOP_K || 4),
      maxChars: Number(process.env.VERA_RETRIEVAL_MAX_CONTEXT_CHARS || 2800),
    });
    const prompt = buildPrompt(promptSource, {
      previousHistory,
      retrievedContexts,
      relevantFacts,
    });
    state.child.stdin.write(prompt + "\n");

    return new Promise((resolve) => {
      let fullOutput = "";
      let resolved = false;
      const timeout = setTimeout(() => {
        finishReply(fullOutput || "Request timeout.");
      }, REQUEST_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        state.child.stdout.off("data", onData);
        controller.cancel = undefined;
      };

      const finishReply = async (output) => {
        if (resolved) return;
        resolved = true;
        cleanup();

        const initialReply = cleanReply(output);
        const safeReply = await runToolLoop(prompt, initialReply);
        state.lastReply = safeReply;
        emitTokens(safeReply, onToken);
        onToken("[DONE]");

        const aiMatches = safeReply.match(/\[(MEMORY|FORGET):\s*(.*?)\]/gi) || [];
        for (const raw of aiMatches) {
          const match = raw.match(/\[(MEMORY|FORGET):\s*(.*?)\]/i);
          if (!match) continue;
          const [, type, content] = match;
          if (type.toUpperCase() === "MEMORY") {
            await memory.manuallySaveFact(content.trim());
          } else {
            await memory.manuallyForgetFact(content.trim());
          }
        }

        const finalHistory = [...trimmed, { role: "assistant", content: safeReply }];
        await memory.saveShortTerm(sessionId, finalHistory);
        try {
          await retrievalMemory.addDocuments(sessionId, "conversation-user", userMessage, { role: "user" });
          await retrievalMemory.addDocuments(sessionId, "conversation-assistant", safeReply, { role: "assistant" });
        } catch (err) {
          console.error("⚠️ Retrieval index update failed:", err.message);
        }
        resolve(safeReply);
      };

      const onData = (data) => {
        if (resolved) return;
        const chunk = data.toString();
        fullOutput += chunk;
        if (fullOutput.includes("</s>")) {
          finishReply(fullOutput.split("</s>")[0]);
        }
      };

      controller.cancel = () => {
        finishReply(fullOutput || "Request cancelled.");
      };

      state.child.stdout.on("data", onData);
    });
  });
}

async function send(userMessage, sessionId = "default", options = {}) {
  return sendStream(userMessage, sessionId, () => {}, {}, userMessage, options);
}

function getRuntimeStatus() {
  const routeStatuses = {};
  for (const [key, state] of sessionStates.entries()) {
    routeStatuses[key] = {
      route: state.route.route,
      modelPath: state.route.modelPath,
      modelReady: state.isReady && Boolean(state.child),
      isStarting: state.isStarting,
      pendingRequests: state.pendingRequests,
      queueAvailable: state.pendingRequests < MAX_PENDING_REQUESTS_PER_ROUTE,
      circuitOpenUntil: state.circuitOpenUntil,
      circuitOpen: Date.now() < state.circuitOpenUntil,
      lastReply: state.lastReply,
    };
  }
  const anyRoute = Array.from(sessionStates.values())[0];
  return {
    modelReady: Boolean(anyRoute?.isReady && anyRoute?.child),
    isStarting: Array.from(sessionStates.values()).some((s) => s.isStarting),
    pendingRequests: pendingRequestsTotal,
    maxPendingRequests: MAX_PENDING_REQUESTS,
    maxPendingRequestsPerRoute: MAX_PENDING_REQUESTS_PER_ROUTE,
    queueAvailable: pendingRequestsTotal < MAX_PENDING_REQUESTS,
    circuitOpenUntil: anyRoute?.circuitOpenUntil || 0,
    circuitOpen: Array.from(sessionStates.values()).some((s) => Date.now() < s.circuitOpenUntil),
    lastReply: anyRoute?.lastReply || "",
    routes: routeStatuses,
    router: ROUTER.getStatus(),
  };
}

function getModelRoute(prompt, metadata = {}) {
  return ROUTER.resolveRoute({ prompt, metadata });
}

startSession({ route: "default", modelPath: DEFAULT_MODEL_PATH, reason: "startup_default" }).catch((err) => {
  console.error("❌ Initial model startup failed:", err.message);
});

module.exports = { sendStream, send, getRuntimeStatus, getModelRoute };

