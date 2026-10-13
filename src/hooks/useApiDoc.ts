import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { getAuthHeaders } from '../lib/apiHeaders';
import { mergeConcurrent } from '../lib/mergeConcurrent';
import { reportSyncError, requestAuthRecheck } from '../lib/syncEvents';

const MAX_CONFLICT_RETRIES = 3;

export function useApiDoc<T>(path: string, initialValue: T) {
  const [data, setData] = useState<T>(initialValue);
  const [loaded, setLoaded] = useState(false);
  const { user, actingKurumKodu } = useAuth();

  const initialRef = useRef(initialValue);
  const dataRef = useRef(data);
  const loadedRef = useRef(false);
  const requestIdRef = useRef(0);
  // Sunucudan en son okunan/yazılan sürüm: başka bilgisayarın değişikliğini ezmeden birleştirmek için.
  const revRef = useRef<string | null>(null);
  const baseRef = useRef<T | undefined>(undefined);

  const [collectionName, docId] = path.split('/');
  const userKey = user ? `${user.uid}|${user.kurumKodu}|${user.role}` : '';

  const fetchData = useCallback(async () => {
    if (!userKey || !collectionName || !docId) return;
    const reqId = ++requestIdRef.current;
    try {
      const res = await fetch(`/api/doc/${collectionName}/${docId}`, {
        headers: getAuthHeaders()
      });
      if (reqId !== requestIdRef.current) return;
      if (res.ok) {
        const item = await res.json();
        if (reqId !== requestIdRef.current) return;
        revRef.current = res.headers.get('X-Rev');
        baseRef.current = item;
        dataRef.current = item;
        setData(item);
        loadedRef.current = true;
        setLoaded(true);
      } else if (res.status === 404) {
        // Belge henüz yok: varsayılan değerle devam edilebilir, ilk kayıt PUT ile oluşturulur.
        revRef.current = null;
        baseRef.current = undefined;
        loadedRef.current = true;
        setLoaded(true);
      } else {
        requestAuthRecheck(res.status);
      }
    } catch (err) {
      console.error(`Error fetching ${path}:`, err);
    }
  }, [path, userKey, actingKurumKodu, collectionName, docId]);

  useEffect(() => {
    // Kapsam (kullanıcı / kurum / belge) değişti: önceki kapsamın verisini taşıma.
    requestIdRef.current++;
    loadedRef.current = false;
    revRef.current = null;
    baseRef.current = undefined;
    setLoaded(false);
    dataRef.current = initialRef.current;
    setData(initialRef.current);

    fetchData();

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('app-sync');
      channel.onmessage = (event) => {
        if (event.data?.type === 'SYNC' && event.data.collection === collectionName && event.data.docId === docId) {
          fetchData();
        }
      };
    } catch {}

    return () => {
      channel?.close();
    };
  }, [fetchData, collectionName, docId]);

  const updateData = useCallback(async (newData: T | ((prev: T) => T)) => {
    const prev = dataRef.current;
    const nextData = typeof newData === 'function' ? (newData as (p: T) => T)(prev) : newData;
    if (nextData === prev) return;

    dataRef.current = nextData;
    setData(nextData);

    // Sunucudaki belge henüz okunmadıysa varsayılan değerlerle üzerine yazma.
    if (!loadedRef.current) {
      console.warn(`${path} henüz yüklenmedi; değişiklik sunucuya gönderilmedi.`);
      return;
    }

    // Yazma sırasında dönen eski bir GET yanıtı yerel değişikliği ezmesin.
    requestIdRef.current++;

    try {
      // Belge o arada başka yerde değiştiyse sunucu 409 döner; alan bazında birleştirip yeniden denenir.
      let toSend = nextData;
      let res: Response | null = null;
      for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
        const rev = revRef.current;
        res = await fetch(`/api/data/${collectionName}/${docId}`, {
          method: 'PUT',
          headers: getAuthHeaders({ 'Content-Type': 'application/json', ...(rev ? { 'If-Match': rev } : {}) }),
          body: JSON.stringify(toSend)
        });
        if (res.status !== 409) break;
        const body = await res.json().catch(() => null);
        if (!body?.current || typeof toSend !== 'object' || toSend === null) break;
        toSend = mergeConcurrent(baseRef.current as object | undefined, toSend as object, body.current) as T;
        revRef.current = typeof body.rev === 'string' ? body.rev : null;
        baseRef.current = body.current;
      }

      if (!res || !res.ok) {
        const status = res?.status ?? 0;
        requestAuthRecheck(status);
        reportSyncError(
          status === 409
            ? 'Ayarlar aynı anda başka bir bilgisayarda değiştirildiği için kaydedilemedi. Sayfa güncel verilerle yenilendi.'
            : status === 413
              ? 'Kaydedilecek veri çok büyük olduğu için sunucu reddetti.'
              : `Değişiklikler kaydedilemedi (HTTP ${status}).`,
        );
        if (status === 409) void fetchData();
        return;
      }

      revRef.current = res.headers.get('X-Rev');
      baseRef.current = toSend;
      // Başka bilgisayarın değişikliğiyle birleştiyse ve o arada yerelde yeniden değişmediyse birleşik hali göster.
      if (toSend !== nextData && dataRef.current === nextData) {
        dataRef.current = toSend;
        setData(toSend);
      }

      try {
        const channel = new BroadcastChannel('app-sync');
        channel.postMessage({ type: 'SYNC', collection: collectionName, docId });
        channel.close();
      } catch {}
    } catch (err) {
      console.error(`Error syncing ${path}:`, err);
      reportSyncError('Değişiklikler kaydedilemedi: sunucuya ulaşılamıyor.');
    }
  }, [path, collectionName, docId, fetchData]);

  return [data, updateData, loaded] as const;
}
