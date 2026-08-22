const SUPABASE={url:'https://fjekdcvkafvhcfqpoghg.supabase.co',key:'sb_publishable_zWvpmYKZeiXYa_bcsu86Ow_e5HMq5iS'};
const PAPELERA_PRICE_FIELDS=[
  {key:'precio_unidad',tier:'unidad',label:'Unidad',detail:'1 unidad'},
  {key:'precio_10',tier:'x10',label:'Pack x10',detail:'10 unidades'},
  {key:'precio_50',tier:'x50',label:'Pack x50',detail:'50 unidades'},
  {key:'precio_100',tier:'x100',label:'Pack x100',detail:'100 unidades'},
  {key:'precio_bulto',tier:'bulto',label:'Bulto',detail:'Bulto completo'},
];
const HELADERIA_PRICE_FIELDS=[{key:'precio',tier:'precio',label:'Precio',detail:'Según cantidad'}];
const PRICE_FIELDS=[...PAPELERA_PRICE_FIELDS,...HELADERIA_PRICE_FIELDS];
const FIELD_BY_TIER=new Map(PRICE_FIELDS.map(field=>[field.tier,field]));
const CATALOGS={papelera:{slug:'papelera',name:'Papelera'},heladeria:{slug:'heladeria',name:'Heladería'}};
const state={
  preview:false,products:[],backups:[],history:[],savedQuotes:[],selected:new Set(),
  expandedCategories:new Set(),
  loadedCatalogs:new Set(),secondaryLoaded:false,secondaryLoading:null,
  catalog:'papelera',
  filters:{search:'',category:''},increase:{scope:'all',percentage:10,tiers:new Set(PAPELERA_PRICE_FIELDS.map(x=>x.tier))},
  quote:null,view:'catalog',busy:false,previewQuoteNumber:0,
};
const THEME_KEY='papelera-roma-theme';
const BOOT_MIN_MS=1150,BOOT_MAX_MS=3500,bootStart=performance.now();let bootHidden=false;
function hideBootSplash(){
  if(bootHidden)return;bootHidden=true;
  const el=document.querySelector('#boot-splash');if(!el)return;
  setTimeout(()=>{el.classList.add('is-hidden');setTimeout(()=>el.remove(),320);},Math.max(0,BOOT_MIN_MS-(performance.now()-bootStart)));
}
setTimeout(hideBootSplash,BOOT_MAX_MS);
const $=selector=>document.querySelector(selector);
const debounce=(fn,ms)=>{let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),ms);};};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(value)||0);
const number=value=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:0}).format(Number(value)||0);
const alphabetical=(a,b)=>String(a).localeCompare(String(b),'es',{sensitivity:'base',numeric:true});
const isPrice=value=>typeof value==='number'&&Number.isFinite(value);
const priceInput=value=>isPrice(value)?number(value):'';
const parsePrice=value=>{if(String(value).trim()==='')return null;const parsed=Number(String(value).replace(/[^0-9,-]/g,'').replaceAll('.','').replace(',','.'));return Number.isFinite(parsed)?Math.round(parsed):NaN;};
const deepCopy=value=>JSON.parse(JSON.stringify(value));
const priceFieldsFor=catalog=>catalog==='heladeria'?HELADERIA_PRICE_FIELDS:PAPELERA_PRICE_FIELDS;
const codeFormatHint=catalog=>catalog==='heladeria'?'H1':'00001-P';
const normalizeSearch=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const searchTokens=value=>normalizeSearch(value).split(' ').filter(Boolean);
const matchesProductSearch=(product,query)=>{const tokens=searchTokens(query);if(!tokens.length)return true;const text=normalizeSearch(`${product.codigo} ${product.nombre} ${product.categoria} ${product.observaciones} ${product.cantidad_bulto} ${product.presentacion}`);return tokens.every(token=>text.includes(token));};
function searchScore(product,tokens,phrase){
  if(!tokens.length)return 0;
  const codeText=normalizeSearch(product.codigo),nameText=normalizeSearch(product.nombre),otherText=normalizeSearch(`${product.categoria} ${product.observaciones} ${product.cantidad_bulto} ${product.presentacion}`);
  let score=0;
  if(codeText===phrase)score+=1000;else if(codeText.startsWith(phrase))score+=600;else if(codeText.includes(phrase))score+=400;
  if(nameText===phrase)score+=900;else if(nameText.startsWith(phrase))score+=350;else if(nameText.includes(phrase))score+=250;
  for(const token of tokens){if(nameText.includes(token))score+=20;else if(codeText.includes(token))score+=12;else if(otherText.includes(token))score+=4;}
  return score;
}
function rankBySearch(products,query){const tokens=searchTokens(query);if(!tokens.length)return products;const phrase=tokens.join(' ');return [...products].sort((a,b)=>searchScore(b,tokens,phrase)-searchScore(a,tokens,phrase));}
const validProductCode=(code,catalog)=>{const value=String(code).trim().toUpperCase();return catalog==='heladeria'?/^H[1-9][0-9]*$/.test(value):/^[0-9]{5}-P$/.test(value)&&Number(value.slice(0,5))>0;};
function nextProductCode(catalog=state.catalog){
  if(catalog==='heladeria'){const highest=state.products.filter(product=>product.catalogo==='heladeria'&&/^H[1-9][0-9]*$/i.test(product.codigo)).reduce((max,product)=>Math.max(max,Number(product.codigo.slice(1))||0),0);return `H${highest+1}`;}
  const highest=state.products.filter(product=>product.catalogo==='papelera'&&/^[0-9]{5}-P$/.test(product.codigo)).reduce((max,product)=>Math.max(max,Number(product.codigo.slice(0,5))||0),0);
  return `${String(highest+1).padStart(5,'0')}-P`;
}

function parseCSV(text){
  const rows=[];let row=[],value='',quoted=false;
  for(let index=0;index<text.length;index++){
    const char=text[index];
    if(char==='"'){if(quoted&&text[index+1]==='"'){value+='"';index++;}else quoted=!quoted;}
    else if(char===','&&!quoted){row.push(value);value='';}
    else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[index+1]==='\n')index++;row.push(value);value='';if(row.some(cell=>cell!==''))rows.push(row);row=[];}
    else value+=char;
  }
  if(value||row.length){row.push(value);rows.push(row);}
  const headers=rows.shift().map(header=>header.replace(/^\uFEFF/,'').trim());
  return rows.map(values=>normaliseProduct(Object.fromEntries(headers.map((header,index)=>[header,values[index]??'']))));
}

function normaliseProduct(raw){
  const product={...raw};
  for(const field of PRICE_FIELDS){const value=raw[field.key];product[field.key]=value===null||value===undefined||String(value).trim()===''?null:Number(value);if(!Number.isFinite(product[field.key]))product[field.key]=null;}
  product.id=String(raw.id||raw.codigo||crypto.randomUUID());
  product.codigo=String(raw.codigo||raw.code||product.id);
  product.categoria_id=raw.categoria_id??raw.category_id??null;
  product.categoria_orden=Number(raw.categoria_orden??raw.category_order??raw.category_display_order??0)||0;
  product.nombre=String(raw.nombre||raw.name||'').trim();
  product.categoria=String(raw.categoria||raw.category||'Sin categoría').trim();
  product.cantidad_bulto=String(raw.cantidad_bulto||raw.bulk_quantity||'').trim();
  product.presentacion=String(raw.presentacion||raw.presentation||'').trim();
  product.observaciones=String(raw.observaciones||raw.notes||'').trim();
  product.catalogo=String(raw.catalogo||raw.catalog_slug||'papelera');
  product.orden=Number(raw.orden??raw.display_order??raw.fuente_fila??raw.source_row??0)||0;
  product.fuente_fila=Number(raw.fuente_fila??raw.source_row??0)||0;
  product.activo=raw.activo===undefined?raw.active!==false:String(raw.activo).toUpperCase()!=='FALSE';
  product.highlight=raw.highlight||null;
  return product;
}

function productFromRemote(row){
  const prices=Object.fromEntries((row.prices||[]).map(price=>[price.tier,Number(price.amount)]));
  return normaliseProduct({id:row.id,codigo:row.code,nombre:row.name,categoria:row.category?.name||'Sin categoría',categoria_id:row.category?.id??null,categoria_orden:row.category?.display_order??0,catalog_slug:row.catalog?.slug||'papelera',cantidad_bulto:row.bulk_quantity,presentacion:row.presentation,observaciones:row.notes,source_row:row.source_row,display_order:row.display_order,active:row.active,highlight:row.highlight,...Object.fromEntries(PRICE_FIELDS.map(field=>[field.key,prices[field.tier]??null]))});
}

function productFromSnapshot(row){
  return normaliseProduct({id:row.id,codigo:row.code,nombre:row.name,categoria:row.category,catalog_slug:state.catalog,cantidad_bulto:row.bulk_quantity,presentacion:row.presentation,observaciones:row.notes,display_order:row.display_order,active:row.active,...Object.fromEntries(PRICE_FIELDS.map(field=>[field.key,row.prices?.[field.tier]??null]))});
}

async function init(){
  state.preview=new URLSearchParams(location.search).get('preview')==='1'&&['localhost','127.0.0.1'].includes(location.hostname);
  state.quote=createEmptyQuote();
  bindStatic();
  if(state.preview){
    const [papelera,heladeria]=await Promise.all([fetch('data/productos_papelera_roma.csv').then(response=>response.text()),fetch('data/productos_heladeria.csv').then(response=>response.text())]);state.products=[...parseCSV(papelera).map(product=>({...product,catalogo:'papelera'})),...parseCSV(heladeria).map(product=>({...product,catalogo:'heladeria'}))];
    state.loadedCatalogs.add('papelera');state.loadedCatalogs.add('heladeria');
    $('#loading-card').hidden=true;setSaveState('Vista previa local · la nube no se modifica','preview');renderAll();hideBootSplash();return;
  }
  try{await loadCloudData();}catch(error){$('#loading-card').hidden=true;setSaveState('No se pudo conectar con la nube','error');renderAll();showToast(readableError(error));hideBootSplash();}
}

function bindStatic(){
  applyTheme(document.documentElement.dataset.theme);
  $('#theme-toggle').onclick=toggleTheme;
  document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>goView(button.dataset.view));
  document.querySelectorAll('[data-catalog]').forEach(button=>button.onclick=()=>setCatalog(button.dataset.catalog));
  let searchTimer;
  $('#search').oninput=event=>{state.filters.search=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(renderCatalog,100);};
  $('#category-filter').onchange=event=>{state.filters.category=event.target.value;renderCatalog();};
  $('#catalog').onchange=event=>{if(event.target.matches('.product-check'))toggleSelection(event.target);if(event.target.matches('.category-check'))toggleCategorySelection(event.target);if(event.target.matches('.price-input'))updatePrice(event.target);};
  $('#catalog').onclick=event=>{const toggleButton=event.target.closest('[data-toggle-category]');if(toggleButton)return toggleCategory(toggleButton.dataset.toggleCategory);const editButton=event.target.closest('[data-edit-product-id]');if(editButton)return openEditProduct(editButton.dataset.editProductId);const deleteButton=event.target.closest('[data-delete-product-id]');if(deleteButton){const product=state.products.find(item=>item.id===deleteButton.dataset.deleteProductId);if(product)return confirmDeactivateProduct(product);}const orderButton=event.target.closest('[data-order-category-id]');if(orderButton)return openProductOrder(Number(orderButton.dataset.orderCategoryId),orderButton.dataset.orderCategoryName);const categoryButton=event.target.closest('[data-edit-category-id]');if(categoryButton)openRenameCategory(Number(categoryButton.dataset.editCategoryId),categoryButton.dataset.editCategoryName);};
  $('#catalog').onfocusin=event=>{if(event.target.matches('.price-input'))event.target.select();};
  $('#catalog').onkeydown=event=>{if(event.target.matches('.price-input')&&event.key==='Enter')event.target.blur();};
  $('#new-product').onclick=openNewProduct;$('#download-excel').onclick=()=>downloadExcel(filtered());$('#print-price-list').onclick=openPrintPriceList;$('#share-price-list').onclick=()=>openSharePriceList('pdf');$('#share-price-list-text').onclick=()=>openSharePriceList('text');$('#manage-categories').onclick=openCategoryManager;$('#save-backup').onclick=saveBackup;$('#view-backups').onclick=openBackups;$('#open-increase').onclick=()=>openIncrease(false);$('#selection-increase').onclick=()=>openIncrease(true);$('#selection-quote').onclick=()=>openQuote(true);$('#clear-selection').onclick=clearSelection;$('#refresh-catalog').onclick=refreshCatalog;
  $('#expand-categories').onclick=expandAllCategories;$('#collapse-categories').onclick=collapseAllCategories;
  $('#quote-search').oninput=debounce(renderQuoteSearch,120);$('#clear-quote').onclick=confirmClearQuote;
  for(const id of ['quote-client','quote-address'])$('#'+id).oninput=syncQuoteFields;
  $('#quote-discount').oninput=event=>{state.quote.discountPercentage=normaliseDiscount(event.target.value);updateQuoteTotals();};
  $('#quote-balance').oninput=event=>{state.quote.previousBalance=normalisePreviousBalance(event.target.value);updateQuoteTotals();};
  $('#quote-pdf').onclick=printQuotePdf;$('#quote-excel').onclick=downloadQuoteExcel;$('#quote-whatsapp').onclick=shareQuotePdf;$('#quote-text').onclick=shareQuoteText;$('#save-quote-cloud').onclick=saveQuoteToCloud;$('#view-saved-quotes').onclick=openSavedQuotes;
  bindScrollTop();bindQuickSearch();bindCatalogFrozenHeader();
}

