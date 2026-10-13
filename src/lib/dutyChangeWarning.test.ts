import { describe, expect, it } from 'vitest';
import { getDay, parseISO } from 'date-fns';
import { dutyChangeWarnings } from './dutyChangeWarning';
import type { Teacher } from '../types';

const date = '2026-10-08';
const day = getDay(parseISO(date));

const ayse: Teacher = {
  id: 'a',
  name: 'Ayşe',
  schedule: { [day]: { 1: '5-A', 2: '5-B' } },
};

describe('dutyChangeWarnings', () => {
  it('dersi ve aynı gün başka nöbeti olan öğretmeni kaydetmeden uyarır', () => {
    const warnings = dutyChangeWarnings({
      teacher: ayse,
      date,
      assignments: [
        { id: '1', date, locationId: 'bahce', teacherId: 'a' },
        { id: '2', date, locationId: 'kat', teacherId: 'b' },
      ],
      locations: [
        { id: 'bahce', name: 'Bahçe' },
        { id: 'kat', name: 'Kat 1' },
      ],
      absences: [],
      excludeAssignmentId: '2',
    });
    expect(warnings).toContain('Bu gün 2 dersi var.');
    expect(warnings).toContain('Aynı gün Bahçe nöbeti de var.');
  });

  it('çakışma yoksa boş döner', () => {
    const warnings = dutyChangeWarnings({
      teacher: { id: 'c', name: 'Can' },
      date,
      assignments: [],
      locations: [],
      absences: [],
    });
    expect(warnings).toEqual([]);
  });
});
