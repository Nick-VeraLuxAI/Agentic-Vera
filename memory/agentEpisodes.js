const crypto = require("crypto");
const { getDb } = require("./db");
const { withMemoryLock } = require("./storage");

const EPISODE_TAG = /\[EPISODE:\s*([\s\S]*?)\]/i;

function extractEpisodeFromReply(reply) {
  const m = String(reply || "").match(EPISODE_TAG);
  if (!m) return null;
  return m[1].trim().slice(0, 8000);
}

async function recordEpisode(runId, stepIndex, content, kind = "lesson") {
  if (!content || !String(content).trim()) return null;
  const id = crypto.randomUUID();
  await withMemoryLock(async () => {
    getDb()
      .prepare(
        `INSERT INTO agent_episodes (id, run_id, step_index, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, runId, stepIndex != null ? Number(stepIndex) : null, String(kind || "lesson"), String(content).trim(), Date.now());
  });
  return id;
}

function listEpisodesForRun(runId) {
  return getDb()
    .prepare(`SELECT * FROM agent_episodes WHERE run_id = ? ORDER BY created_at ASC`)
    .all(runId);
}

module.exports = {
  extractEpisodeFromReply,
  recordEpisode,
  listEpisodesForRun,
};
