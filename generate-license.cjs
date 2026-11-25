#!/usr/bin/env node
/**
 * Lisans Anahtarı Üretim Aracı
 * =============================
 * Kullanım:
 *   node generate-license.cjs <kurumKodu>
 *   node generate-license.cjs 123456
 *   node generate-license.cjs 750012
 *
 * Birden fazla kurum kodu için:
 *   node generate-license.cjs 123456 750012 890001
 *
 * ÖNEMLİ: LICENSE_SECRET proje klasöründeki .env dosyasından okunur ve
 * masaüstü paketine derleme sırasında aynı dosyadan gömülür. .env'i yedekleyin;
 * kaybolursa yeni sürümlerle uyumlu anahtar üretilemez.
 */

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

// .env dosyasını cwd'den ya da bu script'in bulunduğu klasörden yükle (varsa).
try {
  const dotenv = require('dotenv');
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: false });
    }
  }
} catch {
  // dotenv paketi yoksa .env okunamaz; LICENSE_SECRET ortam değişkeni de yoksa araç durur.
}

const LICENSE_SECRET = String(process.env.LICENSE_SECRET || '').trim();

if (!LICENSE_SECRET) {
  console.error('');
  console.error('  HATA: LICENSE_SECRET bulunamadi.');
  console.error('        Bu araci proje klasorunden (.env dosyasinin oldugu yerden) calistirin.');
  console.error('');
  process.exit(1);
}

function generateLicenseKey(kurumKodu) {
  const clean = kurumKodu.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const hmac = crypto.createHmac('sha256', LICENSE_SECRET);
  hmac.update(clean);
  const hex = hmac.digest('hex').substring(0, 16).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('');
  console.log('  Lisans Anahtari Uretim Araci');
  console.log('  ============================');
  console.log('');
  console.log('  Kullanim:');
  console.log('    node generate-license.cjs <kurumKodu> [kurumKodu2] ...');
  console.log('');
  console.log('  Ornek:');
  console.log('    node generate-license.cjs 123456');
  console.log('    node generate-license.cjs 750012 890001');
  console.log('');
  process.exit(0);
}

function ledgerFilePath() {
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'OkulNobetProgrami')
    : path.join(os.homedir(), 'OkulNobetProgrami');
  const pointer = path.join(base, 'lisans-defteri.path');
  try {
    if (fs.existsSync(pointer)) {
      const chosen = fs.readFileSync(pointer, 'utf8').trim();
      if (chosen) return chosen;
    }
  } catch { /* varsayılan dosya */ }
  return path.join(base, 'lisans-defteri.json');
}

function rememberIssuedLicense(kurumKodu, licenseKey) {
  const filePath = ledgerFilePath();
  let licenses = [];
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      licenses = Array.isArray(parsed?.licenses) ? parsed.licenses : [];
    }
  } catch {
    licenses = [];
  }
  if (licenses.some(item => String(item?.kurumKodu || '').toLowerCase() === kurumKodu && !item?.deletedAt)) {
    return 'zaten kayıtlı';
  }
  const now = new Date().toISOString();
  licenses.push({
    id: crypto.randomUUID(),
    kurumKodu,
    okulAdi: `Kurum ${kurumKodu}`,
    licenseKey,
    createdAt: now,
    expiresAt: null,
    isActive: 1,
    lastLoginAt: null,
    updatedAt: now,
    deletedAt: null,
  });
  licenses.sort((a, b) => String(a.kurumKodu).localeCompare(String(b.kurumKodu), 'tr'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, licenses }, null, 2));
  fs.copyFileSync(tmp, filePath);
  fs.rmSync(tmp, { force: true });
  return filePath;
}

function readGithubSettings() {
  let repo = String(process.env.LICENSE_GITHUB_REPO || '').trim();
  let token = String(process.env.LICENSE_GITHUB_TOKEN || '').trim();
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'OkulNobetProgrami')
    : path.join(os.homedir(), 'OkulNobetProgrami');
  const settingsFile = path.join(base, 'lisans-github.json');
  try {
    if (fs.existsSync(settingsFile)) {
      const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (saved?.repo) repo = String(saved.repo).trim();
      if (saved?.token) token = String(saved.token).trim();
    }
  } catch { /* ortam değişkeni kalır */ }
  if (!repo || !token) return null;
  return { repo, token };
}

function pushLedgerToGithub(filePath) {
  const settings = readGithubSettings();
  if (!settings) return Promise.resolve('');
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(settings.repo.replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/, ''));
  if (!match) throw new Error('Depo adı "kullanici/depo" biçiminde olmalı.');
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${settings.token}`,
    'User-Agent': 'okul-nobet-lisans',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const repoUrl = `https://api.github.com/repos/${match[1]}/${match[2]}`;
  const repoRes = fetch(repoUrl, { headers });
  return repoRes.then(async (repo) => {
    const repoBody = await repo.json();
    if (!repo.ok) throw new Error(repoBody.message || 'GitHub deposu okunamadı.');
    if (repoBody.private !== true) throw new Error('Depo herkese açık. Private yapın.');
    const local = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const contentUrl = `${repoUrl}/contents/lisans-defteri.json`;
    const current = await fetch(contentUrl, { headers });
    let sha = '';
    let remote = [];
    if (current.status === 200) {
      const body = await current.json();
      sha = body.sha || '';
      const json = Buffer.from(String(body.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
      remote = JSON.parse(json).licenses || [];
    } else if (current.status !== 404) {
      const body = await current.json().catch(() => ({}));
      throw new Error(body.message || 'Lisans dosyası okunamadı.');
    }
    const byCode = new Map();
    for (const item of [...remote, ...(local.licenses || [])]) {
      const code = String(item.kurumKodu || '').toLowerCase();
      if (!code) continue;
      const prev = byCode.get(code);
      if (!prev || String(item.updatedAt || '') >= String(prev.updatedAt || '')) byCode.set(code, item);
    }
    const licenses = [...byCode.values()];
    const put = await fetch(contentUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Lisans defteri güncellendi',
        content: Buffer.from(JSON.stringify({ version: 1, licenses }, null, 2), 'utf8').toString('base64'),
        ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok) {
      const body = await put.json().catch(() => ({}));
      throw new Error(body.message || 'GitHub güncellenemedi.');
    }
    return settings.repo;
  });
}

console.log('');
console.log('  Kurum Kodu          Lisans Anahtari');
console.log('  ─────────────────   ───────────────────');

for (const raw of args) {
  const clean = raw.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const key = generateLicenseKey(clean);
  let note = '';
  try {
    const recorded = rememberIssuedLicense(clean, key);
    note = recorded === 'zaten kayıtlı' ? '  (defterde var)' : '  (deftere işlendi)';
  } catch (err) {
    note = '  (deftere yazılamadı)';
  }
  console.log(`  ${clean.padEnd(20)}${key}${note}`);
}

pushLedgerToGithub(ledgerFilePath())
  .then((pushed) => {
    if (pushed) console.log(`  GitHub: ${pushed}`);
  })
  .catch((err) => {
    console.log(`  GitHub yazılamadı: ${err instanceof Error ? err.message : err}`);
  })
  .finally(() => {
    console.log('');
    console.log(`  Yerel kopya: ${ledgerFilePath()}`);
    console.log('');
  });
