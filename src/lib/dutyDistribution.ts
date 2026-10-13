import { parseISO } from 'date-fns';
import { Teacher, getTeacherLessonCount } from '../types';
import { weekKey } from './weeklyQuota';

export interface FairDistributionState {
  dutyCounts: Record<string, number>;
  locationCounts: Record<string, Record<string, number>>;
  monthCounts: Record<string, Record<string, number>>;
  lastLocationIdx: Record<string, number>;
  /** Adil dağıtımda Nöbet Yerleri'nde kaydı olmayan öğretmenin ana yeri */
  teacherAnchorLocation: Record<string, string>;
  /** Öğretmenin son nöbette hangi yerde olduğu (rotasyon için) */
  teacherLastLocation: Record<string, string>;
  /** Öğretmenin son nöbet tarihi (YYYY-MM-DD); eşitlikte en uzun süredir nöbet tutmayan öne alınır. */
  lastDutyDate: Record<string, string>;
}

export function createFairDistributionState(teacherIds: string[]): FairDistributionState {
  const dutyCounts: Record<string, number> = {};
  const locationCounts: Record<string, Record<string, number>> = {};
  const monthCounts: Record<string, Record<string, number>> = {};
  const lastLocationIdx: Record<string, number> = {};
  const teacherAnchorLocation: Record<string, string> = {};
  const teacherLastLocation: Record<string, string> = {};
  const lastDutyDate: Record<string, string> = {};

  for (const id of teacherIds) {
    dutyCounts[id] = 0;
    locationCounts[id] = {};
    monthCounts[id] = {};
    lastLocationIdx[id] = -1;
  }

  return { dutyCounts, locationCounts, monthCounts, lastLocationIdx, teacherAnchorLocation, teacherLastLocation, lastDutyDate };
}

export function cloneFairState(state: FairDistributionState): FairDistributionState {
  const nested = (o: Record<string, Record<string, number>>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v }]));
  return {
    dutyCounts: { ...state.dutyCounts },
    locationCounts: nested(state.locationCounts),
    monthCounts: nested(state.monthCounts),
    lastLocationIdx: { ...state.lastLocationIdx },
    teacherAnchorLocation: { ...state.teacherAnchorLocation },
    teacherLastLocation: { ...state.teacherLastLocation },
    lastDutyDate: { ...state.lastDutyDate },
  };
}

function getLocationCount(state: FairDistributionState, teacherId: string, locationId: string): number {
  return state.locationCounts[teacherId]?.[locationId] ?? 0;
}

function getMonthCount(state: FairDistributionState, teacherId: string, monthKey: string): number {
  return state.monthCounts[teacherId]?.[monthKey] ?? 0;
}

const weekdayOrder = (day: number) => (day === 0 ? 7 : day);

/**
 * Gün önceliği: 0 = öğretmenin sabit nöbet günü, 1 = olağan,
 * 2 = sabit günü olan öğretmen o hafta zaten nöbet tuttuysa ya da sabit günü haftanın ilerisindeyse.
 */
function dayPreferenceRank(
  teacher: Teacher,
  state: FairDistributionState,
  dayOfWeek: number,
  dateStr?: string,
): number {
  if (typeof teacher.preferredDay !== 'number') return 1;
  const last = state.lastDutyDate[teacher.id];
  const servedThisWeek = !!(dateStr && last && weekKey(parseISO(last)) === weekKey(parseISO(dateStr)));
  if (servedThisWeek) return 2;
  if (teacher.preferredDay === dayOfWeek) return 0;
  if (weekdayOrder(teacher.preferredDay) > weekdayOrder(dayOfWeek)) return 2;
  return 1;
}

