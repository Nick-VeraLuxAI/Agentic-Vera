const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

let _db;

function getDbPath() {
  return process.env.VERA_MEMORY_DB_PATH || path.join(__dirname, "vera_memory.db");
}

function openDatabase() {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma(`busy_timeout = ${Number(process.env.VERA_SQLITE_BUSY_TIMEOUT_MS || 5000)}`);
  db.pragma("synchronous = NORMAL");
  return db;
}

function runMigrations(db) {
  let applied = new Set();
  try {
    applied = new Set(
      db
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map((r) => r.version)
    );
  } catch (_e) {
    /* schema_migrations not created yet */
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    const version = match ? Number(match[1]) : NaN;
    if (!Number.isFinite(version) || applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    db.exec(sql);
  }
}

function getDb() {
  if (!_db) {
    _db = openDatabase();
    runMigrations(_db);
    const { runLegacyImportIfNeeded } = require("./legacyImport");
    runLegacyImportIfNeeded(_db);
  }
  return _db;
}

function closeDbForTests() {
  if (_db) {
    try {
      _db.close();
    } catch (_e) {
      /* ignore */
    }
    _db = null;
  }
}

module.exports = {
  getDb,
  getDbPath,
  closeDbForTests,
};
