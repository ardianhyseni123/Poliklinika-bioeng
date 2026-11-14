#!/usr/bin/env bash
# Like `npm run dev`, but with the records of a backup file loaded into the local emulators:
#
#   npm run dev:backup -- /path/to/bioeng-backup-YYYY-MM-DD.json
#
# The backup comes from «Kopje rezervë → Eksporto» (old or new app). Everything stays on this
# computer: the emulators use the demo-bioeng project, which cannot reach real Firebase, and
# their data is discarded when you stop this. Log in with the test accounts of
# scripts/seed.mjs; the laboratory account sees everything.
#
# Not loaded: attachments (the importer never uploads them) and the analysis list (the
# laboratory's first login stores the built-in one).
set -euo pipefail

backup="${1:-}"
if [ -z "$backup" ] || [ ! -f "$backup" ]; then
  echo "Usage: npm run dev:backup -- /path/to/bioeng-backup-YYYY-MM-DD.json" >&2
  exit 1
fi
backup="$(cd "$(dirname "$backup")" && pwd)/$(basename "$backup")"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

[ -d tools/firebase-import/node_modules/firebase-admin ] || {
  echo "Run 'npm install' in tools/firebase-import first." >&2
  exit 1
}

# The importer runs inside emulators:exec, which points the Admin SDK at the emulators.
exec scripts/with-java.sh firebase --config firebase.emulators.json emulators:exec --project demo-bioeng --only auth,firestore \
  "node scripts/seed.mjs && node tools/firebase-import/import.mjs '$backup' --commit --project-id demo-bioeng && vite"
