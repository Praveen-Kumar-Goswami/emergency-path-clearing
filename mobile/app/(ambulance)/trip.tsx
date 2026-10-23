import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
  BackHandler,
  SafeAreaView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { supabase } from '../../lib/supabase';
import { TICK_MS, DEFAULT_CENTER } from '../../lib/config';
import { LeafletMap, MapMarker } from '../../components/LeafletMap';
import {
  LatLng,
  haversineDistance,
  polylineLength,
  nearestDistanceAlongRoute,
  pointAtDistance,
} from '../../lib/geo';
import { geoJsonToLeaflet } from '../../lib/routing';

export default function AmbulanceLiveTripScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const tripId = (params.tripId as string) || '';

  // Parse initial route
  const leafletRoute = React.useMemo<LatLng[]>(() => {
    try {
      if (params.routeJson) {
        const parsed = JSON.parse(params.routeJson as string);
        if (parsed?.coordinates) {
          return geoJsonToLeaflet(parsed.coordinates);
        }
      }
    } catch (e) {
      console.warn('Failed to parse routeJson:', e);
    }
    return [];
  }, [params.routeJson]);

  // Trip telemetry state
  const [currentPos, setCurrentPos] = useState<LatLng>(leafletRoute[0] || DEFAULT_CENTER);
  const [currentHeading, setCurrentHeading] = useState<number | null>(null);
  const [speedKmh, setSpeedKmh] = useState<number>(0);
  const [vehiclesAlerted, setVehiclesAlerted] = useState<number>(0);
  const [distanceRemainingM, setDistanceRemainingM] = useState<number>(0);
  const [gpsLost, setGpsLost] = useState<boolean>(false);
  const [connStatus, setConnStatus] = useState<'live' | 'reconnecting'>('live');

  // Controls state
  const [followAmbulance, setFollowAmbulance] = useState<boolean>(true);
  const [simulateDrive, setSimulateDrive] = useState<boolean>(false);
  const [simSpeedKmh, setSimSpeedKmh] = useState<number>(50);

  // Refs for tick loop & synchronization
  const latestFixRef = useRef<{
    lat: number;
    lng: number;
    heading: number | null;
    timestamp: number;
  }>({
    lat: leafletRoute[0]?.[0] || DEFAULT_CENTER[0],
    lng: leafletRoute[0]?.[1] || DEFAULT_CENTER[1],
    heading: null,
    timestamp: Date.now(),
  });

  const lastGoodHeadingRef = useRef<number | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const totalRouteLenRef = useRef<number>(polylineLength(leafletRoute));
  const simProgressMRef = useRef<number>(0);
  const tripCompletedRef = useRef<boolean>(false);

  // Prevent accidental hardware back button on Android
  useEffect(() => {
    const onBackPress = () => {
      confirmEndTrip();
      return true;
    };
    const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backSub.remove();
  }, []);

  // Keep awake for full trip
  useEffect(() => {
    activateKeepAwakeAsync();
    return () => {
      deactivateKeepAwake();
    };
  }, []);

  // End trip helper
  const handleEndTrip = async (auto = false) => {
    if (tripCompletedRef.current) return;
    tripCompletedRef.current = true;
    try {
      await supabase.rpc('end_trip', { p_trip: tripId });
    } catch (e) {
      console.warn('Error calling end_trip:', e);
    }
    if (auto) {
      Alert.alert('Trip Completed', 'You have arrived at the destination. Route cleared.', [
        { text: 'OK', onPress: () => router.replace('/(ambulance)') },
      ]);
    } else {
      router.replace('/(ambulance)');
    }
  };

  const confirmEndTrip = () => {
    Alert.alert('End Emergency Trip?', 'This will clear all corridor alerts for civilian vehicles.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End Trip', style: 'destructive', onPress: () => handleEndTrip(false) },
    ]);
  };

  // Perform a single tick to Supabase
  const executeTick = useCallback(async () => {
    if (inFlightRef.current || !tripId || tripCompletedRef.current) return;

    const fix = latestFixRef.current;
    const ageMs = Date.now() - fix.timestamp;

    // Skip tick if fix is older than 10s
    if (ageMs > 10000 && !simulateDrive) {
      setGpsLost(true);
      return;
    }
    setGpsLost(false);

    inFlightRef.current = true;
    try {
      const { data: matchedCount, error } = await supabase.rpc('tick_ambulance', {
        p_trip: tripId,
        p_lat: fix.lat,
        p_lng: fix.lng,
        p_heading: fix.heading,
      });

      if (error) {
        if (error.message && error.message.toLowerCase().includes('trip not found')) {
          Alert.alert('Trip Ended', 'This trip has expired or was ended.', [
            { text: 'OK', onPress: () => router.replace('/(ambulance)') },
          ]);
          return;
        }
        setConnStatus('reconnecting');
      } else {
        setConnStatus('live');
        setVehiclesAlerted(typeof matchedCount === 'number' ? matchedCount : 0);
      }
    } catch (e: any) {
      setConnStatus('reconnecting');
    } finally {
      inFlightRef.current = false;
    }
  }, [tripId, simulateDrive, router]);

  // Main tick interval (every TICK_MS)
  useEffect(() => {
    const timer = setInterval(() => {
      executeTick();
    }, TICK_MS);

    // Initial immediate tick
    executeTick();

    return () => clearInterval(timer);
  }, [executeTick]);

  // Real GPS tracking (active when simulateDrive is false)
  useEffect(() => {
    if (simulateDrive) return;

    let sub: Location.LocationSubscription | null = null;
    let isCancelled = false;

    (async () => {
      try {
        sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 0,
          },
          (loc) => {
            if (isCancelled || tripCompletedRef.current) return;
            const { coords } = loc;
            const spd = Math.max(0, coords.speed ?? 0) * 3.6;

            let resolvedHeading = lastGoodHeadingRef.current;
            if (
              coords.heading !== null &&
              isFinite(coords.heading) &&
              coords.heading >= 0 &&
              spd >= 3
            ) {
              resolvedHeading = coords.heading;
              lastGoodHeadingRef.current = coords.heading;
            }

            const pos: LatLng = [coords.latitude, coords.longitude];
            setCurrentPos(pos);
            setCurrentHeading(resolvedHeading);
            setSpeedKmh(Math.round(spd));

            latestFixRef.current = {
              lat: coords.latitude,
              lng: coords.longitude,
              heading: resolvedHeading,
              timestamp: Date.now(),
            };

            // Calculate remaining distance along route
            if (leafletRoute.length > 1) {
              const { distanceAlongM } = nearestDistanceAlongRoute(leafletRoute, pos);
              const remaining = Math.max(0, totalRouteLenRef.current - distanceAlongM);
              setDistanceRemainingM(Math.round(remaining));

              // Auto-end if within 40m of destination
              const destPoint = leafletRoute[leafletRoute.length - 1];
              if (haversineDistance(pos, destPoint) <= 40) {
                handleEndTrip(true);
              }
            }
          }
        );
      } catch (e) {
        console.warn('GPS watch error:', e);
      }
    })();

    return () => {
      isCancelled = true;
      if (sub) sub.remove();
    };
  }, [simulateDrive, leafletRoute]);

  // Simulation loop (active when simulateDrive is true)
  useEffect(() => {
    if (!simulateDrive || leafletRoute.length < 2) return;

    const intervalMs = 250;
    const totalDistM = totalRouteLenRef.current;

    const simTimer = setInterval(() => {
      if (tripCompletedRef.current) return;

      // Distance covered in this tick
      const metersPerSec = (simSpeedKmh * 1000) / 3600;
      const metersPerTick = metersPerSec * (intervalMs / 1000);

      simProgressMRef.current = Math.min(totalDistM, simProgressMRef.current + metersPerTick);
      const { point, heading } = pointAtDistance(leafletRoute, simProgressMRef.current);

      setCurrentPos(point);
      setCurrentHeading(heading);
      setSpeedKmh(simSpeedKmh);

      latestFixRef.current = {
        lat: point[0],
        lng: point[1],
        heading,
        timestamp: Date.now(),
      };

      const remaining = Math.max(0, totalDistM - simProgressMRef.current);
      setDistanceRemainingM(Math.round(remaining));

      // Auto-end within 40m of route end
      if (remaining <= 40) {
        clearInterval(simTimer);
        handleEndTrip(true);
      }
    }, intervalMs);

    return () => clearInterval(simTimer);
  }, [simulateDrive, simSpeedKmh, leafletRoute]);

  // Markers for LeafletMap
  const markers: MapMarker[] = [
    {
      id: 'amb',
      lat: currentPos[0],
      lng: currentPos[1],
      kind: 'ambulance',
      heading: currentHeading,
    },
  ];

  if (leafletRoute.length > 0) {
    const dest = leafletRoute[leafletRoute.length - 1];
    markers.push({
      id: 'dest',
      lat: dest[0],
      lng: dest[1],
      kind: 'destination',
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>EMERGENCY TRIP IN PROGRESS</Text>
          <Text style={styles.tripIdText}>ID: #{tripId.substring(0, 8)}</Text>
        </View>

        <View style={styles.headerRight}>
          {simulateDrive && (
            <View style={styles.simBadge}>
              <Text style={styles.simBadgeText}>SIMULATED</Text>
            </View>
          )}

          <View
            style={[
              styles.connBadge,
              connStatus === 'live' ? styles.connLive : styles.connReconnecting,
            ]}
          >
            <Text style={styles.connText}>
              {connStatus === 'live' ? 'Live Telemetry' : 'Reconnecting...'}
            </Text>
          </View>
        </View>
      </View>

      {/* GPS Warning if signal lost */}
      {gpsLost && !simulateDrive && (
        <View style={styles.gpsWarning}>
          <Text style={styles.gpsWarningText}>⚠️ GPS signal lost. Telemetry ticks paused.</Text>
        </View>
      )}

      {/* Vehicles Alerted Ahead Big Card */}
      <View style={styles.alertCard}>
        <View style={styles.alertCountCircle}>
          <Text style={styles.alertCountNum}>{vehiclesAlerted}</Text>
        </View>
        <View style={styles.alertTextCol}>
          <Text style={styles.alertMainText}>
            {vehiclesAlerted === 1
              ? '1 vehicle alerted ahead'
              : `${vehiclesAlerted} vehicles alerted ahead`}
          </Text>
          <Text style={styles.alertSubText}>Within 1 km forward corridor & travelling same way</Text>
        </View>
      </View>

      {/* Map View */}
      <View style={styles.mapContainer}>
        <LeafletMap
          center={currentPos}
          zoom={16}
          markers={markers}
          route={leafletRoute}
          follow={followAmbulance ? currentPos : null}
        />

        {/* Map Control Floating Buttons */}
        <View style={styles.floatingControls}>
          <TouchableOpacity
            style={[styles.floatingBtn, followAmbulance && styles.floatingBtnActive]}
            onPress={() => setFollowAmbulance(!followAmbulance)}
          >
            <Text style={styles.floatingBtnText}>{followAmbulance ? '🎯 Following' : '🧭 Free Cam'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Info Dashboard Bar */}
      <View style={styles.infoBar}>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Speed</Text>
          <Text style={styles.infoValue}>{speedKmh} km/h</Text>
        </View>
        <View style={styles.infoDivider} />
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Remaining</Text>
          <Text style={styles.infoValue}>
            {distanceRemainingM >= 1000
              ? `${(distanceRemainingM / 1000).toFixed(1)} km`
              : `${distanceRemainingM} m`}
          </Text>
        </View>
        <View style={styles.infoDivider} />
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Heading</Text>
          <Text style={styles.infoValue}>
            {currentHeading !== null ? `${Math.round(currentHeading)}°` : '—'}
          </Text>
        </View>
      </View>

      {/* Simulation & End Trip Controls */}
      <View style={styles.controlsBar}>
        <View style={styles.simRow}>
          <View style={styles.simToggleCol}>
            <Text style={styles.simToggleLabel}>Simulate drive</Text>
            <Switch
              value={simulateDrive}
              onValueChange={setSimulateDrive}
              trackColor={{ false: '#334155', true: '#dc2626' }}
              thumbColor={simulateDrive ? '#ffffff' : '#94a3b8'}
            />
          </View>

          {simulateDrive && (
            <View style={styles.speedSelector}>
              {[30, 50, 80].map((spd) => (
                <TouchableOpacity
                  key={spd}
                  style={[styles.speedBtn, simSpeedKmh === spd && styles.speedBtnActive]}
                  onPress={() => setSimSpeedKmh(spd)}
                >
                  <Text
                    style={[styles.speedText, simSpeedKmh === spd && styles.speedTextActive]}
                  >
                    {spd}
                  </Text>
                </TouchableOpacity>
              ))}
              <Text style={styles.kmhLabel}>km/h</Text>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.endTripBtn} onPress={confirmEndTrip} activeOpacity={0.85}>
          <Text style={styles.endTripBtnText}>END EMERGENCY TRIP</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  tripIdText: {
    color: '#94a3b8',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  simBadge: {
    backgroundColor: '#d97706',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  simBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },
  connBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  connLive: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  connReconnecting: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  connText: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '700',
  },
  gpsWarning: {
    backgroundColor: '#b45309',
    padding: 8,
    alignItems: 'center',
  },
  gpsWarningText: {
    color: '#fef3c7',
    fontSize: 12,
    fontWeight: '700',
  },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    gap: 14,
  },
  alertCountCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertCountNum: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  alertTextCol: {
    flex: 1,
  },
  alertMainText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  alertSubText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  floatingControls: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 999,
  },
  floatingBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  floatingBtnActive: {
    borderColor: '#3b82f6',
    backgroundColor: '#1e3a8a',
  },
  floatingBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  infoBar: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderColor: '#334155',
  },
  infoItem: {
    flex: 1,
    alignItems: 'center',
  },
  infoDivider: {
    width: 1,
    backgroundColor: '#334155',
  },
  infoLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  infoValue: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  controlsBar: {
    backgroundColor: '#0f172a',
    padding: 16,
    gap: 12,
  },
  simRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  simToggleCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  simToggleLabel: {
    color: '#f1f5f9',
    fontSize: 13,
    fontWeight: '600',
  },
  speedSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  speedBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#0f172a',
  },
  speedBtnActive: {
    backgroundColor: '#dc2626',
  },
  speedText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  speedTextActive: {
    color: '#ffffff',
  },
  kmhLabel: {
    color: '#64748b',
    fontSize: 11,
  },
  endTripBtn: {
    backgroundColor: '#dc2626',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 50,
    justifyContent: 'center',
  },
  endTripBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
