-- Papelera Roma se mantiene completamente publica hasta incorporar el login.
-- RLS sigue habilitado y se abren solo las tablas y operaciones que usa la app.

drop policy if exists "categories_public_today" on public.categories;
drop policy if exists "products_public_today" on public.products;
drop policy if exists "prices_public_today" on public.product_prices;
drop policy if exists "price_batches_public_today" on public.price_change_batches;
drop policy if exists "price_changes_public_today" on public.price_changes;

create or replace function public.papelera_public_access_active()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select true; $$;

create or replace function public.is_app_user()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select true; $$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select true; $$;

revoke all on function public.papelera_public_access_active() from public, anon;
revoke all on function public.is_app_user() from public, anon;
revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.papelera_public_access_active() to authenticated;
grant execute on function public.is_app_user() to authenticated;
grant execute on function public.is_app_admin() to authenticated;

create policy "categories_public" on public.categories
for select to anon using (true);

create policy "products_public" on public.products
for select to anon using (true);

create policy "prices_public_read" on public.product_prices
for select to anon using (true);

create policy "price_batches_public_read" on public.price_change_batches
for select to anon using (true);

create policy "price_changes_public_read" on public.price_changes
for select to anon using (true);

create policy "backups_public" on public.catalog_backups
for all to anon using (true) with check (true);

grant usage on schema public to anon;
grant select on public.categories, public.products, public.product_prices,
  public.price_change_batches, public.price_changes to anon;
grant select, insert, update, delete on public.catalog_backups to anon;

alter function public.papelera_set_product_price(uuid,text,numeric) security definer;
alter function public.papelera_set_product_price(uuid,text,numeric) set search_path = public, pg_temp;
alter function public.papelera_apply_price_increase(numeric,text[],text,text,uuid[]) security definer;
alter function public.papelera_apply_price_increase(numeric,text[],text,text,uuid[]) set search_path = public, pg_temp;
alter function public.papelera_create_product(text,text,text,text,jsonb) security definer;
alter function public.papelera_create_product(text,text,text,text,jsonb) set search_path = public, pg_temp;
alter function public.papelera_create_catalog_backup(text) security definer;
alter function public.papelera_create_catalog_backup(text) set search_path = public, pg_temp;
alter function public.papelera_restore_catalog_backup(uuid) security definer;
alter function public.papelera_restore_catalog_backup(uuid) set search_path = public, pg_temp;

revoke all on function public.papelera_set_product_price(uuid,text,numeric) from public;
revoke all on function public.papelera_apply_price_increase(numeric,text[],text,text,uuid[]) from public;
revoke all on function public.papelera_create_product(text,text,text,text,jsonb) from public;
revoke all on function public.papelera_create_catalog_backup(text) from public;
revoke all on function public.papelera_restore_catalog_backup(uuid) from public;

grant execute on function public.papelera_set_product_price(uuid,text,numeric) to anon, authenticated;
grant execute on function public.papelera_apply_price_increase(numeric,text[],text,text,uuid[]) to anon, authenticated;
grant execute on function public.papelera_create_product(text,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.papelera_create_catalog_backup(text) to anon, authenticated;
grant execute on function public.papelera_restore_catalog_backup(uuid) to anon, authenticated;

