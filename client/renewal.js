/* Repeat funding presents the next cycle separately from its documented past. */
'use strict';

PST.done = ['تنفيذ سابق مرتبط', ''];
RADAR_PROJECT_PANELS.push(['history', 'التنفيذ السابق']);

function projectHasExecutionHistory(p) {
  return p && p.id !== 'e24' && !!renewalHistoryProjectId(p);
}

const renewalBaseProjectStatus = projectStatus;
projectStatus = function (p) {
  return renewalBaseProjectStatus(p) + (projectHasExecutionHistory(p)
    ? '<span class="renewal-history-badge">سبق تنفيذه</span>' : '');
};

const renewalBaseAmountLabel = projectAmountLabel;
projectAmountLabel = function (p) {
  return isRenewalProject(p) ? 'طلب التمويل الجديد' : renewalBaseAmountLabel(p);
};

const renewalBaseReadiness = projectReadiness;
projectReadiness = function (p) {
  if (!isRenewalProject(p)) return renewalBaseReadiness(p);
  return '<span class="project-ready is-unrated renewal-readiness">الملف الجديد قيد التجهيز</span>';
};

function renewalCardFacts(html, p, cover) {
  if (!isRenewalProject(p)) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;
  const amount = root.querySelector(cover ? '.project-card-facts dd' : '.radar-row-budget>b');
  if (amount && p.amount == null) {
    amount.textContent = 'قيد التحديد';
    amount.classList.add('renewal-pending');
  }
  if (cover) {
    const facts = root.querySelectorAll('.project-card-facts>div');
    if (facts[1]) {
      facts[1].querySelector('dt').textContent = 'المستفيدون المستهدفون';
      if (p.beneficiaries == null) {
        facts[1].querySelector('dd').textContent = 'قيد التحديد';
        facts[1].querySelector('dd').classList.add('renewal-pending');
      }
    }
  } else {
    const beneficiaries = root.querySelector('.radar-row-beneficiaries');
    if (beneficiaries) beneficiaries.innerHTML = p.beneficiaries == null
      ? 'المستفيدون المستهدفون: قيد التحديد'
      : '<b class="num">' + projectValue(p.beneficiaries) + '</b> مستفيد مستهدف';
  }
  return template.innerHTML;
}

const renewalBaseListCard = projectListCard;
projectListCard = function (p) { return renewalCardFacts(renewalBaseListCard(p), p, false); };
const renewalBaseCoverCard = projectCoverCard;
projectCoverCard = function (p) { return renewalCardFacts(renewalBaseCoverCard(p), p, true); };

const renewalBaseFiltered = pFiltered;
pFiltered = function () {
  const status = pF.st;
  let rows;
  try {
    if (status === 'renewal') pF.st = 'all';
    rows = renewalBaseFiltered();
  } finally { pF.st = status; }
  if (status === 'renewal') rows = rows.filter(projectHasExecutionHistory);
  if (pF.sort === 'status') {
    const order = ['ready', 'deck', 'renewal', 'idea', 'done'];
    rows.sort((a, b) => order.indexOf(a.statusKey) - order.indexOf(b.statusKey));
  }
  return rows;
};

function renewalPortfolioHtml() {
  const portfolio = PROJ.filter(p => p.id !== 'e24' && projectIsOperational(p));
  const funding = renewalFundingProjects();
  const pending = portfolio.filter(p => isRenewalProject(p) && p.amount == null).length;
  const scores = portfolio.map(rScore).filter(value => value != null);
  const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) + '%' : '—';
  const total = funding.reduce((sum, p) => sum + (p.amount || 0), 0);
  const metrics = [
    ['عروض مانحين مُعدّة', portfolio.filter(p => p.statusKey === 'deck').length],
    ['جاهزة تقريبًا', portfolio.filter(p => p.statusKey === 'ready').length],
    ['مشاريع سبق تنفيذها', portfolio.filter(projectHasExecutionHistory).length],
    ['أفكار ومسودات', portfolio.filter(p => p.statusKey === 'idea').length],
    ['متوسط جاهزية الملفات المقيّمة', average],
    ['إجمالي طلبات التمويل المحددة (ريال)', fmt(total)]
  ];
  return '<div class="grid g2 project-metrics" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' +
    metrics.map(([label, value]) => '<div class="panel renewal-metric"><div class="score num">' + value + '</div><div class="empty">' + label + '</div></div>').join('') + '</div>' +
    '<p class="renewal-portfolio-note">' + (pending ? pending + ' فرص متجددة لم يُحدد مبلغ طلبها بعد. ' : '') +
    'يشمل الإجمالي الطلبات المحددة للعروض والفرص المتجددة غير المؤرشفة، بما فيها المخفية. مبالغ التنفيذ السابق محفوظة في التاريخ ولا تُضاف إلى الاحتياج الجديد. اعتماد المنحة يُسجل في مسار التقديم.</p>';
}

