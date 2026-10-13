import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from './lib/utils';
import AppShell, { AppTab } from './components/AppShell';
import { Teacher, Location, Assignment, Absence, Substitution, SchoolInfo, ClassInfo, Holiday, ScheduleArchive, DutyChange, SwapRequest, getCurrentAcademicYear, getRelevantAcademicYears, sortLocationsByOrder } from './types';
import TeachersTab from './components/TeachersTab';
import LocationsTab from './components/LocationsTab';
import GeneratorTab from './components/GeneratorTab';
import ScheduleTab from './components/ScheduleTab';
import DailyOperationsTab from './components/DailyOperationsTab';
import SettingsTab from './components/SettingsTab';
import SchedulesTab from './components/SchedulesTab';
import AbsenceTrackingTab from './components/AbsenceTrackingTab';
import SuperAdminPanel from './components/SuperAdminPanel';
import Login from './components/Login';
import Register from './components/Register';
import OnboardingTour, { ONBOARDING_STORAGE_KEY } from './components/OnboardingTour';
import UpdateNotifier, { UpdateStatus } from './components/UpdateNotifier';
import LicenseExpiryWarning from './components/LicenseExpiryWarning';
import { formatLicenseDateLongTr } from './lib/licenseDates';
import { useAuth } from './AuthContext';
import { useApiSync } from './hooks/useApiSync';
import { useApiDoc } from './hooks/useApiDoc';
import { unifyTeachers } from './lib/teacherMatching';
import { getAuthHeaders, setClientName } from './lib/apiHeaders';
import { useMebCalendarSync, MebSyncOutcome } from './hooks/useMebCalendarSync';
import { useUndoableUpdates } from './hooks/useUndoableUpdates';
import { SYNC_ERROR_EVENT } from './lib/syncEvents';
import { License } from './types';

// Vite üzerinden enjekte edilen client sürümü (build sırasında define ile gelir).
// vite.config.ts içinde ayrıca tanımlanmadıysa fallback değeri kullanılır.
declare const __APP_VERSION__: string;
const CLIENT_VERSION: string =
  (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '') ||
  (typeof window !== 'undefined' && (window as any).__APP_VERSION__) ||
  '';

