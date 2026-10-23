-- ==============================================================================
-- EMERGENCY PATH CLEARING - SUPABASE SCHEMA (001)
-- Requires extensions: postgis, pg_cron
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'citizen' CHECK (role IN ('citizen', 'ambulance', 'dispatcher')),
    push_token TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger to auto-create profile upon auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, role)
    VALUES (new.id, 'citizen')
    ON CONFLICT (id) DO NOTHING;
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Vehicle Locations Table
CREATE TABLE IF NOT EXISTS public.vehicle_locations (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    geom GEOMETRY(Point, 4326) NOT NULL,
    speed_kmh NUMERIC NOT NULL DEFAULT 0,
    heading NUMERIC,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_locations_geom_idx ON public.vehicle_locations USING GIST (geom);

-- 3. Trips Table
CREATE TABLE IF NOT EXISTS public.trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ambulance_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    route GEOMETRY(LineString, 4326) NOT NULL,
    amb_geom GEOMETRY(Point, 4326),
    amb_heading NUMERIC,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'expired')),
    last_tick_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trips_amb_geom_idx ON public.trips USING GIST (amb_geom);
CREATE INDEX IF NOT EXISTS trips_route_idx ON public.trips USING GIST (route);

-- 4. Alerts Table
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    distance_m NUMERIC NOT NULL,
    blocking BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'cleared')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_trip_user UNIQUE (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS alerts_user_id_idx ON public.alerts (user_id);
CREATE INDEX IF NOT EXISTS alerts_trip_id_idx ON public.alerts (trip_id);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
    FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "Dispatchers can read all profiles" ON public.profiles;
CREATE POLICY "Dispatchers can read all profiles" ON public.profiles
    FOR SELECT TO authenticated USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'dispatcher')
    );

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Vehicle Locations Policies
DROP POLICY IF EXISTS "Users can read/write own vehicle_location" ON public.vehicle_locations;
CREATE POLICY "Users can manage own vehicle_location" ON public.vehicle_locations
    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Dispatchers can read all vehicle_locations" ON public.vehicle_locations;
CREATE POLICY "Dispatchers can read all vehicle_locations" ON public.vehicle_locations
    FOR SELECT TO authenticated USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'dispatcher')
    );

-- Trips Policies
DROP POLICY IF EXISTS "Ambulance can manage own trips" ON public.trips;
CREATE POLICY "Ambulance can manage own trips" ON public.trips
    FOR ALL TO authenticated USING (ambulance_id = auth.uid()) WITH CHECK (ambulance_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can read active trips" ON public.trips;
CREATE POLICY "Authenticated users can read active trips" ON public.trips
    FOR SELECT TO authenticated USING (status = 'active');

DROP POLICY IF EXISTS "Dispatchers can read all trips" ON public.trips;
CREATE POLICY "Dispatchers can read all trips" ON public.trips
    FOR SELECT TO authenticated USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'dispatcher')
    );

-- Alerts Policies
DROP POLICY IF EXISTS "Users can read own alerts" ON public.alerts;
CREATE POLICY "Users can read own alerts" ON public.alerts
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own alert status" ON public.alerts;
CREATE POLICY "Users can update own alert status" ON public.alerts
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Ambulance can manage alerts for own trips" ON public.alerts;
CREATE POLICY "Ambulance can manage alerts for own trips" ON public.alerts
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.trips WHERE id = alerts.trip_id AND ambulance_id = auth.uid())
    );

DROP POLICY IF EXISTS "Dispatchers can read all alerts" ON public.alerts;
CREATE POLICY "Dispatchers can read all alerts" ON public.alerts
    FOR SELECT TO authenticated USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'dispatcher')
    );

-- Realtime publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'alerts'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trips'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
    END IF;
END $$;

-- ==============================================================================
-- RPCs
-- ==============================================================================

-- 1. report_location(p_lat, p_lng, p_speed, p_heading) -> void
CREATE OR REPLACE FUNCTION public.report_location(
    p_lat NUMERIC,
    p_lng NUMERIC,
    p_speed NUMERIC,
    p_heading NUMERIC DEFAULT NULL
)
RETURNS void AS $$
BEGIN
    INSERT INTO public.vehicle_locations (user_id, geom, speed_kmh, heading, updated_at)
    VALUES (
        auth.uid(),
        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
        COALESCE(p_speed, 0),
        p_heading,
        now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET geom = EXCLUDED.geom,
        speed_kmh = EXCLUDED.speed_kmh,
        heading = EXCLUDED.heading,
        updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. start_trip(p_route jsonb) -> uuid
CREATE OR REPLACE FUNCTION public.start_trip(p_route JSONB)
RETURNS UUID AS $$
DECLARE
    v_trip_id UUID;
    v_geom GEOMETRY;
BEGIN
    -- Cancel any previous active trip for this ambulance
    UPDATE public.trips
    SET status = 'cancelled'
    WHERE ambulance_id = auth.uid() AND status = 'active';

    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_route::text), 4326);

    INSERT INTO public.trips (ambulance_id, route, amb_geom, amb_heading, status, last_tick_at)
    VALUES (
        auth.uid(),
        v_geom,
        ST_StartPoint(v_geom),
        NULL,
        'active',
        now()
    )
    RETURNING id INTO v_trip_id;

    RETURN v_trip_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. my_active_trip() -> jsonb {id, route} or null
