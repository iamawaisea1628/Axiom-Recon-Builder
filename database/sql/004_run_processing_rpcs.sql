-- Axiom Recon Builder: atomic run-processing functions.
-- Run after 003_seed_plans_and_verify.sql.
--
-- Both functions are SECURITY DEFINER so they can write audit_logs (which clients
-- cannot insert into directly), but they authorise the caller themselves through
-- private.has_org_role() and only ever touch rows of the run's own organization.

-- Parses and validates the matches payload sent by the Vercel function.
create or replace function private.parse_matches(p_matches jsonb)
returns table (ord bigint, left_id uuid, right_id uuid, score numeric, status text, explanation jsonb)
language sql
immutable
set search_path = ''
as $$
  select e.ord,
         (e.m ->> 'left_id')::uuid,
         (e.m ->> 'right_id')::uuid,
         (e.m ->> 'score')::numeric,
         e.m ->> 'status',
         coalesce(e.m -> 'explanation', '{}'::jsonb)
  from jsonb_array_elements(p_matches) with ordinality as e(m, ord);
$$;
revoke all on function private.parse_matches(jsonb) from public, anon;
grant execute on function private.parse_matches(jsonb) to authenticated;

create or replace function public.apply_run_matches(
  p_run_id uuid,
  p_matches jsonb,
  p_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  v_run public.reconciliation_runs%rowtype;
  v_total bigint;
  v_invalid bigint;
  v_balance_a numeric;
  v_balance_b numeric;
  v_matched bigint;
  v_reconciled numeric;
  v_groups bigint;
  v_accepted bigint;
  v_suggested bigint;
  v_excluded bigint;
  v_avg numeric;
  v_written bigint;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then
    raise exception 'p_matches must be a JSON array';
  end if;

  -- Lock the run so two concurrent "Run matching" clicks cannot both write results.
  select * into v_run from public.reconciliation_runs where id = p_run_id for update;
  if not found or not (select private.has_org_role(v_run.organization_id, array['owner','admin','preparer'])) then
    raise exception 'Run not found or access denied' using errcode = '42501';
  end if;
  if v_run.status not in ('draft','failed') then
    raise exception 'Only draft or failed runs can be processed';
  end if;
  if v_run.locked_at is not null then raise exception 'This run is locked'; end if;

  select count(*) into v_total from public.transactions
   where run_id = p_run_id and organization_id = v_run.organization_id;
  if v_total = 0 then raise exception 'This run has no staged transactions'; end if;

  -- Validate: statuses, score range, each transaction belongs to this run on the correct
  -- side, and every transaction appears in at most one match.
  select count(*) into v_invalid
  from private.parse_matches(p_matches) m
  where m.status is null or m.status not in ('accepted','suggested','excluded')
     or m.score is null or m.score < 0 or m.score > 100
     or not exists (select 1 from public.transactions t where t.id = m.left_id and t.run_id = p_run_id
                    and t.organization_id = v_run.organization_id and t.source_side = 'a')
     or not exists (select 1 from public.transactions t where t.id = m.right_id and t.run_id = p_run_id
                    and t.organization_id = v_run.organization_id and t.source_side = 'b');
  if v_invalid > 0 then raise exception 'Invalid matches payload (% rows rejected)', v_invalid; end if;

  if (select count(distinct left_id) <> count(*) or count(distinct right_id) <> count(*)
        from private.parse_matches(p_matches)) then
    raise exception 'A transaction appears in more than one match';
  end if;

  -- Replace any previous results for this run.
  delete from public.match_groups where run_id = p_run_id and organization_id = v_run.organization_id;
  update public.transactions set status = 'unmatched'
   where run_id = p_run_id and organization_id = v_run.organization_id;

  with parsed as materialized (
    select m.*, gen_random_uuid() as gid from private.parse_matches(p_matches) m where m.status <> 'excluded'
  ),
  g as (
    insert into public.match_groups (id, organization_id, run_id, match_type, confidence, status, explanation, decided_by, decided_at)
    select gid, v_run.organization_id, p_run_id, 'one_to_one', score, status, explanation,
           case when status = 'accepted' then caller end,
           case when status = 'accepted' then now() end
    from parsed
    returning id
  ),
  i as (
    insert into public.match_group_items (match_group_id, transaction_id, organization_id)
    select gid, left_id, v_run.organization_id from parsed
    union all
    select gid, right_id, v_run.organization_id from parsed
    returning 1
  )
  select (select count(*) from g) + (select count(*) from i) into v_written;

  update public.transactions t
     set status = case m.status when 'accepted' then 'matched' when 'excluded' then 'excluded' else 'suggested' end
    from (select left_id as tx_id, status from private.parse_matches(p_matches)
          union all
          select right_id, status from private.parse_matches(p_matches)) m
   where t.id = m.tx_id and t.run_id = p_run_id and t.organization_id = v_run.organization_id;

  -- Totals are computed from the stored rows, never trusted from the client.
  select coalesce(sum(amount) filter (where source_side = 'a'), 0),
         coalesce(sum(amount) filter (where source_side = 'b'), 0),
         count(*) filter (where status = 'matched'),
         coalesce(sum(abs(amount)) filter (where source_side = 'a' and status = 'matched'), 0)
    into v_balance_a, v_balance_b, v_matched, v_reconciled
    from public.transactions where run_id = p_run_id and organization_id = v_run.organization_id;

  select count(*), count(*) filter (where status = 'accepted'), count(*) filter (where status = 'suggested'), avg(confidence)
    into v_groups, v_accepted, v_suggested, v_avg
    from public.match_groups where run_id = p_run_id and organization_id = v_run.organization_id;
  select count(*) into v_excluded from public.transactions
   where run_id = p_run_id and organization_id = v_run.organization_id and status = 'excluded';

  update public.reconciliation_runs
     set status = 'prepared', source_a_balance = v_balance_a, source_b_balance = v_balance_b,
         reconciled_amount = v_reconciled, outstanding_difference = v_balance_a - v_balance_b,
         total_transactions = v_total, matched_transactions = v_matched,
         average_confidence = round(coalesce(v_avg, 0), 2), prepared_by = caller, updated_at = now()
   where id = p_run_id;

  insert into public.audit_logs (organization_id, actor_id, action, resource_type, resource_id, after_data)
  values (v_run.organization_id, caller, 'reconciliation.processed', 'run', p_run_id::text,
          jsonb_build_object('total', v_total, 'groups', v_groups, 'auto_matched', v_matched,
                             'suggested', v_suggested, 'excluded_transactions', v_excluded,
                             'details', coalesce(p_summary, '{}'::jsonb)));

  return jsonb_build_object('run_id', p_run_id, 'total_transactions', v_total, 'match_groups', v_groups,
                            'auto_matched', v_matched, 'suggested', v_suggested,
                            'excluded_transactions', v_excluded, 'average_confidence', round(coalesce(v_avg, 0), 2));
end;
$$;

revoke all on function public.apply_run_matches(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.apply_run_matches(uuid, jsonb, jsonb) to authenticated;

create or replace function public.decide_match(p_run_id uuid, p_group_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  v_run public.reconciliation_runs%rowtype;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_decision not in ('accepted','rejected') then raise exception 'Decision must be accepted or rejected'; end if;

  select * into v_run from public.reconciliation_runs where id = p_run_id for update;
  if not found or not (select private.has_org_role(v_run.organization_id, array['owner','admin','preparer','reviewer'])) then
    raise exception 'Run not found or access denied' using errcode = '42501';
  end if;
  if v_run.status not in ('prepared','in_review','returned') or v_run.locked_at is not null then
    raise exception 'This run is % and can no longer be changed', case when v_run.locked_at is not null then 'locked' else v_run.status end;
  end if;

  update public.match_groups set status = p_decision, decided_by = caller, decided_at = now()
   where id = p_group_id and run_id = p_run_id and organization_id = v_run.organization_id;
  if not found then raise exception 'Match group not found'; end if;

  update public.transactions t
     set status = case when p_decision = 'accepted' then 'matched' else 'unmatched' end
    from public.match_group_items i
   where i.match_group_id = p_group_id and t.id = i.transaction_id and t.organization_id = v_run.organization_id;

  update public.reconciliation_runs r
     set matched_transactions = (select count(*) from public.transactions where run_id = p_run_id and status = 'matched'),
         reconciled_amount = (select coalesce(sum(abs(amount)), 0) from public.transactions
                               where run_id = p_run_id and source_side = 'a' and status = 'matched'),
         updated_at = now()
   where r.id = p_run_id;

  insert into public.audit_logs (organization_id, actor_id, action, resource_type, resource_id, after_data)
  values (v_run.organization_id, caller, 'match.' || p_decision, 'match', p_group_id::text,
          jsonb_build_object('run_id', p_run_id));

  return jsonb_build_object('group_id', p_group_id, 'status', p_decision);
end;
$$;

revoke all on function public.decide_match(uuid, uuid, text) from public, anon;
grant execute on function public.decide_match(uuid, uuid, text) to authenticated;
