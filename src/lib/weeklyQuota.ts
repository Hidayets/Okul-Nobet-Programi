import { addDays, format, getDay, startOfWeek } from 'date-fns';
import type { Location } from '../types';

/** Nöbet yerinin haftalık nöbetçi sayısı. Bilinçli olarak girilen 0 korunur. */
export function getWeeklyDutyCount(location: Pick<Location, 'weeklyDutyCount'>): number {
  const n = location.weeklyDutyCount;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 1;
}

/** Bir günde aynı yere konabilecek en fazla nöbetçi: haftalık sayı nöbet günlerine eşit yayılır. */
export function maxDailyDuties(weeklyCount: number, activeDayCount: number): number {
  if (weeklyCount <= 0 || activeDayCount <= 0) return 0;
  return Math.ceil(weeklyCount / activeDayCount);
}

/** Pazartesi başlangıçlı takvim haftasının anahtarı. */
export function weekKey(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

/** Verilen günden (dahil) hafta sonuna (Pazar) kadar kalan, tatil olmayan nöbet günü sayısı. */
export function remainingActiveDaysInWeek(date: Date, activeDays: number[], holidays?: Set<string>): number {
  let count = 0;
  let d = date;
  for (;;) {
    if (activeDays.includes(getDay(d)) && !holidays?.has(format(d, 'yyyy-MM-dd'))) count++;
    if (getDay(d) === 0) break;
    d = addDays(d, 1);
  }
  return count;
}

/**
 * Bugün bu yere kaç nöbetçi konacağı.
 * Haftanın kalanına eşit yayılır; tatil olan günlerin payı aynı haftanın sonraki günlerine kayar.
 */
export function slotsForDay(
  weeklyCount: number,
  assignedThisWeek: number,
  remainingDays: number,
  activeDayCount: number,
): number {
  const remaining = weeklyCount - assignedThisWeek;
  if (remaining <= 0 || remainingDays <= 0) return 0;
  return Math.min(maxDailyDuties(weeklyCount, activeDayCount), Math.ceil(remaining / remainingDays));
}

/** Arayüzde "Haftada N nöbetçi" bilgisinin günlük karşılığı. */
export function describeDailyDuty(weeklyCount: number, activeDayCount: number): string {
  if (weeklyCount <= 0) return 'nöbet yok';
  if (activeDayCount <= 0) return 'nöbet günü seçilmemiş';
  if (weeklyCount % activeDayCount === 0) return `her gün ${weeklyCount / activeDayCount} kişi`;
  if (weeklyCount < activeDayCount) return `haftada ${weeklyCount} gün, 1 kişi`;
  return `günde ${Math.floor(weeklyCount / activeDayCount)}-${Math.ceil(weeklyCount / activeDayCount)} kişi`;
}
