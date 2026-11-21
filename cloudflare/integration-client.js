// Bridge monitored opportunities into the existing shared-state render cycle.
const radarStaticCalls=DATA.calls.slice();
let radarApplications=[],radarMonitorAlerts=[];
const radarOldCallKey=callKey;callKey=function(c){return c.key||radarOldCallKey(c);};
const radarOldApplyState=teamApplyState;
teamApplyState=function(data){if(data?.state&&(!TEAM.revision||data.revision>=TEAM.revision)){DATA.calls=radarStaticCalls.concat(data.discoveries||[]);radarApplications=data.applications||[];radarMonitorAlerts=data.monitorAlerts||[];}return radarOldApplyState(data);};
function radarWorkflowPanel(){const mine=radarApplications.filter(a=>a.owner_id===TEAM.user?.id&&!['closed','rejected'].includes(a.stage));return '<section class="card" style="padding:18px;margin:16px 0"><h3>الرصد ومتابعة التقديم</h3><p>'+radarApplications.length+' طلب تقديم مستقل · '+mine.length+' مهام مسندة إليك · '+radarMonitorAlerts.length+' تنبيهات رصد</p><a href="/workflow">الفرص المعتمدة والمطابقة وطلبات التقديم</a></section>';}
const radarOldPipeline=vPipeline;vPipeline=function(){return radarWorkflowPanel()+radarOldPipeline.apply(this,arguments);};
const radarOldCallBox=cwBox;cwBox=function(c){return radarOldCallBox.apply(this,arguments)+(c.monitor?'<p><a href="/workflow#opportunity-'+encodeURIComponent(c.id)+'">مطابقة المشاريع وبدء طلب تقديم مستقل</a></p>':'');};
// Sidebar entries for the monitor pages, rendered by the application's own nav so they share its look.
const RADAR_PAGES={news:['آخر الإعلانات','اكتشاف التمويل','bell'],workflow:['الفرص والمطابقة','المتابعة','fit'],monitor:['مركز الرصد','جاهزية الجمعية','bookmark']};
let radarLastScan=null;
function radarEnsureNav(){if(typeof UI_GROUPS==='undefined'||typeof UI_LABELS==='undefined')return;for(const [id,[label,group,ico]] of Object.entries(RADAR_PAGES)){const g=UI_GROUPS.find(x=>x[0]===group);if(!g)continue;const wanted=id!=='monitor'||TEAM.user?.role==='admin';const has=g[1].includes(id);if(wanted&&!has)g[1].push(id);if(!wanted&&has)g[1].splice(g[1].indexOf(id),1);UI_LABELS[id]=label;if(typeof RADAR_LUCIDE_PATHS!=='undefined'&&!RADAR_LUCIDE_PATHS[id])RADAR_LUCIDE_PATHS[id]=RADAR_LUCIDE_PATHS[ico]||RADAR_LUCIDE_PATHS.info;}}
const radarOldGo=go;go=function(t){if(RADAR_PAGES[t]){location.href='/'+t;return;}return radarOldGo.apply(this,arguments);};
if(typeof uiCount==='function'){const radarOldCount=uiCount;uiCount=function(t){if(t==='news')return radarMonitorAlerts.length||null;if(RADAR_PAGES[t])return null;return radarOldCount.apply(this,arguments);};}
const radarOldRenderTabs=renderTabs;renderTabs=function(){radarEnsureNav();return radarOldRenderTabs.apply(this,arguments);};
function radarPatchLastScan(){if(!radarLastScan)return;const label='آخر رصد: '+radarLastScan;const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;const hits=[];while((n=walker.nextNode()))if(n.nodeValue.includes('آخر رصد: 22 أكتوبر 2026'))hits.push(n);for(const h of hits)h.nodeValue=h.nodeValue.replace('آخر رصد: 22 أكتوبر 2026',label);}
const radarOldRenderLive=renderLive;renderLive=function(){const r=radarOldRenderLive.apply(this,arguments);const stale=document.getElementById('radar-workflow-nav');if(stale)stale.remove();radarPatchLastScan();return r;};
fetch('/api/news?limit=1',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(d=>{const last=d&&d.runs&&d.runs[0];if(last){radarLastScan=new Date(last.started_at).toLocaleString('ar-SA-u-nu-latn',{calendar:'gregory',dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'});radarPatchLastScan();}}).catch(()=>{});
const radarOldTasksView=teamTasksView;teamTasksView=function(){return radarWorkflowPanel()+radarOldTasksView.apply(this,arguments);};
const radarOldAlerts=renderAlerts;renderAlerts=function(){const r=radarOldAlerts.apply(this,arguments),area=document.getElementById('alerts');if(area){for(const alert of radarMonitorAlerts.slice(0,5)){const p=document.createElement('p'),a=document.createElement('a');a.href='/workflow#opportunity-'+encodeURIComponent(alert.reference_id);a.textContent=alert.message;p.append(a);area.append(p);}}return r;};
