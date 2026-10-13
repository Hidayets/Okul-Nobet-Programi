import { describe, it, expect } from 'vitest';
import {
  fillFreedHolidayDates,
  generateDutyAssignmentsForDate,
  shouldFillDutyAfterHolidayRemoval,
} from './fillDutyDay';
import type { Assignment, Holiday, Location, Teacher } from '../types';

const teachers: Teacher[] = [
  { id: 't1', name: 'Ali', dutyType: 'sabit' },
  { id: 't2', name: 'Ayşe', dutyType: 'sabit' },
];

const locations: Location[] = [
  {
    id: 'l1',
    name: 'Bahçe',
    duties: [{ teacherId: 't1', day: 1 }, { teacherId: 't2', day: 1 }],
  },
];

describe('fillDutyDay', () => {
  it('should fill when holiday removed within schedule range on school day', () => {
    const assignments: Assignment[] = [
      { id: 'a1', date: '2026-03-02', locationId: 'l1', teacherId: 't1' },
      { id: 'a2', date: '2026-03-16', locationId: 'l1', teacherId: 't2' },
    ];
    expect(shouldFillDutyAfterHolidayRemoval('2026-03-09', assignments, [1, 2, 3, 4, 5])).toBe(true);
    expect(shouldFillDutyAfterHolidayRemoval('2026-03-09', assignments, [0, 6])).toBe(false);
  });

  it('generates assignments for a freed holiday date', () => {
    const assignments: Assignment[] = [
      { id: 'a1', date: '2026-03-02', locationId: 'l1', teacherId: 't1' },
      { id: 'a2', date: '2026-03-16', locationId: 'l1', teacherId: 't2' },
    ];
    const holidays: Holiday[] = [];
    const filled = generateDutyAssignmentsForDate('2026-03-09', teachers, locations, assignments, holidays);
    expect(filled.length).toBeGreaterThan(0);
    expect(filled.every(a => a.date === '2026-03-09')).toBe(true);
  });

  it('does not fill when date is still a holiday', () => {
    const holidays: Holiday[] = [{ id: 'h1', date: '2026-03-03', name: 'Tatil' }];
    const filled = generateDutyAssignmentsForDate('2026-03-03', teachers, locations, [], holidays);
    expect(filled).toHaveLength(0);
  });

  it('does not assign the same teacher twice at one location on the same day', () => {
    // Yeni sistem: haftada 10 nöbetçi → günde 2 slot; yere yalnız t1 atanmış.
    const newLocations: Location[] = [
      {
        id: 'l1',
        name: 'Bahçe',
        duties: [],
        weeklyDutyCount: 10,
        assignedTeacherIds: ['t1'],
      },
    ];
    const filled = generateDutyAssignmentsForDate('2026-03-09', teachers, newLocations, [], []);
    expect(filled.length).toBe(2);
    const teacherIds = filled.map(a => a.teacherId);
    expect(new Set(teacherIds).size).toBe(teacherIds.length);
    expect(filled.every(a => a.locationId === 'l1')).toBe(true);
  });

  it('tatil olmaktan çıkan birden fazla günü sırayla doldurur, aralık dışını atlar', () => {
    const locs: Location[] = [{ id: 'l1', name: 'Bahçe', duties: [], weeklyDutyCount: 5 }];
    const assignments: Assignment[] = [
      { id: 'a1', date: '2026-03-02', locationId: 'l1', teacherId: 't1' },
      { id: 'a2', date: '2026-03-13', locationId: 'l1', teacherId: 't2' },
    ];
    const filled = fillFreedHolidayDates(['2026-03-10', '2026-03-09', '2026-04-01'], assignments, teachers, locs, [], [1, 2, 3, 4, 5]);
    expect(filled.map(a => a.date).sort()).toEqual(['2026-03-09', '2026-03-10']);
    // Art arda iki gün aynı öğretmene verilmez; adalet sırası önceki doldurulan günü hesaba katar.
    expect(filled[0].teacherId).not.toBe(filled[1].teacherId);
  });

  it('haftalık payı ana dağıtıcı gibi kalan günlere yayar', () => {
    // Haftada 6 nöbetçi, 5 gün: Pazartesi 2 kişi tuttu; kalan 4 nöbet 4 güne birer birer düşer.
    const locs: Location[] = [{ id: 'l1', name: 'Bahçe', duties: [], weeklyDutyCount: 6 }];
    const assignments: Assignment[] = [
      { id: 'a1', date: '2026-03-09', locationId: 'l1', teacherId: 't1' },
      { id: 'a2', date: '2026-03-09', locationId: 'l1', teacherId: 't2' },
      { id: 'a3', date: '2026-03-11', locationId: 'l1', teacherId: 't1' },
    ];
    const filled = generateDutyAssignmentsForDate('2026-03-10', teachers, locs, assignments, []);
    expect(filled).toHaveLength(1);
  });
});
