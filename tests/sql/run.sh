#!/usr/bin/env bash
# Runs the migrations plus behavioural tests against a scratch PostgreSQL database.
# Usage: tests/sql/run.sh [admin-connection-string]   (default: dbname=postgres)
# Needs a Postgres superuser. Creates and drops the database "axiom_sql_test".
set -euo pipefail
cd "$(dirname "$0")/../.."
ADMIN="${1:-dbname=postgres}"
TEST_DB="axiom_sql_test"
psql="psql -X -q -v ON_ERROR_STOP=1"
$psql "$ADMIN" -c "drop database if exists $TEST_DB" -c "create database $TEST_DB"
CONN="${ADMIN/dbname=postgres/dbname=$TEST_DB}"
[[ "$CONN" == "$ADMIN" ]] && CONN="${ADMIN%/*}/$TEST_DB"
for f in tests/sql/harness.sql database/sql/001_core_saas_schema.sql database/sql/002_rls_and_onboarding.sql \
         database/sql/003_seed_plans_and_verify.sql database/sql/004_run_processing_rpcs.sql; do
  echo "== $f"; $psql "$CONN" -f "$f" >/dev/null
done
$psql "$CONN" -f tests/sql/rpc.test.sql 2>&1 | grep -E "PASSED|FAIL|ERROR" || true
$psql "$ADMIN" -c "drop database $TEST_DB"
