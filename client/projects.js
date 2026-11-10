/* Project workspace presentation. Original records, files, authorization and
   shared-write paths remain owned by the base application and team adapter. */
'use strict';

try {
  if (!['list', 'covers'].includes(localStorage.getItem(PROJECT_VIEW_KEY))) projectView = 'list';
} catch (_) { projectView = 'list'; }

const radarProjectTabs = new Map();
let radarProjectFiltersExpanded = false;
const RADAR_PROJECT_PANELS = [
  ['overview', 'نظرة عامة'], ['files', 'الملفات والمصادر'],
  ['followup', 'المتابعة'], ['readiness', 'الجاهزية والمواءمة']
];

function radarProjectOwner(p) {
  const row = pTrack(p.id), member = TEAM.members.find(item => item.id === row.ownerId);
  const owner = member?.displayName || (row.ownerId ? 'حساب غير نشط' : 'لم يُسند بعد');
  let due = '';
  if (row.dueDate) {
    const days = daysTo(row.dueDate), pending = row.st !== 'قُبل';
    due = '<span class="radar-row-due' + (pending && days < 0 ? ' is-overdue' : '') + '"><span>' +
      (pending && days < 0 ? 'متأخر · ' : pending && days === 0 ? 'اليوم · ' : 'الموعد · ') +
      '</span><bdi dir="ltr">' + esc(row.dueDate) + '</bdi></span>';
  }
  return '<div class="radar-row-owner' + (!row.ownerId ? ' is-unassigned' : '') + '">' +
    '<span class="radar-cell-label">مسؤول المتابعة</span><b>' + esc(owner) + '</b>' +
    '<p title="' + esc(row.nextAction || '') + '">' + esc(row.nextAction || 'لم تُحدد خطوة تالية') + '</p>' + due + '</div>';
}

projectListCard = function (p) {
  const row = pTrack(p.id), summary = projectCoverSummary(p), readiness = rScore(p);
  return '<article class="pcard project-list-card radar-project-row" data-project-card="' + esc(p.id) + '">' +
    '<div class="radar-row-title"><h3><button type="button" class="radar-row-name" data-proj="' + esc(p.id) + '">' + esc(p.name) + '</button></h3>' +
    '<p class="radar-row-summary" title="' + esc(summary) + '">' + esc(summary) + '</p>' +
    '<div class="project-list-state">' + projectStatus(p) + (row.st ? '<span class="project-stage">' + esc(row.st) + '</span>' : '') + '</div></div>' +
    '<div class="radar-row-budget"><span class="radar-cell-label">' + projectAmountLabel(p) + '</span><b class="num">' + projectValue(p.amount) + ' <small>ريال</small></b>' +
    '<span class="radar-row-beneficiaries">' + (p.beneficiaries != null ? '<b class="num">' + projectValue(p.beneficiaries) + '</b> مستفيد' : 'المستفيدون غير محددين') + '</span></div>' +
    '<div class="radar-row-readiness">' + projectReadiness(p) +
    (readiness != null ? '<span class="radar-ready-track" aria-hidden="true"><i style="width:' + Math.min(100, Math.max(0, readiness)) + '%"></i></span>' : '') + '</div>' +
    radarProjectOwner(p) + projectActions(p) + '</article>';
};

function radarProjectActiveFilters() {
  return Object.entries(pF).filter(([key, value]) => key !== 'sort' && value && value !== 'all').length;
}

