-- El archivo auditado contiene 99 categorias exactas y 98 al normalizar mayusculas.
-- Preservar "LINEA 2025" y "Linea 2025" mantiene la fidelidad con la fuente.
drop index if exists public.categories_name_ci_idx;
