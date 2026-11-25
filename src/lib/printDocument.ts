/** Basılı çıktı: renksiz, dolgusuz. Hafta ayrımı kalın çizgi ve kalın yazıyla kalır. */
export const PLAIN_PRINT_CSS = `
html body .print-preview-sheet,
html body .print-preview-sheet * {
  background: #fff !important;
  background-color: #fff !important;
  background-image: none !important;
  color: #000 !important;
  box-shadow: none !important;
  text-shadow: none !important;
  -webkit-print-color-adjust: economy !important;
  print-color-adjust: economy !important;
}
html body .print-preview-sheet .print-zebra-row td {
  background: var(--print-zebra, #fff) !important;
  background-color: var(--print-zebra, #fff) !important;
}
html body .print-preview-sheet .schedule-print-section button,
html body .print-preview-sheet .schedule-print-section button * {
  display: inline !important;
  border: none !important;
  outline: none !important;
  border-radius: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  background: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
}
html body .print-preview-sheet,
html body .print-preview-sheet .schedule-print-section,
html body .print-preview-sheet .app-card,
html body .print-preview-sheet .overflow-hidden,
html body .print-preview-sheet .overflow-x-auto,
html body .print-preview-sheet .overflow-y-auto,
html body .print-preview-sheet .overflow-auto {
  overflow: visible !important;
  max-height: none !important;
  height: auto !important;
  page-break-inside: auto !important;
  break-inside: auto !important;
}
.print-preview-sheet table {
  border-collapse: collapse !important;
  width: 100% !important;
  max-width: 100% !important;
}
.print-preview-sheet tr,
.print-preview-sheet .teacher-block {
  break-inside: avoid;
  page-break-inside: avoid;
}
.print-preview-sheet th, .print-preview-sheet td {
  border-color: #000 !important;
}
.print-preview-sheet .schedule-week-row td,
.print-preview-sheet .print-week-sep td {
  font-size: 12pt !important;
  font-weight: 800 !important;
  letter-spacing: 0.08em !important;
  text-align: center !important;
  text-transform: uppercase !important;
  padding: 6px 4px !important;
  border-top: 2.5px solid #000 !important;
  border-bottom: 2.5px solid #000 !important;
  line-height: 1.3 !important;
}
`;

/** Yazıcıya gönderilen belgenin HTML'i. Tarayıcı penceresi açmaz. */
export function buildPrintDocument(
  title: string,
  bodyHtml: string,
  page: 'portrait' | 'landscape',
  css: string,
  options?: { paper?: string; marginMm?: number; contentZoom?: number },
): string {
  const safeTitle = title.replace(/[&<>]/g, (ch) => (
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'
  ));
  const safeBody = bodyHtml.replace(/<\/script/gi, '<\\/script');
  const marginMm = Number.isFinite(options?.marginMm) ? Math.max(0, Number(options?.marginMm)) : 12;

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
${css}
${PLAIN_PRINT_CSS}
@page { margin: ${marginMm}mm; }
html, body {
  margin: 0;
  background: #fff !important;
  height: auto !important;
  overflow: visible !important;
}
.print-preview-sheet {
  width: 100%;
}
.hidden.print\\:block { display: block !important; }
.print\\:hidden { display: none !important; }
.absence-print-section, .duty-counts-print-section { display: block !important; }
</style>
</head>
<body>
<div class="print-preview-sheet">${safeBody}</div>
</body>
</html>`;
}
