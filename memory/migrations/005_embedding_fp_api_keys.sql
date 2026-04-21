-- Chunk embedding provenance + scoped API keys (hashed)

ALTER TABLE chunks ADD COLUMN embedding_fp TEXT;

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (5);
