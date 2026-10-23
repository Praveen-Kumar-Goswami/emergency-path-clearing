# Emergency Path Clearing — Supabase Backend

Production-ready backend configuration, versioned migrations, TypeScript types, and automated verification tests for the Emergency Path Clearing system.

---

## 🛰️ Live Supabase Project

- **Project Ref**: `waiflujimowdlwxrilwd`
- **Project URL**: `https://waiflujimowdlwxrilwd.supabase.co`
- **Publishable Key (Anon)**: Configured in `web/.env`, `mobile/.env`, and `tools/simulator/.env`

---

## 📁 Directory Structure

```
supabase/
├── config.toml                 # Official Supabase CLI local / remote configuration
├── migrations/
│   ├── 20261023073120_enable_extensions.sql       # postgis, uuid-ossp, pg_cron
│   ├── 20261023073500_create_schema_and_policies.sql # Core tables, RLS, spatial RPCs
│   ├── 20261023074000_dashboard_and_cron.sql      # dashboard_snapshot & auto-expiry
│   └── 20261023080500_harden_functions_search_path.sql # Security definer hardening
├── types/
│   └── database.types.ts       # Generated TypeScript database types
├── seed.sql                    # Development accounts and test data
├── test_connection.mjs         # Automated end-to-end connection & RPC test script
├── package.json                # CLI runner scripts and dependencies
├── supabase_schema.sql         # Consolidated initial reference SQL
└── 002_dashboard.sql           # Consolidated migration 002 reference SQL
```

---

## 🗄️ Database Architecture

### 1. Extensions
- **`postgis`**: Powers all spatial calculations (`ST_DWithin`, `ST_Buffer`, `ST_LineLocatePoint`, `ST_Distance`).
- **`uuid-ossp`**: UUID primary key generation (`gen_random_uuid()`).
- **`pg_cron`**: Scheduled background worker for auto-expiring stale trips (`* * * * *`).

### 2. Core Tables & RLS Policies
| Table | Description | RLS Policy Summary |
|---|---|---|
| `public.profiles` | User profiles with `role` (`citizen`, `ambulance`, `dispatcher`) | Users read/update own; Dispatchers read all via `public.is_dispatcher()`. |
| `public.vehicle_locations` | Foreground GPS telemetry with PostGIS point `geom` and GIST index | Users manage own location; Dispatchers read all. |
| `public.trips` | Active ambulance trips with route `LineString`, current `amb_geom`, heading | Ambulance manages own; Authenticated reads active; Dispatcher reads all. |
| `public.alerts` | Corridor alerts with `distance_m`, `blocking`, `status` | Users read/acknowledge own alerts; Dispatchers read all. |

### 3. Spatial RPCs
- **`report_location(p_lat, p_lng, p_speed, p_heading)`**: Upserts caller vehicle GPS into `public.vehicle_locations`.
- **`start_trip(p_route)`**: Cancels existing active trips for the ambulance and starts a new trip with route geometry.
- **`my_active_trip()`**: Fetches the currently active trip for the logged-in ambulance.
- **`end_trip(p_trip)`**: Marks trip completed and clears all associated alerts.
- **`tick_ambulance(p_trip, p_lat, p_lng, p_heading)`**:
  - Updates ambulance position and heading.
  - Generates a 30m corridor buffer along the route.
  - Queries vehicles within 1200m ahead along the line.
  - Filters vehicles whose heading aligns with the ambulance (within ±90°).
  - Fires or clears alerts, flagging `blocking = true` if speed < 10 km/h or distance < 250m.
- **`dashboard_snapshot()`**: Consolidates trips, vehicles online in the last 2 minutes, and active alerts into a single atomic JSON payload for dispatchers.
- **`expire_stale_trips()`**: Marks trips expired if no tick was received in > 3 minutes and clears orphan alerts.

---

## 🧪 Testing Connection & RPCs

Run the verification test script:

```bash
cd supabase
npm run test:connection
```

This verifies:
1. Dispatcher login (`dispatcher1@gmail.com`)
2. `dashboard_snapshot()` RPC execution
3. Ambulance login (`ambulance1@gmail.com`)
4. `my_active_trip()` RPC execution

---

## 🛠️ CLI Commands

```bash
# Start local Supabase Docker stack
npm run db:start

# Check status of local services
npm run db:status

# Push migrations to database
npm run db:push

# Re-generate TypeScript definitions
npm run typegen

# Stop local Supabase
npm run db:stop
```

---

## 🔑 Pre-Configured Test Accounts

| Role | Email | Password |
|---|---|---|
| Dispatcher | `dispatcher1@gmail.com` | `password123` |
| Ambulance | `ambulance1@gmail.com` | `password123` |
| Citizen | Anonymous Sign-in (or any email) | - |
