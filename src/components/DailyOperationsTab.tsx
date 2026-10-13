import React, { useState, useMemo, useEffect } from 'react';
import { format, parseISO, getDay, addDays, isSameWeek, isAfter, isBefore, endOfWeek } from 'date-fns';
import { tr } from 'date-fns/locale';
import { v4 as uuidv4 } from 'uuid';
import { Calendar as CalendarIcon, UserX, UserCheck, RefreshCw, AlertTriangle, BarChart3, Clock, Printer, ChevronDown, ShieldAlert, Users, ArrowRightLeft, X, Plus } from 'lucide-react';
import { Teacher, Assignment, Absence, Substitution, SchoolInfo, DEFAULT_SCHOOL_SETTINGS, calculateLessonTimes, AbsenceReason, ABSENCE_REASONS, Location, canTeacherDutyOnDay } from '../types';
import { assignVicePrincipalsToDates } from '../lib/vicePrincipalDuty';
import { assignSubstitutes } from '../lib/substituteAssignment';
import PrintPreview from './PrintPreview';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Props {
  teachers: Teacher[];
  assignments: Assignment[];
  setAssignments: React.Dispatch<React.SetStateAction<Assignment[]>>;
  absences: Absence[];
  setAbsences: React.Dispatch<React.SetStateAction<Absence[]>>;
  substitutions: Substitution[];
  setSubstitutions: React.Dispatch<React.SetStateAction<Substitution[]>>;
  isAdmin: boolean;
  schoolInfo: SchoolInfo;
  locations: Location[];
}

interface LessonRow {
  key: string;
  hour: number;
  className: string;
  absentTeacherId: string;
  absentTeacherName: string;
  sub?: Substitution;
}

