CREATE TABLE inventory (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, item_id)
) STRICT;

CREATE TABLE inventory_transactions (
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount <> 0),
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, idempotency_key)
) STRICT;

CREATE INDEX inventory_transactions_player_created
  ON inventory_transactions(player_id, created_at DESC, id DESC);

CREATE TABLE store_purchases (
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  currency_id TEXT NOT NULL,
  price_amount INTEGER NOT NULL CHECK (price_amount > 0),
  idempotency_key TEXT NOT NULL,
  wallet_transaction_id INTEGER NOT NULL REFERENCES wallet_transactions(id),
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, idempotency_key)
) STRICT;

CREATE INDEX store_purchases_player_offer
  ON store_purchases(player_id, offer_id, created_at DESC);

CREATE TABLE item_uses (
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  consumed_quantity INTEGER NOT NULL CHECK (consumed_quantity >= 0),
  idempotency_key TEXT NOT NULL,
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, idempotency_key)
) STRICT;

CREATE TABLE reward_claims (
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  reward_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, idempotency_key)
) STRICT;

CREATE INDEX reward_claims_player_reward
  ON reward_claims(player_id, reward_id);

CREATE TABLE iap_purchases (
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  product_id TEXT NOT NULL,
  provider_product_id TEXT NOT NULL,
  purchase_token_hash TEXT NOT NULL,
  order_id TEXT,
  verification_state TEXT NOT NULL,
  fulfillment_state TEXT NOT NULL,
  acknowledge_state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider, purchase_token_hash)
) STRICT;

CREATE INDEX iap_purchases_player_created
  ON iap_purchases(player_id, created_at DESC, id DESC);
