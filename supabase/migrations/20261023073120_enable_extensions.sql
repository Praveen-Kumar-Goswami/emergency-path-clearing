-- ==============================================================================
-- 001: ENABLE EXTENSIONS
-- PostGIS for geospatial queries & pg_cron for scheduled background jobs
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_cron;
