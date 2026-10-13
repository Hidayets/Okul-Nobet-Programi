import { describe, it, expect } from 'vitest';
import { assignSubstitutes, SubstituteCandidate } from './substituteAssignment';

const cand = (id: string, freeHours: number[], previousCount = 0): SubstituteCandidate => ({
  id,
  freeHours: new Set(freeHours),
  previousCount,
});

const countBy = (ids: (string | null)[]) =>
  ids.reduce<Record<string, number>>((acc, id) => {
    if (id) acc[id] = (acc[id] ?? 0) + 1;
    return acc;
  }, {});

describe('assignSubstitutes', () => {
  it('yalnızca bazı saatlerde boş olan öğretmene de görev verir', () => {
    // Açgözlü dağıtım 1. saati A'ya verip A'ya 3, B'ye 0 görev bırakıyordu.
    const result = assignSubstitutes(
      [{ hour: 1 }, { hour: 2 }, { hour: 3 }],
      [cand('A', [1, 2, 3, 4, 5, 6]), cand('B', [1])],
    );
    expect(result).toEqual(['B', 'A', 'A']);
  });

  it('müsait herkese eşit verir; bölünemeyen kalan en fazla bir ders olur', () => {
    const result = assignSubstitutes(
      [{ hour: 1 }, { hour: 2 }, { hour: 3 }, { hour: 4 }, { hour: 5 }],
      [cand('A', [1, 2, 3, 4, 5]), cand('B', [1, 2, 3, 4, 5]), cand('C', [1, 2, 3, 4, 5])],
    );
    const counts = Object.values(countBy(result));
    expect(counts).toHaveLength(3);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts.reduce((s, c) => s + c, 0)).toBe(5);
  });

  it('başka müsait nöbetçi yoksa aynı kişiye fazla görev verir', () => {
    const result = assignSubstitutes(
      [{ hour: 1 }, { hour: 2 }, { hour: 3 }],
      [cand('A', [1, 2, 3]), cand('B', [1])],
    );
    expect(countBy(result)).toEqual({ B: 1, A: 2 });
  });

  it('aynı öğretmeni aynı saatte iki derse vermez', () => {
    const result = assignSubstitutes(
      [{ hour: 2 }, { hour: 2 }, { hour: 2 }],
      [cand('A', [2]), cand('B', [2])],
    );
    expect(result.filter(Boolean)).toHaveLength(2);
    expect(new Set(result.filter(Boolean)).size).toBe(2);
    expect(result.filter(r => r === null)).toHaveLength(1);
  });

  it('olabildiğince çok dersi kapatır', () => {
    // A hem 1 hem 2'de boş, B yalnız 1'de: ikisi de kapatılabilmeli.
    const result = assignSubstitutes(
      [{ hour: 2 }, { hour: 1 }],
      [cand('A', [1, 2]), cand('B', [1])],
    );
    expect(result).toEqual(['A', 'B']);
  });

  it('eşit bölünemeyen fazlalığı geçmişte az görev alana verir', () => {
    const result = assignSubstitutes(
      [{ hour: 1 }, { hour: 2 }, { hour: 3 }],
      [cand('A', [1, 2, 3], 5), cand('B', [1, 2, 3], 1)],
    );
    expect(countBy(result)).toEqual({ A: 1, B: 2 });
  });

  it('geçmişte az görev alana bütün günü yüklemez', () => {
    const result = assignSubstitutes(
      [{ hour: 1 }, { hour: 2 }, { hour: 3 }, { hour: 4 }],
      [cand('A', [1, 2, 3, 4], 30), cand('B', [1, 2, 3, 4], 0)],
    );
    expect(countBy(result)).toEqual({ A: 2, B: 2 });
  });

  it('birleştirme açıksa boş kimse kalmayan saatte görevli nöbetçiye ikinci sınıfı verir', () => {
    const result = assignSubstitutes(
      [{ hour: 2 }, { hour: 2 }, { hour: 2 }],
      [cand('A', [2], 0), cand('B', [2], 4)],
      { allowMerge: true },
    );
    expect(result.every(Boolean)).toBe(true);
    expect(countBy(result)).toEqual({ A: 2, B: 1 });
  });

  it('birleştirmede o gün daha az görev alan seçilir', () => {
    // A 1. saatte de görevli; 2. saatin üçüncü dersi B'ye birleştirilmeli.
    const result = assignSubstitutes(
      [{ hour: 1 }, { hour: 2 }, { hour: 2 }, { hour: 2 }],
      [cand('A', [1, 2]), cand('B', [2])],
      { allowMerge: true },
    );
    expect(countBy(result)).toEqual({ A: 2, B: 2 });
  });

  it('o saatte kendi dersi olmayan kimse yoksa birleştirmede de boş bırakır', () => {
    const result = assignSubstitutes([{ hour: 3 }], [cand('A', [1, 2])], { allowMerge: true });
    expect(result).toEqual([null]);
  });

  it('çok sayıda ders ve öğretmende dengeli dağıtır', () => {
    const teachers = ['A', 'B', 'C', 'D'].map(id => cand(id, [1, 2, 3, 4, 5, 6, 7, 8]));
    const lessons = [1, 1, 2, 3, 3, 4, 5, 5, 6, 7, 8, 8].map(hour => ({ hour }));
    const counts = Object.values(countBy(assignSubstitutes(lessons, teachers)));
    expect(counts.reduce((s, c) => s + c, 0)).toBe(12);
    expect(Math.max(...counts) - Math.min(...counts)).toBe(0);
  });
});
