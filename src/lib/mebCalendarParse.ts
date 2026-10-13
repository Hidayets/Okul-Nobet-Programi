/** MEB haber sayfalarından eğitim-öğretim yılı tatil tarihlerini çıkarır. */

export interface ParsedMebHoliday {
  date: string;
  name: string;
}

export interface ParsedMebCalendar {
  academicYear: string;
  title: string;
  holidays: ParsedMebHoliday[];
  contentHash: string;
  sourceUrl: string;
}

const MONTHS: Record<string, number> = {
  ocak: 1,
  subat: 2,
  şubat: 2,
  mart: 3,
  nisan: 4,
  mayis: 5,
  mayıs: 5,
  haziran: 6,
  temmuz: 7,
  agustos: 8,
  ağustos: 8,
  eylul: 9,
  eylül: 9,
  ekim: 10,
  kasim: 11,
  kasım: 11,
  aralik: 12,
  aralık: 12,
};

/** Bilinen MEB takvim duyuru sayfaları */
export const MEB_CALENDAR_URLS: Record<string, string> = {
  '2025-2026': 'https://www.meb.gov.tr/2025-2026-egitim-ogretim-yili-takvimi-aciklandi/haber/37198/tr',
  '2026-2027': 'https://www.meb.gov.tr/2026-2027-egitim-ogretim-yili-takvimi-aciklandi/haber/41057/tr',
};

export function mebCalendarSlugUrl(academicYear: string): string {
  return `https://www.meb.gov.tr/${academicYear}-egitim-ogretim-yili-takvimi-aciklandi/`;
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTr(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .normalize('NFC');
}

function monthNum(name: string): number | null {
  const key = normalizeTr(name).replace(/ı/g, 'i');
  // Try both with and without Turkish chars
  const candidates = [
    normalizeTr(name),
    key,
    name.toLocaleLowerCase('tr-TR'),
  ];
  for (const c of candidates) {
    if (MONTHS[c] != null) return MONTHS[c];
  }
  // Fuzzy: strip diacritics-ish
  const ascii = normalizeTr(name)
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
  for (const [k, v] of Object.entries(MONTHS)) {
    const ka = k
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c');
    if (ka === ascii) return v;
  }
  return null;
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function weekdayRange(startStr: string, endStr: string, name: string): ParsedMebHoliday[] {
  const result: ParsedMebHoliday[] = [];
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

function extractAcademicYear(text: string, fallback?: string): string | null {
  const m = text.match(/(\d{4})\s*[-–—]\s*(\d{4})\s*eğitim/i);
  if (m) return `${m[1]}-${m[2]}`;
  return fallback ?? null;
}

function extractTitle(text: string, academicYear: string): string {
  const m = text.match(new RegExp(`${academicYear}\\s+eğitim\\s+öğretim\\s+yılı\\s+takvimi`, 'i'));
  if (m) return `${academicYear} Eğitim-Öğretim Yılı`;
  return `${academicYear} Eğitim-Öğretim Yılı`;
}

type DateHit = { day: number; month: number; year: number };

function parseDateToken(day: string, monthName: string, year: string | undefined, defaultYear: number): DateHit | null {
  const m = monthNum(monthName);
  if (m == null) return null;
  const y = year ? Number(year) : defaultYear;
  const d = Number(day);
  if (!y || !d) return null;
  return { day: d, month: m, year: y };
}

const MONTH_ALT =
  'ocak|subat|şubat|mart|nisan|mayis|mayıs|haziran|temmuz|agustos|ağustos|eylul|eylül|ekim|kasim|kasım|aralik|aralık';

/**
 * Aralık çıkarır: "16 Kasım 2026 ... 20 Kasım 2026" veya "10-14 Kasım"
 * Etikete yakın kompakt biçim önce denenir (uzak yarıyıl tarihine kaymamak için).
 */
function extractRangeAfter(
  text: string,
  labelRe: RegExp,
  startYear: number,
  endYear: number,
): { start: string; end: string } | null {
  const idx = text.search(labelRe);
  if (idx < 0) return null;
  const near = text.slice(idx, idx + 120);
  const window = text.slice(idx, idx + 220);

  // Compact: 10-14 Kasım (etikete en yakın)
  const compact = near.match(
    new RegExp(`(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})\\s+(${MONTH_ALT})(?:\\s+(\\d{4}))?`, 'i'),
  );
  if (compact) {
    const month = monthNum(compact[3]);
    if (month == null) return null;
    const year = compact[4] ? Number(compact[4]) : (month >= 9 ? startYear : endYear);
    return {
      start: toIso(year, month, Number(compact[1])),
      end: toIso(year, month, Number(compact[2])),
    };
  }

  // Full: 16 Kasım 2026 ... 20 Kasım 2026
  const full = window.match(
    new RegExp(
      `(\\d{1,2})\\s+(${MONTH_ALT})\\s+(\\d{4})[\\s\\S]{0,80}?(\\d{1,2})\\s+(${MONTH_ALT})\\s+(\\d{4})`,
      'i',
    ),
  );
  if (full) {
    const a = parseDateToken(full[1], full[2], full[3], startYear);
    const b = parseDateToken(full[4], full[5], full[6], endYear);
    if (a && b) return { start: toIso(a.year, a.month, a.day), end: toIso(b.year, b.month, b.day) };
  }

  // Single start + "başlayıp/yapılacak" end
  const startEnd = window.match(
    new RegExp(
      `(\\d{1,2})\\s+(${MONTH_ALT})(?:\\s+(\\d{4}))?[\\s\\S]{0,60}?(?:baslay|başlay|yapil|yapıl)[\\s\\S]{0,40}?(\\d{1,2})\\s+(${MONTH_ALT})(?:\\s+(\\d{4}))?`,
      'i',
    ),
  );
  if (startEnd) {
    const m1 = monthNum(startEnd[2]);
    const m2 = monthNum(startEnd[5]);
    if (m1 == null || m2 == null) return null;
    const y1 = startEnd[3] ? Number(startEnd[3]) : (m1 >= 9 ? startYear : endYear);
    const y2 = startEnd[6] ? Number(startEnd[6]) : y1;
    return {
      start: toIso(y1, m1, Number(startEnd[1])),
      end: toIso(y2, m2, Number(startEnd[4])),
    };
  }

  return null;
}

export function hashMebHolidays(holidays: ParsedMebHoliday[]): string {
  const payload = holidays
    .map(h => `${h.date}|${h.name}`)
    .sort()
    .join(';');
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) - hash + payload.charCodeAt(i)) | 0;
  }
  return `h${(hash >>> 0).toString(16)}`;
}

