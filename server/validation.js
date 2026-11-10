'use strict';
const {bad,HttpError}=require('./errors');
const UNSAFE=new Set(['__proto__','constructor','prototype']);
const META=['at','updatedAt','by','st'];
const ROLE_SET=new Set(['admin','editor','viewer']);
function object(x){ return x!==null&&typeof x==='object'&&!Array.isArray(x); }
function safeTree(value,depth=0){
  if(depth>16)bad('بنية البيانات أعمق من الحد المسموح.');
  if(Array.isArray(value)){if(value.length>3000)bad('عدد العناصر أكبر من الحد المسموح.');value.forEach(v=>safeTree(v,depth+1));}
  else if(object(value)){if(Object.keys(value).length>3000)bad();for(const [k,v]of Object.entries(value)){if(UNSAFE.has(k))bad('مفتاح بيانات غير مسموح.');safeTree(v,depth+1);}}
  else if(typeof value==='string'){if(value.length>1100000||value.includes('\0'))bad('نص أطول من الحد المسموح أو غير صالح.');}
  else if(typeof value==='number'&&!Number.isFinite(value))bad();
  else if(!['string','number','boolean','undefined'].includes(typeof value)&&value!==null)bad();
}
function fields(row,allowed){if(!object(row))bad();for(const k of Object.keys(row))if(!allowed.includes(k))bad('حقل غير مسموح: '+k);}
function str(v,max=10000,required=false){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))bad('حقل نصي غير صالح.');return v;}
function optionalStrings(row,names,max=10000){for(const k of names)if(row[k]!==undefined)str(row[k],max);}
function one(v,values){if(!values.includes(v))bad('قيمة غير مسموح بها.');}
function date(v){str(v,10);if(v==='')return;const parsed=new Date(v+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==v)bad('التاريخ غير صالح.');}
function amount(v,nullable=false,integer=false){if(nullable&&v===null)return;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>Number.MAX_SAFE_INTEGER||(integer&&!Number.isSafeInteger(v)))bad('المبلغ أو العدد غير صالح.');}
function numericText(v){str(v,32);if(v!==''&&(!/^\d+(?:\.\d{1,6})?$/.test(v)||!Number.isFinite(Number(v))||Number(v)>Number.MAX_SAFE_INTEGER))bad('المبلغ غير صالح.');}
function url(v){str(v,3000);if(v==='')return;let u;try{u=new URL(v);}catch{bad('الرابط غير صالح.');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)bad('الرابط غير صالح.');}
function array(v,limit,fn){if(!Array.isArray(v)||v.length>limit)bad('قائمة غير صالحة.');v.forEach(fn);}
function callKey(c){let h=0;const t=(c.funder||'')+'|'+(c.title||'');for(let i=0;i<t.length;i++)h=(h*31+t.charCodeAt(i))|0;return'cw_'+(h>>>0).toString(36);}
function userInput(value,patch=false){
  safeTree(value);fields(value,patch?['displayName','role','active','password']:['username','displayName','role','password']);
  const out={};
  if(!patch){str(value.username,120,true);const u=value.username.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9_.@-]{2,119}$/.test(u))bad('اسم الدخول يجب أن يكون 3 أحرف لاتينية أو أرقام على الأقل.');out.username=u;}
  if(value.displayName!==undefined||!patch){str(value.displayName,100,true);out.displayName=value.displayName.trim();}
  if(value.role!==undefined||!patch){if(!ROLE_SET.has(value.role))bad('الصلاحية غير صالحة.');out.role=value.role;}
  if(value.active!==undefined){if(typeof value.active!=='boolean')bad();out.active=value.active;}
  if(value.password!==undefined||!patch){password(value.password);out.password=value.password;}
  if(patch&&!Object.keys(out).length)bad('لا توجد تعديلات.');return out;
}
function password(value){str(value,128,true);if(value.length<12)bad('كلمة المرور يجب أن تكون 12 حرفًا على الأقل.');}
function createValidator(catalog){
 const donors=new Set((catalog.donors||[]).map(x=>x.id));
 const projects=new Set((catalog.projects||[]).map(x=>x.id));projects.add('p15');
 const docs=new Set(catalog.documentIds||[]);const tags=new Set(Object.keys(catalog.tags||{}));
 const cw=new Set((catalog.calls||[]).map(c=>c.key||callKey(c)));
 const donorStages=catalog.donorStages||['رصد','دراسة','أفكار','إعداد الملف','مُقدَّم','نتيجة'];
 const projectStages=catalog.projectStages||['','مُعدّ','قيد المراجعة','جاهز للتقديم','مُقدَّم','قُبل','رُفض','مؤجل'];
 const finKeys=catalog.financialKeys||['target','cash','restricted','burn','subs','don','carry','extra','thr'];
 function donorExists(id,state){return donors.has(id)||(/^new_[a-z0-9]{1,80}$/.test(id)&&object(state['dn_'+id])&&object(state['dn_'+id].f)&&typeof state['dn_'+id].f.name==='string');}
 function tagList(v){array(v,tags.size,x=>{if(typeof x!=='string'||!tags.has(x))bad('مجال غير صالح.');});if(new Set(v).size!==v.length)bad('مجالات مكررة.');}
 function row(key,value,context={}){
   const state=context.state||{},isImport=!!context.isImport;safeTree(value);if(!object(value)||typeof key!=='string'||key.length>180)bad();
   const out=JSON.parse(JSON.stringify(value));
   if(Buffer.byteLength(JSON.stringify(out))>1200000)bad('السجل أكبر من الحد المسموح.');
   optionalStrings(out,['at','updatedAt','by'],200);if(out.st!==undefined)str(out.st,100);
   let kind='',id='';
   if(donorExists(key,state)){kind='donor';id=key;}
   else if(key==='fin_cfg')kind='fin';
   else {const m=key.match(/^(proj|pm|dn|cw|doc|logo|rel|acc|hist|chk|opp)_(.+)$/);if(!m)bad('معرّف سجل غير معروف.');kind=m[1];id=m[2];}
   if(['proj','pm'].includes(kind)&&!projects.has(id))bad('المشروع غير موجود.');
   if(kind==='proj'&&id==='p15'&&!isImport)bad('استخدم مشروع مهارات المستقبل الموحد.');
   if(kind==='pm'&&id==='p15')bad('معرّف إدارة المشروع غير معتمد.');
   if(['logo','rel','acc','hist','chk'].includes(kind)&&!donorExists(id,state))bad('الجهة غير موجودة.');
   if(kind==='donor'){fields(out,[...META,'note']);optionalStrings(out,['note']);if(out.st!==undefined)one(out.st,['',...donorStages]);}
   if(kind==='proj'){
     fields(out,[...META,'donor','note','res','awarded','mergePreviousRecords','ownerId','nextAction','dueDate']);
     optionalStrings(out,['donor','res','ownerId'],200);optionalStrings(out,['note','nextAction'],20000);
     if(out.st!==undefined)one(out.st,projectStages);
     if(out.donor&&!donorExists(out.donor,state))bad('الجهة المستهدفة غير موجودة.');
     if(out.awarded!==undefined)numericText(out.awarded);
     if(out.dueDate!==undefined)date(out.dueDate);
     if(out.ownerId&&context.memberIds&&!context.memberIds.has(out.ownerId))bad('الموظف المسؤول غير متاح.');
     if(out.mergePreviousRecords!==undefined){
       if(id!=='p11'||!object(out.mergePreviousRecords))bad('سجل دمج غير صالح.');
       for(const [oldId,snapshot]of Object.entries(out.mergePreviousRecords)){
         if(!['p11','p15'].includes(oldId)||!object(snapshot)||Object.hasOwn(snapshot,'mergePreviousRecords'))bad('سجل سابق غير صالح.');
         row('proj_'+oldId,snapshot,{...context,isImport:true});
       }
     }
   }
   if(kind==='pm'){
     fields(out,[...META,'schema','fields','visibility','lifecycle','previousLifecycle']);
     if(out.schema!==1||!object(out.fields))bad('سجل إدارة المشروع غير صالح.');
     if(out.visibility!==undefined)one(out.visibility,['visible','hidden']);
     if(out.lifecycle!==undefined)one(out.lifecycle,['active','archived','trashed']);
     if(out.previousLifecycle!==undefined)one(out.previousLifecycle,['active','archived']);
     const limits={name:160,sub:3000,audience:600,duration:500,nature:240};
     fields(out.fields,[...Object.keys(limits),'amount','beneficiaries','tags']);
     for(const[k,v]of Object.entries(out.fields)){if(Object.hasOwn(limits,k))str(v,limits[k],k==='name');else if(k==='tags')tagList(v);else amount(v,true,k==='beneficiaries');}
   }
   if(kind==='dn'){
     if(!donors.has(id)&&!/^new_[a-z0-9]{1,80}$/.test(id))bad('معرّف جهة غير صالح.');
     fields(out,[...META,'f','hidden']);if(out.hidden!==undefined&&typeof out.hidden!=='boolean')bad();
     if(out.f!==null&&out.f!==undefined){
       fields(out.f,['name','cat','sub','web','portal','apply','elig_txt','range','deadline','focus','reqs','notes','tags']);
       optionalStrings(out.f,['name'],200);optionalStrings(out.f,['sub'],2000);optionalStrings(out.f,['apply','elig_txt','range','notes'],20000);
       if(out.f.name!==undefined)str(out.f.name,200,true);
       if(out.f.cat!==undefined)one(out.f.cat,['government','foundation','csr']);
       for(const k of ['web','portal'])if(out.f[k]!==undefined)url(out.f[k]);
       if(out.f.deadline!==undefined&&out.f.deadline!==null)date(out.f.deadline);
       for(const k of ['focus','reqs'])if(out.f[k]!==undefined)array(out.f[k],200,x=>str(x,3000));
       if(out.f.tags!==undefined)tagList(out.f.tags);
     }
     if(!donors.has(id)&&(!object(out.f)||!out.f.name))bad('اسم الجهة الجديدة مطلوب.');
   }
   if(kind==='cw'){
     if(!cw.has(key))bad('الفرصة غير موجودة.');fields(out,[...META,'saved','stage','owner','note']);
     if(out.saved!==undefined&&typeof out.saved!=='boolean')bad();optionalStrings(out,['owner'],200);optionalStrings(out,['note'],20000);
     if(out.stage!==undefined)one(out.stage,['','eval','prep','sent','skip']);if(out.st!==undefined)one(out.st,['','eval','prep','sent','skip']);
   }
   if(kind==='doc'){
     if(!docs.has(id))bad('الوثيقة غير موجودة.');fields(out,[...META,'exp','iss','note']);for(const k of ['exp','iss'])if(out[k]!==undefined)date(out[k]);optionalStrings(out,['note']);
     if(out.st!==undefined)one(out.st,['',...(catalog.docStates||['ok','partial','missing','expired','stale'])]);
   }
   if(kind==='acc'){fields(out,[...META,'has','owner','how','where','note']);optionalStrings(out,['has','owner','how','where','note'],3000);if(out.has!==undefined)one(out.has,['','yes','no','na']);}
   if(kind==='rel'){
     fields(out,[...META,'log']);if(out.log!==undefined)array(out.log,1500,x=>{fields(x,['id','d','ch','who','x','nx','nd']);str(x.id,120,true);str(x.x,20000,true);optionalStrings(x,['who','nx'],5000);if(x.d!==undefined)date(x.d);if(x.nd!==undefined)date(x.nd);if(x.ch!==undefined)one(x.ch,['','اتصال','اجتماع','بريد','واتساب','فعالية','زيارة']);});
   }
   if(kind==='hist'){
     fields(out,[...META,'list']);if(out.list!==undefined)array(out.list,1500,x=>{fields(x,['p','g','sd','amt','st','rd','why','by']);optionalStrings(x,['p','g','why'],10000);optionalStrings(x,['by'],200);for(const k of ['sd','rd'])if(x[k]!==undefined)date(x[k]);if(x.amt!==undefined)numericText(x.amt);if(x.st!==undefined)one(x.st,['','قُدّم','قيد المراجعة','قُبل','رُفض','سُحب']);});
   }
   if(kind==='chk'){
     fields(out,[...META,'date','list']);if(out.date!==undefined)date(out.date);if(out.list!==undefined)array(out.list,100,x=>{fields(x,['d','x','by']);optionalStrings(x,['x'],10000);optionalStrings(x,['by'],200);if(x.d!==undefined)date(x.d);});
   }
   if(kind==='logo'){
     fields(out,[...META,'aid','dataUrl','verified','source']);optionalStrings(out,['aid'],200);if(out.aid&&!/^[a-zA-Z0-9_-]+$/.test(out.aid))bad();if(out.verified!==undefined&&typeof out.verified!=='boolean')bad();if(out.source!==undefined)url(out.source);
     if(out.dataUrl!==undefined){str(out.dataUrl,1100000);if(out.dataUrl){const m=out.dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);if(!m)bad('صيغة الشعار غير صالحة.');const b=Buffer.from(m[2],'base64');if(b.length>800000||b.length<12)bad('حجم الشعار غير صالح.');const valid=m[1]==='png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):m[1]==='jpeg'?b[0]===255&&b[1]===216&&b[2]===255:b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';if(!valid)bad('محتوى الشعار لا يطابق صيغته.');}}
   }
   if(kind==='fin'){
     fields(out,[...META,...finKeys]);for(const k of finKeys)if(out[k]!==undefined){amount(out[k]);if(['target','burn'].includes(k)&&out[k]===0)bad();if(k==='thr'&&out[k]>100)bad();}
   }
   if(kind==='opp'){
     if(!isImport||!/^\d+$/.test(id)||+id>=(catalog.calls||[]).length)bad('سجل قديم غير معروف.');fields(out,[...META,'saved','stage']);if(out.saved!==undefined&&typeof out.saved!=='boolean')bad();optionalStrings(out,['stage'],100);
   }
   return{value:out,kind};
 }
 function backup(data,state,memberIds){
   safeTree(data);if(!object(data)||data.format!=='donor-radar-backup'||![4,5,6].includes(data.version)||!object(data.state)||Object.keys(data.state).length>3000)bad('الملف ليس نسخة احتياطية معتمدة.');
   const incoming=JSON.parse(JSON.stringify(data.state));
   if(incoming.pm_p15){if(!incoming.pm_p11)incoming.pm_p11=incoming.pm_p15;delete incoming.pm_p15;}
   (catalog.calls||[]).forEach((c,i)=>{const old=incoming['opp_'+i],k=c.key||callKey(c);if(old&&!Object.hasOwn(incoming,k)){incoming[k]={saved:!!old.saved,stage:old.stage==='قيد التقييم'?'eval':'',st:old.stage==='قيد التقييم'?'eval':''};}});
   const combined={...state,...incoming};for(const [key,value]of Object.entries(incoming))row(key,value,{state:combined,isImport:true,memberIds});
   return incoming;
 }
 function authorize(user,key,value,previous,kind){
   if(user.role==='viewer')throw new HttpError(403,'صلاحيتك للاطلاع فقط.','FORBIDDEN');
   if(user.role==='admin')return;
   if(['pm','dn','fin','logo','opp'].includes(kind))throw new HttpError(403,'هذا التعديل يحتاج صلاحية مدير.','FORBIDDEN');
   if(kind==='proj'){
     if(previous?.st==='قُبل'&&['st','awarded','donor'].some(k=>(previous[k]??'')!==(value[k]??'')))throw new HttpError(403,'تعديل التمويل المعتمد يحتاج صلاحية مدير.','ACCEPTED_FUNDING_LOCKED');
     if(value.st==='قُبل'&&previous?.st!=='قُبل')throw new HttpError(403,'اعتماد التمويل يحتاج صلاحية مدير.','ACCEPTED_FUNDING_LOCKED');
   }
 }
 return{row,backup,authorize,callKey};
}
module.exports={createValidator,userInput,password,safeTree,object,str,date,url,fields,ROLE_SET};
