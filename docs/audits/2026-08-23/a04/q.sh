#!/bin/zsh
cd /Users/shubhang/Desktop/Projects/uganda-dashboard
set -a; . ./.env.local >/dev/null 2>&1; set +a
psql "$SUPABASE_DB_URL" -X -q "$@"
