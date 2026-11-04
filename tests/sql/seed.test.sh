#!/usr/bin/env bash
# Verifies 005_demo_test_account.sql on a scratch database: idempotent, complete, and the seeded
# match results are identical to what the real matching engine produces for the seeded data.
# Usage: tests/sql/seed.test.sh [admin-connection-string]   (needs a Postgres superuser and node)
set -euo pipefail
cd "$(dirname "$0")/../.."
ADMIN="${1:-dbname=postgres}"; DB="axiom_seed_test"
psql="psql -X -q -v ON_ERROR_STOP=1"
$psql "$ADMIN" -c "drop database if exists $DB" -c "create database $DB"
CONN="${ADMIN/dbname=postgres/dbname=$DB}"
for f in tests/sql/harness.sql database/sql/00{1,2,3,4}_*.sql; do $psql "$CONN" -f "$f" >/dev/null; done
$psql "$CONN" -f database/sql/005_demo_test_account.sql >/dev/null
$psql "$CONN" -f database/sql/005_demo_test_account.sql >/dev/null   # second run must be a no-op
q() { $psql "$CONN" -At -c "$1"; }
check() { [ "$(q "$2")" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$(q "$2")' expected '$3'"; exit 1; }; }
check "one organization"            "select count(*) from public.organizations"              1
check "one confirmed user"          "select count(*) from auth.users where email_confirmed_at is not null" 1
check "26 transactions"             "select count(*) from public.transactions"               26
check "run is prepared"             "select status from public.reconciliation_runs"           prepared
check "accepted groups"             "select count(*) from public.match_groups where status='accepted'"  3
check "suggested groups"            "select count(*) from public.match_groups where status='suggested'" 7
check "excluded transactions"       "select count(*) from public.transactions where status='excluded'"  2
check "unmatched transactions"      "select count(*) from public.transactions where status='unmatched'" 4
check "matched count on run"        "select matched_transactions from public.reconciliation_runs"       6
check "two exceptions"              "select count(*) from public.exceptions"                 2
check "one comment"                 "select count(*) from public.comments"                  1
check "owner membership"            "select role from public.organization_members"           owner
# seeded results == real engine output
q "select json_agg(t) from (select id,source_side,row_number,transaction_date::text,amount::float8,description,reference,currency,normalized_data from public.transactions order by source_side,row_number) t" > /tmp/seed_tx.json
q "select json_agg(r) from (select id,name,conditions,actions from public.reconciliation_rules where status='active') r" > /tmp/seed_rules.json
q "select json_agg(x) from (select la.row_number as l, rb.row_number as r, g.status, g.confidence::float8 as score from public.match_groups g join public.match_group_items ia on ia.match_group_id=g.id join public.transactions la on la.id=ia.transaction_id and la.source_side='a' join public.match_group_items ib on ib.match_group_id=g.id join public.transactions rb on rb.id=ib.transaction_id and rb.source_side='b') x" > /tmp/seed_groups.json
node -e "
const {buildMatches}=require('./api/_lib/matching');const fs=require('fs');
const tx=JSON.parse(fs.readFileSync('/tmp/seed_tx.json')),rules=JSON.parse(fs.readFileSync('/tmp/seed_rules.json'))||[],db=JSON.parse(fs.readFileSync('/tmp/seed_groups.json'));
const m=buildMatches(tx.filter(t=>t.source_side==='a'),tx.filter(t=>t.source_side==='b'),rules).filter(x=>x.status!=='excluded');
const key=(l,r,s,sc)=>[l,r,s,Number(sc).toFixed(2)].join('|');
const e=m.map(x=>key(x.left.row_number,x.right.row_number,x.status,x.score)).sort(),d=db.map(x=>key(x.l,x.r,x.status,x.score)).sort();
if(JSON.stringify(e)!==JSON.stringify(d)){console.log('FAIL seeded groups differ from engine output\nengine:',e,'\nseeded:',d);process.exit(1)}
console.log('ok   seeded matches identical to engine output ('+m.length+' groups)');
"
$psql "$ADMIN" -c "drop database $DB"
