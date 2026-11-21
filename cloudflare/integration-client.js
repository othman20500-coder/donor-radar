// Bridge monitored opportunities into the existing shared-state render cycle.
const radarStaticCalls=DATA.calls.slice();
let radarApplications=[],radarMonitorAlerts=[];
const radarOldCallKey=callKey;callKey=function(c){return c.key||radarOldCallKey(c);};
const radarOldApplyState=teamApplyState;
teamApplyState=function(data){if(data?.state&&(!TEAM.revision||data.revision>=TEAM.revision)){DATA.calls=radarStaticCalls.concat(data.discoveries||[]);radarApplications=data.applications||[];radarMonitorAlerts=data.monitorAlerts||[];}return radarOldApplyState(data);};
function radarWorkflowPanel(){const mine=radarApplications.filter(a=>a.owner_id===TEAM.user?.id&&!['closed','rejected'].includes(a.stage));return '<section class="card" style="padding:18px;margin:16px 0"><h3>الرصد ومتابعة التقديم</h3><p>'+radarApplications.length+' طلب تقديم مستقل · '+mine.length+' مهام مسندة إليك · '+radarMonitorAlerts.length+' تنبيهات رصد</p><a href="/workflow">الفرص المعتمدة والمطابقة وطلبات التقديم</a></section>';}
const radarOldPipeline=vPipeline;vPipeline=function(){return radarWorkflowPanel()+radarOldPipeline.apply(this,arguments);};
const radarOldCallBox=cwBox;cwBox=function(c){return radarOldCallBox.apply(this,arguments)+(c.monitor?'<p><a href="/workflow#opportunity-'+encodeURIComponent(c.id)+'">مطابقة المشاريع وبدء طلب تقديم مستقل</a></p>':'');};
const radarOldRenderLive=renderLive;renderLive=function(){const r=radarOldRenderLive.apply(this,arguments);let n=document.getElementById('radar-workflow-nav');if(!n){n=document.createElement('a');n.id='radar-workflow-nav';n.href='/workflow';n.style.cssText='position:fixed;bottom:18px;left:18px;z-index:999;background:#116d63;color:white;padding:12px;border-radius:8px';document.body.append(n);}n.textContent='الرصد والمتابعة ('+radarMonitorAlerts.length+')';return r;};
const radarOldTasksView=teamTasksView;teamTasksView=function(){return radarWorkflowPanel()+radarOldTasksView.apply(this,arguments);};
const radarOldAlerts=renderAlerts;renderAlerts=function(){const r=radarOldAlerts.apply(this,arguments),area=document.getElementById('alerts');if(area){for(const alert of radarMonitorAlerts.slice(0,5)){const p=document.createElement('p'),a=document.createElement('a');a.href='/workflow#opportunity-'+encodeURIComponent(alert.reference_id);a.textContent=alert.message;p.append(a);area.append(p);}}return r;};
