const crypto = require("crypto");
const { getDb } = require("./db");

const ENABLED = String(process.env.VERA_AUDIT_LOG_ENABLED || "true").toLowerCase() !== "false";

const GENESIS = crypto.createHash("sha256").update("").digest("hex");

function canonicalRow(prevHash, id, ts, actorType, actorId, action, resource, metaJson, requestId) {
  return `${prevHash}|${id}|${ts}|${actorType || ""}|${actorId || ""}|${action}|${resource || ""}|${metaJson || ""}|${requestId || ""}`;
}

function rowHashFrom(prevHash, id, ts, actorType, actorId, action, resource, metaJson, requestId) {
  return crypto.createHash("sha256").update(canonicalRow(prevHash, id, ts, actorType, actorId, action, resource, metaJson, requestId)).digest("hex");
}

let backfillAttempted = false;

function backfillChainIfNeeded() {
  if (backfillAttempted) return;
  backfillAttempted = true;
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM audit_events ORDER BY rowid ASC`).all();
    if (!rows.length) return;
    let prev = GENESIS;
    const upd = db.prepare(
      `UPDATE audit_events SET chain_prev_hash = ?, row_integrity_hash = ? WHERE id = ?`
    );
    const tx = db.transaction(() => {
      for (const r of rows) {
        if (r.row_integrity_hash) {
          prev = r.row_integrity_hash;
          continue;
        }
        const ph = prev;
        const h = rowHashFrom(ph, r.id, r.ts, r.actor_type, r.actor_id, r.action, r.resource, r.meta_json, r.request_id);
        upd.run(ph, h, r.id);
        prev = h;
      }
    });
    tx();
  } catch (_e) {
    /* columns may not exist on very old DBs */
  }
}

function append(entry) {
  if (!ENABLED) return null;
  try {
    backfillChainIfNeeded();
    const db = getDb();
    const id = crypto.randomUUID();
    const ts = Date.now();
    const actorType = entry.actorType != null ? String(entry.actorType) : "api";
    const actorId = entry.actorId != null ? String(entry.actorId) : "";
    const action = String(entry.action || "unknown").slice(0, 200);
    const resource = entry.resource != null ? String(entry.resource).slice(0, 500) : "";
    const metaJson = entry.meta != null ? JSON.stringify(entry.meta).slice(0, 8000) : "";
    const requestId = entry.requestId != null ? String(entry.requestId) : "";

    const last = db.prepare(`SELECT row_integrity_hash FROM audit_events ORDER BY rowid DESC LIMIT 1`).get();
    const prevHash = (last && last.row_integrity_hash) || GENESIS;
    const chainPrev = prevHash;
    const integrity = rowHashFrom(chainPrev, id, ts, actorType, actorId, action, resource, metaJson, requestId);

    db.prepare(
      `INSERT INTO audit_events (id, ts, actor_type, actor_id, action, resource, meta_json, request_id, chain_prev_hash, row_integrity_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, ts, actorType, actorId, action, resource, metaJson, requestId, chainPrev, integrity);
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

function verifyChain() {
  try {
    backfillChainIfNeeded();
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM audit_events ORDER BY rowid ASC`).all();
    let prev = GENESIS;
    const mismatches = [];
    for (const r of rows) {
      const expected = rowHashFrom(prev, r.id, r.ts, r.actor_type, r.actor_id, r.action, r.resource, r.meta_json, r.request_id);
      if (r.row_integrity_hash && r.row_integrity_hash !== expected) {
        mismatches.push({ id: r.id, expected, stored: r.row_integrity_hash });
      }
      prev = expected;
    }
    return {
      ok: mismatches.length === 0,
      rowCount: rows.length,
      mismatches,
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err), rowCount: 0, mismatches: [] };
  }
}

module.exports = {
  append,
  listSince,
  verifyChain,
  ENABLED,
};
