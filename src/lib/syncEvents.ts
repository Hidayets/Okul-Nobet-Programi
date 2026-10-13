export const SYNC_ERROR_EVENT = 'app-sync-error';
export const AUTH_RECHECK_EVENT = 'app-auth-recheck';

export function reportSyncError(message: string) {
  try {
    window.dispatchEvent(new CustomEvent<string>(SYNC_ERROR_EVENT, { detail: message }));
  } catch {}
}

/** 401/403 yanıtlarında oturum ve lisans durumunun yeniden doğrulanmasını ister. */
export function requestAuthRecheck(status: number) {
  if (status !== 401 && status !== 403) return;
  try {
    window.dispatchEvent(new Event(AUTH_RECHECK_EVENT));
  } catch {}
}
