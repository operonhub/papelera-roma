import fs from 'node:fs/promises';
import { Workbook } from '@oai/artifact-tool';

const csvText=await fs.readFile('data/productos_papelera_roma.csv','utf8');
const heladeriaText=await fs.readFile('data/productos_heladeria.csv','utf8');
const workbook=await Workbook.fromCSV(csvText,{sheetName:'Productos'});
const sheet=workbook.worksheets.getItem('Productos');
const range=sheet.getRange('A1:M2220');
const rows=range.values;
const expectedHeaders=['codigo','nombre','categoria','proveedor','precio_unidad','precio_10','precio_50','precio_100','precio_bulto','cantidad_bulto','observaciones','fuente_fila','activo'];
const headers=rows[0].map(String);
if(JSON.stringify(headers)!==JSON.stringify(expectedHeaders))throw Error(`Encabezados inesperados: ${headers.join(',')}`);
const products=rows.slice(1).filter(r=>r[0]);
if(products.length!==2219)throw Error(`Se esperaban 2219 productos y hay ${products.length}`);
if(new Set(products.map(r=>r[0])).size!==2219)throw Error('Hay códigos duplicados');
if(new Set(products.map(r=>r[2])).size!==99)throw Error(`Se esperaban 99 categorías y hay ${new Set(products.map(r=>r[2])).size}`);
const expected=[
  {col:4,label:'unidad',count:1758,sum:5579580},
  {col:5,label:'x10',count:1410,sum:11445280},
  {col:6,label:'x50',count:552,sum:15357400},
  {col:7,label:'x100',count:526,sum:9699930},
  {col:8,label:'bulto',count:1703,sum:191951148},
];
for(const check of expected){const values=products.map(r=>r[check.col]).filter(v=>v!==null&&v!==undefined&&String(v).trim()!=='').map(Number);if(values.some(v=>!Number.isFinite(v)))throw Error(`Hay precios no numéricos en ${check.label}`);const sum=values.reduce((a,b)=>a+b,0);if(values.length!==check.count||sum!==check.sum)throw Error(`Control ${check.label} falló: cantidad ${values.length}/${check.count}, suma ${sum}/${check.sum}`);}
const placeholder=products.find(r=>r[0]==='H1-2651');
if(!placeholder||Number(placeholder[6])!==4500)throw Error('No se preservó la fila original 2651 con precio 4500');
const heladeriaWorkbook=await Workbook.fromCSV(heladeriaText,{sheetName:'Heladería'}),heladeriaRows=heladeriaWorkbook.worksheets.getItem('Heladería').getRange('A1:O91').values,heladeriaProducts=heladeriaRows.slice(1).filter(row=>row[0]);
if(heladeriaProducts.length!==90)throw Error(`Se esperaban 90 productos de Heladería y hay ${heladeriaProducts.length}`);
if(new Set(heladeriaProducts.map(row=>row[2])).size!==18)throw Error('Las categorías de Heladería no coinciden');
const heladeriaPrices=heladeriaProducts.map(row=>row[11]).filter(value=>value!==null&&value!==undefined&&String(value).trim()!=='').map(Number);
if(heladeriaPrices.length!==73||heladeriaPrices.filter(value=>value===0).length!==28||heladeriaPrices.reduce((sum,value)=>sum+value,0)!==1209994)throw Error('Los precios de Heladería no coinciden');
if(heladeriaProducts.filter(row=>!String(row[10]??'').trim()).length!==6)throw Error('Las presentaciones vacías de Heladería no coinciden');
for(const file of ['index.html','styles.css','app.js','documentos.js','data/productos_heladeria.csv','assets/logo-papelera-roma.png','assets/logo-papelera-roma-pdf.jpg','supabase/migrations/202608120009_quote_numbers_and_category_editing.sql','supabase/migrations/202608120010_harden_quote_numbers_and_category_editing.sql','supabase/migrations/202608130001_catalogos_separados.sql','supabase/migrations/202608130002_heladeria_presentacion_precio.sql','supabase/migrations/202608130003_editar_productos.sql','supabase/migrations/202608130004_corregir_edicion_productos.sql','supabase/migrations/20260813160017_orden_personalizado_productos.sql','supabase/migrations/20260814141823_codigos_y_orden_excel_20260814.sql'])await fs.access(file);
const index=await fs.readFile('index.html','utf8'),app=await fs.readFile('app.js','utf8'),documents=await fs.readFile('documentos.js','utf8'),migration=(await fs.readFile('supabase/migrations/202608120009_quote_numbers_and_category_editing.sql','utf8'))+(await fs.readFile('supabase/migrations/202608120010_harden_quote_numbers_and_category_editing.sql','utf8'))+(await fs.readFile('supabase/migrations/202608130002_heladeria_presentacion_precio.sql','utf8'))+(await fs.readFile('supabase/migrations/202608130003_editar_productos.sql','utf8'))+(await fs.readFile('supabase/migrations/202608130004_corregir_edicion_productos.sql','utf8'))+(await fs.readFile('supabase/migrations/20260813160017_orden_personalizado_productos.sql','utf8'))+(await fs.readFile('supabase/migrations/20260814141823_codigos_y_orden_excel_20260814.sql','utf8'));
const styles=await fs.readFile('styles.css','utf8');
for(const id of ['catalog-tab','quote-tab','open-increase','save-backup','download-excel','print-price-list','share-price-list','manage-categories','expand-categories','collapse-categories','selection-quote','quote-discount','quote-subtotal','quote-total'])if(!index.includes(`id="${id}"`))throw Error(`Falta el control ${id}`);
for(const slug of ['papelera','heladeria'])if(!index.includes(`data-catalog="${slug}"`))throw Error(`Falta la lista ${slug}`);
if(app.includes('PUBLIC_ACCESS_UNTIL')||app.includes('openLogin'))throw Error('La aplicación no debe exigir login ni limitar el acceso público');
for(const removed of ['create-list','csv-file','supplier-filter'])if(index.includes(`id="${removed}"`))throw Error(`Debe quitarse el control ${removed}`);
for(const fn of ['setCatalog','catalogProducts','openIncrease','openQuote','openCategoryManager','renameCategory','openEditProduct','updateProduct','confirmDeactivateProduct','deactivateProduct','nextQuoteNumber','issuedQuoteData','downloadQuoteExcel','printQuotePdf','shareQuoteText','openPrintPriceList','printPriceList','sharePriceList','saveBackup'])if(!app.includes(`function ${fn}`))throw Error(`Falta la función ${fn}`);
for(const expected of ['name="print-scope"','Toda la lista','Solo los seleccionados',"printPriceList(scope='all')"])if(!app.includes(expected))throw Error(`Falta la selección de alcance para imprimir: ${expected}`);
if(!app.includes('p_catalog_slug:state.catalog'))throw Error('Las operaciones deben estar aisladas por lista');
for(const expected of ["tier:'precio'",'Cantidad / presentación','priceFieldsFor'])if(!app.includes(expected))throw Error(`Falta la lógica de Heladería: ${expected}`);
for(const expected of ['data-edit-product-id','data-delete-product-id','productActionIcon'])if(!app.includes(expected))throw Error(`Falta la acción lateral de producto: ${expected}`);
for(const expected of ['data-order-category-id','openProductOrder','bindProductOrder','searchOrderedProduct','papelera_reorder_products','display_order.asc'])if(!app.includes(expected))throw Error(`Falta el orden personalizado de productos: ${expected}`);
for(const expected of ['matchesProductSearch','data-toggle-category','expandAllCategories','collapseAllCategories','papelera_create_product_v2','papelera_update_product_v2',"['Código','codigo'"])if(!app.includes(expected)&&!migration.includes(expected))throw Error(`Falta la mejora de catálogo: ${expected}`);
if(!app.includes('class="product-code">${esc(product.codigo)}</span><span class="product-name">'))throw Error('El código debe mostrarse antes del nombre en cada producto');
for(const expected of ['.product-info strong{display:grid;grid-template-columns:70px minmax(0,1fr)', 'grid-template-columns:minmax(0,1fr) 118px 228px'])if(!styles.includes(expected))throw Error(`Falta la alineación estable del catálogo: ${expected}`);
for(const expected of ['papelera_create_product_v2','papelera_update_product_v2','display_order','^[0-9]{5}-'])if(!migration.includes(expected))throw Error(`Falta la migración de códigos y orden: ${expected}`);
for(const expected of ['Number(a.orden)-Number(b.orden)'])if(!documents.includes(expected))throw Error(`La lista PDF no respeta el orden personalizado: ${expected}`);
for(const expected of ['.category-block,.category-block.heladeria{min-width:0;width:100%}', 'position:sticky;right:8px'])if(!styles.includes(expected))throw Error(`Falta la corrección responsive del catálogo: ${expected}`);
for(const removed of ['function importCSV','product-supplier','supplier-filter'])if(app.includes(removed))throw Error(`Debe quitarse ${removed}`);
for(const fn of ['buildPriceListPdf','buildQuotePdf','sharePdf','printPdf'])if(!documents.includes(`function ${fn}`))throw Error(`Falta el generador ${fn}`);
if(index.includes('quote-validity')||index.includes('quote-number')||index.includes('quote-notes'))throw Error('Validez, número manual y observaciones deben quedar fuera del formulario');
if(/[m]onte\s+[c]hingolo/i.test(`${index}\n${app}\n${documents}`))throw Error('Debe quitarse la referencia geográfica anterior');
if(app.includes('generateQuoteNumber')||app.includes('PR-${parts.year}'))throw Error('La numeración debe ser consecutiva y provenir de Supabase');
for(const fn of ['papelera_next_quote_number','papelera_rename_category','papelera_update_product','papelera_deactivate_product'])if(!migration.includes(fn))throw Error(`Falta la función SQL ${fn}`);
for(const expected of ['papelera_reorder_products','display_order','products_category_order_idx'])if(!migration.includes(expected))throw Error(`Falta la persistencia del orden: ${expected}`);
const inspected=await workbook.inspect({kind:'table',range:'Productos!A1:M2220',include:'values',tableMaxRows:4,tableMaxCols:13,maxChars:3000});
console.log(JSON.stringify({ok:true,papelera:{productos:products.length,categorias:99,precios:expected.reduce((s,x)=>s+x.count,0),controles:expected.map(x=>({nivel:x.label,cantidad:x.count,suma:x.sum}))},heladeria:{productos:heladeriaProducts.length,categorias:18,precios:heladeriaPrices.length,preciosCero:heladeriaPrices.filter(value=>value===0).length,preciosVacios:heladeriaProducts.length-heladeriaPrices.length,suma:heladeriaPrices.reduce((sum,value)=>sum+value,0)}}));
console.log(inspected.ndjson);
