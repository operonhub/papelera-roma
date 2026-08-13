-- Catalagos independientes para Papelera y Heladeria.

create table public.catalogs (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null unique,
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint catalogs_slug_format check (slug ~ '^[a-z0-9-]+$'),
  constraint catalogs_name_not_blank check (btrim(name) <> '')
);

insert into public.catalogs(slug,name,position) values
  ('papelera','Papelera',1),
  ('heladeria','Heladería',2);

alter table public.catalogs enable row level security;
create policy "catalogs_public_read" on public.catalogs for select to anon using (active = true);
grant select on public.catalogs to anon, authenticated;

alter table public.categories add column catalog_id bigint references public.catalogs(id);
update public.categories set catalog_id=(select id from public.catalogs where slug='papelera');
alter table public.categories alter column catalog_id set not null;
alter table public.categories drop constraint if exists categories_name_key;
alter table public.categories add constraint categories_catalog_name_key unique(catalog_id,name);
create index categories_catalog_active_idx on public.categories(catalog_id,active);

alter table public.products add column catalog_id bigint references public.catalogs(id);
update public.products set catalog_id=(select id from public.catalogs where slug='papelera');
alter table public.products alter column catalog_id set not null;
create index products_catalog_active_idx on public.products(catalog_id,active);

alter table public.catalog_backups add column catalog_id bigint references public.catalogs(id);
update public.catalog_backups set catalog_id=(select id from public.catalogs where slug='papelera');
alter table public.catalog_backups alter column catalog_id set not null;
create index catalog_backups_catalog_created_idx on public.catalog_backups(catalog_id,created_at desc);

alter table public.import_jobs add column catalog_id bigint references public.catalogs(id);
update public.import_jobs set catalog_id=(select id from public.catalogs where slug='papelera');
create index import_jobs_catalog_created_idx on public.import_jobs(catalog_id,created_at desc);