export default function DailyOperationsTab({
  teachers,
  assignments,
  setAssignments,
  absences,
  setAbsences,
  substitutions,
  setSubstitutions,
  isAdmin,
  schoolInfo,
  locations,
}: Props) {
  const settings = schoolInfo.settings ?? DEFAULT_SCHOOL_SETTINGS;
  const lessonTimes = useMemo(() => calculateLessonTimes(settings), [settings]);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [countSearch, setCountSearch] = useState('');
  const [printPreviewHtml, setPrintPreviewHtml] = useState<string | null>(null);

  const dayOfWeek = useMemo(() => {
    const date = parseISO(selectedDate);
    return getDay(date);
  }, [selectedDate]);

  const dailyAbsences = useMemo(() => {
    return absences.filter((a) => a.date === selectedDate);
  }, [absences, selectedDate]);

  const dailySubstitutions = useMemo(() => {
    return substitutions.filter((s) => s.date === selectedDate);
  }, [substitutions, selectedDate]);

  const dutyTeachers = useMemo(() => {
    const dailyAssignments = assignments.filter((a) => a.date === selectedDate);
    return teachers.filter((t) => dailyAssignments.some((a) => a.teacherId === t.id));
  }, [assignments, teachers, selectedDate]);

  // Nöbetçi öğretmenlerin nöbet yerlerini bul
  const dutyTeacherLocations = useMemo(() => {
    const dailyAssignments = assignments.filter((a) => a.date === selectedDate);
    const locationMap = new Map<string, Location[]>();
    // Çift nöbetli öğretmenin yerleri Nöbet Yerleri sırasıyla listelenir.
    for (const location of locations) {
      for (const assignment of dailyAssignments) {
        if (assignment.locationId !== location.id) continue;
        const list = locationMap.get(assignment.teacherId) ?? [];
        if (!list.includes(location)) list.push(location);
        locationMap.set(assignment.teacherId, list);
      }
    }
    return locationMap;
  }, [assignments, selectedDate, locations]);

  const allDutyDates = useMemo(
    () => Array.from(new Set(assignments.map(a => a.date))).sort(),
    [assignments],
  );

  const vpByDate = useMemo(
    () => assignVicePrincipalsToDates(allDutyDates, schoolInfo.mudurYardimcilari),
    [allDutyDates, schoolInfo.mudurYardimcilari],
  );

  const dutyVpForSelectedDay = vpByDate[selectedDate] ?? null;

  const printSignatureVpNames = useMemo(() => {
    if (dutyVpForSelectedDay) return [dutyVpForSelectedDay.name];
    if (schoolInfo.mudurYardimcilari.length === 1) {
      return [schoolInfo.mudurYardimcilari[0].name];
    }
    return [];
  }, [dutyVpForSelectedDay, schoolInfo.mudurYardimcilari]);

  const absentIdSet = useMemo(() => {
    return new Set(dailyAbsences.map(a => a.teacherId));
  }, [dailyAbsences]);

  const [reasonPickerFor, setReasonPickerFor] = useState<string | null>(null);
  const [poolPickerTeacherId, setPoolPickerTeacherId] = useState<string | null>(null);
  const [selectedHoursForAbsence, setSelectedHoursForAbsence] = useState<Set<number>>(new Set());

  /** `substituteTeacherId` boş ise ders görevlisiz bırakılır. Başarılıysa true döner. */
  const setLessonSubstitute = (
    substituteTeacherId: string,
    absentTeacherId: string,
    hour: number,
    className: string,
  ): boolean => {
    const existing = substitutions.find(
      s => s.date === selectedDate && s.absentTeacherId === absentTeacherId && s.hour === hour && s.className === className,
    );
    if (substituteTeacherId) {
      const conflict = substitutions.find(
        s => s.date === selectedDate && s.hour === hour && s.substituteTeacherId === substituteTeacherId && s.id !== existing?.id,
      );
      if (conflict) {
        const name = teachers.find(t => t.id === substituteTeacherId)?.name ?? 'Bu öğretmen';
        if (!confirm(`${name} ${hour}. saatte zaten ${conflict.className} sınıfında görevli.\n\n${className} sınıfı da ona verilsin mi? (İki sınıf birleştirilir)`)) {
          return false;
        }
      }
    }
    if (existing) {
      setSubstitutions(prev => prev.map(s =>
        s.id === existing.id ? { ...s, substituteTeacherId } : s,
      ));
    } else if (substituteTeacherId) {
      setSubstitutions(prev => [
        ...prev,
        {
          id: uuidv4(),
          date: selectedDate,
          hour,
          className,
          absentTeacherId,
          substituteTeacherId,
        },
      ]);
    }
    return true;
  };

  const handleManualAssign = (
    substituteTeacherId: string,
    absentTeacherId: string,
    hour: number,
    className: string,
  ) => {
    if (setLessonSubstitute(substituteTeacherId, absentTeacherId, hour, className)) {
      setPoolPickerTeacherId(null);
    }
  };

  const handleMarkAbsent = (teacherId: string, reason: AbsenceReason) => {
    const selectedHours = Array.from(selectedHoursForAbsence).sort((a, b) => (a as number) - (b as number));
    setAbsences((prev) => [...prev, { 
      id: uuidv4(), 
      date: selectedDate, 
      teacherId, 
      reason,
      hours: selectedHours.length > 0 ? selectedHours as number[] : undefined
    }]);
    // Devamsız öğretmen o saatlerde başkasının dersine görevli kalmasın.
    const absentHours = new Set(selectedHours as number[]);
    setSubstitutions((prev) => prev.map((s) => {
      if (s.date !== selectedDate || s.substituteTeacherId !== teacherId) return s;
      if (absentHours.size > 0 && !absentHours.has(s.hour)) return s;
      return { ...s, substituteTeacherId: '' };
    }));
    setReasonPickerFor(null);
    setSelectedHoursForAbsence(new Set());
  };

  const handleMarkPresent = (teacherId: string) => {
    // Bugünkü bu öğretmenin orijinal atamasını bul (takas yapılmış mı?)
    const todaysAssignment = assignments.find(
      a => a.date === selectedDate && a.originalTeacherId === teacherId
    );
    
    if (todaysAssignment && todaysAssignment.swapPairId) {
      // Takas yapılmış, her iki atamayı da geri al
      setAssignments(prev => {
        return prev.map(a => {
          // Bu atama veya eşleştirilmiş atama
          if (a.id === todaysAssignment.id || a.id === todaysAssignment.swapPairId) {
            if (a.originalTeacherId) {
              return { 
                ...a, 
                teacherId: a.originalTeacherId, 
                originalTeacherId: undefined, 
                swapPairId: undefined 
              };
            }
          }
          return a;
        });
      });
    }
    
    // Devamsızlık ve görevlendirmeleri temizle
    setAbsences((prev) => prev.filter((a) => !(a.date === selectedDate && a.teacherId === teacherId)));
    setSubstitutions((prev) => prev.filter((s) => !(s.date === selectedDate && s.absentTeacherId === teacherId)));
  };

  // Nöbetçi olduğu halde devamsız olan öğretmenler
  const absentDutyTeachers = useMemo(() => {
    return dutyTeachers.filter(t => absentIdSet.has(t.id));
  }, [dutyTeachers, absentIdSet]);

  // Bugünkü takaslar - assignments içinden originalTeacherId olan kayıtları bul
  const todaySwaps = useMemo(() => {
    return assignments
      .filter(a => a.date === selectedDate && a.originalTeacherId)
      .map(a => ({
        absentTeacherId: a.originalTeacherId!,
        substituteTeacherId: a.teacherId,
        locationId: a.locationId,
      }));
  }, [assignments, selectedDate]);

  // Nöbet değişikliği önerileri: sonraki günlerde (aynı hafta içinde) nöbetçi olan öğretmenler
  const dutySwapCandidates = useMemo(() => {
    if (absentDutyTeachers.length === 0) return [];
    const today = parseISO(selectedDate);
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });

    // Sonraki günlerdeki nöbet atamalarını bul (daha önce takas edilmiş olanlar hariç)
    const upcomingAssignments = assignments.filter(a => {
      if (a.originalTeacherId) return false;
      const d = parseISO(a.date);
      return isAfter(d, today) && (isBefore(d, weekEnd) || isSameWeek(d, today, { weekStartsOn: 1 }));
    });
    const onDutyToday = new Set(assignments.filter(a => a.date === selectedDate).map(a => a.teacherId));

    // Her devamsız nöbetçi için swap adayları
    const candidates: {
      absentTeacher: Teacher;
      swapCandidate: Teacher;
      swapDate: string;
      absentLocationId: string;
      swapLocationId: string;
    }[] = [];

    absentDutyTeachers.forEach(absentT => {
      // Zaten takas yapılmış mı? (originalTeacherId set edilmiş mi?)
      const alreadySwapped = assignments.some(
        a => a.date === selectedDate && a.originalTeacherId === absentT.id
      );
      if (alreadySwapped) return;

      // Bugünkü atamayı bul (orijinal öğretmen ID'si ile)
      const todaysAssignment = assignments.find(
        a => a.date === selectedDate && a.teacherId === absentT.id && !a.originalTeacherId
      );
      if (!todaysAssignment) return;

      upcomingAssignments.forEach(ua => {
        const swapTeacher = teachers.find(t => t.id === ua.teacherId);
        if (!swapTeacher) return;
        if (absentIdSet.has(swapTeacher.id)) return;
        if (swapTeacher.dutyType === 'nobetDisi') return;
        // Aday bugün zaten nöbetçiyse iki nöbet tutmuş olur.
        if (onDutyToday.has(swapTeacher.id)) return;
        // Devamsız öğretmen takas gününde de gelmeyecekse ya da o gün nöbet tutamıyorsa takas anlamsız.
        if (absences.some(ab => ab.date === ua.date && ab.teacherId === absentT.id)) return;
        if (!canTeacherDutyOnDay(absentT, getDay(parseISO(ua.date)))) return;
        if (assignments.some(a => a.date === ua.date && a.teacherId === absentT.id)) return;

        // Swap adayı bugün müsait mi kontrol et (dersi yoksa)
        const swapScheduleToday = swapTeacher.schedule?.[dayOfWeek] || {};
        const busyHoursToday = Object.keys(swapScheduleToday).length;
        
        // Tamamen dersi yoksa değil, en az bir dersi olmalı
        if (busyHoursToday === 0) return;
        if (busyHoursToday >= settings.lessonCount) return; // Tüm günü dolu

        candidates.push({
          absentTeacher: absentT,
          swapCandidate: swapTeacher,
          swapDate: ua.date,
          absentLocationId: todaysAssignment.locationId,
          swapLocationId: ua.locationId,
        });
      });
    });

    // Tekrar eden öğretmenleri filtrele, en yakın tarihli olanı seç
    const uniqueByCandidate = new Map<string, typeof candidates[0]>();
    candidates.forEach(c => {
      const key = `${c.absentTeacher.id}-${c.swapCandidate.id}`;
      const existing = uniqueByCandidate.get(key);
      if (!existing || c.swapDate < existing.swapDate) {
        uniqueByCandidate.set(key, c);
      }
    });

    return Array.from(uniqueByCandidate.values())
      .sort((a, b) => a.swapDate.localeCompare(b.swapDate))
      .slice(0, 8);
  }, [absentDutyTeachers, assignments, absences, selectedDate, teachers, absentIdSet, dayOfWeek, settings.lessonCount]);

  const handleSwapDuty = (
    absentTeacherId: string,
    swapTeacherId: string,
    absentLocationId: string,
    swapDate: string,
    swapLocationId: string
  ) => {
    // Her iki atamayı bul
    const todaysAssignment = assignments.find(
      a => a.date === selectedDate && a.teacherId === absentTeacherId && a.locationId === absentLocationId
    );
    const swapAssignment = assignments.find(
      a => a.date === swapDate && a.teacherId === swapTeacherId && a.locationId === swapLocationId
    );

    if (!todaysAssignment || !swapAssignment) return;

    // Tam takas: her iki öğretmenin nöbet gün ve yerini değiştir
    // originalTeacherId ve swapPairId ile takas bilgisini sakla
    setAssignments(prev => {
      return prev.map(a => {
        // Bugün: Devamsız öğretmenin yerine takas edilen öğretmen
        if (a.id === todaysAssignment.id) {
          return { 
            ...a, 
            teacherId: swapTeacherId,
            originalTeacherId: absentTeacherId,
            swapPairId: swapAssignment.id
          };
        }
        // Takas günü: Takas edilen öğretmenin yerine devamsız öğretmen
        if (a.id === swapAssignment.id) {
          return { 
            ...a, 
            teacherId: absentTeacherId,
            originalTeacherId: swapTeacherId,
            swapPairId: todaysAssignment.id
          };
        }
        return a;
      });
    });
  };

  // Nöbetçi olmayan ama boş dersi olan öğretmenler
  // Tüm saatleri boş olanlar (o gün hiç dersi yok) önerilmez
  const nonDutyFreeSuggestions = useMemo(() => {
    return teachers
      .filter(t => {
        if (t.dutyType === 'nobetDisi') return false;
        if (dutyTeachers.some(dt => dt.id === t.id)) return false;
        if (absentIdSet.has(t.id)) return false;
        return true;
      })
      .map(t => {
        const schedule = t.schedule?.[dayOfWeek] || {};
        const busyHours = Object.keys(schedule).length;
        const busySet = new Set(Object.keys(schedule).map(Number));
        const freeHoursList: number[] = [];
        for (let h = 1; h <= settings.lessonCount; h++) {
          if (!busySet.has(h)) freeHoursList.push(h);
        }
        return { teacher: t, freeHours: freeHoursList, busyHours };
      })
      .filter(item => item.freeHours.length > 0 && item.busyHours > 0)
      .sort((a, b) => b.freeHours.length - a.freeHours.length);
  }, [teachers, dutyTeachers, absentIdSet, dayOfWeek, settings.lessonCount]);

  const handleAutoAssign = () => {
    if (dutyTeachers.length === 0) {
      alert('Bu tarihte nöbetçi öğretmen bulunmamaktadır!');
      return;
    }

    const availableDutyTeachers = dutyTeachers.filter(t => !absentIdSet.has(t.id));

    if (availableDutyTeachers.length === 0) {
      alert('Tüm nöbetçi öğretmenler devamsız! Görevlendirme yapılamıyor.');
      return;
    }

    const existingToday = substitutions.filter(s => s.date === selectedDate && s.substituteTeacherId).length;
    if (existingToday > 0 && !confirm(`Bu tarihteki ${existingToday} görevlendirme (elle yapılanlar dahil) silinip yeniden dağıtılacak. Devam edilsin mi?`)) {
      return;
    }

    const newSubstitutions: Substitution[] = [];

    // Collect all lessons that need coverage, sorted by hour for deterministic ordering
    const lessonsToAssign: { hour: number; className: string; absentTeacher: Teacher }[] = [];

    dailyAbsences.forEach(absence => {
      const teacher = teachers.find(t => t.id === absence.teacherId);
      if (!teacher?.schedule?.[dayOfWeek]) return;

      const classesToday = teacher.schedule[dayOfWeek];
      // Eğer absence.hours belirtilmişse sadece o saatleri işle, yoksa tüm gün
      const hoursToProcess = absence.hours && absence.hours.length > 0 
        ? absence.hours 
        : Object.keys(classesToday).map(Number);
      
      hoursToProcess.forEach(hour => {
        const className = classesToday[hour];
        if (className) {
          lessonsToAssign.push({
            hour,
            className,
            absentTeacher: teacher,
          });
        }
      });
    });

    lessonsToAssign.sort((a, b) => a.hour - b.hour);

    // Eğer devamsız öğretmenlerin hiçbirinin ders programı yoksa uyar
    if (lessonsToAssign.length === 0 && dailyAbsences.length > 0) {
      alert('Devamsız öğretmenlerin ders programı bulunamadı. Lütfen "Ders Programları" sekmesinden öğretmen programlarını yükleyin.');
      return;
    }

    const previousCounts = new Map<string, number>();
    substitutions.forEach(s => {
      if (s.date === selectedDate || !s.substituteTeacherId) return;
      previousCounts.set(s.substituteTeacherId, (previousCounts.get(s.substituteTeacherId) ?? 0) + 1);
    });

    const neededHours = [...new Set(lessonsToAssign.map(l => l.hour))];
    const chosenIds = assignSubstitutes(
      lessonsToAssign,
      availableDutyTeachers.map(dt => ({
        id: dt.id,
        freeHours: new Set(neededHours.filter(h => !dt.schedule?.[dayOfWeek]?.[h])),
        previousCount: previousCounts.get(dt.id) ?? 0,
      })),
      { allowMerge: true },
    );

    lessonsToAssign.forEach(({ hour, className, absentTeacher }, i) => {
      const chosenId = chosenIds[i];
      if (!chosenId) return;
      newSubstitutions.push({
        id: uuidv4(),
        date: selectedDate,
        hour,
        className,
        absentTeacherId: absentTeacher.id,
        substituteTeacherId: chosenId,
      });
    });

    setSubstitutions(prev => [...prev.filter(s => s.date !== selectedDate), ...newSubstitutions]);
  };

  // Devamsız öğretmenlerin bugün boş kalan dersleri ve varsa görevlendirme kayıtları
  const lessonRows = useMemo<LessonRow[]>(() => {
    const rows: LessonRow[] = [];
    const matched = new Set<string>();
    dailyAbsences.forEach(absence => {
      const teacher = teachers.find(t => t.id === absence.teacherId);
      const classesToday = teacher?.schedule?.[dayOfWeek];
      if (!teacher || !classesToday) return;
      const hours = absence.hours && absence.hours.length > 0
        ? absence.hours
        : Object.keys(classesToday).map(Number);
      hours.forEach(hour => {
        const className = classesToday[hour];
        if (!className) return;
        const sub = dailySubstitutions.find(
          s => s.absentTeacherId === teacher.id && s.hour === hour && s.className === className,
        );
        if (sub) matched.add(sub.id);
        rows.push({
          key: `${teacher.id}-${hour}-${className}`,
          hour,
          className,
          absentTeacherId: teacher.id,
          absentTeacherName: teacher.name,
          sub,
        });
      });
    });
    dailySubstitutions.forEach(sub => {
      if (matched.has(sub.id)) return;
      rows.push({
        key: sub.id,
        hour: sub.hour,
        className: sub.className,
        absentTeacherId: sub.absentTeacherId,
        absentTeacherName: teachers.find(t => t.id === sub.absentTeacherId)?.name ?? 'Bilinmiyor',
        sub,
      });
    });
    return rows.sort((a, b) => a.hour - b.hour || a.absentTeacherName.localeCompare(b.absentTeacherName, 'tr'));
  }, [dailyAbsences, dailySubstitutions, teachers, dayOfWeek]);

  // Görevlendirme sayıları her zaman kayıtlardan hesaplanır; elle yapılan değişiklikler de anında yansır.
  const substitutionCounts = useMemo(() => {
    const total = new Map<string, number>();
    const month = new Map<string, number>();
    const today = new Map<string, number>();
    const lastDate = new Map<string, string>();
    const monthKey = selectedDate.slice(0, 7);
    substitutions.forEach(s => {
      const id = s.substituteTeacherId;
      if (!id) return;
      total.set(id, (total.get(id) ?? 0) + 1);
      if (s.date.startsWith(monthKey)) month.set(id, (month.get(id) ?? 0) + 1);
      if (s.date === selectedDate) today.set(id, (today.get(id) ?? 0) + 1);
      if ((lastDate.get(id) ?? '') < s.date) lastDate.set(id, s.date);
    });
    return { total, month, today, lastDate };
  }, [substitutions, selectedDate]);

  const isAbsentAtHour = (teacherId: string, hour: number) =>
    dailyAbsences.some(a => a.teacherId === teacherId && (!a.hours || a.hours.length === 0 || a.hours.includes(hour)));

  const getSubstituteOptions = (row: LessonRow) => {
    const busyIds = new Set(
      dailySubstitutions
        .filter(s => s.hour === row.hour && s.substituteTeacherId && s.id !== row.sub?.id)
        .map(s => s.substituteTeacherId),
    );
    const dutyIds = new Set(dutyTeachers.map(t => t.id));
    const canCover = (t: Teacher) =>
      t.id !== row.absentTeacherId && !isAbsentAtHour(t.id, row.hour) && !t.schedule?.[dayOfWeek]?.[row.hour];
    const eligible = teachers.filter(t => {
      if (t.id === row.sub?.substituteTeacherId) return true;
      return canCover(t) && !busyIds.has(t.id);
    });
    const byLoad = (a: Teacher, b: Teacher) =>
      (substitutionCounts.today.get(a.id) ?? 0) - (substitutionCounts.today.get(b.id) ?? 0) ||
      (substitutionCounts.total.get(a.id) ?? 0) - (substitutionCounts.total.get(b.id) ?? 0) ||
      a.name.localeCompare(b.name, 'tr');
    return {
      duty: eligible.filter(t => dutyIds.has(t.id)).sort(byLoad),
      others: eligible.filter(t => !dutyIds.has(t.id)).sort(byLoad),
      merge: dutyTeachers
        .filter(t => busyIds.has(t.id) && t.id !== row.sub?.substituteTeacherId && canCover(t))
        .sort(byLoad),
    };
  };

  /** Aynı saatte aynı görevliye verilen diğer sınıflar (birleştirilmiş dersler). */
  const mergedClassesFor = (row: LessonRow): string[] => {
    const subId = row.sub?.substituteTeacherId;
    if (!subId) return [];
    return dailySubstitutions
      .filter(s => s.hour === row.hour && s.substituteTeacherId === subId && s.id !== row.sub?.id)
      .map(s => s.className);
  };

  const formatOptionLabel = (t: Teacher) => {
    const todayCount = substitutionCounts.today.get(t.id) ?? 0;
    const totalCount = substitutionCounts.total.get(t.id) ?? 0;
    return `${t.name} — bugün ${todayCount}, toplam ${totalCount}${t.dutyType === 'nobetDisi' ? ' (nöbet dışı)' : ''}`;
  };

  const liveDistribution = useMemo(() => {
    const ids = new Set<string>(dutyTeachers.filter(t => !absentIdSet.has(t.id)).map(t => t.id));
    substitutionCounts.today.forEach((_, id) => ids.add(id));
    const perTeacher = Array.from(ids)
      .map(id => {
        const teacher = teachers.find(t => t.id === id);
        if (!teacher) return null;
        return {
          id,
          name: teacher.name,
          isDuty: dutyTeachers.some(t => t.id === id),
          todayCount: substitutionCounts.today.get(id) ?? 0,
          totalCount: substitutionCounts.total.get(id) ?? 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.todayCount - a.todayCount || a.name.localeCompare(b.name, 'tr'));
    const unassigned = lessonRows.filter(r => !r.sub?.substituteTeacherId);
    return {
      perTeacher,
      unassigned,
      totalAssigned: lessonRows.length - unassigned.length,
    };
  }, [dutyTeachers, absentIdSet, substitutionCounts, teachers, lessonRows]);

  const teacherCountRows = useMemo(() => {
    const query = countSearch.trim().toLocaleLowerCase('tr');
    return teachers
      .filter(t => !query || t.name.toLocaleLowerCase('tr').includes(query))
      .map(t => ({
        teacher: t,
        total: substitutionCounts.total.get(t.id) ?? 0,
        month: substitutionCounts.month.get(t.id) ?? 0,
        today: substitutionCounts.today.get(t.id) ?? 0,
        lastDate: substitutionCounts.lastDate.get(t.id),
      }))
      .sort((a, b) => b.total - a.total || a.teacher.name.localeCompare(b.teacher.name, 'tr'));
  }, [teachers, substitutionCounts, countSearch]);

  const formattedDate = format(parseISO(selectedDate), 'dd MMMM yyyy EEEE', { locale: tr });

  const printableGrid = useMemo(() => {
    if (dailyAbsences.length === 0) return [];

    return dailyAbsences.map(absence => {
      const teacher = teachers.find(t => t.id === absence.teacherId);
      const reasonLabel = absence.reason
        ? ABSENCE_REASONS.find(r => r.id === absence.reason)?.label ?? '-'
        : '-';
      const schedule = teacher?.schedule?.[dayOfWeek] ?? {};

      const classesByHour: Record<number, string> = {};
      const substitutesByHour: Record<number, string> = {};
      for (let h = 1; h <= settings.lessonCount; h++) {
        const className = schedule[h];
        classesByHour[h] = className || '-';
        if (className) {
          const sub = dailySubstitutions.find(
            s => s.absentTeacherId === absence.teacherId && s.hour === h && s.substituteTeacherId,
          );
          substitutesByHour[h] = sub
            ? teachers.find(t => t.id === sub.substituteTeacherId)?.name ?? '-'
            : '-';
        } else {
          substitutesByHour[h] = '-';
        }
      }

      return {
        absentName: teacher?.name ?? '-',
        reasonLabel,
        classesByHour,
        substitutesByHour,
      };
    });
  }, [dailyAbsences, dailySubstitutions, teachers, dayOfWeek, settings.lessonCount]);

  const okulAdi = schoolInfo.okulAdi || '';
  const mudur = schoolInfo.okulMuduru || '';

  const handlePrintSubstitutions = () => {
    if (printableGrid.length === 0) {
      alert('Yazdırılacak devamsız öğretmen bulunmuyor.');
      return;
    }

    const lessonHeaders = Array.from(
      { length: settings.lessonCount },
      (_, i) => `<th>${i + 1}. Ders</th>`,
    ).join('');

    const absentSections = printableGrid.map(row => `
      <div class="teacher-block">
        <table class="info-table">
          <tr>
            <td class="info-label">Gelmeyen Öğretmen</td>
            <td class="info-value">${esc(row.absentName)}</td>
            <td class="info-label">Gelmeme Sebebi</td>
            <td class="info-value">${esc(row.reasonLabel)}</td>
          </tr>
        </table>
        <table class="schedule-table">
          <thead>
            <tr>
              <th class="row-label"></th>
              ${lessonHeaders}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="row-label">Sınıf</td>
              ${Array.from({ length: settings.lessonCount }, (_, i) => {
                const val = row.classesByHour[i + 1];
                return `<td class="${val === '-' ? 'empty-cell' : 'class-cell'}">${esc(val)}</td>`;
              }).join('')}
            </tr>
            <tr>
              <td class="row-label">Görevlendirilen Öğretmen</td>
              ${Array.from({ length: settings.lessonCount }, (_, i) => {
                const classVal = row.classesByHour[i + 1];
                const subVal = row.substitutesByHour[i + 1];
                const display = classVal !== '-' && subVal !== '-'
                  ? `${esc(subVal)}<br><span class="sub-class">(${esc(classVal)})</span>`
                  : '-';
                return `<td class="${display === '-' ? 'empty-cell' : 'sub-cell'}">${display}</td>`;
              }).join('')}
            </tr>
          </tbody>
        </table>
      </div>
    `).join('');

    const printHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Ders Görevlendirme Çizelgesi</title>
        <style>
          @page { size: landscape; margin: 1cm; }
          .daily-print-sheet, .daily-print-sheet * { box-sizing: border-box; }
          .daily-print-sheet { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 16px; color: #0f172a; }
          .page-frame {
            border: 2px solid #000;
            padding: 16px;
          }
          .header { text-align: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #000; }
          .header div { margin-bottom: 2px; }
          .teacher-block {
            border: 2px solid #000;
            margin-bottom: 14px;
            padding: 0;
            page-break-inside: avoid;
          }
          .teacher-block:last-of-type { margin-bottom: 0; }
          .daily-print-sheet table { border-collapse: collapse; width: 100%; }
          .info-table td {
            border: 1.5px solid #000;
            padding: 7px 10px;
            font-size: 12px;
          }
          .info-label {
            font-weight: 700;
            background-color: #e2e8f0;
            width: 18%;
            text-align: left;
          }
          .info-value { font-weight: 600; width: 32%; }
          .schedule-table th,
          .schedule-table td {
            border: 1.5px solid #000;
            padding: 7px 6px;
            font-size: 11px;
            text-align: center;
            vertical-align: middle;
          }
          .schedule-table th {
            background-color: #e2e8f0;
            font-weight: 700;
          }
          .row-label {
            text-align: left;
            font-weight: 700;
            padding-left: 10px !important;
            background-color: #f1f5f9;
            min-width: 130px;
            width: 130px;
          }
          .class-cell { font-weight: 600; }
          .sub-cell { font-weight: 600; line-height: 1.3; }
          .sub-class { font-size: 10px; font-weight: 500; color: #334155; }
          .empty-cell { color: #64748b; }
          .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 40px;
            padding: 16px 20px 0;
            border-top: 2px solid #000;
          }
          .signature-box { text-align: center; min-width: 140px; }
          .signature-title { font-size: 10px; margin-bottom: 40px; }
          .signature-name {
            font-size: 11px;
            font-weight: 700;
            border-top: 1.5px solid #000;
            padding-top: 4px;
          }
        </style>
      </head>
      <body>
        <div class="daily-print-sheet">
        <div class="page-frame">
          <div class="header">
            ${schoolInfo.valilik ? `<div style="font-size: 11px; font-weight: 700;">T.C.</div>` : ''}
            ${schoolInfo.valilik ? `<div style="font-size: 11px; font-weight: 700;">${esc(schoolInfo.valilik.toLocaleUpperCase('tr-TR'))} VALİLİĞİ</div>` : ''}
            ${schoolInfo.kaymakamlik ? `<div style="font-size: 11px; font-weight: 700;">${esc(schoolInfo.kaymakamlik.toLocaleUpperCase('tr-TR'))} KAYMAKAMLIĞI</div>` : ''}
            ${okulAdi ? `<div style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">${esc(okulAdi.toLocaleUpperCase('tr-TR'))}</div>` : ''}
            <div style="font-size: 14px; font-weight: 700; margin-bottom: 6px;">DERS GÖREVLENDİRME ÇİZELGESİ</div>
            <div style="font-size: 12px; font-weight: 600;">${formattedDate}</div>
          </div>
          ${absentSections}
          <div class="signatures">
            ${printSignatureVpNames.map(name => `
              <div class="signature-box">
                <div class="signature-title">Nöbetçi Müdür Yardımcısı</div>
                <div class="signature-name">${esc(name)}</div>
              </div>
            `).join('')}
            ${mudur ? `
              <div class="signature-box">
                <div class="signature-title">Okul Müdürü</div>
                <div class="signature-name">${esc(mudur)}</div>
              </div>
            ` : ''}
          </div>
        </div>
        </div>
      </body>
      </html>
    `;

    const styleMatch = printHtml.match(/<style>([\s\S]*?)<\/style>/);
    const bodyMatch = printHtml.match(/<body>([\s\S]*?)<\/body>/);
    setPrintPreviewHtml(`${styleMatch ? `<style>${styleMatch[1]}</style>` : ''}${bodyMatch ? bodyMatch[1] : ''}`);
  };

  return (
    <div className="space-y-6">
      {printPreviewHtml && (
        <PrintPreview
          title="Ders görevlendirme çizelgesi"
          html={printPreviewHtml}
          page="landscape"
          onClose={() => setPrintPreviewHtml(null)}
        />
      )}
      <div className="bg-surface p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-lg font-semibold">Günlük İşlemler</h2>
            <p className="text-sm text-slate-500">Devamsızlık ve ders boşluk doldurma işlemleri</p>
          </div>
          <div className="flex flex-col items-stretch sm:items-end gap-2">
            <div className="relative">
              <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setSelectedDate(e.target.value);
                }}
                className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-auto"
              />
            </div>
            {dutyVpForSelectedDay && (
              <div className="text-sm text-slate-600 bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-lg text-center sm:text-right">
                <span className="text-slate-500">Nöbetçi Md. Yrd.:</span>{' '}
                <span className="font-semibold text-indigo-800">{dutyVpForSelectedDay.name}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Distribution Summary */}
      {lessonRows.length > 0 && (
        <div className="bg-surface rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            <h3 className="font-semibold text-slate-800">Dağıtım Özeti</h3>
            <span className="text-xs text-slate-400 ml-auto">Elle yapılan değişiklikler anında yansır</span>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex gap-3 flex-wrap">
              <div className="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-sm font-medium">
                Atanan: {liveDistribution.totalAssigned} ders
              </div>
              {liveDistribution.unassigned.length > 0 && (
                <div className="bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  Görevlisiz: {liveDistribution.unassigned.length} ders
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {liveDistribution.perTeacher.map(pt => (
                <div key={pt.id} className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-sm font-medium text-slate-700 truncate mr-2">
                    {pt.name}
                    {!pt.isDuty && <span className="ml-1 text-[10px] text-violet-600">(geçici)</span>}
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs font-semibold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                      Bugün: {pt.todayCount}
                    </span>
                    <span className="text-xs font-medium text-slate-400">
                      Toplam: {pt.totalCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {liveDistribution.unassigned.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-amber-700">
                  Görevlisiz Dersler{isAdmin ? ' (aşağıdaki listeden elle atayabilirsiniz)' : ''}:
                </p>
                {liveDistribution.unassigned.map(ul => (
                  <div key={ul.key} className="flex items-center gap-2 p-2.5 rounded-lg border border-amber-200 bg-amber-50/50 text-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    <span className="text-amber-800">
                      <span className="font-semibold">{ul.hour}. ders</span> — {ul.className} ({ul.absentTeacherName})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Absences */}
        <div className="bg-surface rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <h3 className="font-semibold text-slate-800">Öğretmen Durumu</h3>
            <span className="text-sm text-slate-500">{formattedDate}</span>
          </div>
          <div className="p-4 max-h-[500px] overflow-y-auto">
            <div className="space-y-2">
              {teachers.filter(t => {
                const schedule = t.schedule?.[dayOfWeek];
                // Sadece o gün dersi olan öğretmenleri göster (schedule varsa ve boş değilse)
                return schedule && Object.keys(schedule).length > 0;
              }).map((teacher) => {
                const absence = dailyAbsences.find((a) => a.teacherId === teacher.id);
                const isAbsent = !!absence;
                const isDuty = dutyTeachers.some(dt => dt.id === teacher.id);
                const reasonInfo = absence?.reason ? ABSENCE_REASONS.find(r => r.id === absence.reason) : null;
                const isReasonOpen = reasonPickerFor === teacher.id;

                return (
                  <div
                    key={teacher.id}
                    className={`relative p-3 rounded-lg border ${
                      isAbsent ? 'bg-red-50 border-red-200' : 'bg-surface border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium ${isAbsent ? 'text-red-700' : 'text-slate-700'}`}>
                          {teacher.name}
                        </span>
                        {isDuty && (
                          <>
                            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                              Nöbetçi
                            </span>
                            {(dutyTeacherLocations.get(teacher.id)?.length ?? 0) > 0 && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                {dutyTeacherLocations.get(teacher.id)!.map(l => l.name).join(' + ')}
                                {dutyTeacherLocations.get(teacher.id)!.length > 1 && ' (2x)'}
                              </span>
                            )}
                          </>
                        )}
                        {reasonInfo && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-600">
                            {reasonInfo.label}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          if (isAbsent) {
                            handleMarkPresent(teacher.id);
                          } else if (isAdmin) {
                            setReasonPickerFor(isReasonOpen ? null : teacher.id);
                            if (!isReasonOpen) {
                              setSelectedHoursForAbsence(new Set());
                            }
                          }
                        }}
                        disabled={!isAdmin}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors flex-shrink-0 ${
                          isAbsent
                            ? 'bg-red-100 text-red-700 hover:bg-red-200'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        } ${!isAdmin ? 'opacity-70 cursor-not-allowed' : ''}`}
                      >
                        {isAbsent ? (
                          <>
                            <UserX className="w-4 h-4" /> Geri Al
                          </>
                        ) : (
                          <>
                            <UserCheck className="w-4 h-4" /> Yok Yaz
                            <ChevronDown className="w-3 h-3" />
                          </>
                        )}
                      </button>
                    </div>

                    {isReasonOpen && (
                      <div className="mt-2 space-y-3">
                        {/* Saat seçimi */}
                        <div>
                          <p className="text-xs font-medium text-slate-600 mb-2">Devamsız olunan saatleri seçin (boş bırakırsanız tüm gün):</p>
                          <div className="flex flex-wrap gap-1.5">
                            {Array.from({ length: settings.lessonCount }, (_, i) => i + 1).map(hour => {
                              const hasClass = teacher.schedule?.[dayOfWeek]?.[hour];
                              if (!hasClass) return null;
                              const isSelected = selectedHoursForAbsence.has(hour);
                              return (
                                <button
                                  key={hour}
                                  onClick={() => {
                                    setSelectedHoursForAbsence(prev => {
                                      const newSet = new Set(prev);
                                      if (newSet.has(hour)) {
                                        newSet.delete(hour);
                                      } else {
                                        newSet.add(hour);
                                      }
                                      return newSet;
                                    });
                                  }}
                                  className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
                                    isSelected
                                      ? 'bg-red-100 border-red-300 text-red-700'
                                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                                  }`}
                                >
                                  {hour}. ders
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {/* Sebep seçimi */}
                        <div>
                          <p className="text-xs font-medium text-slate-600 mb-2">Sebep:</p>
                          <div className="flex flex-wrap gap-1.5">
                            {ABSENCE_REASONS.map(r => (
                              <button
                                key={r.id}
                                onClick={() => handleMarkAbsent(teacher.id, r.id)}
                                className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors border border-red-200"
                              >
                                {r.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Substitutions */}
        <div className="bg-surface rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <h3 className="font-semibold text-slate-800">Ders Görevlendirmeleri</h3>
            <div className="flex items-center gap-2">
              {dailyAbsences.length > 0 && (
                <button
                  onClick={handlePrintSubstitutions}
                  className="bg-slate-600 hover:bg-slate-700 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  Yazdır
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={handleAutoAssign}
                  disabled={dailyAbsences.length === 0}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Otomatik Dağıt
                </button>
              )}
            </div>
          </div>
          
          <div className="p-6 flex-1 overflow-y-auto">
            {dailyAbsences.length === 0 ? (
              <div className="text-center text-slate-500 mt-10">
                Bu tarih için devamsız öğretmen bulunmuyor.
              </div>
            ) : lessonRows.length === 0 ? (
              <div className="text-center text-slate-500 mt-10">
                Devamsız öğretmenlerin ders programı bulunamadı. Öğretmen programlarını "Ders Programları" sekmesinden yükleyin.
              </div>
            ) : (
              <div className="space-y-3">
                {isAdmin && dailySubstitutions.length === 0 && (
                  <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    "Otomatik Dağıt" ile dağıtabilir ya da her ders için görevliyi aşağıdan elle seçebilirsiniz.
                  </div>
                )}
                {lessonRows.map((row) => {
                    const sub = row.sub;
                    const substituteTeacher = sub?.substituteTeacherId
                      ? teachers.find((t) => t.id === sub.substituteTeacherId)
                      : null;
                    const isUnassigned = !sub?.substituteTeacherId;
                    const options = isAdmin ? getSubstituteOptions(row) : null;

                    const lt = lessonTimes.find(l => l.lesson === row.hour);

                    // Check if substitute has own class at a different hour (show "boş ders" badge)
                    const subHasScheduleToday = substituteTeacher?.schedule?.[dayOfWeek];
                    const subTotalLessons = subHasScheduleToday
                      ? Object.keys(subHasScheduleToday).length
                      : 0;

                    return (
                      <div
                        key={row.key}
                        className={`p-4 rounded-lg border ${
                          isUnassigned
                            ? 'border-amber-300 bg-amber-50/70'
                            : 'border-indigo-100 bg-indigo-50/50'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              isUnassigned ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'
                            }`}>
                              {row.hour}. Ders
                            </span>
                            {lt && (
                              <span className="text-xs text-slate-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {lt.start} - {lt.end}
                              </span>
                            )}
                          </div>
                          <span className="font-semibold text-slate-800">{row.className}</span>
                        </div>
                        <div className="text-sm text-slate-600 space-y-1">
                          <p><span className="text-slate-400">Gelmeyen:</span> {row.absentTeacherName}</p>
                          {mergedClassesFor(row).length > 0 && (
                            <p className="text-xs font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                              Birleştirildi: görevli bu saatte {mergedClassesFor(row).join(', ')} sınıfına da giriyor
                            </p>
                          )}
                          {options ? (
                            <div className="flex items-center gap-2 pt-1">
                              <label className="text-slate-400 flex-shrink-0" htmlFor={`sub-${row.key}`}>Görevli:</label>
                              <select
                                id={`sub-${row.key}`}
                                value={sub?.substituteTeacherId ?? ''}
                                onChange={(e) => setLessonSubstitute(e.target.value, row.absentTeacherId, row.hour, row.className)}
                                className={`flex-1 min-w-0 border rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                  isUnassigned ? 'border-amber-300 text-amber-800' : 'border-indigo-200 text-indigo-800 font-medium'
                                }`}
                              >
                                <option value="">— Görevli yok —</option>
                                {options.duty.length > 0 && (
                                  <optgroup label="Bugünkü nöbetçiler">
                                    {options.duty.map(t => (
                                      <option key={t.id} value={t.id}>{formatOptionLabel(t)}</option>
                                    ))}
                                  </optgroup>
                                )}
                                {options.others.length > 0 && (
                                  <optgroup label="Bu saatte boş diğer öğretmenler">
                                    {options.others.map(t => (
                                      <option key={t.id} value={t.id}>{formatOptionLabel(t)}</option>
                                    ))}
                                  </optgroup>
                                )}
                                {options.merge.length > 0 && (
                                  <optgroup label="Sınıf birleştir (bu saatte başka sınıfta görevli)">
                                    {options.merge.map(t => (
                                      <option key={t.id} value={t.id}>{formatOptionLabel(t)}</option>
                                    ))}
                                  </optgroup>
                                )}
                              </select>
                            </div>
                          ) : isUnassigned ? (
                            <p className="flex items-center gap-1.5 text-amber-700 font-medium">
                              <AlertTriangle className="w-4 h-4" />
                              Görevli atanmadı
                            </p>
                          ) : (
                            <div className="flex items-center justify-between">
                              <p>
                                <span className="text-slate-400">Görevli:</span>{' '}
                                <span className="font-medium text-indigo-700">{substituteTeacher?.name}</span>
                              </p>
                              {substituteTeacher && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                  {subTotalLessons > 0 ? `${subTotalLessons} ders/gün` : 'Boş program'}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Nöbetçi Değişikliği Önerisi */}
      {absentDutyTeachers.length > 0 && dutySwapCandidates.length > 0 && (
        <div className="bg-surface rounded-xl shadow-sm border border-amber-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-amber-200 bg-amber-50/50 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600" />
            <div>
              <h3 className="font-semibold text-amber-800">Nöbet Değişikliği Gerekli</h3>
              <p className="text-xs text-amber-600 mt-0.5">
                {absentDutyTeachers.map(t => t.name).join(', ')} bugün nöbetçi olduğu halde devamsız.
              </p>
            </div>
          </div>
          <div className="p-4">
            <p className="text-sm font-medium text-slate-700 mb-3">Bu hafta sonraki günlerde nöbetçi olan öğretmenlerle takas edebilirsiniz:</p>
            <div className="space-y-2">
              {dutySwapCandidates.map((item, i) => (
                <div key={`${item.absentTeacher.id}-${item.swapCandidate.id}`} className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-amber-700 w-6">{i + 1}.</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{item.swapCandidate.name}</span>
                        <ArrowRightLeft className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-sm text-slate-500">{item.absentTeacher.name}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-indigo-600 font-medium">
                          {format(parseISO(item.swapDate), 'dd MMM EEEE', { locale: tr })} nöbetçi
                        </span>
                      </div>
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => handleSwapDuty(
                        item.absentTeacher.id,
                        item.swapCandidate.id,
                        item.absentLocationId,
                        item.swapDate,
                        item.swapLocationId
                      )}
                      className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      Takas Yap
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Geçici Nöbetçi Havuzu */}
      {dailyAbsences.length > 0 && nonDutyFreeSuggestions.length > 0 && (
        <div className="bg-surface rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-600" />
            <div>
              <h3 className="font-semibold text-slate-800">Geçici Nöbetçi Havuzu</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isAdmin
                  ? 'Bir öğretmene tıklayın ve devamsız öğretmenin boş derslerinden birine elle atayın.'
                  : 'Nöbetçi olmadığı halde bugün boş dersi olan öğretmenler'}
              </p>
            </div>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {nonDutyFreeSuggestions.slice(0, 12).map(item => {
                const Wrapper: any = isAdmin ? 'button' : 'div';
                return (
                  <Wrapper
                    key={item.teacher.id}
                    onClick={isAdmin ? () => setPoolPickerTeacherId(item.teacher.id) : undefined}
                    className={`flex items-center justify-between p-2.5 rounded-lg border border-violet-100 bg-violet-50/30 text-left ${
                      isAdmin ? 'hover:bg-violet-50 hover:border-violet-300 transition-colors cursor-pointer w-full' : ''
                    }`}
                    title={isAdmin ? 'Bu öğretmeni elle atamak için tıklayın' : ''}
                  >
                    <span className="text-sm font-medium text-slate-700 truncate mr-2">{item.teacher.name}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-xs font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
                        {item.freeHours.length} boş
                      </span>
                      <span className="text-[10px] text-slate-400 hidden sm:inline">
                        ({item.freeHours.join(', ')}. ders)
                      </span>
                      {isAdmin && <Plus className="w-3.5 h-3.5 text-violet-500" />}
                    </div>
                  </Wrapper>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tüm öğretmenlerin görevlendirme sayıları */}
      <div className="bg-surface rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="font-semibold text-slate-800">Görevlendirme Sayıları</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Bu eğitim yılında kimin kaç derse görevlendirildiği (elle yapılanlar dahil)
              </p>
            </div>
          </div>
          <input
            type="search"
            value={countSearch}
            onChange={(e) => setCountSearch(e.target.value)}
            placeholder="Öğretmen ara..."
            className="sm:ml-auto border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-56"
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
              <tr>
                <th className="text-left font-medium px-4 py-2 w-10">#</th>
                <th className="text-left font-medium px-4 py-2">Öğretmen</th>
                <th className="text-center font-medium px-4 py-2">Seçili gün</th>
                <th className="text-center font-medium px-4 py-2">Bu ay</th>
                <th className="text-center font-medium px-4 py-2">Toplam</th>
                <th className="text-right font-medium px-4 py-2 hidden sm:table-cell">Son görev</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teacherCountRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-slate-500 py-6">Öğretmen bulunamadı.</td>
                </tr>
              ) : teacherCountRows.map((r, i) => (
                <tr key={r.teacher.id} className={r.total === 0 ? 'text-slate-400' : 'text-slate-700'}>
                  <td className="px-4 py-2">{i + 1}</td>
                  <td className="px-4 py-2 font-medium">
                    {r.teacher.name}
                    {r.teacher.dutyType === 'nobetDisi' && (
                      <span className="ml-1.5 text-[10px] font-normal text-slate-400">(nöbet dışı)</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">{r.today || '-'}</td>
                  <td className="px-4 py-2 text-center">{r.month || '-'}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-block min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-semibold ${
                      r.total > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {r.total}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-xs hidden sm:table-cell">
                    {r.lastDate ? format(parseISO(r.lastDate), 'dd.MM.yyyy') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Geçici Nöbetçi Havuzu - Manuel Atama Modal */}
      {poolPickerTeacherId && (() => {
        const poolEntry = nonDutyFreeSuggestions.find(s => s.teacher.id === poolPickerTeacherId);
        if (!poolEntry) return null;
        const freeHourSet = new Set(poolEntry.freeHours);
        const candidateLessons: { absent: Teacher; hour: number; className: string; alreadyAssignedTo?: Teacher }[] = [];
        dailyAbsences.forEach(ab => {
          const absentTeacher = teachers.find(t => t.id === ab.teacherId);
          if (!absentTeacher?.schedule?.[dayOfWeek]) return;
          const absentHours = ab.hours && ab.hours.length > 0 ? new Set(ab.hours) : null;
          Object.entries(absentTeacher.schedule[dayOfWeek]).forEach(([hourStr, className]) => {
            const hour = parseInt(hourStr, 10);
            if (!freeHourSet.has(hour)) return;
            if (absentHours && !absentHours.has(hour)) return;
            if (!className) return;
            const existing = substitutions.find(
              s => s.date === selectedDate && s.absentTeacherId === absentTeacher.id && s.hour === hour && s.className === className,
            );
            const alreadyAssignedTo = existing?.substituteTeacherId
              ? teachers.find(t => t.id === existing.substituteTeacherId)
              : undefined;
            candidateLessons.push({ absent: absentTeacher, hour, className, alreadyAssignedTo });
          });
        });
        candidateLessons.sort((a, b) => a.hour - b.hour);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setPoolPickerTeacherId(null)}>
            <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">Geçici Nöbetçi Havuzu — Manuel Atama</div>
                  <div className="text-base font-semibold text-slate-800">{poolEntry.teacher.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Boş saatleri: {poolEntry.freeHours.join(', ')}. ders
                  </div>
                </div>
                <button onClick={() => setPoolPickerTeacherId(null)} className="text-slate-400 hover:text-slate-700 p-1.5 rounded hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 max-h-[60vh] overflow-y-auto">
                {candidateLessons.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">
                    Bu öğretmenin boş saatlerinde devamsız öğretmenlerin atanmamış dersi bulunmuyor.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {candidateLessons.map((c, idx) => (
                      <div
                        key={`${c.absent.id}-${c.hour}-${idx}`}
                        className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 flex items-center justify-between"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-800">
                            {c.hour}. ders <span className="text-slate-400 font-normal">— {c.className}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            Gelmeyen: <span className="font-medium text-red-600">{c.absent.name}</span>
                          </div>
                          {c.alreadyAssignedTo && (
                            <div className="text-[11px] text-amber-700 mt-0.5">
                              Şu anda: {c.alreadyAssignedTo.name} (üzerine yazılır)
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleManualAssign(poolEntry.teacher.id, c.absent.id, c.hour, c.className)}
                          className="bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Ata
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
