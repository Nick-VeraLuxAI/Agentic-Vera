const path = require("path");

/**
 * Multi-route local GGUF routing: explicit route map + optional keyword rules + metadata hints.
 *
 * - VERA_MODEL_PATH: default GGUF when routes map omits "default"
 * - VERA_MODEL_ROUTES: JSON object { "default": "models/a.gguf", "coder": "models/b.gguf", ... }
 * - VERA_ROUTE_KEYWORDS: JSON { "coder": ["code", "debug"], "legal": ["contract"] } (case-insensitive substring match)
 * - VERA_ROUTE_DEFAULT: route id when no keyword matches (default "default")
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

function scoreRouteForPrompt(prompt, routes, keywordRules) {
  const text = String(prompt || "").toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const [routeId, keywords] of Object.entries(keywordRules)) {
    if (!routes[routeId]) continue;
    let score = 0;
    for (const kw of keywords) {
      if (kw && text.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = routeId;
    }
  }
  if (best && bestScore > 0) return { route: best, reason: "keyword_match", score: bestScore };
  return null;
}

function createModelRouter() {
  const routes = buildRoutesMap();
  const keywordRules = buildKeywordRules();
  const defaultRouteId = String(process.env.VERA_ROUTE_DEFAULT || "default").trim() || "default";

  function resolveRoute({ prompt = "", metadata = {} } = {}) {
    const preferred =
      metadata.preferredRoute ||
      metadata.routeHint ||
      (metadata.headers && metadata.headers["x-model-route"]) ||
      "";

    const prefId = String(preferred || "").trim().toLowerCase();
    if (prefId && routes[prefId]) {
      return {
        route: prefId,
        modelPath: routes[prefId],
        reason: "preferred_route",
        description: "Client or metadata selected route",
      };
    }

    const keywordHit = scoreRouteForPrompt(prompt, routes, keywordRules);
    if (keywordHit && routes[keywordHit.route]) {
      return {
        route: keywordHit.route,
        modelPath: routes[keywordHit.route],
        reason: keywordHit.reason,
        description: `Keyword score ${keywordHit.score}`,
      };
    }

    const fallback = routes[defaultRouteId] ? defaultRouteId : Object.keys(routes)[0] || "default";
    const modelPath = routes[fallback] || routes.default;
    return {
      route: fallback,
      modelPath,
      reason: routes[fallback] ? "default_route" : "single_model",
      description: "No stronger match; using default route",
    };
  }

  function getStatus() {
    const ids = Object.keys(routes);
    return {
      mode: ids.length > 1 ? "multi" : "single",
      defaultRoute: defaultRouteId,
      routes: Object.fromEntries(ids.map((id) => [id, routes[id]])),
      keywordRoutes: Object.keys(keywordRules),
    };
  }

  return {
    resolveRoute,
    getStatus,
  };
}

module.exports = { createModelRouter };
