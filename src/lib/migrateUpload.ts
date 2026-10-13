export interface ImportResult {
  ok: boolean;
  error?: string;
  licenses?: number;
  users?: number;
  documents?: number;
}

interface MigrateElectronAPI {
  hasLocalDatabase?: () => Promise<boolean>;
  readLocalDatabase?: () => Promise<Uint8Array | null>;
  getAppInfo?: () => Promise<{ appMode: string | null }>;
}

function electronApi(): MigrateElectronAPI | undefined {
  return (window as unknown as { electronAPI?: MigrateElectronAPI }).electronAPI;
}

/** Ortak sunucuya bağlı masaüstü uygulamasında bu bilgisayarda eski bir veritabanı var mı? */
export async function hasLocalDatabaseToMigrate(): Promise<boolean> {
  const api = electronApi();
  if (!api?.hasLocalDatabase || !api.readLocalDatabase || !api.getAppInfo) return false;
  try {
    const info = await api.getAppInfo();
    return info?.appMode === 'cloud' && (await api.hasLocalDatabase());
  } catch {
    return false;
  }
}

export async function readLocalDatabase(): Promise<Uint8Array | null> {
  return (await electronApi()?.readLocalDatabase?.()) ?? null;
}

async function post(url: string, body: Uint8Array | ArrayBuffer, headers: Record<string, string>): Promise<ImportResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...headers },
      body: body as BodyInit,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const tooLarge = res.status === 413 ? 'Dosya çok büyük.' : '';
      return { ok: false, error: data?.error || tooLarge || 'Veriler sunucuya aktarılamadı.' };
    }
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: 'Sunucuya bağlanılamadı.' };
  }
}

/** Kurumun eski veritabanını yükler; kurum kodu ve yönetici şifresi dosyadaki kayıtla doğrulanır. */
export function uploadKurumDatabase(body: Uint8Array | ArrayBuffer, kurumKodu: string, adminPassword: string) {
  return post('/api/migrate/kurum-import', body, {
    'x-kurum-kodu': kurumKodu,
    'x-admin-password': encodeURIComponent(adminPassword),
  });
}

/** Süper yönetici: dosyadaki tüm lisans, kullanıcı ve kayıtları sunucuya ekler. */
export function uploadSuperadminDatabase(body: Uint8Array | ArrayBuffer) {
  return post('/api/migrate/superadmin-import', body, {
    Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
  });
}

export function describeImport(r: ImportResult): string {
  return `${r.licenses ?? 0} lisans, ${r.users ?? 0} kullanıcı, ${r.documents ?? 0} kayıt eklendi.`;
}
