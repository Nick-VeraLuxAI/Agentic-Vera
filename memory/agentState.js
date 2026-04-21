const { getDb } = require("./db");
const { withMemoryLock } = require("./storage");

function getSessionState(sessionId) {
  const sid = String(sessionId || "default");
  const row = getDb().prepare(`SELECT * FROM agent_session_state WHERE session_id = ?`).get(sid);
  return row || null;
}

async function upsertSessionState(sessionId, fields = {}) {
  return withMemoryLock(async () => {
    const db = getDb();
    const sid = String(sessionId || "default");
    const now = Date.now();
    const existing = db.prepare(`SELECT session_id FROM agent_session_state WHERE session_id = ?`).get(sid);
    const goal_text = fields.goal_text !== undefined ? fields.goal_text : null;
    const plan_json = fields.plan_json !== undefined ? fields.plan_json : null;
    const status = fields.status !== undefined ? fields.status : "active";
    const step_index = fields.step_index !== undefined ? Number(fields.step_index) : 0;

    if (existing) {
      const cur = db.prepare(`SELECT * FROM agent_session_state WHERE session_id = ?`).get(sid);
      db.prepare(
        `UPDATE agent_session_state SET goal_text = ?, plan_json = ?, status = ?, step_index = ?, updated_at = ? WHERE session_id = ?`
      ).run(
        goal_text !== null ? goal_text : cur.goal_text,
        plan_json !== null ? plan_json : cur.plan_json,
        status,
        Number.isFinite(step_index) ? step_index : cur.step_index,
        now,
        sid
      );
    } else {
      db.prepare(
        `INSERT INTO agent_session_state (session_id, goal_text, plan_json, status, step_index, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sid, goal_text || "", plan_json || "", status, step_index, now);
    }
  });
}

async function clearSessionState(sessionId) {
  return withMemoryLock(async () => {
    const sid = String(sessionId || "default");
    getDb().prepare(`DELETE FROM agent_session_state WHERE session_id = ?`).run(sid);
  });
}

module.exports = {
  getSessionState,
  upsertSessionState,
  clearSessionState,
};
