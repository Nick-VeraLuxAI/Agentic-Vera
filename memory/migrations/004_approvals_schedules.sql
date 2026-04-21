-- Human approval queue (writes) + cron-like schedules for webhooks/worker

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY NOT NULL,
  tool TEXT NOT NULL,
  args_json TEXT NOT NULL,
  run_id TEXT,
  task_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status);

CREATE TABLE IF NOT EXISTS agent_schedules (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  interval_ms INTEGER NOT NULL,
  task_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedules_next ON agent_schedules(next_run_at, enabled);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (4);
