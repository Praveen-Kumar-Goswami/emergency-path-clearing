import React from 'react';
import type { DashboardSnapshot, Trip, AlertRow, Vehicle } from '../lib/types';
import { activeTrips, recentTrips } from '../lib/derive';

interface AnalyticsDashboardProps {
  snapshot: DashboardSnapshot | null;
  onSelectTrip: (tripId: string) => void;
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  snapshot,
  onSelectTrip,
}) => {
  const trips = snapshot?.trips || [];
  const vehicles = snapshot?.vehicles || [];
  const alerts = snapshot?.alerts || [];

  const active = activeTrips(trips);
  const recent = recentTrips(trips);

  // Stats calculation
  const totalAlerts = alerts.length;
  const activeAlerts = alerts.filter((a) => a.status === 'active').length;
  const acknowledgedAlerts = alerts.filter((a) => a.status === 'acknowledged').length;
  const blockingAlerts = alerts.filter((a) => a.is_blocking && (a.status === 'active' || a.status === 'acknowledged')).length;
  const clearedAlerts = alerts.filter((a) => a.status === 'cleared').length;

  const clearanceRate = totalAlerts > 0
    ? Math.round(((clearedAlerts + acknowledgedAlerts) / totalAlerts) * 100)
    : 100;

  // Speed brackets
  const stoppedCount = vehicles.filter((v) => (v.speed_mps || 0) * 3.6 < 8).length;
  const slowingCount = vehicles.filter((v) => {
    const kmh = (v.speed_mps || 0) * 3.6;
    return kmh >= 8 && kmh < 30;
  }).length;
  const freeFlowCount = vehicles.filter((v) => (v.speed_mps || 0) * 3.6 >= 30).length;

  // Format time
  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="analytics-view">
      <div className="analytics-header">
        <div>
          <h2>Corridor Clearance & Response Analytics</h2>
          <p className="analytics-sub">Real-time performance metrics computed across active emergency corridors</p>
        </div>
        <div className="analytics-quick-badge">
          <span>Target Response Window: <strong>&lt; 60 seconds</strong></span>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="kpi-grid">
        <div className="kpi-card green-glow">
          <div className="kpi-label">Corridor Clearance Rate</div>
          <div className="kpi-value text-green">{clearanceRate}%</div>
          <div className="kpi-bar-bg">
            <div className="kpi-bar-fill green-bar" style={{ width: `${clearanceRate}%` }} />
          </div>
          <div className="kpi-footer">Acknowledged or cleared vehicles along paths</div>
        </div>

        <div className="kpi-card red-glow">
          <div className="kpi-label">Blocking Incidents</div>
          <div className="kpi-value text-red">{blockingAlerts}</div>
          <div className="kpi-sub">Vehicles stopped (&lt; 8 km/h) in corridor</div>
          <div className="kpi-footer">Requires urgent audio/vibrational alerts</div>
        </div>

        <div className="kpi-card amber-glow">
          <div className="kpi-label">Active Warning Corridors</div>
          <div className="kpi-value text-amber">{activeAlerts}</div>
          <div className="kpi-sub">Drivers currently in 1,000m lookahead</div>
          <div className="kpi-footer">Ahead of active ambulances on route</div>
        </div>

        <div className="kpi-card blue-glow">
          <div className="kpi-label">Connected Vehicles</div>
          <div className="kpi-value text-blue">{vehicles.length}</div>
          <div className="kpi-sub">{active.length} active emergency ambulance(s)</div>
          <div className="kpi-footer">Transmitting location telemetry every 3s</div>
        </div>
      </div>

      {/* Two Column Layout: Speed Distribution & Active Trips */}
      <div className="analytics-row">
        {/* Speed Distribution Panel */}
        <div className="analytics-panel">
          <div className="panel-title">
            <h3>Traffic Speed & Congestion Breakdown</h3>
            <span className="badge-pill">On-Road Velocity</span>
          </div>

          <div className="speed-dist-container">
            <div className="speed-metric-row">
              <div className="speed-info">
                <span className="speed-dot dot-red" />
                <span className="speed-title">Gridlocked / Stopped (&lt; 8 km/h)</span>
                <span className="speed-count">{stoppedCount} vehicles</span>
              </div>
              <div className="speed-track">
                <div
                  className="speed-fill fill-red"
                  style={{
                    width: `${vehicles.length ? (stoppedCount / vehicles.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            <div className="speed-metric-row">
              <div className="speed-info">
                <span className="speed-dot dot-amber" />
                <span className="speed-title">Slowing / Moving Aside (8 - 30 km/h)</span>
                <span className="speed-count">{slowingCount} vehicles</span>
              </div>
              <div className="speed-track">
                <div
                  className="speed-fill fill-amber"
                  style={{
                    width: `${vehicles.length ? (slowingCount / vehicles.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            <div className="speed-metric-row">
              <div className="speed-info">
                <span className="speed-dot dot-green" />
                <span className="speed-title">Free Flow (&gt; 30 km/h)</span>
                <span className="speed-count">{freeFlowCount} vehicles</span>
              </div>
              <div className="speed-track">
                <div
                  className="speed-fill fill-green"
                  style={{
                    width: `${vehicles.length ? (freeFlowCount / vehicles.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="stat-explanation-box">
            <strong>Corridor Rule:</strong> Any vehicle within the 35m lateral corridor whose speed drops below <strong>8 km/h</strong> is automatically elevated to a <code>BLOCKING</code> alert state with continuous audio siren prompts on the citizen device.
          </div>
        </div>

        {/* Active Emergency Operations */}
        <div className="analytics-panel">
          <div className="panel-title">
            <h3>Emergency Operations Status</h3>
            <span className="badge-pill">{active.length} Active / {recent.length} Logged</span>
          </div>

          <div className="trips-audit-list">
            {active.length === 0 && (
              <div className="empty-trips-message">
                <span>🟢 All emergency corridors currently clear. No active trips.</span>
              </div>
            )}

            {active.map((trip) => {
              const tripAlerts = alerts.filter((a) => a.trip_id === trip.id);
              const tripBlocking = tripAlerts.filter((a) => a.is_blocking).length;
              return (
                <div
                  key={trip.id}
                  className="trip-audit-item active-audit"
                  onClick={() => onSelectTrip(trip.id)}
                >
                  <div className="trip-audit-header">
                    <span className="trip-code">🚑 Unit {trip.id.slice(0, 8)}</span>
                    <span className="badge-active">ACTIVE CORRIDOR</span>
                  </div>
                  <div className="trip-audit-metrics">
                    <div className="audit-metric">
                      <span className="metric-tag">Started</span>
                      <span className="metric-val">{formatTime(trip.started_at)}</span>
                    </div>
                    <div className="audit-metric">
                      <span className="metric-tag">Route Length</span>
                      <span className="metric-val">{trip.route_distance_m ? `${(trip.route_distance_m / 1000).toFixed(1)} km` : 'Calculating'}</span>
                    </div>
                    <div className="audit-metric">
                      <span className="metric-tag">Corridor Alerts</span>
                      <span className="metric-val text-amber">{tripAlerts.length}</span>
                    </div>
                    <div className="audit-metric">
                      <span className="metric-tag">Blocking Ahead</span>
                      <span className="metric-val text-red">{tripBlocking}</span>
                    </div>
                  </div>
                </div>
              );
            })}

            {recent.slice(0, 5).map((trip) => (
              <div key={trip.id} className="trip-audit-item closed-audit">
                <div className="trip-audit-header">
                  <span className="trip-code">🏁 Unit {trip.id.slice(0, 8)}</span>
                  <span className={trip.status === 'completed' ? 'badge-completed' : 'badge-expired'}>
                    {trip.status.toUpperCase()}
                  </span>
                </div>
                <div className="trip-audit-metrics">
                  <div className="audit-metric">
                    <span className="metric-tag">Started</span>
                    <span className="metric-val">{formatTime(trip.started_at)}</span>
                  </div>
                  <div className="audit-metric">
                    <span className="metric-tag">Ended</span>
                    <span className="metric-val">{trip.ended_at ? formatTime(trip.ended_at) : 'N/A'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Alerts Feed Table */}
      <div className="analytics-panel" style={{ marginTop: 16 }}>
        <div className="panel-title">
          <h3>Real-time Alert Transmission Log</h3>
          <span className="badge-pill">{alerts.length} Total Alerts In Database</span>
        </div>

        <div className="table-responsive">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Vehicle ID</th>
                <th>Trip ID</th>
                <th>Distance Ahead</th>
                <th>Classification</th>
                <th>Driver Status</th>
              </tr>
            </thead>
            <tbody>
              {alerts.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    No alerts registered yet. Run simulator or start a trip to observe live dispatches.
                  </td>
                </tr>
              ) : (
                alerts.slice(0, 15).map((alert) => (
                  <tr key={alert.id} className={alert.is_blocking ? 'row-blocking' : ''}>
                    <td className="mono">{formatTime(alert.created_at)}</td>
                    <td className="mono">{alert.user_id.slice(0, 8)}</td>
                    <td className="mono">{alert.trip_id.slice(0, 8)}</td>
                    <td>
                      {alert.distance_m != null ? (
                        <span className="dist-chip">{Math.round(alert.distance_m)}m</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {alert.is_blocking ? (
                        <span className="chip chip-blocking">🛑 BLOCKING</span>
                      ) : (
                        <span className="chip chip-active">⚠️ ON ROUTE</span>
                      )}
                    </td>
                    <td>
                      <span className={`chip chip-${alert.status}`}>
                        {alert.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
