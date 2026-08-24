-- Axiom Recon Builder: seed editable plans and verify tenant security.
-- Run last.

insert into public.plans(id,name,monthly_price,annual_price,monthly_transaction_limit,workspace_limit,seat_limit,ai_request_limit,audit_retention_days,is_public)
values
 ('starter','Starter',29,278,5000,3,2,100,365,true),
 ('professional','Professional',79,758,25000,15,8,1000,730,true),
 ('business','Business',199,1910,100000,100,25,5000,2555,true),
 ('enterprise','Enterprise',null,null,1000000,1000,250,50000,3650,true)
on conflict (id) do update set
 name=excluded.name, monthly_price=excluded.monthly_price, annual_price=excluded.annual_price,
 monthly_transaction_limit=excluded.monthly_transaction_limit, workspace_limit=excluded.workspace_limit,
 seat_limit=excluded.seat_limit, ai_request_limit=excluded.ai_request_limit,
 audit_retention_days=excluded.audit_retention_days, is_public=excluded.is_public;

-- Expected: every listed public table has rowsecurity = true.
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles','organizations','organization_members','plans','subscriptions','workspaces','data_sources','reconciliation_runs','transactions','match_groups','match_group_items','exceptions','reconciliation_rules','approvals','comments','audit_logs')
order by tablename;

-- Expected: no rows returned (all foreign-key columns have supporting indexes).
select conrelid::regclass as table_name, a.attname as unindexed_fk
from pg_constraint c
join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
where c.contype='f' and c.connamespace='public'::regnamespace
and not exists (select 1 from pg_index i where i.indrelid=c.conrelid and a.attnum=any(i.indkey));

-- Expected: four seeded plans.
select id,name,monthly_transaction_limit,workspace_limit,seat_limit from public.plans order by monthly_transaction_limit;
