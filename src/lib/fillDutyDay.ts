import { v4 as uuidv4 } from 'uuid';
import { getDay, parseISO } from 'date-fns';
import { Assignment, Teacher, Location, Holiday } from '../types';
import {
  createFairDistributionState,
  FairDistributionState,
  getMonthKey,
  markAssignedToday,
  pickBestSlotIndex,
  pickTeacherForSlot,
  preferSlotPool,
  recordDutyAssignment,
} from './dutyDistribution';
import { seedFairStateFromHistory } from './dutyHistory';
import { buildTeacherHomeLocations, rotationAnchorWeek, teacherMatchesLocationOnDate } from './dutyLocation';
import { getWeeklyDutyCount, remainingActiveDaysInWeek, slotsForDay, weekKey } from './weeklyQuota';
import { countTeacherDutiesInWeek, preferredDayStillAhead, teachersForDutySlot } from './dutySlotRules';
import { canPlaceWeekDuty, extraDutyPlaceIds, orderSlotIds } from './extraDutyPlace';

function buildSlotsForDate(
  locations: Location[],
  date: Date,
  existingAssignments: Assignment[],
  schoolDays: number[],
  holidayDates: Set<string>,
): string[] {
  const dayOfWeek = getDay(date);
  const wk = weekKey(date);
  const remainingDays = remainingActiveDaysInWeek(date, schoolDays, holidayDates);
  const slots: string[] = [];
  for (const location of locations) {
    if (location.duties && location.duties.length > 0) {
      // Eski sistem: gün bazlı duties kayıtları.
      for (const duty of location.duties) {
        if (duty.day === dayOfWeek) slots.push(location.id);
      }
      continue;
    }
    // Yeni sistem: ana dağıtıcıyla aynı kural; o hafta tutulmuş nöbetler düşülür, kalan pay kalan günlere yayılır.
    if (!schoolDays.includes(dayOfWeek)) continue;
    const assignedThisWeek = existingAssignments.filter(
      a => a.locationId === location.id && weekKey(parseISO(a.date)) === wk,
    ).length;
    const count = slotsForDay(getWeeklyDutyCount(location), assignedThisWeek, remainingDays, schoolDays.length);
    for (let i = 0; i < count; i++) slots.push(location.id);
  }
  return slots;
}

/**
 * Çizelgedeki nöbetlerle adil dağıtım durumunu kurar (ana dağıtıcıdaki gibi göreli sayılarla).
 * Son nöbet tarihi, doldurulan günün haftasında nöbeti olan için o haftadan, diğerleri için o günden önceki son nöbetten alınır.
 */
export function seedFairStateFromAssignments(
  teachers: Teacher[],
  assignments: Assignment[],
  dateStr?: string,
): FairDistributionState {
  const ids = teachers.filter(t => t.dutyType !== 'nobetDisi').map(t => t.id);
  const state = createFairDistributionState(ids);
  const sorted = [...assignments].sort((a, b) => a.date.localeCompare(b.date));
  seedFairStateFromHistory(state, sorted, ids);
  if (!dateStr) return state;

  const wk = weekKey(parseISO(dateStr));
  const lastDate: Record<string, string> = {};
  const lastLoc: Record<string, string> = {};
  for (const a of sorted) {
    if (a.date < dateStr || weekKey(parseISO(a.date)) === wk) {
      lastDate[a.teacherId] = a.date;
      lastLoc[a.teacherId] = a.locationId;
    }
  }
  for (const id of ids) {
    if (lastDate[id]) {
      state.lastDutyDate[id] = lastDate[id];
      state.teacherLastLocation[id] = lastLoc[id];
    } else {
      delete state.lastDutyDate[id];
      delete state.teacherLastLocation[id];
    }
  }
  return state;
}

export function shouldFillDutyAfterHolidayRemoval(
  dateStr: string,
  assignments: Assignment[],
  schoolDays: number[],
): boolean {
  if (assignments.length === 0) return false;
  if (assignments.some(a => a.date === dateStr)) return false;
  const sorted = assignments.map(a => a.date).sort();
  if (dateStr < sorted[0] || dateStr > sorted[sorted.length - 1]) return false;
  return schoolDays.includes(getDay(parseISO(dateStr)));
}

/** Tatil olmaktan çıkan günleri tarih sırasıyla doldurur; her gün öncekilerin atamalarını hesaba katar. */
export function fillFreedHolidayDates(
  dates: string[],
  assignments: Assignment[],
  teachers: Teacher[],
  locations: Location[],
  holidays: Holiday[],
  schoolDays: number[],
): Assignment[] {
  const added: Assignment[] = [];
  for (const date of [...dates].sort()) {
    const all = added.length ? [...assignments, ...added] : assignments;
    if (!shouldFillDutyAfterHolidayRemoval(date, all, schoolDays)) continue;
    added.push(...generateDutyAssignmentsForDate(date, teachers, locations, all, holidays, schoolDays));
  }
  return added;
}

