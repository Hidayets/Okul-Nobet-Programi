export type DutyType = 'sabit' | 'hareketli' | 'nobetDisi';

export interface User {
  uid: string;
  role: 'admin' | 'teacher' | 'superadmin';
  kurumKodu: string;
}

export interface License {
  id: string;
  kurumKodu: string;
  okulAdi: string;
  licenseKey: string;
  createdAt: string;
  expiresAt?: string; // Opsiyonel: Lisans bitiş tarihi
  isActive: boolean | 0 | 1;
  lastLoginAt?: string;
}

/** Login/me endpoint'i tarafından dönen özet lisans bilgisi */
export interface LicenseSummary {
  okulAdi: string | null;
  expiresAt: string | null;
  isActive: boolean;
  daysRemaining: number | null;
}

export interface Teacher {
  id: string;
  name: string;
  email?: string;
  dutyType?: DutyType;
  unavailableDays?: number[]; // Days of week teacher can't do duty (0=Sun, 1=Mon, ..., 5=Fri)
  /** Sabit nöbet günü: öğretmen bu gün nöbete öncelikli yazılır. */
  preferredDay?: number;
  // Alternatif günler. preferredDay veya bu liste doluysa öğretmen SADECE
  // preferredDay ve bu günlerde nöbet tutabilir.
  // Boş/undefined ise kısıtlama yok (unavailableDays'in tersi yönde mantık).
  availableDays?: number[];
  // schedule[dayOfWeek][hour] = className
  // dayOfWeek: 1 (Mon) to 5 (Fri)
  // hour: 1 to 8 (or more)
  schedule?: Record<number, Record<number, string>>;
}

export interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  /** MEB takviminden gelen günler güncellemede birleştirilir; manual elle eklenendir */
  source?: 'meb' | 'manual';
}

export interface MebCalendarSyncMeta {
  version: string;
  syncedAt: string;
  source: 'meb' | 'api' | 'empty';
  /** Canlı MEB sayfasından gelen içerik parmak izi — değişiklik tespitinde kullanılır */
  contentHash?: string;
  /** Örn. "2026-2027 Eğitim-Öğretim Yılı" */
  title?: string;
}

export interface ClassInfo {
  id: string;
  name: string;
  // schedule[dayOfWeek][hour] = teacherName or lessonName
  schedule: Record<number, Record<number, string>>;
}

export interface LocationDuty {
  teacherId: string;
  day: number; // 1=Pzt, 2=Sal, 3=Çar, 4=Per, 5=Cum
}

export interface Location {
  id: string;
  name: string;
  duties: LocationDuty[];
  /** Sıralama için kullanılan alan (sürükle bırak sırasını korumak için) */
  order?: number;
  /** Haftada kaç nöbetçi tutulacağı (yeni sistem) */
  weeklyDutyCount?: number;
  /**
   * Bu nöbet yerine atanan öğretmenler (yeni sistem).
   * Program oluşturulurken bu öğretmenler nöbet dönüş şekline göre
   * (sabit/hareketli) burada görevlendirilir.
   */
  assignedTeacherIds?: string[];
}

/** Nöbet Yerleri sekmesindeki sıra; order alanı olmayan eski kayıtlar kayıt sırasını korur. */
export function sortLocationsByOrder(locations: Location[]): Location[] {
  return locations
    .map((loc, idx) => ({ loc, idx }))
    .sort((a, b) => (a.loc.order ?? 999) - (b.loc.order ?? 999) || a.idx - b.idx)
    .map(({ loc }) => loc);
}

export interface Assignment {
  id: string;
  date: string; // YYYY-MM-DD
  locationId: string;
  teacherId: string;
  // Takas yapıldığında orijinal öğretmen ID'si saklanır (geri alma için)
  originalTeacherId?: string;
  // Takas yapıldığında bağlantılı atama ID'si (karşılıklı takas için)
  swapPairId?: string;
  // Öğretmen aynı gün/aynı yerde başka bir nöbeti varsa "çift nöbet" olarak işaretlenebilir.
  // PDF/print çıktısında ek bir not olarak gösterilir.
  isDoubleDuty?: boolean;
}

