import express from 'express';
import path from 'path';
import { mkdirSync, readFileSync, existsSync, renameSync, readdirSync, unlinkSync, writeFileSync, statSync } from 'fs';
import { homedir, networkInterfaces, tmpdir } from 'os';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { config as loadDotenv } from 'dotenv';
import { parseMebCalendarHtml, resolveMebCalendarUrls } from './src/lib/mebCalendarParse.ts';
import { auditSnapshot, changedTopLevelKeys, collectionBase, sanitizeClientName } from './src/lib/auditLog.ts';
import { sanitizeTeacherSwapCreate, teacherCancelSwap } from './src/lib/swapRequests.ts';
import {
  type LedgerEntry,
  ledgerSignature,
  mergeLicenseRecords,
  normalizeLedgerEntry,
  readLedgerFile,
  writeLedgerFile,
} from './src/lib/licenseLedger.ts';
import { parseGithubRepo, syncGithubLedger, type GithubLedgerConfig } from './src/lib/licenseGithub.ts';
import { lanIpv4Addresses } from './src/lib/lanAddresses.ts';

// CJS (pkg/esbuild) ve ESM (tsx dev) ortamlarında güvenle çalışır
const __dirname = process.cwd();

// .env dosyasını hem cwd'den hem de exe'nin bulunduğu klasörden yüklemeyi dene.
// Bu sayede pkg ile paketlendiğinde de exe'nin yanına bir .env konulabilir.
// Ayrıca kullanıcı veri klasörü (%LOCALAPPDATA%\OkulNobetProgrami\.env) de okunur;
// böylece sunucu sahibi kurulu uygulamada özel giriş anahtarını ayrı bir dosyada
// tutabilir. Bu dosya paketlemeye dahil edilmez, okul kurulumlarına gitmez.
(() => {
  const candidates: string[] = [];
  candidates.push(path.join(process.cwd(), '.env'));
  try {
    const execDir = path.dirname((process as any).execPath || '');
    if (execDir) candidates.push(path.join(execDir, '.env'));
  } catch {}
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'OkulNobetProgrami', '.env'));
  }
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        loadDotenv({ path: p, override: false });
      }
    } catch {}
  }
})();

// .env.example'daki örnek değerler gerçek anahtar sayılmaz.
const PLACEHOLDER_SECRETS = new Set([
  'change-me-in-production-use-a-long-random-string',
]);

function envSecret(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (PLACEHOLDER_SECRETS.has(value)) {
    console.warn(`[auth] ${name} örnek değerde bırakılmış; yok sayıldı.`);
    return undefined;
  }
  return value;
}

if (!envSecret('JWT_SECRET')) {
  console.warn('[auth] JWT_SECRET çevresel değişkeni bulunamadı, veritabanında saklanan rastgele anahtar kullanılacak.');
}

// Sürüm bilgisi: package.json'dan oku, başarısızsa fallback
let APP_VERSION = '0.0.0';
try {
  const pkgPath = path.join(__dirname, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  APP_VERSION = pkg.version || APP_VERSION;
} catch {
  // pkg ile paketlendiğinde package.json okunamayabilir
  try {
    const pkgPath = path.join(path.dirname((process as any).execPath || ''), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    APP_VERSION = pkg.version || APP_VERSION;
  } catch {}
}

// ---- Lisans Sistemi ----
// Yeni kayıtlar yalnızca LICENSE_SECRET ile üretilmiş anahtarı kabul eder. Masaüstü paketinde
// değer derleme sırasında .env'den gömülür (scripts/build-desktop.mjs); kaynak kodda yer almaz.
// Güvenlik için kaynak koddaki eski yer tutucu metin artık hiçbir şekilde sır olarak kullanılmaz;
// ne aktif sır olarak ne de geçmiş anahtarların doğrulanmasında.
const PLACEHOLDER_LICENSE_SECRET = 'okul-nobet-2025-BURAYA-KENDI-GIZLI-ANAHTARINIZI-YAZIN';
declare const __BUILD_LICENSE_SECRET__: string | undefined;
const BUILD_LICENSE_SECRET = typeof __BUILD_LICENSE_SECRET__ === 'string' ? __BUILD_LICENSE_SECRET__ : '';
// Yer tutucu metin gerçek sır sayılmaz; .env'de kalmışsa pakete gömülü sırra öncelik verilir.
function configuredLicenseSecret(value: string | undefined): string {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === PLACEHOLDER_LICENSE_SECRET) return '';
  return trimmed;
}
const LICENSE_SECRET =
  configuredLicenseSecret(process.env.LICENSE_SECRET) ||
  configuredLicenseSecret(BUILD_LICENSE_SECRET);
if (!LICENSE_SECRET) {
  console.warn('[license] LICENSE_SECRET ayarlı değil. Yeni okul kaydı ve şifre sıfırlama için .env dosyasına LICENSE_SECRET ekleyin.');
}

// Özel (süper yönetici) girişi: yazılım sahibinin, hangi bilgisayara kurulursa kurulsun
// giriş yapabilmesi için gömülü bir varsayılan anahtar bulunur. Okul kurulumları bu
// anahtarı bilmediğinden günlük kullanımda özel giriş kullanılmaz.
// Gerekirse her kurulumda .env > SUPER_ADMIN_KEY ile değiştirilebilir.
const SUPER_ADMIN_KEY_ENV = envSecret('SUPER_ADMIN_KEY');
const DEFAULT_SUPER_ADMIN_KEY = '342665';
const SUPER_ADMIN_KEY = SUPER_ADMIN_KEY_ENV || DEFAULT_SUPER_ADMIN_KEY;

function superAdminLoginAllowed(_req: any): boolean {
  return !!SUPER_ADMIN_KEY;
}

/** Token'ı şifreye/anahtara bağlayan kısa parmak izi: şifre değişince eski oturumlar geçersiz olur. */
function secretFingerprint(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function licenseKeyFor(secret: string, kurumKodu: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(kurumKodu);
  const hex = hmac.digest('hex').substring(0, 16).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

function generateLicenseKey(kurumKodu: string): string {
  return licenseKeyFor(LICENSE_SECRET, kurumKodu);
}

function licenseKeyMatches(secret: string, kurumKodu: string, key: string): boolean {
  const cleanKey = key.trim().replace(/-/g, '').toUpperCase();
  const expected = licenseKeyFor(secret, kurumKodu).replace(/-/g, '');
  // Eşit uzunlukta zaman-sabit karşılaştırma
  if (cleanKey.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(cleanKey), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Lisans anahtarı yalnızca güncel LICENSE_SECRET ile üretilmişse geçerlidir. */
function validateLicenseKey(kurumKodu: string, key: string): boolean {
  if (!LICENSE_SECRET) return false;
  return licenseKeyMatches(LICENSE_SECRET, kurumKodu, key);
}

function parseSchoolCodeFromYol(yol?: string): string | null {
  if (!yol) return null;
  const parts = String(yol).split('/');
  const last = parts[parts.length - 1]?.trim();
  if (!last) return null;
  const clean = last.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return clean || null;
}

async function fetchSchoolFromGithubByKurumKodu(kurumKodu: string): Promise<{
  kurumKodu: string;
  okulAdi: string;
  il?: string;
  ilce?: string;
  kaynak: string;
} | null> {
  try {
    const q = encodeURIComponent(`${kurumKodu} repo:MehmetHuseyinDelipalta/MEB-Okul-Veritabani path:"Tüm Okullar" extension:json`);
    const searchRes = await fetch(`https://api.github.com/search/code?q=${q}&per_page=5`, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'okul-nobet-programi',
      },
    });
    if (!searchRes.ok) return null;
    const searchData: any = await searchRes.json();
    const items: any[] = Array.isArray(searchData?.items) ? searchData.items : [];
    if (items.length === 0) return null;

    for (const item of items) {
      if (!item?.url) continue;
      const metaRes = await fetch(item.url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'okul-nobet-programi',
        },
      });
      if (!metaRes.ok) continue;
      const meta: any = await metaRes.json();
      const downloadUrl = meta?.download_url;
      if (!downloadUrl) continue;

      const fileRes = await fetch(downloadUrl, { headers: { 'User-Agent': 'okul-nobet-programi' } });
      if (!fileRes.ok) continue;
      const schools: any = await fileRes.json();
      if (!Array.isArray(schools)) continue;

      const found = schools.find((s) => {
        const code = parseSchoolCodeFromYol(s?.YOL);
        return code === kurumKodu;
      });
      if (found) {
        return {
          kurumKodu,
          okulAdi: String(found.OKUL_ADI || '').trim(),
          il: typeof found.IL === 'string' ? found.IL : undefined,
          ilce: typeof found.ILCE === 'string' ? found.ILCE : undefined,
          kaynak: 'github:MehmetHuseyinDelipalta/MEB-Okul-Veritabani',
        };
      }
    }
  } catch (err) {
    console.warn('[school-lookup] GitHub sorgusunda hata:', err);
  }
  return null;
}

function buildMebSchoolPayload(start: number, length: number, search = ''): URLSearchParams {
  const payload: Record<string, string> = {
    draw: '1',
    'columns[0][data]': 'OKUL_ADI',
    'columns[0][name]': '',
    'columns[0][searchable]': 'true',
    'columns[0][orderable]': 'true',
    'columns[0][search][value]': '',
    'columns[0][search][regex]': 'false',
    'columns[1][data]': 'OKUL_ADI',
    'columns[1][name]': '',
    'columns[1][searchable]': 'true',
    'columns[1][orderable]': 'true',
    'columns[1][search][value]': '',
    'columns[1][search][regex]': 'false',
    'columns[2][data]': 'OKUL_ADI',
    'columns[2][name]': '',
    'columns[2][searchable]': 'true',
    'columns[2][orderable]': 'true',
    'columns[2][search][value]': '',
    'columns[2][search][regex]': 'false',
    'order[0][column]': '0',
    'order[0][dir]': 'asc',
    'order[0][name]': '',
    start: String(start),
    length: String(length),
    'search[value]': search,
    'search[regex]': 'false',
    il: '',
    ilce: '',
  };
  return new URLSearchParams(payload);
}

type MebSchoolRow = { OKUL_ADI?: string; YOL?: string };
type SchoolLookupResult = { kurumKodu: string; okulAdi: string; il?: string; ilce?: string; kaynak: string };

function mapMebRowToSchool(row: MebSchoolRow, kurumKodu: string, kaynak: string): SchoolLookupResult | null {
  const code = parseSchoolCodeFromYol(row?.YOL);
  if (!code || code !== kurumKodu) return null;
  const raw = String(row?.OKUL_ADI || '').trim();
  if (!raw) return null;
  const parts = raw.split(' - ').map((s) => s.trim()).filter(Boolean);
  const il = parts.length >= 1 ? parts[0] : undefined;
  const ilce = parts.length >= 2 ? parts[1] : undefined;
  const okulAdi = parts.length >= 3 ? parts.slice(2).join(' - ') : raw;
  return { kurumKodu, okulAdi, il, ilce, kaynak };
}

let mebSchoolIndex: Map<string, SchoolLookupResult> | null = null;
let mebSchoolIndexUpdatedAt = 0;
let mebSchoolIndexPromise: Promise<void> | null = null;

async function fetchSchoolFromMebQuick(kurumKodu: string): Promise<SchoolLookupResult | null> {
  try {
    const res = await fetch('https://www.meb.gov.tr/baglantilar/okullar/okullar_ajax.php', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        accept: 'application/json, text/javascript, */*; q=0.01',
        origin: 'https://www.meb.gov.tr',
        referer: 'https://www.meb.gov.tr/baglantilar/okullar/index.php',
        'user-agent': 'okul-nobet-programi',
      },
      body: buildMebSchoolPayload(0, 200, kurumKodu).toString(),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const data: any = JSON.parse(text);
    const rows: MebSchoolRow[] = Array.isArray(data?.data) ? data.data : [];
    for (const row of rows) {
      const mapped = mapMebRowToSchool(row, kurumKodu, 'meb-quick-search');
      if (mapped) return mapped;
    }
  } catch (err) {
    console.warn('[school-lookup] MEB hızlı arama hatası:', err);
  }
  return null;
}

async function ensureMebSchoolIndex(): Promise<void> {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  if (mebSchoolIndex && Date.now() - mebSchoolIndexUpdatedAt < maxAgeMs) return;
  if (mebSchoolIndexPromise) return mebSchoolIndexPromise;
  mebSchoolIndexPromise = (async () => {
    const next = new Map<string, SchoolLookupResult>();
    const pageSize = 10000;
    let start = 0;
    let total = 0;
    for (;;) {
      const res = await fetch('https://www.meb.gov.tr/baglantilar/okullar/okullar_ajax.php', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'x-requested-with': 'XMLHttpRequest',
          accept: 'application/json, text/javascript, */*; q=0.01',
          origin: 'https://www.meb.gov.tr',
          referer: 'https://www.meb.gov.tr/baglantilar/okullar/index.php',
          'user-agent': 'okul-nobet-programi',
        },
        body: buildMebSchoolPayload(start, pageSize, '').toString(),
      });
      if (!res.ok) break;
      const text = await res.text();
      const data: any = JSON.parse(text);
      const rows: MebSchoolRow[] = Array.isArray(data?.data) ? data.data : [];
      total = Number(data?.recordsTotal || 0);
      for (const row of rows) {
        const code = parseSchoolCodeFromYol(row?.YOL);
        if (!code) continue;
        const mapped = mapMebRowToSchool(row, code, 'meb-full-index');
        if (mapped) next.set(code, mapped);
      }
      start += rows.length;
      if (!rows.length || (total > 0 && start >= total)) break;
    }
    if (next.size > 0) {
      mebSchoolIndex = next;
      mebSchoolIndexUpdatedAt = Date.now();
    }
  })().finally(() => {
    mebSchoolIndexPromise = null;
  });
  return mebSchoolIndexPromise;
}

