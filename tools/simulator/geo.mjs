/**
 * @fileoverview Pure mathematical geospatial helper utilities for spherical Earth calculations,
 * great-circle distances, bearings, forward projections, and polyline linear referencing.
 */

/** Earth radius in meters according to WGS84 spherical approximation */
const EARTH_RADIUS_M = 6371000;

/**
 * Converts degrees to radians.
 * @param {number} deg Angle in degrees
 * @returns {number} Angle in radians
 */
export const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Converts radians to degrees.
 * @param {number} rad Angle in radians
 * @returns {number} Angle in degrees
 */
export const toDeg = (rad) => (rad * 180) / Math.PI;

/**
 * Calculates the great-circle Haversine distance between two [lat, lng] coordinates.
 *
 * @param {[number, number]} p1 First coordinate point [lat, lng]
 * @param {[number, number]} p2 Second coordinate point [lat, lng]
 * @returns {number} Distance in meters
 */
export const haversineDistance = (p1, p2) => {
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
 * Calculates the forward initial bearing from point p1 to point p2.
 *
 * @param {[number, number]} p1 Origin coordinate [lat, lng]
 * @param {[number, number]} p2 Destination coordinate [lat, lng]
 * @returns {number} Compass bearing in degrees normalized to [0, 360)
 */
export const bearing = (p1, p2) => {
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
 * Computes destination coordinate given a start point, travel distance, and bearing.
 *
 * @param {[number, number]} start Starting coordinate [lat, lng]
 * @param {number} distanceM Forward distance in meters
 * @param {number} brngDeg Heading in degrees [0, 360)
 * @returns {[number, number]} Projected coordinate [lat, lng]
 */
export const destinationPoint = (start, distanceM, brngDeg) => {
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
 * Computes the total cumulative length of a polyline in meters.
 *
 * @param {[number, number][]} polyline Array of [lat, lng] points
 * @returns {number} Total distance in meters
 */
export const polylineLength = (polyline) => {
  if (polyline.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    total += haversineDistance(polyline[i], polyline[i + 1]);
  }
  return total;
};

/**
 * Computes exact coordinate and tangent bearing at a given meter offset along a polyline.
 *
 * @param {[number, number][]} polyline Array of [lat, lng] points
 * @param {number} meters Distance from polyline start in meters
 * @returns {{ point: [number, number], heading: number }} Interpolated point and road heading
 */
export const pointAtDistance = (polyline, meters) => {
  if (polyline.length === 0) return { point: [0, 0], heading: 0 };
  if (polyline.length === 1 || meters <= 0) {
    const heading = polyline.length > 1 ? bearing(polyline[0], polyline[1]) : 0;
    return { point: polyline[0], heading };
  }

  let accumulated = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const segLen = haversineDistance(polyline[i], polyline[i + 1]);
    if (accumulated + segLen >= meters) {
      const remaining = meters - accumulated;
      const segBearing = bearing(polyline[i], polyline[i + 1]);
      const p = destinationPoint(polyline[i], remaining, segBearing);
      return { point: p, heading: segBearing };
    }
    accumulated += segLen;
  }

  const lastIdx = polyline.length - 1;
  const lastHeading = bearing(polyline[lastIdx - 1], polyline[lastIdx]);
  return { point: polyline[lastIdx], heading: lastHeading };
};

/**
 * Computes linear referencing: projects a test point onto a polyline to determine
 * distance along the route and perpendicular lateral offset.
 *
 * @param {[number, number][]} polyline Array of [lat, lng] points representing route centerline
 * @param {[number, number]} point Test coordinate [lat, lng]
 * @returns {{ distanceAlongM: number, lateralM: number }} Nearest distance along route and lateral offset
 */
export const nearestDistanceAlongRoute = (polyline, point) => {
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

    const dAP = haversineDistance(pA, point);
    const dBP = haversineDistance(pB, point);

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

/**
 * Projects a point along the route with a perpendicular lateral displacement.
 *
 * @param {[number, number][]} polyline Array of [lat, lng] points
 * @param {number} distanceAlongM Distance along centerline in meters
 * @param {number} lateralOffsetM Lateral offset in meters (+90° right)
 * @returns {{ point: [number, number], heading: number }} Displaced point and road heading
 */
export const lateralOffsetPoint = (polyline, distanceAlongM, lateralOffsetM) => {
  const { point, heading } = pointAtDistance(polyline, distanceAlongM);
  const perpBearing = (heading + 90) % 360;
  const offsetPoint = destinationPoint(point, lateralOffsetM, perpBearing);
  return { point: offsetPoint, heading };
};
