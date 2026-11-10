'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {userInput} = require('./validation');

const FILENAME = 'initial-admin-credentials.json';
const META_KEY = 'initial_admin_credentials';
const FORMAT = 'radar-initial-admin-credentials';
const setupIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const credentialPath = dataDir => path.join(dataDir, FILENAME);

function readCredentialFile(dataDir) {
  const file = credentialPath(dataDir);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 8192 || (stat.mode & 0o077) !== 0) {
      throw new Error('ملف التهيئة غير صالح أو صلاحياته غير خاصة.');
    }
    let value;
    try { value = JSON.parse(fs.readFileSync(fd, 'utf8')); }
    catch { throw new Error('تعذر التحقق من ملف التهيئة الخاص.'); }
    if (value?.format !== FORMAT || value.version !== 1 || !setupIdPattern.test(value.setupId) || typeof value.username !== 'string') {
      throw new Error('تعذر التحقق من هوية ملف التهيئة الخاص.');
    }
    return value;
  } finally { fs.closeSync(fd); }
}

function stageCredentials(cfg, username, displayName) {
  const input = userInput({username, displayName, role:'admin', password:crypto.randomBytes(32).toString('base64url')});
  const setupId = crypto.randomUUID(), file = credentialPath(cfg.dataDir);
  fs.mkdirSync(cfg.dataDir, {recursive:true, mode:0o700});
  fs.chmodSync(cfg.dataDir, 0o700);
  // O_EXCL rejects an existing file, including a symlink. Never overwrite it.
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  let written = false;
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, JSON.stringify({
      format:FORMAT, version:1, setupId, createdAt:new Date().toISOString(),
      username:input.username, displayName:input.displayName,
      loginUrl:cfg.publicUrl + '/login', password:input.password,
      instruction:'كلمة مرور مؤقتة. غيّرها عند أول دخول. يُحذف هذا الملف بعد نجاح التغيير.'
    }, null, 2) + '\n');
    fs.fsyncSync(fd);
    const directoryFd = fs.openSync(cfg.dataDir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    written = true;
  } finally {
    fs.closeSync(fd);
    if (!written) { try { fs.unlinkSync(file); } catch {} }
  }
  return {input, setupId, file};
}

function readMarker(db) {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get(META_KEY);
  if (!row) return null;
  let value;
  try { value = JSON.parse(row.value); }
  catch { throw new Error('سجل التهيئة الخاص غير صالح.'); }
  if (!setupIdPattern.test(value?.setupId) || typeof value.userId !== 'string' || typeof value.username !== 'string') {
    throw new Error('سجل التهيئة الخاص غير صالح.');
  }
  return {...value, serialized:row.value};
}

// Called inside the same transaction that creates the initial administrator.
function registerBootstrap(db, value) {
  if (!setupIdPattern.test(value.setupId) || readMarker(db)) throw new Error('تعذر تسجيل تهيئة المدير الأول.');
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(META_KEY, JSON.stringify(value));
}

function discardUncommittedCredentials(dataDir, db, setupId) {
  // If creation committed, preserve the handoff file even if later work failed.
  const marker = readMarker(db);
  if (marker?.setupId === setupId) return false;
  let value;
  try { value = readCredentialFile(dataDir); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (value.setupId !== setupId) throw new Error('لن يُحذف ملف تهيئة يعود إلى محاولة أخرى.');
  fs.unlinkSync(credentialPath(dataDir));
  return true;
}

function cleanupInitialCredentials({dataDir, db, userId}) {
  const marker = readMarker(db);
  if (!marker) return {status:'none'};
  if (userId !== undefined && marker.userId !== userId) return {status:'different-user'};
  const user = db.prepare('SELECT username,must_change_password FROM users WHERE id=?').get(marker.userId);
  if (!user || user.username !== marker.username) throw new Error('تعذر مطابقة ملف التهيئة مع حساب المدير.');
  if (user.must_change_password) return {status:'pending'};
  let value;
  try { value = readCredentialFile(dataDir); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (value) {
    if (value.setupId !== marker.setupId || value.username !== marker.username) throw new Error('لن يُحذف ملف تهيئة غير مطابق لسجل المدير.');
    fs.unlinkSync(credentialPath(dataDir));
  }
  db.prepare('DELETE FROM meta WHERE key=? AND value=?').run(META_KEY, marker.serialized);
  return {status:'removed'};
}

module.exports = {FILENAME, META_KEY, credentialPath, stageCredentials, registerBootstrap,
  discardUncommittedCredentials, cleanupInitialCredentials};
