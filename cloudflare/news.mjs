// "آخر الإعلانات": a read-only, time-ordered view of everything the monitor has recorded, for every role.
// It shows candidates before review (clearly labelled) so the team sees news without following sites by hand.
import {now} from './security.mjs';
export async function newsFeed(store,params){
 const limit=Math.min(300,Math.max(1,Number(params.get('limit')||150)||150));
 const donors=Object.fromEntries(store.catalog.donors.map(d=>[d.id,d.name]));
 const rows=await store.all("SELECT o.id,o.title,o.source_url,o.review_status,o.duplicate_of,o.fields_json,o.created_at,o.opens_at,o.closes_at,o.donor_id,o.source_id,s.name source_name,s.kind source_kind,(SELECT MAX(e.created_at) FROM evidence e WHERE e.opportunity_id=o.id) last_evidence_at,(SELECT MAX(b.observed_at) FROM observations b WHERE b.source_id=o.source_id AND b.url=o.source_url) last_seen_at FROM opportunities o JOIN sources s ON s.id=o.source_id WHERE o.review_status!='rejected' ORDER BY o.created_at DESC LIMIT ?",limit);
 const items=rows.map(r=>{const f=JSON.parse(r.fields_json||'{}');return {id:r.id,title:r.title,url:r.source_url,status:r.review_status,duplicateOf:r.duplicate_of,hint:f.hint||null,topics:f.topics||[],createdAt:r.created_at,opensAt:r.opens_at,closesAt:r.closes_at,donorId:r.donor_id,donor:donors[r.donor_id]||null,sourceId:r.source_id,source:r.source_name,sourceKind:r.source_kind,lastEvidenceAt:r.last_evidence_at,lastSeenAt:r.last_seen_at};});
 const sources=(await store.all('SELECT s.id,s.name,s.url,s.kind,s.enabled,s.last_checked,s.failures,s.donor_id,p.robots_reviewed,p.terms_reviewed,p.reviewed_at FROM sources s LEFT JOIN source_policies p ON p.source_id=s.id ORDER BY s.name')).map(s=>({...s,donor:donors[s.donor_id]||null,active:!!(s.enabled&&s.robots_reviewed&&s.terms_reviewed&&s.kind!=='manual')}));
 const alerts=await store.all('SELECT id,kind,reference_id,message,created_at FROM alerts WHERE acknowledged_at IS NULL ORDER BY id DESC LIMIT 60');
 const runs=await store.all('SELECT id,started_at,ended_at,checked,succeeded,failed FROM scan_runs ORDER BY started_at DESC LIMIT 5');
 const scheduled=await store.all('SELECT slot,created_at,status,attempts,finished_at,detail FROM scheduled_runs ORDER BY CAST(slot AS INTEGER) DESC LIMIT 3');
 return {generatedAt:now(),items,sources,alerts,runs,scheduled,donors:store.catalog.donors.map(d=>({id:d.id,name:d.name}))};
}
