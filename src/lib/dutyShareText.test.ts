import { describe, expect, it } from 'vitest';
import { formatDutyWhatsAppText } from './dutyShareText';

describe('formatDutyWhatsAppText', () => {
  it('nöbetleri WhatsApp metnine çevirir', () => {
    const text = formatDutyWhatsAppText('Ayşe Yılmaz', [
      { when: '13 Ekim 2026 Pazartesi', place: 'Bahçe' },
      { when: '20 Ekim 2026 Pazartesi', place: 'Kat 1', note: 'çift nöbet' },
    ]);
    expect(text).toBe(
      'Ayşe Yılmaz nöbet listesi\n• 13 Ekim 2026 Pazartesi — Bahçe\n• 20 Ekim 2026 Pazartesi — Kat 1 (çift nöbet)',
    );
  });

  it('nöbet yoksa bunu yazar', () => {
    expect(formatDutyWhatsAppText('Ali', [])).toBe('Ali için kayıtlı nöbet yok.');
  });
});