pList = function () {
  const rows = pFiltered(), active = radarProjectActiveFilters();
  const modes = [['list', 'عرض القائمة', 'menu'], ['covers', 'عرض الأغلفة', 'overview']];
  return '<div class="project-display-bar"><div class="project-result-info"><p class="project-result-count" role="status" aria-live="polite" aria-atomic="true"><b class="num">' + rows.length +
    '</b> من ' + projectCatalogCount() + ' مشروعًا' + (active ? ' <span class="radar-filter-count">· ' + (active === 1 ? 'فلتر واحد مفعّل' : active + ' فلاتر مفعّلة') + '</span>' : '') + '</p>' +
    (projectView === 'covers' ? '<span class="project-cover-note">أغلفة تصورية للمشاريع</span>' : '<span class="project-cover-note">قارن المشاريع وتابع مسؤوليات الفريق</span>') + '</div>' +
    '<div class="project-view-switch" role="group" aria-label="طريقة عرض المشاريع">' + modes.map(([value, label, icon]) => '<button type="button" data-project-view="' + value +
      '" aria-pressed="' + String(projectView === value) + '" aria-controls="projectCollection">' + uiIcon(icon) + '<span>' + label + '</span></button>').join('') + '</div></div>' +
    '<div id="projectCollection" class="cards project-collection project-' + projectView + '">' +
    (rows.length ? (projectView === 'list' ? '<div class="radar-list-head" aria-hidden="true"><span>المشروع وحالة الملف</span><span>التمويل والمستفيدون</span><span>الجاهزية</span><span>المتابعة والتكليف</span><span>الإجراءات</span></div>' : '') + rows.map(pCard).join('') :
      '<div class="project-empty"><h3>لا توجد مشاريع تطابق البحث</h3><p>جرّب عبارة أقصر أو أزل الفلاتر المحددة.</p><button class="btn ghost" type="button" data-radar-reset-filters>مسح البحث والفلاتر</button></div>') + '</div>';
};

const radarOriginalProjectsView = vProjects;
vProjects = function () {
  /* Keep the original options and financial summary, so source rules cannot
     drift from the filtering and export handlers. This template is detached. */
  const template = document.createElement('template');
  template.innerHTML = radarOriginalProjectsView();
  const original = template.content;
  const control = (id, label, cls = '') => {
    const node = original.querySelector('#' + id);
    if (!node) return '';
    node.setAttribute('aria-label', label);
    return '<label class="radar-filter-field ' + cls + '" for="' + id + '"><span>' + label + '</span>' + node.outerHTML + '</label>';
  };
  const visible = PROJ.filter(projectIsVisible);
  const packaged = visible.filter(p => PFILES[p.id]).length;
  const assigned = visible.filter(p => pTrack(p.id).ownerId).length;
  const portfolio = original.querySelector('#projectPortfolioSummary');
  if (portfolio) {
    const label = portfolio.querySelector('.project-portfolio-label b');
    if (label) label.textContent = 'ملخص المحفظة';
  }
  const advanced = ['fld', 'nat', 'aud', 'amt', 'trk'].some(key => pF[key] && pF[key] !== 'all');
  return '<div class="radar-project-header"><div><p class="radar-project-kicker">برامج الجمعية</p><h2>مكتبة المشاريع</h2><p class="lead">من اختيار المشروع إلى تجهيز عرضه ومتابعة تقديمه.</p></div>' +
    '<div class="radar-project-tools"><button type="button" class="btn ghost sm" id="pexp" aria-label="تصدير القائمة (CSV)">' + uiIcon('download') + ' <span class="radar-export-label">تصدير القائمة (CSV)</span></button></div></div>' +
    '<div class="radar-project-overview"><span><b class="num">' + visible.length + '</b> مشروعًا ظاهرًا</span><span><b class="num">' + packaged + '</b> بعروض معتمدة</span><span><b class="num">' + assigned + '</b> مسندة للفريق</span></div>' +
    (portfolio ? portfolio.outerHTML : '') +
    '<div class="radar-project-workspace' + (radarProjectFiltersExpanded ? ' is-filters-expanded' : '') + '"><div class="radar-filter-primary">' +
    control('pq', 'البحث في المشاريع', 'radar-search-label') +
    '<button type="button" class="btn ghost radar-mobile-filter-toggle" aria-expanded="' + radarProjectFiltersExpanded + '" aria-controls="radar-project-primary-options radar-project-secondary-options" data-radar-filter-toggle>الفلاتر</button>' +
    '<div id="radar-project-primary-options" class="radar-primary-options">' + control('pst', 'حالة ملف المشروع') +
    control('ppkg', 'ملفات المشروع') + control('psort', 'ترتيب المشاريع') + '</div></div>' +
    '<div id="radar-project-secondary-options" class="radar-filter-bottom">' + control('projectManagementFilter', 'عرض المشاريع', 'radar-lifecycle-filter') +
    '<details id="radarProjectAdvanced" class="radar-filter-advanced"' + (advanced ? ' open' : '') + '><summary>فلاتر إضافية</summary><div class="radar-filter-grid">' +
    control('pfld', 'المجال') + control('pnat', 'نوع المشروع') + control('paud', 'الفئة المستفيدة') + control('pamt', 'مبلغ الطلب') + control('ptrk', 'مسار التقديم') + '</div></details>' +
    '<button type="button" class="radar-filter-reset" data-radar-reset-filters>مسح الفلاتر</button></div></div>' +
    '<div id="plist">' + pList() + '</div>';
};
VIEWS.projects = vProjects;

