import { Holiday } from '../types';
import { v4 as uuidv4 } from 'uuid';
import {
  hashMebHolidays,
  parseMebCalendarHtml,
  resolveMebCalendarUrls,
  type ParsedMebHoliday,
} from './mebCalendarParse';

/**
 * Yerel yedek takvim sürümü — canlı MEB sayfası her açılışta ayrıca kontrol edilir.
 * Bilinen yedek veri değişince artırın.
 */
export const MEB_CALENDAR_VERSION = '2026-10-13';

interface RawHoliday {
  date: string;
  name: string;
}

function weekdayRange(startStr: string, endStr: string, name: string): RawHoliday[] {
  const result: RawHoliday[] = [];
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);

  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      result.push({ date: `${yyyy}-${mm}-${dd}`, name });
    }
  }
  return result;
}

function isWeekday(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow !== 0 && dow !== 6;
}

/**
 * MEB eğitim-öğretim yılı takvim verileri (çevrimdışı yedek).
 * Kaynak: meb.gov.tr resmi duyuruları
 *
 * MEB'e göre 29 Ekim, 23 Nisan ve 19 Mayıs okuldaki törenlere
 * katılım nedeniyle İŞ GÜNÜ sayılır, bu yüzden dahil edilmez.
 */
function getMebCalendarFallback(academicYear: string): RawHoliday[] {
  switch (academicYear) {
    case '2024-2025':
      return [
        ...weekdayRange('2024-11-18', '2024-11-22', '1. Ara Tatil'),
        { date: '2025-01-01', name: 'Yılbaşı' },
        ...weekdayRange('2025-01-20', '2025-01-31', 'Yarıyıl Tatili'),
        { date: '2025-03-31', name: 'Ramazan Bayramı' },
        { date: '2025-04-01', name: 'Ramazan Bayramı' },
        ...weekdayRange('2025-04-14', '2025-04-18', '2. Ara Tatil'),
        { date: '2025-05-01', name: 'Emek ve Dayanışma Günü' },
        { date: '2025-06-05', name: 'Kurban Bayramı Arife' },
        { date: '2025-06-06', name: 'Kurban Bayramı' },
        { date: '2025-06-09', name: 'Kurban Bayramı' },
      ];

    case '2025-2026':
      return [
        ...weekdayRange('2025-11-10', '2025-11-14', '1. Ara Tatil'),
        { date: '2025-11-24', name: 'Öğretmenler Günü' },
        { date: '2026-01-01', name: 'Yılbaşı' },
        ...weekdayRange('2026-01-19', '2026-01-30', 'Yarıyıl Tatili'),
        ...weekdayRange('2026-03-16', '2026-03-20', '2. Ara Tatil / Ramazan Bayramı'),
        { date: '2026-05-01', name: 'Emek ve Dayanışma Günü' },
        { date: '2026-05-26', name: 'Kurban Bayramı Arife' },
        { date: '2026-05-27', name: 'Kurban Bayramı' },
        { date: '2026-05-28', name: 'Kurban Bayramı' },
        { date: '2026-05-29', name: 'Kurban Bayramı' },
      ];

    case '2026-2027':
      // Kaynak: https://www.meb.gov.tr/2026-2027-egitim-ogretim-yili-takvimi-aciklandi/haber/41057/tr
      return [
        ...weekdayRange('2026-11-16', '2026-11-20', '1. Ara Tatil'),
        { date: '2026-11-24', name: 'Öğretmenler Günü' },
        { date: '2027-01-01', name: 'Yılbaşı' },
        ...weekdayRange('2027-01-25', '2027-02-05', 'Yarıyıl Tatili'),
        ...weekdayRange('2027-03-08', '2027-03-12', '2. Ara Tatil / Ramazan Bayramı'),
        { date: '2027-05-01', name: 'Emek ve Dayanışma Günü' },
        { date: '2027-05-17', name: 'Kurban Bayramı' },
        { date: '2027-05-18', name: 'Kurban Bayramı' },
        { date: '2027-05-19', name: 'Kurban Bayramı' },
      ];

    default:
      return [];
  }
}

