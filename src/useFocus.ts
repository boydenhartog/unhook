import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { createService, errorMessage } from './service';
import type { AppStatus, FocusService } from './types';

export function useFocus() {
  const [service] = useState<FocusService>(createService);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true), changing = useRef(false);
  const refresh = useCallback(async () => {
    if (changing.current) return;
    try { const next = await service.getStatus(); if (mounted.current && !changing.current) { setStatus(next); setReadError(null); } }
    catch (failure) { if (mounted.current) setReadError(errorMessage(failure)); }
  }, [service]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = setInterval(() => void refresh(), 2000);
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    if (!service.preview) {
      void listen<AppStatus>('status-changed', event => { if (alive) setStatus(event.payload); })
        .then(stop => { if (alive) unsubscribe = stop; else stop(); })
        .catch(failure => { if (alive) setReadError(errorMessage(failure)); });
    }
    return () => { alive = false; mounted.current = false; clearInterval(interval); unsubscribe?.(); };
  }, [refresh, service]);
  const run = async (action: () => Promise<AppStatus>): Promise<boolean> => {
    if (changing.current) return false;
    changing.current = true; setBusy(true); setActionError(null);
    try { const next = await action(); if (mounted.current) setStatus(next); return true; }
    catch (failure) { if (mounted.current) setActionError(errorMessage(failure)); return false; }
    finally { changing.current = false; if (mounted.current) setBusy(false); }
  };
  return { status, error: actionError || readError, busy, service, run, refresh };
}