/** Tatil kaldırıldığında tek bir güne, çizelgeyi üreten dağıtıcıyla aynı kurallarla nöbet ataması üretir. */
export function generateDutyAssignmentsForDate(
  dateStr: string,
  teachers: Teacher[],
  locations: Location[],
  existingAssignments: Assignment[],
  holidays: Holiday[],
  schoolDays: number[] = [1, 2, 3, 4, 5],
): Assignment[] {
  if (holidays.some(h => h.date === dateStr)) return [];
  if (existingAssignments.some(a => a.date === dateStr)) return [];

  const eligibleTeachers = teachers.filter(t => t.dutyType !== 'nobetDisi');
  if (eligibleTeachers.length === 0 || locations.length === 0) return [];

  const date = parseISO(dateStr);
  const dayOfWeek = getDay(date);
  const holidayDates = new Set(holidays.map(h => h.date));
  const extraPlaces = extraDutyPlaceIds(locations);
  const slotsToFill = orderSlotIds(
    buildSlotsForDate(locations, date, existingAssignments, schoolDays, holidayDates),
    extraPlaces,
  );
  if (!slotsToFill.length) return [];

  const fairState = seedFairStateFromAssignments(teachers, existingAssignments, dateStr);
  const refWeekStart = rotationAnchorWeek(date);

  const monthKey = getMonthKey(dateStr);
  const assignedToday = new Set<string>();
  const weekDutyCount = countTeacherDutiesInWeek(existingAssignments, weekKey(date));
  const weeklySlots = locations.reduce((sum, loc) => sum + getWeeklyDutyCount(loc), 0);
  const allowExtraDuty = eligibleTeachers.length > 0 && eligibleTeachers.length < weeklySlots;
  const homeMap = buildTeacherHomeLocations(locations);
  const homeCount = (id: string) => homeMap[id]?.length ?? 0;
  const matchesSlot = (t: Teacher, locationId: string) =>
    homeCount(t.id) === 0 || teacherMatchesLocationOnDate(t, locationId, date, locations, homeMap, refWeekStart);
  const result: Assignment[] = [];

  for (let s = 0; s < slotsToFill.length; s++) {
    const dayPool = teachersForDutySlot(eligibleTeachers, dayOfWeek, assignedToday, {
      weekDutyCount,
      allowExtraDuty,
      fixedDayStillAhead: (t) => preferredDayStillAhead(t, date, schoolDays, holidayDates),
    });
    if (dayPool.length === 0) break;
    const availableForDay = dayPool.filter(t => canPlaceWeekDuty(weekDutyCount[t.id] ?? 0, slotsToFill[s], extraPlaces));
    if (availableForDay.length === 0) continue;
    const slotCandidates = availableForDay.filter(t => matchesSlot(t, slotsToFill[s]));
    const preferredCandidates = preferSlotPool(slotCandidates, assignedToday, id => homeCount(id) > 0);
    const pool = preferredCandidates.length > 0 ? preferredCandidates : slotCandidates.length > 0 ? slotCandidates : availableForDay;

    const chosen = pickTeacherForSlot(pool, fairState, assignedToday, slotsToFill[s], monthKey, dayOfWeek, dateStr);
    if (!chosen) continue;

    const bestSlotIdx = pickBestSlotIndex(
      slotsToFill,
      s,
      fairState,
      chosen.id,
      locId => matchesSlot(chosen, locId) && canPlaceWeekDuty(weekDutyCount[chosen.id] ?? 0, locId, extraPlaces),
    );
    if (bestSlotIdx !== s) {
      [slotsToFill[s], slotsToFill[bestSlotIdx]] = [slotsToFill[bestSlotIdx], slotsToFill[s]];
    }

    const locationId = slotsToFill[s];
    const extraDuty = (weekDutyCount[chosen.id] ?? 0) > 0;
    result.push({
      id: uuidv4(),
      date: dateStr,
      locationId,
      teacherId: chosen.id,
      ...(extraDuty ? { isDoubleDuty: true } : {}),
    });

    weekDutyCount[chosen.id] = (weekDutyCount[chosen.id] ?? 0) + 1;
    recordDutyAssignment(fairState, chosen.id, locationId, monthKey, s, false, dateStr);
    markAssignedToday(assignedToday, chosen.id, locationId);
  }

  return result;
}
