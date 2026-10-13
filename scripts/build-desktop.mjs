/**
 * Okul Nöbet Programı – Masaüstü Build Pipeline
 *
 * Çalıştırma: npm run build:desktop
 *
 * Adımlar:
 *  1. React frontend'i Vite ile derle  →  dist/
 *  2. Express server'ı esbuild ile CJS'e derle  →  _build_tmp/server.cjs
 *  3. better-sqlite3 native binding'i kopyala
 *  4. @yao-pkg/pkg ile tek .exe oluştur  →  out/OkulNobet.exe
 *  5. dist/ klasörünü out/ yanına kopyala
 *  6. electron-builder ile Electron installer oluştur
 */

import { execSync, spawnSync } from 'child_process';
import {
  cpSync, mkdirSync, rmSync, writeFileSync, renameSync,
  existsSync, readFileSync, copyFileSync, readdirSync, statSync
} from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
// Her çalıştırmada benzersiz temp klasörü: bu makinede silinen klasörler uzun
// süre "delete pending" durumunda kalabildiğinden aynı yolu yeniden
// oluşturmaya çalışmak EPERM üretiyor. Benzersiz yol bu sorunu tamamen ortadan kaldırır.
const TMP   = path.join(ROOT, `_build_tmp-${Date.now()}`);
const RELEASE = path.join(ROOT, 'out');

function run(cmd, cwd = ROOT) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit', cwd });
}

// rm→mkdir ardışık çağrılarda Windows klasörü kısa süre "delete pending"
// durumunda bırakır; bu da EPERM/ENOTEMPTY ile çökmeye yol açar.
// Kısa beklemeyle yeniden deneyerek bu duruma dayanıklı hale getiriyoruz.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function mkdirRobust(dir, attempts = 6) {
  for (let i = 0; ; i++) {
    try {
      mkdirSync(dir, { recursive: true });
      return;
    } catch (e) {
      if (i >= attempts - 1) throw e;
      console.warn(`⚠ mkdir deneme ${i + 1}/${attempts} başarısız (${dir}): ${e.code}. Tekrar deneniyor…`);
      sleep(1000);
    }
  }
}

function clean(...dirs) {
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (let i = 0; i < 3; i++) {
      try {
        rmSync(d, { recursive: true, force: true });
        break;
      } catch {
        if (i === 2) console.warn(`⚠ ${d} silinemedi, mevcut dosyaların üzerine yazılacak.`);
        else sleep(1000);
      }
    }
  }
}

// Windows'ta fs.cpSync büyük dizinlerde / Türkçe karakterli yollarda
// STATUS_STACK_BUFFER_OVERRUN (0xC0000409) ile çöküyor. xcopy daha güvenilir.
function copyDirRobust(src, dest) {
  mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    const res = spawnSync(
      'xcopy',
      [src, dest, '/E', '/I', '/Q', '/Y', '/H', '/R'],
      { stdio: 'inherit', shell: true }
    );
    if (res.status === 0) return;
    console.warn('xcopy başarısız, manuel kopyalamaya geçiliyor…');
  }
  // Fallback: manuel rekürsif kopyalama (cpSync olmadan)
  const stack = [{ s: src, d: dest }];
  while (stack.length) {
    const { s, d } = stack.pop();
    mkdirSync(d, { recursive: true });
    for (const entry of readdirSync(s)) {
      const sp = path.join(s, entry);
      const dp = path.join(d, entry);
      if (statSync(sp).isDirectory()) {
        stack.push({ s: sp, d: dp });
      } else {
        copyFileSync(sp, dp);
      }
    }
  }
}

// ─── 1. Frontend Build ───────────────────────────────────────────────────────
console.log('\n═══ Adım 1: Frontend derleniyor (vite build)…');
run('npm run build');

// ─── 2. Server Bundle ─────────────────────────────────────────────────────────
console.log('\n═══ Adım 2: Server esbuild ile derleniyor…');
mkdirRobust(TMP);

run(
  `npx esbuild server.ts ` +
  `--bundle --platform=node --format=cjs --target=node22 ` +
  `--define:process.env.NODE_ENV='"production"' ` +
  `--external:better-sqlite3 --external:lightningcss --external:vite ` +
  `--outfile=${path.join(TMP, 'server.cjs')}`
);

// ─── 3. Giriş noktası: better-sqlite3 native hook ────────────────────────────
console.log('\n═══ Adım 3: pkg giriş noktası (native module hook) oluşturuluyor…');
const entryCode = `
'use strict';
const path   = require('path');
const fs     = require('fs');
const Module = require('module');

if (process.pkg) {
  const _orig = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (request && request.endsWith('better_sqlite3.node')) {
      const nodeFile = path.join(path.dirname(process.execPath), 'better_sqlite3.node');
      if (fs.existsSync(nodeFile)) {
        const m = { exports: {} };
        process.dlopen(m, path.toNamespacedPath(nodeFile));
        return m.exports;
      }
    }
    return _orig(request, parent, isMain);
  };
}

require('./server.cjs');
`.trimStart();

writeFileSync(path.join(TMP, 'entry.cjs'), entryCode);
writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({
  name: 'okul-nobet', version: '1.0.0'
}));

