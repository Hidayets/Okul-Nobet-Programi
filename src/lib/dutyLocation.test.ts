import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import {
  buildTeacherHomeLocation,
  buildTeacherHomeLocations,
  getDutyLocationForTeacher,
  teacherMatchesLocationOnDate,
} from './dutyLocation';
import type { Location, Teacher } from '../types';

const locations: Location[] = [
  { id: 'bahce', name: 'Bahçe', duties: [{ teacherId: 't1', day: 1 }] },
  { id: 'koridor', name: 'Koridor', duties: [] },
  { id: 'kantin', name: 'Kantin', duties: [] },
];

const homeMap = buildTeacherHomeLocation(locations);
const refWeekStart = parseISO('2026-03-02'); // Pazartesi

describe('dutyLocation', () => {
  it('sabit teacher stays at home location every week', () => {
    const sabit: Teacher = { id: 't1', name: 'Sabit', dutyType: 'sabit' };
    const week0 = parseISO('2026-03-02');
    const week1 = parseISO('2026-03-09');

    expect(getDutyLocationForTeacher(sabit, week0, locations, homeMap, refWeekStart)).toBe('bahce');
    expect(getDutyLocationForTeacher(sabit, week1, locations, homeMap, refWeekStart)).toBe('bahce');
  });

  it('hareketli teacher rotates locations weekly on same weekday', () => {
    const hareketli: Teacher = { id: 't1', name: 'Hareketli', dutyType: 'hareketli' };
    const week0 = parseISO('2026-03-02');
    const week1 = parseISO('2026-03-09');
    const week2 = parseISO('2026-03-16');

    expect(getDutyLocationForTeacher(hareketli, week0, locations, homeMap, refWeekStart)).toBe('bahce');
    expect(getDutyLocationForTeacher(hareketli, week1, locations, homeMap, refWeekStart)).toBe('koridor');
    expect(getDutyLocationForTeacher(hareketli, week2, locations, homeMap, refWeekStart)).toBe('kantin');
  });

  it('teacherMatchesLocationOnDate validates slot', () => {
    const hareketli: Teacher = { id: 't1', name: 'H', dutyType: 'hareketli' };
    const week1 = parseISO('2026-03-09');

    expect(teacherMatchesLocationOnDate(hareketli, 'koridor', week1, locations, homeMap, refWeekStart)).toBe(true);
    expect(teacherMatchesLocationOnDate(hareketli, 'bahce', week1, locations, homeMap, refWeekStart)).toBe(false);
  });

  it('hareketli rotation skips locations with zero weekly duties', () => {
    const withEmpty: Location[] = [
      { id: 'bahce', name: 'Bahçe', duties: [], assignedTeacherIds: ['t3'] },
      { id: 'depo', name: 'Depo', duties: [], weeklyDutyCount: 0 },
      { id: 'kantin', name: 'Kantin', duties: [] },
    ];
    const homes = buildTeacherHomeLocations(withEmpty);
    const hareketli: Teacher = { id: 't3', name: 'H', dutyType: 'hareketli' };
    const week1 = parseISO('2026-03-09');
    expect(getDutyLocationForTeacher(hareketli, week1, withEmpty, homes, refWeekStart)).toBe('kantin');
  });

  it('teacher assigned to two locations (çift nöbet) matches both', () => {
    const multi: Location[] = [
      { id: 'bahce', name: 'Bahçe', duties: [], assignedTeacherIds: ['t2'] },
      { id: 'koridor', name: 'Koridor', duties: [], assignedTeacherIds: ['t2'] },
      { id: 'kantin', name: 'Kantin', duties: [] },
    ];
    const homes = buildTeacherHomeLocations(multi);
    expect(homes.t2).toEqual(['bahce', 'koridor']);

    const sabit: Teacher = { id: 't2', name: 'Çift', dutyType: 'sabit' };
    const date = parseISO('2026-03-09');
    expect(teacherMatchesLocationOnDate(sabit, 'bahce', date, multi, homes, refWeekStart)).toBe(true);
    expect(teacherMatchesLocationOnDate(sabit, 'koridor', date, multi, homes, refWeekStart)).toBe(true);
    expect(teacherMatchesLocationOnDate(sabit, 'kantin', date, multi, homes, refWeekStart)).toBe(false);
  });
});
