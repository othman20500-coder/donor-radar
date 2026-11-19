// Review-round tests. Network is always a local fake; nothing here contacts a real site or the cloud environment.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';

let mf,db,store;
const origin='https://localhost',password='Development-only-Password42!',at=()=>new Date().toISOString();
const ENV=extra=>({APP_ENV:'development',APP_NAME:'donor-radar-v13-dev',LIVE_SCAN_ENABLED:'true',REVIEWED_SOURCE_URLS:JSON.stringify(['https://feed.example.org/rss.xml','https://feed.example.org/other.xml','https://feed.example.org/news/*','https://html.example.org/index']),...extra});
async function seed(id,role){const {hashPassword}=await import('../security.mjs');await db.prepare('INSERT INTO users(id,username,display_name,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,id,id,role,await hashPassword(password),at(),at()).run();}
async function request(path,{method='GET',body,session}={}){const headers={};if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json';}if(session){headers.Cookie=session.cookie;headers['X-CSRF-Token']=session.csrfToken;}return (await mf.getWorker('radar')).fetch(origin+path,{method,headers,redirect:'manual',body:body===undefined?undefined:JSON.stringify(body)});}
async function login(username){const r=await request('/api/auth/login',{method:'POST',body:{username,password}});assert.equal(r.status,200,await r.clone().text());return {...await r.json(),cookie:r.headers.get('set-cookie').split(';')[0]};}
async function addSource(id,url,kind='html',reviewedAt=at()){await db.prepare('INSERT INTO sources(id,name,url,created_at,donor_id,kind) VALUES(?,?,?,?,?,?)').bind(id,id,url,at(),'associations-support-fund',kind).run();if(reviewedAt)await db.prepare('INSERT INTO source_policies(source_id,robots_reviewed,terms_reviewed,reviewed_at) VALUES(?,1,1,?)').bind(id,reviewedAt).run();}
async function withFetch(fn,run){const original=globalThis.fetch;globalThis.fetch=fn;try{return await run();}finally{globalThis.fetch=original;}}
const rss=items=>'<?xml version="1.0"?><rss version="2.0"><channel><title>إعلانات رسمية للتجربة</title>'+items.map(i=>`<item><title>${i.title}</title><link>${i.link}</link><description>${i.desc||''}</description></item>`).join('')+'</channel></rss>';
const xml=body=>new Response(body,{headers:{'content-type':'application/rss+xml; charset=utf-8'}});
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({name:'radar',modules:true,scriptPath:new URL('../dist/worker.js',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),compatibilityDate:'2026-11-19',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'review',RESTORE:'review-restore',RESTORE2:'review-restore2'},bindings:{APP_ENV:'development',PUBLIC_URL:origin,APP_NAME:'donor-radar-v13-dev',LIVE_SCAN_ENABLED:'false'},assets:{directory:new URL('../dist/assets',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),binding:'ASSETS',run_worker_first:true,assetConfig:{html_handling:'none'}}}));
 db=await mf.getD1Database('DB');for(const f of ['0001','0002','0003'])await db.exec(await readFile(new URL(`../migrations/${f}.sql`,import.meta.url),'utf8'));
 await seed('admin','admin');await seed('editor','editor');await seed('viewer','viewer');
 const {Store}=await import('../store.mjs');store=new Store(db,JSON.parse(await readFile(new URL('../../private/catalog.json',import.meta.url),'utf8')));
});
after(async()=>{await mf?.dispose();});