export function compareTeachersForFairSlot(
  a: Teacher,
  b: Teacher,
  state: FairDistributionState,
  assignedToday: Set<string>,
  locationId: string,
  monthKey: string,
  dayOfWeek: number,
  dateStr?: string,
): number {
  // Aynı gün ikinci nöbet (çift nöbet) yalnız başka aday kalmadığında verilir.
  const aToday = assignedToday.has(a.id) ? 1 : 0;
  const bToday = assignedToday.has(b.id) ? 1 : 0;
  if (aToday !== bToday) return aToday - bToday;

  const dayRankDiff = dayPreferenceRank(a, state, dayOfWeek, dateStr) - dayPreferenceRank(b, state, dayOfWeek, dateStr);
  if (dayRankDiff !== 0) return dayRankDiff;

  // Ay bazlı dengeyi en üste taşı - aynı ay içinde dengeli dağıtım için
  const monthDiff = getMonthCount(state, a.id, monthKey) - getMonthCount(state, b.id, monthKey);
  if (monthDiff !== 0) return monthDiff;

  // Toplam nöbet sayısı ikinci öncelik
  const totalDiff = state.dutyCounts[a.id] - state.dutyCounts[b.id];
  if (totalDiff !== 0) return totalDiff;

  // Rotasyon: Son nöbet yeri ile aynı yerde olan öğretmenleri daha az öncelikli yap
  const aLastLoc = state.teacherLastLocation[a.id];
  const bLastLoc = state.teacherLastLocation[b.id];
  const aWasHere = aLastLoc === locationId ? 1 : 0;
  const bWasHere = bLastLoc === locationId ? 1 : 0;
  if (aWasHere !== bWasHere) return aWasHere - bWasHere;

  // Yer bazlı nöbet sayısı
  const locDiff = getLocationCount(state, a.id, locationId) - getLocationCount(state, b.id, locationId);
  if (locDiff !== 0) return locDiff;

  // Ders saati son öncelik - çok fazla ders saati olan öğretmenler daha az nöbet almalı
  const lessonDiff = getTeacherLessonCount(a, dayOfWeek) - getTeacherLessonCount(b, dayOfWeek);
  if (lessonDiff !== 0) return lessonDiff;

  const aLastDate = state.lastDutyDate[a.id] ?? '';
  const bLastDate = state.lastDutyDate[b.id] ?? '';
  if (aLastDate !== bLastDate) return aLastDate < bLastDate ? -1 : 1;

  return a.name.localeCompare(b.name, 'tr');
}

export function pickTeacherForSlot(
  candidates: Teacher[],
  state: FairDistributionState,
  assignedToday: Set<string>,
  locationId: string,
  monthKey: string,
  dayOfWeek: number,
  dateStr?: string,
): Teacher | null {
  if (candidates.length === 0) return null;

  // Güvenlik kilidi: aynı gün aynı yerde aynı öğretmen ikinci kez atanmasın.
  // assignedToday artık teacherId_locationId formatında
  const pool = candidates.filter(t => !assignedToday.has(`${t.id}_${locationId}`));
  if (pool.length === 0) return null;

  const sorted = [...pool].sort((a, b) =>
    compareTeachersForFairSlot(a, b, state, assignedToday, locationId, monthKey, dayOfWeek, dateStr),
  );
  return sorted[0];
}

/** assignedToday hem öğretmen kimliğini hem `${teacherId}_${locationId}` anahtarını tutar. */
export function markAssignedToday(assignedToday: Set<string>, teacherId: string, locationId: string): void {
  assignedToday.add(teacherId);
  assignedToday.add(`${teacherId}_${locationId}`);
}

/**
 * Öğretmen bugün bu yere yazılabilir mi. Aynı gün ikinci nöbet yalnız birden fazla
 * nöbet yerine atanmış (çift nöbetli) öğretmene, farklı bir yerde ve atandığı yer sayısını aşmadan verilir.
 */
export function canTakeSlotToday(
  teacherId: string,
  locationId: string,
  assignedToday: Set<string>,
  homeCount: number,
): boolean {
  if (!assignedToday.has(teacherId)) return true;
  if (homeCount < 2 || assignedToday.has(`${teacherId}_${locationId}`)) return false;
  const prefix = `${teacherId}_`;
  let today = 0;
  for (const key of assignedToday) if (key.startsWith(prefix)) today++;
  return today < homeCount;
}

/**
 * Aday havuzu önceliği: o gün nöbeti olmayan ve bu yere atanmış öğretmenler,
 * sonra o gün nöbeti olmayan diğerleri, en son çift nöbet alabilecekler.
 */
export function preferSlotPool(
  candidates: Teacher[],
  assignedToday: Set<string>,
  hasHome: (teacherId: string) => boolean,
): Teacher[] {
  const free = candidates.filter(t => !assignedToday.has(t.id));
  const freeWithHome = free.filter(t => hasHome(t.id));
  if (freeWithHome.length > 0) return freeWithHome;
  if (free.length > 0) return free;
  return candidates;
}

