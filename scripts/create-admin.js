'use strict';
const {openStore,ask,secret,fail}=require('./cli');
const {password:validatePassword}=require('../server/validation');
async function main(){
 if(process.argv.length>2)throw new Error('لا تضع كلمات المرور في الأمر. استخدم npm run setup واتبع الأسئلة.');
 const app=openStore();try{
  if(app.store.users().length)throw new Error('تم إعداد النظام بالفعل. أنشئ حسابات الموظفين من لوحة الفريق باستخدام حساب مدير.');
  console.log('إنشاء أول مدير لرادار المانحين. لن تظهر كلمة المرور أثناء الكتابة.');
  const displayName=await ask('اسم المدير المعروض: '),username=await ask('اسم الدخول (أحرف لاتينية/أرقام، 3–120): ');
  const password=await secret('كلمة المرور (12–128 حرفًا): ');validatePassword(password);
  const repeated=await secret('أعد كلمة المرور: ');if(password!==repeated)throw new Error('كلمتا المرور غير متطابقتين. لم يُنشأ حساب.');
  await app.store.createUser({username,displayName,role:'admin',password},null,{mustChangePassword:false,initialOnly:true});
  console.log('تم إنشاء المدير. افتح رابط التطبيق وسجّل الدخول.');
 }finally{app.close();}
}
if(require.main===module)main().catch(fail);
module.exports={main};
