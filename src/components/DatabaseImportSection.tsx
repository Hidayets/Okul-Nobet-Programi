import { useEffect, useState } from 'react';
import { UploadCloud, Loader2 } from 'lucide-react';
import { describeImport, hasLocalDatabaseToMigrate, readLocalDatabase, uploadSuperadminDatabase } from '../lib/migrateUpload';

interface Props {
  onImported: () => void;
}

/** Süper yönetici: eski bilgisayarlardaki lisans ve kurum verilerini ortak sunucuya ekler. */
export default function DatabaseImportSection({ onImported }: Props) {
  const [hasLocalDb, setHasLocalDb] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    hasLocalDatabaseToMigrate().then(setHasLocalDb);
  }, []);

  const runImport = async (getBody: () => Promise<Uint8Array | ArrayBuffer | null>) => {
    setLoading(true);
    setMessage(null);
    try {
      const body = await getBody();
      if (!body) {
        setMessage({ type: 'error', text: 'Bu bilgisayarda eski veritabanı bulunamadı.' });
        return;
      }
      const result = await uploadSuperadminDatabase(body);
      if (!result.ok) {
        setMessage({ type: 'error', text: result.error || 'Veriler aktarılamadı.' });
        return;
      }
      setMessage({ type: 'success', text: describeImport(result) });
      onImported();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-slate-700 bg-slate-800 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <UploadCloud className="w-5 h-5 text-purple-400" />
        <h3 className="font-semibold">Eski bilgisayarlardaki verileri sunucuya aktar</h3>
      </div>
      <p className="text-sm text-slate-400">
        Daha önce farklı bilgisayarlarda verdiğiniz lisansları ve okul verilerini buraya toplayın.
        Dosyadaki lisans, kullanıcı ve kayıtlardan sunucuda olmayanlar eklenir; var olanların üzerine yazılmaz.
        Okul bilgisayarlarındaki dosya: <code className="bg-slate-900 px-1 rounded">%LOCALAPPDATA%\OkulNobetProgrami\database.sqlite</code>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {hasLocalDb && (
          <button
            type="button"
            disabled={loading}
            onClick={() => runImport(readLocalDatabase)}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-700 disabled:opacity-60"
          >
            Bu bilgisayardaki verileri aktar
          </button>
        )}
        <label className={`px-3 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 cursor-pointer ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          Dosya seçip aktar
          <input
            type="file"
            accept=".sqlite,.db,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void runImport(() => file.arrayBuffer());
            }}
          />
        </label>
        {loading && <Loader2 className="w-5 h-5 animate-spin text-slate-400" />}
      </div>
      {message && (
        <div className={`text-sm px-3 py-2 rounded-lg border ${
          message.type === 'success'
            ? 'bg-emerald-900/40 border-emerald-700 text-emerald-200'
            : 'bg-red-900/40 border-red-700 text-red-200'
        }`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
