-- Agent session goals + run traces (orchestrated agent runs)

CREATE TABLE IF NOT EXISTS agent_session_state (
  session_id TEXT PRIMARY KEY NOT NULL,
  goal_text TEXT,
  plan_json TEXT,
  status TEXT,
  step_index INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  trace_json TEXT NOT NULL DEFAULT '[]',
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);
