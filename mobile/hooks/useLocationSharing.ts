import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { LOCATION_MS } from '../lib/config';

export type SharingStatus = 'sharing' | 'paused' | 'error' | 'permission_needed';

export const useLocationSharing = () => {
  const { userId } = useAuth();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [isSharing, setIsSharing] = useState<boolean>(false);
  const [speedKmh, setSpeedKmh] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [lastSentTimestamp, setLastSentTimestamp] = useState<number | null>(null);
  const [lastSentAge, setLastSentAge] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SharingStatus>('permission_needed');

  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const lastFixRef = useRef<{ lat: number; lng: number; speed: number; heading: number | null } | null>(null);
  const backoffDelayRef = useRef<number>(1000);
  const retryTimeoutRef = useRef<any>(null);

  // Check initial permission
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const { status: permStatus } = await Location.getForegroundPermissionsAsync();
        if (!isMounted) return;
        if (permStatus === Location.PermissionStatus.GRANTED) {
          setHasPermission(true);
          setPermissionDenied(false);
          setIsSharing(true);
          setStatus('sharing');
        } else if (permStatus === Location.PermissionStatus.DENIED) {
          setHasPermission(false);
          setPermissionDenied(true);
          setStatus('permission_needed');
        }
      } catch (e: any) {
        console.warn('Error checking permission:', e);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // Request foreground permission
  const requestPermission = async () => {
    try {
      setError(null);
      const isEnabled = await Location.hasServicesEnabledAsync();
      if (!isEnabled) {
        setError('Location services are turned off on your device. Please enable GPS.');
        setStatus('error');
        return false;
      }

      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus === Location.PermissionStatus.GRANTED) {
        setHasPermission(true);
        setPermissionDenied(false);
        setIsSharing(true);
        setStatus('sharing');
        return true;
      } else {
        setHasPermission(false);
        setPermissionDenied(true);
        setStatus('permission_needed');
        return false;
      }
    } catch (e: any) {
      setError(e.message || 'Failed to request location permission.');
      setStatus('error');
      return false;
    }
  };

  // Keep lastSentAge updated every second
  useEffect(() => {
    if (!lastSentTimestamp) return;
    const interval = setInterval(() => {
      setLastSentAge(Math.max(0, Math.floor((Date.now() - lastSentTimestamp) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastSentTimestamp]);

  // Handle reporting location fix
  const reportLocation = async (lat: number, lng: number, speed: number, heading: number | null) => {
    if (inFlightRef.current || !userId) return;
    inFlightRef.current = true;

    try {
      const { error: rpcError } = await supabase.rpc('report_location', {
        p_lat: lat,
        p_lng: lng,
        p_speed: speed,
        p_heading: heading ?? undefined,
      });

      if (rpcError) throw rpcError;

      // Successful report
      setLastSentTimestamp(Date.now());
      setLastSentAge(0);
      setError(null);
      setStatus('sharing');
      backoffDelayRef.current = 1000;
    } catch (err: any) {
      console.warn('report_location failed:', err);
      setError(err.message || 'Failed to send location to server.');
      setStatus('error');

      // Exponential backoff up to 15s
      backoffDelayRef.current = Math.min(15000, backoffDelayRef.current * 1.5);
    } finally {
      inFlightRef.current = false;
    }
  };

  // Watch position when isSharing is active
  useEffect(() => {
    if (!isSharing || !hasPermission || !userId) {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
      deactivateKeepAwake();
      setStatus(isSharing ? 'paused' : 'paused');

      // If user turned switch OFF, delete row
      if (!isSharing && userId) {
        supabase.from('vehicle_locations').delete().eq('user_id', userId).then();
      }
      return;
    }

    let isCancelled = false;
    activateKeepAwakeAsync();
    setStatus('sharing');

    const startWatching = async () => {
      try {
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: LOCATION_MS,
            distanceInterval: 0,
          },
          (loc) => {
            if (isCancelled) return;
            const { coords } = loc;

            // Accuracy check: skip fixes worse than 50m
            if (coords.accuracy !== null && coords.accuracy > 50) {
              return;
            }

            const currentAccuracy = coords.accuracy ?? 0;
            const currentSpeedKmh = Math.max(0, coords.speed ?? 0) * 3.6;
            const validHeading =
              coords.heading !== null &&
              isFinite(coords.heading) &&
              coords.heading >= 0 &&
              currentSpeedKmh >= 3
                ? coords.heading
                : null;

            setSpeedKmh(Math.round(currentSpeedKmh));
            setAccuracy(Math.round(currentAccuracy));

            lastFixRef.current = {
              lat: coords.latitude,
              lng: coords.longitude,
              speed: currentSpeedKmh,
              heading: validHeading,
            };

            reportLocation(coords.latitude, coords.longitude, currentSpeedKmh, validHeading);
          }
        );

        if (!isCancelled) {
          subscriptionRef.current = sub;
        } else {
          sub.remove();
        }
      } catch (err: any) {
        if (!isCancelled) {
          setError(err.message || 'Unable to access GPS location.');
          setStatus('error');
        }
      }
    };

    startWatching();

    return () => {
      isCancelled = true;
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
      deactivateKeepAwake();
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [isSharing, hasPermission, userId]);

  return {
    isSharing,
    setIsSharing,
    hasPermission,
    permissionDenied,
    requestPermission,
    speedKmh,
    accuracy,
    lastSentAge,
    error,
    status,
  };
};
