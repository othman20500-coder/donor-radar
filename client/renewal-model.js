/* Funding opportunities derived from completed work. This layer changes only
   the in-memory presentation: source records, identifiers, stored follow-up,
   financial awards and original attachment registries remain untouched. */
'use strict';

const RENEWAL_PROJECT_CONTENT = Object.freeze({
  e23: Object.freeze({
    sub: 'تمويل دفعة جديدة لتمكين الأسر المنتجة وتطوير منتجاتها وربطها بفرص البيع.',
    nature: 'تمكين اقتصادي للأسر',
    summary: Object.freeze({
      'فرصة التمويل': 'تنفيذ دفعة جديدة من ريادة الأسر، بخطة تمكين وإنتاج وتسويق تُبنى على تجربة التنفيذ السابقة.',
      'نطاق الدورة الجديدة': 'تحديد الأسر المستهدفة ومسار تطوير المنتجات والتسويق، ثم إعداد موازنة وجدول تنفيذ يناسبان الدفعة الجديدة.',
      'قبل التقديم': 'مراجعة نتائج الدورة السابقة وتوحيد أرقامها، والتحقق من نطاق التنفيذ، ثم تحديد مبلغ الطلب والمستفيدين ومؤشرات قياس التقدم.'
    })
  }),
  e25: Object.freeze({
    sub: 'تمويل دورة جديدة من خدمات مركز صلة الأسري، مع تطوير الوصول إلى الأسر وقياس نتائج الخدمة.',
    nature: 'دعم الأسرة وتنمية المجتمع',
    summary: Object.freeze({
      'فرصة التمويل': 'تمويل دورة جديدة لخدمات مركز صلة الأسري، أو توسعة محددة للخدمة وفق الاحتياج المتجدد.',
      'نطاق الدورة الجديدة': 'تحديد الخدمات والأسر المستهدفة وشركاء الإحالة، مع خطة للتنفيذ والمتابعة وقياس النتائج.',
      'قبل التقديم': 'مراجعة نتائج التنفيذ السابق والفروق في أرقام الصرف، ثم اعتماد نطاق الدورة وميزانيتها وعدد المستفيدين المستهدفين.'
    })
  }),
  e26: Object.freeze({
    sub: 'تمويل مرحلة لتفعيل الخطة الاستراتيجية وتطوير القدرات والحوكمة وقياس الأداء.',
    nature: 'تطوير مؤسسي وتفعيل الاستراتيجية',
    summary: Object.freeze({
      'فرصة التمويل': 'بناء طلب تمويل لمرحلة تفعيل الخطة الاستراتيجية وتطوير القدرات المؤسسية، بالاستفادة من مخرجات المنحة السابقة.',
      'نطاق المرحلة الجديدة': 'اختيار أولويات محددة من الخطة، مثل متابعة الأداء والحوكمة وبناء القدرات، ثم تحويلها إلى أنشطة ومخرجات قابلة للتمويل.',
      'قبل التقديم': 'تحديد نطاق المرحلة الجديدة وفصل تكلفتها عن إعداد الخطة السابق، واعتماد الموازنة والمدة ومؤشرات الإنجاز والجهات المستفيدة.'
    })
  }),
  e27: Object.freeze({
    sub: 'تمويل فترة تشغيل جديدة تستند إلى موازنة محدثة واحتياجات استمرار برامج الجمعية.',
    nature: 'دعم تشغيلي واستدامة',
    summary: Object.freeze({
      'فرصة التمويل': 'إعداد طلب لدعم فترة تشغيل جديدة بما يساعد على استمرار برامج الجمعية وتحسين كفاءة التشغيل.',
      'نطاق الفترة الجديدة': 'تحديد الفترة والبنود التشغيلية المطلوب تمويلها ومساهمة الجمعية، وربطها بالخدمات والبرامج المستفيدة.',
      'قبل التقديم': 'إعداد موازنة محدثة والتحقق من أهلية البنود وشروط الجهة المانحة؛ الاستفادة السابقة لا تعني اعتماد التمويل للفترة الجديدة.'
    })
  }),
  e28: Object.freeze({
    sub: 'تمويل مرحلة تطوير جديدة للمنصة التعليمية، تُحدد بالاستناد إلى نتائج الدراسة السابقة.',
    nature: 'تطوير منصة تعليمية رقمية',
    summary: Object.freeze({
      'فرصة التمويل': 'تطوير طلب تمويل للمرحلة التالية من المنصة التعليمية، بعد مراجعة مخرجات الدراسة السابقة وتحديد ما يلزم تنفيذه.',
      'نطاق المرحلة الجديدة': 'تحديد مكونات مرحلة التطوير ومخرجاتها ومسؤوليات الشركاء، ويمكن أن تبدأ بنطاق تجريبي يُعتمد وفق نتائج الدراسة.',
      'قبل التقديم': 'استكمال التقرير النهائي للدراسة والتحقق من ملكية المخرجات، ثم تحديد النطاق والموازنة والمستفيدين والمدة قبل اعتماد طلب التمويل.'
    })
  })
});

