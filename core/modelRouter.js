const path = require("path");

/**
 * Multi-route local GGUF routing: explicit route map + optional keyword rules + metadata hints.
 *
 * - VERA_MODEL_PATH: default GGUF when routes map omits "default"
 * - VERA_MODEL_ROUTES: JSON object { "default": "models/a.gguf", "coder": "models/b.gguf", ... }
 * - VERA_ROUTE_KEYWORDS: JSON { "coder": ["code", "debug"], "legal": ["contract"] } (case-insensitive substring match)
 * - VERA_ROUTE_DEFAULT: route id when no keyword matches (default "default")
 * - VERA_ROUTE_FALLBACK_CHAIN: JSON array of route ids to try when the chosen route has no mapped model (e.g. ["coder","default"])
 * - VERA_ROUTE_CONFIDENCE_MIN + VERA_ROUTE_LOW_CONFIDENCE_ROUTE: if resolved confidence is below min, switch to the given route when present
 */

function resolveRepoRoot() {
  return path.join(__dirname, "..");
}

function parseJsonEnv(raw, label) {
  if (!raw || !String(raw).trim()) return null;
  try {
    return JSON.parse(String(raw));
  } catch (e) {
    console.warn(`⚠️ ${label} is not valid JSON; ignoring.`, e.message);
    return null;
  }
}

function normalizeModelPath(p) {
  const s = String(p || "").trim();
  if (!s) return null;
  return path.isAbsolute(s) ? s : path.resolve(resolveRepoRoot(), s);
}

function buildRoutesMap() {
  const defaultPath = normalizeModelPath(process.env.VERA_MODEL_PATH || path.join(resolveRepoRoot(), "models/JSON-llama3-fp16.Q4_K_M.gguf"));
  const fromEnv = parseJsonEnv(process.env.VERA_MODEL_ROUTES, "VERA_MODEL_ROUTES");

  const routes = {};
  if (fromEnv && typeof fromEnv === "object") {
    for (const [k, v] of Object.entries(fromEnv)) {
      const np = normalizeModelPath(v);
      if (np) routes[String(k).trim()] = np;
    }
  }
  if (!routes.default && defaultPath) {
    routes.default = defaultPath;
  }
  return routes;
}

function buildKeywordRules() {
  const raw = parseJsonEnv(process.env.VERA_ROUTE_KEYWORDS, "VERA_ROUTE_KEYWORDS");
  if (!raw || typeof raw !== "object") {
    return {
      coder: ["code", "debug", "function", "typescript", "javascript", "python", "rust", "implement", "refactor"],
      legal: ["contract", "clause", "liable", "indemnif", "terms of service", "compliance"],
      file: ["read file", "file path", "directory", "folder", "workspace"],
    };
  }
  const out = {};
  for (const [route, words] of Object.entries(raw)) {
    if (Array.isArray(words)) {
      out[String(route)] = words.map((w) => String(w).toLowerCase());
    }
  }
  return out;
}

