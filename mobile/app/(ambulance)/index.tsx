import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  FlatList,
  Alert,
  Linking,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { DEFAULT_CENTER } from '../../lib/config';
import { LeafletMap, MapMarker } from '../../components/LeafletMap';
import { geocode, getRoute, geoJsonToLeaflet, GeocodeResult, RouteResult } from '../../lib/routing';
import { LatLng } from '../../lib/geo';

export default function AmbulanceSetupScreen() {
  const router = useRouter();
  const { signOut } = useAuth();

  // Location and destination state
  const [currentPos, setCurrentPos] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [destLabel, setDestLabel] = useState<string>('');

  // Routing state
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [leafletRoute, setLeafletRoute] = useState<[number, number][] | null>(null);
  const [isRouting, setIsRouting] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Status & permissions
  const [permError, setPermError] = useState<string | null>(null);
  const [isStartingTrip, setIsStartingTrip] = useState<boolean>(false);

  // Active trip resume prompt
  const [activeTrip, setActiveTrip] = useState<{ id: string; route: any } | null>(null);

  // Check for active trip on mount
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.rpc('my_active_trip');
        if (!error && data && data.id) {
          setActiveTrip(data);
        }
      } catch (e) {
        console.warn('Error checking my_active_trip:', e);
      }
    })();
  }, []);

  // Request location permission & get current position
  const fetchLocation = useCallback(async () => {
    try {
      setPermError(null);
      const isEnabled = await Location.hasServicesEnabledAsync();
      if (!isEnabled) {
        setPermError('Location services disabled. Please enable GPS.');
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.GRANTED) {
        setPermError('Location permission denied. Please allow access in settings.');
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCurrentPos([loc.coords.latitude, loc.coords.longitude]);
    } catch (e: any) {
      setPermError(e.message || 'Failed to obtain GPS fix.');
    }
  }, []);

  useEffect(() => {
    fetchLocation();
  }, [fetchLocation]);

  // Handle route calculation
  const calculateRoute = async (from: LatLng, to: LatLng) => {
    try {
      setIsRouting(true);
      setRouteError(null);
      const res = await getRoute(from, to);
      setRouteResult(res);
      setLeafletRoute(geoJsonToLeaflet(res.geometry.coordinates));
    } catch (err: any) {
      setRouteError(err.message || 'Failed to calculate driving route.');
    } finally {
      setIsRouting(false);
    }
  };

  // When map is pressed, set destination
  const handleMapPress = (coords: { lat: number; lng: number }) => {
    setSearchResults([]);
    const destPoint: LatLng = [coords.lat, coords.lng];
    setDestination(destPoint);
    setDestLabel(`Destination (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`);
    if (currentPos) {
      calculateRoute(currentPos, destPoint);
    }
  };

  // Handle geocode search
  const handleSearchSubmit = async () => {
    if (!searchQuery.trim()) return;
    try {
      setIsSearching(true);
      const results = await geocode(searchQuery);
      setSearchResults(results);
    } catch (e: any) {
      console.warn('Geocoding error:', e);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (item: GeocodeResult) => {
    const destPoint: LatLng = [item.lat, item.lng];
    setDestination(destPoint);
    setDestLabel(item.label);
    setSearchResults([]);
    setSearchQuery('');
    if (currentPos) {
      calculateRoute(currentPos, destPoint);
    }
  };

  // Start Emergency Trip
  const handleStartTrip = async () => {
    if (!routeResult) return;
    try {
      setIsStartingTrip(true);
      const { data: tripId, error } = await supabase.rpc('start_trip', {
        p_route: routeResult.geometry,
      });

      if (error) throw error;
      if (!tripId) throw new Error('Trip ID was not returned by server.');

      router.push({
        pathname: '/(ambulance)/trip',
        params: {
          tripId,
          routeJson: JSON.stringify(routeResult.geometry),
        },
      });
    } catch (e: any) {
      Alert.alert('Trip Creation Failed', e.message || 'Unable to start emergency trip.');
    } finally {
      setIsStartingTrip(false);
    }
  };

  // Resume or cancel existing active trip
  const handleResumeTrip = () => {
    if (!activeTrip) return;
    router.push({
      pathname: '/(ambulance)/trip',
      params: {
        tripId: activeTrip.id,
        routeJson: JSON.stringify(activeTrip.route),
      },
    });
  };

  const handleCancelActiveTrip = async () => {
    if (!activeTrip) return;
    try {
      await supabase.rpc('end_trip', { p_trip: activeTrip.id });
      setActiveTrip(null);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to cancel active trip.');
    }
  };

  // Construct map markers
  const markers: MapMarker[] = [];
  if (currentPos) {
    markers.push({
      id: 'self',
      lat: currentPos[0],
      lng: currentPos[1],
      kind: 'self',
    });
  }
  if (destination) {
    markers.push({
      id: 'dest',
      lat: destination[0],
      lng: destination[1],
      kind: 'destination',
    });
  }

  const mapCenter = currentPos || DEFAULT_CENTER;

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header Bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.title}>🚑 Dispatch Route Planner</Text>
          <Text style={styles.subTitle}>Select destination to calculate clearance corridor</Text>
        </View>
        <TouchableOpacity style={styles.signOutBtn} onPress={signOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Active Trip Resume Banner */}
      {activeTrip && (
        <View style={styles.resumeBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.resumeTitle}>Active Emergency Trip in Progress</Text>
            <Text style={styles.resumeSub}>Trip #{activeTrip.id.substring(0, 8)} is running.</Text>
          </View>
          <View style={styles.resumeActions}>
            <TouchableOpacity style={styles.resumeBtn} onPress={handleResumeTrip}>
              <Text style={styles.resumeBtnText}>Resume</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelTripBtn} onPress={handleCancelActiveTrip}>
              <Text style={styles.cancelTripText}>End</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Search Input Bar */}
      <View style={styles.searchBarContainer}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearchSubmit}
          placeholder="Search hospital, street or destination..."
          placeholderTextColor="#64748b"
          returnKeyType="search"
        />
        <TouchableOpacity
          style={styles.searchBtn}
          onPress={handleSearchSubmit}
          disabled={isSearching}
        >
          {isSearching ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.searchBtnText}>Search</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Search Dropdown Results */}
      {searchResults.length > 0 && (
        <View style={styles.resultsDropdown}>
          <FlatList
            data={searchResults}
            keyExtractor={(_, idx) => String(idx)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.resultRow}
                onPress={() => handleSelectSearchResult(item)}
              >
                <Text style={styles.resultIcon}>📍</Text>
                <Text style={styles.resultText} numberOfLines={2}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* Permission Warning */}
      {permError && (
        <View style={styles.permWarning}>
          <Text style={styles.permWarningText}>⚠️ {permError}</Text>
          <TouchableOpacity onPress={() => Linking.openSettings()}>
            <Text style={styles.settingsLink}>Settings</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Map View */}
      <View style={styles.mapContainer}>
        <LeafletMap
          center={mapCenter}
          zoom={14}
          markers={markers}
          route={leafletRoute}
          fitToRoute={!!leafletRoute}
          onMapPress={handleMapPress}
        />
      </View>

      {/* Route & Trip Control Bottom Sheet */}
      <View style={styles.bottomCard}>
        {isRouting ? (
          <View style={styles.routingLoading}>
            <ActivityIndicator size="small" color="#dc2626" />
            <Text style={styles.routingLoadingText}>Calculating road route & corridor...</Text>
          </View>
        ) : routeError ? (
          <View style={styles.routeErrorBox}>
            <Text style={styles.routeErrorText}>⚠️ {routeError}</Text>
            {currentPos && destination && (
              <TouchableOpacity
                style={styles.recalcBtn}
                onPress={() => calculateRoute(currentPos, destination)}
              >
                <Text style={styles.recalcBtnText}>Retry Calculation</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : routeResult ? (
          <View>
            <View style={styles.routeStatsRow}>
              <View>
                <Text style={styles.routeStatsTitle}>
                  {(routeResult.distance_m / 1000).toFixed(1)} km
                </Text>
                <Text style={styles.routeStatsSub}>
                  Est. {Math.round(routeResult.duration_s / 60)} min ({routeResult.provider})
                </Text>
              </View>

              <TouchableOpacity
                style={styles.recalcSmallBtn}
                onPress={() => currentPos && destination && calculateRoute(currentPos, destination)}
              >
                <Text style={styles.recalcSmallText}>Recalculate</Text>
              </TouchableOpacity>
            </View>

            {destLabel ? (
              <Text style={styles.destLabelText} numberOfLines={1}>
                To: {destLabel}
              </Text>
            ) : null}

            <TouchableOpacity
              style={styles.startTripBtn}
              onPress={handleStartTrip}
              disabled={isStartingTrip}
              activeOpacity={0.85}
            >
              {isStartingTrip ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.startTripText}>🚨 START EMERGENCY TRIP</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.tapPrompt}>
            <Text style={styles.tapPromptText}>
              Tap anywhere on the map or search above to set destination.
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  subTitle: {
    color: '#94a3b8',
    fontSize: 12,
  },
  signOutBtn: {
    backgroundColor: '#1e293b',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  signOutText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  resumeBanner: {
    backgroundColor: '#991b1b',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resumeTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  resumeSub: {
    color: '#fecaca',
    fontSize: 11,
  },
  resumeActions: {
    flexDirection: 'row',
    gap: 8,
  },
  resumeBtn: {
    backgroundColor: '#ffffff',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  resumeBtnText: {
    color: '#991b1b',
    fontWeight: '700',
    fontSize: 12,
  },
  cancelTripBtn: {
    backgroundColor: '#450a0a',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  cancelTripText: {
    color: '#fca5a5',
    fontWeight: '700',
    fontSize: 12,
  },
  searchBarContainer: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    backgroundColor: '#0f172a',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#334155',
    minHeight: 46,
  },
  searchBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 46,
  },
  searchBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  resultsDropdown: {
    position: 'absolute',
    top: 120,
    left: 12,
    right: 12,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    maxHeight: 220,
    zIndex: 9999,
    elevation: 8,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  resultIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  resultText: {
    color: '#f8fafc',
    fontSize: 13,
    flex: 1,
  },
  permWarning: {
    backgroundColor: '#78350f',
    padding: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  permWarningText: {
    color: '#fef3c7',
    fontSize: 12,
  },
  settingsLink: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  mapContainer: {
    flex: 1,
  },
  bottomCard: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    borderTopWidth: 1,
    borderColor: '#334155',
  },
  tapPrompt: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  tapPromptText: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
  },
  routingLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  routingLoadingText: {
    color: '#f1f5f9',
    fontSize: 14,
  },
  routeErrorBox: {
    paddingVertical: 10,
  },
  routeErrorText: {
    color: '#f87171',
    fontSize: 13,
    marginBottom: 8,
  },
  recalcBtn: {
    backgroundColor: '#334155',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  recalcBtnText: {
    color: '#f1f5f9',
    fontSize: 13,
    fontWeight: '600',
  },
  routeStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  routeStatsTitle: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800',
  },
  routeStatsSub: {
    color: '#94a3b8',
    fontSize: 13,
  },
  destLabelText: {
    color: '#cbd5e1',
    fontSize: 12,
    marginBottom: 12,
  },
  recalcSmallBtn: {
    backgroundColor: '#334155',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  recalcSmallText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  startTripBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
    marginTop: 4,
  },
  startTripText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
