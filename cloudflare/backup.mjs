export const snapshotTables=['users','meta','records','audit','sources','source_policies','observations','opportunities','events','scan_runs','alerts','evidence','applications','scheduled_runs','application_events'];
const addedLater={2:['applications','scheduled_runs','application_events'],3:['application_events']};
export async function snapshot(db){const result=await db.batch(snapshotTables.map(t=>db.prepare('SELECT * FROM '+t)));return {format:'donor-radar-dev-snapshot',version:4,createdAt:new Date().toISOString(),tables:Object.fromEntries(snapshotTables.map((t,i)=>[t,result[i].results]))};}
// Operator-only recovery into a fresh database. Sessions and login tokens are never restored.
export async function restoreFresh(db,data){
 if(data?.format!=='donor-radar-dev-snapshot'||![2,3,4].includes(data.version))throw Error('Unsupported snapshot');
 const statements=[];
 for(const t of snapshotTables){const rows=data.tables[t]??((addedLater[data.version]||[]).includes(t)?[]:undefined);if(!Array.isArray(rows))throw Error('Missing table '+t);const existing=await db.prepare('SELECT count(*) n FROM '+t).first();if(existing.n&&t!=='meta')throw Error('Restore requires an empty database');const columns=(await db.prepare('PRAGMA table_info('+t+')').all()).results.map(x=>x.name);for(const row of rows){const legacy=data.version<4;if(Object.keys(row).some(c=>!columns.includes(c))||(!legacy&&columns.some(c=>!Object.hasOwn(row,c))))throw Error('Invalid row '+t);const selected=legacy?columns.filter(c=>Object.hasOwn(row,c)):columns;statements.push(db.prepare('INSERT '+(t==='meta'?'OR REPLACE ':'')+'INTO '+t+' ('+selected.join(',')+') VALUES ('+selected.map(()=>'?').join(',')+')').bind(...selected.map(c=>row[c])));}}
 const checks=snapshotTables.filter(t=>t!=='meta').map(t=>db.prepare('INSERT INTO write_guards(id,ok) SELECT ?,CASE WHEN (SELECT count(*) FROM '+t+')=0 THEN 1 ELSE 0 END').bind('restore-'+t));
 await db.batch([...checks,...statements,db.prepare("DELETE FROM write_guards WHERE id LIKE 'restore-%'")]);
}
