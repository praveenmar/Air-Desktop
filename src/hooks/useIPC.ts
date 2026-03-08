// Purpose: Generic React Hook for executing and managing state of async IPC calls.
// Prototype Origin: New file for React UI architecture.
// Changes: Adapted to accept a typed fetcher function instead of a raw channel string 
//          to enforce strict TypeScript and leverage the `window.airAPI` definitions.

import { useState, useEffect, useCallback } from 'react';

export function useIPC<T, P extends any[]>(
  fetcher: (...args: P) => Promise<T>,
  ...args: P
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher(...args);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [fetcher, JSON.stringify(args)]); // Deep compare args to avoid infinite loops

  useEffect(() => {
    execute().catch(console.error);
  }, [execute]);

  return { data, loading, error, refetch: execute };
}