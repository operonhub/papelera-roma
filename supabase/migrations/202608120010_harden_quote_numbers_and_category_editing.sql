-- Mantiene las funciones publicas con privilegios minimos y ejecucion invoker.

alter table public.categories
  drop constraint if exists categories_name_length;

alter table public.categories
  add constraint categories_name_length
  check (char_length(btrim(name)) between 1 and 120);

drop policy if exists "categories_public_update_name" on public.categories;
create policy "categories_public_update_name" on public.categories
for update to anon
using (active = true)
with check (active = true);

grant update (name, updated_at) on public.categories to anon;
grant usage on sequence public.papelera_quote_number_seq to anon, authenticated;

alter function public.papelera_next_quote_number() security invoker;
alter function public.papelera_rename_category(bigint, text) security invoker;

revoke all on function public.papelera_next_quote_number() from public;
revoke all on function public.papelera_rename_category(bigint, text) from public;
grant execute on function public.papelera_next_quote_number() to anon, authenticated;
grant execute on function public.papelera_rename_category(bigint, text) to anon, authenticated;
