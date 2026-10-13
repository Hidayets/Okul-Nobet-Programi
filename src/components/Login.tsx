import React, { useEffect, useState } from 'react';
import { Building2, KeyRound, UserCircle2, Loader2, ArrowLeft, CheckCircle2, Shield, UploadCloud } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { describeImport, hasLocalDatabaseToMigrate, readLocalDatabase, uploadKurumDatabase } from '../lib/migrateUpload';

interface Props {
  onSwitchToRegister: () => void;
}

export default function Login({ onSwitchToRegister }: Props) {
  const { setUser, setLicense, setActingKurumKodu } = useAuth();
  const [kurumKodu, setKurumKodu] = useState('');
  const [role, setRole] = useState<'admin' | 'teacher'>('teacher');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Özel giriş modu
  const [showSuperAdmin, setShowSuperAdmin] = useState(false);
  const [superAdminKey, setSuperAdminKey] = useState('');
  const [logoClickCount, setLogoClickCount] = useState(0);
  
  // Logo'ya 5 kez tıklayınca özel girişi aç
  const handleLogoClick = () => {
    const newCount = logoClickCount + 1;
    setLogoClickCount(newCount);
    if (newCount >= 5) {
      setShowSuperAdmin(true);
      setLogoClickCount(0);
    }
    // 2 saniye sonra sayacı sıfırla
    setTimeout(() => setLogoClickCount(0), 2000);
  };

  const [showForgot, setShowForgot] = useState(false);
  const [forgotKurum, setForgotKurum] = useState('');
  const [forgotLicense, setForgotLicense] = useState('');
  const [forgotRole, setForgotRole] = useState<'admin' | 'teacher'>('admin');
  const [forgotNewPw, setForgotNewPw] = useState('');
  const [forgotNewPw2, setForgotNewPw2] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState(false);

  const [hasLocalDb, setHasLocalDb] = useState(false);
  const [showMigrate, setShowMigrate] = useState(false);
  const [migrateFile, setMigrateFile] = useState<File | null>(null);
  const [migrateLoading, setMigrateLoading] = useState(false);
  const [migrateMessage, setMigrateMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    hasLocalDatabaseToMigrate().then(setHasLocalDb);
  }, []);

  const handleMigrate = async () => {
    const cleanKurumKodu = kurumKodu.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!cleanKurumKodu || !password) {
      setMigrateMessage({ type: 'error', text: 'Yukarıya kurum kodunuzu ve Admin şifrenizi girin.' });
      return;
    }
    setMigrateLoading(true);
    setMigrateMessage(null);
    try {
      const body = migrateFile ? await migrateFile.arrayBuffer() : hasLocalDb ? await readLocalDatabase() : null;
      if (!body) {
        setMigrateMessage({ type: 'error', text: 'Eski bilgisayardaki database.sqlite dosyasını seçin.' });
        return;
      }
      const result = await uploadKurumDatabase(body, cleanKurumKodu, password);
      if (!result.ok) {
        setMigrateMessage({ type: 'error', text: result.error || 'Veriler aktarılamadı.' });
        return;
      }
      setRole('admin');
      setMigrateMessage({ type: 'success', text: `Verileriniz sunucuya taşındı: ${describeImport(result)} Şimdi Admin olarak giriş yapabilirsiniz.` });
    } finally {
      setMigrateLoading(false);
    }
  };

  const formatLicenseInput = (value: string) => {
    const clean = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16);
    const parts = clean.match(/.{1,4}/g) || [];
    return parts.join('-');
  };

  const resetForgotForm = () => {
    setShowForgot(false);
    setForgotSuccess(false);
    setForgotError('');
    setForgotKurum('');
    setForgotLicense('');
    setForgotRole('admin');
    setForgotNewPw('');
    setForgotNewPw2('');
  };

  const handleSuperAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!superAdminKey.trim()) {
      setError('Anahtarı girin.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Özel token oluştur
      const res = await fetch('/api/auth/superadmin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ masterKey: superAdminKey })
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem('token', data.token);
        setActingKurumKodu(null);
        setUser(data.user);
        setLicense(null);
      } else {
        setError(data.error || 'Giriş yapılırken bir hata oluştu.');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setError('Giriş yapılırken bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const cleanKurumKodu = kurumKodu.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    
    if (!cleanKurumKodu || !password) {
      setError('Lütfen tüm alanları doldurun.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          kurumKodu: cleanKurumKodu,
          role,
          password
        })
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem('token', data.token);
        setUser(data.user);
        setLicense(data.license || null);
      } else {
        setError(data.error || 'Giriş yapılırken bir hata oluştu.');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setError('Giriş yapılırken bir hata oluştu. Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = forgotKurum.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const cleanLicense = forgotLicense.replace(/-/g, '').trim();
    if (!clean || !cleanLicense || !forgotNewPw) {
      setForgotError('Lütfen kurum kodu, lisans anahtarı ve yeni şifreyi girin.');
      return;
    }
    if (cleanLicense.length !== 16) {
      setForgotError('Lisans anahtarı 16 haneli olmalıdır (XXXX-XXXX-XXXX-XXXX).');
      return;
    }
    if (forgotNewPw.length < 6) {
      setForgotError('Şifre en az 6 karakter olmalıdır.');
      return;
    }
    if (forgotNewPw !== forgotNewPw2) {
      setForgotError('Yeni şifreler eşleşmiyor.');
      return;
    }

    setForgotLoading(true);
    setForgotError('');

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kurumKodu: clean,
          licenseKey: cleanLicense,
          newPassword: forgotNewPw,
          role: forgotRole,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setForgotSuccess(true);
      } else {
        setForgotError(data.error || 'Şifre sıfırlanamadı.');
      }
    } catch {
      setForgotError('Bağlantı hatası. Lütfen tekrar deneyin.');
    } finally {
      setForgotLoading(false);
    }
  };

  // Özel Giriş Ekranı
  if (showSuperAdmin) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center">
            <div className="bg-purple-600 p-3 rounded-xl shadow-lg">
              <Shield className="w-10 h-10 text-white" />
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            Yönetici Girişi
          </h2>
          <p className="mt-2 text-center text-sm text-slate-400">
            Özel erişim
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-slate-800 py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-700">
            <form className="space-y-6" onSubmit={handleSuperAdminLogin}>
              {error && (
                <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-300">Master Anahtar</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <KeyRound className="h-5 w-5 text-slate-500" />
                  </div>
                  <input
                    type="password"
                    required
                    value={superAdminKey}
                    onChange={(e) => setSuperAdminKey(e.target.value)}
                    className="bg-slate-700 text-white focus:ring-purple-500 focus:border-purple-500 block w-full pl-10 sm:text-sm border-slate-600 rounded-md py-2 border placeholder-slate-400"
                    placeholder="Yönetici anahtarı"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-70"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Giriş Yap'}
              </button>

              <button
                type="button"
                onClick={() => { setShowSuperAdmin(false); setError(''); setSuperAdminKey(''); }}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 text-sm font-medium text-slate-400 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" />
                Normal giriş sayfasına dön
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (showForgot) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center">
            <div className="bg-amber-500 p-3 rounded-xl shadow-lg">
              <KeyRound className="w-10 h-10 text-white" />
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-slate-900">
            Şifremi Unuttum
          </h2>
          <p className="mt-2 text-center text-sm text-slate-600 px-4">
            Size verilen lisans anahtarı ile yeni şifre oluşturun. Okul verileriniz silinmez; yalnızca şifre güncellenir.
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-surface py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
            {forgotSuccess ? (
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <CheckCircle2 className="w-16 h-16 text-emerald-500" />
                </div>
                <h3 className="text-lg font-semibold text-slate-800">Şifre Güncellendi</h3>
                <p className="text-sm text-slate-600">
                  {forgotRole === 'admin' ? 'Admin' : 'Öğretmen'} şifreniz güncellendi. Öğretmenler, nöbetler ve ayarlar aynen duruyor.
                  Yeni şifrenizle giriş yapabilirsiniz.
                </p>
                <button
                  onClick={resetForgotForm}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  Giriş Sayfasına Dön
                </button>
              </div>
            ) : (
              <form className="space-y-5" onSubmit={handleForgotPassword}>
                {forgotError && (
                  <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                    {forgotError}
                  </div>
                )}

                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2.5 rounded-lg text-xs">
                  Bu işlem yalnızca şifreyi değiştirir. Yeniden kayıt yapmaz; verileriniz kaybolmaz.
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">Kurum Kodu</label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Building2 className="h-5 w-5 text-slate-400" />
                    </div>
                    <input
                      type="text"
                      required
                      value={forgotKurum}
                      onChange={(e) => setForgotKurum(e.target.value)}
                      className="focus:ring-amber-500 focus:border-amber-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md py-2 border"
                      placeholder="Kayıt olduğunuz kurum kodu"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">Lisans Anahtarı</label>
                  <p className="text-xs text-slate-500 mb-1">İlk kurulumda size verilen anahtar</p>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <KeyRound className="h-5 w-5 text-slate-400" />
                    </div>
                    <input
                      type="text"
                      required
                      value={forgotLicense}
                      onChange={(e) => setForgotLicense(formatLicenseInput(e.target.value))}
                      className="focus:ring-amber-500 focus:border-amber-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md py-2 border font-mono tracking-wider"
                      placeholder="XXXX-XXXX-XXXX-XXXX"
                      maxLength={19}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">Hangi kullanıcı?</label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <UserCircle2 className="h-5 w-5 text-slate-400" />
                    </div>
                    <select
                      value={forgotRole}
                      onChange={(e) => setForgotRole(e.target.value as 'admin' | 'teacher')}
                      className="focus:ring-amber-500 focus:border-amber-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md py-2 border bg-surface"
                    >
                      <option value="admin">Admin (Okul İdaresi)</option>
                      <option value="teacher">Öğretmen</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">Yeni Şifre</label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <KeyRound className="h-5 w-5 text-slate-400" />
                    </div>
                    <input
                      type="password"
                      required
                      value={forgotNewPw}
                      onChange={(e) => setForgotNewPw(e.target.value)}
                      className="focus:ring-amber-500 focus:border-amber-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md py-2 border"
                      placeholder="En az 6 karakter"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">Yeni Şifre (Tekrar)</label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <KeyRound className="h-5 w-5 text-slate-400" />
                    </div>
                    <input
                      type="password"
                      required
                      value={forgotNewPw2}
                      onChange={(e) => setForgotNewPw2(e.target.value)}
                      className="focus:ring-amber-500 focus:border-amber-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md py-2 border"
                      placeholder="Şifreyi tekrar girin"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:opacity-70"
                >
                  {forgotLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Yeni Şifre Oluştur'}
                </button>

                <button
                  type="button"
                  onClick={resetForgotForm}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 text-sm font-medium text-slate-600 hover:text-slate-800"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Giriş sayfasına dön
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8" style={{ background: 'linear-gradient(135deg, #eef4fb 0%, #dbeafe 50%, #e0f2fe 100%)' }}>
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div
            className="app-logo-ring cursor-pointer select-none"
            onClick={handleLogoClick}
            title={logoClickCount > 0 ? `${5 - logoClickCount} tıklama kaldı` : undefined}
          >
            <span className="app-logo-n">N</span>
          </div>
        </div>
        <h2 className="mt-6 text-center text-2xl font-bold text-[#1a4a8a]" style={{ fontFamily: 'Georgia, serif' }}>
          Okul Öğretmen Nöbet Programı
        </h2>
        <p className="mt-2 text-center text-sm text-blue-500 italic">
          Düzenli Nöbet • Güvenli Okul • Başarılı Eğitim
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="app-card py-8 px-4 sm:px-10">
          <form className="space-y-6" onSubmit={handleLogin}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="kurumKodu" className="block text-sm font-medium text-slate-700">
                Kurum Kodu
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Building2 className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="kurumKodu"
                  type="text"
                  required
                  value={kurumKodu}
                  onChange={(e) => setKurumKodu(e.target.value)}
                  className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md py-2 border"
                  placeholder="Örn: 123456"
                />
              </div>
            </div>

            <div>
              <label htmlFor="role" className="block text-sm font-medium text-slate-700">
                Kullanıcı Adı
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <UserCircle2 className="h-5 w-5 text-slate-400" />
                </div>
                <select
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'admin' | 'teacher')}
                  className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md py-2 border bg-surface"
                >
                  <option value="teacher">Öğretmen</option>
                  <option value="admin">Admin (Okul İdaresi)</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Şifre
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md py-2 border"
                  placeholder="Şifrenizi girin"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-70"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Giriş Yap'}
              </button>
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setForgotRole(role);
                  setShowForgot(true);
                }}
                className="text-sm text-indigo-600 hover:text-indigo-500 font-medium"
              >
                Şifremi Unuttum
              </button>
            </div>
          </form>

          <div className="mt-4 border-t border-slate-200 pt-4">
            {hasLocalDb && !showMigrate && (
              <div className="mb-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Bu bilgisayarda programın eski sürümünden kalan veriler var. Giriş yapamıyorsanız aşağıdan sunucuya taşıyın.
              </div>
            )}
            <button
              type="button"
              onClick={() => { setShowMigrate(v => !v); setMigrateMessage(null); }}
              className="w-full flex items-center justify-center gap-2 text-sm text-indigo-600 hover:text-indigo-500 font-medium"
            >
              <UploadCloud className="w-4 h-4" />
              Eski bilgisayardaki verilerimi taşı
            </button>
            {showMigrate && (
              <div className="mt-3 space-y-3 text-sm">
                <p className="text-xs text-slate-600">
                  Programı daha önce başka bir bilgisayarda kullandıysanız verilerinizi buraya taşıyabilirsiniz.
                  Yukarıya kurum kodunuzu ve <strong>Admin</strong> şifrenizi yazın. Var olan kayıtlar silinmez; yalnızca eksikler eklenir.
                </p>
                {hasLocalDb ? (
                  <p className="text-xs text-slate-600">Bu bilgisayardaki eski veriler kullanılacak. İsterseniz başka bir dosya da seçebilirsiniz.</p>
                ) : (
                  <p className="text-xs text-slate-600">
                    Eski bilgisayarda <code className="bg-slate-100 px-1 rounded">%LOCALAPPDATA%\OkulNobetProgrami\database.sqlite</code> dosyasını seçin.
                  </p>
                )}
                <input
                  type="file"
                  accept=".sqlite,.db,application/octet-stream"
                  onChange={(e) => setMigrateFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-slate-100 file:text-slate-700"
                />
                {migrateMessage && (
                  <div className={`px-3 py-2 rounded-lg text-xs border ${
                    migrateMessage.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-red-50 border-red-200 text-red-600'
                  }`}>
                    {migrateMessage.text}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleMigrate}
                  disabled={migrateLoading}
                  className="w-full flex justify-center py-2 px-4 rounded-md text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70"
                >
                  {migrateLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verileri Sunucuya Taşı'}
                </button>
              </div>
            )}
          </div>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-surface text-slate-500">
                  İlk defa mı kullanıyorsunuz?
                </span>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <button
                onClick={onSwitchToRegister}
                className="w-full flex justify-center py-2 px-4 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-surface hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Yeni Okul Kaydı Oluştur (İlk Kurulum)
              </button>
              <p className="text-xs text-center text-slate-500 px-2">
                Daha önce kayıt olduysanız buradan tekrar kayıt olmayın. Lisans bitince yönetici uzatır; aynı şifrelerle giriş yaparsınız.
              </p>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400 select-none">
          © {new Date().getFullYear()} Hidayet SEVDİ
        </p>
      </div>
    </div>
  );
}