// 29 Ekim, 23 Nisan, 19 Mayıs, 15 Temmuz, 30 Ağustos
// MEB takviminde iş günü sayıldığı veya okul dışı dönemde kaldığı için çıkarılır
const EXCLUDED_MMDD = new Set([
  '10-28', '10-29', '04-23', '05-19', '07-15', '08-30',
]);

async function fetchNagerHolidays(year: number): Promise<RawHoliday[]> {
  const res = await fetch(`https://date.nager.at/api/v3/publicholidays/${year}/TR`);
  if (!res.ok) return [];
  const data: { date: string; localName: string }[] = await res.json();
  return data.map(h => ({ date: h.date, name: h.localName }));
}

function mergeHolidayLists(primary: RawHoliday[], secondary: RawHoliday[]): RawHoliday[] {
  const map = new Map<string, string>();
  for (const h of primary) map.set(h.date, h.name);
  for (const h of secondary) {
    if (!map.has(h.date)) map.set(h.date, h.name);
  }
  return [...map.entries()]
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function filterSchoolYearHolidays(
  holidays: RawHoliday[],
  schoolStart: string,
  schoolEnd: string,
): RawHoliday[] {
  return holidays.filter(h => {
    if (h.date < schoolStart || h.date > schoolEnd) return false;
    if (EXCLUDED_MMDD.has(h.date.slice(5)) && !/ramazan|kurban/i.test(h.name)) return false;
    // Arife yarım gündür; sabah ders ve nöbet olduğu için tatil sayılmaz.
    if (/arife/i.test(h.name)) return false;
    if (!isWeekday(h.date)) return false;
    return true;
  });
}

export interface FetchMebHolidaysResult {
  holidays: Holiday[];
  source: 'meb' | 'api' | 'empty';
  contentHash?: string;
  title?: string;
  sourceUrl?: string;
}

async function fetchLiveMebBreaks(academicYear: string): Promise<{
  holidays: ParsedMebHoliday[];
  contentHash: string;
  title: string;
  sourceUrl: string;
} | null> {
  try {
    const res = await fetch(`/api/meb-calendar/${encodeURIComponent(academicYear)}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && Array.isArray(data.holidays) && data.holidays.length > 0) {
        return {
          holidays: data.holidays,
          contentHash: data.contentHash || hashMebHolidays(data.holidays),
          title: data.title || `${academicYear} Eğitim-Öğretim Yılı`,
          sourceUrl: data.sourceUrl || resolveMebCalendarUrls(academicYear)[0],
        };
      }
    }
  } catch {
    // Sunucu yoksa doğrudan dene
  }

  for (const url of resolveMebCalendarUrls(academicYear)) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const html = await res.text();
      const parsed = parseMebCalendarHtml(html, academicYear, url);
      if (parsed && parsed.holidays.length > 0) {
        return {
          holidays: parsed.holidays,
          contentHash: parsed.contentHash,
          title: parsed.title,
          sourceUrl: parsed.sourceUrl,
        };
      }
    } catch {
      // sonraki URL
    }
  }
  return null;
}

/**
 * Belirtilen eğitim-öğretim yılı için tatil günlerini döndürür.
 *
 * 1) MEB resmi haber sayfasından canlı ara tatil / yarıyıl çekilir
 * 2) Resmi tatiller (bayram vb.) Nager API ile birleştirilir
 * 3) Canlı veri yoksa yerel MEB yedeği kullanılır
 */
export async function fetchMebHolidays(academicYear: string): Promise<FetchMebHolidaysResult> {
  const parts = academicYear.split('-').map(Number);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { holidays: [], source: 'empty' };
  }
  const [startYear, endYear] = parts;
  const schoolStart = `${startYear}-09-01`;
  const schoolEnd = `${endYear}-06-30`;

  const live = await fetchLiveMebBreaks(academicYear);

  let apiPublic: RawHoliday[] = [];
  try {
    const [h1, h2] = await Promise.all([
      fetchNagerHolidays(startYear),
      fetchNagerHolidays(endYear),
    ]);
    apiPublic = filterSchoolYearHolidays([...h1, ...h2], schoolStart, schoolEnd);
  } catch {
    apiPublic = [];
  }

  if (live) {
    const merged = mergeHolidayLists(
      live.holidays,
      [
        ...apiPublic,
        ...(isWeekday(`${startYear}-11-24`)
          ? [{ date: `${startYear}-11-24`, name: 'Öğretmenler Günü' }]
          : []),
      ],
    );
    const filtered = filterSchoolYearHolidays(merged, schoolStart, schoolEnd);
    return {
      holidays: filtered.map(h => ({ id: uuidv4(), date: h.date, name: h.name, source: 'meb' as const })),
      source: 'meb',
      contentHash: hashMebHolidays(filtered),
      title: live.title,
      sourceUrl: live.sourceUrl,
    };
  }

  const mebData = getMebCalendarFallback(academicYear);
  if (mebData.length > 0) {
    const merged = mergeHolidayLists(mebData, apiPublic);
    const filtered = filterSchoolYearHolidays(merged, schoolStart, schoolEnd);
    return {
      holidays: filtered.map(h => ({ id: uuidv4(), date: h.date, name: h.name, source: 'meb' as const })),
      source: 'meb',
      contentHash: hashMebHolidays(filtered),
      title: `${academicYear} Eğitim-Öğretim Yılı`,
    };
  }

  if (apiPublic.length > 0) {
    return {
      holidays: apiPublic.map(h => ({ id: uuidv4(), date: h.date, name: h.name, source: 'meb' as const })),
      source: 'api',
      contentHash: hashMebHolidays(apiPublic),
      title: `${academicYear} Eğitim-Öğretim Yılı`,
    };
  }

  return { holidays: [], source: 'empty', title: `${academicYear} Eğitim-Öğretim Yılı` };
}

export interface MebHolidaySyncResult {
  holidays: Holiday[];
  added: number;
  updated: number;
  removed: number;
  /** Artık hiçbir tatil kaydı kalmayan (yeniden iş günü olan) tarihler */
  removedDates: string[];
  changed: boolean;
}

/** MEB takvimini mevcut tatillerle birleştirir; elle eklenen günleri korur. */
export function syncHolidaysWithMeb(existing: Holiday[], fetched: Holiday[]): MebHolidaySyncResult {
  const fetchedByDate = new Map(fetched.map(h => [h.date, h.name]));
  const mergedMeb: Holiday[] = [];
  const manual: Holiday[] = [];
  let added = 0;
  let updated = 0;
  let removed = 0;
  const removedCandidates = new Set<string>();

  for (const h of existing) {
    if (h.source === 'manual') {
      manual.push(h);
      continue;
    }

    const newName = fetchedByDate.get(h.date);
    if (newName !== undefined) {
      if (newName !== h.name) updated++;
      mergedMeb.push({ ...h, name: newName, source: 'meb' });
      fetchedByDate.delete(h.date);
      continue;
    }

    if (h.source === 'meb') {
      removed++;
      removedCandidates.add(h.date);
      continue;
    }

    manual.push({ ...h, source: 'manual' });
  }

  for (const [date, name] of fetchedByDate) {
    added++;
    mergedMeb.push({ id: uuidv4(), date, name, source: 'meb' });
  }

  const holidays = [...manual, ...mergedMeb].sort((a, b) => a.date.localeCompare(b.date));
  const stillHoliday = new Set(holidays.map(h => h.date));
  const removedDates = [...removedCandidates].filter(d => !stillHoliday.has(d)).sort();
  return { holidays, added, updated, removed, removedDates, changed: added + updated + removed > 0 };
}
