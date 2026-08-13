import csv, io, re, subprocess, unicodedata
from difflib import SequenceMatcher

def key(value):
    text=unicodedata.normalize('NFD',value or '')
    text=''.join(ch for ch in text if unicodedata.category(ch)!='Mn').lower()
    return re.sub(r'[^a-z0-9]+',' ',text).strip()

old_text=subprocess.check_output(['git','show','HEAD:data/productos_papelera_roma.csv'],text=True,encoding='utf-8')
old_rows=list(csv.DictReader(io.StringIO(old_text)))
with open('data/productos_papelera_roma.csv',encoding='utf-8',newline='') as handle:new_rows=list(csv.DictReader(handle))
old_keys=[f"{key(row['categoria'])}|{key(row['nombre'])}" for row in old_rows]
new_keys=[f"{key(row['categoria'])}|{key(row['nombre'])}" for row in new_rows]
matcher=SequenceMatcher(None,old_keys,new_keys,autojunk=False)
assigned={};preserved=[];serial=1
for tag,i1,i2,j1,j2 in matcher.get_opcodes():
    if tag=='equal':
        for offset in range(i2-i1):assigned[j1+offset]=old_rows[i1+offset]['codigo']
    elif tag=='delete':preserved.extend(old_rows[i1:i2])
    elif tag=='insert':
        for index in range(j1,j2):assigned[index]=f'PAP-20260813-{serial:04d}';serial+=1
    else:
        old_block=old_rows[i1:i2];new_indexes=list(range(j1,j2));available=set(new_indexes)
        for old in old_block:
            if not available:preserved.append(old);continue
            best=max(available,key=lambda index:SequenceMatcher(None,key(old['nombre']),key(new_rows[index]['nombre']),autojunk=False).ratio())
            score=SequenceMatcher(None,key(old['nombre']),key(new_rows[best]['nombre']),autojunk=False).ratio()
            if score>=0.45:
                assigned[best]=old['codigo'];available.remove(best)
            else:preserved.append(old)
        for index in sorted(available):assigned[index]=f'PAP-20260813-{serial:04d}';serial+=1
for index,row in enumerate(new_rows):row['codigo']=assigned[index]
for row in preserved:
    note='Conservado de la lista anterior: no figura en el Excel del 12/08/2026.'
    row['observaciones']=f"{row['observaciones']} · {note}".strip(' ·')
new_rows.extend(preserved)
headers=list(new_rows[0])
with open('data/productos_papelera_roma.csv','w',encoding='utf-8',newline='') as handle:
    writer=csv.DictWriter(handle,fieldnames=headers,lineterminator='\n');writer.writeheader();writer.writerows(new_rows)
print({'source_products':len(new_rows)-len(preserved),'preserved_from_previous':len(preserved),'final_products':len(new_rows),'new_codes':serial-1,'preserved_codes':len(new_rows)-(serial-1)})
