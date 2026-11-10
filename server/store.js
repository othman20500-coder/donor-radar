'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {HttpError,bad}=require('./errors');
const {createValidator,userInput}=require('./validation');
const {hashPassword,verifyPassword,randomToken,hashToken}=require('./security');
const {registerBootstrap,cleanupInitialCredentials}=require('./bootstrap-credentials');
function iso(){return new Date().toISOString();}
function riyadhDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function publicUser(u){return{id:u.id,username:u.username,displayName:u.display_name,role:u.role,active:!!u.active,mustChangePassword:!!u.must_change_password};}
class Store{
 constructor({dataDir,catalog}){
  this.dataDir=dataDir;fs.mkdirSync(dataDir,{recursive:true,mode:0o700});fs.chmodSync(dataDir,0o700);
  fs.writeFileSync(path.join(dataDir,'.htaccess'),'Require all denied\n',{mode:0o600});
  this.backupDir=path.join(dataDir,'backups');fs.mkdirSync(this.backupDir,{recursive:true,mode:0o700});fs.chmodSync(this.backupDir,0o700);
  fs.writeFileSync(path.join(this.backupDir,'.htaccess'),'Require all denied\n',{mode:0o600});
  this.file=path.join(dataDir,'radar.sqlite');this.db=new DatabaseSync(this.file);fs.chmodSync(this.file,0o600);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  this.db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,display_name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,must_change_password INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,last_seen TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS records(key TEXT PRIMARY KEY,value TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT OR IGNORE INTO meta(key,value) VALUES('revision','0');
INSERT OR IGNORE INTO meta(key,value) VALUES('schema','1');
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,actor_id TEXT,actor_name TEXT NOT NULL,action TEXT NOT NULL,record_key TEXT,fields TEXT NOT NULL DEFAULT '[]',version INTEGER);
CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,window_start TEXT NOT NULL);`);
  this.catalog=catalog;this.validate=createValidator(catalog);this.lastAutoCheck='';
 }
 close(){this.db.close();}
 revision(){return Number(this.db.prepare("SELECT value FROM meta WHERE key='revision'").get().value);}
 bump(){this.db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();return this.revision();}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const v=fn();this.db.exec('COMMIT');return v;}catch(e){try{this.db.exec('ROLLBACK');}catch{}throw e;}}
 audit(actor,action,key,fields=[],version=null){this.db.prepare('INSERT INTO audit(at,actor_id,actor_name,action,record_key,fields,version) VALUES(?,?,?,?,?,?,?)').run(iso(),actor?.id||null,actor?.displayName||'إدارة النظام',action,key||null,JSON.stringify(fields),version);}
 user(id){const u=this.db.prepare('SELECT * FROM users WHERE id=?').get(id);return u?publicUser(u):null;}
 users(){return this.db.prepare('SELECT * FROM users ORDER BY created_at,id').all().map(publicUser);}
 memberIds(){return new Set(this.db.prepare('SELECT id FROM users WHERE active=1').all().map(u=>u.id));}
 members(){return this.db.prepare('SELECT id,display_name FROM users WHERE active=1 ORDER BY display_name').all().map(u=>({id:u.id,displayName:u.display_name}));}
 assertActor(actor,requiredRole){
  if(!actor)return;const current=this.user(actor.id);
  if(!current?.active||(actor.sessionHash&&!this.sessionByHash(actor.sessionHash,actor.id)))throw new HttpError(401,'تغير الحساب؛ أعد تسجيل الدخول.','AUTH_REQUIRED');
  if(current.mustChangePassword||requiredRole&&current.role!==requiredRole)throw new HttpError(403,'لم تعد صلاحية الحساب تسمح بهذه العملية.','FORBIDDEN');
 }
 async createUser(input,actor,options={}){
  const {mustChangePassword,...publicInput}=input;const v=userInput(publicInput);const encoded=await hashPassword(v.password),id='u_'+crypto.randomUUID(),now=iso();
  return this.transaction(()=>{
   this.assertActor(actor,'admin');
   if(options.initialOnly&&this.db.prepare('SELECT id FROM users LIMIT 1').get())throw new HttpError(409,'تم إعداد النظام بالفعل. استخدم حساب المدير الحالي.','ALREADY_INITIALIZED');
   if(this.db.prepare('SELECT id FROM users WHERE username=?').get(v.username))throw new HttpError(409,'اسم الدخول مستخدم بالفعل.','USERNAME_EXISTS');
   const must=options.mustChangePassword??mustChangePassword??!!actor;
   if(options.bootstrapSetupId!==undefined&&(!options.initialOnly||actor||!must||v.role!=='admin'))throw new Error('تهيئة التسليم مخصصة للمدير الأول فقط.');
   this.db.prepare('INSERT INTO users(id,username,display_name,role,password_hash,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,v.username,v.displayName,v.role,encoded,must?1:0,now,now);
   if(options.bootstrapSetupId!==undefined)registerBootstrap(this.db,{setupId:options.bootstrapSetupId,userId:id,username:v.username});
   const u=this.user(id);this.audit(actor||u,'user.create',id,['username','displayName','role']);this.bump();return u;
  });
 }
 async updateUser(id,input,actor){
  const v=userInput(input,true),encoded=v.password?await hashPassword(v.password):null;
  return this.transaction(()=>{
   this.assertActor(actor,'admin');
   const old=this.db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!old)throw new HttpError(404,'المستخدم غير موجود.','NOT_FOUND');
   const role=v.role??old.role,active=v.active===undefined?!!old.active:v.active;
   if(old.role==='admin'&&old.active&&(!active||role!=='admin')&&this.db.prepare("SELECT count(*) n FROM users WHERE role='admin' AND active=1").get().n<=1)throw new HttpError(409,'يجب إبقاء مدير نشط واحد على الأقل.','LAST_ADMIN');
   this.db.prepare('UPDATE users SET display_name=?,role=?,active=?,password_hash=?,must_change_password=?,updated_at=? WHERE id=?').run(v.displayName??old.display_name,role,active?1:0,encoded||old.password_hash,encoded?1:old.must_change_password,iso(),id);
   if(encoded||role!==old.role||active!==!!old.active)this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
   this.audit(actor,encoded?'user.password_reset':'user.update',id,Object.keys(v).map(k=>k==='password'?'passwordReset':k));this.bump();return this.user(id);
  });
 }
 rateLimit(username,ip){
  const now=Date.now();for(const [key,max]of [['u:'+hashToken(username),8],['i:'+hashToken(ip),30]]){const r=this.db.prepare('SELECT * FROM login_attempts WHERE key=?').get(key);if(r&&now-Date.parse(r.window_start)<15*60*1000&&r.count>=max)throw new HttpError(429,'محاولات دخول كثيرة؛ حاول بعد 15 دقيقة.','RATE_LIMITED');}
 }
 loginFailure(username,ip){const now=iso(),cutoff=Date.now()-15*60*1000;for(const key of ['u:'+hashToken(username),'i:'+hashToken(ip)]){const r=this.db.prepare('SELECT * FROM login_attempts WHERE key=?').get(key);if(!r||Date.parse(r.window_start)<cutoff)this.db.prepare('INSERT INTO login_attempts(key,count,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=1,window_start=excluded.window_start').run(key,now);else this.db.prepare('UPDATE login_attempts SET count=count+1 WHERE key=?').run(key);}this.db.prepare('DELETE FROM login_attempts WHERE window_start<?').run(new Date(Date.now()-24*3600000).toISOString());}
 async login(username,password,ip){
  if(typeof username!=='string'||typeof password!=='string'||username.length>120||password.length>128)bad('بيانات الدخول غير صالحة.');
  username=username.trim().toLowerCase();this.rateLimit(username,ip);
  const row=this.db.prepare('SELECT * FROM users WHERE username=?').get(username),valid=await verifyPassword(password,row?.password_hash);
  if(!row||!row.active||!valid){this.loginFailure(username,ip);throw new HttpError(401,'اسم الدخول أو كلمة المرور غير صحيحة.','INVALID_LOGIN');}
  // A reset/deactivation could have occurred while scrypt was running.
  const current=this.db.prepare('SELECT * FROM users WHERE id=?').get(row.id);if(!current?.active||current.password_hash!==row.password_hash)throw new HttpError(401,'أعد تسجيل الدخول.','INVALID_LOGIN');
  this.db.prepare('DELETE FROM login_attempts WHERE key=?').run('u:'+hashToken(username));
  const token=randomToken(),csrf=randomToken(),now=iso();this.db.prepare('DELETE FROM sessions WHERE expires_at<? OR last_seen<?').run(now,new Date(Date.now()-60*60*1000).toISOString());
  this.db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,created_at,expires_at,last_seen) VALUES(?,?,?,?,?,?)').run(hashToken(token),row.id,csrf,now,new Date(Date.now()+12*3600000).toISOString(),now);
  const user=publicUser(current);this.audit(user,'auth.login',user.id);return{token,csrfToken:csrf,user};
 }
 session(token){
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
  const h=hashToken(token),s=this.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(h);if(!s)return null;
  const now=Date.now(),u=this.db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
  if(!u?.active||Date.parse(s.expires_at)<=now||Date.parse(s.last_seen)<now-3600000){this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(h);return null;}
  if(Date.parse(s.last_seen)<now-60000)this.db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(iso(),h);
  return{user:publicUser(u),csrfToken:s.csrf,tokenHash:h};
 }
 logout(s){this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(s.tokenHash);this.audit(s.user,'auth.logout',s.user.id);}
 async changePassword(s,currentPassword,newPassword){
  if(typeof newPassword==='string'&&newPassword===currentPassword)throw new HttpError(400,'اختر كلمة مرور جديدة تختلف عن كلمة المرور الحالية.','PASSWORD_REUSE');
  const old=this.db.prepare('SELECT * FROM users WHERE id=?').get(s.user.id);if(!await verifyPassword(currentPassword,old.password_hash))throw new HttpError(400,'كلمة المرور الحالية غير صحيحة.','INVALID_PASSWORD');
  const encoded=await hashPassword(newPassword),csrf=randomToken();const result=this.transaction(()=>{
   const current=this.db.prepare('SELECT password_hash,active FROM users WHERE id=?').get(s.user.id);
   if(!current?.active||current.password_hash!==old.password_hash||!this.sessionByHash(s.tokenHash,s.user.id))throw new HttpError(409,'تغير الحساب؛ أعد تسجيل الدخول.','ACCOUNT_CHANGED');
   this.db.prepare('UPDATE users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?').run(encoded,iso(),s.user.id);
   this.db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(s.user.id,s.tokenHash);
   this.db.prepare('UPDATE sessions SET csrf=? WHERE token_hash=?').run(csrf,s.tokenHash);
   this.audit(s.user,'auth.password_change',s.user.id,['password']);return{user:this.user(s.user.id),csrfToken:csrf};
  });
  // The password commit must succeed independently of best-effort file cleanup.
  try{cleanupInitialCredentials({dataDir:this.dataDir,db:this.db,userId:s.user.id});}
  catch{console.error('تم تغيير كلمة المرور، وتعذر تنظيف ملف التهيئة الخاص. شغّل setup:cleanup من لوحة الاستضافة.');}
  return result;
 }
 sessionByHash(tokenHash,userId){return this.db.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>? AND last_seen>?').get(tokenHash,userId,iso(),new Date(Date.now()-3600000).toISOString());}
 state(){const state={},versions={};for(const r of this.db.prepare('SELECT key,value,version FROM records').all()){state[r.key]=JSON.parse(r.value);versions[r.key]=r.version;}return{state,versions,revision:this.revision(),members:this.members(),serverTime:iso()};}
 record(key){const r=this.db.prepare('SELECT * FROM records WHERE key=?').get(key);return r?{value:JSON.parse(r.value),version:r.version}:null;}
 stamp(value,user){return{...value,by:user.displayName,at:riyadhDate(),updatedAt:iso()};}
 setRecord(key,value,expectedVersion,user){
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)bad('رقم إصدار السجل غير صالح.');
  return this.transaction(()=>{
   const state=this.state().state,previous=this.record(key),valid=this.validate.row(key,value,{state,memberIds:this.memberIds()});
   const effectivePrevious=previous?.value||(key==='proj_p11'?this.record('proj_p15')?.value:undefined);
   this.validate.authorize(user,key,valid.value,effectivePrevious,valid.kind);
   if((previous?.version||0)!==expectedVersion)throw new HttpError(409,'حدّث زميل هذا السجل. راجع آخر نسخة قبل حفظ تعديلك.','VERSION_CONFLICT',{current:previous?.value||null,version:previous?.version||0,revision:this.revision()});
   if(key==='proj_p11'){
    // Preserve both source tracking records once, independently of client input.
    const fallback=previous?.value||this.record('proj_p15')?.value||{};
    if(fallback.mergePreviousRecords&&typeof fallback.mergePreviousRecords==='object')valid.value.mergePreviousRecords=fallback.mergePreviousRecords;
    else{const history={};for(const oldId of ['p11','p15']){const old=this.record('proj_'+oldId);if(old){const snap={...old.value};delete snap.mergePreviousRecords;history[oldId]=snap;}}valid.value.mergePreviousRecords=history;}
   }
   const row=this.stamp(valid.value,user),version=(previous?.version||0)+1;
   this.db.prepare('INSERT INTO records(key,value,version,updated_at,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(key,JSON.stringify(row),version,row.updatedAt,user.id);
   const changed=Object.keys(row).filter(k=>!['by','at','updatedAt'].includes(k)&&JSON.stringify(previous?.value?.[k])!==JSON.stringify(row[k]));
   this.audit(user,previous?'record.update':'record.create',key,changed,version);return{key,value:row,version,revision:this.bump()};
  });
 }
 previewImport(backup){const state=this.state().state,incoming=this.validate.backup(backup,state,this.memberIds()),keys=Object.keys(incoming);return{revision:this.revision(),created:keys.filter(k=>!Object.hasOwn(state,k)),conflicts:keys.filter(k=>Object.hasOwn(state,k)),total:keys.length,warnings:['الاستيراد لا يغيّر حسابات الموظفين.','اختر إضافة السجلات الجديدة للاحتفاظ بالسجلات الموجودة.']};}
 import(backup,mode,expectedRevision,user){
  if(!['add-only','replace'].includes(mode)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)bad();
  this.previewImport(backup);if(expectedRevision!==this.revision())throw new HttpError(409,'تغيرت بيانات الفريق. أعد مراجعة الاستيراد.','REVISION_CONFLICT',{revision:this.revision()});
  this.createBackup(user,'before-import');
  return this.transaction(()=>{
   if(expectedRevision!==this.revision())throw new HttpError(409,'تغيرت بيانات الفريق. أعد مراجعة الاستيراد.','REVISION_CONFLICT',{revision:this.revision()});
   const incoming=this.validate.backup(backup,this.state().state,this.memberIds());let created=0,updated=0,skipped=0;
   for(const[key,val]of Object.entries(incoming)){
    const old=this.record(key);if(old&&mode==='add-only'){skipped++;continue;}
    const row=this.stamp(val,user),version=(old?.version||0)+1;
    this.db.prepare('INSERT INTO records(key,value,version,updated_at,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(key,JSON.stringify(row),version,row.updatedAt,user.id);
    old?updated++:created++;this.audit(user,'record.import',key,Object.keys(val).filter(k=>!['at','updatedAt','by'].includes(k)),version);
   }
   const revision=created||updated?this.bump():this.revision();this.audit(user,'backup.import',null,[mode,'created:'+created,'updated:'+updated,'skipped:'+skipped]);return{created,updated,skipped,revision};
  });
 }
 exportBackup(){return{format:'donor-radar-backup',version:6,createdAt:iso(),sourceDate:'2026-10-22',state:this.state().state};}
 auditEvents(limit){const n=Math.min(Math.max(Number(limit)||100,1),250);return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(n).map(r=>({id:r.id,at:r.at,actor:r.actor_name,actorId:r.actor_id,action:r.action,key:r.record_key,fields:JSON.parse(r.fields),version:r.version}));}
 backupFiles(){return fs.readdirSync(this.backupDir).filter(n=>/^radar-\d{8}T\d{6}Z-[a-f0-9]{8}\.sqlite$/.test(n)).map(name=>{const s=fs.statSync(path.join(this.backupDir,name));return{name,bytes:s.size,createdAt:s.mtime.toISOString()};}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 createBackup(actor,reason='manual'){
  const name='radar-'+iso().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')+'-'+crypto.randomBytes(4).toString('hex')+'.sqlite',dest=path.join(this.backupDir,name);
  this.db.prepare('VACUUM INTO ?').run(dest);fs.chmodSync(dest,0o600);const fd=fs.openSync(dest,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  this.db.prepare("INSERT INTO meta(key,value) VALUES('last_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(riyadhDate());
  this.audit(actor,'backup.create',name,[reason]);
  const files=this.backupFiles();for(const f of files.slice(14))fs.unlinkSync(path.join(this.backupDir,f.name));
  return this.backupFiles().find(f=>f.name===name);
 }
 maybeAutoBackup(){const today=riyadhDate();if(this.lastAutoCheck===today)return;const row=this.db.prepare("SELECT value FROM meta WHERE key='last_backup'").get();if(row?.value!==today)this.createBackup(null,'automatic-daily');this.lastAutoCheck=today;}
 backupPath(name){if(!/^radar-\d{8}T\d{6}Z-[a-f0-9]{8}\.sqlite$/.test(name))throw new HttpError(404,'النسخة غير موجودة.','NOT_FOUND');const file=path.join(this.backupDir,name);if(!fs.existsSync(file))throw new HttpError(404,'النسخة غير موجودة.','NOT_FOUND');return file;}
}
module.exports={Store,publicUser,iso};
