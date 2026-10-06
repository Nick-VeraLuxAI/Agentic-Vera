-- Tamper-evident hash chain for audit_events (row_integrity_hash links to previous row)

ALTER TABLE audit_events ADD COLUMN chain_prev_hash TEXT;
ALTER TABLE audit_events ADD COLUMN row_integrity_hash TEXT;

INSERT OR IGNORE INTO schema_migrations (version) VALUES (7);
