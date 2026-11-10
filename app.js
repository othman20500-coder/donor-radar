'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {config,within}=require('./server/config');
const {HttpError,bad}=require('./server/errors');
const {safeTree,fields,userInput}=require('./server/validation');
const security=require('./server/security');
const {acquireLease}=require('./server/lease');

function json(res,status,value){const body=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)});res.end(body);}
function redirect(res,to){res.writeHead(303,{Location:to,'Content-Type':'text/plain; charset=utf-8'});res.end('انتقل إلى صفحة تسجيل الدخول.');}
function readJson(req,limit){
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new HttpError(415,'أرسل بيانات JSON.','CONTENT_TYPE');
 const declared=Number(req.headers['content-length']||0);if(declared>limit)throw new HttpError(413,'حجم الطلب أكبر من الحد المسموح.','BODY_TOO_LARGE');
 return new Promise((resolve,reject)=>{let size=0,failed=false;const chunks=[];
  req.on('data',chunk=>{if(failed)return;size+=chunk.length;if(size>limit){failed=true;chunks.length=0;reject(new HttpError(413,'حجم الطلب أكبر من الحد المسموح.','BODY_TOO_LARGE'));return;}chunks.push(chunk);});
  req.on('end',()=>{if(failed)return;try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));safeTree(value);resolve(value);}catch(e){reject(e instanceof HttpError?e:new HttpError(400,'بيانات JSON غير صالحة.','INVALID_JSON'));}});
  req.on('error',()=>reject(new HttpError(400,'تعذر قراءة الطلب.','INVALID_REQUEST')));
  req.on('aborted',()=>reject(new HttpError(400,'توقف إرسال الطلب.','INVALID_REQUEST')));
 });
}
function requestPath(req,cfg){
 const raw=(req.url||'').split('?')[0];
 if(!raw.startsWith('/')||raw.startsWith('//')||raw.includes('\\')||/%(?:2f|5c|00)/i.test(raw))throw new HttpError(404,'المسار غير موجود.','NOT_FOUND');
 let decoded;try{decoded=decodeURIComponent(raw);}catch{throw new HttpError(400,'المسار غير صالح.','INVALID_PATH');}
 if(decoded.includes('\0')||decoded.includes('\\')||decoded.includes('%')||decoded.split('/').some(p=>p==='.'||p==='..'))throw new HttpError(404,'المسار غير موجود.','NOT_FOUND');
 if(cfg.prefix&&decoded===cfg.prefix)return{pathname:'',canonical:false};
 if(!decoded.startsWith(cfg.base))throw new HttpError(404,'المسار غير موجود.','NOT_FOUND');
 return{pathname:decoded.slice(cfg.prefix.length),canonical:true};
}
function html(file,base,nonce){
 let value=fs.readFileSync(file,'utf8');
 value=value.replace(/<meta\s+name=["']radar-base["'][^>]*>/gi,'');
 value=value.replace(/<head\b([^>]*)>/i,'<head$1><meta name="radar-base" content="'+base+'">');
 return value.replace(/<script\b([^>]*)>/gi,(_all,attrs)=>'<script'+attrs.replace(/\snonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')+' nonce="'+nonce+'">');
}
function serveHtml(req,res,file,cfg,nonce){const body=html(file,cfg.base,nonce);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':Buffer.byteLength(body)});res.end(req.method==='HEAD'?undefined:body);}
function sendFile(req,res,file,mime,download){
 const stat=fs.statSync(file);if(!stat.isFile())throw new HttpError(404,'الملف غير موجود.','NOT_FOUND');
 const headers={'Content-Type':mime||'application/octet-stream','Accept-Ranges':'bytes'};
 if(download)headers['Content-Disposition']="attachment; filename*=UTF-8''"+encodeURIComponent(download);
 let start=0,end=stat.size-1,status=200;
 if(req.headers.range){
  const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':'bytes */'+stat.size});res.end();return;}
  if(m[1]){start=Number(m[1]);if(m[2])end=Math.min(Number(m[2]),end);}else{const suffix=Number(m[2]);start=Math.max(0,stat.size-suffix);}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=stat.size){res.writeHead(416,{'Content-Range':'bytes */'+stat.size});res.end();return;}
  status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+stat.size;
 }
 headers['Content-Length']=stat.size?end-start+1:0;res.writeHead(status,headers);
 if(req.method==='HEAD'||stat.size===0){res.end();return;}
 const stream=fs.createReadStream(file,{start,end});stream.once('error',()=>res.destroy());res.once('close',()=>stream.destroy());stream.pipe(res);
}
function createApp(options={}){
 const cfg=config(options);const {Store}=require('./server/store');
 const catalog=JSON.parse(fs.readFileSync(cfg.catalogPath,'utf8'));const allowed=new Map();
 for(const item of catalog.allowedFiles||[]){if(!item||typeof item.path!=='string'||item.path.startsWith('/')||item.path.includes('\\')||item.path.split('/').some(p=>p==='.'||p==='..'||p.startsWith('.')))throw new Error('قائمة الملفات المحمية غير صالحة.');allowed.set(item.path,item);}
 const release=acquireLease(cfg.dataDir);let store;try{store=new Store({dataDir:cfg.dataDir,catalog});}catch(e){release();throw e;}
 let pendingHash=0,closed=false;const passwordAttempts=new Map();
 async function hashing(fn){if(pendingHash>=2)throw new HttpError(429,'الخدمة مشغولة بطلبات الدخول. حاول بعد قليل.','RATE_LIMITED');pendingHash++;try{return await fn();}finally{pendingHash--;}}
 function administrator(s){if(s.user.role!=='admin')throw new HttpError(403,'هذه العملية تحتاج صلاحية مدير.','FORBIDDEN');}
 const handler=async(req,res)=>{
  const nonce=crypto.randomBytes(18).toString('base64');security.headers(res,nonce);
  if(cfg.secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try{
   if(fs.existsSync(path.join(cfg.dataDir,'maintenance.lock')))throw new HttpError(503,'النظام في صيانة مؤقتة.','MAINTENANCE');
   const {pathname:p,canonical}=requestPath(req,cfg);
   if(!canonical){redirect(res,cfg.base);return;}
   const isRead=req.method==='GET'||req.method==='HEAD',isApi=p.startsWith('/api/');
   if(!['GET','HEAD','POST','PUT','PATCH'].includes(req.method)){res.setHeader('Allow','GET, HEAD, POST, PUT, PATCH');throw new HttpError(405,'طريقة الطلب غير مسموحة.','METHOD_NOT_ALLOWED');}
   if(!isRead)security.checkOrigin(req,cfg);
   const token=security.readCookie(req,cfg.cookieName);let session=store.session(token);
   function freshSession(allowPasswordChange=false){
    session=store.session(token);if(!session)throw new HttpError(401,'انتهت الجلسة أو تغير الحساب. أعد تسجيل الدخول.','AUTH_REQUIRED');
    if(!security.equal(req.headers['x-csrf-token'],session.csrfToken))throw new HttpError(403,'تغيرت الجلسة. حدّث الصفحة.','INVALID_CSRF');
    if(session.user.mustChangePassword&&!allowPasswordChange)throw new HttpError(403,'غيّر كلمة المرور المؤقتة لتفعيل حسابك.','PASSWORD_CHANGE_REQUIRED');
    return session;
   }
   const actor=()=>({...session.user,sessionHash:session.tokenHash});
   if(p==='/login'&&isRead){
    if(session&&!session.user.mustChangePassword){redirect(res,cfg.base);return;}
    serveHtml(req,res,path.join(cfg.viewsDir,'login.html'),cfg,nonce);return;
   }
   if(p==='/api/auth/login'&&req.method==='POST'){
    const body=await readJson(req,16384);fields(body,['username','password']);
    const result=await hashing(()=>store.login(body.username,body.password,req.socket.remoteAddress||'unknown'));
    if(session)store.logout(session);res.setHeader('Set-Cookie',security.cookie(result.token,cfg));
    json(res,200,{user:result.user,csrfToken:result.csrfToken});return;
   }
   if(!session){if(token)res.setHeader('Set-Cookie',security.cookie('',cfg,true));if(isApi||!isRead)throw new HttpError(401,'انتهت الجلسة أو لم تسجل الدخول.','AUTH_REQUIRED');redirect(res,cfg.base+'login');return;}
   if(!isRead&&!security.equal(req.headers['x-csrf-token'],session.csrfToken))throw new HttpError(403,'تعذر التحقق من الطلب. حدّث الصفحة وحاول مرة أخرى.','INVALID_CSRF');
   if(p==='/api/session'&&req.method==='GET'){json(res,200,{user:session.user,csrfToken:session.csrfToken});return;}
   if(p==='/api/auth/logout'&&req.method==='POST'){store.logout(session);res.setHeader('Set-Cookie',security.cookie('',cfg,true));json(res,200,{ok:true});return;}
   if(p==='/api/auth/password'&&req.method==='POST'){
    const body=await readJson(req,16384);fields(body,['currentPassword','newPassword']);
    freshSession(true);
    const key=session.user.id,now=Date.now(),attempt=passwordAttempts.get(key);
    if(attempt&&now-attempt.at<15*60000&&attempt.count>=8)throw new HttpError(429,'محاولات كثيرة؛ حاول بعد 15 دقيقة.','RATE_LIMITED');
    passwordAttempts.set(key,{at:attempt&&now-attempt.at<15*60000?attempt.at:now,count:attempt&&now-attempt.at<15*60000?attempt.count+1:1});
    const result=await hashing(()=>store.changePassword(session,body.currentPassword,body.newPassword));passwordAttempts.delete(key);json(res,200,result);return;
   }
   if(session.user.mustChangePassword){if(!isApi&&isRead){redirect(res,cfg.base+'login');return;}throw new HttpError(403,'غيّر كلمة المرور المؤقتة لتفعيل حسابك.','PASSWORD_CHANGE_REQUIRED');}
   // A failed daily snapshot must not prevent staff reading their existing work.
   try{store.maybeAutoBackup();}catch{if(cfg.nodeEnv!=='test')console.error('تعذر إنشاء النسخة اليومية. راجع مساحة القرص وصلاحيات مجلد البيانات.');}
   if(p==='/api/state'&&req.method==='GET'){
    const since=new URL(req.url,cfg.origin).searchParams.get('since');if(since!==null&&!/^\d+$/.test(since))bad('رقم المراجعة غير صالح.');
    const revision=store.revision();json(res,200,since!==null&&Number(since)===revision?{unchanged:true,revision,serverTime:new Date().toISOString()}:store.state());return;
   }
   if(p.startsWith('/api/records/')&&req.method==='PUT'){
    if(session.user.role==='viewer')throw new HttpError(403,'صلاحيتك للاطلاع فقط.','FORBIDDEN');
    const body=await readJson(req,2*1024*1024);fields(body,['value','expectedVersion']);
    freshSession();
    json(res,200,store.setRecord(p.slice('/api/records/'.length),body.value,body.expectedVersion,session.user));return;
   }
   if(p==='/api/users'&&req.method==='GET'){administrator(session);json(res,200,{users:store.users()});return;}
   if(p==='/api/users'&&req.method==='POST'){
    administrator(session);const body=await readJson(req,16384);userInput(body);
    freshSession();administrator(session);const user=await hashing(()=>store.createUser(body,actor(),{mustChangePassword:true}));json(res,201,{user});return;
   }
   if(p.startsWith('/api/users/')&&req.method==='PATCH'){
    administrator(session);const body=await readJson(req,16384);freshSession();administrator(session);const user=await hashing(()=>store.updateUser(p.slice('/api/users/'.length),body,actor()));json(res,200,{user});return;
   }
   if(p==='/api/audit'&&req.method==='GET'){
    administrator(session);const value=new URL(req.url,cfg.origin).searchParams.get('limit');if(value!==null&&(!/^\d+$/.test(value)||Number(value)<1))bad();json(res,200,{events:store.auditEvents(value)});return;
   }
   if(p==='/api/backup'&&req.method==='GET'){
    administrator(session);res.setHeader('Content-Disposition','attachment; filename="radar-state-'+new Date().toISOString().slice(0,10)+'.json"');json(res,200,store.exportBackup());return;
   }
   if(p==='/api/backups'&&req.method==='GET'){administrator(session);json(res,200,{backups:store.backupFiles()});return;}
   if(p==='/api/backups'&&req.method==='POST'){administrator(session);json(res,201,{backup:store.createBackup(session.user)});return;}
   if(p.startsWith('/api/backups/')&&isRead){administrator(session);const name=p.slice('/api/backups/'.length);sendFile(req,res,store.backupPath(name),'application/vnd.sqlite3',name);return;}
   if(p==='/api/import/preview'&&req.method==='POST'){
    administrator(session);const body=await readJson(req,64*1024*1024);fields(body,['backup']);freshSession();administrator(session);json(res,200,store.previewImport(body.backup));return;
   }
   if(p==='/api/import'&&req.method==='POST'){
    administrator(session);const body=await readJson(req,64*1024*1024);fields(body,['backup','mode','expectedRevision']);freshSession();administrator(session);json(res,200,store.import(body.backup,body.mode||'add-only',body.expectedRevision,session.user));return;
   }
   if(isRead&&(p==='/'||p==='/index.html')){serveHtml(req,res,path.join(cfg.appDir,'index.html'),cfg,nonce);return;}
   if(isRead){
    const relative=p.slice(1),entry=allowed.get(relative);if(entry){
     const file=fs.realpathSync(path.join(cfg.appDir,relative));if(!within(fs.realpathSync(cfg.appDir),file))throw new HttpError(404,'الملف غير موجود.','NOT_FOUND');
     const ext=path.extname(file).toLowerCase(),inline=['.pdf','.png','.jpg','.jpeg','.webp','.svg'].includes(ext);
     sendFile(req,res,file,entry.mime,inline?undefined:path.basename(file));return;
    }
   }
   throw new HttpError(404,'المسار غير موجود.','NOT_FOUND');
  }catch(e){
   if(res.headersSent){res.destroy();return;}
   const known=e instanceof HttpError,status=known?e.status:500;
   if(!known&&cfg.nodeEnv!=='test')console.error('تعذر إتمام طلب في رادار المانحين. تحقق من الملفات وصلاحيات قاعدة البيانات.');
   if(status===429)res.setHeader('Retry-After','900');
   json(res,status,{error:known?e.message:'تعذر إتمام الطلب. حاول مرة أخرى أو تواصل مع مدير النظام.',code:known?e.code:'INTERNAL_ERROR',...(known&&e.details?e.details:{})});
  }
 };
 const server=http.createServer({maxHeaderSize:16384},handler);server.requestTimeout=60000;server.headersTimeout=15000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=1000;
 server.on('clientError',(_error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
 async function close(){if(closed)return;closed=true;if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));store.close();release();}
 return{server,store,config:cfg,close};
}
function start(){
 try{
  const app=createApp();app.server.listen(app.config.port,()=>console.log('رادار المانحين: الخدمة جاهزة.'));
  let stopping=false;const stop=()=>{if(stopping)return;stopping=true;app.close().then(()=>process.exit(0)).catch(()=>process.exit(1));};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  app.server.on('error',()=>{console.error('تعذر بدء الخدمة. راجع PORT وإعدادات Node.js في الاستضافة.');stop();});
  return app;
 }catch(e){console.error(e.message||'تعذر بدء رادار المانحين.');process.exitCode=1;}
}
// Keep this module inert when imported. Hosting loaders use passenger.cjs.
if(require.main===module)start();
module.exports={createApp,start};
