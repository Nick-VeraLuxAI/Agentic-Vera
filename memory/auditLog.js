const crypto = require("crypto");
const { getDb } = require("./db");

const ENABLED = String(process.env.VERA_AUDIT_LOG_ENABLED || "true").toLowerCase() !== "false";

function append(entry) {
  if (!ENABLED) return null;
  try {
    const db = getDb();
    const id = crypto.randomUUID();
    const ts = Date.now();
    db.prepare(
      `INSERT INTO audit_events (id, ts, actor_type, actor_id, action, resource, meta_json, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      ts,
      entry.actorType != null ? String(entry.actorType) : "api",
      entry.actorId != null ? String(entry.actorId) : "",
      String(entry.action || "unknown").slice(0, 200),
      entry.resource != null ? String(entry.resource).slice(0, 500) : "",
      entry.meta != null ? JSON.stringify(entry.meta).slice(0, 8000) : "",
      entry.requestId != null ? String(entry.requestId) : ""
    );
    return id;
  } catch (_e) {
    return null;
  }
}

function listSince(sinceTs = 0, limit = 200) {
  try {
    const db = getDb();
    const lim = Math.min(2000, Math.max(1, Number(limit) || 200));
    return db
      .prepare(`SELECT * FROM audit_events WHERE ts >= ? ORDER BY ts DESC LIMIT ?`)
      .all(Number(sinceTs) || 0, lim);
  } catch (_e) {
    return [];
  }
}

module.exports = {
  append,
  listSince,
  ENABLED,
};
