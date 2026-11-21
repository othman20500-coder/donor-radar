// Shared page shell for /news, /workflow and /monitor: the same sidebar, header, theme and tokens as the main
// application. Visual layer only. Expects the build-time globals from radar-shell-data.js:
// ICONS, UI_GROUPS, UI_LABELS, NAV_GROUPS, RADAR_LOGOS.
(function(){
 'use strict';
 const $=(s,r=document)=>r.querySelector(s);
 const EXTRA={news:{label:'آخر الإعلانات',href:'/news',group:'اكتشاف التمويل',icon:'bell'},workflow:{label:'الفرص والمطابقة',href:'/workflow',group:'المتابعة',icon:'fit'},monitor:{label:'مركز الرصد',href:'/monitor',group:'جاهزية الجمعية',icon:'sources',admin:true}};
 // Same resolution as the application's icon(): Lucide paths by normalised key, then the legacy ICONS set, then "info".
 function svg(name){const raw=String(name||'info'),key=raw.replace(/[-_\s]/g,'').toLowerCase();const L=typeof RADAR_LUCIDE_PATHS!=='undefined'?RADAR_LUCIDE_PATHS:{},I=typeof ICONS!=='undefined'?ICONS:{};const body=L[key]||I[raw]||L.info||'<circle cx="12" cy="12" r="9"/>';return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+body+'</svg>';}
 function uiIcon(key){return svg(({calls:'opportunities',opps:'fit',library:'register',sources:'bookmark'})[key]||key);}
 function readTheme(){let t='light';try{const s=localStorage.getItem('radar-theme');if(['light','dark'].includes(s))t=s;}catch(e){}return t;}
 function applyTheme(t){document.documentElement.dataset.theme=t;const b=$('#themeToggle');if(b)b.innerHTML=uiIcon(t==='dark'?'sun':'moon');}
 function groupsWith(role){
  const groups=UI_GROUPS.map(([label,items])=>[label,items.slice()]);
  for(const [id,x] of Object.entries(EXTRA)){if(x.admin&&role!=='admin')continue;const g=groups.find(([l])=>l===x.group);if(g)g[1].push(id);}
  return groups;
 }
 function navMarkup(current,role,counts){
  return groupsWith(role).map(([label,items])=>'<div class="nav-group"><p class="nav-group-label">'+label+'</p>'+items.map(t=>{
   const x=EXTRA[t],href=x?x.href:'/#'+t,text=x?x.label:UI_LABELS[t],cnt=counts&&counts[t]!=null?'<span class="nav-count" aria-label="'+counts[t]+' سجل">'+counts[t]+'</span>':'';
   return '<a class="nav-link" href="'+href+'"'+(t===current?' aria-current="page"':'')+'>'+uiIcon(x?x.icon:t)+'<span>'+text+'</span>'+cnt+'</a>';}).join('')+'</div>').join('');
 }
 function mobileMarkup(currentGroupLabel){
  return NAV_GROUPS.map(g=>'<a href="/#'+g.items[0][0]+'"'+(g.label===currentGroupLabel||(currentGroupLabel==='اكتشاف التمويل'&&g.id==='opps')||(currentGroupLabel==='جاهزية الجمعية'&&g.id==='org')||(currentGroupLabel==='المتابعة'&&g.id==='follow')?' aria-current="page"':'')+'>'+uiIcon(g.icon)+'<span>'+g.label+'</span></a>').join('');
 }
 /** Builds the shell around #page-content (or an empty main) and returns the <main> element. */
 window.radarShell=function({page,title,role='viewer',counts={}}){
  const theme=readTheme();document.documentElement.dataset.theme=theme;
  const content=$('#page-content');const existing=content?content.innerHTML:'';
  const group=EXTRA[page]?EXTRA[page].group:'الرئيسية';
  document.body.innerHTML=
   '<header class="top"><div class="wrap">'+
    '<div class="brandrow"><a class="brand-home" href="/#overview" aria-label="جمعية التنمية الأهلية بالمعذر — لوحة القرار"><img class="brand-logo brand-logo-light" src="'+RADAR_LOGOS.light+'" width="587" height="128" alt="جمعية التنمية الأهلية بالمعذر"><img class="brand-logo brand-logo-dark" src="'+RADAR_LOGOS.dark+'" width="587" height="128" alt="" aria-hidden="true"></a><div class="brand"><b>رادار المانحين</b></div></div>'+
    '<nav class="tabs" id="tabs" aria-label="أقسام رادار المانحين">'+navMarkup(page,role,counts)+'</nav>'+
    '<div class="sidebar-footer"><div class="storage-label">'+uiIcon('check')+'<span>متصل بمساحة الفريق</span></div><span id="shellFooter">آخر رصد حي: —</span><a href="/#overview" class="shell-footer-link">'+uiIcon('overview')+' العودة إلى لوحة القرار</a></div>'+
   '</div></header>'+
   '<div class="wrap"><div class="workspace-top"><button type="button" class="icon-btn nav-toggle" id="navToggle" aria-controls="tabs" aria-expanded="false" aria-label="فتح قائمة الأقسام">'+uiIcon('menu')+'</button><div class="breadcrumb"><span>مساحة العمل</span>'+uiIcon('chevronLeft')+'<b id="currentPage">'+title+'</b></div><div class="workspace-actions"><a class="quick-search" href="/#overview">'+uiIcon('search')+'<span>ابحث في الرادار</span></a><button type="button" class="icon-btn" id="themeToggle" aria-label="تبديل المظهر">'+uiIcon(theme==='dark'?'sun':'moon')+'</button></div></div>'+
   '<main id="main"><section id="page">'+existing+'</section></main></div>'+
   '<button type="button" class="nav-scrim" id="navScrim" tabindex="-1" aria-label="إغلاق القائمة"></button><nav class="mobile-nav" id="mobileNav" aria-label="التنقل السريع">'+mobileMarkup(group)+'</nav>';
  document.title=title+' · رادار المانحين';
  $('#themeToggle').addEventListener('click',()=>{const now=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(now);try{localStorage.setItem('radar-theme',now);}catch(e){}});
  const setDrawer=open=>{document.body.classList.toggle('nav-open',open);$('#navToggle').setAttribute('aria-expanded',String(open));};
  $('#navToggle').addEventListener('click',()=>setDrawer(!document.body.classList.contains('nav-open')));
  $('#navScrim').addEventListener('click',()=>setDrawer(false));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')setDrawer(false);});
  matchMedia('(max-width:960px)').addEventListener('change',m=>{if(!m.matches)setDrawer(false);});
  return $('#page');
 };
 window.radarShellFooter=function(text){const f=$('#shellFooter');if(f)f.textContent=text;};
 window.radarShellCount=function(id,n){const link=document.querySelector('.nav-link[href="'+(EXTRA[id]?EXTRA[id].href:'/#'+id)+'"]');if(!link)return;let c=link.querySelector('.nav-count');if(n==null){if(c)c.remove();return;}if(!c){c=document.createElement('span');c.className='nav-count';link.append(c);}c.textContent=String(n);c.setAttribute('aria-label',n+' سجل');};
 window.radarIcon=svg;
})();
