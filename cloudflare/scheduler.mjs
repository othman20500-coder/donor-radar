import {now,fail} from './security.mjs';
import {fetchBounded,recordPage,allowedList,isAllowed} from './monitor.mjs';
const DAY=86400000,POLICY_MAX_AGE=90*DAY,SLOT_MS=6*3600000,MAX_ATTEMPTS=3,RUNNING_STALE=10*60000;
/** A source that keeps failing is retried with exponential backoff (2h, 4h, ... capped at 48h) instead of every cycle. */
export function backoffDue(source,at=Date.now()){
 const failures=Number(source.failures||0);if(failures<3||!source.last_checked)return true;
 const wait=Math.min(48,2**(failures-2))*3600000;return Date.parse(source.last_checked)+wait<=at;
}
function gate(env){if(env.APP_ENV!=='development'||env.APP_NAME!=='donor-radar-v13-dev')fail(503,'بيئة رصد غير معتمدة.');}
export async function runScan(store,session,env,max=3){
 gate(env);
 if(env.LIVE_SCAN_ENABLED!=='true')return {disabled:true,results:[]};
 const id=crypto.randomUUID(),lock=await store.q('UPDATE scan_lock SET owner=?,expires_at=? WHERE id=1 AND expires_at<?',id,Date.now()+240000,Date.now()).run();if(!lock.meta.changes)return {busy:true,results:[]};
 const results=[];
 try{
  await store.atomic([store.q('INSERT INTO scan_runs(id,started_at) VALUES(?,?)',id,now())],{session,admin:!!session});
  const cutoff=new Date(Date.now()-POLICY_MAX_AGE).toISOString();
  const eligible=await store.all("SELECT s.*,p.reviewed_at FROM sources s JOIN source_policies p ON p.source_id=s.id WHERE s.enabled=1 AND s.kind!='manual' AND p.robots_reviewed=1 AND p.terms_reviewed=1 AND p.reviewed_at>? ORDER BY COALESCE(s.last_checked,''),s.id",cutoff);
  const due=eligible.filter(s=>backoffDue(s)),sources=due.slice(0,max);
  // A reviewed source whose review is older than 90 days is reported instead of failing silently or being scanned.
  const stale=await store.all("SELECT s.id,s.name FROM sources s JOIN source_policies p ON p.source_id=s.id WHERE s.enabled=1 AND s.kind!='manual' AND p.robots_reviewed=1 AND p.terms_reviewed=1 AND p.reviewed_at<=?",cutoff);
  if(stale.length)await store.atomic(stale.map(s=>store.q('INSERT OR IGNORE INTO alerts(dedupe_key,kind,reference_id,message,created_at) VALUES(?,?,?,?,?)','policy_stale:'+s.id+':'+now().slice(0,7),'policy_stale',s.id,'انتهت صلاحية مراجعة سياسات المصدر ولن يُفحص حتى تُجدد: '+s.name,now())).concat(store.bump()),{});
  for(const source of sources){
   const guard={session,admin:!!session,condition:'EXISTS(SELECT 1 FROM sources s JOIN source_policies p ON p.source_id=s.id WHERE s.id=? AND s.enabled=1 AND p.robots_reviewed=1 AND p.terms_reviewed=1 AND p.reviewed_at>?)',args:[source.id,cutoff]};
   try{
    await store.atomic([],guard);const body=await fetchBounded(source.url,env,source.kind);await store.atomic([],guard);const result=await recordPage(store,session,source,body,guard);
    // Detail pages are read only when an explicit allow rule covers them, unseen ones first; a failed detail never fails the source.
    const rules=allowedList(env),details=(await store.all("SELECT o.* FROM opportunities o WHERE o.source_id=? AND o.review_status!='rejected' AND o.duplicate_of IS NULL ORDER BY (SELECT MAX(observed_at) FROM observations b WHERE b.source_id=o.source_id AND b.url=o.source_url) IS NOT NULL,(SELECT MAX(observed_at) FROM observations b WHERE b.source_id=o.source_id AND b.url=o.source_url),o.created_at DESC LIMIT 30",source.id)).filter(o=>o.source_url!==source.url&&isAllowed(rules,o.source_url)&&!/"hint":"index"/.test(o.fields_json||'')).slice(0,2);
    for(const o of details){try{await store.atomic([],guard);const detail=await fetchBounded(o.source_url,env,'html');await recordPage(store,session,{...source,kind:'html',url:o.source_url,opportunityId:o.id},detail,guard);}catch(e){await store.atomic([store.q('INSERT INTO events(at,kind,reference_id,detail) VALUES(?,?,?,?)',now(),'detail_error',o.id,String(e.message).slice(0,180))],{});}}
    results.push(result);await store.q('UPDATE sources SET last_checked=?,failures=0 WHERE id=?',now(),source.id).run();
   }catch(e){results.push({sourceId:source.id,ok:false,error:String(e.message).slice(0,180)});const failures=Number(source.failures||0)+1;await store.atomic([store.q('UPDATE sources SET last_checked=?,failures=failures+1 WHERE id=?',now(),source.id),store.q('INSERT INTO events(at,kind,reference_id,detail) VALUES(?,?,?,?)',now(),'scan_error',source.id,String(e.message).slice(0,180)),store.q('INSERT OR IGNORE INTO alerts(dedupe_key,kind,reference_id,message,created_at) VALUES(?,?,?,?,?)','failure:'+source.id+':'+now().slice(0,10),'scan_error',source.id,'تعذر فحص المصدر: '+source.name+(failures>=3?' (فشل متكرر؛ يُعاد بفواصل متزايدة)':''),now()),store.bump()],{});}
  }
  await store.atomic([store.q('UPDATE scan_runs SET ended_at=?,checked=?,succeeded=?,failed=? WHERE id=?',now(),results.length,results.filter(x=>x.ok).length,results.filter(x=>!x.ok).length,id),store.audit(session?.user,'monitor.scan',id,[session?'manual':'scheduled']),store.bump()],{});
  return {runId:id,results,skippedBackoff:eligible.length-due.length};
 }finally{await store.q('UPDATE scan_lock SET expires_at=0,owner=NULL WHERE id=1 AND owner=?',id).run();await prune(store).catch(e=>console.error('Prune failed:',e.message));}
}
/** Keeps history bounded: recent observations per page, old runs and acknowledged alerts. */
export async function prune(store){
 const old=new Date(Date.now()-180*DAY).toISOString(),ackOld=new Date(Date.now()-90*DAY).toISOString();
 await store.db.batch([
  store.q('DELETE FROM observations WHERE id IN (SELECT id FROM (SELECT id,observed_at,ROW_NUMBER() OVER (PARTITION BY source_id,url ORDER BY id DESC) n FROM observations) WHERE n>20 AND observed_at<?)',old),
  store.q('DELETE FROM scan_runs WHERE id IN (SELECT id FROM scan_runs ORDER BY started_at DESC LIMIT -1 OFFSET 300)'),
  store.q('DELETE FROM scheduled_runs WHERE slot IN (SELECT slot FROM scheduled_runs ORDER BY CAST(slot AS INTEGER) DESC LIMIT -1 OFFSET 400)'),
  store.q('DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id DESC LIMIT -1 OFFSET 1000)'),
  store.q('DELETE FROM alerts WHERE acknowledged_at IS NOT NULL AND acknowledged_at<?',ackOld)]);
}
/**
 * One scheduled window = one successful run. The slot is claimed before scanning but is marked
 * failed/busy when the scan could not run, so a retry trigger in the same window can finish it.
 */
