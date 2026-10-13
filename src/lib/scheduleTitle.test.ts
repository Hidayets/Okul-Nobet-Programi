import { describe, it, expect } from 'vitest';
import { formatSchedulePrintTitle } from './scheduleTitle';

describe('formatSchedulePrintTitle', () => {
  it('uses single month title when all dates are in same month', () => {
    const title = formatSchedulePrintTitle(['2026-03-02', '2026-03-15', '2026-03-28']);
    expect(title).toBe('MART AYI NÖBET PROGRAMI');
  });

  it('uses month range within same year', () => {
    const title = formatSchedulePrintTitle(['2026-03-02', '2026-06-20']);
    expect(title).toBe('MART - HAZİRAN 2026 NÖBET PROGRAMI');
  });

  it('uses year span when months cross calendar years', () => {
    const title = formatSchedulePrintTitle(['2025-09-01', '2026-06-15']);
    expect(title).toBe('EYLÜL 2025 - HAZİRAN 2026 NÖBET PROGRAMI');
  });
});
