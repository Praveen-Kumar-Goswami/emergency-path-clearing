import { ORS_API_KEY } from './config';
import { LatLng } from './geo';

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

export interface RouteResult {
  geometry: {
    type: 'LineString';
    coordinates: [number, number][]; // [lng, lat]
  };
  distance_m: number;
  duration_s: number;
  provider: 'OpenRouteService' | 'OSRM';
}

/**
 * Geocode text search using OpenRouteService or fallback
 */
export const geocode = async (text: string): Promise<GeocodeResult[]> => {
  if (!text || text.trim().length < 2) return [];

  const query = encodeURIComponent(text.trim());

  if (ORS_API_KEY && ORS_API_KEY !== 'your-openrouteservice-api-key') {
    try {
      const url = `https://api.openrouteservice.org/geocode/search?api_key=${ORS_API_KEY}&text=${query}&size=5`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json.features && Array.isArray(json.features)) {
          return json.features.map((f: any) => ({
            label: f.properties?.label || f.properties?.name || 'Selected Location',
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
          }));
        }
      }
    } catch (e) {
      console.warn('ORS geocode error, falling back to Nominatim', e);
    }
  }

  // Fallback to OSM Nominatim
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=5`,
      { headers: { 'User-Agent': 'EmergencyPathClearingApp/1.0' } }
    );
    if (res.ok) {
      const json = await res.json();
      return json.map((item: any) => ({
        label: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
      }));
    }
  } catch (err) {
    console.warn('Nominatim geocode error:', err);
  }

  return [];
};

/**
 * Get driving route between from [lat, lng] and to [lat, lng]
 */
export const getRoute = async (from: LatLng, to: LatLng): Promise<RouteResult> => {
  const [fromLat, fromLng] = from;
  const [toLat, toLng] = to;

  // Try OpenRouteService first if API key is provided
  if (ORS_API_KEY && ORS_API_KEY !== 'your-openrouteservice-api-key') {
    try {
      const url = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: ORS_API_KEY,
        },
        body: JSON.stringify({
          coordinates: [
            [fromLng, fromLat],
            [toLng, toLat],
          ],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.features && data.features.length > 0) {
          const feature = data.features[0];
          return {
            geometry: feature.geometry,
            distance_m: feature.properties.summary.distance,
            duration_s: feature.properties.summary.duration,
            provider: 'OpenRouteService',
          };
        }
      } else {
        console.warn(`ORS directions returned status ${res.status}, falling back to OSRM`);
      }
    } catch (orsError) {
      console.warn('ORS routing failed, trying OSRM fallback:', orsError);
    }
  }

  // Fallback to public OSRM server
  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    const res = await fetch(osrmUrl);
    if (!res.ok) {
      throw new Error(`OSRM HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error(data.message || 'No route found between points');
    }

    const route = data.routes[0];
    return {
      geometry: route.geometry,
      distance_m: route.distance,
      duration_s: route.duration,
      provider: 'OSRM',
    };
  } catch (osrmError: any) {
    throw new Error(
      `Routing failed. ORS and OSRM were unreachable: ${osrmError.message || String(osrmError)}`
    );
  }
};

/**
 * Convert GeoJSON LineString coordinates [[lng, lat], ...] to Leaflet LatLng [[lat, lng], ...]
 */
export const geoJsonToLeaflet = (coords: [number, number][]): LatLng[] => {
  return coords.map(([lng, lat]) => [lat, lng]);
};