test('match: structured criteria never claim eligibility and block on hard mismatches',async()=>{
 const {matchProject,validateTerms,monthsFrom,audiencesFrom,byFit}=await import('../match.mjs');
 const o={closes_at:'2027-06-01',opens_at:null},p={id:'p',name:'نادي شبابي',tags:['youth'],amount:300000,duration:'12 شهرًا',audience:'الشباب من 15 إلى 25'};
 const ok=validateTerms({entityTypes:['association'],region:{scope:'national',names:[]},audiences:['youth'],amount:{min:100000,max:500000},durationMonths:{min:6,max:24},applicationStatus:'open',readiness:['license']});
 const good=matchProject(o,p,{terms:ok,topics:['youth'],docs:{license:'ok'},today:'2026-11-19'});
 assert.equal(good.verdict,'candidate_ok');assert.equal(good.eligible,null);assert.equal(good.needsHumanReview,true);
 const tooBig=matchProject(o,{...p,amount:900000},{terms:ok,topics:['youth'],docs:{license:'ok'},today:'2026-11-19'});assert.equal(tooBig.verdict,'blocked');assert.match(tooBig.blockers[0],/المبلغ/);
 const wrongRegion=matchProject(o,p,{terms:validateTerms({region:{scope:'regional',names:['جدة']}}),topics:['youth'],today:'2026-11-19'});assert.equal(wrongRegion.verdict,'blocked');
 const closed=matchProject({closes_at:'2026-01-01'},p,{terms:ok,topics:['youth'],docs:{license:'ok'},today:'2026-11-19'});assert.equal(closed.verdict,'blocked');assert.equal(closed.closed,true);
 const missingDoc=matchProject(o,p,{terms:ok,topics:['youth'],docs:{license:'missing'},today:'2026-11-19'});assert.equal(missingDoc.verdict,'blocked');
 const unknown=matchProject(o,p,{terms:validateTerms(undefined),topics:[],today:'2026-11-19'});assert.equal(unknown.verdict,'needs_review');assert.ok(unknown.gaps.length>=4);
 assert.deepEqual([tooBig,good,unknown].sort(byFit).map(x=>x.verdict),['candidate_ok','needs_review','blocked']);
 assert.equal(monthsFrom('٦ أشهر'),6);assert.equal(monthsFrom('سنتين'),24);assert.equal(monthsFrom('غير محددة'),null);assert.deepEqual(audiencesFrom('أطفال وشباب'),['youth','children']);
 for(const bad of [{amount:{min:5,max:1}},{entityTypes:['wizard']},{region:{scope:'mars'}},{unknown:1},{audiences:['youth','youth']},{evidence:{amount:'x'.repeat(401)}}])assert.throws(()=>validateTerms(bad),RangeError);
});

test('allow list accepts exact urls and explicit path prefixes only',async()=>{
 const {isAllowed}=await import('../monitor.mjs'),list=['https://a.example/x','https://a.example/news/*'];
 assert.ok(isAllowed(list,'https://a.example/x'));assert.ok(isAllowed(list,'https://a.example/news/1'));
 assert.ok(!isAllowed(list,'https://a.example/y'));assert.ok(!isAllowed(list,'https://a.example/newsletter/1'));assert.ok(!isAllowed(list,'https://b.example/news/1'));assert.ok(!isAllowed(list,'https://a.example/news/../admin'));
});

test('scheduler: a failed or busy window is retried in the same slot and finally completes once',async()=>{
 const {scheduledScan}=await import('../scheduler.mjs');await addSource('sched','https://feed.example.org/rss.xml','feed');const t=Math.floor(1900000000000/21600000)*21600000+1000;let ok=false,calls=0;
 const f=async()=>{calls++;if(!ok)throw Error('network down');return xml(rss([{title:'منحة تجريبية للشباب',link:'https://feed.example.org/news/youth-1',desc:'آخر موعد للتقديم: 2027-04-01'}]));};
 await withFetch(f,async()=>{
  const first=await scheduledScan(store,ENV(),t);assert.equal(first.results[0].ok,false);assert.equal((await store.one('SELECT status,attempts FROM scheduled_runs WHERE slot=?',String(Math.floor(t/21600000)))).status,'failed');
  await store.q("UPDATE scan_lock SET owner='x',expires_at=?",Date.now()+60000).run();await db.prepare('UPDATE sources SET last_checked=NULL,failures=0').run();
  const busy=await scheduledScan(store,ENV(),t+1800000);assert.equal(busy.busy,true);assert.equal((await store.one('SELECT status FROM scheduled_runs')).status,'busy');
  await store.q('UPDATE scan_lock SET owner=NULL,expires_at=0').run();ok=true;
  const done=await scheduledScan(store,ENV(),t+1800000);assert.equal(done.results[0].ok,true);const row=await store.one('SELECT status,attempts,finished_at FROM scheduled_runs');assert.equal(row.status,'done');assert.equal(row.attempts,3);assert.ok(row.finished_at);
  const before=calls;assert.equal((await scheduledScan(store,ENV(),t+3600000)).duplicate,true);assert.equal(calls,before);
 });
 await db.prepare("UPDATE sources SET enabled=0 WHERE id='sched'").run();
});

