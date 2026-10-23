/**
 * @fileoverview Pure functional state transformers and metric derivations
 * for the Emergency Path Clearing dispatch dashboard.
 */

import type { Snapshot, Trip, AlertRow, VehicleVisualState } from './types';

/**
 * Filters a list of trips down to only active emergency runs.
 *
 * @param trips Array of Trip objects
 * @returns Array containing only trips with status === 'active'
 */
export const activeTrips = (trips: Trip[]): Trip[] => {
  return trips.filter((t) => t.status === 'active');
};

/**
 * Filters a list of trips down to historical or inactive runs.
 *
 * @param trips Array of Trip objects
 * @returns Array containing trips with status !== 'active'
 */
export const recentTrips = (trips: Trip[]): Trip[] => {
  return trips.filter((t) => t.status !== 'active');
};

/**
 * Builds an efficient lookup map of the latest alert row per citizen user ID.
 *
 * @param alerts Array of AlertRow records sorted by created_at DESC
 * @returns Map mapping user_id to their newest AlertRow
 */
export const getLatestAlertPerUser = (alerts: AlertRow[]): Map<string, AlertRow> => {
  const map = new Map<string, AlertRow>();
  alerts.forEach((alert) => {
    if (!map.has(alert.user_id)) {
      map.set(alert.user_id, alert);
    }
  });
  return map;
};

/**
 * Derives the visual alert state token for a vehicle based on its latest alert record.
 *
 * @param userId Unique user identifier
 * @param userAlertMap Pre-computed map from getLatestAlertPerUser
 * @returns Visual alert state: 'blocking' | 'active' | 'acknowledged' | 'none'
 */
export const deriveVehicleAlertState = (
  userId: string,
  userAlertMap: Map<string, AlertRow>
): VehicleVisualState => {
  const alert = userAlertMap.get(userId);
  if (!alert) return 'none';

  if (alert.status === 'acknowledged') return 'acknowledged';
  if (alert.status === 'active') {
    return alert.blocking ? 'blocking' : 'active';
  }
  return 'none';
};

/**
 * Aggregates high-level dispatch telemetry counters from the current snapshot.
 *
 * @param snapshot Complete telemetry snapshot from dashboard_snapshot RPC
 * @param selectedTripId Optional active trip ID to scope metrics to, or null for all trips
 * @returns Object with counts for vehiclesOnline, alertsActive, blocking, acknowledged
 */
export const deriveMetrics = (snapshot: Snapshot | null, selectedTripId: string | null) => {
  if (!snapshot) {
    return {
      vehiclesOnline: 0,
      alertsActive: 0,
      blocking: 0,
      acknowledged: 0,
    };
  }

  const vehiclesOnline = snapshot.vehicles.length;

  // Filter alerts for the selected trip or all active/acknowledged alerts
  const relevantAlerts = selectedTripId
    ? snapshot.alerts.filter((a) => a.trip_id === selectedTripId)
    : snapshot.alerts;

  let alertsActive = 0;
  let blocking = 0;
  let acknowledged = 0;

  relevantAlerts.forEach((a) => {
    if (a.status === 'active') {
      alertsActive++;
      if (a.blocking) blocking++;
    } else if (a.status === 'acknowledged') {
      acknowledged++;
    }
  });

  return {
    vehiclesOnline,
    alertsActive,
    blocking,
    acknowledged,
  };
};

/**
 * Converts GeoJSON coordinates `[[longitude, latitude], ...]` to Leaflet format `[[latitude, longitude], ...]`.
 *
 * @param coords Array of [lng, lat] coordinate pairs
 * @returns Array of [lat, lng] pairs for Leaflet map polylines
 */
export const geoJsonToLeafletCoords = (coords: [number, number][]): [number, number][] => {
  return coords.map(([lng, lat]) => [lat, lng]);
};
