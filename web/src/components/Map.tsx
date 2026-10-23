import React, { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  CircleMarker,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import type { Trip, Vehicle, AlertRow, VehicleVisualState } from '../lib/types';
import { geoJsonToLeafletCoords, deriveVehicleAlertState } from '../lib/derive';
import { LOOKAHEAD_M, DEFAULT_CENTER } from '../config';

// Fix Leaflet's default icon assets
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom DivIcon for ambulance with rotating arrow and pulsing aura
const createAmbulanceIcon = (heading: number | null, isActive: boolean) => {
  const rot = heading ?? 0;
  return L.divIcon({
    className: 'amb-marker-wrapper',
    html: `
      <div class="ambulance-container ${isActive ? 'pulse' : ''}" style="transform: rotate(${rot}deg);">
        <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
          <polygon points="17,2 32,30 17,24 2,30" fill="#dc2626" stroke="#ffffff" stroke-width="2.5" />
        </svg>
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
};

// Map controller subcomponent for camera follow and fitBounds
interface MapControllerProps {
  follow: boolean;
  targetPos: [number, number] | null;
  fitBoundsTrigger: number;
  routeCoords: [number, number][];
}

const MapController: React.FC<MapControllerProps> = ({
  follow,
  targetPos,
  fitBoundsTrigger,
  routeCoords,
}) => {
  const map = useMap();

  useEffect(() => {
    if (fitBoundsTrigger > 0 && routeCoords.length > 1) {
      const bounds = L.latLngBounds(routeCoords);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [fitBoundsTrigger, map, routeCoords]);

  useEffect(() => {
    if (follow && targetPos) {
      map.panTo(targetPos, { animate: true, duration: 0.5 });
    }
  }, [follow, targetPos, map]);

  return null;
};

// Calculate 1 km forward alert zone on route polyline
const computeAlertZoneSegment = (
  route: [number, number][],
  ambPos: [number, number] | null,
  lookaheadM: number
): [number, number][] => {
  if (!ambPos || route.length < 2) return [];

  // Find index of nearest route point to ambulance
  let nearestIdx = 0;
  let minDistance = Infinity;

  for (let i = 0; i < route.length; i++) {
    const d = L.latLng(ambPos).distanceTo(L.latLng(route[i]));
    if (d < minDistance) {
      minDistance = d;
      nearestIdx = i;
    }
  }

  const segment: [number, number][] = [ambPos];
  let accumulatedM = 0;

  for (let i = nearestIdx; i < route.length - 1; i++) {
    const p1 = route[i];
    const p2 = route[i + 1];
    const segDist = L.latLng(p1).distanceTo(L.latLng(p2));

    if (accumulatedM + segDist >= lookaheadM) {
      const ratio = (lookaheadM - accumulatedM) / (segDist || 1);
      const endLat = p1[0] + ratio * (p2[0] - p1[0]);
      const endLng = p1[1] + ratio * (p2[1] - p1[1]);
      segment.push([endLat, endLng]);
      break;
    }

    segment.push(p2);
    accumulatedM += segDist;
  }

  return segment.length >= 2 ? segment : [];
};

interface MapProps {
  selectedTrip: Trip | null;
  vehicles: Vehicle[];
  alerts: AlertRow[];
  follow: boolean;
  onToggleFollow: () => void;
  focusedVehiclePos: [number, number] | null;
}

export const Map: React.FC<MapProps> = ({
  selectedTrip,
  vehicles,
  alerts,
  follow,
  onToggleFollow,
  focusedVehiclePos,
}) => {
  const [fitTrigger, setFitTrigger] = React.useState<number>(0);
  const previousTripIdRef = useRef<string | null>(null);

  // Convert selected trip route
  const routeCoords = useMemo<[number, number][]>(() => {
    if (!selectedTrip?.route?.coordinates) return [];
    return geoJsonToLeafletCoords(selectedTrip.route.coordinates);
  }, [selectedTrip]);

  // Ambulance position
  const ambPos = useMemo<[number, number] | null>(() => {
    if (selectedTrip?.amb_lat != null && selectedTrip?.amb_lng != null) {
      return [selectedTrip.amb_lat, selectedTrip.amb_lng];
    }
    return routeCoords[0] || null;
  }, [selectedTrip, routeCoords]);

  // Auto-fit when trip changes
  useEffect(() => {
    if (selectedTrip && selectedTrip.id !== previousTripIdRef.current) {
      previousTripIdRef.current = selectedTrip.id;
      setFitTrigger((n) => n + 1);
    }
  }, [selectedTrip]);

  // Compute 1km forward alert zone segment
  const alertZoneCoords = useMemo(() => {
    return computeAlertZoneSegment(routeCoords, ambPos, LOOKAHEAD_M);
  }, [routeCoords, ambPos]);

  // Map of alerts per user for fast O(1) state lookup
  const userAlertMap = useMemo(() => {
    const alertMap = new window.Map<string, AlertRow>();
    alerts.forEach((a) => {
      if (!alertMap.has(a.user_id) && (!selectedTrip || a.trip_id === selectedTrip.id)) {
        alertMap.set(a.user_id, a);
      }
    });
    return alertMap;
  }, [alerts, selectedTrip]);

  // Color mapping helper for vehicles
  const getVehicleColor = (state: VehicleVisualState): string => {
    switch (state) {
      case 'blocking':
        return '#ef4444'; // Red
      case 'active':
        return '#f59e0b'; // Amber
      case 'acknowledged':
        return '#22c55e'; // Green
      default:
        return '#94a3b8'; // Gray
    }
  };

  const centerPos = ambPos || routeCoords[0] || DEFAULT_CENTER;

  return (
    <div className="map-view-container">
      <MapContainer
        center={centerPos}
        zoom={14}
        scrollWheelZoom={true}
        className="leaflet-map-element"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />

        <MapController
          follow={follow}
          targetPos={focusedVehiclePos || ambPos}
          fitBoundsTrigger={fitTrigger}
          routeCoords={routeCoords}
        />

        {/* Selected Trip Route */}
        {routeCoords.length > 1 && (
          <Polyline
            positions={routeCoords}
            pathOptions={{
              color: '#2563eb',
              weight: 6,
              opacity: 0.8,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        )}

        {/* 1km Alert Zone Highlight */}
        {alertZoneCoords.length > 1 && (
          <Polyline
            positions={alertZoneCoords}
            pathOptions={{
              color: '#ef4444',
              weight: 12,
              opacity: 0.35,
              lineCap: 'round',
            }}
          />
        )}

        {/* Ambulance Marker */}
        {ambPos && selectedTrip && (
          <Marker
            position={ambPos}
            icon={createAmbulanceIcon(
              selectedTrip.amb_heading,
              selectedTrip.status === 'active'
            )}
          >
            <Popup className="custom-popup">
              <div className="popup-content">
                <strong>🚑 Emergency Ambulance</strong>
                <div>Trip ID: #{selectedTrip.id.substring(0, 8)}</div>
                <div>Status: <span className={`status-${selectedTrip.status}`}>{selectedTrip.status}</span></div>
                {selectedTrip.amb_heading != null && <div>Heading: {Math.round(selectedTrip.amb_heading)}°</div>}
              </div>
            </Popup>
          </Marker>
        )}

        {/* Vehicles */}
        {vehicles.map((v) => {
          const state = deriveVehicleAlertState(v.user_id, userAlertMap);
          const color = getVehicleColor(state);
          const alert = userAlertMap.get(v.user_id);

          return (
            <CircleMarker
              key={v.user_id}
              center={[v.lat, v.lng]}
              radius={state !== 'none' ? 8 : 6}
              pathOptions={{
                color: '#ffffff',
                weight: 1.5,
                fillColor: color,
                fillOpacity: 0.9,
              }}
            >
              <Popup className="custom-popup">
                <div className="popup-content">
                  <div className="popup-header">
                    <strong>Vehicle #{v.short_id}</strong>
                    <span className={`badge-state state-${state}`}>
                      {state === 'blocking'
                        ? 'BLOCKING'
                        : state === 'active'
                        ? 'ALERTED'
                        : state === 'acknowledged'
                        ? 'ACKNOWLEDGED'
                        : 'NORMAL'}
                    </span>
                  </div>
                  <div>Speed: {v.speed_kmh} km/h</div>
                  <div>Heading: {v.heading != null ? `${Math.round(v.heading)}°` : '—'}</div>
                  <div>Last seen: {v.age_s}s ago</div>
                  {alert && (
                    <div className="alert-dist-info">
                      Distance ahead: <strong>{Math.round(alert.distance_m)} m</strong>
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Floating Map Actions */}
      <div className="map-floating-bar">
        <button
          className={`floating-btn ${follow ? 'active' : ''}`}
          onClick={onToggleFollow}
          title="Toggle camera following the ambulance"
        >
          {follow ? '🎯 Following Ambulance' : '🧭 Free Camera'}
        </button>

        {routeCoords.length > 1 && (
          <button
            className="floating-btn"
            onClick={() => setFitTrigger((n) => n + 1)}
            title="Fit view to current route"
          >
            🗺️ Fit Route
          </button>
        )}
      </div>

      {/* Map Legend */}
      <div className="map-legend">
        <div className="legend-title">Vehicle Status</div>
        <div className="legend-item">
          <span className="dot dot-gray" /> Normal
        </div>
        <div className="legend-item">
          <span className="dot dot-amber" /> Alerted (Active)
        </div>
        <div className="legend-item">
          <span className="dot dot-red" /> Blocking (&lt; 8 km/h)
        </div>
        <div className="legend-item">
          <span className="dot dot-green" /> Acknowledged
        </div>
      </div>
    </div>
  );
};
