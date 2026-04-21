const crypto = require("crypto");
const { getDb } = require("./db");
const { withMemoryLock } = require("./storage");

function createRequest({ tool, args, runId = null, taskId = null }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO approval_requests (id, tool, args_json, run_id, task_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(id, String(tool), JSON.stringify(args || {}), runId, taskId, now);
  return id;
}

function getRequest(id) {
  return getDb().prepare(`SELECT * FROM approval_requests WHERE id = ?`).get(id) || null;
}

function listPending(limit = 50) {
  return getDb()
    .prepare(`SELECT * FROM approval_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`)
    .all(limit);
}

async function approve(id, note = "") {
  return withMemoryLock(async () => {
    const row = getRequest(id);
    if (!row || row.status !== "pending") return false;
    getDb()
      .prepare(`UPDATE approval_requests SET status = 'approved', resolved_at = ?, resolution_note = ? WHERE id = ?`)
      .run(Date.now(), note || null, id);
    return true;
  });
}

async function reject(id, note = "") {
  return withMemoryLock(async () => {
    const row = getRequest(id);
    if (!row || row.status !== "pending") return false;
    getDb()
      .prepare(`UPDATE approval_requests SET status = 'rejected', resolved_at = ?, resolution_note = ? WHERE id = ?`)
      .run(Date.now(), note || null, id);
    return true;
  });
}

function isApproved(id) {
  const row = getRequest(id);
  return row && row.status === "approved";
}

/** Mark approved request consumed (one-time use for writes). */
async function consumeIfApproved(id) {
  return withMemoryLock(async () => {
    const row = getRequest(id);
    if (!row || row.status !== "approved") return false;
    getDb()
      .prepare(`UPDATE approval_requests SET status = 'consumed', resolved_at = ? WHERE id = ?`)
      .run(Date.now(), id);
    return true;
  });
}

module.exports = {
  createRequest,
  getRequest,
  listPending,
  approve,
  reject,
  isApproved,
  consumeIfApproved,
};
