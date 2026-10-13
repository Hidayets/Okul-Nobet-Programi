import { addDays, format, getDay, parseISO } from 'date-fns';
import { Absence, Assignment, Location, Teacher } from '../types';
import { getWeeklyDutyCount, remainingActiveDaysInWeek, slotsForDay, weekKey } from './weeklyQuota';

export interface ScheduleIssue {
  level: 'red' | 'orange';
  text: string;
}

function dayLabel(date: string): string {
  return format(parseISO(date), 'dd.MM.yyyy');
}

function nextSchoolDay(date: string, schoolDays: number[], holidays: Set<string>): string | null {
  let cursor = addDays(parseISO(date), 1);
  for (let i = 0; i < 14; i++) {
    const key = format(cursor, 'yyyy-MM-dd');
    if (schoolDays.includes(getDay(cursor)) && !holidays.has(key)) return key;
    cursor = addDays(cursor, 1);
  }
  return null;
}

export function scanSchedule(input: {
  assignments: Assignment[];
  teachers: Teacher[];
  locations: Location[];
  absences: Absence[];
  holidays: { date: string }[];
  schoolDays: number[];
}): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const holidaySet = new Set(input.holidays.map((h) => h.date));
  const schoolDays = input.schoolDays.length > 0 ? input.schoolDays : [1, 2, 3, 4, 5];
  const teacherName = new Map(input.teachers.map((t) => [t.id, t.name]));
  const dutyDates = [...new Set(input.assignments.map((a) => a.date))]
    .filter((date) => !holidaySet.has(date))
    .sort();

  const fullDayAbsent = new Set(
    input.absences
      .filter((a) => !a.hours || a.hours.length === 0)
      .map((a) => `${a.date}|${a.teacherId}`),
  );
  for (const assignment of input.assignments) {
    if (holidaySet.has(assignment.date)) continue;
    if (!fullDayAbsent.has(`${assignment.date}|${assignment.teacherId}`)) continue;
    const name = teacherName.get(assignment.teacherId) || 'Öğretmen';
    const place = input.locations.find((l) => l.id === assignment.locationId)?.name || 'nöbet yeri';
    issues.push({
      level: 'red',
      text: `${dayLabel(assignment.date)} ${name} devamsız görünüyor, ${place} nöbetinde duruyor.`,
    });
  }

  // Hiç ataması olmayan okul günleri de eksik sayılabilsin diye aralıktaki tüm okul günleri taranır.
  const scanDates: string[] = [];
  if (dutyDates.length > 0) {
    const last = dutyDates[dutyDates.length - 1];
    for (let cursor = parseISO(dutyDates[0]); ; cursor = addDays(cursor, 1)) {
      const key = format(cursor, 'yyyy-MM-dd');
      if (key > last) break;
      if (schoolDays.includes(getDay(cursor)) && !holidaySet.has(key)) scanDates.push(key);
    }
  }

  const activeDayCount = schoolDays.length;
  for (const location of input.locations) {
    const weekly = getWeeklyDutyCount(location);
    if (weekly <= 0) continue;
    const short: string[] = [];
    const extra: string[] = [];
    let week = '';
    let assignedThisWeek = 0;
    for (const date of scanDates) {
      const key = weekKey(parseISO(date));
      if (key !== week) {
        week = key;
        assignedThisWeek = 0;
      }
      const actual = input.assignments.filter((a) => a.date === date && a.locationId === location.id).length;
      const expected = slotsForDay(
        weekly,
        assignedThisWeek,
        remainingActiveDaysInWeek(parseISO(date), schoolDays, holidaySet),
        activeDayCount,
      );
      if (actual < expected) short.push(dayLabel(date));
      else if (actual > expected) extra.push(dayLabel(date));
      assignedThisWeek += actual;
    }
    const summarize = (dates: string[], kind: 'eksik' | 'fazla', level: 'red' | 'orange') => {
      if (dates.length === 0) return;
      const text = dates.length <= 2
        ? `${location.name}: ${dates.join(', ')} ${kind} nöbetçi.`
        : `${location.name}: ${dates.length} günde ${kind} nöbetçi.`;
      issues.push({ level, text });
    };
    summarize(short, 'eksik', 'red');
    summarize(extra, 'fazla', 'orange');
  }

  for (const teacher of input.teachers) {
    const dates = [...new Set(
      input.assignments
        .filter((a) => a.teacherId === teacher.id && !holidaySet.has(a.date))
        .map((a) => a.date),
    )].sort();
    let run = dates.length > 0 ? [dates[0]] : [];
    const flush = () => {
      if (run.length >= 2) {
        issues.push({
          level: 'orange',
          text: `${teacher.name} art arda nöbetçi: ${dayLabel(run[0])} – ${dayLabel(run[run.length - 1])}.`,
        });
      }
    };
    for (let i = 1; i < dates.length; i++) {
      if (nextSchoolDay(dates[i - 1], schoolDays, holidaySet) === dates[i]) run.push(dates[i]);
      else {
        flush();
        run = [dates[i]];
      }
    }
    flush();

    const own = input.assignments.filter((a) => a.teacherId === teacher.id && !holidaySet.has(a.date));
    if (teacher.dutyType === 'sabit' || own.length < 4) continue;
    const byPlace = new Map<string, number>();
    for (const assignment of own) {
      byPlace.set(assignment.locationId, (byPlace.get(assignment.locationId) || 0) + 1);
    }
    const top = [...byPlace.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / own.length >= 0.8) {
      const place = input.locations.find((l) => l.id === top[0])?.name || 'aynı yer';
      issues.push({
        level: 'orange',
        text: `${teacher.name} nöbetlerinin çoğu ${place} bölgesinde.`,
      });
    }
  }

  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));
}
