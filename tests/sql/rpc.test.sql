-- Behavioural tests for 004_run_processing_rpcs.sql (run via tests/sql/run.sh).
\set ON_ERROR_STOP on
\set QUIET on

create schema if not exists testh;
grant usage on schema testh to authenticated;
create or replace function testh.expect_fail(stmt text, needle text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then
    if sqlerrm like '%' || needle || '%' then return; end if;
    raise exception 'wrong error for [%]: got "%", wanted "%"', stmt, sqlerrm, needle;
  end;
  raise exception 'expected failure containing "%" but statement succeeded: %', needle, stmt;
end $$;
create or replace function testh.assert_eq(actual anyelement, expected anyelement, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL %: expected %, got %', label, expected, actual; end if;
end $$;
grant execute on all functions in schema testh to authenticated;

insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111111','owner@x.test'),
 ('22222222-2222-2222-2222-222222222222','viewer@x.test'),
 ('33333333-3333-3333-3333-333333333333','outsider@x.test'),
 ('44444444-4444-4444-4444-444444444444','reviewer@x.test');

-- owner onboarding through the real RPC
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select public.create_organization_with_owner('Acme','acme-1','business','PK','PKR','Bank rec','bank') as org \gset
reset role;
insert into public.organization_members(organization_id,user_id,role,status,joined_at) values
 (:'org','22222222-2222-2222-2222-222222222222','viewer','active',now()),
 (:'org','44444444-4444-4444-4444-444444444444','reviewer','active',now());
select id as ws from public.workspaces where organization_id=:'org' \gset

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
insert into public.reconciliation_runs(organization_id,workspace_id,name,status,prepared_by)
  values (:'org',:'ws','Jan','draft','11111111-1111-1111-1111-111111111111') returning id as run \gset
insert into public.transactions(organization_id,workspace_id,run_id,source_side,transaction_date,description,amount,currency,row_number) values
 (:'org',:'ws',:'run','a','2026-01-01','Pay A',100,'PKR',1),
 (:'org',:'ws',:'run','a','2026-01-02','Pay B',200,'PKR',2),
 (:'org',:'ws',:'run','a','2026-01-03','Fee',5,'PKR',3),
 (:'org',:'ws',:'run','a','2026-01-04','Lonely',999,'PKR',4),
 (:'org',:'ws',:'run','b','2026-01-01','Pay A',100,'PKR',1),
 (:'org',:'ws',:'run','b','2026-01-02','Pay B',200,'PKR',2),
 (:'org',:'ws',:'run','b','2026-01-03','Fee',5,'PKR',3);
select id as a1 from public.transactions where run_id=:'run' and source_side='a' and row_number=1 \gset
select id as a2 from public.transactions where run_id=:'run' and source_side='a' and row_number=2 \gset
select id as a3 from public.transactions where run_id=:'run' and source_side='a' and row_number=3 \gset
select id as b1 from public.transactions where run_id=:'run' and source_side='b' and row_number=1 \gset
select id as b2 from public.transactions where run_id=:'run' and source_side='b' and row_number=2 \gset
select id as b3 from public.transactions where run_id=:'run' and source_side='b' and row_number=3 \gset
select jsonb_build_array(
  jsonb_build_object('left_id',:'a1','right_id',:'b1','score',100,'status','accepted','explanation','{"method":"t"}'),
  jsonb_build_object('left_id',:'a2','right_id',:'b2','score',80,'status','suggested','explanation','{}'),
  jsonb_build_object('left_id',:'a3','right_id',:'b3','score',90,'status','excluded','explanation','{}')
) as payload \gset

-- authorisation and validation failures (all must leave the run untouched)
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select testh.expect_fail(format('select public.apply_run_matches(%L,%L::jsonb)', :'run', :'payload'), 'access denied');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select testh.expect_fail(format('select public.apply_run_matches(%L,%L::jsonb)', :'run', :'payload'), 'access denied');
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select testh.expect_fail(format('select public.apply_run_matches(%L,%L::jsonb)', :'run', :'payload'), 'access denied');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select testh.expect_fail(format('select public.apply_run_matches(%L,%L::jsonb)', :'run',
  jsonb_build_array(jsonb_build_object('left_id',:'b1','right_id',:'a1','score',50,'status','suggested'))::text), 'Invalid matches payload');
select testh.expect_fail(format('select public.apply_run_matches(%L,%L::jsonb)', :'run',
  jsonb_build_array(jsonb_build_object('left_id',:'a1','right_id',:'b1','score',500,'status','suggested'))::text), 'Invalid matches payload');
select testh.expect_fail(format('select public.apply_run_matches(%L,%L::jsonb)', :'run',
  jsonb_build_array(jsonb_build_object('left_id',:'a1','right_id',:'b1','score',50,'status','accepted'),
                    jsonb_build_object('left_id',:'a2','right_id',:'b1','score',50,'status','accepted'))::text), 'more than one match');
select testh.expect_fail(format('select public.apply_run_matches(%L,%L::jsonb)', gen_random_uuid(), :'payload'), 'access denied');
select testh.assert_eq((select status from public.reconciliation_runs where id=:'run'), 'draft', 'run still draft after failures');

-- happy path
select public.apply_run_matches(:'run', :'payload'::jsonb, '{"active_rules":0}') as result \gset
select testh.assert_eq((select status from public.reconciliation_runs where id=:'run'), 'prepared', 'run prepared');
select testh.assert_eq((select count(*) from public.match_groups where run_id=:'run'), 2::bigint, 'two groups (excluded has none)');
select testh.assert_eq((select matched_transactions from public.reconciliation_runs where id=:'run'), 2::bigint, 'matched tx count');
select testh.assert_eq((select reconciled_amount from public.reconciliation_runs where id=:'run'), 100::numeric, 'reconciled amount');
select testh.assert_eq((select source_a_balance from public.reconciliation_runs where id=:'run'), 1304::numeric, 'balance a');
select testh.assert_eq((select outstanding_difference from public.reconciliation_runs where id=:'run'), 1304 - 305::numeric, 'difference');
select testh.assert_eq((select status from public.transactions where id=:'a1'), 'matched', 'a1 matched');
select testh.assert_eq((select status from public.transactions where id=:'a2'), 'suggested', 'a2 suggested');
select testh.assert_eq((select status from public.transactions where id=:'a3'), 'excluded', 'a3 excluded');
select testh.assert_eq((select count(*) from public.transactions where run_id=:'run' and status='unmatched'), 1::bigint, 'one unmatched');
select testh.assert_eq((select decided_by from public.match_groups where run_id=:'run' and status='accepted'), '11111111-1111-1111-1111-111111111111'::uuid, 'decided_by');
select testh.expect_fail(format('select public.apply_run_matches(%L,%L::jsonb)', :'run', :'payload'), 'Only draft or failed');

-- decisions
select public.decide_match(:'run', g.id, 'rejected') from public.match_groups g where g.run_id=:'run' and g.status='accepted';
select testh.assert_eq((select status from public.transactions where id=:'a1'), 'unmatched', 'rejected -> unmatched');
select testh.assert_eq((select matched_transactions from public.reconciliation_runs where id=:'run'), 0::bigint, 'matched count after reject');
select id as sug from public.match_groups where run_id=:'run' and status='suggested' \gset
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select public.decide_match(:'run', :'sug', 'accepted');   -- reviewer may decide
select testh.assert_eq((select status from public.transactions where id=:'a2'), 'matched', 'reviewer accepted');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select testh.expect_fail(format('select public.decide_match(%L,%L,%L)', :'run', :'sug', 'rejected'), 'access denied');
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select testh.expect_fail(format('select public.decide_match(%L,%L,%L)', :'run', :'sug', 'rejected'), 'access denied');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select testh.expect_fail(format('select public.decide_match(%L,%L,%L)', :'run', :'sug', 'maybe'), 'accepted or rejected');
select testh.expect_fail(format('select public.decide_match(%L,%L,%L)', :'run', gen_random_uuid(), 'accepted'), 'not found');

-- direct table writes by a viewer remain blocked by RLS; clients cannot forge audit rows
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select testh.expect_fail(format($f$insert into public.audit_logs(organization_id,action,resource_type) values (%L,'x','y')$f$, :'org'), 'permission denied');
select testh.assert_eq((select count(*) from public.match_groups where run_id=:'run'), 2::bigint, 'viewer can read groups via RLS');
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select testh.assert_eq((select count(*) from public.match_groups where run_id=:'run'), 0::bigint, 'outsider sees nothing');

-- locked / approved runs cannot be changed
reset role;
update public.reconciliation_runs set locked_at = now() where id=:'run';
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select testh.expect_fail(format('select public.decide_match(%L,%L,%L)', :'run', :'sug', 'rejected'), 'locked');
reset role;
select testh.assert_eq((select count(*) from public.audit_logs where organization_id=:'org' and action in ('reconciliation.processed','match.accepted','match.rejected')), 3::bigint, 'audit rows');

\echo ALL SQL TESTS PASSED
