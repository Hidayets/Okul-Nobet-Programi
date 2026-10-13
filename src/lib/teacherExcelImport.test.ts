import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseTeachersFromRows,
  parseTeachersFromWorksheet,
  looksLikeEmail,
  looksLikePersonName,
} from './teacherExcelImport';

function sheetFromRows(rows: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

describe('looksLikeEmail', () => {
  it('detects valid emails', () => {
    expect(looksLikeEmail('ahmet.yilmaz@okul.edu.tr')).toBe(true);
    expect(looksLikeEmail('not-an-email')).toBe(false);
  });
});

describe('looksLikePersonName', () => {
  it('accepts Turkish names', () => {
    expect(looksLikePersonName('Ahmet Yılmaz')).toBe(true);
    expect(looksLikePersonName('Ad Soyad')).toBe(false);
    expect(looksLikePersonName('123')).toBe(false);
  });

  it('rejects header cells with separators', () => {
    expect(looksLikePersonName('Ad-Soyad')).toBe(false);
    expect(looksLikePersonName('Adı Soyadı')).toBe(false);
    expect(looksLikePersonName('AD_SOYAD')).toBe(false);
    expect(looksLikePersonName('Adı-Soyadı')).toBe(false);
    expect(looksLikePersonName('ad.soyad')).toBe(false);
    expect(looksLikePersonName('İsim Soyisim')).toBe(false);
    expect(looksLikePersonName('E-Posta')).toBe(false);
    expect(looksLikePersonName('Nöbet Tipi')).toBe(false);
  });

  it('does not misclassify real names that resemble headers', () => {
    expect(looksLikePersonName('Adnan Soyadgil')).toBe(true);
    expect(looksLikePersonName('Adil Soydan')).toBe(true);
  });
});

describe('parseTeachersFromRows', () => {
  it('parses standard headers with ad soyad and email', () => {
    const rows = [
      ['Ad Soyad', 'E-posta', 'Nöbet Tipi'],
      ['Ahmet Yılmaz', 'ahmet@okul.edu.tr', 'Sabit'],
      ['Ayşe Demir', '', 'Hareketli'],
    ];
    const result = parseTeachersFromRows(rows);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Ahmet Yılmaz');
    expect(result[0].email).toBe('ahmet@okul.edu.tr');
    expect(result[0].dutyType).toBe('sabit');
    expect(result[1].name).toBe('Ayşe Demir');
    expect(result[1].dutyType).toBe('hareketli');
  });

  it('parses separate ad and soyad columns', () => {
    const rows = [
      ['Ad', 'Soyad', 'Mail'],
      ['Mehmet', 'Kaya', 'mehmet@okul.edu.tr'],
      ['Zeynep', 'Çelik', ''],
    ];
    const result = parseTeachersFromRows(rows);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Mehmet Kaya');
    expect(result[0].email).toBe('mehmet@okul.edu.tr');
    expect(result[1].name).toBe('Zeynep Çelik');
  });

  it('imports name-only list without headers', () => {
    const rows = [
      ['Ahmet Yılmaz'],
      ['Ayşe Demir'],
      ['Mehmet Kaya'],
    ];
    const result = parseTeachersFromRows(rows);
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.name)).toEqual(['Ahmet Yılmaz', 'Ayşe Demir', 'Mehmet Kaya']);
  });

  it('detects email column by content without header keyword', () => {
    const rows = [
      ['İsim', 'İletişim'],
      ['Ali Veli', 'ali@okul.edu.tr'],
      ['Fatma Nur', 'fatma@okul.edu.tr'],
    ];
    const result = parseTeachersFromRows(rows);
    expect(result).toHaveLength(2);
    expect(result[0].email).toBe('ali@okul.edu.tr');
    expect(result[1].email).toBe('fatma@okul.edu.tr');
  });

  it('skips index column and reads names from second column', () => {
    const rows = [
      ['1', 'Ahmet Yılmaz'],
      ['2', 'Ayşe Demir'],
      ['3', 'Mehmet Kaya'],
    ];
    const result = parseTeachersFromRows(rows);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('Ahmet Yılmaz');
  });

  it('handles alternate header labels', () => {
    const rows = [
      ['Öğretmen', 'Email'],
      ['Can Öztürk', 'can@okul.edu.tr'],
    ];
    const result = parseTeachersFromRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Can Öztürk');
  });

  it('deduplicates same teacher', () => {
    const rows = [
      ['Ad Soyad'],
      ['Ahmet Yılmaz'],
      ['Ahmet Yılmaz'],
    ];
    const result = parseTeachersFromRows(rows);
    expect(result).toHaveLength(1);
  });

  it('does not import the header row as a teacher (Ad-Soyad variants)', () => {
    const rows = [
      ['Ad-Soyad', 'E-Posta'],
      ['Ahmet Yılmaz', 'ahmet@okul.edu.tr'],
      ['Ayşe Demir', 'ayse@okul.edu.tr'],
    ];
    const result = parseTeachersFromRows(rows);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).not.toContain('Ad-Soyad');
  });

  it('skips header even when column detection falls back to content', () => {
    const rows = [
      ['Adı Soyadı'],
      ['Ahmet Yılmaz'],
      ['Ayşe Demir'],
    ];
    const result = parseTeachersFromRows(rows);
    expect(result.map((t) => t.name)).toEqual(['Ahmet Yılmaz', 'Ayşe Demir']);
  });

  it('parses schedule columns when present', () => {
    const rows = [
      ['Ad Soyad', 'Pzt-1', 'Sal-2'],
      ['Ahmet Yılmaz', '9/A', '10/B'],
    ];
    const result = parseTeachersFromRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].schedule?.[1]?.[1]).toBe('9/A');
    expect(result[0].schedule?.[2]?.[2]).toBe('10/B');
  });
});

describe('parseTeachersFromWorksheet', () => {
  it('works with worksheet object', () => {
    const ws = sheetFromRows([
      ['Ad Soyad'],
      ['Test Öğretmen'],
    ]);
    const result = parseTeachersFromWorksheet(ws);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Test Öğretmen');
  });
});