function renewalProjectKey(value) {
  return projectManagementId(value);
}

function isRenewalProject(value) {
  return Object.prototype.hasOwnProperty.call(RENEWAL_PROJECT_CONTENT, renewalProjectKey(value));
}

/* A funding project has one historical source. e24 remains directly readable
   as a record, but is never aliased to p11 for writes or financial tracking. */
function renewalHistoryProjectId(value) {
  const id = renewalProjectKey(value);
  if (id === 'p11' || id === 'e24') return 'e24';
  return isRenewalProject(id) ? id : null;
}

function renewalOriginal(value) {
  const id = renewalHistoryProjectId(value);
  return id ? PROJECT_BASE_BY_ID[id] || null : null;
}

/* Operational requests include hidden active projects, as the existing
   financial summary does. Archive/trash and the historical e24 are excluded. */
function renewalFundingProjects() {
  return PROJ.filter(p => p.id !== 'e24' && projectIsOperational(p) &&
    (p.kind === 'deck' || p.kind === 'renewal'));
}

PST.renewal = ['فرصة تمويل متجدد', 'info'];

const renewalBaseApplyProjectManagement = applyProjectManagement;
applyProjectManagement = function () {
  renewalBaseApplyProjectManagement();
  for (const p of PROJ) {
    if (p.id === 'p11') p.notes = (p.notes || []).map(note => note.replace('محفوظ مستقلًا ضمن المشاريع المنفّذة', 'محفوظ في تبويب «التنفيذ السابق»'));
    if (!isRenewalProject(p)) continue;
    const content = RENEWAL_PROJECT_CONTENT[p.id];
    const fields = projectManagementState(p.id).fields;
    const has = key => Object.prototype.hasOwnProperty.call(fields, key);
    p.kind = 'renewal';
    p.statusKey = 'renewal';
    p.status = PST.renewal[0];
    p.amountBasis = 'proposed';
    p.amount = has('amount') ? fields.amount : null;
    p.beneficiaries = has('beneficiaries') ? fields.beneficiaries : null;
    p.duration = has('duration') ? fields.duration : '';
    if (!has('sub')) p.sub = content.sub;
    if (!has('nature')) p.nature = content.nature;
    p.cost = Number.isFinite(p.amount) && Number.isFinite(p.beneficiaries) && p.beneficiaries > 0
      ? fmt(Math.round(p.amount / p.beneficiaries)) + ' ريال · تكلفة المستفيد المستهدف'
      : '';
    p.contrib = '';
    p.ready = null;
    p.summary = projectManagementClone(content.summary);
    p.sections = [];
    p.notes = [
      'هذه فرصة تمويل لدورة أو مرحلة جديدة قيد التجهيز؛ يُحدد مبلغ الطلب والمستفيدون والمدة في بيانات الفرصة.',
      'نتائج التنفيذ السابق ومبالغه وتواريخه محفوظة في سجل التنفيذ، ولا تُحتسب تلقائيًا ضمن طلب التمويل الجديد.'
    ];
  }
  return PROJ;
};

const renewalBaseProjectIsVisible = projectIsVisible;
projectIsVisible = function (p) {
  return renewalProjectKey(p) !== 'e24' && renewalBaseProjectIsVisible(p);
};

const renewalBaseProjectCanRecommend = projectCanRecommend;
projectCanRecommend = function (p) {
  return renewalProjectKey(p) !== 'e24' && renewalBaseProjectCanRecommend(p);
};

const renewalBaseProjectManagementMatches = projectManagementMatches;
projectManagementMatches = function (p, filter = projectManagementFilter) {
  if (renewalProjectKey(p) === 'e24' && filter === 'visible') return false;
  return renewalBaseProjectManagementMatches(p, filter);
};

const renewalBaseNextAction = nextAction;
nextAction = function (p) {
  if (!isRenewalProject(p)) return renewalBaseNextAction(p);
  const track = pTrack(p.id);
  /* Keep existing submission/award follow-up meaningful and unchanged. */
  if (['مُقدَّم', 'قُبل', 'رُفض'].includes(track.st)) return renewalBaseNextAction(p);
  if (!Number.isFinite(p.amount) || p.amount <= 0) return 'تحديد مبلغ طلب التمويل الجديد وإعداد موازنة توضح بنوده.';
  if (!Number.isFinite(p.beneficiaries) || p.beneficiaries <= 0) return 'تحديد المستفيدين المستهدفين من الدورة أو المرحلة الجديدة.';
  if (!String(p.duration || '').trim()) return 'تحديد مدة تنفيذ الدورة أو المرحلة الجديدة وجدولها.';
  return 'مراجعة نطاق الدورة الجديدة وموازنتها ونتائج التنفيذ السابق، وتجهيز عرض التمويل قبل التقديم.';
};
