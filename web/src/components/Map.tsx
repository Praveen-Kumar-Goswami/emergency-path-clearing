import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
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

export type MapTileTheme = 'dark' | 'satellite' | 'street';

const TILE_PROVIDERS: Record<MapTileTheme, { url: string; attribution: string; maxZoom: number }> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
    maxZoom: 20,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri &mdash; DigitalGlobe, GeoEye, Earthstar',
    maxZoom: 19,
  },
  street: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
    maxZoom: 19,
  },
};

/**
 * Creates custom tactical DivIcon for an emergency ambulance with siren strobe & directional heading.
 */
const createAmbulanceIcon = (heading: number | null, isActive: boolean) => {
  const rot = heading ?? 0;
  return L.divIcon({
    className: 'amb-marker-wrapper',
    html: `
      <div class="tactical-amb-marker ${isActive ? 'active' : ''}">
        <div class="amb-beacon-ring"></div>
        <div class="amb-radar-pulse"></div>
        <div class="amb-body" style="transform: rotate(${rot}deg);">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <polygon points="20,2 36,34 20,27 4,34" fill="#ff2d55" stroke="#ffffff" stroke-width="2.5" />
            <circle cx="20" cy="20" r="4.5" fill="#ffffff" />
          </svg>
        </div>
        <span class="amb-label">AMB</span>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
};

/**
 * Creates custom tactical DivIcon for civilian vehicles with status glow and heading pointer.
 */
const createVehicleIcon = (
  state: VehicleVisualState,
  heading: number | null,
  shortId: string
) => {
  const rot = heading ?? 0;
  const isAlerted = state !== 'none';
  const color =
    state === 'blocking'
      ? '#ff3838'
      : state === 'active'
      ? '#ffb020'
      : state === 'acknowledged'
      ? '#00e87a'
      : '#94a3b8';

  return L.divIcon({
    className: 'veh-marker-wrapper',
    html: `
      <div class="tactical-veh-marker state-${state}">
        ${isAlerted ? `<div class="veh-pulse-ring"></div>` : ''}
        <div class="veh-pointer" style="transform: rotate(${rot}deg);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="${color}" stroke="#ffffff" stroke-width="1.5">
            <polygon points="12,2 21,21 12,17 3,21" />
          </svg>
        </div>
        <span class="veh-id-badge">#${shortId}</span>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

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
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    }
  }, [fitBoundsTrigger, map, routeCoords]);

  useEffect(() => {
    if (follow && targetPos) {
      map.panTo(targetPos, { animate: true, duration: 0.6 });
    }
  }, [follow, targetPos, map]);

  return null;
};

/**
 * Calculates 1,000m forward lookahead danger zone on route polyline starting from ambulance fix.
 */
