import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Calendar, MapPin, Users, Settings, BookOpen, ClipboardList,
  LogOut, GraduationCap, ChevronDown, ChevronUp, BarChart3, HelpCircle,
  RefreshCw, Shield,   Home, Clock,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { formatAcademicYear } from '../types';
import { UpdateStatus } from './UpdateNotifier';

export type AppTab =
  | 'teachers' | 'locations' | 'generator' | 'schedule' | 'daily'
  | 'absenceTracking' | 'settings' | 'schedules' | 'licenses';

interface TabDef {
  id: AppTab;
  label: string;
  icon: typeof Home;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
}

const ALL_TABS: TabDef[] = [
  { id: 'schedule', label: 'Ana Sayfa', icon: Home },
  { id: 'teachers', label: 'Öğretmenler', icon: Users, adminOnly: true },
  { id: 'schedules', label: 'Ders Programları', icon: BookOpen, adminOnly: true },
  { id: 'locations', label: 'Nöbet Yerleri', icon: MapPin, adminOnly: true },
  { id: 'generator', label: 'Program Oluştur', icon: Calendar, adminOnly: true },
  { id: 'daily', label: 'Günlük İşlemler', icon: ClipboardList },
  { id: 'absenceTracking', label: 'Devamsızlık Takip', icon: BarChart3 },
  { id: 'settings', label: 'Ayarlar', icon: Settings, adminOnly: true },
  { id: 'licenses', label: 'Lisans Yönetimi', icon: Shield, superAdminOnly: true },
];

interface Props {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  user: { kurumKodu: string; role: string };
  onSignOut: () => void;
  onTourOpen: () => void;
  onCheckUpdate: () => void;
  appVersion: string;
  updateStatus: UpdateStatus;
  activeYear: string;
  onYearChange: (year: string) => void;
  availableYears: string[];
  yearLabels?: Record<string, string | undefined>;
  actingKurumKodu?: string | null;
  onActingKurumChange?: (code: string | null) => void;
  superAdminOptions?: { kurumKodu: string; okulAdi: string }[];
  children: ReactNode;
  banners?: ReactNode;
}