// ─── 4. better-sqlite3 native binding ────────────────────────────────────────
// OkulNobet.exe, pkg ile Node 22 (ABI 127) üzerinde çalışır.
// node_modules içindeki .node dosyası electron-builder tarafından Electron 41
// ABI'sine (145) çevrilmiş olabilir. O dosya sunucuyu açılışta çökertir.
console.log('\n═══ Adım 4: better-sqlite3 Node 22 (ABI 127) indiriliyor…');
const sqlitePkg = path.join(ROOT, 'node_modules', 'better-sqlite3');
const sqliteVersion = JSON.parse(readFileSync(path.join(sqlitePkg, 'package.json'), 'utf8')).version;
const bindingSrc = path.join(sqlitePkg, 'build', 'Release', 'better_sqlite3.node');
const sqliteTmp = path.join(TMP, 'sqlite-node22');
mkdirSync(sqliteTmp, { recursive: true });
const sqliteGz = path.join(sqliteTmp, 'better-sqlite3.tar.gz');
const sqliteUrl = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${sqliteVersion}/better-sqlite3-v${sqliteVersion}-node-v127-win32-x64.tar.gz`;
try {
  execSync(`curl.exe -L --fail -o "${sqliteGz}" "${sqliteUrl}"`, { stdio: 'inherit' });
} catch {
  // Windows sertifika iptal (CRL) sunucusuna ulaşılamazsa curl CRYPT_E_NO_REVOCATION_CHECK ile düşer.
  console.warn('⚠ İndirme başarısız; sertifika iptal kontrolü atlanarak yeniden deneniyor…');
  execSync(`curl.exe -L --fail --ssl-no-revoke -o "${sqliteGz}" "${sqliteUrl}"`, { stdio: 'inherit' });
}
execSync(`tar -xzf "${sqliteGz}" -C "${sqliteTmp}"`, { stdio: 'inherit' });
const sqliteNode = path.join(sqliteTmp, 'build', 'Release', 'better_sqlite3.node');
if (!existsSync(sqliteNode)) {
  console.error('HATA: Node 22 better_sqlite3.node paketin içinde yok.');
  process.exit(1);
}
mkdirSync(path.dirname(bindingSrc), { recursive: true });
copyFileSync(sqliteNode, bindingSrc);
copyFileSync(bindingSrc, path.join(TMP, 'better_sqlite3.node'));

// ─── 5. dist/ ve .node dosyasını out/ içine önce kopyala ─────────────────────
console.log('\n═══ Adım 5: dist/ ve native binding kopyalanıyor…');
mkdirSync(RELEASE, { recursive: true });
const releaseDist = path.join(RELEASE, 'dist');
try {
  // Silmeden üzerine yaz: silinen klasörler "delete pending" nedeniyle
  // yeniden oluşturulamayabiliyor. Eski hash'li dosyalar kalırsa da zarar vermez.
  mkdirRobust(releaseDist);
  copyDirRobust(path.join(ROOT, 'dist'), releaseDist);
} catch (e) {
  // out/dist kilitli olabilir (sadece OkulNobet.exe doğrudan
  // çalıştırıldığında kullanılır). Installer bu klasöre ihtiyaç duymaz.
  console.warn(`⚠ out/dist güncellenemedi (${e.code}); kopyalama atlanıyor.`);
}
copyFileSync(bindingSrc, path.join(RELEASE, 'better_sqlite3.node'));
console.log('  ✓ native binding kopyalandı');

// ─── 6. pkg ile exe oluştur ───────────────────────────────────────────────────
console.log('\n═══ Adım 6: pkg ile Windows yürütülebilir dosyası oluşturuluyor…');
const exeOut = path.join(RELEASE, 'OkulNobet.exe');

try {
  execSync(
    `npx @yao-pkg/pkg "${path.join(TMP, 'entry.cjs')}" ` +
    `--targets node22-win-x64 --no-bytecode --public ` +
    `--output "${exeOut}"`,
    { stdio: 'inherit', cwd: ROOT }
  );
} catch (e) {
  if (!existsSync(exeOut)) {
    console.error('HATA: OkulNobet.exe oluşturulamadı.', e);
    process.exit(1);
  }
  console.warn('⚠ pkg tamamlandı (uyarıyla çıktı ama exe oluşturuldu).');
}

// ─── 7. Electron-builder ile installer oluştur ──────────────────────────────
console.log('\n═══ Adım 7: Electron-builder ile kurulum paketi oluşturuluyor…');
// electron-builder ara çıktısı package.json → build.directories.output'a yazılır
// (EB_OUTPUT_DIR ile değiştirilebilir); kurulum dosyaları sonra proje köküne taşınır.
// Çıktı klasörü proje kökü yapılamaz: electron-builder onu paket dosyalarından hariç tutar.
const rootPkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const ebOutput = path.resolve(ROOT, process.env.EB_OUTPUT_DIR || rootPkg.build?.directories?.output || 'release');
const PACKAGE_DIR = ROOT;
const isInstallerArtifact = (name) =>
  /^OkulNobetProgrami-Setup-.+\.exe(\.blockmap)?$/.test(name) || name === 'latest.yml';
try {
  run(`npx electron-builder --win --config -c.directories.output="${ebOutput}"`);
  for (const name of readdirSync(ebOutput).filter(isInstallerArtifact)) {
    const src = path.join(ebOutput, name);
    const dest = path.join(PACKAGE_DIR, name);
    rmSync(dest, { force: true });
    try {
      renameSync(src, dest);
    } catch {
      copyFileSync(src, dest);
      rmSync(src, { force: true });
    }
  }
  console.log(`\n✔ Electron installer oluşturuldu: ${PACKAGE_DIR}`);
} catch (e) {
  console.error('⚠ electron-builder hatası:', e.message);
  console.log(`  out/ klasöründeki OkulNobet.exe doğrudan kullanılabilir.`);
}

// ─── Temizlik ─────────────────────────────────────────────────────────────────
clean(TMP);

console.log('\n═══════════════════════════════════════════════════');
console.log('  Build tamamlandı!');
console.log(`  Server EXE: ${exeOut}`);
console.log(`  Installer: ${PACKAGE_DIR}`);
console.log('═══════════════════════════════════════════════════\n');
