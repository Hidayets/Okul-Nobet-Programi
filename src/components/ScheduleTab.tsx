import React, { useState, useMemo, useEffect, useRef } from 'react';
import { format, parseISO, getISOWeek, getDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Calendar, Printer, Send, X, CheckCircle2, BarChart3, Archive, Trash2, ChevronDown, ChevronUp, ArrowLeft, ArrowRight, Palette, Layers, Plus, FileSpreadsheet, Info, AlertTriangle, Undo2 } from 'lucide-react';
import PrintPreview, { capturePrintHtml } from './PrintPreview';
import * as XLSX from 'xlsx';
import { exportDutyScheduleToExcel } from '../lib/dutyScheduleExcel';
import { buildTeacherColorMap, getTeacherSubject, getTeacherBarColor } from '../lib/teacherColors';
import { Teacher, Location, Assignment, SchoolInfo, ScheduleArchive, formatAcademicYear, canTeacherDutyOnDay, Holiday, Absence, Substitution, DutyChange, DutyChangeReason, DUTY_CHANGE_REASONS } from '../types';
import { dutyChangeWarnings } from '../lib/dutyChangeWarning';
import { dutyClockRange, formatDutyClock } from '../lib/dutyHours';
import { scanSchedule } from '../lib/scheduleScan';
import TodayBoard from './TodayBoard';
import MyDutyList from './MyDutyList';
import ScheduleWarnings from './ScheduleWarnings';
import { getAuthHeaders } from '../lib/apiHeaders';
import { computeLocationDistribution, computeMonthDistribution } from '../lib/dutyDistribution';
import { assignVicePrincipalsToDates, countVpDutiesByPrincipal } from '../lib/vicePrincipalDuty';
import { formatSchedulePrintTitle } from '../lib/scheduleTitle';
import { buildScheduleRows } from '../lib/holidaySchedule';
import { getScheduleColumnHeader, getWeekHeaderStyle } from '../lib/headerColors';
import SchedulePreviewDemo from './SchedulePreviewDemo';
import { weekKey } from '../lib/weeklyQuota';

type ZebraColor = 'none' | 'blue' | 'green' | 'purple' | 'amber';

const ZEBRA_COLORS: { id: ZebraColor; label: string; swatch: string; print: string }[] = [
  { id: 'none', label: 'Renksiz', swatch: '#ffffff', print: 'transparent' },
  { id: 'blue', label: 'Mavi', swatch: '#dbeafe', print: '#dbeafe' },
  { id: 'green', label: 'Yeşil', swatch: '#dcfce7', print: '#dcfce7' },
  { id: 'purple', label: 'Mor', swatch: '#ede9fe', print: '#ede9fe' },
  { id: 'amber', label: 'Sarı', swatch: '#fef3c7', print: '#fef3c7' },
];

const ZEBRA_STORAGE_KEY = 'pdfZebraColor';

interface Props {
  assignments: Assignment[];
  setAssignments?: React.Dispatch<React.SetStateAction<Assignment[]>>;
  teachers: Teacher[];
  locations: Location[];
  schoolInfo: SchoolInfo;
  holidays?: Holiday[];
  absences?: Absence[];
  substitutions?: Substitution[];
  kurumKodu?: string;
  canUndo?: boolean;
  onUndo?: () => void;
  dutyChanges?: DutyChange[];
  setDutyChanges?: (next: DutyChange[] | ((prev: DutyChange[]) => DutyChange[])) => unknown;
  editorLabel?: string;
  isAdmin?: boolean;
  activeYear?: string;
  scheduleArchives?: ScheduleArchive[];
  setScheduleArchives?: React.Dispatch<React.SetStateAction<ScheduleArchive[]>>;
  onGoToGenerator?: () => void;
}