function radarSelectProjectPanel(key, focus = false) {
  const box = $('#pbox');
  if (!box || !RADAR_PROJECT_PANELS.some(([id]) => id === key)) return;
  const tab = box.querySelector('[role="tab"][data-radar-project-tab="' + key + '"]');
  if (!tab) return;
  radarProjectTabs.set(box.dataset.pid, key);
  box.querySelectorAll('.radar-detail-tabs [role="tab"]').forEach(button => {
    const selected = button === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  box.querySelectorAll('.radar-detail-panel').forEach(panel => { panel.hidden = panel.dataset.radarPanel !== key; });
  if (focus) {
    tab.focus({ preventScroll: true });
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

const radarOriginalOpenProject = openProj;
openProj = function (id) {
  radarOriginalOpenProject(id);
  const canonical = canonicalProjectId(id), p = PROJ.find(item => item.id === canonical), box = $('#pbox');
  if (!p || !box || box.dataset.pid !== canonical) return;
  const children = [...box.children], header = children[0];
  box.classList.add('radar-project-dialog');
  header.classList.add('radar-detail-header');
  const tabs = document.createElement('div');
  tabs.className = 'radar-detail-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'أقسام المشروع');
  const panels = {};
  for (const [key, label] of RADAR_PROJECT_PANELS) {
    tabs.insertAdjacentHTML('beforeend', '<button type="button" role="tab" id="radar-project-tab-' + key + '" data-radar-project-tab="' + key + '" aria-controls="radar-project-panel-' + key + '" aria-selected="false" tabindex="-1">' + label + '</button>');
    const panel = document.createElement('div');
    panel.id = 'radar-project-panel-' + key;
    panel.className = 'radar-detail-panel';
    panel.dataset.radarPanel = key;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', 'radar-project-tab-' + key);
    panel.tabIndex = 0;
    panels[key] = panel;
  }
  const followupGrid = document.createElement('div'), readinessGrid = document.createElement('div');
  followupGrid.className = readinessGrid.className = 'radar-detail-grid';
  const shortcuts = document.createElement('div');
  shortcuts.className = 'radar-detail-file-shortcut';
  shortcuts.innerHTML = projectPdfLink(p, 'فتح عرض المانحين PDF', 'btn') +
    '<button class="btn ghost" type="button" data-radar-project-tab="files">الملفات والمصادر</button>' +
    '<button class="btn ghost" type="button" data-radar-project-tab="followup">متابعة المشروع وتكليفه</button>';
  const detailed = document.createElement('details');
  detailed.className = 'radar-detail-content';
  detailed.innerHTML = '<summary>محتوى العرض التفصيلي</summary>';
  let hasDetailed = false;

  /* Move the original live nodes. Never clone inputs, save controls or links. */
  for (const node of children.slice(1)) {
    const style = node.getAttribute('style') || '';
    if (node.classList.contains('project-management-context')) {
      node.classList.add('radar-detail-context');
      continue;
    }
    if (node.classList.contains('meta')) {
      node.classList.add('radar-detail-meta'); panels.overview.append(node);
    } else if (node.classList.contains('grid') && style.includes('170px')) {
      node.classList.add('radar-detail-facts'); panels.overview.append(node, shortcuts);
    } else if (node.classList.contains('package-files') || node.classList.contains('project-sources')) {
      panels.files.append(node);
    } else if (node.classList.contains('grid') && style.includes('320px')) {
      for (const child of [...node.children]) {
        if (child.classList.contains('team-assignment') || child.querySelector('[data-pt]')) followupGrid.append(child);
        else readinessGrid.append(child);
      }
      node.remove();
    } else if (node.classList.contains('grid') && style.includes('260px')) {
      node.classList.add('radar-detail-overview-summary'); panels.overview.append(node);
    } else if (node.tagName === 'H3' || node.classList.contains('cards')) {
      detailed.append(node); hasDetailed = true;
    } else if (node === children[children.length - 1] && node.tagName === 'P') {
      node.classList.add('radar-detail-note'); panels.files.append(node);
    } else {
      if (node.classList.contains('next-action')) node.classList.add('radar-detail-next');
      panels.overview.append(node);
    }
  }
  if (!shortcuts.isConnected && !panels.overview.contains(shortcuts)) panels.overview.prepend(shortcuts);
  if (hasDetailed) panels.overview.append(detailed);
  if (followupGrid.children.length) panels.followup.append(followupGrid);
  else panels.followup.innerHTML = '<p class="radar-detail-empty">لا توجد متابعة متاحة لهذا السجل.</p>';
  if (readinessGrid.children.length) panels.readiness.append(readinessGrid);
  else panels.readiness.innerHTML = '<p class="radar-detail-empty">لم يُقيّم هذا السجل للتقديم. راجع الملف والمصادر المتاحة.</p>';
  if (!panels.files.querySelector('.package-files')) panels.files.insertAdjacentHTML('afterbegin', '<p class="radar-detail-empty">لا يوجد عرض مانحين معتمد في الحزمة لهذا السجل. يمكنك الرجوع إلى المصادر المتاحة أدناه.</p>');
  const track = panels.followup.querySelector('[data-pt]')?.closest('.panel');
  if (track) track.querySelector('h3')?.insertAdjacentHTML('afterend', '<p class="radar-detail-note">يُحفظ مسار التقديم عند تغيير الحقول ومغادرتها. استخدم «حفظ التكليف» لحفظ المسؤول والخطوة التالية.</p>');
  const management = children.find(node => node.classList.contains('project-management-context'));
  box.replaceChildren(header);
  if (management) box.append(management);
  box.append(tabs, ...Object.values(panels));
  radarSelectProjectPanel(radarProjectTabs.get(canonical) || 'overview');
  /* These containers are divs: section/form-based draft scope stays #pbox. */
  teamRestoreDrafts(box);
  teamApplyPermissions(box);
  uiPolish(box);
};

/* The same dialog also hosts donor/profile/editor screens. Clear only this
   layer's class when those original screens open. */
const radarOriginalManager = projectManagementOpen;
projectManagementOpen = function (id) { $('#pbox')?.classList.remove('radar-project-dialog'); return radarOriginalManager(id); };
const radarOriginalDonorProfile = openDonorProfile;
openDonorProfile = function (id) { $('#pbox')?.classList.remove('radar-project-dialog'); return radarOriginalDonorProfile(id); };
const radarOriginalDonorEditor = openDonorForm;
openDonorForm = function (id) { $('#pbox')?.classList.remove('radar-project-dialog'); return radarOriginalDonorEditor(id); };

document.addEventListener('click', event => {
  const reset = event.target.closest('[data-radar-reset-filters]');
  if (reset) {
    Object.assign(pF, { q: '', st: 'all', pkg: 'all', fld: 'all', nat: 'all', aud: 'all', amt: 'all', trk: 'all' });
    projectManagementFilter = 'visible';
    radarProjectFiltersExpanded = false;
    renderLive();
    $('#pq')?.focus({ preventScroll: true });
    return;
  }
  const filterToggle = event.target.closest('[data-radar-filter-toggle]');
  if (filterToggle) {
    radarProjectFiltersExpanded = !radarProjectFiltersExpanded;
    filterToggle.setAttribute('aria-expanded', String(radarProjectFiltersExpanded));
    filterToggle.closest('.radar-project-workspace').classList.toggle('is-filters-expanded', radarProjectFiltersExpanded);
    return;
  }
  const tab = event.target.closest('[data-radar-project-tab]');
  if (tab && tab.closest('#pbox')) radarSelectProjectPanel(tab.dataset.radarProjectTab, true);
});

document.addEventListener('keydown', event => {
  const tab = event.target.closest('.radar-detail-tabs [role="tab"]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(tab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
    (index + (event.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  radarSelectProjectPanel(tabs[next].dataset.radarProjectTab, true);
});