function buildFallbackChain() {
  const raw = parseJsonEnv(process.env.VERA_ROUTE_FALLBACK_CHAIN, "VERA_ROUTE_FALLBACK_CHAIN");
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

function scoreRouteForPrompt(prompt, routes, keywordRules) {
  const text = String(prompt || "").toLowerCase();
  let best = null;
  let bestScore = 0;
  let bestMaxKw = 1;
  for (const [routeId, keywords] of Object.entries(keywordRules)) {
    if (!routes[routeId]) continue;
    let score = 0;
    for (const kw of keywords) {
      if (kw && text.includes(kw)) score += 1;
    }
    const denom = Math.max(1, keywords.length);
    if (score > bestScore) {
      bestScore = score;
      best = routeId;
      bestMaxKw = denom;
    }
  }
  if (best && bestScore > 0) {
    const confidence = Math.min(1, 0.35 + 0.65 * (bestScore / bestMaxKw));
    return { route: best, reason: "keyword_match", score: bestScore, confidence };
  }
  return null;
}

function pickRouteWithFallback(routes, primaryId, fallbackChain) {
  const tried = new Set();
  const order = [primaryId, ...fallbackChain];
  for (const id of order) {
    if (!id || tried.has(id)) continue;
    tried.add(id);
    if (routes[id]) {
      return { route: id, modelPath: routes[id], usedFallback: id !== primaryId };
    }
  }
  const fb = routes.default ? "default" : Object.keys(routes)[0];
  return fb ? { route: fb, modelPath: routes[fb], usedFallback: true } : null;
}

function createModelRouter() {
  const routes = buildRoutesMap();
  const keywordRules = buildKeywordRules();
  const defaultRouteId = String(process.env.VERA_ROUTE_DEFAULT || "default").trim() || "default";
  const fallbackChain = buildFallbackChain();
  const confMin = Number(process.env.VERA_ROUTE_CONFIDENCE_MIN || 0);
  const lowConfRoute = String(process.env.VERA_ROUTE_LOW_CONFIDENCE_ROUTE || "").trim();

  function resolveRoute({ prompt = "", metadata = {} } = {}) {
    const preferred =
      metadata.preferredRoute ||
      metadata.routeHint ||
      (metadata.headers && metadata.headers["x-model-route"]) ||
      "";

    const prefId = String(preferred || "").trim().toLowerCase();
    if (prefId && routes[prefId]) {
      const picked = pickRouteWithFallback(routes, prefId, fallbackChain);
      if (picked) {
        return {
          route: picked.route,
          modelPath: picked.modelPath,
          reason: "preferred_route",
          description: "Client or metadata selected route",
          confidence: 1,
          fallbackChain: fallbackChain.length ? fallbackChain : undefined,
        };
      }
    }

    const keywordHit = scoreRouteForPrompt(prompt, routes, keywordRules);
    let chosenRoute = defaultRouteId;
    let reason = "default_route";
    let description = "No stronger match; using default route";
    let confidence = 0.45;

    if (keywordHit && routes[keywordHit.route]) {
      chosenRoute = keywordHit.route;
      reason = keywordHit.reason;
      description = `Keyword score ${keywordHit.score}`;
      confidence = keywordHit.confidence;
    } else {
      chosenRoute = routes[defaultRouteId] ? defaultRouteId : Object.keys(routes)[0] || "default";
    }

    if (Number.isFinite(confMin) && confMin > 0 && confidence < confMin && lowConfRoute && routes[lowConfRoute]) {
      chosenRoute = lowConfRoute;
      reason = "low_confidence_fallback";
      description = `Confidence ${confidence.toFixed(3)} below ${confMin}; using ${lowConfRoute}`;
      confidence = Math.max(confidence, 0.55);
    }

    const picked = pickRouteWithFallback(routes, chosenRoute, fallbackChain);
    if (!picked) {
      return {
        route: "default",
        modelPath: routes.default,
        reason: "single_model",
        description: "No route map entries",
        confidence: 0.5,
      };
    }

    return {
      route: picked.route,
      modelPath: picked.modelPath,
      reason,
      description: picked.usedFallback ? `${description} (model fallback chain)` : description,
      confidence: Number(confidence.toFixed(4)),
      fallbackChain: fallbackChain.length ? fallbackChain : undefined,
    };
  }

  function getStatus() {
    const ids = Object.keys(routes);
    return {
      mode: ids.length > 1 ? "multi" : "single",
      defaultRoute: defaultRouteId,
      routes: Object.fromEntries(ids.map((id) => [id, routes[id]])),
      keywordRoutes: Object.keys(keywordRules),
      fallbackChain,
      confidencePolicy: {
        min: confMin || null,
        lowConfidenceRoute: lowConfRoute || null,
      },
    };
  }

  return {
    resolveRoute,
    getStatus,
  };
}

module.exports = { createModelRouter };
