import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const source='C:/Users/Boste/Downloads/Papelera Roma  12-08-2026 (1).xlsx';
const outDir='.analysis/papelera-roma-2026-08-12';
await fs.mkdir(outDir,{recursive:true});
const input=await FileBlob.load(source);
const workbook=await SpreadsheetFile.importXlsx(input);

const overview=await workbook.inspect({kind:'workbook,sheet,table',maxChars:12000,tableMaxRows:12,tableMaxCols:14,tableMaxCellChars:120});
console.log('---OVERVIEW---');
console.log(overview.ndjson);

const sheets=await workbook.inspect({kind:'sheet',include:'id,name',maxChars:4000});
console.log('---SHEETS---');
console.log(sheets.ndjson);

const firstSheet=workbook.worksheets.getItemAt(0);
const logicalRange='A1:K3113';
const used=firstSheet.getRange(logicalRange);
console.log('---FIRST_SHEET---');
console.log(JSON.stringify({name:firstSheet.name,address:used.address,rowCount:used.rowCount,columnCount:used.columnCount}));

const formulas=await workbook.inspect({kind:'formula',sheetId:firstSheet.name,range:used.address,maxChars:6000,options:{maxResults:200}});
console.log('---FORMULAS---');
console.log(formulas.ndjson);

const styles=await workbook.inspect({kind:'computedStyle',sheetId:firstSheet.name,range:'A1:G40',maxChars:6000,options:{maxResults:50}});
console.log('---STYLES---');
console.log(styles.ndjson);

const columnAStyles=await workbook.inspect({kind:'computedStyle',sheetId:firstSheet.name,range:'A1:A3111',maxChars:2000000,options:{maxResults:4000}});
const styleRecords=columnAStyles.ndjson.split('\n').map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(x=>x?.for);
const compactStyles=styleRecords.map(x=>({row:Number(String(x.for).replace(/\D/g,'')),styleId:x.style?.styleId,fill:x.style?.fill?.color?.value??null,bold:x.style?.font?.bold??false}));
await fs.writeFile(`${outDir}/column-a-styles.json`,JSON.stringify(compactStyles,null,2),'utf8');
const categoryStyle=compactStyles.find(x=>x.row===2);
console.log('---CATEGORY_STYLE---');
console.log(JSON.stringify({categoryStyle,matchingRows:compactStyles.filter(x=>x.styleId===categoryStyle?.styleId).map(x=>x.row)},null,2));

const rows=used.values;
const clean=v=>typeof v==='string'?v.replace(/\s+/g,' ').trim():v;
const named=[];
for(let i=0;i<rows.length;i++){
  const r=rows[i].map(clean),name=r[0];if(name===null||name===undefined||name==='')continue;
  const numericPrices=r.slice(1,6).filter(v=>typeof v==='number'&&Number.isFinite(v));
  const headerWords=r.slice(1,7).filter(v=>typeof v==='string'&&/(unid|bulto|cantidad|precio|paq|caja)/i.test(v));
  const uppercase=typeof name==='string'&&name.length>2&&name===name.toUpperCase()&&/[A-ZÁÉÍÓÚÑ]/.test(name);
  named.push({row:i+1,name,values:r.slice(1,7),numericCount:numericPrices.length,headerCount:headerWords.length,uppercase});
}
const categories=named.filter(x=>x.numericCount===0&&(x.headerCount>=2||x.uppercase));
const products=named.filter(x=>x.numericCount>0);
const unmatched=named.filter(x=>x.numericCount===0&&!categories.includes(x));
const dupNames=[...products.reduce((m,x)=>m.set(x.name,(m.get(x.name)||0)+1),new Map())].filter(([,n])=>n>1);
const fractional=[];for(const p of products)for(const v of p.values.slice(0,5))if(typeof v==='number'&&!Number.isInteger(v))fractional.push({row:p.row,name:p.name,value:v});
const priceStats=[1,2,3,4,5].map((col,idx)=>{const vals=rows.map(r=>r[col]).filter(v=>typeof v==='number'&&Number.isFinite(v));return {column:['B_unidad','C_10','D_50','E_100','F_bulto'][idx],count:vals.length,min:Math.min(...vals),max:Math.max(...vals),sum:vals.reduce((a,b)=>a+b,0)};});
const analysis={logicalRows:rows.length,namedRows:named.length,productRows:products.length,categoryCandidates:categories,unmatchedNamedRows:unmatched,duplicateProductNames:dupNames,fractionalPrices:fractional,priceStats};
await fs.writeFile(`${outDir}/analysis.json`,JSON.stringify(analysis,null,2),'utf8');
console.log('---ANALYSIS---');
console.log(JSON.stringify({logicalRows:analysis.logicalRows,namedRows:analysis.namedRows,productRows:analysis.productRows,categoryCount:categories.length,unmatchedCount:unmatched.length,duplicateNames:dupNames.length,fractionalPrices:fractional.length,priceStats},null,2));
console.log('---CATEGORY_CANDIDATES---');
console.log(JSON.stringify(categories,null,2));
console.log('---UNMATCHED_NAMED_ROWS---');
console.log(JSON.stringify(unmatched.slice(0,250),null,2));

