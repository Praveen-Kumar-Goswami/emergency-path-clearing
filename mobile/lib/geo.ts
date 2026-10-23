export type LatLng = [number, number]; // [lat, lng]

const EARTH_RADIUS_M = 6371000;

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/**
 * Great-circle distance between two points in meters (Haversine formula)
 */
export const haversineDistance = (p1: LatLng, p2: LatLng): number => {
  const [lat1, lon1] = p1;
  const [lat2, lon2] = p2;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
};

/**
 * Initial bearing from p1 to p2 in degrees [0, 360)
 */
export const bearing = (p1: LatLng, p2: LatLng): number => {
  const [lat1, lon1] = p1;
  const [lat2, lon2] = p2;

  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));

  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
};

/**
 * Destination point given start point, distance in meters, and bearing in degrees
 */
export const destinationPoint = (start: LatLng, distanceM: number, brngDeg: number): LatLng => {
  const [lat1, lon1] = start;
  const rLat1 = toRad(lat1);
  const rLon1 = toRad(lon1);
  const rBrng = toRad(brngDeg);
  const dr = distanceM / EARTH_RADIUS_M;

  const lat2 = Math.asin(Math.sin(rLat1) * Math.cos(dr) + Math.cos(rLat1) * Math.sin(dr) * Math.cos(rBrng));
  const lon2 =
    rLon1 +
    Math.atan2(
      Math.sin(rBrng) * Math.sin(dr) * Math.cos(rLat1),
      Math.cos(dr) - Math.sin(rLat1) * Math.sin(lat2)
    );

  return [toDeg(lat2), toDeg(lon2)];
};

/**
 * Total length of a polyline in meters
 */
export const polylineLength = (polyline: LatLng[]): number => {
  if (polyline.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    total += haversineDistance(polyline[i], polyline[i + 1]);
  }
  return total;
};

/**
 * Point at a specific distance in meters along a polyline
 */
export const pointAtDistance = (
  polyline: LatLng[],
  meters: number
): { point: LatLng; heading: number } => {
  if (polyline.length === 0) {
    return { point: [0, 0], heading: 0 };
  }
  if (polyline.length === 1 || meters <= 0) {
    const heading = polyline.length > 1 ? bearing(polyline[0], polyline[1]) : 0;
    return { point: polyline[0], heading };
  }

  let accumulated = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const segLen = haversineDistance(polyline[i], polyline[i + 1]);
    if (accumulated + segLen >= meters) {
      const remaining = meters - accumulated;
      const ratio = segLen === 0 ? 0 : remaining / segLen;
      const segBearing = bearing(polyline[i], polyline[i + 1]);
      const p = destinationPoint(polyline[i], remaining, segBearing);
      return { point: p, heading: segBearing };
    }
    accumulated += segLen;
  }

  // If beyond polyline end, return end point with last segment bearing
  const lastIdx = polyline.length - 1;
  const lastHeading = bearing(polyline[lastIdx - 1], polyline[lastIdx]);
  return { point: polyline[lastIdx], heading: lastHeading };
};

/**
 * Find distance along route for a point, and lateral distance to the route
 */
export const nearestDistanceAlongRoute = (
  polyline: LatLng[],
  point: LatLng
): { distanceAlongM: number; lateralM: number } => {
  if (polyline.length < 2) {
    const latDist = polyline.length === 1 ? haversineDistance(polyline[0], point) : 0;
    return { distanceAlongM: 0, lateralM: latDist };
  }

  let minLateralM = Infinity;
  let bestDistanceAlongM = 0;
  let accumulatedM = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const pA = polyline[i];
    const pB = polyline[i + 1];
    const segLen = haversineDistance(pA, pB);

    if (segLen === 0) {
      const d = haversineDistance(pA, point);
      if (d < minLateralM) {
        minLateralM = d;
        bestDistanceAlongM = accumulatedM;
      }
      continue;
    }

    // Project point onto segment
    const dAP = haversineDistance(pA, point);
    const dBP = haversineDistance(pB, point);

    // Approximate projection ratio using triangle sides
    const t = Math.max(0, Math.min(1, (dAP * dAP - dBP * dBP + segLen * segLen) / (2 * segLen * segLen)));
    const projPoint = destinationPoint(pA, t * segLen, bearing(pA, pB));
    const lateralDist = haversineDistance(projPoint, point);

    if (lateralDist < minLateralM) {
      minLateralM = lateralDist;
      bestDistanceAlongM = accumulatedM + t * segLen;
    }

    accumulatedM += segLen;
  }

  return { distanceAlongM: bestDistanceAlongM, lateralM: minLateralM };
};
