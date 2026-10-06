const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const memory = require("../memory/memoryController");
const retrievalMemory = require("../memory/retrievalMemory");
const agentState = require("../memory/agentState");
const { createModelRouter } = require("./modelRouter");
const { runTool, MAX_SYNTHESIS_JSON_CHARS } = require("../tools/runner");
const { REGISTERED_NAMES } = require("../tools/manifest");
const { formatToolAwarenessBlock, formatToolProtocolBlock } = require("../tools/manifest");
const { parseToolCalls, stripToolMarkers } = require("./toolProtocol");
const { loadModeBlock, toolIterationsForMode } = require("./chatMode");
const { getRoleBlock } = require("./multiAgentRoles");
const { ApprovalPauseError } = require("./agentErrors");

const DEFAULT_MODEL_PATH = process.env.VERA_MODEL_PATH || path.join(__dirname, "../models/JSON-llama3-fp16.Q4_K_M.gguf");
const MAIN_BINARY = path.join(__dirname, "../build/bin/llama-cli");
const MAX_PENDING_REQUESTS = Number(process.env.VERA_MAX_PENDING_REQUESTS || 20);
const MAX_PENDING_REQUESTS_PER_ROUTE = Number(process.env.VERA_MAX_PENDING_REQUESTS_PER_ROUTE || MAX_PENDING_REQUESTS);
const REQUEST_TIMEOUT_MS = Number(process.env.VERA_REQUEST_TIMEOUT_MS || 90000);
const MAX_RESTARTS_PER_WINDOW = Number(process.env.VERA_MAX_RESTARTS_PER_WINDOW || 5);
const RESTART_WINDOW_MS = Number(process.env.VERA_RESTART_WINDOW_MS || 60000);
const CIRCUIT_OPEN_MS = Number(process.env.VERA_CIRCUIT_OPEN_MS || 30000);
const MAX_HISTORY_TURNS = Number(process.env.VERA_SHORT_TERM_HISTORY_TURNS || 4);
const MAX_TOOL_ITERATIONS = Number(process.env.VERA_TOOL_MAX_ITERATIONS || 4);
const TOOL_LOOP_MAX_MS = Number(process.env.VERA_TOOL_LOOP_MAX_MS || 120000);
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
    confidence: typeof route.confidence === "number" ? route.confidence : undefined,
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
  return `${formatToolAwarenessBlock()}\n\n${formatToolProtocolBlock()}`;
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
  const {
    retrievedContexts = [],
    previousHistory = [],
    relevantFacts = [],
    agentGoal,
    agentPlan,
    interactionMode,
    agentRole,
    coordinationBlock = "",
  } = options;
  const modeBlock = interactionMode ? `${loadModeBlock(interactionMode)}\n\n` : "";
  const roleBlock = (() => {
    const r = getRoleBlock(agentRole);
    return r.text ? `${r.text}\n\n` : "";
  })();
  const coord =
    coordinationBlock && String(coordinationBlock).trim()
      ? `${String(coordinationBlock).trim()}\n\n`
      : "";
  const historyBlock = previousHistory.length
    ? `Recent conversation:\n${previousHistory.map((m) => `${m.role}: ${m.content}`).join("\n")}\n\n`
    : "";
  const contextBlock = retrievedContexts.length
    ? `Relevant prior context (cite sources as [n] in your answer when used):\n${retrievedContexts
        .map((c, idx) => {
          const n = idx + 1;
          const cite = c.chunkId ? `[${n}] id=${c.chunkId}` : `[${n}]`;
          return `(${n}) ${cite} [${c.source}] ${c.text}`;
        })
        .join("\n\n")}\n\n`
    : "";
  const factsBlock = relevantFacts.length
    ? `Potentially relevant known facts:\n${relevantFacts
        .map((f) => `- ${f.subject || f.value || f.original || JSON.stringify(f)}`)
        .join("\n")}\n\n`
    : "";
  const agentBlock =
    agentGoal && String(agentGoal).trim()
      ? `Active goal:\n${String(agentGoal).trim()}\n${agentPlan && String(agentPlan).trim() ? `Plan / notes:\n${String(agentPlan).trim()}\n` : ""}\n`
      : "";
  return `${modeBlock}${roleBlock}${coord}${historyBlock}${factsBlock}${contextBlock}${agentBlock}${userInput}`.trim();
}

function truncateForSynthesis(obj) {
  const raw = JSON.stringify(obj, null, 2);
  const max = Number(MAX_SYNTHESIS_JSON_CHARS) || 24000;
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}\n… [truncated ${raw.length - max} chars for safety]`;
}

async function runToolLoop(basePrompt, firstReply, loopOpts = {}) {
  const runOneTool = typeof loopOpts.runToolImpl === "function" ? loopOpts.runToolImpl : runTool;
  const loopMaxMs = Number(loopOpts.loopMaxMs ?? TOOL_LOOP_MAX_MS) || TOOL_LOOP_MAX_MS;
  const maxIterations = Number(loopOpts.maxIterations ?? MAX_TOOL_ITERATIONS) || MAX_TOOL_ITERATIONS;
  const deadline = Date.now() + loopMaxMs;

  let workingReply = String(firstReply || "");
  for (let step = 0; step < maxIterations; step += 1) {
    if (Date.now() > deadline) {
      console.warn("⚠️ Tool loop stopped: wall-clock budget exceeded.");
      break;
    }
    const toolCalls = parseToolCalls(workingReply);
    if (!toolCalls.length) break;

    const toolResults = [];
    for (const call of toolCalls) {
      const name = String(call.name || "").trim();
      if (!REGISTERED_NAMES.has(name)) {
        console.warn(`⚠️ Ignoring unknown tool in model output: ${name}`);
        toolResults.push({
          name,
          result: { ok: false, error: `Unknown or disallowed tool: ${name}` },
        });
        continue;
      }
      try {
        const result = await runOneTool(name, call.arguments || {}, loopOpts.toolCtx || {});
        toolResults.push({ name, result });
      } catch (err) {
        if (err instanceof ApprovalPauseError || err.code === "APPROVAL_PAUSE") {
          throw err;
        }
        const msg = err && err.message ? err.message : String(err);
        console.error(`❌ Tool '${name}' rejected:`, msg);
        toolResults.push({
          name,
          result: { ok: false, error: msg },
        });
      }
    }

    const resultsPayload = truncateForSynthesis(toolResults);
    const synthesisPrompt = `
