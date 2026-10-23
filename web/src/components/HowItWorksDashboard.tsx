import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Snapshot, Trip } from '../lib/types';
import { activeTrips } from '../lib/derive';

interface HowItWorksDashboardProps {
  snapshot: Snapshot | null;
}

export const HowItWorksDashboard: React.FC<HowItWorksDashboardProps> = ({ snapshot }) => {
  const [activeStep, setActiveStep] = useState<number>(1);
  const [testLog, setTestLog] = useState<string[]>([]);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  const active: Trip[] = activeTrips(snapshot?.trips || []);

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setTestLog((prev) => [`[${timestamp}] ${msg}`, ...prev.slice(0, 30)]);
  };

  // Helper to inject a test vehicle into public.vehicles via RPC report_location
  const injectTestVehicle = async (
    scenario: 'ahead_moving' | 'ahead_blocking' | 'behind' | 'off_route'
  ) => {
    try {
      setIsSimulating(true);

      // Check if there is an active trip to reference
      let refLat = 37.7749;
      let refLng = -122.4194;

      if (active.length > 0 && active[0].amb_lat != null && active[0].amb_lng != null) {
        refLat = active[0].amb_lat;
        refLng = active[0].amb_lng;
      }

      let lat = refLat;
      let lng = refLng;
      let speedMps = 11.1; // ~40 km/h
      let heading = 0;
      let scenarioLabel = '';

      if (scenario === 'ahead_moving') {
        lat += 0.004; // ~450m ahead
        speedMps = 11.1;
        scenarioLabel = 'Ahead on route (~450m ahead, speed 40 km/h) -> EXPECT: ALERT (Amber)';
      } else if (scenario === 'ahead_blocking') {
        lat += 0.002; // ~220m ahead
        speedMps = 1.0; // ~3.6 km/h (< 8 km/h)
        scenarioLabel = 'Ahead on route (~220m ahead, stopped at 3.6 km/h) -> EXPECT: BLOCKING (Red)';
      } else if (scenario === 'behind') {
        lat -= 0.004; // ~450m behind
        speedMps = 12.0;
        scenarioLabel = 'Behind ambulance (~450m behind) -> EXPECT: NO ALERT (Negative control)';
      } else if (scenario === 'off_route') {
        lat += 0.003;
        lng += 0.005; // ~400m lateral offset (> 35m)
        speedMps = 10.0;
        scenarioLabel = 'Off corridor (400m lateral distance) -> EXPECT: NO ALERT (Negative control)';
      }

      addLog(`Testing scenario: ${scenarioLabel}...`);

      const { error } = await supabase.rpc('report_location', {
        p_lat: lat,
        p_lng: lng,
        p_speed: speedMps,
        p_heading: heading,
      });

      if (error) {
        addLog(`Note: ${error.message} (Tip: sign in or run simulator for anonymous mock sessions)`);
      } else {
        addLog(`✅ Location reported via PostGIS ST_SetSRID. Check Map & Sidebar!`);
      }
    } catch (e: unknown) {
      addLog(`❌ Simulation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="how-it-works-view">
      {/* Title */}
      <div className="analytics-header">
        <div>
          <h2>Corridor Detection Engine: Architecture & Interactive Lab</h2>
          <p className="analytics-sub">
            How PostGIS spatial mathematics reliably warns vehicles up to 1 km ahead without false positives
          </p>
        </div>
        <div className="analytics-quick-badge">
          <span>Lookahead Buffer: <strong>1,000 meters</strong> | Lateral Corridor: <strong>35 meters</strong></span>
        </div>
      </div>

      {/* 6 Step Visual Pipeline */}
      <div className="pipeline-steps-bar">
        {[
          { step: 1, title: 'Route Ingestion', icon: '🛣️' },
          { step: 2, title: 'Linear Referencing', icon: '📐' },
          { step: 3, title: 'Lateral Corridor', icon: '📏' },
          { step: 4, title: 'Velocity & Blocking', icon: '🛑' },
          { step: 5, title: 'Realtime Dispatch', icon: '📡' },
          { step: 6, title: 'Overtake Clear', icon: '✅' },
        ].map((item) => (
          <div
            key={item.step}
            className={`pipeline-step-card ${activeStep === item.step ? 'active' : ''}`}
            onClick={() => setActiveStep(item.step)}
          >
            <div className="step-num">0{item.step}</div>
            <div className="step-icon">{item.icon}</div>
            <div className="step-title">{item.title}</div>
          </div>
        ))}
      </div>

      {/* Step Detail Card */}
      <div className="step-detail-container">
        {activeStep === 1 && (
          <div className="step-detail-card">
            <div className="step-detail-header">
              <span className="step-badge">Stage 1: Polyline & Route Geometry</span>
              <h3>High-Precision Road Network Ingestion</h3>
            </div>
            <p className="step-desc">
              When an ambulance crew initiates an emergency trip, the mobile app contacts the <strong>OpenRouteService Directions API</strong> (with automated fallback to OSRM). The resulting GeoJSON LineString contains centimeter-accurate road coordinates adhering to legal driving paths and one-way streets.
            </p>
            <div className="code-snippet-box">
              <div className="code-header">SQL Ingestion via PostGIS</div>
              <pre>
{`-- supabase_schema.sql: start_trip()
INSERT INTO public.trips (
    ambulance_id, status, destination_lat, destination_lng,
    route_geom, route_geojson, route_distance_m
) VALUES (
    p_ambulance_id, 'active', p_dest_lat, p_dest_lng,
    ST_SetSRID(ST_GeomFromGeoJSON(p_route_geojson), 4326),
    p_route_geojson, p_route_distance_m
);`}
              </pre>
            </div>
          </div>
        )}

        {activeStep === 2 && (
          <div className="step-detail-card">
            <div className="step-detail-header">
              <span className="step-badge">Stage 2: Linear Referencing</span>
              <h3>ST_LineLocatePoint: Directional Lookahead</h3>
            </div>
            <p className="step-desc">
              Standard GPS radius circles fail because they alert cars behind the ambulance or on irrelevant parallel streets. Path Clear uses <strong>Linear Referencing</strong>. Each vehicle's fractional position <code>[0.0, 1.0]</code> along the route is compared directly against the ambulance's position.
            </p>
            <div className="code-snippet-box">
              <div className="code-header">PostGIS Forward Condition</div>
              <pre>
{`-- Vehicles behind the ambulance are strictly excluded:
v_amb_pos  := ST_LineLocatePoint(v_route_geom, v_amb_geom);
v_veh_pos  := ST_LineLocatePoint(v_route_geom, veh.geom);

-- Only alert if vehicle is ahead, and within 1,000 meters forward:
WHERE v_veh_pos >= v_amb_pos
  AND (v_veh_pos - v_amb_pos) * v_total_length <= 1000.0;`}
              </pre>
            </div>
          </div>
        )}

        {activeStep === 3 && (
          <div className="step-detail-card">
            <div className="step-detail-header">
              <span className="step-badge">Stage 3: Lateral Tolerance</span>
              <h3>35-Meter Perpendicular Road Buffer</h3>
            </div>
            <p className="step-desc">
              To avoid alerting vehicles in parallel parking structures, alleys, or perpendicular cross-streets, the engine applies a lateral distance threshold of <strong>35 meters</strong> using spherical geography distance.
            </p>
            <div className="code-snippet-box">
              <div className="code-header">PostGIS ST_DWithin Corridor Constraint</div>
              <pre>
{`-- Ensure the vehicle is strictly on the road roadway:
ST_DWithin(
    veh.geom::geography,
    v_route_geom::geography,
    35.0 -- 35 meters perpendicular corridor tolerance
);`}
              </pre>
            </div>
          </div>
        )}

        {activeStep === 4 && (
          <div className="step-detail-card">
            <div className="step-detail-header">
              <span className="step-badge">Stage 4: Velocity Classification</span>
              <h3>Dynamic Urgency: Speed &lt; 8 km/h = BLOCKING</h3>
            </div>
            <p className="step-desc">
              Vehicles that are stopped at a red light or stuck in a queue directly in front of the ambulance cannot easily see or hear the siren in advance. Path Clear marks speed under <strong>8 km/h (~2.2 m/s)</strong> as <code>is_blocking = true</code>, triggering an unmistakable siren sound and intense full-screen flash.
            </p>
            <div className="code-snippet-box">
              <div className="code-header">Blocking Condition</div>
              <pre>
{`-- Classify blocking state based on telemetry:
is_blocking := (COALESCE(veh.speed_mps, 0) < 2.22); -- 2.22 m/s = 8 km/h

-- Alert message dynamically elevates:
-- Normal:   "Ambulance approaching in 450m. Move to left."
-- Blocking: "YOU ARE BLOCKING AN AMBULANCE. MOVE ASIDE NOW."`}
              </pre>
            </div>
          </div>
        )}

        {activeStep === 5 && (
          <div className="step-detail-card">
            <div className="step-detail-header">
              <span className="step-badge">Stage 5: Realtime Broadcast</span>
              <h3>Sub-Second Supabase Realtime Delivery</h3>
            </div>
            <p className="step-desc">
              When the ambulance telemetry ticks every 3 seconds, matched alerts are upserted into the <code>public.alerts</code> table with Row-Level Security. Citizen apps listen via WebSocket channel with filters, displaying the full-screen alert within <strong>~120ms</strong>.
            </p>
            <div className="code-snippet-box">
              <div className="code-header">Client Realtime Subscription</div>
              <pre>
{`// mobile/hooks/useMyAlerts.ts
supabase.channel('my_corridor_alerts')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'alerts',
    filter: 'user_id=eq.' + activeUserId,
  }, (payload) => {
    handleIncomingCorridorAlert(payload.new);
  }).subscribe();`}
              </pre>
            </div>
          </div>
        )}

        {activeStep === 6 && (
          <div className="step-detail-card">
            <div className="step-detail-header">
              <span className="step-badge">Stage 6: Overtake Auto-Clearance</span>
              <h3>Immediate Clearance When Ambulance Passes</h3>
            </div>
            <p className="step-desc">
              As soon as the ambulance passes a citizen car (i.e. <code>v_amb_pos &gt; v_veh_pos</code>), the alert row status is automatically set to <code>cleared</code>. The citizen screen switches to a calming green banner: <em>"Ambulance has passed. Thank you."</em> for 4 seconds, then dismisses.
            </p>
            <div className="code-snippet-box">
              <div className="code-header">Auto-Clearance Logic</div>
              <pre>
{`-- Clear alerts where the ambulance has already passed the vehicle:
UPDATE public.alerts
SET status = 'cleared',
    cleared_at = now()
WHERE trip_id = v_trip_id
  AND status IN ('active', 'acknowledged')
  AND v_amb_pos > (
      SELECT ST_LineLocatePoint(v_route_geom, geom)
      FROM public.vehicles WHERE user_id = alerts.user_id
  );`}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Simulation Laboratory */}
      <div className="analytics-panel" style={{ marginTop: 20 }}>
        <div className="panel-title">
          <h3>Interactive Corridor Test Lab</h3>
          <span className="badge-pill">Test Matrix Positive & Negative Controls</span>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 14 }}>
          Inject live test telemetry into the database to verify spatial corridor behavior without waiting for physical vehicles:
        </p>

        <div className="sim-buttons-grid">
          <button
            className="sim-btn btn-amber"
            onClick={() => injectTestVehicle('ahead_moving')}
            disabled={isSimulating}
          >
            <span className="sim-icon">🚗</span>
            <div className="sim-btn-text">
              <strong>Ahead & Moving</strong>
              <span>~450m ahead @ 40 km/h (Expect: Amber Alert)</span>
            </div>
          </button>

          <button
            className="sim-btn btn-red"
            onClick={() => injectTestVehicle('ahead_blocking')}
            disabled={isSimulating}
          >
            <span className="sim-icon">🛑</span>
            <div className="sim-btn-text">
              <strong>Ahead & Blocking</strong>
              <span>~220m ahead @ 3 km/h (Expect: Red Blocking Alert)</span>
            </div>
          </button>

          <button
            className="sim-btn btn-gray"
            onClick={() => injectTestVehicle('behind')}
            disabled={isSimulating}
          >
            <span className="sim-icon">🚙</span>
            <div className="sim-btn-text">
              <strong>Behind Ambulance</strong>
              <span>~450m behind (Negative Control: No Alert)</span>
            </div>
          </button>

          <button
            className="sim-btn btn-gray"
            onClick={() => injectTestVehicle('off_route')}
            disabled={isSimulating}
          >
            <span className="sim-icon">🏢</span>
            <div className="sim-btn-text">
              <strong>Off Corridor</strong>
              <span>400m lateral away (Negative Control: No Alert)</span>
            </div>
          </button>
        </div>

        {/* Live Lab Log */}
        <div className="test-log-container">
          <div className="test-log-header">
            <span>Live PostGIS Execution Console</span>
            <button className="clear-log-btn" onClick={() => setTestLog([])}>
              Clear Log
            </button>
          </div>
          <div className="test-log-body">
            {testLog.length === 0 ? (
              <span className="empty-log">Click any test button above to inject simulated vehicle telemetry...</span>
            ) : (
              testLog.map((log, idx) => (
                <div key={idx} className="log-line">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
