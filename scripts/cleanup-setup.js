'use strict';

const fs = require('node:fs');
const {openStore, fail} = require('./cli');
const {credentialPath, cleanupInitialCredentials} = require('../server/bootstrap-credentials');

function main(args=process.argv.slice(2)) {
  if (args.length) throw new Error('أمر setup:cleanup لا يقبل معاملات.');
  const app = openStore();
  try {
    const result = cleanupInitialCredentials({dataDir:app.cfg.dataDir, db:app.store.db});
    if (result.status === 'pending') throw new Error('أكمل تغيير كلمة مرور المدير الأول قبل حذف ملف التسليم.');
    if (result.status === 'none' && fs.existsSync(credentialPath(app.cfg.dataDir))) {
      throw new Error('يوجد ملف تهيئة غير مرتبط بحساب مثبت. لن يُحذف تلقائيًا.');
    }
    console.log(result.status === 'removed' ? 'اكتمل تنظيف ملف بيانات الدخول المؤقت.' : 'لا يوجد ملف تسليم يحتاج إلى تنظيف.');
  } finally { app.close(); }
}

if (require.main === module) { try { main(); } catch (error) { fail(error); } }
module.exports = {main};
