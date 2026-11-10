'use strict';
// تشغيل رادار على Render: سحب البيانات والعروض من الخادم القديم إلى القرص عند الحاجة،
// ثم ربط private بالقرص، ثم تشغيل التطبيق كما يشغّله passenger.cjs.
// السحب يحدث إن كان القرص بلا قاعدة، أو إن تغيّر RADAR_IMPORT_NONCE عن آخر سحب (يوم التحويل).
// المصدر: سكربت PHP مؤقت على cPanel يرسل سجلات (مسار + محتوى) مشفرة AES-256-GCM بإطارات،
// مفتاحها sha256 للرمز RADAR_IMPORT_TOKEN. إن لزم السحب وفشل، لا يبدأ التطبيق بقرص فارغ.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const DISK = process.env.RADAR_DISK || '/data';
const STATE = path.join(DISK, 'radar-import.json');
const ALLOWED = /^(private|radar-data)\//;

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}

/* يفك الإطارات ثم السجلات أثناء التنزيل، ويكتب كل ملف في مجلد مؤقت على القرص */
async function pull(url, token, stage) {
  const key = crypto.createHash('sha256').update(token).digest();
  const res = await fetch(url, { headers: { 'X-Token': token }, signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (res.status !== 200) throw new Error('المصدر رد ' + res.status + '؛ هل المُصدِّر مرفوع والرمز مطابق؟');
  let enc = Buffer.alloc(0), plain = Buffer.alloc(0), files = 0, bytes = 0;
  let cur = null; // { fd, left }
  const takeRecords = () => {
    for (;;) {
      if (cur) {
        if (!plain.length) return;
        const n = Math.min(cur.left, plain.length);
        fs.writeSync(cur.fd, plain.subarray(0, n));
        plain = plain.subarray(n); cur.left -= n;
        if (cur.left === 0) { fs.closeSync(cur.fd); cur = null; files++; }
        continue;
      }
      if (plain.length < 4) return;
      const nameLen = plain.readUInt32BE(0);
      if (plain.length < 4 + nameLen + 8) return;
      const name = plain.subarray(4, 4 + nameLen).toString('utf8');
      const size = plain.readUInt32BE(4 + nameLen) * 2 ** 32 + plain.readUInt32BE(8 + nameLen);
      plain = plain.subarray(12 + nameLen);
      const parts = name.split('/');
      if (!ALLOWED.test(name) || path.isAbsolute(name) || parts.some((p) => p === '' || p === '.' || p === '..'))
        throw new Error('مسار غير متوقع في الأرشيف: ' + name);
      const dest = path.join(stage, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
      cur = { fd: fs.openSync(dest, 'w', 0o600), left: size };
      if (size === 0) { fs.closeSync(cur.fd); cur = null; files++; }
    }
  };
  for await (const chunk of res.body) {
    bytes += chunk.length;
    enc = Buffer.concat([enc, chunk]);
    while (enc.length >= 4) {
      const n = enc.readUInt32BE(0);
      if (enc.length < 32 + n) break;
      const d = crypto.createDecipheriv('aes-256-gcm', key, enc.subarray(4, 16));
      d.setAuthTag(enc.subarray(16, 32));
      plain = Buffer.concat([plain, d.update(enc.subarray(32, 32 + n)), d.final()]);
      enc = enc.subarray(32 + n);
      takeRecords();
    }
  }
  if (enc.length || plain.length || cur) throw new Error('الأرشيف ناقص');
  return { files, bytes };
}

async function importIfNeeded() {
  const url = process.env.RADAR_IMPORT_URL || '';
  const token = process.env.RADAR_IMPORT_TOKEN || '';
  const nonce = process.env.RADAR_IMPORT_NONCE || '';
  const hasData = fs.existsSync(path.join(DISK, 'radar-data', 'radar.sqlite'));
  if (!url) return 'لا مصدر للسحب';
  if (hasData && (!nonce || readState().nonce === nonce)) return 'البيانات موجودة؛ لا سحب';
  if (!/^https:\/\//.test(url) && !/^http:\/\/127\.0\.0\.1[:/]/.test(url)) throw new Error('RADAR_IMPORT_URL يجب أن يبدأ بـ https://');
  if (token.length < 32) throw new Error('RADAR_IMPORT_TOKEN مطلوب (32 حرفًا على الأقل)');
  const stage = path.join(DISK, '.radar-import-' + crypto.randomBytes(4).toString('hex'));
  try {
    const r = await pull(url, token, stage);
    if (!fs.existsSync(path.join(stage, 'radar-data', 'radar.sqlite'))) throw new Error('الأرشيف بلا radar.sqlite');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const d of ['private', 'radar-data']) {
      const live = path.join(DISK, d);
      if (fs.existsSync(live)) fs.renameSync(live, path.join(DISK, 'prev-' + stamp + '-' + d));
      if (fs.existsSync(path.join(stage, d))) fs.renameSync(path.join(stage, d), live);
    }
    fs.writeFileSync(STATE, JSON.stringify({ nonce, at: new Date().toISOString(), ...r }), { mode: 0o600 });
    return 'سُحب ' + r.files + ' ملفًا (' + r.bytes + ' بايت)' + (hasData ? '؛ السابق محفوظ باسم prev-' + stamp : '');
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/* private داخل المستودع رابط إلى القرص: العروض والفهرس والصفحة المبنية بيانات لا كود */
function linkPrivate() {
  const disk = path.join(DISK, 'private');
  fs.mkdirSync(disk, { recursive: true, mode: 0o700 });
  const local = path.join(ROOT, 'private');
  let st = null;
  try { st = fs.lstatSync(local); } catch {}
  if (st && st.isSymbolicLink() && fs.readlinkSync(local) === disk) return;
  if (st && !st.isSymbolicLink()) throw new Error('private موجود داخل المستودع كمجلد حقيقي؛ أزله ليُربط بالقرص');
  if (st) fs.unlinkSync(local);
  fs.symlinkSync(disk, local, 'dir');
}

(async () => {
  try {
    console.log('رادار: ' + (await importIfNeeded()));
    linkPrivate();
    process.env.RADAR_DATA_DIR ||= path.join(DISK, 'radar-data');
    require('../app.js').start();
  } catch (e) {
    console.error('رادار: تعذر البدء: ' + e.message);
    process.exit(1);
  }
})();
