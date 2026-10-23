-- ==============================================================================
-- 002: CORE SCHEMA, RLS POLICIES & SPATIAL RPCS
-- ==============================================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Helper function to break RLS recursion on public.profiles
CREATE OR REPLACE FUNCTION public.is_dispatcher()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'dispatcher'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

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

-- Enable Row Level Security
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
    FOR SELECT TO authenticated USING (public.is_dispatcher());

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Vehicle Locations Policies
DROP POLICY IF EXISTS "Users can manage own vehicle_location" ON public.vehicle_locations;
CREATE POLICY "Users can manage own vehicle_location" ON public.vehicle_locations
    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Dispatchers can read all vehicle_locations" ON public.vehicle_locations;
CREATE POLICY "Dispatchers can read all vehicle_locations" ON public.vehicle_locations
    FOR SELECT TO authenticated USING (public.is_dispatcher());

-- Trips Policies
DROP POLICY IF EXISTS "Ambulance can manage own trips" ON public.trips;
CREATE POLICY "Ambulance can manage own trips" ON public.trips
    FOR ALL TO authenticated USING (auth.uid() = ambulance_id) WITH CHECK (auth.uid() = ambulance_id);

DROP POLICY IF EXISTS "Anyone authenticated can read active trips" ON public.trips;
CREATE POLICY "Anyone authenticated can read active trips" ON public.trips
    FOR SELECT TO authenticated USING (status = 'active');

DROP POLICY IF EXISTS "Dispatchers can view all trips" ON public.trips;
CREATE POLICY "Dispatchers can view all trips" ON public.trips
    FOR SELECT TO authenticated USING (public.is_dispatcher());

-- Alerts Policies
DROP POLICY IF EXISTS "Users can view and acknowledge own alerts" ON public.alerts;
CREATE POLICY "Users can view and acknowledge own alerts" ON public.alerts
    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Dispatchers can read all alerts" ON public.alerts;
CREATE POLICY "Dispatchers can read all alerts" ON public.alerts
    FOR SELECT TO authenticated USING (public.is_dispatcher());

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

-- 5. RPC Functions
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
        p_speed,
        p_heading,
        now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        geom = EXCLUDED.geom,
        speed_kmh = EXCLUDED.speed_kmh,
        heading = EXCLUDED.heading,
        updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.start_trip(p_route JSONB)
RETURNS UUID AS $$
DECLARE
    v_trip_id UUID;
    v_first_point GEOMETRY;
    v_is_ambulance BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'ambulance'
    ) INTO v_is_ambulance;

    IF NOT v_is_ambulance THEN
        RAISE EXCEPTION 'Only users with ambulance role can start a trip';
    END IF;

    UPDATE public.trips
    SET status = 'cancelled'
    WHERE ambulance_id = auth.uid() AND status = 'active';

    v_first_point := ST_PointN(ST_GeomFromGeoJSON(p_route::text), 1);

    INSERT INTO public.trips (ambulance_id, route, amb_geom, status, last_tick_at)
    VALUES (
        auth.uid(),
        ST_SetSRID(ST_GeomFromGeoJSON(p_route::text), 4326),
        ST_SetSRID(v_first_point, 4326),
        'active',
        now()
    )
    RETURNING id INTO v_trip_id;

    RETURN v_trip_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.my_active_trip()
RETURNS JSONB AS $$
DECLARE
    v_trip RECORD;
