import { Teacher, ClassInfo } from '../types';
import { turkishLower, fuzzyTeacherMatch } from './teacherMatching';

/**
 * Öğretmen ve sınıf programlarını karşılaştırır.
 *
 * Sınıf programında esas olan satır başındaki sınıf adıdır. Hücre içeriği
 * ("Mat6", "MAT" vb.) yalnızca o saatte ders olduğunu gösterir; içerikten bir
 * öğretmen tanınabiliyorsa ("H. SEVDİ", "HSEVDİ", "HSVD") o öğretmenin
 * programı da ayrıca kontrol edilir. Öğretmen programındaki hücre dersin
 * verildiği sınıfı belirtir.
 */

export interface ComparisonEntry {
  day: number;
  hour: number;
  teacherName: string;
  teacherValue: string;
  className: string | null;
  classValue: string | null;
  /** other_teacher: sınıf hücresinde başka bir öğretmen tanındı (ClassTeacherIssue olarak raporlanır). */
  status: 'match' | 'class_not_found' | 'class_slot_empty' | 'other_teacher';
  /** Sınıf hücresinden tanınan ve bu öğretmenle aynı olan öğretmen. */
  recognizedFromClass?: boolean;
}

export interface ConflictEntry {
  day: number;
  hour: number;
  className: string;
  teacherNames: string[];
}

/** Sınıf programında dolu olup o saatte o sınıfa dersi olan öğretmen bulunmayan saat. */
export interface UncoveredClassSlot {
  day: number;
  hour: number;
  className: string;
  classValue: string;
}

/** Sınıf hücresinde tanınan öğretmenin programında o saatte bu sınıf yok. */
export interface ClassTeacherIssue {
  day: number;
  hour: number;
  className: string;
  classValue: string;
  teacherName: string;
  /** Öğretmenin o saatteki program hücresi (boşsa null). */
  teacherValue: string | null;
  /** O saatte bu sınıfa dersi olan öğretmenler. */
  coveredBy: string[];
}

export interface ValidationReport {
  comparisons: ComparisonEntry[];
  conflicts: ConflictEntry[];
  uncoveredClassSlots: UncoveredClassSlot[];
  classTeacherIssues: ClassTeacherIssue[];
  /** Hücresinden öğretmen tanınan sınıf saati sayısı. */
  recognizedClassSlots: number;
}

export function normalizeClassKey(s: string): string {
  return turkishLower(s).replace(/[\s\-_./]+/g, '');
}

/** Öğretmen hücresindeki değerin işaret ettiği sınıf(lar): "6-E", "6E", "6-E MAT", "6-E, 6-F". */
export function resolveClasses(value: string, classByKey: Map<string, ClassInfo>): ClassInfo[] {
  const whole = classByKey.get(normalizeClassKey(value));
  if (whole) return [whole];
  const found: ClassInfo[] = [];
  for (const token of value.split(/[\s,;+]+/)) {
    const cls = token ? classByKey.get(normalizeClassKey(token)) : undefined;
    if (cls && !found.includes(cls)) found.push(cls);
  }
  return found;
}

/* ─── Sınıf hücresinden öğretmen tanıma ─── */

const VOWELS = /[aeıioöuü]/g;
const lettersOnly = (s: string) => turkishLower(s).replace(/[^a-zçğıöşü]/g, '');
/** İlk harf + kalan ünsüzler: "sevdi" → "svd". */
const consonantSkeleton = (w: string) => (w ? w[0] + w.slice(1).replace(VOWELS, '') : '');
const isSkeletonLike = (s: string) => s.length >= 4 && consonantSkeleton(s) === s;

/** "Hidayet SEVDİ" → hidayetsevdi, hsevdi, sevdih, sevdi, hidayets */
function teacherNameKeys(name: string): string[] {
  const parts = turkishLower(name).split(/[\s.]+/).map(lettersOnly).filter(Boolean);
  if (parts.length < 2) return parts[0] && parts[0].length >= 3 ? [parts[0]] : [];
  const surname = parts[parts.length - 1];
  const given = parts.slice(0, -1);
  const initials = given.map(p => p[0]).join('');
  return [...new Set([
    parts.join(''),
    initials + surname,
    given[0][0] + surname,
    surname + initials,
    surname,
    given.join('') + surname[0],
  ])].filter(k => k.length >= 3);
}

