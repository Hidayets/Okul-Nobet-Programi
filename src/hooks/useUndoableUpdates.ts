import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_UNDO = 15;

function snapshotValue<T>(value: T): T {
  if (!Array.isArray(value)) return value;
  return value.map((item) => (item && typeof item === 'object' ? { ...item } : item)) as T;
}

/** Son kullanıcı değişikliklerini saklar. Sunucudan gelen ilk yükleme yığına girmez. */
export function useUndoableUpdates<T>(
  value: T,
  commit: (next: T | ((prev: T) => T)) => unknown,
  scopeKey: string,
) {
  const past = useRef<T[]>([]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    past.current = [];
    setCanUndo(false);
  }, [scopeKey]);

  const update = useCallback((next: T | ((prev: T) => T)) => {
    const current = valueRef.current;
    const resolved = typeof next === 'function' ? (next as (prev: T) => T)(current) : next;
    if (resolved === current) return commit(next);
    past.current = [...past.current, snapshotValue(current)].slice(-MAX_UNDO);
    valueRef.current = resolved;
    setCanUndo(true);
    return commit(resolved);
  }, [commit]);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    setCanUndo(past.current.length > 0);
    if (previous !== undefined) {
      valueRef.current = previous;
      commit(previous);
    }
  }, [commit]);

  /** Dışarıdan yapılan toplu değişikliklerden sonra eski anlık görüntüler geri yüklenmesin. */
  const clearHistory = useCallback(() => {
    past.current = [];
    setCanUndo(false);
  }, []);

  return { update, undo, canUndo, clearHistory };
}
