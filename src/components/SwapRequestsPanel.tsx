import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ArrowLeftRight, Check, X, AlertTriangle } from 'lucide-react';
import { Assignment, DutyChange, Location, SwapRequest, Teacher } from '../types';
import { applySwapRequest, checkSwapRequest } from '../lib/swapRequests';

interface Props {
  swapRequests: SwapRequest[];
  setSwapRequests: (next: SwapRequest[] | ((prev: SwapRequest[]) => SwapRequest[])) => unknown;
  assignments: Assignment[];
  setAssignments: (next: Assignment[] | ((prev: Assignment[]) => Assignment[])) => unknown;
  setDutyChanges?: (next: DutyChange[] | ((prev: DutyChange[]) => DutyChange[])) => unknown;
  teachers: Teacher[];
  locations: Location[];
  editorLabel: string;
}

export function formatSwapDuty(date: string, locationName: string): string {
  try {
    return `${format(parseISO(date), 'd MMM EEE', { locale: tr })}, ${locationName}`;
  } catch {
    return `${date}, ${locationName}`;
  }
}

export default function SwapRequestsPanel({
  swapRequests, setSwapRequests, assignments, setAssignments, setDutyChanges, teachers, locations, editorLabel,
}: Props) {
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);

  const teacherName = useMemo(() => {
    const byId = new Map(teachers.map(t => [t.id, t.name]));
    return (id: string) => byId.get(id) ?? 'silinmiş öğretmen';
  }, [teachers]);
  const locationName = useMemo(() => {
    const byId = new Map(locations.map(l => [l.id, l.name]));
    return (id: string) => byId.get(id) ?? 'silinmiş yer';
  }, [locations]);

  const pending = useMemo(
    () => swapRequests.filter(r => r.status === 'pending').sort((a, b) => a.date.localeCompare(b.date)),
    [swapRequests],
  );
  if (pending.length === 0) return null;

  const decide = (request: SwapRequest, status: 'approved' | 'rejected', decisionNote?: string) => {
    const decided: SwapRequest = {
      ...request,
      status,
      decidedAt: new Date().toISOString(),
      ...(decisionNote ? { decisionNote } : {}),
    };
    setSwapRequests(prev => prev.map(r => (r.id === request.id ? decided : r)));
  };

  const approve = (request: SwapRequest) => {
    const next = applySwapRequest(assignments, request);
    if (!next) {
      alert('Çizelge bu istekten sonra değişmiş; istek onaylanamaz. Reddedip öğretmenden yeni istek açmasını isteyebilirsiniz.');
      return;
    }
    setAssignments(next);
    if (setDutyChanges) {
      const at = new Date().toISOString();
      const rows: DutyChange[] = [{
        id: crypto.randomUUID(), at, by: editorLabel, assignmentId: request.assignmentId,
        date: request.date, locationId: request.locationId,
        fromTeacherId: request.requesterId, toTeacherId: request.targetTeacherId, reason: 'takas',
      }];
      if (request.targetAssignmentId && request.targetDate && request.targetLocationId) {
        rows.push({
          id: crypto.randomUUID(), at, by: editorLabel, assignmentId: request.targetAssignmentId,
          date: request.targetDate, locationId: request.targetLocationId,
          fromTeacherId: request.targetTeacherId, toTeacherId: request.requesterId, reason: 'takas',
        });
      }
      setDutyChanges(prev => [...prev, ...rows].slice(-200));
    }
    decide(request, 'approved');
  };

  return (
    <div className="app-card print:hidden border-amber-300">
      <div className="app-card-header">
        <h3 className="font-bold text-[#1a4a8a] text-sm flex items-center gap-1.5">
          <ArrowLeftRight className="w-4 h-4 text-amber-600" />
          Bekleyen takas istekleri ({pending.length})
        </h3>
        <p className="text-xs text-blue-500 mt-0.5">Öğretmenlerin nöbet devir/değişim istekleri. Onaylanınca çizelgeye işlenir.</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {pending.map(request => {
          const check = checkSwapRequest(request, assignments, teacherName);
          const isRejecting = rejecting?.id === request.id;
          return (
            <li key={request.id} className="p-4 text-sm space-y-2">
              <div className="text-slate-800">
                <span className="font-semibold">{teacherName(request.requesterId)}</span>
                {' → '}
                <span className="font-semibold">{teacherName(request.targetTeacherId)}</span>
                {': '}
                {formatSwapDuty(request.date, locationName(request.locationId))} nöbeti
                {request.targetAssignmentId && request.targetDate && request.targetLocationId ? (
                  <> karşılığında {formatSwapDuty(request.targetDate, locationName(request.targetLocationId))} nöbetini alacak (karşılıklı takas)</>
                ) : (
                  <> devredilecek</>
                )}
              </div>
              {request.note && <div className="text-slate-600 italic">"{request.note}"</div>}
              {[...check.blockers, ...check.warnings].map(msg => (
                <div
                  key={msg}
                  className={`flex items-start gap-1.5 text-xs ${check.blockers.includes(msg) ? 'text-red-700' : 'text-amber-700'}`}
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {msg}
                </div>
              ))}
              {isRejecting ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    autoFocus
                    value={rejecting.note}
                    onChange={e => setRejecting({ id: request.id, note: e.target.value })}
                    placeholder="Ret gerekçesi (isteğe bağlı)"
                    maxLength={300}
                    className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                  />
                  <button
                    type="button"
                    className="app-btn app-btn-red"
                    onClick={() => { decide(request, 'rejected', rejecting.note.trim() || undefined); setRejecting(null); }}
                  >
                    Reddet
                  </button>
                  <button type="button" className="app-btn" onClick={() => setRejecting(null)}>Vazgeç</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="app-btn app-btn-green-outline"
                    disabled={check.blockers.length > 0}
                    onClick={() => approve(request)}
                  >
                    <Check className="w-4 h-4" /> Onayla
                  </button>
                  <button
                    type="button"
                    className="app-btn"
                    onClick={() => setRejecting({ id: request.id, note: '' })}
                  >
                    <X className="w-4 h-4" /> Reddet
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