const computeAlertZoneSegment = (
  route: [number, number][],
  ambPos: [number, number] | null,
  lookaheadM: number
): [number, number][] => {
  if (!ambPos || route.length < 2) return [];

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
  const [fitTrigger, setFitTrigger] = useState<number>(0);
  const [tileTheme, setTileTheme] = useState<MapTileTheme>('dark');
  const [showOnlyAlerted, setShowOnlyAlerted] = useState<boolean>(false);
  const [legendCollapsed, setLegendCollapsed] = useState<boolean>(false);
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

  // Auto-fit bounds on trip change
  useEffect(() => {
    if (selectedTrip && selectedTrip.id !== previousTripIdRef.current) {
      previousTripIdRef.current = selectedTrip.id;
      setFitTrigger((n) => n + 1);
    }
  }, [selectedTrip]);

  // Compute 1km forward hazard zone
  const alertZoneCoords = useMemo(() => {
    return computeAlertZoneSegment(routeCoords, ambPos, LOOKAHEAD_M);
  }, [routeCoords, ambPos]);

  // Map of alerts per user
  const userAlertMap = useMemo(() => {
    const alertMap = new window.Map<string, AlertRow>();
    alerts.forEach((a) => {
      if (!alertMap.has(a.user_id) && (!selectedTrip || a.trip_id === selectedTrip.id)) {
        alertMap.set(a.user_id, a);
      }
    });
    return alertMap;
  }, [alerts, selectedTrip]);

  // Filtered vehicles
  const displayedVehicles = useMemo(() => {
    if (!showOnlyAlerted) return vehicles;
    return vehicles.filter((v) => {
      const state = deriveVehicleAlertState(v.user_id, userAlertMap);
      return state !== 'none';
    });
  }, [vehicles, showOnlyAlerted, userAlertMap]);

  const centerPos = ambPos || routeCoords[0] || DEFAULT_CENTER;
  const currentTile = TILE_PROVIDERS[tileTheme];

  return (
    <div className="map-view-container">
      <MapContainer
        center={centerPos}
        zoom={14}
        scrollWheelZoom={true}
        className="leaflet-map-element"
      >
        <TileLayer
          key={tileTheme}
          attribution={currentTile.attribution}
          url={currentTile.url}
          maxZoom={currentTile.maxZoom}
        />

        <MapController
          follow={follow}
          targetPos={focusedVehiclePos || ambPos}
          fitBoundsTrigger={fitTrigger}
          routeCoords={routeCoords}
        />

        {/* 1. 35m Corridor Lateral Buffer Ribbon */}
        {routeCoords.length > 1 && (
          <Polyline
            positions={routeCoords}
            pathOptions={{
              color: '#00f0ff',
              weight: 34,
              opacity: 0.14,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        )}

        {/* 2. Main Route Centerline Glow */}
        {routeCoords.length > 1 && (
          <Polyline
            positions={routeCoords}
            pathOptions={{
              color: '#00e5ff',
              weight: 5,
              opacity: 0.9,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        )}

        {/* 3. 1km Forward Hazard Lookahead Zone (Outer Danger Aura) */}
        {alertZoneCoords.length > 1 && (
          <Polyline
            positions={alertZoneCoords}
            pathOptions={{
              color: '#ff2d55',
              weight: 36,
              opacity: 0.28,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        )}

        {/* 4. 1km Hazard Zone Centerline with Warning Dashes */}
        {alertZoneCoords.length > 1 && (
          <Polyline
            positions={alertZoneCoords}
            pathOptions={{
              color: '#ff3838',
              weight: 6,
              opacity: 1,
              dashArray: '10, 10',
              lineCap: 'round',
            }}
          />
        )}

        {/* 5. Ambulance Marker */}
        {ambPos && selectedTrip && (
          <Marker
            position={ambPos}
            icon={createAmbulanceIcon(
              selectedTrip.amb_heading,
              selectedTrip.status === 'active'
            )}
          >
            <Popup className="custom-popup" closeButton={false}>
              <div className="popup-card-content">
                <div className="popup-title-bar">
                  <span className="popup-icon">🚑</span>
                  <strong>Emergency Unit #{selectedTrip.ambulance_id.substring(0, 6)}</strong>
                  <span className={`status-pill ${selectedTrip.status}`}>
                    {selectedTrip.status.toUpperCase()}
                  </span>
                </div>
                <div className="popup-data-grid">
                  <div className="popup-data-item">
                    <span className="lbl">Heading</span>
                    <span className="val">{selectedTrip.amb_heading != null ? `${Math.round(selectedTrip.amb_heading)}°` : '—'}</span>
                  </div>
                  <div className="popup-data-item">
                    <span className="lbl">Trip ID</span>
                    <span className="val mono">#{selectedTrip.id.substring(0, 8)}</span>
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        {/* 6. Civilian Vehicles */}
        {displayedVehicles.map((v) => {
          const state = deriveVehicleAlertState(v.user_id, userAlertMap);
          const alert = userAlertMap.get(v.user_id);

          return (
            <Marker
              key={v.user_id}
              position={[v.lat, v.lng]}
              icon={createVehicleIcon(state, v.heading, v.short_id)}
            >
              <Popup className="custom-popup" closeButton={false}>
                <div className="popup-card-content">
                  <div className="popup-title-bar">
                    <span className="popup-icon">🚗</span>
                    <strong>Vehicle #{v.short_id}</strong>
                    <span className={`status-pill state-${state}`}>
                      {state === 'blocking'
                        ? 'BLOCKING'
                        : state === 'active'
                        ? 'ALERTED'
                        : state === 'acknowledged'
                        ? 'ACKNOWLEDGED'
                        : 'NORMAL'}
                    </span>
                  </div>

                  <div className="popup-data-grid">
                    <div className="popup-data-item">
                      <span className="lbl">Speed</span>
                      <span className="val">{v.speed_kmh.toFixed(1)} km/h</span>
                    </div>
                    <div className="popup-data-item">
                      <span className="lbl">Heading</span>
                      <span className="val">{v.heading != null ? `${Math.round(v.heading)}°` : '—'}</span>
                    </div>
                    <div className="popup-data-item">
                      <span className="lbl">Signal Age</span>
                      <span className="val">{v.age_s}s ago</span>
                    </div>
                    {alert && (
                      <div className="popup-data-item highlight">
                        <span className="lbl">Corridor Distance</span>
                        <span className="val red">{Math.round(alert.distance_m)} m ahead</span>
                      </div>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Floating Tactical HUD Toolbar */}
      <div className="map-tactical-toolbar">
        {/* Camera Follow Toggle */}
        <button
          className={`hud-btn ${follow ? 'active' : ''}`}
          onClick={onToggleFollow}
          title="Toggle camera auto-follow on ambulance"
        >
          <span className="hud-icon">{follow ? '🎯' : '🧭'}</span>
          <span>{follow ? 'Locked on Ambulance' : 'Free Camera'}</span>
        </button>

        {/* Fit Bounds */}
        {routeCoords.length > 1 && (
          <button
            className="hud-btn"
            onClick={() => setFitTrigger((n) => n + 1)}
            title="Recenter and fit route in viewport"
          >
            <span className="hud-icon">🗺️</span>
            <span>Fit Route</span>
          </button>
        )}

        {/* Tile Switcher */}
        <div className="hud-pill-group">
          <button
            className={`hud-pill ${tileTheme === 'dark' ? 'selected' : ''}`}
            onClick={() => setTileTheme('dark')}
            title="Tactical Dark Map"
          >
            🌙 Dark
          </button>
          <button
            className={`hud-pill ${tileTheme === 'satellite' ? 'selected' : ''}`}
            onClick={() => setTileTheme('satellite')}
            title="Satellite Imagery"
          >
            🛰️ Sat
          </button>
          <button
            className={`hud-pill ${tileTheme === 'street' ? 'selected' : ''}`}
            onClick={() => setTileTheme('street')}
            title="Street Map"
          >
            🗺️ Street
          </button>
        </div>

        {/* Vehicle Filter Toggle */}
        <button
          className={`hud-btn ${showOnlyAlerted ? 'active' : ''}`}
          onClick={() => setShowOnlyAlerted(!showOnlyAlerted)}
          title="Filter vehicles to only those with active corridor alerts"
        >
          <span className="hud-icon">🚨</span>
          <span>{showOnlyAlerted ? 'Showing Alerted Only' : 'All Vehicles'}</span>
        </button>
      </div>

      {/* Floating Tactical Legend */}
      <div className={`map-tactical-legend ${legendCollapsed ? 'collapsed' : ''}`}>
        <div
          className="legend-header"
          onClick={() => setLegendCollapsed(!legendCollapsed)}
          role="button"
          tabIndex={0}
        >
          <span className="legend-title">Tactical Status Map</span>
          <span className="legend-toggle">{legendCollapsed ? '▲' : '▼'}</span>
        </div>

        {!legendCollapsed && (
          <div className="legend-body">
            <div className="legend-row">
              <span className="legend-color-dot amb-dot"></span>
              <span className="legend-lbl">Ambulance Unit</span>
            </div>
            <div className="legend-row">
              <span className="legend-color-dot blocking-dot"></span>
              <span className="legend-lbl">Blocking (&lt; 8 km/h)</span>
            </div>
            <div className="legend-row">
              <span className="legend-color-dot alert-dot"></span>
              <span className="legend-lbl">Corridor Alert (&lt; 1km)</span>
            </div>
            <div className="legend-row">
              <span className="legend-color-dot ack-dot"></span>
              <span className="legend-lbl">Moving Aside (Ack)</span>
            </div>
            <div className="legend-row">
              <span className="legend-color-dot normal-dot"></span>
              <span className="legend-lbl">Normal Civilian</span>
            </div>
            <div className="legend-divider"></div>
            <div className="legend-row">
              <span className="corridor-line-preview hazard"></span>
              <span className="legend-lbl">1km Hazard Zone</span>
            </div>
            <div className="legend-row">
              <span className="corridor-line-preview corridor"></span>
              <span className="legend-lbl">35m Lateral Corridor</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
