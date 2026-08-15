import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

await import('./validate.mjs');

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'dist');
const publicFiles=['index.html','app.js','styles.css','documentos.js','manifest.webmanifest'];

await fs.rm(output,{recursive:true,force:true});
await fs.mkdir(output,{recursive:true});
for(const file of publicFiles)await fs.copyFile(path.join(root,file),path.join(output,file));
await fs.cp(path.join(root,'assets'),path.join(output,'assets'),{recursive:true});

console.log(JSON.stringify({ok:true,output,files:[...publicFiles,'assets/']}));
