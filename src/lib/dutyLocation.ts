import { startOfWeek } from 'date-fns';
import { Teacher, Location, getCurrentAcademicYear } from '../types';
import { getWeeklyDutyCount } from './weeklyQuota';

/** Öğretmen → nöbet yeri(leri). Çift nöbetli öğretmenin birden fazla yeri olabilir. */
export type TeacherHomeMap = Record<string, string | string[]>;

/**
 * Hareketli nöbetçilerin yer dönüşü için sabit başlangıç haftası: eğitim yılının 1 Eylül'ü.
 * Her çizelge aynı referansı kullandığı için ardışık çizelgeler dönüşü kaldığı yerden sürdürür.
 */
export function rotationAnchorWeek(date: Date): Date {
  const startYear = Number(getCurrentAcademicYear(date).slice(0, 4));
  return startOfWeek(new Date(startYear, 8, 1), { weekStartsOn: 1 });
}

function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** Hareketli dönüşe giren yerler: haftalık nöbeti 0 olan yerler atlanır. */
function rotationRing(locations: Location[]): Location[] {
  return locations.filter(l => getWeeklyDutyCount(l) > 0 || (l.duties?.length ?? 0) > 0);
}

export function homesOf(homeMap: TeacherHomeMap, teacherId: string): string[] {
  const v = homeMap[teacherId];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** Nöbet Yerleri atamalarından öğretmenin tüm nöbet yerleri (Nöbet Yerleri sırasıyla). */
export function buildTeacherHomeLocations(locations: Location[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  // Yeni sistem: yere doğrudan atanan öğretmenler önceliklidir.
  for (const loc of locations) {
    for (const tid of loc.assignedTeacherIds || []) {
      const list = (map[tid] ??= []);
      if (!list.includes(loc.id)) list.push(loc.id);
    }
  }
  // Eski sistem: gün bazlı duties kayıtları (yalnız yeni sistemde kaydı olmayanlar için).
  const legacy: Record<string, string> = {};
  for (const loc of locations) {
    for (const duty of loc.duties || []) {
      if (!map[duty.teacherId] && !legacy[duty.teacherId]) legacy[duty.teacherId] = loc.id;
    }
  }
  for (const [tid, locId] of Object.entries(legacy)) map[tid] = [locId];
  return map;
}

/** Nöbet Yerleri atamalarından öğretmenin ana (ilk) nöbet yeri. */
export function buildTeacherHomeLocation(locations: Location[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [tid, homes] of Object.entries(buildTeacherHomeLocations(locations))) {
    map[tid] = homes[0];
  }
  return map;
}

export function getWeekOffset(date: Date, refWeekStart: Date): number {
  const currentWeekStart = startOfWeek(date, { weekStartsOn: 1 });
  return Math.round((currentWeekStart.getTime() - refWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

/**
 * Sabit nöbetçi: her hafta aynı günde aynı yerde.
 * Hareketli nöbetçi: aynı günde kalır, nöbet yeri haftalık döner.
 */
export function getDutyLocationForTeacher(
  teacher: Teacher,
  date: Date,
  locations: Location[],
  teacherHomeLocation: TeacherHomeMap,
  refWeekStart: Date,
): string | null {
  const homeId = homesOf(teacherHomeLocation, teacher.id)[0];
  if (!homeId) return null;

  const ring = rotationRing(locations);
  const homeIdx = ring.findIndex(l => l.id === homeId);
  if (homeIdx < 0) return homeId;

  // Sabit nöbetçi: her zaman aynı yerde
  if (teacher.dutyType === 'sabit') {
    return homeId;
  }

  // Sabit değilse (hareketli veya belirtilmemiş): her nöbette bir sonraki yere kayar
  const weekOffset = getWeekOffset(date, refWeekStart);
  return ring[wrapIndex(homeIdx + weekOffset, ring.length)].id;
}

/** Nöbet Yerleri'nde kaydı olan öğretmenin bu tarihte tutması gereken yer(ler)den biri mi. */
export function teacherMatchesLocationOnDate(
  teacher: Teacher,
  locationId: string,
  date: Date,
  locations: Location[],
  teacherHomeLocation: TeacherHomeMap,
  refWeekStart: Date,
): boolean {
  const homes = homesOf(teacherHomeLocation, teacher.id);
  if (homes.length === 0) return true;

  const weekOffset = getWeekOffset(date, refWeekStart);
  const ring = rotationRing(locations);
  return homes.some(homeId => {
    const homeIdx = ring.findIndex(l => l.id === homeId);
    if (homeIdx < 0) return homeId === locationId;

    // Sabit nöbetçi: her zaman aynı yerde
    if (teacher.dutyType === 'sabit') {
      return homeId === locationId;
    }

    // Sabit değilse (hareketli veya belirtilmemiş): her nöbette bir sonraki yere kayar
    return ring[wrapIndex(homeIdx + weekOffset, ring.length)].id === locationId;
  });
}
