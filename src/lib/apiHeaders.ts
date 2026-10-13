const ACTING_KURUM_KEY = 'superadminActingKurumKodu';

export function getActingKurumKodu(): string | null {
  try {
    return localStorage.getItem(ACTING_KURUM_KEY);
  } catch {
    return null;
  }
}

export function setActingKurumKoduStorage(kurumKodu: string | null) {
  try {
    if (kurumKodu) {
      localStorage.setItem(ACTING_KURUM_KEY, kurumKodu);
    } else {
      localStorage.removeItem(ACTING_KURUM_KEY);
    }
  } catch {}
}

export function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const acting = getActingKurumKodu();
  if (acting) headers['X-Acting-Kurum-Kodu'] = acting;
  return headers;
}
