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
 await db.exec(sql);
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
