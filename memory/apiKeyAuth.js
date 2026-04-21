const { lookupScopesByRawKey, hasActiveKeys } = require("./apiKeyStore");

function adminKey() {
  return String(process.env.VERA_ADMIN_API_KEY || "").trim();
}

function memoryKey() {
  return String(process.env.VERA_MEMORY_API_KEY || "").trim();
}

function getProvidedApiKey(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  const headerKey = String(req.headers["x-api-key"] || "").trim();
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  return bearer || headerKey || "";
}

/**
 * @returns {{ ok: boolean, scopes: Set<string>, source?: string }}
 */
function resolveApiAccess(req) {
  const key = getProvidedApiKey(req);
  if (!key) {
    return { ok: false, scopes: new Set() };
  }
  const ak = adminKey();
  const mk = memoryKey();
  if (ak && key === ak) {
    return { ok: true, scopes: new Set(["admin", "memory", "tasks", "hooks"]), source: "env_admin" };
  }
  if (mk && key === mk) {
    return { ok: true, scopes: new Set(["memory"]), source: "env_memory" };
  }
  const fromDb = lookupScopesByRawKey(key);
  if (fromDb && fromDb.length) {
    return { ok: true, scopes: new Set(fromDb), source: "sqlite" };
  }
  return { ok: false, scopes: new Set() };
}

function hasScope(access, need) {
  if (!access || !access.ok) return false;
  if (access.scopes.has("admin")) return true;
  return access.scopes.has(need);
}

function matchesAdminApiKey(req) {
  const ak = adminKey();
  if (!ak) {
    if (!hasActiveKeys()) return true;
    return hasScope(resolveApiAccess(req), "admin");
  }
  return hasScope(resolveApiAccess(req), "admin");
}

function memoryOpenByDefault() {
  return !adminKey() && !memoryKey();
}

function adminOpenByDefault() {
  return !adminKey();
}

module.exports = {
  getProvidedApiKey,
  resolveApiAccess,
  hasScope,
  matchesAdminApiKey,
  memoryOpenByDefault,
  adminOpenByDefault,
};
