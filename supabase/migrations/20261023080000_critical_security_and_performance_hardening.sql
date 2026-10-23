-- ==============================================================================
-- EMERGENCY PATH CLEARING - MIGRATION 003: CRITICAL SECURITY & PERFORMANCE HARDENING
-- Addresses:
-- 1. Input sanitization & coordinate range validation on all RPCs
-- 2. Strict JSONB LineString validation on start_trip
-- 3. Anonymous user DoS rate limiting
-- 4. Critical composite database indexes for zero-scan queries
-- 5. Bounding-box spatial optimization in tick_ambulance
-- 6. Profile creation race condition handling
-- 7. Automated cleanup for stale telemetry and rate limits
-- ==============================================================================

-- 1. Rate Limiting Table
CREATE TABLE IF NOT EXISTS public.rpc_rate_limits (
    user_id UUID NOT NULL,
    endpoint TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_count INT NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS rpc_rate_limits_window_idx ON public.rpc_rate_limits (window_start);

-- Rate Limiting Enforcement Function
CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_user_id UUID,
    p_endpoint TEXT,
    p_max_requests INT DEFAULT 60,
    p_window_seconds INT DEFAULT 60
)
RETURNS void AS $$
DECLARE
    v_current_count INT;
    v_window_start TIMESTAMPTZ;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    SELECT request_count, window_start INTO v_current_count, v_window_start
    FROM public.rpc_rate_limits
    WHERE user_id = p_user_id AND endpoint = p_endpoint
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.rpc_rate_limits (user_id, endpoint, window_start, request_count)
        VALUES (p_user_id, p_endpoint, now(), 1);
    ELSIF now() - v_window_start > (p_window_seconds || ' seconds')::INTERVAL THEN
        UPDATE public.rpc_rate_limits
        SET window_start = now(), request_count = 1
        WHERE user_id = p_user_id AND endpoint = p_endpoint;
    ELSIF v_current_count >= p_max_requests THEN
        RAISE EXCEPTION 'Rate limit exceeded: maximum % requests per %s allowed on %.',
            p_max_requests, p_window_seconds, p_endpoint
            USING ERRCODE = 'P0001';
    ELSE
        UPDATE public.rpc_rate_limits
        SET request_count = request_count + 1
        WHERE user_id = p_user_id AND endpoint = p_endpoint;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Critical Performance Indexes
CREATE INDEX IF NOT EXISTS vehicle_locations_updated_at_idx ON public.vehicle_locations (updated_at DESC);
CREATE INDEX IF NOT EXISTS trips_status_tick_idx ON public.trips (status, last_tick_at DESC);
CREATE INDEX IF NOT EXISTS trips_created_at_idx ON public.trips (created_at DESC);
CREATE INDEX IF NOT EXISTS trips_ambulance_id_status_idx ON public.trips (ambulance_id, status);
CREATE INDEX IF NOT EXISTS alerts_status_created_idx ON public.alerts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_trip_user_status_idx ON public.alerts (trip_id, user_id, status);

-- 3. Hardened report_location with bounds validation & rate limiting
CREATE OR REPLACE FUNCTION public.report_location(
    p_lat NUMERIC,
    p_lng NUMERIC,
    p_speed NUMERIC,
    p_heading NUMERIC DEFAULT NULL
)
RETURNS void AS $$
BEGIN
    -- Coordinate boundary validation
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat < -90.0 OR p_lat > 90.0 OR p_lng < -180.0 OR p_lng > 180.0 THEN
        RAISE EXCEPTION 'Coordinates out of bounds: latitude must be [-90, 90], longitude [-180, 180].'
            USING ERRCODE = '22003';
    END IF;

    -- Speed sanity bounds (0 to 350 km/h)
    IF p_speed IS NOT NULL AND (p_speed < 0 OR p_speed > 350) THEN
        RAISE EXCEPTION 'Speed out of realistic bounds (0 - 350 km/h).'
            USING ERRCODE = '22003';
    END IF;

    -- Heading sanity bounds (0 to 360 deg)
    IF p_heading IS NOT NULL AND (p_heading < 0 OR p_heading > 360) THEN
        RAISE EXCEPTION 'Heading out of bounds (0 - 360 degrees).'
            USING ERRCODE = '22003';
    END IF;

    -- Rate limiting: max 90 reports per 60 seconds per user
    PERFORM public.check_rate_limit(auth.uid(), 'report_location', 90, 60);

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

