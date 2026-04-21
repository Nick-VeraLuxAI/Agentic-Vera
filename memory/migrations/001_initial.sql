-- Persistent memory: events, entities, beliefs (with supersession), chunks (RAG)

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL DEFAULT 'subject',
  label TEXT NOT NULL,
  normalized_key TEXT NOT NULL UNIQUE,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

CREATE TABLE IF NOT EXISTS beliefs (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  entity_id TEXT,
  subject_key TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  superseded_by TEXT,
  source_event_id TEXT,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (superseded_by) REFERENCES beliefs(id),
  FOREIGN KEY (source_event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_beliefs_session ON beliefs(session_id);
CREATE INDEX IF NOT EXISTS idx_beliefs_subject ON beliefs(subject_key);
CREATE INDEX IF NOT EXISTS idx_beliefs_valid ON beliefs(valid_to);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,
  text TEXT NOT NULL,
  metadata TEXT,
  embedding TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_chunks_created ON chunks(created_at);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
