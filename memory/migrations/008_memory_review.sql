-- Human review queue for potentially conflicting beliefs

ALTER TABLE beliefs ADD COLUMN review_flag INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_beliefs_review ON beliefs(review_flag) WHERE review_flag != 0;

INSERT OR IGNORE INTO schema_migrations (version) VALUES (8);
