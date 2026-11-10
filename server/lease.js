'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
function maintenanceFile(dataDir){return path.join(dataDir,'maintenance.lock');}
function acquireLease(dataDir){
 fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
 const dir=path.join(dataDir,'run');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const guard=maintenanceFile(dataDir);
 if(fs.existsSync(guard))throw new Error('التطبيق في وضع صيانة الاستعادة. أتمم الاستعادة قبل تشغيل الخدمة.');
 const file=path.join(dir,process.pid+'-'+crypto.randomBytes(8).toString('hex')+'.lock');
 fs.writeFileSync(file,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
 if(fs.existsSync(guard)){fs.unlinkSync(file);throw new Error('بدأت صيانة الاستعادة. أعد تشغيل الخدمة بعد انتهائها.');}
 let released=false;return()=>{if(!released){released=true;try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}}};
}
function acquireMaintenance(dataDir){
 fs.mkdirSync(dataDir,{recursive:true,mode:0o700});const guard=maintenanceFile(dataDir);
 try{fs.writeFileSync(guard,JSON.stringify({pid:process.pid,at:new Date().toISOString()}),{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST')throw new Error('يوجد قفل صيانة بالفعل. لا تبدأ استعادة أخرى؛ راجع العملية المحلية أولًا.');throw e;}
 const release=()=>{try{fs.unlinkSync(guard);}catch(e){if(e.code!=='ENOENT')throw e;}};
 try{
  const dir=path.join(dataDir,'run');for(const name of fs.existsSync(dir)?fs.readdirSync(dir):[]){
   if(!/^\d+-[a-f0-9]+\.lock$/.test(name))throw new Error('ملف قفل غير معروف؛ تحقق من توقف الخدمة قبل الاستعادة.');
   const pid=Number(name.split('-')[0]);let alive=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
   if(alive)throw new Error('الخدمة ما زالت تعمل. استخدم Stop App في cPanel وأوقف جميع عملياتها قبل الاستعادة.');
   fs.unlinkSync(path.join(dir,name));
  }
  return release;
 }catch(e){release();throw e;}
}
module.exports={acquireLease,acquireMaintenance};
