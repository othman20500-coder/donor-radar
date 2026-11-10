'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function runtimeCheck(){
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major<22||(major===22&&minor<13))throw new Error('رادار المانحين يتطلب Node.js 22.13 أو أحدث مع node:sqlite. اختر Node.js 24 LTS في لوحة الاستضافة.');
 try{require('node:sqlite');}catch{throw new Error('node:sqlite غير متاح في هذه الاستضافة. فعّل إصدار Node.js 22.13 أو أحدث، ويفضّل 24 LTS.');}
}
function within(parent,child){const rel=path.relative(parent,child);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
function readLocal(rootDir){
 const file=path.join(rootDir,'config.json');if(!fs.existsSync(file))return{};
 let value;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('ملف config.json غير صالح.');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('ملف config.json يجب أن يحتوي إعدادات JSON.');
 for(const k of Object.keys(value))if(!['PUBLIC_URL','RADAR_DATA_DIR','PORT','NODE_ENV'].includes(k))throw new Error('إعداد غير معتمد في config.json: '+k);
 return value;
}
function config(options={}){
 runtimeCheck();const rootDir=path.resolve(options.rootDir||path.join(__dirname,'..')),local=readLocal(rootDir);
 const get=(key)=>process.env[key]??local[key];
 const nodeEnv=options.nodeEnv||get('NODE_ENV')||'production';
 if(!['production','development','test'].includes(nodeEnv))throw new Error('NODE_ENV يجب أن يكون production أو development أو test.');
 const publicValue=options.publicUrl||get('PUBLIC_URL')||(nodeEnv==='production'?'':'http://127.0.0.1:3000');
 if(!publicValue)throw new Error('حدد PUBLIC_URL برابط HTTPS النهائي قبل بدء التطبيق.');
 let url;try{url=new URL(publicValue);}catch{throw new Error('PUBLIC_URL غير صالح.');}
 if(url.username||url.password||url.hash||url.search||!['http:','https:'].includes(url.protocol))throw new Error('PUBLIC_URL يجب أن يكون رابط الموقع الكامل دون معاملات أو بيانات دخول.');
 if(nodeEnv==='production'&&url.protocol!=='https:')throw new Error('PUBLIC_URL يجب أن يستخدم HTTPS في وضع production.');
 if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('HTTP مسموح للتطوير المحلي فقط. استخدم HTTPS للاستضافة.');
 let prefix=url.pathname.replace(/\/+$/,'');if(prefix==='/')prefix='';
 if(!/^(?:\/[A-Za-z0-9_-]+)*$/.test(prefix))throw new Error('مسار PUBLIC_URL يجب أن يستخدم أحرفًا لاتينية أو أرقامًا أو - أو _.');
 const base=prefix+'/',appDir=path.resolve(options.appDir||path.join(rootDir,'private','app'));
 const configuredData=options.dataDir||get('RADAR_DATA_DIR')||path.join(rootDir,'data');
 if(typeof configuredData!=='string'||!path.isAbsolute(configuredData))throw new Error('RADAR_DATA_DIR يجب أن يكون مسارًا مطلقًا خارج public.');
 const dataDir=path.resolve(configuredData);
 if(within(path.join(rootDir,'public'),dataDir)||within(appDir,dataDir))throw new Error('مجلد البيانات يجب أن يكون خارج public وخارج private/app.');
 const rawPort=options.port??get('PORT')??3000;
 const port=/^\d+$/.test(String(rawPort))?Number(rawPort):rawPort;
 if(typeof port==='number'&&(!Number.isInteger(port)||port<0||port>65535))throw new Error('PORT غير صالح.');
 return{rootDir,nodeEnv,publicUrl:url.origin+prefix,origin:url.origin,prefix,base,cookiePath:base,
  cookieName:'radar_session_'+crypto.createHash('sha256').update(base).digest('hex').slice(0,10),secure:url.protocol==='https:',
  dataDir,appDir,viewsDir:path.resolve(options.viewsDir||path.join(rootDir,'views')),catalogPath:path.resolve(options.catalogPath||path.join(rootDir,'private','catalog.json')),port};
}
module.exports={config,runtimeCheck,within,readLocal};
