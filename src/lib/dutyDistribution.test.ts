import { describe, it, expect } from 'vitest';
import {
  createFairDistributionState,
  pickTeacherForSlot,
  recordDutyAssignment,
  compareTeachersForFairSlot,
  computeLocationDistribution,
  computeMonthDistribution,
  getMonthKey,
  canTakeSlotToday,
  markAssignedToday,
  preferSlotPool,
} from './dutyDistribution';
import type { Teacher } from '../types';

function makeTeacher(overrides: Partial<Teacher> & { id: string; name: string }): Teacher {
  return {
    dutyType: 'hareketli',
    ...overrides,
  };
}

describe('dutyDistribution', () => {
  it('getMonthKey extracts YYYY-MM', () => {
    expect(getMonthKey('2026-03-15')).toBe('2026-03');
  });

  it('prefers teacher with fewer total duties', () => {
    const state = createFairDistributionState(['a', 'b']);
    state.dutyCounts.a = 3;
    state.dutyCounts.b = 1;

    const a = makeTeacher({ id: 'a', name: 'Ali' });
    const b = makeTeacher({ id: 'b', name: 'Berk' });

    expect(compareTeachersForFairSlot(a, b, state, new Set(), 'loc1', '2026-03', 1)).toBeGreaterThan(0);
  });

  it('prefers teacher with fewer lessons on that day', () => {
    const state = createFairDistributionState(['a', 'b']);
    const a = makeTeacher({
      id: 'a',
      name: 'Ali',
      schedule: { 1: { 1: '9A', 2: '9B', 3: '9C', 4: '9C', 5: '9D', 6: '9E', 7: '9F', 8: '9G' } },
    });
    const b = makeTeacher({
      id: 'b',
      name: 'Berk',
      schedule: { 1: { 1: '10A' } },
    });

    const chosen = pickTeacherForSlot([a, b], state, new Set(), 'loc1', '2026-03', 1);
    expect(chosen?.id).toBe('b');
  });

  it('records teacher anchor location when setAnchor is true', () => {
    const state = createFairDistributionState(['t1']);
    recordDutyAssignment(state, 't1', 'loc1', '2026-03', undefined, true);
    expect(state.teacherAnchorLocation.t1).toBe('loc1');
  });

  it('never picks a teacher twice for the same location on the same day', () => {
    const state = createFairDistributionState(['a', 'b']);
    const a = makeTeacher({ id: 'a', name: 'Ali' });
    const b = makeTeacher({ id: 'b', name: 'Berk' });
    // Anahtar formatı: `${teacherId}_${locationId}`
    const assignedToday = new Set(['a_loc1']);

    // 'a' loc1 için havuzda kalsa bile seçilemez; kalan tek aday 'b' döner.
    expect(pickTeacherForSlot([a, b], state, assignedToday, 'loc1', '2026-03', 1)?.id).toBe('b');
    // Havuzda yalnızca o yere atanmış öğretmen varsa sonuç boş olur (mükerrer atama yapılmaz).
    expect(pickTeacherForSlot([a], state, assignedToday, 'loc1', '2026-03', 1)).toBeNull();
    // Aynı gün farklı bir yerde (loc2) görev yapabilir.
    expect(pickTeacherForSlot([a], state, assignedToday, 'loc2', '2026-03', 1)?.id).toBe('a');
  });

  it('prefers the teacher whose fixed duty day is today', () => {
    const state = createFairDistributionState(['a', 'b']);
    state.dutyCounts.a = 5;
    const a = makeTeacher({ id: 'a', name: 'Ali', preferredDay: 1 });
    const b = makeTeacher({ id: 'b', name: 'Berk' });
    expect(pickTeacherForSlot([a, b], state, new Set(), 'loc1', '2026-03', 1, '2026-03-02')?.id).toBe('a');
  });

  it('uses an alternative day last when the teacher already had duty that week', () => {
    const state = createFairDistributionState(['a', 'b']);
    state.dutyCounts.b = 5;
    state.lastDutyDate.a = '2026-03-02';
    const a = makeTeacher({ id: 'a', name: 'Ali', preferredDay: 1, availableDays: [3] });
    const b = makeTeacher({ id: 'b', name: 'Berk' });
    expect(pickTeacherForSlot([a, b], state, new Set(), 'loc1', '2026-03', 3, '2026-03-04')?.id).toBe('b');
    // Sabit günü tatile denk geldiyse (o hafta nöbet yok) alternatif günde adil sıraya girer.
    state.lastDutyDate.a = '2026-02-23';
    expect(pickTeacherForSlot([a, b], state, new Set(), 'loc1', '2026-03', 3, '2026-03-04')?.id).toBe('a');
  });

  it('keeps a fixed-day teacher for their own day instead of an earlier alternative day', () => {
    const state = createFairDistributionState(['a', 'b']);
    state.dutyCounts.b = 5;
    const a = makeTeacher({ id: 'a', name: 'Ali', preferredDay: 4, availableDays: [2] });
    const b = makeTeacher({ id: 'b', name: 'Berk' });
    // Salı alternatif gün ama Perşembe (sabit gün) henüz gelmedi.
    expect(pickTeacherForSlot([a, b], state, new Set(), 'loc1', '2026-03', 2, '2026-03-03')?.id).toBe('b');
  });

  it('does not give the fixed day priority again after an alternative-day duty that week', () => {
    const state = createFairDistributionState(['a', 'b']);
    state.dutyCounts.b = 5;
    state.lastDutyDate.a = '2026-03-03';
    const a = makeTeacher({ id: 'a', name: 'Ali', preferredDay: 4, availableDays: [2] });
    const b = makeTeacher({ id: 'b', name: 'Berk' });
    expect(pickTeacherForSlot([a, b], state, new Set(), 'loc1', '2026-03', 4, '2026-03-05')?.id).toBe('b');
  });

  it('gives a second same-day duty only to multi-location teachers at another location', () => {
    const assignedToday = new Set<string>();
    markAssignedToday(assignedToday, 'a', 'loc1');
    expect(canTakeSlotToday('a', 'loc2', assignedToday, 1)).toBe(false);
    expect(canTakeSlotToday('a', 'loc1', assignedToday, 2)).toBe(false);
    expect(canTakeSlotToday('a', 'loc2', assignedToday, 2)).toBe(true);
    markAssignedToday(assignedToday, 'a', 'loc2');
    expect(canTakeSlotToday('a', 'loc3', assignedToday, 2)).toBe(false);
    expect(canTakeSlotToday('b', 'loc1', assignedToday, 0)).toBe(true);
  });

  it('preferSlotPool keeps double duty as the last resort', () => {
    const a = makeTeacher({ id: 'a', name: 'Ali' });
    const b = makeTeacher({ id: 'b', name: 'Berk' });
    const c = makeTeacher({ id: 'c', name: 'Cem' });
    const assignedToday = new Set(['a']);
    const hasHome = (id: string) => id !== 'c';
    expect(preferSlotPool([a, b, c], assignedToday, hasHome).map(t => t.id)).toEqual(['b']);
    expect(preferSlotPool([a, c], assignedToday, hasHome).map(t => t.id)).toEqual(['c']);
    expect(preferSlotPool([a], assignedToday, hasHome).map(t => t.id)).toEqual(['a']);
  });

  it('computeLocationDistribution groups by teacher and location', () => {
    const result = computeLocationDistribution(
      [
        { teacherId: 't1', locationId: 'l1' },
        { teacherId: 't1', locationId: 'l1' },
        { teacherId: 't1', locationId: 'l2' },
      ],
      { t1: 'Ayşe' },
      { l1: 'Bahçe', l2: 'Koridor' },
    );
    expect(result).toHaveLength(1);
    expect(result[0].locations.find(l => l.locationId === 'l1')?.count).toBe(2);
    expect(result[0].locations.find(l => l.locationId === 'l2')?.count).toBe(1);
  });

  it('computeMonthDistribution groups by teacher and month', () => {
    const result = computeMonthDistribution(
      [
        { teacherId: 't1', date: '2026-03-01' },
        { teacherId: 't1', date: '2026-03-15' },
        { teacherId: 't1', date: '2026-04-01' },
      ],
      { t1: 'Ayşe' },
    );
    expect(result[0].months).toEqual([
      { monthKey: '2026-03', count: 2 },
      { monthKey: '2026-04', count: 1 },
    ]);
  });
});
