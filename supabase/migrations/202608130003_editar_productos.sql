-- Edicion y desactivacion recuperable de productos desde la aplicacion publica.

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
  v_category_id bigint;
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  if btrim(coalesce(p_name,''))='' or btrim(coalesce(p_category,''))='' then
    raise exception 'Nombre y categoria son obligatorios';
  end if;

  select catalog_id into v_catalog_id
  from public.products
  where id=p_product_id and active=true;
  if v_catalog_id is null then raise exception 'Producto no encontrado'; end if;

  insert into public.categories(catalog_id,name,active)
  values(v_catalog_id,btrim(p_category),true)
  on conflict(catalog_id,name) do update set active=true
  returning id into v_category_id;

  update public.products
  set name=btrim(p_name),
      category_id=v_category_id,
      bulk_quantity=coalesce(p_bulk_quantity,''),
      presentation=coalesce(p_presentation,''),
      notes=coalesce(p_notes,'')
  where id=p_product_id and active=true;

  return jsonb_build_object('id',p_product_id,'updated',true);
end;
$$;

create or replace function public.papelera_deactivate_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_name text;
begin
  if not public.is_app_user() then raise exception 'Acceso denegado'; end if;
  update public.products
  set active=false
  where id=p_product_id and active=true
  returning name into v_name;
  if v_name is null then raise exception 'Producto no encontrado'; end if;
  return jsonb_build_object('id',p_product_id,'name',v_name,'active',false);
end;
$$;

revoke all on function public.papelera_update_product(uuid,text,text,text,text,text) from public;
revoke all on function public.papelera_deactivate_product(uuid) from public;
grant execute on function public.papelera_update_product(uuid,text,text,text,text,text) to anon,authenticated;
grant execute on function public.papelera_deactivate_product(uuid) to anon,authenticated;
