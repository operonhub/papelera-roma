# Papelera Roma

Aplicación de gestión de productos, precios y presupuestos conectada al proyecto Supabase `Papelera Roma`.

## Funcionalidad

- Dos listas independientes almacenadas en Supabase: Papelería (2.219 productos y 5.949 precios) y Heladería (90 productos, 18 categorías y 73 precios informados).
- Cinco presentaciones vendibles: Unidad, Pack x10, Pack x50, Pack x100 y Bulto.
- Heladería conserva su formato original de Producto, Cantidad/Presentación y Precio, incluidos los ceros explícitos y los precios realmente vacíos.
- Aumentos o descuentos por presentación, categoría o selección de productos.
- Presupuesto en una sección independiente con descuento porcentual, numeración consecutiva en la nube, impresión/PDF, Excel y WhatsApp.
- Selección completa y edición de nombres de categorías.
- Edición de datos generales y desactivación recuperable de productos desde la lista.
- Catálogo móvil en formato de fichas, sin desplazamiento horizontal.
- Copias completas de cada lista guardadas y restauradas desde la nube.
- Historial de cambios de precios.
- Acceso público sin autenticación a todas las funciones de la aplicación, incluidas altas, precios y copias en la nube.

Los códigos de integración se mantienen en la base de datos, pero no se muestran ni se solicitan en la interfaz.

## Verificación

```bash
npm run build
```

Para revisar la interfaz local sin modificar Supabase, abrir la aplicación con `?preview=1` desde `localhost` o `127.0.0.1`.
