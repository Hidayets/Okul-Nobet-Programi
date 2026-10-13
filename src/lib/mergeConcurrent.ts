const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Üç yönlü alan birleştirme: başka bir bilgisayar kaydı değiştirdiyse, bu bilgisayarda
 * değiştirilen alanlar yerelden, dokunulmayan alanlar sunucudaki güncel halinden alınır.
 * `base` bilinmiyorsa yerel değişiklik olduğu gibi kullanılır.
 */
export function mergeConcurrent<T extends object>(base: T | undefined, local: T, remote: T): T {
  if (!base) return local;
  const b = base as Record<string, unknown>;
  const l = local as Record<string, unknown>;
  const result: Record<string, unknown> = { ...(remote as Record<string, unknown>) };
  const keys = new Set([...Object.keys(b), ...Object.keys(l)]);
  for (const key of keys) {
    if (same(b[key], l[key])) continue;
    if (key in l) result[key] = l[key];
    else delete result[key];
  }
  return result as T;
}
