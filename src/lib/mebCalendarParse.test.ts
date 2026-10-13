import { describe, expect, it } from 'vitest';
import {
  parseMebCalendarText,
  hashMebHolidays,
  MEB_CALENDAR_URLS,
} from './mebCalendarParse';

const SAMPLE_2026_2027 = `
2026-2027 EĞİTİM ÖĞRETİM YILI TAKVİMİ AÇIKLANDI
Millî Eğitim Bakanlığınca 2026-2027 eğitim öğretim yılı takvimi açıklandı.
2026-2027 eğitim ve öğretim yılında birinci dönem ara tatili 16 Kasım 2026 Pazartesi günü başlayacak ve 20 Kasım 2026 Cuma günü sona erecek.
Yarıyıl tatili 25 Ocak 2027 Pazartesi günü başlayıp 5 Şubat 2027 Cuma günü tamamlanacak.
İkinci dönemin ara tatili 8 Mart 2027 Pazartesi günü başlayacak ve 12 Mart 2027 Cuma günü sona erecek.
2026-2027 eğitim ve öğretim yılı, 25 Haziran 2027 Cuma günü tamamlanacak.
`;

const SAMPLE_2025_2026 = `
2025-2026 EĞİTİM ÖĞRETİM YILI TAKVİMİ AÇIKLANDI
Birinci dönem ara tatili, 10-14 Kasım arasında yapılacak.
Yarıyıl tatili de 19 Ocak 2026 Pazartesi başlayacak ve 30 Ocak 2026 Cuma günü sona erecek.
İkinci dönemin ara tatili ise 16 Mart 2026 tarihinde başlayıp 20 Mart 2026 Cuma sona erecek.
`;

describe('parseMebCalendarText', () => {
  it('2026-2027 MEB sayfasından ara tatil ve yarıyıl çıkarır', () => {
    const parsed = parseMebCalendarText(
      SAMPLE_2026_2027,
      '2026-2027',
      MEB_CALENDAR_URLS['2026-2027'],
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.academicYear).toBe('2026-2027');
    expect(parsed!.title).toBe('2026-2027 Eğitim-Öğretim Yılı');

    const ara1 = parsed!.holidays.filter(h => h.name === '1. Ara Tatil');
    expect(ara1.map(h => h.date)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
    ]);

    const yariyil = parsed!.holidays.filter(h => h.name === 'Yarıyıl Tatili');
    expect(yariyil[0].date).toBe('2027-01-25');
    expect(yariyil[yariyil.length - 1].date).toBe('2027-02-05');

    const ara2 = parsed!.holidays.filter(h => h.name === '2. Ara Tatil');
    expect(ara2.map(h => h.date)).toEqual([
      '2027-03-08',
      '2027-03-09',
      '2027-03-10',
      '2027-03-11',
      '2027-03-12',
    ]);

    expect(parsed!.contentHash).toBe(hashMebHolidays(parsed!.holidays));
  });

  it('2025-2026 kompakt tarih biçimini çözer', () => {
    const parsed = parseMebCalendarText(
      SAMPLE_2025_2026,
      '2025-2026',
      MEB_CALENDAR_URLS['2025-2026'],
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.holidays.filter(h => h.name === '1. Ara Tatil').map(h => h.date)).toEqual([
      '2025-11-10',
      '2025-11-11',
      '2025-11-12',
      '2025-11-13',
      '2025-11-14',
    ]);
    expect(parsed!.holidays.filter(h => h.name === 'Yarıyıl Tatili')[0].date).toBe('2026-01-19');
    expect(parsed!.holidays.filter(h => h.name === '2. Ara Tatil').map(h => h.date)).toEqual([
      '2026-03-16',
      '2026-03-17',
      '2026-03-18',
      '2026-03-19',
      '2026-03-20',
    ]);
  });
});
