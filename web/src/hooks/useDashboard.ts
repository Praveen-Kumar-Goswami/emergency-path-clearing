import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Snapshot } from '../lib/types';

export type DashboardConnection = 'live' | 'reconnecting' | 'offline';

export const useDashboard = (enabled: boolean = true) => {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<DashboardConnection>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'reconnecting'
  );
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef<boolean>(false);
  const backoffDelayRef = useRef<number>(2000);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveFailuresRef = useRef<number>(0);

  const fetchSnapshot = useCallback(async () => {
    if (!enabled || inFlightRef.current) return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setConnection('offline');
      return;
    }

    inFlightRef.current = true;
    try {
      const { data, error: rpcError } = await supabase.rpc('dashboard_snapshot');
      if (rpcError) throw rpcError;

      if (data) {
        setSnapshot(data as unknown as Snapshot);
        setLastUpdated(new Date());
        setConnection('live');
        setError(null);
        consecutiveFailuresRef.current = 0;
        backoffDelayRef.current = 2000;
      }
    } catch (err: unknown) {
      consecutiveFailuresRef.current++;
      const msg = err instanceof Error ? err.message : 'Error loading dashboard snapshot';
      setError(msg);

      if (consecutiveFailuresRef.current >= 2) {
        setConnection('reconnecting');
      }

      // Backoff up to 10 seconds with 20% random jitter
      const jitter = Math.random() * (backoffDelayRef.current * 0.2);
      backoffDelayRef.current = Math.min(10000, backoffDelayRef.current * 1.5 + jitter);
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled]);

  // Main polling loop
  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;

    const scheduleNextPoll = () => {
      pollTimerRef.current = setTimeout(async () => {
        if (!isMounted) return;
        await fetchSnapshot();
        scheduleNextPoll();
      }, backoffDelayRef.current);
    };

    // Initial fetch
    void (async () => {
      await fetchSnapshot();
      if (isMounted) scheduleNextPoll();
    })();

    return () => {
      isMounted = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [enabled, fetchSnapshot]);

  // Realtime subscription on alerts table
  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel('dashboard_alerts_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'alerts',
        },
        () => {
          // Debounce 300ms refresh
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => {
            fetchSnapshot();
          }, 300);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [enabled, fetchSnapshot]);

  // Offline / online browser network listeners
  useEffect(() => {
    const handleOnline = () => {
      setConnection('reconnecting');
      fetchSnapshot();
    };

    const handleOffline = () => {
      setConnection('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchSnapshot]);

  return {
    snapshot,
    connection,
    lastUpdated,
    error,
    refresh: fetchSnapshot,
  };
};
