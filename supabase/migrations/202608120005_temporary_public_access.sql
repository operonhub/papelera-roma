-- Acceso publico temporal solicitado para probar las funciones reales.
-- Vence automaticamente a las 00:00 de Argentina del 13/08/2026.

create or replace function public.papelera_public_access_active()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select now() < timestamptz '2026-08-13 03:00:00+00';
$$;

revoke all on function public.papelera_public_access_active() from public;
grant execute on function public.papelera_public_access_active() to anon, authenticated;

create or replace function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.papelera_public_access_active() or exists (
    select 1
    from public.papelera_profiles
    where user_id = (select auth.uid()) and active = true
  );
$$;

revoke all on function public.is_app_user() from public;
grant execute on function public.is_app_user() to anon, authenticated;

create policy "categories_public_today" on public.categories
for select to anon
using ((select public.papelera_public_access_active()));

create policy "products_public_today" on public.products
for select to anon
using ((select public.papelera_public_access_active()));

create policy "prices_public_today" on public.product_prices
for select to anon
using ((select public.papelera_public_access_active()));

create policy "price_batches_public_today" on public.price_change_batches
for select to anon
using ((select public.papelera_public_access_active()));

-- Las funciones se ejecutan con permisos del propietario, pero conservan la
-- validacion explicita de is_app_user(). Esto evita exponer escrituras directas.
alter function public.papelera_set_product_price(uuid,text,numeric) security definer;
alter function public.papelera_set_product_price(uuid,text,numeric) set search_path = public, pg_temp;
alter function public.papelera_apply_price_increase(numeric,text[],text,text,uuid[]) security definer;
alter function public.papelera_apply_price_increase(numeric,text[],text,text,uuid[]) set search_path = public, pg_temp;

grant usage on schema public to anon;
grant select on public.categories to anon;
grant select on public.products to anon;
grant select on public.product_prices to anon;
grant select on public.price_change_batches to anon;

revoke insert, update, delete on public.product_prices from anon;
revoke insert, update, delete on public.price_change_batches from anon;
revoke all on public.price_changes from anon;
revoke all on sequence public.price_changes_id_seq from anon;

grant execute on function public.papelera_set_product_price(uuid,text,numeric) to anon;
grant execute on function public.papelera_apply_price_increase(numeric,text[],text,text,uuid[]) to anon;