/** MEB haber metninden ara tatil / yarıyıl günlerini çıkarır. */
export function parseMebCalendarHtml(
  html: string,
  academicYearHint: string,
  sourceUrl: string,
): ParsedMebCalendar | null {
  const text = stripHtmlToText(html);
  return parseMebCalendarText(text, academicYearHint, sourceUrl);
}

export function parseMebCalendarText(
  text: string,
  academicYearHint: string,
  sourceUrl: string,
): ParsedMebCalendar | null {
  // Türkçe İ/ı için locale lower-case (JS /i bayrağı yetersiz)
  const normalized = text.toLocaleLowerCase('tr-TR');
  const academicYear = extractAcademicYear(normalized, academicYearHint);
  if (!academicYear) return null;

  const parts = academicYear.split('-').map(Number);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [startYear, endYear] = parts;

  const holidays: ParsedMebHoliday[] = [];

  const ara1 = extractRangeAfter(
    normalized,
    /birinci\s+d[oö]nem\s+ara\s+tatili|1\.?\s*d[oö]nem\s+ara\s+tatili/,
    startYear,
    endYear,
  );
  if (ara1) holidays.push(...weekdayRange(ara1.start, ara1.end, '1. Ara Tatil'));

  const yariyil = extractRangeAfter(
    normalized,
    /yar[iı]y[iı]l\s+tatili/,
    startYear,
    endYear,
  );
  if (yariyil) holidays.push(...weekdayRange(yariyil.start, yariyil.end, 'Yarıyıl Tatili'));

  const ara2 = extractRangeAfter(
    normalized,
    /ikinci\s+d[oö]nem(?:in)?\s+ara\s+tatili|2\.?\s*d[oö]nem(?:in)?\s+ara\s+tatili/,
    startYear,
    endYear,
  );
  if (ara2) holidays.push(...weekdayRange(ara2.start, ara2.end, '2. Ara Tatil'));

  if (holidays.length === 0) return null;

  // Deduplicate by date (keep first name)
  const byDate = new Map<string, string>();
  for (const h of holidays) {
    if (!byDate.has(h.date)) byDate.set(h.date, h.name);
  }
  const unique = [...byDate.entries()]
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    academicYear,
    title: extractTitle(text, academicYear),
    holidays: unique,
    contentHash: hashMebHolidays(unique),
    sourceUrl,
  };
}

export function resolveMebCalendarUrls(academicYear: string): string[] {
  const urls: string[] = [];
  const known = MEB_CALENDAR_URLS[academicYear];
  if (known) urls.push(known);
  const slug = mebCalendarSlugUrl(academicYear);
  if (!urls.includes(slug)) urls.push(slug);
  return urls;
}
