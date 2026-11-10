/* Donor Radar v10 — authenticated team adapter. Loaded after v9, before boot.
 * Shared records live only on the server. Pending edits and recoverable drafts
 * are held in memory; success is announced only after a confirmed API response.
 */
'use strict';

const TEAM = {
  user: null, csrfToken: '', ready: false, connected: false, expired: false,
  confirmed: {}, versions: {}, revision: 0, observedRevision: 0, members: [], queues: new Map(),
  failures: new Map(), drafts: new Map(), incoming: null, polling: false,
  tab: 'account', admin: {}, adminLoading: {}, adminError: {}, editUser: '',
  importBackup: null, importPreview: null, importName: '', importMode: 'add-only',
  lastSaved: '', lastChecked: '', initialError: '', eventTarget: null,
  forceRendering: false, pollTimer: null, notice: '', pendingSequence: 0
};
const TEAM_BASE = (() => {
  const declared = document.querySelector('meta[name="radar-base"]')?.content;
  const path = declared || location.pathname.replace(/(?:index\.html)?$/, '');
  return new URL(path.endsWith('/') ? path : path + '/', location.origin).pathname;
})();
const TEAM_ROLES = { admin: 'مدير المساحة', editor: 'محرر', viewer: 'مشاهد' };
if (typeof ICONS !== 'undefined') ICONS.users = '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3M16 5a3 3 0 0 1 0 6M21 21v-3a4 4 0 0 0-3-3.87"/>';
const TEAM_ADMIN_CONTROLS = '[data-project-manage],[data-project-management-action],#projectManagementForm [type="submit"],[data-dnadd],[data-dnedit],[data-dnhide],[data-dnrestore],[data-dnreset],[data-dnsave],[data-fin],[data-logo],[data-logo-del],[data-logo-source],[data-logo-verified]';
const TEAM_EDITOR_CONTROLS = '[data-pipe],[data-note],[data-pt],[data-acc],[data-doc],[data-cwf],[data-cwsave],[data-cwstart],[data-hist-add],[data-hist-del],[data-chk-add],[data-rel-add],[data-rel-del],[data-hbox] input,[data-hbox] select,[data-hbox] textarea,[data-cbox] input,[data-rel] input,[data-rel] select,[data-rel] textarea,[data-team-assignment] input,[data-team-assignment] select,[data-team-assignment] textarea,[data-team-assignment] [type="submit"]';
const TEAM_EDITABLE_CONTROLS = TEAM_ADMIN_CONTROLS + ',' + TEAM_EDITOR_CONTROLS;
const TEAM_APPEND_BUTTONS = '[data-dnsave],[data-dnreset],[data-hist-add],[data-chk-add],[data-rel-add]';
const TEAM_FIELD_NAMES = { st: 'المرحلة', stage: 'المرحلة', donor: 'الجهة المانحة', note: 'الملاحظة', awarded: 'التمويل المعتمد', res: 'نتيجة التقديم', ownerId: 'المسؤول', nextAction: 'الخطوة التالية', dueDate: 'الموعد', fields: 'بيانات المشروع', visibility: 'الظهور', lifecycle: 'حالة المشروع', previousLifecycle: 'الحالة السابقة', schema: 'تنسيق السجل', f: 'بيانات الجهة', hidden: 'الإخفاء', list: 'السجل', log: 'التواصل', date: 'التاريخ', saved: 'حفظ الفرصة', exp: 'تاريخ الانتهاء', iss: 'تاريخ الإصدار', verified: 'التحقق', source: 'المصدر', dataUrl: 'الشعار', aid: 'الشعار', mergePreviousRecords: 'المتابعة السابقة' };

function teamUrl(path) { return TEAM_BASE + String(path).replace(/^\/+/, ''); }
function teamIsAdmin() { return TEAM.ready && TEAM.user?.role === 'admin'; }
function teamCanEdit() { return TEAM.ready && ['admin', 'editor'].includes(TEAM.user?.role); }
function teamClean(value) { return cleanStoredValue(value); }
function teamClone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function teamDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ar-SA', { calendar: 'gregory', timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }) : String(value);
}
function teamRecordTitle(key) {
  const user = TEAM.admin.users?.users?.find(item => item.id === key) || TEAM.members.find(item => item.id === key);
  if (user) return user.displayName;
  const pid = key.replace(/^(proj_|pm_)/, '');
  if (/^(proj_|pm_)/.test(key)) return PROJ.find(p => p.id === canonicalProjectId(pid))?.name || key;
  if (key.startsWith('cw_')) return DATA.calls.find(call => callKey(call) === key)?.title || 'فرصة تمويل';
  if (key.startsWith('doc_')) return DOCS[key.slice(4)]?.[0] || 'وثيقة الجمعية';
  const did = key.replace(/^(dn_|rel_|hist_|chk_|acc_|logo_)/, '');
  return byId[did]?.name || (key === 'fin_cfg' ? 'المؤشرات المالية' : key);
}
function teamError(message, code, status, payload) {
  const error = new Error(message); Object.assign(error, { code, status, payload }); return error;
}
async function teamApi(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const method = options.method || 'GET';
  const headers = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = TEAM.csrfToken;
  try {
    const response = await fetch(teamUrl(path), {
      method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal
    });
    let payload;
    try { payload = await response.json(); } catch (_) { throw teamError('استجابة غير متوقعة من الخادم. لم يُؤكَّد الحفظ.', 'BAD_RESPONSE', response.status); }
    if (!response.ok) {
      const error = teamError(payload.error || 'تعذر تنفيذ الطلب.', payload.code, response.status, payload);
      if (response.status === 401 || payload.code === 'PASSWORD_CHANGE_REQUIRED') teamSessionExpired(payload.code);
      throw error;
    }
    TEAM.connected = true;
    return payload;
  } catch (error) {
    if (error.status) throw error;
    TEAM.connected = false;
    throw teamError(error.name === 'AbortError' ? 'انتهت مهلة الاتصال. لم يُؤكَّد الحفظ؛ راجع المحاولة قبل إعادتها.' : 'تعذر الاتصال بالخادم. احتُفظ بالتعديل كمسودة في هذه الصفحة.', 'NETWORK', 0);
  } finally { clearTimeout(timeout); }
}

/* Never read or write the old shared store, even if an old control calls it. */
lsRead = function () { return {}; };
lsWrite = function () { return false; };
hasClaude = function () { return false; };
dbc = null;
USER = '';
pendingWrites.clear();

