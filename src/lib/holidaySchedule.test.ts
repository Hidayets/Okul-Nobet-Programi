import { describe, it, expect } from 'vitest';
import { buildScheduleRows, stripAssignmentsOnHolidays } from './holidaySchedule';
import type { Assignment, Holiday } from '../types';

const holidays: Holiday[] = [
  { id: '1', date: '2026-01-01', name: 'Yılbaşı' },
  { id: '2', date: '2026-01-20', name: 'Yarıyıl Tatili' },
];

describe('holidaySchedule', () => {
  it('inserts holiday rows between duty days within program range', () => {
    const assignments: Assignment[] = [
      { id: 'a1', date: '2026-01-02', locationId: 'l1', teacherId: 't1' },
      { id: 'a2', date: '2026-01-21', locationId: 'l1', teacherId: 't1' },
    ];
    const rangeHolidays: Holiday[] = [
      { id: '2', date: '2026-01-15', name: 'Yarıyıl Tatili' },
    ];
    const rows = buildScheduleRows(assignments, rangeHolidays);
    expect(rows.map(r => r.date)).toEqual(['2026-01-02', '2026-01-15', '2026-01-21']);
    expect(rows[1]).toMatchObject({ type: 'holiday', holidayName: 'Yarıyıl Tatili' });
    expect(rows[0]).toMatchObject({ type: 'duty' });
  });

  it('prefers holiday row when assignment exists on holiday date', () => {
    const assignments: Assignment[] = [
      { id: 'a1', date: '2026-01-01', locationId: 'l1', teacherId: 't1' },
    ];
    const rows = buildScheduleRows(assignments, holidays);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'holiday', holidayName: 'Yılbaşı' });
  });

  it('çizelgenin sonuna ve başına bitişik tatil haftalarını da gösterir', () => {
    // Son nöbet Cuma 13.11; 16-20.11 ara tatil. İlk nöbet Pazartesi 09.11; önceki Cuma 06.11 tatil.
    const assignments: Assignment[] = [
      { id: 'a1', date: '2026-11-09', locationId: 'l1', teacherId: 't1' },
      { id: 'a2', date: '2026-11-13', locationId: 'l1', teacherId: 't1' },
    ];
    const breakWeek: Holiday[] = [
      { id: 'h0', date: '2026-11-06', name: 'Okul tatili' },
      ...['16', '17', '18', '19', '20'].map(d => ({ id: `h${d}`, date: `2026-11-${d}`, name: '1. Ara Tatil' })),
      { id: 'hx', date: '2026-12-25', name: 'Uzak tatil' },
    ];
    const rows = buildScheduleRows(assignments, breakWeek);
    expect(rows.map(r => r.date)).toEqual([
      '2026-11-06', '2026-11-09', '2026-11-13',
      '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20',
    ]);
  });

  it('strips assignments on holiday dates', () => {
    const assignments: Assignment[] = [
      { id: 'a1', date: '2026-01-01', locationId: 'l1', teacherId: 't1' },
      { id: 'a2', date: '2026-01-02', locationId: 'l1', teacherId: 't1' },
    ];
    const cleaned = stripAssignmentsOnHolidays(assignments, holidays);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].date).toBe('2026-01-02');
  });
});
