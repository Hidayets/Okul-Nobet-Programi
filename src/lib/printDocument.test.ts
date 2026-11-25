import { describe, expect, it } from 'vitest';
import { buildPrintDocument } from './printDocument';

describe('buildPrintDocument', () => {
  it('yatay A4 belgeyi tarayıcı yazdırma çağrısı olmadan üretir', () => {
    const doc = buildPrintDocument('Nöbet çizelgesi', '<table><tr><td>Ali</td></tr></table>', 'landscape', '.x{color:red}');
    expect(doc).toContain('@page { margin: 12mm; }');
    expect(doc).not.toContain('size: A4');
    expect(doc).not.toContain('window.print()');
    expect(doc).toContain('Ali');
    expect(doc).toContain('.x{color:red}');
    expect(doc).toContain('background-color: #fff !important');
    expect(doc).toContain('.schedule-week-row td');
    expect(doc).toContain('.schedule-print-section button');
    expect(doc).toContain('--print-zebra');
  });

  it('gövnedeki stil etiketini kapatır, betiği kapatmaz', () => {
    const doc = buildPrintDocument('Günlük', '<style>td{color:red}</style><p>Ali</p><script>x</script>', 'landscape', '');
    expect(doc).toContain('</style><p>Ali</p>');
    expect(doc).toContain('<\\/script>');
  });

  it('dikey sayfa boyutunu ve seçilen boşluğu yazar', () => {
    const doc = buildPrintDocument('Devamsızlık', '<p>Liste</p>', 'portrait', '', { marginMm: 25, paper: 'A4' });
    expect(doc).toContain('margin: 25mm');
    expect(doc).not.toContain('size: A4');
  });
});
