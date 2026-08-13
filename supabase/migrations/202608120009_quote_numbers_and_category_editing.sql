-- Numeracion consecutiva de presupuestos y administracion publica de categorias.

create sequence if not exists public.papelera_quote_number_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no cycle;

create or replace function public.papelera_next_quote_number()
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  select nextval('public.papelera_quote_number_seq'::regclass);
$$;

create or replace function public.papelera_rename_category(
  p_category_id bigint,
  p_new_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_name text;
  v_new_name text := btrim(coalesce(p_new_name, ''));
  v_affected integer := 0;
begin
  if v_new_name = '' then
    raise exception 'El nombre de la categoria es obligatorio';
  end if;
  if char_length(v_new_name) > 120 then
    raise exception 'El nombre de la categoria es demasiado largo';
  end if;

  select name into v_old_name
  from public.categories
  where id = p_category_id and active = true
  for update;

  if v_old_name is null then
    raise exception 'Categoria no encontrada';
  end if;

  if exists (
    select 1 from public.categories
    where name = v_new_name and id <> p_category_id
  ) then
    raise exception 'Ya existe una categoria con ese nombre';
  end if;

  update public.categories
  set name = v_new_name, updated_at = now()
  where id = p_category_id;

  select count(*)::integer into v_affected
  from public.products
  where category_id = p_category_id and active = true;

  return jsonb_build_object(
    'old_name', v_old_name,
    'new_name', v_new_name,
    'affected_products', v_affected
  );
end;
$$;

revoke all on sequence public.papelera_quote_number_seq from public, anon, authenticated;
revoke all on function public.papelera_next_quote_number() from public;
revoke all on function public.papelera_rename_category(bigint, text) from public;
grant execute on function public.papelera_next_quote_number() to anon, authenticated;
grant execute on function public.papelera_rename_category(bigint, text) to anon, authenticated;
