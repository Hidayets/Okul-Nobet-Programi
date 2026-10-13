/** Merdiven usulü: öğretmen her yeni nöbetinde bir sonraki güne ve bir sonraki nöbet yerine kayar. */

export interface StaircaseSlot {
  dateStr: string;
  dayOfWeek: number;
  locationId: string;
  teacherId: string;
}

export interface StaircaseTarget {
  /** Hedef gün (days dizisindeki sıra); bilinmiyorsa -1 */
  dayIdx: number;
  /** Hedef nöbet yeri (ring dizisindeki sıra); bilinmiyorsa -1 */
  locIdx: number;
}

export interface LastDuty {
  dayOfWeek: number;
  locationId: string;
}

/** Son nöbetten bir adım sonraki gün ve yer. */
export function staircaseTarget(
  last: LastDuty | undefined,
  days: number[],
  ring: string[],
): StaircaseTarget | null {
  if (!last) return null;
  const d = days.indexOf(last.dayOfWeek);
  const l = ring.indexOf(last.locationId);
  return {
    dayIdx: d < 0 || days.length === 0 ? -1 : (d + 1) % days.length,
    locIdx: l < 0 || ring.length === 0 ? -1 : (l + 1) % ring.length,
  };
}

export interface ArrangeOptions {
  days: number[];
  ring: string[];
  targets: Record<string, StaircaseTarget | null | undefined>;
  preferredDayOf: (teacherId: string) => number | undefined;
  /** Öğretmen bu gün nöbet tutabilir mi (zorunlu kural) */
  dayOk: (teacherId: string, slot: StaircaseSlot) => boolean;
  /** Öğretmenin atandığı yer kuralına uyuyor mu (mevcuttan kötüye gidilmez) */
  homeOk: (teacherId: string, slot: StaircaseSlot) => boolean;
}

export function staircaseScore(teacherId: string, slot: StaircaseSlot, opts: ArrangeOptions): number {
  let score = 0;
  if (opts.preferredDayOf(teacherId) === slot.dayOfWeek) score += 4;
  const target = opts.targets[teacherId];
  if (target) {
    if (target.dayIdx >= 0 && opts.days[target.dayIdx] === slot.dayOfWeek) score += 2;
    if (target.locIdx >= 0 && opts.ring[target.locIdx] === slot.locationId) score += 1;
  }
  return score;
}

/**
 * Haftanın nöbetçileri belirlendikten sonra, kişileri merdiven hedeflerine en çok uyacak
 * şekilde haftanın slotları arasında takas eder. Kimin nöbet tutacağı değişmez.
 */
export function arrangeStaircaseWeek(slots: StaircaseSlot[], opts: ArrangeOptions): StaircaseSlot[] {
  const result = slots.map(s => ({ ...s }));
  const n = result.length;

  const slotsOnDate = (teacherId: string, dateStr: string, except: number[]) => {
    let c = 0;
    for (let k = 0; k < n; k++) {
      if (except.includes(k)) continue;
      if (result[k].teacherId === teacherId && result[k].dateStr === dateStr) c++;
    }
    return c;
  };
  const busyAt = (teacherId: string, slot: StaircaseSlot, except: number[]) => {
    for (let k = 0; k < n; k++) {
      if (except.includes(k)) continue;
      const o = result[k];
      if (o.teacherId === teacherId && o.dateStr === slot.dateStr && o.locationId === slot.locationId) return true;
    }
    return false;
  };
  const canMove = (teacherId: string, from: StaircaseSlot, to: StaircaseSlot, except: number[]) => {
    if (!opts.dayOk(teacherId, to)) return false;
    if (!opts.homeOk(teacherId, to) && opts.homeOk(teacherId, from)) return false;
    if (busyAt(teacherId, to, except)) return false;
    if (from.dateStr !== to.dateStr && slotsOnDate(teacherId, to.dateStr, except) > 0) return false;
    return true;
  };

  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = result[i];
        const b = result[j];
        if (a.teacherId === b.teacherId) continue;
        if (a.dateStr === b.dateStr && a.locationId === b.locationId) continue;
        const before = staircaseScore(a.teacherId, a, opts) + staircaseScore(b.teacherId, b, opts);
        const after = staircaseScore(a.teacherId, b, opts) + staircaseScore(b.teacherId, a, opts);
        if (after <= before) continue;
        if (!canMove(a.teacherId, a, b, [i, j]) || !canMove(b.teacherId, b, a, [i, j])) continue;
        const tmp = a.teacherId;
        a.teacherId = b.teacherId;
        b.teacherId = tmp;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return result;
}
