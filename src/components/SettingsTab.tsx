import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Save, Plus, Trash2, Building2, CheckCircle2, Clock, CalendarDays, Palette, Check, KeyRound, ShieldCheck, Users, Eye, EyeOff, GraduationCap, Mail, CalendarX2, ScanSearch } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import { SchoolInfo, VicePrincipal, SchoolSettings, DEFAULT_SCHOOL_SETTINGS, calculateLessonTimes, getCurrentAcademicYear, formatAcademicYear, Holiday, Teacher, Assignment, Location } from '../types';
import { applyAdminDetection, formatDetectionSummary, PRINCIPAL_WEEKLY_LESSONS, VICE_PRINCIPAL_WEEKLY_LESSONS } from '../lib/adminDetection';
import { useTheme, THEMES } from '../ThemeContext';
import { cn } from '../lib/utils';
import { MEB_CALENDAR_VERSION } from '../lib/mebCalendar';
import { runMebHolidaySync } from '../hooks/useMebCalendarSync';
import { stripAssignmentsOnHolidays } from '../lib/holidaySchedule';
import {
  fillFreedHolidayDates,
  generateDutyAssignmentsForDate,
  shouldFillDutyAfterHolidayRemoval,
} from '../lib/fillDutyDay';
import BackupSection from './BackupSection';
import ChangeHistorySection from './ChangeHistorySection';
import { getAuthHeaders } from '../lib/apiHeaders';
import { getTimeDiffInMinutes, normalizeClock, shiftLessonTimes } from '../lib/lessonTimes';
import { dutyClockRange, formatDutyClock } from '../lib/dutyHours';

interface Props {
  schoolInfo: SchoolInfo;
  setSchoolInfo: React.Dispatch<React.SetStateAction<SchoolInfo>>;
  teachers: Teacher[];
  locations: Location[];
  holidays: Holiday[];
  setHolidays: React.Dispatch<React.SetStateAction<Holiday[]>>;
  assignments?: Assignment[];
  setAssignments?: React.Dispatch<React.SetStateAction<Assignment[]>>;
  activeYear: string;
  isAdmin?: boolean;
}

