import { describe, expect, it } from 'vitest';
import { getCurrentAcademicYear, getRelevantAcademicYears } from '../types';

describe('getCurrentAcademicYear', () => {
  it('Ağustos başında yeni eğitim-öğretim yılına geçer', () => {
    expect(getCurrentAcademicYear(new Date(2026, 7, 1))).toBe('2026-2027'); // 1 Ağustos
    expect(getCurrentAcademicYear(new Date(2026, 7, 4))).toBe('2026-2027'); // 4 Ağustos
  });

  it('Temmuzda hâlâ önceki yıldadır', () => {
    expect(getCurrentAcademicYear(new Date(2026, 6, 31))).toBe('2025-2026'); // 31 Temmuz
  });

  it('Ocak–Temmuz aralığında önceki yılı gösterir', () => {
    expect(getCurrentAcademicYear(new Date(2026, 0, 15))).toBe('2025-2026');
    expect(getCurrentAcademicYear(new Date(2027, 5, 1))).toBe('2026-2027');
  });

  it('getRelevantAcademicYears güncel yılı döner', () => {
    expect(getRelevantAcademicYears(new Date(2026, 7, 4))).toEqual(['2026-2027']);
  });
});
