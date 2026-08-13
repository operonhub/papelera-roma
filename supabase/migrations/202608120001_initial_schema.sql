-- Papelera Roma - esquema inicial de produccion
-- Ejecutar en un proyecto Supabase dedicado a Papelera Roma.

create extension if not exists pgcrypto;

-- Operon CRM ya usa public.profiles. La aplicacion de Papelera Roma mantiene
-- sus membresias separadas para no acoplar ni modificar el esquema del CRM.
create table if not exists public.papelera_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'editor' check (role in ('owner', 'admin', 'editor', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Se preservan como categorias distintas las variantes de capitalizacion del archivo fuente.

create table if not exists public.suppliers (
  id bigint generated always as identity primary key,
  name text not null unique,
  phone text,
  email text,
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists suppliers_name_ci_idx on public.suppliers (lower(name));

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category_id bigint not null references public.categories(id),
  supplier_id bigint references public.suppliers(id),
  bulk_quantity text not null default '',
  notes text not null default '',
  source_row integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_code_not_blank check (btrim(code) <> ''),
  constraint products_name_not_blank check (btrim(name) <> ''),
  constraint products_source_row_positive check (source_row is null or source_row > 0)
);

create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_supplier_idx on public.products(supplier_id);
create index if not exists products_active_idx on public.products(active);
create index if not exists products_name_search_idx on public.products using gin (to_tsvector('simple', name));

create table if not exists public.product_prices (
  product_id uuid not null references public.products(id) on delete cascade,
  tier text not null check (tier in ('unidad', 'x10', 'x50', 'x100', 'bulto')),
  amount numeric(14,2) not null check (amount >= 0),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, tier)
);

create index if not exists product_prices_tier_idx on public.product_prices(tier);

create table if not exists public.price_change_batches (
  id uuid primary key default gen_random_uuid(),
  change_type text not null check (change_type in ('manual', 'percentage', 'import', 'restore', 'create')),
  scope_type text not null default 'product' check (scope_type in ('all', 'category', 'supplier', 'selected', 'product', 'import', 'restore')),
  scope_label text not null default '',
  percentage numeric(9,4),
  affected_products integer not null default 0 check (affected_products >= 0),
  affected_prices integer not null default 0 check (affected_prices >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.price_changes (
  id bigint generated always as identity primary key,
  batch_id uuid references public.price_change_batches(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  tier text not null check (tier in ('unidad', 'x10', 'x50', 'x100', 'bulto')),
  old_amount numeric(14,2),
  new_amount numeric(14,2),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists price_changes_product_idx on public.price_changes(product_id, created_at desc);
create index if not exists price_changes_batch_idx on public.price_changes(batch_id);

create table if not exists public.catalog_backups (
  id uuid primary key default gen_random_uuid(),
  label text not null default '',
  product_count integer not null check (product_count >= 0),
  price_count integer not null check (price_count >= 0),
  snapshot jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  tax_id text,
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_not_blank check (btrim(name) <> '')
);

create index if not exists customers_name_idx on public.customers(name);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null default '',
  customer_address text not null default '',
  issued_on date not null default current_date,
  valid_until date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled')),
  notes text not null default '',
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quote_items (
  id bigint generated always as identity primary key,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  position integer not null check (position > 0),
  product_id uuid references public.products(id) on delete set null,
  product_code text not null default '',
  product_name text not null,
  category_name text not null default '',
  price_tier text not null check (price_tier in ('unidad', 'x10', 'x50', 'x100', 'bulto')),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  unique (quote_id, position)
);

create index if not exists quote_items_quote_idx on public.quote_items(quote_id);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  source_file text not null,
  source_sha256 text,
  transformed_sha256 text not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  product_count integer not null default 0,
  category_count integer not null default 0,
  price_count integer not null default 0,
  controls jsonb not null default '{}'::jsonb,
  error_message text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create or replace function public.papelera_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists papelera_profiles_set_updated_at on public.papelera_profiles;
create trigger papelera_profiles_set_updated_at before update on public.papelera_profiles
for each row execute function public.papelera_set_updated_at();

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
for each row execute function public.papelera_set_updated_at();

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at before update on public.suppliers
for each row execute function public.papelera_set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function public.papelera_set_updated_at();

drop trigger if exists product_prices_set_updated_at on public.product_prices;
create trigger product_prices_set_updated_at before update on public.product_prices
for each row execute function public.papelera_set_updated_at();

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers
for each row execute function public.papelera_set_updated_at();

drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at before update on public.quotes
for each row execute function public.papelera_set_updated_at();

create or replace function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.papelera_profiles
    where user_id = auth.uid() and active = true
  );
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.papelera_profiles
    where user_id = auth.uid() and active = true and role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_app_user() from public;
revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_user() to authenticated;
grant execute on function public.is_app_admin() to authenticated;

alter table public.papelera_profiles enable row level security;
alter table public.categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.product_prices enable row level security;
alter table public.price_change_batches enable row level security;
alter table public.price_changes enable row level security;
alter table public.catalog_backups enable row level security;
alter table public.customers enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.import_jobs enable row level security;

create policy "papelera_profiles_read_self_or_admin" on public.papelera_profiles for select to authenticated
using (user_id = auth.uid() or public.is_app_admin());
create policy "papelera_profiles_admin_write" on public.papelera_profiles for all to authenticated
using (public.is_app_admin()) with check (public.is_app_admin());

create policy "categories_app_read" on public.categories for select to authenticated using (public.is_app_user());
create policy "categories_admin_write" on public.categories for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "suppliers_app_read" on public.suppliers for select to authenticated using (public.is_app_user());
create policy "suppliers_admin_write" on public.suppliers for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "products_app_read" on public.products for select to authenticated using (public.is_app_user());
create policy "products_app_write" on public.products for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy "prices_app_read" on public.product_prices for select to authenticated using (public.is_app_user());
create policy "prices_app_write" on public.product_prices for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy "price_batches_app" on public.price_change_batches for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy "price_changes_app" on public.price_changes for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy "backups_app_read" on public.catalog_backups for select to authenticated using (public.is_app_user());
create policy "backups_admin_write" on public.catalog_backups for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "customers_app" on public.customers for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy "quotes_app" on public.quotes for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy "quote_items_app" on public.quote_items for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy "imports_admin_read" on public.import_jobs for select to authenticated using (public.is_app_admin());

grant select, insert, update, delete on public.papelera_profiles to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.suppliers to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.product_prices to authenticated;
grant select, insert, update, delete on public.price_change_batches to authenticated;
grant select, insert, update, delete on public.price_changes to authenticated;
grant select, insert, update, delete on public.catalog_backups to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.quotes to authenticated;
grant select, insert, update, delete on public.quote_items to authenticated;
grant select on public.import_jobs to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Despues de crear/invitar al primer usuario en Authentication, convertirlo en propietario:
-- insert into public.papelera_profiles (user_id, display_name, role)
-- select id, coalesce(email, 'Administrador'), 'owner' from auth.users where email = 'EMAIL_DEL_CLIENTE';
