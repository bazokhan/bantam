CREATE TABLE wallets (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  currency_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, currency_id)
) STRICT;

CREATE TABLE wallet_transactions (
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  currency_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount <> 0),
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, idempotency_key)
) STRICT;

CREATE INDEX wallet_transactions_player_created
  ON wallet_transactions(player_id, created_at DESC, id DESC);
