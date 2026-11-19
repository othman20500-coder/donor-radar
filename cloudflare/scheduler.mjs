import {now,fail} from './security.mjs';
import {fetchBounded,recordPage} from './monitor.mjs';
export async function runScan(store,session,env,max=3){
 if(env.APP_ENV!=='development'||env.APP_NAME!=='donor-radar-v13-dev')fail(503,'بيئة رصد غير معتمدة.');
 if(env.LIVE_SCAN_ENABLED!=='true')return {disabled:true,results:[]};
 const id=crypto.randomUUID(),lock=await store.q('UPDATE scan_lock SET owner=?,expires_at=? WHERE id=1 AND expires_at<?',id,Date.now()+240000,Date.now()).run();if(!lock.meta.changes)return {busy:true,results:[]};
 const results=[];
 try{
  await store.atomic([store.q('INSERT INTO scan_runs(id,started_at) VALUES(?,?)',id,now())],{session,admin:!!session});
  const sources=await store.all('SELECT s.* FROM sources s JOIN source_policies p ON p.source_id=s.id WHERE s.enabled=1 AND p.robots_reviewed=1 AND p.terms_reviewed=1 ORDER BY COALESCE(s.last_checked,\'\'),s.id LIMIT ?',max);
  for(const source of sources){
   const guard={session,admin:!!session,condition:'EXISTS(SELECT 1 FROM sources s JOIN source_policies p ON p.source_id=s.id WHERE s.id=? AND s.enabled=1 AND p.robots_reviewed=1 AND p.terms_reviewed=1 AND p.reviewed_at>?)',args:[source.id,new Date(Date.now()-90*86400000).toISOString()]};
   try{
    await store.atomic([],guard);const html=await fetchBounded(source.url,env);await store.atomic([],guard);const result=await recordPage(store,session,source,html,guard);
    // Only explicitly reviewed detail URLs are fetched, never arbitrary discovered links.
    const approved=JSON.parse(env.REVIEWED_SOURCE_URLS||'[]');const details=await store.all('SELECT * FROM opportunities WHERE source_id=? ORDER BY created_at DESC LIMIT 30',source.id);
    for(const o of details.filter(o=>approved.includes(o.source_url)&&o.source_url!==source.url).slice(0,2)){await store.atomic([],guard);const detail=await fetchBounded(o.source_url,env);await recordPage(store,session,{...source,url:o.source_url,opportunityId:o.id},detail,guard);}
    results.push(result);await store.q('UPDATE sources SET last_checked=?,failures=0 WHERE id=?',now(),source.id).run();
   }catch(e){results.push({sourceId:source.id,ok:false,error:String(e.message).slice(0,180)});await store.atomic([store.q('UPDATE sources SET last_checked=?,failures=failures+1 WHERE id=?',now(),source.id),store.q('INSERT INTO events(at,kind,reference_id,detail) VALUES(?,?,?,?)',now(),'scan_error',source.id,String(e.message).slice(0,180)),store.q('INSERT OR IGNORE INTO alerts(dedupe_key,kind,reference_id,message,created_at) VALUES(?,?,?,?,?)','failure:'+source.id+':'+now().slice(0,10),'scan_error',source.id,'تعذر فحص المصدر: '+source.name,now()),store.bump()]);}
  }
  await store.atomic([store.q('UPDATE scan_runs SET ended_at=?,checked=?,succeeded=?,failed=? WHERE id=?',now(),results.length,results.filter(x=>x.ok).length,results.filter(x=>!x.ok).length,id),store.audit(session?.user,'monitor.scan',id,[session?'manual':'scheduled']),store.bump()]);return {runId:id,results};
 }finally{await store.q('UPDATE scan_lock SET expires_at=0,owner=NULL WHERE id=1 AND owner=?',id).run();}
}
export async function scheduledScan(store,env,time){
 if(env.APP_ENV!=='development'||env.APP_NAME!=='donor-radar-v13-dev'||env.LIVE_SCAN_ENABLED!=='true')return {disabled:true};
 const slot=String(Math.floor(time/(6*3600000)));const r=await store.q('INSERT OR IGNORE INTO scheduled_runs(slot,created_at) VALUES(?,?)',slot,now()).run();if(!r.meta.changes)return {duplicate:true};return runScan(store,null,env,3);
}
