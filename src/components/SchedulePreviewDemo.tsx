import { getScheduleColumnHeader, getWeekHeaderStyle } from '../lib/headerColors';

const DEMO_LOCATIONS = ['Bahçe', 'Koridor', 'Kantin'];

/** Program yokken çizelgenin nasıl görüneceğini gösteren örnek tablo */
export default function SchedulePreviewDemo() {
  const weekStyle = getWeekHeaderStyle(12);
  const vpCol = getScheduleColumnHeader(DEMO_LOCATIONS.length + 1);

  return (
    <div className="mt-8 text-left max-w-5xl mx-auto print:hidden">
      <p className="text-xs text-center text-slate-400 mb-3 uppercase tracking-wide font-medium">
        Örnek çizelge görünümü
      </p>
      <div className="rounded-xl border border-dashed border-slate-300 overflow-hidden shadow-sm bg-white/80">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr>
                {(() => {
                  const h = getScheduleColumnHeader(0);
                  return (
                    <th className={`py-3 px-4 font-semibold border-r border-slate-200 ${h.bg} ${h.text}`}>
                      Tarih / Gün
                    </th>
                  );
                })()}
                {DEMO_LOCATIONS.map((name, i) => {
                  const h = getScheduleColumnHeader(i + 1);
                  return (
                    <th key={name} className={`py-3 px-4 font-semibold border-r border-slate-200 ${h.bg} ${h.text}`}>
                      {name}
                    </th>
                  );
                })}
                <th className={`py-3 px-4 font-semibold ${vpCol.bg} ${vpCol.text}`}>
                  Nöbetçi Md. Yrd.
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  colSpan={DEMO_LOCATIONS.length + 2}
                  className={`py-1.5 px-4 text-xs font-bold tracking-wide bg-gradient-to-r ${weekStyle}`}
                >
                  12. HAFTA
                </td>
              </tr>
              <tr className="border-b border-slate-200 print-zebra-row">
                <td className="py-3 px-4 border-r border-slate-200 bg-[#dbeafe]">
                  <div className="font-medium text-slate-900">16.03.2026</div>
                  <div className="text-xs text-slate-500">Pazartesi</div>
                </td>
                {['Ayşe YILMAZ', 'Mehmet DEMİR', 'Ali KAYA'].map((name, i) => (
                  <td key={i} className="py-3 px-4 border-r border-slate-200">
                    <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {name}
                    </span>
                  </td>
                ))}
                <td className="py-3 px-4 text-sm font-medium text-slate-700">Fatma ÖZ</td>
              </tr>
              <tr className="bg-rose-50/80 border-b border-rose-200">
                <td className="py-3 px-4 border-r border-rose-200">
                  <div className="font-medium text-rose-900">19.03.2026</div>
                  <div className="text-xs text-rose-600">Perşembe</div>
                </td>
                <td
                  colSpan={DEMO_LOCATIONS.length + 1}
                  className="py-3 px-4 text-center font-semibold text-rose-800"
                >
                  2. Ara Tatil
                </td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-3 px-4 border-r border-slate-200">
                  <div className="font-medium text-slate-900">23.03.2026</div>
                  <div className="text-xs text-slate-500">Pazartesi</div>
                </td>
                <td className="py-3 px-4 border-r border-slate-200">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
                    Zeynep AK
                    <span className="text-[10px] font-bold bg-amber-500 text-white px-1 rounded-sm">2x</span>
                  </span>
                </td>
                <td className="py-3 px-4 border-r border-slate-200">
                  <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                    Hasan ÇELİK
                  </span>
                </td>
                <td className="py-3 px-4 border-r border-slate-200">
                  <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                    Elif YILDIZ
                  </span>
                </td>
                <td className="py-3 px-4 text-sm font-medium text-slate-700">Ahmet POLAT</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <ul className="mt-4 grid sm:grid-cols-2 gap-2 text-xs text-slate-500 max-w-2xl mx-auto">
        <li className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-indigo-100 border border-indigo-200 shrink-0" />
          Normal nöbet
        </li>
        <li className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-300 shrink-0" />
          Çift nöbet (2x)
        </li>
        <li className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-rose-100 border border-rose-200 shrink-0" />
          Tatil günü (nöbet yok)
        </li>
        <li className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-gradient-to-r from-violet-200 to-violet-50 border border-violet-200 shrink-0" />
          Hafta başlığı (renkli)
        </li>
      </ul>
    </div>
  );
}
