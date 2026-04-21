const crypto = require("crypto");
const { getDb } = require("./db");

function hashRawKey(rawKey) {
  const pepper = String(process.env.VERA_API_KEY_PEPPER || "").trim();
  return crypto.createHash("sha256").update(`${pepper}\n${String(rawKey)}`).digest("hex");
}

/**
 * @returns {string[]|null}
 */
function lookupScopesByRawKey(rawKey) {
  const h = hashRawKey(rawKey);
  let row;
  try {
    row = getDb().prepare(`SELECT scopes, revoked_at FROM api_keys WHERE key_hash = ?`).get(h);
  } catch (_e) {
    return null;
  }
  if (!row || row.revoked_at != null) return null;
  try {
    const scopes = JSON.parse(row.scopes);
    return Array.isArray(scopes) ? scopes.map(String) : null;
  } catch (_e) {
    return null;
  }
}

function addKey(rawKey, label, scopes) {
  const db = getDb();
  const id = crypto.randomUUID();
  const h = hashRawKey(rawKey);
  const now = Date.now();
  const scopesJson = JSON.stringify(Array.isArray(scopes) ? scopes : ["memory"]);
  db.prepare(
    `INSERT INTO api_keys (id, key_hash, label, scopes, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)`
  ).run(id, h, label || null, scopesJson, now);
  return id;
}

function revokeKeyById(id) {
  const db = getDb();
  const r = db.prepare(`UPDATE api_keys SET revoked_at = ? WHERE id = ?`).run(Date.now(), String(id));
  return r.changes > 0;
}

function listKeys() {
  try {
    return getDb()
      .prepare(`SELECT id, label, scopes, created_at, revoked_at FROM api_keys ORDER BY created_at DESC`)
      .all();
  } catch (_e) {
    return [];
  }
}

function hasActiveKeys() {
  try {
    const row = getDb().prepare(`SELECT COUNT(*) as c FROM api_keys WHERE revoked_at IS NULL`).get();
    return row && row.c > 0;
  } catch (_e) {
    return false;
  }
}

module.exports = {
  hashRawKey,
  lookupScopesByRawKey,
  addKey,
  revokeKeyById,
  listKeys,
  hasActiveKeys,
};
