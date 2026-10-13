import { describe, it, expect } from 'vitest';
import { assignVicePrincipalsToDates, countVpDutiesByPrincipal } from './vicePrincipalDuty';
import type { VicePrincipal } from '../types';

const vps: VicePrincipal[] = [
  { id: 'vp1', name: 'Ayşe A' },
  { id: 'vp2', name: 'Mehmet B' },
  { id: 'vp3', name: 'Zeynep C' },
];

describe('vicePrincipalDuty', () => {
  it('assigns same VP to every day when only one exists', () => {
    const dates = ['2026-03-02', '2026-03-03', '2026-03-04'];
    const map = assignVicePrincipalsToDates(dates, [{ id: 'vp1', name: 'Tek VP' }]);
    expect(Object.values(map).every(v => v.id === 'vp1')).toBe(true);
    expect(Object.keys(map)).toHaveLength(3);
  });

  it('distributes multiple VPs evenly across the year', () => {
    const dates = Array.from({ length: 10 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
    const map = assignVicePrincipalsToDates(dates, vps);
    const counts = countVpDutiesByPrincipal(map);
    expect(counts).toHaveLength(3);
    for (const { count } of counts) {
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(4);
    }
  });

  it('rotates without skipping days', () => {
    const dates = ['2026-03-01', '2026-03-02', '2026-03-03'];
    const map = assignVicePrincipalsToDates(dates, vps.slice(0, 2));
    expect(map['2026-03-01'].id).not.toBe(map['2026-03-02'].id);
    expect(map['2026-03-02'].id).not.toBe(map['2026-03-03'].id);
  });
});
