import { useEffect, useMemo, useState } from 'react';
import { format, getDay, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ArrowLeftRight, Copy, Printer, UserRound } from 'lucide-react';
import PrintPreview from './PrintPreview';
import { formatSwapDuty } from './SwapRequestsPanel';
import { Assignment, Holiday, Location, SwapRequest, Teacher, canTeacherDutyOnDay } from '../types';
import { formatDutyWhatsAppText, DutyShareLine } from '../lib/dutyShareText';
import { readMyTeacherId, writeMyTeacherId } from '../lib/myTeacher';

interface Props {
  teachers: Teacher[];
  assignments: Assignment[];
  locations: Location[];
  holidays: Holiday[];
  schoolName?: string;
  kurumKodu: string;
  isAdmin: boolean;
  dutyHours?: string;
  swapRequests?: SwapRequest[];
  setSwapRequests?: (next: SwapRequest[] | ((prev: SwapRequest[]) => SwapRequest[])) => Promise<boolean> | unknown;
}

const SWAP_STATUS_LABELS: Record<SwapRequest['status'], { text: string; className: string }> = {
  pending: { text: 'Yönetici onayı bekliyor', className: 'text-amber-700' },
  approved: { text: 'Onaylandı', className: 'text-emerald-700' },
  rejected: { text: 'Reddedildi', className: 'text-red-700' },
  cancelled: { text: 'Geri çekildi', className: 'text-slate-500' },
};