const renewalBaseProjectsView = vProjects;
vProjects = function () {
  const template = document.createElement('template');
  template.innerHTML = renewalBaseProjectsView();
  const root = template.content;
  const status = root.querySelector('#pst');
  if (status) {
    status.setAttribute('aria-label', 'حالة فرصة التمويل');
    const previous = status.querySelector('option[value="done"]');
    if (previous) { previous.value = 'renewal'; previous.textContent = 'تمويل متجدد · سبق تنفيذها'; }
    status.value = pF.st;
    for (const option of status.options) option.toggleAttribute('selected', option.value === pF.st);
    const label = status.closest('label')?.querySelector('span');
    if (label) label.textContent = 'حالة فرصة التمويل';
  }
  const portfolio = root.querySelector('#projectPortfolioSummary');
  if (portfolio) {
    portfolio.querySelector('.project-portfolio-content').innerHTML = renewalPortfolioHtml();
    const count = portfolio.querySelector('.project-portfolio-count');
    if (count) count.textContent = PROJ.filter(p => p.id !== 'e24' && projectIsOperational(p)).length + ' فرصة غير مؤرشفة · سجل التنفيذ محفوظ';
  }
  const lead = root.querySelector('.radar-project-header .lead');
  if (lead) lead.textContent = 'فرص جديدة ومتجددة للتمويل؛ خبرة التنفيذ السابق تدعم عرض الدورة القادمة.';
  const overview = root.querySelector('.radar-project-overview');
  if (overview) overview.insertAdjacentHTML('beforeend', '<button type="button" class="renewal-filter-button" data-renewal-filter aria-pressed="' + (pF.st === 'renewal') + '"><b class="num">' +
    PROJ.filter(p => projectIsVisible(p) && projectHasExecutionHistory(p)).length + '</b> فرص سبق تنفيذها</button>');
  const title = root.querySelector('.radar-list-head>span');
  if (title) title.textContent = 'المشروع وحالة الفرصة';
  return template.innerHTML;
};
VIEWS.projects = vProjects;

function renewalHistoryHtml(p) {
  const history = renewalOriginal(p);
  if (!history) return '';
  const summary = Object.entries(history.summary || {}).map(([label, value]) =>
    '<section class="renewal-history-section"><h4>' + esc(label) + '</h4><p>' + esc(value) + '</p></section>').join('');
  const sections = (history.sections || []).filter(item => item.x && item.x !== 'None' && item.x !== 'null').map(item =>
    '<details class="renewal-history-detail"><summary>' + esc(item.t) + '</summary><p>' + esc(item.x.replace(/ ‖ /g, '\n• ')) + '</p></details>').join('');
  return '<section class="renewal-history" aria-label="التنفيذ السابق ونتائجه"><div class="renewal-section-heading"><div><p class="radar-project-kicker">خبرة تدعم فرصة التمويل</p><h3>التنفيذ السابق ونتائجه</h3></div><span class="renewal-history-badge">سجل مرجعي</span></div>' +
    '<p class="renewal-history-intro">' + esc(history.name) + ' — الأرقام والتواريخ التالية تخص التنفيذ السابق. تبقى أي ملاحظات أو اختلافات بين المصادر موضحة كما وردت، ولا تُعامل هذه الأرقام كميزانية أو مستهدفات للدورة الجديدة.</p>' + summary +
    (sections ? '<div class="renewal-history-details">' + sections + '</div>' : '') +
    (p.id !== history.id ? '<button type="button" class="btn ghost sm" data-proj="' + esc(history.id) + '">مصادر التنفيذ السابق ومتابعته</button>' : '<button type="button" class="btn ghost sm" data-radar-project-tab="files">ملفات التنفيذ السابق ومصادره</button>') + '</section>';
}