BEGIN
    SELECT id, status, created_at, last_tick_at,
           ST_AsGeoJSON(route)::jsonb AS route_geojson,
           ST_Y(amb_geom) AS amb_lat,
           ST_X(amb_geom) AS amb_lng,
           amb_heading
    INTO v_trip
    FROM public.trips
    WHERE ambulance_id = auth.uid() AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_trip.id IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'id', v_trip.id,
        'status', v_trip.status,
        'created_at', v_trip.created_at,
        'last_tick_at', v_trip.last_tick_at,
        'route', v_trip.route_geojson,
        'amb_lat', v_trip.amb_lat,
        'amb_lng', v_trip.amb_lng,
        'amb_heading', v_trip.amb_heading
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.end_trip(p_trip UUID)
RETURNS void AS $$
BEGIN
    UPDATE public.trips
    SET status = 'completed'
    WHERE id = p_trip AND ambulance_id = auth.uid();

    UPDATE public.alerts
    SET status = 'cleared'
    WHERE trip_id = p_trip;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.tick_ambulance(
    p_trip UUID,
    p_lat NUMERIC,
    p_lng NUMERIC,
    p_heading NUMERIC DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_amb_point GEOMETRY;
    v_route GEOMETRY;
    v_corridor GEOMETRY;
    v_loc_record RECORD;
    v_dist_along_amb NUMERIC;
    v_dist_along_veh NUMERIC;
    v_distance_to_amb NUMERIC;
    v_heading_diff NUMERIC;
    v_heading_match BOOLEAN;
    v_is_blocking BOOLEAN;
    v_alerts_count INTEGER := 0;
    v_trip_exists BOOLEAN;
    v_active_user_ids UUID[] := '{}';
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.trips
        WHERE id = p_trip AND ambulance_id = auth.uid() AND status = 'active'
    ) INTO v_trip_exists;

    IF NOT v_trip_exists THEN
        RAISE EXCEPTION 'Trip does not exist or is not active for this ambulance';
    END IF;

    v_amb_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

    UPDATE public.trips
    SET amb_geom = v_amb_point,
        amb_heading = p_heading,
        last_tick_at = now()
    WHERE id = p_trip
    RETURNING route INTO v_route;

    v_corridor := ST_Buffer(v_route::geography, 30)::geometry;
    v_dist_along_amb := ST_LineLocatePoint(v_route, v_amb_point);

    FOR v_loc_record IN
        SELECT vl.user_id, vl.geom, vl.speed_kmh, vl.heading
        FROM public.vehicle_locations vl
        WHERE vl.user_id <> auth.uid()
          AND vl.updated_at > now() - INTERVAL '60 seconds'
          AND ST_DWithin(vl.geom::geography, v_amb_point::geography, 1200)
          AND ST_Intersects(vl.geom, v_corridor)
    LOOP
        v_dist_along_veh := ST_LineLocatePoint(v_route, v_loc_record.geom);

        IF v_dist_along_veh > v_dist_along_amb THEN
            v_distance_to_amb := ST_Distance(v_amb_point::geography, v_loc_record.geom::geography);

            IF v_distance_to_amb <= 1000 THEN
                v_heading_match := true;
                IF p_heading IS NOT NULL AND v_loc_record.heading IS NOT NULL THEN
                    v_heading_diff := ABS(p_heading - v_loc_record.heading);
                    IF v_heading_diff > 180 THEN
                        v_heading_diff := 360 - v_heading_diff;
                    END IF;
                    IF v_heading_diff >= 90 THEN
                        v_heading_match := false;
                    END IF;
                END IF;

                IF v_heading_match THEN
                    v_is_blocking := (v_loc_record.speed_kmh < 10) OR (v_distance_to_amb < 250);

                    INSERT INTO public.alerts (trip_id, user_id, distance_m, blocking, status, created_at)
                    VALUES (
                        p_trip,
                        v_loc_record.user_id,
                        ROUND(v_distance_to_amb),
                        v_is_blocking,
                        'active',
                        now()
                    )
                    ON CONFLICT (trip_id, user_id) DO UPDATE SET
                        distance_m = EXCLUDED.distance_m,
                        blocking = EXCLUDED.blocking,
                        status = 'active',
                        created_at = now();

                    v_active_user_ids := array_append(v_active_user_ids, v_loc_record.user_id);
                    v_alerts_count := v_alerts_count + 1;
                END IF;
            END IF;
        END IF;
    END LOOP;

    UPDATE public.alerts
    SET status = 'cleared'
    WHERE trip_id = p_trip
      AND status = 'active'
      AND NOT (user_id = ANY(v_active_user_ids));

    RETURN v_alerts_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