/** Lisans bitişi: YYYY-MM-DD ise o günün yerel gün sonu (bitiş günü dahil). */
function licenseEndOfDayMs(expiresAt: string): number | null {
  const datePart = expiresAt.split('T')[0];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    return new Date(y, mo, d, 23, 59, 59, 999).getTime();
  }
  const t = new Date(expiresAt).getTime();
  return Number.isNaN(t) ? null : t;
}

// Lisans tablosundan kayıt durumunu kontrol eder.
// Dönüş: { ok: boolean, reason?: 'not-found' | 'inactive' | 'expired', license?: any }
function checkLicenseRecord(kurumKodu: string): {
  ok: boolean;
  reason?: 'not-found' | 'inactive' | 'expired';
  license?: any;
} {
  const license: any = db.prepare('SELECT * FROM licenses WHERE kurumKodu = ?').get(kurumKodu);
  if (!license) {
    // Süper yöneticinin sildiği lisans, kaydı olmayan eski okul gibi serbest bırakılmaz.
    return isLicenseRevoked(kurumKodu) ? { ok: false, reason: 'inactive' } : { ok: false, reason: 'not-found' };
  }
  if (!license.isActive) return { ok: false, reason: 'inactive', license };
  if (license.expiresAt) {
    const endMs = licenseEndOfDayMs(license.expiresAt);
    if (endMs !== null && Date.now() > endMs) {
      return { ok: false, reason: 'expired', license };
    }
  }
  return { ok: true, license };
}

const revokedLicenseKey = (kurumKodu: string) => `license_revoked:${kurumKodu}`;

function isLicenseRevoked(kurumKodu: string): boolean {
  return !!db.prepare('SELECT 1 FROM meta WHERE key = ?').get(revokedLicenseKey(kurumKodu));
}

function setLicenseRevoked(kurumKodu: string, revoked: boolean): void {
  if (revoked) {
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(revokedLicenseKey(kurumKodu), new Date().toISOString());
  } else {
    db.prepare('DELETE FROM meta WHERE key = ?').run(revokedLicenseKey(kurumKodu));
  }
}

/**
 * Lisans sistemi öncesinden kalan (lisans kaydı olmayan) okul için süresiz bir kayıt açar.
 * Böylece süper yönetici bu okulu da listede görür; pasifleştirebilir veya silebilir.
 */
function ensureLegacyLicense(kurumKodu: string): ReturnType<typeof checkLicenseRecord> {
  const lic = checkLicenseRecord(kurumKodu);
  if (lic.reason !== 'not-found') return lic;
  const hasUsers = !!db.prepare('SELECT 1 FROM users WHERE kurumKodu = ? LIMIT 1').get(kurumKodu);
  if (!hasUsers) return lic;
  let okulAdi = `Kurum ${kurumKodu}`;
  try {
    const row: any = db.prepare("SELECT data FROM documents WHERE collection = 'schoolInfo' AND id = 'info' AND kurumKodu = ?").get(kurumKodu);
    const name = row ? String(JSON.parse(row.data)?.okulAdi || '').trim() : '';
    if (name) okulAdi = name;
  } catch { /* varsayılan ad kalır */ }
  db.prepare(`
    INSERT OR IGNORE INTO licenses (id, kurumKodu, okulAdi, licenseKey, createdAt, expiresAt, isActive, updatedAt)
    VALUES (?, ?, ?, ?, ?, NULL, 1, ?)
  `).run(uuidv4(), kurumKodu, okulAdi, generateLicenseKey(kurumKodu), new Date().toISOString(), new Date().toISOString());
  console.log(`[license] ${kurumKodu} için eski kurulumdan lisans kaydı oluşturuldu.`);
  applyLicenseLedger();
  return checkLicenseRecord(kurumKodu);
}

// İstemciye gönderilecek özet lisans bilgisi (gizli alanlar hariç)
function getLicenseSummary(kurumKodu: string): {
  okulAdi: string | null;
  expiresAt: string | null;
  isActive: boolean;
  daysRemaining: number | null;
} | null {
  const row: any = db.prepare('SELECT okulAdi, expiresAt, isActive FROM licenses WHERE kurumKodu = ?').get(kurumKodu);
  if (!row) return null;
  let daysRemaining: number | null = null;
  if (row.expiresAt) {
    const endMs = licenseEndOfDayMs(row.expiresAt);
    if (endMs !== null) {
      const ms = endMs - Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      // Pozitif tarafta yukarı yuvarla, negatif tarafta aşağı yuvarla.
      // Aksi halde -0 → 0 olur ve süresi yeni dolmuş lisans hâlâ
      // "0 gün kaldı" olarak görünür.
      daysRemaining = ms >= 0 ? Math.ceil(ms / dayMs) : Math.floor(ms / dayMs);
    }
  }
  return {
    okulAdi: row.okulAdi || null,
    expiresAt: row.expiresAt || null,
    isActive: !!row.isActive,
    daysRemaining,
  };
}

// pkg ile paketlendiğinde process.pkg tanımlıdır
const isPkg = !!(process as any).pkg;

// Uygulama dizini: pkg'da exe'nin yanı, geliştirmede cwd
const APP_DIR = isPkg ? path.dirname(process.execPath) : process.cwd();

// Bulut sunucusunda DATA_DIR kalıcı diske işaret eder (konteyner yeniden başlayınca veri silinmesin).
// Tek veritabanı: kurulu uygulama ve bu bilgisayardaki web aynı dosyayı kullanır.
// Aksi halde süper yönetici uygulamada başka, webde başka lisans görür.
const DB_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.platform === 'win32'
    ? path.join(homedir(), 'AppData', 'Local', 'OkulNobetProgrami')
    : (isPkg ? path.dirname(process.execPath) : process.cwd());
mkdirSync(DB_DIR, { recursive: true });

// Initialize SQLite Database
const DB_FILE = path.join(DB_DIR, 'database.sqlite');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

interface ImportCounts {
  licenses: number;
  users: number;
  documents: number;
}

/**
 * Başka bir veritabanı dosyasındaki lisans, kullanıcı ve kayıtları bu veritabanına ekler.
 * Var olan satırların üzerine yazılmaz. `kurumKodu` verilirse yalnızca o kurumun satırları alınır.
 */
