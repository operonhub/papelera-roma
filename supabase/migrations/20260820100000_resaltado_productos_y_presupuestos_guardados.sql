-- Resaltado de productos (solo en pantalla) y presupuestos guardados en la nube.

alter table public.products
  add column if not exists highlight text;
alter table public.products
  drop constraint if exists products_highlight_valid;
alter table public.products
  add constraint products_highlight_valid
  check (highlight is null or highlight in ('amarillo','verde','rosa'));

drop function if exists public.papelera_create_product_v2(text,text,text,text,text,jsonb,text,text);
create or replace function public.papelera_create_product_v2(
  p_name text,
  p_category text,
  p_bulk_quantity text default '',
  p_presentation text default '',
  p_notes text default '',
  p_prices jsonb default '{}'::jsonb,
  p_catalog_slug text default 'papelera',
  p_code text default null,
  p_highlight text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_catalog_id bigint;
  v_category_id bigint;
  v_product_id uuid:=gen_random_uuid();
  v_code text;
  v_highlight text;
  v_next integer;
  v_price record;
  v_price_count integer:=0;
  v_display_order integer;
  v_category_order integer;
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  select id into v_catalog_id
  from public.catalogs
  where slug=p_catalog_slug and active=true
  for update;
  if v_catalog_id is null then raise exception 'Lista no encontrada'; end if;
  if btrim(coalesce(p_name,''))='' or btrim(coalesce(p_category,''))='' then
    raise exception 'Nombre y categoria son obligatorios';
  end if;

  v_highlight:=nullif(btrim(coalesce(p_highlight,'')),'');
  if v_highlight is not null and v_highlight not in ('amarillo','verde','rosa') then
    raise exception 'Color de resaltado invalido';
  end if;

  if nullif(btrim(coalesce(p_code,'')),'') is null then
    if p_catalog_slug='heladeria' then
      select coalesce(max(substring(code from 2)::integer),0)+1 into v_next
      from public.products
      where catalog_id=v_catalog_id and code ~ '^H[1-9][0-9]*$';
      v_code:='H'||v_next::text;
    else
      select coalesce(max(substring(code from 1 for 5)::integer),0)+1 into v_next
      from public.products
      where catalog_id=v_catalog_id
        and code ~ '^[0-9]{5}-P$'
        and substring(code from 1 for 5)::integer between 1 and 69999;
      if v_next>69999 then raise exception 'No quedan codigos disponibles'; end if;
      v_code:=lpad(v_next::text,5,'0')||'-P';
    end if;
  else
    v_code:=upper(btrim(p_code));
    if p_catalog_slug='heladeria' then
      if v_code !~ '^H[1-9][0-9]*$' then
        raise exception 'El codigo debe tener el formato H1';
      end if;
    else
      if v_code !~ '^[0-9]{5}-P$'
         or substring(v_code from 1 for 5)::integer not between 1 and 69999 then
        raise exception 'El codigo debe tener el formato 00001-P';
      end if;
    end if;
    if exists(select 1 from public.products where code=v_code) then
      raise exception 'Ese codigo ya esta en uso';
    end if;
  end if;

  select coalesce(max(display_order),0)+1 into v_category_order
  from public.categories where catalog_id=v_catalog_id and active=true;
  insert into public.categories(catalog_id,name,display_order,active)
  values(v_catalog_id,btrim(p_category),v_category_order,true)
  on conflict(catalog_id,name) do update set active=true
  returning id into v_category_id;

  select coalesce(max(display_order),0)+1 into v_display_order
  from public.products
  where category_id=v_category_id and active=true;

  insert into public.products(
    id,code,name,catalog_id,category_id,bulk_quantity,presentation,notes,display_order,active,highlight
  ) values(
    v_product_id,v_code,btrim(p_name),v_catalog_id,v_category_id,
    coalesce(p_bulk_quantity,''),coalesce(p_presentation,''),coalesce(p_notes,''),
    v_display_order,true,v_highlight
  );

  for v_price in select key,value from jsonb_each_text(coalesce(p_prices,'{}'::jsonb)) loop
    if v_price.key not in ('unidad','x10','x50','x100','bulto','precio') then
      raise exception 'Presentacion invalida';
    end if;
    if v_price.value::numeric<0 then raise exception 'Precio invalido'; end if;
    insert into public.product_prices(product_id,tier,amount,updated_by)
    values(v_product_id,v_price.key,round(v_price.value::numeric,2),auth.uid());
    v_price_count:=v_price_count+1;
  end loop;

  insert into public.price_change_batches(
    change_type,scope_type,scope_label,affected_products,affected_prices,created_by
  ) values('create','product',btrim(p_name),1,v_price_count,auth.uid());
  return v_product_id;
end;
$$;

drop function if exists public.papelera_update_product_v2(uuid,text,text,text,text,text,text);
create or replace function public.papelera_update_product_v2(
  p_product_id uuid,
  p_name text,
  p_category text,
  p_bulk_quantity text default '',
  p_presentation text default '',
  p_notes text default '',
  p_code text default null,
  p_highlight text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_catalog_id bigint;
  v_catalog_slug text;
  v_old_category_id bigint;
  v_category_id bigint;
  v_display_order integer;
  v_category_order integer;
  v_code text;
  v_highlight text;
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  if btrim(coalesce(p_name,''))='' or btrim(coalesce(p_category,''))='' then
    raise exception 'Nombre y categoria son obligatorios';
  end if;

  v_highlight:=nullif(btrim(coalesce(p_highlight,'')),'');
  if v_highlight is not null and v_highlight not in ('amarillo','verde','rosa') then
    raise exception 'Color de resaltado invalido';
  end if;

  select p.catalog_id,p.category_id,ca.slug
  into v_catalog_id,v_old_category_id,v_catalog_slug
  from public.products p
  join public.catalogs ca on ca.id=p.catalog_id
  where p.id=p_product_id and p.active=true
  for update of p;
  if v_catalog_id is null then raise exception 'Producto no encontrado'; end if;

  v_code:=upper(btrim(coalesce(p_code,'')));
  if v_catalog_slug='heladeria' then
    if v_code !~ '^H[1-9][0-9]*$' then
      raise exception 'El codigo debe tener el formato H1';
    end if;
  else
    if v_code !~ '^[0-9]{5}-P$'
       or substring(v_code from 1 for 5)::integer not between 1 and 69999 then
      raise exception 'El codigo debe tener el formato 00001-P';
    end if;
  end if;
  if exists(select 1 from public.products where code=v_code and id<>p_product_id) then
    raise exception 'Ese codigo ya esta en uso';
  end if;

  select coalesce(max(display_order),0)+1 into v_category_order
  from public.categories where catalog_id=v_catalog_id and active=true;
  insert into public.categories(catalog_id,name,display_order,active)
  values(v_catalog_id,btrim(p_category),v_category_order,true)
  on conflict(catalog_id,name) do update set active=true
  returning id into v_category_id;

  if v_category_id<>v_old_category_id then
    select coalesce(max(display_order),0)+1 into v_display_order
    from public.products
    where category_id=v_category_id and active=true;
  end if;

  update public.products
  set code=v_code,
      name=btrim(p_name),
      category_id=v_category_id,
      bulk_quantity=coalesce(p_bulk_quantity,''),
      presentation=coalesce(p_presentation,''),
      notes=coalesce(p_notes,''),
      highlight=v_highlight,
      display_order=case when v_category_id<>v_old_category_id then v_display_order else display_order end
  where id=p_product_id and active=true;

  return jsonb_build_object('id',p_product_id,'updated',true,'code',v_code);
end;
$$;

revoke all on function public.papelera_create_product_v2(text,text,text,text,text,jsonb,text,text,text) from public;
revoke all on function public.papelera_update_product_v2(uuid,text,text,text,text,text,text,text) from public;
grant execute on function public.papelera_create_product_v2(text,text,text,text,text,jsonb,text,text,text) to anon,authenticated;
grant execute on function public.papelera_update_product_v2(uuid,text,text,text,text,text,text,text) to anon,authenticated;

-- Presupuestos guardados: se listan/crean/actualizan/eliminan igual que las
-- copias de catalogo, con lectura y escritura publica (misma politica que
-- catalog_backups, ya que la app no tiene login).

create table if not exists public.saved_quotes (
  id uuid primary key default gen_random_uuid(),
  label text not null default '',
  item_count integer not null default 0,
  total numeric not null default 0,
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists saved_quotes_updated_idx on public.saved_quotes(updated_at desc);

alter table public.saved_quotes enable row level security;

drop policy if exists "saved_quotes_public" on public.saved_quotes;
create policy "saved_quotes_public" on public.saved_quotes
for all to anon using (true) with check (true);

grant select, insert, update, delete on public.saved_quotes to anon;
