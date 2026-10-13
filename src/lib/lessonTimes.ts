import type { LessonTime } from '../types';

/** "8:30", "08:30" ve "08:30:00" değerlerini "SS:DD" biçimine çevirir. */
export function normalizeClock(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function getTimeDiffInMinutes(oldTime: string, newTime: string): number {
  const oldN = normalizeClock(oldTime);
  const newN = normalizeClock(newTime);
  if (!oldN || !newN) return 0;
  const [oldH, oldM] = oldN.split(':').map(Number);
  const [newH, newM] = newN.split(':').map(Number);
  return (newH * 60 + newM) - (oldH * 60 + oldM);
}

export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const day = 24 * 60;
  const total = ((h * 60 + m + minutes) % day + day) % day;
  const newH = Math.floor(total / 60);
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

/**
 * Bir dersin başlangıç veya bitişini değiştirir.
 * O dersin kendisi ve sonraki dersler aynı dakika kadar kayar.
 * Önceki derslere dokunulmaz.
 */
export function shiftLessonTimes(
  times: LessonTime[],
  index: number,
  field: 'start' | 'end',
  newValue: string,
): LessonTime[] {
  const normalized = normalizeClock(newValue);
  if (index < 0 || index >= times.length || !normalized) return times.map(t => ({ ...t }));

  const updated = times.map(t => ({ ...t }));
  const delta = getTimeDiffInMinutes(updated[index][field], normalized);
  if (delta === 0) return updated;
  newValue = normalized;
  if (field === 'start') {
    updated[index] = {
      ...updated[index],
      start: newValue,
      end: addMinutesToTime(updated[index].end, delta),
    };
  } else {
    updated[index] = { ...updated[index], end: newValue };
  }

  for (let i = index + 1; i < updated.length; i++) {
    updated[i] = {
      ...updated[i],
      start: addMinutesToTime(updated[i].start, delta),
      end: addMinutesToTime(updated[i].end, delta),
    };
  }

  return updated;
}
