import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  haversineDistance,
  polylineLength,
  pointAtDistance,
  nearestDistanceAlongRoute,
  lateralOffsetPoint,
} from './geo.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSIONS_FILE = path.join(__dirname, '.sessions.json');

// Parse CLI Arguments
const args = process.argv.slice(2);
let vehicleCount = 12;
let updateIntervalSec = 5;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--count' && args[i + 1]) {
    vehicleCount = parseInt(args[i + 1], 10) || 12;
  }
  if (args[i] === '--interval' && args[i + 1]) {
    updateIntervalSec = parseInt(args[i + 1], 10) || 5;
  }
}

// Environment validation
const {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  DISPATCHER_EMAIL,
  DISPATCHER_PASSWORD,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in .env');
  process.exit(1);
}

if (!DISPATCHER_EMAIL || !DISPATCHER_PASSWORD) {
  console.error('❌ Error: Missing DISPATCHER_EMAIL or DISPATCHER_PASSWORD in .env');
  process.exit(1);
}

// Dispatcher client to inspect trips
const dispatcherClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Load session cache
const loadSessionCache = () => {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch (e) {
    // Ignore read errors
  }
  return {};
};

const saveSessionCache = (cache) => {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not save session cache:', e.message);
  }
};

// Convert GeoJSON coordinates [[lng, lat], ...] to [[lat, lng], ...]
const geoJsonToLeaflet = (coords) => coords.map(([lng, lat]) => [lat, lng]);