function bindScrollTop(){
  const button=$('#scroll-top'),searchButton=$('#mobile-search');let ticking=false;
  window.addEventListener('scroll',()=>{
    if(ticking)return;ticking=true;
    requestAnimationFrame(()=>{const visible=window.scrollY>420;button.classList.toggle('is-visible',visible);button.tabIndex=visible?0:-1;searchButton.classList.toggle('is-visible',visible);searchButton.tabIndex=visible?0:-1;ticking=false;});
  },{passive:true});
  button.onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
  searchButton.onclick=event=>{event.stopPropagation();openQuickSearch();};
}

let frozenHeaderTicking=false;
function requestCatalogFrozenHeaderUpdate(){
  if(frozenHeaderTicking)return;frozenHeaderTicking=true;
  requestAnimationFrame(updateCatalogFrozenHeaderPosition);
}

function currentVisibleCategoryName(){
  const headings=document.querySelectorAll('.category-heading');let current='';
  for(const heading of headings){if(heading.getBoundingClientRect().top<=80)current=heading.querySelector('strong')?.textContent||'';else break;}
  return current;
}

function updateCatalogFrozenHeaderPosition(){
  frozenHeaderTicking=false;
  const frozen=$('#catalog-frozen-header'),catalogEl=$('#catalog');if(!frozen||!catalogEl)return;
  if(state.view!=='catalog'){frozen.classList.remove('is-visible');return;}
  const firstHeading=document.querySelector('.category-heading'),shouldShow=Boolean(firstHeading)&&firstHeading.getBoundingClientRect().top<0;
  frozen.classList.toggle('is-visible',shouldShow);
  if(!shouldShow)return;
  const rect=catalogEl.getBoundingClientRect();
  frozen.style.left=rect.left+'px';frozen.style.width=rect.width+'px';
  $('#catalog-frozen-category').textContent=currentVisibleCategoryName();
  $('#catalog-frozen-columns').style.transform=`translateX(${-catalogEl.scrollLeft}px)`;
}

function bindCatalogFrozenHeader(){
  window.addEventListener('scroll',requestCatalogFrozenHeaderUpdate,{passive:true});
  window.addEventListener('resize',requestCatalogFrozenHeaderUpdate);
  $('#catalog').addEventListener('scroll',requestCatalogFrozenHeaderUpdate,{passive:true});
}

function bindQuickSearch(){
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!$('#quick-search').hidden){closeQuickSearch();return;}
    const key=event.key.toLowerCase();
    if(!(event.ctrlKey||event.metaKey)||key!=='f')return;
    if($('.panel-overlay'))return;
    event.preventDefault();
    openQuickSearch();
  });
  document.addEventListener('click',event=>{
    const panel=$('#quick-search');
    if(panel.hidden||panel.contains(event.target))return;
    closeQuickSearch();
  });
  $('#quick-search-close').onclick=closeQuickSearch;
  $('#quick-search-input').oninput=debounce(renderQuickSearchResults,120);
  $('#quick-search-input').onkeydown=event=>{if(event.key==='Enter')$('.quick-result')?.click();};
}

function openQuickSearch(){
  const panel=$('#quick-search'),input=$('#quick-search-input');
  panel.hidden=false;input.value='';renderQuickSearchResults();input.focus();
}

function closeQuickSearch(){$('#quick-search').hidden=true;}

function quickPriceSummary(product){
  const field=firstPriceField(product);
  return field?`${field.label} ${money(product[field.key])}`:'Sin precio cargado';
}

const QUICK_SEARCH_LIMIT=50;
async function renderQuickSearchResults(){
  const query=$('#quick-search-input').value.trim(),container=$('#quick-search-results');
  if(normalizeSearch(query).length<1){container.innerHTML='<div class="quick-search-hint">Escribí para buscar en Papelería y Heladería.</div>';return;}
  const missing=Object.keys(CATALOGS).filter(slug=>!state.loadedCatalogs.has(slug));
  if(missing.length){
    container.innerHTML='<div class="quick-search-hint">Cargando productos…</div>';
    try{await Promise.all(missing.map(loadCatalogData));}catch(error){container.innerHTML=`<div class="quick-search-empty">${esc(readableError(error))}</div>`;return;}
    if($('#quick-search-input').value.trim()!==query)return;
  }
  const all=rankBySearch(state.products.filter(product=>product.activo!==false&&matchesProductSearch(product,query)),query),matches=all.slice(0,QUICK_SEARCH_LIMIT);
  const rows=matches.map(product=>`<button type="button" class="quick-result" data-quick-result="${product.id}"><div class="quick-result-name"><strong><span class="product-code">${esc(product.codigo)}</span>${esc(product.nombre)}</strong><small>${esc(CATALOGS[product.catalogo]?.name||product.catalogo)} · ${esc(product.categoria)}</small></div><div class="quick-result-prices">${esc(quickPriceSummary(product))}</div></button>`).join('');
  const truncated=all.length>matches.length?`<div class="quick-search-truncated">Mostrando ${number(matches.length)} de ${number(all.length)} resultados · seguí escribiendo para afinar</div>`:'';
  container.innerHTML=matches.length?rows+truncated:'<div class="quick-search-empty">No encontramos productos.</div>';
  container.querySelectorAll('[data-quick-result]').forEach(button=>button.onclick=()=>goToProduct(button.dataset.quickResult));
}

function goToProduct(id){
  const product=state.products.find(item=>item.id===id);if(!product)return;
  closeQuickSearch();
  if(state.view!=='catalog')goView('catalog');
  if(state.catalog!==product.catalogo)setCatalog(product.catalogo);
  state.filters.search='';state.filters.category='';$('#search').value='';renderCatalog();
  const row=document.querySelector(`.product-check[data-id="${id}"]`)?.closest('.product-row');
  if(!row)return;
  row.scrollIntoView({block:'center',behavior:'smooth'});
  row.classList.add('is-highlighted');
  setTimeout(()=>row.classList.remove('is-highlighted'),1600);
}

