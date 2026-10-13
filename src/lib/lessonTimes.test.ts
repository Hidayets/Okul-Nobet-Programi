import { describe, it, expect } from 'vitest';
import { shiftLessonTimes } from './lessonTimes';
import type { LessonTime } from '../types';

const base: LessonTime[] = [
  { lesson: 1, start: '08:30', end: '09:10' },
  { lesson: 2, start: '09:20', end: '10:00' },
  { lesson: 3, start: '10:10', end: '10:50' },
  { lesson: 4, start: '11:00', end: '11:40' },
];

describe('shiftLessonTimes', () => {
  it('başlangıç değişince önceki dersleri bozmaz, bu dersi ve sonrakileri kaydırır', () => {
    const next = shiftLessonTimes(base, 2, 'start', '10:20');
    expect(next[0]).toEqual(base[0]);
    expect(next[1]).toEqual(base[1]);
    expect(next[2]).toEqual({ lesson: 3, start: '10:20', end: '11:00' });
    expect(next[3]).toEqual({ lesson: 4, start: '11:10', end: '11:50' });
  });

  it('bitiş değişince önceki dersleri ve bu dersin başlangıcını olduğu gibi bırakır', () => {
    const next = shiftLessonTimes(base, 1, 'end', '10:15');
    expect(next[0]).toEqual(base[0]);
    expect(next[1]).toEqual({ lesson: 2, start: '09:20', end: '10:15' });
    expect(next[2]).toEqual({ lesson: 3, start: '10:25', end: '11:05' });
    expect(next[3]).toEqual({ lesson: 4, start: '11:15', end: '11:55' });
  });

  it('saati geri alınca da önceki ders aynı kalır', () => {
    const next = shiftLessonTimes(base, 2, 'start', '10:00');
    expect(next[1].end).toBe('10:00');
    expect(next[2]).toEqual({ lesson: 3, start: '10:00', end: '10:40' });
    expect(next[3]).toEqual({ lesson: 4, start: '10:50', end: '11:30' });
  });

  it('saniye içeren saat değerini dakikaya yuvarlayıp önceki dersi bozmaz', () => {
    const next = shiftLessonTimes(base, 2, 'start', '10:20:00');
    expect(next[0]).toEqual(base[0]);
    expect(next[1]).toEqual(base[1]);
    expect(next[2].start).toBe('10:20');
  });

  it('kaynak listeyi değiştirmez', () => {
    const snapshot = base.map(t => ({ ...t }));
    shiftLessonTimes(base, 0, 'start', '08:40');
    expect(base).toEqual(snapshot);
  });
});
