import { format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';

/** Nöbet çizelgesi yazdırma başlığı — tek ay veya çok aylı programlar için. */
export function formatSchedulePrintTitle(sortedDates: string[]): string {
  if (sortedDates.length === 0) return 'NÖBET PROGRAMI';

  const first = parseISO(sortedDates[0]);
  const last = parseISO(sortedDates[sortedDates.length - 1]);
  const firstMonth = format(first, 'MMMM', { locale: tr }).toLocaleUpperCase('tr-TR');
  const lastMonth = format(last, 'MMMM', { locale: tr }).toLocaleUpperCase('tr-TR');
  const firstYear = first.getFullYear();
  const lastYear = last.getFullYear();
  const firstMonthKey = format(first, 'yyyy-MM');
  const lastMonthKey = format(last, 'yyyy-MM');

  if (firstMonthKey === lastMonthKey) {
    return `${firstMonth} AYI NÖBET PROGRAMI`;
  }
  if (firstYear === lastYear) {
    return `${firstMonth} - ${lastMonth} ${firstYear} NÖBET PROGRAMI`;
  }
  return `${firstMonth} ${firstYear} - ${lastMonth} ${lastYear} NÖBET PROGRAMI`;
}
