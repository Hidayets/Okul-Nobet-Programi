import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { Assignment, DEFAULT_SCHOOL_SETTINGS, Holiday, Location, SchoolInfo, Teacher } from '../types';
import {
  fetchMebHolidays,
  MEB_CALENDAR_VERSION,
  syncHolidaysWithMeb,
} from '../lib/mebCalendar';
import { stripAssignmentsOnHolidays } from '../lib/holidaySchedule';
import { fillFreedHolidayDates } from '../lib/fillDutyDay';

export interface MebSyncOutcome {
  message: string;
  type: 'success' | 'info' | 'warning';
}

interface Options {
  activeYear: string;
  holidays: Holiday[];
  setHolidays: Dispatch<SetStateAction<Holiday[]>>;
  schoolInfo: SchoolInfo;
  setSchoolInfo: Dispatch<SetStateAction<SchoolInfo>>;
  assignments: Assignment[];
  setAssignments: Dispatch<SetStateAction<Assignment[]>>;
  teachers: Teacher[];
  locations: Location[];
  enabled: boolean;
  onSync?: (outcome: MebSyncOutcome | null) => void;
}

/**
 * Uygulama açılır açılmaz (ve aktif yıl değişince) MEB takvimini canlı kontrol eder.
 * Değişiklik yoksa kullanıcıyı rahatsız etmez; varsa tatilleri günceller.
 * Yeni tatil günlerinin nöbetleri silinir, tatil olmaktan çıkan günler nöbetle doldurulur.
 */
export function useMebCalendarSync({
  activeYear,
  holidays,
  setHolidays,
  schoolInfo,
  setSchoolInfo,
  assignments,
  setAssignments,
  teachers,
  locations,
  enabled,
  onSync,
}: Options) {
  const checkedSessionRef = useRef<Set<string>>(new Set());
  const holidaysRef = useRef(holidays);
  holidaysRef.current = holidays;
  const assignmentsRef = useRef(assignments);
  assignmentsRef.current = assignments;
  const teachersRef = useRef(teachers);
  teachersRef.current = teachers;
  const locationsRef = useRef(locations);
  locationsRef.current = locations;
  const schoolDaysRef = useRef<number[]>(DEFAULT_SCHOOL_SETTINGS.schoolDays);
  schoolDaysRef.current = schoolInfo.settings?.schoolDays?.length
    ? schoolInfo.settings.schoolDays
    : DEFAULT_SCHOOL_SETTINGS.schoolDays;
  const setSchoolInfoRef = useRef(setSchoolInfo);
  setSchoolInfoRef.current = setSchoolInfo;
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  useEffect(() => {
    if (!enabled) return;

    const sessionKey = `${activeYear}@${MEB_CALENDAR_VERSION}`;
    if (checkedSessionRef.current.has(sessionKey)) return;

    checkedSessionRef.current.add(sessionKey);
    let cancelled = false;
    let finished = false;

    (async () => {
      try {
        const { holidays: fetched, source, contentHash, title } = await fetchMebHolidays(activeYear);
        if (cancelled) return;

        if (fetched.length === 0) {
          setSchoolInfoRef.current(prev => ({
            ...prev,
            mebCalendarSync: {
              ...prev.mebCalendarSync,
              [activeYear]: {
                version: MEB_CALENDAR_VERSION,
                syncedAt: new Date().toISOString(),
                source,
                contentHash,
                title,
              },
            },
          }));
          return;
        }

        const sync = syncHolidaysWithMeb(holidaysRef.current, fetched);
        if (sync.changed) {
          setHolidays(sync.holidays);
          const currentAssignments = assignmentsRef.current;
          const stripped = stripAssignmentsOnHolidays(currentAssignments, sync.holidays);
          const filled = locationsRef.current.length > 0
            ? fillFreedHolidayDates(
                sync.removedDates,
                stripped,
                teachersRef.current,
                locationsRef.current,
                sync.holidays,
                schoolDaysRef.current,
              )
            : [];
          if (stripped.length !== currentAssignments.length || filled.length > 0) {
            setAssignments(prev => {
              const datesWithDuty = new Set(prev.map(a => a.date));
              return [...stripAssignmentsOnHolidays(prev, sync.holidays), ...filled.filter(a => !datesWithDuty.has(a.date))];
            });
          }

          const parts: string[] = [];
          if (sync.added > 0) parts.push(`${sync.added} yeni tatil`);
          if (sync.updated > 0) parts.push(`${sync.updated} güncellenen`);
          if (sync.removed > 0) parts.push(`${sync.removed} kaldırılan`);
          const removedDuties = currentAssignments.length - stripped.length;
          if (removedDuties > 0) parts.push(`${removedDuties} tatil günü nöbeti temizlendi`);
          if (filled.length > 0) parts.push(`tatil olmaktan çıkan günlere ${filled.length} nöbet eklendi`);

          onSyncRef.current?.({
            type: 'success',
            message: `MEB takvimi güncellendi (${title || activeYear}): ${parts.join(', ')}.`,
          });
        }

        setSchoolInfoRef.current(prev => {
          const years = new Set(prev.academicYears || []);
          years.add(activeYear);
          return {
            ...prev,
            academicYears: Array.from(years).sort(),
            mebCalendarSync: {
              ...prev.mebCalendarSync,
              [activeYear]: {
                version: MEB_CALENDAR_VERSION,
                syncedAt: new Date().toISOString(),
                source,
                contentHash,
                title: title || `${activeYear} Eğitim-Öğretim Yılı`,
              },
            },
          };
        });
      } catch {
        checkedSessionRef.current.delete(sessionKey);
        if (!cancelled) {
          onSyncRef.current?.({
            type: 'warning',
            message: 'MEB tatil takvimi kontrol edilemedi. Ayarlar’dan manuel yükleyebilirsiniz.',
          });
        }
      } finally {
        finished = !cancelled;
      }
    })();

    return () => {
      cancelled = true;
      if (!finished) checkedSessionRef.current.delete(sessionKey);
    };
  }, [activeYear, enabled, setAssignments, setHolidays]);
}

/** Ayarlar sayfasındaki manuel MEB yükleme için ortak senkron mantığı */
export async function runMebHolidaySync(
  activeYear: string,
  holidays: Holiday[],
): Promise<{
  holidays: Holiday[];
  source: 'meb' | 'api' | 'empty';
  sync: ReturnType<typeof syncHolidaysWithMeb>;
  contentHash?: string;
  title?: string;
  sourceUrl?: string;
}> {
  const { holidays: fetched, source, contentHash, title, sourceUrl } = await fetchMebHolidays(activeYear);
  const sync = syncHolidaysWithMeb(holidays, fetched);
  return { holidays: sync.holidays, source, sync, contentHash, title, sourceUrl };
}