CREATE OR REPLACE FUNCTION public.my_active_trip()
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'id', id,
        'route', ST_AsGeoJSON(route)::jsonb
    )
    INTO v_result
    FROM public.trips
    WHERE ambulance_id = auth.uid()
      AND status = 'active'
      AND last_tick_at > now() - INTERVAL '3 minutes'
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. end_trip(p_trip uuid) -> void
CREATE OR REPLACE FUNCTION public.end_trip(p_trip UUID)
RETURNS void AS $$
BEGIN
    UPDATE public.trips
    SET status = 'completed'
    WHERE id = p_trip AND (ambulance_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'dispatcher'
    ));

    UPDATE public.alerts
    SET status = 'cleared'
    WHERE trip_id = p_trip AND status IN ('active', 'acknowledged');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. tick_ambulance(p_trip uuid, p_lat numeric, p_lng numeric, p_heading numeric) -> int
CREATE OR REPLACE FUNCTION public.tick_ambulance(
    p_trip UUID,
    p_lat NUMERIC,
    p_lng NUMERIC,
    p_heading NUMERIC DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_amb_geom GEOMETRY;
    v_route GEOMETRY;
    v_amb_loc NUMERIC;
    v_route_len_m NUMERIC;
    v_matched_count INTEGER := 0;
    v_matched_user_ids UUID[] := ARRAY[]::UUID[];
BEGIN
    -- Verify trip is active
    SELECT route INTO v_route
    FROM public.trips
    WHERE id = p_trip AND status = 'active';

    IF v_route IS NULL THEN
        RAISE EXCEPTION 'trip not found or not active';
    END IF;

    v_amb_geom := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
    v_amb_loc := ST_LineLocatePoint(v_route, v_amb_geom);
    v_route_len_m := ST_Length(v_route::geography);

    -- Update ambulance position on trip
    UPDATE public.trips
    SET amb_geom = v_amb_geom,
        amb_heading = p_heading,
        last_tick_at = now()
    WHERE id = p_trip;

    -- Match vehicles:
    -- 1) updated within last 2 minutes
    -- 2) within 30m lateral corridor of the route: ST_DWithin(route::geography, geom::geography, 30)
    -- 3) ahead of ambulance: vehicle location on route > amb location on route
    -- 4) up to 1000m ahead along route: (veh_loc - amb_loc) * route_len_m <= 1000
    -- 5) heading matching route direction (tolerance +-60 deg) or speed < 3 km/h
    WITH candidates AS (
        SELECT 
            vl.user_id,
            vl.geom,
            vl.speed_kmh,
            vl.heading,
            ST_LineLocatePoint(v_route, vl.geom) AS veh_loc,
            -- distance in meters along the route ahead of ambulance
            (ST_LineLocatePoint(v_route, vl.geom) - v_amb_loc) * v_route_len_m AS dist_ahead_m,
            (vl.speed_kmh < 8.0) AS is_blocking
        FROM public.vehicle_locations vl
        WHERE vl.updated_at > now() - INTERVAL '2 minutes'
          AND vl.user_id != auth.uid()
          AND ST_DWithin(v_route::geography, vl.geom::geography, 30)
    ),
    matched AS (
        SELECT 
            c.user_id,
            ROUND(c.dist_ahead_m) AS dist_ahead_m,
            c.is_blocking
        FROM candidates c
        WHERE c.veh_loc > v_amb_loc
          AND c.dist_ahead_m <= 1000
          AND (
              c.heading IS NULL
              OR c.speed_kmh < 3.0
              OR p_heading IS NULL
              -- Heading alignment within 60 degrees of ambulance heading or route bearing
              OR ABS(c.heading - p_heading) <= 60
              OR ABS(c.heading - p_heading) >= 300
          )
    )
    SELECT 
        COALESCE(array_agg(m.user_id), ARRAY[]::UUID[]),
        COUNT(*)
    INTO v_matched_user_ids, v_matched_count
    FROM matched m;

    -- Upsert alerts for matched vehicles
    INSERT INTO public.alerts (trip_id, user_id, distance_m, blocking, status, created_at)
    SELECT 
        p_trip,
        m.user_id,
        m.dist_ahead_m,
        m.is_blocking,
        'active',
        now()
    FROM matched m
    ON CONFLICT (trip_id, user_id) DO UPDATE
    SET distance_m = EXCLUDED.distance_m,
        blocking = EXCLUDED.blocking,
        -- if already acknowledged, keep acknowledged, otherwise set active
        status = CASE 
            WHEN public.alerts.status = 'acknowledged' THEN 'acknowledged'
            ELSE 'active'
        END;

    -- Clear alerts for vehicles previously alerted on this trip that are no longer matched (e.g. ambulance passed them)
    UPDATE public.alerts
    SET status = 'cleared'
    WHERE trip_id = p_trip
      AND status IN ('active', 'acknowledged')
      AND NOT (user_id = ANY(v_matched_user_ids));

    RETURN v_matched_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
