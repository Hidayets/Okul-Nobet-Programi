import { describe, it, expect } from 'vitest';
import { arrangeStaircaseWeek, staircaseTarget, type ArrangeOptions, type StaircaseSlot } from './staircase';

const days = [1, 2, 3];
const ring = ['A', 'B', 'C'];

const baseOpts = (overrides: Partial<ArrangeOptions> = {}): ArrangeOptions => ({
  days,
  ring,
  targets: {},
  preferredDayOf: () => undefined,
  dayOk: () => true,
  homeOk: () => true,
  ...overrides,
});

const week: StaircaseSlot[] = [
  { dateStr: '2026-10-12', dayOfWeek: 1, locationId: 'A', teacherId: 't1' },
  { dateStr: '2026-10-13', dayOfWeek: 2, locationId: 'B', teacherId: 't2' },
  { dateStr: '2026-10-14', dayOfWeek: 3, locationId: 'C', teacherId: 't3' },
];

describe('staircase', () => {
  it('bir sonraki gün ve yeri hedefler, sonda başa döner', () => {
    expect(staircaseTarget({ dayOfWeek: 1, locationId: 'A' }, days, ring)).toEqual({ dayIdx: 1, locIdx: 1 });
    expect(staircaseTarget({ dayOfWeek: 3, locationId: 'C' }, days, ring)).toEqual({ dayIdx: 0, locIdx: 0 });
    expect(staircaseTarget(undefined, days, ring)).toBeNull();
  });

  it('haftanın nöbetçilerini merdiven sırasına dizer', () => {
    // Geçen hafta t1 Pzt-A, t2 Sal-B, t3 Çar-C'deydi; bu hafta her biri bir adım kaymalı.
    const targets = {
      t1: staircaseTarget({ dayOfWeek: 1, locationId: 'A' }, days, ring),
      t2: staircaseTarget({ dayOfWeek: 2, locationId: 'B' }, days, ring),
      t3: staircaseTarget({ dayOfWeek: 3, locationId: 'C' }, days, ring),
    };
    const arranged = arrangeStaircaseWeek(week, baseOpts({ targets }));
    expect(arranged.map(s => s.teacherId)).toEqual(['t3', 't1', 't2']);
  });

  it('öğretmenin tutamadığı güne kaydırmaz', () => {
    const targets = {
      t1: staircaseTarget({ dayOfWeek: 1, locationId: 'A' }, days, ring),
      t2: staircaseTarget({ dayOfWeek: 2, locationId: 'B' }, days, ring),
      t3: staircaseTarget({ dayOfWeek: 3, locationId: 'C' }, days, ring),
    };
    const arranged = arrangeStaircaseWeek(week, baseOpts({
      targets,
      dayOk: (id, slot) => !(id === 't1' && slot.dayOfWeek === 2),
    }));
    expect(arranged.find(s => s.teacherId === 't1')?.dayOfWeek).not.toBe(2);
  });

  it('ikinci nöbeti işaretli yerin dışına kaydırmaz', () => {
    const slots: StaircaseSlot[] = [
      { dateStr: '2026-10-12', dayOfWeek: 1, locationId: 'A', teacherId: 't1' },
      { dateStr: '2026-10-14', dayOfWeek: 3, locationId: 'B', teacherId: 't1' },
      { dateStr: '2026-10-14', dayOfWeek: 3, locationId: 'C', teacherId: 't2' },
    ];
    const arranged = arrangeStaircaseWeek(slots, baseOpts({
      targets: { t1: { dayIdx: 2, locIdx: 2 } },
      preferredDayOf: id => (id === 't1' ? 1 : undefined),
      extraDutyPlaceIds: ['B'],
    }));
    expect(arranged.find(s => s.teacherId === 't1' && s.dayOfWeek === 3)?.locationId).toBe('B');
  });

  it('sabit nöbet gününü merdivene tercih eder', () => {
    const targets = { t1: staircaseTarget({ dayOfWeek: 1, locationId: 'A' }, days, ring) };
    const arranged = arrangeStaircaseWeek(week, baseOpts({
      targets,
      preferredDayOf: id => (id === 't1' ? 1 : undefined),
    }));
    expect(arranged.find(s => s.teacherId === 't1')?.dayOfWeek).toBe(1);
  });
});
