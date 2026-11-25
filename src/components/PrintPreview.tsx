import { useEffect, useRef } from 'react';
import { buildPrintDocument } from '../lib/printDocument';

type PrintPdfResult = { ok?: boolean; error?: string; canceled?: boolean };

type ElectronPrintApi = {
  printPdf?: (opts: Record<string, unknown>) => Promise<PrintPdfResult>;
};

function electronApi(): ElectronPrintApi | null {
  const api = (window as unknown as { electronAPI?: ElectronPrintApi }).electronAPI;
  return api?.printPdf ? api : null;
}

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
  note?: string;
  onClose: () => void;
}

/** Yazdır deyince belge varsayılan tarayıcıda açılır ve tarayıcı önizlemesi gösterilir. */
export default function PrintPreview({ title, html, page = 'portrait', onClose }: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      if (!cancelled) onCloseRef.current();
    };

    const api = electronApi();
    const documentHtml = buildPrintDocument(title, html, page, collectDocumentCss(), { marginMm: 12 });
    if (!api?.printPdf) {
      const preview = window.open('', '_blank');
      if (preview) {
        preview.document.open();
        preview.document.write(documentHtml);
        preview.document.close();
        preview.focus();
        preview.print();
      }
      finish();
      return () => { cancelled = true; };
    }

    api.printPdf({ html: documentHtml })
      .then((result) => {
        if (cancelled) return;
        if (result && !result.ok && !result.canceled && result.error) {
          window.alert(result.error);
        }
      })
      .catch(() => {
        if (!cancelled) window.alert('Yazdırma hazırlanamadı.');
      })
      .finally(() => {
        finish();
      });

    return () => { cancelled = true; };
  }, [title, html, page]);

  return null;
}
