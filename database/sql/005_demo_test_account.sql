-- Axiom Recon Builder: TEST ACCOUNT + DEMO DATA  (development / staging only)
-- ---------------------------------------------------------------------------
-- Run in the Supabase SQL Editor AFTER 001-004. Do NOT run it in production.
--
-- Creates (or reuses) a confirmed email/password user, an organization on a trial
-- plan, one workspace, two sample CSV sources, a PROCESSED reconciliation run
-- (13 bank + 13 ledger transactions, scored matches), one rule and two exceptions,
-- so every page has data the first time you sign in.
--
-- To try the live flow as well, upload docs/sample-data/*.csv in Reconciliations.
--
-- Safe to run twice: it does nothing if the demo organization already exists.
-- To reset: delete from public.organizations where slug = 'demo-accounting';
--           (the user can be deleted in Authentication -> Users), then run again.

do $$
declare
  v_email    text := 'test.user@example.com';   -- <- change if you like
  v_password text := 'Axiom@Test2026';          -- <- change if you like
  v_name     text := 'Test User';

  v_uid   uuid;
  v_org   uuid;
  v_ws    uuid;
  v_src_a uuid;
  v_src_b uuid;
  v_run   uuid;
  v_ex1   uuid;
  v_written bigint;
begin
  -- 1. User (confirmed, password login) ------------------------------------
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      lower(v_email), crypt(v_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', v_name, 'country_code', 'PK'),
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text,
            jsonb_build_object('sub', v_uid::text, 'email', lower(v_email), 'email_verified', true),
            'email', now(), now(), now());
  end if;

  insert into public.profiles (id, full_name, country_code)
  values (v_uid, v_name, 'PK') on conflict (id) do nothing;

  -- 2. Organization, membership, trial subscription, workspace -------------
  if exists (select 1 from public.organizations where slug = 'demo-accounting') then
    raise notice 'Demo organization already exists - nothing to do.';
    return;
  end if;

  insert into public.organizations (name, slug, business_type, country_code, base_currency, status, created_by)
  values ('Demo Accounting Ltd', 'demo-accounting', 'accounting_firm', 'PK', 'PKR', 'trial', v_uid)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (v_org, v_uid, 'owner', 'active', now());

  insert into public.subscriptions (organization_id, plan_id, status, trial_ends_at)
  values (v_org, 'professional', 'trialing', now() + interval '14 days');

  insert into public.workspaces (organization_id, name, description, reconciliation_type, base_currency, frequency, preparer_id, reviewer_id, created_by)
  values (v_org, 'Operating account - monthly', 'Main bank account against the general ledger', 'bank', 'PKR', 'monthly', v_uid, v_uid, v_uid)
  returning id into v_ws;

  insert into public.audit_logs (organization_id, actor_id, action, resource_type, resource_id, after_data)
  values (v_org, v_uid, 'organization.created', 'organization', v_org::text, '{"name":"Demo Accounting Ltd","seeded":true}');

  -- 3. Sources and the run (marked 'prepared' in step 5) ---------------------------------------------
  insert into public.data_sources (organization_id, workspace_id, side, source_type, name, configuration)
  values (v_org, v_ws, 'a', 'csv', 'bank_statement_jan_2026.csv', '{"seeded":true}') returning id into v_src_a;
  insert into public.data_sources (organization_id, workspace_id, side, source_type, name, configuration)
  values (v_org, v_ws, 'b', 'csv', 'ledger_export_jan_2026.csv', '{"seeded":true}') returning id into v_src_b;

  insert into public.reconciliation_runs (organization_id, workspace_id, name, period_start, period_end, status, total_transactions, prepared_by)
  values (v_org, v_ws, 'Operating account - January 2026', '2026-01-01', '2026-01-31', 'draft', 26, v_uid)
  returning id into v_run;

  -- 4. Transactions: side a = bank statement, side b = ledger ---------------
  insert into public.transactions
    (organization_id, workspace_id, run_id, source_id, source_side, transaction_date, description, reference, amount, currency, row_number, status)
  select v_org, v_ws, v_run, case t.side when 'a' then v_src_a else v_src_b end,
         t.side, t.d::date, t.descr, t.ref, t.amt, 'PKR', t.rn, 'unmatched'
  from (values
    -- bank statement
    ('a', 1,  '2026-01-02', 'ACME LTD PAYMENT',          'INV-2001',  125000.00),
    ('a', 2,  '2026-01-03', 'SALARY TRANSFER JAN',        null,      -450000.00),
    ('a', 3,  '2026-01-05', 'K-ELECTRIC BILL',            null,       -18450.00),
    ('a', 4,  '2026-01-07', 'STRIPE PAYOUT',              null,        98200.50),
    ('a', 5,  '2026-01-10', 'OFFICE RENT',                'RENT-JAN',  -85000.00),
    ('a', 6,  '2026-01-12', 'BETA TRADERS',               'INV-2002',   54000.00),
    ('a', 7,  '2026-01-14', 'CHEQUE 004512',              null,       -22000.00),
    ('a', 8,  '2026-01-15', 'BANK CHARGES',               null,        -1500.00),
    ('a', 9,  '2026-01-18', 'REFUND CUSTOMER',            null,         7500.00),
    ('a', 10, '2026-01-20', 'SUBSCRIPTION SAAS',          null,        -3000.00),
    ('a', 11, '2026-01-22', 'CASH DEPOSIT',               null,        40000.00),
    ('a', 12, '2026-01-25', 'UNKNOWN TRANSFER 99812',     null,        15750.00),
    ('a', 13, '2026-01-27', 'DELTA CO PAYMENT',           'INV-2005',   76000.00),
    -- general ledger
    ('b', 1,  '2026-01-02', 'Acme Ltd payment received',  'INV-2001',  125000.00),
    ('b', 2,  '2026-01-03', 'Payroll January',            null,      -450000.00),
    ('b', 3,  '2026-01-06', 'K Electric utility payment', null,       -18450.00),
    ('b', 4,  '2026-01-09', 'Stripe settlement',          null,        98200.50),
    ('b', 5,  '2026-01-10', 'Rent January office',        'RENT-JAN',  -85000.00),
    ('b', 6,  '2026-01-12', 'Beta Traders invoice',       'INV-2002',   54500.00),
    ('b', 7,  '2026-01-16', 'Cheque payment 4512',        null,       -22000.00),
    ('b', 8,  '2026-01-15', 'Bank charges Jan',           null,        -1500.00),
    ('b', 9,  '2026-01-18', 'Customer refund',            null,        -7500.00),
    ('b', 10, '2026-01-20', 'SaaS subscription',          null,        -3000.00),
    ('b', 11, '2026-01-20', 'SaaS subscription',          null,        -3000.00),
    ('b', 12, '2026-01-28', 'Prepaid insurance accrual',  null,       -12000.00),
    ('b', 13, '2026-01-27', 'Delta Co',                   'INV-2005',   76000.00)
  ) as t(side, rn, d, descr, ref, amt);

  -- 5. Matching results, exactly as the engine (deterministic_v2) produces them -----
  --    Rule 'Bank charges - exclude' is created first because the engine applied it.
  insert into public.reconciliation_rules (organization_id, workspace_id, name, description, priority, conditions, actions, status, created_by)
  values (v_org, null, 'Bank charges - exclude',
          'Bank fees are booked separately; exclude matching fee pairs from review.', 10,
          '{"logic":"and","groups":[{"field":"description","operator":"begins_with","value":"bank charge"}]}',
          '{"type":"exclude","confidence_adjustment":0,"require_approval":false}', 'active', v_uid);

  with m(l_rn, r_rn, score, status, explanation) as (values
    (10, 10, 100, 'suggested', '{"amount":{"score":50,"max":50,"difference":0,"sign_flipped":false},"date":{"score":20,"max":20,"difference_days":0},"reference":{"score":0,"max":0,"available":false,"exact":false},"description":{"score":10,"max":10,"available":true},"method":"deterministic_v2","ambiguity":{"competing_candidates":1,"margin":5}}'::jsonb),
    (8, 8, 98.08, 'excluded', '{"amount":{"score":50,"max":50,"difference":0,"sign_flipped":false},"date":{"score":20,"max":20,"difference_days":0},"reference":{"score":0,"max":0,"available":false,"exact":false},"description":{"score":8.46,"max":10,"available":true},"method":"deterministic_v2","rule":{"id":"r","name":"Bank charges - exclude","action":"exclude","confidence_adjustment":0,"require_approval":false}}'::jsonb),
    (1, 1, 97.69, 'accepted', '{"amount":{"score":50,"max":50,"difference":0,"sign_flipped":false},"date":{"score":20,"max":20,"difference_days":0},"reference":{"score":20,"max":20,"available":true,"exact":true},"description":{"score":7.69,"max":10,"available":true},"method":"deterministic_v2"}'::jsonb),
    (5, 5, 97.14, 'accepted', '{"amount":{"score":50,"max":50,"difference":0,"sign_flipped":false},"date":{"score":20,"max":20,"difference_days":0},"reference":{"score":20,"max":20,"available":true,"exact":true},"description":{"score":7.14,"max":10,"available":true},"method":"deterministic_v2"}'::jsonb),
    (13, 13, 96.36, 'accepted', '{"amount":{"score":50,"max":50,"difference":0,"sign_flipped":false},"date":{"score":20,"max":20,"difference_days":0},"reference":{"score":20,"max":20,"available":true,"exact":true},"description":{"score":6.36,"max":10,"available":true},"method":"deterministic_v2"}'::jsonb),
    (6, 6, 92.75, 'suggested', '{"amount":{"score":45.41,"max":50,"difference":500,"sign_flipped":false},"date":{"score":20,"max":20,"difference_days":0},"reference":{"score":20,"max":20,"available":true,"exact":true},"description":{"score":7.33,"max":10,"available":true},"method":"deterministic_v2"}'::jsonb),
    (2, 2, 91.41, 'suggested', '{"amount":{"score":50,"max":50,"difference":0,"sign_flipped":false},"date":{"score":20,"max":20,"difference_days":0},"reference":{"score":0,"max":0,"available":false,"exact":false},"description":{"score":3.13,"max":10,"available":true},"method":"deterministic_v2"}'::jsonb),
    (3, 3, 88.3, 'suggested', '{"amount":{"score":50,"max":50,"difference":0,"sign_flipped":false},"date":{"score":15,"max":20,"difference_days":1},"reference":{"score":0,"max":0,"available":false,"exact":false},"description":{"score":5.64,"max":10,"available":true},"method":"deterministic_v2"}'::jsonb),
    (7, 7, 83.33, 'suggested', '{"amount":{"score":50,"max":50,"difference":0,"sign_flipped":false},"date":{"score":10,"max":20,"difference_days":2},"reference":{"score":0,"max":0,"available":false,"exact":false},"description":{"score":6.67,"max":10,"available":true},"method":"deterministic_v2"}'::jsonb),
    (4, 4, 81.25, 'suggested', '{"amount":{"score":50,"max":50,"difference":0,"sign_flipped":false},"date":{"score":10,"max":20,"difference_days":2},"reference":{"score":0,"max":0,"available":false,"exact":false},"description":{"score":5,"max":10,"available":true},"method":"deterministic_v2"}'::jsonb),
    (9, 9, 81.25, 'suggested', '{"amount":{"score":35,"max":50,"difference":15000,"sign_flipped":true},"date":{"score":20,"max":20,"difference_days":0},"reference":{"score":0,"max":0,"available":false,"exact":false},"description":{"score":10,"max":10,"available":true},"method":"deterministic_v2"}'::jsonb)
  ),
  parsed as materialized (
    select m.*, gen_random_uuid() as gid, la.id as lid, rb.id as rid
    from m
    join public.transactions la on la.run_id = v_run and la.source_side = 'a' and la.row_number = m.l_rn
    join public.transactions rb on rb.run_id = v_run and rb.source_side = 'b' and rb.row_number = m.r_rn
  ),
  g as (
    insert into public.match_groups (id, organization_id, run_id, match_type, confidence, status, explanation, decided_by, decided_at)
    select gid, v_org, v_run, 'one_to_one', score, status, explanation,
           case when status = 'accepted' then v_uid end, case when status = 'accepted' then now() end
    from parsed where status <> 'excluded'
    returning id
  ),
  i as (
    insert into public.match_group_items (match_group_id, transaction_id, organization_id)
    select gid, lid, v_org from parsed where status <> 'excluded'
    union all
    select gid, rid, v_org from parsed where status <> 'excluded'
    returning 1
  ),
  t as (
    update public.transactions x
       set status = case p.status when 'accepted' then 'matched' when 'excluded' then 'excluded' else 'suggested' end
      from (select lid as tx_id, status from parsed union all select rid, status from parsed) p
     where x.id = p.tx_id
    returning 1
  )
  select (select count(*) from g) + (select count(*) from i) + (select count(*) from t) into v_written;

  update public.reconciliation_runs r
     set status = 'prepared',
         source_a_balance = (select sum(amount) from public.transactions where run_id = v_run and source_side = 'a'),
         source_b_balance = (select sum(amount) from public.transactions where run_id = v_run and source_side = 'b'),
         reconciled_amount = (select coalesce(sum(abs(amount)), 0) from public.transactions where run_id = v_run and source_side = 'a' and status = 'matched'),
         matched_transactions = (select count(*) from public.transactions where run_id = v_run and status = 'matched'),
         average_confidence = (select round(avg(confidence), 2) from public.match_groups where run_id = v_run),
         updated_at = now()
   where r.id = v_run;
  update public.reconciliation_runs
     set outstanding_difference = source_a_balance - source_b_balance where id = v_run;

  insert into public.audit_logs (organization_id, actor_id, action, resource_type, resource_id, after_data)
  values (v_org, v_uid, 'reconciliation.processed', 'run', v_run::text, '{"seeded":true,"engine":"deterministic_v2"}');

  -- 6. Exceptions with a comment for the Exceptions page ----------------------
  insert into public.exceptions (organization_id, workspace_id, run_id, transaction_id, category, priority, status, financial_impact, currency, owner_id, due_at)
  select v_org, v_ws, v_run, t.id, 'Unidentified receipt', 'high', 'open', 15750, 'PKR', v_uid, now() + interval '3 days'
  from public.transactions t where t.run_id = v_run and t.source_side = 'a' and t.row_number = 12
  returning id into v_ex1;

  insert into public.exceptions (organization_id, workspace_id, run_id, transaction_id, category, priority, status, financial_impact, currency, owner_id, due_at)
  select v_org, v_ws, v_run, t.id, 'Timing difference', 'medium', 'investigating', 12000, 'PKR', v_uid, now() + interval '7 days'
  from public.transactions t where t.run_id = v_run and t.source_side = 'b' and t.row_number = 12;

  insert into public.comments (organization_id, entity_type, entity_id, body, author_id)
  values (v_org, 'exception', v_ex1, 'Asked the bank for the remitter details on this transfer.', v_uid);

  raise notice 'Demo data created. Sign in as % with the password set at the top of this script.', v_email;
end $$;

-- Result: shows the demo organization and its owner login.
select o.name as organization, o.slug, u.email as login_email, r.name as draft_run, r.status as run_status
from public.organizations o
join public.organization_members m on m.organization_id = o.id and m.role = 'owner'
join auth.users u on u.id = m.user_id
left join public.reconciliation_runs r on r.organization_id = o.id
where o.slug = 'demo-accounting';

-- Seeded outcome (engine deterministic_v2) - what you should see on the results page:
--   accepted : Acme / INV-2001, Office rent / RENT-JAN, Delta Co / INV-2005 (matching references)
--   suggested: Salary, K-Electric, Stripe, Cheque 4512 (same amount, descriptions differ),
--              Beta Traders (amounts differ by 500: never auto-accepted),
--              Customer refund (opposite signs), SaaS subscription (two equal candidates)
--   excluded : the two "Bank charges" rows (rule)
--   unmatched: bank CASH DEPOSIT + UNKNOWN TRANSFER, ledger Prepaid insurance + one SaaS subscription
