import { describe, it, expect } from 'vitest';
import type { Assignment, Location, ScheduleArchive, Teacher } from '../types';
import { createFairDistributionState, pickTeacherForSlot } from './dutyDistribution';
import { collectDutyHistory, historyCountsForWeek, seedFairStateFromHistory } from './dutyHistory';
import { rotationAnchorWeek, teacherMatchesLocationOnDate } from './dutyLocation';

const a = (date: string, teacherId: string, locationId = 'bahce'): Assignment => ({
  id: `${date}-${teacherId}-${locationId}`,
  date,
  teacherId,
  locationId,
});

const archive = (archivedAt: string, assignments: Assignment[]): ScheduleArchive => ({
  id: archivedAt,
  label: archivedAt,
  startDate: assignments[0]?.date ?? '',
  endDate: assignments[assignments.length - 1]?.date ?? '',
  assignments,
  archivedAt,
});

const teacher = (id: string, name: string): Teacher => ({ id, name, dutyType: 'hareketli' });

const locations: Location[] = [
  { id: 'bahce', name: 'Bahçe', duties: [] },
  { id: 'koridor', name: 'Koridor', duties: [] },
];

describe('collectDutyHistory', () => {
  it('başlangıç tarihinden önceki nöbetleri mevcut çizelge ve arşivlerden toplar', () => {
    const history = collectDutyHistory(
      [a('2026-10-12', 't2'), a('2026-10-19', 't3')],
      [archive('2026-10-10T10:00:00Z', [a('2026-10-05', 't1')])],
      '2026-10-19',
    );
    expect(history.map(h => h.date)).toEqual(['2026-10-05', '2026-10-12']);
  });

  it('aynı tarih için en son kaydedilen sürümü kullanır', () => {
    const history = collectDutyHistory(
      [a('2026-10-05', 'yeni')],
      [
        archive('2026-10-01T10:00:00Z', [a('2026-10-05', 'eski'), a('2026-10-06', 'eski')]),
        archive('2026-10-03T10:00:00Z', [a('2026-10-06', 'orta')]),
      ],
      '2026-10-10',
    );
    expect(history.map(h => `${h.date}:${h.teacherId}`)).toEqual(['2026-10-05:yeni', '2026-10-06:orta']);
  });
});

describe('seedFairStateFromHistory', () => {
  it('geçen hafta nöbet tutmayanları yeni çizelgede öne alır', () => {
    const teachers = [teacher('t1', 'Ali'), teacher('t2', 'Berk'), teacher('t3', 'Can')];
    const state = createFairDistributionState(teachers.map(t => t.id));
    seedFairStateFromHistory(
      state,
      [a('2026-10-05', 't1'), a('2026-10-06', 't2')],
      teachers.map(t => t.id),
    );
    // İsim sırası Ali'yi öne alırdı; ama nöbet tutmamış olan Can seçilmeli.
    expect(pickTeacherForSlot(teachers, state, new Set(), 'bahce', '2026-10', 1)?.id).toBe('t3');
  });

  it('nöbet sayısı eşitse en uzun süredir nöbet tutmayanı seçer', () => {
    const teachers = [teacher('t1', 'Ali'), teacher('t2', 'Berk')];
    const state = createFairDistributionState(teachers.map(t => t.id));
    seedFairStateFromHistory(
      state,
      [a('2026-10-05', 't2'), a('2026-10-09', 't1')],
      teachers.map(t => t.id),
    );
    expect(pickTeacherForSlot(teachers, state, new Set(), 'bahce', '2026-11', 1)?.id).toBe('t2');
  });

  it('yeni eklenen öğretmeni birikmiş farkla arka arkaya nöbete yazmaz', () => {
    const state = createFairDistributionState(['t1', 't2', 'yeni']);
    const history = [
      ...['01', '02', '05', '06'].map(d => a(`2026-10-${d}`, 't1')),
      ...['01', '02', '05'].map(d => a(`2026-10-${d}`, 't2', 'koridor')),
    ];
    seedFairStateFromHistory(state, history, ['t1', 't2', 'yeni']);
    expect(state.dutyCounts).toEqual({ t1: 1, t2: 0, yeni: 0 });
    expect(state.monthCounts.yeni['2026-10']).toBe(0);
  });

  it('son nöbet yerini hatırlar', () => {
    const state = createFairDistributionState(['t1']);
    seedFairStateFromHistory(state, [a('2026-10-05', 't1', 'bahce'), a('2026-10-12', 't1', 'kantin')], ['t1']);
    expect(state.teacherLastLocation.t1).toBe('kantin');
    expect(state.lastDutyDate.t1).toBe('2026-10-12');
  });
});

describe('historyCountsForWeek', () => {
  it('yalnızca aynı haftadaki nöbetleri sayar', () => {
    const history = [a('2026-10-02', 't1'), a('2026-10-05', 't1'), a('2026-10-06', 't2'), a('2026-10-06', 't3', 'kantin')];
    expect(historyCountsForWeek(history, '2026-10-05')).toEqual({ bahce: 2, kantin: 1 });
  });
});

describe('rotationAnchorWeek', () => {
  it('aynı eğitim yılındaki her tarih için aynı haftayı verir', () => {
    const oct = rotationAnchorWeek(new Date(2026, 9, 12));
    const mar = rotationAnchorWeek(new Date(2027, 2, 1));
    expect(oct.getTime()).toBe(mar.getTime());
  });

  it('ardışık çizelgelerde hareketli öğretmenin yeri kaldığı yerden devam eder', () => {
    const t: Teacher = { id: 't1', name: 'H', dutyType: 'hareketli' };
    const home = { t1: 'bahce' };
    const week1 = new Date(2026, 9, 5);
    const week2 = new Date(2026, 9, 12);
    const loc1 = locations.find(l => teacherMatchesLocationOnDate(t, l.id, week1, locations, home, rotationAnchorWeek(week1)))!.id;
    const loc2 = locations.find(l => teacherMatchesLocationOnDate(t, l.id, week2, locations, home, rotationAnchorWeek(week2)))!.id;
    expect(loc1).not.toBe(loc2);
  });

  it('Ağustos tarihlerinde (referanstan önce) hata vermez', () => {
    const t: Teacher = { id: 't1', name: 'H', dutyType: 'hareketli' };
    const date = new Date(2026, 7, 20);
    expect(() => teacherMatchesLocationOnDate(t, 'bahce', date, locations, { t1: 'bahce' }, rotationAnchorWeek(date))).not.toThrow();
  });
});
