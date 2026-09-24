CREATE TABLE players (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE refresh_sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX refresh_sessions_family ON refresh_sessions(family_id);

CREATE TABLE runs (
  adapter_id TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(adapter_id, player_id, run_id)
) STRICT;

CREATE TABLE leaderboard_entries (
  id INTEGER PRIMARY KEY,
  board_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  value INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  UNIQUE(board_id, period_key, player_id)
) STRICT;
CREATE INDEX leaderboard_order ON leaderboard_entries(board_id, period_key, value, achieved_at, id);

CREATE TABLE rate_limits (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(player_id, category, bucket)
) STRICT;
