const fs = require("fs");
const path = require("path");
const { getDb, getDbPath } = require("./db");

function exportSnapshotJson() {
  const db = getDb();
  const beliefs = db.prepare(`SELECT * FROM beliefs WHERE valid_to IS NULL ORDER BY valid_from DESC`).all();
  const events = db.prepare(`SELECT * FROM events ORDER BY created_at DESC LIMIT 5000`).all();
  const chunks = db.prepare(`SELECT id, session_id, source, text, metadata, created_at FROM chunks ORDER BY created_at DESC LIMIT 10000`).all();
  const entities = db.prepare(`SELECT * FROM entities`).all();

  return {
    exportedAt: new Date().toISOString(),
    dbPath: getDbPath(),
    beliefs,
    entities,
    events,
    chunks,
  };
}

function writeExportFile(outPath) {
  const data = exportSnapshotJson();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
  return outPath;
}

module.exports = { exportSnapshotJson, writeExportFile };
