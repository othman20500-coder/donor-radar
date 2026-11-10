'use strict';

const {openStore, fail} = require('./cli');
const {stageCredentials, discardUncommittedCredentials} = require('../server/bootstrap-credentials');

async function createInitialAdmin(app, username, displayName) {
  if (app.store.users().length) throw new Error('تم إعداد النظام بالفعل. لن يُعاد إنشاء المدير أو تغيير كلمة مروره.');
  const staged = stageCredentials(app.cfg, username, displayName);
  try {
    const user = await app.store.createUser(staged.input, null, {
      initialOnly:true, mustChangePassword:true, bootstrapSetupId:staged.setupId
    });
    return {user, file:staged.file};
  } catch (error) {
    try { discardUncommittedCredentials(app.cfg.dataDir, app.store.db, staged.setupId); }
    catch { console.error('تعذر تنظيف ملف التهيئة الخاص. راجع حالة المدير قبل أي محاولة أخرى.'); }
    throw error;
  }
}

async function main(args=process.argv.slice(2)) {
  if (args.length !== 2) throw new Error('استخدم setup:cpanel مع اسم الدخول واسم العرض فقط. لا تُدخل كلمة مرور في الأمر.');
  const app = openStore();
  try {
    const result = await createInitialAdmin(app, args[0], args[1]);
    console.log('تم إنشاء المدير الأول. يلزم تغيير كلمة المرور عند أول دخول.');
    console.log('ملف بيانات الدخول الخاص: ' + result.file);
  } finally { app.close(); }
}

if (require.main === module) main().catch(fail);
module.exports = {main, createInitialAdmin};