function teamControlKey(el) {
  if (!el?.dataset) return '';
  const d = el.dataset;
  if (d.pt) return 'proj_' + canonicalProjectId(el.closest('#pbox')?.dataset.pid || '');
  if (el.closest('[data-team-assignment]')) return 'proj_' + el.closest('[data-team-assignment]').dataset.teamAssignment;
  if (el.closest('#projectManagementForm')) return 'pm_' + el.closest('#projectManagementForm').dataset.projectId;
  if (d.pipe !== undefined) return d.pipe;
  if (d.note !== undefined) return d.note;
  if (d.acc) return 'acc_' + d.did;
  if (d.doc) return 'doc_' + d.doc;
  if (d.cwk) return d.cwk;
  if (d.fin) return 'fin_cfg';
  for (const name of ['logo', 'logoSource', 'logoVerified']) if (d[name] !== undefined) return 'logo_' + d[name];
  const box = el.closest('[data-hbox],[data-cbox],[data-rel]');
  if (box) return box.dataset.hbox ? 'hist_' + box.dataset.hbox : box.dataset.cbox ? 'chk_' + box.dataset.cbox : 'rel_' + box.dataset.rel;
  if (el.id?.startsWith('dnf-')) return el.closest('#pbox')?.dataset.teamDonorKey || '';
  return '';
}
function teamControlSignature(el) {
  const scope = el.closest('[data-hbox],[data-cbox],[data-rel],#pbox,section[id],form[id]');
  const scopeKey = scope ? [scope.id, scope.dataset.hbox, scope.dataset.cbox, scope.dataset.rel, scope.dataset.pid, scope.dataset.pmId, scope.dataset.teamDonorKey].filter(Boolean).join(':') : '';
  const data = [...el.attributes].filter(a => a.name.startsWith('data-') && !a.name.startsWith('data-team-')).map(a => [a.name, a.value]);
  return JSON.stringify([scopeKey, el.tagName, el.id, el.name, el.type, data, el.id || data.length || el.name ? '' : el.className, el.type === 'checkbox' || el.type === 'radio' ? el.value : '']);
}
function teamControlValue(el) { return { value: el.value, checked: el.checked, type: el.type }; }
function teamSameValue(a, b) { return a && b && a.value === b.value && a.checked === b.checked; }
function teamRememberControl(el) {
  if (!el?.matches('input,select,textarea') || el.type === 'file') return;
  const signature = teamControlSignature(el), existing = TEAM.drafts.get(signature), key = teamControlKey(el);
  const version = existing?.version ?? Number(el.dataset.teamVersion || TEAM.versions[key] || 0);
  const entry = { ...teamControlValue(el), signature, key, version, secret: el.type === 'password', at: new Date().toISOString() };
  TEAM.drafts.set(signature, entry); el.dataset.teamDirty = '1'; el.dataset.teamVersion = String(version);
}
function teamRestoreDrafts(root = document) {
  root.querySelectorAll('input,select,textarea').forEach(el => {
    const draft = TEAM.drafts.get(teamControlSignature(el));
    if (!draft || el.type === 'file') return;
    el.value = draft.value; if (el.type === 'checkbox' || el.type === 'radio') el.checked = draft.checked;
    el.dataset.teamDirty = '1'; el.dataset.teamVersion = String(draft.version);
  });
}
function teamForgetControls(root) {
  if (!root) return;
  const controls = root.matches?.('input,select,textarea') ? [root] : [...root.querySelectorAll('input,select,textarea')];
  controls.forEach(el => { TEAM.drafts.delete(teamControlSignature(el)); delete el.dataset.teamDirty; delete el.dataset.teamVersion; });
}
function teamContext(target = TEAM.eventTarget) {
  let scope = target;
  if (target?.closest) {
    if (target.closest('[data-dnsave],[data-dnreset]')) scope = target.closest('#pbox');
    else if (target.closest('[data-hist-add]')) scope = target.closest('[data-hbox]');
    else if (target.closest('[data-chk-add]')) scope = target.closest('[data-cbox]');
    else if (target.closest('[data-rel-add]')) scope = target.closest('[data-rel]');
    else if (target.closest('[type="submit"]')) scope = target.closest('form');
  }
  const controls = !scope ? [] : scope.matches?.('input,select,textarea') ? [scope] : [...scope.querySelectorAll('input,select,textarea')];
  controls.filter(el => el.type !== 'file').forEach(teamRememberControl);
  const submitted = controls.filter(el => el.type !== 'file').map(el => ({ signature: teamControlSignature(el), ...teamControlValue(el), version: TEAM.drafts.get(teamControlSignature(el))?.version }));
  const donorForm = !!target?.closest?.('[data-dnsave],[data-dnreset]');
  return { submitted, target, donorForm, donorKey: donorForm ? target.closest('#pbox')?.dataset.teamDonorKey : '', lockSignature: target?.matches?.(TEAM_APPEND_BUTTONS) ? teamControlSignature(target) : '', form: scope?.tagName === 'FORM' ? scope : null };
}
function teamClearSubmitted(context) {
  (context?.submitted || []).forEach(item => {
    const current = TEAM.drafts.get(item.signature);
    if (teamSameValue(current, item)) TEAM.drafts.delete(item.signature);
  });
  document.querySelectorAll('[data-team-dirty]').forEach(el => {
    if (!TEAM.drafts.has(teamControlSignature(el))) { delete el.dataset.teamDirty; delete el.dataset.teamVersion; }
  });
}
function teamHasDrafts() { return TEAM.drafts.size > 0; }
function teamHasPending() { return TEAM.queues.size > 0; }
function teamRemoteBlocked() {
  return teamHasDrafts() || teamHasPending() || TEAM.failures.size > 0 || !!document.querySelector('#pmodal:not([hidden]) input,#pmodal:not([hidden]) textarea,#pmodal:not([hidden]) select');
}
function teamCanWriteKey(key) {
  if (!teamCanEdit()) return false;
  return !/^(pm_|dn_|logo_)/.test(key) && key !== 'fin_cfg' || teamIsAdmin();
}
function teamCanonicalKey(key) { return key === 'proj_p15' ? 'proj_p11' : key; }
function teamBuildRow(key, patch, current = PIPE[key] || {}) {
  const cleanPatch = teamClean(patch);
  let base = teamClean(current || {});
  if (key === 'proj_p11') {
    if (!Object.keys(base).length) base = teamClean(PIPE.proj_p15 || {});
    const old = base.mergePreviousRecords;
    const captured = old && typeof old === 'object' && !Array.isArray(old);
    const snapshots = captured ? teamClean(old) : {};
    if (!captured) ['p11', 'p15'].forEach(id => { if (futureMergeHasRow(id)) snapshots[id] = futureMergeSnapshot(PIPE['proj_' + id]); });
    delete cleanPatch.mergePreviousRecords;
    return { ...base, ...cleanPatch, st: cleanPatch.st ?? base.st ?? '', mergePreviousRecords: snapshots };
  }
  if (key.startsWith('pm_')) {
    const id = key.slice(3);
    const row = { ...projectManagementState(id), ...base, ...cleanPatch, schema: 1 };
    projectManagementValidateRow(row, id); return row;
  }
  return { ...base, ...cleanPatch, st: cleanPatch.st ?? base.st ?? '' };
}
function teamQueueWrite(rawKey, patch, context = teamContext()) {
  const key = teamCanonicalKey(rawKey);
  if (!TEAM.ready || TEAM.expired) { teamSessionExpired(); return Promise.resolve(false); }
  if (!teamCanWriteKey(key)) { toast('صلاحية حسابك لا تسمح بهذا التعديل.'); return Promise.resolve(false); }
  if (typeof key !== 'string' || STORE_UNSAFE_KEYS.has(key) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return Promise.resolve(false);
  let row;
  try { row = teamBuildRow(key, patch); } catch (error) { toast(error.message); return Promise.resolve(false); }
  if (TEAM.failures.has(key)) {
    const failure = TEAM.failures.get(key);
    failure.proposed = teamBuildRow(key, patch, failure.proposed);
    failure.patch = { ...failure.patch, ...teamClean(patch) };
    failure.contexts.push(context);
    toast('هذا السجل يحتاج مراجعة محاولة سابقة. احتُفظ بالتعديل ضمن المسودة.');
    teamUpdateStatus(); return Promise.resolve(false);
  }
  let queue = TEAM.queues.get(key);
  if (!queue) {
    const pinned = context.submitted.find(item => Number.isInteger(item.version))?.version;
    queue = { key, items: [], running: false, base: teamClone(TEAM.confirmed[key] || {}), mergeSnapshots: key === 'proj_p11' ? teamClone(row.mergePreviousRecords) : null, expectedVersion: pinned ?? TEAM.versions[key] ?? 0 };
    TEAM.queues.set(key, queue);
  }
  const promise = new Promise(resolve => queue.items.push({ patch: teamClean(patch), context, resolve, sequence: ++TEAM.pendingSequence }));
  PIPE[key] = row;
  rescore(); renderLive(); teamUpdateStatus();
  teamDrainQueue(queue);
  return promise;
}
async function teamDrainQueue(queue) {
  if (queue.running) return;
  queue.running = true;
  while (queue.items.length && TEAM.ready && !TEAM.expired) {
    const item = queue.items[0];
    let value;
    try {
      value = teamBuildRow(queue.key, item.patch, TEAM.confirmed[queue.key] || {});
      if (queue.key === 'proj_p11' && queue.mergeSnapshots) value.mergePreviousRecords = teamClone(queue.mergeSnapshots);
      const result = await teamApi('api/records/' + encodeURIComponent(queue.key), { method: 'PUT', body: { value, expectedVersion: queue.expectedVersion } });
      TEAM.confirmed[queue.key] = teamClean(result.value); TEAM.versions[queue.key] = result.version;
      TEAM.observedRevision = Math.max(TEAM.observedRevision, result.revision || 0); queue.expectedVersion = result.version;
      queue.items.shift(); teamClearSubmitted(item.context);
      let visible = teamClean(result.value);
      queue.items.forEach(next => { visible = teamBuildRow(queue.key, next.patch, visible); });
      PIPE[queue.key] = visible;
      TEAM.lastSaved = new Date().toISOString(); TEAM.connected = true;
      if (!queue.items.length) TEAM.queues.delete(queue.key);
      rescore(); renderLive();
      teamAfterSave(queue.key, item.context); item.resolve(true);
      if (!queue.items.length) toast('تم حفظ التعديل للفريق.');
    } catch (error) {
      const remaining = queue.items.slice();
      const proposed = teamClone(PIPE[queue.key] || value || {});
      const server = error.code === 'VERSION_CONFLICT' ? (error.payload.current || {}) : (TEAM.confirmed[queue.key] || {});
      if (error.code === 'VERSION_CONFLICT') {
        TEAM.confirmed[queue.key] = teamClean(server); TEAM.versions[queue.key] = error.payload.version;
        TEAM.observedRevision = Math.max(TEAM.observedRevision, error.payload.revision || 0);
      }
      if (Object.keys(server).length) PIPE[queue.key] = teamClean(server); else delete PIPE[queue.key];
      TEAM.failures.set(queue.key, { key: queue.key, base: queue.base, proposed, server: teamClone(server), version: TEAM.versions[queue.key] || 0, patch: Object.assign({}, ...remaining.map(next => next.patch)), contexts: remaining.map(next => next.context), error: error.message, code: error.code });
      TEAM.queues.delete(queue.key); queue.items.length = 0;
      remaining.forEach(next => next.resolve(false));
      rescore(); renderLive();
      toast(error.code === 'VERSION_CONFLICT' ? 'عدّل زميل هذا السجل. راجع النسختين قبل الحفظ.' : 'لم يُؤكَّد الحفظ. المسودة متاحة للمراجعة.');
      break;
    } finally { teamUpdateStatus(); }
  }
  if (queue.items.length && TEAM.queues.get(queue.key) === queue) {
    const remaining = queue.items.slice(), server = TEAM.confirmed[queue.key] || {};
    TEAM.failures.set(queue.key, { key: queue.key, base: queue.base, proposed: teamClone(PIPE[queue.key] || {}), server: teamClone(server), version: TEAM.versions[queue.key] || 0, patch: Object.assign({}, ...remaining.map(next => next.patch)), contexts: remaining.map(next => next.context), error: 'توقفت الكتابة لأن الجلسة غير متاحة. راجع المسودة بعد تسجيل الدخول.', code: 'SESSION_EXPIRED' });
    if (Object.keys(server).length) PIPE[queue.key] = teamClean(server); else delete PIPE[queue.key];
    TEAM.queues.delete(queue.key); queue.items.length = 0; remaining.forEach(next => next.resolve(false));
    rescore(); renderLive(); teamUpdateStatus();
  }
  queue.running = false;
}
function teamAfterSave(key, context) {
  if (context?.donorForm && $('#pbox').dataset.teamDonorKey === context.donorKey && $('#pbox').querySelector('[data-dnsave]') && !document.querySelector('#pbox [data-team-dirty]')) $('#pmodal').hidden = true;
  if (key.startsWith('proj_') && !$('#pmodal').hidden && $('#pbox').dataset.pid === key.slice(5) && !document.querySelector('#pbox [data-team-dirty]')) {
    const scroll = $('#pmodal').scrollTop; openProj(key.slice(5)); $('#pmodal').scrollTop = scroll;
  }
}
setPipe = function (key, patch) { teamQueueWrite(key, patch); return false; };
projectManagementCommit = function (id, patch) { teamQueueWrite('pm_' + projectManagementId(id), patch); return false; };

function teamApplyState(data) {
  if (!data?.state || data.revision < TEAM.observedRevision || data.revision < TEAM.revision) return false;
  TEAM.confirmed = teamClean(data.state); TEAM.versions = { ...data.versions }; TEAM.revision = data.revision;
  TEAM.observedRevision = Math.max(TEAM.observedRevision, data.revision);
  TEAM.members = Array.isArray(data.members) ? data.members : [];
  PIPE = teamClone(TEAM.confirmed); TEAM.incoming = null;
  TEAM.lastChecked = data.serverTime || new Date().toISOString(); TEAM.connected = true;
  rescore(); renderLive(); return true;
}
initStore = async function () {
  PIPE = {}; dbc = null; USER = ''; TEAM.ready = false;
  rescore(); renderLive();
  try {
    const session = await teamApi('api/session');
    TEAM.user = session.user; TEAM.csrfToken = session.csrfToken; USER = session.user.displayName;
    if (session.user.mustChangePassword) { location.assign(teamUrl('login')); return; }
    const state = await teamApi('api/state');
    TEAM.ready = true; TEAM.expired = false; TEAM.initialError = '';
    teamApplyState(state); teamHideLock();
    if (!TEAM.pollTimer) TEAM.pollTimer = setInterval(() => teamPoll(), 10000);
    if (cur === 'team') teamLoadAdmin(TEAM.tab);
  } catch (error) {
    TEAM.initialError = error.message;
    if (error.status === 401) location.assign(teamUrl('login'));
    else { teamShowLock('تعذر فتح مساحة الفريق', error.message, false); teamUpdateStatus(); }
  }
};
async function teamPoll(force = false) {
  if (!TEAM.ready || TEAM.expired || TEAM.polling || document.hidden && !force) return;
  TEAM.polling = true;
  try {
    const data = await teamApi('api/state?since=' + TEAM.revision);
    TEAM.lastChecked = data.serverTime || new Date().toISOString();
    if (!data.unchanged && data.state && data.revision >= TEAM.observedRevision && data.revision >= TEAM.revision) {
      const versions = Object.keys(data.versions || {});
      const alreadyKnown = versions.length === Object.keys(TEAM.versions).length && versions.every(key => TEAM.versions[key] === data.versions[key]) && JSON.stringify(data.members || []) === JSON.stringify(TEAM.members);
      if (alreadyKnown) { TEAM.revision = data.revision; TEAM.observedRevision = Math.max(TEAM.observedRevision, data.revision); TEAM.incoming = null; }
      else if (teamRemoteBlocked()) TEAM.incoming = data;
      else teamApplyState(data);
    }
  } catch (error) { if (!TEAM.expired) TEAM.notice = error.message; }
  finally { TEAM.polling = false; teamUpdateStatus(); }
}
async function teamRefresh() {
  if (teamHasPending()) { toast('انتظر تأكيد الطلبات الحالية قبل التحديث.'); return; }
  if (TEAM.failures.size) { teamOpenReview(); return; }
  if (teamHasDrafts() && !confirm('يوجد نص لم يُحفظ. تحديث البيانات سيزيل هذه المسودات من الحقول. هل تريد المتابعة؟')) return;
  TEAM.drafts.clear();
  const pid = !$('#pmodal').hidden && $('#pbox').dataset.pid;
  const pmid = !$('#pmodal').hidden && $('#pbox').dataset.pmId;
  try {
    const data = await teamApi('api/state');
    teamApplyState(data);
    if (pid) openProj(pid); else if (pmid && teamIsAdmin()) projectManagementOpen(pmid); else $('#pmodal').hidden = true;
    TEAM.notice = ''; toast('تحدّثت بيانات الفريق.');
  } catch (error) { toast(error.message); }
}

function teamStatusText() {
  if (TEAM.expired) return 'انتهت الجلسة — الحفظ متوقف';
  if (!TEAM.ready) return TEAM.initialError ? 'الاتصال غير متاح' : 'جارٍ فتح مساحة الفريق…';
  if (TEAM.failures.size) return 'يوجد ' + TEAM.failures.size + ' تعديل يحتاج مراجعة';
  if (teamHasPending()) return 'جارٍ حفظ ' + TEAM.queues.size + ' سجل للفريق…';
  if (!TEAM.connected) return 'تعذر الاتصال — لا يوجد حفظ محلي';
  if (TEAM.incoming) return 'توجد تحديثات جديدة من الفريق';
  if (teamHasDrafts()) return 'توجد حقول لم يُؤكَّد حفظها';
  return TEAM.lastSaved ? 'محفوظ للفريق · ' + teamDate(TEAM.lastSaved) : 'متصل بمساحة الفريق';
}
function teamUpdateStatus() {
  const bar = $('#teamStatus'), label = $('#storageLabel');
  const state = TEAM.expired || TEAM.failures.size ? 'error' : teamHasPending() ? 'pending' : !TEAM.connected ? 'offline' : TEAM.incoming || teamHasDrafts() ? 'attention' : 'saved';
  if (label) { label.className = 'storage-label team-storage'; label.innerHTML = uiIcon('database') + '<span>' + esc(teamStatusText()) + '</span>'; }
  if (bar) {
    bar.dataset.state = state;
    bar.innerHTML = '<div class="team-status-copy"><span class="team-status-dot" aria-hidden="true"></span><span role="status" aria-live="polite">' + esc(teamStatusText()) + '</span></div><div class="team-status-actions">' + (TEAM.failures.size ? '<button type="button" data-team-review>مراجعة التعديلات</button>' : TEAM.incoming ? '<button type="button" data-team-refresh>عرض التحديث</button>' : !TEAM.connected && TEAM.ready ? '<button type="button" data-team-poll>إعادة الاتصال</button>' : '') + '<button type="button" data-go="team">' + esc(TEAM.user?.displayName || 'حساب الفريق') + '</button></div>';
  }
  const account = $('#teamAccountButton');
  if (account) account.innerHTML = uiIcon('users') + '<span>' + esc(TEAM.user?.displayName || 'الفريق') + '</span>';
  teamApplyPermissions(document);
}
function teamApplyPermissions(root) {
  root.querySelectorAll(TEAM_ADMIN_CONTROLS).forEach(el => {
    const allow = teamIsAdmin();
    if (el.matches('input,select,textarea')) el.disabled = !allow;
    else el.hidden = !allow;
    if (!allow) el.title = 'إدارة هذا العنصر متاحة لمدير المساحة.';
  });
  root.querySelectorAll(TEAM_EDITOR_CONTROLS).forEach(el => {
    el.disabled = !teamCanEdit() || !!el.closest('form[data-team-busy="1"]');
    if (!teamCanEdit()) el.title = TEAM.ready ? 'حسابك للعرض؛ اطلب من محرر الفريق إجراء التعديل.' : 'انتظر الاتصال بمساحة الفريق.';
  });
  if (TEAM.user?.role === 'editor') {
    const pid = $('#pbox')?.dataset.pid, row = pid ? pTrack(pid) : {};
    root.querySelectorAll('[data-pt="st"] option').forEach(option => { if (option.value === 'قُبل') option.disabled = true; });
    if (row.st === 'قُبل') root.querySelectorAll('[data-pt="st"],[data-pt="donor"],[data-pt="awarded"]').forEach(el => { el.disabled = true; el.title = 'تغيير التمويل المقبول متاح لمدير المساحة.'; });
  }
  root.querySelectorAll('#whoami').forEach(el => { el.disabled = true; el.value = TEAM.user?.displayName || ''; });
  root.querySelectorAll('.logoctl').forEach(el => { el.hidden = !teamIsAdmin(); });
  root.querySelectorAll(TEAM_APPEND_BUTTONS).forEach(el => {
    const signature = teamControlSignature(el);
    const blocked = [...TEAM.queues.values()].some(queue => queue.items.some(item => item.context.lockSignature === signature)) || [...TEAM.failures.values()].some(failure => failure.contexts.some(context => context.lockSignature === signature));
    el.disabled = !teamCanEdit() || el.matches('[data-dnsave],[data-dnreset]') && !teamIsAdmin() || blocked;
    if (blocked) el.title = 'انتظر تأكيد هذه العملية أو راجع محاولتها السابقة.';
  });
  root.querySelectorAll('#pbox .panel h3 small').forEach(el => {
    if (/محفوظ في هذا المتصفح|مشترك بين من يفتحون الصفحة/.test(el.textContent)) el.textContent = 'متابعة مشتركة للفريق';
  });
  root.querySelectorAll('#pipeline .lead,.foot').forEach(el => {
    if (el.textContent.includes('في هذا المتصفح')) el.textContent = el.textContent.replace('في هذا المتصفح فقط', 'على خادم الفريق').replace('في هذا المتصفح', 'للفريق على الخادم');
  });
  root.querySelectorAll('#pbox p.empty').forEach(el => {
    if (el.textContent.includes('احتفظ بملف index.html')) el.textContent = 'عروض الحزمة الأصلية متاحة للفريق من روابط المشروع بعد تسجيل الدخول. الروابط الخارجية في «المصادر» تتطلب صلاحية الوصول الأصلية.';
  });
}
const teamOriginalRenderLive = renderLive;
renderLive = function () {
  const active = document.activeElement;
  const focus = active?.matches('input,select,textarea') ? { signature: teamControlSignature(active), start: active.selectionStart, end: active.selectionEnd } : null;
  teamOriginalRenderLive(); teamRestoreDrafts(); teamApplyPermissions(document); teamUpdateStatus();
  if (focus) {
    const input = [...document.querySelectorAll('input,select,textarea')].find(el => teamControlSignature(el) === focus.signature && !el.closest('[hidden]'));
    if (input) { input.focus({ preventScroll: true }); try { input.setSelectionRange(focus.start, focus.end); } catch (_) {} }
  }
};
UI_LABELS.team = 'الفريق والحساب';
UI_GROUPS.push(['مساحة الفريق', ['team']]);
VIEWS.team = function () { return teamWorkspaceView(); };
const teamOriginalUiIcon = uiIcon;
uiIcon = function (key) { return teamOriginalUiIcon(key === 'team' ? 'users' : key); };
const teamOriginalInitChrome = initChrome;
initChrome = function () {
  teamOriginalInitChrome();
  const main = $('#main');
  if (!$('#team')) { const section = document.createElement('section'); section.id = 'team'; section.hidden = true; main.appendChild(section); }
  const top = $('.workspace-top');
  if (top) top.insertAdjacentHTML('afterend', '<div id="teamStatus" class="team-status" aria-label="حالة الحفظ المشترك"></div>');
  $('.workspace-actions')?.insertAdjacentHTML('afterbegin', '<button type="button" class="team-account-button" id="teamAccountButton" data-go="team" aria-label="الفريق والحساب"></button>');
  const dataButton = $('[data-data-manager]');
  if (dataButton) dataButton.innerHTML = uiIcon('users') + ' الفريق والحساب';
  document.body.insertAdjacentHTML('beforeend', '<div id="teamLock" class="team-lock" hidden><div class="team-lock-box" role="dialog" aria-modal="true" aria-labelledby="teamLockTitle" tabindex="-1"></div></div>');
  const observer = new MutationObserver(records => {
    if (records.some(record => record.addedNodes.length)) { teamRestoreDrafts(); teamApplyPermissions(document); }
  });
  observer.observe(main, { childList: true, subtree: true });
  observer.observe($('#pbox'), { childList: true, subtree: true });
  teamUpdateStatus();
};
activityPanel = function () {
  const keys = Object.keys(PIPE).filter(key => PIPE[key]?.updatedAt).sort((a, b) => String(PIPE[b].updatedAt).localeCompare(String(PIPE[a].updatedAt))).slice(0, 10);
  return '<section class="panel team-activity"><div class="section-title"><h3>نشاط الفريق</h3><button class="text-link" data-go="team">الحساب والفريق</button></div><p class="team-muted">يظهر اسم الحساب المسجّل مع كل تعديل يؤكده الخادم.</p>' + (keys.length ? '<ul class="list">' + keys.map(key => '<li><div class="t"><b>' + esc(teamRecordTitle(key)) + '</b><span>' + esc(PIPE[key].by || 'حساب الفريق') + ' · ' + esc(teamDate(PIPE[key].updatedAt)) + '</span></div>' + (TEAM.queues.has(key) ? '<span class="chip warn">قيد الحفظ</span>' : '') + '</li>').join('') + '</ul>' : '<p class="empty">يبدأ سجل النشاط مع أول تعديل محفوظ.</p>') + '</section>';
};

function teamAssignmentHtml(id) {
  const row = pTrack(id), member = TEAM.members.find(item => item.id === row.ownerId);
  if (!teamCanEdit()) return '<section class="panel team-assignment"><div class="section-title"><h3>مسؤولية المتابعة</h3><span class="chip">للعرض</span></div><dl class="team-summary"><div><dt>المسؤول</dt><dd>' + esc(member?.displayName || (row.ownerId ? 'حساب غير نشط' : 'لم يُسند بعد')) + '</dd></div><div><dt>الموعد</dt><dd>' + esc(row.dueDate || 'غير محدد') + '</dd></div><div class="team-full"><dt>الخطوة التالية</dt><dd>' + esc(row.nextAction || 'لم تُحدد بعد') + '</dd></div></dl></section>';
  return '<section class="panel team-assignment"><div class="section-title"><h3>مسؤولية المتابعة</h3><span class="chip">للفريق</span></div><p class="team-muted">حدد المسؤول والخطوة التالية، ثم احفظ التكليف.</p><form data-team-assignment="' + esc(id) + '" class="team-form"><div class="team-fields"><label><span>المسؤول عن المشروع</span><select name="ownerId"><option value="">غير مسند</option>' + (row.ownerId && !member ? '<option value="' + esc(row.ownerId) + '" selected>حساب غير نشط — أعد الإسناد</option>' : '') + TEAM.members.map(item => '<option value="' + esc(item.id) + '"' + (row.ownerId === item.id ? ' selected' : '') + '>' + esc(item.displayName) + '</option>').join('') + '</select></label><label><span>الموعد المستهدف</span><input name="dueDate" type="date" value="' + esc(row.dueDate || '') + '"></label><label class="team-full"><span>الخطوة التالية</span><textarea name="nextAction" rows="2" maxlength="2000" placeholder="مثال: مراجعة ميزانية العرض وإرسالها إلى الجهة">' + esc(row.nextAction || '') + '</textarea></label></div><div class="team-form-footer"><button type="submit" class="btn">حفظ التكليف</button><span class="team-muted">الحفظ يظهر لجميع أعضاء الفريق.</span></div><p class="team-form-error" role="alert" hidden></p></form></section>';
}
const teamOriginalOpenProj = openProj;
openProj = function (id) {
  teamOriginalOpenProj(id);
  const canonical = canonicalProjectId(id), box = $('#pbox');
  if (!box || !PROJ.some(p => p.id === canonical)) return;
  delete box.dataset.pmId; delete box.dataset.teamDonorKey;
  const panel = box.querySelector('[data-pt]')?.closest('.panel');
  if (panel) panel.insertAdjacentHTML('beforebegin', teamAssignmentHtml(canonical)); else box.insertAdjacentHTML('beforeend', teamAssignmentHtml(canonical));
  teamRestoreDrafts(box); teamApplyPermissions(box);
};
const teamOriginalDonorForm = openDonorForm;
openDonorForm = function (id) {
  if (!teamIsAdmin()) { toast('تعديل بيانات الجهات متاح لمدير المساحة.'); return; }
  teamOriginalDonorForm(id); delete $('#pbox').dataset.pmId;
  $('#pbox').dataset.teamDonorKey = id ? 'dn_' + id : 'dn_new_draft';
  teamRestoreDrafts($('#pbox')); teamApplyPermissions($('#pbox'));
};
const teamOriginalOpenManager = projectManagementOpen;
projectManagementOpen = function (id) {
  if (!teamIsAdmin()) { toast('إدارة المشاريع متاحة لمدير المساحة.'); return; }
  teamOriginalOpenManager(id); delete $('#pbox').dataset.teamDonorKey;
  $('#pbox').insertAdjacentHTML('beforeend', '<p class="team-shared-note">الإخفاء والأرشفة يغيّران العرض لجميع أعضاء الفريق. تبقى الملفات الأصلية متاحة لكل حساب مسجّل.</p>');
  teamRestoreDrafts($('#pbox')); teamApplyPermissions($('#pbox'));
};

uiOpenDataManager = function () { go('team'); };
uiReadBackup = function (file) { TEAM.tab = 'import'; go('team'); if (teamIsAdmin()) teamReadImport(file); };
uiApplyBackup = function () { return teamApplyImport(); };
uiExportBackup = function () { return teamDownload('api/backup', 'radar-team-state-' + riyadhDateString() + '.json'); };

function teamSessionExpired(code) {
  if (TEAM.expired) return;
  TEAM.expired = true; TEAM.ready = false; TEAM.connected = false;
  teamShowLock(code === 'PASSWORD_CHANGE_REQUIRED' ? 'يلزم تغيير كلمة المرور' : 'انتهت جلسة حسابك', 'توقف الحفظ. بقيت المسودات في هذه الصفحة؛ افتح تسجيل الدخول ثم عُد لإعادة الاتصال.', true);
  teamUpdateStatus();
}
function teamShowLock(title, message, auth) {
  const lock = $('#teamLock'); if (!lock) return;
  lock.hidden = false;
  lock.querySelector('.team-lock-box').innerHTML = '<div class="team-brand-mark" aria-hidden="true">ر</div><h2 id="teamLockTitle">' + esc(title) + '</h2><p>' + esc(message) + '</p><div class="team-lock-actions">' + (auth ? '<a class="btn" href="' + esc(teamUrl('login')) + '" target="_blank" rel="noopener">فتح تسجيل الدخول</a><button class="btn ghost" data-team-reconnect>أعدت تسجيل الدخول</button>' : '<button class="btn" data-team-reconnect>إعادة المحاولة</button>') + '<button class="btn ghost" data-team-download-drafts>تنزيل المسودات</button></div><p class="team-muted">لا تغلق هذه الصفحة قبل حفظ المسودات التي تحتاجها.</p><p class="team-lock-error" role="alert"></p>';
  lock.querySelector('.team-lock-box').focus();
}
function teamHideLock() { if ($('#teamLock')) $('#teamLock').hidden = true; }
async function teamReconnect() {
  try {
    const response = await teamApi('api/session');
    if (response.user.mustChangePassword) { throw Error('غيّر كلمة المرور من صفحة تسجيل الدخول أولًا.'); }
    if (TEAM.user && response.user.id !== TEAM.user.id && (teamHasDrafts() || TEAM.failures.size || teamHasPending())) throw Error('الحساب المفتوح مختلف. ادخل بالحساب السابق أو نزّل المسودات ثم أعد تحميل الصفحة.');
    TEAM.user = response.user; USER = response.user.displayName; TEAM.csrfToken = response.csrfToken;
    TEAM.expired = false; TEAM.ready = true; TEAM.connected = true;
    const data = await teamApi('api/state');
    if (teamRemoteBlocked()) TEAM.incoming = data; else teamApplyState(data);
    teamHideLock(); if (!TEAM.pollTimer) TEAM.pollTimer = setInterval(() => teamPoll(), 10000);
    teamUpdateStatus(); toast('عاد الاتصال. راجع المحاولات غير المؤكدة قبل حفظها.');
  } catch (error) { const target = $('#teamLock .team-lock-error'); if (target) target.textContent = error.message; }
}
function teamExportDrafts() {
  const payload = { format: 'donor-radar-unsaved-drafts', exportedAt: new Date().toISOString(), account: TEAM.user?.username || '', note: 'مسودات غير مؤكدة؛ ليست نسخة استعادة تلقائية. راجعها مع بيانات الفريق قبل الإدخال.', fields: [...TEAM.drafts.values()].filter(entry => !entry.secret), records: [...TEAM.failures.values()].map(f => ({ key: f.key, proposed: f.proposed, error: f.error })), pending: [...TEAM.queues.values()].map(queue => ({ key: queue.key, proposed: PIPE[queue.key] })) };
  return saveFile('radar-unsaved-drafts-' + riyadhDateString() + '.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
}
function teamReviewValue(value, key) {
  if (key === 'dataUrl' || key === 'aid') return value ? 'شعار مرفوع' : 'بلا شعار';
  if (key === 'ownerId') return TEAM.members.find(member => member.id === value)?.displayName || value || 'غير مسند';
  if (value === undefined || value === null || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
function teamOpenReview(key) {
  const failure = TEAM.failures.get(key) || TEAM.failures.values().next().value;
  if (!failure) { toast('لا توجد تعديلات تحتاج مراجعة.'); return; }
  const fields = Object.keys(failure.patch).filter(field => !['at', 'by', 'updatedAt'].includes(field));
  const box = $('#pbox'); delete box.dataset.pid; delete box.dataset.pmId; delete box.dataset.teamDonorKey;
  box.innerHTML = '<div class="team-review"><div class="section-title"><div><p class="team-eyebrow">مراجعة الحفظ</p><h3>' + esc(teamRecordTitle(failure.key)) + '</h3></div><button type="button" class="btn sm ghost" id="pclose">إغلاق</button></div><p class="team-review-warning" role="alert">' + esc(failure.error) + '</p><p>لم تُستبدل نسخة الفريق بهذه المسودة. قارن القيم، ثم اختر حفظ التعديل على النسخة الحالية أو استبعاد المسودة.</p><div class="team-table-wrap"><table class="team-review-table"><thead><tr><th>الحقل</th><th>نسخة الفريق الحالية</th><th>تعديلك المقترح</th></tr></thead><tbody>' + fields.map(field => '<tr><th scope="row">' + esc(TEAM_FIELD_NAMES[field] || field) + '</th><td><pre>' + esc(teamReviewValue(failure.server[field], field)) + '</pre></td><td><pre>' + esc(teamReviewValue(failure.proposed[field], field)) + '</pre></td></tr>').join('') + '</tbody></table></div><div class="team-form-footer"><button type="button" class="btn" data-team-retry="' + esc(failure.key) + '">حفظ التعديل بعد المراجعة</button><button type="button" class="btn ghost" data-team-discard="' + esc(failure.key) + '">اعتماد نسخة الفريق</button><button type="button" class="btn ghost" data-team-download-drafts>تنزيل المسودة</button></div><p class="team-muted">سيعيد الخادم فحص النسخة عند الحفظ. أي تعديل أحدث من زميل سيحتاج مراجعة جديدة.</p>' + (TEAM.failures.size > 1 ? '<nav class="team-review-links" aria-label="باقي التعديلات">' + [...TEAM.failures.keys()].filter(k => k !== failure.key).map(k => '<button class="text-link" data-team-review="' + esc(k) + '">' + esc(teamRecordTitle(k)) + '</button>').join('') + '</nav>' : '') + '</div>';
  $('#pmodal').hidden = false; uiRefineDialog('pmodal', true);
}
async function teamRetryFailure(key) {
  const failure = TEAM.failures.get(key); if (!failure || !TEAM.ready) return;
  if (!confirm('حفظ القيم المقترحة في الحقول المعروضة بدل قيمها الحالية للفريق؟')) return;
  TEAM.failures.delete(key);
  const context = { submitted: [], target: null };
  const ok = await teamQueueWrite(key, failure.patch, context);
  if (ok) { failure.contexts.forEach(teamClearSubmitted); $('#pmodal').hidden = true; renderLive(); }
  else teamOpenReview(key);
}
function teamDiscardFailure(key) {
  const failure = TEAM.failures.get(key); if (!failure) return;
  if (!confirm('استبعاد هذه المسودة واعتماد نسخة الفريق الحالية؟')) return;
  failure.contexts.forEach(teamClearSubmitted); TEAM.failures.delete(key);
  [...TEAM.drafts.entries()].forEach(([signature, entry]) => { if (entry.key === key) TEAM.drafts.delete(signature); });
  $('#pmodal').hidden = true; renderLive(); teamUpdateStatus();
}

/* Team workspace. Admin data is fetched only for the selected admin section. */
function teamWorkspaceView() {
  if (!TEAM.user) return '<div class="team-page"><h2>الفريق والحساب</h2><div class="panel team-empty">جارٍ فتح مساحة الفريق…</div></div>';
  const tabs = [['account', 'حسابي'], ['tasks', 'مهامي']];
  if (teamIsAdmin()) tabs.push(['users', 'أعضاء الفريق'], ['audit', 'سجل النشاط'], ['backups', 'النسخ الاحتياطي'], ['import', 'استيراد البيانات']);
  if (!tabs.some(([key]) => key === TEAM.tab)) TEAM.tab = 'account';
  const current = { account: teamAccountView, tasks: teamTasksView, users: teamUsersView, audit: teamAuditView, backups: teamBackupsView, import: teamImportView }[TEAM.tab];
  return '<div class="team-page"><header class="team-page-header"><div><p class="team-eyebrow">رادار المانحين · مساحة مشتركة</p><h2>الفريق والحساب</h2><p class="lead">المشاريع والمتابعة في مكان واحد، بحساب مستقل لكل عضو.</p></div><span class="team-role-badge">' + esc(TEAM_ROLES[TEAM.user.role]) + '</span></header><nav class="team-tabs" aria-label="إدارة مساحة الفريق">' + tabs.map(([key, title]) => '<button type="button" data-team-tab="' + key + '"' + (TEAM.tab === key ? ' aria-current="page"' : '') + '>' + title + '</button>').join('') + '</nav><div id="teamTabContent">' + current() + '</div></div>';
}
function teamAccountView() {
  const user = TEAM.user;
  const rights = user.role === 'admin' ? 'تدير أعضاء الفريق والمشاريع والنسخ الاحتياطية، وتتابع جميع التعديلات.' : user.role === 'editor' ? 'تحدّث المتابعة والتكليفات والوثائق. اعتماد التمويل وتغيير بيانات المشاريع من صلاحيات المدير.' : 'تطّلع على المشاريع والمتابعة والملفات الأصلية. التعديل متاح للمحرر والمدير.';
  return '<div class="team-account-grid"><section class="panel team-identity"><div class="team-avatar" aria-hidden="true">' + esc(user.displayName.slice(0, 1)) + '</div><h3>' + esc(user.displayName) + '</h3><p class="team-username" dir="ltr">' + esc(user.username) + '</p><span class="team-role-badge">' + esc(TEAM_ROLES[user.role]) + '</span><p class="team-muted">' + rights + '</p><div class="team-identity-footer"><span class="team-status-dot" aria-hidden="true"></span>حساب موثّق لتسجيل التعديلات باسمك</div><button type="button" class="btn ghost team-logout" data-team-logout>تسجيل الخروج</button></section><section class="panel"><div class="section-title"><h3>تغيير كلمة المرور</h3></div><p class="team-muted">استخدم كلمة مرور خاصة بهذا الحساب، من 12 إلى 128 حرفًا. بعد تغييرها تُغلق الجلسات الأخرى للحساب.</p><form id="teamPasswordForm" class="team-form"><label><span>كلمة المرور الحالية</span><input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128" dir="ltr"></label><div class="team-fields"><label><span>كلمة المرور الجديدة</span><input name="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" dir="ltr"></label><label><span>تأكيد كلمة المرور الجديدة</span><input name="confirmPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" dir="ltr"></label></div><p class="team-form-error" role="alert" hidden></p><p class="team-form-success" role="status" hidden></p><div class="team-form-footer"><button type="submit" class="btn">تغيير كلمة المرور</button></div></form></section></div><section class="panel team-shared-explanation"><h3>كيف يعمل الحفظ المشترك؟</h3><p>تُحفظ التعديلات على الخادم باسم حسابك. راقب شريط الحفظ أعلى الصفحة؛ إذا ظهر تعارض أو تعذر اتصال، تبقى المسودة هنا للمراجعة. عند تعديل زميل لنفس السجل ستقارن النسختين قبل إعادة الحفظ.</p><p>إخفاء مشروع يغيّر ظهوره في المكتبة للفريق كله، وتبقى مرفقاته الأصلية متاحة للحسابات المسجلة.</p></section>';
}
function teamTasksView() {
  const projects = PROJ.filter(p => p.id !== 'p15' && pTrack(p.id).ownerId === TEAM.user.id).map(p => ({ p, row: pTrack(p.id) })).sort((a, b) => (a.row.dueDate || '9999').localeCompare(b.row.dueDate || '9999'));
  const overdue = projects.filter(item => item.row.dueDate && daysTo(item.row.dueDate) < 0 && item.row.st !== 'قُبل').length;
  return '<section class="panel"><div class="section-title"><div><h3>مشاريع مسندة إليك</h3><p class="team-muted">المسؤول والخطوة التالية يحددهما الفريق من تفاصيل المشروع.</p></div><span class="chip">' + projects.length + ' مشروع</span></div>' + (overdue ? '<p class="team-inline-warning">' + overdue + ' تكليف تجاوز الموعد المحدد. راجع الخطوة التالية مع الفريق.</p>' : '') + (projects.length ? '<div class="team-task-list">' + projects.map(({ p, row }) => '<article class="team-task"><div class="team-task-main"><button class="team-task-title" data-proj="' + esc(p.id) + '">' + esc(p.name) + '</button><p>' + esc(row.nextAction || 'لم تُحدد خطوة تالية.') + '</p><span class="chip">' + esc(row.st || 'لم يبدأ') + '</span></div><div class="team-task-due' + (row.dueDate && daysTo(row.dueDate) < 0 ? ' is-overdue' : '') + '"><span>الموعد المستهدف</span><b dir="ltr">' + esc(row.dueDate || 'غير محدد') + '</b><button class="text-link" data-proj="' + esc(p.id) + '">فتح المشروع</button></div></article>').join('') + '</div>' : '<div class="team-empty"><h4>لا يوجد تكليف مسند إليك بعد</h4><p>افتح أي مشروع، ثم عيّن المسؤول والخطوة التالية من «مسؤولية المتابعة».</p><button class="btn ghost" data-go="projects">مكتبة المشاريع</button></div>') + '</section>';
}
function teamAdminState(tab) {
  if (TEAM.adminLoading[tab]) return '<p class="team-loading" role="status">جارٍ تحميل البيانات…</p>';
  if (TEAM.adminError[tab]) return '<div class="team-inline-warning" role="alert">' + esc(TEAM.adminError[tab]) + ' <button class="text-link" data-team-load="' + tab + '">إعادة المحاولة</button></div>';
  if (!TEAM.admin[tab]) return '<div class="team-empty"><button class="btn ghost" data-team-load="' + tab + '">تحميل البيانات</button></div>';
  return '';
}
function teamUsersView() {
  const members = TEAM.admin.users?.users || [], edit = members.find(user => user.id === TEAM.editUser);
  return '<section class="panel"><div class="section-title"><div><h3>أعضاء الفريق</h3><p class="team-muted">أنشئ حسابًا مستقلًا لكل موظف وحدّد الصلاحية المناسبة لعمله.</p></div><button class="btn ghost sm" data-team-load="users">تحديث</button></div>' + teamAdminState('users') + (members.length ? '<div class="team-table-wrap"><table class="team-users-table"><thead><tr><th>العضو</th><th>الصلاحية</th><th>الحالة</th><th><span class="sr-only">إدارة العضو</span></th></tr></thead><tbody>' + members.map(user => '<tr><td><b>' + esc(user.displayName) + '</b><span class="team-table-sub" dir="ltr">' + esc(user.username) + '</span></td><td>' + esc(TEAM_ROLES[user.role]) + '</td><td><span class="chip ' + (user.active ? 'good' : '') + '">' + (user.active ? 'نشط' : 'معطّل') + '</span>' + (user.mustChangePassword ? '<span class="team-table-sub">يلزم تغيير كلمة المرور</span>' : '') + '</td><td><button class="btn sm ghost" data-team-edit-user="' + esc(user.id) + '">إدارة</button></td></tr>').join('') + '</tbody></table></div>' : '') + '</section><section class="panel"><div class="section-title"><h3>' + (edit ? 'إدارة حساب ' + esc(edit.displayName) : 'إضافة عضو') + '</h3>' + (edit ? '<button class="text-link" data-team-edit-user="">إضافة عضو جديد</button>' : '') + '</div><form id="teamUserForm" class="team-form" data-user-id="' + esc(edit?.id || '') + '"><div class="team-fields"><label><span>الاسم الظاهر للفريق</span><input name="displayName" maxlength="100" required value="' + esc(edit?.displayName || '') + '" autocomplete="off"></label><label><span>اسم المستخدم</span><input name="username" dir="ltr" value="' + esc(edit?.username || '') + '" autocomplete="off"' + (edit ? ' disabled' : ' required minlength="3" maxlength="120" pattern="[a-z0-9][a-z0-9._@\\-]{2,119}"') + '><small>حروف إنجليزية صغيرة وأرقام، ويمكن استخدام . _ @ -</small></label><label><span>الصلاحية</span><select name="role">' + Object.entries(TEAM_ROLES).map(([key, label]) => '<option value="' + key + '"' + ((edit?.role || 'editor') === key ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label><label><span>' + (edit ? 'إعادة تعيين كلمة المرور (اختياري)' : 'كلمة مرور مؤقتة') + '</span><input name="password" type="password" dir="ltr" autocomplete="new-password" minlength="12" maxlength="128"' + (edit ? '' : ' required') + '><small>' + (edit ? 'اتركها فارغة للإبقاء على كلمة المرور الحالية.' : 'من 12 إلى 128 حرفًا، ويغيّرها العضو عند أول دخول.') + '</small></label>' + (edit ? '<label class="team-check team-full"><input type="checkbox" name="active"' + (edit.active ? ' checked' : '') + '><span>الحساب نشط ويمكنه الدخول</span></label>' : '') + '</div><div class="team-role-guide"><p><b>مشاهد:</b> يطّلع على البيانات والملفات.</p><p><b>محرر:</b> يحدث المتابعة والوثائق والتكليفات.</p><p><b>مدير:</b> يدير المشاريع والمستخدمين واعتماد التمويل والاستيراد والنسخ.</p></div>' + (edit ? '<p class="team-muted">تغيير الصلاحية أو التعطيل أو إعادة كلمة المرور يغلق جلسات هذا الحساب. يبقى مدير نشط واحد على الأقل.</p>' : '<p class="team-muted">بعد إنشاء الحساب، سلّم بيانات الدخول للعضو عبر القناة المعتمدة لديكم. لا تُرسل رسائل تلقائية من هذه الصفحة.</p>') + '<p class="team-form-error" role="alert" hidden></p><div class="team-form-footer"><button type="submit" class="btn">' + (edit ? 'حفظ الحساب' : 'إنشاء الحساب') + '</button>' + (edit ? '<button type="button" class="btn ghost" data-team-edit-user="">إلغاء</button>' : '') + '</div></form></section>';
}
function teamAuditView() {
  const events = TEAM.admin.audit?.events || [];
  const labels = { 'auth.login': 'تسجيل دخول', 'auth.logout': 'تسجيل خروج', 'auth.password_change': 'تغيير كلمة المرور', 'record.update': 'تعديل سجل', 'record.create': 'إنشاء سجل', 'record.import': 'استيراد سجل', 'user.create': 'إضافة عضو', 'user.update': 'تعديل حساب', 'user.password_reset': 'إعادة كلمة المرور', 'backup.import': 'استيراد بيانات', 'backup.create': 'نسخة احتياطية' };
  return '<section class="panel"><div class="section-title"><div><h3>سجل النشاط</h3><p class="team-muted">آخر 100 حدث مسجل على الخادم، مع الحساب والتاريخ والحقول المتغيرة.</p></div><button class="btn ghost sm" data-team-load="audit">تحديث</button></div>' + teamAdminState('audit') + (events.length ? '<div class="team-table-wrap"><table class="team-audit-table"><thead><tr><th>الحساب والتوقيت</th><th>الإجراء</th><th>السجل</th><th>الحقول</th></tr></thead><tbody>' + events.map(event => '<tr><td><b>' + esc(typeof event.actor === 'object' ? event.actor?.displayName || event.actor?.username || 'النظام' : event.actor || 'النظام') + '</b><span class="team-table-sub">' + esc(teamDate(event.at)) + '</span></td><td>' + esc(labels[event.action] || event.action) + '</td><td>' + esc(event.key ? teamRecordTitle(event.key) : '—') + (event.version != null ? '<span class="team-table-sub">نسخة ' + esc(event.version) + '</span>' : '') + '</td><td>' + esc((Array.isArray(event.fields) ? event.fields : []).map(field => TEAM_FIELD_NAMES[field] || field).join('، ') || '—') + '</td></tr>').join('') + '</tbody></table></div>' : TEAM.admin.audit ? '<p class="empty">لا توجد أحداث مسجلة بعد.</p>' : '') + '</section>';
}
function teamBytes(bytes) { return Number(bytes || 0) >= 1048576 ? (Number(bytes) / 1048576).toLocaleString('ar-SA', { maximumFractionDigits: 1 }) + ' م.ب' : (Number(bytes || 0) / 1024).toLocaleString('ar-SA', { maximumFractionDigits: 1 }) + ' ك.ب'; }
function teamBackupsView() {
  const backups = TEAM.admin.backups?.backups || [];
  return '<div class="team-backup-grid"><section class="panel"><span class="team-card-kicker">بيانات الرادار</span><h3>تصدير المتابعة والمشاريع</h3><p class="team-muted">ملف JSON للتحديثات المشتركة، يمكن معاينته واستيراده من قسم استيراد البيانات.</p><button class="btn" data-team-export>تنزيل بيانات الفريق</button></section><section class="panel"><span class="team-card-kicker">قاعدة بيانات كاملة</span><h3>نسخة لاستعادة المساحة</h3><p class="team-muted">نسخة من قاعدة البيانات تشمل حسابات الفريق وسجلات العمل. احتفظ بها في مكان مخصص ومقيّد؛ يستعيدها مسؤول الاستضافة بأداة الاستعادة.</p><button class="btn ghost" data-team-create-backup>إنشاء نسخة الآن</button></section></div><section class="panel"><div class="section-title"><h3>النسخ المحفوظة على الخادم</h3><button class="btn ghost sm" data-team-load="backups">تحديث</button></div>' + teamAdminState('backups') + (backups.length ? '<ul class="team-backup-list">' + backups.map(backup => '<li><div><b>' + esc(teamDate(backup.createdAt)) + '</b><span class="team-table-sub" dir="ltr">' + esc(backup.name) + '</span></div><span class="team-muted">' + teamBytes(backup.bytes) + '</span><button class="btn ghost sm" data-team-download-backup="' + esc(backup.name) + '">تنزيل</button></li>').join('') + '</ul>' : TEAM.admin.backups ? '<p class="empty">لا توجد نسخ مسجلة. أنشئ أول نسخة من الزر أعلاه.</p>' : '') + '<p class="team-muted">نسخة قاعدة البيانات تختلف عن ملف JSON؛ استعادتها تتم بأداة الاستضافة المرفقة.</p></section>';
}
function teamImportView() {
  const preview = TEAM.importPreview;
  return '<section class="panel team-import"><p class="team-card-kicker">نقل البيانات السابقة</p><h3>معاينة نسخة الرادار قبل الاستيراد</h3><p class="team-muted">اختر ملف النسخة الاحتياطية JSON من النسخ السابقة. تفحص المعاينة السجلات والتعارضات قبل أي تغيير في مساحة الفريق.</p><label class="team-file-drop"><span>اختر ملف النسخة الاحتياطية</span><input id="teamImportFile" type="file" accept=".json,application/json"><small>' + esc(TEAM.importName || 'ملف JSON — بحد أقصى 8 ميجابايت') + '</small></label><div id="teamImportError" class="team-form-error" role="alert" hidden></div>' + (preview ? '<div class="team-import-preview"><h4>نتيجة المعاينة</h4><div class="team-import-counts"><div><b>' + preview.total + '</b><span>سجل في الملف</span></div><div><b>' + preview.created.length + '</b><span>سجل جديد</span></div><div><b>' + preview.conflicts.length + '</b><span>سجل موجود مسبقًا</span></div></div>' + (preview.warnings?.length ? '<ul class="team-inline-warning">' + preview.warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '') + (preview.conflicts.length ? '<details class="team-import-overlaps"><summary>السجلات الموجودة مسبقًا (' + preview.conflicts.length + ')</summary><ul>' + preview.conflicts.map(key => '<li>' + esc(teamRecordTitle(key)) + '</li>').join('') + '</ul>' : '') + '<form id="teamImportForm" class="team-form"><fieldset class="team-import-options"><legend>طريقة الاستيراد</legend><label><input type="radio" name="mode" value="add-only"' + (TEAM.importMode === 'add-only' ? ' checked' : '') + '><span><b>إضافة السجلات الجديدة فقط</b><small>تبقى سجلات الفريق الموجودة كما هي. هذا هو الخيار الافتراضي.</small></span></label><label><input type="radio" name="mode" value="replace"' + (TEAM.importMode === 'replace' ? ' checked' : '') + '><span><b>إضافة الجديد واستبدال السجلات المتطابقة</b><small>تستبدل قيم السجلات المعروضة أعلاه بقيم الملف. ينشئ الخادم نسخة قبل التغيير.</small></span></label></fieldset><label class="team-check"><input type="checkbox" name="reviewed" required><span>راجعت أعداد السجلات وطريقة الاستيراد وأريد تطبيقها على مساحة الفريق.</span></label><p class="team-form-error" role="alert" hidden></p><div class="team-form-footer"><button type="submit" class="btn">تطبيق الاستيراد</button><button type="button" class="btn ghost" data-team-cancel-import>إلغاء</button></div></form><p class="team-muted">إذا تغيرت بيانات الفريق بعد هذه المعاينة، ستحتاج معاينة جديدة قبل التطبيق.</p></div>' : '<div class="team-import-steps"><span><b>1</b> اختر الملف</span><span><b>2</b> راجع المعاينة</span><span><b>3</b> أكّد التطبيق</span></div>') + '</section>';
}
async function teamLoadAdmin(tab, force = false) {
  const paths = { users: 'api/users', audit: 'api/audit?limit=100', backups: 'api/backups' };
  if (!teamIsAdmin() || !paths[tab] || TEAM.adminLoading[tab] || TEAM.admin[tab] && !force) return;
  TEAM.adminLoading[tab] = true; TEAM.adminError[tab] = ''; if (cur === 'team') renderLive();
  try { TEAM.admin[tab] = await teamApi(paths[tab]); }
  catch (error) { TEAM.adminError[tab] = error.message; }
  finally { TEAM.adminLoading[tab] = false; if (cur === 'team') renderLive(); }
}
function teamFormError(form, message) {
  const target = form.querySelector('.team-form-error');
  if (target) { target.hidden = !message; target.textContent = message; if (message) { target.tabIndex = -1; target.focus({ preventScroll: true }); } }
}
function teamSetBusy(form, busy, label) {
  form.dataset.teamBusy = busy ? '1' : '';
  form.querySelectorAll('button[type="submit"]').forEach(button => { if (!button.dataset.teamLabel) button.dataset.teamLabel = button.textContent; button.disabled = busy; button.textContent = busy ? label || 'جارٍ الحفظ…' : button.dataset.teamLabel; });
}
async function teamSavePassword(form) {
  if (form.dataset.teamBusy === '1' || !form.reportValidity()) return;
  const currentPassword = form.elements.currentPassword.value, newPassword = form.elements.newPassword.value;
  if (newPassword !== form.elements.confirmPassword.value) { teamFormError(form, 'تأكيد كلمة المرور لا يطابق الكلمة الجديدة.'); return; }
  teamSetBusy(form, true); teamFormError(form, '');
  try {
    const result = await teamApi('api/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
    TEAM.user = result.user; TEAM.csrfToken = result.csrfToken; teamForgetControls(form); form.reset();
    const message = form.querySelector('.team-form-success'); if (message) { message.hidden = false; message.textContent = 'تغيّرت كلمة المرور وأُغلقت الجلسات الأخرى.'; }
    toast('تم تغيير كلمة المرور.');
  } catch (error) { teamFormError(form, error.message); }
  finally { teamSetBusy(form, false); teamUpdateStatus(); }
}
async function teamSaveUser(form) {
  if (!teamIsAdmin() || form.dataset.teamBusy === '1' || !form.reportValidity()) return;
  const id = form.dataset.userId;
  const data = { displayName: form.elements.displayName.value.trim(), role: form.elements.role.value };
  if (id) data.active = form.elements.active.checked; else data.username = form.elements.username.value.trim();
  if (form.elements.password.value) data.password = form.elements.password.value;
  if (id && data.password && !confirm('إعادة تعيين كلمة المرور وإغلاق جلسات هذا الحساب؟ سيُلزم العضو بتغييرها عند دخوله.')) return;
  teamSetBusy(form, true); teamFormError(form, '');
  try {
    const result = await teamApi('api/users' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PATCH' : 'POST', body: data });
    teamForgetControls(form); form.reset(); TEAM.editUser = ''; TEAM.admin.users = null;
    if (result.user?.id === TEAM.user.id) { TEAM.user = result.user; USER = result.user.displayName; }
    toast(id ? 'تم تحديث حساب العضو.' : 'أُنشئ الحساب. سيغيّر العضو كلمة المرور عند أول دخول.');
    await teamLoadAdmin('users', true);
  } catch (error) { teamFormError(form, error.message); }
  finally { if (form.isConnected) teamSetBusy(form, false); }
}
async function teamDownload(path, filename) {
  if (!teamIsAdmin()) { toast('تنزيل النسخ الاحتياطية متاح لمدير المساحة.'); return false; }
  try {
    const response = await fetch(teamUrl(path), { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) { const payload = await response.json(); if (response.status === 401) teamSessionExpired(); throw Error(payload.error || 'تعذر تنزيل النسخة.'); }
    const blob = await response.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; a.hidden = true; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000); toast('بدأ تنزيل النسخة الاحتياطية.'); return true;
  } catch (error) { toast(error.message || 'تعذر تنزيل النسخة.'); return false; }
}
async function teamCreateBackup(button) {
  if (!teamIsAdmin() || button.disabled) return;
  button.disabled = true; button.textContent = 'جارٍ إنشاء النسخة…';
  try { await teamApi('api/backups', { method: 'POST', body: {} }); toast('أُنشئت النسخة على الخادم.'); await teamLoadAdmin('backups', true); }
  catch (error) { toast(error.message); }
  finally { if (button.isConnected) { button.disabled = false; button.textContent = 'إنشاء نسخة الآن'; } }
}
async function teamReadImport(file) {
  if (!file || !teamIsAdmin()) return;
  TEAM.importPreview = null; TEAM.importBackup = null; TEAM.importName = file.name; TEAM.importMode = 'add-only';
  try {
    if (file.size > 8 * 1024 * 1024) throw Error('الملف أكبر من 8 ميجابايت.');
    const backup = JSON.parse(await file.text());
    const result = await teamApi('api/import/preview', { method: 'POST', body: { backup } });
    TEAM.importBackup = backup; TEAM.importPreview = result; renderLive();
  } catch (error) {
    renderLive(); const target = $('#teamImportError'); if (target) { target.hidden = false; target.textContent = error instanceof SyntaxError ? 'الملف ليس JSON صالحًا. اختر نسخة احتياطية من الرادار.' : error.message; }
  }
}
async function teamApplyImport(form = $('#teamImportForm')) {
  if (!teamIsAdmin() || !TEAM.importBackup || !TEAM.importPreview || !form || form.dataset.teamBusy === '1' || !form.reportValidity()) return;
  if (teamHasPending() || TEAM.failures.size) { teamFormError(form, 'أكمل مراجعة التعديلات الجارية قبل استيراد بيانات أخرى.'); return; }
  const mode = form.querySelector('[name="mode"]:checked').value;
  if (!confirm(mode === 'replace' ? 'تطبيق الاستيراد واستبدال السجلات المتطابقة في مساحة الفريق بقيم الملف؟' : 'إضافة السجلات الجديدة إلى مساحة الفريق الآن؟')) return;
  teamSetBusy(form, true, 'جارٍ تطبيق الاستيراد…'); teamFormError(form, '');
  try {
    const result = await teamApi('api/import', { method: 'POST', body: { backup: TEAM.importBackup, mode, expectedRevision: TEAM.importPreview.revision } });
    teamForgetControls(form); TEAM.importBackup = null; TEAM.importPreview = null; TEAM.importName = '';
    const data = await teamApi('api/state'); teamApplyState(data);
    toast('اكتمل الاستيراد: ' + result.created + ' جديد، ' + result.updated + ' محدّث، ' + result.skipped + ' دون تغيير.');
  } catch (error) {
    teamFormError(form, error.message);
    if (error.status === 409) { TEAM.importPreview = null; form.insertAdjacentHTML('beforeend', '<button type="button" class="btn ghost" data-team-repreview>إعادة المعاينة</button>'); }
  } finally { if (form.isConnected) teamSetBusy(form, false); }
}
async function teamPreviewAgain() {
  if (!TEAM.importBackup) return;
  try { TEAM.importPreview = await teamApi('api/import/preview', { method: 'POST', body: { backup: TEAM.importBackup } }); teamForgetControls($('#teamImportForm')); renderLive(); }
  catch (error) { toast(error.message); }
}
async function teamLogout() {
  if (teamHasPending()) { toast('انتظر تأكيد الحفظ أو فشله قبل تسجيل الخروج.'); return; }
  if ((teamHasDrafts() || TEAM.failures.size) && !confirm('توجد مسودات غير محفوظة. هل تريد تسجيل الخروج وتركها؟ يمكنك إلغاء الخروج وتنزيلها أولًا من مراجعة الحفظ.')) return;
  try { await teamApi('api/auth/logout', { method: 'POST', body: {} }); TEAM.drafts.clear(); TEAM.failures.clear(); TEAM.ready = false; location.assign(teamUrl('login')); }
  catch (error) { toast(error.message); }
}
async function teamSaveAssignment(form) {
  if (!teamCanEdit() || form.dataset.teamBusy === '1' || !form.reportValidity()) return;
  const patch = { ownerId: form.elements.ownerId.value, nextAction: form.elements.nextAction.value.trim(), dueDate: form.elements.dueDate.value };
  const context = teamContext(form); teamSetBusy(form, true); teamFormError(form, '');
  const ok = await teamQueueWrite('proj_' + form.dataset.teamAssignment, patch, context);
  if (!ok && form.isConnected) teamFormError(form, 'لم يُؤكَّد الحفظ. افتح مراجعة التعديلات من شريط الحفظ.');
  if (form.isConnected) teamSetBusy(form, false);
}
async function teamSaveProjectForm(form) {
  if (!teamIsAdmin() || form.dataset.teamBusy === '1') return;
  const errorTarget = $('#projectManagementError');
  try {
    const fields = projectManagementReadForm(form, form.dataset.projectId), context = teamContext(form);
    teamSetBusy(form, true);
    const ok = await teamQueueWrite('pm_' + projectManagementId(form.dataset.projectId), { fields }, context);
    if (ok && form.isConnected) openProj(form.dataset.projectId);
    else if (errorTarget?.isConnected) { errorTarget.hidden = false; errorTarget.textContent = 'لم يُؤكَّد حفظ المشروع. راجع التعديل من شريط الحفظ.'; }
  } catch (error) { if (errorTarget) { errorTarget.hidden = false; errorTarget.textContent = error.message; } }
  finally { if (form.isConnected) teamSetBusy(form, false); }
}
async function teamProjectAction(button) {
  if (!teamIsAdmin() || button.disabled) return;
  const id = projectManagementId(button.dataset.projectId), action = button.dataset.projectManagementAction;
  const state = projectManagementState(id), project = PROJ.find(p => p.id === id);
  if (!project) return;
  const form = $('#projectManagementForm');
  if (form && projectManagementFormFingerprint(form) !== projectManagementEditFingerprint && !confirm('يوجد تعديل غير محفوظ في بيانات المشروع. هل تريد متابعة هذا الإجراء وترك تعديل النموذج؟')) return;
  const patches = { hide: { visibility: 'hidden' }, show: { visibility: 'visible' }, archive: { lifecycle: 'archived', previousLifecycle: 'active' }, activate: { lifecycle: 'active', previousLifecycle: 'active' }, trash: { lifecycle: 'trashed', previousLifecycle: state.lifecycle === 'archived' ? 'archived' : 'active' }, restore: { lifecycle: state.previousLifecycle === 'archived' ? 'archived' : 'active' }, reset: { fields: {} } };
  if (!patches[action]) return;
  if (['trash', 'reset'].includes(action) && !confirm(action === 'trash' ? 'نقل «' + project.name + '» إلى السلة للفريق؟ يمكن استعادته لاحقًا.' : 'استعادة بيانات الحزمة الأصلية؟ تبقى المتابعة والملفات وحالة المشروع.')) return;
  if (form) teamForgetControls(form);
  button.disabled = true;
  const ok = await teamQueueWrite('pm_' + id, patches[action], { submitted: [], target: button });
  if (ok && button.isConnected) projectManagementOpen(id); else if (button.isConnected) button.disabled = false;
}

/* Capture legacy writes before their synchronous handlers can announce success
 * or rebuild an editor while its request is still pending. */
document.addEventListener('input', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches('input,textarea,select')) return;
  if (target.matches(TEAM_EDITABLE_CONTROLS) || target.closest('.team-form,#projectManagementForm,[data-hbox],[data-cbox],[data-rel]') || target.id.startsWith('dnf-')) teamRememberControl(target);
  teamUpdateStatus();
}, true);
document.addEventListener('change', event => {
  const target = event.target; if (!(target instanceof HTMLElement)) return;
  TEAM.eventTarget = target; queueMicrotask(() => { if (TEAM.eventTarget === target) TEAM.eventTarget = null; });
  if (target.matches(TEAM_ADMIN_CONTROLS) && !teamIsAdmin() || target.matches(TEAM_EDITOR_CONTROLS) && !teamCanEdit() || target.id === 'whoami') { event.stopImmediatePropagation(); event.preventDefault(); teamApplyPermissions(document); return; }
  if (target.dataset.pt) {
    event.stopImmediatePropagation();
    const id = $('#pbox').dataset.pid, field = target.dataset.pt;
    if (!id || !['st', 'donor', 'note', 'res', 'awarded'].includes(field)) return;
    let value = target.value;
    if (field === 'awarded' && value.trim()) { const number = fnum(value); if (number == null) { toast('أدخل مبلغًا صالحًا غير سالب.'); return; } value = String(number); }
    teamRememberControl(target); teamQueueWrite('proj_' + id, { [field]: value }, teamContext(target)); return;
  }
  if (target.id === 'teamImportFile') { event.stopImmediatePropagation(); teamReadImport(target.files[0]); return; }
  if (target.closest('#teamImportForm') && target.name === 'mode') TEAM.importMode = target.value;
  if (target.matches(TEAM_EDITABLE_CONTROLS) && target.type !== 'file') teamRememberControl(target);
}, true);
document.addEventListener('submit', event => {
  const form = event.target;
  const action = form.id === 'projectManagementForm' ? teamSaveProjectForm : form.dataset.teamAssignment ? teamSaveAssignment : form.id === 'teamPasswordForm' ? teamSavePassword : form.id === 'teamUserForm' ? teamSaveUser : form.id === 'teamImportForm' ? teamApplyImport : null;
  if (!action) return;
  event.preventDefault(); event.stopImmediatePropagation(); action(form);
}, true);
document.addEventListener('click', event => {
  const element = event.target; if (!(element instanceof Element)) return;
  const target = element.closest('button,a,input,label');
  TEAM.eventTarget = target || element; queueMicrotask(() => { if (TEAM.eventTarget === target || TEAM.eventTarget === element) TEAM.eventTarget = null; });
  const restricted = element.closest(TEAM_ADMIN_CONTROLS);
  if (restricted && !teamIsAdmin() || element.closest(TEAM_EDITOR_CONTROLS) && !teamCanEdit()) { event.preventDefault(); event.stopImmediatePropagation(); toast(TEAM.ready ? 'صلاحية حسابك لا تسمح بهذا التعديل.' : 'انتظر الاتصال بمساحة الفريق.'); return; }
  const projectAction = element.closest('[data-project-management-action]');
  if (projectAction) { event.preventDefault(); event.stopImmediatePropagation(); teamProjectAction(projectAction); return; }
  const button = element.closest('[data-team-tab],[data-team-load],[data-team-edit-user],[data-team-review],[data-team-retry],[data-team-discard],[data-team-refresh],[data-team-poll],[data-team-reconnect],[data-team-download-drafts],[data-team-logout],[data-team-export],[data-team-create-backup],[data-team-download-backup],[data-team-cancel-import],[data-team-repreview]');
  if (!button) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (button.hasAttribute('data-team-tab')) { TEAM.tab = button.dataset.teamTab; renderLive(); teamLoadAdmin(TEAM.tab); }
  else if (button.hasAttribute('data-team-load')) teamLoadAdmin(button.dataset.teamLoad, true);
  else if (button.hasAttribute('data-team-edit-user')) { teamForgetControls($('#teamUserForm')); TEAM.editUser = button.dataset.teamEditUser; renderLive(); $('#teamUserForm input')?.focus(); }
  else if (button.hasAttribute('data-team-review')) teamOpenReview(button.dataset.teamReview);
  else if (button.hasAttribute('data-team-retry')) teamRetryFailure(button.dataset.teamRetry);
  else if (button.hasAttribute('data-team-discard')) teamDiscardFailure(button.dataset.teamDiscard);
  else if (button.hasAttribute('data-team-refresh')) teamRefresh();
  else if (button.hasAttribute('data-team-poll')) teamPoll(true);
  else if (button.hasAttribute('data-team-reconnect')) teamReconnect();
  else if (button.hasAttribute('data-team-download-drafts')) teamExportDrafts();
  else if (button.hasAttribute('data-team-logout')) teamLogout();
  else if (button.hasAttribute('data-team-export')) uiExportBackup();
  else if (button.hasAttribute('data-team-create-backup')) teamCreateBackup(button);
  else if (button.hasAttribute('data-team-download-backup')) teamDownload('api/backups/' + encodeURIComponent(button.dataset.teamDownloadBackup), button.dataset.teamDownloadBackup);
  else if (button.hasAttribute('data-team-cancel-import')) { teamForgetControls($('#teamImportForm')); TEAM.importBackup = null; TEAM.importPreview = null; TEAM.importName = ''; renderLive(); }
  else if (button.hasAttribute('data-team-repreview')) teamPreviewAgain();
}, true);
document.addEventListener('keydown', event => {
  const lock = $('#teamLock');
  if (lock && !lock.hidden) {
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); }
    if (event.key === 'Tab') {
      const list = [...lock.querySelectorAll('button:not([disabled]),a[href]')], first = list[0], last = list[list.length - 1];
      if (event.shiftKey && (document.activeElement === first || !list.includes(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
}, true);
window.addEventListener('beforeunload', event => {
  if (TEAM.ready && (teamHasPending() || TEAM.failures.size || teamHasDrafts()) || TEAM.expired && (TEAM.failures.size || teamHasDrafts())) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('online', () => teamPoll(true));
window.addEventListener('offline', () => { TEAM.connected = false; teamUpdateStatus(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) teamPoll(); });
