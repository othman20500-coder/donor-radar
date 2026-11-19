import {Buffer} from 'node:buffer';
import catalog from '../private/catalog.json';
import {Store} from './store.mjs';
import {HttpError} from '../server/errors.js';
import {safeTree,fields} from '../server/validation.js';
import {fail,equal,readCookie,cookie} from './security.mjs';
import {monitorRoute} from './monitor.mjs';
import {snapshot} from './backup.mjs';
globalThis.Buffer=Buffer;
const json=(value,status=200,headers={})=>Response.json(value,{status,headers});
async function body(req,limit=16384){if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||''))fail(415,'أرسل JSON.');if(Number(req.headers.get('content-length')||0)>limit)fail(413,'حجم الطلب كبير.');const reader=req.body?.getReader();let size=0,parts=[];if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail(413,'حجم الطلب كبير.');}parts.push(value);}}finally{reader.releaseLock();}try{const value=JSON.parse(Buffer.concat(parts).toString()||'{}');safeTree(value);return value;}catch(e){if(e instanceof HttpError)throw e;fail(400,'JSON غير صالح.');}}
function admin(s){if(s.user.role!=='admin')fail(403,'هذه العملية تحتاج صلاحية مدير.','FORBIDDEN');}
function secure(response,nonce){const r=new Response(response.body,response);r.headers.set('Cache-Control','no-store');r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('X-Frame-Options','DENY');r.headers.set('Referrer-Policy','same-origin');r.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');r.headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`);return r;}
async function page(env,req,name,nonce){const r=await env.ASSETS.fetch(new Request(new URL('/'+name,req.url),{method:'GET'}));if(!r.ok)fail(503,'ملفات الواجهة غير متاحة.','ASSETS_UNAVAILABLE');let html=await r.text();html=html.replace(/<meta\s+name=["']radar-base["'][^>]*>/gi,'').replace(/<head\b([^>]*)>/i,'<head$1><meta name="radar-base" content="/">').replace(/<script\b([^>]*)>/gi,(_m,a)=>`<script${a.replace(/\snonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')} nonce="${nonce}">`);return new Response(req.method==='HEAD'?null:html,{headers:{'Content-Type':'text/html; charset=utf-8'}});}
async function handle(req,env,nonce){
 if(env.APP_ENV!=='development'||env.APP_NAME!=='donor-radar-v13-dev')fail(503,'إعداد بيئة التطوير غير صالح.','ENVIRONMENT_LOCK');
 const url=new URL(req.url);if(!env.PUBLIC_URL||url.origin!==new URL(env.PUBLIC_URL).origin)fail(403,'عنوان بيئة التطوير غير معتمد.','INVALID_HOST');
 const raw=url.pathname;if(/%(?:2f|5c|00|25)/i.test(raw)||raw.includes('\\'))fail(404,'المسار غير موجود.');let p;try{p=decodeURIComponent(raw);}catch{fail(400,'المسار غير صالح.');}if(p.split('/').some(x=>x==='..'||x==='.'||x.startsWith('.')))fail(404,'المسار غير موجود.');
 if(!['GET','HEAD','POST','PUT','PATCH'].includes(req.method))fail(405,'طريقة الطلب غير مسموحة.');const read=['GET','HEAD'].includes(req.method);
 if(!read&&(req.headers.get('origin')!==new URL(env.PUBLIC_URL).origin||req.headers.get('sec-fetch-site')==='cross-site'))fail(403,'مصدر الطلب غير مسموح.','INVALID_ORIGIN');
 const store=new Store(env.DB,catalog),s=await store.session(readCookie(req));
 if(p==='/login'&&read){if(s&&!s.user.mustChangePassword)return new Response(null,{status:303,headers:{Location:'/'}});return page(env,req,'login.html',nonce);}
 if(p==='/api/auth/login'&&req.method==='POST'){const b=await body(req);fields(b,['username','password']);const r=await store.login(b.username,b.password,req.headers.get('CF-Connecting-IP')||'local');if(s)await store.logout(s);return json({user:r.user,csrfToken:r.csrfToken},200,{'Set-Cookie':cookie(r.token)});}
 if(!s){if(read&&!p.startsWith('/api/'))return new Response(null,{status:303,headers:{Location:'/login'}});fail(401,'سجل الدخول أولًا.','AUTH_REQUIRED');}
 if(!read&&!equal(req.headers.get('x-csrf-token'),s.csrfToken))fail(403,'تعذر التحقق من الطلب.','INVALID_CSRF');
 if(p==='/api/session'&&req.method==='GET')return json({user:s.user,csrfToken:s.csrfToken});
 if(p==='/api/auth/logout'&&req.method==='POST'){await store.logout(s);return json({ok:true},200,{'Set-Cookie':cookie('',true)});}
 if(p==='/api/auth/password'&&req.method==='POST'){const b=await body(req);fields(b,['currentPassword','newPassword']);return json(await store.changePassword(s,b.currentPassword,b.newPassword));}
 if(s.user.mustChangePassword){if(read&&!p.startsWith('/api/'))return new Response(null,{status:303,headers:{Location:'/login'}});fail(403,'غيّر كلمة المرور المؤقتة.','PASSWORD_CHANGE_REQUIRED');}
 if(p==='/monitor'&&read){admin(s);return page(env,req,'monitor.html',nonce);}
 if(p.startsWith('/api/monitor/')){admin(s);const r=await monitorRoute(store,s,p,req.method,read?{}:await body(req),env);return json(r.data,r.status||200);}
 if(p==='/api/state'&&req.method==='GET'){const since=url.searchParams.get('since');if(since!==null&&!/^\d+$/.test(since))fail(400,'رقم مراجعة غير صالح.');const state=await store.state();return json(since!==null&&Number(since)===state.revision?{unchanged:true,revision:state.revision,serverTime:state.serverTime}:state);}
 if(p.startsWith('/api/records/')&&req.method==='PUT'){const b=await body(req,2*1024*1024);fields(b,['value','expectedVersion']);return json(await store.setRecord(p.slice(13),b.value,b.expectedVersion,s));}
 if(p==='/api/users'){admin(s);if(req.method==='GET')return json({users:await store.users()});if(req.method==='POST')return json({user:await store.createUser(await body(req),s)},201);}
 if(p.startsWith('/api/users/')&&req.method==='PATCH'){admin(s);return json({user:await store.updateUser(p.slice(11),await body(req),s)});}
 if(p==='/api/audit'&&req.method==='GET'){admin(s);const limit=url.searchParams.get('limit')||'100';if(!/^\d+$/.test(limit)||Number(limit)<1)fail(400,'حد غير صالح.');return json({events:(await store.all('SELECT * FROM audit ORDER BY id DESC LIMIT ?',Math.min(250,Number(limit)))).map(r=>({id:r.id,at:r.at,actor:r.actor_name,actorId:r.actor_id,action:r.action,key:r.record_key,fields:JSON.parse(r.fields),version:r.version}))});}
 if(p==='/api/backup'&&req.method==='GET'){admin(s);return json(await store.exportBackup(),200,{'Content-Disposition':'attachment; filename="radar-dev-state.json"'});}
 if(p==='/api/import/preview'&&req.method==='POST'){admin(s);const b=await body(req,4*1024*1024);fields(b,['backup']);return json(await store.previewImport(b.backup));}
 if(p==='/api/import'&&req.method==='POST'){admin(s);const b=await body(req,4*1024*1024);fields(b,['backup','mode','expectedRevision']);await saveBackup(store,s,env);return json(await store.importBackup(b.backup,b.mode||'add-only',b.expectedRevision,s));}
 if(p==='/api/backups'){admin(s);if(!env.BACKUPS)fail(503,'تخزين النسخ الاحتياطية غير مهيأ.');if(req.method==='POST')return json({backup:await saveBackup(store,s,env)},201);if(req.method==='GET'){const list=await env.BACKUPS.list({prefix:'dev-backup-',limit:100});return json({backups:list.objects.map(o=>({name:o.key,bytes:o.size,createdAt:o.uploaded.toISOString()})).reverse()});}}
 if(p.startsWith('/api/backups/')&&read){admin(s);const name=p.slice(13);if(!/^dev-backup-[a-zA-Z0-9-]+\.json$/.test(name)||!env.BACKUPS)fail(404,'نسخة غير موجودة.');const obj=await env.BACKUPS.get(name);if(!obj)fail(404,'نسخة غير موجودة.');return new Response(req.method==='HEAD'?null:obj.body,{headers:{'Content-Type':'application/json','Content-Disposition':`attachment; filename="${name}"`}});}
 if((p==='/'||p==='/index.html')&&read)return page(env,req,'index.html',nonce);
 if(read){const entry=catalog.allowedFiles.find(a=>'/'+a.path===p);if(entry){const r=await env.ASSETS.fetch(req);if(!r.ok)fail(404,'الملف غير موجود.');const out=new Response(r.body,r);out.headers.set('Content-Type',entry.mime||'application/octet-stream');return out;}}
 fail(404,'المسار غير موجود.','NOT_FOUND');
}
async function saveBackup(store,s,env){if(!env.BACKUPS)fail(503,'تخزين النسخ الاحتياطية غير مهيأ.');const data=await snapshot(store.db);const name='dev-backup-'+crypto.randomUUID()+'.json',text=JSON.stringify(data);await env.BACKUPS.put(name,text,{httpMetadata:{contentType:'application/json'}});await store.atomic([store.audit(s.user,'backup.create',name)],{session:s,admin:true});return {name,bytes:Buffer.byteLength(text),createdAt:data.createdAt};}
export default {async fetch(req,env){const nonce=crypto.randomUUID().replaceAll('-','');try{return secure(await handle(req,env,nonce),nonce);}catch(e){const known=e instanceof HttpError;if(!known)console.error('Application request failed:',e.message);return secure(json({error:known?e.message:'تعذر إتمام الطلب.',code:known?e.code:'INTERNAL_ERROR'},known?e.status:500,e.status===429?{'Retry-After':'900'}:{}),nonce);}}};