export default function App() {
  const { user, license, loading, signOut, licenseLockout, actingKurumKodu, setActingKurumKodu } = useAuth();
  const [showRegister, setShowRegister] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('schedule');
  const [superAdminLicenses, setSuperAdminLicenses] = useState<License[]>([]);
  const [tourOpen, setTourOpen] = useState(false);
  const [showLicenseWarning, setShowLicenseWarning] = useState(false);
  const [mebSyncNotice, setMebSyncNotice] = useState<MebSyncOutcome | null>(null);

  const handleMebSync = useCallback((outcome: MebSyncOutcome | null) => {
    if (outcome) setMebSyncNotice(outcome);
  }, []);

  // Lisans pasifleştirildi/dolduğunda backend 403 + licenseStatus döner ve
  // AuthContext oturumu kapatır. Burada kullanıcıya tek seferlik bir uyarı
  // göster ve onlara Login ekranını sun.
  useEffect(() => {
    if (licenseLockout) {
      // Sayfa modal'lar arasında bocalamasın diye küçük bir gecikmeyle göster.
      window.setTimeout(() => {
        try {
          alert(licenseLockout.message);
        } catch {}
      }, 0);
    }
  }, [licenseLockout]);

  // Lisans bitimine 30 gün (1 ay) veya daha az kaldıysa: her uygulama açılışında (yeni oturum)
  // bir kez tam ekran uyarı gösterilir. Oturumu kapatıp tekrar açınca yeniden gösterilir.
  useEffect(() => {
    if (!user || user.role === 'superadmin') return;
    if (!license || !license.expiresAt) return;
    const d = license.daysRemaining;
    if (d === null || d === undefined) return;
    if (d > 30) return;

    const key = `licenseWarnShown__${user.kurumKodu}__${license.expiresAt}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {}
    setShowLicenseWarning(true);
  }, [user, license]);

  // Güncelleme sistemi state'leri
  const [updateCheckTrigger, setUpdateCheckTrigger] = useState(0);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' });
  const [appVersion, setAppVersion] = useState<string>(CLIENT_VERSION);
  const [versionMismatch, setVersionMismatch] = useState<{ client: string; server: string } | null>(null);

  const [activeYear, setActiveYear] = useState<string>(() => {
    const current = getCurrentAcademicYear();
    const stored = localStorage.getItem('activeAcademicYear');
    // Yeni eğitim yılı (Ağustos+) başladıysa eski seçimi otomatik güncelle
    if (!stored || stored < current) return current;
    return stored;
  });

  useEffect(() => {
    localStorage.setItem('activeAcademicYear', activeYear);
  }, [activeYear]);

  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin' || isSuperAdmin;

  const scopedCollection = (name: string) => `${name}__${activeYear}`;

  const [teachers, setTeachers, teachersLoaded] = useApiSync<Teacher>(scopedCollection('teachers'), []);
  const [classes, setClasses] = useApiSync<ClassInfo>(scopedCollection('classes'), []);
  const [locations, setLocations, locationsLoaded] = useApiSync<Location>(scopedCollection('locations'), []);
  const orderedLocations = useMemo(() => sortLocationsByOrder(locations), [locations]);
  const [assignments, setAssignments, assignmentsLoaded] = useApiSync<Assignment>(scopedCollection('assignments'), []);
  const assignmentHistory = useUndoableUpdates(
    assignments,
    setAssignments,
    `${activeYear}|${user?.uid ?? ''}|${actingKurumKodu ?? ''}`,
  );
  const [absences, setAbsences] = useApiSync<Absence>(scopedCollection('absences'), []);
  const [substitutions, setSubstitutions] = useApiSync<Substitution>(scopedCollection('substitutions'), []);
  const [holidays, setHolidays, holidaysLoaded] = useApiSync<Holiday>(scopedCollection('holidays'), []);
  const [scheduleArchives, setScheduleArchives] = useApiSync<ScheduleArchive>(scopedCollection('scheduleArchives'), []);
  const [dutyChanges, setDutyChanges] = useApiSync<DutyChange>(scopedCollection('dutyChanges'), []);
  const [swapRequests, setSwapRequests] = useApiSync<SwapRequest>(scopedCollection('swapRequests'), []);

  const [schoolInfo, setSchoolInfo, schoolInfoLoaded] = useApiDoc<SchoolInfo>('schoolInfo/info', {
    valilik: '',
    kaymakamlik: '',
    okulAdi: '',
    okulMuduru: '',
    mudurYardimcilari: []
  });

  // Güncel yılı okul dönem listesine ekle
  useEffect(() => {
    if (!schoolInfoLoaded || !isAdmin) return;
    const current = getCurrentAcademicYear();
    const years = schoolInfo.academicYears || [];
    if (years.includes(current)) return;
    setSchoolInfo(prev => {
      const y = prev.academicYears || [];
      if (y.includes(current)) return prev;
      return { ...prev, academicYears: [...y, current].sort() };
    });
  }, [schoolInfoLoaded, isAdmin, schoolInfo.academicYears, setSchoolInfo]);

  const [syncError, setSyncError] = useState<string | null>(null);
  useEffect(() => {
    const onError = (e: Event) => setSyncError((e as CustomEvent<string>).detail);
    window.addEventListener(SYNC_ERROR_EVENT, onError);
    return () => window.removeEventListener(SYNC_ERROR_EVENT, onError);
  }, []);

  // Rol değişince (çıkış / farklı kullanıcıyla giriş) yetkisiz sekmede kalınmasın.
  useEffect(() => {
    const adminOnlyTabs: AppTab[] = ['teachers', 'schedules', 'locations', 'generator', 'settings'];
    if (!isAdmin && adminOnlyTabs.includes(activeTab)) setActiveTab('schedule');
    if (!isSuperAdmin && activeTab === 'licenses') setActiveTab('schedule');
  }, [isAdmin, isSuperAdmin, activeTab]);

  const handleTeacherIdsMerged = useCallback((idRemap: Record<string, string>) => {
    if (!idRemap || Object.keys(idRemap).length === 0) return;
    const mapId = (id: string) => idRemap[id] ?? id;
    setAssignments((prev) => prev.map((a) => ({ ...a, teacherId: mapId(a.teacherId) })));
    setAbsences((prev) => prev.map((a) => ({ ...a, teacherId: mapId(a.teacherId) })));
    setSubstitutions((prev) =>
      prev.map((s) => ({
        ...s,
        absentTeacherId: mapId(s.absentTeacherId),
        substituteTeacherId: s.substituteTeacherId ? mapId(s.substituteTeacherId) : s.substituteTeacherId,
      })),
    );
    setLocations((prev) =>
      prev.map((loc) => ({
        ...loc,
        duties: loc.duties.map((d) => ({ ...d, teacherId: mapId(d.teacherId) })),
        assignedTeacherIds: loc.assignedTeacherIds
          ? [...new Set(loc.assignedTeacherIds.map(mapId))]
          : loc.assignedTeacherIds,
      })),
    );
    setScheduleArchives((prev) =>
      prev.map((arch) => ({
        ...arch,
        assignments: arch.assignments.map((a) => ({ ...a, teacherId: mapId(a.teacherId) })),
      })),
    );
    assignmentHistory.clearHistory();
  }, [setAssignments, setAbsences, setSubstitutions, setLocations, setScheduleArchives, assignmentHistory.clearHistory]);

  const handleLocationsRemoved = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const removed = new Set(ids);
    setAssignments((prev) => prev.filter((a) => !removed.has(a.locationId)));
    assignmentHistory.clearHistory();
  }, [setAssignments, assignmentHistory.clearHistory]);

  const handleTeachersRemoved = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const removed = new Set(ids);
    assignmentHistory.clearHistory();
    setAssignments((prev) => prev.filter((a) => !removed.has(a.teacherId)));
    setAbsences((prev) => prev.filter((a) => !removed.has(a.teacherId)));
    setSubstitutions((prev) =>
      prev
        .filter((s) => !removed.has(s.absentTeacherId))
        .map((s) => (s.substituteTeacherId && removed.has(s.substituteTeacherId) ? { ...s, substituteTeacherId: '' } : s)),
    );
    setLocations((prev) =>
      prev.map((loc) => ({
        ...loc,
        duties: (loc.duties || []).filter((d) => !removed.has(d.teacherId)),
        assignedTeacherIds: loc.assignedTeacherIds?.filter((id) => !removed.has(id)),
      })),
    );
  }, [setAssignments, setAbsences, setSubstitutions, setLocations, assignmentHistory.clearHistory]);

  const availableYears = useMemo(() => {
    const years = new Set(schoolInfo.academicYears || []);
    for (const y of getRelevantAcademicYears()) years.add(y);
    return Array.from(years).sort();
  }, [schoolInfo.academicYears]);

  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(activeYear)) {
      setActiveYear(availableYears[availableYears.length - 1]);
    }
  }, [availableYears, activeYear]);

  useEffect(() => {
    if (!user || user.role === 'superadmin') return;
    try {
      if (!localStorage.getItem(ONBOARDING_STORAGE_KEY)) {
        setTourOpen(true);
      }
    } catch {}
  }, [user]);

  // Öğretmen listesinde aynı kişiyi temsil eden mükerrer kayıtları
  // (örn. "Ahmet Adıgüzel" ve "A. Adıgüzel") otomatik birleştirir.
  // İşlem yalnızca gerçekten birleştirilecek kayıt varsa state'i günceller,
  // bu sayede sonsuz döngü oluşmaz.
  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    if (!teachers || teachers.length < 2) return;
    const { teachers: unified, idRemap } = unifyTeachers(teachers);
    if (Object.keys(idRemap).length === 0) return;
    setTeachers(unified);
    handleTeacherIdsMerged(idRemap);
  }, [teachers, user, setTeachers, handleTeacherIdsMerged]);

  // Electron uygulama bilgisini çek (paketli sürümde otoriter sürüm)
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.getAppInfo) {
      api.getAppInfo().then((info: any) => {
        if (info?.version) setAppVersion(info.version);
        setClientName(info?.computerName);
      }).catch(() => {});
    }
  }, []);

  // Server-Client sürüm uyumsuzluğu kontrolü
  useEffect(() => {
    if (!user || user.role === 'superadmin') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/version');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const sv = data?.version || '';
        const cv = appVersion || CLIENT_VERSION;
        if (sv && cv && sv !== cv) {
          setVersionMismatch({ client: cv, server: sv });
        } else {
          setVersionMismatch(null);
        }
      } catch {
        // Sessizce yut, kullanıcıyı bezdirmeyelim
      }
    })();
    return () => { cancelled = true; };
  }, [user, appVersion]);

  const handleCheckUpdate = useCallback(() => {
    setUpdateCheckTrigger((n) => n + 1);
  }, []);

  useMebCalendarSync({
    activeYear,
    holidays,
    setHolidays,
    schoolInfo,
    setSchoolInfo,
    assignments,
    setAssignments,
    teachers,
    locations: orderedLocations,
    enabled: !!user && isAdmin && user.role !== 'superadmin' && holidaysLoaded && assignmentsLoaded && schoolInfoLoaded
      && teachersLoaded && locationsLoaded,
    onSync: handleMebSync,
  });

  useEffect(() => {
    if (!isSuperAdmin) return;
    (async () => {
      try {
        const res = await fetch('/api/licenses', { headers: getAuthHeaders() });
        if (res.ok) setSuperAdminLicenses(await res.json());
      } catch {}
    })();
  }, [isSuperAdmin]);

  const handleSuperAdminSelectKurum = useCallback((kurumKodu: string) => {
    setActingKurumKodu(kurumKodu);
    setActiveTab('schedule');
  }, [setActingKurumKodu]);

  const yearLabels = useMemo(() => {
    const labels: Record<string, string | undefined> = {};
    for (const y of availableYears) {
      labels[y] = schoolInfo.mebCalendarSync?.[y]?.title;
    }
    return labels;
  }, [availableYears, schoolInfo.mebCalendarSync]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!user) {
    if (showRegister) {
      return <Register onBackToLogin={() => setShowRegister(false)} />;
    }
    return <Login onSwitchToRegister={() => setShowRegister(true)} />;
  }

  const banners = (
    <>
      {/* Sürüm uyumsuzluğu uyarısı kaldırıldı */}
      {user && user.role !== 'superadmin' && license && license.expiresAt && license.daysRemaining !== null && license.daysRemaining <= 30 && (
        <div className={cn(
          "border-b print:hidden",
          license.daysRemaining < 0 ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"
        )}>
          <div className={cn(
            "px-4 sm:px-6 py-2 flex items-center gap-2 text-sm",
            license.daysRemaining < 0 ? "text-red-900" : "text-amber-900"
          )}>
            <AlertTriangle className={cn(
              "w-4 h-4 flex-shrink-0",
              license.daysRemaining < 0 ? "text-red-600" : "text-amber-600"
            )} />
            <div className="flex-1">
              {license.daysRemaining < 0 ? (
                <>
                  <span className="font-semibold">{formatLicenseDateLongTr(license.expiresAt)} tarihinde lisans süreniz dolmuştur.</span>{' '}
                  <a href="mailto:okulcozumleri@gmail.com" className="font-semibold underline">okulcozumleri@gmail.com</a>
                </>
              ) : (
                <>
                  <span className="font-semibold">{formatLicenseDateLongTr(license.expiresAt)} tarihinde lisans süreniz dolacaktır.</span>{' '}
                  <a href="mailto:okulcozumleri@gmail.com" className="font-semibold underline">okulcozumleri@gmail.com</a>
                </>
              )}
            </div>
            <button
              onClick={() => setShowLicenseWarning(true)}
              className={cn(
                "text-xs font-medium px-2 py-1 rounded",
                license.daysRemaining < 0 ? "text-red-700 hover:bg-red-100" : "text-amber-700 hover:bg-amber-100"
              )}
            >
              Detay
            </button>
          </div>
        </div>
      )}

      {syncError && (
        <div className="px-4 sm:px-6 py-2.5 border-b text-sm flex items-start justify-between gap-3 print:hidden bg-red-50 border-red-200 text-red-800">
          <span>
            <span className="font-semibold">Kaydetme hatası:</span> {syncError} Sayfayı yenileyip değişikliklerinizi kontrol edin.
          </span>
          <button
            type="button"
            onClick={() => setSyncError(null)}
            className="text-xs font-medium opacity-70 hover:opacity-100 shrink-0"
          >
            Kapat
          </button>
        </div>
      )}

      {mebSyncNotice && (
        <div className={`px-4 sm:px-6 py-2.5 border-b text-sm flex items-start justify-between gap-3 print:hidden ${
          mebSyncNotice.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : mebSyncNotice.type === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-sky-50 border-sky-200 text-sky-800'
        }`}>
          <span>{mebSyncNotice.message}</span>
          <button
            type="button"
            onClick={() => setMebSyncNotice(null)}
            className="text-xs font-medium opacity-70 hover:opacity-100 shrink-0"
          >
            Kapat
          </button>
        </div>
      )}
    </>
  );

  return (
    <>
    <AppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      isAdmin={isAdmin}
      isSuperAdmin={isSuperAdmin}
      user={user}
      onSignOut={signOut}
      onTourOpen={() => setTourOpen(true)}
      onCheckUpdate={handleCheckUpdate}
      appVersion={appVersion}
      updateStatus={updateStatus}
      activeYear={activeYear}
      onYearChange={setActiveYear}
      availableYears={availableYears}
      yearLabels={yearLabels}
      actingKurumKodu={actingKurumKodu}
      onActingKurumChange={setActingKurumKodu}
      superAdminOptions={superAdminLicenses.map(l => ({ kurumKodu: l.kurumKodu, okulAdi: l.okulAdi }))}
      banners={banners}
    >
        {activeTab === 'licenses' && isSuperAdmin && (
          <SuperAdminPanel
            embedded
            onSelectKurum={handleSuperAdminSelectKurum}
          />
        )}
        {activeTab === 'teachers' && isAdmin && (
          <TeachersTab teachers={teachers} setTeachers={setTeachers} onTeachersRemoved={handleTeachersRemoved} />
        )}
        {activeTab === 'schedules' && isAdmin && (
          <SchedulesTab 
            teachers={teachers} 
            setTeachers={setTeachers}
            onTeacherIdsMerged={handleTeacherIdsMerged}
            classes={classes}
            setClasses={setClasses}
            schoolInfo={schoolInfo}
            setSchoolInfo={setSchoolInfo}
          />
        )}
        {activeTab === 'locations' && isAdmin && (
          <LocationsTab
            locations={locations}
            setLocations={setLocations}
            onLocationsRemoved={handleLocationsRemoved}
            teachers={teachers}
            schoolDayCount={schoolInfo.settings?.schoolDays?.length}
          />
        )}
        {activeTab === 'generator' && isAdmin && (
          <GeneratorTab 
            teachers={teachers} 
            locations={orderedLocations}
            holidays={holidays}
            onGenerate={async (newAssignments) => {
              if (assignments.length > 0) {
                const sortedDates = assignments.map(a => a.date).sort();
                const archiveStart = sortedDates[0];
                const archiveEnd = sortedDates[sortedDates.length - 1];
                const formatDate = (d: string) => {
                  const [y, m, day] = d.split('-');
                  return `${day}/${m}/${y}`;
                };
                const archive: ScheduleArchive = {
                  id: crypto.randomUUID(),
                  label: `${formatDate(archiveStart)} - ${formatDate(archiveEnd)} Nöbeti`,
                  startDate: archiveStart,
                  endDate: archiveEnd,
                  assignments: [...assignments],
                  archivedAt: new Date().toISOString(),
                  mudurYardimcilari: schoolInfo.mudurYardimcilari.map(vp => ({ ...vp })),
                };
                const archived = await setScheduleArchives(prev => [...prev, archive]);
                if (!archived) {
                  alert('Önceki nöbet çizelgesi arşivlenemediği için yeni çizelge kaydedilmedi. Mevcut çizelgeniz korunuyor.');
                  return;
                }
              }
              assignmentHistory.update(newAssignments);
            }} 
            onSuccess={() => setActiveTab('schedule')}
            schoolInfo={schoolInfo}
            currentAssignments={assignments}
            scheduleArchives={scheduleArchives}
          />
        )}
        {activeTab === 'schedule' && (
          <ScheduleTab
            assignments={assignments}
            setAssignments={assignmentHistory.update}
            teachers={teachers}
            locations={orderedLocations}
            schoolInfo={schoolInfo}
            holidays={holidays}
            absences={absences}
            substitutions={substitutions}
            kurumKodu={actingKurumKodu || user.kurumKodu}
            canUndo={assignmentHistory.canUndo}
            onUndo={assignmentHistory.undo}
            dutyChanges={dutyChanges}
            setDutyChanges={setDutyChanges}
            editorLabel={isSuperAdmin ? 'Yönetici' : 'Admin'}
            isAdmin={isAdmin}
            activeYear={activeYear}
            scheduleArchives={scheduleArchives}
            setScheduleArchives={setScheduleArchives}
            onGoToGenerator={isAdmin ? () => setActiveTab('generator') : undefined}
            swapRequests={swapRequests}
            setSwapRequests={setSwapRequests}
          />
        )}
        {activeTab === 'daily' && (
          <DailyOperationsTab
            teachers={teachers}
            assignments={assignments}
            setAssignments={assignmentHistory.update}
            absences={absences}
            setAbsences={setAbsences}
            substitutions={substitutions}
            setSubstitutions={setSubstitutions}
            isAdmin={isAdmin}
            schoolInfo={schoolInfo}
            locations={orderedLocations}
          />
        )}
        {activeTab === 'absenceTracking' && (
          <AbsenceTrackingTab
            teachers={teachers}
            absences={absences}
            schoolInfo={schoolInfo}
            activeYear={activeYear}
          />
        )}
        {activeTab === 'settings' && isAdmin && (
          <Fragment key={`${actingKurumKodu ?? ''}|${activeYear}`}>
            <SettingsTab
              schoolInfo={schoolInfo}
              setSchoolInfo={setSchoolInfo}
              teachers={teachers}
              locations={orderedLocations}
              holidays={holidays}
              setHolidays={setHolidays}
              assignments={assignments}
              setAssignments={assignmentHistory.update}
              activeYear={activeYear}
              isAdmin={isAdmin}
            />
          </Fragment>
        )}
    </AppShell>

    <OnboardingTour
      open={tourOpen}
      onClose={() => setTourOpen(false)}
      onTabChange={(tabId) => setActiveTab(tabId as AppTab)}
    />

    <UpdateNotifier
      manualCheckTrigger={updateCheckTrigger}
      onStatusChange={setUpdateStatus}
    />

    {showLicenseWarning && (
      <LicenseExpiryWarning
        license={license}
        thresholdDays={30}
        onDismiss={() => setShowLicenseWarning(false)}
      />
    )}
    </>
  );
}
