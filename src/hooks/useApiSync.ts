import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { getAuthHeaders } from '../lib/apiHeaders';
import { mergeConcurrent } from '../lib/mergeConcurrent';
import { reportSyncError, requestAuthRecheck } from '../lib/syncEvents';

const SYNC_CHANNEL = 'app-sync';
const POLL_INTERVAL_MS = 300_000; // 5 dakikaya çıkarıldı - gereksiz yenilemeyi önlemek için
/** Pencereye dönüldüğünde, son okumadan bu kadar zaman geçtiyse başka bilgisayarların değişiklikleri çekilir. */
const FOCUS_REFRESH_MS = 30_000;
const MAX_CONFLICT_RETRIES = 3;

function notifyCollectionSync(collectionName: string) {
  try {
    const channel = new BroadcastChannel(SYNC_CHANNEL);
    channel.postMessage({ type: 'SYNC', collection: collectionName });
    channel.close();
  } catch {}
}

export function useApiSync<T extends { id: string }>(collectionName: string, initialValue: T[] = []) {
  const [data, setData] = useState<T[]>(initialValue);
  const [loaded, setLoaded] = useState(false);
  const { user, actingKurumKodu } = useAuth();
  const initialRef = useRef(initialValue);
  const dataRef = useRef(data);
  dataRef.current = data;
  const requestIdRef = useRef(0);
  const pendingWritesRef = useRef(0);
  // Sunucudan en son okunan/yazılan sürüm: başka bilgisayarın değişikliğini ezmeden birleştirmek için.
  const revsRef = useRef(new Map<string, string>());
  const baseRef = useRef(new Map<string, T>());
  const lastFetchRef = useRef(0);

  const userKey = user ? `${user.uid}|${user.kurumKodu}|${user.role}` : '';

  const fetchData = useCallback(async () => {
    if (!userKey) return;
    // Yazma devam ederken gelen liste, henüz kaydedilmemiş yerel değişiklikleri geri alır.
    if (pendingWritesRef.current > 0) return;
    const reqId = ++requestIdRef.current;
    try {
      const res = await fetch(`/api/data/${collectionName}`, {
        headers: getAuthHeaders()
      });
      if (reqId !== requestIdRef.current || pendingWritesRef.current > 0) return;
      if (res.ok) {
        const raw = (await res.json()) as (T & { _rev?: string })[];
        if (reqId !== requestIdRef.current || pendingWritesRef.current > 0) return;
        const revs = new Map<string, string>();
        const base = new Map<string, T>();
        const items = raw.map(({ _rev, ...rest }) => {
          const item = rest as unknown as T;
          if (_rev) revs.set(item.id, _rev);
          base.set(item.id, item);
          return item;
        });
        revsRef.current = revs;
        baseRef.current = base;
        lastFetchRef.current = Date.now();
        dataRef.current = items;
        setData(items);
        setLoaded(true);
      } else {
        requestAuthRecheck(res.status);
      }
    } catch (err) {
      console.error(`Error fetching ${collectionName}:`, err);
    }
  }, [collectionName, userKey, actingKurumKodu]);

  useEffect(() => {
    // Yıl / kurum / kullanıcı değişti: önceki kapsamın verisi yeni koleksiyona karışmasın.
    requestIdRef.current++;
    revsRef.current = new Map();
    baseRef.current = new Map();
    dataRef.current = initialRef.current;
    setData(initialRef.current);
    setLoaded(false);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!userKey) return;

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(SYNC_CHANNEL);
      channel.onmessage = (event) => {
        if (event.data?.type === 'SYNC' && event.data.collection === collectionName) {
          fetchData();
        }
      };
    } catch {}

    const pollId = window.setInterval(fetchData, POLL_INTERVAL_MS);
    const onFocus = () => {
      if (Date.now() - lastFetchRef.current > FOCUS_REFRESH_MS) fetchData();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      channel?.close();
      window.clearInterval(pollId);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchData, collectionName, userKey]);

  const rememberServerVersion = (item: T, res: Response) => {
    const rev = res.headers.get('X-Rev');
    if (rev) revsRef.current.set(item.id, rev);
    else revsRef.current.delete(item.id);
    baseRef.current.set(item.id, item);
  };

  const updateData = useCallback(async (newData: T[] | ((prev: T[]) => T[])): Promise<boolean> => {
    const current = dataRef.current;
    const nextData = typeof newData === 'function' ? (newData as (prev: T[]) => T[])(current) : newData;
    if (nextData === current) return true;

    const currentById = new Map(current.map(d => [d.id, d]));
    const nextIds = new Set(nextData.map(d => d.id));
    const added = nextData.filter((item: T) => !currentById.has(item.id));
    const removed = current.filter(item => !nextIds.has(item.id));
    const updated = nextData.filter((item: T) => {
      const old = currentById.get(item.id);
      return old && JSON.stringify(old) !== JSON.stringify(item);
    });

    setData(nextData);
    dataRef.current = nextData;

    if (added.length === 0 && removed.length === 0 && updated.length === 0) return true;

    const headers = getAuthHeaders({ 'Content-Type': 'application/json' });
    requestIdRef.current++;
    pendingWritesRef.current++;

    let failedStatus: number | null = null;
    let networkError = false;
    const track = (res: Response) => {
      if (!res.ok && failedStatus === null) failedStatus = res.status;
    };
    // Başka bilgisayarın değişikliğiyle birleştirilen kayıtlar: [gönderilen, birleşik]
    const mergedItems: [T, T][] = [];

    // Kayıt o arada başka yerde değiştiyse sunucu 409 döner; alan bazında birleştirip yeniden denenir.
    const putWithMerge = async (item: T) => {
      let toSend = item;
      for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
        const rev = revsRef.current.get(toSend.id);
        const res = await fetch(`/api/data/${collectionName}/${toSend.id}`, {
          method: 'PUT',
          headers: rev ? { ...headers, 'If-Match': rev } : headers,
          body: JSON.stringify(toSend)
        });
        if (res.status === 409) {
          const body = await res.json().catch(() => null);
          if (!body?.current) {
            track(res);
            return;
          }
          const remote = { ...body.current, id: toSend.id } as T;
          toSend = mergeConcurrent(baseRef.current.get(toSend.id), toSend, remote);
          if (typeof body.rev === 'string') revsRef.current.set(toSend.id, body.rev);
          baseRef.current.set(toSend.id, remote);
          continue;
        }
        track(res);
        if (res.ok) {
          rememberServerVersion(toSend, res);
          if (toSend !== item) mergedItems.push([item, toSend]);
        }
        return;
      }
      if (failedStatus === null) failedStatus = 409;
    };

    try {
      for (const item of added) {
        const res = await fetch(`/api/data/${collectionName}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(item)
        });
        track(res);
        if (res.ok) rememberServerVersion(item, res);
      }

      for (const item of updated) {
        await putWithMerge(item);
      }

      for (const item of removed) {
        const res = await fetch(`/api/data/${collectionName}/${item.id}`, {
          method: 'DELETE',
          headers
        });
        track(res);
        if (res.ok) {
          revsRef.current.delete(item.id);
          baseRef.current.delete(item.id);
        }
      }
    } catch (err) {
      console.error(`Error syncing ${collectionName}:`, err);
      networkError = true;
    } finally {
      pendingWritesRef.current--;
    }

    if (mergedItems.length > 0) {
      // Yalnızca o arada yerelde yeniden değiştirilmemiş kayıtlar birleşik haliyle değiştirilir.
      const replacements = new Map(mergedItems.map(([sent, merged]) => [sent, merged]));
      const merged = dataRef.current.map(d => replacements.get(d) ?? d);
      dataRef.current = merged;
      setData(merged);
    }

    if (failedStatus === null && !networkError) {
      notifyCollectionSync(collectionName);
      return true;
    }

    if (failedStatus !== null) requestAuthRecheck(failedStatus);
    reportSyncError(
      networkError
        ? 'Değişikliklerin bir kısmı kaydedilemedi: sunucuya ulaşılamıyor.'
        : failedStatus === 409
          ? 'Bazı kayıtlar aynı anda başka bir bilgisayarda değiştirildiği için kaydedilemedi. Sayfa güncel verilerle yenilendi.'
          : failedStatus === 413
            ? 'Kaydedilecek veri çok büyük olduğu için sunucu reddetti.'
            : `Değişikliklerin bir kısmı kaydedilemedi (HTTP ${failedStatus}).`,
    );
    if (failedStatus === 409) void fetchData();
    return false;
  }, [collectionName, fetchData]);

  return [data, updateData, loaded] as const;
}
