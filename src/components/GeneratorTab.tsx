import { useState, useMemo, useEffect } from 'react';
import { format, addDays, isBefore, isSameDay, getDay, parseISO, startOfWeek } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { Calendar as CalendarIcon, Settings2, AlertCircle, Repeat, MapPin, Users, BarChart3, RefreshCw, ArrowRightLeft } from 'lucide-react';
import { Teacher, Location, Assignment, SchoolInfo, DEFAULT_SCHOOL_SETTINGS, Holiday, ScheduleArchive, canTeacherDutyOnDay, sortLocationsByOrder } from '../types';
import {
  canTakeSlotToday,
  cloneFairState,
  createFairDistributionState,
  getMonthKey,
  markAssignedToday,
  pickBestSlotIndex,
  pickTeacherForSlot,
  preferSlotPool,
  recordDutyAssignment,
} from '../lib/dutyDistribution';
import { buildTeacherHomeLocations, teacherMatchesLocationOnDate, rotationAnchorWeek } from '../lib/dutyLocation';
import { collectDutyHistory, historyCountsForWeek, lastHistoryDate, seedFairStateFromHistory } from '../lib/dutyHistory';
import { arrangeStaircaseWeek, staircaseTarget, type LastDuty, type StaircaseSlot, type StaircaseTarget } from '../lib/staircase';
import {
  describeDailyDuty,
  getWeeklyDutyCount,
  maxDailyDuties,
  remainingActiveDaysInWeek,
  slotsForDay,
  weekKey,
} from '../lib/weeklyQuota';

interface Props {
  teachers: Teacher[];
  locations: Location[];
  holidays: Holiday[];
  onGenerate: (assignments: Assignment[]) => void;
  onSuccess: () => void;
  schoolInfo: SchoolInfo;
  /** Mevcut çizelge ve arşivler: yeni çizelge bunların devamı olarak hazırlanır. */
  currentAssignments?: Assignment[];
  scheduleArchives?: ScheduleArchive[];
}

const DAYS_OF_WEEK = [
  { id: 1, label: 'Pazartesi' },
  { id: 2, label: 'Salı' },
  { id: 3, label: 'Çarşamba' },
  { id: 4, label: 'Perşembe' },
  { id: 5, label: 'Cuma' },
  { id: 6, label: 'Cumartesi' },
  { id: 0, label: 'Pazar' },
];

const DAY_SHORT: Record<number, string> = {
  0: 'Paz', 1: 'Pzt', 2: 'Sal', 3: 'Çar', 4: 'Per', 5: 'Cum', 6: 'Cmt'
};

type RotationMode = 'locationBased' | 'standard' | 'rotating' | 'staircase';

