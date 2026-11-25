import ExcelJS from 'exceljs';
import { format, parseISO, getISOWeek } from 'date-fns';
import { tr } from 'date-fns/locale';

export interface DutyScheduleExcelTeacher {
  name: string;
}

export interface DutyScheduleExcelAssignment {
  teacher: DutyScheduleExcelTeacher;
  isDoubleDuty?: boolean;
  assignment?: { isDoubleDuty?: boolean };
}

export interface DutyScheduleExcelLocation {
  id: string;
  name: string;
}

export interface DutyScheduleExcelRow {
  type: 'duty' | 'holiday';
  date: string;
  holidayName?: string;
}

export interface DutyScheduleExcelSchoolInfo {
  valilik?: string;
  kaymakamlik?: string;
  okulAdi?: string;
  okulMuduru?: string;
}

export interface DutyScheduleExcelParams {
  rows: DutyScheduleExcelRow[];
  locations: DutyScheduleExcelLocation[];
  /** tarih -> yerId -> atamalar */
  scheduleData: Record<string, Record<string, DutyScheduleExcelAssignment[]>>;
  /** tarih -> nöbetçi müdür yardımcısı */
  vpByDate: Record<string, { name: string } | null | undefined>;
  schoolInfo: DutyScheduleExcelSchoolInfo;
  title: string;
  yearLabel?: string;
}

const black = { argb: 'FF000000' };

const thinBorder: ExcelJS.Borders = {
  top: { style: 'thin', color: black },
  left: { style: 'thin', color: black },
  bottom: { style: 'thin', color: black },
  right: { style: 'thin', color: black },
  diagonal: undefined,
};

const weekBorder: ExcelJS.Borders = {
  top: { style: 'medium', color: black },
  left: { style: 'thin', color: black },
  bottom: { style: 'medium', color: black },
  right: { style: 'thin', color: black },
  diagonal: undefined,
};

function applyBorderRange(
  ws: ExcelJS.Worksheet,
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number,
  border: ExcelJS.Borders,
) {
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      ws.getCell(r, c).border = border;
    }
  }
}

