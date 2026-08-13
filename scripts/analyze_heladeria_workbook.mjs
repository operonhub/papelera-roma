import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const source=process.env.HELADERIA_XLSX||'tmp/catalog-import/heladeria-convertida.xlsx';
const outDir='.analysis/heladeria-2026-08-13';
await fs.mkdir(outDir,{recursive:true});
const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const sheet=workbook.worksheets.getItemAt(0),used=sheet.getUsedRange(true),rows=used.values;
const clean=value=>typeof value==='string'?value.replace(/Âº/g,'º').replace(/\s+/g,' ').trim():value;
const parsePrice=value=>{
  if(typeof value==='number'&&Number.isFinite(value))return value>0?Math.round(value):null;
  if(typeof value!=='string')return null;
  const text=value.trim();if(!text)return null;
  const numbers=[...text.matchAll(/(?:^|\s)(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d{4,})(?:\s|$)/g)].map(match=>match[1]);
  if(!numbers.length)return null;
  const last=numbers.at(-1),normalised=/[.,]\d{2}$/.test(last)?last.slice(0,-3).replace(/\D/g,''):last.replace(/\D/g,'');
  const number=Number(normalised);return Number.isFinite(number)&&number>0?number:null;
};
const headerRow=row=>{
  const name=clean(row[0]),quantity=clean(row[2]),price=clean(row[4]);
  return typeof name==='string'&&name&&!/LISTA DE PRECIOS|CELULAR/i.test(name)&&typeof quantity==='string'&&/CANTIDAD/i.test(quantity)&&typeof price==='string'&&/PRECIO/i.test(price);
};
const output=[];let category='Sin categoría';const skipped=[];
for(let index=0;index<rows.length;index++){
  const row=rows[index],rowNumber=index+2,name=clean(row[0]);
  if(headerRow(row)){category=name;continue;}
  if(typeof name!=='string'||!name||/LISTA DE PRECIOS|CELULAR/i.test(name)){continue;}
  const quantity=clean(row[2]);
  const price=parsePrice(row[4]);
  const hasProductShape=rowNumber>=7&&!headerRow(row);
  if(!hasProductShape){skipped.push({row:rowNumber,name,quantity,price:row[4]});continue;}
  output.push({
    codigo:`HEL-${String(rowNumber).padStart(4,'0')}`,
    nombre:name,
    categoria:category,
    proveedor:'',
    precio_unidad:null,
    precio_10:null,
    precio_50:null,
    precio_100:null,
    precio_bulto:price,
    cantidad_bulto:quantity===null||quantity===undefined?'':String(quantity),
    observaciones:clean(row[6])||'',
    fuente_fila:rowNumber,
    activo:true,
  });
}
const headers=['codigo','nombre','categoria','proveedor','precio_unidad','precio_10','precio_50','precio_100','precio_bulto','cantidad_bulto','observaciones','fuente_fila','activo'];
const csvQuote=value=>{if(value===null||value===undefined)return '';const text=String(value===true?'TRUE':value);return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;};
const csv=[headers.join(','),...output.map(product=>headers.map(header=>csvQuote(product[header])).join(','))].join('\n')+'\n';
await fs.writeFile('data/productos_heladeria.csv',csv,'utf8');
const audit={sourceRows:rows.length,products:output.length,categories:new Set(output.map(item=>item.categoria)).size,prices:output.filter(item=>item.precio_bulto!==null).length,priceSum:output.reduce((sum,item)=>sum+(item.precio_bulto||0),0),zeroOrMissingPrices:output.filter(item=>item.precio_bulto===null).map(item=>({row:item.fuente_fila,name:item.nombre,quantity:item.cantidad_bulto})),duplicateNames:[...output.reduce((map,item)=>map.set(item.nombre,(map.get(item.nombre)||0)+1),new Map())].filter(([,count])=>count>1),skipped};
await fs.writeFile(`${outDir}/audit.json`,JSON.stringify(audit,null,2),'utf8');
const check=await Workbook.fromCSV(csv,{sheetName:'Heladería'});
const inspected=await check.inspect({kind:'table',range:`Heladería!A1:M${output.length+1}`,include:'values',tableMaxRows:8,tableMaxCols:13,maxChars:5000});
console.log(JSON.stringify(audit,null,2));console.log(inspected.ndjson);
