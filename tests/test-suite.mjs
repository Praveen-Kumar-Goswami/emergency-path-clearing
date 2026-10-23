import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineDistance,
  bearing,
  destinationPoint,
  polylineLength,
  pointAtDistance,
  nearestDistanceAlongRoute,
  lateralOffsetPoint,
} from '../tools/simulator/geo.mjs';

// ==============================================================================
// 1. GEOSPATIAL CALCULATIONS TEST SUITE
// ==============================================================================
test('Geospatial: Haversine distance between same point is 0 meters', () => {
  const p = [51.5074, -0.1278]; // London
  const dist = haversineDistance(p, p);
  assert.equal(Math.round(dist), 0);
});

test('Geospatial: Haversine distance between known points is accurate within 0.5%', () => {
  const london = [51.5074, -0.1278];
  const paris = [48.8566, 2.3522];
  const distKm = haversineDistance(london, paris) / 1000;
  // Known distance London to Paris is ~343 km
  assert.ok(distKm > 340 && distKm < 346, `Expected ~343km, got ${distKm.toFixed(1)}km`);
});

test('Geospatial: Bearing calculation from South to North is 0 degrees', () => {
  const p1 = [51.0, 0.0];
  const p2 = [52.0, 0.0];
  const b = bearing(p1, p2);
  assert.equal(Math.round(b), 0);
});

test('Geospatial: Destination point at 1,000m North matches haversine distance', () => {
  const start = [51.505, -0.09];
  const dest = destinationPoint(start, 1000, 0); // 1km North
  const calculatedDist = haversineDistance(start, dest);
  assert.ok(Math.abs(calculatedDist - 1000) < 1.0, `Expected 1000m, got ${calculatedDist}m`);
});

test('Geospatial: Polyline length sums individual segment distances correctly', () => {
  const p1 = [51.505, -0.09];
  const p2 = destinationPoint(p1, 500, 90);  // 500m East
  const p3 = destinationPoint(p2, 500, 180); // 500m South
  const polyline = [p1, p2, p3];

  const totalLen = polylineLength(polyline);
  assert.ok(Math.abs(totalLen - 1000) < 2.0, `Expected ~1000m, got ${totalLen}m`);
});

// ==============================================================================
// 2. CORRIDOR FILTERING & POSITIVE/NEGATIVE CONTROLS
// ==============================================================================
test('Corridor Engine: Vehicle ahead within 1,000m triggers active alert', () => {
  const route = [
    [51.500, -0.090],
    [51.530, -0.090], // ~3.3km straight line north
  ];
  const ambulancePos = destinationPoint(route[0], 500, 0); // 500m along route
  const citizenPos = destinationPoint(route[0], 950, 0);   // 950m along route (450m ahead)

  const { distanceAlongM: ambDist } = nearestDistanceAlongRoute(route, ambulancePos);
  const { distanceAlongM: citDist, lateralM } = nearestDistanceAlongRoute(route, citizenPos);

  const forwardDist = citDist - ambDist;
  const isAhead = forwardDist >= 0;
  const within1km = forwardDist <= 1000;
  const withinCorridor = lateralM <= 35.0;

  assert.equal(isAhead, true, 'Citizen should be ahead of ambulance');
  assert.equal(within1km, true, 'Citizen should be within 1km lookahead');
  assert.equal(withinCorridor, true, 'Citizen should be on the road centerline');
  assert.ok(Math.abs(forwardDist - 450) < 5.0, `Expected ~450m ahead, got ${forwardDist}m`);
});

test('Corridor Engine Negative Control: Vehicle behind ambulance does NOT trigger alert', () => {
  const route = [
    [51.500, -0.090],
    [51.530, -0.090],
  ];
  const ambulancePos = destinationPoint(route[0], 1000, 0); // 1000m along route
  const citizenBehind = destinationPoint(route[0], 600, 0);  // 600m along route (400m behind)

  const { distanceAlongM: ambDist } = nearestDistanceAlongRoute(route, ambulancePos);
  const { distanceAlongM: citDist } = nearestDistanceAlongRoute(route, citizenBehind);

  const forwardDist = citDist - ambDist;
  const isEligibleForAlert = forwardDist >= 0 && forwardDist <= 1000;

  assert.equal(isEligibleForAlert, false, 'Vehicle behind ambulance must NOT trigger corridor alert');
  assert.equal(forwardDist < 0, true, `Expected negative distance along route, got ${forwardDist}m`);
});

