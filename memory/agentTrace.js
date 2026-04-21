const crypto = require("crypto");
const { getDb } = require("./db");
const { withMemoryLock } = require("./storage");

function startRun({ taskId, sessionId }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO agent_runs (id, task_id, session_id, status, started_at, trace_json) VALUES (?, ?, ?, 'running', ?, '[]')`
    )
    .run(id, taskId || null, String(sessionId || "default"), now);
  return id;
}

async function appendEvent(runId, event) {
  return withMemoryLock(async () => {
    const db = getDb();
    const row = db.prepare(`SELECT trace_json FROM agent_runs WHERE id = ?`).get(runId);
    if (!row) return false;
    const arr = JSON.parse(row.trace_json || "[]");
    arr.push({ ts: Date.now(), ...event });
    db.prepare(`UPDATE agent_runs SET trace_json = ? WHERE id = ?`).run(JSON.stringify(arr), runId);
    return true;
  });
}

async function completeRun(runId, status, error = null) {
  return withMemoryLock(async () => {
    getDb()
      .prepare(`UPDATE agent_runs SET status = ?, ended_at = ?, error = ? WHERE id = ?`)
      .run(status, Date.now(), error || null, runId);
  });
}

async function saveCheckpoint(runId, checkpoint) {
  return withMemoryLock(async () => {
    const db = getDb();
    const row = db.prepare(`SELECT id FROM agent_runs WHERE id = ?`).get(runId);
    if (!row) return false;
    db.prepare(`UPDATE agent_runs SET checkpoint_json = ? WHERE id = ?`).run(JSON.stringify(checkpoint), runId);
    return true;
  });
}

function getCheckpoint(runId) {
  const row = getDb().prepare(`SELECT checkpoint_json FROM agent_runs WHERE id = ?`).get(runId);
  if (!row || !row.checkpoint_json) return null;
  try {
    return JSON.parse(row.checkpoint_json);
  } catch (_e) {
    return null;
  }
}

function getRun(runId) {
  return getDb().prepare(`SELECT * FROM agent_runs WHERE id = ?`).get(runId) || null;
}

function getRunByTaskId(taskId) {
  return getDb().prepare(`SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1`).get(taskId) || null;
}

module.exports = {
  startRun,
  appendEvent,
  completeRun,
  saveCheckpoint,
  getCheckpoint,
  getRun,
  getRunByTaskId,
};
