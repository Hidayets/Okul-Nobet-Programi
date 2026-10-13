import { describe, it, expect } from 'vitest';
import { buildPrintDocument } from './printDocument';

describe('buildPrintDocument', () => {
  it('yatay sayfada yazdırma önizlemesini ve ölçek notunu içerir', () => {
    const doc = buildPrintDocument('Nöbet çizelgesi', '<table><tr><td>Ali</td></tr></table>', 'landscape', '.x{color:red}');
    expect(doc).toContain('@page { size: A4 landscape; margin: 8mm; }');
    expect(doc).toContain('window.print()');
    expect(doc).toContain('Diğer ayarlar');
    expect(doc).toContain('Ali');
    expect(doc).toContain('.x{color:red}');
  });

  it('dikey sayfa boyutunu yazar', () => {
    const doc = buildPrintDocument('Devamsızlık', '<p>Liste</p>', 'portrait', '');
    expect(doc).toContain('size: A4 portrait');
  });
});
