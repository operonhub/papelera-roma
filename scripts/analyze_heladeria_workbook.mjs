import fs from 'node:fs/promises';
import { Workbook } from '@oai/artifact-tool';

const source=process.env.HELADERIA_JSON||'tmp/catalog-import/heladeria-source.json';
const outDir='.analysis/heladeria-2026-08-13';
await fs.mkdir(outDir,{recursive:true});
const sourceData=JSON.parse(await fs.readFile(source,'utf8'));
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const parsePrice=(value,text)=>{
  if(typeof value==='number'&&Number.isFinite(value))return Math.round(value);
  const displayed=clean(text);if(!displayed)return null;
  const amounts=[...displayed.matchAll(/\d[\d\s.]*(?:,\d{2}|\.\d{2})/g)].map(match=>match[0]);
  if(!amounts.length)return null;
  const normalised=amounts.at(-1).replace(/[.,]\d{2}$/,'').replace(/\D/g,'');
  const number=Number(normalised);return Number.isFinite(number)?number:null;
};
const headerRow=row=>{
  const name=clean(row.cells[0].text),quantity=clean(row.cells[1].text),price=clean(row.cells[2].text);
  return name&&!/LISTA DE PRECIOS|CELULAR/i.test(name)&&/CANTIDAD/i.test(quantity)&&/PRECIO/i.test(price);
};
const output=[];let category='Sin categoría';const skipped=[];
for(const row of sourceData.rows){
  const rowNumber=row.row,name=clean(row.cells[0].text);
  if(headerRow(row)){category=name;continue;}
  if(!name||/LISTA DE PRECIOS|CELULAR/i.test(name)||/^\d{7,}$/.test(name))continue;
  const quantityValue=row.cells[1].value,quantity=typeof quantityValue==='number'?String(quantityValue):clean(row.cells[1].text);
  const price=parsePrice(row.cells[2].value,row.cells[2].text);
  if(rowNumber<7){skipped.push({row:rowNumber,name,quantity,price:row.cells[2].text});continue;}
  output.push({
    codigo:`HEL-${String(rowNumber).padStart(4,'0')}`,
    nombre:name,
    categoria:category,
    proveedor:'',
    precio_unidad:null,
    precio_10:null,
    precio_50:null,
    precio_100:null,
    precio_bulto:null,
    cantidad_bulto:'',
    presentacion:quantity,
    precio:price,
    observaciones:clean(row.cells[3].text),
    fuente_fila:rowNumber,
    activo:true,
  });
}
const headers=['codigo','nombre','categoria','proveedor','precio_unidad','precio_10','precio_50','precio_100','precio_bulto','cantidad_bulto','presentacion','precio','observaciones','fuente_fila','activo'];
const csvQuote=value=>{if(value===null||value===undefined)return '';const text=String(value===true?'TRUE':value);return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;};
const csv=[headers.join(','),...output.map(product=>headers.map(header=>csvQuote(product[header])).join(','))].join('\n')+'\n';
await fs.writeFile('data/productos_heladeria.csv',csv,'utf8');
const priced=output.filter(item=>item.precio!==null),zeroPrices=priced.filter(item=>item.precio===0),missingPrices=output.filter(item=>item.precio===null);
const audit={sourceRows:sourceData.rows.length,products:output.length,categories:new Set(output.map(item=>item.categoria)).size,prices:priced.length,positivePrices:priced.filter(item=>item.precio>0).length,zeroPrices:zeroPrices.length,missingPrices:missingPrices.length,priceSum:priced.reduce((sum,item)=>sum+item.precio,0),missingPresentations:output.filter(item=>!item.presentacion).map(item=>({row:item.fuente_fila,name:item.nombre})),zeroPriceRows:zeroPrices.map(item=>({row:item.fuente_fila,name:item.nombre,presentation:item.presentacion})),missingPriceRows:missingPrices.map(item=>({row:item.fuente_fila,name:item.nombre,presentation:item.presentacion})),duplicateNames:[...output.reduce((map,item)=>map.set(item.nombre,(map.get(item.nombre)||0)+1),new Map())].filter(([,count])=>count>1),skipped};
await fs.writeFile(`${outDir}/audit.json`,JSON.stringify(audit,null,2),'utf8');
const check=await Workbook.fromCSV(csv,{sheetName:'Heladería'});
const inspected=await check.inspect({kind:'table',range:`Heladería!A1:O${output.length+1}`,include:'values',tableMaxRows:8,tableMaxCols:15,maxChars:5000});
const preview=await check.render({sheetName:'Heladería',range:`A1:O${Math.min(output.length+1,35)}`,scale:1,format:'png'});
await fs.writeFile(`${outDir}/canonical.png`,new Uint8Array(await preview.arrayBuffer()));
console.log(JSON.stringify(audit,null,2));console.log(inspected.ndjson);
