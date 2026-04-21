const crypto = require("crypto");
const { getDb } = require("./db");
const { withMemoryLock } = require("./storage");

function createSession(goalSummary = "") {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO agent_coordination_sessions (id, goal_summary, created_at) VALUES (?, ?, ?)`).run(
    id,
    String(goalSummary || "").slice(0, 2000),
    now
  );
  return id;
}

function appendMessage(coordId, fromRole, toRole, runId, body) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO agent_coordination_messages (id, coord_id, from_role, to_role, run_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(coordId),
    fromRole != null ? String(fromRole).slice(0, 64) : "",
    toRole != null ? String(toRole).slice(0, 64) : "all",
    runId != null ? String(runId) : "",
    String(body || "").slice(0, 12000),
    now
  );
  return id;
}

function listMessages(coordId, limit = 40) {
  const db = getDb();
  const lim = Math.min(200, Math.max(1, Number(limit) || 40));
  return db
    .prepare(
      `SELECT id, from_role, to_role, run_id, body, created_at FROM agent_coordination_messages WHERE coord_id = ? ORDER BY created_at ASC LIMIT ?`
    )
    .all(String(coordId), lim);
}

/**
 * Text block for prompts: shared state across concurrent agent runs with the same coord_id.
 */
function formatPromptBlock(coordId) {
  if (!coordId) return "";
  const preamble = `Multi-agent society: you share a coordination bus with other runs and roles. Use the coordination_post tool to broadcast handoffs, blockers, and decisions so parallel or follow-on agents stay aligned.\n\n`;
  const rows = listMessages(coordId, 50);
  if (!rows.length) return preamble.trim() ? `${preamble.trim()}\n` : "";
  const lines = rows.map((r) => {
    const who = [r.from_role || "?", r.to_role && r.to_role !== "all" ? `→${r.to_role}` : ""].filter(Boolean).join(" ");
    return `[${who}] run=${(r.run_id || "").slice(0, 8)}: ${r.body}`;
  });
  return `${preamble}Coordination channel (append-only log for this session):\n${lines.join("\n")}\n`;
}

module.exports = {
  createSession,
  appendMessage,
  listMessages,
  formatPromptBlock,
};
