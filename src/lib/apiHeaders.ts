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

const CLIENT_NAME_KEY = 'clientName';

/** Değişiklik geçmişinde görünen cihaz adı (masaüstünde bilgisayar adı). */
export function setClientName(name: string | null | undefined) {
  try {
    if (name && name.trim()) localStorage.setItem(CLIENT_NAME_KEY, name.trim().slice(0, 60));
  } catch {}
}

export function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const acting = getActingKurumKodu();
  if (acting) headers['X-Acting-Kurum-Kodu'] = acting;
  const clientName = localStorage.getItem(CLIENT_NAME_KEY);
  // Başlıklar yalnızca ASCII taşıyabildiğinden Türkçe karakterli adlar kodlanır.
  if (clientName) headers['X-Client-Name'] = encodeURIComponent(clientName);
  return headers;
}
