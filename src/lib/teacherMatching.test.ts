import { describe, it, expect } from 'vitest';
import { isSameTeacherName, unifyTeachers } from './teacherMatching';
import type { Teacher } from '../types';

const t = (id: string, name: string): Teacher => ({ id, name } as Teacher);

describe('isSameTeacherName', () => {
  it('kısaltmalı adı tam adla eşleştirir', () => {
    expect(isSameTeacherName('Ahmet Adıgüzel', 'A. Adıgüzel')).toBe(true);
    expect(isSameTeacherName('Ahmet Yılmaz', 'Ah.Yılmaz')).toBe(true);
  });

  it('büyük/küçük harf farkını aynı kabul eder', () => {
    expect(isSameTeacherName('AYŞE KARA', 'ayşe kara')).toBe(true);
  });

  it('kısaltma içermeyen farklı adları eşleştirmez', () => {
    expect(isSameTeacherName('Can Demir', 'Canan Demir')).toBe(false);
    expect(isSameTeacherName('Gül Yılmaz', 'Gülay Yılmaz')).toBe(false);
    expect(isSameTeacherName('Ali Kaya', 'Mehmet Ali Kaya')).toBe(false);
  });
});

describe('unifyTeachers', () => {
  it('kısaltmalı kaydı tam adlı kayıtla birleştirir', () => {
    const { teachers, idRemap } = unifyTeachers([t('1', 'Ahmet Adıgüzel'), t('2', 'A. Adıgüzel')]);
    expect(teachers).toHaveLength(1);
    expect(teachers[0].name).toBe('Ahmet Adıgüzel');
    expect(idRemap).toEqual({ '2': '1' });
  });

  it('benzer ama farklı adları birleştirmez', () => {
    const { teachers, idRemap } = unifyTeachers([t('1', 'Can Demir'), t('2', 'Canan Demir')]);
    expect(teachers).toHaveLength(2);
    expect(idRemap).toEqual({});
  });

  it('birden fazla adayla eşleşen kısaltmayı birleştirmez', () => {
    const { teachers, idRemap } = unifyTeachers([
      t('1', 'A. Yılmaz'),
      t('2', 'Ahmet Yılmaz'),
      t('3', 'Ayşe Yılmaz'),
    ]);
    expect(teachers).toHaveLength(3);
    expect(idRemap).toEqual({});
  });
});
