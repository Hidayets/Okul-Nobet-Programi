import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
const require = createRequire(import.meta.url);

// Uygulama ismini açıkça sabitle. Aksi halde Electron app.getName() çağrısı
// package.json'daki "name" alanına bakar; bu da bundle sürecine göre değişebilir.
// Sabitleyince app.getPath('userData') her sürümde aynı klasörü döndürür.
// → %APPDATA%/okul-nobet-programi
app.setName('okul-nobet-programi');

// Aynı anda tek kopya: ikinci açılış kendini kapatır, açık pencere öne gelir.
// Kilit userData klasörüne bağlı olduğundan setName'den sonra alınmalı.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    if (!win) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  });
}

// Native dialog'u kapatmak için flag - frontend kendi UI'sını gösterir
const USE_NATIVE_UPDATE_DIALOG = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const isDev   = process.env.NODE_ENV === 'development';
const PORT    = 3000;

let mainWindow   = null;
let serverProcess = null;
let serverStartError = '';
let serverExited = false;
let serverLogPath = '';
let appMode = null; // 'server' | 'client'
let serverUrl = `http://127.0.0.1:${PORT}`;

// Ortak bulut sunucusu: package.json > okulNobet.cloudUrl (ya da OKUL_NOBET_CLOUD_URL).
// Tanımlıysa tüm kurulumlar buraya bağlanır; böylece lisanslar ve kurum verileri her bilgisayarda aynıdır.
function readCloudUrl() {
  const fromEnv = String(process.env.OKUL_NOBET_CLOUD_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf-8'));
    const url = String(pkg?.okulNobet?.cloudUrl || '').trim();
    return url ? url.replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

// "192.168.1.5", "192.168.1.5:3000" ya da "https://okul.ornek.com" kabul edilir.
function resolveServerUrl(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  if (!raw) return `http://localhost:${PORT}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.includes(':')) return `http://${raw}`;
  return `http://${raw}:${PORT}`;
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;
autoUpdater.logger = console;

autoUpdater.on('checking-for-update', () => {
  console.log('Güncelleme kontrol ediliyor...');
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status: 'checking' });
  }
});

autoUpdater.on('update-available', (info) => {
  console.log('Güncelleme mevcut:', info.version);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', {
      status: 'available',
      version: info.version,
    });
  }
});

autoUpdater.on('update-not-available', (info) => {
  console.log('Uygulama güncel.');
  if (mainWindow) {
    mainWindow.webContents.send('update-status', {
      status: 'not-available',
      version: info?.version,
    });
  }
});

autoUpdater.on('download-progress', (progress) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Güncelleme indirildi:', info.version);

  // Kurulum tetiklenmeden önce veritabanını mutlaka yedekle.
  // Mevcut mimaride DB install dizininin dışında (AppData\Local) tutulduğu
  // için NSIS güncelleme onu zaten silmez; bu yedek "ek güvence" amaçlıdır.
  try {
    const res = backupDatabase('pre-update');
    if (mainWindow && res.ok) {
      mainWindow.webContents.send('backup-status', {
        status: 'created',
        reason: 'pre-update',
        path: res.path,
      });
    }
  } catch (err) {
    console.warn('[backup] update-downloaded yedeği başarısız:', err?.message || err);
  }

  if (mainWindow) {
    mainWindow.webContents.send('update-status', {
      status: 'downloaded',
      version: info.version,
    });
  }

  if (USE_NATIVE_UPDATE_DIALOG) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Güncelleme Hazır',
      message: `Yeni sürüm (v${info.version}) indirildi.`,
      detail: 'Güncellemeyi yüklemek için uygulama yeniden başlatılacak.',
      buttons: ['Şimdi Yeniden Başlat', 'Sonra'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        // isSilent=true: NSIS wizard'ı gösterme, sessiz kur ve uygulamayı yeniden aç.
        autoUpdater.quitAndInstall(true, true);
      }
    });
  }
});

autoUpdater.on('error', (err) => {
  console.error('Güncelleme hatası:', err?.message || err);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', {
      status: 'error',
      message: err?.message || 'Bilinmeyen hata',
    });
  }
});

