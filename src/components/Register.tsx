import React, { useState, useEffect } from 'react';
import { Building2, KeyRound, ArrowLeft, Loader2, ShieldCheck, Users, BadgeCheck, CheckCircle2, AlertCircle } from 'lucide-react';

interface Props {
  onBackToLogin: () => void;
}

type LicenseCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; okulAdi?: string | null; expiresAt?: string | null; registered: boolean }
  | {
      state: 'error';
      reason: 'not-found' | 'inactive' | 'expired' | 'network' | 'already-registered';
      okulAdi?: string | null;
      registered?: boolean;
    };

export default function Register({ onBackToLogin }: Props) {
  const [kurumKodu, setKurumKodu] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [teacherPassword, setTeacherPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [licCheck, setLicCheck] = useState<LicenseCheck>({ state: 'idle' });

  const formatLicenseInput = (value: string) => {
    const clean = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16);
    const parts = clean.match(/.{1,4}/g) || [];
    return parts.join('-');
  };

  const alreadyRegistered =
    (licCheck.state === 'ok' && licCheck.registered) ||
    (licCheck.state === 'error' && (licCheck.reason === 'already-registered' || licCheck.registered));

  // Kurum kodu girildikçe (debounced) lisans + önceki kayıt durumunu kontrol et
  useEffect(() => {
    const cleanKurumKodu = kurumKodu.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!cleanKurumKodu) {
      setLicCheck({ state: 'idle' });
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLicCheck({ state: 'checking' });
      try {
        const res = await fetch(`/api/licenses/check/${encodeURIComponent(cleanKurumKodu)}`);
        if (!res.ok) throw new Error('network');
        const data = await res.json();
        if (cancelled) return;

        if (data.registered) {
          setLicCheck({
            state: 'error',
            reason: 'already-registered',
            okulAdi: data.okulAdi,
            registered: true,
          });
          return;
        }

        if (!data.exists) {
          setLicCheck({ state: 'error', reason: 'not-found', registered: false });
        } else if (!data.ok) {
          setLicCheck({
            state: 'error',
            reason: data.reason || 'not-found',
            okulAdi: data.okulAdi,
            registered: false,
          });
        } else {
          setLicCheck({
            state: 'ok',
            okulAdi: data.okulAdi,
            expiresAt: data.expiresAt,
            registered: false,
          });
        }
      } catch {
        if (!cancelled) setLicCheck({ state: 'error', reason: 'network' });
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [kurumKodu]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (alreadyRegistered) {
      setError('Bu okul zaten kayıtlı. Giriş sayfasından mevcut kullanıcı adı ve şifrenizle giriş yapın.');
      return;
    }
    
    const cleanKurumKodu = kurumKodu.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const cleanLicense = licenseKey.replace(/-/g, '').trim();
    
    if (!cleanKurumKodu || !cleanLicense || !adminPassword || !teacherPassword) {
      setError('Lütfen tüm alanları doldurun. Kurum kodu sadece harf ve rakamlardan oluşmalıdır.');
      return;
    }
    if (cleanLicense.length !== 16) {
      setError('Lisans anahtarı 16 haneli olmalıdır (XXXX-XXXX-XXXX-XXXX).');
      return;
    }
    if (adminPassword.length < 6 || teacherPassword.length < 6) {
      setError('Şifreler en az 6 karakter olmalıdır.');
      return;
    }
    if (adminPassword === teacherPassword) {
      setError('Admin şifresi ile öğretmen şifresi aynı olamaz.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          kurumKodu: cleanKurumKodu,
          licenseKey: cleanLicense,
          adminPassword,
          teacherPassword
        })
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => {
          onBackToLogin();
        }, 3000);
      } else {
        setError(data.error || 'Kayıt oluşturulurken bir hata meydana geldi.');
      }
    } catch (err: any) {
      console.error('Registration error:', err);
      setError(`Kayıt oluşturulurken bir hata meydana geldi: ${err.message || err.code || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-emerald-100 mb-4">
            <ShieldCheck className="h-8 w-8 text-emerald-600" />
          </div>
          <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Kurulum Başarılı!</h2>
          <p className="text-slate-600 mb-6">
            Okulunuz için nöbet sistemi başarıyla kuruldu. Giriş ekranına yönlendiriliyorsunuz...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <button 
            onClick={onBackToLogin}
            className="absolute top-8 left-8 text-slate-500 hover:text-slate-700 flex items-center gap-2 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Girişe Dön
          </button>
          <div className="bg-indigo-600 p-3 rounded-xl shadow-lg">
            <Building2 className="w-10 h-10 text-white" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-slate-900">
          İlk Kurulum (Okul Kaydı)
        </h2>
        <p className="mt-2 text-center text-sm text-slate-600 px-4">
          Yalnızca daha önce kayıt olmamış okullar için. Size verilen yeni lisans anahtarı ile kurulum yapın.
          Daha önce kayıt olduysanız giriş sayfasını kullanın; lisans bitince yalnızca uzatma yeterlidir.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-surface py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
          <form className="space-y-6" onSubmit={handleRegister}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            {alreadyRegistered && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm space-y-2">
                <p className="font-medium">
                  {licCheck.state === 'error' && licCheck.okulAdi
                    ? `${licCheck.okulAdi} zaten kayıtlı.`
                    : 'Bu kurum kodu ile daha önce kayıt yapılmış.'}
                </p>
                <p>
                  Yeniden kayıt veya yeni lisans gerekmez. Lisans uzatıldığında aynı kullanıcı adı ve şifre ile giriş yapabilirsiniz.
                </p>
                <button
                  type="button"
                  onClick={onBackToLogin}
                  className="text-indigo-700 font-semibold hover:underline"
                >
                  Giriş sayfasına dön →
                </button>
              </div>
            )}

            <div>
              <label htmlFor="kurumKodu" className="block text-sm font-medium text-slate-700">
                Kurum Kodu (MEB Kurum Kodu)
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
                  className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 pr-10 sm:text-sm border-slate-300 rounded-md py-2 border"
                  placeholder="Örn: 123456"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                  {licCheck.state === 'checking' && (
                    <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                  )}
                  {licCheck.state === 'ok' && !licCheck.registered && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  )}
                  {licCheck.state === 'error' && (
                    <AlertCircle className={`w-4 h-4 ${licCheck.reason === 'already-registered' ? 'text-amber-500' : 'text-red-500'}`} />
                  )}
                </div>
              </div>
              {licCheck.state === 'ok' && !licCheck.registered && (
                <p className="mt-1 text-xs text-emerald-700">
                  ✓ {licCheck.okulAdi || 'Lisans bulundu'}
                  {licCheck.expiresAt && ` • ${new Date(licCheck.expiresAt).toLocaleDateString('tr-TR')} tarihine kadar geçerli`}
                </p>
              )}
              {licCheck.state === 'error' && licCheck.reason !== 'already-registered' && (
                <p className="mt-1 text-xs text-slate-600">
                  {licCheck.reason === 'not-found' && 'Sistemde henüz lisans kaydı yok. Size verilen yeni lisans anahtarı ile kayıt olabilirsiniz.'}
                  {licCheck.reason === 'inactive' && 'Lisans pasif durumda. Yönetici etkinleştirdikten sonra ilk kurulumu tamamlayabilirsiniz.'}
                  {licCheck.reason === 'expired' && 'Lisansın süresi dolmuş. Yönetici uzattıktan sonra ilk kurulumu tamamlayabilirsiniz.'}
                  {licCheck.reason === 'network' && 'Lisans kontrolü yapılamadı.'}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="licenseKey" className="block text-sm font-medium text-slate-700">
                Lisans Anahtarı
              </label>
              <p className="text-xs text-slate-500 mb-2">
                Yalnızca ilk kurulum için size verilen lisans anahtarını girin.
              </p>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <BadgeCheck className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="licenseKey"
                  type="text"
                  required
                  disabled={alreadyRegistered}
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(formatLicenseInput(e.target.value))}
                  className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md py-2 border font-mono tracking-wider disabled:bg-slate-100 disabled:text-slate-400"
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  maxLength={19}
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                Yönetici (Admin) Şifresi
              </h3>
              <p className="text-xs text-slate-500 mb-3">
                Programı hazırlamak, öğretmen ve nöbet yeri eklemek için sizin kullanacağınız şifre.
              </p>
              <div className="relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="adminPassword"
                  type="password"
                  required
                  disabled={alreadyRegistered}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md py-2 border disabled:bg-slate-100"
                  placeholder="En az 6 karakter"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-600" />
                Öğretmen Şifresi (Ortak)
              </h3>
              <p className="text-xs text-slate-500 mb-3">
                Öğretmenlerin programı sadece görüntüleyebilmesi için onlara vereceğiniz tek ve ortak şifre.
              </p>
              <div className="relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="teacherPassword"
                  type="password"
                  required
                  disabled={alreadyRegistered}
                  value={teacherPassword}
                  onChange={(e) => setTeacherPassword(e.target.value)}
                  className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md py-2 border disabled:bg-slate-100"
                  placeholder="En az 6 karakter"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading || alreadyRegistered}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-70"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Kurulumu Tamamla'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