test('scheduler: repeated failures back off and stale policy reviews are reported, not scanned',async()=>{
 const {backoffDue,runScan}=await import('../scheduler.mjs'),now=Date.now();
 assert.equal(backoffDue({failures:2,last_checked:new Date(now).toISOString()},now),true);
 assert.equal(backoffDue({failures:3,last_checked:new Date(now-3600000).toISOString()},now),false);assert.equal(backoffDue({failures:3,last_checked:new Date(now-3*3600000).toISOString()},now),true);
 assert.equal(backoffDue({failures:20,last_checked:new Date(now-47*3600000).toISOString()},now),false);assert.equal(backoffDue({failures:20,last_checked:new Date(now-49*3600000).toISOString()},now),true);
 await addSource('stale','https://html.example.org/index','html',new Date(now-100*86400000).toISOString());let calls=0;
 await withFetch(async()=>{calls++;return new Response('x');},async()=>{const r=await runScan(store,null,ENV(),3);assert.equal(calls,0);assert.equal(r.results.length,0);});
 assert.ok((await store.one("SELECT count(*) n FROM alerts WHERE kind='policy_stale'")).n>=1);await db.prepare("UPDATE sources SET enabled=0 WHERE id='stale'").run();
});

test('feed source: items become pending candidates with dated evidence, duplicates are flagged, changes alert',async()=>{
 const {runScan}=await import('../scheduler.mjs');await addSource('feed-a','https://feed.example.org/other.xml','feed');
 const feed=rss([{title:'منحة المشاريع الشبابية 2027',link:'https://feed.example.org/news/1?utm_source=x',desc:'آخر موعد للتقديم: 2027-03-01'},{title:'أخبار الجمعية العامة',link:'https://feed.example.org/news/2'},{title:'تمويل المشاريع الشبابية',link:'https://elsewhere.example.com/x'}]);
 await db.prepare("UPDATE sources SET enabled=0").run();await db.prepare("UPDATE sources SET enabled=1 WHERE id='feed-a'").run();
 await withFetch(async()=>xml(feed),async()=>{const r=await runScan(store,null,ENV(),3);assert.equal(r.results[0].ok,true);assert.equal(r.results[0].discovery.candidates,1);});
 const o=await store.one("SELECT * FROM opportunities WHERE source_id='feed-a'");assert.equal(o.source_url,'https://feed.example.org/news/1');assert.equal(o.review_status,'pending');assert.ok(o.title_key);
 const ev=await store.one('SELECT * FROM evidence WHERE opportunity_id=?',o.id);assert.equal(ev.closes_at,'2027-03-01');assert.equal(ev.review_status,'pending');assert.equal(ev.origin,'automatic');
 // same announcement title republished under another URL on another source is flagged as a probable duplicate
 await db.prepare("UPDATE sources SET enabled=0").run();await addSource('feed-b','https://feed.example.org/news/b.xml','feed');await db.prepare("UPDATE sources SET enabled=1 WHERE id='feed-b'").run();
 await withFetch(async()=>xml(rss([{title:'برنامج منحة المشاريع الشبابية ٢٠٢٧',link:'https://feed.example.org/news/9'}])),async()=>{await runScan(store,null,ENV(),3);});
 const d=await store.one("SELECT * FROM opportunities WHERE source_id='feed-b'");assert.equal(d.duplicate_of,o.id);assert.match((await store.one("SELECT message FROM alerts WHERE reference_id=?",d.id)).message,/مكرر/);
 // the announcement text changes its deadline: a new pending evidence and an alert, the reviewed date stays
 await db.prepare("UPDATE sources SET enabled=0").run();await db.prepare("UPDATE sources SET enabled=1,last_checked=NULL WHERE id='feed-a'").run();
 await withFetch(async()=>xml(rss([{title:'منحة المشاريع الشبابية 2027',link:'https://feed.example.org/news/1',desc:'آخر موعد للتقديم: 2027-05-01'}])),async()=>{await runScan(store,null,ENV(),3);});
 assert.equal((await store.all('SELECT * FROM evidence WHERE opportunity_id=?',o.id)).length,2);assert.ok((await store.one("SELECT count(*) n FROM alerts WHERE kind='source_changed' AND reference_id=?",o.id)).n>=1);
 await db.prepare("UPDATE sources SET enabled=0").run();
});

