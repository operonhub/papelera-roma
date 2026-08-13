-- El helper de autorizacion se usa internamente por las RPC controladas.
-- Los visitantes no necesitan poder invocarlo directamente por la API.

revoke execute on function public.is_app_user() from anon;

