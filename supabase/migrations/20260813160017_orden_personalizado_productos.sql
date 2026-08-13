-- Orden manual de productos dentro de cada categoria.

alter table public.products
  add column if not exists display_order integer;

with ranked as (
  select id,
         row_number() over (
           partition by category_id
           order by source_row nulls last, name, id
         )::integer as position
  from public.products
)
update public.products p
set display_order=ranked.position
from ranked
where ranked.id=p.id
  and p.display_order is null;

alter table public.products
  alter column display_order set default 0,
  alter column display_order set not null;

alter table public.products
  drop constraint if exists products_display_order_nonnegative;
alter table public.products
  add constraint products_display_order_nonnegative check (display_order >= 0);

create index if not exists products_category_order_idx
  on public.products(category_id,active,display_order,name);

create or replace function public.papelera_reorder_products(
  p_category_id bigint,
  p_product_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_expected integer;
  v_valid integer;
  v_unique integer;
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  if p_product_ids is null or cardinality(p_product_ids)=0 then
    raise exception 'La categoria no tiene productos para ordenar';
  end if;

  perform 1
  from public.categories
  where id=p_category_id and active=true
  for update;
  if not found then raise exception 'Categoria no encontrada'; end if;

  perform 1
  from public.products
  where category_id=p_category_id and active=true
  order by id
  for update;

  select count(*)::integer into v_expected
  from public.products
  where category_id=p_category_id and active=true;

  select count(distinct product_id)::integer into v_unique
  from unnest(p_product_ids) as ordered(product_id);

  select count(*)::integer into v_valid
  from public.products
  where category_id=p_category_id
    and active=true
    and id=any(p_product_ids);

  if cardinality(p_product_ids)<>v_expected
     or v_unique<>v_expected
     or v_valid<>v_expected then
    raise exception 'El orden debe incluir una sola vez todos los productos activos de la categoria';
  end if;

  update public.products p
  set display_order=ordered.position::integer
  from unnest(p_product_ids) with ordinality as ordered(product_id,position)
  where p.id=ordered.product_id
    and p.category_id=p_category_id
    and p.active=true;

  return jsonb_build_object('category_id',p_category_id,'products',v_expected);
end;
$$;

create or replace function public.papelera_create_product(
  p_name text,
  p_category text,
  p_bulk_quantity text default '',
  p_presentation text default '',
  p_notes text default '',
  p_prices jsonb default '{}'::jsonb,
  p_catalog_slug text default 'papelera'
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
  v_price record;
  v_price_count integer:=0;
  v_display_order integer;
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  select id into v_catalog_id from public.catalogs where slug=p_catalog_slug and active=true;
  if v_catalog_id is null then raise exception 'Lista no encontrada'; end if;
  if btrim(coalesce(p_name,''))='' or btrim(coalesce(p_category,''))='' then
    raise exception 'Nombre y categoria son obligatorios';
  end if;

  insert into public.categories(catalog_id,name,active)
  values(v_catalog_id,btrim(p_category),true)
  on conflict(catalog_id,name) do update set active=true
  returning id into v_category_id;

  select coalesce(max(display_order),0)+1 into v_display_order
  from public.products
  where category_id=v_category_id and active=true;

  v_code:=upper(left(p_catalog_slug,3))||'-'||upper(replace(v_product_id::text,'-',''));
  insert into public.products(
    id,code,name,catalog_id,category_id,bulk_quantity,presentation,notes,display_order,active
  ) values(
    v_product_id,v_code,btrim(p_name),v_catalog_id,v_category_id,
    coalesce(p_bulk_quantity,''),coalesce(p_presentation,''),coalesce(p_notes,''),
    v_display_order,true
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

create or replace function public.papelera_update_product(
  p_product_id uuid,
  p_name text,
  p_category text,
  p_bulk_quantity text default '',
  p_presentation text default '',
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_catalog_id bigint;
  v_old_category_id bigint;
  v_category_id bigint;
  v_display_order integer;
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  if btrim(coalesce(p_name,''))='' or btrim(coalesce(p_category,''))='' then
    raise exception 'Nombre y categoria son obligatorios';
  end if;

  select catalog_id,category_id into v_catalog_id,v_old_category_id
  from public.products
  where id=p_product_id and active=true
  for update;
  if v_catalog_id is null then raise exception 'Producto no encontrado'; end if;

  insert into public.categories(catalog_id,name,active)
  values(v_catalog_id,btrim(p_category),true)
  on conflict(catalog_id,name) do update set active=true
  returning id into v_category_id;

  if v_category_id<>v_old_category_id then
    select coalesce(max(display_order),0)+1 into v_display_order
    from public.products
    where category_id=v_category_id and active=true;
  end if;

  update public.products
  set name=btrim(p_name),
      category_id=v_category_id,
      bulk_quantity=coalesce(p_bulk_quantity,''),
      presentation=coalesce(p_presentation,''),
      notes=coalesce(p_notes,''),
      display_order=case when v_category_id<>v_old_category_id then v_display_order else display_order end
  where id=p_product_id and active=true;

  return jsonb_build_object('id',p_product_id,'updated',true);
end;
$$;

create or replace function public.papelera_create_catalog_backup(
  p_label text default '',
  p_catalog_slug text default 'papelera'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_catalog_id bigint;
  v_id uuid;
  v_products jsonb;
  v_product_count integer;
  v_price_count integer;
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  select id into v_catalog_id from public.catalogs where slug=p_catalog_slug and active=true;
  if v_catalog_id is null then raise exception 'Lista no encontrada'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'code',p.code,'name',p.name,'category',c.name,
    'bulk_quantity',p.bulk_quantity,'presentation',p.presentation,'notes',p.notes,
    'source_row',p.source_row,'display_order',p.display_order,'active',p.active,
    'prices',coalesce((select jsonb_object_agg(pp.tier,pp.amount)
                       from public.product_prices pp where pp.product_id=p.id),'{}'::jsonb)
  ) order by c.name,p.display_order,p.name),'[]'::jsonb),count(*)::integer
  into v_products,v_product_count
  from public.products p
  join public.categories c on c.id=p.category_id
  where p.active=true and p.catalog_id=v_catalog_id;

  select count(*)::integer into v_price_count
  from public.product_prices pp
  join public.products p on p.id=pp.product_id
  where p.active=true and p.catalog_id=v_catalog_id;

  insert into public.catalog_backups(catalog_id,label,product_count,price_count,snapshot,created_by)
  values(v_catalog_id,coalesce(nullif(btrim(p_label),''),'Copia del catalogo'),
         v_product_count,v_price_count,
         jsonb_build_object('version',4,'catalog',p_catalog_slug,'products',v_products),auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.papelera_restore_catalog_backup(p_backup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_snapshot jsonb;
  v_catalog_id bigint;
  v_item jsonb;
  v_price record;
  v_category_id bigint;
  v_product_id uuid;
  v_products integer:=0;
  v_prices integer:=0;
  v_display_order integer;
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  select snapshot,catalog_id into v_snapshot,v_catalog_id
  from public.catalog_backups where id=p_backup_id;
  if v_snapshot is null then raise exception 'Copia no encontrada'; end if;

  update public.products set active=false where catalog_id=v_catalog_id;
  for v_item in select value from jsonb_array_elements(v_snapshot->'products') loop
    insert into public.categories(catalog_id,name,active)
    values(v_catalog_id,v_item->>'category',true)
    on conflict(catalog_id,name) do update set active=true
    returning id into v_category_id;

    v_display_order:=coalesce(
      nullif(v_item->>'display_order','')::integer,
      nullif(v_item->>'source_row','')::integer,
      v_products+1
    );

    insert into public.products(
      id,code,name,catalog_id,category_id,bulk_quantity,presentation,notes,
      source_row,display_order,active
    ) values(
      (v_item->>'id')::uuid,v_item->>'code',v_item->>'name',v_catalog_id,v_category_id,
      coalesce(v_item->>'bulk_quantity',''),coalesce(v_item->>'presentation',''),
      coalesce(v_item->>'notes',''),nullif(v_item->>'source_row','')::integer,
      v_display_order,coalesce((v_item->>'active')::boolean,true)
    )
    on conflict(code) do update set
      name=excluded.name,catalog_id=excluded.catalog_id,category_id=excluded.category_id,
      bulk_quantity=excluded.bulk_quantity,presentation=excluded.presentation,
      notes=excluded.notes,source_row=excluded.source_row,
      display_order=excluded.display_order,active=excluded.active
    returning id into v_product_id;

    delete from public.product_prices where product_id=v_product_id;
    for v_price in select key,value from jsonb_each_text(coalesce(v_item->'prices','{}'::jsonb)) loop
      insert into public.product_prices(product_id,tier,amount,updated_by)
      values(v_product_id,v_price.key,v_price.value::numeric,auth.uid());
      v_prices:=v_prices+1;
    end loop;
    v_products:=v_products+1;
  end loop;

  insert into public.price_change_batches(
    change_type,scope_type,scope_label,affected_products,affected_prices,created_by
  ) values('restore','restore','Copia restaurada',v_products,v_prices,auth.uid());
  return jsonb_build_object('products',v_products,'prices',v_prices);
end;
$$;

revoke all on function public.papelera_reorder_products(bigint,uuid[]) from public;
revoke all on function public.papelera_create_product(text,text,text,text,text,jsonb,text) from public;
revoke all on function public.papelera_update_product(uuid,text,text,text,text,text) from public;
revoke all on function public.papelera_create_catalog_backup(text,text) from public;
revoke all on function public.papelera_restore_catalog_backup(uuid) from public;

grant execute on function public.papelera_reorder_products(bigint,uuid[]) to anon,authenticated;
grant execute on function public.papelera_create_product(text,text,text,text,text,jsonb,text) to anon,authenticated;
grant execute on function public.papelera_update_product(uuid,text,text,text,text,text) to anon,authenticated;
grant execute on function public.papelera_create_catalog_backup(text,text) to anon,authenticated;
grant execute on function public.papelera_restore_catalog_backup(uuid) to anon,authenticated;
