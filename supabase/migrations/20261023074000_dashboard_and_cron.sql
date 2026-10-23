-- ==============================================================================
-- 003: DASHBOARD SNAPSHOT & AUTO-EXPIRY (MIGRATION 002)
-- ==============================================================================

-- 1. Auto-expire stale trips (trips without a tick for > 3 minutes)
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 2. dashboard_snapshot() RPC (for Dispatcher role)
CREATE OR REPLACE FUNCTION public.dashboard_snapshot()
RETURNS JSONB AS $$
DECLARE
    v_is_dispatcher BOOLEAN;
    v_trips JSONB;
    v_vehicles JSONB;
    v_alerts JSONB;
BEGIN
    -- Run cleanup check first
    PERFORM public.expire_stale_trips();

    -- Role check: Dispatcher only
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'dispatcher'
    ) INTO v_is_dispatcher;

    IF NOT v_is_dispatcher THEN
        RAISE EXCEPTION 'Access denied. Dispatcher role required.';
    END IF;

    -- Query trips (all active trips, plus completed/expired/cancelled from the last 2 hours)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', t.id,
            'status', t.status,
            'created_at', t.created_at,
            'last_tick_at', t.last_tick_at,
            'ambulance_id', t.ambulance_id,
            'route', ST_AsGeoJSON(t.route)::jsonb,
            'amb_lat', CASE WHEN t.amb_geom IS NOT NULL THEN ST_Y(t.amb_geom) ELSE NULL END,
            'amb_lng', CASE WHEN t.amb_geom IS NOT NULL THEN ST_X(t.amb_geom) ELSE NULL END,
            'amb_heading', t.amb_heading
        ) ORDER BY t.created_at DESC
    ), '[]'::jsonb)
    INTO v_trips
    FROM public.trips t
    WHERE t.status = 'active' OR t.created_at > now() - INTERVAL '2 hours';

    -- Query vehicles online (seen in last 2 minutes)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'user_id', v.user_id,
            'short_id', substring(v.user_id::text, 1, 6),
            'lat', ST_Y(v.geom),
            'lng', ST_X(v.geom),
            'speed_kmh', v.speed_kmh,
            'heading', v.heading,
            'age_s', GREATEST(0, ROUND(EXTRACT(epoch FROM (now() - v.updated_at))))
        ) ORDER BY v.updated_at DESC
    ), '[]'::jsonb)
    INTO v_vehicles
    FROM public.vehicle_locations v
    WHERE v.updated_at > now() - INTERVAL '2 minutes';

    -- Query alerts (active or acknowledged, or cleared within last 5 minutes)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'trip_id', a.trip_id,
            'user_id', a.user_id,
            'short_id', substring(a.user_id::text, 1, 6),
            'distance_m', a.distance_m,
            'blocking', a.blocking,
            'status', a.status,
            'created_at', a.created_at
        ) ORDER BY a.created_at DESC
    ), '[]'::jsonb)
    INTO v_alerts
    FROM public.alerts a
    WHERE a.status IN ('active', 'acknowledged') OR a.created_at > now() - INTERVAL '5 minutes';

    -- Return consolidated snapshot
    RETURN jsonb_build_object(
        'server_time', now(),
        'trips', v_trips,
        'vehicles', v_vehicles,
        'alerts', v_alerts
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3. Optional pg_cron setup for automatic cleanup every minute
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'expire-stale-trips-job',
            '* * * * *',
            'SELECT public.expire_stale_trips()'
        );
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;
