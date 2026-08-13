import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

function parseCsv(text){
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(char==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(char===','&&!quoted){row.push(value);value='';}
    else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[i+1]==='\n')i++;row.push(value);value='';if(row.some(cell=>cell!==''))rows.push(row);row=[];}
    else value+=char;
  }
  if(value||row.length){row.push(value);rows.push(row);}
  const headers=rows.shift().map(item=>item.replace(/^\uFEFF/,'').trim());
  return rows.map(values=>Object.fromEntries(headers.map((header,index)=>[header,values[index]??''])));
}
const oldRows=parseCsv(execFileSync('git',['show','HEAD:data/productos_papelera_roma.csv'],{encoding:'utf8',maxBuffer:20_000_000}));
const newRows=parseCsv(await fs.readFile('data/productos_papelera_roma.csv','utf8'));
const key=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g,' ').trim();
const productKey=row=>`${key(row.categoria)}|${key(row.nombre)}|${key(row.cantidad_bulto)}`;
const oldByName=new Map();for(const row of oldRows){const name=key(row.nombre);oldByName.set(name,[...(oldByName.get(name)||[]),row]);}
const newByName=new Map();for(const row of newRows){const name=key(row.nombre);newByName.set(name,[...(newByName.get(name)||[]),row]);}
const added=newRows.filter(row=>!oldByName.has(key(row.nombre)));
const removed=oldRows.filter(row=>!newByName.has(key(row.nombre)));
const uniqueMatches=[];
for(const [name,newGroup] of newByName){const oldGroup=oldByName.get(name);if(newGroup.length===1&&oldGroup?.length===1)uniqueMatches.push({old:oldGroup[0],next:newGroup[0]});}
const priceFields=['precio_unidad','precio_10','precio_50','precio_100','precio_bulto'];
const changed=uniqueMatches.filter(({old,next})=>priceFields.some(field=>old[field]!==next[field])||old.categoria!==next.categoria||old.cantidad_bulto!==next.cantidad_bulto).map(({old,next})=>({oldCode:old.codigo,newCode:next.codigo,name:next.nombre,oldCategory:old.categoria,newCategory:next.categoria,prices:Object.fromEntries(priceFields.filter(field=>old[field]!==next[field]).map(field=>[field,{old:old[field],new:next[field]}])),oldBulk:old.cantidad_bulto,newBulk:next.cantidad_bulto}));
const codeNameMismatches=newRows.filter(row=>{const old=oldRows.find(item=>item.codigo===row.codigo);return old&&key(old.nombre)!==key(row.nombre);}).map(row=>({code:row.codigo,old:oldRows.find(item=>item.codigo===row.codigo)?.nombre,new:row.nombre}));
const oldByProductKey=new Map();for(const row of oldRows){const itemKey=productKey(row);oldByProductKey.set(itemKey,[...(oldByProductKey.get(itemKey)||[]),row]);}
const newByProductKey=new Map();for(const row of newRows){const itemKey=productKey(row);newByProductKey.set(itemKey,[...(newByProductKey.get(itemKey)||[]),row]);}
const exactProductKeyMatches=[...newByProductKey].filter(([itemKey,rows])=>rows.length===1&&oldByProductKey.get(itemKey)?.length===1).length;
const unmatchedNewByProductKey=newRows.filter(row=>!oldByProductKey.has(productKey(row)));
const unmatchedOldByProductKey=oldRows.filter(row=>!newByProductKey.has(productKey(row)));
const report={oldProducts:oldRows.length,newProducts:newRows.length,uniqueNameMatches:uniqueMatches.length,exactProductKeyMatches,unmatchedNewByProductKey,unmatchedOldByProductKey,added,removed,changed,duplicateNameGroupsNew:[...newByName.entries()].filter(([,rows])=>rows.length>1).map(([name,rows])=>({name,rows:rows.map(row=>({code:row.codigo,name:row.nombre,category:row.categoria,bulk:row.cantidad_bulto}))})),codeNameMismatches:codeNameMismatches.slice(0,100),codeNameMismatchCount:codeNameMismatches.length};
await fs.mkdir('.analysis/papelera-roma-2026-08-12',{recursive:true});
await fs.writeFile('.analysis/papelera-roma-2026-08-12/comparison.json',JSON.stringify(report,null,2),'utf8');
console.log(JSON.stringify({oldProducts:report.oldProducts,newProducts:report.newProducts,uniqueNameMatches:report.uniqueNameMatches,exactProductKeyMatches,unmatchedNewByProductKey:unmatchedNewByProductKey.length,unmatchedOldByProductKey:unmatchedOldByProductKey.length,added:added.length,removed:removed.length,changed:changed.length,duplicateNameGroupsNew:report.duplicateNameGroupsNew.length,codeNameMismatchCount:report.codeNameMismatchCount,unmatchedNewRows:unmatchedNewByProductKey.map(row=>({code:row.codigo,name:row.nombre,category:row.categoria,bulk:row.cantidad_bulto})),unmatchedOldRows:unmatchedOldByProductKey.map(row=>({code:row.codigo,name:row.nombre,category:row.categoria,bulk:row.cantidad_bulto}))},null,2));
