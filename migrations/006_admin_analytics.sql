-- Analytics indexes for the admin console.
-- Additive only: the dashboard's activity chart, "runs today" counters and
-- per-board entry counts read these tables by time range. Safe to apply
-- online — no table or column is rewritten.
CREATE INDEX IF NOT EXISTS runs_created_at ON runs(created_at);
CREATE INDEX IF NOT EXISTS leaderboard_entries_achieved_at ON leaderboard_entries(achieved_at);
CREATE INDEX IF NOT EXISTS players_created_at ON players(created_at);