${basePrompt}

Tool execution results:
${resultsPayload}

Use tool results to answer the user. Do not emit tool call payloads in your final answer.
`.trim();

    try {
      const inferResult = await runOneTool("local_infer", { prompt: synthesisPrompt }, loopOpts.toolCtx || {});
      if (!inferResult || !inferResult.ok) {
        workingReply = cleanReply(
          `Could not synthesize an answer after tools: ${inferResult?.error || "inference failed"}.`
        );
        break;
      }
      workingReply = cleanReply(inferResult.reply || "");
    } catch (err) {
      if (err instanceof ApprovalPauseError || err.code === "APPROVAL_PAUSE") {
        throw err;
      }
      console.error("❌ Synthesis local_infer failed:", err.message);
      workingReply = cleanReply(
        "I ran the tools but could not synthesize a follow-up answer. Check logs for details."
      );
      break;
    }
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
  const resolved = ROUTER.resolveRoute({ prompt, metadata: options.metadata || {} });
  const explicitPath = options.modelPath;
  if (explicitPath) {
    return normalizeRoute({
      route: resolved.route || "default",
      modelPath: explicitPath,
      reason: "explicit_model_path",
      description: resolved.description,
    });
  }
  return normalizeRoute({
    route: resolved.route || "default",
    modelPath: resolved.modelPath,
    reason: resolved.reason,
    description: resolved.description,
    confidence: resolved.confidence,
  });
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
    const trimmed = [...previousHistory, { role: "user", content: userMessage }].slice(-MAX_HISTORY_TURNS * 2);

    const unified = await memory.searchUnified(userMessage, sessionId, {
      topK: Number(process.env.VERA_RETRIEVAL_TOP_K || 4),
      maxChars: Number(process.env.VERA_RETRIEVAL_MAX_CONTEXT_CHARS || 2800),
    });
    const relevantFacts = unified.beliefs;
    const retrievedContexts = unified.chunks;

    let coordinationBlock = "";
    if (options.coordinationId) {
      try {
        const { formatPromptBlock } = require("../memory/agentCoordination");
        coordinationBlock = formatPromptBlock(options.coordinationId);
      } catch (_e) {
        coordinationBlock = "";
      }
    }

    let agentGoal = options.agentGoal;
    let agentPlan = options.agentPlan;
    if (agentGoal === undefined || agentPlan === undefined) {
      try {
        const row = agentState.getSessionState(sessionId);
        if (row && row.goal_text) {
          if (agentGoal === undefined) agentGoal = row.goal_text;
          if (agentPlan === undefined) agentPlan = row.plan_json || "";
        }
      } catch (_e) {
        /* DB not ready in some tests */
      }
    }

    const prompt = buildPrompt(promptSource, {
      previousHistory,
      retrievedContexts,
      relevantFacts,
      agentGoal,
      agentPlan,
      interactionMode: options.interactionMode,
      agentRole: options.agentRole,
      coordinationBlock,
    });
    state.child.stdin.write(prompt + "\n");

    return new Promise((resolve, reject) => {
      let fullOutput = "";
      let settled = false;
      const timeout = setTimeout(() => {
        finishReply(fullOutput || "Request timeout.");
      }, REQUEST_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        state.child.stdout.off("data", onData);
        controller.cancel = undefined;
      };

      const finishReply = async (output) => {
        if (settled) return;

        const initialReply = cleanReply(output);
        const toolCtx = {
          modelPath: state.route.modelPath,
          route: state.route.route,
          interactionMode: options.interactionMode,
          agentRole: options.agentRole,
          runId: options.toolCtx?.runId,
          taskId: options.toolCtx?.taskId,
          requireHumanApproval: options.toolCtx?.requireHumanApproval,
          coordinationId: options.coordinationId,
        };
        const modeIterations = options.interactionMode
          ? toolIterationsForMode(options.interactionMode)
          : MAX_TOOL_ITERATIONS;
        let safeReply;
        try {
          safeReply = await runToolLoop(prompt, initialReply, {
            runToolImpl: options.runToolImpl,
            loopMaxMs: options.toolLoopMaxMs ?? TOOL_LOOP_MAX_MS,
            maxIterations: options.toolMaxIterations ?? modeIterations,
            toolCtx,
          });
        } catch (err) {
          if (err instanceof ApprovalPauseError || err.code === "APPROVAL_PAUSE") {
            settled = true;
            cleanup();
            reject(err);
            return;
          }
          settled = true;
          cleanup();
          resolve(cleanReply(`Error during tool loop: ${err.message || err}`));
          return;
        }

        settled = true;
        cleanup();

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
        if (settled) return;
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

module.exports = {
  sendStream,
  send,
  getRuntimeStatus,
  getModelRoute,
  parseToolCalls,
  stripToolMarkers,
  buildPrompt,
  runToolLoop,
};

