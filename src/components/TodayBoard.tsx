import { useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import { CalendarClock, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import PrintPreview from './PrintPreview';
import { Absence, Assignment, Location, Substitution, Teacher } from '../types';
import { buildDayBoard } from '../lib/dayBoard';

interface Props {
  schoolName?: string;
  locations: Location[];
  teachers: Teacher[];
  assignments: Assignment[];
  absences: Absence[];
  substitutions: Substitution[];
  vicePrincipalName?: (date: string) => string | undefined;
  dutyHours?: string;
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function TodayBoard({
  schoolName,
  locations,
  teachers,
  assignments,
  absences,
  substitutions,
  vicePrincipalName,
  dutyHours = '',
}: Props) {
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const today = format(new Date(), 'yyyy-MM-dd');

  const board = useMemo(
    () => buildDayBoard({ date, locations, teachers, assignments, absences, substitutions }),
    [date, locations, teachers, assignments, absences, substitutions],
  );
  const vp = vicePrincipalName?.(date);
  const parsed = parseISO(date);
  const heading = format(parsed, 'd MMMM yyyy EEEE', { locale: tr });

  const openPrint = () => {
    const dutyRows = board.duties.map((row) => `
      <tr>
        <td>${esc(row.locationName)}</td>
        <td>${esc(row.teacherName)}</td>
        <td>${esc(row.status)}</td>
      </tr>`).join('') || '<tr><td colspan="3">Bu gün nöbet ataması yok.</td></tr>';
    const absenceRows = board.absences.map((row) => `<li>${esc(row.teacherName)} — ${esc(row.detail)}</li>`).join('');
    const coverRows = board.covers.map((row) => `<li>${esc(row)}</li>`).join('');
    setPrintHtml(`
      <style>
        .day-board { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; }
        .day-board h1 { font-size: 18px; margin: 0 0 4px; }
        .day-board h2 { font-size: 14px; margin: 16px 0 6px; }
        .day-board table { width: 100%; border-collapse: collapse; }
        .day-board th, .day-board td { border: 1px solid #334155; padding: 6px 8px; text-align: left; font-size: 13px; }
        .day-board th { background: #e2e8f0; }
        .day-board ul { margin: 0; padding-left: 18px; }
      </style>
      <div class="day-board">
        ${schoolName ? `<div>${esc(schoolName)}</div>` : ''}
        <h1>Günün Nöbet Panosu</h1>
        <div>${esc(heading)}${dutyHours ? ` · Nöbet saati ${esc(dutyHours)}` : ''}</div>
        <h2>Nöbet yerleri</h2>
        <table>
          <thead><tr><th>Yer</th><th>Öğretmen</th><th>Durum</th></tr></thead>
          <tbody>${dutyRows}</tbody>
        </table>
        ${vp ? `<p><strong>Nöbetçi müdür yardımcısı:</strong> ${esc(vp)}</p>` : ''}
        <h2>Devamsızlar</h2>
        ${absenceRows ? `<ul>${absenceRows}</ul>` : '<p>Devamsız yok.</p>'}
        <h2>Derse girenler</h2>
        ${coverRows ? `<ul>${coverRows}</ul>` : '<p>Görevlendirme yok.</p>'}
      </div>
    `);
  };

  return (
    <div className="app-card print:hidden border-l-4 border-l-indigo-500">
      <div className="app-card-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-[#1a4a8a] text-sm flex items-center gap-1.5">
            <CalendarClock className="w-4 h-4 text-indigo-600" />
            Günün panosu
          </h3>
          <p className="text-xs text-blue-500 mt-0.5 capitalize">
            {date === today ? 'Bugün — ' : ''}{heading}{dutyHours ? ` · Nöbet saati ${dutyHours}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="app-icon-btn" onClick={() => setDate(format(addDays(parsed, -1), 'yyyy-MM-dd'))} title="Önceki gün">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="app-year-select"
          />
          <button type="button" className="app-icon-btn" onClick={() => setDate(format(addDays(parsed, 1), 'yyyy-MM-dd'))} title="Sonraki gün">
            <ChevronRight className="w-4 h-4" />
          </button>
          {date !== today && (
            <button type="button" className="app-btn app-btn-blue" onClick={() => setDate(today)}>Bugün</button>
          )}
          <button type="button" className="app-btn app-btn-blue" onClick={openPrint}>
            <Printer className="w-4 h-4" /> Yazdır
          </button>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">Yer</th>
                <th className="py-2 pr-3">Öğretmen</th>
                <th className="py-2">Durum</th>
              </tr>
            </thead>
            <tbody>
              {board.duties.length === 0 && (
                <tr><td colSpan={3} className="py-3 text-slate-400">Bu gün için nöbet ataması yok.</td></tr>
              )}
              {board.duties.map((row, i) => (
                <tr key={`${row.locationName}-${row.teacherName}-${i}`} className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-medium text-slate-700">{row.locationName}</td>
                  <td className="py-2 pr-3 text-slate-800">{row.teacherName}</td>
                  <td className={`py-2 ${row.status.startsWith('Devamsız') ? 'text-rose-700 font-medium' : 'text-slate-600'}`}>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {vp && (
          <p className="text-sm text-slate-700"><span className="text-blue-500">Nöbetçi müdür yardımcısı:</span> {vp}</p>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Devamsızlar</h4>
            {board.absences.length === 0 ? (
              <p className="text-sm text-slate-400">Devamsız yok.</p>
            ) : (
              <ul className="text-sm text-slate-700 space-y-1">
                {board.absences.map((row) => (
                  <li key={`${row.teacherName}-${row.detail}`}>{row.teacherName} — {row.detail}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Derse girenler</h4>
            {board.covers.length === 0 ? (
              <p className="text-sm text-slate-400">Görevlendirme yok.</p>
            ) : (
              <ul className="text-sm text-slate-700 space-y-1">
                {board.covers.map((row) => <li key={row}>{row}</li>)}
              </ul>
            )}
          </div>
        </div>
      </div>
      {printHtml && (
        <PrintPreview title="Günün panosu" html={printHtml} page="portrait" onClose={() => setPrintHtml(null)} />
      )}
    </div>
  );
}
