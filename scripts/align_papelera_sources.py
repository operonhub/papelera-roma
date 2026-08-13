import csv, io, json, re, subprocess, unicodedata
from difflib import SequenceMatcher

def key(value):
    text=unicodedata.normalize('NFD',value or '')
    text=''.join(ch for ch in text if unicodedata.category(ch)!='Mn').lower()
    return re.sub(r'[^a-z0-9]+',' ',text).strip()

old_text=subprocess.check_output(['git','show','HEAD:data/productos_papelera_roma.csv'],text=True,encoding='utf-8')
with open('data/productos_papelera_roma.csv',encoding='utf-8',newline='') as handle:
    new_rows=list(csv.DictReader(handle))
old_rows=list(csv.DictReader(io.StringIO(old_text)))
old_keys=[f"{key(row['categoria'])}|{key(row['nombre'])}" for row in old_rows]
new_keys=[f"{key(row['categoria'])}|{key(row['nombre'])}" for row in new_rows]
matcher=SequenceMatcher(None,old_keys,new_keys,autojunk=False)
blocks=[]
for tag,i1,i2,j1,j2 in matcher.get_opcodes():
    if tag!='equal':
        blocks.append({'tag':tag,'oldRange':[i1,i2],'newRange':[j1,j2],'old':[{'code':row['codigo'],'name':row['nombre'],'category':row['categoria']} for row in old_rows[i1:i2]],'new':[{'code':row['codigo'],'name':row['nombre'],'category':row['categoria']} for row in new_rows[j1:j2]]})
summary={'old':len(old_rows),'new':len(new_rows),'matching':sum(block.size for block in matcher.get_matching_blocks()),'blocks':blocks}
with open('.analysis/papelera-roma-2026-08-12/alignment.json','w',encoding='utf-8') as handle:json.dump(summary,handle,ensure_ascii=False,indent=2)
print(json.dumps({'old':summary['old'],'new':summary['new'],'matching':summary['matching'],'nonEqualBlocks':len(blocks),'blocks':blocks},ensure_ascii=False,indent=2))