export default function AppShell({
  activeTab,
  onTabChange,
  isAdmin,
  isSuperAdmin,
  user,
  onSignOut,
  onTourOpen,
  onCheckUpdate,
  appVersion,
  updateStatus,
  activeYear,
  onYearChange,
  availableYears,
  yearLabels = {},
  actingKurumKodu,
  onActingKurumChange,
  superAdminOptions = [],
  children,
  banners,
}: Props) {
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setClock(new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!userMenuRef.current?.contains(e.target as Node)) setUserMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [userMenuOpen]);

  const visibleTabs = ALL_TABS.filter((tab) => {
    if (tab.superAdminOnly && !isSuperAdmin) return false;
    if (tab.adminOnly && !isAdmin) return false;
    return true;
  });

  const updateReady = updateStatus.status === 'downloaded';
  const updateInProgress =
    updateStatus.status === 'available' || updateStatus.status === 'downloading';

  const roleLabel = isSuperAdmin ? 'Yönetici' : isAdmin ? 'Admin' : 'Öğretmen';

  return (
    <div className="app-shell min-h-screen flex print:block">
      {/* Sol menü */}
      <aside className="app-sidebar print:hidden flex flex-col w-[220px] shrink-0">
        <div className="app-sidebar-logo">
          <div className="app-logo-ring">
            <span className="app-logo-n">N</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-1">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn('app-nav-item w-full', isActive && 'app-nav-item-active')}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div ref={userMenuRef} className="relative">
          {userMenuOpen && (
            <div
              role="menu"
              className="absolute bottom-full left-2 right-2 mb-1 z-50 rounded-xl bg-surface shadow-xl border border-slate-200 py-1 text-sm text-slate-700"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => { setUserMenuOpen(false); onCheckUpdate(); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-slate-100 text-left"
              >
                <RefreshCw
                  className={cn('w-4 h-4 text-blue-600', updateStatus.status === 'checking' && 'animate-spin')}
                />
                <span className="flex-1">Güncelleme Kontrol</span>
                {appVersion && <span className="text-[11px] text-slate-400">v{appVersion}</span>}
              </button>
              <div className="my-1 border-t border-slate-100" />
              <button
                type="button"
                role="menuitem"
                onClick={() => { setUserMenuOpen(false); onSignOut(); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-red-50 text-red-600 text-left"
              >
                <LogOut className="w-4 h-4" />
                <span>Çıkış</span>
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setUserMenuOpen((open) => !open)}
            className="app-sidebar-user w-[calc(100%-1rem)] text-left hover:bg-white/10 transition-colors"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            title="Kullanıcı menüsü"
          >
            <div className="app-user-avatar shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-blue-300/80">Kullanıcı</div>
              <div className="text-sm font-semibold text-white truncate">{roleLabel}</div>
            </div>
            <ChevronUp
              className={cn('w-4 h-4 text-blue-200/70 transition-transform', !userMenuOpen && 'rotate-180')}
            />
          </button>
        </div>
      </aside>

      {/* Ana alan */}
      <div className="app-content flex-1 flex flex-col min-w-0">
        {/* Gradient banner */}
        <header className="app-banner print:hidden">
          <div className="app-banner-content">
            <div>
              <h1 className="app-banner-title">Okul Öğretmen Nöbet Programı</h1>
              <p className="app-banner-subtitle">
                Düzenli Nöbet • Güvenli Okul • Başarılı Eğitim
              </p>
            </div>
            <div className="app-banner-actions">
              <div className="relative">
                <select
                  value={activeYear}
                  onChange={(e) => onYearChange(e.target.value)}
                  className="app-year-select"
                >
                  {availableYears.map((y) => (
                    <option key={y} value={y}>
                      {formatAcademicYear(y, yearLabels[y])}
                    </option>
                  ))}
                </select>
                <GraduationCap className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 pointer-events-none" />
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 pointer-events-none" />
              </div>

              {isSuperAdmin && onActingKurumChange && (
                <select
                  value={actingKurumKodu || ''}
                  onChange={(e) => onActingKurumChange(e.target.value || null)}
                  className="app-year-select max-w-[200px]"
                  title="Kurum seç"
                >
                  <option value="">Yönetici alanı</option>
                  {superAdminOptions.map((lic) => (
                    <option key={lic.kurumKodu} value={lic.kurumKodu}>
                      {lic.okulAdi}
                    </option>
                  ))}
                </select>
              )}

              {!isSuperAdmin && (
                <span className="text-xs text-blue-700/70 hidden lg:inline">
                  {user.kurumKodu}
                </span>
              )}

              {appVersion && (
                <button
                  onClick={onCheckUpdate}
                  className={cn(
                    'app-version-badge',
                    updateReady && 'app-version-badge-ready',
                    updateInProgress && 'app-version-badge-progress',
                  )}
                  title="Güncellemeleri kontrol et"
                >
                  <RefreshCw
                    className={cn('w-3 h-3', updateStatus.status === 'checking' && 'animate-spin')}
                  />
                  v{appVersion}
                </button>
              )}

              <button onClick={onTourOpen} className="app-icon-btn" title="Yardım">
                <HelpCircle className="w-4 h-4" />
              </button>
              <button onClick={onSignOut} className="app-icon-btn" title="Çıkış">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {banners}

        <main className="app-main flex-1 print:p-0">
          <div key={activeTab} className="tab-panel-enter">
            {children}
          </div>
        </main>

        <footer className="app-footer print:hidden">
          <span>
            Okul Öğretmen Nöbet Programı
            {appVersion ? ` v${appVersion}` : ''}
          </span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="app-status-dot" />
              Sistem Aktif
            </span>
            <span className="flex items-center gap-1 text-blue-400">
              <Clock className="w-3.5 h-3.5" />
              {clock}
            </span>
          </span>
        </footer>
      </div>
    </div>
  );
}

export { ALL_TABS };