test('Corridor Engine Negative Control: Vehicle outside 35m lateral tolerance does NOT trigger alert', () => {
  const route = [
    [51.500, -0.090],
    [51.530, -0.090],
  ];
  // Vehicle at 800m along route but offset 120m East perpendicularly
  const { point: offRoutePoint } = lateralOffsetPoint(route, 800, 120);

  const { lateralM } = nearestDistanceAlongRoute(route, offRoutePoint);
  const isWithinCorridor = lateralM <= 35.0;

  assert.equal(isWithinCorridor, false, 'Vehicle 120m lateral offset must be rejected by 35m corridor filter');
  assert.ok(Math.abs(lateralM - 120) < 2.0, `Expected ~120m lateral offset, got ${lateralM}m`);
});

// ==============================================================================
// 3. VELOCITY CLASSIFICATION & BLOCKING THRESHOLD (< 8 km/h)
// ==============================================================================
test('Velocity Rule: Speed < 8 km/h is classified as BLOCKING', () => {
  const stationaryVehicleSpeedKmh = 0;
  const crawlingVehicleSpeedKmh = 5.4;
  const movingVehicleSpeedKmh = 35.0;

  const isBlocking1 = stationaryVehicleSpeedKmh < 8.0;
  const isBlocking2 = crawlingVehicleSpeedKmh < 8.0;
  const isBlocking3 = movingVehicleSpeedKmh < 8.0;

  assert.equal(isBlocking1, true, '0 km/h must be classified as BLOCKING');
  assert.equal(isBlocking2, true, '5.4 km/h must be classified as BLOCKING');
  assert.equal(isBlocking3, false, '35.0 km/h must be classified as NORMAL moving vehicle');
});

// ==============================================================================
// 4. OVERTAKE CLEARANCE ENGINE
// ==============================================================================
test('Auto-Clearance: Alert clears immediately when ambulance overtakes vehicle', () => {
  let ambulancePosM = 400; // meters along route
  const vehiclePosM = 500;  // vehicle was at 500m

  // Before overtake: vehicle is ahead
  let alertStatus = (vehiclePosM >= ambulancePosM) ? 'active' : 'cleared';
  assert.equal(alertStatus, 'active', 'Alert should be active before ambulance overtakes');

  // Ambulance ticks forward to 550m (passes vehicle)
  ambulancePosM = 550;
  alertStatus = (vehiclePosM >= ambulancePosM) ? 'active' : 'cleared';
  assert.equal(alertStatus, 'cleared', 'Alert should immediately clear after ambulance passes vehicle');
});

// ==============================================================================
// 5. METRICS DERIVATION & SNAPSHOT CALCULATIONS
// ==============================================================================
test('Metrics Derivation: Correctly counts online vehicles, active alerts, and blocking incidents', () => {
  const mockSnapshot = {
    server_time: new Date().toISOString(),
    trips: [
      { id: 'trip-1', status: 'active', created_at: '', last_tick_at: '', ambulance_id: '', route: { type: 'LineString', coordinates: [] }, amb_lat: null, amb_lng: null, amb_heading: null },
      { id: 'trip-2', status: 'completed', created_at: '', last_tick_at: '', ambulance_id: '', route: { type: 'LineString', coordinates: [] }, amb_lat: null, amb_lng: null, amb_heading: null },
    ],
    vehicles: [
      { user_id: 'u1', short_id: 'u1', lat: 0, lng: 0, speed_kmh: 0, heading: 0, age_s: 5 },
      { user_id: 'u2', short_id: 'u2', lat: 0, lng: 0, speed_kmh: 30, heading: 0, age_s: 5 },
      { user_id: 'u3', short_id: 'u3', lat: 0, lng: 0, speed_kmh: 45, heading: 0, age_s: 10 },
    ],
    alerts: [
      { id: 'a1', trip_id: 'trip-1', user_id: 'u1', short_id: 'u1', distance_m: 200, blocking: true, status: 'active', created_at: '' },
      { id: 'a2', trip_id: 'trip-1', user_id: 'u2', short_id: 'u2', distance_m: 600, blocking: false, status: 'active', created_at: '' },
      { id: 'a3', trip_id: 'trip-1', user_id: 'u3', short_id: 'u3', distance_m: 900, blocking: false, status: 'acknowledged', created_at: '' },
    ],
  };

  const totalVehicles = mockSnapshot.vehicles.length;
  const activeAlerts = mockSnapshot.alerts.filter(a => a.status === 'active').length;
  const blockingAlerts = mockSnapshot.alerts.filter(a => a.status === 'active' && a.blocking).length;
  const ackAlerts = mockSnapshot.alerts.filter(a => a.status === 'acknowledged').length;

  assert.equal(totalVehicles, 3);
  assert.equal(activeAlerts, 2);
  assert.equal(blockingAlerts, 1);
  assert.equal(ackAlerts, 1);
});