function LessonClockInput({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  return (
    <input
      key={value}
      type="text"
      inputMode="numeric"
      spellCheck={false}
      maxLength={8}
      defaultValue={value}
      placeholder="08:30"
      title="Saat biçimi 08:30. Kutudan çıkınca bu ders ve sonrakiler kayar."
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      onBlur={(e) => {
        const next = normalizeClock(e.target.value);
        if (!next || next === value) {
          e.currentTarget.value = value;
          return;
        }
        onCommit(next);
      }}
      className="px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 w-full"
    />
  );
}

const DAYS_OF_WEEK = [
  { id: 1, label: 'Pazartesi', short: 'Pzt' },
  { id: 2, label: 'Salı', short: 'Sal' },
  { id: 3, label: 'Çarşamba', short: 'Çar' },
  { id: 4, label: 'Perşembe', short: 'Per' },
  { id: 5, label: 'Cuma', short: 'Cum' },
  { id: 6, label: 'Cumartesi', short: 'Cmt' },
  { id: 0, label: 'Pazar', short: 'Paz' },
];

export default function SettingsTab({ schoolInfo, setSchoolInfo, teachers, locations, holidays, setHolidays, assignments = [], setAssignments, activeYear, isAdmin = false }: Props) {
  const { theme, setTheme } = useTheme();
  const [info, setInfo] = useState<SchoolInfo>(schoolInfo);
  // Form düzenlenmediyse dışarıdan gelen güncel okul bilgisini forma yansıt.
  const syncedInfoRef = useRef(schoolInfo);
  useEffect(() => {
    const lastSynced = syncedInfoRef.current;
    syncedInfoRef.current = schoolInfo;
    setInfo(prev => (prev === lastSynced ? schoolInfo : prev));
  }, [schoolInfo]);

  const applyAcademicYears = (updatedYears: string[]) => {
    setSchoolInfo(prev => ({ ...prev, academicYears: updatedYears }));
    if (info !== syncedInfoRef.current) {
      setInfo(prev => ({ ...prev, academicYears: updatedYears }));
    }
  };

  /** Yalnızca bu formda düzenlenen alanları en güncel okul bilgisinin üzerine yazar. */
  const saveFormFields = (source: SchoolInfo) => {
    syncedInfoRef.current = source;
    setSchoolInfo(prev => ({
      ...prev,
      valilik: source.valilik,
      kaymakamlik: source.kaymakamlik,
      okulAdi: source.okulAdi,
      okulMuduru: source.okulMuduru,
      mudurYardimcilari: source.mudurYardimcilari,
      settings: source.settings,
      gmailEmail: source.gmailEmail,
      gmailAppPassword: source.gmailAppPassword,
    }));
  };
  const [newVpName, setNewVpName] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  const [adminCurrentPw, setAdminCurrentPw] = useState('');
  const [adminNewPw, setAdminNewPw] = useState('');
  const [teacherNewPw, setTeacherNewPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAdminPw, setShowAdminPw] = useState(false);
  const [showTeacherPw, setShowTeacherPw] = useState(false);

  const handleChangePassword = async (targetRole: 'admin' | 'teacher') => {
    const newPassword = targetRole === 'admin' ? adminNewPw : teacherNewPw;
    if (!newPassword || newPassword.length < 6) {
      setPwMessage({ type: 'error', text: 'Yeni şifre en az 6 karakter olmalıdır.' });
      return;
    }
    if (targetRole === 'admin' && !adminCurrentPw) {
      setPwMessage({ type: 'error', text: 'Mevcut admin şifresini girin.' });
      return;
    }

    setPwLoading(true);
    setPwMessage(null);

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          targetRole,
          currentPassword: targetRole === 'admin' ? adminCurrentPw : undefined,
          newPassword,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Kendi şifresini değiştiren yöneticinin oturumu yeni token ile sürer; diğer cihazlardaki oturumlar kapanır.
        if (typeof data.token === 'string') localStorage.setItem('token', data.token);
        setPwMessage({ type: 'success', text: targetRole === 'admin' ? 'Admin şifresi değiştirildi.' : 'Öğretmen şifresi değiştirildi.' });
        setAdminCurrentPw('');
        setAdminNewPw('');
        setTeacherNewPw('');
      } else {
        setPwMessage({ type: 'error', text: data.error || 'Şifre değiştirilemedi.' });
      }
    } catch {
      setPwMessage({ type: 'error', text: 'Bağlantı hatası. Lütfen tekrar deneyin.' });
    } finally {
      setPwLoading(false);
    }
  };

  const [newYearStart, setNewYearStart] = useState('');
  const [copyTeachers, setCopyTeachers] = useState(true);
  const [copyFromYear, setCopyFromYear] = useState('');
  const [addingYear, setAddingYear] = useState(false);

  const isValidYearFormat = (value: string): boolean => {
    const match = value.match(/^(\d{4})-(\d{4})$/);
    if (!match) return false;
    return Number(match[2]) === Number(match[1]) + 1;
  };

  const yearAlreadyExists = (info.academicYears || []).includes(newYearStart);

  useEffect(() => {
    const years = [...(info.academicYears || [])].sort();
    if (years.length > 0 && !years.includes(copyFromYear)) {
      setCopyFromYear(years[years.length - 1]);
    }
  }, [info.academicYears, copyFromYear]);

  const handleAddYear = async () => {
    if (!newYearStart || !isValidYearFormat(newYearStart) || yearAlreadyExists) return;

    setAddingYear(true);
    try {
      if (copyTeachers && copyFromYear && (info.academicYears || []).length > 0) {
        const targetRes = await fetch(`/api/data/teachers__${newYearStart}`, {
          headers: getAuthHeaders()
        });
        const targetTeachers = targetRes.ok ? await targetRes.json() : [];
        const res = await fetch(`/api/data/teachers__${copyFromYear}`, {
          headers: getAuthHeaders()
        });
        if (!res.ok) {
          alert('Öğretmen listesi kopyalanamadı: kaynak dönemin öğretmenleri okunamadı.');
          return;
        }
        if (Array.isArray(targetTeachers) && targetTeachers.length > 0) {
          alert(`${formatAcademicYear(newYearStart)} döneminde zaten öğretmen kaydı olduğu için kopyalama yapılmadı.`);
        } else {
          const teachers = await res.json();
          let failed = 0;
          for (const teacher of teachers) {
            const { schedule, ...teacherInfo } = teacher;
            const postRes = await fetch(`/api/data/teachers__${newYearStart}`, {
              method: 'POST',
              headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ ...teacherInfo, id: uuidv4() })
            });
            if (!postRes.ok) failed++;
          }
          if (failed > 0) {
            alert(`${failed} öğretmen yeni döneme kopyalanamadı.`);
          }
        }
      }

      const updatedYears = [...(info.academicYears || []), newYearStart].sort();
      applyAcademicYears(updatedYears);
    } catch (err) {
      console.error('Error adding year:', err);
      alert('Dönem eklenirken bağlantı hatası oluştu.');
    } finally {
      setAddingYear(false);
    }
  };

  const handleDeleteYear = (year: string) => {
    const years = info.academicYears || [];
    if (years.length <= 1) return;
    if (!confirm(`"${formatAcademicYear(year)}" dönemini listeden kaldırmak istediğinize emin misiniz?`)) return;
    const updatedYears = years.filter(y => y !== year);
    applyAcademicYears(updatedYears);
  };

  const settings: SchoolSettings = info.settings ?? DEFAULT_SCHOOL_SETTINGS;

  const updateSettings = (patch: Partial<SchoolSettings>) => {
    setInfo({ ...info, settings: { ...settings, ...patch } });
  };

  const commitLessonTime = (idx: number, field: 'start' | 'end', raw: string) => {
    const value = normalizeClock(raw);
    if (!value) return;
    setInfo(prev => {
      const current = prev.settings ?? DEFAULT_SCHOOL_SETTINGS;
      const base = current.manualLessonTimes && current.manualLessonTimes.length > 0
        ? current.manualLessonTimes
        : calculateLessonTimes(current);
      if (!base[idx] || base[idx][field] === value) return prev;
      return {
        ...prev,
        settings: { ...current, manualLessonTimes: shiftLessonTimes(base, idx, field, value) },
      };
    });
  };

  const lessonTimes = useMemo(() => calculateLessonTimes(settings), [settings]);

  useEffect(() => {
    if (showSuccess) {
      const timer = setTimeout(() => setShowSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showSuccess]);

  const handleDetectAdmins = () => {
    const { schoolInfo: next, detection } = applyAdminDetection(info, teachers, { overwrite: true });
    const summary = formatDetectionSummary(detection);
    if (!summary) {
      setPwMessage({ type: 'error', text: 'Ders programında müdür veya müdür yardımcısı tespit edilemedi.' });
      return;
    }
    setInfo(next);
    saveFormFields(next);
    setPwMessage({ type: 'success', text: `Otomatik tespit: ${summary}` });
  };

  const handleSave = () => {
    saveFormFields(info);
    setShowSuccess(true);
  };

  const handleAddVp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVpName.trim()) return;

    const newVp: VicePrincipal = {
      id: uuidv4(),
      name: newVpName.trim(),
    };

    setInfo({
      ...info,
      mudurYardimcilari: [...info.mudurYardimcilari, newVp],
    });
    setNewVpName('');
  };

  const handleDeleteVp = (id: string) => {
    setInfo({
      ...info,
      mudurYardimcilari: info.mudurYardimcilari.filter((vp) => vp.id !== id),
    });
  };

  const toggleDay = (dayId: number) => {
    const current = settings.schoolDays;
    const updated = current.includes(dayId)
      ? current.filter(d => d !== dayId)
      : [...current, dayId];
    updateSettings({ schoolDays: updated });
  };

  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');

  const handleAddHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHolidayDate || !newHolidayName.trim()) return;
    if (holidays.some(h => h.date === newHolidayDate)) return;
    const dutiesOnDate = assignments.filter(a => a.date === newHolidayDate).length;
    if (dutiesOnDate > 0 && setAssignments) {
      if (!confirm(`Bu tarihte ${dutiesOnDate} nöbet ataması var. Tatil eklenirse bu atamalar silinecek. Devam edilsin mi?`)) return;
      setAssignments(prev => prev.filter(a => a.date !== newHolidayDate));
    }
    setHolidays(prev => [...prev, {
      id: uuidv4(),
      date: newHolidayDate,
      name: newHolidayName.trim(),
      source: 'manual',
    }]);
    setNewHolidayDate('');
    setNewHolidayName('');
  };

  const handleDeleteHoliday = (id: string) => {
    const removed = holidays.find(h => h.id === id);
    const nextHolidays = holidays.filter(h => h.id !== id);
    setHolidays(prev => prev.filter(h => h.id !== id));

    if (!removed || !setAssignments || locations.length === 0) return;

    // Formdaki kaydedilmemiş değil, kayıtlı okul günleri kullanılır.
    const schoolDays = schoolInfo.settings?.schoolDays?.length ? schoolInfo.settings.schoolDays : settings.schoolDays;
    if (!shouldFillDutyAfterHolidayRemoval(removed.date, assignments, schoolDays)) return;

    const newDayAssignments = generateDutyAssignmentsForDate(
      removed.date,
      teachers,
      locations,
      assignments,
      nextHolidays,
      schoolDays,
    );

    if (newDayAssignments.length > 0) {
      setAssignments(prev => [...prev, ...newDayAssignments]);
      setMebResult({
        type: 'success',
        text: `${format(parseISO(removed.date), 'dd.MM.yyyy', { locale: tr })} tarihi için ${newDayAssignments.length} nöbet ataması eklendi.`,
      });
    }
  };

  const [fetchingMeb, setFetchingMeb] = useState(false);
  const [mebResult, setMebResult] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);

  const handleFetchMeb = async () => {
    setFetchingMeb(true);
    setMebResult(null);
    try {
      const { holidays: merged, source, sync, contentHash, title } = await runMebHolidaySync(activeYear, holidays);

      if (sync.changed) {
        setHolidays(merged);
        let filledCount = 0;
        if (setAssignments) {
          // Tatil olmaktan çıkan günler, elle silinen tatildeki gibi nöbetle doldurulur.
          const schoolDays = schoolInfo.settings?.schoolDays?.length ? schoolInfo.settings.schoolDays : settings.schoolDays;
          const stripped = stripAssignmentsOnHolidays(assignments, merged);
          const filled = locations.length > 0
            ? fillFreedHolidayDates(sync.removedDates, stripped, teachers, locations, merged, schoolDays)
            : [];
          filledCount = filled.length;
          setAssignments(prev => {
            const next = stripAssignmentsOnHolidays(prev, merged);
            const datesWithDuty = new Set(prev.map(a => a.date));
            const toAdd = filled.filter(a => !datesWithDuty.has(a.date));
            return next.length !== prev.length || toAdd.length > 0 ? [...next, ...toAdd] : prev;
          });
        }
        const parts: string[] = [];
        if (sync.added > 0) parts.push(`${sync.added} yeni`);
        if (sync.updated > 0) parts.push(`${sync.updated} güncellenen`);
        if (sync.removed > 0) parts.push(`${sync.removed} kaldırılan`);
        if (filledCount > 0) parts.push(`tatil olmaktan çıkan günlere ${filledCount} nöbet eklendi`);
        const sourceLabel = source === 'meb' ? 'MEB resmi takviminden' : 'resmi tatil verilerinden';
        setMebResult({
          type: 'success',
          text: `Tatil takvimi ${sourceLabel} güncellendi${parts.length ? ` (${parts.join(', ')})` : ''}. Toplam: ${merged.length} gün`,
        });
      } else if (merged.length === 0) {
        setMebResult({
          type: 'warning',
          text: `${formatAcademicYear(activeYear, title)} için henüz takvim verisi bulunamadı. Tatil günlerini elle ekleyebilirsiniz.`,
        });
      } else {
        setMebResult({ type: 'success', text: 'MEB tatil takvimi güncel, değişiklik yok.' });
      }

      setSchoolInfo(prev => {
        const years = new Set(prev.academicYears || []);
        years.add(activeYear);
        return {
          ...prev,
          academicYears: Array.from(years).sort(),
          mebCalendarSync: {
            ...prev.mebCalendarSync,
            [activeYear]: {
              version: MEB_CALENDAR_VERSION,
              syncedAt: new Date().toISOString(),
              source,
              contentHash,
              title: title || `${activeYear} Eğitim-Öğretim Yılı`,
            },
          },
        };
      });
    } catch {
      setMebResult({ type: 'error', text: 'Takvim verileri alınamadı. Lütfen tekrar deneyin.' });
    } finally {
      setFetchingMeb(false);
    }
  };

  const mebSyncMeta = schoolInfo.mebCalendarSync?.[activeYear];

  return (
    <div className="w-full mx-auto space-y-6">
      {showSuccess && (
        <div className="bg-emerald-50 text-emerald-700 px-5 py-3 rounded-xl flex items-center gap-2 border border-emerald-200 shadow-sm">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-medium">Tüm ayarlar başarıyla kaydedildi</span>
        </div>
      )}

      {/* Tema */}
      <div className="bg-surface p-8 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
            <Palette className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Tema</h2>
            <p className="text-sm text-slate-500 mt-0.5">Uygulama genelinde kullanılacak renk temasını seçin</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cn(
                "relative p-4 rounded-xl border-2 transition-all text-left group",
                theme === t.id
                  ? "border-indigo-500 ring-2 ring-indigo-500/30"
                  : "border-slate-200 hover:border-slate-300"
              )}
            >
              <div className="rounded-lg overflow-hidden mb-3 border border-slate-200/50">
                <div className="h-5" style={{ backgroundColor: t.colors.page }}>
                  <div className="h-1.5 mx-1 mt-1 rounded-full" style={{ backgroundColor: t.colors.accent, opacity: 0.8 }} />
                </div>
                <div className="p-1.5" style={{ backgroundColor: t.colors.page }}>
                  <div className="rounded p-1.5" style={{ backgroundColor: t.colors.card }}>
                    <div className="flex gap-1 mb-1">
                      <div className="h-1 w-6 rounded-full" style={{ backgroundColor: t.colors.text, opacity: 0.7 }} />
                      <div className="h-1 w-3 rounded-full" style={{ backgroundColor: t.colors.accent }} />
                    </div>
                    <div className="h-1 w-full rounded-full mb-0.5" style={{ backgroundColor: t.colors.text, opacity: 0.15 }} />
                    <div className="h-1 w-3/4 rounded-full" style={{ backgroundColor: t.colors.text, opacity: 0.1 }} />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{t.label}</span>
                {theme === t.id && (
                  <Check className="w-4 h-4 text-indigo-500" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Eğitim-Öğretim Dönemi */}
      <div className="bg-surface p-8 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="bg-violet-100 p-2 rounded-lg text-violet-600">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Eğitim-Öğretim Dönemi</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Eğitim-öğretim yıllarını yönetin. Her dönemin verileri (öğretmenler, ders programları, nöbet atamaları) birbirinden bağımsızdır.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-3">Kayıtlı Dönemler</h3>
            {(info.academicYears || []).length === 0 ? (
              <div className="text-sm text-slate-500 bg-slate-50 rounded-lg p-4 border border-dashed border-slate-300">
                Henüz dönem eklenmemiş. Aşağıdan yeni bir eğitim-öğretim dönemi ekleyin.
              </div>
            ) : (
              <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                {[...(info.academicYears || [])].sort().map(year => (
                  <li key={year} className="px-4 py-3 flex items-center justify-between bg-slate-50">
                    <div className="flex items-center gap-3">
                      <GraduationCap className="w-4 h-4 text-violet-500" />
                      <span className="font-medium text-slate-700">{formatAcademicYear(year, info.mebCalendarSync?.[year]?.title)}</span>
                      {year === getCurrentAcademicYear() && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                          Güncel
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteYear(year)}
                      disabled={(info.academicYears || []).length <= 1}
                      className="text-red-500 hover:text-red-700 p-1 rounded-md hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title={(info.academicYears || []).length <= 1 ? 'Son dönem silinemez' : 'Dönemi listeden kaldır'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-3">Yeni Dönem Ekle</h3>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={newYearStart}
                    onChange={(e) => setNewYearStart(e.target.value)}
                    disabled={addingYear}
                    placeholder="Örn: 2025-2026"
                    className={`flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-surface disabled:opacity-50 ${
                      newYearStart && !isValidYearFormat(newYearStart)
                        ? 'border-red-300 focus:ring-red-500/40'
                        : yearAlreadyExists
                          ? 'border-amber-300 focus:ring-amber-500/40'
                          : 'border-slate-300'
                    }`}
                  />
                  <button
                    onClick={handleAddYear}
                    disabled={addingYear || !newYearStart || !isValidYearFormat(newYearStart) || yearAlreadyExists}
                    className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {addingYear ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Ekleniyor...
                      </>
                    ) : (
                      <>
                        <Plus className="w-5 h-5" />
                        Ekle
                      </>
                    )}
                  </button>
                </div>
                {newYearStart && !isValidYearFormat(newYearStart) && (
                  <p className="text-xs text-red-500">Geçerli format: YYYY-YYYY (Örn: 2025-2026). İkinci yıl birinciden bir fazla olmalıdır.</p>
                )}
                {yearAlreadyExists && (
                  <p className="text-xs text-amber-600">Bu dönem zaten kayıtlı.</p>
                )}

                {(info.academicYears || []).length > 0 && (
                  <div className="bg-violet-50 rounded-lg p-4 border border-violet-100 space-y-3">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={copyTeachers}
                        onChange={(e) => setCopyTeachers(e.target.checked)}
                        disabled={addingYear}
                        className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                      />
                      <span className="text-sm font-medium text-slate-700">Önceki dönemden öğretmen listesini aktar</span>
                    </label>
                    {copyTeachers && (
                      <div className="flex items-center gap-2 ml-6">
                        <span className="text-sm text-slate-500 whitespace-nowrap">Kaynak dönem:</span>
                        <select
                          value={copyFromYear}
                          onChange={(e) => setCopyFromYear(e.target.value)}
                          disabled={addingYear}
                          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-surface disabled:opacity-50"
                        >
                          {[...(info.academicYears || [])].sort().map(y => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <p className="text-xs text-slate-500 ml-6">
                      Sadece öğretmen bilgileri (ad, iletişim, nöbet türü) aktarılır. Ders programları aktarılmaz.
                    </p>
                  </div>
                )}
              </div>
            <p className="text-xs text-slate-400 mt-2">
              Eğitim-öğretim yılı Eylül'de başlar, Haziran sonunda biter. Üst menüdeki dönem seçiciden aktif dönemi değiştirebilirsiniz.
            </p>
          </div>
        </div>
      </div>

      {/* Şifre Yönetimi */}
      <div className="bg-surface p-8 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="bg-rose-100 p-2 rounded-lg text-rose-600">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Şifre Yönetimi</h2>
            <p className="text-sm text-slate-500 mt-0.5">Admin ve öğretmen şifrelerini değiştirin</p>
          </div>
        </div>

        {pwMessage && (
          <div className={`mb-6 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
            pwMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {pwMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : null}
            {pwMessage.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Admin Password */}
          <div className="p-5 rounded-xl border border-slate-200 space-y-4">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-600" />
              Admin Şifresi
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-500">Mevcut Şifre</label>
                <div className="relative">
                  <input
                    type={showAdminPw ? 'text' : 'password'}
                    value={adminCurrentPw}
                    onChange={(e) => setAdminCurrentPw(e.target.value)}
                    placeholder="Mevcut admin şifresi"
                    className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPw(!showAdminPw)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showAdminPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-500">Yeni Şifre</label>
                <input
                  type="password"
                  value={adminNewPw}
                  onChange={(e) => setAdminNewPw(e.target.value)}
                  placeholder="En az 6 karakter"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                onClick={() => handleChangePassword('admin')}
                disabled={pwLoading || !adminCurrentPw || !adminNewPw}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {pwLoading ? 'Değiştiriliyor...' : 'Admin Şifresini Değiştir'}
              </button>
            </div>
          </div>

          {/* Teacher Password */}
          <div className="p-5 rounded-xl border border-slate-200 space-y-4">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-600" />
              Öğretmen Şifresi (Ortak)
            </h3>
            <p className="text-xs text-slate-500">
              Öğretmenlerin programa erişimi için kullanacağı ortak şifreyi değiştirin.
            </p>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-500">Yeni Öğretmen Şifresi</label>
                <div className="relative">
                  <input
                    type={showTeacherPw ? 'text' : 'password'}
                    value={teacherNewPw}
                    onChange={(e) => setTeacherNewPw(e.target.value)}
                    placeholder="En az 6 karakter"
                    className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTeacherPw(!showTeacherPw)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showTeacherPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                onClick={() => handleChangePassword('teacher')}
                disabled={pwLoading || !teacherNewPw}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {pwLoading ? 'Değiştiriliyor...' : 'Öğretmen Şifresini Değiştir'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Okul Bilgileri */}
      <div className="bg-surface p-8 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
            <Building2 className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-semibold text-slate-800">Okul Bilgileri</h2>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Valilik</label>
              <input
                type="text"
                value={info.valilik}
                onChange={(e) => setInfo({ ...info, valilik: e.target.value })}
                placeholder="Örn: İSTANBUL"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Kaymakamlık</label>
              <input
                type="text"
                value={info.kaymakamlik}
                onChange={(e) => setInfo({ ...info, kaymakamlik: e.target.value })}
                placeholder="Örn: KADIKÖY"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Okul Adı</label>
              <input
                type="text"
                value={info.okulAdi}
                onChange={(e) => setInfo({ ...info, okulAdi: e.target.value })}
                placeholder="Örn: ATATÜRK İLKOKULU"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Okul Müdürü</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={info.okulMuduru}
                  onChange={(e) => setInfo({ ...info, okulMuduru: e.target.value })}
                  placeholder="Örn: Ahmet YILMAZ"
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={handleDetectAdmins}
                  className="shrink-0 px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors flex items-center gap-1.5"
                  title="Öğretmen ders programlarından müdür ve müdür yardımcılarını tespit et"
                >
                  <ScanSearch className="w-4 h-4" />
                  Otomatik Tespit
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Ders programında &quot;Müdür&quot;, &quot;İdare&quot; gibi hücrelerden, öğretmen adından veya haftalık ders saatinden
                (müdür: {PRINCIPAL_WEEKLY_LESSONS} saat, müdür yardımcısı: {VICE_PRINCIPAL_WEEKLY_LESSONS} saat) algılanır.
              </p>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-100">
            <h3 className="text-md font-medium text-slate-800 mb-4">Müdür Yardımcıları</h3>
            
            <form onSubmit={handleAddVp} className="flex gap-3 mb-4">
              <input
                type="text"
                value={newVpName}
                onChange={(e) => setNewVpName(e.target.value)}
                placeholder="Müdür Yardımcısı Adı Soyadı"
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={!newVpName.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50 transition-colors"
              >
                <Plus className="w-5 h-5" />
                Ekle
              </button>
            </form>

            {info.mudurYardimcilari.length > 0 && (
              <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                {info.mudurYardimcilari.map((vp) => (
                  <li key={vp.id} className="px-4 py-3 flex items-center justify-between bg-slate-50">
                    <span className="font-medium text-slate-700">{vp.name}</span>
                    <button
                      onClick={() => handleDeleteVp(vp.id)}
                      className="text-red-500 hover:text-red-700 p-1 rounded-md hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Ders Saatleri ve Zaman Ayarları */}
      <div className="bg-surface p-8 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="bg-amber-100 p-2 rounded-lg text-amber-600">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Ders Saatleri ve Zaman Ayarları</h2>
            <p className="text-sm text-slate-500 mt-0.5">Ders süreleri, teneffüsler ve öğle arası ayarları</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Otomatik Ayarlar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Günlük Ders Sayısı</label>
              <input
                type="number"
                min={1}
                max={12}
                value={settings.lessonCount}
                onChange={(e) => updateSettings({ lessonCount: Math.max(1, Math.min(12, parseInt(e.target.value) || 1)) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <p className="text-xs text-slate-400">1-12 arası</p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">İlk Ders Başlama Saati</label>
              <input
                type="time"
                value={settings.firstLessonStart}
                onChange={(e) => updateSettings({ firstLessonStart: e.target.value })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Ders Süresi (dk)</label>
              <input
                type="number"
                min={20}
                max={60}
                value={settings.lessonDuration}
                onChange={(e) => updateSettings({ lessonDuration: Math.max(20, Math.min(60, parseInt(e.target.value) || 40)) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <p className="text-xs text-slate-400">20-60 dakika</p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Teneffüs Süresi (dk)</label>
              <input
                type="number"
                min={5}
                max={30}
                value={settings.breakDuration}
                onChange={(e) => updateSettings({ breakDuration: Math.max(5, Math.min(30, parseInt(e.target.value) || 10)) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <p className="text-xs text-slate-400">5-30 dakika</p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Öğle Arası (kaçıncı dersten sonra)</label>
              <input
                type="number"
                min={1}
                max={settings.lessonCount - 1 || 1}
                value={settings.lunchAfterLesson}
                onChange={(e) => updateSettings({ lunchAfterLesson: Math.max(1, Math.min(settings.lessonCount - 1, parseInt(e.target.value) || 4)) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <p className="text-xs text-slate-400">{settings.lunchAfterLesson}. ders ile {settings.lunchAfterLesson + 1}. ders arası</p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Öğle Arası Süresi (dk)</label>
              <input
                type="number"
                min={20}
                max={90}
                value={settings.lunchDuration}
                onChange={(e) => updateSettings({ lunchDuration: Math.max(20, Math.min(90, parseInt(e.target.value) || 40)) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <p className="text-xs text-slate-400">20-90 dakika</p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Nöbet, ilk dersten kaç dk önce</label>
              <input
                type="number"
                min={0}
                max={60}
                value={settings.dutyMinutesBefore ?? 15}
                onChange={(e) => updateSettings({ dutyMinutesBefore: Math.max(0, Math.min(60, parseInt(e.target.value) || 0)) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <p className="text-xs text-slate-400">0-60 dakika</p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Nöbet, son dersten kaç dk sonra</label>
              <input
                type="number"
                min={0}
                max={60}
                value={settings.dutyMinutesAfter ?? 15}
                onChange={(e) => updateSettings({ dutyMinutesAfter: Math.max(0, Math.min(60, parseInt(e.target.value) || 0)) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <p className="text-xs text-slate-400">0-60 dakika. Çıktıda nöbet saati bu aralıktan yazılır.</p>
            </div>
          </div>

          {/* Ders Saatleri Önizleme ve Düzenleme */}
          <div className="pt-6 border-t border-slate-100">
            <h3 className="text-md font-medium text-slate-800 mb-4">Ders Saatleri Çizelgesi</h3>
            {formatDutyClock(dutyClockRange(settings)) && (
              <p className="text-sm text-slate-600 mb-3">Nöbet saati: {formatDutyClock(dutyClockRange(settings))}</p>
            )}
            <p className="text-sm text-slate-500 mb-4">Otomatik hesaplanan saatleri manuel olarak düzenleyebilirsiniz. Saat kutusundan çıkınca o ders ve sonraki dersler kayar; önceki derslerin başlangıç ve bitiş saatleri aynı kalır.</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-2 px-3">Ders</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-2 px-3">Başlangıç</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-2 px-3">Bitiş</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-2 px-3">Ara</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(settings.manualLessonTimes || lessonTimes).map((lt, idx, rows) => {
                    const isBeforeLunch = (lt.lesson || idx + 1) === settings.lunchAfterLesson;
                    const isLast = idx === rows.length - 1;
                    const gap = !isLast ? getTimeDiffInMinutes(lt.end, rows[idx + 1].start) : 0;
                    return (
                      <tr key={idx} className={isBeforeLunch ? 'bg-amber-50/50' : ''}>
                        <td className="py-2.5 px-3">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold">
                            {lt.lesson || idx + 1}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <LessonClockInput value={lt.start} onCommit={(next) => commitLessonTime(idx, 'start', next)} />
                        </td>
                        <td className="py-2.5 px-3">
                          <LessonClockInput value={lt.end} onCommit={(next) => commitLessonTime(idx, 'end', next)} />
                        </td>
                        <td className="py-2.5 px-3">
                          {!isLast && (
                            isBeforeLunch ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                Öğle Arası — {gap} dk
                              </span>
                            ) : (
                              <span className="text-sm text-slate-500">{gap} dk teneffüs</span>
                            )
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              onClick={() => {
                updateSettings({ manualLessonTimes: undefined });
              }}
              className="mt-4 text-sm text-slate-500 hover:text-slate-700 underline"
            >
              Otomatik hesaplanan saatlere geri dön
            </button>
          </div>
        </div>
      </div>

      {/* Okul Günleri */}
      <div className="bg-surface p-8 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="bg-emerald-100 p-2 rounded-lg text-emerald-600">
            <CalendarDays className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Okul Günleri</h2>
            <p className="text-sm text-slate-500 mt-0.5">Haftada kaç gün ve hangi günler ders yapılıyor</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {DAYS_OF_WEEK.map(day => (
              <button
                key={day.id}
                onClick={() => toggleDay(day.id)}
                className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  settings.schoolDays.includes(day.id)
                    ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-600 ring-offset-2'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {day.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-slate-500">
            Haftada <span className="font-semibold text-slate-700">{settings.schoolDays.length}</span> gün ders yapılıyor.
            Bu ayar nöbet programı oluşturma ve diğer hesaplamalarda otomatik kullanılacaktır.
          </p>
        </div>
      </div>

      {/* Tatil ve Özel Günler */}
      <div className="bg-surface p-8 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="bg-rose-100 p-2 rounded-lg text-rose-600">
            <CalendarX2 className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-slate-800">Tatil ve Özel Günler</h2>
            <p className="text-sm text-slate-500 mt-0.5">Nöbet programından çıkarılacak tatil ve özel günleri tanımlayın</p>
          </div>
        </div>

        <div className="mb-5">
          <button
            onClick={handleFetchMeb}
            disabled={fetchingMeb}
            className="w-full sm:w-auto bg-rose-600 hover:bg-rose-700 text-white px-5 py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-wait shadow-sm"
          >
            {fetchingMeb ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Yükleniyor...
              </>
            ) : (
              <>
                <CalendarX2 className="w-4 h-4" />
                MEB {formatAcademicYear(activeYear, mebSyncMeta?.title)} Takviminden Yükle
              </>
            )}
          </button>
          <p className="text-xs text-slate-400 mt-2">
            MEB resmi haber sayfasından ara tatiller ve yarıyıl tatili canlı çekilir; dini bayramlar ve resmi tatiller birleştirilir.
            29 Ekim, 23 Nisan ve 19 Mayıs MEB tarafından iş günü sayıldığı için dahil edilmez.
            Uygulama her açılışta güncel takvimi otomatik kontrol eder.
          </p>
          {mebSyncMeta && (
            <p className="text-xs text-slate-500 mt-2">
              Son MEB kontrolü:{' '}
              {format(new Date(mebSyncMeta.syncedAt), 'dd MMMM yyyy HH:mm', { locale: tr })}
              {' · '}kaynak: {mebSyncMeta.source === 'meb' ? 'MEB takvimi' : mebSyncMeta.source === 'api' ? 'resmi tatil API' : '—'}
              {mebSyncMeta.title ? ` · ${mebSyncMeta.title}` : ''}
            </p>
          )}

          {mebResult && (
            <div className={`mt-3 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
              mebResult.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : mebResult.type === 'warning'
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {mebResult.type === 'success' && <CheckCircle2 className="w-4 h-4 flex-shrink-0" />}
              {mebResult.text}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 pt-5">
          <h3 className="text-sm font-medium text-slate-700 mb-3">Elle Tatil Günü Ekle</h3>
        </div>

        <form onSubmit={handleAddHoliday} className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            type="date"
            value={newHolidayDate}
            onChange={(e) => setNewHolidayDate(e.target.value)}
            className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          <input
            type="text"
            value={newHolidayName}
            onChange={(e) => setNewHolidayName(e.target.value)}
            placeholder="Tatil adı (Örn: Cumhuriyet Bayramı)"
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          <button
            type="submit"
            disabled={!newHolidayDate || !newHolidayName.trim() || holidays.some(h => h.date === newHolidayDate)}
            className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-5 h-5" />
            Ekle
          </button>
        </form>

        {holidays.some(h => h.date === newHolidayDate) && newHolidayDate && (
          <p className="text-xs text-amber-600 mb-3">Bu tarih zaten eklenmiş.</p>
        )}

        {holidays.length === 0 ? (
          <div className="text-sm text-slate-500 bg-slate-50 rounded-lg p-4 border border-dashed border-slate-300">
            Henüz tatil günü eklenmemiş. Nöbet programından çıkarılmasını istediğiniz günleri ekleyin.
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
            {[...holidays].sort((a, b) => a.date.localeCompare(b.date)).map(h => (
              <li key={h.id} className="px-4 py-3 flex items-center justify-between bg-slate-50 hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-3 flex-wrap">
                  <CalendarX2 className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span className="text-sm font-medium text-slate-700">
                    {format(parseISO(h.date), 'dd MMMM yyyy EEEE', { locale: tr })}
                  </span>
                  <span className="text-xs bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">{h.name}</span>
                </div>
                <button
                  onClick={() => handleDeleteHoliday(h.id)}
                  className="text-red-500 hover:text-red-700 p-1 rounded-md hover:bg-red-50 transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-slate-400 mt-3">
          Toplam {holidays.length} tatil/özel gün tanımlı. Tatil silindiğinde, mevcut nöbet programı aralığındaki o güne otomatik nöbet atanır.
        </p>
      </div>

      {/* Gmail Yapılandırma */}
      <div className="bg-surface p-8 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="bg-red-100 p-2 rounded-lg text-red-600">
            <Mail className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-800">E-posta Bildirimi (Gmail)</h2>
            <p className="text-sm text-slate-500 mt-0.5">Nöbet programını öğretmenlere e-posta ile göndermek için Gmail ayarları</p>
          </div>
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Gmail Adresi</label>
            <input
              type="email"
              value={info.gmailEmail || ''}
              onChange={(e) => setInfo({ ...info, gmailEmail: e.target.value })}
              placeholder="ornek@gmail.com"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Gmail Uygulama Şifresi</label>
            <input
              type="password"
              value={info.gmailAppPassword || ''}
              onChange={(e) => setInfo({ ...info, gmailAppPassword: e.target.value })}
              placeholder="xxxx xxxx xxxx xxxx"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <h4 className="text-sm font-semibold text-amber-800 mb-2">Uygulama Şifresi Nasıl Alınır?</h4>
            <ol className="text-xs text-amber-700 space-y-1 list-decimal pl-4">
              <li>Google Hesabınıza giriş yapın (myaccount.google.com)</li>
              <li>Güvenlik → 2 Adımlı Doğrulama'yı açın (zaten açıksa atlayın)</li>
              <li>Güvenlik → "Uygulama Şifreleri" bölümüne gidin</li>
              <li>Uygulama adı olarak "Nöbet Programı" yazıp "Oluştur" deyin</li>
              <li>Gösterilen 16 haneli şifreyi yukarıdaki alana yapıştırın</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Değişiklik Geçmişi */}
      <ChangeHistorySection teachers={teachers} locations={locations} />

      {/* Veri Yedekleme */}
      <BackupSection />

      {/* Kaydet Butonu */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-8 rounded-xl font-semibold flex items-center gap-2 transition-colors shadow-sm"
        >
          <Save className="w-5 h-5" />
          Tüm Ayarları Kaydet
        </button>
      </div>
    </div>
  );
}
