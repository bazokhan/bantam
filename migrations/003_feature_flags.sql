CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  rollout_percent INTEGER NOT NULL DEFAULT 100,
  value TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (rollout_percent BETWEEN 0 AND 100)
) STRICT;

CREATE INDEX feature_flags_enabled ON feature_flags(enabled);