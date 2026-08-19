-- Simplifica los codigos de Heladeria (00001-H -> H1) para dejar de chocar
-- con busquedas por codigo de Papeleria al presupuestar.

alter table public.products
  drop constraint if exists products_commercial_code_format;

update public.products p
set code='H'||(substring(p.code from 1 for 5)::integer)::text
from public.catalogs c
where c.id=p.catalog_id and c.slug='heladeria' and p.code ~ '^[0-9]{5}-H$';

alter table public.products
  add constraint products_commercial_code_format
  check (code ~ '^([0-9]{5}-P|H[1-9][0-9]*)$');

create or replace function public.papelera_create_product_v2(
  p_name text,
  p_category text,
  p_bulk_quantity text default '',
  p_presentation text default '',
  p_notes text default '',
  p_prices jsonb default '{}'::jsonb,
  p_catalog_slug text default 'papelera',
  p_code text default null
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

create or replace function public.papelera_update_product_v2(
  p_product_id uuid,
  p_name text,
  p_category text,
  p_bulk_quantity text default '',
  p_presentation text default '',
  p_notes text default '',
  p_code text default null
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
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  if btrim(coalesce(p_name,''))='' or btrim(coalesce(p_category,''))='' then
    raise exception 'Nombre y categoria son obligatorios';
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
      display_order=case when v_category_id<>v_old_category_id then v_display_order else display_order end
  where id=p_product_id and active=true;

  return jsonb_build_object('id',p_product_id,'updated',true,'code',v_code);
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
  v_catalog_slug text;
  v_item jsonb;
  v_price record;
  v_category_id bigint;
  v_product_id uuid;
  v_products integer:=0;
  v_prices integer:=0;
  v_display_order integer;
  v_category_order integer;
  v_code text;
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  select cb.snapshot,cb.catalog_id,ca.slug into v_snapshot,v_catalog_id,v_catalog_slug
  from public.catalog_backups cb
  join public.catalogs ca on ca.id=cb.catalog_id
  where cb.id=p_backup_id;
  if v_snapshot is null then raise exception 'Copia no encontrada'; end if;
  if v_catalog_slug is null then raise exception 'Lista no encontrada'; end if;

  with ranked as (
    select id,row_number() over(order by active desc,source_row nulls last,display_order,name,id)::integer as position
    from public.products where catalog_id=v_catalog_id
  )
  update public.products p
  set code=case when v_catalog_slug='heladeria'
              then 'H'||(900000+ranked.position)::text
              else lpad((70000+ranked.position)::text,5,'0')||'-P'
            end,
      active=false
  from ranked where ranked.id=p.id;

  for v_item in select value from jsonb_array_elements(v_snapshot->'products') loop
    v_category_order:=coalesce(nullif(v_item->>'category_order','')::integer,v_products+1);
    insert into public.categories(catalog_id,name,display_order,active)
    values(v_catalog_id,v_item->>'category',v_category_order,true)
    on conflict(catalog_id,name) do update set
      display_order=excluded.display_order,
      active=true
    returning id into v_category_id;

    v_display_order:=coalesce(
      nullif(v_item->>'display_order','')::integer,
      nullif(v_item->>'source_row','')::integer,
      v_products+1
    );
    v_code:=upper(coalesce(v_item->>'code',''));
    if v_catalog_slug='heladeria' then
      if v_code !~ '^H[1-9][0-9]*$' then
        if v_code ~ '^[0-9]{5}-H$' then
          v_code:='H'||(substring(v_code from 1 for 5)::integer)::text;
        else
          v_code:='H'||(v_products+1)::text;
        end if;
      end if;
    else
      if v_code !~ '^[0-9]{5}-P$'
         or substring(v_code from 1 for 5)::integer not between 1 and 69999 then
        v_code:=lpad((v_products+1)::text,5,'0')||'-P';
      end if;
    end if;

    insert into public.products(
      id,code,name,catalog_id,category_id,bulk_quantity,presentation,notes,
      source_row,display_order,active
    ) values(
      (v_item->>'id')::uuid,v_code,v_item->>'name',v_catalog_id,v_category_id,
      coalesce(v_item->>'bulk_quantity',''),coalesce(v_item->>'presentation',''),
      coalesce(v_item->>'notes',''),nullif(v_item->>'source_row','')::integer,
      v_display_order,coalesce((v_item->>'active')::boolean,true)
    )
    on conflict(id) do update set
      code=excluded.code,name=excluded.name,catalog_id=excluded.catalog_id,
      category_id=excluded.category_id,bulk_quantity=excluded.bulk_quantity,
      presentation=excluded.presentation,notes=excluded.notes,
      source_row=excluded.source_row,display_order=excluded.display_order,
      active=excluded.active
    returning id into v_product_id;

    delete from public.product_prices where product_id=v_product_id;
    for v_price in select key,value from jsonb_each_text(coalesce(v_item->'prices','{}'::jsonb)) loop
      insert into public.product_prices(product_id,tier,amount,updated_by)
      values(v_product_id,v_price.key,v_price.value::numeric,auth.uid());
      v_prices:=v_prices+1;
    end loop;
    v_products:=v_products+1;
  end loop;

  update public.categories c
  set active=exists(select 1 from public.products p where p.category_id=c.id and p.active=true)
  where c.catalog_id=v_catalog_id;

  insert into public.price_change_batches(
    change_type,scope_type,scope_label,affected_products,affected_prices,created_by
  ) values('restore','restore','Copia restaurada',v_products,v_prices,auth.uid());
  return jsonb_build_object('products',v_products,'prices',v_prices);
end;
$$;

revoke all on function public.papelera_create_product_v2(text,text,text,text,text,jsonb,text,text) from public;
revoke all on function public.papelera_update_product_v2(uuid,text,text,text,text,text,text) from public;
grant execute on function public.papelera_create_product_v2(text,text,text,text,text,jsonb,text,text) to anon,authenticated;
grant execute on function public.papelera_update_product_v2(uuid,text,text,text,text,text,text) to anon,authenticated;
