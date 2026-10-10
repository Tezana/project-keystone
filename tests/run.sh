#!/usr/bin/env bash
# Runs every website test against the demo data in tracker/*.json.
# Usage:  tests/run.sh            (all suites)
#         tests/run.sh budget     (one suite, by file name)
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
PORT=${PORT:-8766}
export SITE_URL="http://localhost:$PORT" OUT="$ROOT/tests/output"
mkdir -p "$OUT"
[ -d tests/node_modules ] || (cd tests && npm install --silent)

# Build test data from the plan files without touching the real copies
BK=$(mktemp -d)
cp README.md dashboard/progress.svg docs/data.json "$BK/"
restore(){ cp "$BK/README.md" README.md; cp "$BK/progress.svg" dashboard/progress.svg; cp "$BK/data.json" docs/data.json; kill $SRV 2>/dev/null; }
trap restore EXIT
(cd scripts && LOCAL_PREVIEW=1 python3 dashboard.py >/dev/null)
(cd docs && python3 -m http.server "$PORT" >/dev/null 2>&1) & SRV=$!
sleep 1

status=0
for f in tests/*${1:-}*.test.js; do
  printf '%-34s' "$(basename "$f")"
  out=$(node "$f" 2>&1); code=$?
  echo "$out" | tail -1
  if [ $code -ne 0 ] || echo "$out" | grep -q "^FAIL"; then echo "$out" | grep -E "^FAIL|Error" | head -10; status=1; fi
done
exit $status
