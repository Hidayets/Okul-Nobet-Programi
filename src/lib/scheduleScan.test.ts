import { describe, expect, it } from 'vitest';
import { scanSchedule } from './scheduleScan';
import type { Assignment, Teacher } from '../types';

const days = [1, 2, 3, 4, 5];
const ayse: Teacher = { id: 'a', name: 'Ayşe', dutyType: 'hareketli' };
const sabit: Teacher = { id: 's', name: 'Selim', dutyType: 'sabit' };

function duty(partial: Partial<Assignment> & Pick<Assignment, 'id' | 'date' | 'locationId' | 'teacherId'>): Assignment {
  return partial;
}

describe('scanSchedule', () => {
  it('devamsız nöbetçiyi ve eksik yeri kırmızı işaretler', () => {
    const issues = scanSchedule({
      teachers: [ayse],
      locations: [
        { id: 'bahce', name: 'Bahçe', duties: [], weeklyDutyCount: 5 },
        { id: 'kat', name: 'Kat', duties: [], weeklyDutyCount: 5 },
      ],
      holidays: [],
      schoolDays: days,
      absences: [{ id: 'ab', date: '2026-10-05', teacherId: 'a' }],
      assignments: [
        duty({ id: '1', date: '2026-10-05', locationId: 'kat', teacherId: 'a' }),
      ],
    });
    expect(issues.some((i) => i.level === 'red' && i.text.includes('devamsız'))).toBe(true);
    expect(issues.some((i) => i.level === 'red' && i.text.includes('Bahçe') && i.text.includes('eksik'))).toBe(true);
  });

  it('art arda günü ve sürekli aynı yeri turuncu işaretler, sabit öğretmeni aynı yer için işaretlemez', () => {
    const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
    const issues = scanSchedule({
      teachers: [ayse, sabit],
      locations: [{ id: 'bahce', name: 'Bahçe', duties: [], weeklyDutyCount: 5 }],
      holidays: [],
      schoolDays: days,
      absences: [],
      assignments: [
        ...dates.map((date, i) => duty({ id: `h${i}`, date, locationId: 'bahce', teacherId: 'a' })),
        ...dates.map((date, i) => duty({ id: `s${i}`, date, locationId: 'bahce', teacherId: 's' })),
      ],
    });
    expect(issues.some((i) => i.level === 'orange' && i.text.includes('Ayşe') && i.text.includes('art arda'))).toBe(true);
    expect(issues.some((i) => i.level === 'orange' && i.text.includes('Ayşe') && i.text.includes('Bahçe'))).toBe(true);
    expect(issues.some((i) => i.text.includes('Selim') && i.text.includes('çoğu'))).toBe(false);
  });

  it('hiç nöbetçi yazılmamış okul gününü eksik sayar, tatili saymaz', () => {
    const issues = scanSchedule({
      teachers: [ayse],
      locations: [{ id: 'bahce', name: 'Bahçe', duties: [], weeklyDutyCount: 5 }],
      holidays: [{ date: '2026-10-07' }],
      schoolDays: days,
      absences: [],
      assignments: [
        duty({ id: '1', date: '2026-10-05', locationId: 'bahce', teacherId: 'a' }),
        duty({ id: '2', date: '2026-10-08', locationId: 'bahce', teacherId: 'a' }),
      ],
    });
    const short = issues.find((i) => i.text.includes('Bahçe') && i.text.includes('eksik'));
    expect(short?.text).toContain('06.10.2026');
    expect(short?.text).not.toContain('07.10.2026');
  });
});
