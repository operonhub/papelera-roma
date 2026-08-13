-- Defensa adicional: durante la prueba publica, las copias siguen siendo privadas
-- incluso si existiera un grant historico; RLS ya las mantiene invisibles.

revoke all on public.catalog_backups from anon;
revoke execute on function public.papelera_create_catalog_backup(text) from anon;
revoke execute on function public.papelera_restore_catalog_backup(uuid) from anon;