-- 4. Hardened start_trip with strict JSONB schema validation
CREATE OR REPLACE FUNCTION public.start_trip(p_route JSONB)
RETURNS UUID AS $$
DECLARE
    v_trip_id UUID;
    v_geom GEOMETRY;
    v_coord_count INT;
    v_is_ambulance BOOLEAN;
BEGIN
    -- Privilege check: must have ambulance or dispatcher role
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('ambulance', 'dispatcher')
    ) INTO v_is_ambulance;

    IF NOT v_is_ambulance THEN
        RAISE EXCEPTION 'Access denied: ambulance or dispatcher role required.' USING ERRCODE = '42501';
    END IF;

    -- Rate limiting: max 10 trips started per minute
    PERFORM public.check_rate_limit(auth.uid(), 'start_trip', 10, 60);

    -- Strict JSONB schema validation
    IF p_route IS NULL OR jsonb_typeof(p_route) != 'object' THEN
        RAISE EXCEPTION 'Invalid route payload: must be a GeoJSON object.' USING ERRCODE = '22023';
    END IF;

    IF p_route->>'type' != 'LineString' THEN
        RAISE EXCEPTION 'Invalid route geometry: type must be LineString.' USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(p_route->'coordinates') != 'array' THEN
        RAISE EXCEPTION 'Invalid coordinates: must be an array of coordinate pairs.' USING ERRCODE = '22023';
    END IF;

    v_coord_count := jsonb_array_length(p_route->'coordinates');
    IF v_coord_count < 2 THEN
        RAISE EXCEPTION 'Route must contain at least 2 coordinate pairs.' USING ERRCODE = '22023';
    END IF;

    IF v_coord_count > 5000 THEN
        RAISE EXCEPTION 'Route exceeds maximum allowable coordinates (5000).' USING ERRCODE = '22023';
    END IF;

    -- Convert GeoJSON to PostGIS geometry safely
    BEGIN
        v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_route::text), 4326);
    EXCEPTION
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Malformed GeoJSON syntax: unable to parse geometry.' USING ERRCODE = '22023';
    END;

    -- Verify geometry type
    IF ST_GeometryType(v_geom) != 'ST_LineString' THEN
        RAISE EXCEPTION 'Parsed geometry is not a LineString.' USING ERRCODE = '22023';
    END IF;

    -- Cancel any existing active trips for this ambulance
    UPDATE public.trips
    SET status = 'cancelled'
    WHERE ambulance_id = auth.uid() AND status = 'active';

    -- Insert new trip
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

-- 5. Hardened tick_ambulance with bounds validation, spatial index pre-filter, and rate limiting
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
    v_owner_id UUID;
