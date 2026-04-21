const { getDb } = require("./db");

const RETENTION_DAYS_EVENTS = Number(process.env.VERA_MEMORY_RETENTION_DAYS_EVENTS || 0);
const RETENTION_DAYS_CHUNKS = Number(process.env.VERA_MEMORY_RETENTION_DAYS_CHUNKS || 0);

/**
 * Deletes old events and orphaned chunks past optional age thresholds.
 * Summarization of deleted episodes is a stub (logged only) until a summarizer is wired.
 */
function applyRetentionPolicy() {
  const db = getDb();
  const now = Date.now();
  let deletedEvents = 0;
  let deletedChunks = 0;

  if (RETENTION_DAYS_EVENTS > 0) {
    const cutoff = now - RETENTION_DAYS_EVENTS * 86400000;
    const rows = db.prepare(`SELECT id FROM events WHERE created_at < ?`).all(cutoff);
    const delChunks = db.prepare(`DELETE FROM chunks WHERE event_id = ?`);
    const delEv = db.prepare(`DELETE FROM events WHERE id = ?`);
    const tx = db.transaction(() => {
      for (const r of rows) {
        delChunks.run(r.id);
        delEv.run(r.id);
        deletedEvents += 1;
      }
    });
    tx();
    if (deletedEvents > 0) {
      console.log(`🧹 Retention: removed ${deletedEvents} old event(s) (>${RETENTION_DAYS_EVENTS}d).`);
      console.log("ℹ️ Episode summarization stub: no summary event written (configure summarizer to enable).");
    }
  }

  if (RETENTION_DAYS_CHUNKS > 0) {
    const cutoff = now - RETENTION_DAYS_CHUNKS * 86400000;
    const res = db.prepare(`DELETE FROM chunks WHERE created_at < ?`).run(cutoff);
    deletedChunks = res.changes;
    if (deletedChunks > 0) {
      console.log(`🧹 Retention: removed ${deletedChunks} old chunk(s) (>${RETENTION_DAYS_CHUNKS}d).`);
    }
  }

  return { deletedEvents, deletedChunks };
}

module.exports = { applyRetentionPolicy };