/** "Hidayet SEVDİ" → hsvd, hdytsvd */
function teacherSkeletonKeys(name: string): string[] {
  const parts = turkishLower(name).split(/[\s.]+/).map(lettersOnly).filter(Boolean);
  if (parts.length < 2) return [];
  const surname = parts[parts.length - 1];
  const given = parts.slice(0, -1);
  const initials = given.map(p => p[0]).join('');
  return [...new Set([
    initials + consonantSkeleton(surname),
    given[0][0] + consonantSkeleton(surname),
    parts.map(consonantSkeleton).join(''),
  ])].filter(k => k.length >= 4);
}

function addKey(index: Map<string, Set<Teacher>>, key: string, teacher: Teacher) {
  const set = index.get(key) ?? new Set<Teacher>();
  set.add(teacher);
  index.set(key, set);
}

const unique = (set: Set<Teacher> | undefined): Teacher | null =>
  set && set.size === 1 ? set.values().next().value ?? null : null;

/**
 * Sınıf programı hücresindeki öğretmen kısaltmalarını tanıyan fonksiyon üretir.
 * Birden fazla öğretmene uyan kısaltmalar (ör. aynı soyad) tanınmış sayılmaz.
 */
export function createTeacherRecognizer(teachers: Teacher[]): (cellValue: string) => Teacher[] {
  const named = teachers.filter(t => t.name && t.name.trim());
  const keyIndex = new Map<string, Set<Teacher>>();
  const skeletonIndex = new Map<string, Set<Teacher>>();
  for (const t of named) {
    for (const k of teacherNameKeys(t.name)) addKey(keyIndex, k, t);
    for (const k of teacherSkeletonKeys(t.name)) addKey(skeletonIndex, k, t);
  }

  const matchWindow = (tokens: string[]): Teacher | null => {
    const key = lettersOnly(tokens.join(''));
    if (key.length < 3) return null;
    const byKey = unique(keyIndex.get(key));
    if (byKey) return byKey;
    if (isSkeletonLike(key)) {
      const bySkeleton = unique(skeletonIndex.get(key));
      if (bySkeleton) return bySkeleton;
    }
    const text = tokens.join(' ');
    const fuzzy = named.filter(t => fuzzyTeacherMatch(t.name, text));
    return fuzzy.length === 1 ? fuzzy[0] : null;
  };

  const cache = new Map<string, Teacher[]>();
  return (cellValue: string) => {
    const cached = cache.get(cellValue);
    if (cached) return cached;
    const tokens = cellValue.split(/[\s,;/()+\-–]+/).filter(t => t && !/\d/.test(t));
    const used = new Array(tokens.length).fill(false);
    const found: Teacher[] = [];
    for (let size = Math.min(3, tokens.length); size >= 1; size--) {
      for (let i = 0; i + size <= tokens.length; i++) {
        if (used.slice(i, i + size).some(Boolean)) continue;
        const teacher = matchWindow(tokens.slice(i, i + size));
        if (!teacher) continue;
        for (let j = i; j < i + size; j++) used[j] = true;
        if (!found.includes(teacher)) found.push(teacher);
      }
    }
    cache.set(cellValue, found);
    return found;
  };
}

/* ─── Karşılaştırma ─── */

const dayOrder = (d: number) => (d === 0 ? 7 : d);
const hasSchedule = (t: Teacher) => !!t.schedule && Object.keys(t.schedule).length > 0;

