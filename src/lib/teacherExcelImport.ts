import * as XLSX from 'xlsx';
import type { DutyType } from '../types';

export interface ParsedTeacherRow {
  name: string;
  email?: string;
  dutyType?: DutyType;
  schedule?: Record<number, Record<number, string>>;
}

function turkishLower(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u200E\u200F]/g, '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
}

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u200E\u200F]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function unmergeWorksheet(ws: XLSX.WorkSheet): void {
  const merges = ws['!merges'];
  if (!merges || merges.length === 0) return;

  for (const merge of merges) {
    const { s, e } = merge;
    const topRef = XLSX.utils.encode_cell(s);
    const cell = ws[topRef];
    if (!cell) continue;

    for (let r = s.r; r <= e.r; r++) {
      for (let c = s.c; c <= e.c; c++) {
        if (r === s.r && c === s.c) continue;
        ws[XLSX.utils.encode_cell({ r, c })] = { t: cell.t, v: cell.v };
      }
    }
  }
  delete ws['!merges'];
}

/** Gün başlıkları Türkçe karaktersiz de yazılabildiği için (PAZARTESI, Carsamba) ASCII karşılaştırılır. */
function asciiFold(s: string): string {
  return turkishLower(s)
    .replace(/ç/g, 'c')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u');
}

const ALL_DAYS_LOWER: Record<string, number> = {
  pazartesi: 1, pzt: 1, pts: 1,
  sali: 2, sal: 2,
  carsamba: 3, car: 3, cars: 3, crs: 3,
  persembe: 4, per: 4, pers: 4, prs: 4,
  cuma: 5, cum: 5,
};

const SORTED_DAY_ENTRIES = Object.entries(ALL_DAYS_LOWER)
  .sort(([a], [b]) => b.length - a.length);

