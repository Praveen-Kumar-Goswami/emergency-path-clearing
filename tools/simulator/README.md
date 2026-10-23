# Traffic Corridor Simulator Tool

Node.js (18+, ESM) automated test simulation script for the **Emergency Path Clearing** corridor verification system.

## Overview
Generates simulated civilian vehicles with varied spatial, velocity, and orientation profiles to rigorously test positive and negative control logic:
- `ahead_moving`: 200–900m ahead along route, moving 25–40 km/h with matching heading. **Expected: ALERT**
- `ahead_blocking`: 100–800m ahead along route, stationary (< 8 km/h). **Expected: BLOCKING ALERT**
- `behind`: 100–300m behind the ambulance. **Expected: NO ALERT**
- `opposite`: 300m ahead on route with reversed heading (bearing + 180°). **Expected: NO ALERT**
- `off_route`: 150m laterally away from route (> 30m corridor). **Expected: NO ALERT**

## Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Fill in your Supabase credentials:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `DISPATCHER_EMAIL`
   - `DISPATCHER_PASSWORD`

3. Install dependencies:
   ```bash
   npm install
   ```

## Usage

Start an emergency trip in the Ambulance app first, then launch:
```bash
node simulate.mjs
```

### CLI Options
- `--count <N>`: Total vehicles to simulate (default: 12).
- `--interval <sec>`: Location update interval in seconds (default: 5).

Example:
```bash
node simulate.mjs --count 16 --interval 3
```

Press `Ctrl+C` at any time to automatically clean up all simulated vehicle locations from the database and print the PASS/FAIL test summary.