BEGIN
    -- Coordinate boundary validation
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat < -90.0 OR p_lat > 90.0 OR p_lng < -180.0 OR p_lng > 180.0 THEN
        RAISE EXCEPTION 'Coordinates out of bounds: latitude must be [-90, 90], longitude [-180, 180].'
            USING ERRCODE = '22003';
    END IF;

    IF p_heading IS NOT NULL AND (p_heading < 0 OR p_heading > 360) THEN
        RAISE EXCEPTION 'Heading out of bounds (0 - 360 degrees).'
            USING ERRCODE = '22003';
    END IF;

    -- Rate limiting: max 60 ticks per 60 seconds
    PERFORM public.check_rate_limit(auth.uid(), 'tick_ambulance', 60, 60);

    -- Verify trip exists, is active, and caller is owner or dispatcher
    SELECT route, ambulance_id INTO v_route, v_owner_id
    FROM public.trips
    WHERE id = p_trip AND status = 'active';

    IF v_route IS NULL THEN
        RAISE EXCEPTION 'Trip not found or not active.' USING ERRCODE = 'P0002';
    END IF;

    IF v_owner_id != auth.uid() AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'dispatcher'
    ) THEN
        RAISE EXCEPTION 'Access denied: caller is not trip owner or dispatcher.' USING ERRCODE = '42501';
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

    -- Match vehicles with 2-tier spatial filter:
    -- Tier 1: Fast GIST bounding box envelope (ST_Buffer in degrees ~35m ~0.0005 deg)
    -- Tier 2: Precise ST_DWithin geography (35m lateral tolerance)
    WITH candidates AS (
        SELECT 
            vl.user_id,
            vl.geom,
            vl.speed_kmh,
            vl.heading,
            ST_LineLocatePoint(v_route, vl.geom) AS veh_loc,
            (ST_LineLocatePoint(v_route, vl.geom) - v_amb_loc) * v_route_len_m AS dist_ahead_m,
            (vl.speed_kmh < 8.0) AS is_blocking
        FROM public.vehicle_locations vl
        WHERE vl.updated_at > now() - INTERVAL '2 minutes'
          AND vl.user_id != auth.uid()
          AND vl.geom && ST_Buffer(v_route, 0.0006)
          AND ST_DWithin(v_route::geography, vl.geom::geography, 35)
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
              OR ABS(c.heading - p_heading) <= 60
              OR ABS(c.heading - p_heading) >= 300
          )
    )
    SELECT 
        COALESCE(array_agg(m.user_id), ARRAY[]::UUID[]),
        COUNT(*)
    INTO v_matched_user_ids, v_matched_count
    FROM matched m;

    -- Upsert alerts for matched vehicles in single set operation
    INSERT INTO public.alerts (trip_id, user_id, distance_m, blocking, status, created_at)
    SELECT 
        p_trip,
        m.user_id,
        m.dist_ahead_m,
        m.is_blocking,
        'active',
        now()
    FROM (
        SELECT 
            c.user_id,
            ROUND(c.dist_ahead_m) AS dist_ahead_m,
            c.is_blocking
        FROM (
            SELECT 
                vl.user_id,
                vl.geom,
                vl.speed_kmh,
                vl.heading,
                ST_LineLocatePoint(v_route, vl.geom) AS veh_loc,
                (ST_LineLocatePoint(v_route, vl.geom) - v_amb_loc) * v_route_len_m AS dist_ahead_m,
                (vl.speed_kmh < 8.0) AS is_blocking
            FROM public.vehicle_locations vl
            WHERE vl.updated_at > now() - INTERVAL '2 minutes'
              AND vl.user_id != auth.uid()
              AND vl.geom && ST_Buffer(v_route, 0.0006)
              AND ST_DWithin(v_route::geography, vl.geom::geography, 35)
        ) c
        WHERE c.veh_loc > v_amb_loc
          AND c.dist_ahead_m <= 1000
          AND (
              c.heading IS NULL
              OR c.speed_kmh < 3.0
              OR p_heading IS NULL
              OR ABS(c.heading - p_heading) <= 60
              OR ABS(c.heading - p_heading) >= 300
          )
    ) m
    ON CONFLICT (trip_id, user_id) DO UPDATE
    SET distance_m = EXCLUDED.distance_m,
        blocking = EXCLUDED.blocking,
        status = CASE 
            WHEN public.alerts.status = 'acknowledged' THEN 'acknowledged'
            ELSE 'active'
        END;

    -- Auto-clear alerts when ambulance overtakes vehicle
    UPDATE public.alerts
    SET status = 'cleared'
    WHERE trip_id = p_trip
      AND status IN ('active', 'acknowledged')
      AND NOT (user_id = ANY(v_matched_user_ids));

    RETURN v_matched_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Hardened handle_new_user with concurrency safety
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, role, created_at)
    VALUES (new.id, 'citizen', now())
    ON CONFLICT (id) DO NOTHING;
    RETURN new;
EXCEPTION
    WHEN OTHERS THEN
        RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Automated Stale Telemetry & Unbounded Growth Purge
CREATE OR REPLACE FUNCTION public.cleanup_stale_telemetry()
RETURNS void AS $$
BEGIN
    -- Purge vehicle location fixes older than 15 minutes
    DELETE FROM public.vehicle_locations
    WHERE updated_at < now() - INTERVAL '15 minutes';

    -- Purge rate limit records older than 10 minutes
    DELETE FROM public.rpc_rate_limits
    WHERE window_start < now() - INTERVAL '10 minutes';

    -- Purge cleared alerts older than 2 hours
    DELETE FROM public.alerts
    WHERE status = 'cleared' AND created_at < now() - INTERVAL '2 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Integrate cleanup into expire_stale_trips
CREATE OR REPLACE FUNCTION public.expire_stale_trips()
RETURNS void AS $$
BEGIN
    -- Mark trips expired if last tick was more than 3 minutes ago
    UPDATE public.trips
    SET status = 'expired'
    WHERE status = 'active'
      AND last_tick_at < now() - INTERVAL '3 minutes';

    -- Mark alerts for expired trips as cleared
    UPDATE public.alerts
    SET status = 'cleared'
    WHERE trip_id IN (
        SELECT id FROM public.trips WHERE status IN ('expired', 'completed', 'cancelled')
    ) AND status IN ('active', 'acknowledged');

    -- Purge old rows to prevent unbounded growth
    PERFORM public.cleanup_stale_telemetry();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