interface SwapDraft {
  assignmentId: string;
  targetTeacherId: string;
  targetAssignmentId: string;
  note: string;
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export default function MyDutyList({
  teachers,
  assignments,
  locations,
  holidays,
  schoolName,
  kurumKodu,
  isAdmin,
  dutyHours = '',
  swapRequests = [],
  setSwapRequests,
}: Props) {
  const [teacherId, setTeacherId] = useState(() => readMyTeacherId(kurumKodu));
  const [copied, setCopied] = useState(false);
  const [printHtml, setPrintHtml] = useState<string | null>(null);

  useEffect(() => {
    setTeacherId(readMyTeacherId(kurumKodu));
  }, [kurumKodu]);

  const chooseTeacher = (id: string) => {
    setTeacherId(id);
    writeMyTeacherId(kurumKodu, id);
  };

  const sortedTeachers = useMemo(
    () => [...teachers].sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    [teachers],
  );
  const teacher = sortedTeachers.find((t) => t.id === teacherId) || null;
  const holidayDates = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t.name])), [teachers]);

  const rows = useMemo(() => {
    if (!teacher) return [];
    return assignments
      .filter((a) => a.teacherId === teacher.id && !holidayDates.has(a.date))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [assignments, teacher, holidayDates]);

  const lines: DutyShareLine[] = rows.map((row) => {
    const place = locations.find((l) => l.id === row.locationId)?.name || 'Nöbet yeri';
    const notes: string[] = [];
    if (row.isDoubleDuty) notes.push('çift nöbet');
    if (row.originalTeacherId) {
      notes.push(`${teacherById.get(row.originalTeacherId) || 'başka öğretmen'} yerine`);
    }
    return {
      when: format(parseISO(row.date), 'd MMMM yyyy EEEE', { locale: tr }),
      time: dutyHours || undefined,
      place,
      note: notes.join(', ') || undefined,
    };
  });

  const shareText = teacher ? formatDutyWhatsAppText(teacher.name, lines) : '';

  const [draft, setDraft] = useState<SwapDraft | null>(null);
  const [swapMessage, setSwapMessage] = useState<string | null>(null);
  const canRequestSwap = !isAdmin && !!setSwapRequests && !!teacher;
  const today = format(new Date(), 'yyyy-MM-dd');
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name || 'Nöbet yeri';
  const pendingByAssignment = useMemo(() => {
    const map = new Map<string, SwapRequest>();
    for (const r of swapRequests) {
      if (r.status === 'pending' && r.requesterId === teacherId) map.set(r.assignmentId, r);
    }
    return map;
  }, [swapRequests, teacherId]);
  const myRequests = useMemo(
    () => swapRequests
      .filter((r) => r.requesterId === teacherId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8),
    [swapRequests, teacherId],
  );
  const incoming = useMemo(
    () => swapRequests.filter((r) => r.status === 'pending' && r.targetTeacherId === teacherId),
    [swapRequests, teacherId],
  );

  const draftAssignment = draft ? rows.find((r) => r.id === draft.assignmentId) : undefined;
  const swapCandidates = useMemo(() => {
    if (!draftAssignment || !teacher) return [];
    const dow = getDay(parseISO(draftAssignment.date));
    const busy = new Set(assignments.filter((a) => a.date === draftAssignment.date).map((a) => a.teacherId));
    return sortedTeachers.filter((t) => t.id !== teacher.id && !busy.has(t.id) && canTeacherDutyOnDay(t, dow));
  }, [draftAssignment, teacher, assignments, sortedTeachers]);
  const targetDuties = useMemo(() => {
    if (!draft?.targetTeacherId) return [];
    return assignments
      .filter((a) => a.teacherId === draft.targetTeacherId && a.date >= today && !holidayDates.has(a.date))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [draft?.targetTeacherId, assignments, today, holidayDates]);

  const submitSwap = async () => {
    if (!draft || !draftAssignment || !teacher || !setSwapRequests || !draft.targetTeacherId) return;
    const other = targetDuties.find((a) => a.id === draft.targetAssignmentId);
    const request: SwapRequest = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      requesterId: teacher.id,
      assignmentId: draftAssignment.id,
      date: draftAssignment.date,
      locationId: draftAssignment.locationId,
      targetTeacherId: draft.targetTeacherId,
      ...(other ? { targetAssignmentId: other.id, targetDate: other.date, targetLocationId: other.locationId } : {}),
      ...(draft.note.trim() ? { note: draft.note.trim().slice(0, 300) } : {}),
      status: 'pending',
    };
    const ok = await setSwapRequests((prev) => [...prev, request]);
    setDraft(null);
    setSwapMessage(ok === false ? 'İstek gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin.' : 'İsteğiniz yöneticiye iletildi.');
    window.setTimeout(() => setSwapMessage(null), 4000);
  };

  const cancelSwap = (id: string) => {
    if (!setSwapRequests) return;
    setSwapRequests((prev) => prev.map((r) => (
      r.id === id ? { ...r, status: 'cancelled' as const, decidedAt: new Date().toISOString() } : r
    )));
  };

  const onCopy = async () => {
    if (!shareText) return;
    const ok = await copyText(shareText);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const openPrint = () => {
    if (!teacher) return;
    const body = lines.map((line) => `
      <tr>
        <td>${esc(line.when)}</td>
        <td>${esc(line.time || '')}</td>
        <td>${esc(line.place)}</td>
        <td>${esc(line.note || '')}</td>
      </tr>`).join('') || '<tr><td colspan="4">Kayıtlı nöbet yok.</td></tr>';
    setPrintHtml(`
      <style>
        .my-duties { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; }
        .my-duties h1 { font-size: 18px; margin: 0 0 8px; }
        .my-duties table { width: 100%; border-collapse: collapse; }
        .my-duties th, .my-duties td { border: 1px solid #334155; padding: 6px 8px; text-align: left; font-size: 13px; }
        .my-duties th { background: #e2e8f0; }
      </style>
      <div class="my-duties">
        ${schoolName ? `<div>${esc(schoolName)}</div>` : ''}
        <h1>${esc(teacher.name)} nöbet listesi</h1>
        <table>
          <thead><tr><th>Gün</th><th>Saat</th><th>Yer</th><th>Not</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `);
  };

  return (
    <div className="app-card print:hidden">
      <div className="app-card-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-[#1a4a8a] text-sm flex items-center gap-1.5">
            <UserRound className="w-4 h-4 text-indigo-600" />
            {isAdmin ? 'Öğretmen nöbet listesi' : 'Nöbetlerim'}
          </h3>
          <p className="text-xs text-blue-500 mt-0.5">
            {isAdmin
              ? 'Seçilen öğretmenin günlerini yazdırın veya WhatsApp’a yapıştırın.'
              : 'Adınızı seçin. Yalnızca sizin nöbet günleriniz görünür.'}
          </p>
        </div>
        <select
          value={teacherId}
          onChange={(e) => chooseTeacher(e.target.value)}
          className="app-year-select max-w-xs"
        >
          <option value="">{isAdmin ? 'Öğretmen seçin' : 'Adınızı seçin'}</option>
          {sortedTeachers.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>
      <div className="p-4">
        {!teacher ? (
          <p className="text-sm text-slate-500">Liste için bir öğretmen seçin. Seçim bu bilgisayarda hatırlanır.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              <button type="button" className="app-btn app-btn-blue" onClick={openPrint}>
                <Printer className="w-4 h-4" /> Yazdır
              </button>
              <button type="button" className="app-btn app-btn-green-outline" onClick={onCopy}>
                <Copy className="w-4 h-4" /> {copied ? 'Kopyalandı' : 'WhatsApp metni'}
              </button>
            </div>
            {swapMessage && <p className="text-sm text-indigo-700 mb-2">{swapMessage}</p>}
            {canRequestSwap && incoming.length > 0 && (
              <div className="mb-3 p-3 bg-sky-50 border border-sky-200 rounded-lg text-sm text-sky-900 space-y-1">
                {incoming.map((r) => (
                  <div key={r.id}>
                    <span className="font-semibold">{teacherById.get(r.requesterId) || 'Bir öğretmen'}</span>,{' '}
                    {formatSwapDuty(r.date, locationName(r.locationId))} nöbetini size
                    {r.targetDate && r.targetLocationId
                      ? <> sizin {formatSwapDuty(r.targetDate, locationName(r.targetLocationId))} nöbetinizle değiştirmek</>
                      : ' devretmek'} istiyor (yönetici onayı bekleniyor).
                  </div>
                ))}
              </div>
            )}
            {rows.length === 0 ? (
              <p className="text-sm text-slate-400">Bu öğretmenin kayıtlı nöbeti yok.</p>
            ) : (
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {lines.map((line, i) => {
                  const row = rows[i];
                  const pendingRequest = pendingByAssignment.get(row.id);
                  const isDrafting = draft?.assignmentId === row.id;
                  return (
                    <li key={row.id} className="px-3 py-2 text-sm">
                      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                        <span className="text-slate-800">{line.when}</span>
                        <span className="text-slate-600 text-right flex-1">{line.time ? `${line.time} · ` : ''}{line.place}{line.note ? ` · ${line.note}` : ''}</span>
                        {canRequestSwap && row.date >= today && (
                          pendingRequest ? (
                            <span className="text-xs text-amber-700 flex items-center gap-2">
                              Takas isteği bekliyor
                              <button type="button" className="underline" onClick={() => cancelSwap(pendingRequest.id)}>Geri çek</button>
                            </span>
                          ) : !isDrafting && (
                            <button
                              type="button"
                              className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                              onClick={() => setDraft({ assignmentId: row.id, targetTeacherId: '', targetAssignmentId: '', note: '' })}
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" /> Değiştir
                            </button>
                          )
                        )}
                      </div>
                      {isDrafting && draft && (
                        <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                          <label className="block text-xs text-slate-600">
                            Nöbeti kim alsın?
                            <select
                              value={draft.targetTeacherId}
                              onChange={(e) => setDraft({ ...draft, targetTeacherId: e.target.value, targetAssignmentId: '' })}
                              className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                            >
                              <option value="">Öğretmen seçin (o gün boşta ve nöbet tutabilenler)</option>
                              {swapCandidates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </label>
                          {draft.targetTeacherId && (
                            <label className="block text-xs text-slate-600">
                              Karşılığında onun bir nöbetini alır mısınız?
                              <select
                                value={draft.targetAssignmentId}
                                onChange={(e) => setDraft({ ...draft, targetAssignmentId: e.target.value })}
                                className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                              >
                                <option value="">Hayır, nöbetimi devrediyorum</option>
                                {targetDuties.map((a) => (
                                  <option key={a.id} value={a.id}>{formatSwapDuty(a.date, locationName(a.locationId))}</option>
                                ))}
                              </select>
                            </label>
                          )}
                          <input
                            type="text"
                            value={draft.note}
                            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                            maxLength={300}
                            placeholder="Not (isteğe bağlı): ör. o gün sağlık raporum var"
                            className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="app-btn app-btn-blue"
                              disabled={!draft.targetTeacherId}
                              onClick={() => void submitSwap()}
                            >
                              İsteği gönder
                            </button>
                            <button type="button" className="app-btn" onClick={() => setDraft(null)}>Vazgeç</button>
                          </div>
                          <p className="text-xs text-slate-500">İstek yönetici onaylayınca çizelgeye işlenir.</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {canRequestSwap && myRequests.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-slate-600 mb-1.5">Takas isteklerim</h4>
                <ul className="space-y-1 text-xs">
                  {myRequests.map((r) => (
                    <li key={r.id} className="flex flex-wrap gap-x-2">
                      <span className="text-slate-700">
                        {formatSwapDuty(r.date, locationName(r.locationId))} → {teacherById.get(r.targetTeacherId) || 'öğretmen'}
                        {r.targetDate && r.targetLocationId ? ` (karşılığında ${formatSwapDuty(r.targetDate, locationName(r.targetLocationId))})` : ''}
                      </span>
                      <span className={SWAP_STATUS_LABELS[r.status].className}>{SWAP_STATUS_LABELS[r.status].text}</span>
                      {r.decisionNote && <span className="text-slate-500 italic">"{r.decisionNote}"</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
      {printHtml && (
        <PrintPreview
          title={teacher ? `${teacher.name} nöbet listesi` : 'Nöbet listesi'}
          html={printHtml}
          page="portrait"
          onClose={() => setPrintHtml(null)}
        />
      )}
    </div>
  );
}
