(function(){
  'use strict';

  const A4={portrait:[595,842],landscape:[842,595]};
  const TEAL=[0.031,0.498,0.525],MINT=[0.573,0.835,0.753],INK=[0.071,0.220,0.231];

  function latin(text){
    let out='';
    for(const ch of String(text??''))out+=ch.codePointAt(0)<=255?ch:'?';
    return out.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  }
  function width(text,size,bold=false){return String(text??'').length*size*(bold?.56:.51);}
  function truncate(text,max,size,bold=false){
    let value=String(text??'');
    if(width(value,size,bold)<=max)return value;
    while(value.length>1&&width(value+'...',size,bold)>max)value=value.slice(0,-1);
    return value+'...';
  }
  function money(value){return '$ '+Math.round(Number(value)||0).toLocaleString('es-AR');}
  function text(ops,x,y,value,size=9,bold=false,color=INK){
    ops.push(`${color.join(' ')} rg BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${latin(value)}) Tj ET`);
  }
  function textRight(ops,right,y,value,size=9,bold=false,color=INK){text(ops,right-width(value,size,bold),y,value,size,bold,color);}
  function rect(ops,x,y,w,h,color){ops.push(`${color.join(' ')} rg ${x} ${y} ${w} ${h} re f`);}
  function line(ops,x1,y1,x2,y2,color=[.82,.89,.87]){ops.push(`${color.join(' ')} RG .5 w ${x1} ${y1} m ${x2} ${y2} l S`);}
  function image(ops,x,y,w,h){ops.push(`q ${w} 0 0 ${h} ${x} ${y} cm /Logo Do Q`);}
  let brandPromise;
  async function loadBrand(){
    if(!brandPromise)brandPromise=fetch('assets/logo-papelera-roma-pdf.jpg').then(async response=>{if(!response.ok)throw new Error('No se pudo cargar el logo para el PDF.');return {bytes:new Uint8Array(await response.arrayBuffer()),width:306,height:320};});
    return brandPromise;
  }

  function brandHeader(ops,pageW,pageH,kind,subtitle){
    rect(ops,0,pageH-74,pageW,74,TEAL);
    image(ops,28,pageH-67,58,58);
    text(ops,98,pageH-35,'PAPELERA ROMA',17,true,[1,1,1]);
    textRight(ops,pageW-34,pageH-36,kind,12,true,[1,1,1]);
    if(subtitle)textRight(ops,pageW-34,pageH-51,truncate(subtitle,260,8),8,false,[.86,.96,.94]);
  }

  function assemble(pages,pageW,pageH,brand){
    const count=pages.length;
    for(let i=0;i<count;i++){
      text(pages[i],34,20,'Papelera Roma - Documento generado desde la lista de precios',7,false,[.35,.48,.46]);
      textRight(pages[i],pageW-34,20,`Página ${i+1} de ${count}`,7,false,[.35,.48,.46]);
    }
    const objects=[],pageIds=[];
    for(let i=0;i<count;i++)pageIds.push(3+i*2);
    const regular=3+count*2,bold=regular+1,logo=bold+1;
    objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
    objects[2]=`<< /Type /Pages /Kids [${pageIds.map(id=>id+' 0 R').join(' ')}] /Count ${count} >>`;
    pages.forEach((ops,i)=>{
      const pageId=3+i*2,contentId=pageId+1,stream=ops.join('\n');
      objects[pageId]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> /XObject << /Logo ${logo} 0 R >> >> /Contents ${contentId} 0 R >>`;
      objects[contentId]=`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });
    objects[regular]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[bold]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    const binary=Array.from(brand.bytes,byte=>String.fromCharCode(byte)).join('');
    objects[logo]=`<< /Type /XObject /Subtype /Image /Width ${brand.width} /Height ${brand.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${brand.bytes.length} >>\nstream\n${binary}\nendstream`;
    let out='%PDF-1.4\n%âãÏÓ\n';const offsets=new Array(logo+1).fill(0);
    for(let id=1;id<=logo;id++){offsets[id]=out.length;out+=`${id} 0 obj\n${objects[id]}\nendobj\n`;}
    const xref=out.length;out+=`xref\n0 ${logo+1}\n0000000000 65535 f \n`;
    for(let id=1;id<=logo;id++)out+=String(offsets[id]).padStart(10,'0')+' 00000 n \n';
    out+=`trailer\n<< /Size ${logo+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes=new Uint8Array(out.length);for(let i=0;i<out.length;i++)bytes[i]=out.charCodeAt(i)&255;return bytes;
  }

  async function buildPriceListPdf({items,title,client,date,priceFields,detailKey,detailLabel}){
    const brand=await loadBrand();
    const [pageW,pageH]=A4.landscape,pages=[];let ops,y;
    const compact=Boolean(detailKey&&priceFields.length===1),cols={name:34,detail:500,prices:compact?[808]:[500,574,648,722,808],right:808};
    const groups=new Map();
    [...items].sort((a,b)=>a.categoria.localeCompare(b.categoria,'es',{sensitivity:'base',numeric:true})||(Number(a.orden)-Number(b.orden))||a.nombre.localeCompare(b.nombre,'es',{sensitivity:'base',numeric:true})).forEach(p=>{if(!groups.has(p.categoria))groups.set(p.categoria,[]);groups.get(p.categoria).push(p);});
    function tableHeader(){
      rect(ops,30,y-5,pageW-60,19,[.89,.95,.93]);
      text(ops,cols.name,y,'Producto',8,true);
      if(compact)text(ops,cols.detail,y,detailLabel||'Cantidad / presentaciÃ³n',8,true);
      priceFields.forEach((field,i)=>textRight(ops,cols.prices[i],y,field.label,8,true));y-=23;
    }
    function newPage(){
      ops=[];pages.push(ops);brandHeader(ops,pageW,pageH,'LISTA DE PRECIOS',title||'Precios vigentes');
      y=pageH-98;
      if(pages.length===1){
        text(ops,34,y,`Fecha: ${date}`,9,false);
        if(client)text(ops,210,y,`Cliente: ${truncate(client,340,9,true)}`,9,true);
        textRight(ops,pageW-34,y,`${items.length.toLocaleString('es-AR')} productos`,9,true);
        y-=24;
      }
      tableHeader();
    }
    function ensure(space=18){if(y<46+space)newPage();}
    newPage();
    for(const [category,products] of groups){
      ensure(34);rect(ops,30,y-6,pageW-60,20,[.82,.93,.89]);text(ops,34,y,truncate(category,740,9,true),9,true,TEAL);y-=24;
      for(const p of products){
        ensure(24);text(ops,cols.name,y,truncate(p.nombre,compact?430:400,8),8,false);
        if(compact)text(ops,cols.detail,y,truncate(p[detailKey]||'-',190,8),8,false);
        priceFields.forEach((field,i)=>{const value=p[field.key];textRight(ops,cols.prices[i],y,typeof value==='number'?money(value):'-',8,false);});
        line(ops,34,y-9,pageW-34,y-9);y-=22;
      }
    }
    return assemble(pages,pageW,pageH,brand);
  }

  async function buildQuotePdf({number,client,address,date,items,subtotal,discountPercentage,discountAmount,previousBalance,total}){
    const brand=await loadBrand();
    const [pageW,pageH]=A4.portrait,pages=[];let ops,y;
    function tableHeader(){
      rect(ops,30,y-5,pageW-60,20,[.89,.95,.93]);
      text(ops,36,y,'Cant.',8,true);text(ops,76,y,'Producto',8,true);text(ops,330,y,'Presentación',8,true);
      textRight(ops,472,y,'Precio',8,true);textRight(ops,558,y,'Importe',8,true);y-=24;
    }
    function newPage(){
      ops=[];pages.push(ops);brandHeader(ops,pageW,pageH,'PRESUPUESTO',number?`N.º ${number}`:'');
      y=pageH-98;
      if(pages.length===1){
        text(ops,34,y,`Fecha: ${date}`,9,false);y-=18;
        if(client){text(ops,34,y,`Cliente: ${truncate(client,500,11,true)}`,11,true);y-=17;}
        if(address){text(ops,34,y,`Domicilio: ${truncate(address,490,9)}`,9,false);y-=17;}
        y-=5;
      }
      tableHeader();
    }
    function ensure(space=20){if(y<64+space)newPage();}
    newPage();
    for(const item of items){
      ensure(24);text(ops,36,y,String(item.quantity),8,false);
      text(ops,76,y,truncate(item.name,238,8),8,false);
      text(ops,330,y,truncate(item.priceLabel,102,8),8,false);
      textRight(ops,472,y,money(item.unitPrice),8,false);textRight(ops,558,y,money(item.amount),8,true);
      line(ops,34,y-9,561,y-9);y-=22;
    }
    const extra=previousBalance?24:0;
    ensure(116+extra);y-=10;rect(ops,350,y-78-extra,211,92+extra,[.91,.97,.95]);
    text(ops,365,y-5,'SUBTOTAL',9,true,TEAL);textRight(ops,558,y-5,money(subtotal),10,true,INK);
    text(ops,365,y-29,`DESCUENTO ${Number(discountPercentage)||0}%`,9,true,TEAL);textRight(ops,558,y-29,`- ${money(discountAmount)}`,10,true,INK);
    if(previousBalance){text(ops,365,y-53,'SALDO ANTERIOR',9,true,TEAL);textRight(ops,558,y-53,`${previousBalance>0?'+':'-'} ${money(Math.abs(previousBalance))}`,10,true,INK);}
    line(ops,365,y-43-extra,558,y-43-extra,[.65,.82,.77]);
    text(ops,365,y-64-extra,'TOTAL',10,true,TEAL);textRight(ops,558,y-65-extra,money(total),14,true,INK);y-=97+extra;
    text(ops,34,y,'Documento no válido como factura. Precios sujetos a confirmación.',7,false,[.35,.48,.46]);
    return assemble(pages,pageW,pageH,brand);
  }

  function download(bytes,filename,type){
    const blob=new Blob([bytes],{type}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  async function sharePdf(bytes,filename,title){
    const file=new File([bytes],filename,{type:'application/pdf'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      try{await navigator.share({files:[file],title});return {shared:true};}
      catch(error){if(error&&error.name==='AbortError')return {cancelled:true};}
    }
    download(bytes,filename,'application/pdf');
    return {downloaded:true};
  }

  function printPdf(bytes,target){
    const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),popup=target&&!target.closed?target:window.open('','_blank');
    if(!popup){download(bytes,'documento.pdf','application/pdf');return {downloaded:true};}
    popup.document.open();popup.document.write(`<!doctype html><html><head><title>Imprimir / PDF</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}body{overflow:hidden}</style></head><body><iframe id="pdf" src="${url}"></iframe></body></html>`);popup.document.close();
    const frame=popup.document.getElementById('pdf');frame.onload=()=>setTimeout(()=>{try{frame.contentWindow.focus();frame.contentWindow.print();}catch{popup.focus();popup.print();}setTimeout(()=>URL.revokeObjectURL(url),60000);},350);
    return {opened:true};
  }

  window.RomaDocuments={buildPriceListPdf,buildQuotePdf,download,sharePdf,print:printPdf};
})();
