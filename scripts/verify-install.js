'use strict';

// Read-only deployment verification. This script never opens the application
// database, creates an account, reads credentials, or makes a network request.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {config, within} = require('../server/config');
const EXPECTED_FILES = 74;

function failWith(code) { const error = new Error(code); error.verificationCode=code; throw error; }
function entries(value) {
  if (!Array.isArray(value) || value.length !== EXPECTED_FILES) failWith('VERIFY_FILE_COUNT');
  const seen = new Set();
  for (const item of value) {
    if (!item || typeof item.path !== 'string' || path.isAbsolute(item.path) || item.path.includes('\\') ||
        item.path.split('/').some(part => !part || part.startsWith('.')) || seen.has(item.path) ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[0-9a-f]{64}$/.test(item.sha256)) failWith('VERIFY_MANIFEST_ENTRY');
    seen.add(item.path);
  }
  return value;
}

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyInstall(options={}) {
  // config() validates the selected Node runtime and loads node:sqlite without
  // constructing Store or touching RADAR_DATA_DIR.
  const cfg = config(options);
  const catalog = JSON.parse(fs.readFileSync(cfg.catalogPath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(cfg.rootDir, 'private/build-manifest.json'), 'utf8'));
  const allowed = entries(catalog.allowedFiles), originals = entries(manifest.originalAssets);
  if (catalog.version !== manifest.version || manifest.attachments + manifest.covers !== EXPECTED_FILES) failWith('VERIFY_MANIFEST_VERSION');
  const manifestByPath = new Map(originals.map(item => [item.path, item]));
  const appDir = fs.realpathSync(cfg.appDir);
  for (const item of allowed) {
    const expected = manifestByPath.get(item.path);
    if (!expected || item.bytes !== expected.bytes || item.sha256 !== expected.sha256) failWith('VERIFY_CATALOG_MISMATCH');
    const file = fs.realpathSync(path.join(appDir, item.path));
    if (!within(appDir, file)) failWith('VERIFY_ASSET_PATH');
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size !== item.bytes) failWith('VERIFY_ASSET_SIZE');
    if (await digest(file) !== item.sha256) failWith('VERIFY_ASSET_HASH');
  }
  return {node:process.versions.node, files:allowed.length};
}

async function main(args=process.argv.slice(2)) {
  if (args.length) failWith('VERIFY_ARGUMENTS');
  const result = await verifyInstall();
  console.log('Node.js: ' + result.node);
  console.log('عدد الملفات الأصلية: ' + result.files);
  console.log('نجح التحقق من سلامة التثبيت.');
}

if (require.main === module) main().catch(error => {
  console.error('فشل التحقق من سلامة التثبيت: ' + (error.verificationCode || 'VERIFY_CONFIG_OR_FILES'));
  process.exitCode=1;
});
module.exports = {verifyInstall, main};
