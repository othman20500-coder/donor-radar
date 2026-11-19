export const snapshotTables=['users','meta','records','audit','sources','source_policies','observations','opportunities','events','scan_runs','alerts','evidence'];
export async function snapshot(db){const result=await db.batch(snapshotTables.map(t=>db.prepare('SELECT * FROM '+t)));return {format:'donor-radar-dev-snapshot',version:2,createdAt:new Date().toISOString(),tables:Object.fromEntries(snapshotTables.map((t,i)=>[t,result[i].results]))};}
// Operator-only recovery into a fresh database. Sessions and login tokens are never restored.
export async function restoreFresh(db,data){
 if(data?.format!=='donor-radar-dev-snapshot'||data.version!==2)throw Error('Unsupported snapshot');
 const statements=[];
 for(const t of snapshotTables){const rows=data.tables[t];if(!Array.isArray(rows))throw Error('Missing table '+t);const existing=await db.prepare('SELECT count(*) n FROM '+t).first();if(existing.n&&t!=='meta')throw Error('Restore requires an empty database');const columns=(await db.prepare('PRAGMA table_info('+t+')').all()).results.map(x=>x.name);for(const row of rows){if(Object.keys(row).length!==columns.length||columns.some(c=>!Object.hasOwn(row,c)))throw Error('Invalid row '+t);statements.push(db.prepare('INSERT '+(t==='meta'?'OR REPLACE ':'')+'INTO '+t+' ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').bind(...columns.map(c=>row[c])));}}
 const checks=snapshotTables.filter(t=>t!=='meta').map(t=>db.prepare('INSERT INTO write_guards(id,ok) SELECT ?,CASE WHEN (SELECT count(*) FROM '+t+')=0 THEN 1 ELSE 0 END').bind('restore-'+t));
 await db.batch([...checks,...statements,db.prepare("DELETE FROM write_guards WHERE id LIKE 'restore-%'")]);
}
