import { describe, it, expect } from 'vitest';
import {
  buildLocationAssignedDays,
  canTeacherDutyOnDay,
  getTeacherLessonCount,
  sortLocationsByOrder,
  type Location,
} from '../types';

describe('teacher helpers', () => {
  const locations: Location[] = [
    {
      id: 'loc1',
      name: 'Bahçe',
      duties: [{ teacherId: 't1', day: 1 }],
    },
  ];

  it('buildLocationAssignedDays maps teacher to assigned weekdays', () => {
    expect(buildLocationAssignedDays(locations)).toEqual({ t1: [1] });
  });

  it('getTeacherLessonCount counts filled schedule cells', () => {
    const teacher = {
      id: 't1',
      name: 'T',
      schedule: { 1: { 1: '9A', 2: '', 3: '9B' } },
    };
    expect(getTeacherLessonCount(teacher, 1)).toBe(2);
    expect(getTeacherLessonCount(teacher, 5)).toBe(0);
  });

  it('canTeacherDutyOnDay allows only the fixed day and alternative days', () => {
    const fixedOnly = { id: 't1', name: 'T', preferredDay: 1 };
    expect(canTeacherDutyOnDay(fixedOnly, 1)).toBe(true);
    expect(canTeacherDutyOnDay(fixedOnly, 3)).toBe(false);

    const withAlternatives = { id: 't2', name: 'T', preferredDay: 1, availableDays: [3, 4] };
    expect(canTeacherDutyOnDay(withAlternatives, 1)).toBe(true);
    expect(canTeacherDutyOnDay(withAlternatives, 4)).toBe(true);
    expect(canTeacherDutyOnDay(withAlternatives, 5)).toBe(false);
  });

  it('sortLocationsByOrder follows saved order and keeps array order for missing values', () => {
    const sorted = sortLocationsByOrder([
      { id: 'c', name: 'C', duties: [], order: 2 },
      { id: 'x', name: 'X', duties: [] },
      { id: 'a', name: 'A', duties: [], order: 0 },
      { id: 'y', name: 'Y', duties: [] },
      { id: 'b', name: 'B', duties: [], order: 1 },
    ]);
    expect(sorted.map(l => l.id)).toEqual(['a', 'b', 'c', 'x', 'y']);
  });
});
