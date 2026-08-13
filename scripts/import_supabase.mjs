import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const SOURCE='data/productos_papelera_roma.csv';
const SOURCE_XLSX_SHA256='763E73FE315BB14F83DE2632B4AC535CFA759814A4B763BFCF5D7598E87BA8E2';
const CATALOG_SLUG='papelera';
const EXPECTED={
  products:2219,
  categories:99,
  prices:{
    unidad:{count:1758,sum:5579580},
    x10:{count:1410,sum:11445280},
    x50:{count:552,sum:15357400},
    x100:{count:526,sum:9699930},
    bulto:{count:1703,sum:191951148},
  },
};
const PRICE_COLUMNS={unidad:'precio_unidad',x10:'precio_10',x50:'precio_50',x100:'precio_100',bulto:'precio_bulto'};

function parseCsv(text){
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(char==='"'){
      if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;
    }else if(char===','&&!quoted){row.push(value);value='';}
    else if((char==='\n'||char==='\r')&&!quoted){
      if(char==='\r'&&text[i+1]==='\n')i++;
      row.push(value);value='';if(row.some(cell=>cell!==''))rows.push(row);row=[];
    }else value+=char;
  }
  if(value!==''||row.length){row.push(value);rows.push(row);}
  const headers=rows.shift().map(header=>header.replace(/^\uFEFF/,'').trim());
  return rows.map(values=>Object.fromEntries(headers.map((header,index)=>[header,values[index]??''])));
}

function numberOrNull(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const number=Number(value);if(!Number.isFinite(number))throw new Error(`Precio no numerico: ${value}`);return number;
}

function controlsFor(rows){
  const codes=new Set(),categories=new Set(),prices={};
  for(const tier of Object.keys(PRICE_COLUMNS))prices[tier]={count:0,sum:0};
  for(const row of rows){
    if(!row.codigo||!row.nombre||!row.categoria)throw new Error(`Producto incompleto en fila fuente ${row.fuente_fila||'desconocida'}`);
    if(codes.has(row.codigo))throw new Error(`Codigo duplicado: ${row.codigo}`);
    codes.add(row.codigo);categories.add(row.categoria);
    for(const [tier,column] of Object.entries(PRICE_COLUMNS)){
      const amount=numberOrNull(row[column]);if(amount===null)continue;
      prices[tier].count++;prices[tier].sum+=amount;
    }
  }
  return {products:rows.length,categories:categories.size,priceCount:Object.values(prices).reduce((sum,item)=>sum+item.count,0),prices};
}

function assertControls(actual){
  if(actual.products!==EXPECTED.products)throw new Error(`Productos: ${actual.products}/${EXPECTED.products}`);
  if(actual.categories!==EXPECTED.categories)throw new Error(`Categorias: ${actual.categories}/${EXPECTED.categories}`);
  for(const [tier,expected] of Object.entries(EXPECTED.prices)){
    const got=actual.prices[tier];
    if(got.count!==expected.count||got.sum!==expected.sum)throw new Error(`${tier}: cantidad ${got.count}/${expected.count}, suma ${got.sum}/${expected.sum}`);
  }
}

const csv=await fs.readFile(SOURCE,'utf8');
const rows=parseCsv(csv);
const localControls=controlsFor(rows);
assertControls(localControls);
const transformedSha256=crypto.createHash('sha256').update(csv).digest('hex').toUpperCase();

if(!process.argv.includes('--apply')){
  console.log(JSON.stringify({ok:true,mode:'dry-run',source:SOURCE,sourceXlsxSha256:SOURCE_XLSX_SHA256,transformedSha256,controls:localControls},null,2));
  console.log('Validacion local completa. Para importar: node scripts/import_supabase.mjs --apply');
  process.exit(0);
}

const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const secret=process.env.SUPABASE_SECRET_KEY||'';
if(!base||!secret)throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY. La clave secreta debe existir solo en el entorno local seguro.');

