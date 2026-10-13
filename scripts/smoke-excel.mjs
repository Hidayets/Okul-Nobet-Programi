// Geçici duman testi: dutyScheduleExcel modülünü Node'da çalıştırır.
// Tarayıcı API'leri (Blob/URL/document) minimal taklit edilir.
globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
globalThis.document = {
  createElement: () => ({
    set href(v) {}, set download(v) {},
    click() { globalThis.__clicked = true; },
  }),
  body: { appendChild() {}, removeChild() {} },
};

const { exportDutyScheduleToExcel } = await import('../src/lib/dutyScheduleExcel.ts');

const rows = [
  { type: 'duty', date: '2026-09-28' },
  { type: 'duty', date: '2026-09-29' },
  { type: 'holiday', date: '2026-09-30', holidayName: 'Cumhuriyet Bayramı' },
  { type: 'duty', date: '2026-10-01' },
  { type: 'duty', date: '2026-10-05' },
];

const params = {
  rows,
  locations: [{ id: 'l1', name: 'Kat Girişi' }, { id: 'l2', name: 'Bahçe' }],
  scheduleData: {
    '2026-09-28': { l1: [{ teacher: { name: 'Ali Veli' }, isDoubleDuty: true }, { teacher: { name: 'Ayşe Can' } }], l2: [{ teacher: { name: 'Mehmet Ok' } }] },
    '2026-09-29': { l1: [{ teacher: { name: 'Mehmet Ok' } }] },
    '2026-10-01': { l2: [{ teacher: { name: 'Ayşe Can' } }] },
    '2026-10-05': { l1: [{ teacher: { name: 'Ali Veli' } }] },
  },
  vpByDate: { '2026-09-28': { name: 'Fatma Yıldız' } },
  schoolInfo: { valilik: 'Test', kaymakamlik: 'Merkez', okulAdi: 'Deneme Okulu', okulMuduru: 'Müdür Bey' },
  title: 'EYLÜL AYI NÖBET PROGRAMI',
  yearLabel: '2026-2027',
};

const name = await exportDutyScheduleToExcel(params);
console.log('OK:', name, 'clicked:', globalThis.__clicked, 'blobParts:', (await Promise.all()).length ?? '');
