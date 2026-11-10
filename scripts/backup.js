'use strict';
const {openStore,fail}=require('./cli');
function main(){
 if(process.argv.length>2)throw new Error('الاستخدام: npm run backup');
 const app=openStore();try{const backup=app.store.createBackup(null,'local-cli');console.log('أُنشئت لقطة SQLite متسقة: '+app.store.backupPath(backup.name));console.log('الحجم: '+backup.bytes+' بايت. تحتوي الحسابات والبيانات؛ احفظها في مكان خاص.');}finally{app.close();}
}
if(require.main===module){try{main();}catch(e){fail(e);}}
module.exports={main};
