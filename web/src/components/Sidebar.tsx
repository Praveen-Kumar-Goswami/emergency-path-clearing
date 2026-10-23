import { useState } from 'react';
import type { Trip, AlertRow, Vehicle } from '../lib/types';
import { activeTrips, recentTrips } from '../lib/derive';

interface SidebarProps {
  trips: Trip[];
  vehicles: Vehicle[];
  alerts: AlertRow[];
  selectedTripId: string | null;
  onSelectTrip: (tripId: string) => void;
  onFocusVehicle: (pos: [number, number]) => void;
  metrics: {
    vehiclesOnline: number;
    alertsActive: number;
    blocking: number;
    acknowledged: number;
  };
}

export const Sidebar: React.FC<SidebarProps> = ({
  trips,
  vehicles,
  alerts,
  selectedTripId,
  onSelectTrip,
  onFocusVehicle,
  metrics,
}) => {
  const [showRecent, setShowRecent] = useState(false);

  const active = activeTrips(trips);
  const recent = recentTrips(trips);
  const selectedTrip = trips.find((t) => t.id === selectedTripId) || null;

  // Stale trip check (> 30s since last tick)
  const isTripStale = (trip: Trip) => {
    if (trip.status !== 'active') return false;
    const diffSeconds = (Date.now() - new Date(trip.last_tick_at).getTime()) / 1000;
    return diffSeconds > 30;
  };

  // Vehicle lookup map for clicking alert feed rows
  const vehicleMap = new Map<string, Vehicle>();
  vehicles.forEach((v) => vehicleMap.set(v.user_id, v));

  // Filter alert feed for selected trip or all recent alerts
  const displayAlerts = (selectedTripId
    ? alerts.filter((a) => a.trip_id === selectedTripId)
    : alerts
  ).slice(0, 50);

  const formatTime = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getTickAgeText = (lastTickAt: string) => {
    const age = Math.max(0, Math.floor((Date.now() - new Date(lastTickAt).getTime()) / 1000));
    return `${age}s ago`;
  };

  return (
    <aside className="dashboard-sidebar">
      {/* 1. Top Metrics Counters */}
      <div className="metrics-strip">
        <div className="metric-box">
          <span className="metric-val">{metrics.vehiclesOnline}</span>
          <span className="metric-lbl">Vehicles</span>
        </div>
        <div className="metric-box active-alert">
          <span className="metric-val">{metrics.alertsActive}</span>
          <span className="metric-lbl">Alerted</span>
        </div>
        <div className="metric-box blocking-alert">
          <span className="metric-val">{metrics.blocking}</span>
          <span className="metric-lbl">Blocking</span>
        </div>
        <div className="metric-box ack-alert">
          <span className="metric-val">{metrics.acknowledged}</span>
          <span className="metric-lbl">Cleared</span>
        </div>
      </div>

      {/* 2. Trip Selector */}
      <section className="sidebar-section">
        <div className="section-header">
          <h3>Active Emergency Trips ({active.length})</h3>
        </div>

        {active.length === 0 ? (
          <div className="empty-trips-card">
            <div className="calm-illustration">
              <div className="calm-circle" />
              <div className="calm-bar" />
            </div>
            <p className="empty-title">No active emergency trips</p>
            <p className="empty-sub">
              Corridor alerts will automatically broadcast when an ambulance starts a trip.
            </p>
          </div>
        ) : (
          <div className="trip-list">
            {active.map((trip) => {
              const isSelected = trip.id === selectedTripId;
              const stale = isTripStale(trip);
              const shortAmbId = trip.ambulance_id.substring(0, 6);

              return (
                <div
                  key={trip.id}
                  className={`trip-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelectTrip(trip.id)}
                >
                  <div className="trip-main">
                    <span className="trip-icon">🚑</span>
                    <div className="trip-info">
                      <div className="trip-title-row">
                        <strong>Ambulance #{shortAmbId}</strong>
                        <span className="trip-status-tag active">ACTIVE</span>
                      </div>
                      <div className="trip-meta">
                        <span>Started: {formatTime(trip.created_at)}</span>
                        <span>Tick: {getTickAgeText(trip.last_tick_at)}</span>
                      </div>
                    </div>
                  </div>

                  {stale && (
                    <div className="stale-warning">
                      ⚠️ No signal from ambulance ({getTickAgeText(trip.last_tick_at)})
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Collapsed Recent Trips */}
        {recent.length > 0 && (
          <div className="recent-section">
            <button
              className="recent-toggle"
              onClick={() => setShowRecent(!showRecent)}
            >
              <span>{showRecent ? '▼' : '▶'} Recent Completed Trips ({recent.length})</span>
            </button>

            {showRecent && (
              <div className="recent-list">
                {recent.slice(0, 5).map((trip) => (
                  <div
                    key={trip.id}
                    className={`recent-item ${trip.id === selectedTripId ? 'selected' : ''}`}
                    onClick={() => onSelectTrip(trip.id)}
                  >
                    <span>Amb #{trip.ambulance_id.substring(0, 6)}</span>
                    <span className={`status-badge ${trip.status}`}>{trip.status}</span>
                    <span className="recent-time">{formatTime(trip.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 3. Alert Feed */}
      <section className="sidebar-section feed-section">
        <div className="section-header">
          <h3>
            Corridor Alert Feed {selectedTrip && `(#${selectedTrip.id.substring(0, 6)})`}
          </h3>
          <span className="feed-count">{displayAlerts.length} total</span>
        </div>

        <div className="alert-feed-list">
          {displayAlerts.length === 0 ? (
            <div className="feed-empty">No alerts triggered in this corridor.</div>
          ) : (
            displayAlerts.map((alert) => {
              const vehicle = vehicleMap.get(alert.user_id);
              const isOnline = !!vehicle;

              return (
                <div
                  key={alert.id}
                  className={`feed-row status-${alert.status} ${alert.blocking ? 'blocking' : ''} ${
                    isOnline ? 'clickable' : ''
                  }`}
                  onClick={() => {
                    if (vehicle) {
                      onFocusVehicle([vehicle.lat, vehicle.lng]);
                    }
                  }}
                  title={isOnline ? 'Click to pan to vehicle' : 'Vehicle offline'}
                >
                  <div className="feed-col-left">
                    <span className="feed-time">{formatTime(alert.created_at)}</span>
                    <span className="feed-user">#{alert.short_id}</span>
                  </div>

                  <div className="feed-col-center">
                    <span className="feed-dist">{Math.round(alert.distance_m)} m ahead</span>
                  </div>

                  <div className="feed-col-right">
                    <span
                      className={`status-chip chip-${alert.status} ${
                        alert.blocking ? 'chip-blocking' : ''
                      }`}
                    >
                      {alert.blocking
                        ? 'BLOCKING'
                        : alert.status === 'active'
                        ? 'ALERT'
                        : alert.status === 'acknowledged'
                        ? 'ACK'
                        : 'CLEARED'}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </aside>
  );
};