export function recordDutyAssignment(
  state: FairDistributionState,
  teacherId: string,
  locationId: string,
  monthKey: string,
  slotIdx?: number,
  setAnchor?: boolean,
  dateStr?: string,
): void {
  state.dutyCounts[teacherId] = (state.dutyCounts[teacherId] ?? 0) + 1;
  if (dateStr && (state.lastDutyDate[teacherId] ?? '') < dateStr) {
    state.lastDutyDate[teacherId] = dateStr;
  }

  if (!state.locationCounts[teacherId]) state.locationCounts[teacherId] = {};
  state.locationCounts[teacherId][locationId] = (state.locationCounts[teacherId][locationId] ?? 0) + 1;

  if (!state.monthCounts[teacherId]) state.monthCounts[teacherId] = {};
  state.monthCounts[teacherId][monthKey] = (state.monthCounts[teacherId][monthKey] ?? 0) + 1;

  // Son nöbet yerini kaydet (rotasyon için)
  state.teacherLastLocation[teacherId] = locationId;

  if (setAnchor && !state.teacherAnchorLocation[teacherId]) {
    state.teacherAnchorLocation[teacherId] = locationId;
  }

  if (slotIdx !== undefined) {
    state.lastLocationIdx[teacherId] = slotIdx;
  }
}

export function pickBestSlotIndex(
  slotsToFill: string[],
  currentIdx: number,
  state: FairDistributionState,
  teacherId: string,
  matchesSlot?: (locationId: string) => boolean,
): number {
  if (slotsToFill.length <= 1) return currentIdx;

  if (matchesSlot) {
    for (let j = currentIdx; j < slotsToFill.length; j++) {
      if (matchesSlot(slotsToFill[j])) return j;
    }
  }

  const prevLocIdx = state.lastLocationIdx[teacherId] ?? -1;
  for (let j = currentIdx; j < slotsToFill.length; j++) {
    if (j !== prevLocIdx) return j;
  }
  return currentIdx;
}

export function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** Çizelge analizi: öğretmen × nöbet yeri sayıları */
export function computeLocationDistribution(
  assignments: { teacherId: string; locationId: string }[],
  teacherNames: Record<string, string>,
  locationNames: Record<string, string>,
): { teacherId: string; teacherName: string; locations: { locationId: string; locationName: string; count: number }[] }[] {
  const map = new Map<string, Map<string, number>>();
  for (const a of assignments) {
    if (!map.has(a.teacherId)) map.set(a.teacherId, new Map());
    const locMap = map.get(a.teacherId)!;
    locMap.set(a.locationId, (locMap.get(a.locationId) ?? 0) + 1);
  }

  return [...map.entries()]
    .map(([teacherId, locMap]) => ({
      teacherId,
      teacherName: teacherNames[teacherId] || '?',
      locations: [...locMap.entries()]
        .map(([locationId, count]) => ({
          locationId,
          locationName: locationNames[locationId] || '?',
          count,
        }))
        .sort((a, b) => a.locationName.localeCompare(b.locationName, 'tr')),
    }))
    .sort((a, b) => a.teacherName.localeCompare(b.teacherName, 'tr'));
}

/** Çizelge analizi: öğretmen × ay sayıları */
export function computeMonthDistribution(
  assignments: { teacherId: string; date: string }[],
  teacherNames: Record<string, string>,
): { teacherId: string; teacherName: string; months: { monthKey: string; count: number }[] }[] {
  const map = new Map<string, Map<string, number>>();
  for (const a of assignments) {
    const monthKey = getMonthKey(a.date);
    if (!map.has(a.teacherId)) map.set(a.teacherId, new Map());
    const monthMap = map.get(a.teacherId)!;
    monthMap.set(monthKey, (monthMap.get(monthKey) ?? 0) + 1);
  }

  return [...map.entries()]
    .map(([teacherId, monthMap]) => ({
      teacherId,
      teacherName: teacherNames[teacherId] || '?',
      months: [...monthMap.entries()]
        .map(([monthKey, count]) => ({ monthKey, count }))
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
    }))
    .sort((a, b) => a.teacherName.localeCompare(b.teacherName, 'tr'));
}