function renewalCurrentFacts(p) {
  const facts = [
    ['طلب التمويل الجديد (ريال)', p.amount == null ? 'قيد التحديد' : fmt(p.amount)],
    ['المستفيدون المستهدفون', p.beneficiaries == null ? 'قيد التحديد' : fmt(p.beneficiaries)],
    ['مدة الدورة أو المرحلة الجديدة', p.duration || 'تُحدد مع خطة التنفيذ'],
    ['الفئة المستفيدة', p.audience || 'قيد التحديد'],
    ['طبيعة الفرصة', p.nature || 'قيد التحديد']
  ];
  if (p.cost) facts.push(['التكلفة للمستفيد المستهدف', p.cost]);
  return facts.map(([label, value]) => '<div class="panel"><div class="empty">' + esc(label) + '</div><b>' + esc(value) + '</b></div>').join('');
}

const renewalBaseOpenProject = openProj;
openProj = function (id) {
  renewalBaseOpenProject(id);
  const p = PROJ.find(item => item.id === canonicalProjectId(id)), box = $('#pbox');
  if (!p || !box || box.dataset.pid !== p.id) return;
  const historyPanel = box.querySelector('[data-radar-panel="history"]');
  const historyTab = box.querySelector('[role="tab"][data-radar-project-tab="history"]');
  const overview = box.querySelector('[data-radar-panel="overview"]');
  if (!renewalOriginal(p)) {
    const wasSelected = historyTab?.getAttribute('aria-selected') === 'true';
    historyPanel?.remove(); historyTab?.remove();
    if (wasSelected) radarSelectProjectPanel('overview');
    return;
  }
  if (historyPanel) historyPanel.innerHTML = renewalHistoryHtml(p);
  if (isRenewalProject(p)) {
    let facts = overview?.querySelector('.radar-detail-facts');
    if (!facts && overview) {
      facts = document.createElement('div'); facts.className = 'grid radar-detail-facts'; overview.prepend(facts);
    }
    if (facts) facts.innerHTML = renewalCurrentFacts(p);
    overview?.insertAdjacentHTML('afterbegin', '<div class="renewal-current-callout"><div><b>تمويل دورة أو مرحلة جديدة</b><p>استفد من التجربة السابقة وحدّد احتياج التنفيذ القادم.</p></div><div class="renewal-current-actions">' +
      (teamIsAdmin() ? '<button type="button" class="btn sm" data-project-manage="' + esc(p.id) + '">تجهيز بيانات الفرصة</button>' : '') +
      '<button type="button" class="btn ghost sm" data-radar-project-tab="history">اطّلع على التنفيذ السابق</button></div></div>');
    const emptyFiles = box.querySelector('[data-radar-panel="files"]>.radar-detail-empty');
    if (emptyFiles) emptyFiles.textContent = 'عرض تمويل الدورة الجديدة قيد التجهيز. وثائق التنفيذ السابق متاحة في المصادر أدناه للاستفادة منها عند إعداد العرض.';
    if (pTrack(p.id).st) box.querySelector('[data-radar-panel="followup"]')?.insertAdjacentHTML('afterbegin', '<p class="renewal-followup-note">مسار المتابعة المحفوظ باقٍ كما هو. راجع الدورة التي يخصها قبل تحديثه؛ عرض فرصة متجددة لا يعني اعتماد تمويل جديد.</p>');
  } else if (p.id === 'p11') {
    overview?.insertAdjacentHTML('afterbegin', '<div class="renewal-current-callout"><div><b>فرصة واحدة تستند إلى خبرة سابقة</b><p>المرحلتان ضمن مشروع مهارات المستقبل الموحّد. نتائج التنفيذ السابق متاحة لدعم العرض، ومبلغه منفصل عن طلب التمويل الحالي.</p></div><button type="button" class="btn ghost sm" data-radar-project-tab="history">التنفيذ السابق</button></div>');
  } else if (p.id === 'e24') {
    overview?.insertAdjacentHTML('afterbegin', '<div class="renewal-current-callout"><div><b>سجل التنفيذ السابق لمهارات المستقبل</b><p>هذا السجل مرتبط بفرصة مهارات المستقبل الموحّدة؛ يُحفظ للنتائج والمصادر والمتابعة السابقة ولا يمثل طلب تمويل إضافيًا.</p></div><button type="button" class="btn sm" data-proj="p11">فتح فرصة التمويل الحالية</button></div>');
    const track = box.querySelector('[data-pt]')?.closest('.panel')?.querySelector('h3');
    if (track) track.textContent = 'متابعة السجل السابق';
  }
  teamApplyPermissions(box);
};