async function db(path,{method='GET',body,prefer,headers={}}={}){
  const response=await fetch(`${SUPABASE.url}/rest/v1/${path}`,{method,headers:{apikey:SUPABASE.key,Accept:'application/json','Content-Type':'application/json',...(prefer?{Prefer:prefer}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await response.text();const payload=text?JSON.parse(text):null;if(!response.ok)throw new Error(payload?.message||payload?.hint||`Error ${response.status}`);return payload;
}

async function dbPages(path,size=1000){
  const all=[];
  for(let from=0;;from+=size){const page=await db(path,{headers:{Range:`${from}-${from+size-1}`}});all.push(...page);if(page.length<size)return all;}
}

async function rpc(name,body){return db(`rpc/${name}`,{method:'POST',body,prefer:'return=representation'});}

function catalogProductsPath(slug){
  return `products?select=id,code,name,bulk_quantity,presentation,notes,source_row,display_order,active,highlight,catalog:catalogs!inner(slug,name),category:categories(id,name,display_order),prices:product_prices(tier,amount)&catalog.slug=eq.${encodeURIComponent(slug)}&active=eq.true&order=source_row.asc.nullslast,display_order.asc,name.asc`;
}

async function loadCatalogData(slug){
  const rows=await dbPages(catalogProductsPath(slug)),products=rows.map(productFromRemote);
  state.products=[...state.products.filter(product=>product.catalogo!==slug),...products];
  state.loadedCatalogs.add(slug);
}

async function loadSecondaryData(){
  if(state.preview||state.secondaryLoaded)return;
  if(state.secondaryLoading)return state.secondaryLoading;
  state.secondaryLoading=(async()=>{
    const [backups,history,savedQuotes]=await Promise.all([
      db('catalog_backups?select=id,label,product_count,price_count,created_at,catalog:catalogs(slug,name)&order=created_at.desc&limit=40'),
      db('price_change_batches?select=id,change_type,scope_label,percentage,affected_products,affected_prices,created_at&order=created_at.desc&limit=50'),
      db('saved_quotes?select=id,label,item_count,total,updated_at&order=updated_at.desc&limit=40'),
    ]);
    state.backups=backups||[];state.history=history||[];state.savedQuotes=savedQuotes||[];state.secondaryLoaded=true;renderSummary();$('#saved-quotes-count').textContent=number(state.savedQuotes.length);
  })();
  try{await state.secondaryLoading;}finally{state.secondaryLoading=null;}
}

async function loadCloudData({showLoadingCard=true}={}){
  if(showLoadingCard)$('#loading-card').hidden=false;
  await loadCatalogData(state.catalog);state.selected.clear();
  $('#loading-card').hidden=true;setSaveState('Acceso público · nube activa','preview');renderAll();hideBootSplash();
  setTimeout(()=>loadSecondaryData().catch(()=>{}),0);
}

async function refreshCatalog(){
  if(state.preview)return showToast('La actualización no está disponible en la vista previa local.');
  const button=$('#refresh-catalog');button.disabled=true;button.textContent='Actualizando…';
  try{await loadCloudData({showLoadingCard:false});showToast('Precios actualizados.');}
  catch(error){showToast(readableError(error));}
  finally{button.disabled=false;button.textContent='↻ Actualizar';}
}

function setSaveState(message,kind){const box=$('.save-state');box.className=`save-state ${kind||''}`;$('#save-label').textContent=message;$('#auth-button').textContent=state.preview?'Vista previa':'Acceso público';}
function catalogProducts(){return state.products.filter(product=>product.catalogo===state.catalog);}
function catalogName(){return CATALOGS[state.catalog]?.name||state.catalog;}
function visibleBackups(){return state.backups.filter(backup=>(backup.catalog?.slug||'papelera')===state.catalog);}
async function setCatalog(slug){
  if(!CATALOGS[slug]||slug===state.catalog)return;
  const previous=state.catalog;state.catalog=slug;state.filters.search='';state.filters.category='';state.selected.clear();state.increase.tiers=new Set(priceFieldsFor(slug).map(field=>field.tier));$('#search').value='';document.querySelectorAll('[data-catalog]').forEach(button=>button.classList.toggle('active',button.dataset.catalog===slug));
  if(!state.preview&&!state.loadedCatalogs.has(slug)){
    $('#loading-card').hidden=false;$('#catalog').innerHTML='';$('#empty').hidden=true;renderFilters();renderSummary();
    try{await loadCatalogData(slug);}catch(error){state.catalog=previous;document.querySelectorAll('[data-catalog]').forEach(button=>button.classList.toggle('active',button.dataset.catalog===previous));$('#loading-card').hidden=true;renderAll();showToast(readableError(error));return;}
    $('#loading-card').hidden=true;
  }
  renderAll();
}
function renderAll(){renderFilters();renderSummary();renderCatalog();renderQuote();}
function orderedCategoryNames(products=catalogProducts()){const records=new Map();for(const product of products){const current=records.get(product.categoria),order=Number(product.categoria_orden)||999999,row=Number(product.fuente_fila)||999999;if(!current||order<current.order||(order===current.order&&row<current.row))records.set(product.categoria,{name:product.categoria,order,row});}return [...records.values()].sort((a,b)=>a.order-b.order||a.row-b.row||alphabetical(a.name,b.name)).map(record=>record.name);}
function unique(key,products=catalogProducts()){return key==='categoria'?orderedCategoryNames(products):[...new Set(products.map(product=>product[key]).filter(Boolean))].sort(alphabetical);}
function byProductOrder(a,b){return Number(a.orden)-Number(b.orden)||alphabetical(a.nombre,b.nombre)||alphabetical(a.id,b.id);}
function totalPriceCells(products=catalogProducts()){return products.reduce((sum,product)=>sum+priceFieldsFor(product.catalogo).filter(field=>isPrice(product[field.key])).length,0);}
function filtered(){const query=state.filters.search.trim();return catalogProducts().filter(product=>matchesProductSearch(product,query)&&(!state.filters.category||product.categoria===state.filters.category));}
function renderFilters(){const categories=unique('categoria');$('#category-filter').innerHTML='<option value="">Todas las categorías</option>'+categories.map(category=>`<option value="${esc(category)}" ${category===state.filters.category?'selected':''}>${esc(category)}</option>`).join('');}
function renderSummary(){$('#product-count').textContent=number(catalogProducts().length);$('#category-count').textContent=number(unique('categoria').length);$('#price-count').textContent=number(totalPriceCells());$('#backup-count').textContent=number(visibleBackups().length);}

function priceColumnHeaderCells(){
  const fields=priceFieldsFor(state.catalog),heladeria=state.catalog==='heladeria';
  const middle=heladeria?`<span>Cantidad / presentación</span>${fields.map(field=>`<span>${field.label}</span>`).join('')}`:`${fields.map(field=>`<span>${field.label}</span>`).join('')}<span>Contenido del bulto</span>`;
  return `<span></span><span>Producto</span>${middle}<span></span>`;
}

function renderCatalog(){
  const items=filtered(),query=state.filters.search.trim(),tokens=searchTokens(query),phrase=tokens.join(' ');
  let categories=orderedCategoryNames(items);
  const scoreOf=tokens.length?new Map(items.map(product=>[product.id,searchScore(product,tokens,phrase)])):null;
  if(scoreOf){
    const bestByCategory=new Map();
    for(const item of items){const s=scoreOf.get(item.id);if(s>(bestByCategory.get(item.categoria)??-1))bestByCategory.set(item.categoria,s);}
    categories=[...categories].sort((a,b)=>(bestByCategory.get(b)??0)-(bestByCategory.get(a)??0));
  }
  const forceOpen=Boolean(query||state.filters.category);$('#empty').hidden=items.length>0||!catalogProducts().length;
  const headerCells=priceColumnHeaderCells();
  $('#catalog').innerHTML=categories.map(category=>{const products=items.filter(product=>product.categoria===category).sort(scoreOf?(a,b)=>scoreOf.get(b.id)-scoreOf.get(a.id):byProductOrder),categoryId=products[0]?.categoria_id??'',key=`${state.catalog}:${categoryId||category}`,expanded=forceOpen||state.expandedCategories.has(key),body=expanded?`<div class="category-body"><div class="price-columns-header">${headerCells}</div>${products.map(productRow).join('')}</div>`:'';return `<section class="category-block ${state.catalog}"><div class="category-heading"><button class="category-toggle" type="button" data-toggle-category="${esc(key)}" aria-expanded="${expanded}" aria-label="${expanded?'Cerrar':'Abrir'} categoría ${esc(category)}"><span class="category-chevron" aria-hidden="true">⌄</span><strong>${esc(category)}</strong></button><label class="category-select"><input class="category-check" type="checkbox" data-category="${esc(category)}" aria-label="Seleccionar categoría ${esc(category)}"><span>Seleccionar</span></label><div class="category-tools"><span>${number(products.length)}</span><button type="button" data-order-category-id="${categoryId}" data-order-category-name="${esc(category)}" aria-label="Ordenar productos de ${esc(category)}">Ordenar productos</button><button type="button" data-edit-category-id="${categoryId}" data-edit-category-name="${esc(category)}" aria-label="Editar categoría ${esc(category)}">Editar nombre</button></div></div>${body}</section>`;}).join('');updateSelectionBar();syncCategoryChecks();
  const frozenColumns=$('#catalog-frozen-columns');
  if(frozenColumns){frozenColumns.className='price-columns-header'+(state.catalog==='heladeria'?' heladeria':'');frozenColumns.innerHTML=headerCells;}
  requestCatalogFrozenHeaderUpdate();
}

function toggleCategory(key){state.expandedCategories.has(key)?state.expandedCategories.delete(key):state.expandedCategories.add(key);renderCatalog();}
function expandAllCategories(){for(const category of categoryRecords())state.expandedCategories.add(`${state.catalog}:${category.id||category.name}`);renderCatalog();}
function collapseAllCategories(){for(const category of categoryRecords())state.expandedCategories.delete(`${state.catalog}:${category.id||category.name}`);renderCatalog();}

function applyTheme(theme,{persist=false}={}){
  const selected=theme==='dark'?'dark':'light',dark=selected==='dark';
  document.documentElement.dataset.theme=selected;
  document.documentElement.style.colorScheme=selected;
  const button=$('#theme-toggle');
  if(button){
    const action=dark?'Activar modo claro':'Activar modo nocturno';
    button.setAttribute('aria-label',action);
    button.setAttribute('title',action);
    button.setAttribute('aria-pressed',String(dark));
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#07151d':'#073f43');
  if(persist){try{localStorage.setItem(THEME_KEY,selected);}catch{}}
}

function toggleTheme(){applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark',{persist:true});}

function productActionIcon(kind){return kind==='edit'?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>';}

function productRow(product){
  const fields=priceFieldsFor(product.catalogo),prices=fields.map(field=>`<div class="price-wrap"><span class="mobile-price-label">${field.label} ($)</span><input class="price-input" data-id="${product.id}" data-tier="${field.tier}" value="${priceInput(product[field.key])}" inputmode="numeric" placeholder="—" aria-label="Precio ${field.label} de ${esc(product.nombre)}"></div>`).join(''),detail=product.catalogo==='heladeria'?`<div class="bulk-quantity"><span class="mobile-price-label">Cantidad / presentación</span><span>${esc(product.presentacion||'—')}</span></div>${prices}`:`${prices}<div class="bulk-quantity"><span class="mobile-price-label">Contenido del bulto</span><span>${esc(product.cantidad_bulto||'—')}</span></div>`;
  const actions=`<div class="product-actions"><button type="button" class="product-action product-action-edit" data-edit-product-id="${product.id}" aria-label="Editar producto ${esc(product.nombre)}" title="Editar producto">${productActionIcon('edit')}</button><button type="button" class="product-action product-action-delete" data-delete-product-id="${product.id}" aria-label="Eliminar producto ${esc(product.nombre)}" title="Eliminar producto">${productActionIcon('delete')}</button></div>`;
  return `<div class="product-row${product.highlight?` highlight-${product.highlight}`:''}"><input class="product-check" type="checkbox" data-id="${product.id}" ${state.selected.has(product.id)?'checked':''} aria-label="Seleccionar ${esc(product.codigo)} ${esc(product.nombre)}"><div class="product-info"><strong><span class="product-code">${esc(product.codigo)}</span><span class="product-name">${esc(product.nombre)}</span></strong>${product.observaciones?`<small><span class="product-note">${esc(product.observaciones)}</span></small>`:''}</div>${detail}${actions}</div>`;
}

function toggleSelection(input){input.checked?state.selected.add(input.dataset.id):state.selected.delete(input.dataset.id);updateSelectionBar();syncCategoryChecks();}
function updateSelectionBar(){const count=state.selected.size;$('#selection-bar').hidden=count===0;$('#selection-count').textContent=number(count);}
function selectedProducts(){return catalogProducts().filter(product=>state.selected.has(product.id));}
function syncVisibleProductChecks(){document.querySelectorAll('.product-check').forEach(input=>{input.checked=state.selected.has(input.dataset.id);});}
function clearSelection(){state.selected.clear();syncVisibleProductChecks();updateSelectionBar();syncCategoryChecks();}
function toggleCategorySelection(input){const products=catalogProducts().filter(product=>product.categoria===input.dataset.category);for(const product of products)input.checked?state.selected.add(product.id):state.selected.delete(product.id);syncVisibleProductChecks();updateSelectionBar();syncCategoryChecks();}
function syncCategoryChecks(){document.querySelectorAll('.category-check').forEach(input=>{const products=catalogProducts().filter(product=>product.categoria===input.dataset.category),selected=products.filter(product=>state.selected.has(product.id)).length;input.checked=products.length>0&&selected===products.length;input.indeterminate=selected>0&&selected<products.length;});}
function categoryRecords(){const records=new Map();for(const product of catalogProducts()){if(!records.has(product.categoria))records.set(product.categoria,{id:product.categoria_id,name:product.categoria,count:0,order:Number(product.categoria_orden)||999999,row:Number(product.fuente_fila)||999999});const record=records.get(product.categoria);record.count++;record.order=Math.min(record.order,Number(product.categoria_orden)||999999);record.row=Math.min(record.row,Number(product.fuente_fila)||999999);}return [...records.values()].sort((a,b)=>a.order-b.order||a.row-b.row||alphabetical(a.name,b.name));}

function openCategoryManager(){
  const categories=categoryRecords();
  $('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel panel-wide" role="dialog" aria-modal="true"><div class="panel-head"><div><h2>Categorías</h2><p>Seleccioná, ordená o corregí el nombre de cada categoría.</p></div><button class="icon-close" data-close>×</button></div><div class="category-manager-list">${categories.map(category=>`<div class="category-manager-row"><div><strong>${esc(category.name)}</strong><small>${number(category.count)} productos</small></div><div><button class="btn btn-quiet" data-select-category="${esc(category.name)}">Seleccionar</button><button class="btn btn-secondary" data-manage-order-id="${category.id}" data-manage-order-name="${esc(category.name)}">Ordenar productos</button><button class="btn btn-secondary" data-rename-category-id="${category.id}" data-rename-category-name="${esc(category.name)}">Editar nombre</button></div></div>`).join('')}</div></section></div>`;
  bindPanelClose();document.querySelectorAll('[data-select-category]').forEach(button=>button.onclick=()=>{for(const product of catalogProducts().filter(item=>item.categoria===button.dataset.selectCategory))state.selected.add(product.id);closePanel();syncVisibleProductChecks();updateSelectionBar();syncCategoryChecks();showToast(`Categoría seleccionada: ${button.dataset.selectCategory}.`);});document.querySelectorAll('[data-manage-order-id]').forEach(button=>button.onclick=()=>openProductOrder(Number(button.dataset.manageOrderId),button.dataset.manageOrderName));document.querySelectorAll('[data-rename-category-id]').forEach(button=>button.onclick=()=>openRenameCategory(Number(button.dataset.renameCategoryId),button.dataset.renameCategoryName));
}

function orderRow(product,index,total){
  return `<div class="order-product-row" draggable="true" data-order-product-id="${product.id}"><button type="button" class="order-grip" aria-label="Arrastrar ${esc(product.nombre)}" title="Arrastrar para ordenar">⠿</button><span class="order-position">${index+1}</span><div class="order-product-name"><strong>${esc(product.nombre)}</strong>${product.observaciones?`<small>${esc(product.observaciones)}</small>`:''}</div><div class="order-buttons"><button type="button" data-order-top aria-label="Mover ${esc(product.nombre)} al inicio" title="Mover al inicio">⇈</button><button type="button" data-order-up aria-label="Subir ${esc(product.nombre)}" title="Subir" ${index===0?'disabled':''}>↑</button><button type="button" data-order-down aria-label="Bajar ${esc(product.nombre)}" title="Bajar" ${index===total-1?'disabled':''}>↓</button></div></div>`;
}

function openProductOrder(categoryId,categoryName){
  const products=catalogProducts().filter(product=>product.categoria===categoryName).sort(byProductOrder);
  $('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel panel-wide order-panel" role="dialog" aria-modal="true" aria-labelledby="order-title"><div class="panel-head"><div><span class="step-label">ORDEN PERSONALIZADO</span><h2 id="order-title">${esc(categoryName)}</h2><p>Arrastrá los productos o usá las flechas. “Mover al inicio” sirve para destacar una marca rápidamente.</p></div><button class="icon-close" data-close>×</button></div><div class="order-help"><span>⠿ Arrastrar</span><span>⇈ Mover al inicio</span><span>↑↓ Subir o bajar</span></div><div class="order-search"><span>⌕</span><input id="order-search" type="search" placeholder="Buscar producto o marca…" autocomplete="off"><small id="order-search-status">${number(products.length)} productos</small></div><div class="order-product-list" id="order-product-list">${products.map((product,index)=>orderRow(product,index,products.length)).join('')}</div><div class="form-error" id="order-error" hidden></div><div class="panel-actions order-panel-actions"><button class="btn btn-quiet" type="button" data-close>Cancelar</button><button class="btn btn-accent" id="save-product-order" type="button">Guardar orden</button></div></section></div>`;
  bindPanelClose();bindProductOrder();$('#order-search').oninput=searchOrderedProduct;$('#save-product-order').onclick=()=>saveProductOrder(categoryId,categoryName);
}

function searchOrderedProduct(event){
  const query=event.target.value.trim(),tokens=searchTokens(query),rows=[...document.querySelectorAll('.order-product-row')],status=$('#order-search-status');rows.forEach(row=>row.classList.remove('order-match'));if(!tokens.length){status.textContent=`${number(rows.length)} productos`;return;}const match=rows.find(row=>{const text=normalizeSearch(row.querySelector('.order-product-name').textContent);return tokens.every(token=>text.includes(token));});status.textContent=match?'Producto encontrado':'Sin coincidencias';if(match){match.classList.add('order-match');match.scrollIntoView({block:'center',behavior:'smooth'});}
}

function refreshOrderPositions(){
  const rows=[...document.querySelectorAll('.order-product-row')];
  rows.forEach((row,index)=>{row.querySelector('.order-position').textContent=index+1;row.querySelector('[data-order-up]').disabled=index===0;row.querySelector('[data-order-down]').disabled=index===rows.length-1;});
}

function bindProductOrder(){
  const list=$('#order-product-list');let dragged=null;
  list.onclick=event=>{const row=event.target.closest('.order-product-row');if(!row)return;if(event.target.closest('[data-order-top]'))list.prepend(row);else if(event.target.closest('[data-order-up]')&&row.previousElementSibling)list.insertBefore(row,row.previousElementSibling);else if(event.target.closest('[data-order-down]')&&row.nextElementSibling)list.insertBefore(row.nextElementSibling,row);else return;refreshOrderPositions();row.classList.add('order-moved');setTimeout(()=>row.classList.remove('order-moved'),300);};
  list.ondragstart=event=>{dragged=event.target.closest('.order-product-row');if(!dragged)return;dragged.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',dragged.dataset.orderProductId);};
  list.ondragover=event=>{event.preventDefault();const target=event.target.closest('.order-product-row');if(!dragged||!target||target===dragged)return;const rect=target.getBoundingClientRect();list.insertBefore(dragged,event.clientY<rect.top+rect.height/2?target:target.nextElementSibling);};
  list.ondrop=event=>{event.preventDefault();refreshOrderPositions();};
  list.ondragend=()=>{dragged?.classList.remove('dragging');dragged=null;refreshOrderPositions();};
}

async function saveProductOrder(categoryId,categoryName){
  const ids=[...document.querySelectorAll('.order-product-row')].map(row=>row.dataset.orderProductId),button=$('#save-product-order'),error=$('#order-error');button.disabled=true;button.textContent='Guardando…';
  try{
    if(state.preview){ids.forEach((id,index)=>{const product=state.products.find(item=>item.id===id);if(product)product.orden=index+1;});}
    else{await rpc('papelera_reorder_products',{p_category_id:categoryId,p_product_ids:ids});await loadCloudData();}
    closePanel();renderCatalog();showToast(`Orden guardado en ${categoryName}.`);
  }catch(failure){error.textContent=readableError(failure);error.hidden=false;button.disabled=false;button.textContent='Guardar orden';}
}

function openRenameCategory(id,name){
  $('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel" role="dialog" aria-modal="true"><div class="panel-head"><div><h2>Editar categoría</h2><p>El nuevo nombre se aplicará a todos los productos de esta categoría.</p></div><button class="icon-close" data-close>×</button></div><form id="category-form"><div class="field"><label for="category-name">Nombre</label><input id="category-name" maxlength="120" value="${esc(name)}" required></div><div class="form-error" id="category-error" hidden></div><div class="panel-actions"><button class="btn btn-quiet" type="button" data-close>Cancelar</button><button class="btn btn-accent" id="category-submit" type="submit">Guardar nombre</button></div></form></section></div>`;
  bindPanelClose();$('#category-form').onsubmit=event=>renameCategory(event,id,name);setTimeout(()=>{$('#category-name')?.focus();$('#category-name')?.select();},50);
}

async function renameCategory(event,id,oldName){
  event.preventDefault();const name=$('#category-name').value.trim(),error=$('#category-error'),button=$('#category-submit');if(!name){error.textContent='Ingresá un nombre.';error.hidden=false;return;}button.disabled=true;button.textContent='Guardando…';
  try{if(state.preview){for(const product of catalogProducts().filter(item=>item.categoria===oldName))product.categoria=name;}else{await rpc('papelera_rename_category',{p_category_id:id,p_new_name:name});await loadCloudData();}if(state.filters.category===oldName)state.filters.category=name;closePanel();renderAll();showToast(`Categoría actualizada: ${name}.`);}catch(failure){error.textContent=readableError(failure);error.hidden=false;button.disabled=false;button.textContent='Guardar nombre';}
}

async function updatePrice(input){
  const product=state.products.find(item=>item.id===input.dataset.id),field=FIELD_BY_TIER.get(input.dataset.tier),value=parsePrice(input.value);if(!product||!field)return;
  if(Number.isNaN(value)||value<0){input.value=priceInput(product[field.key]);showToast('Ingresá un precio válido.');return;}
  if(value===product[field.key]){input.value=priceInput(value);return;}
  const old=product[field.key];product[field.key]=value;input.disabled=true;
  try{if(!state.preview)await rpc('papelera_set_product_price',{p_product_id:product.id,p_tier:field.tier,p_amount:value});input.value=priceInput(value);renderSummary();showToast(`Precio ${field.label} actualizado.`);}
  catch(error){product[field.key]=old;input.value=priceInput(old);showToast(readableError(error));}
  finally{input.disabled=false;}
}

function openNewProduct(){
  const categories=unique('categoria'),fields=priceFieldsFor(state.catalog),catalogFields=state.catalog==='heladeria'?`<div class="field"><label>Cantidad / presentación</label><input id="product-presentation" placeholder="Ej: Caja x 100"></div>${fields.map(field=>`<div class="field"><label>${field.label}</label><input id="new-${field.tier}" type="number" min="0" step="1" placeholder="Sin precio"></div>`).join('')}`:`${fields.map(field=>`<div class="field"><label>Precio ${field.label}</label><input id="new-${field.tier}" type="number" min="0" step="1" placeholder="Sin precio"></div>`).join('')}<div class="field"><label>Contenido del bulto</label><input id="product-bulk" placeholder="Ej: 12 paquetes x 100"></div>`;
  $('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel" role="dialog" aria-modal="true"><div class="panel-head"><div><h2>Nuevo producto · ${esc(catalogName())}</h2><p>El código se completa solo, pero también podés escribirlo o corregirlo.</p></div><button class="icon-close" data-close>×</button></div><form id="product-form"><div class="product-form"><div class="field"><label for="product-code">Código</label><input id="product-code" maxlength="7" placeholder="Automático: ${nextProductCode()}" autocapitalize="characters"><small class="form-help">Formato ${codeFormatHint(state.catalog)}</small></div><div class="field field-wide"><label>Nombre <span class="required">*</span></label><input id="product-name" required></div><div class="field field-wide"><label>Categoría <span class="required">*</span></label><input id="product-category" list="category-options" required><datalist id="category-options">${categories.map(value=>`<option value="${esc(value)}"></option>`).join('')}</datalist></div>${catalogFields}<div class="field field-wide"><label>Observaciones</label><input id="product-notes" placeholder="Opcional"></div>${highlightPickerField(null)}</div><div id="product-error" class="form-error" hidden></div><div class="panel-actions"><button class="btn btn-quiet" type="button" data-close>Cancelar</button><button class="btn btn-accent" id="product-submit" type="submit">Guardar producto</button></div></form></section></div>`;
  bindPanelClose();$('#product-form').onsubmit=createProduct;setTimeout(()=>$('#product-name')?.focus(),50);
}

async function createProduct(event){
  event.preventDefault();const name=$('#product-name').value.trim(),category=$('#product-category').value.trim(),code=$('#product-code').value.trim().toUpperCase(),error=$('#product-error'),button=$('#product-submit');
  if(!name||!category){error.textContent='Completá nombre y categoría.';error.hidden=false;return;}
  if(code&&!validProductCode(code,state.catalog)){error.textContent=`El código debe tener el formato ${codeFormatHint(state.catalog)}.`;error.hidden=false;return;}
  const fields=priceFieldsFor(state.catalog),prices={};for(const field of fields){const value=parsePrice($(`#new-${field.tier}`).value);if(Number.isNaN(value)||value<0){error.textContent='Revisá los precios ingresados.';error.hidden=false;return;}if(value!==null)prices[field.tier]=value;}
  button.disabled=true;button.textContent='Guardando…';
  try{
    const bulk=$('#product-bulk')?.value.trim()||'',presentation=$('#product-presentation')?.value.trim()||'',highlight=document.querySelector('input[name="product-highlight"]:checked')?.value||null;
    if(state.preview){state.products.push(normaliseProduct({id:crypto.randomUUID(),code:code||nextProductCode(),name,categoria:category,catalog_slug:state.catalog,bulk_quantity:bulk,presentacion:presentation,notes:$('#product-notes').value,highlight,...Object.fromEntries(fields.map(field=>[field.key,prices[field.tier]??null]))}));}
    else{await rpc('papelera_create_product_v2',{p_name:name,p_category:category,p_bulk_quantity:bulk,p_presentation:presentation,p_notes:$('#product-notes').value.trim(),p_prices:prices,p_catalog_slug:state.catalog,p_code:code||null,p_highlight:highlight});await loadCloudData();}
    closePanel();renderAll();showToast(`${name} fue agregado.`);
  }catch(failure){error.textContent=readableError(failure);error.hidden=false;button.disabled=false;button.textContent='Guardar producto';}
}

function highlightPickerField(selected){
  const options=[['','Sin resaltar','ninguno'],['amarillo','Amarillo','amarillo'],['verde','Verde','verde'],['rosa','Rosa','rosa']];
  return `<div class="field field-wide"><label>Resaltar</label><div class="highlight-picker">${options.map(([value,label,swatch])=>`<label class="highlight-option"><input type="radio" name="product-highlight" value="${value}" ${(selected||'')===value?'checked':''}><span class="highlight-swatch ${swatch}"></span>${esc(label)}</label>`).join('')}</div></div>`;
}
function productFormFields(product){
  return product.catalogo==='heladeria'?`<div class="field"><label for="product-presentation">Cantidad / presentación</label><input id="product-presentation" maxlength="160" value="${esc(product.presentacion)}" placeholder="Ej: Caja x 100"></div>`:`<div class="field"><label for="product-bulk">Contenido del bulto</label><input id="product-bulk" maxlength="160" value="${esc(product.cantidad_bulto)}" placeholder="Ej: 12 paquetes x 100"></div>`;
}

function openEditProduct(id){
  const product=state.products.find(item=>item.id===id);if(!product)return;
  const categories=unique('categoria',state.products.filter(item=>item.catalogo===product.catalogo));
  $('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel" role="dialog" aria-modal="true"><div class="panel-head"><div><h2>Editar producto · ${esc(CATALOGS[product.catalogo]?.name||product.catalogo)}</h2><p>Corregí el código o los datos generales. Los precios se editan directamente desde la lista.</p></div><button class="icon-close" data-close>×</button></div><form id="edit-product-form"><div class="product-form"><div class="field"><label for="edit-product-code">Código <span class="required">*</span></label><input id="edit-product-code" maxlength="7" value="${esc(product.codigo)}" autocapitalize="characters" required><small class="form-help">Formato ${codeFormatHint(product.catalogo)}</small></div><div class="field field-wide"><label for="edit-product-name">Nombre <span class="required">*</span></label><input id="edit-product-name" maxlength="240" value="${esc(product.nombre)}" required></div><div class="field field-wide"><label for="edit-product-category">Categoría <span class="required">*</span></label><input id="edit-product-category" maxlength="120" list="edit-category-options" value="${esc(product.categoria)}" required><datalist id="edit-category-options">${categories.map(value=>`<option value="${esc(value)}"></option>`).join('')}</datalist></div>${productFormFields(product)}<div class="field field-wide"><label for="edit-product-notes">Observaciones</label><input id="edit-product-notes" maxlength="500" value="${esc(product.observaciones)}" placeholder="Opcional"></div>${highlightPickerField(product.highlight)}</div><div id="edit-product-error" class="form-error" hidden></div><div class="panel-actions"><button class="btn btn-quiet" type="button" data-close>Cancelar</button><button class="btn btn-accent" id="edit-product-submit" type="submit">Guardar cambios</button></div></form></section></div>`;
  bindPanelClose();$('#edit-product-form').onsubmit=event=>updateProduct(event,product);setTimeout(()=>{$('#edit-product-name')?.focus();$('#edit-product-name')?.select();},50);
}

async function updateProduct(event,product){
  event.preventDefault();const name=$('#edit-product-name').value.trim(),category=$('#edit-product-category').value.trim(),code=$('#edit-product-code').value.trim().toUpperCase(),bulk=$('#product-bulk')?.value.trim()||'',presentation=$('#product-presentation')?.value.trim()||'',notes=$('#edit-product-notes').value.trim(),highlight=document.querySelector('input[name="product-highlight"]:checked')?.value||null,error=$('#edit-product-error'),button=$('#edit-product-submit');
  if(!name||!category){error.textContent='Completá nombre y categoría.';error.hidden=false;return;}button.disabled=true;button.textContent='Guardando…';
  if(!validProductCode(code,product.catalogo)){error.textContent=`El código debe tener el formato ${codeFormatHint(product.catalogo)}.`;error.hidden=false;button.disabled=false;button.textContent='Guardar cambios';return;}
  try{
    if(state.preview){Object.assign(product,{codigo:code,nombre:name,categoria:category,cantidad_bulto:bulk,presentacion:presentation,observaciones:notes,highlight});}
    else{await rpc('papelera_update_product_v2',{p_product_id:product.id,p_name:name,p_category:category,p_bulk_quantity:bulk,p_presentation:presentation,p_notes:notes,p_code:code,p_highlight:highlight});await loadCloudData();}
    closePanel();renderAll();showToast(`${name} fue actualizado.`);
  }catch(failure){error.textContent=readableError(failure);error.hidden=false;button.disabled=false;button.textContent='Guardar cambios';}
}

function confirmDeactivateProduct(product){
  $('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel" role="dialog" aria-modal="true"><div class="confirm-card"><div class="confirm-icon">×</div><h2>Eliminar producto</h2><p><strong>${esc(product.nombre)}</strong> dejará de aparecer en la lista y en los presupuestos. Sus datos y precios quedarán guardados en la nube para poder recuperarlos.</p><div class="panel-actions"><button class="btn btn-quiet" data-close>Cancelar</button><button class="btn btn-danger" id="deactivate-confirm">Eliminar</button></div></div></section></div>`;
  bindPanelClose();$('#deactivate-confirm').onclick=()=>deactivateProduct(product);
}

async function deactivateProduct(product){
  const button=$('#deactivate-confirm');button.disabled=true;button.textContent='Eliminando…';
  try{
    if(state.preview)product.activo=false;else{await rpc('papelera_deactivate_product',{p_product_id:product.id});await loadCloudData();}
    state.selected.delete(product.id);state.quote.items=state.quote.items.filter(item=>item.id!==product.id);if(state.preview)state.products=state.products.filter(item=>item.id!==product.id);closePanel();renderAll();showToast(`${product.nombre} fue eliminado de la lista.`);
  }catch(failure){showToast(readableError(failure));button.disabled=false;button.textContent='Eliminar';}
}

function targetProducts(){
  const scope=state.increase.scope;if(scope==='all')return catalogProducts();if(scope==='selected')return selectedProducts();if(scope.startsWith('category:'))return catalogProducts().filter(product=>product.categoria===scope.slice(9));return [];
}
function increaseChanges(){return targetProducts().flatMap(product=>priceFieldsFor(product.catalogo).filter(field=>state.increase.tiers.has(field.tier)&&isPrice(product[field.key])).map(field=>({product,field,old:product[field.key],next:Math.round(product[field.key]*(1+Number(state.increase.percentage||0)/100))})));}
function openIncrease(forceSelected=false){
  if(forceSelected||state.selected.size)state.increase.scope='selected';if(state.increase.scope==='selected'&&!state.selected.size)state.increase.scope='all';renderIncreaseModal();
}

function renderIncreaseModal(){
  const fields=priceFieldsFor(state.catalog),changes=increaseChanges(),products=new Set(changes.map(change=>change.product.id)).size,tiers=fields.filter(field=>state.increase.tiers.has(field.tier)).map(field=>field.label).join(', '),single=fields.length===1;
  $('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel" role="dialog" aria-modal="true"><div class="panel-head"><div><h2>Aumentar precios</h2><p>Podés usar un número negativo para aplicar un descuento.</p></div><button class="icon-close" data-close>×</button></div><section class="panel-section"><span class="step-label">ALCANCE</span><h3>¿Qué productos querés modificar?</h3><div class="scope-select"><label for="increase-scope">Aplicar a</label><select id="increase-scope"><option value="all" ${state.increase.scope==='all'?'selected':''}>Todos los productos</option>${state.selected.size?`<option value="selected" ${state.increase.scope==='selected'?'selected':''}>Productos seleccionados (${number(state.selected.size)})</option>`:''}${unique('categoria').map(category=>`<option value="category:${esc(category)}" ${state.increase.scope===`category:${category}`?'selected':''}>Categoría · ${esc(category)}</option>`).join('')}</select></div></section><section class="panel-section"><span class="step-label">${single?'PRECIO':'PRESENTACIONES'}</span><h3>${single?'¿Qué precio aumenta?':'¿Qué listas de precio aumentan?'}</h3><div class="tier-grid">${fields.map(field=>`<label class="tier-option"><input type="checkbox" data-increase-tier="${field.tier}" ${state.increase.tiers.has(field.tier)?'checked':''}><span>${field.label}</span></label>`).join('')}</div></section><section class="panel-section"><span class="step-label">PORCENTAJE</span><h3>Definí el cambio</h3><div class="percentage-box"><div class="percentage-hint">Aumento positivo · descuento negativo</div><div class="field"><input id="increase-percentage" type="number" step="0.1" value="${state.increase.percentage}" aria-label="Porcentaje"></div></div><p class="form-help">Ejemplos: 10 aumenta un 10%; -5 descuenta un 5%.</p></section><section class="panel-section"><div class="preview-summary"><div class="preview-stat"><small>Productos</small><strong id="increase-products">${number(products)}</strong></div><div class="preview-stat"><small>Precios</small><strong id="increase-prices">${number(changes.length)}</strong></div><div class="preview-stat"><small>Columnas</small><strong id="increase-tiers">${number(state.increase.tiers.size)}</strong></div></div><div class="notice" id="increase-notice"><strong>Se modificarán:</strong> ${esc(tiers||'ningún precio')}. El cambio se aplica al confirmar.</div></section><div class="panel-actions"><button class="btn btn-quiet" data-close>Cancelar</button><button class="btn btn-accent" id="increase-confirm" ${!changes.length||!state.increase.tiers.size||!Number.isFinite(Number(state.increase.percentage))||Number(state.increase.percentage)<=-100?'disabled':''}>Aplicar aumento</button></div></section></div>`;
  bindPanelClose();$('#increase-scope').onchange=event=>{state.increase.scope=event.target.value;updateIncreasePreview();};document.querySelectorAll('[data-increase-tier]').forEach(input=>input.onchange=()=>{input.checked?state.increase.tiers.add(input.dataset.increaseTier):state.increase.tiers.delete(input.dataset.increaseTier);updateIncreasePreview();});$('#increase-percentage').oninput=event=>{state.increase.percentage=Number(event.target.value);updateIncreasePreview();};$('#increase-confirm').onclick=applyIncrease;
}

function updateIncreasePreview(){
  const changes=increaseChanges(),products=new Set(changes.map(change=>change.product.id)).size,tiers=priceFieldsFor(state.catalog).filter(field=>state.increase.tiers.has(field.tier)).map(field=>field.label),percentage=Number(state.increase.percentage),valid=changes.length&&tiers.length&&Number.isFinite(percentage)&&percentage>-100;
  $('#increase-products').textContent=number(products);$('#increase-prices').textContent=number(changes.length);$('#increase-tiers').textContent=number(tiers.length);$('#increase-notice').innerHTML=`<strong>Se modificarán:</strong> ${esc(tiers.join(', ')||'ningún precio')}. El cambio se aplica al confirmar.`;const button=$('#increase-confirm');button.disabled=!valid;button.textContent=percentage<0?'Aplicar descuento':'Aplicar aumento';
}

async function applyIncrease(){
  const button=$('#increase-confirm'),changes=increaseChanges();button.disabled=true;button.textContent='Aplicando…';
  try{
    if(state.preview){for(const change of changes)change.product[change.field.key]=change.next;}
    else{const category=state.increase.scope.startsWith('category:')?state.increase.scope.slice(9):null,scope=state.increase.scope.startsWith('category:')?'category':state.increase.scope;await rpc('papelera_apply_price_increase',{p_percentage:state.increase.percentage,p_tiers:[...state.increase.tiers],p_scope:scope,p_category:category,p_product_ids:scope==='selected'?[...state.selected]:null,p_catalog_slug:state.catalog});await loadCloudData();}
    closePanel();renderAll();showToast(`Listo: se actualizaron ${number(changes.length)} precios.`);
  }catch(error){showToast(readableError(error));button.disabled=false;updateIncreasePreview();}
}

function createEmptyQuote(){return {number:null,savedId:null,client:'',address:'',discountPercentage:0,previousBalance:0,items:[]};}
function goView(view){state.view=view;document.querySelectorAll('.app-view').forEach(section=>{const active=section.id===`${view}-view`;section.classList.toggle('active',active);section.hidden=!active;});document.querySelectorAll('.app-tab').forEach(tab=>{const active=tab.dataset.view===view;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});if(view==='quote')renderQuote();window.scrollTo({top:0,behavior:'smooth'});requestCatalogFrozenHeaderUpdate();}
function openQuote(seedSelection=false){if(seedSelection){for(const product of selectedProducts())if(firstPriceField(product)&&!state.quote.items.some(item=>item.id===product.id))state.quote.items.push(newQuoteItem(product));}goView('quote');}
function firstPriceField(product){return priceFieldsFor(product.catalogo).find(field=>isPrice(product[field.key]))||null;}
function priceDetail(product,field){if(product.catalogo==='heladeria')return product.presentacion||'Cantidad no informada';if(field.tier==='bulto'&&product.cantidad_bulto)return product.cantidad_bulto;return field.detail;}
function newQuoteItem(product){return {id:product.id,tier:firstPriceField(product)?.tier||'',quantity:1,priceOverride:null};}
function syncQuoteFields(){if(!state.quote)return;state.quote.client=$('#quote-client').value;state.quote.address=$('#quote-address').value;}
function quoteRows(){const byId=new Map(state.products.map(product=>[product.id,product]));return state.quote.items.map(item=>{const product=byId.get(item.id),field=FIELD_BY_TIER.get(item.tier),quantity=Math.max(1,Math.round(Number(item.quantity)||1)),catalogUnitPrice=product&&field&&isPrice(product[field.key])?product[field.key]:null;if(!product||!field||!isPrice(catalogUnitPrice))return null;const overridden=isPrice(item.priceOverride),unitPrice=overridden?item.priceOverride:catalogUnitPrice,amount=unitPrice*quantity,catalogAmount=catalogUnitPrice*quantity;return {...item,product,field,quantity,unitPrice,catalogUnitPrice,catalogAmount,amount,overridden};}).filter(Boolean);}
function normaliseDiscount(value){const parsed=Number(String(value??0).replace(',','.'));return Number.isFinite(parsed)?Math.min(100,Math.max(0,parsed)):0;}
function normalisePreviousBalance(value){const parsed=Number(String(value??0).replace(',','.'));return Number.isFinite(parsed)?Math.round(parsed):0;}
function quoteTotals(rows=quoteRows()){const subtotal=rows.reduce((sum,row)=>sum+row.amount,0),discountPercentage=normaliseDiscount(state.quote.discountPercentage),discountAmount=Math.round(subtotal*discountPercentage/100),previousBalance=normalisePreviousBalance(state.quote.previousBalance);return {subtotal,discountPercentage,discountAmount,previousBalance,total:subtotal-discountAmount+previousBalance};}
async function nextQuoteNumber(){const value=state.preview?++state.previewQuoteNumber:await rpc('papelera_next_quote_number',{}),numberValue=Array.isArray(value)?value[0]:value;if(!Number.isInteger(Number(numberValue))||Number(numberValue)<1)throw new Error('No se pudo generar el número de presupuesto.');state.quote.number=String(numberValue);return state.quote.number;}

function renderQuote(){
  if(!state.quote)state.quote=createEmptyQuote();$('#quote-client').value=state.quote.client;$('#quote-address').value=state.quote.address;$('#quote-discount').value=state.quote.discountPercentage;$('#quote-balance').value=state.quote.previousBalance;
  const rows=quoteRows();$('#quote-items').innerHTML=rows.length?rows.map(quoteItemRow).join(''):'<div class="quote-empty"><strong>Todavía no agregaste productos</strong><span>Buscalos arriba o seleccioná varios desde la lista de precios.</span></div>';updateQuoteTotals();
  document.querySelectorAll('[data-quote-remove]').forEach(button=>button.onclick=()=>{state.quote.items=state.quote.items.filter(item=>item.id!==button.dataset.quoteRemove);renderQuote();});
  document.querySelectorAll('[data-quote-tier]').forEach(select=>select.onchange=()=>{const item=state.quote.items.find(entry=>entry.id===select.dataset.quoteTier);if(item){item.tier=select.value;item.priceOverride=null;}renderQuote();});
  document.querySelectorAll('[data-quote-qty]').forEach(input=>{input.oninput=()=>{const item=state.quote.items.find(entry=>entry.id===input.dataset.quoteQty);if(item)item.quantity=Math.max(1,Math.round(Number(input.value)||1));updateQuoteTotals();};input.onchange=()=>{input.value=Math.max(1,Math.round(Number(input.value)||1));};});
  document.querySelectorAll('[data-quote-price]').forEach(input=>{input.onfocus=()=>input.select();input.onkeydown=event=>{if(event.key==='Enter')input.blur();};input.oninput=()=>{const item=state.quote.items.find(entry=>entry.id===input.dataset.quotePrice);if(!item)return;const parsed=parsePrice(input.value);item.priceOverride=isPrice(parsed)?parsed:null;updateQuoteTotals();};input.onchange=()=>{const item=state.quote.items.find(entry=>entry.id===input.dataset.quotePrice);if(!item)return;const parsed=parsePrice(input.value);if(parsed===null)item.priceOverride=null;else if(Number.isNaN(parsed)||parsed<0){showToast('Ingresá un precio válido.');}else item.priceOverride=parsed;renderQuote();};});
  document.querySelectorAll('[data-quote-reset-price]').forEach(button=>button.onclick=()=>{const item=state.quote.items.find(entry=>entry.id===button.dataset.quoteResetPrice);if(item)item.priceOverride=null;renderQuote();});
  for(const id of ['quote-pdf','quote-excel','quote-whatsapp','quote-text'])$('#'+id).disabled=!rows.length;
}

function quoteItemRow(row){
  const options=priceFieldsFor(row.product.catalogo).filter(field=>isPrice(row.product[field.key])).map(field=>`<option value="${field.tier}" ${field.tier===row.tier?'selected':''}>${row.product.catalogo==='heladeria'?esc(priceDetail(row.product,field)):`${field.label} · ${esc(priceDetail(row.product,field))}`} · ${money(row.product[field.key])}</option>`).join('');
  return `<div class="quote-item${row.overridden?' is-overridden':''}"><div class="quote-product"><strong>${esc(row.product.nombre)}</strong><small>${esc(CATALOGS[row.product.catalogo]?.name||row.product.catalogo)} · ${esc(row.product.categoria)}</small></div><select data-quote-tier="${row.product.id}" aria-label="Presentación de ${esc(row.product.nombre)}">${options}</select><input data-quote-qty="${row.product.id}" type="number" min="1" step="1" value="${row.quantity}" aria-label="Cantidad de presentaciones de ${esc(row.product.nombre)}"><div class="quote-line-price" data-total-id="${row.product.id}"><input class="quote-line-total${row.overridden?' is-custom':''}" data-quote-price="${row.product.id}" inputmode="numeric" value="${row.overridden?number(row.unitPrice):''}" placeholder="${number(row.catalogUnitPrice)}" title="Precio por unidad de esta presentación; la cantidad lo multiplica sola" aria-label="Precio unitario de ${esc(row.product.nombre)}"><small class="quote-line-computed" data-total-readout>Total ${money(row.amount)}</small></div><button class="quote-remove" data-quote-remove="${row.product.id}" aria-label="Quitar ${esc(row.product.nombre)}">×</button><button type="button" class="quote-price-flag" data-quote-reset-price="${row.product.id}" ${row.overridden?'':'hidden'} title="Volver a cobrar el precio de catálogo">Precio modificado · Restablecer</button></div>`;
}

function updateQuoteTotals(){const rows=quoteRows(),totals=quoteTotals(rows);for(const row of rows){const wrap=document.querySelector(`[data-total-id="${row.product.id}"]`);if(!wrap)continue;const input=wrap.querySelector('.quote-line-total');input.placeholder=number(row.catalogUnitPrice);input.classList.toggle('is-custom',row.overridden);if(!row.overridden&&document.activeElement!==input)input.value='';const readout=wrap.querySelector('[data-total-readout]');if(readout)readout.textContent=`Total ${money(row.amount)}`;const flag=document.querySelector(`[data-quote-reset-price="${row.product.id}"]`);if(flag)flag.hidden=!row.overridden;}$('#quote-subtotal').textContent=money(totals.subtotal);$('#quote-discount-amount').textContent=`− ${money(totals.discountAmount)}`;const balanceEl=$('#quote-balance-amount');balanceEl.textContent=totals.previousBalance===0?money(0):`${totals.previousBalance>0?'+':'−'} ${money(Math.abs(totals.previousBalance))}`;balanceEl.classList.toggle('balance-positive',totals.previousBalance>0);balanceEl.classList.toggle('balance-negative',totals.previousBalance<0);$('#quote-total').textContent=money(totals.total);}
const QUOTE_SEARCH_LIMIT=50;
async function renderQuoteSearch(){
  const query=$('#quote-search').value.trim(),container=$('#quote-results');
  if(normalizeSearch(query).length<2){container.hidden=true;container.innerHTML='';return;}
  const missing=Object.keys(CATALOGS).filter(slug=>!state.loadedCatalogs.has(slug));
  if(missing.length){
    container.hidden=false;container.innerHTML='<div class="quote-no-results">Cargando productos…</div>';
    try{await Promise.all(missing.map(loadCatalogData));}catch(error){container.innerHTML=`<div class="quote-no-results">${esc(readableError(error))}</div>`;return;}
    if($('#quote-search').value.trim()!==query)return;
  }
  const existing=new Set(state.quote.items.map(item=>item.id)),all=rankBySearch(state.products.filter(product=>!existing.has(product.id)&&firstPriceField(product)&&matchesProductSearch(product,query)),query),matches=all.slice(0,QUOTE_SEARCH_LIMIT);
  container.hidden=false;
  const rows=matches.map(product=>`<button type="button" data-quote-add="${product.id}"><span><strong><span class="product-code">${esc(product.codigo)}</span>${esc(product.nombre)}</strong><small>${esc(CATALOGS[product.catalogo]?.name||product.catalogo)} · ${esc(product.categoria)}</small></span><b>Agregar</b></button>`).join('');
  const truncated=all.length>matches.length?`<div class="quote-search-truncated">Mostrando ${number(matches.length)} de ${number(all.length)} resultados · seguí escribiendo para afinar</div>`:'';
  container.innerHTML=matches.length?rows+truncated:'<div class="quote-no-results">No encontramos productos con precio.</div>';
  container.querySelectorAll('[data-quote-add]').forEach(button=>button.onclick=()=>{const product=state.products.find(item=>item.id===button.dataset.quoteAdd);if(product)state.quote.items.push(newQuoteItem(product));$('#quote-search').value='';container.hidden=true;renderQuote();});
}

function confirmClearQuote(){if(!state.quote.items.length){state.quote=createEmptyQuote();renderQuote();return;}$('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel" role="dialog" aria-modal="true"><div class="confirm-card"><div class="confirm-icon">×</div><h2>Vaciar presupuesto</h2><p>Se quitarán los datos del cliente y todos los productos cargados.</p><div class="panel-actions"><button class="btn btn-quiet" data-close>Cancelar</button><button class="btn btn-danger" id="clear-quote-confirm">Vaciar</button></div></div></section></div>`;bindPanelClose();$('#clear-quote-confirm').onclick=()=>{state.quote=createEmptyQuote();closePanel();renderQuote();};}

function quoteData(){syncQuoteFields();const rows=quoteRows(),totals=quoteTotals(rows);return {number:state.quote.number,client:state.quote.client,address:state.quote.address,date:prettyDate(),items:rows.map(row=>({name:row.product.nombre,category:`${CATALOGS[row.product.catalogo]?.name||row.product.catalogo} · ${row.product.categoria}`,priceLabel:(row.product.catalogo==='heladeria'?priceDetail(row.product,row.field):row.field.label+(row.field.tier==='bulto'&&row.product.cantidad_bulto?` (${row.product.cantidad_bulto})`:''))+(row.overridden?' · Precio acordado':''),quantity:row.quantity,unitPrice:row.unitPrice,amount:row.amount})),...totals};}
async function issuedQuoteData(){const data=quoteData();if(!data.items.length)throw new Error('Agregá al menos un producto.');data.number=await nextQuoteNumber();return data;}
function todayIso(){return new Intl.DateTimeFormat('en-CA').format(new Date());}
function prettyDate(){return new Intl.DateTimeFormat('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());}
function safeName(value){return String(value||'documento').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'documento';}
async function printQuotePdf(){const target=window.open('','_blank');try{const data=await issuedQuoteData(),bytes=await window.RomaDocuments.buildQuotePdf(data);window.RomaDocuments.print(bytes,target);showToast(`Presupuesto N.º ${data.number} listo para imprimir o guardar como PDF.`);}catch(error){target?.close();showToast(readableError(error));}}
async function shareQuotePdf(){
  const target=window.open('','_blank');
  try{
    const data=await issuedQuoteData(),bytes=await window.RomaDocuments.buildQuotePdf(data),result=await window.RomaDocuments.sharePdf(bytes,`papelera-roma-presupuesto-${data.number}-${safeName(data.client||'cliente')}.pdf`,'Presupuesto Papelera Roma');
    if(result.downloaded){
      const url=`https://wa.me/?text=${encodeURIComponent(`Presupuesto N.º ${data.number} de Papelera Roma. Adjuntá el PDF descargado.`)}`;
      if(target&&!target.closed)target.location.href=url;else window.open(url,'_blank','noopener');
      showToast('PDF descargado para adjuntar en WhatsApp.');
    }else target?.close();
  }catch(error){target?.close();showToast(readableError(error));}
}
async function shareQuoteText(){const target=window.open('','_blank');try{const data=await issuedQuoteData(),lines=[`*PAPELERA ROMA · PRESUPUESTO N.º ${data.number}*`,`Fecha: ${data.date}`,data.client?`Cliente: ${data.client}`:'','',...data.items.map(item=>`${item.quantity} × ${item.name} · ${item.priceLabel} — ${money(item.amount)}`),'',`Subtotal: ${money(data.subtotal)}`,data.discountPercentage?`Descuento ${data.discountPercentage}%: - ${money(data.discountAmount)}`:'',data.previousBalance?`Saldo anterior: ${data.previousBalance>0?'+':'−'} ${money(Math.abs(data.previousBalance))}`:'',`*TOTAL: ${money(data.total)}*`].filter(Boolean);target.location.href=`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;}catch(error){target?.close();showToast(readableError(error));}}

function priceListData(items=filtered(),label=state.filters.category||'Lista completa'){return {items,title:`${catalogName()} · ${label}`,date:prettyDate(),priceFields:priceFieldsFor(state.catalog),detailKey:state.catalog==='heladeria'?'presentacion':null,detailLabel:state.catalog==='heladeria'?'Cantidad / presentación':null};}
function openPrintPriceList(){
  const allCount=catalogProducts().length,selectedCount=selectedProducts().length,defaultScope=selectedCount?'selected':'all';
  $('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel" role="dialog" aria-modal="true" aria-labelledby="print-list-title"><div class="panel-head"><div><h2 id="print-list-title">Imprimir lista / PDF</h2><p>Elegí qué productos querés incluir en el documento.</p></div><button class="icon-close" type="button" data-close>×</button></div><form id="print-list-form"><div class="print-scope-grid"><label class="print-scope-option"><input type="radio" name="print-scope" value="all" ${defaultScope==='all'?'checked':''}><span><strong>Toda la lista</strong><small>${number(allCount)} productos de ${esc(catalogName())}</small></span></label><label class="print-scope-option ${selectedCount?'':'disabled'}"><input type="radio" name="print-scope" value="selected" ${defaultScope==='selected'?'checked':''} ${selectedCount?'':'disabled'}><span><strong>Solo los seleccionados</strong><small>${selectedCount?`${number(selectedCount)} producto${selectedCount===1?'':'s'} seleccionado${selectedCount===1?'':'s'}`:'Seleccioná productos desde la lista para habilitar esta opción'}</small></span></label></div><div class="notice">El PDF respetará el orden actual de los productos y sus categorías.</div><div class="panel-actions"><button class="btn btn-quiet" type="button" data-close>Cancelar</button><button class="btn btn-accent" id="print-list-confirm" type="submit">Continuar</button></div></form></section></div>`;
  bindPanelClose();$('#print-list-form').onsubmit=event=>{event.preventDefault();const scope=new FormData(event.currentTarget).get('print-scope')||'all';closePanel();printPriceList(scope);};
}
async function printPriceList(scope='all'){const selected=scope==='selected',items=selected?selectedProducts():catalogProducts(),data=priceListData(items,selected?`Selección · ${number(items.length)} productos`:'Lista completa');if(!data.items.length)return showToast(selected?'No hay productos seleccionados para imprimir.':'No hay productos para imprimir.');const target=window.open('','_blank');try{const bytes=await window.RomaDocuments.buildPriceListPdf(data);window.RomaDocuments.print(bytes,target);showToast(`Lista lista para imprimir: ${number(data.items.length)} productos.`);}catch(error){target?.close();showToast(readableError(error));}}
function openSharePriceList(mode='pdf'){
  const allCount=catalogProducts().length,selectedCount=selectedProducts().length,defaultScope=selectedCount?'selected':'all',isText=mode==='text';
  $('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel" role="dialog" aria-modal="true" aria-labelledby="share-list-title"><div class="panel-head"><div><h2 id="share-list-title">${isText?'Enviar como texto por WhatsApp':'Enviar lista por WhatsApp'}</h2><p>Elegí qué productos querés incluir${isText?' en el mensaje':' en el PDF'}.</p></div><button class="icon-close" type="button" data-close>×</button></div><form id="share-list-form"><div class="print-scope-grid"><label class="print-scope-option"><input type="radio" name="share-scope" value="all" ${defaultScope==='all'?'checked':''}><span><strong>Toda la lista</strong><small>${number(allCount)} productos de ${esc(catalogName())}</small></span></label><label class="print-scope-option ${selectedCount?'':'disabled'}"><input type="radio" name="share-scope" value="selected" ${defaultScope==='selected'?'checked':''} ${selectedCount?'':'disabled'}><span><strong>Solo los seleccionados</strong><small>${selectedCount?`${number(selectedCount)} producto${selectedCount===1?'':'s'} seleccionado${selectedCount===1?'':'s'}`:'Seleccioná productos desde la lista para habilitar esta opción'}</small></span></label></div><div class="panel-actions"><button class="btn btn-quiet" type="button" data-close>Cancelar</button><button class="btn btn-accent" type="submit">Continuar</button></div></form></section></div>`;
  bindPanelClose();$('#share-list-form').onsubmit=event=>{event.preventDefault();const scope=new FormData(event.currentTarget).get('share-scope')||'all';closePanel();(isText?sharePriceListText:sharePriceList)(scope);};
}
async function sharePriceList(scope='all'){
  const selected=scope==='selected',items=selected?selectedProducts():catalogProducts(),data=priceListData(items,selected?`Selección · ${number(items.length)} productos`:'Lista completa');
  if(!data.items.length)return showToast(selected?'No hay productos seleccionados para compartir.':'No hay productos para compartir.');
  const target=window.open('','_blank');
  try{
    const bytes=await window.RomaDocuments.buildPriceListPdf(data),filename=`papelera-roma-${state.catalog}-precios-${todayIso()}.pdf`,result=await window.RomaDocuments.sharePdf(bytes,filename,`Lista de precios ${catalogName()}`);
    if(result.downloaded){
      const text=`Lista de precios${selected?' (selección)':''} de ${catalogName()} · Papelera Roma. Adjuntá el PDF descargado.`,url=`https://wa.me/?text=${encodeURIComponent(text)}`;
      if(target&&!target.closed)target.location.href=url;else window.open(url,'_blank','noopener');
      showToast('Lista descargada para adjuntar en WhatsApp.');
    }else target?.close();
  }catch(error){target?.close();showToast(readableError(error));}
}
function priceListLine(product){
  const fields=priceFieldsFor(product.catalogo).filter(field=>isPrice(product[field.key])),detail=product.catalogo==='heladeria'?(product.presentacion?` (${product.presentacion})`:''):(product.cantidad_bulto?` (Bulto: ${product.cantidad_bulto})`:''),tiers=fields.map(field=>`${field.label} ${money(product[field.key])}`).join(' · ');
  return `${product.codigo} · ${product.nombre}${detail}${tiers?` — ${tiers}`:' — sin precio'}`;
}
function sharePriceListText(scope='all'){
  const selected=scope==='selected',items=selected?selectedProducts():catalogProducts();
  if(!items.length)return showToast(selected?'No hay productos seleccionados para compartir.':'No hay productos para compartir.');
  const target=window.open('','_blank');
  try{
    const lines=[`*${catalogName().toUpperCase()} · PAPELERA ROMA*`,selected?`Selección · ${number(items.length)} productos`:`Lista completa · ${number(items.length)} productos`,'',...items.map(priceListLine)],text=lines.join('\n');
    if(text.length>6000){target?.close();showToast('La selección es muy grande para enviar como texto. Elegí menos productos o usá el PDF.');return;}
    const url=`https://wa.me/?text=${encodeURIComponent(text)}`;
    if(target&&!target.closed)target.location.href=url;else window.open(url,'_blank','noopener');
  }catch(error){target?.close();showToast(readableError(error));}
}

function xmlEscape(value){return String(value??'').replace(/[<>&"']/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]));}
function excelDocument(products){const catalog=products[0]?.catalogo||state.catalog,fields=priceFieldsFor(catalog),columns=catalog==='heladeria'?[['Código','codigo','String',80],['Producto','nombre','String',300],['Categoría','categoria','String',190],['Cantidad / presentación','presentacion','String',190],['Precio','precio','Number',110],['Observaciones','observaciones','String',220]]:[['Código','codigo','String',80],['Producto','nombre','String',280],['Categoría','categoria','String',180],...fields.map(field=>[field.label,field.key,'Number',95]),['Contenido del bulto','cantidad_bulto','String',180],['Observaciones','observaciones','String',280]];const header=columns.map(([label])=>`<Cell ss:StyleID="Header"><Data ss:Type="String">${xmlEscape(label)}</Data></Cell>`).join(''),rows=products.map(product=>`<Row>${columns.map(([,key,type])=>{const value=product[key];if(type==='Number'&&!isPrice(value))return '<Cell></Cell>';return `<Cell${type==='Number'?' ss:StyleID="Money"':''}><Data ss:Type="${type}">${type==='Number'?Number(value):xmlEscape(value)}</Data></Cell>`;}).join('')}</Row>`).join('');return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default"><Font ss:FontName="Arial" ss:Size="10"/><Alignment ss:Vertical="Center"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#087F86" ss:Pattern="Solid"/></Style><Style ss:ID="Money"><NumberFormat ss:Format="&quot;$&quot; #,##0"/></Style></Styles><Worksheet ss:Name="Productos"><Table>${columns.map(column=>`<Column ss:Width="${column[3]}"/>`).join('')}<Row ss:Height="24">${header}</Row>${rows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet></Workbook>`;}
function downloadExcel(products,stamp=new Date(),filename=''){if(!products.length)return showToast('No hay productos para exportar.');const blob=new Blob([excelDocument(products)],{type:'application/vnd.ms-excel;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a'),date=new Intl.DateTimeFormat('en-CA').format(new Date(stamp));link.href=url;link.download=filename||`papelera-roma-${state.catalog}-precios-${date}.xls`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast(`Excel generado con ${number(products.length)} productos.`);}
function quoteExcelDocument(data){const rows=data.items.map(item=>`<Row><Cell><Data ss:Type="Number">${item.quantity}</Data></Cell><Cell><Data ss:Type="String">${xmlEscape(item.name)}</Data></Cell><Cell><Data ss:Type="String">${xmlEscape(item.category)}</Data></Cell><Cell><Data ss:Type="String">${xmlEscape(item.priceLabel)}</Data></Cell><Cell ss:StyleID="Money"><Data ss:Type="Number">${item.unitPrice}</Data></Cell><Cell ss:StyleID="Money"><Data ss:Type="Number">${item.amount}</Data></Cell></Row>`).join('');return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default"><Font ss:FontName="Arial" ss:Size="10"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#087F86" ss:Pattern="Solid"/></Style><Style ss:ID="Money"><NumberFormat ss:Format="&quot;$&quot; #,##0"/></Style></Styles><Worksheet ss:Name="Presupuesto"><Table><Column ss:Width="60"/><Column ss:Width="280"/><Column ss:Width="170"/><Column ss:Width="150"/><Column ss:Width="95"/><Column ss:Width="110"/><Row><Cell ss:MergeAcross="5" ss:StyleID="Header"><Data ss:Type="String">PAPELERA ROMA · PRESUPUESTO ${xmlEscape(data.number)}</Data></Cell></Row><Row><Cell ss:MergeAcross="5"><Data ss:Type="String">Cliente: ${xmlEscape(data.client||'')} · Fecha: ${xmlEscape(data.date)}</Data></Cell></Row><Row>${['Cantidad','Producto','Categoría','Presentación','Precio','Importe'].map(label=>`<Cell ss:StyleID="Header"><Data ss:Type="String">${label}</Data></Cell>`).join('')}</Row>${rows}<Row><Cell ss:MergeAcross="4"><Data ss:Type="String">SUBTOTAL</Data></Cell><Cell ss:StyleID="Money"><Data ss:Type="Number">${data.subtotal}</Data></Cell></Row><Row><Cell ss:MergeAcross="4"><Data ss:Type="String">DESCUENTO ${data.discountPercentage}%</Data></Cell><Cell ss:StyleID="Money"><Data ss:Type="Number">${-data.discountAmount}</Data></Cell></Row>${data.previousBalance?`<Row><Cell ss:MergeAcross="4"><Data ss:Type="String">SALDO ANTERIOR</Data></Cell><Cell ss:StyleID="Money"><Data ss:Type="Number">${data.previousBalance}</Data></Cell></Row>`:''}<Row><Cell ss:MergeAcross="4" ss:StyleID="Header"><Data ss:Type="String">TOTAL</Data></Cell><Cell ss:StyleID="Money"><Data ss:Type="Number">${data.total}</Data></Cell></Row></Table></Worksheet></Workbook>`;}
async function downloadQuoteExcel(){try{const data=await issuedQuoteData(),blob=new Blob([quoteExcelDocument(data)],{type:'application/vnd.ms-excel;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`papelera-roma-presupuesto-${data.number}-${safeName(data.client||'cliente')}.xls`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast(`Presupuesto N.º ${data.number} exportado a Excel.`);}catch(error){showToast(readableError(error));}}

async function saveBackup(){
  if(state.preview)return showToast('Las copias en la nube no están disponibles en la vista previa local.');const button=$('#save-backup');button.disabled=true;button.textContent='Guardando…';
  try{await rpc('papelera_create_catalog_backup',{p_label:`${catalogName()} · Copia ${prettyDate()}`,p_catalog_slug:state.catalog});await refreshBackups();showToast(`Copia de ${catalogName()} guardada: ${number(catalogProducts().length)} productos.`);}
  catch(error){showToast(readableError(error));}finally{button.disabled=false;button.textContent='☁ Guardar copia';}
}
async function refreshBackups(){if(state.preview)return;state.backups=await db('catalog_backups?select=id,label,product_count,price_count,created_at,catalog:catalogs(slug,name)&order=created_at.desc&limit=40');renderSummary();}
async function openBackups(){if(state.preview)return showToast('Las copias en la nube no están disponibles en la vista previa local.');$('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel panel-wide"><div class="panel-head"><div><h2>Copias en la nube</h2><p>Se guardan en Papelera Roma y están disponibles desde cualquier dispositivo.</p></div><button class="icon-close" data-close>×</button></div><div class="loading-card"><span class="spinner"></span><strong>Cargando copias</strong></div></section></div>`;bindPanelClose();try{await refreshBackups();renderBackupsModal();}catch(error){closePanel();showToast(readableError(error));}}
function renderBackupsModal(){
  const backups=visibleBackups();$('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel panel-wide" role="dialog" aria-modal="true"><div class="panel-head"><div><h2>Copias de ${esc(catalogName())}</h2><p>Podés descargar una copia en Excel o restaurar solamente esta lista.</p></div><button class="icon-close" data-close>×</button></div><div class="notice">Las copias se almacenan en Supabase de Papelera Roma, no en este navegador.</div>${backups.length?`<div class="backup-list">${backups.map((backup,index)=>backupRow(backup,index)).join('')}</div>`:'<div class="panel-empty"><strong>Todavía no hay copias</strong><span>Usá “Guardar copia” desde la lista de precios.</span></div>'}</section></div>`;bindPanelClose();document.querySelectorAll('[data-backup-download]').forEach(button=>button.onclick=()=>downloadBackup(button.dataset.backupDownload));document.querySelectorAll('[data-backup-restore]').forEach(button=>button.onclick=()=>confirmRestore(button.dataset.backupRestore));document.querySelectorAll('[data-backup-delete]').forEach(button=>button.onclick=()=>confirmDeleteBackup(button.dataset.backupDelete));
}
function backupRow(backup,index){const date=new Intl.DateTimeFormat('es-AR',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(backup.created_at));return `<div class="backup-item"><div class="backup-icon">${index===0?'★':'◷'}</div><div class="backup-info"><strong>${esc(backup.label||'Copia guardada')}</strong><small>${date} · ${number(backup.product_count)} productos · ${number(backup.price_count)} precios</small></div><div class="backup-actions"><button class="btn btn-quiet" data-backup-download="${backup.id}">⇩ Excel</button><button class="btn btn-secondary" data-backup-restore="${backup.id}">Restaurar</button><button class="btn btn-danger" data-backup-delete="${backup.id}">Eliminar</button></div></div>`;}
async function downloadBackup(id){try{const [backup]=await db(`catalog_backups?select=snapshot,created_at,label&id=eq.${id}&limit=1`);if(!backup)throw new Error('Copia no encontrada.');downloadExcel((backup.snapshot?.products||[]).map(productFromSnapshot),backup.created_at,`papelera-roma-${state.catalog}-copia-${todayIso()}.xls`);}catch(error){showToast(readableError(error));}}
function confirmRestore(id){const backup=state.backups.find(item=>item.id===id);if(!backup)return;$('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel"><div class="confirm-card"><div class="confirm-icon">◷</div><h2>Restaurar copia</h2><p>El catálogo activo volverá a <strong>${number(backup.product_count)} productos</strong> y <strong>${number(backup.price_count)} precios</strong>.</p><div class="notice">Los productos creados después de esta copia quedarán inactivos; no se borran físicamente.</div><div class="panel-actions"><button class="btn btn-quiet" id="restore-back">Volver</button><button class="btn btn-accent" id="restore-confirm">Restaurar</button></div></div></section></div>`;$('#restore-back').onclick=renderBackupsModal;$('#restore-confirm').onclick=async()=>{const button=$('#restore-confirm');button.disabled=true;button.textContent='Restaurando…';try{await rpc('papelera_restore_catalog_backup',{p_backup_id:id});closePanel();await loadCloudData();showToast('La copia fue restaurada.');}catch(error){showToast(readableError(error));button.disabled=false;button.textContent='Restaurar';}};}
function confirmDeleteBackup(id){$('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel"><div class="confirm-card"><div class="confirm-icon">×</div><h2>Eliminar copia</h2><p>La copia se borrará de la nube. Esta acción no se puede deshacer.</p><div class="panel-actions"><button class="btn btn-quiet" id="delete-back">Volver</button><button class="btn btn-danger" id="delete-confirm">Eliminar</button></div></div></section></div>`;$('#delete-back').onclick=renderBackupsModal;$('#delete-confirm').onclick=async()=>{try{await db(`catalog_backups?id=eq.${id}`,{method:'DELETE'});await refreshBackups();renderBackupsModal();showToast('Copia eliminada.');}catch(error){showToast(readableError(error));}};}

async function refreshSavedQuotes(){if(state.preview)return;state.savedQuotes=await db('saved_quotes?select=id,label,item_count,total,updated_at&order=updated_at.desc&limit=40');$('#saved-quotes-count').textContent=number(state.savedQuotes.length);}
async function openSavedQuotes(){
  if(state.preview)return showToast('Los presupuestos guardados no están disponibles en la vista previa local.');
  $('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel panel-wide"><div class="panel-head"><div><h2>Presupuestos guardados</h2><p>Se guardan en Papelera Roma y están disponibles desde cualquier dispositivo.</p></div><button class="icon-close" data-close>×</button></div><div class="loading-card"><span class="spinner"></span><strong>Cargando presupuestos</strong></div></section></div>`;
  bindPanelClose();
  try{await refreshSavedQuotes();renderSavedQuotesModal();}catch(error){closePanel();showToast(readableError(error));}
}
function renderSavedQuotesModal(){
  const quotes=state.savedQuotes;
  $('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel panel-wide" role="dialog" aria-modal="true"><div class="panel-head"><div><h2>Presupuestos guardados</h2><p>Abrí uno para seguir editándolo, eliminarlo o enviarlo desde ahí.</p></div><button class="icon-close" data-close>×</button></div>${quotes.length?`<div class="backup-list">${quotes.map(savedQuoteRow).join('')}</div>`:'<div class="panel-empty"><strong>Todavía no hay presupuestos guardados</strong><span>Usá “☁ Guardar presupuesto” desde el presupuesto.</span></div>'}</section></div>`;
  bindPanelClose();
  document.querySelectorAll('[data-saved-quote-open]').forEach(button=>button.onclick=()=>loadSavedQuote(button.dataset.savedQuoteOpen));
  document.querySelectorAll('[data-saved-quote-delete]').forEach(button=>button.onclick=()=>confirmDeleteSavedQuote(button.dataset.savedQuoteDelete));
}
function savedQuoteRow(quote){
  const date=new Intl.DateTimeFormat('es-AR',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(quote.updated_at));
  return `<div class="backup-item"><div class="backup-icon">📄</div><div class="backup-info"><strong>${esc(quote.label||'Presupuesto sin nombre')}</strong><small>${date} · ${number(quote.item_count)} producto${quote.item_count===1?'':'s'} · ${money(quote.total)}</small></div><div class="backup-actions"><button class="btn btn-secondary" data-saved-quote-open="${quote.id}">Abrir</button><button class="btn btn-danger" data-saved-quote-delete="${quote.id}">Eliminar</button></div></div>`;
}
async function loadSavedQuote(id){
  try{
    const [row]=await db(`saved_quotes?select=*&id=eq.${id}&limit=1`);
    if(!row)throw new Error('Presupuesto no encontrado.');
    const missing=Object.keys(CATALOGS).filter(slug=>!state.loadedCatalogs.has(slug));
    if(missing.length)await Promise.all(missing.map(loadCatalogData));
    const snapshot=row.snapshot||{};
    state.quote={number:null,savedId:row.id,client:snapshot.client||'',address:snapshot.address||'',discountPercentage:normaliseDiscount(snapshot.discountPercentage),previousBalance:normalisePreviousBalance(snapshot.previousBalance),items:Array.isArray(snapshot.items)?snapshot.items:[]};
    closePanel();goView('quote');showToast(`Presupuesto "${row.label||'sin nombre'}" cargado.`);
  }catch(error){showToast(readableError(error));}
}
function confirmDeleteSavedQuote(id){
  $('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel"><div class="confirm-card"><div class="confirm-icon">×</div><h2>Eliminar presupuesto</h2><p>El presupuesto guardado se borrará de la nube. Esta acción no se puede deshacer.</p><div class="panel-actions"><button class="btn btn-quiet" id="delete-quote-back">Volver</button><button class="btn btn-danger" id="delete-quote-confirm">Eliminar</button></div></div></section></div>`;
  bindPanelClose();
  $('#delete-quote-back').onclick=renderSavedQuotesModal;
  $('#delete-quote-confirm').onclick=async()=>{
    try{await db(`saved_quotes?id=eq.${id}`,{method:'DELETE'});if(state.quote?.savedId===id)state.quote.savedId=null;await refreshSavedQuotes();renderSavedQuotesModal();showToast('Presupuesto eliminado.');}catch(error){showToast(readableError(error));}
  };
}
async function saveQuoteToCloud(){
  if(state.preview)return showToast('Los presupuestos guardados no están disponibles en la vista previa local.');
  syncQuoteFields();
  const rows=quoteRows();
  if(!rows.length)return showToast('Agregá al menos un producto para guardar el presupuesto.');
  const totals=quoteTotals(rows),label=(state.quote.client||'').trim()||'Presupuesto sin nombre';
  const payload={label,item_count:rows.length,total:totals.total,snapshot:{client:state.quote.client,address:state.quote.address,discountPercentage:state.quote.discountPercentage,previousBalance:state.quote.previousBalance,items:state.quote.items},updated_at:new Date().toISOString()};
  try{
    if(state.quote.savedId){
      await db(`saved_quotes?id=eq.${state.quote.savedId}`,{method:'PATCH',body:payload,prefer:'return=minimal'});
    }else{
      const [row]=await db('saved_quotes',{method:'POST',body:payload,prefer:'return=representation'});
      state.quote.savedId=row.id;
    }
    await refreshSavedQuotes().catch(()=>{});
    showToast('Presupuesto guardado en la nube.');
  }catch(error){showToast(readableError(error));}
}

async function refreshHistory(){if(state.preview)return;state.history=await db('price_change_batches?select=id,change_type,scope_label,percentage,affected_products,affected_prices,created_at&order=created_at.desc&limit=50');}
async function openHistory(){if(!state.preview)try{await refreshHistory();}catch(error){return showToast(readableError(error));}$('#panel-root').innerHTML=`<div class="panel-overlay"><section class="panel panel-wide"><div class="panel-head"><div><h2>Historial de precios</h2><p>Cambios manuales, aumentos, productos creados y restauraciones.</p></div><button class="icon-close" data-close>×</button></div>${state.history.length?`<div class="history-list">${state.history.map(historyRow).join('')}</div>`:'<div class="panel-empty"><strong>Todavía no hay cambios</strong></div>'}</section></div>`;bindPanelClose();}
function historyRow(item){const text=item.change_type==='manual'?`Precio editado · ${item.scope_label}`:item.change_type==='create'?`Producto agregado · ${item.scope_label}`:item.change_type==='restore'?'Copia restaurada':`${Number(item.percentage)>=0?'Aumento':'Descuento'} del ${Math.abs(Number(item.percentage))}% · ${item.scope_label}`;const date=new Intl.DateTimeFormat('es-AR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(item.created_at));return `<div class="history-entry"><div class="backup-icon">↗</div><div><strong>${esc(text)}</strong><small>${date} · ${number(item.affected_products)} productos · ${number(item.affected_prices)} precios</small></div></div>`;}

function bindPanelClose(){document.querySelectorAll('[data-close]').forEach(button=>button.onclick=closePanel);const overlay=$('.panel-overlay');if(overlay)overlay.onclick=event=>{if(event.target===event.currentTarget)closePanel();};document.onkeydown=event=>{if(event.key==='Escape')closePanel();};}
function closePanel(){$('#panel-root').innerHTML='';document.onkeydown=null;}
function readableError(error){const message=String(error?.message||error||'No se pudo completar la acción.');if(/fetch/i.test(message))return 'No se pudo conectar con Papelera Roma. Revisá tu conexión.';return message;}
function showToast(message){const toast=$('#toast');toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove('show'),3600);}

document.addEventListener('DOMContentLoaded',init);
