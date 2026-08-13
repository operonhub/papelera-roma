-- Mantener las funciones SECURITY DEFINER fuera del esquema expuesto.
create schema if not exists papelera_private;
revoke all on schema papelera_private from public, anon;
grant usage on schema papelera_private to authenticated;

create or replace function papelera_private.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.papelera_profiles
    where user_id = (select auth.uid()) and active = true
  );
$$;

create or replace function papelera_private.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.papelera_profiles
    where user_id = (select auth.uid()) and active = true and role in ('owner', 'admin')
  );
$$;

revoke all on function papelera_private.is_app_user() from public, anon;
revoke all on function papelera_private.is_app_admin() from public, anon;
grant execute on function papelera_private.is_app_user() to authenticated;
grant execute on function papelera_private.is_app_admin() to authenticated;

create or replace function public.is_app_user()
returns boolean
language sql
stable
security invoker
set search_path = papelera_private, pg_temp
as $$ select papelera_private.is_app_user(); $$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security invoker
set search_path = papelera_private, pg_temp
as $$ select papelera_private.is_app_admin(); $$;

revoke all on function public.is_app_user() from public, anon;
revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_user() to authenticated;
grant execute on function public.is_app_admin() to authenticated;