export function validateSchedules(teachers: Teacher[], classes: ClassInfo[]): ValidationReport {
  const comparisons: ComparisonEntry[] = [];
  const classesWithSchedule = classes.filter(c => c.schedule && Object.keys(c.schedule).length > 0);
  const recognize = createTeacherRecognizer(teachers);
  /** Programı yüklü olduğu için doğrulanabilen, hücreden tanınan öğretmenler. */
  const recognizedAt = (cellValue: string) => recognize(cellValue).filter(hasSchedule);

  const classByKey = new Map<string, ClassInfo>();
  for (const cls of classesWithSchedule) {
    const key = normalizeClassKey(cls.name);
    if (key && !classByKey.has(key)) classByKey.set(key, cls);
  }

  const slotTeachers = new Map<string, { cls: ClassInfo; day: number; hour: number; names: string[] }>();

  for (const teacher of teachers) {
    if (!teacher.schedule) continue;
    for (const [dayStr, hours] of Object.entries(teacher.schedule)) {
      const day = Number(dayStr);
      for (const [hourStr, rawValue] of Object.entries(hours || {})) {
        const hour = Number(hourStr);
        const value = String(rawValue ?? '').trim();
        if (!value) continue;

        const matched = resolveClasses(value, classByKey);
        if (matched.length === 0) {
          comparisons.push({
            day, hour, teacherName: teacher.name, teacherValue: value,
            className: null, classValue: null, status: 'class_not_found',
          });
          continue;
        }

        for (const cls of matched) {
          const key = `${cls.id}|${day}|${hour}`;
          const slot = slotTeachers.get(key) ?? { cls, day, hour, names: [] };
          if (!slot.names.includes(teacher.name)) slot.names.push(teacher.name);
          slotTeachers.set(key, slot);

          const classValue = String(cls.schedule?.[day]?.[hour] ?? '').trim();
          if (!classValue) {
            comparisons.push({
              day, hour, teacherName: teacher.name, teacherValue: value,
              className: cls.name, classValue: null, status: 'class_slot_empty',
            });
            continue;
          }
          const recognized = recognizedAt(classValue);
          const isNamed = recognized.includes(teacher);
          comparisons.push({
            day, hour, teacherName: teacher.name, teacherValue: value,
            className: cls.name, classValue,
            status: recognized.length > 0 && !isNamed ? 'other_teacher' : 'match',
            recognizedFromClass: isNamed || undefined,
          });
        }
      }
    }
  }

  const conflicts: ConflictEntry[] = [];
  for (const slot of slotTeachers.values()) {
    if (slot.names.length > 1) {
      conflicts.push({ day: slot.day, hour: slot.hour, className: slot.cls.name, teacherNames: slot.names });
    }
  }

  const uncoveredClassSlots: UncoveredClassSlot[] = [];
  const classTeacherIssues: ClassTeacherIssue[] = [];
  let recognizedClassSlots = 0;
  for (const cls of classesWithSchedule) {
    for (const [dayStr, hours] of Object.entries(cls.schedule)) {
      const day = Number(dayStr);
      for (const [hourStr, rawValue] of Object.entries(hours || {})) {
        const hour = Number(hourStr);
        const classValue = String(rawValue ?? '').trim();
        if (!classValue) continue;
        const coveredBy = slotTeachers.get(`${cls.id}|${day}|${hour}`)?.names ?? [];
        const recognized = recognizedAt(classValue);

        if (recognized.length === 0) {
          if (coveredBy.length === 0) {
            uncoveredClassSlots.push({ day, hour, className: cls.name, classValue });
          }
          continue;
        }

        recognizedClassSlots++;
        for (const t of recognized) {
          if (coveredBy.includes(t.name)) continue;
          const teacherValue = String(t.schedule?.[day]?.[hour] ?? '').trim();
          classTeacherIssues.push({
            day, hour, className: cls.name, classValue,
            teacherName: t.name, teacherValue: teacherValue || null, coveredBy,
          });
        }
      }
    }
  }

  const bySlot = (a: { className: string | null; day: number; hour: number }, b: typeof a) =>
    (a.className ?? '').localeCompare(b.className ?? '', 'tr', { numeric: true })
    || dayOrder(a.day) - dayOrder(b.day)
    || a.hour - b.hour;
  conflicts.sort(bySlot);
  uncoveredClassSlots.sort(bySlot);
  classTeacherIssues.sort(bySlot);

  return { comparisons, conflicts, uncoveredClassSlots, classTeacherIssues, recognizedClassSlots };
}
