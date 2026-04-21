-- Durable checkpoints + episodic "lessons" for long-horizon agent runs

ALTER TABLE agent_runs ADD COLUMN checkpoint_json TEXT;

CREATE TABLE IF NOT EXISTS agent_episodes (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  step_index INTEGER,
  kind TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_episodes_run ON agent_episodes(run_id);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (3);
