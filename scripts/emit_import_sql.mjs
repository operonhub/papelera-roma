import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const text=await fs.readFile('data/productos_papelera_roma.csv','utf8');
function parseCsv(input){
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(c==='"'){if(quoted&&input[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(value);value='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(value);value='';if(row.some(x=>x!==''))rows.push(row);row=[];}
    else value+=c;
  }
  if(value||row.length){row.push(value);rows.push(row);}
  const headers=rows.shift().map(x=>x.replace(/^\uFEFF/,'').trim());
  return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
}
const rows=parseCsv(text);
const priceColumns={unidad:'precio_unidad',x10:'precio_10',x50:'precio_50',x100:'precio_100',bulto:'precio_bulto'};
const productRows=rows.map(r=>({code:r.codigo,name:r.nombre,category:r.categoria,supplier:r.proveedor||null,bulk_quantity:r.cantidad_bulto||'',notes:r.observaciones||'',source_row:r.fuente_fila?Number(r.fuente_fila):null,active:String(r.activo).toUpperCase()!=='FALSE'}));
const priceRows=rows.flatMap(r=>Object.entries(priceColumns).flatMap(([tier,col])=>String(r[col]).trim()===''?[]:[{code:r.codigo,tier,amount:Number(r[col])}]));
const json=value=>JSON.stringify(value).replaceAll('$payload$','$pay_load$');
const stage=process.argv[2],index=Number(process.argv[3]||0);
if(stage==='stats'){
  const groups=new Map();
  for(const name of new Set(productRows.map(r=>r.category))){const key=name.toLocaleLowerCase('es');groups.set(key,[...(groups.get(key)||[]),name]);}
  process.stdout.write(JSON.stringify({exact:new Set(productRows.map(r=>r.category)).size,caseInsensitive:groups.size,variants:[...groups.values()].filter(x=>x.length>1)},null,2));
}else if(stage==='hash'){
  const canonical=priceRows.map(r=>`${r.code}|${r.tier}|${r.amount.toFixed(2)}`).sort().join('\n');
  process.stdout.write(crypto.createHash('sha256').update(canonical).digest('hex'));
}else if(stage==='setup'){
  const categories=[...new Set(productRows.map(r=>r.category))].map(name=>({name}));
  const suppliers=[...new Set(productRows.map(r=>r.supplier).filter(Boolean))].map(name=>({name}));
  process.stdout.write(`insert into public.categories(name) select name from jsonb_to_recordset($payload$${json(categories)}$payload$::jsonb) as x(name text) on conflict(name) do update set active=true;
insert into public.suppliers(name) select name from jsonb_to_recordset($payload$${json(suppliers)}$payload$::jsonb) as x(name text) on conflict(name) do update set active=true;`);
}else if(stage==='products'){
  const part=productRows.slice(index*500,(index+1)*500);
  process.stdout.write(`with src as (select * from jsonb_to_recordset($payload$${json(part)}$payload$::jsonb) as x(code text,name text,category text,supplier text,bulk_quantity text,notes text,source_row integer,active boolean)), resolved as (select s.*,c.id category_id,p.id supplier_id from src s join public.categories c on c.name=s.category left join public.suppliers p on p.name=s.supplier) insert into public.products(code,name,category_id,supplier_id,bulk_quantity,notes,source_row,active) select code,name,category_id,supplier_id,bulk_quantity,notes,source_row,active from resolved on conflict(code) do update set name=excluded.name,category_id=excluded.category_id,supplier_id=excluded.supplier_id,bulk_quantity=excluded.bulk_quantity,notes=excluded.notes,source_row=excluded.source_row,active=excluded.active;`);
}else if(stage==='clear-prices'){
  process.stdout.write(`delete from public.product_prices pp using public.products p where pp.product_id=p.id and p.code in (select code from jsonb_to_recordset($payload$${json(productRows.map(({code})=>({code})))}$payload$::jsonb) as x(code text));`);
}else if(stage==='prices'){
  const part=priceRows.slice(index*1000,(index+1)*1000);
  process.stdout.write(`with src as (select * from jsonb_to_recordset($payload$${json(part)}$payload$::jsonb) as x(code text,tier text,amount numeric)), resolved as (select p.id product_id,s.tier,s.amount from src s join public.products p on p.code=s.code) insert into public.product_prices(product_id,tier,amount) select product_id,tier,amount from resolved on conflict(product_id,tier) do update set amount=excluded.amount;`);
}else throw new Error('Etapa desconocida');