const NAME_HEADER_KEYWORDS = [
  'ad soyad', 'adı soyadı', 'ad-soyad', 'ad soyadı', 'isim', 'name',
  'öğretmen', 'ogretmen', 'öğretmen adı', 'ogretmen adi', 'öğretmen adı soyadı',
];
const FIRST_NAME_HEADER_KEYWORDS = ['ad', 'adı', 'isim', 'first name', 'firstname'];
const LAST_NAME_HEADER_KEYWORDS = ['soyad', 'soyadı', 'soyisim', 'lastname', 'last name'];
const EMAIL_HEADER_KEYWORDS = ['e-posta', 'e posta', 'eposta', 'email', 'mail', 'e-mail'];
const DUTY_HEADER_KEYWORDS = ['nöbet tipi', 'nöbet türü', 'nobet tipi', 'nobet turu', 'duty type', 'duty'];
const HEADER_SKIP_WORDS = new Set([
  'ad', 'adı', 'soyad', 'soyadı', 'ad soyad', 'adı soyadı', 'isim', 'name',
  'e-posta', 'eposta', 'email', 'mail', 'sıra', 'sira', 'no', '#',
  'nöbet tipi', 'nöbet türü', 'öğretmen', 'ogretmen',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseDayHourHeader(cell: string): { day: number; hour: number } | null {
  const s = asciiFold(cell);
  if (!s) return null;

  for (const [dayStr, dayNum] of SORTED_DAY_ENTRIES) {
    if (!s.startsWith(dayStr)) continue;
    const rest = s.slice(dayStr.length).replace(/[\s\-_./]+/g, '');
    const hourMatch = rest.match(/^(\d+)/);
    if (hourMatch) {
      return { day: dayNum, hour: parseInt(hourMatch[1], 10) };
    }
  }

  const digitIdx = s.search(/\d/);
  if (digitIdx >= 2) {
    const dayPart = s.substring(0, digitIdx).replace(/[\s\-_./]+$/g, '');
    const hourStr = s.substring(digitIdx).match(/^(\d+)/);
    if (hourStr) {
      const dayNum = ALL_DAYS_LOWER[dayPart] ?? null;
      const hour = parseInt(hourStr[1], 10);
      if (dayNum !== null && hour >= 1 && hour <= 15) {
        return { day: dayNum, hour };
      }
    }
  }

  return null;
}

function headerIncludes(lower: string, keywords: string[]): boolean {
  return keywords.some((kw) => lower.includes(kw));
}

function headerIsExactWord(lower: string, keywords: string[]): boolean {
  const normalized = lower.replace(/[.:_\-\s]+/g, ' ').trim();
  return keywords.some((kw) => normalized === kw || normalized === `${kw}ı` || normalized === `${kw}i`);
}

export function looksLikeEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

export function looksLikePersonName(s: string): boolean {
  const t = s.trim();
  if (!t || t.length < 2 || looksLikeEmail(t)) return false;
  if (!/\p{L}/u.test(t)) return false;
  if (/^\d+$/.test(t)) return false;
  if (isHeaderLikeCell(t)) return false;
  if (/^(sabit|hareketli|nöbet\s*dışı|nobet\s*disi|exempt)$/i.test(t)) return false;
  const letters = (t.match(/\p{L}/gu) || []).length;
  return letters / t.length > 0.5;
}

/** Ayraçları (boşluk, -, _, ., :, /) kaldırıp harfleri sadeleştirir: "Ad-Soyad" -> "adsoyad" */
function collapseSeparators(s: string): string {
  return turkishLower(s).replace(/[\s\-_.:/\\]+/g, '');
}

const HEADER_TOKENS = new Set(
  [...HEADER_SKIP_WORDS, ...NAME_HEADER_KEYWORDS, ...EMAIL_HEADER_KEYWORDS, ...DUTY_HEADER_KEYWORDS]
    .map(collapseSeparators)
    .filter(Boolean),
);

function isHeaderLikeCell(s: string): boolean {
  const collapsed = collapseSeparators(s);
  if (!collapsed) return false;
  if (HEADER_TOKENS.has(collapsed)) return true;

  // "ad"+"soyad" birleşik başlıkları: adsoyad, adisoyadi, isimsoyisim vb. (tam eşleşme)
  if (/^(ad[ıi]?|isim)(soyad[ıi]?|soyisim)$/.test(collapsed)) return true;

  return false;
}

function parseDutyType(raw: string): DutyType {
  const lower = turkishLower(raw);
  if (lower.includes('dışı') || lower.includes('disi') || lower.includes('exempt')) {
    return 'nobetDisi';
  }
  if (lower.includes('hareketli')) {
    return 'hareketli';
  }
  return 'sabit';
}

interface ColumnMap {
  dataStartRow: number;
  nameCol: number;
  firstNameCol: number;
  lastNameCol: number;
  emailCol: number;
  dutyTypeCol: number;
  scheduleCols: Record<number, { day: number; hour: number }>;
}

function scoreNameColumn(rows: string[][], col: number, startRow: number): number {
  let hits = 0;
  let total = 0;
  const end = Math.min(rows.length, startRow + 30);
  for (let r = startRow; r < end; r++) {
    const val = rows[r]?.[col] || '';
    if (!val) continue;
    total++;
    if (looksLikePersonName(val)) hits++;
  }
  return total === 0 ? 0 : hits / total;
}

function scoreEmailColumn(rows: string[][], col: number, startRow: number): number {
  let hits = 0;
  let total = 0;
  const end = Math.min(rows.length, startRow + 30);
  for (let r = startRow; r < end; r++) {
    const val = rows[r]?.[col] || '';
    if (!val) continue;
    total++;
    if (looksLikeEmail(val)) hits++;
  }
  return total === 0 ? 0 : hits / total;
}

function detectColumnsFromHeader(rows: string[][]): ColumnMap | null {
  const maxScan = Math.min(rows.length, 15);

  for (let r = 0; r < maxScan; r++) {
    const row = rows[r];
    let nameCol = -1;
    let firstNameCol = -1;
    let lastNameCol = -1;
    let emailCol = -1;
    let dutyTypeCol = -1;
    const scheduleCols: Record<number, { day: number; hour: number }> = {};
    let headerSignals = 0;

    for (let c = 0; c < row.length; c++) {
      const lower = turkishLower(row[c]);
      if (!lower) continue;

      if (headerIncludes(lower, NAME_HEADER_KEYWORDS)) {
        nameCol = c;
        headerSignals++;
      } else if (headerIsExactWord(lower, FIRST_NAME_HEADER_KEYWORDS)) {
        firstNameCol = c;
        headerSignals++;
      } else if (headerIsExactWord(lower, LAST_NAME_HEADER_KEYWORDS)) {
        lastNameCol = c;
        headerSignals++;
      }

      if (headerIncludes(lower, EMAIL_HEADER_KEYWORDS)) {
        emailCol = c;
        headerSignals++;
      }
      if (headerIncludes(lower, DUTY_HEADER_KEYWORDS)) {
        dutyTypeCol = c;
        headerSignals++;
      }

      const schedule = parseDayHourHeader(row[c]);
      if (schedule) {
        scheduleCols[c] = schedule;
      }
    }

    const scheduleCount = Object.keys(scheduleCols).length;
    if (headerSignals >= 1 || scheduleCount >= 3) {
      if (nameCol === -1 && firstNameCol === -1 && lastNameCol === -1) {
        const contentStart = r + 1;
        let bestCol = -1;
        let bestScore = 0;
        for (let c = 0; c < row.length; c++) {
          if (scheduleCols[c]) continue;
          const score = scoreNameColumn(rows, c, contentStart);
          if (score > bestScore) {
            bestScore = score;
            bestCol = c;
          }
        }
        if (bestCol >= 0 && bestScore >= 0.4) {
          nameCol = bestCol;
        }
      }

      if (emailCol === -1) {
        const contentStart = r + 1;
        let bestCol = -1;
        let bestScore = 0;
        for (let c = 0; c < row.length; c++) {
          if (c === nameCol || c === firstNameCol || c === lastNameCol || scheduleCols[c]) continue;
          const score = scoreEmailColumn(rows, c, contentStart);
          if (score > bestScore) {
            bestScore = score;
            bestCol = c;
          }
        }
        if (bestCol >= 0 && bestScore >= 0.5) {
          emailCol = bestCol;
        }
      }

      if (nameCol >= 0 || firstNameCol >= 0 || lastNameCol >= 0 || scheduleCount >= 3) {
        return {
          dataStartRow: r + 1,
          nameCol,
          firstNameCol,
          lastNameCol,
          emailCol,
          dutyTypeCol,
          scheduleCols,
        };
      }
    }
  }

  return null;
}

function detectColumnsFromContent(rows: string[][]): ColumnMap {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let dataStartRow = 0;

  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r];
    const headerHits = row.filter((cell) => isHeaderLikeCell(cell)).length;
    const nonEmpty = row.filter((cell) => cell).length;
    if (nonEmpty > 0 && headerHits / nonEmpty >= 0.5) {
      dataStartRow = r + 1;
      break;
    }
  }

  const scheduleCols: Record<number, { day: number; hour: number }> = {};
  const headerRow = rows[dataStartRow - 1] || rows[0] || [];
  for (let c = 0; c < headerRow.length; c++) {
    const schedule = parseDayHourHeader(headerRow[c]);
    if (schedule) scheduleCols[c] = schedule;
  }

  let nameCol = -1;
  let firstNameCol = -1;
  let lastNameCol = -1;
  let emailCol = -1;
  let dutyTypeCol = -1;

  const nameScores: number[] = [];
  const emailScores: number[] = [];
  for (let c = 0; c < maxCols; c++) {
    if (scheduleCols[c]) continue;
    nameScores[c] = scoreNameColumn(rows, c, dataStartRow);
    emailScores[c] = scoreEmailColumn(rows, c, dataStartRow);
  }

  const sortedNameCols = nameScores
    .map((score, col) => ({ col, score }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (sortedNameCols.length >= 2 && sortedNameCols[0].score >= 0.4 && sortedNameCols[1].score >= 0.4) {
    const [a, b] = [sortedNameCols[0].col, sortedNameCols[1].col].sort((x, y) => x - y);
    firstNameCol = a;
    lastNameCol = b;
  } else if (sortedNameCols.length >= 1 && sortedNameCols[0].score >= 0.3) {
    nameCol = sortedNameCols[0].col;
  }

  const bestEmail = emailScores
    .map((score, col) => ({ col, score }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)[0];
  if (bestEmail) {
    emailCol = bestEmail.col;
  }

  if (nameCol === -1 && firstNameCol === -1 && lastNameCol === -1) {
    const indexCol = rows.slice(dataStartRow, dataStartRow + 10).every((row) => /^\d*$/.test(row[0] || ''));
    if (indexCol && maxCols >= 2) {
      const col1Score = scoreNameColumn(rows, 1, dataStartRow);
      if (col1Score >= 0.3) nameCol = 1;
    } else if (maxCols === 1) {
      nameCol = 0;
    } else {
      nameCol = sortedNameCols[0]?.col ?? 0;
    }
  }

  return {
    dataStartRow,
    nameCol,
    firstNameCol,
    lastNameCol,
    emailCol,
    dutyTypeCol,
    scheduleCols,
  };
}

function extractNameFromRow(row: string[], map: ColumnMap): string {
  if (map.firstNameCol >= 0 || map.lastNameCol >= 0) {
    const first = map.firstNameCol >= 0 ? row[map.firstNameCol] || '' : '';
    const last = map.lastNameCol >= 0 ? row[map.lastNameCol] || '' : '';
    const combined = [first, last].filter(Boolean).join(' ').trim();
    if (combined) return combined;
  }

  if (map.nameCol >= 0) {
    const direct = row[map.nameCol] || '';
    if (direct) return direct;
  }

  for (let c = 0; c < row.length; c++) {
    if (c === map.emailCol || map.scheduleCols[c]) continue;
    const val = row[c] || '';
    if (looksLikePersonName(val)) return val;
  }

  return '';
}

function extractEmailFromRow(row: string[], map: ColumnMap): string {
  if (map.emailCol >= 0) {
    const direct = row[map.emailCol] || '';
    if (looksLikeEmail(direct)) return direct;
  }

  for (let c = 0; c < row.length; c++) {
    const val = row[c] || '';
    if (looksLikeEmail(val)) return val;
  }

  return '';
}

function extractDutyTypeFromRow(row: string[], map: ColumnMap): DutyType | undefined {
  if (map.dutyTypeCol >= 0) {
    const raw = row[map.dutyTypeCol] || '';
    if (raw) return parseDutyType(raw);
  }

  for (let c = 0; c < row.length; c++) {
    const val = row[c] || '';
    if (!val || looksLikeEmail(val) || looksLikePersonName(val)) continue;
    const lower = turkishLower(val);
    if (lower.includes('nöbet') || lower.includes('nobet') || lower.includes('hareketli') || lower.includes('dışı') || lower.includes('disi')) {
      return parseDutyType(val);
    }
  }

  return undefined;
}

function extractScheduleFromRow(
  row: string[],
  scheduleCols: Record<number, { day: number; hour: number }>,
): Record<number, Record<number, string>> | undefined {
  const schedule: Record<number, Record<number, string>> = {};
  let hasData = false;

  for (const [colStr, mapping] of Object.entries(scheduleCols)) {
    const value = row[parseInt(colStr, 10)] || '';
    if (!value) continue;
    hasData = true;
    if (!schedule[mapping.day]) schedule[mapping.day] = {};
    schedule[mapping.day][mapping.hour] = value;
  }

  return hasData ? schedule : undefined;
}

function rowIsEmpty(row: string[]): boolean {
  return row.every((cell) => !cell);
}

export function parseTeachersFromRows(rows: string[][]): ParsedTeacherRow[] {
  if (rows.length === 0) return [];

  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const normalized = rows.map((row) => {
    const arr = row.map((cell) => cellStr(cell));
    while (arr.length < maxCols) arr.push('');
    return arr;
  });

  const map = detectColumnsFromHeader(normalized) ?? detectColumnsFromContent(normalized);
  const results: ParsedTeacherRow[] = [];
  const seenNames = new Set<string>();

  for (let r = map.dataStartRow; r < normalized.length; r++) {
    const row = normalized[r];
    if (rowIsEmpty(row)) continue;

    const name = extractNameFromRow(row, map);
    if (!name || !looksLikePersonName(name)) continue;

    const key = turkishLower(name);
    if (seenNames.has(key)) continue;
    seenNames.add(key);

    const email = extractEmailFromRow(row, map);
    const dutyType = extractDutyTypeFromRow(row, map);
    const schedule = extractScheduleFromRow(row, map.scheduleCols);

    results.push({
      name,
      email: email || undefined,
      dutyType,
      schedule,
    });
  }

  return results;
}

export function parseTeachersFromWorksheet(ws: XLSX.WorkSheet): ParsedTeacherRow[] {
  unmergeWorksheet(ws);
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const rows = raw.map((row) => (Array.isArray(row) ? row : []).map((cell) => cellStr(cell)));
  return parseTeachersFromRows(rows);
}
