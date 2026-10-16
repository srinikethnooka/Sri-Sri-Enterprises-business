#!/usr/bin/env bash
# Applies all migrations to a fresh throwaway database and runs the SQL test suite.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-db.sh
# Needs a PostgreSQL 15+ superuser connection. Never point this at production.
set -euo pipefail

DB="${TEST_DB:-ssb_test}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -d postgres -c "drop database if exists ${DB};" -c "create database ${DB};"
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/00_supabase_shim.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -f "$f"
done

fail=0
for f in "$ROOT"/supabase/tests/0[1-9]*.sql "$ROOT"/supabase/tests/[1-9]*.sql; do
  if "${PSQL[@]}" -d "$DB" -f "$f"; then
    echo "PASS     $(basename "$f")"
  else
    echo "FAIL     $(basename "$f")"
    fail=1
  fi
done
if [ $fail -eq 0 ]; then
  TEST_DB="$DB" "$ROOT/scripts/test-concurrency.sh" || fail=1
fi
exit $fail
