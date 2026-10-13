import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Copy, Printer, UserRound } from 'lucide-react';
import PrintPreview from './PrintPreview';
import { Assignment, Holiday, Location, Teacher } from '../types';
import { formatDutyWhatsAppText, DutyShareLine } from '../lib/dutyShareText';

interface Props {
  teachers: Teacher[];
  assignments: Assignment[];
  locations: Location[];
  holidays: Holiday[];
  schoolName?: string;
  kurumKodu: string;
  isAdmin: boolean;
  dutyHours?: string;
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
}: Props) {
  const storageKey = `nobet-my-teacher:${kurumKodu || 'okul'}`;
  const [teacherId, setTeacherId] = useState(() => {
    try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
  });
  const [copied, setCopied] = useState(false);
  const [printHtml, setPrintHtml] = useState<string | null>(null);

  useEffect(() => {
    try { setTeacherId(localStorage.getItem(storageKey) || ''); } catch { setTeacherId(''); }
  }, [storageKey]);

  const chooseTeacher = (id: string) => {
    setTeacherId(id);
    try {
      if (id) localStorage.setItem(storageKey, id);
      else localStorage.removeItem(storageKey);
    } catch { /* depolama kapalı olabilir */ }
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
            {rows.length === 0 ? (
              <p className="text-sm text-slate-400">Bu öğretmenin kayıtlı nöbeti yok.</p>
            ) : (
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {lines.map((line, i) => (
                  <li key={`${line.when}-${line.place}-${i}`} className="px-3 py-2 text-sm flex justify-between gap-3">
                    <span className="text-slate-800">{line.when}</span>
                    <span className="text-slate-600 text-right">{line.time ? `${line.time} · ` : ''}{line.place}{line.note ? ` · ${line.note}` : ''}</span>
                  </li>
                ))}
              </ul>
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