export interface ScheduleConfig {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  activeDays: number[]; // 1=Mon, 2=Tue, ..., 5=Fri
}

export type DutyChangeReason = 'rapor' | 'izin' | 'toplanti' | 'ders' | 'idari';

export const DUTY_CHANGE_REASONS: { id: DutyChangeReason; label: string }[] = [
  { id: 'rapor', label: 'Rapor' },
  { id: 'izin', label: 'İzin' },
  { id: 'toplanti', label: 'Toplantı' },
  { id: 'ders', label: 'Ders değişikliği' },
  { id: 'idari', label: 'İdari karar' },
];

export interface DutyChange {
  id: string;
  at: string;
  by: string;
  assignmentId: string;
  date: string;
  locationId: string;
  fromTeacherId: string;
  toTeacherId?: string;
  reason: DutyChangeReason;
}

export type AbsenceReason = 'mazeret' | 'rapor' | 'gorevliIzinli' | 'diger';

export const ABSENCE_REASONS: { id: AbsenceReason; label: string; color: string }[] = [
  { id: 'mazeret', label: 'Mazeret İzni', color: 'amber' },
  { id: 'rapor', label: 'Raporlu', color: 'red' },
  { id: 'gorevliIzinli', label: 'Görevli İzinli', color: 'blue' },
  { id: 'diger', label: 'Diğer', color: 'slate' },
];

export interface Absence {
  id: string;
  date: string; // YYYY-MM-DD
  teacherId: string;
  reason?: AbsenceReason;
  /** Devamsız olunan ders saatleri (boş ise tüm gün) */
  hours?: number[];
}

export interface Substitution {
  id: string;
  date: string; // YYYY-MM-DD
  hour: number;
  className: string;
  absentTeacherId: string;
  substituteTeacherId: string;
}

export interface VicePrincipal {
  id: string;
  name: string;
}

export interface SchoolSettings {
  lessonCount: number;
  firstLessonStart: string;
  lessonDuration: number;
  breakDuration: number;
  lunchAfterLesson: number;
  lunchDuration: number;
  schoolDays: number[];
  /** Nöbet, ilk dersten kaç dakika önce başlar */
  dutyMinutesBefore?: number;
  /** Nöbet, son dersten kaç dakika sonra biter */
  dutyMinutesAfter?: number;
  /** Manuel ders saatleri (otomatik hesaplama yerine) */
  manualLessonTimes?: LessonTime[];
}

export const DEFAULT_SCHOOL_SETTINGS: SchoolSettings = {
  lessonCount: 8,
  firstLessonStart: '08:30',
  lessonDuration: 40,
  breakDuration: 10,
  lunchAfterLesson: 4,
  lunchDuration: 40,
  schoolDays: [1, 2, 3, 4, 5],
  dutyMinutesBefore: 15,
  dutyMinutesAfter: 15,
};

export interface LessonTime {
  lesson: number;
  start: string;
  end: string;
}

export function calculateLessonTimes(settings: SchoolSettings): LessonTime[] {
  // Manuel ders saatleri varsa onları kullan
  if (settings.manualLessonTimes && settings.manualLessonTimes.length > 0) {
    return settings.manualLessonTimes;
  }

  // Yoksa otomatik hesapla
  const [startH, startM] = settings.firstLessonStart.split(':').map(Number);
  let totalMinutes = startH * 60 + startM;
  const times: LessonTime[] = [];

  for (let i = 1; i <= settings.lessonCount; i++) {
    const sh = Math.floor(totalMinutes / 60);
    const sm = totalMinutes % 60;
    const start = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;

    totalMinutes += settings.lessonDuration;

    const eh = Math.floor(totalMinutes / 60);
    const em = totalMinutes % 60;
    const end = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;

    times.push({ lesson: i, start, end });

    if (i < settings.lessonCount) {
      totalMinutes += i === settings.lunchAfterLesson
        ? settings.lunchDuration
        : settings.breakDuration;
    }
  }

  return times;
}

