-- Axiom Recon Builder: tenant isolation and onboarding RPC
-- Run after 001_core_saas_schema.sql.

create or replace function private.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create or replace function private.has_org_role(target_org uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any(allowed_roles)
  );
$$;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid,text[]) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid,text[]) to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, country_code)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'country_code')
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.create_organization_with_owner(
  organization_name text,
  organization_slug text,
  organization_business_type text,
  organization_country_code text,
  organization_base_currency text,
  workspace_name text,
  workspace_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_org uuid;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if trim(organization_name) = '' then raise exception 'Organization name is required'; end if;

  insert into public.organizations(name, slug, business_type, country_code, base_currency, status, created_by)
  values (trim(organization_name), lower(trim(organization_slug)), organization_business_type,
    upper(organization_country_code), upper(organization_base_currency), 'trial', caller)
  returning id into new_org;

  insert into public.organization_members(organization_id, user_id, role, status, joined_at)
  values (new_org, caller, 'owner', 'active', now());

  insert into public.subscriptions(organization_id, plan_id, status, trial_ends_at)
  values (new_org, 'professional', 'trialing', now() + interval '14 days');

  insert into public.workspaces(organization_id, name, reconciliation_type, base_currency, created_by)
  values (new_org, trim(workspace_name), workspace_type, upper(organization_base_currency), caller);

  insert into public.audit_logs(organization_id, actor_id, action, resource_type, resource_id, after_data)
  values (new_org, caller, 'organization.created', 'organization', new_org::text,
    jsonb_build_object('name', trim(organization_name), 'workspace', trim(workspace_name)));
  return new_org;
end;
$$;

revoke all on function public.create_organization_with_owner(text,text,text,text,text,text,text) from public, anon;
grant execute on function public.create_organization_with_owner(text,text,text,text,text,text,text) to authenticated;

-- RLS on every public table exposed through the Data API.
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.workspaces enable row level security;
alter table public.data_sources enable row level security;
alter table public.reconciliation_runs enable row level security;
alter table public.transactions enable row level security;
alter table public.match_groups enable row level security;
alter table public.match_group_items enable row level security;
alter table public.exceptions enable row level security;
alter table public.reconciliation_rules enable row level security;
alter table public.approvals enable row level security;
alter table public.comments enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_own_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_own_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy plans_authenticated_read on public.plans for select to authenticated using (is_public = true);

create policy organizations_member_read on public.organizations for select to authenticated using ((select private.is_org_member(id)));
create policy organizations_admin_update on public.organizations for update to authenticated using ((select private.has_org_role(id,array['owner','admin']))) with check ((select private.has_org_role(id,array['owner','admin'])));
create policy organization_members_member_read on public.organization_members for select to authenticated using ((select private.is_org_member(organization_id)));
create policy organization_members_admin_write on public.organization_members for all to authenticated using ((select private.has_org_role(organization_id,array['owner','admin']))) with check ((select private.has_org_role(organization_id,array['owner','admin'])));
create policy subscriptions_admin_read on public.subscriptions for select to authenticated using ((select private.has_org_role(organization_id,array['owner','admin'])));

create policy workspaces_member_read on public.workspaces for select to authenticated using ((select private.is_org_member(organization_id)));
create policy workspaces_preparer_write on public.workspaces for all to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','preparer']))) with check ((select private.has_org_role(organization_id,array['owner','admin','preparer'])));
create policy data_sources_member_read on public.data_sources for select to authenticated using ((select private.is_org_member(organization_id)));
create policy data_sources_preparer_write on public.data_sources for all to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','preparer']))) with check ((select private.has_org_role(organization_id,array['owner','admin','preparer'])));
create policy runs_member_read on public.reconciliation_runs for select to authenticated using ((select private.is_org_member(organization_id)));
create policy runs_finance_write on public.reconciliation_runs for all to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','preparer','reviewer']))) with check ((select private.has_org_role(organization_id,array['owner','admin','preparer','reviewer'])));
create policy transactions_member_read on public.transactions for select to authenticated using ((select private.is_org_member(organization_id)));
create policy transactions_preparer_write on public.transactions for all to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','preparer']))) with check ((select private.has_org_role(organization_id,array['owner','admin','preparer'])));
create policy match_groups_member_read on public.match_groups for select to authenticated using ((select private.is_org_member(organization_id)));
create policy match_groups_finance_write on public.match_groups for all to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','preparer','reviewer']))) with check ((select private.has_org_role(organization_id,array['owner','admin','preparer','reviewer'])));
create policy match_items_member_read on public.match_group_items for select to authenticated using ((select private.is_org_member(organization_id)));
create policy match_items_finance_write on public.match_group_items for all to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','preparer','reviewer']))) with check ((select private.has_org_role(organization_id,array['owner','admin','preparer','reviewer'])));
create policy exceptions_member_read on public.exceptions for select to authenticated using ((select private.is_org_member(organization_id)));
create policy exceptions_finance_write on public.exceptions for all to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','preparer','reviewer']))) with check ((select private.has_org_role(organization_id,array['owner','admin','preparer','reviewer'])));
create policy rules_member_read on public.reconciliation_rules for select to authenticated using ((select private.is_org_member(organization_id)));
create policy rules_preparer_write on public.reconciliation_rules for all to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','preparer']))) with check ((select private.has_org_role(organization_id,array['owner','admin','preparer'])));
create policy approvals_member_read on public.approvals for select to authenticated using ((select private.is_org_member(organization_id)));
create policy approvals_finance_write on public.approvals for all to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','preparer','reviewer']))) with check ((select private.has_org_role(organization_id,array['owner','admin','preparer','reviewer'])));
create policy comments_member_read on public.comments for select to authenticated using ((select private.is_org_member(organization_id)));
create policy comments_member_insert on public.comments for insert to authenticated with check ((select private.is_org_member(organization_id)) and author_id = (select auth.uid()));
create policy comments_author_update on public.comments for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()) and (select private.is_org_member(organization_id)));
create policy audit_logs_member_read on public.audit_logs for select to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','reviewer'])));