export async function scheduledScan(store,env,time){
 if(env.APP_ENV!=='development'||env.APP_NAME!=='donor-radar-v13-dev'||env.LIVE_SCAN_ENABLED!=='true')return {disabled:true};
 const slot=String(Math.floor(time/SLOT_MS)),at=now();
 const claim=await store.q("INSERT OR IGNORE INTO scheduled_runs(slot,created_at,status,attempts) VALUES(?,?,'running',1)",slot,at).run();
 if(!claim.meta.changes){
  const reclaim=await store.q("UPDATE scheduled_runs SET status='running',attempts=attempts+1,created_at=? WHERE slot=? AND attempts<? AND (status IN ('failed','busy') OR (status='running' AND created_at<?))",at,slot,MAX_ATTEMPTS,new Date(Date.now()-RUNNING_STALE).toISOString()).run();
  if(!reclaim.meta.changes)return {duplicate:true};
 }
 let status='done',detail='',result;
 try{
  result=await runScan(store,null,env,3);
  if(result.busy){status='busy';detail='فحص آخر قيد التنفيذ';}
  else if(result.results.length&&result.results.every(r=>!r.ok)){status='failed';detail=result.results.map(r=>r.error).filter(Boolean).join('؛ ').slice(0,300);}
  else if(!result.results.length){detail='لا مصادر مؤهلة للفحص في هذه النافذة';}
  return result;
 }catch(e){status='failed';detail=String(e.message||e).slice(0,300);console.error('Scheduled scan failed:',detail);return {failed:true,error:detail};}
 finally{await store.q('UPDATE scheduled_runs SET status=?,finished_at=?,detail=? WHERE slot=?',status,now(),detail,slot).run().catch(e=>console.error('Slot update failed:',e.message));}
}
