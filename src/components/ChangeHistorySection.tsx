import { useCallback, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import { History, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Location, Teacher } from '../types';
import { getAuthHeaders } from '../lib/apiHeaders';
import {
  AuditEntry, AuditNames, describeAuditEntry, groupAuditEntries, ROLE_LABELS, COLLECTION_LABELS, ACTION_LABELS, collectionBase,
} from '../lib/auditLog';

const PAGE_SIZE = 300;

interface Props {
  teachers: Teacher[];
  locations: Location[];
}

export default function ChangeHistorySection({ teachers, locations }: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (before?: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) params.set('before', String(before));
      const res = await fetch(`/api/audit?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      const rows = (await res.json()) as AuditEntry[];
      setEntries(prev => (before ? [...prev, ...rows] : rows));
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Değişiklik geçmişi okunamadı.');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && entries.length === 0) void load();
  };

  const names: AuditNames = useMemo(() => {
    const teacherById = new Map(teachers.map(t => [t.id, t.name]));
    const locationById = new Map(locations.map(l => [l.id, l.name]));
    return {
      teacher: id => teacherById.get(id) ?? 'silinmiş öğretmen',
      location: id => locationById.get(id) ?? 'silinmiş yer',
      date: d => {
        try { return format(parseISO(d), 'd MMM yyyy EEE', { locale: tr }); } catch { return d; }
      },
    };
  }, [teachers, locations]);

  const groups = useMemo(() => groupAuditEntries(entries), [entries]);

  const who = (e: AuditEntry) => {
    const role = ROLE_LABELS[e.role] ?? e.role;
    const where = e.client || e.ip;
    return where ? `${role} · ${where}` : role;
  };

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={`w-full px-6 py-4 bg-slate-50/50 hover:bg-slate-100/60 transition-colors flex items-center gap-3 text-left ${open ? 'border-b border-slate-200' : ''}`}
      >
        <div className="bg-slate-100 p-2 rounded-lg text-slate-600">
          <History className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-slate-800">Değişiklik Geçmişi</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Öğretmen, nöbet yeri, çizelge ve ayarlarda kim, ne zaman, neyi değiştirdi (son 400 gün)
          </p>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
      </button>

      {open && (
        <div className="p-4 space-y-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="text-sm text-slate-600 hover:text-slate-800 flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Yenile
            </button>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && !loading && groups.length === 0 && (
            <p className="text-sm text-slate-500">Henüz kayıtlı değişiklik yok. Bu sürümden sonra yapılan değişiklikler burada listelenir.</p>
          )}

          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {groups.map(group => {
              const e = group.first;
              const many = group.entries.length > 1;
              const isOpen = expanded === group.key;
              const base = collectionBase(e.collection);
              return (
                <li key={group.key} className="px-3 py-2 text-sm">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
                    <span className="text-slate-500 shrink-0 tabular-nums sm:w-32">
                      {format(parseISO(e.at), 'd MMM HH:mm', { locale: tr })}
                    </span>
                    <span className="flex-1 text-slate-800">
                      {many ? (
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : group.key)}
                          className="text-left hover:underline"
                        >
                          {COLLECTION_LABELS[base] ?? base}: {group.entries.length} kayıt {ACTION_LABELS[e.action]}
                          <span className="text-slate-400"> ({isOpen ? 'gizle' : 'ayrıntı'})</span>
                        </button>
                      ) : describeAuditEntry(e, names)}
                    </span>
                    <span className="text-xs text-slate-500 shrink-0 sm:text-right sm:w-48 truncate" title={who(e)}>
                      {who(e)}
                    </span>
                  </div>
                  {many && isOpen && (
                    <ul className="mt-2 ml-0 sm:ml-32 space-y-1 text-xs text-slate-600 max-h-64 overflow-y-auto">
                      {group.entries.map(item => (
                        <li key={item.id}>{describeAuditEntry(item, names)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void load(entries[entries.length - 1]?.id)}
                disabled={loading}
                className="text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
              >
                Daha eski kayıtlar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