// Renderer → Main: manuel kontrol ve kurulum tetikleyicileri
ipcMain.handle('updater:check', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, currentVersion: app.getVersion(), updateInfo: result?.updateInfo || null };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('updater:install', async () => {
  try {
    // Kurulumdan hemen önce son bir yedek daha al (savunmacı katman).
    try { backupDatabase('pre-update'); } catch {}
    // isSilent=true: NSIS sihirbazı gösterilmez, sessiz kurulum yapılır.
    // isForceRunAfter=true: kurulum sonrası uygulama otomatik açılır.
    // Bu kombinasyon "ilk defa kuruluyormuş gibi" hissini ortadan kaldırır.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

// Dosya sistemine dokunan IPC'ler yalnızca uygulamanın kendi sayfasından çağrılabilir.
// Sunucu http→https yönlendirmesi yapabileceği için şema değil, ana bilgisayar adı karşılaştırılır.
function isTrustedSender(evt) {
  try {
    if (!mainWindow || evt?.sender !== mainWindow.webContents) return false;
    if (evt.senderFrame !== evt.sender.mainFrame) return false;
    const frame = new URL(evt.senderFrame.url);
    const appUrl = new URL(serverUrl);
    return /^https?:$/.test(frame.protocol) && frame.hostname === appUrl.hostname;
  } catch {
    return false;
  }
}

const UNTRUSTED = { ok: false, error: 'Bu işleme izin verilmiyor.' };

// ───── Yedekleme IPC'leri ─────
ipcMain.handle('backup:create', async () => {
  return backupDatabase('manual');
});

ipcMain.handle('backup:list', async () => {
  return listBackups();
});

ipcMain.handle('backup:open-folder', async () => {
  try {
    ensureBackupDir();
    await shell.openPath(BACKUP_DIR);
    return { ok: true, path: BACKUP_DIR };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('backup:get-paths', async () => {
  return {
    dbFile: DB_FILE,
    backupDir: BACKUP_DIR,
    dbExists: fs.existsSync(DB_FILE),
    externalDir: getExternalBackupDir(),
    canRestore: appMode === 'server',
    isCloud: appMode === 'cloud',
  };
});

// Ek yedek konumunu kullanıcıya seçtir (OneDrive/Drive/USB klasörü gibi)
ipcMain.handle('backup:pick-external-dir', async (evt) => {
  if (!isTrustedSender(evt)) return UNTRUSTED;
  try {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: 'Ek yedek klasörü seçin (OneDrive/Drive klasörü önerilir)',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Bu klasörü kullan',
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { ok: false, canceled: true };
    }
    const chosen = result.filePaths[0];
    // Yazma izni testi: gerçekten yazabiliyor muyuz?
    try {
      const probe = path.join(chosen, '.okulnobet-write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
    } catch {
      return { ok: false, error: 'Seçilen klasöre yazma izniniz yok. Başka bir klasör seçin.' };
    }
    const settings = loadBackupSettings();
    settings.externalDir = chosen;
    saveBackupSettings(settings);
    return { ok: true, path: chosen };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('backup:clear-external-dir', async (evt) => {
  if (!isTrustedSender(evt)) return UNTRUSTED;
  try {
    const settings = loadBackupSettings();
    delete settings.externalDir;
    saveBackupSettings(settings);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

// "Yedeği indir": mevcut DB'nin (veya seçilen yedeğin) kopyasını kullanıcının
// belirlediği konuma kaydeder. USB/Drive/manual transfer için.
ipcMain.handle('backup:download', async (evt, sourcePath) => {
  if (!isTrustedSender(evt)) return UNTRUSTED;
  try {
    const src = (typeof sourcePath === 'string' && sourcePath) ? path.resolve(sourcePath) : DB_FILE;
    if (src !== path.resolve(DB_FILE) && !isAllowedBackupPath(src)) {
      return { ok: false, error: 'Yalnızca veritabanı ve yedek klasöründeki dosyalar indirilebilir.' };
    }
    if (!fs.existsSync(src)) {
      return { ok: false, error: 'Kaynak dosya bulunamadı.' };
    }
    if (!isSqliteFile(src)) {
      return { ok: false, error: 'Seçilen dosya geçerli bir SQLite veritabanı değil.' };
    }
    const ts = localDateStr();
    const defaultName = path.basename(src).startsWith('database-')
      ? path.basename(src)
      : `okul-nobet-yedek-${ts}.sqlite`;
    const result = await dialog.showSaveDialog(mainWindow || undefined, {
      title: 'Yedeği nereye kaydedelim?',
      defaultPath: defaultName,
      filters: [
        { name: 'SQLite Veritabanı', extensions: ['sqlite'] },
        { name: 'Tüm dosyalar', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }
    copyDatabaseWithWal(src, result.filePath);
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

function isAllowedBackupPath(filePath) {
  const normalized = path.resolve(filePath);
  const roots = [path.resolve(BACKUP_DIR)];
  const extDir = getExternalBackupDir();
  if (extDir) roots.push(path.resolve(extDir));
  return roots.some((root) => normalized === root || normalized.startsWith(root + path.sep));
}

function isSqliteFile(filePath) {
  try {
    const header = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    return header.toString('utf8', 0, 15) === 'SQLite format 3';
  } catch {
    return false;
  }
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

/** Sunucuyu durdurur ve süreç gerçekten kapanana kadar (en fazla timeoutMs) bekler. */
function stopServerAndWait(timeoutMs = 5000) {
  const proc = serverProcess;
  stopServer();
  if (!proc || proc.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

function removeIfExists(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

// Sunucu SQLite'ı WAL kipinde açar; son değişiklikler "-wal" dosyasında durur.
// WAL önce, ana dosya sonra kopyalanır: arada checkpoint olursa ana dosya zaten
// o sayfaları içerdiğinden eski WAL'ın yeniden uygulanması tutarlı sonuç verir.
function copyDatabaseWithWal(src, dest) {
  const srcWal = `${src}-wal`;
  const hasWal = fs.existsSync(srcWal) && fs.statSync(srcWal).size > 0;
  if (hasWal) fs.copyFileSync(srcWal, `${dest}-wal`);
  fs.copyFileSync(src, dest);
  if (!hasWal) removeIfExists(`${dest}-wal`);
  removeIfExists(`${dest}-shm`);
}

function removeBackupFile(filePath) {
  removeIfExists(filePath);
  removeIfExists(`${filePath}-wal`);
}

ipcMain.handle('backup:restore', async (evt, backupPath) => {
  if (!isTrustedSender(evt)) return UNTRUSTED;
  try {
    if (appMode !== 'server') {
      return { ok: false, error: 'Geri yükleme yalnızca sunucu (ana bilgisayar) modunda kullanılabilir.' };
    }
    const src = typeof backupPath === 'string' ? backupPath.trim() : '';
    if (!src || !fs.existsSync(src)) {
      return { ok: false, error: 'Yedek dosyası bulunamadı.' };
    }
    if (!isAllowedBackupPath(src)) {
      return { ok: false, error: 'Yalnızca uygulama yedek klasöründeki dosyalar geri yüklenebilir.' };
    }
    if (!isSqliteFile(src)) {
      return { ok: false, error: 'Seçilen dosya geçerli bir SQLite veritabanı değil.' };
    }

    if (fs.existsSync(DB_FILE)) {
      const safety = backupDatabase('pre-restore');
      if (!safety.ok) {
        return { ok: false, error: `Geri yükleme öncesi güvenlik yedeği alınamadı: ${safety.error}` };
      }
    }

    await stopServerAndWait();

    copyDatabaseWithWal(src, DB_FILE);

    app.relaunch();
    app.quit();
    return { ok: true, restarting: true };
  } catch (err) {
    if (appMode === 'server' && !isDev) {
      try { startServer(); } catch {}
    }
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('backup:pick-and-restore', async (evt) => {
  if (!isTrustedSender(evt)) return UNTRUSTED;
  try {
    if (appMode !== 'server') {
      return { ok: false, error: 'Geri yükleme yalnızca sunucu (ana bilgisayar) modunda kullanılabilir.' };
    }
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: 'Geri yüklenecek yedek dosyasını seçin',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite Veritabanı', extensions: ['sqlite'] },
        { name: 'Tüm dosyalar', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { ok: false, canceled: true };
    }
    const src = result.filePaths[0];
    if (!isSqliteFile(src)) {
      return { ok: false, error: 'Seçilen dosya geçerli bir SQLite veritabanı değil.' };
    }

    if (fs.existsSync(DB_FILE)) {
      const safety = backupDatabase('pre-restore');
      if (!safety.ok) {
        return { ok: false, error: `Geri yükleme öncesi güvenlik yedeği alınamadı: ${safety.error}` };
      }
    }

    await stopServerAndWait();

    copyDatabaseWithWal(src, DB_FILE);

    app.relaunch();
    app.quit();
    return { ok: true, restarting: true, path: src };
  } catch (err) {
    if (appMode === 'server' && !isDev) {
      try { startServer(); } catch {}
    }
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('app:get-info', () => {
  return {
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appMode,
    serverUrl,
    computerName: os.hostname(),
  };
});

// Ayar dosyası: mod ve sunucu IP'si saklanır.
//
// Bağlantı ayarlarını sabit bir konumda tutuyoruz:
//   %LOCALAPPDATA%\OkulNobetProgrami\connection-settings.json
//
// Bu klasör veritabanıyla aynı yerde, install dizinin DIŞINDA. NSIS update
// onu silmediği gibi, app.getName()/productName değişikliklerine karşı da
// bağışıklık sağlar. Eski sürümlerde dosya app.getPath('userData') altındaydı;
// orada bulursak otomatik olarak yeni konuma taşıyoruz (geriye dönük uyumluluk).
const SETTINGS_DIR  = path.join(os.homedir(), 'AppData', 'Local', 'OkulNobetProgrami');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'connection-settings.json');

// Eski (userData tabanlı) konumlardan yeni sabit konuma taşı.
// Birkaç olası eski isim deneriz: app.getName() değişmiş olabilir.
function migrateLegacySettings() {
  if (fs.existsSync(SETTINGS_FILE)) return; // Yeni konum hazırsa dokunma.
  const candidates = [];
  try { candidates.push(path.join(app.getPath('userData'), 'connection-settings.json')); } catch {}
  // Olası eski productName tabanlı yollar
  const appDataRoaming = path.join(os.homedir(), 'AppData', 'Roaming');
  for (const name of ['okul-nobet-programi', 'Okul Nöbet Programı', 'okul-nobet']) {
    candidates.push(path.join(appDataRoaming, name, 'connection-settings.json'));
  }
  for (const oldPath of candidates) {
    try {
      if (oldPath && fs.existsSync(oldPath)) {
        fs.mkdirSync(SETTINGS_DIR, { recursive: true });
        fs.copyFileSync(oldPath, SETTINGS_FILE);
        console.log('[settings] Eski konumdan yeni konuma taşındı:', oldPath, '→', SETTINGS_FILE);
        return;
      }
    } catch (err) {
      console.warn('[settings] Migration sırasında hata:', err?.message || err);
    }
  }
}

function getSettingsPath() {
  return SETTINGS_FILE;
}

function loadSettings() {
  try {
    migrateLegacySettings();
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

function saveSettings(settings) {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[settings] Yazma hatası:', err?.message || err);
  }
}

function getIconPath() {
  if (isDev) return path.join(__dirname, '..', 'build', 'icon.ico');
  return path.join(process.resourcesPath, 'icon.ico');
}

function healthUrlFor(url) {
  const base = String(url || '').replace(/\/+$/, '');
  if (base.endsWith('/api/health')) return base;
  return `${base}/api/health`;
}

function readServerLogTail(max = 900) {
  try {
    if (!serverLogPath || !fs.existsSync(serverLogPath)) return '';
    const text = fs.readFileSync(serverLogPath, 'utf8').trim();
    return text.length > max ? text.slice(-max) : text;
  } catch {
    return '';
  }
}

function killStaleServer() {
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    execFile('taskkill', ['/IM', 'OkulNobet.exe', '/F'], { windowsHide: true }, () => resolve());
  });
}

async function waitForServer(url, maxMs = 20000) {
  const healthUrl = healthUrlFor(url);
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (serverStartError || serverExited) return false;
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
      if (res.ok || (res.status > 0 && res.status < 500)) return true;
    } catch { /* henüz hazır değil */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function startServer() {
  if (isDev) return;
  serverStartError = '';
  serverExited = false;
  const exeDir = path.dirname(app.getPath('exe'));
  const serverExe = path.join(exeDir, 'OkulNobet.exe');
  if (!fs.existsSync(serverExe)) {
    serverStartError = `Sunucu dosyası bulunamadı:\n${serverExe}`;
    return;
  }

  await killStaleServer();
  await new Promise(r => setTimeout(r, 400));

  const logDir = path.join(os.homedir(), 'AppData', 'Local', 'OkulNobetProgrami');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* klasör zaten var */ }
  serverLogPath = path.join(logDir, 'server.log');
  const logFd = fs.openSync(serverLogPath, 'a');
  fs.writeSync(logFd, `\n---- ${new Date().toISOString()} ----\n`);

  serverProcess = spawn(serverExe, [], {
    cwd: exeDir,
    detached: false,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });

  serverProcess.on('error', (err) => {
    serverStartError = err?.message || String(err);
    console.error('Sunucu başlatılamadı:', serverStartError);
  });
  serverProcess.on('exit', (code) => {
    serverExited = true;
    if (code && code !== 0 && !serverStartError) {
      serverStartError = `Sunucu beklenmedik şekilde kapandı (kod ${code}).`;
    }
    serverProcess = null;
  });
}

function serverFailureMessage() {
  const detail = serverStartError || readServerLogTail();
  if (!detail) return 'Sunucu 20 saniye içinde başlamadı.';
  return `Sunucu başlatılamadı.\n\n${detail}`;
}

function createMainWindow(url) {
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 600,
    title: 'Okul Nöbet Programı',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.loadURL(url);

  // Önek karşılaştırması "http://192.168.1.5:3000.evil.com" gibi adresleri de geçirirdi; köken tam eşleşmeli.
  const appOrigin = (() => { try { return new URL(url).origin; } catch { return null; } })();
  const isAppUrl = (target) => {
    try { return !!appOrigin && new URL(target).origin === appOrigin; } catch { return false; }
  };

  mainWindow.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    if (!linkUrl || linkUrl === '' || linkUrl === 'about:blank') return { action: 'allow' };
    if (isAppUrl(linkUrl)) return { action: 'allow' };
    if (/^https?:\/\//i.test(linkUrl)) shell.openExternal(linkUrl);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (isAppUrl(target)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(target)) shell.openExternal(target);
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Electron'un Windows yazdırma penceresi önizleme ve ölçek sunmaz.
  // Çizelge Edge/Chrome'da açılır; tarayıcının yazdırma önizlemesinde
  // Diğer ayarlar → Ölçek ile küçültülüp büyütülebilir.
  ipcMain.removeHandler('print-pdf');
  ipcMain.handle('print-pdf', async (_event, opts = {}) => {
    const html = typeof opts?.html === 'string' ? opts.html : '';
    if (!html.trim()) return { ok: false, error: 'Yazdırılacak içerik yok.' };
    try {
      const dir = path.join(app.getPath('temp'), 'okul-nobet-yazdir');
      fs.mkdirSync(dir, { recursive: true });
      const cutoff = Date.now() - 2 * 60 * 60 * 1000;
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        try {
          if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
        } catch { /* açık dosya silinemez */ }
      }
      const file = path.join(dir, `cizelge-${Date.now()}.html`);
      fs.writeFileSync(file, html, 'utf8');
      const openError = await openInBrowserPrintPreview(file);
      if (openError) return { ok: false, error: openError };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || 'Yazdırma penceresi açılamadı.' };
    }
  });
}

function findBrowserExecutable() {
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function openInBrowserPrintPreview(file) {
  const browser = findBrowserExecutable();
  if (!browser) return shell.openPath(file);
  try {
    const child = spawn(browser, ['--new-window', file], { detached: true, stdio: 'ignore' });
    child.unref();
    return Promise.resolve('');
  } catch {
    return shell.openPath(file);
  }
}

// Mod seçim penceresi
function createSetupWindow() {
  return new Promise((resolve) => {
    const iconPath = getIconPath();

    const setupWin = new BrowserWindow({
      width: 520,
      height: 480,
      resizable: false,
      title: 'Okul Nöbet Programı — Bağlantı Ayarı',
      icon: iconPath,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true,
      },
      show: false,
      backgroundColor: '#0f172a',
      autoHideMenuBar: true,
    });

    setupWin.setMenuBarVisibility(false);
    setupWin.removeMenu();

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #f1f5f9; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 32px; user-select: none; }
  h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 6px; }
  .sub { color: #94a3b8; font-size: 0.85rem; margin-bottom: 28px; text-align: center; line-height: 1.5; }
  .cards { display: flex; gap: 16px; width: 100%; }
  .card { flex: 1; background: #1e293b; border: 2px solid #334155; border-radius: 14px; padding: 24px 18px; text-align: center; cursor: pointer; transition: all 0.2s; }
  .card:hover { border-color: #818cf8; transform: translateY(-3px); box-shadow: 0 12px 30px rgba(79,70,229,0.2); }
  .card.active { border-color: #818cf8; background: #1e1b4b; }
  .card .icon { font-size: 2.2rem; margin-bottom: 10px; }
  .card h2 { font-size: 1rem; font-weight: 700; margin-bottom: 6px; }
  .card p { font-size: 0.78rem; color: #94a3b8; line-height: 1.4; }
  .ip-section { margin-top: 20px; width: 100%; display: none; }
  .ip-section.show { display: block; }
  .ip-section label { font-size: 0.85rem; font-weight: 600; display: block; margin-bottom: 6px; }
  .ip-section input { width: 100%; padding: 10px 14px; border-radius: 8px; border: 2px solid #334155; background: #1e293b; color: #f1f5f9; font-size: 0.95rem; font-family: monospace; outline: none; transition: border-color 0.2s; }
  .ip-section input:focus { border-color: #818cf8; }
  .ip-section .hint { font-size: 0.75rem; color: #64748b; margin-top: 6px; }
  .btn { margin-top: 24px; width: 100%; padding: 12px; border-radius: 10px; border: none; background: #4f46e5; color: white; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
  .btn:hover { background: #4338ca; }
  .btn:disabled { opacity: 0.4; cursor: default; }
</style></head><body>
  <h1>Okul Nöbet Programı</h1>
  <p class="sub">Bu bilgisayar nasıl çalışsın?</p>
  <div class="cards">
    <div class="card" id="cardServer" onclick="selectMode('server')">
      <div class="icon">🖥️</div>
      <h2>Ana Bilgisayar</h2>
      <p>Veriler bu bilgisayarda durur. Lisans ve okul kayıtları buradan yönetilir. Başka yerden bağlanılacaksa bu bilgisayar açık kalmalıdır.</p>
    </div>
    <div class="card" id="cardClient" onclick="selectMode('client')">
      <div class="icon">💻</div>
      <h2>Bağlanan Bilgisayar</h2>
      <p>Kayıtlı kurumun verilerine buradan girilir. Ana bilgisayardaki aynı kurum kodu ve şifre geçerlidir; bu bilgisayarda yeni boş kayıt açılmaz.</p>
    </div>
  </div>
  <div class="ip-section" id="ipSection">
    <label>Ana Bilgisayarın IP Adresi</label>
    <input type="text" id="ipInput" placeholder="Örn: 192.168.1.50 veya https://sunucu-adresi" oninput="validateIp()">
    <div class="hint">Ana bilgisayarın başlık çubuğundaki IP adresini yazın. Adres başka bir ağdaysa tam adresi girin (ör. https://sunucu). Ana bilgisayar kapalıyken verilere ulaşılamaz.</div>
  </div>
  <button class="btn" id="startBtn" onclick="start()" disabled>Başla</button>
<script>
  const { ipcRenderer } = require('electron');
  let mode = null;
  function selectMode(m) {
    mode = m;
    document.getElementById('cardServer').classList.toggle('active', m === 'server');
    document.getElementById('cardClient').classList.toggle('active', m === 'client');
    document.getElementById('ipSection').classList.toggle('show', m === 'client');
    if (m === 'server') { document.getElementById('startBtn').disabled = false; }
    else { validateIp(); }
  }
  function validateIp() {
    const val = document.getElementById('ipInput').value.trim();
    document.getElementById('startBtn').disabled = !val;
  }
  function start() {
    const ip = document.getElementById('ipInput').value.trim();
    ipcRenderer.send('setup-done', { mode, serverIp: ip || '' });
  }
</script></body></html>`;

    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    const tmpPath = path.join(SETTINGS_DIR, 'setup.html');
    fs.writeFileSync(tmpPath, html);
    setupWin.loadFile(tmpPath);

    setupWin.once('ready-to-show', () => setupWin.show());

    ipcMain.once('setup-done', (_e, data) => {
      setupWin.close();
      resolve(data);
    });

    setupWin.on('closed', () => {
      resolve(null);
    });
  });
}

// Sunucu modunda başlık çubuğunda IP göster
function getLocalIp() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
  } catch {}
  return 'localhost';
}

// ───────────────────────────────────────────────────────────
// Veritabanı yedekleme (otomatik + güncelleme öncesi)
// ───────────────────────────────────────────────────────────
// Veritabanı server.ts ile aynı yolda tutulur:
//   %LOCALAPPDATA%\OkulNobetProgrami\database.sqlite
// Yedekler ise yan klasörde tutulur:
//   %LOCALAPPDATA%\OkulNobetProgrami\backups\
const DB_BASE_DIR = path.join(os.homedir(), 'AppData', 'Local', 'OkulNobetProgrami');
const DB_FILE     = path.join(DB_BASE_DIR, 'database.sqlite');
const BACKUP_DIR  = path.join(DB_BASE_DIR, 'backups');
const MAX_BACKUPS = 15;
const STARTUP_BACKUP_KEY = 'lastStartupBackupDate';
const EXTERNAL_BACKUP_MAX = 30; // Bulut klasöründe daha fazla tutalım

function getBackupSettingsPath() {
  return path.join(app.getPath('userData'), 'backup-settings.json');
}

function loadBackupSettings() {
  try {
    const raw = fs.readFileSync(getBackupSettingsPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveBackupSettings(settings) {
  try {
    fs.writeFileSync(getBackupSettingsPath(), JSON.stringify(settings, null, 2));
    return true;
  } catch (err) {
    console.warn('[backup] Ayarlar kaydedilemedi:', err?.message || err);
    return false;
  }
}

function getExternalBackupDir() {
  const settings = loadBackupSettings();
  const dir = settings?.externalDir;
  if (!dir || typeof dir !== 'string') return null;
  return dir;
}

function localDateStr(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ensureBackupDir() {
  try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
}

// Ek (kullanıcının seçtiği — örn. OneDrive/Drive senkronize klasörü) konumdaki
// eski yedekleri temizle. Sadece bizim yazdığımız "database-..." dosyalarına dokunulur.
function pruneExternalBackups(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir)
      .filter((f) => f.startsWith('database-') && f.endsWith('.sqlite'))
      .map((f) => ({
        full: path.join(dir, f),
        mtime: fs.statSync(path.join(dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const old of entries.slice(EXTERNAL_BACKUP_MAX)) removeBackupFile(old.full);
  } catch (err) {
    console.warn('[backup] Ek klasördeki eski yedekler temizlenemedi:', err?.message || err);
  }
}

function pruneOldBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const entries = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('database-') && f.endsWith('.sqlite'))
      .map((f) => ({
        name: f,
        full: path.join(BACKUP_DIR, f),
        mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const old of entries.slice(MAX_BACKUPS)) removeBackupFile(old.full);
  } catch (err) {
    console.warn('Eski yedekler temizlenemedi:', err?.message || err);
  }
}

// reason: 'startup' | 'pre-update' | 'manual'
function backupDatabase(reason = 'manual') {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { ok: false, error: 'Veritabanı henüz oluşturulmamış.' };
    }
    ensureBackupDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeReason = String(reason).replace(/[^a-z0-9-]/gi, '');
    const fileName = `database-${ts}-${safeReason}.sqlite`;
    const dest = path.join(BACKUP_DIR, fileName);
    copyDatabaseWithWal(DB_FILE, dest);
    pruneOldBackups();
    console.log(`[backup] Veritabanı yedeklendi (${reason}):`, dest);

    // Kullanıcı ek bir konum (OneDrive/Drive/USB) seçtiyse oraya da kopyala.
    // OneDrive/Drive klasörü ise istemci otomatik buluta senkronlar; uygulamanın
    // doğrudan bulut API'leriyle uğraşması gerekmez ve KVKK sorumluluğu okulda kalır.
    let externalPath = null;
    let externalError = null;
    const extDir = getExternalBackupDir();
    if (extDir) {
      try {
        fs.mkdirSync(extDir, { recursive: true });
        externalPath = path.join(extDir, fileName);
        copyDatabaseWithWal(DB_FILE, externalPath);
        pruneExternalBackups(extDir);
        console.log('[backup] Ek konuma da kopyalandı:', externalPath);
      } catch (err) {
        externalError = err?.message || String(err);
        externalPath = null;
        console.warn('[backup] Ek konuma kopyalama başarısız:', externalError);
      }
    }

    return { ok: true, path: dest, externalPath, externalError };
  } catch (err) {
    console.error('[backup] Yedek alınamadı:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Aynı gün içinde tekrar yedek almasın diye basit bir flag dosyası kullan
function maybeRunStartupBackup() {
  try {
    if (appMode !== 'server') return; // İstemci modunda lokal DB yok
    if (!fs.existsSync(DB_FILE)) return;
    const today = localDateStr();
    const flagPath = path.join(BACKUP_DIR, `.${STARTUP_BACKUP_KEY}`);
    let last = null;
    try { last = fs.readFileSync(flagPath, 'utf-8').trim(); } catch {}
    if (last === today) return; // Bugün zaten yedek alındı
    ensureBackupDir();
    const res = backupDatabase('startup');
    if (res.ok) {
      try { fs.writeFileSync(flagPath, today); } catch {}
    }
  } catch (err) {
    console.warn('[backup] Startup yedeklemesi atlandı:', err?.message || err);
  }
}

function listBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('database-') && f.endsWith('.sqlite'))
      .map((f) => {
        const full = path.join(BACKUP_DIR, f);
        const stat = fs.statSync(full);
        return {
          name: f,
          path: full,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch {
    return [];
  }
}

function startUpdateChecks() {
  if (isDev) return;
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('Güncelleme kontrolü başarısız:', err?.message || err);
    });
  }, 5000);

  // Her 4 saatte bir güncelleme kontrolü
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('Periyodik güncelleme kontrolü başarısız:', err?.message || err);
    });
  }, 4 * 60 * 60 * 1000);
}

// Bu bilgisayardaki eski veritabanının tam kopyası (WAL'daki son değişiklikler dahil).
function readLocalDatabaseSnapshot() {
  if (!fs.existsSync(DB_FILE)) return null;
  try {
    const Database = require('better-sqlite3');
    const local = new Database(DB_FILE, { fileMustExist: true });
    try {
      local.pragma('wal_checkpoint(TRUNCATE)');
      return local.serialize();
    } finally {
      local.close();
    }
  } catch (err) {
    console.warn('[migrate] Veritabanı SQLite ile okunamadı, dosya doğrudan okunuyor:', err?.message || err);
    return fs.readFileSync(DB_FILE);
  }
}

ipcMain.handle('migrate:has-local-db', () => fs.existsSync(DB_FILE));

// Eski veritabanı yalnızca ortak (bulut) sunucuya taşınmak üzere ve uygulamanın kendi sayfasına verilir.
ipcMain.handle('migrate:read-local-db', (evt) => {
  if (appMode !== 'cloud' || !isTrustedSender(evt)) return null;
  const buf = readLocalDatabaseSnapshot();
  return buf ? new Uint8Array(buf) : null;
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  let settings = loadSettings();
  const cloudUrl = readCloudUrl();

  if (cloudUrl) {
    appMode = 'cloud';
    serverUrl = cloudUrl;
    for (;;) {
      if (await waitForServer(`${serverUrl}/api/health`, 15000)) break;
      const response = await dialog.showMessageBox({
        type: 'error',
        title: 'Bağlantı Hatası',
        message: `Sunucuya bağlanılamadı.\n\n${serverUrl}\n\nİnternet bağlantınızı kontrol edip tekrar deneyin.`,
        buttons: ['Tekrar Dene', 'Çıkış'],
        defaultId: 0,
      });
      if (response.response !== 0) { app.quit(); return; }
    }
    createMainWindow(serverUrl);
    startUpdateChecks();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(serverUrl);
    });
    return;
  }

  // İlk çalışma veya ayar yoksa mod seçim ekranı göster
  if (!settings) {
    const result = await createSetupWindow();
    if (!result) { app.quit(); return; }
    settings = { mode: result.mode, serverIp: result.serverIp };
    saveSettings(settings);
  }

  appMode = settings.mode;

  if (appMode === 'server') {
    await startServer();
    serverUrl = `http://127.0.0.1:${PORT}`;
    const ready = await waitForServer(serverUrl, 45000);
    if (!ready) {
      dialog.showErrorBox('Hata', serverFailureMessage());
      app.quit();
      return;
    }
    createMainWindow(serverUrl);

    // Başlıkta IP göster
    const localIp = getLocalIp();
    if (mainWindow) {
      mainWindow.setTitle(`Okul Nöbet Programı — Sunucu: ${localIp}:${PORT}`);
    }
  } else {
    // İstemci modu: sunucu IP'sine bağlan
    serverUrl = resolveServerUrl(settings.serverIp);
    const ready = await waitForServer(serverUrl, 10000);
    if (!ready) {
      const response = await dialog.showMessageBox({
        type: 'error',
        title: 'Bağlantı Hatası',
        message: `Ana bilgisayara bağlanılamadı.\n\n${serverUrl} adresine ulaşılamıyor.\n\nAna bilgisayarın açık ve aynı ağda olduğundan emin olun.`,
        buttons: ['Ayarları Sıfırla', 'Tekrar Dene', 'Çıkış'],
        defaultId: 1,
      });
      if (response.response === 0) {
        // Ayarları sıfırla
        try { fs.unlinkSync(getSettingsPath()); } catch {}
        app.relaunch();
        app.quit();
        return;
      } else if (response.response === 1) {
        app.relaunch();
        app.quit();
        return;
      } else {
        app.quit();
        return;
      }
    }
    createMainWindow(serverUrl);
    if (mainWindow) {
      mainWindow.setTitle(`Okul Nöbet Programı — Bağlı: ${settings.serverIp}`);
    }
  }

  // Günlük rolling yedek (sunucu modunda, üretim/geliştirme fark etmez).
  // Sunucu hazır olduktan ~3 sn sonra arka planda çalışır.
  setTimeout(() => {
    try { maybeRunStartupBackup(); } catch {}
  }, 3000);

  startUpdateChecks();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(serverUrl);
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
});