function centeredTitleCell(
  ws: ExcelJS.Worksheet,
  row: number,
  colEnd: number,
  value: string,
  opts?: { size?: number; bold?: boolean },
) {
  const cell = ws.getCell(row, 1);
  cell.value = value;
  cell.font = { bold: opts?.bold ?? true, size: opts?.size ?? 10, color: { argb: 'FF000000' } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  if (colEnd > 1) ws.mergeCells(row, 1, row, colEnd);
}

/**
 * Yazdırılan nöbet çizelgesini doğrudan Excel (.xlsx) dosyası olarak üretir.
 * - Tüm haftalar tek bir sayfada olur, haftalar arasına başlık satırı eklenir.
 * - Öğretmen isimleri hücreye düz metin olarak yazılır (iç içe kutucuk yok);
 *   aynı yerde birden fazla nöbetçi varsa alt alta satır olarak yazılır.
 * - Çift nöbetli öğretmenlerin adına " (2x)" eklenir.
 */
export async function exportDutyScheduleToExcel(params: DutyScheduleExcelParams): Promise<string> {
  const { rows, locations, scheduleData, vpByDate, schoolInfo, title, yearLabel } = params;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Okul Öğretmen Nöbet Programı';
  workbook.created = new Date();

  const totalCols = 1 + locations.length + 1; // Tarih/Gün + yerler + Md. Yrd.

  // Tek bir worksheet oluştur
  const ws = workbook.addWorksheet('Nöbet Çizelgesi', {
    views: [{ showGridLines: false }],
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });

  ws.columns = [
    { width: 17 },
    ...locations.map(() => ({ width: 26 })),
    { width: 20 },
  ];

  // --- Başlık bloğu (yazdırılan antetin karşılığı) ---
  let rowIdx = 1;
  centeredTitleCell(ws, rowIdx++, totalCols, 'T.C.');
  if (schoolInfo.valilik) centeredTitleCell(ws, rowIdx++, totalCols, `${schoolInfo.valilik.toLocaleUpperCase('tr-TR')} VALİLİĞİ`);
  if (schoolInfo.kaymakamlik) centeredTitleCell(ws, rowIdx++, totalCols, `${schoolInfo.kaymakamlik.toLocaleUpperCase('tr-TR')} KAYMAKAMLIĞI`);
  if (schoolInfo.okulAdi) centeredTitleCell(ws, rowIdx++, totalCols, schoolInfo.okulAdi.toLocaleUpperCase('tr-TR'), { size: 11 });
  centeredTitleCell(ws, rowIdx++, totalCols, title, { size: 12 });
  if (yearLabel) centeredTitleCell(ws, rowIdx++, totalCols, yearLabel, { size: 10 });
  rowIdx++; // boşluk

  // --- Tablo başlığı ---
  const headerRowIdx = rowIdx++;
  ws.getCell(headerRowIdx, 1).value = 'Tarih / Gün';
  locations.forEach((loc, i) => {
    ws.getCell(headerRowIdx, 2 + i).value = loc.name;
  });
  ws.getCell(headerRowIdx, totalCols).value = 'Nöbetçi Md. Yrd.';
  for (let c = 1; c <= totalCols; c++) {
    const cell = ws.getCell(headerRowIdx, c);
    cell.font = { bold: true, size: 10, color: { argb: 'FF000000' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder;
  }
  ws.getRow(headerRowIdx).height = 24;

  // --- Veri satırları ---
  let currentWeekNum: number | null = null;
  rows.forEach((r) => {
    const parsed = parseISO(r.date);
    const weekNum = getISOWeek(parsed);
    
    // Hafta değiştiğinde başlık satırı ekle
    if (currentWeekNum === null || weekNum !== currentWeekNum) {
      currentWeekNum = weekNum;
      const weekLabelRow = rowIdx++;
      centeredTitleCell(ws, weekLabelRow, totalCols, `${weekNum}. HAFTA`, { size: 14 });
      for (let c = 1; c <= totalCols; c++) {
        const cell = ws.getCell(weekLabelRow, c);
        cell.font = { bold: true, size: 14, color: { argb: 'FF000000' } };
        cell.border = weekBorder;
      }
      ws.getRow(weekLabelRow).height = 22;
    }

    const dateText = format(parsed, 'dd.MM.yyyy');
    const dayName = format(parsed, 'EEEE', { locale: tr });

    if (r.type === 'holiday') {
      const hRow = rowIdx++;
      ws.getCell(hRow, 1).value = `${dateText}\n${dayName}`;
      ws.getCell(hRow, 1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      const label = r.holidayName ? `TATİL — ${r.holidayName}` : 'TATİL';
      if (totalCols > 1) {
        ws.getCell(hRow, 2).value = label;
        ws.mergeCells(hRow, 2, hRow, totalCols);
        ws.getCell(hRow, 2).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      }
      for (let c = 1; c <= totalCols; c++) {
        const cell = ws.getCell(hRow, c);
        cell.font = { bold: true, size: 9, color: { argb: 'FF000000' } };
        cell.border = thinBorder;
      }
      ws.getRow(hRow).height = 22;
      return;
    }

    const dRow = rowIdx++;
    ws.getCell(dRow, 1).value = `${dateText}\n${dayName}`;
    ws.getCell(dRow, 1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    ws.getCell(dRow, 1).font = { size: 9, color: { argb: 'FF000000' } };

    locations.forEach((loc, i) => {
      const entries = scheduleData[r.date]?.[loc.id] ?? [];
      const names = entries.map(e =>
        e.isDoubleDuty || e.assignment?.isDoubleDuty ? `${e.teacher.name} (2x)` : e.teacher.name,
      );
      const cell = ws.getCell(dRow, 2 + i);
      cell.value = names.length > 0 ? names.join('\n') : '-';
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      cell.font = { size: 9, color: { argb: 'FF000000' } };
    });

    const vp = vpByDate[r.date];
    const vpCell = ws.getCell(dRow, totalCols);
    vpCell.value = vp?.name ?? '-';
    vpCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    vpCell.font = { size: 9, color: { argb: 'FF000000' } };

    applyBorderRange(ws, dRow, dRow, 1, totalCols, thinBorder);
    ws.getRow(dRow).height = 22;
  });

  // --- İmza alanı ---
  rowIdx++;
  const sigTitleRow = rowIdx++;
  const sigNameRow = rowIdx++;
  if (totalCols >= 2) {
    ws.mergeCells(sigTitleRow, totalCols - 1, sigTitleRow, totalCols);
    ws.mergeCells(sigNameRow, totalCols - 1, sigNameRow, totalCols);
  }
  const sigTitleCell = ws.getCell(sigTitleRow, Math.max(1, totalCols - 1));
  sigTitleCell.value = 'Okul Müdürü';
  sigTitleCell.alignment = { horizontal: 'right', vertical: 'middle' };
  sigTitleCell.font = { size: 9, color: { argb: 'FF000000' } };

  const sigNameCell = ws.getCell(sigNameRow, Math.max(1, totalCols - 1));
  sigNameCell.value = schoolInfo.okulMuduru ?? '';
  sigNameCell.alignment = { horizontal: 'right', vertical: 'middle' };
  sigNameCell.font = { bold: true, size: 10, color: { argb: 'FF000000' } };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const safeYear = (yearLabel ?? 'Egitim_Ogretim').replace(/[^\p{L}\p{N}]+/gu, '_');
  anchor.href = url;
  anchor.download = `Nobet_Cizelgesi_${safeYear}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // İndirme başlamadan URL iptal edilirse bazı Electron sürümlerinde dosya inmiyor.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);

  return `Nobet_Cizelgesi_${(yearLabel ?? 'Egitim_Ogretim').replace(/[^\p{L}\p{N}]+/gu, '_')}.xlsx`;
}