test('review: evidence or a written reason is required; rejection needs no classification; duplicates merge safely',async()=>{
 const admin=await login('admin'),o=await store.one("SELECT * FROM opportunities WHERE source_id='feed-a'"),d=await store.one("SELECT * FROM opportunities WHERE source_id='feed-b'");
 const base={decision:'approved',expectedVersion:0,donorId:'associations-support-fund',topics:['youth']};
 let r=await request('/api/workflow/opportunities/'+o.id,{method:'POST',session:admin,body:base});assert.equal(r.status,400);assert.equal((await r.json()).code,'EVIDENCE_REQUIRED');
 const ev=await store.one("SELECT * FROM evidence WHERE opportunity_id=? AND closes_at='2027-03-01'",o.id);
 assert.equal((await request('/api/workflow/opportunities/'+o.id,{method:'POST',session:admin,body:{...base,evidenceId:ev.id}})).status,400,'pending evidence cannot be linked');
 assert.equal((await request('/api/monitor/evidence/'+ev.id,{method:'POST',session:admin,body:{decision:'accepted'}})).status,200);
 const terms={entityTypes:['association'],region:{scope:'national',names:[]},audiences:['youth'],amount:{min:null,max:500000},durationMonths:{min:null,max:null},applicationStatus:'open',readiness:['license'],evidence:{amount:'الحد الأعلى للمنحة 500000 ريال'}};
 r=await request('/api/workflow/opportunities/'+o.id,{method:'POST',session:admin,body:{...base,evidenceId:ev.id,terms}});assert.equal(r.status,200,await r.clone().text());
 const row=await store.one('SELECT * FROM opportunities WHERE id=?',o.id);assert.equal(row.closes_at,'2027-03-01');assert.equal(JSON.parse(row.terms_json).amount.max,500000);
 assert.equal((await request('/api/workflow/opportunities/'+o.id,{method:'POST',session:admin,body:{...base,expectedVersion:1,evidenceId:ev.id,terms:{amount:{min:9,max:1}}}})).status,400);
 // duplicate merge
 r=await request('/api/workflow/opportunities/'+d.id,{method:'POST',session:admin,body:{decision:'duplicate',expectedVersion:0,duplicateOf:o.id}});assert.equal(r.status,200,await r.clone().text());
 const merged=await store.one('SELECT * FROM opportunities WHERE id=?',d.id);assert.equal(merged.review_status,'rejected');assert.equal(merged.duplicate_of,o.id);
 assert.equal((await request('/api/workflow/opportunities/'+d.id,{method:'POST',session:admin,body:{decision:'duplicate',expectedVersion:1,duplicateOf:d.id}})).status,400);
 // plain rejection of an unreviewed candidate does not need donor or topics
 await db.prepare("INSERT INTO opportunities(id,source_id,title,source_url,created_at) VALUES('noise-1','feed-a','إعلان غير ذي صلة بالجهة','https://feed.example.org/news/noise',?)").bind(at()).run();
 assert.equal((await request('/api/workflow/opportunities/noise-1',{method:'POST',session:admin,body:{decision:'rejected',expectedVersion:0}})).status,200);
});

