export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: [number, number][]; // [lng, lat]
}

export type TripStatus = 'active' | 'completed' | 'cancelled' | 'expired';
export type AlertStatus = 'active' | 'acknowledged' | 'cleared';
export type VehicleVisualState = 'none' | 'active' | 'blocking' | 'acknowledged';

export interface Trip {
  id: string;
  status: TripStatus;
  created_at: string;
  last_tick_at: string;
  ambulance_id: string;
  route: GeoJsonLineString;
  amb_lat: number | null;
  amb_lng: number | null;
  amb_heading: number | null;
}

export interface Vehicle {
  user_id: string;
  short_id: string;
  lat: number;
  lng: number;
  speed_kmh: number;
  heading: number | null;
  age_s: number;
}

export interface AlertRow {
  id: string;
  trip_id: string;
  user_id: string;
  short_id: string;
  distance_m: number;
  blocking: boolean;
  status: AlertStatus;
  created_at: string;
}

export interface Snapshot {
  server_time: string;
  trips: Trip[];
  vehicles: Vehicle[];
  alerts: AlertRow[];
}
