import { Absence, ABSENCE_REASONS, Assignment, Substitution } from '../types';

export interface DayBoardDuty {
  locationName: string;
  teacherName: string;
  status: string;
}

export interface DayBoardAbsence {
  teacherName: string;
  detail: string;
}

export interface DayBoard {
  duties: DayBoardDuty[];
  absences: DayBoardAbsence[];
  covers: string[];
}

function teacherName(teachers: { id: string; name: string }[], id: string | undefined): string {
  if (!id) return '—';
  return teachers.find((t) => t.id === id)?.name || '—';
}

function absenceDetail(absence: Absence): string {
  const reason = ABSENCE_REASONS.find((r) => r.id === absence.reason)?.label;
  const hours = absence.hours && absence.hours.length > 0
    ? `${absence.hours.join(', ')}. saat`
    : 'Tüm gün';
  return reason ? `${reason} · ${hours}` : hours;
}

export function buildDayBoard(input: {
  date: string;
  locations: { id: string; name: string }[];
  teachers: { id: string; name: string }[];
  assignments: Assignment[];
  absences: Absence[];
  substitutions: Substitution[];
}): DayBoard {
  const absentIds = new Set(input.absences.filter((a) => a.date === input.date).map((a) => a.teacherId));
  const duties: DayBoardDuty[] = [];

  for (const location of input.locations) {
    const rows = input.assignments.filter((a) => a.date === input.date && a.locationId === location.id);
    for (const row of rows) {
      const name = teacherName(input.teachers, row.teacherId);
      let status = 'Görevde';
      if (row.originalTeacherId) {
        status = `${teacherName(input.teachers, row.originalTeacherId)} yerine`;
      } else if (absentIds.has(row.teacherId)) {
        status = 'Devamsız';
      }
      if (row.isDoubleDuty) status = `${status} · çift nöbet`;
      duties.push({ locationName: location.name, teacherName: name, status });
    }
  }

  const absences = input.absences
    .filter((a) => a.date === input.date)
    .map((a) => ({
      teacherName: teacherName(input.teachers, a.teacherId),
      detail: absenceDetail(a),
    }));

  const covers = input.substitutions
    .filter((s) => s.date === input.date)
    .sort((a, b) => a.hour - b.hour || a.className.localeCompare(b.className, 'tr'))
    .map((s) => {
      const cover = s.substituteTeacherId
        ? teacherName(input.teachers, s.substituteTeacherId)
        : 'atanmadı';
      return `${s.hour}. saat ${s.className}: ${teacherName(input.teachers, s.absentTeacherId)} yerine ${cover}`;
    });

  return { duties, absences, covers };
}