test('workflow: structured matches, application timeline, results and alert acknowledgement',async()=>{
 const admin=await login('admin'),editor=await login('editor'),viewer=await login('viewer'),o=await store.one("SELECT * FROM opportunities WHERE source_id='feed-a' AND review_status='approved'");
 await store.q("INSERT INTO records VALUES('doc_license',?,1,?,'admin')",JSON.stringify({st:'ok'}),at()).run();
 let w=await (await request('/api/workflow',{session:editor})).json();const m=w.matches[o.id].find(x=>x.projectId==='p01');assert.ok(m.criteria.length>=6);assert.equal(m.eligible,null);assert.ok(['candidate_ok','needs_review'].includes(m.verdict),m.verdict);assert.equal(m.criteria.find(c=>c.key==='doc_license').status,'met');assert.deepEqual(w.evidence,[]);
 w=await (await request('/api/workflow',{session:admin})).json();assert.ok(w.evidence.some(e=>e.opportunity_id===o.id&&e.review_status==='accepted'));
 const input={opportunityId:o.id,projectId:'p01',ownerId:'editor',stage:'eval',nextAction:'مراجعة الشروط',dueDate:'2026-12-01',notes:'',expectedVersion:0};
 let r=await request('/api/workflow/applications',{method:'POST',session:editor,body:input});assert.equal(r.status,200,await r.clone().text());const app=await r.json();
 assert.equal((await request(`/api/workflow/applications/${app.id}/events`,{method:'POST',session:viewer,body:{kind:'note',text:'x'}})).status,403);
 assert.equal((await request(`/api/workflow/applications/${app.id}/events`,{method:'POST',session:editor,body:{kind:'contact',text:'اتصال بمسؤول البرنامج لتأكيد الشروط'}})).status,200);
 assert.equal((await request(`/api/workflow/applications/${app.id}/events`,{method:'POST',session:editor,body:{kind:'result',result:'accepted',text:'قُبل'}})).status,403);
 assert.equal((await request(`/api/workflow/applications/${app.id}/events`,{method:'POST',session:editor,body:{kind:'note',text:'x',result:'accepted'}})).status,400);
 assert.equal((await request(`/api/workflow/applications/${app.id}/events`,{method:'POST',session:admin,body:{kind:'result',result:'accepted',text:'وصل إشعار القبول'}})).status,200);
 w=await (await request('/api/workflow',{session:editor})).json();const a=w.applications.find(x=>x.id===app.id);assert.equal(a.stage,'accepted');assert.equal(a.version,2);assert.deepEqual(w.events[app.id].map(e=>e.kind),['result','contact','stage']);
 assert.equal((await request('/api/workflow/applications',{method:'POST',session:editor,body:{...input,expectedVersion:1}})).status,403,'editor cannot alter an accepted application');
 assert.equal((await request('/api/workflow/applications',{method:'POST',session:admin,body:{...input,expectedVersion:1}})).status,409,'stale version after the result must conflict');
 const alert=(await store.one('SELECT id FROM alerts WHERE acknowledged_at IS NULL ORDER BY id DESC LIMIT 1')).id;
 assert.equal((await request(`/api/workflow/alerts/${alert}/ack`,{method:'POST',session:viewer,body:{}})).status,403);
 assert.equal((await request(`/api/workflow/alerts/${alert}/ack`,{method:'POST',session:editor,body:{}})).status,200);
 w=await (await request('/api/workflow',{session:editor})).json();assert.ok(!w.alerts.some(x=>x.id===alert));
 // a duplicate cannot be merged once it has applications
 assert.equal((await request('/api/workflow/opportunities/'+o.id,{method:'POST',session:admin,body:{decision:'duplicate',expectedVersion:1,duplicateOf:'missing'}})).status,400);
});

test('manual intake records what a person read on an official site without any network call',async()=>{
 const admin=await login('admin'),editor=await login('editor');let calls=0;await addSource('manual-src','https://asf.example.org/ar/grants','manual',null);
 await withFetch(async()=>{calls++;throw Error('no network expected');},async()=>{
  const body={sourceId:'manual-src',title:'منحة تجريبية مُدخلة يدويًا',url:'https://asf.example.org/ar/grants/3',quote:'نص موجز كتبه المراجع كما ورد في صفحة المنتج',closesAt:'2027-02-01'};
  assert.equal((await request('/api/monitor/manual',{method:'POST',session:editor,body})).status,403);
  assert.equal((await request('/api/monitor/manual',{method:'POST',session:admin,body:{...body,url:'https://evil.example.com/x'}})).status,400);
  assert.equal((await request('/api/monitor/manual',{method:'POST',session:admin,body:{...body,quote:'قصير'}})).status,400);
  const r=await request('/api/monitor/manual',{method:'POST',session:admin,body});assert.equal(r.status,201,await r.clone().text());const out=await r.json();
  assert.equal((await request('/api/monitor/manual',{method:'POST',session:admin,body})).status,409);
  const ev=await store.one('SELECT * FROM evidence WHERE id=?',out.evidenceId);assert.equal(ev.origin,'manual');assert.equal(ev.closes_at,'2027-02-01');assert.equal(ev.review_status,'pending');
 });
 assert.equal(calls,0);
 const {runScan}=await import('../scheduler.mjs');await withFetch(async()=>{calls++;return new Response('x');},async()=>{await runScan(store,null,ENV(),3);});assert.equal(calls,0,'manual sources are never scanned');
});