function importDatabaseFile(sourcePath: string, kurumKodu?: string): ImportCounts {
  const src = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set(
      (src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(t => t.name),
    );
    const copyTable = (table: string) => {
      if (!tables.has(table)) return 0;
      const srcCols = (src.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
      const dstCols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
      const cols = dstCols.filter(c => srcCols.includes(c));
      if (cols.length === 0) return 0;
      if (kurumKodu && !cols.includes('kurumKodu')) return 0;
      const before = (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
      const placeholders = cols.map(() => '?').join(', ');
      const insert = db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
      const select = `SELECT ${cols.join(', ')} FROM ${table}${kurumKodu ? ' WHERE kurumKodu = ?' : ''}`;
      let rows = (kurumKodu ? src.prepare(select).all(kurumKodu) : src.prepare(select).all()) as Record<string, unknown>[];
      if (table === 'users') {
        // Yüklenen dosyadan yalnız kurumun admin/öğretmen hesapları alınır (yetki yükseltme engeli).
        rows = rows.filter(row => {
          const role = String(row.role ?? '');
          if (role !== 'admin' && role !== 'teacher') return false;
          return !kurumKodu || row.email === `${role}@${kurumKodu}.nobet.app`;
        });
      }
      for (const row of rows) insert.run(...cols.map(c => row[c]));
      const after = (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
      return after - before;
    };
    const counts = db.transaction(() => ({
      licenses: copyTable('licenses'),
      users: copyTable('users'),
      documents: copyTable('documents'),
    }))();
    scopeLegacyCollections();
    applyLicenseLedger();
    return counts;
  } finally {
    src.close();
  }
}

function mergeOtherDatabase(sourcePath: string): void {
  if (!existsSync(sourcePath)) return;
  if (path.resolve(sourcePath) === path.resolve(DB_FILE)) return;
  try {
    const added = importDatabaseFile(sourcePath);
    const backup = `${sourcePath}.birlestirildi`;
    try { renameSync(sourcePath, backup); } catch { /* dosya kilitliyse yerinde kalır; ekleme yok sayılır */ }
    console.log(`[db] ${sourcePath} birleştirildi (+${added.licenses} lisans, +${added.users} kullanıcı, +${added.documents} kayıt)`);
  } catch (err) {
    console.warn('[db] Diğer veritabanı birleştirilemedi:', sourcePath, err instanceof Error ? err.message : err);
  }
}

// Create Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    kurumKodu TEXT NOT NULL,
    role TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    kurumKodu TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (collection, id, kurumKodu)
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    kurumKodu TEXT UNIQUE NOT NULL,
    okulAdi TEXT NOT NULL,
    licenseKey TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    expiresAt TEXT,
    isActive INTEGER DEFAULT 1,
    lastLoginAt TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kurumKodu TEXT NOT NULL,
    at TEXT NOT NULL,
    role TEXT NOT NULL,
    client TEXT,
    ip TEXT,
    collection TEXT NOT NULL,
    docId TEXT NOT NULL,
    action TEXT NOT NULL,
    before TEXT,
    after TEXT,
    changedKeys TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_log_kurum ON audit_log (kurumKodu, id);
`);

try {
  db.exec('ALTER TABLE licenses ADD COLUMN updatedAt TEXT');
} catch { /* sütun zaten var */ }

const ledgerPointerPath = path.join(DB_DIR, 'lisans-defteri.path');

function resolveLedgerPath(): string {
  try {
    if (existsSync(ledgerPointerPath)) {
      const chosen = readFileSync(ledgerPointerPath, 'utf8').trim();
      if (chosen) return path.resolve(chosen);
    }
  } catch { /* varsayılan dosya */ }
  return path.join(DB_DIR, 'lisans-defteri.json');
}

function licenseRowToEntry(row: any): LedgerEntry | null {
  return normalizeLedgerEntry({
    id: row.id,
    kurumKodu: row.kurumKodu,
    okulAdi: row.okulAdi,
    licenseKey: row.licenseKey,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt || null,
    isActive: row.isActive ? 1 : 0,
    lastLoginAt: row.lastLoginAt || null,
    updatedAt: row.updatedAt || row.createdAt,
    deletedAt: null,
  });
}

function applyLedgerEntriesToDb(entries: LedgerEntry[]): void {
  const upsert = db.prepare(`
    INSERT INTO licenses (id, kurumKodu, okulAdi, licenseKey, createdAt, expiresAt, isActive, lastLoginAt, updatedAt)
    VALUES (@id, @kurumKodu, @okulAdi, @licenseKey, @createdAt, @expiresAt, @isActive, @lastLoginAt, @updatedAt)
    ON CONFLICT(kurumKodu) DO UPDATE SET
      okulAdi = excluded.okulAdi,
      licenseKey = excluded.licenseKey,
      expiresAt = excluded.expiresAt,
      isActive = excluded.isActive,
      lastLoginAt = excluded.lastLoginAt,
      updatedAt = excluded.updatedAt
  `);
  db.transaction(() => {
    for (const entry of entries) {
      if (entry.deletedAt) {
        db.prepare('DELETE FROM licenses WHERE kurumKodu = ?').run(entry.kurumKodu);
        setLicenseRevoked(entry.kurumKodu, true);
        continue;
      }
      upsert.run({
        id: entry.id,
        kurumKodu: entry.kurumKodu,
        okulAdi: entry.okulAdi,
        licenseKey: entry.licenseKey,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        isActive: entry.isActive,
        lastLoginAt: entry.lastLoginAt,
        updatedAt: entry.updatedAt,
      });
      setLicenseRevoked(entry.kurumKodu, false);
    }
  })();
}

/** Yerel veritabanı ile paylaşılan lisans defterini birleştirir. En son değişiklik kazanır. */
function applyLicenseLedger(extra: LedgerEntry[] = []): void {
  const filePath = resolveLedgerPath();
  let fileEntries: LedgerEntry[] = [];
  try {
    fileEntries = readLedgerFile(filePath);
  } catch (err) {
    console.warn('[license] Lisans defteri okunamadı:', err instanceof Error ? err.message : err);
  }
  const localEntries = (db.prepare('SELECT * FROM licenses').all() as any[])
    .map(licenseRowToEntry)
    .filter((entry): entry is LedgerEntry => !!entry);
  const merged = mergeLicenseRecords([localEntries, fileEntries, extra]);
  applyLedgerEntriesToDb(merged);

  let latest: LedgerEntry[] = [];
  try {
    latest = readLedgerFile(filePath);
  } catch { /* yazmadan önce yeniden okunamadı */ }
  const finalMerged = mergeLicenseRecords([merged, latest]);
  if (ledgerSignature(finalMerged) !== ledgerSignature(merged)) {
    applyLedgerEntriesToDb(finalMerged);
  }
  try {
    if (ledgerSignature(finalMerged) !== ledgerSignature(latest)) {
      writeLedgerFile(filePath, finalMerged);
    }
  } catch (err) {
    console.warn('[license] Lisans defteri yazılamadı:', err instanceof Error ? err.message : err);
  }
  void scheduleGithubSync();
}

const githubConfigPath = path.join(DB_DIR, 'lisans-github.json');
let githubChain: Promise<void> = Promise.resolve();
let lastGithubSync: { ok: boolean; message: string; repo: string } | null = null;

function readGithubConfig(): GithubLedgerConfig | null {
  let repo = String(process.env.LICENSE_GITHUB_REPO || '').trim();
  let token = String(process.env.LICENSE_GITHUB_TOKEN || '').trim();
  let filePath = String(process.env.LICENSE_GITHUB_PATH || 'lisans-defteri.json').trim();
  try {
    if (existsSync(githubConfigPath)) {
      const saved = JSON.parse(readFileSync(githubConfigPath, 'utf8'));
      if (saved?.repo) repo = String(saved.repo).trim();
      if (saved?.token) token = String(saved.token).trim();
      if (saved?.path) filePath = String(saved.path).trim();
    }
  } catch { /* ortam değişkeni kalır */ }
  if (!parseGithubRepo(repo) || !token) return null;
  return { repo, token, path: filePath || 'lisans-defteri.json' };
}

function githubStatus() {
  const config = readGithubConfig();
  return {
    configured: !!config,
    repo: config?.repo || '',
    path: config?.path || 'lisans-defteri.json',
    sync: lastGithubSync,
  };
}

async function syncLicensesWithGithub(): Promise<void> {
  const config = readGithubConfig();
  if (!config) return;
  const local = (db.prepare('SELECT * FROM licenses').all() as any[])
    .map(licenseRowToEntry)
    .filter((entry): entry is LedgerEntry => !!entry);
  try {
    const result = await syncGithubLedger(config, local);
    applyLedgerEntriesToDb(result.entries);
    writeLedgerFile(resolveLedgerPath(), result.entries);
    lastGithubSync = {
      ok: true,
      repo: config.repo,
      message: result.uploaded ? 'GitHub güncellendi.' : 'GitHub ile aynı.',
    };
  } catch (err) {
    lastGithubSync = {
      ok: false,
      repo: config.repo,
      message: err instanceof Error ? err.message : 'GitHub eşitlemesi başarısız.',
    };
    console.warn('[license]', lastGithubSync.message);
  }
}

function scheduleGithubSync(): Promise<void> {
  const job = githubChain.then(() => syncLicensesWithGithub());
  githubChain = job.catch(() => {});
  return job;
}

applyLicenseLedger();

// Migration: scope existing unscoped collections by academic year
const academicYearMigration = db.prepare("SELECT value FROM meta WHERE key = 'academic_year_migration_v1'").get();
if (!academicYearMigration) {
  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();
  const currentAcademicYear = month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
  const collectionsToMigrate = ['teachers', 'classes', 'locations', 'assignments', 'absences', 'substitutions'];

  db.transaction(() => {
    for (const col of collectionsToMigrate) {
      const rows = db.prepare('SELECT * FROM documents WHERE collection = ?').all(col) as any[];
      if (rows.length === 0) continue;

      const scopedCol = `${col}__${currentAcademicYear}`;
      for (const row of rows) {
        db.prepare('INSERT OR IGNORE INTO documents (collection, id, kurumKodu, data) VALUES (?, ?, ?, ?)').run(
          scopedCol, row.id, row.kurumKodu, row.data
        );
      }
      db.prepare('DELETE FROM documents WHERE collection = ?').run(col);
    }

    const schoolInfoRows = db.prepare("SELECT * FROM documents WHERE collection = 'schoolInfo' AND id = 'info'").all() as any[];
    for (const row of schoolInfoRows) {
      let data: any;
      try {
        data = JSON.parse(row.data);
      } catch {
        console.warn(`[migration] ${row.kurumKodu} okul bilgisi okunamadı; atlandı.`);
        continue;
      }
      data.academicYears = [...new Set([...(data.academicYears || []), currentAcademicYear])].sort();
      db.prepare("UPDATE documents SET data = ? WHERE collection = 'schoolInfo' AND id = 'info' AND kurumKodu = ?").run(
        JSON.stringify(data), row.kurumKodu
      );
    }

    db.prepare("INSERT INTO meta (key, value) VALUES ('academic_year_migration_v1', ?)").run(new Date().toISOString());
  })();

  console.log(`Migration: scoped collections to academic year ${currentAcademicYear}`);
}

// Eski sürüm web sunucusu veriyi proje klasöründe tutuyordu. Kurulu uygulama AppData kullanıyordu.
for (const extra of [path.join(process.cwd(), 'database.sqlite'), path.join(APP_DIR, 'database.sqlite')]) {
  mergeOtherDatabase(extra);
}

scopeLegacyCollections();

// Birleşmeden gelen eski (yıla ayrılmamış) kayıtları güncel eğitim yılına bağla.
function scopeLegacyCollections(): void {
  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();
  const currentAcademicYear = month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
  for (const col of ['teachers', 'classes', 'locations', 'assignments', 'absences', 'substitutions']) {
    const rows = db.prepare('SELECT * FROM documents WHERE collection = ?').all(col) as any[];
    if (rows.length === 0) continue;
    const scopedCol = `${col}__${currentAcademicYear}`;
    const insert = db.prepare('INSERT OR IGNORE INTO documents (collection, id, kurumKodu, data) VALUES (?, ?, ?, ?)');
    const remove = db.prepare('DELETE FROM documents WHERE collection = ? AND id = ? AND kurumKodu = ?');
    const tx = db.transaction(() => {
      for (const row of rows) {
        insert.run(scopedCol, row.id, row.kurumKodu, row.data);
        remove.run(col, row.id, row.kurumKodu);
      }
    });
    tx();
  }
}

// Token imza anahtarı: .env'de yoksa kuruluma özel rastgele bir anahtar üretilip saklanır.
// Kaynak kodda sabit bir anahtar olsaydı herkes geçerli (süper yönetici dahil) token üretebilirdi.
const JWT_SECRET: string = envSecret('JWT_SECRET') || (() => {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'jwt_secret'").get() as { value: string } | undefined;
  if (row?.value) return row.value;
  const generated = crypto.randomBytes(48).toString('hex');
  db.prepare("INSERT INTO meta (key, value) VALUES ('jwt_secret', ?)").run(generated);
  return generated;
})();

// Basit deneme sınırlayıcı: aynı IP'den kısa sürede çok sayıda başarısız denemeyi engeller.
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_FAILURES = 10;
const authFailures = new Map<string, { count: number; resetAt: number }>();

function authRateKey(req: any, scope: string): string {
  return `${scope}|${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

function isAuthRateLimited(key: string): boolean {
  const entry = authFailures.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    authFailures.delete(key);
    return false;
  }
  return entry.count >= AUTH_MAX_FAILURES;
}

function recordAuthFailure(key: string) {
  const now = Date.now();
  const entry = authFailures.get(key);
  if (!entry || now > entry.resetAt) {
    authFailures.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS });
  } else {
    entry.count++;
  }
}

const RATE_LIMIT_MESSAGE = 'Çok fazla başarısız deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin.';

/** Kaydın sürüm etiketi: içerik değişince değişir. Eşzamanlı düzenlemede üzerine yazmayı önlemek için kullanılır. */
function revisionOf(dataJson: string): string {
  return crypto.createHash('sha1').update(dataJson).digest('hex').slice(0, 16);
}

function stripRevision(body: any): any {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { _rev, ...rest } = body;
  return rest;
}

const AUDIT_RETENTION_DAYS = 400;
const insertAuditRow = db.prepare(`
  INSERT INTO audit_log (kurumKodu, at, role, client, ip, collection, docId, action, before, after, changedKeys)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/** Kayıt değişikliğini özet olarak saklar. Değişiklik geçmişi yazılamazsa asıl işlem bozulmaz. */
function writeAudit(
  req: any,
  kurumKodu: string,
  collection: string,
  docId: string,
  action: 'create' | 'update' | 'delete',
  beforeJson: string | null,
  afterJson: string | null,
): void {
  try {
    const before = beforeJson ? JSON.parse(beforeJson) : null;
    const after = afterJson ? JSON.parse(afterJson) : null;
    const changed = action === 'update' ? changedTopLevelKeys(before, after) : [];
    if (action === 'update' && changed.length === 0) return;
    const snap = (v: unknown) => {
      const s = auditSnapshot(v);
      return s ? JSON.stringify(s) : null;
    };
    insertAuditRow.run(
      kurumKodu,
      new Date().toISOString(),
      String(req.user?.role || ''),
      sanitizeClientName(req.headers['x-client-name']),
      String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || null,
      collection,
      docId,
      action,
      snap(before),
      snap(after),
      changed.length ? JSON.stringify(changed) : null,
    );
  } catch (err) {
    console.warn('[audit] Kayıt yazılamadı:', err instanceof Error ? err.message : err);
  }
}

function pruneAuditLog(): void {
  try {
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000).toISOString();
    db.prepare('DELETE FROM audit_log WHERE at < ?').run(cutoff);
  } catch (err) {
    console.warn('[audit] Eski kayıtlar silinemedi:', err instanceof Error ? err.message : err);
  }
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Bulutta veri tek kopya olduğundan sunucu kendi günlük yedeğini alır (son 14 gün tutulur).
function startCloudBackups(): void {
  if (!process.env.DATA_DIR) return;
  const backupDir = path.join(DB_DIR, 'backups');
  mkdirSync(backupDir, { recursive: true });
  const run = async () => {
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(backupDir, `database-${day}.sqlite`);
    if (existsSync(target)) return;
    try {
      await db.backup(target);
      const old = readdirSync(backupDir)
        .filter(f => f.startsWith('database-') && f.endsWith('.sqlite'))
        .sort()
        .slice(0, -14);
      for (const f of old) unlinkSync(path.join(backupDir, f));
      console.log('[backup] Günlük yedek alındı:', target);
    } catch (err) {
      console.warn('[backup] Günlük yedek alınamadı:', err instanceof Error ? err.message : err);
    }
  };
  void run();
  setInterval(() => { void run(); }, 60 * 60 * 1000);
}

/** Yüklenen veritabanı dosyasını geçici olarak diske yazıp işler, sonra siler. */
function withUploadedDatabase<T>(body: unknown, fn: (filePath: string) => T): T {
  if (!Buffer.isBuffer(body) || body.length < 100 || body.subarray(0, 15).toString('latin1') !== 'SQLite format 3') {
    throw new Error('Geçerli bir veritabanı dosyası (database.sqlite) yükleyin.');
  }
  const tmp = path.join(tmpdir(), `okul-nobet-import-${crypto.randomBytes(8).toString('hex')}.sqlite`);
  writeFileSync(tmp, body);
  try {
    return fn(tmp);
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Bulut barındırıcıları istekleri bir vekil sunucu üzerinden iletir; deneme sınırı gerçek IP'ye uygulanmalı.
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

  // Tarayıcı tabanlı farklı sitelerin API yanıtlarını okuyup/yazabilmesi (çapraz köken,
  // ör. lisans anahtarı denemesi) engellenir. Uygulamanın kendisi (masaüstü veya LAN
  // istemcisi) her zaman aynı kökenden istek atar; bu yüzden yalnızca Origin ana bilgisayarı
  // isteğin Host'u ile aynı olan isteklere izin verilir.
  app.use(cors((req, callback) => {
    const origin = req.headers.origin;
    let allow = false;
    if (!origin) {
      // Aynı köken istekleri ve tarayıcı dışı istemciler (curl, LAN) Origin göndermeyebilir.
      allow = true;
    } else {
      try {
        allow = new URL(origin).host === req.headers.host;
      } catch {
        allow = false;
      }
    }
    callback(null, { origin: allow, credentials: false });
  }));
  // Arşivlenen nöbet çizelgeleri tek belgede tutulduğundan varsayılan 100kb sınırı yetmez.
  app.use(express.json({ limit: '50mb' }));

  // --- API Routes ---

  // Middleware to verify JWT
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    // Algoritma açıkça HS256 ile sınırlandırılır (algoritma karışıklığı saldırılarına karşı).
    jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err: any, user: any) => {
      if (err) return res.status(403).json({ error: 'Forbidden' });
      if (!isSessionStillValid(user)) {
        return res.status(401).json({ error: 'Oturumunuz sona erdi. Lütfen yeniden giriş yapın.' });
      }
      req.user = user;
      next();
    });
  };

  // Şifre (veya özel giriş anahtarı) değiştiğinde eski token'lar geçersiz olur.
  function isSessionStillValid(user: any): boolean {
    if (!user || typeof user !== 'object') return false;
    if (user.role === 'superadmin') {
      return !!SUPER_ADMIN_KEY && user.kv === secretFingerprint(SUPER_ADMIN_KEY);
    }
    const row: any = db.prepare('SELECT role, kurumKodu, passwordHash FROM users WHERE id = ?').get(user.id);
    if (!row || row.role !== user.role || row.kurumKodu !== user.kurumKodu) return false;
    return user.pwv === secretFingerprint(row.passwordHash);
  }

  // Superadmin, seçili kurum kodu üzerinden okul verisine erişir.
  const getEffectiveKurumKodu = (req: any): string => {
    const { kurumKodu, role } = req.user;
    if (role === 'superadmin') {
      const acting = req.headers['x-acting-kurum-kodu'];
      if (typeof acting === 'string' && acting.trim()) {
        return acting.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      }
    }
    return kurumKodu;
  };

  const isAdminRole = (role: string) => role === 'admin' || role === 'superadmin';

  // Öğretmen hesabı salt okunurdur; veri değiştiren uç noktalar yalnızca yöneticilere açıktır.
  const requireAdmin = (req: any, res: any, next: any) => {
    if (!req.user || !isAdminRole(req.user.role)) {
      return res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekir.' });
    }
    next();
  };

  // İstisna: öğretmen hesabı takas isteği açabilir ve kendi bekleyen isteğini geri çekebilir
  // (içerik POST/PUT içinde ayrıca sınırlandırılır).
  const isTeacherSwapWrite = (req: any) =>
    req.user?.role === 'teacher' && collectionBase(String(req.params.collection || '')) === 'swapRequests';
  const requireAdminOrSwapRequest = (req: any, res: any, next: any) => {
    if (isTeacherSwapWrite(req)) return next();
    return requireAdmin(req, res, next);
  };

  // Gmail uygulama şifresi gibi gizli alanlar yönetici olmayanlara gönderilmez.
  const redactForRole = (collection: string, data: any, role: string) => {
    if (collection !== 'schoolInfo' || isAdminRole(role) || !data || typeof data !== 'object') return data;
    const { gmailAppPassword, ...rest } = data;
    return rest;
  };

  // Middleware: aktif/geçerli lisans gerektir.
  // - superadmin için her zaman izinli.
  // - Lisans kaydı olmayan eski kurulumlara süresiz bir kayıt açılır (süper yönetici sonradan yönetebilir).
  // - Silinmiş, pasif veya süresi dolmuş lisanslar 403 + licenseStatus alanı ile reddedilir.
  // İstemci `licenseStatus` alanını görünce oturumu kapatıp uyarı gösterir.
  const requireActiveLicense = (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'superadmin') return next();
    const lic = ensureLegacyLicense(req.user.kurumKodu);
    if (lic.ok) return next();
    const msg =
      lic.reason === 'inactive'
        ? 'Lisansınız pasif duruma alınmış. Lütfen yöneticiyle iletişime geçin.'
        : 'Lisansınızın süresi dolmuş. Lütfen yöneticiyle iletişime geçin.';
    return res.status(403).json({ error: msg, licenseStatus: lic.reason });
  };

  // Auth: Register
  app.post('/api/auth/register', (req, res) => {
    const { kurumKodu, adminPassword, teacherPassword, licenseKey } = req.body;

    if (!kurumKodu || !adminPassword || !teacherPassword || !licenseKey) {
      return res.status(400).json({ error: 'Lütfen tüm alanları doldurun (lisans anahtarı dahil).' });
    }

    const cleanKurumKodu = kurumKodu.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    if (!validateLicenseKey(cleanKurumKodu, licenseKey)) {
      return res.status(400).json({ error: 'Geçersiz lisans anahtarı. Lütfen size verilen anahtarı doğru girdiğinizden emin olun.' });
    }

    // Lisans anahtarı doğrulandıktan sonra lisans durumunu kontrol et.
    // not-found ise (okulun kendi lokal DB'sinde ilk kurulum), kaydı otomatik oluşturacağız.
    const lic = checkLicenseRecord(cleanKurumKodu);
    const existingUser = db.prepare('SELECT id FROM users WHERE kurumKodu = ?').get(cleanKurumKodu);

    // Daha önce kayıt olmuş okullar yeniden kayıt olamaz — sadece lisans uzatılır.
    if (existingUser) {
      if (!lic.ok && lic.reason === 'expired') {
        return res.status(403).json({
          error: 'Bu okul zaten kayıtlı; lisans süresi dolmuş. Yeniden kayıt gerekmez. Lisans uzatıldığında aynı kurum kodu, kullanıcı adı ve şifre ile giriş yapabilirsiniz.',
          code: 'already-registered-expired',
        });
      }
      if (!lic.ok && lic.reason === 'inactive') {
        return res.status(403).json({
          error: 'Bu okul zaten kayıtlı; lisans pasif. Yeniden kayıt gerekmez. Lisans yeniden etkinleştirildiğinde aynı şifrelerle giriş yapabilirsiniz.',
          code: 'already-registered-inactive',
        });
      }
      return res.status(400).json({
        error: 'Bu kurum kodu ile zaten bir kayıt oluşturulmuş. Giriş sayfasından mevcut kullanıcı adı ve şifrenizle giriş yapın. Yeni lisans veya yeniden kayıt gerekmez.',
        code: 'already-registered',
      });
    }

    if (!lic.ok && lic.reason !== 'not-found') {
      const msg =
        lic.reason === 'inactive'
          ? 'Bu kurum kodu için lisans pasif durumda. Lütfen yöneticiyle iletişime geçin.'
          : 'Bu kurum kodu için lisansın süresi dolmuş. Yönetici lisansı uzattıktan sonra ilk kurulumu tamamlayabilirsiniz.';
      return res.status(403).json({ error: msg });
    }

    const adminEmail = `admin@${cleanKurumKodu}.nobet.app`;
    const teacherEmail = `teacher@${cleanKurumKodu}.nobet.app`;

    try {
      const adminHash = bcrypt.hashSync(adminPassword, 10);
      const teacherHash = bcrypt.hashSync(teacherPassword, 10);

      const insertUser = db.prepare('INSERT INTO users (id, kurumKodu, role, email, passwordHash) VALUES (?, ?, ?, ?, ?)');
      
      const adminId = uuidv4();
      const teacherId = uuidv4();

      db.transaction(() => {
        // Okulun lokal veritabanında lisans kaydı yoksa, doğrulanan anahtarla ilk kaydı oluştur.
        if (lic.reason === 'not-found') {
          db.prepare(`
            INSERT INTO licenses (id, kurumKodu, okulAdi, licenseKey, createdAt, expiresAt, isActive, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)
          `).run(
            uuidv4(),
            cleanKurumKodu,
            `Kurum ${cleanKurumKodu}`,
            generateLicenseKey(cleanKurumKodu),
            new Date().toISOString(),
            null,
            new Date().toISOString(),
          );
        }

        insertUser.run(adminId, cleanKurumKodu, 'admin', adminEmail, adminHash);
        insertUser.run(teacherId, cleanKurumKodu, 'teacher', teacherEmail, teacherHash);

        // Initialize School Info
        const insertDoc = db.prepare('INSERT INTO documents (collection, id, kurumKodu, data) VALUES (?, ?, ?, ?)');
        const m = new Date().getMonth() + 1;
        const y = new Date().getFullYear();
        const initYear = m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
        insertDoc.run('schoolInfo', 'info', cleanKurumKodu, JSON.stringify({
          valilik: '',
          kaymakamlik: '',
          okulAdi: '',
          okulMuduru: '',
          mudurYardimcilari: [],
          academicYears: [initYear],
          updatedAt: new Date().toISOString()
        }));
      })();
      applyLicenseLedger();

      res.json({ success: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: 'Kayıt oluşturulurken bir hata meydana geldi.' });
    }
  });

  // Auth: Login
  app.post('/api/auth/login', (req, res) => {
    const { kurumKodu, role, password } = req.body;

    if (!kurumKodu || !role || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    if (role !== 'admin' && role !== 'teacher') {
      return res.status(400).json({ error: 'Geçersiz kullanıcı türü.' });
    }

    const cleanKurumKodu = String(kurumKodu).trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const email = `${role}@${cleanKurumKodu}.nobet.app`;
    const rateKey = authRateKey(req, 'login');
    if (isAuthRateLimited(rateKey)) {
      return res.status(429).json({ error: RATE_LIMIT_MESSAGE });
    }

    try {
      const user: any = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || user.role !== role) {
        recordAuthFailure(rateKey);
        return res.status(401).json({ error: 'Hatalı kurum kodu, kullanıcı adı veya şifre.' });
      }

      const validPassword = bcrypt.compareSync(String(password), user.passwordHash);
      if (!validPassword) {
        recordAuthFailure(rateKey);
        return res.status(401).json({ error: 'Hatalı kurum kodu, kullanıcı adı veya şifre.' });
      }

      // Lisans kontrolü: kayıt sırasında lisans olabilir ama daha sonra pasif edilmiş, silinmiş veya süresi geçmiş olabilir.
      const lic = ensureLegacyLicense(user.kurumKodu);
      if (!lic.ok) {
        const msg =
          lic.reason === 'inactive'
            ? 'Lisansınız pasif durumda. Yönetici lisansı yeniden etkinleştirdiğinde aynı kurum kodu, kullanıcı adı ve şifre ile giriş yapabilirsiniz. Yeniden kayıt gerekmez.'
            : 'Lisansınızın süresi dolmuş. Yönetici lisansınızı uzattığında aynı kurum kodu, kullanıcı adı ve şifre ile giriş yapabilirsiniz. Yeniden kayıt veya yeni lisans gerekmez.';
        return res.status(403).json({ error: msg, licenseStatus: lic.reason });
      }

      const token = jwt.sign(
        { id: user.id, kurumKodu: user.kurumKodu, role: user.role, pwv: secretFingerprint(user.passwordHash) },
        JWT_SECRET,
        { expiresIn: '7d', algorithm: 'HS256' },
      );

      // Lisans tablosunda lastLoginAt güncelle
      db.prepare('UPDATE licenses SET lastLoginAt = ? WHERE kurumKodu = ?').run(new Date().toISOString(), user.kurumKodu);
      applyLicenseLedger();

      res.json({
        token,
        user: {
          uid: user.id,
          kurumKodu: user.kurumKodu,
          role: user.role
        },
        license: getLicenseSummary(user.kurumKodu),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Giriş yapılırken bir hata oluştu.' });
    }
  });

  // Auth: Özel Giriş
  app.post('/api/auth/superadmin-login', (req, res) => {
    if (!SUPER_ADMIN_KEY) {
      return res.status(404).json({ error: 'Bu kurulumda özel yönetici girişi etkin değil.' });
    }
    const { masterKey } = req.body;
    const rateKey = authRateKey(req, 'superadmin');
    if (isAuthRateLimited(rateKey)) {
      return res.status(429).json({ error: RATE_LIMIT_MESSAGE });
    }

    if (!superAdminLoginAllowed(req)) {
      recordAuthFailure(rateKey);
      return res.status(403).json({
        error: 'Özel yönetici girişi bu sunucuda etkin değil.',
      });
    }

    if (typeof masterKey !== 'string' || !safeEqual(masterKey, SUPER_ADMIN_KEY)) {
      recordAuthFailure(rateKey);
      return res.status(401).json({ error: 'Geçersiz anahtar.' });
    }

    const token = jwt.sign({
      id: 'superadmin',
      kurumKodu: '__superadmin__',
      role: 'superadmin',
      kv: secretFingerprint(SUPER_ADMIN_KEY),
    }, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });

    res.json({
      token,
      user: {
        uid: 'superadmin',
        kurumKodu: '__superadmin__',
        role: 'superadmin'
      }
    });
  });

  // Licenses: Get all
  app.get('/api/licenses', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim.' });
    }

    try {
      applyLicenseLedger();
      await githubChain;
      const licenses = db.prepare('SELECT * FROM licenses ORDER BY createdAt DESC').all();
      res.json(licenses);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Lisanslar yüklenirken hata oluştu.' });
    }
  });

  app.get('/api/licenses/github', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim.' });
    }
    res.json(githubStatus());
  });

  app.put('/api/licenses/github', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim.' });
    }
    const repo = String(req.body?.repo || '').trim();
    const token = String(req.body?.token || '').trim();
    if (!parseGithubRepo(repo)) {
      return res.status(400).json({ error: 'Depo adı "kullanici/depo" biçiminde olmalı.' });
    }
    const existing = readGithubConfig();
    const nextToken = token || existing?.token || '';
    if (!nextToken) {
      return res.status(400).json({ error: 'GitHub kişisel erişim anahtarını yazın.' });
    }
    if (existing && existing.repo !== repo && !token) {
      return res.status(400).json({ error: 'Depo değişti. Erişim anahtarını yeniden yazın.' });
    }
    try {
      writeFileSync(githubConfigPath, JSON.stringify({
        repo,
        token: nextToken,
        path: 'lisans-defteri.json',
      }, null, 2), 'utf8');
      applyLicenseLedger();
      await githubChain;
      const status = githubStatus();
      if (status.sync && !status.sync.ok) {
        return res.status(400).json({ error: status.sync.message, ...status });
      }
      res.json(status);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'GitHub ayarı kaydedilemedi.' });
    }
  });

  app.get('/api/licenses/ledger', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim.' });
    }
    const ledgerPath = resolveLedgerPath();
    res.json({ path: ledgerPath, exists: existsSync(ledgerPath) });
  });

  app.put('/api/licenses/ledger', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim.' });
    }
    const raw = String(req.body?.path || '').trim();
    if (!raw) {
      return res.status(400).json({ error: 'Lisans defteri dosyasının yolunu yazın.' });
    }
    let target = path.resolve(raw);
    try {
      if (existsSync(target) && statSync(target).isDirectory()) {
        target = path.join(target, 'lisans-defteri.json');
      }
    } catch { /* dosya değilse aşağıdaki kontrol yeter */ }
    if (!target.toLowerCase().endsWith('.json')) {
      return res.status(400).json({ error: 'Dosya adı .json ile bitmeli. Klasör verdiyseniz klasörün yolunu yazın.' });
    }
    try {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(ledgerPointerPath, target, 'utf8');
      applyLicenseLedger();
    } catch (err) {
      return res.status(400).json({
        error: err instanceof Error ? `Bu konuma yazılamadı: ${err.message}` : 'Bu konuma yazılamadı.',
      });
    }
    res.json({ path: resolveLedgerPath(), exists: existsSync(resolveLedgerPath()) });
  });

  // Licenses: Create new
  app.post('/api/licenses', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim.' });
    }

    const { kurumKodu, okulAdi, expiresAt } = req.body;

    if (!kurumKodu || !okulAdi) {
      return res.status(400).json({ error: 'Kurum kodu ve okul adı gerekli.' });
    }

    const cleanKurumKodu = kurumKodu.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const licenseKey = generateLicenseKey(cleanKurumKodu);

    try {
      // Zaten var mı kontrol et — kayıtlı okullar için yeni lisans değil, uzatma gerekir
      const existing: any = db.prepare('SELECT * FROM licenses WHERE kurumKodu = ?').get(cleanKurumKodu);
      if (existing) {
        return res.status(409).json({
          error: 'Bu kurum kodu için zaten lisans mevcut. Yeni lisans oluşturmayın; mevcut lisansı uzatın. Okul aynı kullanıcı adı ve şifre ile giriş yapmaya devam eder.',
          code: 'license-exists',
          license: existing,
        });
      }

      const id = uuidv4();
      db.transaction(() => {
        db.prepare(`
          INSERT INTO licenses (id, kurumKodu, okulAdi, licenseKey, createdAt, expiresAt, isActive, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        `).run(id, cleanKurumKodu, okulAdi.trim(), licenseKey, new Date().toISOString(), expiresAt || null, new Date().toISOString());
        setLicenseRevoked(cleanKurumKodu, false);
      })();
      applyLicenseLedger();
      await githubChain;

      res.json({ 
        id, 
        kurumKodu: cleanKurumKodu, 
        okulAdi: okulAdi.trim(), 
        licenseKey,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt || null,
        isActive: 1
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Lisans oluşturulurken hata oluştu.' });
    }
  });

  // Licenses: Delete
  app.delete('/api/licenses/:id', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim.' });
    }

    try {
      const license: any = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
      db.transaction(() => {
        db.prepare('DELETE FROM licenses WHERE id = ?').run(req.params.id);
        // Silinen lisansın okulu, kaydı olmayan eski kurulum sayılıp girişe devam edemesin.
        if (license?.kurumKodu) setLicenseRevoked(license.kurumKodu, true);
      })();
      if (license?.kurumKodu) {
        const now = new Date().toISOString();
        const tombstone = normalizeLedgerEntry({
          id: String(license.id || license.kurumKodu),
          kurumKodu: license.kurumKodu,
          okulAdi: license.okulAdi,
          licenseKey: license.licenseKey,
          createdAt: license.createdAt,
          expiresAt: license.expiresAt || null,
          isActive: 0,
          lastLoginAt: license.lastLoginAt || null,
          updatedAt: now,
          deletedAt: now,
        });
        if (tombstone) applyLicenseLedger([tombstone]);
      }
      await githubChain;
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Lisans silinirken hata oluştu.' });
    }
  });

  // Licenses: Bitiş tarihi uzatma / okul adı düzeltme (süper yönetici)
  app.patch('/api/licenses/:id', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim.' });
    }

    const { expiresAt, okulAdi } = req.body as { expiresAt?: string | null; okulAdi?: string };

    try {
      const license: any = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
      if (!license) {
        return res.status(404).json({ error: 'Lisans bulunamadı.' });
      }

      let nextExpires: string | null = license.expiresAt ?? null;
      if (Object.prototype.hasOwnProperty.call(req.body, 'expiresAt')) {
        if (expiresAt === null || expiresAt === undefined || String(expiresAt).trim() === '') {
          nextExpires = null;
        } else {
          nextExpires = String(expiresAt).trim();
        }
      }

      let nextOkul = license.okulAdi;
      if (typeof okulAdi === 'string' && okulAdi.trim()) {
        nextOkul = okulAdi.trim();
      }

      // Uzatma / düzenleme sonrası okul aynı hesapla girebilsin diye lisansı yeniden aktif et.
      db.prepare('UPDATE licenses SET expiresAt = ?, okulAdi = ?, isActive = 1, updatedAt = ? WHERE id = ?').run(
        nextExpires,
        nextOkul,
        new Date().toISOString(),
        req.params.id,
      );
      applyLicenseLedger();
      await githubChain;
      const updated: any = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Lisans güncellenirken hata oluştu.' });
    }
  });

  // Licenses: Toggle active
  app.patch('/api/licenses/:id/toggle', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim.' });
    }

    try {
      const license: any = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
      if (!license) {
        return res.status(404).json({ error: 'Lisans bulunamadı.' });
      }

      const newStatus = license.isActive ? 0 : 1;
      const updatedAt = new Date().toISOString();
      db.prepare('UPDATE licenses SET isActive = ?, updatedAt = ? WHERE id = ?').run(newStatus, updatedAt, req.params.id);
      applyLicenseLedger();
      await githubChain;
      res.json({ ...license, isActive: newStatus, updatedAt });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Lisans güncellenirken hata oluştu.' });
    }
  });

  // Auth: Şifre sıfırlama — lisans anahtarı ile doğrulanır.
  // Yalnızca passwordHash güncellenir; kullanıcılar ve okul verileri dokunulmaz.
  app.post('/api/auth/reset-password', (req, res) => {
    const { kurumKodu, licenseKey, newPassword, role: resetRole } = req.body;

    if (!kurumKodu || !licenseKey || !newPassword) {
      return res.status(400).json({ error: 'Kurum kodu, lisans anahtarı ve yeni şifre gerekli.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalıdır.' });
    }

    const targetRole = resetRole === 'teacher' ? 'teacher' : 'admin';
    const cleanKurumKodu = String(kurumKodu).trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const cleanLicense = String(licenseKey).replace(/[^a-zA-Z0-9]/g, '').trim().toUpperCase();
    const rateKey = authRateKey(req, 'reset-password');
    if (isAuthRateLimited(rateKey)) {
      return res.status(429).json({ error: RATE_LIMIT_MESSAGE });
    }

    if (!validateLicenseKey(cleanKurumKodu, cleanLicense)) {
      recordAuthFailure(rateKey);
      return res.status(400).json({
        error: 'Geçersiz lisans anahtarı. Size verilen lisans anahtarını kontrol edin.',
      });
    }

    // Kurumun daha önce kayıtlı olduğundan emin ol (veri kaybı / yeniden kurulum yok)
    const existingUsers = db.prepare('SELECT id FROM users WHERE kurumKodu = ? LIMIT 1').get(cleanKurumKodu);
    if (!existingUsers) {
      return res.status(404).json({
        error: 'Bu kurum koduna ait kayıt bulunamadı. Henüz ilk kurulumu yapmadıysanız “Yeni Okul Kaydı”nı kullanın.',
      });
    }

    const email = `${targetRole}@${cleanKurumKodu}.nobet.app`;

    try {
      const user: any = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
      if (!user) {
        return res.status(404).json({
          error: targetRole === 'admin'
            ? 'Bu kurum için admin hesabı bulunamadı.'
            : 'Bu kurum için öğretmen hesabı bulunamadı.',
        });
      }

      const newHash = bcrypt.hashSync(newPassword, 10);
      // Sadece şifre hash'i — documents / diğer kullanıcılar silinmez
      db.prepare('UPDATE users SET passwordHash = ? WHERE email = ?').run(newHash, email);

      res.json({
        success: true,
        role: targetRole,
        message: 'Şifre güncellendi. Okul verileriniz aynen duruyor; yeni şifrenizle giriş yapabilirsiniz.',
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Şifre sıfırlanırken bir hata oluştu.' });
    }
  });

  // Auth: Change Password
  app.post('/api/auth/change-password', authenticateToken, requireActiveLicense, (req: any, res) => {
    const { targetRole, currentPassword, newPassword } = req.body;

    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ error: 'Yalnızca admin şifre değiştirebilir.' });
    }
    if (!targetRole || !newPassword) {
      return res.status(400).json({ error: 'Eksik alanlar.' });
    }
    if (targetRole !== 'admin' && targetRole !== 'teacher') {
      return res.status(400).json({ error: 'Geçersiz kullanıcı türü.' });
    }
    // Süper yönetici dışındaki kullanıcılar admin şifresini mevcut şifreyi bilmeden değiştiremez.
    if (targetRole === 'admin' && req.user.role !== 'superadmin' && !currentPassword) {
      return res.status(400).json({ error: 'Mevcut admin şifresini girin.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalıdır.' });
    }

    const kurumKodu = getEffectiveKurumKodu(req);
    const email = `${targetRole}@${kurumKodu}.nobet.app`;

    try {
      const user: any = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      }

      if (targetRole === 'admin' && currentPassword) {
        const valid = bcrypt.compareSync(currentPassword, user.passwordHash);
        if (!valid) {
          return res.status(401).json({ error: 'Mevcut şifre hatalı.' });
        }
      }

      const newHash = bcrypt.hashSync(newPassword, 10);
      db.prepare('UPDATE users SET passwordHash = ? WHERE email = ?').run(newHash, email);

      // Eski şifreyle açılmış oturumlar kapanır; şifreyi değiştiren kendi hesabıysa oturumu yeni token ile sürer.
      const token = user.id === req.user.id
        ? jwt.sign(
            { id: user.id, kurumKodu: user.kurumKodu, role: user.role, pwv: secretFingerprint(newHash) },
            JWT_SECRET,
            { expiresIn: '7d', algorithm: 'HS256' },
          )
        : undefined;
      res.json({ success: true, ...(token ? { token } : {}) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Şifre değiştirilirken bir hata oluştu.' });
    }
  });

  // Auth: Me
  app.get('/api/auth/me', authenticateToken, requireActiveLicense, (req: any, res) => {
    const isSuper = req.user.role === 'superadmin';
    res.json({
      user: {
        uid: req.user.id,
        kurumKodu: req.user.kurumKodu,
        role: req.user.role
      },
      license: isSuper ? null : getLicenseSummary(req.user.kurumKodu),
    });
  });

  // Oturum açmış kullanıcı: başka bilgisayarların bağlanacağı yerel adres.
  app.get('/api/network', authenticateToken, (_req, res) => {
    res.json({ addresses: lanIpv4Addresses(networkInterfaces()), port: PORT });
  });

  // Public: Sürüm bilgisi (server-client uyum kontrolü için)
  app.get('/api/version', (_req, res) => {
    res.json({
      version: APP_VERSION,
      name: 'okul-nobet-programi',
      timestamp: new Date().toISOString(),
    });
  });

  // Public: MEB eğitim-öğretim yılı takvimini resmi haber sayfasından çeker
  app.get('/api/meb-calendar/:year', async (req, res) => {
    const academicYear = String(req.params.year || '').trim();
    if (!/^\d{4}-\d{4}$/.test(academicYear)) {
      return res.status(400).json({ ok: false, error: 'Geçersiz eğitim-öğretim yılı.' });
    }

    try {
      const urls = resolveMebCalendarUrls(academicYear);
      let lastError: string | null = null;

      for (const url of urls) {
        try {
          const upstream = await fetch(url, {
            headers: {
              'user-agent': 'OkulNobetProgrami/1.0 (+https://localhost; MEB takvim senkronu)',
              accept: 'text/html,application/xhtml+xml',
            },
            redirect: 'follow',
          });
          if (!upstream.ok) {
            lastError = `HTTP ${upstream.status}`;
            continue;
          }
          const html = await upstream.text();
          const parsed = parseMebCalendarHtml(html, academicYear, url);
          if (!parsed || parsed.holidays.length === 0) {
            lastError = 'Sayfada tatil tarihi bulunamadı';
            continue;
          }
          return res.json({
            ok: true,
            academicYear: parsed.academicYear,
            title: parsed.title,
            holidays: parsed.holidays,
            contentHash: parsed.contentHash,
            sourceUrl: parsed.sourceUrl,
            fetchedAt: new Date().toISOString(),
          });
        } catch (err: any) {
          lastError = err?.message || String(err);
        }
      }

      return res.status(404).json({
        ok: false,
        error: lastError || 'MEB takvim sayfası bulunamadı.',
        academicYear,
      });
    } catch (err: any) {
      console.warn('[meb-calendar] hata:', err);
      return res.status(500).json({ ok: false, error: 'MEB takvimi alınamadı.' });
    }
  });

  // Lisans: Bir kurum kodu için aktif lisans kontrolü (kayıt formunda canlı geri bildirim için)
  app.get('/api/licenses/check/:kurumKodu', (req, res) => {
    const cleanKurumKodu = req.params.kurumKodu.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!cleanKurumKodu) return res.json({ exists: false, registered: false });
    const lic = checkLicenseRecord(cleanKurumKodu);
    const registered = !!db.prepare('SELECT id FROM users WHERE kurumKodu = ? LIMIT 1').get(cleanKurumKodu);
    // not-found iken lic.license yok; satır yine de olabilir mi? hayır.
    const row: any = lic.license || db.prepare('SELECT * FROM licenses WHERE kurumKodu = ?').get(cleanKurumKodu);
    res.json({
      exists: !!row,
      registered,
      ok: lic.ok,
      reason: lic.reason || null,
      okulAdi: row?.okulAdi || null,
      expiresAt: row?.expiresAt || null,
    });
  });

  // Kurum kodundan okul bilgisi getir (superadmin lisans üretimi için).
  app.get('/api/schools/lookup/:kurumKodu', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim.' });
    }
    const kurumKodu = req.params.kurumKodu.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!kurumKodu) return res.status(400).json({ error: 'Geçersiz kurum kodu.' });

    // Öncelik: daha önce lisanslanan okul adını dön.
    const existing: any = db.prepare('SELECT kurumKodu, okulAdi FROM licenses WHERE kurumKodu = ?').get(kurumKodu);
    if (existing?.okulAdi) {
      return res.json({
        found: true,
        kurumKodu,
        okulAdi: existing.okulAdi,
        kaynak: 'local-license-db',
      });
    }

    const schoolQuick = await fetchSchoolFromMebQuick(kurumKodu);
    if (schoolQuick?.okulAdi) {
      return res.json({ found: true, ...schoolQuick });
    }

    try {
      await ensureMebSchoolIndex();
      const indexed = mebSchoolIndex?.get(kurumKodu);
      if (indexed?.okulAdi) {
        return res.json({ found: true, ...indexed });
      }
    } catch (err) {
      console.warn('[school-lookup] MEB tam indeks hatası:', err);
    }

    const school = await fetchSchoolFromGithubByKurumKodu(kurumKodu);
    if (!school || !school.okulAdi) {
      return res.status(404).json({
        found: false,
        error: 'Bu kurum kodu için okul bilgisi bulunamadı.',
      });
    }

    return res.json({
      found: true,
      ...school,
    });
  });

  // CRUD: Get Collection
  app.get('/api/data/:collection', authenticateToken, requireActiveLicense, (req: any, res) => {
    const { collection } = req.params;
    const kurumKodu = getEffectiveKurumKodu(req);

    try {
      const rows = db.prepare('SELECT id, data FROM documents WHERE collection = ? AND kurumKodu = ?').all(collection, kurumKodu);
      const items = rows.map((row: any) => ({
        id: row.id,
        ...redactForRole(collection, JSON.parse(row.data), req.user.role),
        _rev: revisionOf(row.data),
      }));
      res.json(items);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch data' });
    }
  });

  // CRUD: Create Document
  app.post('/api/data/:collection', authenticateToken, requireActiveLicense, requireAdminOrSwapRequest, (req: any, res) => {
    const { collection } = req.params;
    const kurumKodu = getEffectiveKurumKodu(req);
    let data = stripRevision(req.body);
    if (isTeacherSwapWrite(req)) {
      data = sanitizeTeacherSwapCreate(data, new Date().toISOString());
      if (!data) return res.status(400).json({ error: 'Takas isteği eksik ya da hatalı.' });
    }

    // Use provided id or generate one
    const id = data.id || uuidv4();
    if (!data.id) data.id = id;

    try {
      const json = JSON.stringify(data);
      db.prepare('INSERT INTO documents (collection, id, kurumKodu, data) VALUES (?, ?, ?, ?)').run(
        collection, id, kurumKodu, json
      );
      writeAudit(req, kurumKodu, collection, id, 'create', null, json);
      res.setHeader('X-Rev', revisionOf(json));
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create document' });
    }
  });

  // CRUD: Update Document
  app.put('/api/data/:collection/:id', authenticateToken, requireActiveLicense, requireAdminOrSwapRequest, (req: any, res) => {
    const { collection, id } = req.params;
    const kurumKodu = getEffectiveKurumKodu(req);
    const teacherSwap = isTeacherSwapWrite(req);
    const ifMatch = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : '';

    try {
      // Okuma-karşılaştırma-yazma tek işlemde: arada başka bir yazma araya giremez.
      const outcome = db.transaction(() => {
        const current: any = db.prepare('SELECT data FROM documents WHERE collection = ? AND id = ? AND kurumKodu = ?').get(
          collection, id, kurumKodu
        );
        // İstemci okuduğu sürümü bildirdiyse ve kayıt o arada başka yerden değiştiyse üzerine yazılmaz.
        if (current && ifMatch && revisionOf(current.data) !== ifMatch) {
          return { kind: 'conflict' as const, current: current.data as string };
        }
        let data = stripRevision(req.body);
        if (teacherSwap) {
          data = current ? teacherCancelSwap(JSON.parse(current.data), new Date().toISOString()) : null;
          if (!data) return { kind: 'forbidden' as const };
        }
        const json = JSON.stringify(data);
        if (current) {
          db.prepare('UPDATE documents SET data = ? WHERE collection = ? AND id = ? AND kurumKodu = ?').run(
            json, collection, id, kurumKodu
          );
        } else {
          db.prepare('INSERT INTO documents (collection, id, kurumKodu, data) VALUES (?, ?, ?, ?)').run(
            collection, id, kurumKodu, json
          );
        }
        writeAudit(req, kurumKodu, collection, id, current ? 'update' : 'create', current?.data ?? null, json);
        return { kind: 'saved' as const, data, json };
      })();

      if (outcome.kind === 'conflict') {
        return res.status(409).json({
          error: 'Bu kayıt başka bir yerde değiştirilmiş.',
          current: redactForRole(collection, JSON.parse(outcome.current), req.user.role),
          rev: revisionOf(outcome.current),
        });
      }
      if (outcome.kind === 'forbidden') {
        return res.status(403).json({ error: 'Öğretmen hesabı yalnızca bekleyen takas isteğini geri çekebilir.' });
      }
      res.setHeader('X-Rev', revisionOf(outcome.json));
      res.json(outcome.data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update document' });
    }
  });

  // CRUD: Delete Document
  app.delete('/api/data/:collection/:id', authenticateToken, requireActiveLicense, requireAdmin, (req: any, res) => {
    const { collection, id } = req.params;
    const kurumKodu = getEffectiveKurumKodu(req);

    try {
      db.transaction(() => {
        const current: any = db.prepare('SELECT data FROM documents WHERE collection = ? AND id = ? AND kurumKodu = ?').get(
          collection, id, kurumKodu
        );
        if (!current) return;
        db.prepare('DELETE FROM documents WHERE collection = ? AND id = ? AND kurumKodu = ?').run(
          collection, id, kurumKodu
        );
        writeAudit(req, kurumKodu, collection, id, 'delete', current.data, null);
      })();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to delete document' });
    }
  });

  // Değişiklik geçmişi (en yeniden eskiye, sayfalı)
  app.get('/api/audit', authenticateToken, requireActiveLicense, requireAdmin, (req: any, res) => {
    const kurumKodu = getEffectiveKurumKodu(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 1000);
    const before = Number(req.query.before) || 0;
    try {
      const rows: any[] = before > 0
        ? db.prepare('SELECT * FROM audit_log WHERE kurumKodu = ? AND id < ? ORDER BY id DESC LIMIT ?').all(kurumKodu, before, limit)
        : db.prepare('SELECT * FROM audit_log WHERE kurumKodu = ? ORDER BY id DESC LIMIT ?').all(kurumKodu, limit);
      const parse = (v: string | null) => {
        if (!v) return null;
        try { return JSON.parse(v); } catch { return null; }
      };
      res.json(rows.map(r => ({
        id: r.id,
        at: r.at,
        role: r.role,
        client: r.client,
        ip: r.ip,
        collection: r.collection,
        docId: r.docId,
        action: r.action,
        before: parse(r.before),
        after: parse(r.after),
        changedKeys: parse(r.changedKeys) || [],
      })));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Değişiklik geçmişi okunamadı.' });
    }
  });

  // CRUD: Get Single Document
  app.get('/api/doc/:collection/:id', authenticateToken, requireActiveLicense, (req: any, res) => {
    const { collection, id } = req.params;
    const kurumKodu = getEffectiveKurumKodu(req);

    try {
      const row: any = db.prepare('SELECT data FROM documents WHERE collection = ? AND id = ? AND kurumKodu = ?').get(
        collection, id, kurumKodu
      );
      
      if (row) {
        res.setHeader('X-Rev', revisionOf(row.data));
        res.json(redactForRole(collection, JSON.parse(row.data), req.user.role));
      } else {
        res.status(404).json({ error: 'Document not found' });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch document' });
    }
  });

  // Email: Send notifications to teachers
  app.post('/api/send-email', authenticateToken, requireActiveLicense, async (req: any, res) => {
    const kurumKodu = getEffectiveKurumKodu(req);

    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ error: 'Yalnızca admin e-posta gönderebilir.' });
    }

    const { gmailEmail, gmailAppPassword, recipients } = req.body;

    if (!gmailEmail || !gmailAppPassword) {
      return res.status(400).json({ error: 'Gmail ayarları eksik. Ayarlar sayfasından Gmail adresinizi ve uygulama şifrenizi girin.' });
    }

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'Gönderilecek öğretmen listesi boş.' });
    }

    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: gmailEmail,
          pass: gmailAppPassword.replace(/\s/g, ''),
        },
      });

      await transporter.verify();

      const results: { email: string; success: boolean; error?: string }[] = [];

      for (const recipient of recipients) {
        if (!recipient.email) {
          results.push({ email: '(yok)', success: false, error: 'E-posta adresi eksik' });
          continue;
        }

        try {
          await transporter.sendMail({
            from: `"Nöbet Programı" <${gmailEmail}>`,
            to: recipient.email,
            subject: recipient.subject || 'Nöbet Görev Bilgilendirmesi',
            html: recipient.html || recipient.text || '',
          });
          results.push({ email: recipient.email, success: true });
        } catch (err: any) {
          results.push({ email: recipient.email, success: false, error: err.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        success: true,
        sent: successCount,
        failed: failCount,
        details: results,
      });
    } catch (err: any) {
      console.error('Email error:', err);
      if (err.code === 'EAUTH') {
        return res.status(401).json({ error: 'Gmail kimlik doğrulama hatası. E-posta adresinizi ve uygulama şifrenizi kontrol edin.' });
      }
      res.status(500).json({ error: `E-posta gönderilirken hata oluştu: ${err.message}` });
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // --- Eski bilgisayarlardaki verileri bu sunucuya taşıma ---
  const rawDatabase = express.raw({ type: 'application/octet-stream', limit: '200mb' });

  app.post('/api/migrate/superadmin-import', authenticateToken, rawDatabase, (req: any, res) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim.' });
    }
    try {
      const counts = withUploadedDatabase(req.body, file => importDatabaseFile(file));
      res.json({ ok: true, ...counts });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Veritabanı içe aktarılamadı.' });
    }
  });

  // Kurum yöneticisi, eski bilgisayarındaki veritabanını kurum kodu ve yönetici şifresiyle yükler.
  // Şifre dosyadaki kayıtla doğrulanır; yalnızca o kurumun satırları alınır.
  app.post('/api/migrate/kurum-import', rawDatabase, (req, res) => {
    const rateKey = authRateKey(req, 'migrate');
    if (isAuthRateLimited(rateKey)) {
      return res.status(429).json({ error: RATE_LIMIT_MESSAGE });
    }
    const kurumKodu = String(req.headers['x-kurum-kodu'] || '').trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    let password = '';
    try { password = decodeURIComponent(String(req.headers['x-admin-password'] || '')); } catch { /* boş kalır */ }
    if (!kurumKodu || !password) {
      return res.status(400).json({ error: 'Kurum kodu ve yönetici şifresi gerekli.' });
    }

    const authError = (message: string) => Object.assign(new Error(message), { status: 401 });
    try {
      const counts = withUploadedDatabase(req.body, file => {
        const src = new Database(file, { readonly: true, fileMustExist: true });
        try {
          const tables = new Set(
            (src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(t => t.name),
          );
          if (!tables.has('users')) throw new Error('Dosyada kullanıcı bilgisi yok.');
          const email = `admin@${kurumKodu}.nobet.app`;
          const localUser: any = src.prepare('SELECT * FROM users WHERE email = ?').get(email);
          if (!localUser || !bcrypt.compareSync(password, localUser.passwordHash)) {
            throw authError('Dosyada bu kurum kodu ve yönetici şifresiyle eşleşen kayıt bulunamadı.');
          }
          const cloudUser: any = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
          if (cloudUser && !bcrypt.compareSync(password, cloudUser.passwordHash)) {
            throw authError('Bu kurum sunucuda farklı bir yönetici şifresiyle kayıtlı. Sunucudaki şifreyi kullanın.');
          }
          if (isLicenseRevoked(kurumKodu)) {
            throw Object.assign(new Error('Bu kurumun lisansı kaldırılmış. Lütfen yöneticiyle iletişime geçin.'), { status: 403 });
          }
          const cloudLicense = db.prepare('SELECT kurumKodu FROM licenses WHERE kurumKodu = ?').get(kurumKodu);
          const localLicense: any = tables.has('licenses')
            ? src.prepare('SELECT licenseKey FROM licenses WHERE kurumKodu = ?').get(kurumKodu)
            : null;
          const hasValidLocalKey = !!(localLicense && validateLicenseKey(kurumKodu, localLicense.licenseKey));
          if (!cloudLicense && !hasValidLocalKey) {
            throw new Error('Bu kurum için geçerli bir lisans bulunamadı.');
          }
          // Sunucuda henüz yönetici yoksa dosyanın lisans anahtarı kayıttaki gibi kanıt olarak istenir.
          if (!cloudUser && !hasValidLocalKey) {
            throw authError('Bu kurum sunucuda henüz kayıtlı değil; dosyada geçerli lisans anahtarı bulunamadı.');
          }
        } finally {
          src.close();
        }
        return importDatabaseFile(file, kurumKodu);
      });
      res.json({ ok: true, ...counts });
    } catch (err: any) {
      if (err?.status === 401) recordAuthFailure(rateKey);
      res.status(err?.status || 400).json({ error: err instanceof Error ? err.message : 'Veritabanı içe aktarılamadı.' });
    }
  });

  // Vite middleware for development (sadece geliştirme modunda dinamik import)
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(APP_DIR, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[server] ${PORT} portu kullanımda. Uygulamanın başka bir kopyası açık olabilir.`);
    } else {
      console.error('[server] Sunucu hatası:', err);
    }
    process.exit(1);
  });
  startCloudBackups();
  pruneAuditLog();
  setInterval(pruneAuditLog, 24 * 60 * 60 * 1000);
}

startServer().catch((err) => {
  console.error('[server] Sunucu başlatılamadı:', err);
  process.exit(1);
});
