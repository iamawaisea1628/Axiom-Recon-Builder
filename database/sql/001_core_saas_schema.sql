-- Axiom Recon Builder: core SaaS schema
-- Run first in the Supabase SQL Editor.

create extension if not exists pgcrypto;
create schema if not exists private;

-- Stop before making changes if this project contains the incompatible prototype table.
do $$
begin
  if to_regclass('public.transactions') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='transactions' and column_name='organization_id'
  ) then
    raise exception 'Legacy Axiom transactions table detected. Stop and migrate/rename the prototype tables before running this SaaS schema.';
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  country_code text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  business_type text not null check (business_type in ('accounting_firm','bookkeeping_team','finance_department','business','other')),
  country_code text not null,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'UTC',
  fiscal_year_end_month smallint not null default 12 check (fiscal_year_end_month between 1 and 12),
  status text not null default 'active' check (status in ('trial','active','past_due','suspended','cancelled')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','preparer','reviewer','viewer')),
  status text not null default 'active' check (status in ('invited','active','suspended')),
  invited_by uuid references auth.users(id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.plans (
  id text primary key,
  name text not null,
  monthly_price numeric(12,2),
  annual_price numeric(12,2),
  monthly_transaction_limit bigint not null check (monthly_transaction_limit > 0),
  workspace_limit integer not null check (workspace_limit > 0),
  seat_limit integer not null check (seat_limit > 0),
  ai_request_limit bigint not null default 0 check (ai_request_limit >= 0),
  audit_retention_days integer not null default 365 check (audit_retention_days > 0),
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan_id text not null references public.plans(id),
  provider_customer_id text,
  provider_subscription_id text unique,
  status text not null default 'trialing' check (status in ('trialing','active','past_due','grace_period','paused','cancelled','expired')),
  billing_interval text check (billing_interval in ('month','year')),
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 160),
  description text,
  reconciliation_type text not null check (reconciliation_type in ('bank','payment_settlement','receivables','payables','intercompany','other')),
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  frequency text not null default 'monthly' check (frequency in ('daily','weekly','monthly','quarterly','annual','ad_hoc')),
  preparer_id uuid references auth.users(id),
  reviewer_id uuid references auth.users(id),
  status text not null default 'active' check (status in ('draft','active','paused','archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  side text not null check (side in ('a','b')),
  source_type text not null check (source_type in ('csv','xlsx','quickbooks','xero','stripe','shopify','api','other')),
  name text not null,
  configuration jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','disconnected','error','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  period_start date,
  period_end date,
  status text not null default 'draft' check (status in ('draft','processing','prepared','in_review','approved','returned','failed','cancelled')),
  source_a_balance numeric(20,4),
  source_b_balance numeric(20,4),
  reconciled_amount numeric(20,4) not null default 0,
  outstanding_difference numeric(20,4) not null default 0,
  total_transactions bigint not null default 0,
  matched_transactions bigint not null default 0,
  average_confidence numeric(5,2),
  prepared_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  approved_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  source_id uuid references public.data_sources(id),
  source_side text not null check (source_side in ('a','b')),
  external_id text,
  transaction_date date not null,
  description text,
  reference text,
  amount numeric(20,4) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  normalized_data jsonb not null default '{}'::jsonb,
  row_number bigint,
  status text not null default 'unmatched' check (status in ('unmatched','suggested','matched','exception','excluded','duplicate')),
  created_at timestamptz not null default now()
);

create table if not exists public.match_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  match_type text not null check (match_type in ('one_to_one','one_to_many','many_to_one','many_to_many')),
  confidence numeric(5,2) check (confidence between 0 and 100),
  status text not null default 'suggested' check (status in ('suggested','accepted','rejected','returned')),
  explanation jsonb not null default '{}'::jsonb,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.match_group_items (
  match_group_id uuid not null references public.match_groups(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  primary key (match_group_id, transaction_id)
);

create table if not exists public.exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete set null,
  category text not null,
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','investigating','waiting','resolved','ignored','reopened')),
  financial_impact numeric(20,4),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  owner_id uuid references auth.users(id),
  due_at timestamptz,
  resolution text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reconciliation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  priority integer not null default 100,
  conditions jsonb not null,
  actions jsonb not null,
  status text not null default 'draft' check (status in ('draft','active','disabled','archived')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  assigned_to uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending','approved','returned','cancelled')),
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('run','match','exception','rule')),
  entity_id uuid not null,
  body text not null check (char_length(trim(body)) > 0),
  author_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  reason text,
  before_data jsonb,
  after_data jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  ip_address inet,
  created_at timestamptz not null default now()
);

-- Foreign keys and tenant access paths must be indexed explicitly in Postgres.
create index if not exists organization_members_user_idx on public.organization_members(user_id, status);
create index if not exists organizations_created_by_idx on public.organizations(created_by);
create index if not exists organization_members_invited_by_idx on public.organization_members(invited_by) where invited_by is not null;
create index if not exists subscriptions_plan_idx on public.subscriptions(plan_id);
create index if not exists workspaces_org_status_idx on public.workspaces(organization_id, status);
create index if not exists workspaces_preparer_idx on public.workspaces(preparer_id) where preparer_id is not null;
create index if not exists workspaces_reviewer_idx on public.workspaces(reviewer_id) where reviewer_id is not null;
create index if not exists workspaces_created_by_idx on public.workspaces(created_by);
create index if not exists data_sources_workspace_idx on public.data_sources(workspace_id);
create index if not exists reconciliation_runs_workspace_period_idx on public.reconciliation_runs(workspace_id, period_end desc);
create index if not exists reconciliation_runs_org_status_idx on public.reconciliation_runs(organization_id, status);
create index if not exists reconciliation_runs_prepared_by_idx on public.reconciliation_runs(prepared_by) where prepared_by is not null;
create index if not exists reconciliation_runs_reviewed_by_idx on public.reconciliation_runs(reviewed_by) where reviewed_by is not null;
create index if not exists transactions_run_side_date_idx on public.transactions(run_id, source_side, transaction_date);
create index if not exists transactions_org_status_idx on public.transactions(organization_id, status);
create index if not exists transactions_reference_idx on public.transactions(organization_id, reference) where reference is not null;
create index if not exists transactions_workspace_idx on public.transactions(workspace_id);
create index if not exists transactions_source_idx on public.transactions(source_id) where source_id is not null;
create index if not exists match_groups_run_status_idx on public.match_groups(run_id, status);
create index if not exists match_groups_org_idx on public.match_groups(organization_id);
create index if not exists match_groups_decided_by_idx on public.match_groups(decided_by) where decided_by is not null;
create index if not exists match_group_items_transaction_idx on public.match_group_items(transaction_id);
create index if not exists match_group_items_org_idx on public.match_group_items(organization_id);
create index if not exists exceptions_org_status_due_idx on public.exceptions(organization_id, status, due_at);
create index if not exists exceptions_workspace_idx on public.exceptions(workspace_id);
create index if not exists exceptions_run_idx on public.exceptions(run_id);
create index if not exists exceptions_transaction_idx on public.exceptions(transaction_id) where transaction_id is not null;
create index if not exists exceptions_owner_status_idx on public.exceptions(owner_id, status) where owner_id is not null;
create index if not exists exceptions_resolved_by_idx on public.exceptions(resolved_by) where resolved_by is not null;
create index if not exists reconciliation_rules_org_status_idx on public.reconciliation_rules(organization_id, status);
create index if not exists reconciliation_rules_workspace_idx on public.reconciliation_rules(workspace_id) where workspace_id is not null;
create index if not exists reconciliation_rules_created_by_idx on public.reconciliation_rules(created_by);
create index if not exists approvals_assignee_status_idx on public.approvals(assigned_to, status) where assigned_to is not null;
create index if not exists approvals_org_idx on public.approvals(organization_id);
create index if not exists approvals_run_idx on public.approvals(run_id);
create index if not exists approvals_requested_by_idx on public.approvals(requested_by);
create index if not exists comments_entity_idx on public.comments(entity_type, entity_id, created_at);
create index if not exists comments_org_idx on public.comments(organization_id);
create index if not exists comments_author_idx on public.comments(author_id);
create index if not exists audit_logs_org_created_idx on public.audit_logs(organization_id, created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id) where actor_id is not null;

-- Exposed tables receive no anonymous access.
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.organizations, public.organization_members,
  public.workspaces, public.data_sources, public.reconciliation_runs, public.transactions,
  public.match_groups, public.match_group_items, public.exceptions, public.reconciliation_rules,
  public.approvals, public.comments to authenticated;
grant select on public.plans, public.subscriptions, public.audit_logs to authenticated;
grant usage, select on all sequences in schema public to authenticated;
