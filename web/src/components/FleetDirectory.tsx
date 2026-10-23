import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Snapshot, Trip, Vehicle } from '../lib/types';
import { activeTrips } from '../lib/derive';

interface ProfileRecord {
  id: string;
  role: 'dispatcher' | 'ambulance' | 'citizen';
  full_name?: string | null;
  badge_id?: string | null;
  created_at: string;
}

interface FleetDirectoryProps {
  snapshot: Snapshot | null;
  onFocusVehicle?: (pos: [number, number]) => void;
}

export const FleetDirectory: React.FC<FleetDirectoryProps> = ({ snapshot, onFocusVehicle }) => {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const active: Trip[] = activeTrips(snapshot?.trips || []);
  const vehicles: Vehicle[] = snapshot?.vehicles || [];

  const fetchProfiles = useCallback(async (showLoadingSpinner = false) => {
    if (showLoadingSpinner) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setProfiles(data as unknown as ProfileRecord[]);
      }
    } catch (e) {
      console.warn('Could not load profiles:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void fetchProfiles(false);
  }, [fetchProfiles]);

  const filteredProfiles = profiles.filter((p) => {
    if (roleFilter !== 'all' && p.role !== roleFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = p.full_name?.toLowerCase().includes(q);
      const matchBadge = p.badge_id?.toLowerCase().includes(q);
      const matchId = p.id.toLowerCase().includes(q);
      return matchName || matchBadge || matchId;
    }
    return true;
  });

  return (
    <div className="fleet-view">
      <div className="analytics-header">
        <div>
          <h2>Emergency Fleet & Personnel Directory</h2>
          <p className="analytics-sub">
            Registered dispatchers, ambulance units, and real-time connected vehicles
          </p>
        </div>
        <button className="btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => void fetchProfiles(true)}>
          🔄 Refresh Directory
        </button>
      </div>

      {/* Overview Cards */}
      <div className="kpi-grid">
        <div className="kpi-card blue-glow">
          <div className="kpi-label">Active Emergency Units</div>
          <div className="kpi-value text-blue">{active.length}</div>
          <div className="kpi-sub">Ambulances with active route corridor</div>
        </div>

        <div className="kpi-card amber-glow">
          <div className="kpi-label">Connected Vehicles</div>
          <div className="kpi-value text-amber">{vehicles.length}</div>
          <div className="kpi-sub">Transmitting live GPS telemetry</div>
        </div>

        <div className="kpi-card green-glow">
          <div className="kpi-label">Dispatch Personnel</div>
          <div className="kpi-value text-green">
            {profiles.filter((p) => p.role === 'dispatcher').length}
          </div>
          <div className="kpi-sub">Authorized dispatch console operators</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Ambulance Operators</div>
          <div className="kpi-value">
            {profiles.filter((p) => p.role === 'ambulance').length}
          </div>
          <div className="kpi-sub">Registered mobile emergency crews</div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="directory-controls">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search by name, badge ID, or User ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="filter-pills">
          {['all', 'dispatcher', 'ambulance', 'citizen'].map((r) => (
            <button
              key={r}
              className={`filter-pill ${roleFilter === r ? 'active' : ''}`}
              onClick={() => setRoleFilter(r)}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Directory Table */}
      <div className="analytics-panel">
        <div className="panel-title">
          <h3>Registered System Profiles</h3>
          <span className="badge-pill">{filteredProfiles.length} Profiles</span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
            Loading personnel directory...
          </div>
        ) : (
          <div className="table-responsive">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Full Name</th>
                  <th>Badge / Unit</th>
                  <th>User ID</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                      No profiles match the selected filter.
                    </td>
                  </tr>
                ) : (
                  filteredProfiles.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className={`chip chip-role-${p.role}`}>
                          {p.role === 'dispatcher' ? '🖥️ DISPATCHER' : p.role === 'ambulance' ? '🚑 AMBULANCE' : '🚗 CITIZEN'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{p.full_name || '—'}</td>
                      <td className="mono">{p.badge_id || '—'}</td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.id}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {new Date(p.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Live Connected Vehicles Stream */}
      <div className="analytics-panel" style={{ marginTop: 16 }}>
        <div className="panel-title">
          <h3>Live Telemetry Vehicles ({vehicles.length})</h3>
          <span className="badge-pill">In-Memory PostGIS Buffer</span>
        </div>

        <div className="table-responsive">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Vehicle / User ID</th>
                <th>Speed (km/h)</th>
                <th>Heading</th>
                <th>Coordinates (Lat, Lng)</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    No connected vehicles currently reporting. Start simulator or citizen app to stream positions.
                  </td>
                </tr>
              ) : (
                vehicles.map((v: Vehicle) => {
                  const speedKmh = Math.round(v.speed_kmh);
                  return (
                    <tr key={v.user_id}>
                      <td className="mono">🚗 {v.user_id.slice(0, 12)}</td>
                      <td>
                        <span className={`chip ${speedKmh < 8 ? 'chip-blocking' : 'chip-ack'}`}>
                          {speedKmh} km/h
                        </span>
                      </td>
                      <td className="mono">{v.heading != null ? `${Math.round(v.heading)}°` : '—'}</td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {v.lat.toFixed(5)}, {v.lng.toFixed(5)}
                      </td>
                      <td>
                        {onFocusVehicle && (
                          <button
                            className="btn-secondary"
                            style={{ padding: '3px 10px', fontSize: 11, width: 'auto' }}
                            onClick={() => onFocusVehicle([v.lat, v.lng])}
                          >
                            🎯 View on Map
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
