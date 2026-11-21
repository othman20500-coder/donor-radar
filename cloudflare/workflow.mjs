import {fields} from '../server/validation.js';
import {fail,now,digest} from './security.mjs';
import {matchProject,byFit,validateTerms,parseTerms,statusFor,READINESS,ENTITY_TYPES,AUDIENCES,APP_STATUS,DEFAULT_ORG} from './match.mjs';
const stages=['eval','prep','sent','accepted','rejected','closed'];
const stageNames={eval:'تقييم',prep:'تجهيز',sent:'قُدم',accepted:'مقبول',rejected:'مرفوض',closed:'مغلق'};
function text(v,max=1000){if(typeof v!=='string'||v.length>max)fail(400,'نص غير صالح.');return v.trim();}
function date(v){if(v!==''&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))fail(400,'تاريخ غير صالح.');return v;}
export function asCall(o,catalog){const d=catalog.donors.find(d=>d.id===o.donor_id);const f=JSON.parse(o.fields_json||'{}');return {id:o.id,key:'cw_mon_'+o.id,donorId:o.donor_id,funder:d?.name||f.donorName||'جهة تحتاج مراجعة',title:o.title,url:o.source_url,deadline:o.closes_at||'',field:(f.topics||[]).join('، '),src:'مركز الرصد — مراجعة بشرية',notes:(o.opens_at?'الفتح '+o.opens_at+'؛ ':'')+(f.notes||'')+'؛ تحقق من الشروط في المصدر',monitor:true};}
export function effectiveProjects(catalog,state){return catalog.projects.map(p=>({...p,...(state['pm_'+p.id]?.fields||{}),visibility:state['pm_'+p.id]?.visibility,lifecycle:state['pm_'+p.id]?.lifecycle})).filter(p=>p.visibility!=='hidden'&&!['trashed','archived'].includes(p.lifecycle));}
const docStates=state=>Object.fromEntries(Object.keys(READINESS).map(k=>[k,state['doc_'+k]?.st||'']));
function view(o,catalog,state){const f=JSON.parse(o.fields_json||'{}'),terms=parseTerms(o.terms_json);return {...o,terms,status:statusFor(terms,o,now().slice(0,10)),topics:f.topics||[],donorName:f.donorName||null};}
export {matchProject};
export async function workflowRoute(store,s,path,method,b){
 const state=await store.state();
 if(method==='GET'&&path==='/api/workflow'){
  const rows=await store.all("SELECT * FROM opportunities WHERE review_status='approved' OR ?='admin' ORDER BY created_at DESC LIMIT 300",s.user.role),opportunities=rows.map(o=>view(o,store.catalog,state.state)),projects=effectiveProjects(store.catalog,state.state),org=store.catalog.org||DEFAULT_ORG,docs=docStates(state.state),today=now().slice(0,10),labels=Object.fromEntries(Object.entries(store.catalog.tags||{}).map(([k,v])=>[k,typeof v==='string'?v:k]));
  const approved=opportunities.filter(o=>o.review_status==='approved');
  const events=await store.all('SELECT application_id,at,kind,actor_name,text,data FROM application_events ORDER BY id DESC LIMIT 600'),byApp={};for(const e of events){(byApp[e.application_id]??=[]).length<15&&byApp[e.application_id].push({...e,data:JSON.parse(e.data||'{}')});}
  const evidence=s.user.role==='admin'?(await store.all("SELECT id,opportunity_id,url,opens_at,closes_at,review_status,origin,excerpt,conflicts FROM evidence WHERE opportunity_id IS NOT NULL AND review_status IN ('pending','accepted') ORDER BY created_at DESC LIMIT 400")).map(e=>({...e,excerpt:JSON.parse(e.excerpt||'[]')})):[];
  const relations=Object.fromEntries([...new Set(approved.map(o=>o.donor_id).filter(Boolean))].map(id=>[id,(state.state['rel_'+id]?.log||[]).slice(-3)]));
  return {tags:store.catalog.tags,enums:{entityTypes:ENTITY_TYPES,audiences:AUDIENCES,appStatus:APP_STATUS,readiness:READINESS},org,opportunities,applications:state.applications,events:byApp,evidence,relations,alerts:state.monitorAlerts,members:state.members,donors:store.catalog.donors.map(d=>({id:d.id,name:d.name})),projects:projects.map(p=>({id:p.id,name:p.name})),matches:Object.fromEntries(approved.map(o=>[o.id,projects.map(p=>matchProject(o,p,{terms:o.terms,topics:o.topics,org,docs,today,labels})).sort(byFit)]))};
 }
 if(method!=='POST')fail(404,'مسار غير موجود.');if(s.user.role==='viewer')fail(403,'صلاحيتك للاطلاع فقط.');
 if(path.startsWith('/api/workflow/alerts/')&&path.endsWith('/ack')){
  fields(b,[]);const id=Number(path.slice('/api/workflow/alerts/'.length,-4));if(!Number.isSafeInteger(id)||id<1)fail(400,'تنبيه غير صالح.');
  await store.atomic([store.q('UPDATE alerts SET acknowledged_at=? WHERE id=? AND acknowledged_at IS NULL',now(),id),store.audit(s.user,'alert.ack',String(id)),store.bump()],{session:s,condition:'EXISTS(SELECT 1 FROM alerts WHERE id=?)',args:[id]});return {ok:true};
 }
 if(path.startsWith('/api/workflow/opportunities/')){
  if(s.user.role!=='admin')fail(403,'اعتماد الفرص للمدير.');fields(b,['decision','expectedVersion','donorId','topics','eligibility','region','audience','notes','evidenceId','terms','duplicateOf','noEvidenceReason','donorName']);const id=path.split('/').pop(),o=await store.one('SELECT * FROM opportunities WHERE id=?',id);if(!o)fail(404,'الفرصة غير موجودة.');
  if(!['approved','rejected','duplicate'].includes(b.decision)||!Number.isInteger(b.expectedVersion))fail(400,'قرار غير صالح.');
  const guard={session:s,admin:true,condition:'EXISTS(SELECT 1 FROM opportunities WHERE id=? AND version=?)',args:[id,b.expectedVersion]};
  // Rejecting or withdrawing needs no classification; history, evidence and applications stay.
  if(b.decision==='rejected'){await store.atomic([store.q("UPDATE opportunities SET review_status='rejected',version=version+1 WHERE id=?",id),store.audit(s.user,'workflow.review',id,['rejected'],b.expectedVersion+1),store.bump()],guard);return {ok:true,version:b.expectedVersion+1};}
  if(b.decision==='duplicate'){
   if(typeof b.duplicateOf!=='string'||b.duplicateOf===id)fail(400,'اختر الإعلان الأصلي.');const canon=await store.one("SELECT id FROM opportunities WHERE id=? AND duplicate_of IS NULL AND review_status!='rejected'",b.duplicateOf);if(!canon)fail(400,'الإعلان الأصلي غير متاح.');
   if(await store.one('SELECT id FROM applications WHERE opportunity_id=? LIMIT 1',id))fail(409,'لا يمكن دمج فرصة لها طلبات تقديم؛ انقل المتابعة أولًا.','HAS_APPLICATIONS');
   await store.atomic([store.q("UPDATE opportunities SET review_status='rejected',duplicate_of=?,version=version+1 WHERE id=?",canon.id,id),store.audit(s.user,'workflow.duplicate',id,[canon.id],b.expectedVersion+1),store.bump()],{...guard,condition:guard.condition+' AND NOT EXISTS(SELECT 1 FROM applications WHERE opportunity_id=?)',args:[id,b.expectedVersion,id]});return {ok:true,version:b.expectedVersion+1};
  }
  // A funder missing from the directory may be named in free text; the catalog id stays null until the directory is updated.
  const donorName=text(b.donorName||'',160);if(b.donorId){if(!store.catalog.donors.some(d=>d.id===b.donorId))fail(400,'اختر جهة من الدليل.');}else if(donorName.length<3)fail(400,'اختر جهة من الدليل أو اكتب اسم الجهة المانحة (3 أحرف فأكثر).','DONOR_REQUIRED');
  if(!Array.isArray(b.topics)||b.topics.length>30||b.topics.some(t=>typeof t!=='string'||!Object.hasOwn(store.catalog.tags,t)))fail(400,'مجالات غير صالحة.');
  let terms;try{terms=validateTerms(b.terms);}catch(e){if(e instanceof RangeError)fail(400,e.message);throw e;}
  const meta={topics:b.topics,eligibility:text(b.eligibility||''),region:text(b.region||''),audience:text(b.audience||''),notes:text(b.notes||'')};if(!b.donorId)meta.donorName=donorName;
  let evidence=null;if(b.evidenceId){evidence=await store.one("SELECT * FROM evidence WHERE id=? AND opportunity_id=? AND url=? AND review_status='accepted' AND conflicts=0",b.evidenceId,id,o.source_url);if(!evidence)fail(400,'اربط دليلًا معتمدًا يخص إعلان الفرصة نفسه.');}
  else if(!o.evidence_id){const why=text(b.noEvidenceReason||'',300);if(why.length<10)fail(400,'اربط دليلًا معتمدًا، أو وثّق سبب نشر الفرصة بلا دليل تاريخ (10 أحرف على الأقل).','EVIDENCE_REQUIRED');meta.noEvidenceReason=why;}
  const statements=[store.q("UPDATE opportunities SET review_status='approved',donor_id=?,fields_json=?,terms_json=?,evidence_id=?,opens_at=?,closes_at=?,duplicate_of=NULL,version=version+1 WHERE id=?",b.donorId||null,JSON.stringify(meta),JSON.stringify(terms),evidence?.id||o.evidence_id,evidence?evidence.opens_at:o.opens_at,evidence?evidence.closes_at:o.closes_at,id),store.audit(s.user,'workflow.review',id,['approved'],b.expectedVersion+1),store.bump()];
  await store.atomic(statements,guard);return {ok:true,version:b.expectedVersion+1};
 }
 const eventMatch=/^\/api\/workflow\/applications\/([a-f0-9]{32})\/events$/.exec(path);
 if(eventMatch){
  fields(b,['kind','text','result']);const app=await store.one('SELECT * FROM applications WHERE id=?',eventMatch[1]);if(!app)fail(404,'طلب التقديم غير موجود.');
  if(!['contact','note','result'].includes(b.kind))fail(400,'نوع السجل غير صالح.');const body=text(b.text,2000);if(!body)fail(400,'اكتب نص السجل.');
  const at=now(),statements=[];let data={};
  if(b.kind==='result'){if(!['accepted','rejected'].includes(b.result))fail(400,'اختر نتيجة الطلب.');if(b.result==='accepted'&&s.user.role!=='admin')fail(403,'تسجيل القبول يتطلب المدير.');if(app.stage==='accepted'&&s.user.role!=='admin')fail(403,'تغيير القبول يتطلب المدير.');data={result:b.result};statements.push(store.q('UPDATE applications SET stage=?,version=version+1,updated_at=? WHERE id=?',b.result,at,app.id));}
  else if(b.result!==undefined)fail(400,'النتيجة خاصة بسجل النتيجة.');
  statements.push(store.q('INSERT INTO application_events(application_id,at,kind,actor_id,actor_name,text,data) VALUES(?,?,?,?,?,?,?)',app.id,at,b.kind,s.user.id,s.user.displayName,body,JSON.stringify(data)),store.audit(s.user,'application.event',app.id,[b.kind]),store.bump());
  await store.atomic(statements,{session:s,condition:'EXISTS(SELECT 1 FROM applications WHERE id=? AND version=?)',args:[app.id,app.version]});return {ok:true};
 }
 if(path==='/api/workflow/applications'){
  fields(b,['opportunityId','projectId','ownerId','stage','nextAction','dueDate','notes','expectedVersion']);if(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0||!stages.includes(b.stage))fail(400,'مرحلة أو إصدار غير صالح.');
  const o=await store.one("SELECT * FROM opportunities WHERE id=? AND review_status='approved'",text(b.opportunityId,100));if(!o)fail(400,'الفرصة ليست معتمدة.');if(!effectiveProjects(store.catalog,state.state).some(p=>p.id===b.projectId)&&!await store.one('SELECT id FROM applications WHERE opportunity_id=? AND project_id=?',o.id,b.projectId))fail(400,'المشروع غير نشط.');if(!state.members.some(m=>m.id===b.ownerId))fail(400,'اختر مسؤولًا نشطًا.');
  const id=(await digest(o.id+'\0'+b.projectId)).slice(0,32),old=await store.one('SELECT * FROM applications WHERE id=?',id);if(s.user.role!=='admin'&&(b.stage==='accepted'||old?.stage==='accepted'))fail(403,'تغيير القبول يتطلب المدير.');
  const next=text(b.nextAction),due=date(text(b.dueDate,10)),notes=text(b.notes,4000),at=now(),statements=[store.q('INSERT INTO applications VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,stage=excluded.stage,next_action=excluded.next_action,due_date=excluded.due_date,notes=excluded.notes,version=excluded.version,updated_at=excluded.updated_at',id,o.id,b.projectId,b.ownerId,b.stage,next,due,notes,b.expectedVersion+1,old?.created_at||at,at)];
  if(!old||old.stage!==b.stage)statements.push(store.q('INSERT INTO application_events(application_id,at,kind,actor_id,actor_name,text,data) VALUES(?,?,?,?,?,?,?)',id,at,'stage',s.user.id,s.user.displayName,old?'المرحلة: '+(stageNames[old.stage]||old.stage)+' ← '+stageNames[b.stage]:'بدء التقييم: '+stageNames[b.stage],JSON.stringify({from:old?.stage||null,to:b.stage})));
  statements.push(store.audit(s.user,'application.save',id,['stage','owner','nextAction'],b.expectedVersion+1),store.bump());
  await store.atomic(statements,{session:s,condition:'COALESCE((SELECT version FROM applications WHERE id=?),0)=?',args:[id,b.expectedVersion]});return {id,version:b.expectedVersion+1};
 }
 fail(404,'مسار غير موجود.');
}