create or replace function public.papelera_rename_category(p_category_id bigint,p_new_name text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_old_name text;v_new_name text:=btrim(coalesce(p_new_name,''));v_catalog_id bigint;v_affected integer:=0;
begin
  if v_new_name='' then raise exception 'El nombre de la categoria es obligatorio'; end if;
  if char_length(v_new_name)>120 then raise exception 'El nombre de la categoria es demasiado largo'; end if;
  select name,catalog_id into v_old_name,v_catalog_id from public.categories where id=p_category_id and active=true for update;
  if v_old_name is null then raise exception 'Categoria no encontrada'; end if;
  if exists(select 1 from public.categories where catalog_id=v_catalog_id and name=v_new_name and id<>p_category_id) then raise exception 'Ya existe una categoria con ese nombre en esta lista'; end if;
  update public.categories set name=v_new_name,updated_at=now() where id=p_category_id;
  select count(*)::integer into v_affected from public.products where category_id=p_category_id and active=true;
  return jsonb_build_object('old_name',v_old_name,'new_name',v_new_name,'affected_products',v_affected);
end;$$;

drop function if exists public.papelera_create_product(text,text,text,text,jsonb);
create function public.papelera_create_product(p_name text,p_category text,p_bulk_quantity text default '',p_notes text default '',p_prices jsonb default '{}'::jsonb,p_catalog_slug text default 'papelera')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_catalog_id bigint;v_category_id bigint;v_product_id uuid:=gen_random_uuid();v_code text;v_price record;v_price_count integer:=0;
begin
  select id into v_catalog_id from public.catalogs where slug=p_catalog_slug and active=true;
  if v_catalog_id is null then raise exception 'Lista no encontrada'; end if;
  if btrim(coalesce(p_name,''))='' or btrim(coalesce(p_category,''))='' then raise exception 'Nombre y categoria son obligatorios'; end if;
  insert into public.categories(catalog_id,name,active) values(v_catalog_id,btrim(p_category),true)
  on conflict(catalog_id,name) do update set active=true returning id into v_category_id;
  v_code:=upper(left(p_catalog_slug,3))||'-'||upper(replace(v_product_id::text,'-',''));
  insert into public.products(id,code,name,catalog_id,category_id,bulk_quantity,notes,active)
  values(v_product_id,v_code,btrim(p_name),v_catalog_id,v_category_id,coalesce(p_bulk_quantity,''),coalesce(p_notes,''),true);
  for v_price in select key,value from jsonb_each_text(coalesce(p_prices,'{}'::jsonb)) loop
    if v_price.key not in ('unidad','x10','x50','x100','bulto') then raise exception 'Presentacion invalida'; end if;
    if v_price.value::numeric<0 then raise exception 'Precio invalido'; end if;
    insert into public.product_prices(product_id,tier,amount,updated_by) values(v_product_id,v_price.key,round(v_price.value::numeric,2),auth.uid());v_price_count:=v_price_count+1;
  end loop;
  insert into public.price_change_batches(change_type,scope_type,scope_label,affected_products,affected_prices,created_by) values('create','product',btrim(p_name),1,v_price_count,auth.uid());
  return v_product_id;
end;$$;

drop function if exists public.papelera_apply_price_increase(numeric,text[],text,text,uuid[]);
create function public.papelera_apply_price_increase(p_percentage numeric,p_tiers text[],p_scope text,p_category text default null,p_product_ids uuid[] default null,p_catalog_slug text default 'papelera')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_catalog_id bigint;v_batch uuid;v_products integer;v_prices integer;
begin
  select id into v_catalog_id from public.catalogs where slug=p_catalog_slug and active=true;
  if v_catalog_id is null then raise exception 'Lista no encontrada'; end if;
  if p_percentage is null or p_percentage<=-100 or p_percentage>10000 then raise exception 'Porcentaje invalido'; end if;
  if p_scope not in ('all','category','selected') then raise exception 'Alcance invalido'; end if;
  if coalesce(array_length(p_tiers,1),0)=0 or exists(select 1 from unnest(p_tiers) tier where tier not in ('unidad','x10','x50','x100','bulto')) then raise exception 'Presentaciones invalidas'; end if;
  if p_scope='selected' and coalesce(array_length(p_product_ids,1),0)=0 then raise exception 'No hay productos seleccionados'; end if;
  insert into public.price_change_batches(change_type,scope_type,scope_label,percentage,created_by) values('percentage',p_scope,case when p_scope='all' then 'Lista '||p_catalog_slug when p_scope='category' then p_category else 'Productos seleccionados' end,p_percentage,auth.uid()) returning id into v_batch;
  insert into public.price_changes(batch_id,product_id,tier,old_amount,new_amount,created_by)
  select v_batch,pp.product_id,pp.tier,pp.amount,round(pp.amount*(1+p_percentage/100),2),auth.uid()
  from public.product_prices pp join public.products p on p.id=pp.product_id join public.categories c on c.id=p.category_id
  where p.active=true and p.catalog_id=v_catalog_id and pp.tier=any(p_tiers) and (p_scope='all' or (p_scope='category' and c.name=p_category) or (p_scope='selected' and p.id=any(p_product_ids)));
  get diagnostics v_prices=row_count;select count(distinct product_id) into v_products from public.price_changes where batch_id=v_batch;
  update public.product_prices pp set amount=pc.new_amount,updated_by=auth.uid() from public.price_changes pc where pc.batch_id=v_batch and pp.product_id=pc.product_id and pp.tier=pc.tier;
  update public.price_change_batches set affected_products=v_products,affected_prices=v_prices where id=v_batch;
  return jsonb_build_object('batch_id',v_batch,'affected_products',v_products,'affected_prices',v_prices);
end;$$;

drop function if exists public.papelera_create_catalog_backup(text);
create function public.papelera_create_catalog_backup(p_label text default '',p_catalog_slug text default 'papelera')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_catalog_id bigint;v_id uuid;v_products jsonb;v_product_count integer;v_price_count integer;
begin
  select id into v_catalog_id from public.catalogs where slug=p_catalog_slug and active=true;if v_catalog_id is null then raise exception 'Lista no encontrada';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'category',c.name,'bulk_quantity',p.bulk_quantity,'notes',p.notes,'source_row',p.source_row,'active',p.active,'prices',coalesce((select jsonb_object_agg(pp.tier,pp.amount) from public.product_prices pp where pp.product_id=p.id),'{}'::jsonb)) order by c.name,p.name),'[]'::jsonb),count(*)::integer into v_products,v_product_count from public.products p join public.categories c on c.id=p.category_id where p.active=true and p.catalog_id=v_catalog_id;
  select count(*)::integer into v_price_count from public.product_prices pp join public.products p on p.id=pp.product_id where p.active=true and p.catalog_id=v_catalog_id;
  insert into public.catalog_backups(catalog_id,label,product_count,price_count,snapshot,created_by) values(v_catalog_id,coalesce(nullif(btrim(p_label),''),'Copia del catalogo'),v_product_count,v_price_count,jsonb_build_object('version',2,'catalog',p_catalog_slug,'products',v_products),auth.uid()) returning id into v_id;return v_id;
