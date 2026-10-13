import { describe, it, expect } from 'vitest';
import { syncHolidaysWithMeb } from './mebCalendar';
import type { Holiday } from '../types';

describe('syncHolidaysWithMeb', () => {
  it('MEB takviminden çıkan günleri yeniden iş günü olarak bildirir', () => {
    const existing: Holiday[] = [
      { id: '1', date: '2026-05-26', name: 'Kurban Bayramı Arife', source: 'meb' },
      { id: '2', date: '2026-05-27', name: 'Kurban Bayramı', source: 'meb' },
      { id: '3', date: '2026-06-01', name: 'Eski MEB günü', source: 'meb' },
      { id: '4', date: '2026-06-01', name: 'Okul etkinliği', source: 'manual' },
    ];
    const fetched: Holiday[] = [{ id: 'x', date: '2026-05-27', name: 'Kurban Bayramı', source: 'meb' }];
    const sync = syncHolidaysWithMeb(existing, fetched);
    expect(sync.removed).toBe(2);
    // 01.06 elle eklenen tatil olarak kaldığı için iş gününe dönmez.
    expect(sync.removedDates).toEqual(['2026-05-26']);
    expect(sync.holidays.map(h => h.date)).toEqual(['2026-05-27', '2026-06-01']);
  });
});