export interface SchoolInfo {
  valilik?: string;
  kaymakamlik?: string;
  okulAdi?: string;
  okulMuduru?: string;
  mudurYardimcilari: VicePrincipal[];
  settings?: SchoolSettings;
  academicYears?: string[];
  /** Dönem bazında MEB tatil takvimi senkron bilgisi */
  mebCalendarSync?: Record<string, MebCalendarSyncMeta>;
  gmailEmail?: string;
  gmailAppPassword?: string;
}

export interface ScheduleArchive {
  id: string;
  label: string; // "06/04/2026-30/04/2026 Nöbeti"
  startDate: string;
  endDate: string;
  assignments: Assignment[];
  archivedAt: string; // ISO timestamp
  /** Arşiv anındaki müdür yardımcıları (eski arşivlerde olmayabilir) */
  mudurYardimcilari?: VicePrincipal[];
}

// Bir öğretmenin verilen güne nöbet tutup tutamayacağını döner.
// Öncelik: preferredDay + availableDays (varsa, yalnız bu günlerde tutar) > unavailableDays (kara liste).
export function canTeacherDutyOnDay(teacher: Teacher | undefined, dayOfWeek: number): boolean {
  if (!teacher) return false;
  if (teacher.dutyType === 'nobetDisi') return false;
  const hasPreferred = typeof teacher.preferredDay === 'number';
  if (hasPreferred || (teacher.availableDays && teacher.availableDays.length > 0)) {
    return teacher.preferredDay === dayOfWeek || (teacher.availableDays ?? []).includes(dayOfWeek);
  }
  if (teacher.unavailableDays && teacher.unavailableDays.includes(dayOfWeek)) return false;
  return true;
}

/** Öğretmenin belirli gündeki ders sayısı (nöbet atamasında yük dengeleme için). */
export function getTeacherLessonCount(teacher: Teacher, dayOfWeek: number): number {
  const day = teacher.schedule?.[dayOfWeek];
  if (!day) return 0;
  return Object.values(day).filter(v => v && String(v).trim()).length;
}

/** Nöbet Yerleri'ndeki atamalardan öğretmen → gün listesi haritası (bilgi amaçlı). */
export function buildLocationAssignedDays(locations: Location[]): Record<string, number[]> {
  const map: Record<string, Set<number>> = {};
  for (const loc of locations) {
    for (const duty of loc.duties || []) {
      if (!map[duty.teacherId]) map[duty.teacherId] = new Set();
      map[duty.teacherId].add(duty.day);
    }
  }
  const result: Record<string, number[]> = {};
  for (const [id, days] of Object.entries(map)) {
    result[id] = [...days];
  }
  return result;
}

/**
 * Güncel eğitim-öğretim yılı.
 * Ağustos'tan itibaren bir sonraki yıla geçilir (okullar yeni döneme hazırlanır).
 * Örn. 4 Ağustos 2026 → 2026-2027
 */
export function getCurrentAcademicYear(now = new Date()): string {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 8) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

/** Bir sonraki eğitim-öğretim yılı kimliği (örn. 2025-2026 → 2026-2027) */
export function getNextAcademicYear(yearId = getCurrentAcademicYear()): string {
  const start = Number(yearId.split('-')[0]);
  if (!start) return yearId;
  return `${start + 1}-${start + 2}`;
}

/** Listeye her zaman güncel yılı ekler (önceki yıllar okulun kayıtlı dönemlerinden gelir). */
export function getRelevantAcademicYears(now = new Date()): string[] {
  return [getCurrentAcademicYear(now)];
}

export function formatAcademicYear(yearId: string, title?: string): string {
  if (title && title.trim()) return title.trim();
  return `${yearId} Eğitim-Öğretim Yılı`;
}