const renewalBaseOpenManager = projectManagementOpen;
projectManagementOpen = function (id) {
  renewalBaseOpenManager(id);
  const p = PROJ.find(item => item.id === canonicalProjectId(id));
  const form = $('#projectManagementForm');
  if (!p || !isRenewalProject(p) || !form || form.dataset.projectId !== p.id) return;
  const labels = { amount: 'طلب تمويل الدورة أو المرحلة الجديدة (ريال)', beneficiaries: 'عدد المستفيدين المستهدفين', duration: 'مدة الدورة أو المرحلة الجديدة' };
  for (const [key, label] of Object.entries(labels)) {
    const span = form.querySelector('label[for="pm_' + key + '"]>span');
    if (span) span.textContent = label;
  }
  const help = $('#pbox .project-editor-help');
  if (help) help.textContent = 'حدّد بيانات فرصة التمويل القادمة ثم احفظ التعديلات. تبقى مبالغ التنفيذ السابق ونتائجه وتواريخه محفوظة في تبويب «التنفيذ السابق».';
  form.querySelector('[name="duration"]')?.setAttribute('placeholder', 'مثال: 6 أشهر من اعتماد التمويل');
  const reset = form.querySelector('[data-project-management-action="reset"]');
  if (reset) reset.textContent = 'إعادة بيانات الفرصة الافتراضية';
};

const renewalBaseReadForm = projectManagementReadForm;
projectManagementReadForm = function (form, id) {
  const fields = renewalBaseReadForm(form, id);
  if (isRenewalProject(id)) {
    /* Derived defaults differ from the original record. Preserve an explicit
       choice even when it happens to equal the original source wording. */
    for (const key of ['sub', 'nature', 'duration']) {
      fields[key] = form.querySelector('[name="' + key + '"]').value.trim();
    }
    projectManagementValidateRow({ schema: 1, fields }, id);
  }
  return fields;
};

exportCsv = function () {
  const quote = value => { let text = String(value == null ? '' : value); if (/^\s*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; };
  const headers = ['المشروع', 'حالة الفرصة', 'النوع', 'المجالات', 'الفئة', 'طلب التمويل الحالي (ريال)', 'وضع مبلغ الطلب', 'المستفيدون المستهدفون', 'التكلفة للمستفيد', 'مدة التنفيذ المطلوبة', 'الجاهزية %', 'مسار التقديم', 'الجهة المقدَّم لها', 'أنسب جهة', 'سبق تنفيذه', 'الفترة السابقة (مرجعية)', 'التمويل السابق (مرجعي)'];
  const rows = pFiltered().map(p => {
    const track = pTrack(p.id), matched = p.id === 'e24' ? null : matchD(p)[0], history = renewalOriginal(p);
    const amountLabel = p.id === 'e24' ? 'سجل تاريخي؛ ليس طلبًا إضافيًا' : p.amount == null ? 'قيد التحديد' : isRenewalProject(p) ? 'طلب مقترح للدورة الجديدة' : p.amountBasis === 'proposed' ? 'طلب مقترح بحسب العرض' : 'قيمة الطلب المسجلة';
    return [p.name, PST[p.statusKey]?.[0] || p.status, p.nature, p.tags.map(tag => TAGS[tag]).join('، '), p.audience, p.id === 'e24' ? null : p.amount, amountLabel,
      p.id === 'e24' ? null : p.beneficiaries, p.cost, p.id === 'e24' ? '' : p.duration, rScore(p), track.st, byId[track.donor]?.name, matched?.d.name,
      history ? 'نعم' : '', history?.summary?.['الفترة'] || history?.duration || '', history?.summary?.['المبلغ'] || ''].map(quote).join(',');
  });
  return '\ufeff' + [headers.map(quote).join(','), ...rows].join('\r\n');
};

document.addEventListener('click', event => {
  const button = event.target.closest('[data-renewal-filter]');
  if (!button) return;
  pF.st = pF.st === 'renewal' ? 'all' : 'renewal';
  renderLive();
  $('[data-renewal-filter]')?.focus({ preventScroll: true });
});

/* No write is triggered; the first render already uses the funding view. */
applyProjectManagement();
