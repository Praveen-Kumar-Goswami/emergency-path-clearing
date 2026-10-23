import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export interface AlertData {
  id: string;
  trip_id: string;
  distance_m: number;
  blocking: boolean;
  status: 'active' | 'acknowledged' | 'cleared';
  created_at: string;
}

export type RealtimeConnectionState = 'live' | 'reconnecting' | 'offline';

export const useMyAlerts = () => {
  const { userId } = useAuth();
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [justCleared, setJustCleared] = useState<boolean>(false);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('reconnecting');
  const clearedTimerRef = useRef<any>(null);

  const fetchActiveAlerts = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from('alerts')
        .select('id,trip_id,distance_m,blocking,status,created_at')
        .eq('user_id', userId)
        .in('status', ['active', 'acknowledged']);

      if (!error && data) {
        setAlerts(data as AlertData[]);
      }
    } catch (e) {
      console.warn('Error fetching active alerts:', e);
    }
  }, [userId]);

  const acknowledgeAlert = async (alertId: string) => {
    try {
      const { error } = await supabase
        .from('alerts')
        .update({ status: 'acknowledged' })
        .eq('id', alertId);

      if (!error) {
        setAlerts((prev) =>
          prev.map((a) => (a.id === alertId ? { ...a, status: 'acknowledged' } : a))
        );
      }
    } catch (e) {
      console.warn('Error acknowledging alert:', e);
    }
  };

  useEffect(() => {
    if (!userId) {
      setAlerts([]);
      return;
    }

    fetchActiveAlerts();

    // Subscribe to realtime changes on alerts
    const channelName = `my_alerts_${userId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'alerts',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newRow = payload.new as AlertData;

          if (payload.eventType === 'DELETE' || (newRow && newRow.status === 'cleared')) {
            setAlerts((prev) => {
              const remaining = prev.filter((a) => a.id !== ((payload.old as any)?.id || newRow?.id));
              if (prev.length > 0 && remaining.length === 0) {
                // Show "Ambulance has passed" banner for 4s
                setJustCleared(true);
                if (clearedTimerRef.current) clearTimeout(clearedTimerRef.current);
                clearedTimerRef.current = setTimeout(() => {
                  setJustCleared(false);
                }, 4000);
              }
              return remaining;
            });
          } else if (payload.eventType === 'INSERT') {
            if (newRow.status === 'active' || newRow.status === 'acknowledged') {
              setAlerts((prev) => {
                const filtered = prev.filter((a) => a.id !== newRow.id);
                return [...filtered, newRow];
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            if (newRow.status === 'active' || newRow.status === 'acknowledged') {
              setAlerts((prev) => prev.map((a) => (a.id === newRow.id ? newRow : a)));
            } else {
              setAlerts((prev) => {
                const remaining = prev.filter((a) => a.id !== newRow.id);
                if (remaining.length === 0) {
                  setJustCleared(true);
                  if (clearedTimerRef.current) clearTimeout(clearedTimerRef.current);
                  clearedTimerRef.current = setTimeout(() => {
                    setJustCleared(false);
                  }, 4000);
                }
                return remaining;
              });
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionState('live');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setConnectionState('reconnecting');
        }
      });

    // AppState listener for foreground reconnect
    const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        fetchActiveAlerts();
      }
    });

    return () => {
      supabase.removeChannel(channel);
      appStateSub.remove();
      if (clearedTimerRef.current) clearTimeout(clearedTimerRef.current);
    };
  }, [userId, fetchActiveAlerts]);

  // Pick the closest active alert
  const sorted = [...alerts].sort((a, b) => a.distance_m - b.distance_m);
  const primaryAlert = sorted.length > 0 ? sorted[0] : null;

  return {
    alerts,
    primaryAlert,
    justCleared,
    connectionState,
    acknowledgeAlert,
    refetch: fetchActiveAlerts,
  };
};
