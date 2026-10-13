import { getDay, parseISO } from 'date-fns';
import { Absence, Assignment, Teacher, getTeacherLessonCount } from '../types';

export function dutyChangeWarnings(input: {
  teacher: Teacher;
  date: string;
  assignments: Assignment[];
  locations: { id: string; name: string }[];
  absences: Absence[];
  excludeAssignmentId?: string;
}): string[] {
  const day = getDay(parseISO(input.date));
  const warnings: string[] = [];
  const lessons = getTeacherLessonCount(input.teacher, day);
  if (lessons > 0) {
    warnings.push(`Bu gün ${lessons} dersi var.`);
  }

  const others = input.assignments.filter(
    (a) => a.teacherId === input.teacher.id && a.date === input.date && a.id !== input.excludeAssignmentId,
  );
  for (const assignment of others) {
    const place = input.locations.find((l) => l.id === assignment.locationId)?.name || 'başka bir yer';
    warnings.push(`Aynı gün ${place} nöbeti de var.`);
  }

  const absence = input.absences.find((a) => a.teacherId === input.teacher.id && a.date === input.date);
  if (absence) {
    warnings.push(absence.hours && absence.hours.length > 0
      ? `Bu gün ${absence.hours.join(', ')}. saatte devamsız.`
      : 'Bu gün devamsız görünüyor.');
  }

  return warnings;
}
