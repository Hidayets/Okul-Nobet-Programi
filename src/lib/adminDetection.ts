import { v4 as uuidv4 } from 'uuid';
import { Teacher, SchoolInfo, VicePrincipal } from '../types';
import { turkishLower } from './teacherMatching';

export type AdminRole = 'principal' | 'vicePrincipal';

export interface DetectedAdmin {
  teacherId: string;
  teacherName: string;
  role: AdminRole;
  reason: string;
}

export interface AdminDetectionResult {
  principal: DetectedAdmin | null;
  vicePrincipals: DetectedAdmin[];
}

/** Haftalık ders saati ile müdür / müdür yardımcısı tahmini */
export const PRINCIPAL_WEEKLY_LESSONS = 2;
export const VICE_PRINCIPAL_WEEKLY_LESSONS = 6;

function foldTr(s: string): string {
  return turkishLower(s)
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVicePrincipalText(folded: string): boolean {
  return (
    /mudur\s*y(a)?rd/.test(folded) ||
    /mudur\s*yardimci/.test(folded) ||
    /mud\.?\s*yrd/.test(folded) ||
    /\bm\.?\s*yrd\b/.test(folded) ||
    folded.includes('mudur yardimcisi')
  );
}

function isPrincipalText(folded: string): boolean {
  if (isVicePrincipalText(folded)) return false;
  return (
    folded.includes('okul muduru') ||
    folded.includes('okul mudur') ||
    /\bmudur\b/.test(folded) ||
    /\bidareci\b/.test(folded) ||
    /\bidare\b/.test(folded) ||
    folded.includes('yonetim')
  );
}

function detectRoleInText(text: string): AdminRole | null {
  const folded = foldTr(text);
  if (!folded) return null;
  if (isVicePrincipalText(folded)) return 'vicePrincipal';
  if (isPrincipalText(folded)) return 'principal';
  return null;
}

function collectScheduleTexts(teacher: Teacher): string[] {
  const texts: string[] = [];
  if (!teacher.schedule) return texts;
  for (const hours of Object.values(teacher.schedule)) {
    for (const val of Object.values(hours)) {
      const trimmed = String(val || '').trim();
      if (trimmed) texts.push(trimmed);
    }
  }
  return texts;
}

function countWeeklyLessons(teacher: Teacher): number {
  if (!teacher.schedule) return 0;
  let n = 0;
  for (const hours of Object.values(teacher.schedule)) {
    for (const val of Object.values(hours)) {
      if (val && String(val).trim()) n++;
    }
  }
  return n;
}

function detectByLessonHours(teacher: Teacher): DetectedAdmin | null {
  const weekly = countWeeklyLessons(teacher);
  if (weekly === PRINCIPAL_WEEKLY_LESSONS) {
    return {
      teacherId: teacher.id,
      teacherName: teacher.name,
      role: 'principal',
      reason: `Haftalık ${weekly} ders saati`,
    };
  }
  if (weekly === VICE_PRINCIPAL_WEEKLY_LESSONS) {
    return {
      teacherId: teacher.id,
      teacherName: teacher.name,
      role: 'vicePrincipal',
      reason: `Haftalık ${weekly} ders saati`,
    };
  }
  return null;
}

function detectTeacherAdminFromText(teacher: Teacher): DetectedAdmin | null {
  const nameRole = detectRoleInText(teacher.name);
  const scheduleTexts = collectScheduleTexts(teacher);

  for (const cell of scheduleTexts) {
    const cellRole = detectRoleInText(cell);
    if (cellRole === 'vicePrincipal') {
      return {
        teacherId: teacher.id,
        teacherName: teacher.name,
        role: 'vicePrincipal',
        reason: `Ders programında "${cell}"`,
      };
    }
  }

  for (const cell of scheduleTexts) {
    const cellRole = detectRoleInText(cell);
    if (cellRole === 'principal') {
      return {
        teacherId: teacher.id,
        teacherName: teacher.name,
        role: 'principal',
        reason: `Ders programında "${cell}"`,
      };
    }
  }

  if (nameRole) {
    return {
      teacherId: teacher.id,
      teacherName: teacher.name,
      role: nameRole,
      reason: 'Öğretmen adında idari unvan',
    };
  }

  return null;
}

/** Parantez içi unvanları ve yaygın ekleri temizleyerek görünen adı döndürür. */
export function cleanAdminDisplayName(rawName: string): string {
  return rawName
    .replace(/\([^)]*(müdür|mudur|m\.?\s*yrd|yardımcı|yardimci|idare)[^)]*\)/gi, '')
    .replace(/\s*[-–—]\s*(müdür|mudur|m\.?\s*yrd\.?|müdür yardımcısı|mudur yardimcisi|idareci).*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectAdminsFromTeachers(teachers: Teacher[]): AdminDetectionResult {
  const textHits: DetectedAdmin[] = [];
  const hourHits: DetectedAdmin[] = [];

  for (const teacher of teachers) {
    const textHit = detectTeacherAdminFromText(teacher);
    if (textHit) {
      textHits.push(textHit);
      continue;
    }
    const hourHit = detectByLessonHours(teacher);
    if (hourHit) hourHits.push(hourHit);
  }

  const textVPs = textHits.filter(f => f.role === 'vicePrincipal');
  const textPrincipals = textHits.filter(f => f.role === 'principal');

  let principal: DetectedAdmin | null = null;
  if (textPrincipals.length === 1) {
    principal = textPrincipals[0];
  } else if (textPrincipals.length > 1) {
    principal = textPrincipals.find(p => foldTr(p.reason).includes('okul mudur')) ?? textPrincipals[0];
  }

  if (!principal) {
    const hourPrincipals = hourHits.filter(h => h.role === 'principal');
    if (hourPrincipals.length === 1) {
      principal = hourPrincipals[0];
    }
  }

  const principalId = principal?.teacherId;
  const hourVPs = hourHits.filter(
    h => h.role === 'vicePrincipal' && h.teacherId !== principalId,
  );
  const vicePrincipalIds = new Set<string>();
  const vicePrincipals: DetectedAdmin[] = [];

  for (const vp of [...textVPs, ...hourVPs]) {
    if (vp.teacherId === principalId || vicePrincipalIds.has(vp.teacherId)) continue;
    vicePrincipalIds.add(vp.teacherId);
    vicePrincipals.push(vp);
  }

  return { principal, vicePrincipals };
}

function namesLikelySame(a: string, b: string): boolean {
  const fa = foldTr(cleanAdminDisplayName(a));
  const fb = foldTr(cleanAdminDisplayName(b));
  return fa === fb || fa.includes(fb) || fb.includes(fa);
}

export function applyAdminDetection(
  schoolInfo: SchoolInfo,
  teachers: Teacher[],
  options?: { overwrite?: boolean },
): { schoolInfo: SchoolInfo; detection: AdminDetectionResult; changed: boolean } {
  const detection = detectAdminsFromTeachers(teachers);
  const overwrite = options?.overwrite ?? false;

  let okulMuduru = schoolInfo.okulMuduru;
  let mudurYardimcilari: VicePrincipal[] = [...schoolInfo.mudurYardimcilari];
  let changed = false;

  if (detection.principal) {
    const name = cleanAdminDisplayName(detection.principal.teacherName);
    if (overwrite || !okulMuduru.trim()) {
      if (okulMuduru.trim() !== name) changed = true;
      okulMuduru = name;
    }
  }

  if (overwrite) {
    const nextVps = detection.vicePrincipals.map(vp => ({
      id: uuidv4(),
      name: cleanAdminDisplayName(vp.teacherName),
    }));
    if (JSON.stringify(nextVps.map(v => v.name)) !== JSON.stringify(mudurYardimcilari.map(v => v.name))) {
      changed = true;
    }
    mudurYardimcilari = nextVps;
  } else {
    for (const vp of detection.vicePrincipals) {
      const name = cleanAdminDisplayName(vp.teacherName);
      if (!mudurYardimcilari.some(existing => namesLikelySame(existing.name, name))) {
        mudurYardimcilari.push({ id: uuidv4(), name });
        changed = true;
      }
    }
  }

  return {
    schoolInfo: { ...schoolInfo, okulMuduru, mudurYardimcilari },
    detection,
    changed,
  };
}

export function formatDetectionSummary(detection: AdminDetectionResult): string | null {
  const parts: string[] = [];
  if (detection.principal) {
    parts.push(`Müdür: ${cleanAdminDisplayName(detection.principal.teacherName)}`);
  }
  if (detection.vicePrincipals.length > 0) {
    parts.push(
      `${detection.vicePrincipals.length} müdür yardımcısı`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
