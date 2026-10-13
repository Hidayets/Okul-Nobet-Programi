import { describe, expect, it } from 'vitest';
import { buildDayBoard } from './dayBoard';

describe('buildDayBoard', () => {
  it('devamsız nöbetçiyi, yerine bakanı ve ders görevini listeler', () => {
    const board = buildDayBoard({
      date: '2026-10-08',
      locations: [{ id: 'bahce', name: 'Bahçe' }, { id: 'kat', name: 'Kat 1' }],
      teachers: [
        { id: 'a', name: 'Ayşe' },
        { id: 'b', name: 'Mehmet' },
        { id: 'c', name: 'Can' },
      ],
      assignments: [
        { id: '1', date: '2026-10-08', locationId: 'bahce', teacherId: 'a' },
        { id: '2', date: '2026-10-08', locationId: 'kat', teacherId: 'b', originalTeacherId: 'c' },
      ],
      absences: [{ id: 'ab', date: '2026-10-08', teacherId: 'a', reason: 'rapor' }],
      substitutions: [{
        id: 's',
        date: '2026-10-08',
        hour: 2,
        className: '5-A',
        absentTeacherId: 'a',
        substituteTeacherId: 'b',
      }],
    });

    expect(board.duties).toEqual([
      { locationName: 'Bahçe', teacherName: 'Ayşe', status: 'Devamsız' },
      { locationName: 'Kat 1', teacherName: 'Mehmet', status: 'Can yerine' },
    ]);
    expect(board.absences[0].teacherName).toBe('Ayşe');
    expect(board.absences[0].detail).toContain('Raporlu');
    expect(board.covers).toEqual(['2. saat 5-A: Ayşe yerine Mehmet']);
  });
});
