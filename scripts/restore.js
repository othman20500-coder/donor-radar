'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {settings,ask,fail}=require('./cli');
const {acquireMaintenance}=require('../server/lease');

function checkSnapshot(db){
 const result=db.prepare('PRAGMA integrity_check').all();if(result.length!==1||Object.values(result[0])[0]!=='ok')throw new Error('النسخة تالفة؛ لم تُغيّر البيانات الحالية.');
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('ترابط سجلات النسخة غير سليم.');
 const required={users:['id','username','display_name','role','password_hash','active','must_change_password','created_at','updated_at'],sessions:['token_hash','user_id','csrf','created_at','expires_at','last_seen'],records:['key','value','version','updated_at','updated_by'],meta:['key','value'],audit:['id','at','actor_id','actor_name','action','record_key','fields','version'],login_attempts:['key','count','window_start']};
 for(const [table,columns]of Object.entries(required)){
  const actual=db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name);if(columns.some(c=>!actual.includes(c)))throw new Error('الملف ليس نسخة قاعدة رادار المانحين المتوافقة.');
 }
 if(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger','view')").all().length)throw new Error('النسخة تحتوي كائنات غير معتمدة.');
 const schema=db.prepare("SELECT value FROM meta WHERE key='schema'").get();if(schema?.value!=='1')throw new Error('إصدار قاعدة البيانات غير متوافق.');
 if(!db.prepare("SELECT id FROM users WHERE active=1 AND role='admin'").get())throw new Error('النسخة لا تحتوي مديرًا نشطًا؛ اختر نسخة قابلة للاستخدام.');
}
function restoreSnapshot(cfg,source){
 const {DatabaseSync}=require('node:sqlite');
 source=path.resolve(source);if(!fs.statSync(source).isFile())throw new Error('حدد ملف نسخة SQLite.');
 const release=acquireMaintenance(cfg.dataDir),id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex');
 const temp=path.join(cfg.dataDir,'restore-'+id+'.sqlite'),target=path.join(cfg.dataDir,'radar.sqlite');let snapshot,next,old;
 let savedPrevious=null;
 try{
  snapshot=new DatabaseSync(source,{readOnly:true});snapshot.exec('PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000;');checkSnapshot(snapshot);
  // VACUUM INTO reads a consistent SQLite snapshot, including any source WAL.
  snapshot.prepare('VACUUM INTO ?').run(temp);snapshot.close();snapshot=null;fs.chmodSync(temp,0o600);
  next=new DatabaseSync(temp);next.exec('PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');checkSnapshot(next);
  next.exec('BEGIN IMMEDIATE');
  try{
   next.exec('DELETE FROM sessions; DELETE FROM login_attempts;');
   next.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
   next.prepare("DELETE FROM meta WHERE key='last_backup'").run();
   next.prepare('INSERT INTO audit(at,actor_id,actor_name,action,record_key,fields,version) VALUES(?,NULL,?,?,NULL,?,NULL)').run(new Date().toISOString(),'إدارة النظام','database.restore',JSON.stringify(['local-cli','sessions-revoked']));
   next.exec('COMMIT');
  }catch(e){next.exec('ROLLBACK');throw e;}
  next.close();next=null;
  const synced=fs.openSync(temp,'r');try{fs.fsyncSync(synced);}finally{fs.closeSync(synced);}
  if(fs.existsSync(target)){
   // All writers are stopped. Preserve the entire old database file set before
   // checkpointing or replacing it, including WAL/SHM after an interrupted run.
   savedPrevious=path.join(cfg.dataDir,'backups','before-restore-'+id);fs.mkdirSync(savedPrevious,{recursive:true,mode:0o700});
   fs.writeFileSync(path.join(savedPrevious,'.htaccess'),'Require all denied\n',{mode:0o600});
   for(const suffix of ['','-wal','-shm'])if(fs.existsSync(target+suffix)){const dest=path.join(savedPrevious,'radar.sqlite'+suffix);fs.copyFileSync(target+suffix,dest,fs.constants.COPYFILE_EXCL);fs.chmodSync(dest,0o600);}
   try{old=new DatabaseSync(target);const ck=old.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();if(ck?.busy)throw new Error('قاعدة البيانات مستخدمة من عملية أخرى. أوقفها أولًا.');old.close();old=null;}catch(e){if(old){try{old.close();}catch{}old=null;}if(![11,26].includes(e.errcode)&&!String(e.code||'').includes('SQLITE_CORRUPT')&&!String(e.code||'').includes('SQLITE_NOTADB'))throw e;}
  }
  // No application process can start while maintenance.lock exists.
  for(const suffix of ['-wal','-shm'])if(fs.existsSync(target+suffix))fs.unlinkSync(target+suffix);
  fs.renameSync(temp,target);fs.chmodSync(target,0o600);
  fs.writeFileSync(path.join(cfg.dataDir,'.htaccess'),'Require all denied\n',{mode:0o600});
  return{file:target,savedPrevious};
 }finally{
  for(const db of [snapshot,next,old])if(db)try{db.close();}catch{}
  for(const suffix of ['','-wal','-shm','-journal'])try{fs.unlinkSync(temp+suffix);}catch(e){if(e.code!=='ENOENT')throw e;}
  release();
 }
}
async function main(){
 const args=process.argv.slice(2),confirmed=args.includes('--confirm-restore'),files=args.filter(x=>x!=='--confirm-restore');
 if(files.length!==1||files[0].startsWith('-'))throw new Error('الاستخدام: npm run restore -- /absolute/backup.sqlite');
 const cfg=settings(),source=path.resolve(files[0]);
 console.log('يجب إيقاف التطبيق أولًا من cPanel. ستُستبدل البيانات والحسابات بما في النسخة، وستُلغى الجلسات.');
 if(!confirmed){const reply=await ask('اكتب RESTORE لتأكيد الاستعادة: ');if(reply!=='RESTORE')throw new Error('أُلغيت الاستعادة دون تغيير البيانات.');}
 const result=restoreSnapshot(cfg,source);
 console.log('اكتملت الاستعادة. أعد تشغيل التطبيق وسجّل الدخول من جديد.');
 if(result.savedPrevious)console.log('الملفات السابقة محفوظة محليًا في: '+result.savedPrevious);
}
if(require.main===module)main().catch(fail);
module.exports={restoreSnapshot,checkSnapshot,main};
