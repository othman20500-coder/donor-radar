#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const fallback=fs.existsSync(path.join(__dirname,'source/base-v9.html'))?path.join(__dirname,'source/base-v9.html'):path.resolve(__dirname,'../radar-brand-work/dist/index.html');
const source=fs.readFileSync(process.argv[2]||fallback,'utf8');
function literal(name){
 const marker=new RegExp('\\bconst\\s+'+name+'\\s*=\\s*').exec(source);
 if(!marker)throw Error('Missing '+name);
 const start=marker.index+marker[0].length;
 let quote='',escape=false,depth=0;
 for(let i=start;i<source.length;i++){
  const c=source[i];
  if(quote){if(escape){escape=false;continue;}if(c==='\\'){escape=true;continue;}if(c===quote)quote='';continue;}
  if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
  if('([{'.includes(c))depth++;
  if(')]}'.includes(c))depth--;
  if(c===';'&&depth===0)return vm.runInNewContext('('+source.slice(start,i)+')',{}, {timeout:1000});
 }
 throw Error('Unclosed '+name);
}
const data=literal('DATA'),projects=literal('PROJ'),files=literal('PFILES'),covers=literal('PCOVERS');
const allowedFiles=new Map();
for(const edition of Object.values(files))for(const type of ['pdf','pptx'])if(edition[type]){
 const f=edition[type];allowedFiles.set(f.path,{path:f.path,sha256:f.sha256,bytes:f.bytes,
  mime:type==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
}
for(const c of Object.values(covers))allowedFiles.set(c.src,{path:c.src,sha256:c.sha256,bytes:c.bytes,mime:'image/webp'});
function callKey(c){let h=0;const t=(c.funder||'')+'|'+(c.title||'');for(let i=0;i<t.length;i++)h=(h*31+t.charCodeAt(i))|0;return 'cw_'+(h>>>0).toString(36);}
const catalog={version:10,sourceVersion:9,projects,donors:data.donors,calls:data.calls.map(c=>({...c,key:callKey(c)})),
 tags:literal('TAGS'),documentIds:literal('CDOC').map(x=>x.id),documentNeeds:Object.keys(literal('DOCS')),
 allowedFiles:[...allowedFiles.values()],donorFields:literal('DNF').map(x=>x[0]),donorFieldDefinitions:literal('DNF'),
 financialKeys:Object.keys(literal('FDEF')),financialDefaults:literal('FDEF'),projectStages:literal('PSTAGES'),donorStages:literal('STAGES'),
 aliases:{p15:'p11'},docStates:['ok','partial','missing','expired','stale']};
const out=path.resolve(__dirname,'private/catalog.json');fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({catalog:out,projects:projects.length,donors:data.donors.length,files:allowedFiles.size,calls:catalog.calls.length}));
