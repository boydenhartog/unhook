import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './service';
import type { FocusService, SetupStatus } from './types';

export function useSetup(service: FocusService) {
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true),
    changing = useRef(false),
    reading = useRef(false);
  const refresh = useCallback(async () => {
    if (changing.current || reading.current) return;
    reading.current = true;
    try {
      const next = await service.getSetupStatus();
      if (mounted.current && !changing.current) {
        setSetup(next);
        setReadError(null);
      }
    } catch (failure) {
      if (mounted.current) setReadError(errorMessage(failure));
    } finally {
      reading.current = false;
    }
  }, [service]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (changing.current) return false;
    changing.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      const next = await service.getSetupStatus();
      if (mounted.current) setSetup(next);
      return true;
    } catch (failure) {
      if (mounted.current) setActionError(errorMessage(failure));
      return false;
    } finally {
      changing.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { setup, error: actionError || readError, busy, refresh, run };
}
