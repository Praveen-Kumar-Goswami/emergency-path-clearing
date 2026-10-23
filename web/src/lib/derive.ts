import type { Snapshot, Trip, AlertRow, VehicleVisualState } from './types';

export const activeTrips = (trips: Trip[]): Trip[] => {
  return trips.filter((t) => t.status === 'active');
};

export const recentTrips = (trips: Trip[]): Trip[] => {
  return trips.filter((t) => t.status !== 'active');
};

export const getLatestAlertPerUser = (alerts: AlertRow[]): Map<string, AlertRow> => {
  const map = new Map<string, AlertRow>();
  // Alerts are ordered by created_at DESC from RPC
  alerts.forEach((alert) => {
    if (!map.has(alert.user_id)) {
      map.set(alert.user_id, alert);
    }
  });
  return map;
};

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
 * Converts GeoJSON coordinates [[lng, lat], ...] to Leaflet [[lat, lng], ...]
 */
export const geoJsonToLeafletCoords = (coords: [number, number][]): [number, number][] => {
  return coords.map(([lng, lat]) => [lat, lng]);
};
