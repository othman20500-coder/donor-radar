import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

let mf,db;
const origin='https://localhost';
const password='Development-only-Password42!';
async function seed(id,role){
 const {hashPassword}=await import('../security.mjs');
 await db.prepare('INSERT INTO users(id,username,display_name,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,id,id,role,await hashPassword(password),new Date().toISOString(),new Date().toISOString()).run();
}
async function request(path,{method='GET',body,session,csrf=true,requestOrigin=origin}={}){
 const headers={};if(method!=='GET'){headers.Origin=requestOrigin;headers['Content-Type']='application/json';}
 if(session){headers.Cookie=session.cookie;if(csrf)headers['X-CSRF-Token']=session.csrfToken;}
 return (await mf.getWorker("radar")).fetch(origin+path,{method,headers,redirect:"manual",body:body===undefined?undefined:JSON.stringify(body)});
}
async function login(username){const r=await request('/api/auth/login',{method:'POST',body:{username,password}});assert.equal(r.status,200,await r.clone().text());return {...await r.json(),cookie:r.headers.get('set-cookie').split(';')[0]};}
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({name:"radar",modules:true,scriptPath:new URL('../dist/worker.js',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),compatibilityDate:'2026-11-19',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'test',RESTORE:'restore-test'},bindings:{APP_ENV:'development',PUBLIC_URL:origin,APP_NAME:'donor-radar-v13-dev',LIVE_SCAN_ENABLED:'false'},assets:{directory:new URL('../dist/assets',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),binding:'ASSETS',run_worker_first:true,assetConfig:{html_handling:'none'}}}));
 db=await mf.getD1Database('DB');
 const sql=await readFile(new URL('../migrations/0001.sql',import.meta.url),'utf8');
 // D1 exec accepts individual lines; schema uses one statement per line.
 await db.exec(sql);await db.exec(await readFile(new URL('../migrations/0002.sql',import.meta.url),'utf8'));
 await seed('admin','admin');await seed('editor','editor');await seed('viewer','viewer');
});
after(async()=>{await mf?.dispose();});
test('protected app, files and monitor reject anonymous users',async()=>{
 assert.equal((await request('/api/state')).status,401);
 assert.equal((await request('/api/monitor/dashboard')).status,401);
 assert.equal((await request('/')).status,303);
 assert.equal((await request('/login')).status,200);
 assert.equal((await request('/private/catalog.json')).status,303);
});
test('login failure, cookie flags, CSRF, origin and logout',async()=>{
 assert.equal((await request('/api/auth/login',{method:'POST',body:{username:'admin',password:'wrong'}})).status,401);
 const s=await login('admin');
 const raw=await request('/api/auth/login',{method:'POST',body:{username:'admin',password}});
 assert.match(raw.headers.get('set-cookie'),/HttpOnly/);assert.match(raw.headers.get('set-cookie'),/Secure/);assert.match(raw.headers.get('set-cookie'),/SameSite=Strict/);
 assert.equal((await request('/api/auth/logout',{method:'POST',session:s,body:{},csrf:false})).status,403);
 assert.equal((await request('/api/auth/logout',{method:'POST',session:s,body:{},requestOrigin:'https://evil.example'})).status,403);
 assert.equal((await request('/api/auth/logout',{method:'POST',session:s,body:{}})).status,200);
 assert.equal((await request('/api/session',{session:s})).status,401);
});
test('viewer cannot write and editor cannot administer or monitor',async()=>{
 const viewer=await login('viewer'),editor=await login('editor');
 assert.equal((await request('/api/records/fin_cfg',{method:'PUT',session:viewer,body:{value:{target:100},expectedVersion:0}})).status,403);
 for(const path of ['/api/users','/api/monitor/dashboard','/api/backup'])assert.equal((await request(path,{session:editor})).status,403);
});
test('concurrent updates have one winner and preserve audit/revision',async()=>{
 const s=await login('admin');
 const results=await Promise.all([100,200].map(target=>request('/api/records/fin_cfg',{method:'PUT',session:s,body:{value:{target},expectedVersion:0}})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const state=await (await request('/api/state',{session:s})).json();assert.equal(state.versions.fin_cfg,1);
 const count=await db.prepare("SELECT count(*) n FROM audit WHERE action='record.create' AND record_key='fin_cfg'").first();assert.equal(count.n,1);
});
test('last admin protected and role change invalidates session',async()=>{
 const admin=await login('admin'),editor=await login('editor');
 assert.equal((await request('/api/users/admin',{method:'PATCH',session:admin,body:{active:false}})).status,409);
 assert.equal((await request('/api/users/editor',{method:'PATCH',session:admin,body:{role:'viewer'}})).status,200);
 assert.equal((await request('/api/session',{session:editor})).status,401);
});
test('monitor has explicit policy and live-network gates',async()=>{
 const s=await login('admin');
 let r=await request('/api/monitor/sources',{method:'POST',session:s,body:{name:'Official test',url:'https://example.org/grants'}});assert.equal(r.status,201);
 const {id}=await r.json();
 r=await request('/api/monitor/scan',{method:'POST',session:s,body:{}});assert.equal(r.status,200);assert.equal((await r.json()).results.length,0);
 assert.equal((await request('/api/monitor/sources',{method:'POST',session:s,body:{name:'Unsafe',url:'https://127.0.0.1/'}})).status,400);
 r=await request('/api/monitor/policies/'+id,{method:'POST',session:s,body:{robotsReviewed:true,termsReviewed:true,robotsUrl:'https://example.org/robots.txt',termsUrl:'https://example.org/terms',notes:'Test fixture only'}});assert.equal(r.status,200);
 r=await request('/api/monitor/scan',{method:'POST',session:s,body:{}});assert.equal(r.status,403);
});
test('backup excludes credentials and preview validates input',async()=>{
 const s=await login('admin');const r=await request('/api/backup',{session:s});assert.equal(r.status,200);
 const backup=await r.json();assert.equal(backup.format,'donor-radar-backup');assert.ok(backup.state.fin_cfg);assert.equal(backup.users,undefined);
 assert.equal((await request('/api/import/preview',{method:'POST',session:s,body:{backup}})).status,200);
 assert.equal((await request('/api/import/preview',{method:'POST',session:s,body:{backup:{state:{}}}})).status,400);
});








test('complete snapshot restores data, accounts and audit into fresh D1 without sessions',async()=>{
 const {snapshot,restoreFresh}=await import('../backup.mjs');const data=await snapshot(db);
 assert.ok(data.tables.users[0].password_hash);assert.equal(data.tables.sessions,undefined);
 const restored=await mf.getD1Database('RESTORE');await restored.exec(await readFile(new URL('../migrations/0001.sql',import.meta.url),'utf8'));
 await restored.exec(await readFile(new URL('../migrations/0002.sql',import.meta.url),'utf8'));
 await restoreFresh(restored,data);
 for(const table of ['users','records','audit','sources','source_policies'])assert.equal((await restored.prepare('SELECT count(*) n FROM '+table).first()).n,data.tables[table].length);
 assert.equal((await restored.prepare('SELECT count(*) n FROM sessions').first()).n,0);
 assert.equal((await restored.prepare('PRAGMA foreign_key_check').all()).results.length,0);
 await assert.rejects(()=>restoreFresh(restored,data),/empty database/);
});


test('revoked policy prevents later network calls in an active scan',async()=>{
 const {monitorRoute}=await import('../monitor.mjs');let revoked=false,calls=0;const original=globalThis.fetch;
 const fake={all:async()=>[{id:'one',url:'https://example.org/one'},{id:'two',url:'https://example.org/two'}],one:async()=>({n:2}),q:()=>({run:async()=>({meta:{changes:1}})}),atomic:async(_stmts,options)=>{if(options.condition&&options.args[0]==='two'&&revoked)throw Error('Policy revoked');}};
 globalThis.fetch=async()=>{calls++;revoked=true;throw Error('Simulated network failure after revocation');};
 try{const result=await monitorRoute(fake,{user:{role:'admin'}},'/api/monitor/scan','POST',{maxSources:2},{LIVE_SCAN_ENABLED:'true',REVIEWED_SOURCE_URLS:JSON.stringify(['https://example.org/one','https://example.org/two'])});assert.equal(calls,1);assert.equal(result.data.results[1].error,'Policy revoked');}finally{globalThis.fetch=original;}
});

test('new users must change password; old sessions and CSRF tokens cannot continue',async()=>{
 const admin=await login('admin');let r=await request('/api/users',{method:'POST',session:admin,body:{username:'neweditor',displayName:'QA editor',role:'editor',password}});assert.equal(r.status,201,await r.clone().text());
 const a=await login('neweditor'),b=await login('neweditor');assert.equal((await request('/api/state',{session:a})).status,403);
 r=await request('/api/auth/password',{method:'POST',session:a,body:{currentPassword:password,newPassword:'Changed-Development-Password84!'}});assert.equal(r.status,200,await r.clone().text());const changed=await r.json();assert.notEqual(changed.csrfToken,a.csrfToken);
 assert.equal((await request('/api/session',{session:b})).status,401);
 assert.equal((await request('/api/auth/logout',{method:'POST',session:a,body:{}})).status,403);
 assert.equal((await request('/api/state',{session:{...a,csrfToken:changed.csrfToken}})).status,200);
});

test('approved discoveries are shared; applications are independent and versioned',async()=>{
 const admin=await login('admin');await request('/api/users/editor',{method:'PATCH',session:admin,body:{role:'editor'}});const editor=await login('editor'),viewer=await login('viewer');
 const source=(await db.prepare('SELECT id FROM sources LIMIT 1').first()).id;
 await db.prepare("INSERT INTO opportunities(id,source_id,title,source_url,review_status,created_at) VALUES('flow-one',?,'منحة اختبار','https://example.org/grants/one','pending',?)").bind(source,new Date().toISOString()).run();
 let state=await (await request('/api/state',{session:admin})).json();assert.ok(Array.isArray(state.discoveries),'shared discoveries missing');assert.ok(!state.discoveries.some(x=>x.id==='flow-one'));
 const review={decision:'approved',expectedVersion:0,donorId:'associations-support-fund',topics:['youth']};
 assert.equal((await request('/api/workflow/opportunities/flow-one',{method:'POST',session:editor,body:review})).status,403);
 let r=await request('/api/workflow/opportunities/flow-one',{method:'POST',session:admin,body:review});assert.equal(r.status,200,await r.clone().text());
 state=await (await request('/api/state',{session:admin})).json();assert.ok(state.discoveries.some(x=>x.id==='flow-one'&&x.key==='cw_mon_flow-one'));
 const input={opportunityId:'flow-one',projectId:'p01',ownerId:'editor',stage:'eval',nextAction:'مراجعة الشروط',dueDate:'2026-12-01',notes:'',expectedVersion:0};
 assert.equal((await request('/api/workflow/applications',{method:'POST',session:viewer,body:input})).status,403);
 r=await request('/api/workflow/applications',{method:'POST',session:editor,body:input});assert.equal(r.status,200,await r.clone().text());const app=await r.json();
 assert.equal((await request('/api/workflow/applications',{method:'POST',session:editor,body:input})).status,409);
 assert.equal((await request('/api/workflow/applications',{method:'POST',session:editor,body:{...input,projectId:'p02'}})).status,200);
 assert.equal((await request('/api/workflow/applications',{method:'POST',session:editor,body:{...input,expectedVersion:app.version,stage:'accepted'}})).status,403);
 state=await (await request('/api/state',{session:admin})).json();assert.equal(state.applications.length,2);
 assert.equal((await request('/api/records/cw_mon_flow-one',{method:'PUT',session:editor,body:{expectedVersion:0,value:{stage:'eval',owner:'editor',note:'متابعة'}}})).status,200);
});

test('scheduled discovery is stable, binds detail evidence and preserves reviewed dates on change',async()=>{
 const {Store}=await import('../store.mjs'),{scheduledScan}=await import('../scheduler.mjs');
 const catalog=JSON.parse(await readFile(new URL('../../private/catalog.json',import.meta.url),'utf8')),store=new Store(db,catalog),original=globalThis.fetch;let calls=0,changed=false;
 await db.prepare('UPDATE sources SET enabled=0').run();
 await db.prepare("INSERT INTO sources(id,name,url,created_at,donor_id) VALUES('schedule-source','Fixture','https://example.org/feed',?,'associations-support-fund')").bind(new Date().toISOString()).run();
 await db.prepare("INSERT INTO source_policies(source_id,robots_reviewed,terms_reviewed,reviewed_at) VALUES('schedule-source',1,1,?)").bind(new Date().toISOString()).run();
 const env={APP_ENV:'development',APP_NAME:'donor-radar-v13-dev',LIVE_SCAN_ENABLED:'true',REVIEWED_SOURCE_URLS:JSON.stringify(['https://example.org/feed','https://example.org/detail'])};
 globalThis.fetch=async url=>{calls++;return new Response(url.endsWith('/feed')?'<html>صفحة منح رسمية للتجربة المحلية فقط <a href="/detail">منحة '+(changed?'عنوان جديد':'المشاريع')+'</a></html>':'<html>إعلان تمويل تجريبي طويل بما يكفي لفحص التفاصيل. deadline: '+(changed?'2027-02-01':'2027-01-01')+'</html>',{headers:{'content-type':'text/html'}});};
 try{
 const first=await scheduledScan(store,env,1800000000000);assert.equal(first.results[0].ok,true);assert.equal(calls,2);assert.equal((await scheduledScan(store,env,1800000000000)).duplicate,true);assert.equal(calls,2);
 const o=await store.one("SELECT * FROM opportunities WHERE source_id='schedule-source'");assert.equal(o.review_status,'pending');const evidence=await store.one('SELECT * FROM evidence WHERE opportunity_id=?',o.id);assert.equal(evidence.closes_at,'2027-01-01');
 const admin=await login('admin');assert.equal((await request('/api/monitor/evidence/'+evidence.id,{method:'POST',session:admin,body:{decision:'accepted'}})).status,200);
 let r=await request('/api/workflow/opportunities/'+o.id,{method:'POST',session:admin,body:{decision:'approved',expectedVersion:0,donorId:'associations-support-fund',topics:['youth'],evidenceId:evidence.id}});assert.equal(r.status,200,await r.clone().text());
 changed=true;await scheduledScan(store,env,1800021600000);assert.equal((await store.one("SELECT count(*) n FROM opportunities WHERE source_id='schedule-source'")).n,1);assert.equal((await store.one('SELECT closes_at FROM opportunities WHERE id=?',o.id)).closes_at,'2027-01-01');assert.ok((await store.one('SELECT count(*) n FROM alerts WHERE reference_id=?',o.id)).n>0);
 await db.prepare("UPDATE source_policies SET robots_reviewed=0 WHERE source_id='schedule-source'").run();const before=calls;await scheduledScan(store,env,1800043200000);assert.equal(calls,before);
 const snap=(await import('../backup.mjs'));const backup=await snap.snapshot(db);assert.equal(backup.tables.applications.length,2);assert.ok(backup.tables.scheduled_runs.length>=2);
 }finally{globalThis.fetch=original;}
});

test('withdrawn opportunities retain restorable history and hidden projects cannot start applications',async()=>{
 const admin=await login('admin');
 const {Store}=await import('../store.mjs'),{effectiveProjects}=await import('../workflow.mjs');const catalog=JSON.parse(await readFile(new URL('../../private/catalog.json',import.meta.url),'utf8'));
 assert.ok(!effectiveProjects(catalog,{pm_p01:{visibility:'hidden'}}).some(p=>p.id==='p01'));assert.ok(!effectiveProjects(catalog,{pm_p01:{lifecycle:'trashed'}}).some(p=>p.id==='p01'));assert.ok(!effectiveProjects(catalog,{pm_p01:{lifecycle:'archived'}}).some(p=>p.id==='p01'));assert.equal(effectiveProjects(catalog,{pm_p01:{fields:{name:'تعديل محفوظ'}}}).find(p=>p.id==='p01').name,'تعديل محفوظ');
 const r=await request('/api/workflow/opportunities/flow-one',{method:'POST',session:admin,body:{decision:'rejected',expectedVersion:1,donorId:'associations-support-fund',topics:['youth']}});assert.equal(r.status,200);
 const store=new Store(db,catalog),backup=await store.exportBackup();assert.ok(backup.state['cw_mon_flow-one']);assert.ok((await store.previewImport(backup)).total>0);assert.ok(!(await store.state()).discoveries.some(o=>o.id==='flow-one'));assert.equal((await store.state()).applications.filter(a=>a.opportunity_id==='flow-one').length,2);
});

test('new accepted evidence can clear a formerly reviewed deadline',async()=>{
 const admin=await login('admin'),o=await db.prepare("SELECT * FROM opportunities WHERE source_id='schedule-source'").first();
 await db.prepare("INSERT INTO evidence(id,source_id,url,content_hash,excerpt,opens_at,review_status,created_at,opportunity_id) VALUES('replacement-evidence',?,?,?,'opening date: 2027-03-01','2027-03-01','accepted',?,?)").bind(o.source_id,o.source_url,'replacement-hash',new Date().toISOString(),o.id).run();
 const r=await request('/api/workflow/opportunities/'+o.id,{method:'POST',session:admin,body:{decision:'approved',expectedVersion:o.version,donorId:'associations-support-fund',topics:['youth'],evidenceId:'replacement-evidence'}});assert.equal(r.status,200);const updated=await db.prepare('SELECT * FROM opportunities WHERE id=?').bind(o.id).first();assert.equal(updated.closes_at,null);assert.equal(updated.opens_at,'2027-03-01');
});
