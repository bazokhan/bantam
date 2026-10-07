#!/bin/sh
set -eu
node dist/ops/generate-litestream-config.js >/dev/null || true
if [ "${BANTAM_RESTORE_IF_MISSING:-false}" = "true" ]; then
  node dist/ops/cli.js restore-if-missing "${BANTAM_ONLY_GAME:?BANTAM_ONLY_GAME is required for automatic restore}"
fi
exec litestream replicate -config "${LITESTREAM_CONFIG:-/data/litestream.generated.yml}" -exec "node dist/main.js"
