import { VicePrincipal } from '../types';

/** Her nöbet gününe müdür yardımcısı atar; çoklu listede yıl boyu dengeli dağıtım. */
export function assignVicePrincipalsToDates(
  sortedDates: string[],
  vicePrincipals: VicePrincipal[],
): Record<string, VicePrincipal> {
  const map: Record<string, VicePrincipal> = {};
  if (vicePrincipals.length === 0 || sortedDates.length === 0) return map;

  if (vicePrincipals.length === 1) {
    const only = vicePrincipals[0];
    for (const date of sortedDates) map[date] = only;
    return map;
  }

  const counts = new Map<string, number>();
  for (const vp of vicePrincipals) counts.set(vp.id, 0);

  const stableOrder = [...vicePrincipals].sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  for (const date of sortedDates) {
    const chosen = [...stableOrder].sort((a, b) => {
      const diff = (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, 'tr');
    })[0];
    map[date] = chosen;
    counts.set(chosen.id, (counts.get(chosen.id) ?? 0) + 1);
  }

  return map;
}

export function countVpDutiesByPrincipal(
  vpByDate: Record<string, VicePrincipal>,
): { vp: VicePrincipal; count: number }[] {
  const counts = new Map<string, { vp: VicePrincipal; count: number }>();
  for (const vp of Object.values(vpByDate)) {
    const entry = counts.get(vp.id);
    if (entry) entry.count++;
    else counts.set(vp.id, { vp, count: 1 });
  }
  return [...counts.values()].sort((a, b) => a.vp.name.localeCompare(b.vp.name, 'tr'));
}