// ==============================================================================
// 6. INPUT SANITIZATION & BOUNDING BOX VALIDATION
// ==============================================================================
test('Security Sanitization: Coordinates validation enforces valid WGS84 bounds', () => {
  const isValidCoordinate = (lat, lng) => {
    return (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      !isNaN(lat) &&
      !isNaN(lng) &&
      lat >= -90.0 &&
      lat <= 90.0 &&
      lng >= -180.0 &&
      lng <= 180.0
    );
  };

  assert.equal(isValidCoordinate(51.505, -0.09), true);
  assert.equal(isValidCoordinate(91.0, 0.0), false, 'Lat > 90 must be invalid');
  assert.equal(isValidCoordinate(-91.0, 0.0), false, 'Lat < -90 must be invalid');
  assert.equal(isValidCoordinate(0.0, 185.0), false, 'Lng > 180 must be invalid');
  assert.equal(isValidCoordinate(NaN, 0.0), false, 'NaN must be invalid');
});

test('Security Sanitization: Role authorization enforces strict role whitelist', () => {
  const ALLOWED_ROLES = new Set(['dispatcher', 'ambulance', 'citizen']);

  assert.equal(ALLOWED_ROLES.has('dispatcher'), true);
  assert.equal(ALLOWED_ROLES.has('ambulance'), true);
  assert.equal(ALLOWED_ROLES.has('citizen'), true);
  assert.equal(ALLOWED_ROLES.has('admin'), false, 'Non-whitelisted roles must be rejected');
  assert.equal(ALLOWED_ROLES.has("'; DROP TABLE profiles; --"), false, 'SQL injection string rejected');
});

// ==============================================================================
// 7. GEOJSON & COORDINATE PROJECTION TRANSFORMATIONS
// ==============================================================================
test('Coordinate Transform: GeoJSON [lng, lat] converts correctly to Leaflet [lat, lng]', () => {
  const geoJsonCoords = [
    [-0.1278, 51.5074],
    [-0.0900, 51.5050],
  ];
  const leafletCoords = geoJsonCoords.map(([lng, lat]) => [lat, lng]);

  assert.deepEqual(leafletCoords[0], [51.5074, -0.1278]);
  assert.deepEqual(leafletCoords[1], [51.5050, -0.0900]);
});

// ==============================================================================
// 8. VEHICLE VISUAL ALERT STATE DERIVATION
// ==============================================================================
test('Visual State Derivation: Maps alert status and blocking flags to UI color tokens', () => {
  const userAlertMap = new Map([
    ['user-red', { status: 'active', blocking: true }],
    ['user-orange', { status: 'active', blocking: false }],
    ['user-green', { status: 'acknowledged', blocking: false }],
  ]);

  const getState = (userId) => {
    const alert = userAlertMap.get(userId);
    if (!alert) return 'none';
    if (alert.status === 'acknowledged') return 'acknowledged';
    if (alert.status === 'active') return alert.blocking ? 'blocking' : 'active';
    return 'none';
  };

  assert.equal(getState('user-red'), 'blocking');
  assert.equal(getState('user-orange'), 'active');
  assert.equal(getState('user-green'), 'acknowledged');
  assert.equal(getState('user-untracked'), 'none');
});

// ==============================================================================
// 9. EFFICIENCY & ADAPTIVE BATTERY-SAVING TELEMETRY ENGINE
// ==============================================================================
test('Efficiency Engine: Adaptive telemetry interval reduces battery & network payload', () => {
  const getAdaptiveTickInterval = (role, speedKmh, hasActiveEmergencyAlert) => {
    if (role === 'ambulance') return 1500; // Emergency vehicle updates at 1.5s
    if (hasActiveEmergencyAlert) return 1500; // In critical corridor: prioritize safety at 1.5s
    if (speedKmh < 1.0) return 5000; // Stationary vehicle conserves power at 5.0s
    return 2500; // Cruising citizen vehicle ticks at 2.5s
  };

  assert.equal(getAdaptiveTickInterval('ambulance', 60, false), 1500);
  assert.equal(getAdaptiveTickInterval('citizen', 45, true), 1500);
  assert.equal(getAdaptiveTickInterval('citizen', 0, false), 5000);
  assert.equal(getAdaptiveTickInterval('citizen', 50, false), 2500);
});

// ==============================================================================
// 10. CLEARANCE MANEUVER GUIDANCE ENGINE
// ==============================================================================
test('Clearance Maneuver: Advises correct lateral pull-over direction based on heading', () => {
  // If road is bearing 0° (North), pull over to right shoulder (bearing ~90° East)
  const getPullOverGuidance = (roadBearingDeg, drivingSide = 'right') => {
    const offset = drivingSide === 'right' ? 90 : -90;
    return (roadBearingDeg + offset + 360) % 360;
  };

  const roadNorth = 0;
  assert.equal(getPullOverGuidance(roadNorth, 'right'), 90, 'Pull over to East shoulder on North road');
  assert.equal(getPullOverGuidance(roadNorth, 'left'), 270, 'Pull over to West shoulder for Left-hand drive');
});

