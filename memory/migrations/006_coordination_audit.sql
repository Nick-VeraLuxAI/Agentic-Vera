-- Multi-agent coordination bus + append-only audit trail

CREATE TABLE IF NOT EXISTS agent_coordination_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  goal_summary TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_coordination_messages (
  id TEXT PRIMARY KEY NOT NULL,
  coord_id TEXT NOT NULL,
  from_role TEXT,
  to_role TEXT,
  run_id TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (coord_id) REFERENCES agent_coordination_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_coord_msgs_coord ON agent_coordination_messages(coord_id, created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  ts INTEGER NOT NULL,
  actor_type TEXT,
  actor_id TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  meta_json TEXT,
  request_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (6);
