const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printPdf: (opts) => ipcRenderer.invoke('print-pdf', opts),
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  openPrinterProperties: (deviceName) => ipcRenderer.invoke('printer:properties', deviceName),

  // Update sistem
  onUpdateStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  // Uygulama bilgileri
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  reconfigureConnection: () => ipcRenderer.invoke('connection:reconfigure'),
  // Tanıtım turu: yalnızca ilk kurulumda gösterilir (kurulum bazında kalıcı bayrak)
  isOnboardingDone: () => ipcRenderer.invoke('onboarding:is-done'),
  markOnboardingDone: () => ipcRenderer.invoke('onboarding:mark-done'),
  // Windows'ta alert/confirm sonrası yazı alanlarının kilitlenmesini önler
  showAlertSync: (message) => ipcRenderer.sendSync('dialog:alert-sync', String(message ?? '')),
  showConfirmSync: (message) => !!ipcRenderer.sendSync('dialog:confirm-sync', String(message ?? '')),
  restoreFocus: () => ipcRenderer.sendSync('window:restore-focus'),

  // Veritabanı yedekleme
  createBackup: () => ipcRenderer.invoke('backup:create'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  openBackupFolder: () => ipcRenderer.invoke('backup:open-folder'),
  getBackupPaths: () => ipcRenderer.invoke('backup:get-paths'),
  pickExternalBackupDir: () => ipcRenderer.invoke('backup:pick-external-dir'),
  clearExternalBackupDir: () => ipcRenderer.invoke('backup:clear-external-dir'),
  downloadBackup: (sourcePath) => ipcRenderer.invoke('backup:download', sourcePath),
  restoreBackup: (backupPath) => ipcRenderer.invoke('backup:restore', backupPath),
  pickAndRestoreBackup: () => ipcRenderer.invoke('backup:pick-and-restore'),
  // Eski (yerel) veritabanını ortak sunucuya taşıma
  hasLocalDatabase: () => ipcRenderer.invoke('migrate:has-local-db'),
  readLocalDatabase: () => ipcRenderer.invoke('migrate:read-local-db'),

  onBackupStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('backup-status', listener);
    return () => ipcRenderer.removeListener('backup-status', listener);
  },
});
