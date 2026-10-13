import { parseISO } from 'date-fns';
import type { Assignment, ScheduleArchive } from '../types';
import { FairDistributionState, getMonthKey } from './dutyDistribution';
import { weekKey } from './weeklyQuota';

/**
 * Yeni çizelgenin başlangıcından önce tutulmuş nöbetler (mevcut çizelge + arşivler).
 * Aynı tarih birden çok kaynakta varsa en son kaydedilen geçerlidir; mevcut çizelge her zaman en yenisidir.
 */
export function collectDutyHistory(
  current: Assignment[],
  archives: ScheduleArchive[],
  beforeDate: string,
): Assignment[] {
  const sources = [
    current,
    ...[...archives]
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))
      .map(a => a.assignments || []),
  ];
  const coveredDates = new Set<string>();
  const history: Assignment[] = [];
  for (const source of sources) {
    const datesInSource = new Set<string>();
    for (const a of source) {
      if (a.date >= beforeDate || coveredDates.has(a.date)) continue;
      history.push(a);
      datesInSource.add(a.date);
    }
    for (const d of datesInSource) coveredDates.add(d);
  }
  return history.sort((a, b) => a.date.localeCompare(b.date));
}

export function lastHistoryDate(history: Assignment[]): string | null {
  return history.length > 0 ? history[history.length - 1].date : null;
}

/**
 * Adil dağıtım durumunu önceki nöbetlerle başlatır; böylece yeni çizelge kaldığı yerden devam eder.
 * Sayılar en az nöbet tutan öğretmene göre göreli tutulur; geçmişi olmayan (yeni eklenen) öğretmen
 * en alttan başlar ama birikmiş farkı bir anda kapatmak için arka arkaya nöbete yazılmaz.
 */
export function seedFairStateFromHistory(
  state: FairDistributionState,
  history: Assignment[],
  teacherIds: string[],
): void {
  const ids = new Set(teacherIds);
  const totals = new Map<string, number>();
  const months = new Map<string, Map<string, number>>();
  const monthKeys = new Set<string>();

  for (const a of history) {
    if (!ids.has(a.teacherId)) continue;
    const mk = getMonthKey(a.date);
    monthKeys.add(mk);
    totals.set(a.teacherId, (totals.get(a.teacherId) ?? 0) + 1);
    if (!months.has(a.teacherId)) months.set(a.teacherId, new Map());
    const m = months.get(a.teacherId)!;
    m.set(mk, (m.get(mk) ?? 0) + 1);

    if (!state.locationCounts[a.teacherId]) state.locationCounts[a.teacherId] = {};
    state.locationCounts[a.teacherId][a.locationId] = (state.locationCounts[a.teacherId][a.locationId] ?? 0) + 1;
    // Geçmiş tarih sırasına göre geldiği için son yazılan en son nöbettir.
    state.teacherLastLocation[a.teacherId] = a.locationId;
    state.lastDutyDate[a.teacherId] = a.date;
  }

  const withHistory = teacherIds.filter(id => totals.has(id));
  if (withHistory.length === 0) return;

  const minTotal = Math.min(...withHistory.map(id => totals.get(id)!));
  for (const id of teacherIds) {
    state.dutyCounts[id] = (totals.get(id) ?? minTotal) - minTotal;
  }

  for (const mk of monthKeys) {
    const minMonth = Math.min(...withHistory.map(id => months.get(id)?.get(mk) ?? 0));
    for (const id of teacherIds) {
      const count = totals.has(id) ? months.get(id)?.get(mk) ?? 0 : minMonth;
      if (!state.monthCounts[id]) state.monthCounts[id] = {};
      state.monthCounts[id][mk] = count - minMonth;
    }
  }
}

/** Başlangıç haftasında, yeni çizelgeden önceki günlerde her yerde tutulmuş nöbet sayısı. */
export function historyCountsForWeek(history: Assignment[], wk: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of history) {
    if (weekKey(parseISO(a.date)) !== wk) continue;
    counts[a.locationId] = (counts[a.locationId] ?? 0) + 1;
  }
  return counts;
}
