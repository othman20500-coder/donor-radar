import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(dir);
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
fs.mkdirSync(path.join(dir,'dist/assets'),{recursive:true});
let html=read('source/base-v9.html');
const marker='/* Single application bootstrap. */';
if(html.split(marker).length!==2)throw Error('Unexpected application bootstrap');
let team=read('client/team.js').replace('قاعدة بيانات كاملة','نسخة بيانات التطوير').replace('نسخة من قاعدة البيانات تشمل حسابات الفريق وسجلات العمل. احتفظ بها في مكان مخصص ومقيّد؛ يستعيدها مسؤول الاستضافة بأداة الاستعادة.','نسخة استعادة تشمل حسابات التطوير وبيانات العمل والرصد. تحتوي بيانات دخول مشفرة ويجب حفظها في مكان مقيّد. لا تشمل الجلسات.').replace('نسخة قاعدة البيانات تختلف عن ملف JSON؛ استعادتها تتم بأداة الاستضافة المرفقة.','استيراد بيانات الفريق متاح من قسم الاستيراد. استعادة الرصد تتم بأداة إدارة بيئة التطوير.');
html=html.replace(marker,[team,read('client/projects.js'),read('client/renewal-model.js'),read('client/renewal.js'),read('cloudflare/integration-client.js'),marker].join('\n'));
html=html.replace('</head>',`<style>${['client/team.css','client/projects.css','client/renewal.css'].map(read).join('\n')}</style></head>`);
// The existing interface remains intact; only add navigation to the monitor for admins.
fs.writeFileSync(path.join(dir,'dist/assets/index.html'),html);
fs.copyFileSync(path.join(root,'views/login.html'),path.join(dir,'dist/assets/login.html'));
fs.copyFileSync(path.join(dir,'workflow-ui.html'),path.join(dir,'dist/assets/workflow.html'));
fs.copyFileSync(path.join(dir,'monitor-ui.html'),path.join(dir,'dist/assets/monitor.html'));
const catalog=JSON.parse(read('private/catalog.json'));
for(const asset of catalog.allowedFiles){const p=asset.path;if(p.startsWith('/')||p.split('/').some(x=>x==='..'||x.startsWith('.')))throw Error('Unsafe asset');const src=path.join(root,'private/app',p),dest=path.join(dir,'dist/assets',p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(src,dest);}
await build({entryPoints:[path.join(dir,'worker.mjs')],outfile:path.join(dir,'dist/worker.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],define:{'process.env.NODE_ENV':'"development"'}});
console.log(`Built existing interface and ${catalog.allowedFiles.length} protected assets.`);
