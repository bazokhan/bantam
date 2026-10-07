#!/bin/sh
set -eu
node dist/ops/generate-litestream-config.js >/dev/null || true

# If LITESTREAM_REPLICA_URL is set to an s3:// URL, wrap the app in litestream
# so SQLite replicas are continuously pushed. Otherwise, run node directly —
# the container still serves all routes, just without out-of-process backups.
if [ -n "${LITESTREAM_REPLICA_URL:-}" ] && echo "$LITESTREAM_REPLICA_URL" | grep -q "^s3://"; then
  if [ "${BANTAM_RESTORE_IF_MISSING:-false}" = "true" ]; then
    node dist/ops/cli.js restore-if-missing "${BANTAM_ONLY_GAME:?BANTAM_ONLY_GAME is required for automatic restore}"
  fi
  exec litestream replicate -config "${LITESTREAM_CONFIG:-/data/litestream.generated.yml}" -exec "node dist/main.js"
else
  exec node dist/main.js
fi