const styleByRow=new Map(compactStyles.map(x=>[x.row,x]));
const isCategory=x=>x.numericCount===0&&(x.headerCount>=3||x.uppercase||(styleByRow.get(x.row)?.bold&&styleByRow.get(x.row)?.fill));
const finalCategoryRows=new Set(named.filter(isCategory).map(x=>x.row));
const headers=['codigo','nombre','categoria','proveedor','precio_unidad','precio_10','precio_50','precio_100','precio_bulto','cantidad_bulto','observaciones','fuente_fila','activo'];
const labels=['Unidad','x 10','x 50','x 100','Bulto'];
const output=[];let currentCategory='Sin categoría';
const unnamedNumericRows=[];
const parseCurrencyText=value=>{
  if(typeof value!=='string')return null;
  const matches=[...value.matchAll(/\$\s*([\d.,]+)/g)].map(m=>m[1]);
  if(matches.length!==1)return null;
  const digits=matches[0].replace(/\D/g,'');
  return digits?Number(digits):null;
};
for(let i=0;i<rows.length;i++){
  const rowNumber=i+1,r=rows[i].map(clean),name=r[0];
  const numericMain=r.slice(1,6).filter(v=>typeof v==='number'&&Number.isFinite(v));
  if((name===null||name===undefined||name==='')&&numericMain.length){
    unnamedNumericRows.push({row:rowNumber,values:r.slice(1,7)});
    const rawPrices=r.slice(1,6),numericPrices=rawPrices.map(v=>typeof v==='number'&&Number.isFinite(v)?v:parseCurrencyText(v));
    output.push({codigo:`H1-${String(rowNumber).padStart(4,'0')}`,nombre:`Producto sin nombre (fila ${rowNumber})`,categoria:currentCategory,proveedor:'',precio_unidad:numericPrices[0],precio_10:numericPrices[1],precio_50:numericPrices[2],precio_100:numericPrices[3],precio_bulto:numericPrices[4],cantidad_bulto:r[6]===null||r[6]===undefined?'':String(r[6]).trim(),observaciones:'La planilla original no contiene nombre para esta fila.',fuente_fila:rowNumber,activo:true});
    continue;
  }
  if(name===null||name===undefined||name==='')continue;
  if(finalCategoryRows.has(rowNumber)){
    currentCategory=typeof name==='string'&&name.trim()&&name.trim()!=='0'?name.trim():`Sin categoría (fila ${rowNumber})`;
    continue;
  }
  const rawPrices=r.slice(1,6),numericPrices=rawPrices.map(v=>typeof v==='number'&&Number.isFinite(v)?v:parseCurrencyText(v));
  const notes=rawPrices.map((v,idx)=>typeof v==='string'&&v.trim()?`${labels[idx]}: ${v.trim()}`:null).filter(Boolean).join(' · ');
  output.push({codigo:`H1-${String(rowNumber).padStart(4,'0')}`,nombre:String(name).trim(),categoria:currentCategory,proveedor:'',precio_unidad:numericPrices[0],precio_10:numericPrices[1],precio_50:numericPrices[2],precio_100:numericPrices[3],precio_bulto:numericPrices[4],cantidad_bulto:r[6]===null||r[6]===undefined?'':String(r[6]).trim(),observaciones:notes,fuente_fila:rowNumber,activo:true});
}
const csvQuote=v=>{if(v===null||v===undefined)return '';const s=String(v===true?'TRUE':v);return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s};
const clientCsv=[headers.join(','),...output.map(p=>headers.map(h=>csvQuote(p[h])).join(','))].join('\n')+'\n';
await fs.writeFile(`${outDir}/productos_cliente.csv`,clientCsv,'utf8');
await fs.writeFile('data/productos_papelera_roma.csv',clientCsv,'utf8');
const outputStats=['precio_unidad','precio_10','precio_50','precio_100','precio_bulto'].map(field=>{const vals=output.map(p=>p[field]).filter(v=>typeof v==='number');return {field,count:vals.length,min:vals.length?Math.min(...vals):null,max:vals.length?Math.max(...vals):null,sum:vals.reduce((a,b)=>a+b,0)};});
const categoryCounts=[...output.reduce((m,p)=>m.set(p.categoria,(m.get(p.categoria)||0)+1),new Map())].map(([category,count])=>({category,count}));
const audit={sourceRows:rows.length,namedRows:named.length,finalCategoryRows:[...finalCategoryRows],categoryCount:categoryCounts.length,productCount:output.length,unnamedNumericRows,outputStats,categoryCounts,rowsWithTextInPriceColumns:output.filter(p=>p.observaciones).map(p=>({row:p.fuente_fila,name:p.nombre,observaciones:p.observaciones})),duplicateCodes:output.length-new Set(output.map(p=>p.codigo)).size,duplicateNames:[...output.reduce((m,p)=>m.set(p.nombre,(m.get(p.nombre)||0)+1),new Map())].filter(([,count])=>count>1)};
const textPriceCells=[];
for(let i=0;i<rows.length;i++)for(let col=1;col<=5;col++){
  const value=clean(rows[i][col]);if(typeof value!=='string'||!value.trim())continue;
  const matches=[...value.matchAll(/\$\s*([\d.,]+)/g)].map(m=>m[1]);
  textPriceCells.push({row:i+1,column:['B','C','D','E','F'][col-1],value,matches});
}
audit.textPriceCells=textPriceCells;
audit.textPriceCellSummary={total:textPriceCells.length,withOneAmount:textPriceCells.filter(x=>x.matches.length===1).length,withMultipleAmounts:textPriceCells.filter(x=>x.matches.length>1).length,withoutAmount:textPriceCells.filter(x=>x.matches.length===0).length};
await fs.writeFile(`${outDir}/final-audit.json`,JSON.stringify(audit,null,2),'utf8');
const csvWorkbook=await Workbook.fromCSV(clientCsv,{sheetName:'Productos'});
const csvCheck=await csvWorkbook.inspect({kind:'table',range:`Productos!A1:M${output.length+1}`,include:'values',tableMaxRows:5,tableMaxCols:13,maxChars:5000});
console.log('---FINAL_AUDIT---');
console.log(JSON.stringify({sourceRows:audit.sourceRows,namedRows:audit.namedRows,categories:audit.categoryCount,products:audit.productCount,unnamedNumericRows:audit.unnamedNumericRows.length,rowsWithTextInPriceColumns:audit.rowsWithTextInPriceColumns.length,textPriceCellSummary:audit.textPriceCellSummary,duplicateCodes:audit.duplicateCodes,duplicateNames:audit.duplicateNames.length,outputStats:audit.outputStats},null,2));
console.log(csvCheck.ndjson);

const anomalyRange=await workbook.inspect({kind:'table',sheetId:firstSheet.name,range:'A2645:G2657',include:'values,formulas',tableMaxRows:20,tableMaxCols:7,maxChars:8000});
console.log('---UNNAMED_PRICE_CONTEXT---');
console.log(anomalyRange.ndjson);

const preview=await workbook.render({sheetName:firstSheet.name,range:'A1:G180',scale:1,format:'png'});
await fs.writeFile(`${outDir}/hoja1.png`,new Uint8Array(await preview.arrayBuffer()));
console.log(`PREVIEW=${outDir}/hoja1.png`);
