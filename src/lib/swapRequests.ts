import type { Assignment, SwapRequest } from '../types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = 300;

const str = (v: unknown, max = 100): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/**
 * Öğretmen hesabından gelen yeni isteği temizler. Öğretmen yalnızca "bekliyor" durumunda
 * istek açabilir; karar alanlarını kendisi dolduramaz.
 */
export function sanitizeTeacherSwapCreate(body: unknown, now: string): SwapRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const id = str(b.id);
  const requesterId = str(b.requesterId);
  const assignmentId = str(b.assignmentId);
  const date = str(b.date, 10);
  const locationId = str(b.locationId);
  const targetTeacherId = str(b.targetTeacherId);
  if (!id || !requesterId || !assignmentId || !date || !DATE_RE.test(date) || !locationId || !targetTeacherId) return null;
  if (requesterId === targetTeacherId) return null;

  const request: SwapRequest = {
    id, createdAt: now, requesterId, assignmentId, date, locationId, targetTeacherId, status: 'pending',
  };
  const targetAssignmentId = str(b.targetAssignmentId);
  const targetDate = str(b.targetDate, 10);
  const targetLocationId = str(b.targetLocationId);
  if (targetAssignmentId) {
    if (!targetDate || !DATE_RE.test(targetDate) || !targetLocationId) return null;
    Object.assign(request, { targetAssignmentId, targetDate, targetLocationId });
  }
  const note = str(b.note, MAX_NOTE);
  if (note) request.note = note;
  return request;
}

/** Öğretmen hesabı yalnızca bekleyen bir isteği geri çekebilir. */
export function teacherCancelSwap(current: unknown, now: string): SwapRequest | null {
  if (!current || typeof current !== 'object') return null;
  const c = current as SwapRequest;
  if (c.status !== 'pending') return null;
  return { ...c, status: 'cancelled', decidedAt: now };
}

export interface SwapCheck {
  /** Onaylanmasını engelleyen durumlar (çizelge istekten sonra değişmiş). */
  blockers: string[];
  /** Onaylanabilir ama yöneticinin bilmesi gereken durumlar. */
  warnings: string[];
}

export function checkSwapRequest(
  request: SwapRequest,
  assignments: Assignment[],
  teacherName: (id: string) => string,
): SwapCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const main = assignments.find(a => a.id === request.assignmentId);
  if (!main) {
    blockers.push('Bu nöbet artık çizelgede yok.');
  } else if (main.teacherId !== request.requesterId) {
    blockers.push(`Bu nöbet artık ${teacherName(request.requesterId)} üzerinde değil.`);
  }

  let other: Assignment | undefined;
  if (request.targetAssignmentId) {
    other = assignments.find(a => a.id === request.targetAssignmentId);
    if (!other) blockers.push('Karşılığında verilecek nöbet artık çizelgede yok.');
    else if (other.teacherId !== request.targetTeacherId) {
      blockers.push(`Karşılığında verilecek nöbet artık ${teacherName(request.targetTeacherId)} üzerinde değil.`);
    }
  }

  const busy = (teacherId: string, date: string, except: string[]) =>
    assignments.some(a => a.teacherId === teacherId && a.date === date && !except.includes(a.id));
  const except = [request.assignmentId, request.targetAssignmentId ?? ''];
  if (busy(request.targetTeacherId, request.date, except)) {
    warnings.push(`${teacherName(request.targetTeacherId)} o gün zaten başka bir yerde nöbetçi.`);
  }
  if (request.targetDate && busy(request.requesterId, request.targetDate, except)) {
    warnings.push(`${teacherName(request.requesterId)} karşılık gelen gün zaten başka bir yerde nöbetçi.`);
  }
  return { blockers, warnings };
}

/** Onaylanan isteği çizelgeye uygular; çizelge istekten sonra değiştiyse null döner. */
export function applySwapRequest(assignments: Assignment[], request: SwapRequest): Assignment[] | null {
  if (checkSwapRequest(request, assignments, id => id).blockers.length > 0) return null;
  return assignments.map(a => {
    if (a.id === request.assignmentId) {
      return {
        ...a,
        teacherId: request.targetTeacherId,
        originalTeacherId: request.requesterId,
        swapPairId: request.targetAssignmentId,
      };
    }
    if (request.targetAssignmentId && a.id === request.targetAssignmentId) {
      return {
        ...a,
        teacherId: request.requesterId,
        originalTeacherId: request.targetTeacherId,
        swapPairId: request.assignmentId,
      };
    }
    return a;
  });
}
