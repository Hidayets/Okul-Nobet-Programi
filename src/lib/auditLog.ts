/**
 * Değişiklik geçmişi: sunucu her kayıt ekleme/değiştirme/silmede kısa bir özet saklar,
 * yönetici ekranı bu özetlerden okunabilir satırlar üretir.
 */

export type AuditAction = 'create' | 'update' | 'delete';

export interface AuditEntry {
  id: number;
  at: string;
  role: string;
  client: string | null;
  ip: string | null;
  collection: string;
  docId: string;
  action: AuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedKeys: string[];
}

/** Özette tutulan alanlar: kaydı tanımaya yetecek kadar, büyük alanlar (ders programı vb.) hariç. */
const SNAPSHOT_FIELDS = [
  'name', 'label', 'date', 'startDate', 'endDate', 'locationId', 'teacherId', 'originalTeacherId',
  'requesterId', 'targetTeacherId', 'absentTeacherId', 'substituteTeacherId', 'status', 'reason', 'type',
];
const MAX_TEXT = 120;

export function auditSnapshot(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const out: Record<string, unknown> = {};
  for (const key of SNAPSHOT_FIELDS) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === 'string') out[key] = value.slice(0, MAX_TEXT);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** Değişen üst düzey alan adları (iç yapıları karşılaştırmadan, JSON eşitliğiyle). */
export function changedTopLevelKeys(before: unknown, after: unknown): string[] {
  const a = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const b = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (key === 'id' || key === '_rev') continue;
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changed.push(key);
  }
  return changed.sort();
}

/** "assignments__2026-2027" → "assignments" */
export function collectionBase(collection: string): string {
  return collection.split('__')[0];
}

/** İstemcinin bildirdiği cihaz adı (URI kodlu başlık); kontrol karakterleri atılır, kısaltılır. */
export function sanitizeClientName(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  let text = raw;
  try { text = decodeURIComponent(raw); } catch { /* kodlanmamış gelmiş olabilir */ }
  text = text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
  return text || null;
}

/* ─── Görüntüleme ─── */

export const COLLECTION_LABELS: Record<string, string> = {
  teachers: 'Öğretmen',
  classes: 'Sınıf programı',
  locations: 'Nöbet yeri',
  assignments: 'Nöbet',
  absences: 'Devamsızlık',
  substitutions: 'Ders doldurma',
  holidays: 'Tatil',
  scheduleArchives: 'Arşiv',
  dutyChanges: 'Nöbet değişiklik notu',
  swapRequests: 'Takas isteği',
  schoolInfo: 'Okul ayarları',
};

export const ACTION_LABELS: Record<AuditAction, string> = {
  create: 'eklendi',
  update: 'değiştirildi',
  delete: 'silindi',
};

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Yönetici',
  teacher: 'Öğretmen hesabı',
  superadmin: 'Süper yönetici',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'ad',
  schedule: 'ders programı',
  dutyType: 'nöbet türü',
  unavailableDays: 'nöbet tutamayacağı günler',
  availableDays: 'nöbet tutabileceği günler',
  preferredDay: 'tercih edilen gün',
  fixedDay: 'sabit gün',
  alternativeDays: 'alternatif günler',
  email: 'e-posta',
  teacherId: 'öğretmen',
  locationId: 'nöbet yeri',
  date: 'tarih',
  isDoubleDuty: 'çift nöbet',
  status: 'durum',
  order: 'sıra',
  settings: 'ayarlar',
  mudurYardimcilari: 'müdür yardımcıları',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'bekliyor',
  approved: 'onaylandı',
  rejected: 'reddedildi',
  cancelled: 'geri çekildi',
};

export interface AuditNames {
  teacher: (id: string) => string;
  location: (id: string) => string;
  date: (isoDate: string) => string;
}

/** Bir geçmiş kaydını okunur cümleye çevirir: "Nöbet değiştirildi — 14 Eki Sal, Bahçe: Ali Veli → Ayşe Kaya" */
export function describeAuditEntry(entry: AuditEntry, names: AuditNames): string {
  const base = collectionBase(entry.collection);
  const head = `${COLLECTION_LABELS[base] ?? base} ${ACTION_LABELS[entry.action] ?? entry.action}`;
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const s = entry.action === 'delete' ? before : after;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const details: string[] = [];

  const title = text(s.name) || text(s.label);
  if (title) details.push(title);
  const date = text(s.date) || text(s.startDate);
  if (date) details.push(names.date(date));
  if (text(s.locationId)) details.push(names.location(text(s.locationId)));

  const beforeTeacher = text(before.teacherId);
  const afterTeacher = text(after.teacherId);
  if (entry.action === 'update' && beforeTeacher && afterTeacher && beforeTeacher !== afterTeacher) {
    details.push(`${names.teacher(beforeTeacher)} → ${names.teacher(afterTeacher)}`);
  } else if (text(s.teacherId)) {
    details.push(names.teacher(text(s.teacherId)));
  }
  if (text(s.absentTeacherId)) details.push(names.teacher(text(s.absentTeacherId)));
  if (text(s.requesterId) && text(s.targetTeacherId)) {
    details.push(`${names.teacher(text(s.requesterId))} → ${names.teacher(text(s.targetTeacherId))}`);
  }
  if (base === 'swapRequests' && text(s.status)) details.push(STATUS_LABELS[text(s.status)] ?? text(s.status));

  const visibleKeys = new Set(['teacherId', 'status']);
  const otherChanges = entry.changedKeys.filter(k => !visibleKeys.has(k) || details.length === 0);
  if (entry.action === 'update' && otherChanges.length > 0) {
    details.push(`değişen: ${otherChanges.map(k => FIELD_LABELS[k] ?? k).join(', ')}`);
  }
  return details.length ? `${head} — ${details.join(', ')}` : head;
}

/** Aynı kişinin kısa sürede aynı türde yaptığı çok sayıda değişiklik (ör. çizelge oluşturma) tek satırda toplanır. */
export interface AuditGroup {
  key: string;
  first: AuditEntry;
  entries: AuditEntry[];
}

const GROUP_WINDOW_MS = 2 * 60 * 1000;

export function groupAuditEntries(entries: AuditEntry[]): AuditGroup[] {
  const groups: AuditGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    const prev = last?.entries[last.entries.length - 1];
    const sameBatch = last && prev
      && prev.collection === entry.collection
      && prev.action === entry.action
      && prev.role === entry.role
      && prev.client === entry.client
      && Math.abs(Date.parse(prev.at) - Date.parse(entry.at)) <= GROUP_WINDOW_MS;
    if (sameBatch) last.entries.push(entry);
    else groups.push({ key: String(entry.id), first: entry, entries: [entry] });
  }
  return groups;
}