test('snapshots v4 restore into a fresh database and legacy v3 snapshots remain restorable',async()=>{
 const {snapshot,restoreFresh}=await import('../backup.mjs'),data=await snapshot(db);assert.equal(data.version,4);assert.ok(data.tables.application_events.length>=3);
 const restored=await mf.getD1Database('RESTORE');for(const f of ['0001','0002','0003'])await restored.exec(await readFile(new URL(`../migrations/${f}.sql`,import.meta.url),'utf8'));
 await restoreFresh(restored,data);for(const t of ['users','opportunities','applications','application_events','scheduled_runs','evidence'])assert.equal((await restored.prepare('SELECT count(*) n FROM '+t).first()).n,data.tables[t].length);
 assert.equal((await restored.prepare('PRAGMA foreign_key_check').all()).results.length,0);
 // legacy: a v3 snapshot has no event table and none of the new columns
 const legacy=JSON.parse(JSON.stringify(data));legacy.version=3;delete legacy.tables.application_events;const added={scheduled_runs:['status','attempts','finished_at','detail'],sources:['kind'],opportunities:['title_key','duplicate_of','terms_json'],evidence:['origin']};
 for(const [t,cols] of Object.entries(added))legacy.tables[t]=legacy.tables[t].map(r=>{const c={...r};for(const k of cols)delete c[k];return c;});
 const fresh=await mf.getD1Database('RESTORE2');for(const f of ['0001','0002','0003'])await fresh.exec(await readFile(new URL(`../migrations/${f}.sql`,import.meta.url),'utf8'));
 await restoreFresh(fresh,legacy);assert.equal((await fresh.prepare('SELECT count(*) n FROM opportunities').first()).n,data.tables.opportunities.length);assert.equal((await fresh.prepare('SELECT count(*) n FROM application_events').first()).n,0);
 assert.equal((await fresh.prepare("SELECT kind FROM sources LIMIT 1").first()).kind.length>0,true);
});

test('discovery: index-like pages are labelled, and the same URL seen from a second source is linked as a duplicate',async()=>{
 const {runScan}=await import('../scheduler.mjs'),{indexLike}=await import('../vendor/discovery.cjs');
 assert.equal(indexLike('منتجات المنح الاعتيادي','https://x.example/a','https://x.example/b'),true);assert.equal(indexLike('منحة البرامج والمشاريع','https://x.example/a','https://x.example/b'),false);assert.equal(indexLike('منحة البرامج','https://x.example/b','https://x.example/b'),true);
 const o=await store.one("SELECT * FROM opportunities WHERE source_url='https://feed.example.org/news/1'");assert.ok(o,'opportunity from the feed test must exist');
 await db.prepare('UPDATE sources SET enabled=0').run();await addSource('idx-src','https://feed.example.org/news/idx.xml','feed');
 await withFetch(async()=>xml(rss([{title:'منتجات المنح الاعتيادية',link:'https://feed.example.org/news/products'},{title:'منحة المشاريع الشبابية — نسخة ثانية من العنوان',link:'https://feed.example.org/news/1'}])),async()=>{const r=await runScan(store,null,ENV(),3);assert.equal(r.results[0].ok,true);assert.equal(r.results[0].discovery.candidates,2);assert.equal(r.results[0].discovery.duplicates,1);});
 const idx=await store.one("SELECT * FROM opportunities WHERE source_id='idx-src' AND source_url='https://feed.example.org/news/products'");assert.equal(JSON.parse(idx.fields_json).hint,'index');assert.match((await store.one('SELECT message FROM alerts WHERE reference_id=?',idx.id)).message,/فهرس/);
 const dup=await store.one("SELECT * FROM opportunities WHERE source_id='idx-src' AND source_url='https://feed.example.org/news/1'");assert.equal(dup.duplicate_of,o.id,'same URL from another source links to the original even when the title differs');
 await db.prepare('UPDATE sources SET enabled=0').run();
});
