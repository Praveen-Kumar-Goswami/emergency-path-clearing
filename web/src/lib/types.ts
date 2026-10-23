/**
 * @fileoverview Shared domain models, telemetry contracts, and geospatial data types
 * for the Emergency Path Clearing web dispatch platform.
 */

/**
 * Standard GeoJSON LineString representation in WGS84 coordinates.
 */
export interface GeoJsonLineString {
  /** GeoJSON geometry discriminator */
  type: 'LineString';
  /** Array of [longitude, latitude] coordinate pairs */
  coordinates: [number, number][];
}

/**
 * Lifecycle state of an emergency ambulance trip.
 * - 'active': Vehicle currently navigating towards emergency.
 * - 'completed': Destination reached within tolerance or explicitly ended.
 * - 'cancelled': Crew aborted the mission.
 * - 'expired': Inactivity timeout triggered by background watchdog.
 */
export type TripStatus = 'active' | 'completed' | 'cancelled' | 'expired';

/**
 * Status of a corridor clearing alert issued to a civilian vehicle.
 * - 'active': Vehicle is ahead within 1km; road must be cleared.
 * - 'acknowledged': Driver confirmed they are pulling aside.
 * - 'cleared': Emergency vehicle has passed; normal traffic flow restored.
 */
export type AlertStatus = 'active' | 'acknowledged' | 'cleared';

/**
 * Visual styling token derived for map markers and UI badges.
 */
export type VehicleVisualState = 'none' | 'active' | 'blocking' | 'acknowledged';

/**
 * Represents an active or historical ambulance emergency response trip.
 */
export interface Trip {
  /** Unique UUID identifier */
  id: string;
  /** Current lifecycle status */
  status: TripStatus;
  /** ISO-8601 timestamp of creation */
  created_at: string;
  /** ISO-8601 timestamp of the most recent GPS tick */
  last_tick_at: string;
  /** User ID of the ambulance crew */
  ambulance_id: string;
  /** Planned road route geometry */
  route: GeoJsonLineString;
  /** Current latitude of the ambulance */
  amb_lat: number | null;
  /** Current longitude of the ambulance */
  amb_lng: number | null;
  /** Current compass bearing (0-360 degrees) */
  amb_heading: number | null;
}

/**
 * Represents real-time telemetry fix from a connected civilian or emergency vehicle.
 */
export interface Vehicle {
  /** Unique user identifier */
  user_id: string;
  /** Truncated human-readable identifier (e.g. 'c1a4') */
  short_id: string;
  /** Latitude in WGS84 */
  lat: number;
  /** Longitude in WGS84 */
  lng: number;
  /** Ground speed in kilometers per hour */
  speed_kmh: number;
  /** Compass heading in degrees (0-360) or null */
  heading: number | null;
  /** Seconds elapsed since fix was recorded by database */
  age_s: number;
}

/**
 * Represents an active or historical corridor alert row.
 */
export interface AlertRow {
  /** Unique UUID identifier */
  id: string;
  /** Associated emergency trip ID */
  trip_id: string;
  /** Recipient citizen user ID */
  user_id: string;
  /** Short identifier of the recipient vehicle */
  short_id: string;
  /** Forward road distance from ambulance to vehicle in meters */
  distance_m: number;
  /** Flagged true if vehicle is stationary (<8 km/h) directly in route */
  blocking: boolean;
  /** Alert lifecycle status */
  status: AlertStatus;
  /** ISO-8601 timestamp when alert was triggered */
  created_at: string;
}

/**
 * Complete atomic snapshot payload returned by the dashboard_snapshot() RPC.
 */
export interface Snapshot {
  /** Database server time for latency synchronization */
  server_time: string;
  /** All recent and active emergency trips */
  trips: Trip[];
  /** Active vehicles currently reporting GPS fixes */
  vehicles: Vehicle[];
  /** Recent corridor alerts across the fleet */
  alerts: AlertRow[];
}
