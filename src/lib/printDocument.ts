/** Tarayıcının yazdırma önizlemesinde açılan, ölçek ayarı yapılabilir belge. */
export function buildPrintDocument(
  title: string,
  bodyHtml: string,
  page: 'portrait' | 'landscape',
  css: string,
): string {
  const safeTitle = title.replace(/[&<>]/g, (ch) => (
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'
  ));
  const safeBody = bodyHtml.replace(/<\/(script|style)/gi, '<\\/$1');

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
${css}
@page { size: A4 ${page}; margin: 8mm; }
html, body {
  margin: 0;
  background: #fff !important;
  height: auto !important;
  overflow: visible !important;
}
.print-preview-sheet, .print-preview-sheet * {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
.hidden.print\\:block { display: block !important; }
.print\\:hidden { display: none !important; }
.absence-print-section, .duty-counts-print-section { display: block !important; }
.print-launch-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 10px 14px;
  background: #0f172a;
  color: #fff;
  font: 13px/1.4 "Segoe UI", sans-serif;
}
.print-launch-bar button {
  border: 0;
  background: #4f46e5;
  color: #fff;
  border-radius: 8px;
  padding: 8px 14px;
  font-weight: 600;
  cursor: pointer;
}
@media print {
  .print-launch-bar { display: none !important; }
}
</style>
</head>
<body>
<div class="print-launch-bar">
  <span>Önizlemede sayfalar görünür. Küçültmek veya büyütmek için <b>Diğer ayarlar → Ölçek</b> değerini değiştirin.</span>
  <button type="button" onclick="window.print()">Yazdır</button>
</div>
<div class="print-preview-sheet">${safeBody}</div>
<script>
  window.addEventListener('load', async function () {
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
    setTimeout(function () { window.print(); }, 400);
  });
</script>
</body>
</html>`;
}