export default function GeneratorTab({
  teachers,
  locations,
  holidays,
  onGenerate,
  onSuccess,
  schoolInfo,
  currentAssignments = [],
  scheduleArchives = [],
}: Props) {
  const settings = schoolInfo.settings ?? DEFAULT_SCHOOL_SETTINGS;
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [rotationMode, setRotationMode] = useState<RotationMode>('standard');
  const [activeDays, setActiveDays] = useState<number[]>(settings.schoolDays);
  const [error, setError] = useState<string | null>(null);
  const [continueFromHistory, setContinueFromHistory] = useState(true);

  const history = useMemo(
    () => (continueFromHistory && startDate ? collectDutyHistory(currentAssignments, scheduleArchives, startDate) : []),
    [continueFromHistory, currentAssignments, scheduleArchives, startDate],
  );
  const lastScheduledDate = useMemo(() => {
    const all = [...currentAssignments, ...scheduleArchives.flatMap(a => a.assignments || [])];
    return all.reduce<string | null>((max, a) => (!max || a.date > max ? a.date : max), null);
  }, [currentAssignments, scheduleArchives]);
  const lastHistoryDay = lastHistoryDate(history);

  const sortedLocations = useMemo(() => sortLocationsByOrder(locations), [locations]);

  useEffect(() => {
    setActiveDays(settings.schoolDays);
  }, [settings.schoolDays.join(',')]);

  // Bir günde tüm yerlere konabilecek en fazla nöbetçi
  const totalDuties = sortedLocations.reduce(
    (sum, loc) => sum + maxDailyDuties(getWeeklyDutyCount(loc), activeDays.length),
    0,
  );
  const eligibleTeachers = useMemo(() => teachers.filter(t => t.dutyType !== 'nobetDisi'), [teachers]);
  const holidayDates = useMemo(() => new Set(holidays.map(h => h.date)), [holidays]);
  const teacherHomeLocation = useMemo(() => buildTeacherHomeLocations(sortedLocations), [sortedLocations]);
  const homeCount = (teacherId: string) => teacherHomeLocation[teacherId]?.length ?? 0;
  const hasHome = (teacherId: string) => homeCount(teacherId) > 0;

  const weeklyStats = useMemo(() => {
    const totalWeekly = sortedLocations.reduce((sum, loc) => sum + getWeeklyDutyCount(loc), 0);
    const teacherCount = eligibleTeachers.length;
    return { totalWeekly, teacherCount };
  }, [sortedLocations, eligibleTeachers]);

  const dailyLabel = (loc: Location) => describeDailyDuty(getWeeklyDutyCount(loc), activeDays.length);

  const createSeededState = () => {
    const ids = eligibleTeachers.map((t: Teacher) => t.id);
    const state = createFairDistributionState(ids);
    seedFairStateFromHistory(state, history, ids);
    return state;
  };

  const rotationRefWeek = (start: Date) =>
    continueFromHistory ? rotationAnchorWeek(start) : startOfWeek(start, { weekStartsOn: 1 });

  const resetWeeklyCounts = (counts: Record<string, number>, wk: string) => {
    const fromHistory = historyCountsForWeek(history, wk);
    for (const loc of sortedLocations) counts[loc.id] = fromHistory[loc.id] ?? 0;
  };

  const toggleDay = (dayId: number) => {
    setActiveDays(prev =>
      prev.includes(dayId)
        ? prev.filter(d => d !== dayId)
        : [...prev, dayId]
    );
  };

  const handleGenerate = () => {
    setError(null);

    if (locations.length === 0) {
      setError('Lütfen önce nöbet yeri ekleyin.');
      return;
    }

    const start = parseISO(startDate);
    const end = parseISO(endDate);

    if (isBefore(end, start)) {
      setError('Bitiş tarihi başlangıç tarihinden önce olamaz.');
      return;
    }

    if (rotationMode === 'locationBased' || rotationMode === 'rotating') {
      return generateDayByDay(start, end);
    }
    if (rotationMode === 'staircase') {
      return generateStaircase(start, end);
    }
    return generateFairDistribution(start, end);
  };

  const resolveTeacherForSlot = (
    preferredTeacherId: string,
    dayOfWeek: number,
    locationId: string,
    date: Date,
    monthKey: string,
    assignedToday: Set<string>,
    fairState: ReturnType<typeof createFairDistributionState>,
    refWeekStart: Date,
  ): string | null => {
    const location = sortedLocations.find(l => l.id === locationId);
    const hasAssignedTeachers = location?.assignedTeacherIds && location.assignedTeacherIds.length > 0;
    // Sabit Atama'da herkes atandığı yerde kalır; Dönerli'de hareketliler haftalık döner.
    const matchesAssigned = (t: Teacher) =>
      rotationMode === 'locationBased'
        ? (teacherHomeLocation[t.id] ?? []).includes(locationId)
        : teacherMatchesLocationOnDate(t, locationId, date, sortedLocations, teacherHomeLocation, refWeekStart);

    // Yeni sistemde genellikle preferredTeacherId boş gelir, doğrudan adil dağıtım yapılır
    if (preferredTeacherId) {
      const preferred = teachers.find(t => t.id === preferredTeacherId);
      if (
        preferred &&
        canTeacherDutyOnDay(preferred, dayOfWeek) &&
        !assignedToday.has(preferredTeacherId) &&
        matchesAssigned(preferred)
      ) {
        return preferredTeacherId;
      }
    }

    // Eğer bu nöbet yerine atanmış öğretmen yoksa, tüm eligible öğretmenleri adil dağıt
    if (!hasAssignedTeachers) {
      const available = eligibleTeachers.filter((t: Teacher) =>
        canTeacherDutyOnDay(t, dayOfWeek) &&
        !assignedToday.has(t.id)
      );
      // Dönüş sırası bu yere gelen hareketliler önce; başka yere atanmışlar kendi yerlerinde
      // boş kalmasın diye en sona bırakılır.
      const rotatedHere = available.filter((t: Teacher) => hasHome(t.id) && matchesAssigned(t));
      const unanchored = available.filter((t: Teacher) => !hasHome(t.id));
      const pool = rotatedHere.length > 0 ? rotatedHere : unanchored.length > 0 ? unanchored : available;
      const chosen = pickTeacherForSlot(pool, fairState, assignedToday, locationId, monthKey, dayOfWeek, format(date, 'yyyy-MM-dd'));
      return chosen?.id ?? null;
    }

    // Atanmış öğretmenler varsa, onları öncelikli olarak kullan
    const substitutes = eligibleTeachers.filter((t: Teacher) => {
      if (preferredTeacherId && t.id === preferredTeacherId) return false;
      if (!canTeacherDutyOnDay(t, dayOfWeek)) return false;
      if (!canTakeSlotToday(t.id, locationId, assignedToday, homeCount(t.id))) return false;
      if (!hasHome(t.id)) return true;
      return matchesAssigned(t);
    });

    // Pool oluştur: önce o gün boşta olan yerleşik öğretmenler, sonra diğerleri, en son çift nöbet
    const preferred = preferSlotPool(substitutes, assignedToday, hasHome);
    const pool = preferred.length > 0
      ? preferred
      : eligibleTeachers.filter((t: Teacher) => canTeacherDutyOnDay(t, dayOfWeek) && !assignedToday.has(t.id));

    const chosen = pickTeacherForSlot(pool, fairState, assignedToday, locationId, monthKey, dayOfWeek, format(date, 'yyyy-MM-dd'));
    return chosen?.id ?? null;
  };

  const recordSlotAssignment = (
    fairState: ReturnType<typeof createFairDistributionState>,
    teacherId: string,
    locationId: string,
    dateStr: string,
    slotIdx?: number,
  ) => {
    // Ana yer atamasını kaldır - aynı öğretmenin her gün aynı yere atanmasını önlemek için
    recordDutyAssignment(fairState, teacherId, locationId, getMonthKey(dateStr), slotIdx, false, dateStr);
  };

  const teacherMatchesSlot = (
    teacher: Teacher,
    locationId: string,
    date: Date,
    refWeekStart: Date,
  ): boolean => {
    // Sadece manuel atanmış öğretmenleri kullan, otomatik anchor'ları kaldır
    if (!hasHome(teacher.id)) return true;
    return teacherMatchesLocationOnDate(teacher, locationId, date, sortedLocations, teacherHomeLocation, refWeekStart);
  };

  // Sabit Atama ve Dönerli: her yer için haftalık nöbetçi sayısı kadar atama yapılır.
  // Hareketli öğretmenlerin yerinin haftalık dönmesi teacherMatchesLocationOnDate içinde sağlanır.
  const generateDayByDay = (start: Date, end: Date) => {
    if (totalDuties === 0) {
      setError('Nöbet yerlerine henüz nöbetçi sayısı belirlenmemiş.');
      return;
    }

    const fairState = createSeededState();
    const newAssignments: Assignment[] = [];
    let currentDate = start;
    const refWeekStart = rotationRefWeek(start);
    const activeDayCount = activeDays.length;

    const weeklyAssignmentCounts: Record<string, number> = {};
    let currentWeek = '';

    while (isBefore(currentDate, end) || isSameDay(currentDate, end)) {
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      const dayOfWeek = getDay(currentDate);
      if (holidayDates.has(dateStr) || !activeDays.includes(dayOfWeek)) {
        currentDate = addDays(currentDate, 1);
        continue;
      }

      const wk = weekKey(currentDate);
      if (wk !== currentWeek) {
        currentWeek = wk;
        resetWeeklyCounts(weeklyAssignmentCounts, wk);
      }

      const monthKey = getMonthKey(dateStr);
      // Bir öğretmen aynı günde 1 nöbet tutar; çift nöbetliler gerekirse ikinci yerinde de tutar.
      const assignedToday = new Set<string>();
      const remainingDays = remainingActiveDaysInWeek(currentDate, activeDays, holidayDates);

      for (const location of sortedLocations) {
        const slots = slotsForDay(
          getWeeklyDutyCount(location),
          weeklyAssignmentCounts[location.id],
          remainingDays,
          activeDayCount,
        );
        for (let k = 0; k < slots; k++) {
          const teacherId = resolveTeacherForSlot(
            '',
            dayOfWeek,
            location.id,
            currentDate,
            monthKey,
            assignedToday,
            fairState,
            refWeekStart,
          );
          if (!teacherId) break;

          newAssignments.push({
            id: uuidv4(),
            date: dateStr,
            locationId: location.id,
            teacherId,
            ...(assignedToday.has(teacherId) ? { isDoubleDuty: true } : {}),
          });
          markAssignedToday(assignedToday, teacherId, location.id);
          recordSlotAssignment(fairState, teacherId, location.id, dateStr);
          weeklyAssignmentCounts[location.id]++;
        }
      }
      currentDate = addDays(currentDate, 1);
    }

    if (newAssignments.length === 0) {
      setError('Seçilen tarih aralığında nöbet atanacak gün bulunamadı.');
      return;
    }

    onGenerate(newAssignments);
    onSuccess();
  };

  // Adil Dönerli: tüm eligible öğretmenler adil şekilde dağıtılır
  const generateFairDistribution = (start: Date, end: Date) => {
    if (totalDuties === 0) {
      setError('Nöbet yerlerine henüz nöbetçi sayısı belirlenmemiş.');
      return;
    }

    if (eligibleTeachers.length === 0) {
      setError('Nöbet tutabilecek öğretmen bulunmuyor.');
      return;
    }

    const fairState = createSeededState();
    const newAssignments: Assignment[] = [];
    let currentDate = start;
    const refWeekStart = rotationRefWeek(start);
    const activeDayCount = activeDays.length;

    const weeklyAssignmentCounts: Record<string, number> = {};
    let currentWeek = '';

    while (isBefore(currentDate, end) || isSameDay(currentDate, end)) {
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      const dayOfWeek = getDay(currentDate);
      if (holidayDates.has(dateStr) || !activeDays.includes(dayOfWeek)) {
        currentDate = addDays(currentDate, 1);
        continue;
      }

      const wk = weekKey(currentDate);
      if (wk !== currentWeek) {
        currentWeek = wk;
        resetWeeklyCounts(weeklyAssignmentCounts, wk);
      }

      const monthKey = getMonthKey(dateStr);
      const assignedToday = new Set<string>();
      const remainingDays = remainingActiveDaysInWeek(currentDate, activeDays, holidayDates);

      const slotsToFill: string[] = [];
      for (const location of sortedLocations) {
        const slots = slotsForDay(
          getWeeklyDutyCount(location),
          weeklyAssignmentCounts[location.id],
          remainingDays,
          activeDayCount,
        );
        for (let k = 0; k < slots; k++) slotsToFill.push(location.id);
      }

      const availableForDay = eligibleTeachers.filter((t: Teacher) => canTeacherDutyOnDay(t, dayOfWeek));

      if (availableForDay.length === 0 || slotsToFill.length === 0) {
        currentDate = addDays(currentDate, 1);
        continue;
      }

      for (let s = 0; s < slotsToFill.length; s++) {
        const slotCandidates = availableForDay.filter((t: Teacher) =>
          canTakeSlotToday(t.id, slotsToFill[s], assignedToday, homeCount(t.id))
          && teacherMatchesSlot(t, slotsToFill[s], currentDate, refWeekStart),
        );
        const preferredCandidates = preferSlotPool(slotCandidates, assignedToday, hasHome);
        const pool = preferredCandidates.length > 0
          ? preferredCandidates
          : availableForDay.filter((t: Teacher) => !assignedToday.has(t.id));

        const chosen = pickTeacherForSlot(
          pool,
          fairState,
          assignedToday,
          slotsToFill[s],
          monthKey,
          dayOfWeek,
          dateStr,
        );
        if (!chosen) continue;

        const isDoubleDuty = assignedToday.has(chosen.id);
        if (!isDoubleDuty) {
          const matchesSlot = (locId: string) =>
            teacherMatchesSlot(chosen, locId, currentDate, refWeekStart);
          const bestSlotIdx = pickBestSlotIndex(slotsToFill, s, fairState, chosen.id, matchesSlot);
          if (bestSlotIdx !== s) {
            [slotsToFill[s], slotsToFill[bestSlotIdx]] = [slotsToFill[bestSlotIdx], slotsToFill[s]];
          }
        }

        const locationId = slotsToFill[s];
        newAssignments.push({
          id: uuidv4(),
          date: dateStr,
          locationId,
          teacherId: chosen.id,
          ...(isDoubleDuty ? { isDoubleDuty: true } : {}),
        });

        recordSlotAssignment(fairState, chosen.id, locationId, dateStr, s);
        markAssignedToday(assignedToday, chosen.id, locationId);
        weeklyAssignmentCounts[locationId]++;
      }

      currentDate = addDays(currentDate, 1);
    }

    if (newAssignments.length === 0) {
      setError('Seçilen tarih aralığında nöbet atanacak gün bulunamadı.');
      return;
    }

    onGenerate(newAssignments);
    onSuccess();
  };

  // Merdiven: hem nöbet günü hem nöbet yeri her hafta 1 adım kayar
  const generateStaircase = (start: Date, end: Date) => {
    if (eligibleTeachers.length === 0) {
      setError('Nöbet tutabilecek öğretmen bulunmuyor.');
      return;
    }
    if (activeDays.length === 0) {
      setError('Lütfen en az bir nöbet günü seçin.');
      return;
    }
    if (eligibleTeachers.length < totalDuties) {
      setError('Nöbet tutacak öğretmen sayısı, toplam nöbetçi sayısından az olamaz.');
      return;
    }

    let fairState = createSeededState();
    const newAssignments: Assignment[] = [];

    const sortedDays = [...activeDays].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
    const D = sortedDays.length;
    const ring = sortedLocations
      .filter(l => getWeeklyDutyCount(l) > 0 || (l.duties?.length ?? 0) > 0)
      .map(l => l.id);
    const teacherById = new Map<string, Teacher>(eligibleTeachers.map((t: Teacher) => [t.id, t]));
    const lastDuty: Record<string, LastDuty> = {};
    for (const a of history) {
      lastDuty[a.teacherId] = { dayOfWeek: getDay(parseISO(a.date)), locationId: a.locationId };
    }

    const refWeekStart = rotationRefWeek(start);
    const refWeekStartMs = refWeekStart.getTime();
    const weekMap = new Map<number, Map<number, string>>();

    let currentDate = start;
    while (isBefore(currentDate, end) || isSameDay(currentDate, end)) {
      const dow = getDay(currentDate);
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      if (activeDays.includes(dow) && !holidayDates.has(dateStr)) {
        const curWeekStart = startOfWeek(currentDate, { weekStartsOn: 1 }).getTime();
        const weekIdx = Math.round((curWeekStart - refWeekStartMs) / (7 * 24 * 60 * 60 * 1000));
        if (!weekMap.has(weekIdx)) weekMap.set(weekIdx, new Map());
        weekMap.get(weekIdx)!.set(dow, dateStr);
      }
      currentDate = addDays(currentDate, 1);
    }

    const sortedWeeks = [...weekMap.entries()].sort(([a], [b]) => a - b);

    for (const [, dates] of sortedWeeks) {
      const weekAssignments: { dateStr: string; locationId: string }[] = [];

      const weeklyAssignmentCounts: Record<string, number> = {};
      const firstDateOfWeek = [...dates.values()].sort()[0];
      resetWeeklyCounts(weeklyAssignmentCounts, weekKey(parseISO(firstDateOfWeek)));

      for (const day of sortedDays) {
        const dateStr = dates.get(day);
        if (!dateStr) continue;
        const remainingDays = remainingActiveDaysInWeek(parseISO(dateStr), activeDays, holidayDates);
        for (const location of sortedLocations) {
          const slots = slotsForDay(
            getWeeklyDutyCount(location),
            weeklyAssignmentCounts[location.id],
            remainingDays,
            D,
          );
          for (let k = 0; k < slots; k++) {
            weekAssignments.push({ dateStr, locationId: location.id });
            weeklyAssignmentCounts[location.id]++;
          }
        }
      }

      // Bir öğretmen aynı günde 1 nöbet tutar (haftada değil); çift nöbetliler gerekirse ikinci yerinde de tutar.
      // Önce adalet sırasıyla bu hafta kimin nöbet tutacağı seçilir, sonra kişiler merdiven sırasına dizilir.
      const assignedByDate = new Map<string, Set<string>>();
      const monthKey = weekAssignments[0] ? getMonthKey(weekAssignments[0].dateStr) : '';
      const weekStartState = cloneFairState(fairState);
      const picked: StaircaseSlot[] = [];

      for (const { dateStr, locationId } of weekAssignments) {
        if (!assignedByDate.has(dateStr)) assignedByDate.set(dateStr, new Set());
        const assignedToday = assignedByDate.get(dateStr)!;
        const dow = getDay(parseISO(dateStr));
        const date = parseISO(dateStr);
        const availableForDay = eligibleTeachers.filter((t: Teacher) => canTeacherDutyOnDay(t, dow));
        const slotCandidates = availableForDay.filter((t: Teacher) =>
          canTakeSlotToday(t.id, locationId, assignedToday, homeCount(t.id))
          && teacherMatchesSlot(t, locationId, date, refWeekStart),
        );
        const preferredCandidates = preferSlotPool(slotCandidates, assignedToday, hasHome);
        const pool = preferredCandidates.length > 0
          ? preferredCandidates
          : availableForDay.filter((t: Teacher) => !assignedToday.has(t.id));

        const chosen = pickTeacherForSlot(
          pool,
          fairState,
          assignedToday,
          locationId,
          getMonthKey(dateStr) || monthKey,
          dow,
          dateStr,
        );
        if (!chosen) continue;

        picked.push({ dateStr, dayOfWeek: dow, locationId, teacherId: chosen.id });
        markAssignedToday(assignedToday, chosen.id, locationId);
        recordSlotAssignment(fairState, chosen.id, locationId, dateStr);
      }

      const targets: Record<string, StaircaseTarget | null> = {};
      for (const p of picked) targets[p.teacherId] = staircaseTarget(lastDuty[p.teacherId], sortedDays, ring);
      const arranged = arrangeStaircaseWeek(picked, {
        days: sortedDays,
        ring,
        targets,
        preferredDayOf: id => teacherById.get(id)?.preferredDay,
        dayOk: (id, slot) => {
          const t = teacherById.get(id);
          return !!t && canTeacherDutyOnDay(t, slot.dayOfWeek);
        },
        homeOk: (id, slot) => {
          const t = teacherById.get(id);
          return !!t && teacherMatchesSlot(t, slot.locationId, parseISO(slot.dateStr), refWeekStart);
        },
      });

      fairState = weekStartState;
      const seenByDate = new Map<string, Set<string>>();
      for (const slot of arranged) {
        if (!seenByDate.has(slot.dateStr)) seenByDate.set(slot.dateStr, new Set());
        const seen = seenByDate.get(slot.dateStr)!;
        newAssignments.push({
          id: uuidv4(),
          date: slot.dateStr,
          locationId: slot.locationId,
          teacherId: slot.teacherId,
          ...(seen.has(slot.teacherId) ? { isDoubleDuty: true } : {}),
        });
        seen.add(slot.teacherId);
        recordSlotAssignment(fairState, slot.teacherId, slot.locationId, slot.dateStr);
        lastDuty[slot.teacherId] = { dayOfWeek: slot.dayOfWeek, locationId: slot.locationId };
      }
    }

    if (newAssignments.length === 0) {
      setError('Seçilen tarih aralığında nöbet atanacak gün bulunamadı.');
      return;
    }

    onGenerate(newAssignments);
    onSuccess();
  };

  const sortedPreviewDays = [...activeDays].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
  const previewLocs = sortedLocations.filter(l => getWeeklyDutyCount(l) > 0 || (l.duties?.length ?? 0) > 0);

  const { totalWeekly, teacherCount } = weeklyStats;
  const ratio = teacherCount > 0 && totalWeekly > 0
    ? (totalWeekly / teacherCount).toFixed(1)
    : '0';

  return (
    <div className="w-full mx-auto space-y-6">
      <div className="bg-surface p-8 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
            <Settings2 className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-semibold text-slate-800">Program Ayarları</h2>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        <div className="space-y-6">
          {/* Date Range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Başlangıç Tarihi</label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Bitiş Tarihi</label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Önceki nöbetlerin devamı */}
          <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/40 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={continueFromHistory}
                onChange={(e) => setContinueFromHistory(e.target.checked)}
                className="w-4 h-4 accent-indigo-600"
              />
              <span className="text-sm font-medium text-slate-700">Önceki nöbetlerin devamı olarak hazırla</span>
            </label>
            {continueFromHistory ? (
              lastHistoryDay ? (
                <p className="text-xs text-slate-600">
                  {format(parseISO(lastHistoryDay), 'dd.MM.yyyy')} tarihine kadar tutulan nöbetler dikkate alınır:
                  az nöbet tutanlar öne alınır, hareketli öğretmenlerin yer sırası ve haftalık sayılar kaldığı yerden sürer.
                </p>
              ) : (
                <p className="text-xs text-slate-500">Başlangıç tarihinden önce kayıtlı nöbet yok; çizelge baştan hazırlanır.</p>
              )
            ) : (
              <p className="text-xs text-slate-500">Önceki nöbetler dikkate alınmaz; dağıtım sıfırdan başlar.</p>
            )}
            {lastScheduledDate && (
              <button
                type="button"
                onClick={() => setStartDate(format(addDays(parseISO(lastScheduledDate), 1), 'yyyy-MM-dd'))}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline"
              >
                Son nöbetin ertesi gününden başla ({format(addDays(parseISO(lastScheduledDate), 1), 'dd.MM.yyyy')})
              </button>
            )}
          </div>

          {/* Rotation Mode */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">Nöbet Dönüş Şekli</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Dönerli */}
              <button
                onClick={() => setRotationMode('rotating')}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  rotationMode === 'rotating'
                    ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500'
                    : 'border-slate-200 hover:border-slate-300 bg-surface'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`p-1.5 rounded-lg ${rotationMode === 'rotating' ? 'bg-violet-100 text-violet-600' : 'bg-slate-100 text-slate-500'}`}>
                    <RefreshCw className="w-5 h-5" />
                  </div>
                  <span className={`font-semibold text-sm ${rotationMode === 'rotating' ? 'text-violet-700' : 'text-slate-700'}`}>
                    Dönerli
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Aynı günde kalınır. Hareketli öğretmenlerin nöbet yeri haftalık döner; sabit öğretmenler hep aynı yerde.
                </p>
              </button>

              {/* Merdiven */}
              <button
                onClick={() => setRotationMode('staircase')}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  rotationMode === 'staircase'
                    ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500'
                    : 'border-slate-200 hover:border-slate-300 bg-surface'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`p-1.5 rounded-lg ${rotationMode === 'staircase' ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                    <ArrowRightLeft className="w-5 h-5" />
                  </div>
                  <span className={`font-semibold text-sm ${rotationMode === 'staircase' ? 'text-amber-700' : 'text-slate-700'}`}>
                    Merdiven
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Öğretmen her yeni nöbetinde bir sonraki güne ve bir sonraki nöbet yerine kayar. Kimin nöbet tutacağı yıl içi dengeye göre belirlenir.
                </p>
              </button>

              {/* Adil Dönerli */}
              <button
                onClick={() => setRotationMode('standard')}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  rotationMode === 'standard'
                    ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                    : 'border-slate-200 hover:border-slate-300 bg-surface'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`p-1.5 rounded-lg ${rotationMode === 'standard' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                    <Repeat className="w-5 h-5" />
                  </div>
                  <span className={`font-semibold text-sm ${rotationMode === 'standard' ? 'text-indigo-700' : 'text-slate-700'}`}>
                    Adil Dönerli
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Tüm öğretmenler yıl boyunca eşit dağıtılır; nöbet yeri ve ay bazında da denge sağlanır.
                </p>
              </button>

              {/* Sabit Atama */}
              <button
                onClick={() => setRotationMode('locationBased')}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  rotationMode === 'locationBased'
                    ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                    : 'border-slate-200 hover:border-slate-300 bg-surface'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`p-1.5 rounded-lg ${rotationMode === 'locationBased' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                    <MapPin className="w-5 h-5" />
                  </div>
                  <span className={`font-semibold text-sm ${rotationMode === 'locationBased' ? 'text-emerald-700' : 'text-slate-700'}`}>
                    Sabit Atama
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Atanmış öğretmenler (hareketli olsalar da) hep atandıkları yerde kalır; sabit nöbet günü seçilenler o gün tutar. Müsait olmayan günlerde yıl içi denge korunarak vekil atanır.
                </p>
              </button>
            </div>
          </div>

          {/* Day selector for Merdiven */}
          {rotationMode === 'staircase' && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-700">Nöbet Günleri</label>
              <div className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map(day => (
                  <button
                    key={day.id}
                    onClick={() => toggleDay(day.id)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      activeDays.includes(day.id)
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Staircase Preview */}
          {rotationMode === 'staircase' && sortedPreviewDays.length >= 2 && previewLocs.length >= 2 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <h4 className="text-sm font-semibold text-amber-800 mb-1">Merdiven Nöbet Önizleme</h4>
              <p className="text-xs text-amber-700 mb-3">Örnek bir öğretmenin art arda nöbetleri:</p>
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse w-full">
                  <thead>
                    <tr>
                      <th className="py-1.5 px-2 text-left text-amber-600 font-semibold border-b border-amber-200">Nöbet</th>
                      <th className="py-1.5 px-2 text-left text-amber-600 font-semibold border-b border-amber-200">Gün</th>
                      <th className="py-1.5 px-2 text-left text-amber-600 font-semibold border-b border-amber-200">Nöbet Yeri</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1, 2, 3].map(step => (
                      <tr key={step}>
                        <td className="py-1.5 px-2 font-medium text-amber-700 border-b border-amber-100 whitespace-nowrap">
                          {step + 1}. nöbet
                        </td>
                        <td className="py-1.5 px-2 text-amber-900 font-semibold border-b border-amber-100">
                          {DAY_SHORT[sortedPreviewDays[step % sortedPreviewDays.length]]}
                        </td>
                        <td className="py-1.5 px-2 text-amber-700 border-b border-amber-100">
                          {previewLocs[step % previewLocs.length].name}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dönerli preview */}
          {rotationMode === 'rotating' && totalDuties > 0 && (
            <div className="bg-violet-50/50 border border-violet-100 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-violet-800 mb-2">Dönerli Önizleme</h4>
              <p className="text-xs text-slate-500 mb-3">Öğretmenler nöbet günlerinde haftalık döner.</p>
              <div className="space-y-2">
                {locations.map(loc => (
                  <div key={loc.id} className="bg-surface rounded-lg border border-violet-100 p-3">
                    <span className="font-medium text-slate-700 text-sm">{loc.name}</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
                        Haftada {getWeeklyDutyCount(loc)} nöbetçi ({dailyLabel(loc)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stats Panel for Adil Dönerli */}
          {rotationMode === 'standard' && totalDuties > 0 && teacherCount > 0 && (
            <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="w-4 h-4 text-indigo-600" />
                <h4 className="text-sm font-semibold text-indigo-800">Dağıtım Bilgileri</h4>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface rounded-lg border border-indigo-100 p-3 text-center">
                  <div className="text-2xl font-bold text-indigo-700">{teacherCount}</div>
                  <div className="text-xs text-slate-500 mt-1">Nöbet Tutacak Öğretmen</div>
                </div>
                <div className="bg-surface rounded-lg border border-indigo-100 p-3 text-center">
                  <div className="text-2xl font-bold text-indigo-700">{totalWeekly}</div>
                  <div className="text-xs text-slate-500 mt-1">Haftalık Slot</div>
                </div>
                <div className="bg-surface rounded-lg border border-indigo-100 p-3 text-center">
                  <div className="text-2xl font-bold text-indigo-700">~{ratio}</div>
                  <div className="text-xs text-slate-500 mt-1">Nöbet / Kişi / Hafta</div>
                </div>
              </div>

              {teacherCount > totalWeekly && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <Users className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-blue-700">
                    <span className="font-semibold">Öğretmen fazlası:</span> Her hafta {teacherCount - totalWeekly} öğretmen nöbet tutmayacak. 
                    Sistem en az nöbet tutanları önceliklendirir.
                  </p>
                </div>
              )}

              {teacherCount < totalWeekly && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <Users className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-700">
                    <span className="font-semibold">Öğretmen eksikliği:</span> Her hafta {totalWeekly - teacherCount} ekstra nöbet gerekiyor. 
                    Sistem çift nöbetleri adilce dağıtır.
                  </p>
                </div>
              )}

              {teacherCount === totalWeekly && (
                <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <Users className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-emerald-700">
                    <span className="font-semibold">Tam denge:</span> Öğretmen sayısı haftalık slot sayısına eşit.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {locations.map(loc => (
                  <span key={loc.id} className="text-xs bg-surface border border-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full">
                    {loc.name}: {getWeeklyDutyCount(loc)}/hafta ({dailyLabel(loc)})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Location-based preview */}
          {rotationMode === 'locationBased' && totalDuties > 0 && (
            <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-emerald-800 mb-3">Nöbet Atamaları Özeti</h4>
              <div className="space-y-2">
                {locations.map(loc => (
                  <div key={loc.id} className="bg-surface rounded-lg border border-emerald-100 p-3">
                    <span className="font-medium text-slate-700 text-sm">{loc.name}</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                        Haftada {getWeeklyDutyCount(loc)} nöbetçi ({dailyLabel(loc)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-6 border-t border-slate-100">
            <button
              onClick={handleGenerate}
              disabled={totalDuties === 0}
              className={`w-full py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm text-white ${
                rotationMode === 'locationBased'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : rotationMode === 'rotating'
                    ? 'bg-violet-600 hover:bg-violet-700'
                    : rotationMode === 'staircase'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-indigo-600 hover:bg-indigo-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <Settings2 className="w-5 h-5" />
              {rotationMode === 'locationBased'
                ? 'Sabit Atama ile Program Oluştur'
                : rotationMode === 'rotating'
                  ? 'Dönerli Program Oluştur'
                  : rotationMode === 'staircase'
                    ? 'Merdiven Nöbet Programı Oluştur'
                    : 'Adil Dönerli Program Oluştur'}
            </button>
            <p className="text-center text-sm text-slate-500 mt-3">
              {rotationMode === 'standard'
                ? `${teacherCount} öğretmen, ${locations.length} nöbet yeri, haftalık ${totalWeekly} slot`
                : rotationMode === 'staircase'
                  ? `${eligibleTeachers.length} öğretmen, ${locations.length} nöbet yeri, ${activeDays.length} gün`
                  : `${locations.length} nöbet yeri, ${totalDuties} görev ataması`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