end;$$;

create or replace function public.papelera_restore_catalog_backup(p_backup_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_snapshot jsonb;v_catalog_id bigint;v_item jsonb;v_price record;v_category_id bigint;v_product_id uuid;v_products integer:=0;v_prices integer:=0;
begin
  select snapshot,catalog_id into v_snapshot,v_catalog_id from public.catalog_backups where id=p_backup_id;if v_snapshot is null then raise exception 'Copia no encontrada';end if;
  update public.products set active=false where catalog_id=v_catalog_id;
  for v_item in select value from jsonb_array_elements(v_snapshot->'products') loop
    insert into public.categories(catalog_id,name,active) values(v_catalog_id,v_item->>'category',true) on conflict(catalog_id,name) do update set active=true returning id into v_category_id;
    insert into public.products(id,code,name,catalog_id,category_id,bulk_quantity,notes,source_row,active) values((v_item->>'id')::uuid,v_item->>'code',v_item->>'name',v_catalog_id,v_category_id,coalesce(v_item->>'bulk_quantity',''),coalesce(v_item->>'notes',''),nullif(v_item->>'source_row','')::integer,coalesce((v_item->>'active')::boolean,true)) on conflict(code) do update set name=excluded.name,catalog_id=excluded.catalog_id,category_id=excluded.category_id,bulk_quantity=excluded.bulk_quantity,notes=excluded.notes,source_row=excluded.source_row,active=excluded.active returning id into v_product_id;
    delete from public.product_prices where product_id=v_product_id;
    for v_price in select key,value from jsonb_each_text(coalesce(v_item->'prices','{}'::jsonb)) loop insert into public.product_prices(product_id,tier,amount,updated_by) values(v_product_id,v_price.key,v_price.value::numeric,auth.uid());v_prices:=v_prices+1;end loop;
    v_products:=v_products+1;
  end loop;
  insert into public.price_change_batches(change_type,scope_type,scope_label,affected_products,affected_prices,created_by) values('restore','restore','Copia restaurada',v_products,v_prices,auth.uid());return jsonb_build_object('products',v_products,'prices',v_prices);
end;$$;

revoke all on function public.papelera_create_product(text,text,text,text,jsonb,text) from public;
revoke all on function public.papelera_apply_price_increase(numeric,text[],text,text,uuid[],text) from public;
revoke all on function public.papelera_create_catalog_backup(text,text) from public;
grant execute on function public.papelera_create_product(text,text,text,text,jsonb,text) to anon,authenticated;
grant execute on function public.papelera_apply_price_increase(numeric,text[],text,text,uuid[],text) to anon,authenticated;
grant execute on function public.papelera_create_catalog_backup(text,text) to anon,authenticated;
revoke all on sequence public.catalogs_id_seq from public,anon,authenticated;
