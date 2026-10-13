import { SchoolSettings, calculateLessonTimes } from '../types';
import { addMinutesToTime } from './lessonTimes';

export const DEFAULT_DUTY_MINUTES_BEFORE = 15;
export const DEFAULT_DUTY_MINUTES_AFTER = 15;

export function dutyClockRange(settings?: SchoolSettings): { start: string; end: string } | null {
  if (!settings) return null;
  const times = calculateLessonTimes(settings);
  if (times.length === 0) return null;
  const before = settings.dutyMinutesBefore ?? DEFAULT_DUTY_MINUTES_BEFORE;
  const after = settings.dutyMinutesAfter ?? DEFAULT_DUTY_MINUTES_AFTER;
  return {
    start: addMinutesToTime(times[0].start, -before),
    end: addMinutesToTime(times[times.length - 1].end, after),
  };
}

export function formatDutyClock(range: { start: string; end: string } | null): string {
  if (!range) return '';
  return `${range.start}–${range.end}`;
}
