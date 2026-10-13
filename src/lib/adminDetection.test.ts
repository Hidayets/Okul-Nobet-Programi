import { describe, it, expect } from 'vitest';
import {
  detectAdminsFromTeachers,
  applyAdminDetection,
  cleanAdminDisplayName,
} from './adminDetection';
import type { Teacher, SchoolInfo } from '../types';

describe('adminDetection', () => {
  it('detects principal from schedule cell', () => {
    const teachers: Teacher[] = [{
      id: 'p1',
      name: 'Ali VELİ',
      schedule: { 1: { 1: 'İDARE', 2: 'OKUL MÜDÜRÜ' } },
    }];
    const result = detectAdminsFromTeachers(teachers);
    expect(result.principal?.teacherName).toBe('Ali VELİ');
  });

  it('detects vice principal from name', () => {
    const teachers: Teacher[] = [{
      id: 'v1',
      name: 'Ayşe KAYA (Müdür Yrd.)',
      schedule: { 1: { 1: '9A' } },
    }];
    const result = detectAdminsFromTeachers(teachers);
    expect(result.vicePrincipals).toHaveLength(1);
    expect(result.principal).toBeNull();
  });

  it('detects hareketli vice principal from schedule', () => {
    const teachers: Teacher[] = [{
      id: 'v2',
      name: 'Mehmet DEMİR',
      schedule: { 2: { 3: 'Müdür Yardımcısı' } },
    }];
    const result = detectAdminsFromTeachers(teachers);
    expect(result.vicePrincipals[0]?.teacherName).toBe('Mehmet DEMİR');
  });

  it('cleans display names', () => {
    expect(cleanAdminDisplayName('Fatma YILMAZ (M.Yrd.)')).toBe('Fatma YILMAZ');
  });

  it('detects principal by 2 weekly lesson hours', () => {
    const teachers: Teacher[] = [{
      id: 'p2',
      name: 'Hasan ÖZTÜRK',
      schedule: {
        1: { 1: '9A', 2: '9B' },
      },
    }];
    const result = detectAdminsFromTeachers(teachers);
    expect(result.principal?.teacherName).toBe('Hasan ÖZTÜRK');
    expect(result.principal?.reason).toContain('2 ders');
  });

  it('detects vice principals by 6 weekly lesson hours', () => {
    const teachers: Teacher[] = [{
      id: 'v3',
      name: 'Zeynep AK',
      schedule: {
        1: { 1: '8A', 2: '8B', 3: '8C' },
        3: { 1: '8A', 2: '8B', 3: '8C' },
      },
    }];
    const result = detectAdminsFromTeachers(teachers);
    expect(result.vicePrincipals).toHaveLength(1);
    expect(result.vicePrincipals[0]?.teacherName).toBe('Zeynep AK');
  });

  it('prefers text detection over lesson hours', () => {
    const teachers: Teacher[] = [{
      id: 'p1',
      name: 'Ali VELİ',
      schedule: { 1: { 1: 'MÜDÜR', 2: '9A', 3: '9B', 4: '9C', 5: '9D', 6: '9E' } },
    }];
    const result = detectAdminsFromTeachers(teachers);
    expect(result.principal?.reason).toContain('Ders programında');
  });

  it('applyAdminDetection fills empty principal', () => {
    const schoolInfo: SchoolInfo = {
      valilik: '',
      kaymakamlik: '',
      okulAdi: '',
      okulMuduru: '',
      mudurYardimcilari: [],
    };
    const teachers: Teacher[] = [{
      id: 'p1',
      name: 'Ali VELİ',
      schedule: { 1: { 1: 'MÜDÜR' } },
    }];
    const { schoolInfo: next, changed } = applyAdminDetection(schoolInfo, teachers);
    expect(changed).toBe(true);
    expect(next.okulMuduru).toBe('Ali VELİ');
  });
});
