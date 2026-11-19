import {fields} from '../server/validation.js';
import {fail,now,digest} from './security.mjs';
import {sourceUrl,readableText} from './vendor/pure.cjs';
import {extractCandidates,extractDates} from './vendor/extraction.cjs';
import {titleKey,indexLike} from './vendor/discovery.cjs';
import {parseFeed} from './feed.mjs';
const MAX_BYTES=512000;
function url(value){try{return sourceUrl(value);}catch{fail(400,'رابط مصدر غير مسموح.');}}
function day(v,label){if(v===undefined||v===null||v==='')return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)fail(400,label+' غير صالح.');return v;}
/** Operator-controlled allow list (REVIEWED_SOURCE_URLS). An entry ending in "/*" allows that path prefix only. */
export function allowedList(env){let list;try{list=JSON.parse(env.REVIEWED_SOURCE_URLS||'[]');}catch{fail(503,'قائمة المصادر غير صالحة.');}if(!Array.isArray(list)||list.some(x=>typeof x!=='string'))fail(503,'قائمة المصادر غير صالحة.');return list;}
export function isAllowed(list,target){return list.some(a=>a===target||(a.endsWith('/*')&&target.startsWith(a.slice(0,-1))&&!target.slice(a.length-1).includes('..')));}
const TYPES={html:/^text\/(html|plain)(?:\s*;|$)/i,feed:/^(?:application|text)\/(?:rss\+xml|atom\+xml|xml)(?:\s*;|$)/i};
export async function fetchBounded(target,env,kind='html'){
 if(!isAllowed(allowedList(env),target))fail(403,'المصدر غير مدرج ضمن قائمة التشغيل المعتمدة.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);let reader;
 try{const r=await fetch(target,{redirect:'manual',signal:controller.signal,headers:{'User-Agent':'DonorRadarMonitor/13 (limited development review)','Accept':kind==='feed'?'application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.8':'text/html,text/plain;q=0.9'}});if(r.status!==200)throw Error('HTTP '+r.status+'؛ لا تتبع للتحويلات');if(!(TYPES[kind]||TYPES.html).test(r.headers.get('content-type')||''))throw Error('نوع محتوى غير مسموح');const length=r.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))throw Error('حجم غير صالح');reader=r.body.getReader();const parts=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw Error('تجاوز حد الحجم');parts.push(value);}return Buffer.concat(parts).toString('utf8');}finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});}
}
const alert=(store,key,kind,ref,message,at)=>store.q('INSERT OR IGNORE INTO alerts(dedupe_key,kind,reference_id,message,created_at) VALUES(?,?,?,?,?)',key,kind,ref,message,at);
export async function recordPage(store,s,source,body,guard){
 const feed=source.kind==='feed'&&!source.opportunityId,hash=await digest(body),text=readableText(body);if(text.length<40)throw Error('المحتوى قصير ويحتاج مراجعة');
 const previous=await store.one('SELECT content_hash FROM observations WHERE source_id=? AND url=? ORDER BY id DESC LIMIT 1',source.id,source.url),changed=!!previous&&previous.content_hash!==hash,at=now();
 const stmts=[store.q('INSERT INTO observations(source_id,observed_at,content_hash,summary,changed,url) VALUES(?,?,?,?,?,?)',source.id,at,hash,text.slice(0,500),Number(changed),source.url)];
 let candidates,pageDates=null,evidenceId=null;
 if(feed){candidates=parseFeed(body,source.url);}
 else{const result=extractCandidates(body,source.url);candidates=source.opportunityId?[]:result.links;pageDates=result.dates;evidenceId=await digest(source.id+'\0'+source.url+'\0'+hash);
  stmts.push(store.q('INSERT OR IGNORE INTO evidence(id,source_id,url,content_hash,excerpt,opens_at,closes_at,conflicts,created_at) VALUES(?,?,?,?,?,?,?,?,?)',evidenceId,source.id,source.url,hash,JSON.stringify(pageDates.evidence),pageDates.opensAt,pageDates.closesAt,Number(pageDates.warnings.length>0),at));
  if(source.opportunityId)stmts.push(store.q('UPDATE evidence SET opportunity_id=? WHERE id=?',source.opportunityId,evidenceId));}
 const batchKeys=new Map();let duplicates=0;
 for(const c of candidates){
  const id=(await digest(source.id+'\0'+c.sourceUrl)).slice(0,32),key=titleKey(c.title),known=await store.one('SELECT id FROM opportunities WHERE id=?',id);
  let dup=null;if(!known){dup=batchKeys.get(key)||(await store.one("SELECT id FROM opportunities WHERE source_url=? AND id!=? AND duplicate_of IS NULL AND review_status!='rejected' ORDER BY created_at LIMIT 1",c.sourceUrl,id))?.id||(await store.one("SELECT id FROM opportunities WHERE title_key=? AND id!=? AND duplicate_of IS NULL AND review_status!='rejected' ORDER BY created_at LIMIT 1",key,id))?.id||null;batchKeys.set(key,dup||id);}
  const idx=indexLike(c.title,c.sourceUrl,source.url);
  if(dup)duplicates++;
  stmts.push(store.q('INSERT OR IGNORE INTO opportunities(id,source_id,title,source_url,created_at,donor_id,title_key,duplicate_of,fields_json) VALUES(?,?,?,?,?,?,?,?,?)',id,source.id,c.title,c.sourceUrl,at,source.donor_id||null,key,dup,idx?'{"hint":"index"}':'{}'));
  if(!known)stmts.push(alert(store,'new:'+id,'candidate',id,(dup?'مرشح مكرر محتمل لإعلان قائم: ':idx?'صفحة فهرس أو خدمة محتملة (ليست إعلانًا غالبًا): ':'إعلان جديد بانتظار المراجعة: ')+c.title,at));
  if(feed){const dates=extractDates(c.summary||''),found=dates.opensAt||dates.closesAt||dates.warnings.length;
   if(found){const eid=await digest(source.id+'\0'+c.sourceUrl+'\0'+await digest(c.raw));stmts.push(store.q('INSERT OR IGNORE INTO evidence(id,source_id,url,content_hash,excerpt,opens_at,closes_at,conflicts,created_at,opportunity_id) VALUES(?,?,?,?,?,?,?,?,?,?)',eid,source.id,c.sourceUrl,await digest(c.raw),JSON.stringify(dates.evidence),dates.opensAt,dates.closesAt,Number(dates.warnings.length>0),at,id));
    if(known)stmts.push(alert(store,'item:'+eid,'source_changed',id,'تغيّر بيان إعلان مرصود ويحتاج مراجعة: '+c.title,at));}}
 }
 if(changed&&!feed)stmts.push(alert(store,source.id+':'+source.url+':'+hash,'source_changed',source.opportunityId||source.id,'تغير محتوى المصدر ويحتاج مراجعة',at));
 stmts.push(store.bump());await store.atomic(stmts,guard||{session:s,admin:!!s});
 return {sourceId:source.id,ok:true,hash,changed,firstSeen:!previous,discovery:{candidates:candidates.length,duplicates,requiresApproval:true}};
}
export async function monitorRoute(store,s,p,method,b,env){
 if(method==='GET'&&p==='/api/monitor/dashboard')return {data:{runtime:{enabled:env.LIVE_SCAN_ENABLED==='true',schedule:'كل ساعة (حتى 6 مصادر بالجولة، تناوب حسب آخر فحص) مع إعادة محاولة بعد 30 دقيقة عند الفشل',allowedUrls:allowedList(env).length},sources:await store.all('SELECT s.*,p.robots_reviewed,p.terms_reviewed,p.reviewed_at FROM sources s LEFT JOIN source_policies p ON p.source_id=s.id ORDER BY s.created_at DESC LIMIT 200'),opportunities:await store.all('SELECT * FROM opportunities ORDER BY created_at DESC LIMIT 100'),evidence:await store.all('SELECT * FROM evidence ORDER BY created_at DESC LIMIT 100'),runs:await store.all('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 20'),scheduled:await store.all('SELECT * FROM scheduled_runs ORDER BY CAST(slot AS INTEGER) DESC LIMIT 12'),alerts:await store.all('SELECT * FROM alerts WHERE acknowledged_at IS NULL ORDER BY id DESC LIMIT 100')}};
 if(method!=='POST')fail(404,'المسار غير موجود.');
 if(p.startsWith('/api/monitor/sources/')){fields(b,['enabled']);if(typeof b.enabled!=='boolean')fail(400,'حالة غير صالحة.');const id=p.split('/').pop();await store.atomic([store.q('UPDATE sources SET enabled=? WHERE id=?',Number(b.enabled),id),store.audit(s.user,'monitor.source.toggle',id,[String(b.enabled)]),store.bump()],{session:s,admin:true,condition:'EXISTS(SELECT 1 FROM sources WHERE id=?)',args:[id]});return {data:{ok:true}};}
 if(p==='/api/monitor/sources'){fields(b,['name','url','donorId','kind']);if(b.donorId&&!store.catalog.donors.some(d=>d.id===b.donorId))fail(400,'جهة غير موجودة.');if(typeof b.name!=='string'||b.name.trim().length<2||b.name.length>160)fail(400,'اسم غير صالح.');const kind=b.kind??'html';if(!['html','feed','manual'].includes(kind))fail(400,'نوع مصدر غير صالح.');const target=url(b.url),id=crypto.randomUUID();try{await store.atomic([store.q('INSERT INTO sources(id,name,url,created_at,donor_id,kind) VALUES(?,?,?,?,?,?)',id,b.name.trim(),target,now(),b.donorId||null,kind),store.audit(s.user,'monitor.source.create',id,[kind])],{session:s,admin:true});}catch(e){if(String(e).includes('UNIQUE'))fail(409,'المصدر مسجل.');throw e;}return {status:201,data:{id}};}
 if(p.startsWith('/api/monitor/policies/')){fields(b,['robotsReviewed','termsReviewed','robotsUrl','termsUrl','notes']);const id=p.slice('/api/monitor/policies/'.length),source=await store.one('SELECT * FROM sources WHERE id=?',id);if(!source)fail(404,'مصدر غير موجود.');if(typeof b.robotsReviewed!=='boolean'||typeof b.termsReviewed!=='boolean'||typeof b.notes!=='string'||!b.notes.trim()||b.notes.length>500)fail(400,'وثق نتيجة المراجعة.');const robots=url(b.robotsUrl),terms=url(b.termsUrl);if(new URL(robots).origin!==new URL(source.url).origin||new URL(terms).origin!==new URL(source.url).origin)fail(400,'يجب أن تكون السياسة من نطاق المصدر نفسه.');if(new URL(robots).pathname!=='/robots.txt')fail(400,'رابط robots يجب أن يكون /robots.txt.');await store.atomic([store.q('INSERT INTO source_policies VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET robots_reviewed=excluded.robots_reviewed,terms_reviewed=excluded.terms_reviewed,reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by,robots_url=excluded.robots_url,terms_url=excluded.terms_url,notes=excluded.notes',id,Number(b.robotsReviewed),Number(b.termsReviewed),now(),s.user.id,robots,terms,b.notes),store.audit(s.user,'monitor.policy.review',id)],{session:s,admin:true});return {data:{ok:true}};}
 // A person read the announcement on the official site and records what it says. No network call is made.
 if(p==='/api/monitor/manual'){
  fields(b,['sourceId','title','url','quote','opensAt','closesAt']);const source=await store.one('SELECT * FROM sources WHERE id=?',b.sourceId);if(!source)fail(404,'مصدر غير موجود.');
  if(typeof b.title!=='string'||b.title.trim().length<5||b.title.length>250)fail(400,'عنوان غير صالح.');if(typeof b.quote!=='string'||b.quote.trim().length<15||b.quote.length>500)fail(400,'اكتب ما ورد في الإعلان بين 15 و500 حرف.');
  const target=url(b.url);if(new URL(target).origin!==new URL(source.url).origin)fail(400,'رابط الإعلان يجب أن يكون من نطاق المصدر.');
  const opens=day(b.opensAt,'تاريخ الفتح'),closes=day(b.closesAt,'تاريخ الإغلاق');if(opens&&closes&&opens>closes)fail(400,'تاريخ الفتح بعد الإغلاق.');
  const id=(await digest(source.id+'\0'+target)).slice(0,32),at=now(),eid=await digest('manual\0'+id+'\0'+b.quote.trim()+'\0'+opens+'\0'+closes),key=titleKey(b.title);
  if(await store.one('SELECT id FROM opportunities WHERE id=?',id))fail(409,'الإعلان مسجل مسبقًا.');
  const dup=(await store.one("SELECT id FROM opportunities WHERE source_url=? AND duplicate_of IS NULL AND review_status!='rejected' ORDER BY created_at LIMIT 1",target))?.id||(await store.one("SELECT id FROM opportunities WHERE title_key=? AND duplicate_of IS NULL AND review_status!='rejected' ORDER BY created_at LIMIT 1",key))?.id||null;
  await store.atomic([store.q('INSERT INTO opportunities(id,source_id,title,source_url,created_at,donor_id,title_key,duplicate_of) VALUES(?,?,?,?,?,?,?,?)',id,source.id,b.title.trim(),target,at,source.donor_id||null,key,dup),store.q('INSERT INTO evidence(id,source_id,url,content_hash,excerpt,opens_at,closes_at,conflicts,created_at,opportunity_id,origin) VALUES(?,?,?,?,?,?,?,?,?,?,?)',eid,source.id,target,eid,JSON.stringify([{field:'manual',quote:b.quote.trim(),by:s.user.displayName}]),opens,closes,0,at,id,'manual'),alert(store,'new:'+id,'candidate',id,(dup?'مرشح مكرر محتمل لإعلان قائم: ':'إعلان مُدخل يدويًا بانتظار المراجعة: ')+b.title.trim(),at),store.audit(s.user,'monitor.manual',id,['title','quote']),store.bump()],{session:s,admin:true});
  return {status:201,data:{id,evidenceId:eid,duplicateOf:dup}};
 }
 if(p.startsWith('/api/monitor/evidence/')){fields(b,['decision']);if(!['accepted','rejected'].includes(b.decision))fail(400,'قرار غير صالح.');const id=p.slice('/api/monitor/evidence/'.length),row=await store.one('SELECT * FROM evidence WHERE id=?',id);if(!row)fail(404,'الدليل غير موجود.');if(b.decision==='accepted'&&(row.conflicts||(!row.opens_at&&!row.closes_at)))fail(400,'لا يمكن اعتماد دليل متعارض أو بلا تاريخ.');await store.atomic([store.q('UPDATE evidence SET review_status=?,reviewed_by=? WHERE id=?',b.decision,s.user.id,id),store.audit(s.user,'monitor.evidence.review',id,[b.decision]),store.bump()],{session:s,admin:true,condition:"EXISTS(SELECT 1 FROM evidence WHERE id=? AND review_status='pending')",args:[id]});return {data:{id,decision:b.decision}};}
 if(p==='/api/monitor/alerts')return {data:await store.all('SELECT * FROM alerts ORDER BY id DESC LIMIT 100')};
 fail(404,'المسار غير موجود.');
}
