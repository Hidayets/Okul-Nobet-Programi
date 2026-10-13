import { describe, it, expect } from 'vitest';
import { validateSchedules, createTeacherRecognizer, validationReportRows } from './scheduleValidation';
import { Teacher, ClassInfo } from '../types';

const teacher = (name: string, schedule: Teacher['schedule']): Teacher =>
  ({ id: name, name, schedule } as Teacher);
const cls = (name: string, schedule: ClassInfo['schedule']): ClassInfo =>
  ({ id: name, name, schedule });

describe('validateSchedules', () => {
  it('sınıf hücresinin içeriğine bakmaz, satır başındaki sınıfı esas alır', () => {
    const report = validateSchedules(
      [teacher('Ali Veli', { 1: { 1: '6-E', 2: '6E', 3: '6-E' } })],
      [cls('6-E', { 1: { 1: 'Mat6', 2: 'MAT', 3: 'Ayşe Kaya' } })],
    );
    expect(report.comparisons.map(c => c.status)).toEqual(['match', 'match', 'match']);
    expect(report.uncoveredClassSlots).toEqual([]);
    expect(report.conflicts).toEqual([]);
  });

  it('sınıfın dersi olan saatte o sınıfa dersi olan öğretmen yoksa raporlar', () => {
    const report = validateSchedules(
      [teacher('Ali Veli', { 1: { 1: '6-E' } })],
      [cls('6-E', { 1: { 1: 'Mat6', 2: 'Türkçe' } })],
    );
    expect(report.uncoveredClassSlots).toEqual([
      { day: 1, hour: 2, className: '6-E', classValue: 'Türkçe' },
    ]);
  });

  it('öğretmenin dersi olduğu saatte sınıf programı boşsa raporlar', () => {
    const report = validateSchedules(
      [teacher('Ali Veli', { 2: { 4: '6-E' } })],
      [cls('6-E', { 1: { 1: 'Mat6' } })],
    );
    expect(report.comparisons).toContainEqual(expect.objectContaining({
      day: 2, hour: 4, className: '6-E', status: 'class_slot_empty',
    }));
  });

  it('başka sınıfın dersi o sınıfın saatini karşılamaz', () => {
    const report = validateSchedules(
      [teacher('Ali Veli', { 1: { 1: '6-F' } })],
      [cls('6-E', { 1: { 1: 'Mat6' } }), cls('6-F', { 1: { 1: 'Fen' } })],
    );
    expect(report.uncoveredClassSlots.map(s => s.className)).toEqual(['6-E']);
  });

  it('öğretmen hücresinde ek metin veya birden fazla sınıf olabilir', () => {
    const report = validateSchedules(
      [teacher('Ali Veli', { 1: { 1: '6-E MAT', 2: '6-E, 6-F' } })],
      [cls('6-E', { 1: { 1: 'x', 2: 'y' } }), cls('6-F', { 1: { 2: 'z' } })],
    );
    expect(report.uncoveredClassSlots).toEqual([]);
    expect(report.comparisons.every(c => c.status === 'match')).toBe(true);
  });

  it('programı yüklenmemiş sınıfı ayrı işaretler, aynı saatte iki öğretmeni çakışma sayar', () => {
    const report = validateSchedules(
      [
        teacher('Ali Veli', { 1: { 1: '6-E', 2: '7-A' } }),
        teacher('Ayşe Kaya', { 1: { 1: '6-E' } }),
      ],
      [cls('6-E', { 1: { 1: 'Mat6' } })],
    );
    expect(report.comparisons).toContainEqual(expect.objectContaining({ teacherValue: '7-A', status: 'class_not_found' }));
    expect(report.conflicts).toEqual([
      { day: 1, hour: 1, className: '6-E', teacherNames: ['Ali Veli', 'Ayşe Kaya'] },
    ]);
  });
});

