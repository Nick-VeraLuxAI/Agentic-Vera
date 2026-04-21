const crypto = require("crypto");
const { getDb } = require("./db");
const { withMemoryLock } = require("./storage");

function upsertSchedule({ id, name, intervalMs, taskType, payload, enabled = true }) {
  const sid = id || crypto.randomUUID();
  const now = Date.now();
  const next = now + Math.max(1000, Number(intervalMs) || 60000);
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM agent_schedules WHERE id = ?`).get(sid);
  const payloadJson = JSON.stringify(payload || {});
  if (existing) {
    db.prepare(
      `UPDATE agent_schedules SET name = ?, interval_ms = ?, task_type = ?, payload_json = ?, enabled = ?, next_run_at = COALESCE(next_run_at, ?) WHERE id = ?`
    ).run(name || "", Number(intervalMs), String(taskType), payloadJson, enabled ? 1 : 0, next, sid);
  } else {
    db.prepare(
      `INSERT INTO agent_schedules (id, name, interval_ms, task_type, payload_json, enabled, next_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sid, name || "", Number(intervalMs), String(taskType), payloadJson, enabled ? 1 : 0, next, now);
  }
  return sid;
}

function listSchedules() {
  return getDb().prepare(`SELECT * FROM agent_schedules ORDER BY created_at DESC`).all();
}

function getDueSchedules(now = Date.now()) {
  return getDb()
    .prepare(`SELECT * FROM agent_schedules WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC`)
    .all(now);
}

async function bumpNextRun(id, intervalMs) {
  return withMemoryLock(async () => {
    const now = Date.now();
    const next = now + Math.max(1000, Number(intervalMs) || 60000);
    getDb()
      .prepare(`UPDATE agent_schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?`)
      .run(now, next, id);
  });
}

module.exports = {
  upsertSchedule,
  listSchedules,
  getDueSchedules,
  bumpNextRun,
};
