import fs from 'node:fs/promises';
import { Workbook } from '@oai/artifact-tool';

const csvText=await fs.readFile('data/productos_papelera_roma.csv','utf8');
const workbook=await Workbook.fromCSV(csvText,{sheetName:'Productos'});
const sheet=workbook.worksheets.getItem('Productos');
const range=sheet.getRange('A1:M2213');
const rows=range.values;
const expectedHeaders=['codigo','nombre','categoria','proveedor','precio_unidad','precio_10','precio_50','precio_100','precio_bulto','cantidad_bulto','observaciones','fuente_fila','activo'];
const headers=rows[0].map(String);
if(JSON.stringify(headers)!==JSON.stringify(expectedHeaders))throw Error(`Encabezados inesperados: ${headers.join(',')}`);
const products=rows.slice(1).filter(r=>r[0]);
if(products.length!==2212)throw Error(`Se esperaban 2212 productos y hay ${products.length}`);
if(new Set(products.map(r=>r[0])).size!==2212)throw Error('Hay códigos duplicados');
if(new Set(products.map(r=>r[2])).size!==99)throw Error(`Se esperaban 99 categorías y hay ${new Set(products.map(r=>r[2])).size}`);
const expected=[
  {col:4,label:'unidad',count:1755,sum:5553380},
  {col:5,label:'x10',count:1409,sum:11434580},
  {col:6,label:'x50',count:552,sum:15357900},
  {col:7,label:'x100',count:525,sum:9631630},
  {col:8,label:'bulto',count:1699,sum:191224648},
];
for(const check of expected){const values=products.map(r=>r[check.col]).filter(v=>v!==null&&v!==undefined&&String(v).trim()!=='').map(Number);if(values.some(v=>!Number.isFinite(v)))throw Error(`Hay precios no numéricos en ${check.label}`);const sum=values.reduce((a,b)=>a+b,0);if(values.length!==check.count||sum!==check.sum)throw Error(`Control ${check.label} falló: cantidad ${values.length}/${check.count}, suma ${sum}/${check.sum}`);}
const placeholder=products.find(r=>r[0]==='H1-2651');
if(!placeholder||Number(placeholder[6])!==4500)throw Error('No se preservó la fila original 2651 con precio 4500');
for(const file of ['index.html','styles.css','app.js','documentos.js','assets/logo-papelera-roma.png'])await fs.access(file);
const index=await fs.readFile('index.html','utf8'),app=await fs.readFile('app.js','utf8'),documents=await fs.readFile('documentos.js','utf8');
for(const id of ['catalog-tab','quote-tab','open-increase','save-backup','download-excel','selection-quote'])if(!index.includes(`id="${id}"`))throw Error(`Falta el control ${id}`);
for(const removed of ['create-list','csv-file','supplier-filter'])if(index.includes(`id="${removed}"`))throw Error(`Debe quitarse el control ${removed}`);
for(const fn of ['openIncrease','openQuote','downloadQuoteExcel','shareQuoteText','saveBackup'])if(!app.includes(`function ${fn}`))throw Error(`Falta la función ${fn}`);
for(const removed of ['function importCSV','product-supplier','supplier-filter'])if(app.includes(removed))throw Error(`Debe quitarse ${removed}`);
for(const fn of ['buildPriceListPdf','buildQuotePdf','sharePdf'])if(!documents.includes(`function ${fn}`))throw Error(`Falta el generador ${fn}`);
const inspected=await workbook.inspect({kind:'table',range:'Productos!A1:M2213',include:'values',tableMaxRows:4,tableMaxCols:13,maxChars:3000});
console.log(JSON.stringify({ok:true,productos:products.length,categorias:99,precios:expected.reduce((s,x)=>s+x.count,0),controles:expected.map(x=>({nivel:x.label,cantidad:x.count,suma:x.sum}))}));
console.log(inspected.ndjson);