describe('createTeacherRecognizer', () => {
  const hidayet = teacher('Hidayet SEVDİ', {});
  const ayse = teacher('Ayşe Kaya', {});
  const names = (r: Teacher[]) => r.map(t => t.name);

  it('kısaltmalardan öğretmeni tanır', () => {
    const recognize = createTeacherRecognizer([hidayet, ayse]);
    for (const cell of ['H. SEVDİ', 'H.SEVDİ', 'HSEVDİ', 'HSVD', 'SEVDİ', 'Hidayet SEVDİ', 'Mat6 HSVD', 'MAT - H. SEVDİ']) {
      expect(names(recognize(cell)), cell).toEqual(['Hidayet SEVDİ']);
    }
  });

  it('ders adlarını öğretmen sanmaz', () => {
    const recognize = createTeacherRecognizer([hidayet, ayse]);
    for (const cell of ['Mat6', 'MAT', 'TÜRKÇE', 'Fen Bil.', 'MTM']) {
      expect(recognize(cell), cell).toEqual([]);
    }
  });

  it('birden fazla öğretmene uyan kısaltmayı tanımaz', () => {
    const recognize = createTeacherRecognizer([hidayet, teacher('Mehmet SEVDİ', {})]);
    expect(recognize('SEVDİ')).toEqual([]);
    expect(names(recognize('H. SEVDİ'))).toEqual(['Hidayet SEVDİ']);
  });
});

describe('validateSchedules — sınıf hücresinde öğretmen', () => {
  it('tanınan öğretmenin o saatte bu sınıfta dersi varsa sorun yok', () => {
    const report = validateSchedules(
      [teacher('Hidayet SEVDİ', { 1: { 1: '6-E' } })],
      [cls('6-E', { 1: { 1: 'HSVD' } })],
    );
    expect(report.classTeacherIssues).toEqual([]);
    expect(report.recognizedClassSlots).toBe(1);
    expect(report.comparisons[0]).toMatchObject({ status: 'match', recognizedFromClass: true });
  });

  it('tanınan öğretmen o saatte başka sınıftaysa raporlar', () => {
    const report = validateSchedules(
      [
        teacher('Hidayet SEVDİ', { 1: { 1: '7-A' } }),
        teacher('Ali Veli', { 1: { 1: '6-E' } }),
      ],
      [cls('6-E', { 1: { 1: 'H. SEVDİ' } })],
    );
    expect(report.classTeacherIssues).toEqual([{
      day: 1, hour: 1, className: '6-E', classValue: 'H. SEVDİ',
      teacherName: 'Hidayet SEVDİ', teacherValue: '7-A', coveredBy: ['Ali Veli'],
    }]);
    expect(report.comparisons.find(c => c.teacherName === 'Ali Veli')?.status).toBe('other_teacher');
    expect(report.uncoveredClassSlots).toEqual([]);
  });

  it('tanınan öğretmenin o saati boşsa raporlar', () => {
    const report = validateSchedules(
      [teacher('Hidayet SEVDİ', { 2: { 3: '6-E' } })],
      [cls('6-E', { 1: { 1: 'HSEVDİ' } })],
    );
    expect(report.classTeacherIssues).toEqual([expect.objectContaining({
      teacherName: 'Hidayet SEVDİ', teacherValue: null, coveredBy: [],
    })]);
    expect(report.uncoveredClassSlots).toEqual([]);
  });

  it('programı yüklenmemiş öğretmen tanınsa da yalnızca ders var/yok kontrolü yapılır', () => {
    const report = validateSchedules(
      [teacher('Hidayet SEVDİ', {}), teacher('Ali Veli', { 1: { 1: '6-E' } })],
      [cls('6-E', { 1: { 1: 'HSVD' } })],
    );
    expect(report.classTeacherIssues).toEqual([]);
    expect(report.uncoveredClassSlots).toEqual([]);
    expect(report.comparisons[0].status).toBe('match');
  });
});

describe('validationReportRows', () => {
  it('sorunları türe, sınıfa ve saate göre sıralı satırlara çevirir', () => {
    const report = validateSchedules(
      [
        teacher('Ali Veli', { 1: { 1: '6-E', 2: '7-A' } }),
        teacher('Ayşe Kaya', { 1: { 1: '6-E' } }),
      ],
      [cls('6-E', { 1: { 1: 'Mat6', 3: 'Fen' } })],
    );
    expect(validationReportRows(report).map(r => [r.kind, r.className, r.hour, r.teacher])).toEqual([
      ['Uyumsuzluk', '6-E', 3, ''],
      ['Çakışma', '6-E', 1, 'Ali Veli, Ayşe Kaya'],
      ['Eksik veri', '7-A', 2, 'Ali Veli'],
    ]);
  });
});