async function main() {
  console.log(`\n======================================================`);
  console.log(`🚑 Emergency Path Clearing - Traffic Corridor Simulator`);
  console.log(`   Simulating ${vehicleCount} vehicles (Interval: ${updateIntervalSec}s)`);
  console.log(`======================================================\n`);

  // 1. Authenticate as dispatcher
  console.log(`Signing in as dispatcher (${DISPATCHER_EMAIL})...`);
  const { data: authData, error: authErr } = await dispatcherClient.auth.signInWithPassword({
    email: DISPATCHER_EMAIL,
    password: DISPATCHER_PASSWORD,
  });

  if (authErr) {
    console.error(`❌ Dispatcher authentication failed: ${authErr.message}`);
    process.exit(1);
  }

  // 2. Poll dashboard_snapshot for newest active trip
  console.log(`Querying active emergency trips...`);
  const { data: snapshot, error: snapErr } = await dispatcherClient.rpc('dashboard_snapshot');
  if (snapErr) {
    console.error(`❌ Failed to fetch dashboard_snapshot: ${snapErr.message}`);
    process.exit(1);
  }

  const activeTrip = snapshot?.trips?.find((t) => t.status === 'active');
  if (!activeTrip || !activeTrip.route?.coordinates) {
    console.error('\n❌ No active emergency trips found!');
    console.error('👉 Start a trip in the ambulance app first, then run this simulator.\n');
    process.exit(1);
  }

  const tripId = activeTrip.id;
  const routeCoords = geoJsonToLeaflet(activeTrip.route.coordinates);
  const totalRouteLenM = polylineLength(routeCoords);

  console.log(`✅ Found active trip: #${tripId.substring(0, 8)}`);
  console.log(`   Route length: ${(totalRouteLenM / 1000).toFixed(2)} km (${routeCoords.length} points)\n`);

  // 3. Generate Scenario Allocations
  // Proportions: ahead_moving 4/12, ahead_blocking 3/12, behind 2/12, opposite 1/12, off_route 2/12
  const scenariosList = [];
  const baseRatios = [
    { type: 'ahead_moving', expected: 'ALERT', weight: 4 },
    { type: 'ahead_blocking', expected: 'BLOCKING', weight: 3 },
    { type: 'behind', expected: 'NONE', weight: 2 },
    { type: 'opposite', expected: 'NONE', weight: 1 },
    { type: 'off_route', expected: 'NONE', weight: 2 },
  ];

  let assigned = 0;
  for (const item of baseRatios) {
    const count = Math.max(1, Math.round((item.weight / 12) * vehicleCount));
    for (let i = 0; i < count && assigned < vehicleCount; i++) {
      scenariosList.push({ scenario: item.type, expected: item.expected });
      assigned++;
    }
  }
  while (scenariosList.length < vehicleCount) {
    scenariosList.push({ scenario: 'ahead_moving', expected: 'ALERT' });
  }

  // 4. Initialize Simulated Citizens
  console.log(`Initializing ${vehicleCount} simulated citizen clients...`);
  const sessionCache = loadSessionCache();
  const vehicles = [];

  for (let i = 0; i < vehicleCount; i++) {
    const vClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const cacheKey = `sim_vehicle_${i}`;
    let session = sessionCache[cacheKey];
    let authed = false;

    if (session?.refresh_token) {
      const { error: setErr } = await vClient.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (!setErr) {
        const { data: userResp } = await vClient.auth.getUser();
        if (userResp?.user) authed = true;
      }
    }

    if (!authed) {
      const { data: anonData, error: anonErr } = await vClient.auth.signInAnonymously();
      if (anonErr) {
        console.error(`Failed anonymous sign-in for vehicle ${i}:`, anonErr.message);
        continue;
      }
      sessionCache[cacheKey] = {
        access_token: anonData.session.access_token,
        refresh_token: anonData.session.refresh_token,
      };
      session = anonData.session;
    }

    const { data: userData } = await vClient.auth.getUser();
    const userId = userData.user.id;

    // Determine initial offset/progress along route relative to ambulance
    const sc = scenariosList[i];
    let distanceAheadM = 0;
    let speedKmh = 0;
    let reverseHeading = false;
    let lateralOffsetM = 0;

    if (sc.scenario === 'ahead_moving') {
      distanceAheadM = 200 + (i * 150) % 700; // 200m - 850m
      speedKmh = 30 + (i * 3) % 15; // 30 - 45 km/h
    } else if (sc.scenario === 'ahead_blocking') {
      distanceAheadM = 150 + (i * 180) % 650; // 150m - 800m
      speedKmh = 0; // stationary -> blocking
    } else if (sc.scenario === 'behind') {
      distanceAheadM = -(100 + (i * 80) % 200); // 100m - 260m behind
      speedKmh = 35;
    } else if (sc.scenario === 'opposite') {
      distanceAheadM = 300 + (i * 100) % 400; // 300m - 700m ahead
      speedKmh = 35;
      reverseHeading = true; // heading reversed by 180 deg
    } else if (sc.scenario === 'off_route') {
      distanceAheadM = 250 + (i * 120) % 500;
      speedKmh = 35;
      lateralOffsetM = 150; // 150m lateral distance (outside 30m corridor)
    }

    vehicles.push({
      index: i + 1,
      userId,
      shortId: userId.substring(0, 6),
      client: vClient,
      scenario: sc.scenario,
      expected: sc.expected,
      distanceAheadM,
      speedKmh,
      reverseHeading,
      lateralOffsetM,
      currentDistAlongRoute: 0,
      currentPos: [0, 0],
      currentHeading: null,
      lastActual: 'NONE',
      lastDist: 0,
    });
  }

  saveSessionCache(sessionCache);
  console.log(`✅ All ${vehicles.length} vehicles authenticated.\n`);

  // Track ambulance current distance along route
  let ambDistAlongM = 0;

  // Poll ambulance position from snapshot every 3s
  const pollAmbulancePos = async () => {
    try {
      const { data: snap } = await dispatcherClient.rpc('dashboard_snapshot');
      const trip = snap?.trips?.find((t) => t.id === tripId);
      if (trip) {
        let aLat = trip.amb_lat;
        let aLng = trip.amb_lng;
        if (aLat != null && aLng != null) {
          const { distanceAlongM } = nearestDistanceAlongRoute(routeCoords, [aLat, aLng]);
          ambDistAlongM = distanceAlongM;
        }
      }
    } catch (e) {
      // Ignore transient errors
    }
  };

  const ambPollTimer = setInterval(pollAmbulancePos, 3000);
  await pollAmbulancePos();

  // 5. Update vehicle positions and report location
  const updateVehicles = async () => {
    for (const v of vehicles) {
      // Advance position along route
      if (v.speedKmh > 0) {
        const metersAdvanced = (v.speedKmh * 1000 / 3600) * updateIntervalSec;
        v.distanceAheadM += v.reverseHeading ? -metersAdvanced : metersAdvanced;
      }

      // Compute vehicle target distance along route
      const targetM = Math.max(0, Math.min(totalRouteLenM, ambDistAlongM + v.distanceAheadM));
      v.currentDistAlongRoute = targetM;

      let pos, head;
      if (v.lateralOffsetM > 0) {
        const res = lateralOffsetPoint(routeCoords, targetM, v.lateralOffsetM);
        pos = res.point;
        head = res.heading;
      } else {
        const res = pointAtDistance(routeCoords, targetM);
        pos = res.point;
        head = res.heading;
      }

      if (v.reverseHeading && head != null) {
        head = (head + 180) % 360;
      }

      v.currentPos = pos;
      v.currentHeading = v.speedKmh >= 3 ? head : null;

      // Call report_location RPC
      try {
        await v.client.rpc('report_location', {
          p_lat: pos[0],
          p_lng: pos[1],
          p_speed: v.speedKmh,
          p_heading: v.currentHeading,
        });
      } catch (e) {
        // Ignore individual reporting failure
      }
    }
  };

  // 6. Verification and status table printing every 5 seconds
  let passCount = 0;
  let totalEvaluations = 0;

  const printStatusTable = async () => {
    console.clear();
    console.log(`========================================================================================`);
    console.log(`🚑 SIMULATOR TELEMETRY MONITOR | Trip: #${tripId.substring(0, 8)} | Amb Pos: ${Math.round(ambDistAlongM)}m`);
    console.log(`========================================================================================`);
    console.log(
      `ID     | SCENARIO        | DIST AHEAD | EXPECTED  | ACTUAL       | VERDICT`
    );
    console.log(`----------------------------------------------------------------------------------------`);

    for (const v of vehicles) {
      // Read alert row for this user
      let actual = 'NONE';
      let alertDist = v.distanceAheadM;

      try {
        const { data: alerts } = await v.client
          .from('alerts')
          .select('id, distance_m, blocking, status')
          .eq('user_id', v.userId)
          .eq('trip_id', tripId)
          .in('status', ['active', 'acknowledged']);

        if (alerts && alerts.length > 0) {
          const alert = alerts[0];
          actual = alert.blocking ? 'BLOCKING' : 'ALERT';
          alertDist = Math.round(alert.distance_m);
        }
      } catch (e) {
        // Ignore read errors
      }

      v.lastActual = actual;
      v.lastDist = alertDist;

      const isPass = actual === v.expected;
      if (isPass) passCount++;
      totalEvaluations++;

      const passStr = isPass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      const distStr = `${Math.round(v.distanceAheadM)}m`.padEnd(10);
      const scenarioStr = v.scenario.padEnd(15);
      const expectedStr = v.expected.padEnd(9);
      const actualStr = actual.padEnd(12);

      console.log(
        `#${v.shortId} | ${scenarioStr} | ${distStr} | ${expectedStr} | ${actualStr} | ${passStr}`
      );
    }

    console.log(`----------------------------------------------------------------------------------------`);
    console.log(`Controls: Press Ctrl+C to stop simulation and clean up all test vehicle records.\n`);
  };

  // Run initial cycle
  await updateVehicles();
  await printStatusTable();

  const simInterval = setInterval(async () => {
    await updateVehicles();
    await printStatusTable();
  }, updateIntervalSec * 1000);

  // Graceful cleanup on Ctrl+C
  const cleanup = async () => {
    clearInterval(simInterval);
    clearInterval(ambPollTimer);
    console.log('\n\n🧹 Cleaning up simulated vehicle locations...');

    for (const v of vehicles) {
      try {
        await v.client.from('vehicle_locations').delete().eq('user_id', v.userId);
      } catch (e) {
        // Ignore delete errors
      }
    }

    console.log('\n======================================================');
    console.log('🏁 SIMULATION TEST SUMMARY');
    console.log('======================================================');
    let finalPass = 0;
    vehicles.forEach((v) => {
      const match = v.lastActual === v.expected;
      if (match) finalPass++;
      const res = match ? '✅ PASS' : '❌ FAIL';
      console.log(
        `Vehicle #${v.shortId} [${v.scenario}] -> Expected: ${v.expected}, Got: ${v.lastActual} [${res}]`
      );
    });

    console.log(`\nOverall Success Rate: ${finalPass}/${vehicles.length} (${Math.round((finalPass / vehicles.length) * 100)}%)`);
    console.log('Clean-up complete. Exiting.\n');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('Fatal simulator error:', err);
  process.exit(1);
});
