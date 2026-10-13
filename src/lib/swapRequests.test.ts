import { describe, it, expect } from 'vitest';
import { applySwapRequest, checkSwapRequest, sanitizeTeacherSwapCreate, teacherCancelSwap } from './swapRequests';
import type { Assignment, SwapRequest } from '../types';

const NOW = '2026-10-13T12:00:00.000Z';
const name = (id: string) => ({ t1: 'Ali', t2: 'Ayşe', t3: 'Can' }[id] ?? id);

const assignments: Assignment[] = [
  { id: 'a1', date: '2026-10-14', locationId: 'l1', teacherId: 't1' },
  { id: 'a2', date: '2026-10-21', locationId: 'l2', teacherId: 't2' },
  { id: 'a3', date: '2026-10-14', locationId: 'l2', teacherId: 't3' },
];

const request = (over: Partial<SwapRequest> = {}): SwapRequest => ({
  id: 'r1', createdAt: NOW, requesterId: 't1', assignmentId: 'a1', date: '2026-10-14', locationId: 'l1',
  targetTeacherId: 't2', status: 'pending', ...over,
});

describe('swapRequests', () => {
  it('öğretmenden gelen isteği bekliyor durumunda kaydeder, karar alanlarını atar', () => {
    const clean = sanitizeTeacherSwapCreate(
      { ...request(), status: 'approved', decisionNote: 'x', createdAt: '2000-01-01', note: '  rapor  ' },
      NOW,
    );
    expect(clean).toEqual({ ...request(), note: 'rapor' });
  });

  it('eksik ya da kendine yönelik isteği reddeder', () => {
    expect(sanitizeTeacherSwapCreate({ ...request(), date: 'yarın' }, NOW)).toBeNull();
    expect(sanitizeTeacherSwapCreate({ ...request(), targetTeacherId: 't1' }, NOW)).toBeNull();
    expect(sanitizeTeacherSwapCreate({ ...request(), targetAssignmentId: 'a2' }, NOW)).toBeNull();
  });

  it('öğretmen yalnızca bekleyen isteği geri çekebilir', () => {
    expect(teacherCancelSwap(request(), NOW)).toMatchObject({ status: 'cancelled', decidedAt: NOW });
    expect(teacherCancelSwap(request({ status: 'approved' }), NOW)).toBeNull();
  });

  it('devri uygular', () => {
    const next = applySwapRequest(assignments, request())!;
    expect(next.find(a => a.id === 'a1')).toMatchObject({ teacherId: 't2', originalTeacherId: 't1' });
    expect(next.find(a => a.id === 'a2')?.teacherId).toBe('t2');
  });

  it('karşılıklı takası uygular', () => {
    const next = applySwapRequest(assignments, request({
      targetAssignmentId: 'a2', targetDate: '2026-10-21', targetLocationId: 'l2',
    }))!;
    expect(next.find(a => a.id === 'a1')).toMatchObject({ teacherId: 't2', swapPairId: 'a2' });
    expect(next.find(a => a.id === 'a2')).toMatchObject({ teacherId: 't1', originalTeacherId: 't2', swapPairId: 'a1' });
  });

  it('çizelge istekten sonra değiştiyse onaylatmaz', () => {
    const changed = assignments.map(a => (a.id === 'a1' ? { ...a, teacherId: 't3' } : a));
    expect(checkSwapRequest(request(), changed, name).blockers).toEqual(['Bu nöbet artık Ali üzerinde değil.']);
    expect(applySwapRequest(changed, request())).toBeNull();
  });

  it('devralan o gün zaten nöbetçiyse uyarır', () => {
    const check = checkSwapRequest(request({ targetTeacherId: 't3' }), assignments, name);
    expect(check.blockers).toEqual([]);
    expect(check.warnings).toEqual(['Can o gün zaten başka bir yerde nöbetçi.']);
  });
});
