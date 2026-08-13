-- Flujos de la aplicacion Papelera Roma: acceso, edicion atomica y copias en nube.

insert into public.papelera_profiles (user_id, display_name, role, active)
select p.id, p.full_name, 'admin', true
from public.profiles p
join auth.users u on u.id = p.id
where p.role::text in ('admin', 'owner')
on conflict (user_id) do update
set display_name = excluded.display_name,
    role = excluded.role,
    active = true;

create or replace function public.papelera_set_product_price(
  p_product_id uuid,
  p_tier text,
  p_amount numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old numeric(14,2);
  v_batch uuid;
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  if p_tier not in ('unidad','x10','x50','x100','bulto') then raise exception 'Presentacion invalida'; end if;
  if p_amount is not null and p_amount < 0 then raise exception 'Precio invalido'; end if;

  select amount into v_old from public.product_prices
  where product_id = p_product_id and tier = p_tier;

  insert into public.price_change_batches(change_type, scope_type, scope_label, affected_products, affected_prices, created_by)
  values ('manual','product',(select name from public.products where id=p_product_id),1,1,auth.uid())
  returning id into v_batch;

  if p_amount is null then
    delete from public.product_prices where product_id=p_product_id and tier=p_tier;
  else
    insert into public.product_prices(product_id,tier,amount,updated_by)
    values(p_product_id,p_tier,round(p_amount,2),auth.uid())
    on conflict(product_id,tier) do update set amount=excluded.amount,updated_by=excluded.updated_by;
  end if;

  insert into public.price_changes(batch_id,product_id,tier,old_amount,new_amount,created_by)
  values(v_batch,p_product_id,p_tier,v_old,p_amount,auth.uid());
  return jsonb_build_object('old_amount',v_old,'new_amount',p_amount,'batch_id',v_batch);
end;
$$;

create or replace function public.papelera_create_product(
  p_name text,
  p_category text,
  p_bulk_quantity text default '',
  p_notes text default '',
  p_prices jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_category_id bigint;
  v_product_id uuid := gen_random_uuid();
  v_code text := 'PR-' || upper(replace(v_product_id::text,'-',''));
  v_price record;
  v_price_count integer := 0;
begin
  if not public.is_app_admin() then raise exception 'Acceso de administrador requerido'; end if;
  if btrim(coalesce(p_name,''))='' or btrim(coalesce(p_category,''))='' then raise exception 'Nombre y categoria son obligatorios'; end if;

  insert into public.categories(name,active) values(btrim(p_category),true)
  on conflict(name) do update set active=true
  returning id into v_category_id;

  insert into public.products(id,code,name,category_id,bulk_quantity,notes,active)
  values(v_product_id,v_code,btrim(p_name),v_category_id,coalesce(p_bulk_quantity,''),coalesce(p_notes,''),true);

  for v_price in select key,value from jsonb_each_text(coalesce(p_prices,'{}'::jsonb)) loop
    if v_price.key not in ('unidad','x10','x50','x100','bulto') then raise exception 'Presentacion invalida'; end if;
    if v_price.value::numeric < 0 then raise exception 'Precio invalido'; end if;
    insert into public.product_prices(product_id,tier,amount,updated_by)
    values(v_product_id,v_price.key,round(v_price.value::numeric,2),auth.uid());
    v_price_count := v_price_count + 1;
  end loop;

  insert into public.price_change_batches(change_type,scope_type,scope_label,affected_products,affected_prices,created_by)
  values('create','product',btrim(p_name),1,v_price_count,auth.uid());
  return v_product_id;
end;
$$;

create or replace function public.papelera_apply_price_increase(
  p_percentage numeric,
  p_tiers text[],
  p_scope text,
  p_category text default null,
  p_product_ids uuid[] default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch uuid;
  v_products integer;
  v_prices integer;
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  if p_percentage is null or p_percentage <= -100 or p_percentage > 10000 then raise exception 'Porcentaje invalido'; end if;
  if p_scope not in ('all','category','selected') then raise exception 'Alcance invalido'; end if;
  if coalesce(array_length(p_tiers,1),0)=0 or exists(select 1 from unnest(p_tiers) t where t not in ('unidad','x10','x50','x100','bulto')) then raise exception 'Presentaciones invalidas'; end if;
  if p_scope='selected' and coalesce(array_length(p_product_ids,1),0)=0 then raise exception 'No hay productos seleccionados'; end if;

  insert into public.price_change_batches(change_type,scope_type,scope_label,percentage,created_by)
  values('percentage',p_scope,case when p_scope='all' then 'Todos los productos' when p_scope='category' then p_category else 'Productos seleccionados' end,p_percentage,auth.uid())
  returning id into v_batch;

  insert into public.price_changes(batch_id,product_id,tier,old_amount,new_amount,created_by)
  select v_batch,pp.product_id,pp.tier,pp.amount,round(pp.amount*(1+p_percentage/100),2),auth.uid()
  from public.product_prices pp
  join public.products p on p.id=pp.product_id
  join public.categories c on c.id=p.category_id
  where p.active=true
    and pp.tier=any(p_tiers)
    and (p_scope='all' or (p_scope='category' and c.name=p_category) or (p_scope='selected' and p.id=any(p_product_ids)));

  get diagnostics v_prices = row_count;
  select count(distinct product_id) into v_products from public.price_changes where batch_id=v_batch;

  update public.product_prices pp
  set amount=pc.new_amount,updated_by=auth.uid()
  from public.price_changes pc
  where pc.batch_id=v_batch and pp.product_id=pc.product_id and pp.tier=pc.tier;

  update public.price_change_batches set affected_products=v_products,affected_prices=v_prices where id=v_batch;
  return jsonb_build_object('batch_id',v_batch,'affected_products',v_products,'affected_prices',v_prices);
end;
$$;

create or replace function public.papelera_create_catalog_backup(p_label text default '')
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_products jsonb;
  v_product_count integer;
  v_price_count integer;
begin
  if not public.is_app_admin() then raise exception 'Acceso de administrador requerido'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'code',p.code,'name',p.name,'category',c.name,
    'bulk_quantity',p.bulk_quantity,'notes',p.notes,'source_row',p.source_row,'active',p.active,
    'prices',coalesce((select jsonb_object_agg(pp.tier,pp.amount) from public.product_prices pp where pp.product_id=p.id),'{}'::jsonb)
  ) order by c.name,p.name),'[]'::jsonb),count(*)::integer
  into v_products,v_product_count
  from public.products p join public.categories c on c.id=p.category_id where p.active=true;
  select count(*)::integer into v_price_count from public.product_prices pp join public.products p on p.id=pp.product_id where p.active=true;
  insert into public.catalog_backups(label,product_count,price_count,snapshot,created_by)
  values(coalesce(nullif(btrim(p_label),''),'Copia del catalogo'),v_product_count,v_price_count,jsonb_build_object('version',1,'products',v_products),auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.papelera_restore_catalog_backup(p_backup_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
  v_item jsonb;
  v_price record;
  v_category_id bigint;
  v_product_id uuid;
  v_products integer := 0;
  v_prices integer := 0;
begin
  if not public.is_app_admin() then raise exception 'Acceso de administrador requerido'; end if;
  select snapshot into v_snapshot from public.catalog_backups where id=p_backup_id;
  if v_snapshot is null then raise exception 'Copia no encontrada'; end if;

  update public.products set active=false;
  for v_item in select value from jsonb_array_elements(v_snapshot->'products') loop
    insert into public.categories(name,active) values(v_item->>'category',true)
    on conflict(name) do update set active=true returning id into v_category_id;
    insert into public.products(id,code,name,category_id,bulk_quantity,notes,source_row,active)
    values((v_item->>'id')::uuid,v_item->>'code',v_item->>'name',v_category_id,coalesce(v_item->>'bulk_quantity',''),coalesce(v_item->>'notes',''),nullif(v_item->>'source_row','')::integer,coalesce((v_item->>'active')::boolean,true))
    on conflict(code) do update set name=excluded.name,category_id=excluded.category_id,bulk_quantity=excluded.bulk_quantity,notes=excluded.notes,source_row=excluded.source_row,active=excluded.active
    returning id into v_product_id;
    delete from public.product_prices where product_id=v_product_id;
    for v_price in select key,value from jsonb_each_text(coalesce(v_item->'prices','{}'::jsonb)) loop
      insert into public.product_prices(product_id,tier,amount,updated_by) values(v_product_id,v_price.key,v_price.value::numeric,auth.uid());
      v_prices := v_prices + 1;
    end loop;
    v_products := v_products + 1;
  end loop;
  insert into public.price_change_batches(change_type,scope_type,scope_label,affected_products,affected_prices,created_by)
  values('restore','restore','Copia restaurada',v_products,v_prices,auth.uid());
  return jsonb_build_object('products',v_products,'prices',v_prices);
end;
$$;

revoke all on function public.papelera_set_product_price(uuid,text,numeric) from public,anon;
revoke all on function public.papelera_create_product(text,text,text,text,jsonb) from public,anon;
revoke all on function public.papelera_apply_price_increase(numeric,text[],text,text,uuid[]) from public,anon;
revoke all on function public.papelera_create_catalog_backup(text) from public,anon;
revoke all on function public.papelera_restore_catalog_backup(uuid) from public,anon;
grant execute on function public.papelera_set_product_price(uuid,text,numeric) to authenticated;
grant execute on function public.papelera_create_product(text,text,text,text,jsonb) to authenticated;
grant execute on function public.papelera_apply_price_increase(numeric,text[],text,text,uuid[]) to authenticated;
grant execute on function public.papelera_create_catalog_backup(text) to authenticated;
grant execute on function public.papelera_restore_catalog_backup(uuid) to authenticated;
