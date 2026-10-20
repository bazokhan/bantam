-- The console's per-player leaderboard view filters leaderboard entries by
-- player id. The existing unique(board_id, period_key, player_id) index puts
-- the player id last, so it cannot serve that filter. This index is purely
-- additive: it reads the same rows the table already holds.
CREATE INDEX leaderboard_player ON leaderboard_entries(player_id, board_id, period_key);
