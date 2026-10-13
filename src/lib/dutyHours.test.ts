import { describe, expect, it } from 'vitest';
import { dutyClockRange, formatDutyClock } from './dutyHours';
import { DEFAULT_SCHOOL_SETTINGS } from '../types';

describe('dutyClockRange', () => {
  it('ilk dersten önce ve son dersten sonra nöbet aralığını verir', () => {
    const range = dutyClockRange({
      ...DEFAULT_SCHOOL_SETTINGS,
      lessonCount: 2,
      firstLessonStart: '08:30',
      lessonDuration: 40,
      breakDuration: 10,
      lunchAfterLesson: 4,
      dutyMinutesBefore: 15,
      dutyMinutesAfter: 10,
    });
    expect(formatDutyClock(range)).toBe('08:15–10:10');
  });
});
