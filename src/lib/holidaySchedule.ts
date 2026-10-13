import { addDays, format, getDay, parseISO } from 'date-fns';
import { Assignment, Holiday } from '../types';

export type ScheduleDayRow =
  | { date: string; type: 'holiday'; holidayName: string }
  | { date: string; type: 'duty' };

export function buildHolidayMap(holidays: Holiday[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of holidays) {
    const existing = map.get(h.date);
    map.set(h.date, existing ? `${existing} / ${h.name}` : h.name);
  }
  return map;
}

/** Çizelge kenarı tatil bloğu en fazla bu kadar gün geriye/ileriye uzanabilir (yarıyıl tatili ~16 gün). */
const MAX_EDGE_HOLIDAY_SPAN_DAYS = 31;

/**
 * Çizelgenin başına veya sonuna bitişik tatil bloğunu da aralığa katar.
 * Örn. son nöbet Cuma ise ve ertesi hafta ara tatilse, o hafta da çizelgede görünür.
 * Hafta sonu gibi nöbet olmayan günler atlanır; tatil olmayan ilk nöbet gününde durulur.
 */
function extendOverAdjacentHolidays(
  edge: string,
  direction: 1 | -1,
  holidayMap: Map<string, string>,
  schoolDays: number[],
): string {
  let result = edge;
  let d = addDays(parseISO(edge), direction);
  for (let step = 0; step < MAX_EDGE_HOLIDAY_SPAN_DAYS; step++) {
    const ds = format(d, 'yyyy-MM-dd');
    if (holidayMap.has(ds)) result = ds;
    else if (schoolDays.includes(getDay(d))) break;
    d = addDays(d, direction);
  }
  return result;
}

/** Nöbet günleri + aralıktaki (ve aralığa bitişik) tatil günlerini kronolojik satır listesi olarak döndürür. */
export function buildScheduleRows(
  assignments: Assignment[],
  holidays: Holiday[],
  schoolDays: number[] = [1, 2, 3, 4, 5],
): ScheduleDayRow[] {
  if (assignments.length === 0 && holidays.length === 0) return [];

  const holidayMap = buildHolidayMap(holidays);
  const assignmentDates = [...new Set(assignments.map(a => a.date))].sort();

  let rangeStart: string;
  let rangeEnd: string;

  if (assignmentDates.length > 0) {
    rangeStart = extendOverAdjacentHolidays(assignmentDates[0], -1, holidayMap, schoolDays);
    rangeEnd = extendOverAdjacentHolidays(assignmentDates[assignmentDates.length - 1], 1, holidayMap, schoolDays);
  } else {
    const sortedHolidayDates = [...holidayMap.keys()].sort();
    rangeStart = sortedHolidayDates[0];
    rangeEnd = sortedHolidayDates[sortedHolidayDates.length - 1];
  }

  const holidayOnlyDates = holidays
    .filter(h => h.date >= rangeStart && h.date <= rangeEnd)
    .map(h => h.date);

  const allDates = [...new Set([...assignmentDates, ...holidayOnlyDates])].sort();

  return allDates.map(date => {
    const holidayName = holidayMap.get(date);
    if (holidayName) {
      return { date, type: 'holiday' as const, holidayName };
    }
    return { date, type: 'duty' as const };
  });
}

export function stripAssignmentsOnHolidays(assignments: Assignment[], holidays: Holiday[]): Assignment[] {
  const holidayDates = new Set(holidays.map(h => h.date));
  if (holidayDates.size === 0) return assignments;
  return assignments.filter(a => !holidayDates.has(a.date));
}
