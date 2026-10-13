import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { buildPrintDocument } from '../lib/printDocument';

type PrintPdfResult = { ok?: boolean; error?: string };

function collectDocumentCss(): string {
  const chunks: string[] = [];
  const sheets = [
    ...Array.from(document.styleSheets),
    ...Array.from(document.adoptedStyleSheets ?? []),
  ];
  for (const sheet of sheets) {
    try {
      for (const rule of sheet.cssRules) chunks.push(rule.cssText);
    } catch {
      /* başka kaynaktan gelen stil sayfası okunamaz */
    }
  }
  return chunks.join('\n');
}

async function requestDocumentPrint(title: string, html: string, page: 'portrait' | 'landscape'): Promise<string | null> {
  const api = (window as unknown as {
    electronAPI?: { printPdf?: (opts: { html: string }) => Promise<PrintPdfResult> };
  }).electronAPI;
  if (api?.printPdf) {
    const result = await api.printPdf({ html: buildPrintDocument(title, html, page, collectDocumentCss()) });
    if (!result?.ok) return result?.error || 'Yazdırma penceresi açılamadı.';
    return null;
  }
  window.print();
  return null;
}

/** Ekranda gizli duran yazdırma bölümünün HTML'ini alır. */
export function capturePrintHtml(selector: string): string | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  return (el as HTMLElement).outerHTML.replace(/display:\s*none/gi, 'display:block');
}

interface Props {
  title: string;
  html: string;
  page?: 'portrait' | 'landscape';
  onClose: () => void;
}

export default function PrintPreview({ title, html, page = 'portrait', onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onPrint = async () => {
    setBusy(true);
    setError(null);
    try {
      const message = await requestDocumentPrint(title, html, page);
      if (message) setError(message);
    } catch {
      setError('Yazdırma hazırlanamadı.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="print-preview-root fixed inset-0 z-[80] flex flex-col bg-slate-900/70">
      <style>{`
        .print-preview-sheet .hidden.print\\:block { display: block !important; }
        .print-preview-sheet .print\\:hidden { display: none !important; }
        .print-preview-sheet .absence-print-section,
        .print-preview-sheet .duty-counts-print-section { display: block !important; }
        @media print {
          @page { size: A4 ${page}; margin: 1cm; }
          html, body {
            height: auto !important;
            overflow: visible !important;
            background: #fff !important;
          }
          #root { display: none !important; }
          .print-preview-root {
            position: static !important;
            display: block !important;
            background: white !important;
            height: auto !important;
            overflow: visible !important;
            inset: auto !important;
          }
          .print-preview-toolbar { display: none !important; }
          .print-preview-scroll {
            overflow: visible !important;
            padding: 0 !important;
            background: white !important;
          }
          .print-preview-sheet {
            box-shadow: none !important;
            margin: 0 !important;
            max-width: none !important;
            width: 100% !important;
          }
        }
      `}</style>
      <div className="print-preview-toolbar flex items-center justify-between gap-3 px-4 py-3 bg-slate-900 text-white shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">Önizleme — {title}</div>
          <div className={`text-xs ${error ? 'text-rose-300' : 'text-slate-400'}`}>
            {error
              ? error
              : 'Yazdır, önizlemeli yazıcı penceresini açar. Küçültmek veya büyütmek için orada Diğer ayarlar → Ölçek kullanılır.'}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600"
          >
            <span className="inline-flex items-center gap-1.5"><X className="w-4 h-4" /> Kapat</span>
          </button>
          <button
            type="button"
            onClick={onPrint}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-1.5"><Printer className="w-4 h-4" /> {busy ? 'Hazırlanıyor…' : 'Yazdır'}</span>
          </button>
        </div>
      </div>
      <div className="print-preview-scroll flex-1 overflow-auto p-6">
        <div
          className="print-preview-sheet bg-white text-slate-900 mx-auto shadow-2xl"
          style={{ maxWidth: page === 'landscape' ? '1100px' : '820px', padding: '24px' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>,
    document.body,
  );
}
