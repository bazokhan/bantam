-- Append-only trail of operator actions taken through the admin console.
-- Lives beside the admin accounts so one query can show every mutation an
-- operator made, across every game, in one ordered list.
--
-- `details` holds a small JSON object that the server builds itself. It never
-- carries credentials, tokens, raw provider ids, ip addresses or headers.
CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY,
  admin_id TEXT,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  game_id TEXT,
  target TEXT,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX admin_audit_created ON admin_audit(created_at DESC, id DESC);
CREATE INDEX admin_audit_game ON admin_audit(game_id, created_at DESC, id DESC);
CREATE INDEX admin_audit_action ON admin_audit(action, created_at DESC, id DESC);