async function api(path,{method='GET',body,prefer,headers={}}={}){
  const response=await fetch(`${base}/rest/v1/${path}`,{
    method,
    headers:{apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json',Accept:'application/json',...(prefer?{Prefer:prefer}:{}),...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const text=await response.text();
  if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${text.slice(0,600)}`);
  return text?JSON.parse(text):null;
}

async function chunks(items,size,handler){for(let index=0;index<items.length;index+=size)await handler(items.slice(index,index+size),index);}
async function fetchAll(path,pageSize=1000){
  const all=[];
  for(let offset=0;;offset+=pageSize){
    const separator=path.includes('?')?'&':'?';
    const page=await api(`${path}${separator}limit=${pageSize}&offset=${offset}`);all.push(...page);
    if(page.length<pageSize)return all;
  }
}

let importJobId=null;
try{
  const catalogs=await api(`catalogs?select=id,slug&slug=eq.${CATALOG_SLUG}&limit=1`);
  const catalogId=catalogs[0]?.id;
  if(!catalogId)throw new Error(`No existe el catálogo ${CATALOG_SLUG}.`);
  const jobs=await api('import_jobs',{method:'POST',prefer:'return=representation',body:[{catalog_id:catalogId,source_file:'Papelera Roma  12-08-2026 (1).xlsx / Hoja1',source_sha256:SOURCE_XLSX_SHA256,transformed_sha256:transformedSha256,status:'running',product_count:localControls.products,category_count:localControls.categories,price_count:localControls.priceCount,controls:{local:localControls}}]});
  importJobId=jobs[0].id;

  const categoryNames=[...new Set(rows.map(row=>row.categoria))].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base',numeric:true}));
  await api('categories?on_conflict=catalog_id,name',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:categoryNames.map(name=>({catalog_id:catalogId,name,active:true}))});
  const categories=await fetchAll(`categories?select=id,name&catalog_id=eq.${catalogId}&order=name.asc`);
  const categoryIds=new Map(categories.map(category=>[category.name,category.id]));

  const supplierNames=[...new Set(rows.map(row=>row.proveedor).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base',numeric:true}));
  if(supplierNames.length)await api('suppliers?on_conflict=name',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:supplierNames.map(name=>({name,active:true}))});
  const suppliers=supplierNames.length?await fetchAll('suppliers?select=id,name&order=name.asc'):[];
  const supplierIds=new Map(suppliers.map(supplier=>[supplier.name,supplier.id]));

  const productPayload=rows.map(row=>({
    catalog_id:catalogId,
    code:row.codigo,
    name:row.nombre,
    category_id:categoryIds.get(row.categoria),
    supplier_id:row.proveedor?supplierIds.get(row.proveedor):null,
    bulk_quantity:row.cantidad_bulto||'',
    notes:row.observaciones||'',
    source_row:row.fuente_fila?Number(row.fuente_fila):null,
    active:String(row.activo).toUpperCase()!=='FALSE',
  }));
  if(productPayload.some(product=>!product.category_id))throw new Error('Hay productos sin categoria resuelta.');
  await chunks(productPayload,250,part=>api('products?on_conflict=code',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:part}));

  const products=await fetchAll(`products?select=id,code&catalog_id=eq.${catalogId}`);
  const importedCodeSet=new Set(rows.map(row=>row.codigo));
  const importedProducts=products.filter(product=>importedCodeSet.has(product.code));
  if(importedProducts.length!==EXPECTED.products)throw new Error(`Productos recuperados de Supabase: ${importedProducts.length}/${EXPECTED.products}`);
  const productIds=new Map(importedProducts.map(product=>[product.code,product.id]));

  await chunks(importedProducts.map(product=>product.id),100,part=>api(`product_prices?product_id=in.(${part.join(',')})`,{method:'DELETE',prefer:'return=minimal'}));
  const pricePayload=[];
  for(const row of rows)for(const [tier,column] of Object.entries(PRICE_COLUMNS)){
    const amount=numberOrNull(row[column]);if(amount!==null)pricePayload.push({product_id:productIds.get(row.codigo),tier,amount});
  }
  await chunks(pricePayload,500,part=>api('product_prices?on_conflict=product_id,tier',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:part}));

  const remotePrices=(await fetchAll('product_prices?select=product_id,tier,amount')).filter(price=>new Set(importedProducts.map(product=>product.id)).has(price.product_id));
  const remoteControls={products:importedProducts.length,categories:new Set(rows.map(row=>row.categoria)).size,priceCount:remotePrices.length,prices:{}};
  for(const tier of Object.keys(PRICE_COLUMNS)){
    const values=remotePrices.filter(price=>price.tier===tier).map(price=>Number(price.amount));
    remoteControls.prices[tier]={count:values.length,sum:values.reduce((sum,value)=>sum+value,0)};
  }
  assertControls(remoteControls);

  await api(`import_jobs?id=eq.${importJobId}`,{method:'PATCH',prefer:'return=minimal',body:{status:'completed',controls:{local:localControls,remote:remoteControls},completed_at:new Date().toISOString()}});
  console.log(JSON.stringify({ok:true,mode:'applied',importJobId,transformedSha256,controls:remoteControls},null,2));
}catch(error){
  if(importJobId){try{await api(`import_jobs?id=eq.${importJobId}`,{method:'PATCH',prefer:'return=minimal',body:{status:'failed',error_message:String(error.message).slice(0,2000),completed_at:new Date().toISOString()}});}catch{}}
  throw error;
}
