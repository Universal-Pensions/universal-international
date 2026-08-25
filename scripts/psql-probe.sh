#!/usr/bin/env bash
# psql-probe.sh — run SQL against live inside a transaction that CANNOT silently commit.
#
# WHY THIS EXISTS
# ---------------
# On 2026-08-25 an agent believed it was probing live inside BEGIN…ROLLBACK and
# instead COMMITTED three migrations. Nothing errored. The mechanism:
#
#   Every migration in this repo from 0101 onward carries its OWN `BEGIN;` and
#   `COMMIT;` at column 0 — it is the house convention (20 forward + 17 down
#   migrations on the remediation branch do it).
#
#   Postgres transactions DO NOT NEST. So:
#       BEGIN;
#       \i supabase/migrations/0114_money_numeric_guards.sql
#       ROLLBACK;
#   emits only a WARNING for the inner BEGIN ("there is already a transaction in
#   progress"), which psql prints and walks straight past — and the inner COMMIT
#   commits the OUTER transaction. The trailing ROLLBACK then has nothing left to
#   undo and reports no error at all. A clean-looking run that wrote to production.
#
# WHAT THIS DOES
#   1. REFUSES to include any file containing column-0 BEGIN/COMMIT/ROLLBACK.
#   2. Strips a migration's own transaction control when asked to (--strip),
#      so the body can be probed safely.
#   3. Asserts the transaction is STILL OPEN immediately before rolling back —
#      so a silent commit is caught and reported instead of passing unnoticed.
#
# USAGE
#   scripts/psql-probe.sh probe.sql                          # probe.sql must have no txn control
#   scripts/psql-probe.sh --strip supabase/migrations/0114_money_numeric_guards.sql probe.sql
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# shellcheck disable=SC1091
set -a; . ./.env.local >/dev/null 2>&1; set +a
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set — check .env.local}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

STRIP=0
if [ "${1:-}" = "--strip" ]; then STRIP=1; shift; fi

BODY="$TMP/body.sql"
: > "$BODY"

for f in "$@"; do
  [ -f "$f" ] || { echo "psql-probe: no such file: $f" >&2; exit 2; }
  if [ "$STRIP" = "1" ]; then
    # Drop ONLY the file's own transaction control. This used to be
    #   grep -vE '^(BEGIN|COMMIT|ROLLBACK|END)\s*;'
    # which has no idea what a dollar-quoted body is: in PL/pgSQL a column-0
    # `END;` is almost always a FUNCTION TERMINATOR, and this repo has 369 of
    # them across 116 migrations. The regex deleted every one, leaving bodies
    # unterminated and guaranteeing "syntax error at end of input" on probe.
    # _strip_txn_control.py tracks dollar-quote state and only strips at
    # statement level. It refuses a file whose quoting it cannot balance.
    if ! python3 "$(dirname "$0")/_strip_txn_control.py" "$f" >> "$BODY"; then
      echo "psql-probe: could not safely strip $f — refusing to probe." >&2
      exit 5
    fi
  else
    # -i and END included: `END` / `END TRANSACTION` is a Postgres synonym for
    # COMMIT, and the strip path already treats it as such. The two paths
    # disagreeing is how a file with lowercase `commit;` or a bare `END;` slips
    # through the refusal and commits the probe to live.
    if grep -qiE '^(BEGIN|START[[:space:]]+TRANSACTION|COMMIT|END|ROLLBACK)[[:space:]]*(WORK|TRANSACTION)?[[:space:]]*;' "$f"; then
      echo "psql-probe: REFUSING $f — it contains column-0 transaction control." >&2
      echo "            Re-run with --strip, or the file's own COMMIT will commit" >&2
      echo "            your probe to LIVE. See the header of this script." >&2
      exit 3
    fi
    cat "$f" >> "$BODY"
  fi
  printf '\n' >> "$BODY"
done

RUN="$TMP/run.sql"
{
  echo "\\set ON_ERROR_STOP on"
  echo "BEGIN;"
  cat "$BODY"
  # The guard. pg_current_xact_id_if_assigned() is NULL outside a transaction that
  # has written anything; the reliable signal that our transaction survived is that
  # we are still in one at all. `\echo` of :ERROR is not enough — a silent commit
  # raises no error. So ask the server directly.
  # Both arms of this used to end in "(safe)", so it could not express the one
  # thing it exists to detect. What actually matters is whether we are STILL in
  # the transaction we opened: if the body committed, we are not, and
  # transaction_timestamp() = statement_timestamp() for the fresh implicit one.
  echo "SELECT CASE"
  echo "         WHEN transaction_timestamp() <> statement_timestamp()"
  echo "           THEN 'probe-txn-state: still inside the probe transaction (safe)'"
  echo "         ELSE 'probe-txn-state: *** NOT IN THE PROBE TRANSACTION — IT COMMITTED ***'"
  echo "       END AS guard;"
  echo "ROLLBACK;"
} > "$RUN"

# Capture psql's exit code instead of discarding it with `|| true`. Swallowing
# it meant a refused connection, a bad password or a syntax abort produced
# output that matched no grep below, so the script exited 0 and printed nothing
# alarming — indistinguishable from "the probe ran and rolled back cleanly".
set +e
OUT="$(psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$RUN" 2>&1)"
PSQL_RC=$?
set -e
echo "$OUT"

# A commit inside the body shows up as psql warning about a missing transaction
# on the trailing ROLLBACK, or as the inner-BEGIN warning. Either is fatal here.
if echo "$OUT" | grep -q 'NOT IN THE PROBE TRANSACTION'; then
  echo >&2
  echo "psql-probe: *** THE PROBE COMMITTED — SOMETHING IS LIVE. ***" >&2
  exit 4
fi

if [ "$PSQL_RC" -ne 0 ]; then
  echo >&2
  echo "psql-probe: psql exited $PSQL_RC — the probe did NOT complete." >&2
  echo "            This is not a clean run. Do not read the absence of a" >&2
  echo "            failure message as success." >&2
  exit "$PSQL_RC"
fi

if echo "$OUT" | grep -qiE 'there is no transaction in progress|there is already a transaction in progress'; then
  echo >&2
  echo "psql-probe: *** THE PROBE ESCAPED ITS TRANSACTION — SOMETHING MAY BE LIVE. ***" >&2
  echo "psql-probe: verify the database state now; do not assume the rollback worked." >&2
  exit 4
fi
