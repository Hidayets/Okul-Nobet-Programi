import { describe, it, expect } from 'vitest';
import {
  auditSnapshot, changedTopLevelKeys, collectionBase, sanitizeClientName,
  describeAuditEntry, groupAuditEntries, AuditEntry,
} from './auditLog';

const names = {
  teacher: (id: string) => ({ t1: 'Ali Veli', t2: 'Ayşe Kaya' }[id] ?? '?'),
  location: (id: string) => ({ l1: 'Bahçe' }[id] ?? '?'),
  date: (d: string) => d,
};

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 1, at: '2026-10-13T10:00:00.000Z', role: 'admin', client: 'PC-1', ip: null,
  collection: 'assignments__2026-2027', docId: 'a1', action: 'update',
  before: null, after: null, changedKeys: [], ...over,
});

describe('auditLog', () => {
  it('özette yalnızca tanıtıcı alanları tutar', () => {
    expect(auditSnapshot({ id: 'x', name: 'Ali', schedule: { 1: { 1: '6-E' } }, teacherId: 't1' }))
      .toEqual({ name: 'Ali', teacherId: 't1' });
    expect(auditSnapshot(null)).toBeNull();
  });

  it('değişen üst düzey alanları bulur', () => {
    expect(changedTopLevelKeys({ id: '1', a: 1, b: [1] }, { id: '1', a: 1, b: [2], c: true })).toEqual(['b', 'c']);
  });

  it('koleksiyon adından yılı ayırır, cihaz adını temizler', () => {
    expect(collectionBase('teachers__2026-2027')).toBe('teachers');
    expect(sanitizeClientName(encodeURIComponent('MÜDÜR-PC'))).toBe('MÜDÜR-PC');
    expect(sanitizeClientName('a\u0000b')).toBe('ab');
    expect(sanitizeClientName('')).toBeNull();
  });

  it('nöbet değişikliğini okunur yazar', () => {
    const text = describeAuditEntry(entry({
      before: { date: '2026-10-14', locationId: 'l1', teacherId: 't1' },
      after: { date: '2026-10-14', locationId: 'l1', teacherId: 't2' },
      changedKeys: ['teacherId'],
    }), names);
    expect(text).toBe('Nöbet değiştirildi — 2026-10-14, Bahçe, Ali Veli → Ayşe Kaya');
  });

  it('öğretmen kaydında değişen alanları adlandırır', () => {
    const text = describeAuditEntry(entry({
      collection: 'teachers__2026-2027',
      after: { name: 'Ali Veli' },
      changedKeys: ['dutyType', 'schedule'],
    }), names);
    expect(text).toBe('Öğretmen değiştirildi — Ali Veli, değişen: nöbet türü, ders programı');
  });

  it('kısa sürede yapılan aynı tür değişiklikleri gruplar', () => {
    const groups = groupAuditEntries([
      entry({ id: 3, action: 'create', at: '2026-10-13T10:01:00.000Z' }),
      entry({ id: 2, action: 'create', at: '2026-10-13T10:00:30.000Z' }),
      entry({ id: 1, action: 'delete', at: '2026-10-13T10:00:00.000Z' }),
    ]);
    expect(groups.map(g => g.entries.length)).toEqual([2, 1]);
  });
});
