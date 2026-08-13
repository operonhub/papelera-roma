# Papelera Roma

Aplicación de gestión de productos, precios y presupuestos conectada al proyecto Supabase `operon-crm`.

## Funcionalidad

- Catálogo de 2.212 productos y 5.940 precios almacenados en Supabase.
- Cinco presentaciones vendibles: Unidad, Pack x10, Pack x50, Pack x100 y Bulto.
- Aumentos o descuentos por presentación, categoría o selección de productos.
- Presupuesto en una sección independiente con exportación a PDF y Excel.
- Copias completas del catálogo guardadas y restauradas desde la nube.
- Historial de cambios de precios.
- Acceso mediante usuarios autorizados de Operon y políticas RLS.

Los códigos de integración se mantienen en la base de datos, pero no se muestran ni se solicitan en la interfaz.

## Verificación

```bash
npm run build
```

Para revisar la interfaz local sin modificar Supabase, abrir la aplicación con `?preview=1` desde `localhost` o `127.0.0.1`.