export default function ScheduleTab({ assignments, setAssignments, teachers, locations, schoolInfo, holidays = [], absences = [], substitutions = [], kurumKodu = '', canUndo = false, onUndo, dutyChanges = [], setDutyChanges, editorLabel = 'Admin', isAdmin = false, activeYear, scheduleArchives = [], setScheduleArchives, onGoToGenerator }: Props) {
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<'idle' | 'sending' | 'success'>('idle');
  const printMode = null as 'schedule' | 'dutyCounts' | null;
  const [printPreview, setPrintPreview] = useState<{ title: string; html: string; page: 'portrait' | 'landscape' } | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [zebraColor, setZebraColor] = useState<ZebraColor>(() => {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem(ZEBRA_STORAGE_KEY)) as ZebraColor | null;
    return saved && ZEBRA_COLORS.some(z => z.id === saved) ? saved : 'blue';
  });
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [showDistributionDetail, setShowDistributionDetail] = useState<'location' | 'month' | null>(null);
  const [popover, setPopover] = useState<{ assignmentId: string; teacherId: string; date: string; locationId: string } | null>(null);
  const [pendingReplace, setPendingReplace] = useState<{ assignmentId: string; teacherId: string; teacherName: string; warnings: string[] } | null>(null);
  const [editReason, setEditReason] = useState<DutyChangeReason | ''>('');
  const [selectedDate, setSelectedDate] = useState<string | null>(() => format(new Date(), 'yyyy-MM-dd'));
  // Bugünün tarihi; gece yarısını otomatik yakalamak için periyodik tazelenir.
  const [todayStr, setTodayStr] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const popoverRef = useRef<HTMLDivElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = format(new Date(), 'yyyy-MM-dd');
      setTodayStr(prev => (prev === now ? prev : now));
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(ZEBRA_STORAGE_KEY, zebraColor);
  }, [zebraColor]);

  useEffect(() => {
    if (!popover && !colorPickerOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || colorPickerRef.current?.contains(target)) return;
      setPopover(null);
      setColorPickerOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [popover, colorPickerOpen]);

  const handleCancelSchedule = () => {
    if (setAssignments) {
      setAssignments([]);
    }
    setShowCancelConfirm(false);
  };

  const toggleDoubleDuty = (assignmentId: string) => {
    if (!setAssignments) return;
    setAssignments(prev => prev.map(a => a.id === assignmentId ? { ...a, isDoubleDuty: !a.isDoubleDuty } : a));
  };

  const recordChange = (assignment: Assignment, toTeacherId?: string) => {
    if (!setDutyChanges || !editReason) return;
    const row: DutyChange = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      by: editorLabel,
      assignmentId: assignment.id,
      date: assignment.date,
      locationId: assignment.locationId,
      fromTeacherId: assignment.teacherId,
      toTeacherId,
      reason: editReason,
    };
    setDutyChanges(prev => [...prev, row].slice(-200));
  };

  const removeAssignment = (assignmentId: string) => {
    if (!setAssignments || !editReason) return;
    const current = assignments.find(a => a.id === assignmentId);
    if (current) recordChange(current);
    setAssignments(prev => prev.filter(a => a.id !== assignmentId));
    setPopover(null);
    setEditReason('');
  };

  const replaceAssignmentTeacher = (assignmentId: string, newTeacherId: string) => {
    if (!setAssignments || !editReason) return;
    const current = assignments.find(a => a.id === assignmentId);
    if (current) recordChange(current, newTeacherId);
    setAssignments(prev => prev.map(a => {
      if (a.id !== assignmentId) return a;
      const { originalTeacherId: _o, swapPairId: _s, ...rest } = a;
      return { ...rest, teacherId: newTeacherId };
    }));
    setPopover(null);
    setPendingReplace(null);
    setEditReason('');
  };

  const requestReplace = (assignmentId: string, newTeacherId: string) => {
    if (!editReason) return;
    const assignment = assignments.find(a => a.id === assignmentId);
    const teacher = teachers.find(t => t.id === newTeacherId);
    if (!assignment || !teacher) return;
    const warnings = dutyChangeWarnings({
      teacher,
      date: assignment.date,
      assignments,
      locations,
      absences,
      excludeAssignmentId: assignmentId,
    });
    if (warnings.length === 0) {
      replaceAssignmentTeacher(assignmentId, newTeacherId);
      return;
    }
    setPopover(null);
    setPendingReplace({ assignmentId, teacherId: newTeacherId, teacherName: teacher.name, warnings });
  };

  const shiftTeachersByOne = (direction: 'forward' | 'backward') => {
    if (!setAssignments) return;
    const dates = Array.from(new Set(assignments.map(a => a.date))).sort();
    const next = assignments.map(a => ({ ...a }));
    for (const date of dates) {
      const dayAssignments = next.filter(a => a.date === date);
      const grouped: Record<string, Assignment[]> = {};
      for (const a of dayAssignments) {
        if (!grouped[a.locationId]) grouped[a.locationId] = [];
        grouped[a.locationId].push(a);
      }
      const locIds = locations.map(l => l.id).filter(id => grouped[id]?.length);
      if (locIds.length < 2) continue;
      // Tüm slotlar yer sırasına göre düz listeye alınıp kaydırılır; yerlerdeki kişi sayısı
      // farklı olsa bile hiçbir öğretmen kaybolmaz ya da aynı gün iki kez yazılmaz.
      const slots = locIds.flatMap(id => grouped[id]);
      const ids = slots.map(a => a.teacherId);
      const step = direction === 'forward'
        ? grouped[locIds[locIds.length - 1]].length
        : grouped[locIds[0]].length;
      const rotatedIds = direction === 'forward'
        ? [...ids.slice(ids.length - step), ...ids.slice(0, ids.length - step)]
        : [...ids.slice(step), ...ids.slice(0, step)];
      const seenToday = new Set<string>();
      slots.forEach((a, i) => {
        a.teacherId = rotatedIds[i];
        delete a.originalTeacherId;
        delete a.swapPairId;
        if (seenToday.has(a.teacherId)) a.isDoubleDuty = true;
        else delete a.isDoubleDuty;
        seenToday.add(a.teacherId);
      });
    }
    setAssignments(next);
  };

  const shiftDaysByOne = (direction: 'forward' | 'backward') => {
    if (!setAssignments) return;
    const dates = Array.from(new Set(assignments.map(a => a.date))).sort();
    if (dates.length < 2) return;
    const rotatedDates = direction === 'forward'
      ? [dates[dates.length - 1], ...dates.slice(0, -1)]
      : [...dates.slice(1), dates[0]];
    const dateMap: Record<string, string> = {};
    dates.forEach((d, i) => { dateMap[d] = rotatedDates[i]; });
    setAssignments(prev => prev.map(a => ({ ...a, date: dateMap[a.date] ?? a.date })));
  };

  const teacherDailyLessonCount = (teacherId: string, dayOfWeek: number): number => {
    const t = teachers.find(x => x.id === teacherId);
    if (!t?.schedule) return 0;
    const day = t.schedule[dayOfWeek];
    if (!day) return 0;
    return Object.values(day).filter(v => v && String(v).trim()).length;
  };

  const holidayDateSet = useMemo(() => new Set(holidays.map(h => h.date)), [holidays]);
  const dutyHours = formatDutyClock(dutyClockRange(schoolInfo.settings));
  const schoolDays = schoolInfo.settings?.schoolDays?.length ? schoolInfo.settings.schoolDays : [1, 2, 3, 4, 5];
  const schoolDaysKey = schoolDays.join(',');
  const scheduleIssues = useMemo(() => scanSchedule({
    assignments,
    teachers,
    locations,
    absences,
    holidays,
    schoolDays,
  }), [assignments, teachers, locations, absences, holidays, schoolInfo.settings]);

  const scheduleData = useMemo(() => {
    const data: Record<string, Record<string, { teacher: Teacher; assignment: Assignment }[]>> = {};
    const dates = new Set<string>();

    assignments.forEach((assignment) => {
      if (holidayDateSet.has(assignment.date)) return;
      dates.add(assignment.date);
      if (!data[assignment.date]) {
        data[assignment.date] = {};
      }
      if (!data[assignment.date][assignment.locationId]) {
        data[assignment.date][assignment.locationId] = [];
      }

      const teacher = teachers.find(t => t.id === assignment.teacherId);
      if (teacher) {
        data[assignment.date][assignment.locationId].push({ teacher, assignment });
      }
    });

    const sortedDates = Array.from(dates).sort();
    return { data, sortedDates };
  }, [assignments, teachers, holidayDateSet]);

  const scheduleRows = useMemo(
    () => buildScheduleRows(assignments, holidays, schoolDays),
    [assignments, holidays, schoolDaysKey],
  );

  const dutyDates = useMemo(
    () => scheduleRows.filter(r => r.type === 'duty').map(r => r.date),
    [scheduleRows],
  );

  const vpByDate = useMemo(
    () => assignVicePrincipalsToDates(dutyDates, schoolInfo.mudurYardimcilari),
    [dutyDates, schoolInfo.mudurYardimcilari],
  );

  const vpDutyStats = useMemo(
    () => countVpDutiesByPrincipal(vpByDate),
    [vpByDate],
  );

  const hasDoubleDuty = useMemo(() => assignments.some(a => a.isDoubleDuty), [assignments]);

  const popoverInfo = useMemo(() => {
    if (!popover) return null;
    const teacher = teachers.find(t => t.id === popover.teacherId);
    if (!teacher) return null;
    const date = parseISO(popover.date);
    const dayOfWeek = getDay(date);
    const lessonCount = teacherDailyLessonCount(teacher.id, dayOfWeek);
    const targetWeek = weekKey(date);
    const sameWeek = assignments.filter(a => {
      if (a.teacherId !== teacher.id || a.id === popover.assignmentId) return false;
      return weekKey(parseISO(a.date)) === targetWeek;
    });
    const weekDutyCount = sameWeek.length + 1;
    const totalDuties = assignments.filter(a => a.teacherId === teacher.id).length;
    const sameDay = assignments.filter(a =>
      a.teacherId === teacher.id && a.date === popover.date && a.id !== popover.assignmentId,
    );
    const dayConflict = !canTeacherDutyOnDay(teacher, dayOfWeek);
    const candidateTeachers = teachers
      .filter(t => t.id !== teacher.id && t.dutyType !== 'nobetDisi' && canTeacherDutyOnDay(t, dayOfWeek))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    const currentAssignment = assignments.find(a => a.id === popover.assignmentId);
    return {
      teacher,
      lessonCount,
      weekDutyCount,
      sameWeek,
      totalDuties,
      sameDay,
      dayConflict,
      candidateTeachers,
      currentAssignment,
      dayOfWeek,
    };
  }, [popover, teachers, assignments]);

  const uniqueTeachersInSchedule = useMemo(() => {
    const teacherIds = new Set(assignments.map(a => a.teacherId));
    return teachers
      .filter(t => teacherIds.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [assignments, teachers]);

  const teacherColorMap = useMemo(
    () => buildTeacherColorMap(uniqueTeachersInSchedule.map(t => t.id)),
    [uniqueTeachersInSchedule],
  );

  // Bugün nöbet günüyse günde bir kez otomatik bugün seçilir; sonrasında kullanıcının seçimi korunur.
  const autoSelectedDayRef = useRef<string | null>(null);
  useEffect(() => {
    if (dutyDates.length === 0) return;
    if (autoSelectedDayRef.current !== todayStr && dutyDates.includes(todayStr)) {
      autoSelectedDayRef.current = todayStr;
      if (selectedDate !== todayStr) setSelectedDate(todayStr);
      return;
    }
    if (!selectedDate || !dutyDates.includes(selectedDate)) {
      setSelectedDate(dutyDates.includes(todayStr) ? todayStr : dutyDates[0]);
    }
  }, [dutyDates, selectedDate, todayStr]);

  const selectedDayDetail = useMemo(() => {
    if (!selectedDate) return null;
    const parsed = parseISO(selectedDate);
    const entries: { location: string; teacher: Teacher }[] = [];
    for (const loc of locations) {
      const cell = scheduleData.data[selectedDate]?.[loc.id] || [];
      for (const { teacher } of cell) {
        entries.push({ location: loc.name, teacher });
      }
    }
    return {
      date: selectedDate,
      formatted: format(parsed, 'd MMMM yyyy', { locale: tr }),
      dayName: format(parsed, 'EEEE', { locale: tr }),
      entries,
      vp: vpByDate[selectedDate] ?? null,
    };
  }, [selectedDate, locations, scheduleData, vpByDate]);

  const weeklyDutyCount = useMemo(() => {
    if (!selectedDate) return dutyDates.length;
    const week = weekKey(parseISO(selectedDate));
    return dutyDates.filter(d => weekKey(parseISO(d)) === week).length;
  }, [selectedDate, dutyDates]);

  const dutyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    assignments.forEach(a => {
      if (holidayDateSet.has(a.date)) return;
      counts[a.teacherId] = (counts[a.teacherId] || 0) + 1;
    });
    return teachers
      .filter(t => counts[t.id])
      .map(t => ({ name: t.name, count: counts[t.id] }))
      .sort((a, b) => b.count - a.count);
  }, [assignments, teachers, holidayDateSet]);

  const teacherNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    teachers.forEach(t => { map[t.id] = t.name; });
    return map;
  }, [teachers]);

  const locationNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    locations.forEach(l => { map[l.id] = l.name; });
    return map;
  }, [locations]);

  const locationDistribution = useMemo(
    () => computeLocationDistribution(assignments, teacherNameMap, locationNameMap),
    [assignments, teacherNameMap, locationNameMap],
  );

  const monthDistribution = useMemo(
    () => computeMonthDistribution(assignments, teacherNameMap),
    [assignments, teacherNameMap],
  );

  const openPrintPreview = (selector: string, title: string, page: 'portrait' | 'landscape') => {
    const html = capturePrintHtml(selector);
    if (!html) {
      alert('Yazdırılacak içerik bulunamadı.');
      return;
    }
    setPrintPreview({ title, html, page });
  };

  const handleExportScheduleToExcel = async () => {
    // Yazdırılan çizelgenin birebir karşılığı: her hafta ayrı sayfa,
    // öğretmen isimleri hücreye düz metin (iç içe kutucuk yok).
    try {
      await exportDutyScheduleToExcel({
        rows: scheduleRows,
        locations,
        scheduleData: scheduleData.data,
        vpByDate,
        schoolInfo,
        title: schedulePrintTitle,
        yearLabel: yearLabel ?? undefined,
      });
    } catch (err) {
      console.error('Excel çizelge oluşturulamadı:', err);
      alert('Excel dosyası oluşturulamadı. Lütfen tekrar deneyin.');
    }
  };

  const handlePrintDutyCounts = () => {
    // Excel dosyası oluştur ve indir
    const workbook = XLSX.utils.book_new();
    
    // Başlık satırı
    const headerRow = ['#', 'Öğretmen Adı', 'Nöbet Sayısı'];
    
    // Veri satırları
    const dataRows = dutyCounts.map((item, i) => [
      i + 1,
      item.name,
      item.count
    ]);
    
    // Worksheet oluştur
    const worksheetData = [headerRow, ...dataRows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    
    // Sütun genişliklerini ayarla
    worksheet['!cols'] = [
      { wch: 8 },  // #
      { wch: 30 }, // Öğretmen Adı
      { wch: 15 }  // Nöbet Sayısı
    ];
    
    // Worksheet'i workbook'a ekle
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Nöbet Sayıları');
    
    // Dosya adı oluştur
    const fileName = `Nobet_Sayilari_${yearLabel || 'Egitim_Ogretim'}.xlsx`;
    
    // Dosyayı indir
    XLSX.writeFile(workbook, fileName);
  };


  const [emailResult, setEmailResult] = useState<{ sent: number; failed: number; details?: any[] } | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const teachersWithDuties = useMemo(() => {
    const map = new Map<string, { teacher: Teacher; duties: { date: string; location: string }[] }>();
    assignments.forEach(a => {
      const teacher = teachers.find(t => t.id === a.teacherId);
      if (!teacher || !teacher.email) return;
      if (!map.has(teacher.id)) {
        map.set(teacher.id, { teacher, duties: [] });
      }
      const loc = locations.find(l => l.id === a.locationId);
      map.get(teacher.id)!.duties.push({
        date: format(parseISO(a.date), 'dd.MM.yyyy EEEE', { locale: tr }),
        location: loc?.name || '-',
      });
    });
    return Array.from(map.values());
  }, [assignments, teachers, locations]);

  const teachersWithoutEmail = useMemo(() => {
    const ids = new Set(assignments.map(a => a.teacherId));
    return teachers.filter(t => ids.has(t.id) && !t.email);
  }, [assignments, teachers]);

  const [showConfirm, setShowConfirm] = useState(false);

  const handleSendNotifications = async () => {
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }
    setShowConfirm(false);
    setNotificationStatus('sending');
    setEmailError(null);
    setEmailResult(null);

    if (!schoolInfo.gmailEmail || !schoolInfo.gmailAppPassword) {
      setEmailError('Gmail ayarları yapılmamış. Ayarlar sayfasından Gmail adresinizi ve uygulama şifrenizi girin.');
      setNotificationStatus('idle');
      return;
    }

    if (teachersWithDuties.length === 0) {
      setEmailError('E-posta adresi olan nöbetçi öğretmen bulunamadı.');
      setNotificationStatus('idle');
      return;
    }

    const okulAdi = schoolInfo.okulAdi || 'Okul';
    const recipients = teachersWithDuties.map(({ teacher, duties }) => {
      const dutyRows = duties
        .map(d => `<tr><td style="border:1px solid #ddd;padding:6px 10px">${d.date}</td><td style="border:1px solid #ddd;padding:6px 10px">${d.location}</td></tr>`)
        .join('');

      return {
        email: teacher.email,
        subject: `${okulAdi} - Nöbet Görev Bilgilendirmesi`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#4338ca">Nöbet Görev Bilgilendirmesi</h2>
            <p>Sayın <strong>${teacher.name}</strong>,</p>
            <p>Aşağıda nöbet görev programınız yer almaktadır:</p>
            <table style="border-collapse:collapse;width:100%;margin:16px 0">
              <thead><tr>
                <th style="border:1px solid #ddd;padding:8px 10px;background:#f0f0f0;text-align:left">Tarih</th>
                <th style="border:1px solid #ddd;padding:8px 10px;background:#f0f0f0;text-align:left">Nöbet Yeri</th>
              </tr></thead>
              <tbody>${dutyRows}</tbody>
            </table>
            <p style="color:#666;font-size:13px">İyi çalışmalar dileriz.<br><strong>${okulAdi}</strong></p>
          </div>
        `,
      };
    });

    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          gmailEmail: schoolInfo.gmailEmail,
          gmailAppPassword: schoolInfo.gmailAppPassword,
          recipients,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setEmailError(data.error || 'E-posta gönderilemedi.');
        setNotificationStatus('idle');
        return;
      }

      setEmailResult({ sent: data.sent, failed: data.failed, details: data.details });
      setNotificationStatus('success');
      setTimeout(() => {
        setShowNotificationModal(false);
        setNotificationStatus('idle');
        setEmailResult(null);
      }, 5000);
    } catch {
      setEmailError('Bağlantı hatası. Sunucu çalıştığından emin olun.');
      setNotificationStatus('idle');
    }
  };

  if (assignments.length === 0) {
    return (
      <div className="bg-surface p-8 sm:p-12 rounded-2xl shadow-sm border border-slate-200">
        <div className="text-center">
          <div className="bg-indigo-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Calendar className="w-8 h-8 text-indigo-600" />
          </div>
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Henüz Program Oluşturulmadı</h2>
          <p className="text-slate-500 max-w-lg mx-auto mb-6">
            Gerçek çizelge, <strong>Program Oluştur</strong> sekmesinden tarih aralığı seçip program ürettikten sonra burada görünür.
            Aşağıda örnek bir önizleme var.
          </p>
          {isAdmin && onGoToGenerator && (
            <button
              type="button"
              onClick={onGoToGenerator}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
            >
              <Calendar className="w-4 h-4" />
              Program Oluştur&apos;a Git
            </button>
          )}
          {isAdmin && onUndo && canUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="ml-2 inline-flex items-center gap-2 bg-surface border border-slate-300 hover:bg-slate-50 text-slate-700 px-5 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
              title="Son nöbet değişikliğini geri al"
            >
              <Undo2 className="w-4 h-4" />
              Geri al
            </button>
          )}
        </div>
        <SchedulePreviewDemo />
      </div>
    );
  }

  const schedulePrintTitle = formatSchedulePrintTitle(scheduleRows.map(r => r.date));
  const holidayRowCount = scheduleRows.length - dutyDates.length;
  const yearLabel = activeYear
    ? formatAcademicYear(activeYear, schoolInfo?.mebCalendarSync?.[activeYear]?.title)
    : '';

  return (
    <div className="space-y-6 relative">
      {printPreview && (
        <PrintPreview
          title={printPreview.title}
          html={printPreview.html}
          page={printPreview.page}
          onClose={() => setPrintPreview(null)}
        />
      )}
      {/* Dynamic print CSS based on printMode */}
      <style type="text/css" media="print">
        {`
          @page { margin: 0.4cm; size: A4 landscape; }
          html, body { font-size: 8pt !important; width: 100% !important; }
          .schedule-print-section table { border-collapse: collapse !important; width: 100% !important; max-width: 100% !important; table-layout: fixed !important; }
          .print-no-border { border: none !important; }
          .print-header-block { font-size: 9pt !important; margin-bottom: 2px !important; line-height: 1.2 !important; }
          .print-title-block { font-size: 10pt !important; margin-bottom: 2px !important; }
          .print-footer-block { font-size: 6pt !important; margin-top: 4px !important; }
          .print-footer-block li { margin-bottom: 0 !important; }
          /* Sayfa genişliğini taşma: hücre içi uzun isimler sarar, sütun genişletmez. */
          .schedule-print-section th,
          .schedule-print-section td {
            overflow-wrap: anywhere !important;
            word-break: break-word !important;
          }
          /* Sticky kolonlar baskıda kaymalara yol açabildiğinden statik konuma alınır. */
          .schedule-print-section th,
          .schedule-print-section td {
            position: static !important;
          }
          .schedule-print-section,
          .schedule-print-section * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .schedule-print-section th,
          .schedule-print-section td {
            border: 1px solid #cbd5e1 !important;
            padding: 1px 2px !important;
            font-size: 7pt !important;
            line-height: 1.1 !important;
          }
          .schedule-print-section th { font-weight: bold !important; }
          .print-week-sep td { padding: 0.5px 2px !important; font-size: 6pt !important; }
          .print-zebra-row td {
            background-color: ${ZEBRA_COLORS.find(z => z.id === zebraColor)?.print || 'transparent'} !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .duty-counts-print-section th,
          .duty-counts-print-section td {
            border: 1px solid black !important;
            padding: 2px 4px !important;
            color: black !important;
            background-color: transparent !important;
            font-size: 8pt !important;
          }
          ${printMode === 'schedule' ? `
            @page { margin: 0.4cm; size: A4 landscape; }
            .duty-counts-print-section { display: none !important; }
            .schedule-print-section { page-break-inside: avoid; }
          ` : ''}
          ${printMode === 'dutyCounts' ? `
            @page { margin: 0.3cm; size: portrait; }
            .schedule-print-section { display: none !important; }
            .duty-counts-print-section { display: block !important; position: static !important; left: auto !important; top: auto !important; }
            .duty-counts-print-section table { table-layout: auto !important; }
          ` : ''}
        `}
      </style>

      {/* Absent Teachers Banner for Today */}
      {(() => {
        const todayAbsences = absences.filter(a => a.date === todayStr);
        if (todayAbsences.length === 0) return null;
        const absentTeacherNames = todayAbsences
          .map(a => teachers.find(t => t.id === a.teacherId)?.name)
          .filter(Boolean);
        if (absentTeacherNames.length === 0) return null;
        return (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4 print:hidden">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-amber-800 mb-1">Bugün Devamsız Öğretmenler</h3>
                <p className="text-sm text-amber-700">
                  {absentTeacherNames.join(', ')}
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      <TodayBoard
        schoolName={schoolInfo.okulAdi}
        locations={locations}
        teachers={teachers}
        assignments={assignments}
        absences={absences}
        substitutions={substitutions}
        vicePrincipalName={(date) => vpByDate[date]?.name}
        dutyHours={dutyHours}
      />
      <MyDutyList
        teachers={teachers}
        assignments={assignments}
        locations={locations}
        holidays={holidays}
        schoolName={schoolInfo.okulAdi}
        kurumKodu={kurumKodu}
        isAdmin={isAdmin}
        dutyHours={dutyHours}
      />

      {isAdmin && <>
      <ScheduleWarnings issues={scheduleIssues} />
      {dutyChanges.length > 0 && (
        <div className="app-card print:hidden">
          <div className="app-card-header">
            <h3 className="font-bold text-[#1a4a8a] text-sm">Değişiklik gerekçeleri</h3>
            <p className="text-xs text-blue-500 mt-0.5">Elle değiştirilen veya silinen nöbetler</p>
          </div>
          <ul className="p-4 space-y-1.5 text-sm text-slate-700">
            {[...dutyChanges].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8).map((change) => {
              const from = teachers.find(t => t.id === change.fromTeacherId)?.name || '—';
              const to = change.toTeacherId ? (teachers.find(t => t.id === change.toTeacherId)?.name || '—') : 'silindi';
              const place = locations.find(l => l.id === change.locationId)?.name || '';
              const reason = DUTY_CHANGE_REASONS.find(r => r.id === change.reason)?.label || change.reason;
              return (
                <li key={change.id}>
                  {format(parseISO(change.date), 'dd.MM.yyyy')} {place}: {from} → {to} · {reason} · {change.by}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {/* Screen UI controls */}
      <div className="app-card print:hidden">
        <div className="app-card-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#1a4a8a]">Nöbet Programı</h2>
            <p className="text-xs text-blue-500/80 mt-0.5">
              {dutyDates.length} nöbet günü
              {holidayRowCount > 0 ? ` · ${holidayRowCount} tatil` : ''}
              {yearLabel ? ` · ${yearLabel}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
          {isAdmin && onGoToGenerator && (
            <button onClick={onGoToGenerator} className="app-btn app-btn-primary">
              <Plus className="w-4 h-4" /> Yeni Program
            </button>
          )}
          {isAdmin && onUndo && (
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="app-btn app-btn-blue disabled:opacity-40"
              title="Son nöbet değişikliğini geri al"
            >
              <Undo2 className="w-4 h-4" /> Geri al
            </button>
          )}
          {isAdmin && setAssignments && (
            <div className="inline-flex items-center bg-slate-50 border border-slate-200 rounded-lg overflow-hidden" title="Tüm öğretmenleri yer/gün rotasyonuyla kaydır">
              <button
                onClick={() => shiftTeachersByOne('backward')}
                className="px-2 py-1.5 hover:bg-slate-100 text-slate-600 transition-colors flex items-center gap-1 text-xs"
                title="Öğretmenleri 1 yer geri kaydır"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Yer
              </button>
              <button
                onClick={() => shiftTeachersByOne('forward')}
                className="px-2 py-1.5 hover:bg-slate-100 text-slate-600 border-l border-slate-200 transition-colors flex items-center gap-1 text-xs"
                title="Öğretmenleri 1 yer ileri kaydır"
              >
                Yer
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => shiftDaysByOne('backward')}
                className="px-2 py-1.5 hover:bg-slate-100 text-slate-600 border-l border-slate-200 transition-colors flex items-center gap-1 text-xs"
                title="Günleri 1 geri kaydır"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Gün
              </button>
              <button
                onClick={() => shiftDaysByOne('forward')}
                className="px-2 py-1.5 hover:bg-slate-100 text-slate-600 border-l border-slate-200 transition-colors flex items-center gap-1 text-xs"
                title="Günleri 1 ileri kaydır"
              >
                Gün
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="relative" ref={colorPickerRef}>
            <button
              onClick={() => { setColorPickerOpen(o => !o); setPopover(null); }}
              className="bg-surface border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors shadow-sm"
              title="Yazdırma satır rengi"
            >
              <Palette className="w-4 h-4" />
              <span className="hidden md:inline">Satır Rengi</span>
              <span
                className="inline-block w-3 h-3 rounded-sm border border-slate-300"
                style={{ background: ZEBRA_COLORS.find(z => z.id === zebraColor)?.swatch }}
              />
            </button>
            {colorPickerOpen && (
              <div className="absolute right-0 mt-1 bg-surface border border-slate-200 rounded-lg shadow-lg p-2 z-40 w-44">
                {ZEBRA_COLORS.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setZebraColor(c.id); setColorPickerOpen(false); }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-slate-100 ${
                      zebraColor === c.id ? 'bg-slate-100 font-medium' : ''
                    }`}
                  >
                    <span
                      className="inline-block w-4 h-4 rounded-sm border border-slate-300"
                      style={{ background: c.swatch }}
                    />
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {isAdmin && setAssignments && (
            <button onClick={() => setShowCancelConfirm(true)} className="app-btn app-btn-red">
              <Trash2 className="w-4 h-4" /> Sil
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowNotificationModal(true)} className="app-btn app-btn-green-outline">
              <Send className="w-4 h-4" /> Bildirim
            </button>
          )}
          <button onClick={() => openPrintPreview('.schedule-print-section', 'Nöbet çizelgesi', 'landscape')} className="app-btn app-btn-blue" title="Çizelgeyi yazdırmadan önce önizle">
            <Printer className="w-4 h-4" /> Yazdır
          </button>
          <button onClick={handleExportScheduleToExcel} className="app-btn app-btn-blue" title="Çizelgeyi her haftası ayrı sayfa olacak şekilde Excel (.xlsx) olarak indir">
            <FileSpreadsheet className="w-4 h-4" /> Yazdır (Excel)
          </button>
          <button onClick={handlePrintDutyCounts} className="app-btn app-btn-green-outline">
            <FileSpreadsheet className="w-4 h-4" /> Sayılar Excel
          </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4 print:block">
      {/* Schedule Table - printable for 'schedule' mode */}
      <div className="schedule-print-section print-color-exact app-card overflow-hidden print:shadow-none print:border-none print:overflow-visible">
        
        {/* Print Header */}
        <div className="hidden print:block text-center font-bold print-header-block">
          <div>T.C.</div>
          {schoolInfo.valilik && <div>{schoolInfo.valilik.toLocaleUpperCase('tr-TR')} VALİLİĞİ</div>}
          {schoolInfo.kaymakamlik && <div>{schoolInfo.kaymakamlik.toLocaleUpperCase('tr-TR')} KAYMAKAMLIĞI</div>}
          {schoolInfo.okulAdi && <div>{schoolInfo.okulAdi.toLocaleUpperCase('tr-TR')}</div>}
          {yearLabel && <div style={{ fontSize: '9pt', marginTop: '2px' }}>{yearLabel}</div>}
        </div>

        <div className="hidden print:block text-center font-bold print-title-block">
          {schedulePrintTitle}
        </div>

        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-left border-collapse print:text-[8pt]">
            <thead>
              <tr className="border-b border-slate-200">
                {(() => {
                  const dateHeader = getScheduleColumnHeader(0);
                  return (
                    <th
                      className={`py-4 px-6 print:py-0.5 print:px-1 font-semibold whitespace-nowrap sticky left-0 z-10 border-r border-slate-200 print:border-slate-300 schedule-th-transition ${dateHeader.bg} ${dateHeader.text}`}
                    >
                      Tarih / Gün
                    </th>
                  );
                })()}
                {locations.map((location, locIndex) => {
                  const col = getScheduleColumnHeader(locIndex + 1);
                  return (
                    <th
                      key={location.id}
                      className={`py-4 px-6 print:py-0.5 print:px-1 font-semibold min-w-[150px] print:min-w-0 print:border-slate-300 schedule-th-transition ${col.bg} ${col.text}`}
                    >
                      {location.name}
                    </th>
                  );
                })}
                {schoolInfo.mudurYardimcilari.length > 0 && (() => {
                  const vpCol = getScheduleColumnHeader(locations.length + 1);
                  return (
                    <th
                      className={`py-4 px-6 print:py-0.5 print:px-1 font-semibold min-w-[150px] print:min-w-0 print:border-slate-300 schedule-th-transition ${vpCol.bg} ${vpCol.text}`}
                    >
                      Nöbetçi Md. Yrd.
                    </th>
                  );
                })()}
              </tr>
            </thead>
            <tbody className="border-b border-slate-200">
              {scheduleRows.map((row, index) => {
                const date = row.date;
                const parsedDate = parseISO(date);
                const formattedDate = format(parsedDate, 'dd.MM.yyyy');
                const dayName = format(parsedDate, 'EEEE', { locale: tr });
                const weekNum = getISOWeek(parsedDate);

                const prevDate = index > 0 ? parseISO(scheduleRows[index - 1].date) : null;
                const prevWeek = prevDate ? getISOWeek(prevDate) : null;
                const isNewWeek = index === 0 || weekNum !== prevWeek;

                const assignedVp = row.type === 'duty' ? (vpByDate[date] ?? null) : null;
                const vpCount = schoolInfo.mudurYardimcilari.length;

                const colCount = locations.length + 1 + (vpCount > 0 ? 1 : 0);

                if (row.type === 'holiday') {
                  return (
                    <React.Fragment key={date}>
                      {isNewWeek && (
                        <tr className="print-week-sep">
                          <td
                            colSpan={colCount}
                            className={`py-2 px-6 print:py-0 print:px-1 text-xs font-bold tracking-wide bg-gradient-to-r ${getWeekHeaderStyle(weekNum)} animate-week-header transition-all duration-500 ${
                              index > 0 ? 'border-t-[3px] border-slate-300 print:border-t-[2px]' : ''
                            }`}
                          >
                            {weekNum}. HAFTA
                          </td>
                        </tr>
                      )}
                      <tr className="border-b border-rose-200 bg-rose-50/80 print:bg-rose-50">
                        <td className="py-3 px-6 print:py-0.5 print:px-1 whitespace-nowrap sticky left-0 bg-rose-50/80 print:bg-rose-50 z-10 border-r border-rose-200">
                          <div className="font-medium text-rose-900 print:leading-tight">{formattedDate}</div>
                          <div className="text-sm text-rose-600 print:text-[7pt] print:leading-tight">{dayName}</div>
                        </td>
                        <td
                          colSpan={locations.length + (vpCount > 0 ? 1 : 0)}
                          className="py-3 px-6 print:py-1 print:px-1 text-center font-semibold text-rose-800"
                        >
                          {row.holidayName}
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                }

                return (
                  <React.Fragment key={date}>
                    {isNewWeek && (
                      <tr className="print-week-sep">
                        <td
                          colSpan={colCount}
                          className={`py-2 px-6 print:py-0 print:px-1 text-xs font-bold tracking-wide bg-gradient-to-r ${getWeekHeaderStyle(weekNum)} animate-week-header transition-all duration-500 ${
                            index > 0 ? 'border-t-[3px] border-slate-300 print:border-t-[2px]' : ''
                          }`}
                        >
                          {weekNum}. HAFTA
                        </td>
                      </tr>
                    )}
                    <tr
                      onClick={() => setSelectedDate(date)}
                      className={`hover:bg-blue-50/40 transition-colors border-b border-slate-200 cursor-pointer ${index % 2 === 1 ? 'print-zebra-row' : ''} ${selectedDate === date ? 'bg-blue-50/60 ring-1 ring-inset ring-blue-200' : ''}`}
                    >
                      <td className="py-4 px-6 print:py-0.5 print:px-1 whitespace-nowrap sticky left-0 bg-surface z-10 border-r border-slate-200">
                        <div className="font-medium text-slate-900 print:leading-tight">{formattedDate}</div>
                        <div className="text-sm text-slate-500 print:text-[7pt] print:leading-tight">{dayName}</div>
                      </td>
                      {locations.map((location) => {
                        const cellEntries = scheduleData.data[date]?.[location.id] || [];
                        return (
                          <td key={location.id} className="py-4 px-6 print:py-0.5 print:px-1 align-top">
                            {cellEntries.length > 0 ? (
                              <div className="flex flex-col gap-1 print:gap-0">
                                {cellEntries.map(({ teacher, assignment }) => {
                                  const isDouble = !!assignment.isDoubleDuty;
                                  const canEdit = isAdmin && !!setAssignments;
                                  return (
                                    <button
                                      key={assignment.id}
                                      type="button"
                                      onClick={(e) => {
                                        if (!canEdit) return;
                                        e.stopPropagation();
                                        setPopover({
                                          assignmentId: assignment.id,
                                          teacherId: teacher.id,
                                          date,
                                          locationId: location.id,
                                        });
                                      }}
                                      className={`text-left inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-sm font-medium border transition-colors print:inline-flex print:py-0 print:px-1 print:text-[8pt] print:leading-tight ${
                                        isDouble
                                          ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 print:bg-amber-50 print:text-amber-900 print:border-amber-300'
                                          : teacherColorMap[teacher.id] || 'teacher-chip-blue'
                                      } ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}
                                      title={canEdit ? 'Düzenlemek için tıkla' : ''}
                                    >
                                      <span>{teacher.name}</span>
                                      {isDouble && (
                                        <span className="text-[10px] font-bold bg-amber-500 text-white px-1 rounded-sm print:bg-amber-500 print:text-white print:px-0.5 print:text-[7pt]">
                                          2x
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-slate-300 text-sm print:text-slate-400">-</span>
                            )}
                          </td>
                        );
                      })}
                      {assignedVp && (
                        <td className="py-4 px-6 print:py-0.5 print:px-1 font-medium text-slate-700">
                          {assignedVp.name}
                        </td>
                      )}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {vpDutyStats.length > 0 && (
          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 print:hidden">
            <p className="text-xs font-medium text-slate-600 mb-2">Müdür yardımcısı nöbet günleri (yıl içi dağılım)</p>
            <div className="flex flex-wrap gap-2">
              {vpDutyStats.map(({ vp, count }) => (
                <span
                  key={vp.id}
                  className="text-xs bg-white border border-slate-200 text-slate-700 px-2.5 py-1 rounded-full"
                >
                  {vp.name}: <strong>{count}</strong> gün
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Print Footer */}
        <div className="hidden print:block print-footer-block">
          {hasDoubleDuty && (
            <div className="mb-2" style={{ border: '1px solid #000', padding: '3px 6px', background: '#fef3c7' }}>
              <strong>NOT:</strong> Yanında "<strong>2x</strong>" işareti bulunan öğretmenler aynı gün <strong>çift nöbet</strong> tutmaktadır.
            </div>
          )}
          <h4 className="font-bold mb-1 underline">NÖBETÇİ ÖĞRETMEN GÖREV TALİMATNAMESİ</h4>
          <ol className="list-decimal pl-4 space-y-0 mb-4 text-justify">
            <li>Derse başlamadan 20 dk. önce okula gelir ve ders bitiminden 20 dk. sonra okuldan ayrılır.</li>
            <li>Nöbetçi öğretmen sabah ilk olarak derslikleri kontrol eder, bölümleri denetler ve okulun eğitim öğretime hazır olup olmadığını nöbet defterine yazarak giriş imzasını atar.</li>
            <li>Nöbetçi öğretmen, o gün gelmeyen öğretmenleri tespit ederek ilgili müdür yardımcısına bildirir, boş geçen derslere girerek defteri "Nöbetçi Öğretmen" yazarak imzalar.</li>
            <li>Nöbeti sonunda nöbet defterine nöbeti ile ilgili raporu yazar ve imzalar.</li>
          </ol>

          {uniqueTeachersInSchedule.length > 0 && (
            <div style={{ marginTop: '12px', pageBreakInside: 'avoid' }}>
              <h4 className="font-bold mb-1 underline">NÖBET PROGRAMI İMZA ÇİZELGESİ</h4>
              <p style={{ fontSize: '7pt', marginBottom: '4px' }}>Yukarıdaki nöbet programını okudum, anladım ve kabul ettim.</p>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ border: '1px solid #000', padding: '2px 6px', background: '#f0f0f0', width: '30px', fontSize: '7pt' }}>#</th>
                    <th style={{ border: '1px solid #000', padding: '2px 6px', background: '#f0f0f0', textAlign: 'left', fontSize: '7pt' }}>Öğretmen Adı Soyadı</th>
                    <th style={{ border: '1px solid #000', padding: '2px 6px', background: '#f0f0f0', width: '120px', fontSize: '7pt' }}>İmza</th>
                  </tr>
                </thead>
                <tbody>
                  {uniqueTeachersInSchedule.map((teacher, i) => (
                    <tr key={teacher.id}>
                      <td style={{ border: '1px solid #000', padding: '2px 6px', textAlign: 'center', fontSize: '7pt' }}>{i + 1}</td>
                      <td style={{ border: '1px solid #000', padding: '2px 6px', fontSize: '7pt' }}>{teacher.name}</td>
                      <td style={{ border: '1px solid #000', padding: '2px 6px', height: '20px' }}></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end items-start mt-4">
            <div className="text-center">
              <div className="font-bold">{schoolInfo.okulMuduru}</div>
              <div>Okul Müdürü</div>
            </div>
          </div>
        </div>

      </div>

      {/* Sağ panel — seçili gün & bilgiler */}
      <div className="space-y-4 print:hidden">
        {selectedDayDetail && (
          <div className="app-card">
            <div className="app-card-header">
              <h3 className="font-bold text-[#1a4a8a] text-sm">Seçili Gün Detayı</h3>
              <p className="text-xs text-blue-500 mt-0.5 capitalize">
                {selectedDayDetail.formatted} — {selectedDayDetail.dayName}
              </p>
            </div>
            <div className="p-4 space-y-3">
              {selectedDayDetail.entries.map(({ location, teacher }, i) => (
                <div key={`${location}-${teacher.id}-${i}`} className="flex gap-3 items-start">
                  <div className="w-1 self-stretch rounded-full" style={{ minHeight: 32, background: getTeacherBarColor(teacher.id, teacherColorMap) }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-blue-400 font-semibold uppercase">{location}</div>
                    <div className="text-sm font-semibold text-slate-800">{teacher.name}</div>
                    <div className="text-xs text-slate-500">{getTeacherSubject(teacher)}</div>
                  </div>
                </div>
              ))}
              {selectedDayDetail.vp && (
                <div className="pt-2 border-t border-blue-100 text-sm">
                  <span className="text-blue-500 text-xs">Nöbetçi Md. Yrd.</span>
                  <div className="font-semibold text-slate-800">{selectedDayDetail.vp.name}</div>
                </div>
              )}
              {selectedDayDetail.entries.length === 0 && (
                <p className="text-sm text-slate-400">Bu gün için nöbet ataması yok.</p>
              )}
            </div>
          </div>
        )}

        <div className="app-card">
          <div className="app-card-header">
            <h3 className="font-bold text-[#1a4a8a] text-sm">Bilgiler</h3>
          </div>
          <div className="p-4 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Toplam Öğretmen</span>
              <span className="font-bold text-[#1a4a8a]">{teachers.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Nöbet Yeri</span>
              <span className="font-bold text-[#1a4a8a]">{locations.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Bu Hafta Nöbet Günü</span>
              <span className="font-bold text-[#1a4a8a]">{weeklyDutyCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Ders Yılı</span>
              <span className="font-bold text-[#1a4a8a] text-xs">{yearLabel || activeYear || '—'}</span>
            </div>
          </div>
        </div>

        <div className="app-card p-4 flex gap-2 items-start">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-500 leading-relaxed">
            Bu program, okul yönetim kriterlerine göre oluşturulmuştur. Nöbet dağılımı adil ve dengeli olacak şekilde planlanmıştır.
          </p>
        </div>
      </div>
      </div>

      {/* Nöbet Listesi — öğretmen kartları */}
      {uniqueTeachersInSchedule.length > 0 && (
        <div className="app-card print:hidden">
          <div className="app-card-header">
            <h3 className="font-bold text-[#1a4a8a] text-sm">Nöbet Listesi</h3>
          </div>
          <div className="p-4 flex flex-wrap gap-3">
            {uniqueTeachersInSchedule.map((teacher) => {
              const duties = assignments
                .filter(a => a.teacherId === teacher.id && !holidayDateSet.has(a.date))
                .map(a => a.date)
                .sort()
                .map(d => format(parseISO(d), 'dd.MM'));
              const chipClass = teacherColorMap[teacher.id] || 'teacher-chip-blue';
              return (
                <div key={teacher.id} className={`rounded-xl border px-3 py-2 min-w-[140px] ${chipClass}`}>
                  <div className="font-semibold text-sm">{teacher.name}</div>
                  <div className="text-[11px] opacity-75">{getTeacherSubject(teacher)}</div>
                  <div className="text-[10px] mt-1 opacity-60">{duties.slice(0, 5).join(', ')}{duties.length > 5 ? '…' : ''}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Duty Counts Print Section */}
      <div className="duty-counts-print-section" style={{ display: printMode === 'dutyCounts' ? 'block' : 'none' }}>
        <div className="text-center font-bold" style={{ marginBottom: '12px' }}>
          <div>T.C.</div>
          {schoolInfo.valilik && <div>{schoolInfo.valilik.toLocaleUpperCase('tr-TR')} VALİLİĞİ</div>}
          {schoolInfo.kaymakamlik && <div>{schoolInfo.kaymakamlik.toLocaleUpperCase('tr-TR')} KAYMAKAMLIĞI</div>}
          {schoolInfo.okulAdi && <div>{schoolInfo.okulAdi.toLocaleUpperCase('tr-TR')}</div>}
          <div style={{ marginTop: '8px', fontSize: '14pt' }}>ÖĞRETMEN NÖBET SAYILARI</div>
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #000', padding: '4px 8px', background: '#f0f0f0', width: '40px' }}>#</th>
              <th style={{ border: '1px solid #000', padding: '4px 8px', background: '#f0f0f0', textAlign: 'left' }}>Öğretmen Adı</th>
              <th style={{ border: '1px solid #000', padding: '4px 8px', background: '#f0f0f0', width: '80px' }}>Nöbet Sayısı</th>
            </tr>
          </thead>
          <tbody>
            {dutyCounts.map((item, i) => (
              <tr key={i}>
                <td style={{ border: '1px solid #000', padding: '4px 8px', textAlign: 'center' }}>{i + 1}</td>
                <td style={{ border: '1px solid #000', padding: '4px 8px' }}>{item.name}</td>
                <td style={{ border: '1px solid #000', padding: '4px 8px', textAlign: 'center', fontWeight: 'bold' }}>{item.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: 'right', marginTop: '40px' }}>
          <div style={{ fontWeight: 'bold' }}>{schoolInfo.okulMuduru || ''}</div>
          <div>Okul Müdürü</div>
        </div>
      </div>

      {/* Duty Counts Summary on screen */}
      {dutyCounts.length > 0 && (
        <div className="bg-surface rounded-xl shadow-sm border border-slate-200 overflow-hidden print:hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-violet-100 p-2 rounded-lg text-violet-600">
                <BarChart3 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">Öğretmen Nöbet Sayıları</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {yearLabel ? `${yearLabel} — ` : ''}{dutyCounts.length} öğretmen, toplam {assignments.length} nöbet
                </p>
              </div>
            </div>
            <button
              onClick={() => openPrintPreview('.duty-counts-print-section', 'Öğretmen nöbet sayıları', 'portrait')}
              className="bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              Yazdır
            </button>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {dutyCounts.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50/50">
                  <span className="text-sm text-slate-700 truncate mr-2">{item.name}</span>
                  <span className="bg-violet-100 text-violet-700 text-sm font-bold px-2 py-0.5 rounded-md flex-shrink-0">
                    {item.count}
                  </span>
                </div>
              ))}
            </div>

            {locationDistribution.length > 0 && (
              <div className="mt-5 pt-5 border-t border-slate-100 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDistributionDetail(prev => prev === 'location' ? null : 'location')}
                    className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                      showDistributionDetail === 'location'
                        ? 'bg-violet-100 text-violet-800 border-violet-200'
                        : 'bg-surface text-slate-600 border-slate-200 hover:border-violet-200'
                    }`}
                  >
                    Nöbet yeri dağılımı
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDistributionDetail(prev => prev === 'month' ? null : 'month')}
                    className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                      showDistributionDetail === 'month'
                        ? 'bg-violet-100 text-violet-800 border-violet-200'
                        : 'bg-surface text-slate-600 border-slate-200 hover:border-violet-200'
                    }`}
                  >
                    Aylık dağılım
                  </button>
                </div>

                {showDistributionDetail === 'location' && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600">
                          <th className="text-left p-2 border-b border-slate-200">Öğretmen</th>
                          {locations.map(loc => (
                            <th key={loc.id} className="p-2 border-b border-slate-200 text-center whitespace-nowrap">{loc.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {locationDistribution.map(row => (
                          <tr key={row.teacherId} className="border-b border-slate-100">
                            <td className="p-2 font-medium text-slate-700 whitespace-nowrap">{row.teacherName}</td>
                            {locations.map(loc => {
                              const entry = row.locations.find(l => l.locationId === loc.id);
                              return (
                                <td key={loc.id} className="p-2 text-center text-slate-600">
                                  {entry?.count ?? '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {showDistributionDetail === 'month' && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600">
                          <th className="text-left p-2 border-b border-slate-200">Öğretmen</th>
                          {Array.from(new Set(monthDistribution.flatMap(r => r.months.map(m => m.monthKey)))).sort().map(monthKey => (
                            <th key={monthKey} className="p-2 border-b border-slate-200 text-center whitespace-nowrap">
                              {format(parseISO(`${monthKey}-01`), 'MMM yyyy', { locale: tr })}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {monthDistribution.map(row => {
                          const monthKeys = Array.from(new Set(monthDistribution.flatMap(r => r.months.map(m => m.monthKey)))).sort();
                          return (
                            <tr key={row.teacherId} className="border-b border-slate-100">
                              <td className="p-2 font-medium text-slate-700 whitespace-nowrap">{row.teacherName}</td>
                              {monthKeys.map(monthKey => {
                                const entry = row.months.find(m => m.monthKey === monthKey);
                                return (
                                  <td key={monthKey} className="p-2 text-center text-slate-600">
                                    {entry?.count ?? '—'}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Schedule Archives */}
      {scheduleArchives.length > 0 && (
        <ArchiveSection
          archives={scheduleArchives}
          teachers={teachers}
          locations={locations}
          schoolInfo={schoolInfo}
          holidays={holidays}
          isAdmin={isAdmin}
          onDelete={isAdmin && setScheduleArchives ? (archiveId) => {
            setScheduleArchives(prev => prev.filter(a => a.id !== archiveId));
          } : undefined}
        />
      )}

      </>}

      {/* Smart popover: cell info + actions */}
      {popover && popoverInfo && (
        <div className="fixed inset-0 z-40 flex items-start justify-center pt-24 px-4 print:hidden" onClick={() => setPopover(null)}>
          <div
            ref={popoverRef}
            className="bg-surface rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500">
                  {format(parseISO(popover.date), 'dd.MM.yyyy EEEE', { locale: tr })} —{' '}
                  {locations.find(l => l.id === popover.locationId)?.name || ''}
                </div>
                <div className="text-base font-semibold text-slate-800">{popoverInfo.teacher.name}</div>
                {(() => {
                  const last = dutyChanges
                    .filter(c => c.assignmentId === popover.assignmentId)
                    .sort((a, b) => b.at.localeCompare(a.at))[0];
                  if (!last) return null;
                  const reason = DUTY_CHANGE_REASONS.find(r => r.id === last.reason)?.label;
                  return <div className="text-xs text-slate-500">Son gerekçe: {reason} · {last.by}</div>;
                })()}
              </div>
              <button onClick={() => setPopover(null)} className="text-slate-400 hover:text-slate-700 p-1.5 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-200">
                  <div className="text-[11px] text-slate-500">O gün ders</div>
                  <div className="text-lg font-bold text-slate-700">{popoverInfo.lessonCount}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-200">
                  <div className="text-[11px] text-slate-500">Bu hafta nöbet</div>
                  <div className="text-lg font-bold text-slate-700">{popoverInfo.weekDutyCount}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-200">
                  <div className="text-[11px] text-slate-500">Toplam nöbet</div>
                  <div className="text-lg font-bold text-slate-700">{popoverInfo.totalDuties}</div>
                </div>
              </div>

              <div className="space-y-1.5">
                {popoverInfo.dayConflict && (
                  <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1.5 rounded">
                    <span className="text-xs">⚠️ Bu öğretmen tercih ayarlarına göre {format(parseISO(popover.date), 'EEEE', { locale: tr })} günü nöbet tutmamalı.</span>
                  </div>
                )}
                {popoverInfo.lessonCount >= 8 && (
                  <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1.5 rounded">
                    <span className="text-xs">⚠️ O gün {popoverInfo.lessonCount} dersi var (tam gün).</span>
                  </div>
                )}
                {popoverInfo.lessonCount === 0 && (
                  <div className="flex items-center gap-2 text-sky-700 bg-sky-50 border border-sky-200 px-2 py-1.5 rounded">
                    <span className="text-xs">ℹ️ O gün hiç dersi yok.</span>
                  </div>
                )}
                {popoverInfo.sameDay.length > 0 && (
                  <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1.5 rounded">
                    <span className="text-xs">⚠️ Aynı gün başka nöbet(ler)i var ({popoverInfo.sameDay.length}). Çift nöbet sayılır.</span>
                  </div>
                )}
                {popoverInfo.sameWeek.length >= 2 && (
                  <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1.5 rounded">
                    <span className="text-xs">⚠️ Bu hafta {popoverInfo.sameWeek.length + 1} nöbeti var.</span>
                  </div>
                )}
              </div>

              {popoverInfo.currentAssignment && (
                <button
                  onClick={() => toggleDoubleDuty(popoverInfo.currentAssignment!.id)}
                  className={`w-full px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center gap-2 ${
                    popoverInfo.currentAssignment.isDoubleDuty
                      ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
                      : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  {popoverInfo.currentAssignment.isDoubleDuty ? 'Çift Nöbet İşaretini Kaldır' : 'Çift Nöbet Olarak İşaretle'}
                </button>
              )}

              <div>
                <div className="text-xs font-medium text-slate-600 mb-1.5">Değişiklik gerekçesi</div>
                <select
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value as DutyChangeReason | '')}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-surface"
                >
                  <option value="">Gerekçe seçin</option>
                  {DUTY_CHANGE_REASONS.map((reason) => (
                    <option key={reason.id} value={reason.id}>{reason.label}</option>
                  ))}
                </select>
              </div>

              {popoverInfo.candidateTeachers.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-600 mb-1.5">Bu öğretmeni başkasıyla değiştir:</div>
                  <select
                    disabled={!editReason}
                    onChange={(e) => {
                      if (e.target.value) requestReplace(popover.assignmentId, e.target.value);
                    }}
                    defaultValue=""
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-surface disabled:opacity-50"
                  >
                    <option value="">Bir öğretmen seçin...</option>
                    {popoverInfo.candidateTeachers.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                onClick={() => removeAssignment(popover.assignmentId)}
                disabled={!editReason}
                className="w-full px-3 py-2 rounded-lg text-sm font-medium border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                Bu Nöbeti Sil
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingReplace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm print:hidden">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-lg font-semibold text-slate-800">Nöbet değişikliği</h3>
            </div>
            <div className="p-6">
              <p className="text-slate-700 mb-3">
                <span className="font-semibold">{pendingReplace.teacherName}</span> bu güne yazılmadan önce:
              </p>
              <ul className="mb-6 space-y-1 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {pendingReplace.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPendingReplace(null)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={() => replaceAssignmentTeacher(pendingReplace.assignmentId, pendingReplace.teacherId)}
                  className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 rounded-lg font-medium transition-colors"
                >
                  Yine de değiştir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Schedule Confirmation */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm print:hidden">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-lg font-semibold text-slate-800">Çizelgeyi İptal Et</h3>
            </div>
            <div className="p-6">
              <p className="text-slate-600 mb-6">
                Mevcut nöbet çizelgesi tamamen silinecek. Sonradan Geri al ile dönebilirsiniz.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  onClick={handleCancelSchedule}
                  className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Evet, İptal Et
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notification Modal */}
      {showNotificationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm print:hidden">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-800">Bildirimleri Gönder</h3>
              <button 
                onClick={() => { setShowNotificationModal(false); setShowConfirm(false); }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                disabled={notificationStatus === 'sending'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              {notificationStatus === 'success' ? (
                <div className="text-center py-6">
                  <div className="bg-emerald-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                  </div>
                  <h4 className="text-lg font-medium text-slate-800 mb-2">E-postalar Gönderildi!</h4>
                  {emailResult && (
                    <div className="space-y-1 text-sm">
                      <p className="text-emerald-600 font-medium">{emailResult.sent} e-posta başarıyla gönderildi.</p>
                      {emailResult.failed > 0 && (
                        <p className="text-red-500">{emailResult.failed} e-posta gönderilemedi.</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {emailError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                      {emailError}
                    </div>
                  )}

                  {!schoolInfo.gmailEmail || !schoolInfo.gmailAppPassword ? (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                      <p className="text-sm text-amber-700">
                        Gmail ayarları yapılmamış. <strong>Ayarlar</strong> sayfasından Gmail adresinizi ve uygulama şifrenizi girmeniz gerekiyor.
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="text-slate-600 mb-4">
                        Nöbet programı, e-posta adresi kayıtlı öğretmenlere <strong>{schoolInfo.gmailEmail}</strong> adresinden gönderilecektir.
                      </p>

                      <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-4">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-slate-600">E-posta gönderilecek:</span>
                          <span className="font-semibold text-emerald-600">{teachersWithDuties.length} öğretmen</span>
                        </div>
                        {teachersWithoutEmail.length > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-600">E-postası olmayan:</span>
                            <span className="font-semibold text-amber-600">{teachersWithoutEmail.length} öğretmen</span>
                          </div>
                        )}
                      </div>

                      {teachersWithoutEmail.length > 0 && (
                        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <p className="text-xs text-amber-700 mb-1 font-medium">E-postası olmayan öğretmenler:</p>
                          <p className="text-xs text-amber-600">
                            {teachersWithoutEmail.map(t => t.name).join(', ')}
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {showConfirm ? (
                    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-2">
                      <p className="text-sm font-semibold text-amber-800 mb-3">
                        {teachersWithDuties.length} öğretmene e-posta göndermek istediğinize emin misiniz?
                      </p>
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => setShowConfirm(false)}
                          className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors text-sm"
                        >
                          Vazgeç
                        </button>
                        <button
                          onClick={handleSendNotifications}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
                        >
                          <Send className="w-4 h-4" />
                          Evet, Gönder
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => { setShowNotificationModal(false); setEmailError(null); setShowConfirm(false); }}
                        className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
                        disabled={notificationStatus === 'sending'}
                      >
                        İptal
                      </button>
                      <button
                        onClick={handleSendNotifications}
                        disabled={notificationStatus === 'sending' || !schoolInfo.gmailEmail || !schoolInfo.gmailAppPassword || teachersWithDuties.length === 0}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {notificationStatus === 'sending' ? (
                          <span className="flex items-center gap-2">
                            <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Gönderiliyor...
                          </span>
                        ) : (
                          <>
                            <Send className="w-4 h-4" />
                            E-postaları Gönder
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ArchiveItem: React.FC<{
  archive: ScheduleArchive;
  teachers: Teacher[];
  locations: Location[];
  schoolInfo: SchoolInfo;
  holidays: Holiday[];
  isExpanded: boolean;
  onToggle: () => void;
  onDelete?: (id: string) => void;
  confirmDeleteId: string | null;
  setConfirmDeleteId: React.Dispatch<React.SetStateAction<string | null>>;
}> = ({
  archive,
  teachers,
  locations,
  schoolInfo,
  holidays,
  isExpanded,
  onToggle,
  onDelete,
  confirmDeleteId,
  setConfirmDeleteId,
}) => {
  const archiveHolidaySet = useMemo(() => new Set(holidays.map(h => h.date)), [holidays]);

  const archiveScheduleData = useMemo(() => {
    const data: Record<string, Record<string, Teacher[]>> = {};
    const dates = new Set<string>();
    archive.assignments.forEach((a) => {
      if (archiveHolidaySet.has(a.date)) return;
      dates.add(a.date);
      if (!data[a.date]) data[a.date] = {};
      if (!data[a.date][a.locationId]) data[a.date][a.locationId] = [];
      const t = teachers.find(t2 => t2.id === a.teacherId);
      if (t) data[a.date][a.locationId].push(t);
    });
    return { data, sortedDates: Array.from(dates).sort() };
  }, [archive.assignments, teachers, archiveHolidaySet]);

  const archiveSchoolDays = schoolInfo.settings?.schoolDays?.length ? schoolInfo.settings.schoolDays : [1, 2, 3, 4, 5];
  const archiveRows = useMemo(
    () => buildScheduleRows(archive.assignments, holidays, archiveSchoolDays),
    [archive.assignments, holidays, archiveSchoolDays.join(',')],
  );

  const archiveDutyDates = useMemo(
    () => archiveRows.filter(r => r.type === 'duty').map(r => r.date),
    [archiveRows],
  );

  const archiveVps = archive.mudurYardimcilari ?? schoolInfo.mudurYardimcilari;

  const archiveVpByDate = useMemo(
    () => assignVicePrincipalsToDates(archiveDutyDates, archiveVps),
    [archiveDutyDates, archiveVps],
  );

  const archivedDate = new Date(archive.archivedAt);
  const archivedStr = format(archivedDate, 'dd.MM.yyyy HH:mm', { locale: tr });

  return (
    <div>
      <div
        className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <Archive className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <div>
            <span className="font-medium text-slate-800">{archive.label}</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-slate-500">
                {archive.assignments.length} nöbet | Arşivlenme: {archivedStr}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onDelete && (
            confirmDeleteId === archive.id ? (
              <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => { onDelete(archive.id); setConfirmDeleteId(null); }}
                  className="text-xs bg-red-600 text-white px-2.5 py-1 rounded-md font-medium hover:bg-red-700 transition-colors"
                >
                  Sil
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="text-xs bg-slate-200 text-slate-700 px-2.5 py-1 rounded-md font-medium hover:bg-slate-300 transition-colors"
                >
                  İptal
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(archive.id); }}
                className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                title="Arşivi Sil"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )
          )}
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
        </div>
      </div>
      {isExpanded && (
        <div className="px-6 pb-4">
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="py-2 px-3 font-semibold text-slate-600 whitespace-nowrap border-r border-slate-200">Tarih / Gün</th>
                  {locations.map(loc => (
                    <th key={loc.id} className="py-2 px-3 font-semibold text-slate-600 border-r border-slate-200 last:border-r-0">{loc.name}</th>
                  ))}
                  {archiveVps.length > 0 && (
                    <th className="py-2 px-3 font-semibold text-slate-600">Nöbetçi Md. Yrd.</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {archiveRows.map(row => {
                  const date = row.date;
                  const parsed = parseISO(date);
                  if (row.type === 'holiday') {
                    return (
                      <tr key={date} className="border-b border-rose-100 bg-rose-50/60">
                        <td className="py-2 px-3 whitespace-nowrap border-r border-rose-200">
                          <div className="font-medium text-rose-800">{format(parsed, 'dd.MM.yyyy')}</div>
                          <div className="text-xs text-rose-500">{format(parsed, 'EEEE', { locale: tr })}</div>
                        </td>
                        <td
                          colSpan={locations.length + (archiveVps.length > 0 ? 1 : 0)}
                          className="py-2 px-3 text-xs font-semibold text-rose-700 text-center"
                        >
                          {row.holidayName}
                        </td>
                      </tr>
                    );
                  }
                  const assignedVp = archiveVpByDate[date];
                  return (
                    <tr key={date} className="border-b border-slate-100 last:border-b-0">
                      <td className="py-2 px-3 whitespace-nowrap border-r border-slate-200">
                        <div className="font-medium text-slate-700">{format(parsed, 'dd.MM.yyyy')}</div>
                        <div className="text-xs text-slate-400">{format(parsed, 'EEEE', { locale: tr })}</div>
                      </td>
                      {locations.map(loc => {
                        const assigned = archiveScheduleData.data[date]?.[loc.id] || [];
                        return (
                          <td key={loc.id} className="py-2 px-3 border-r border-slate-200 last:border-r-0">
                            {assigned.length > 0 ? (
                              <div className="flex flex-col gap-0.5">
                                {assigned.map((t, ti) => (
                                  <span key={ti} className="text-xs font-medium text-slate-700">{t.name}</span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-300 text-xs">-</span>
                            )}
                          </td>
                        );
                      })}
                      {assignedVp && (
                        <td className="py-2 px-3 text-xs font-medium text-slate-700">{assignedVp.name}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

function ArchiveSection({
  archives,
  teachers,
  locations,
  schoolInfo,
  holidays,
  isAdmin,
  onDelete,
}: {
  archives: ScheduleArchive[];
  teachers: Teacher[];
  locations: Location[];
  schoolInfo: SchoolInfo;
  holidays: Holiday[];
  isAdmin: boolean;
  onDelete?: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const sortedArchives = useMemo(
    () => [...archives].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)),
    [archives]
  );

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-slate-200 overflow-hidden print:hidden">
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        aria-expanded={isOpen}
        className={`w-full px-6 py-4 bg-slate-50/50 hover:bg-slate-100/60 transition-colors flex items-center gap-3 text-left ${isOpen ? 'border-b border-slate-200' : ''}`}
      >
        <div className="bg-amber-100 p-2 rounded-lg text-amber-600">
          <Archive className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-slate-800">Arşivlenmiş Nöbet Çizelgeleri</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {sortedArchives.length} arşivlenmiş çizelge
          </p>
        </div>
        {isOpen
          ? <ChevronUp className="w-5 h-5 text-slate-400" />
          : <ChevronDown className="w-5 h-5 text-slate-400" />}
      </button>
      {isOpen && <div className="divide-y divide-slate-200">
        {sortedArchives.map((archive) => (
          <ArchiveItem
            key={archive.id}
            archive={archive}
            teachers={teachers}
            locations={locations}
            schoolInfo={schoolInfo}
            holidays={holidays}
            isExpanded={expandedId === archive.id}
            onToggle={() => setExpandedId(expandedId === archive.id ? null : archive.id)}
            onDelete={onDelete}
            confirmDeleteId={confirmDeleteId}
            setConfirmDeleteId={setConfirmDeleteId}
          />
        ))}
      </div>}
    </div>
  );
}
