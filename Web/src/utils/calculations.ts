/**
 * Calculates the Haversine distance in meters between two coordinates.
 */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculates the initial forward azimuth (bearing) in degrees [0, 360) from point 1 to point 2.
 * 0° = North, 90° = East, 180° = South, 270° = West.
 */
export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const dLambda = (lon2 - lon1) * toRad;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return ((theta * toDeg) + 360) % 360;
}

const COMPASS_SECTORS = [
  '↑ N ทิศเหนือ',
  '↗ NE ตะวันออกเฉียงเหนือ',
  '→ E ทิศตะวันออก',
  '↘ SE ตะวันออกเฉียงใต้',
  '↓ S ทิศใต้',
  '↙ SW ตะวันตกเฉียงใต้',
  '← W ทิศตะวันตก',
  '↖ NW ตะวันตกเฉียงเหนือ',
];

/**
 * Formats a bearing angle in degrees into a readable Thai compass label with arrow and degrees.
 */
export function formatDirectionTH(bearing: number | null | undefined): string {
  if (bearing == null || isNaN(bearing)) return 'หยุดนิ่ง / รอทิศทาง';
  const normalized = ((bearing % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % 8;
  return `${COMPASS_SECTORS[idx]} (${Math.round(normalized)}°)`;
}

export interface AnalysisStats {
  samples: number | string;
  meanError: number | string;
  stdDev: number | string;
  min: number | string;
  max: number | string;
  avgAcc: number | string;
  barWidth: number;
}

export interface KmlPoint {
  lat: number;
  lng: number;
  timeMs?: number;
}

export interface ParsedKmlRoute {
  name: string;
  points: KmlPoint[];
  totalDistanceM: number;
}

export interface RouteComparisonMetrics {
  id: string;
  label: string;
  source: string;
  samples: number;
  avgErrorM: number | null;
  updateIntervalS: number | null;
  avgSpeedMs: number | null;
  dataConsistencyPct: number | null;
  availabilityPct: number | null;
  isSimulated?: boolean;
}

/**
 * Parses a KML file (LineString coordinates, gx:Track coordinates, or Points) into ordered lat/lng waypoints.
 */
export function parseKmlRoute(kmlText: string, fallbackName = 'Manual Route.kml'): ParsedKmlRoute {
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, 'text/xml');
  const parseErr = doc.getElementsByTagName('parsererror');
  if (parseErr.length > 0) {
    throw new Error('ไฟล์ KML ไม่ถูกต้องตามรูปแบบ XML');
  }

  const nameEl = doc.getElementsByTagName('name')[0];
  const name = nameEl?.textContent?.trim() || fallbackName;
  const points: KmlPoint[] = [];

  // 1. Standard KML <LineString><coordinates>lng,lat[,alt] ...</coordinates>
  const lineStrings = Array.from(doc.getElementsByTagName('LineString'));
  for (const ls of lineStrings) {
    const coordEl = ls.getElementsByTagName('coordinates')[0];
    const raw = coordEl?.textContent?.trim();
    if (!raw) continue;
    const tuples = raw.split(/\s+/);
    for (const tuple of tuples) {
      const parts = tuple.split(',');
      if (parts.length < 2) continue;
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng) && !(lat === 0 && lng === 0)) {
        points.push({ lat, lng });
      }
    }
  }

  // 2. Google Earth <gx:Track> (<when> + <gx:coord>lng lat alt</gx:coord>)
  if (points.length === 0) {
    const allEls = Array.from(doc.getElementsByTagName('*'));
    const tracks = allEls.filter((el) => el.localName === 'Track');
    for (const track of tracks) {
      const children = Array.from(track.children);
      const whens = children.filter((c) => c.localName === 'when');
      const coords = children.filter((c) => c.localName === 'coord');
      for (let i = 0; i < coords.length; i++) {
        const parts = (coords[i].textContent || '').trim().split(/\s+/);
        if (parts.length < 2) continue;
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        const rawTime = whens[i]?.textContent?.trim();
        const tMs = rawTime ? Date.parse(rawTime) : NaN;
        if (!isNaN(lat) && !isNaN(lng) && !(lat === 0 && lng === 0)) {
          points.push({ lat, lng, timeMs: !isNaN(tMs) ? tMs : undefined });
        }
      }
    }
  }

  // 3. Fallback: ordered <Point><coordinates>
  if (points.length === 0) {
    const pointEls = Array.from(doc.getElementsByTagName('Point'));
    for (const pt of pointEls) {
      const raw = pt.getElementsByTagName('coordinates')[0]?.textContent?.trim();
      if (!raw) continue;
      const parts = raw.split(',');
      if (parts.length < 2) continue;
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng) && !(lat === 0 && lng === 0)) {
        points.push({ lat, lng });
      }
    }
  }

  let totalDistanceM = 0;
  for (let i = 1; i < points.length; i++) {
    totalDistanceM += haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }

  return { name, points, totalDistanceM };
}

/**
 * Shortest cross-track distance in meters from point (lat, lng) to segment A->B.
 */
export function distancePointToSegmentMeters(
  lat: number,
  lng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * cosLat;

  const ax = (aLng - lng) * metersPerDegLng;
  const ay = (aLat - lat) * metersPerDegLat;
  const bx = (bLng - lng) * metersPerDegLng;
  const by = (bLat - lat) * metersPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(ax, ay);

  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(projX, projY);
}

/**
 * Minimum distance in meters from (lat, lng) to a polyline route.
 */
export function distancePointToRouteMeters(
  lat: number,
  lng: number,
  route: { lat: number; lng: number }[]
): number {
  if (route.length === 0) return 0;
  if (route.length === 1) return haversine(lat, lng, route[0].lat, route[0].lng);

  let best = Infinity;
  for (let i = 1; i < route.length; i++) {
    const d = distancePointToSegmentMeters(
      lat,
      lng,
      route[i - 1].lat,
      route[i - 1].lng,
      route[i].lat,
      route[i].lng
    );
    if (d < best) best = d;
  }
  return best === Infinity ? 0 : best;
}

function extractPointTimeMs(p: any): number {
  const raw = p?.device_time || p?.recorded_at || p?.timestamp || p?.updated_at || p?.server_time;
  if (!raw) return 0;
  const ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
  return isNaN(ms) ? 0 : ms;
}

/**
 * Computes route error, update interval (s), average speed (m/s), data consistency (%),
 * and session availability / uptime (%) for a stream of GPS points.
 */
export function computeTelemetryMetrics(
  points: Array<{ latitude: number; longitude: number; speed?: number; accuracy?: number | null; device_time?: string; recorded_at?: string; timestamp?: string; updated_at?: string; server_time?: string }>,
  options: {
    id: string;
    label: string;
    source: string;
    kmlRoute?: { lat: number; lng: number }[] | null;
    refLat?: number | null;
    refLng?: number | null;
    overrideAvgErrorM?: number | null;
    overrideSamples?: number | null;
  }
): RouteComparisonMetrics {
  const validPts = points.filter(
    (p) =>
      typeof p.latitude === 'number' &&
      typeof p.longitude === 'number' &&
      !isNaN(p.latitude) &&
      !isNaN(p.longitude) &&
      !(p.latitude === 0 && p.longitude === 0)
  );
  const sampleCount = options.overrideSamples ?? validPts.length;

  if (validPts.length === 0) {
    return {
      id: options.id,
      label: options.label,
      source: options.source,
      samples: sampleCount,
      avgErrorM: options.overrideAvgErrorM ?? null,
      updateIntervalS: null,
      avgSpeedMs: null,
      dataConsistencyPct: null,
      availabilityPct: null,
    };
  }

  let avgErrorM: number | null = options.overrideAvgErrorM ?? null;
  if (avgErrorM == null) {
    if (options.kmlRoute && options.kmlRoute.length >= 2) {
      const errs = validPts.map((p) => distancePointToRouteMeters(p.latitude, p.longitude, options.kmlRoute!));
      avgErrorM = parseFloat((errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2));
    } else if (options.refLat != null && options.refLng != null) {
      const errs = validPts.map((p) => haversine(options.refLat!, options.refLng!, p.latitude, p.longitude));
      avgErrorM = parseFloat((errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2));
    }
  }

  const withTime = validPts
    .map((p) => ({ pt: p, ms: extractPointTimeMs(p) }))
    .filter((x) => x.ms > 0)
    .sort((a, b) => a.ms - b.ms);

  let updateIntervalS: number | null = null;
  let dataConsistencyPct: number | null = null;
  let availabilityPct: number | null = null;

  if (withTime.length >= 2) {
    const allDeltasSec: number[] = [];
    const activeDeltasSec: number[] = [];
    let impliedJumpCount = 0;

    for (let i = 1; i < withTime.length; i++) {
      const dtSec = (withTime[i].ms - withTime[i - 1].ms) / 1000;
      if (dtSec <= 0) continue;
      allDeltasSec.push(dtSec);
      if (dtSec <= 300) {
        activeDeltasSec.push(dtSec);
        const distM = haversine(
          withTime[i - 1].pt.latitude,
          withTime[i - 1].pt.longitude,
          withTime[i].pt.latitude,
          withTime[i].pt.longitude
        );
        if (distM / dtSec > 65) {
          impliedJumpCount++;
        }
      }
    }

    const refDeltas = activeDeltasSec.length > 0 ? activeDeltasSec : allDeltasSec;
    if (refDeltas.length > 0) {
      const meanDt = refDeltas.reduce((a, b) => a + b, 0) / refDeltas.length;
      updateIntervalS = parseFloat(meanDt.toFixed(2));

      const sortedDt = [...refDeltas].sort((a, b) => a - b);
      const medianDt = sortedDt[Math.floor(sortedDt.length / 2)];
      const steadyThreshold = Math.max(3.0, medianDt * 2.5);
      const steadyCount = refDeltas.filter((dt) => dt <= steadyThreshold).length;
      const cadenceScore = steadyCount / refDeltas.length;
      const nonJumpScore = Math.max(0, 1 - impliedJumpCount / refDeltas.length);
      const validRatio = validPts.length / Math.max(1, points.length);
      dataConsistencyPct = parseFloat((Math.min(100, cadenceScore * nonJumpScore * validRatio * 100)).toFixed(1));

      // Active-session availability: exclude multi-minute powered-off breaks (>300s)
      const activeTotalSec = activeDeltasSec.reduce((a, b) => a + b, 0);
      if (activeTotalSec > 0) {
        const uptimeThresholdSec = Math.max(20, medianDt * 2.5);
        const healthySec = activeDeltasSec
          .filter((dt) => dt <= uptimeThresholdSec)
          .reduce((a, b) => a + b, 0);
        availabilityPct = parseFloat(Math.min(100, (healthySec / activeTotalSec) * 100).toFixed(1));
      } else {
        availabilityPct = parseFloat(((validPts.length / Math.max(1, points.length)) * 100).toFixed(1));
      }
    } else {
      availabilityPct = validPts.length > 0 ? 100.0 : null;
    }
  } else {
    dataConsistencyPct = parseFloat(((validPts.length / Math.max(1, points.length)) * 100).toFixed(1));
    availabilityPct = validPts.length > 0 ? 100.0 : null;
  }

  // Average speed in m/s (DB stores km/h -> divide by 3.6; fallback to Haversine speed if all reported speeds are 0)
  const numericSpeeds = validPts
    .map((p) => Number(p.speed))
    .filter((s) => !isNaN(s) && s >= 0);
  const nonZeroSpeeds = numericSpeeds.filter((s) => s > 0);
  let avgSpeedMs: number | null = null;
  if (nonZeroSpeeds.length > 0) {
    avgSpeedMs = parseFloat((numericSpeeds.reduce((a, b) => a + b, 0) / numericSpeeds.length / 3.6).toFixed(2));
  } else if (withTime.length >= 2) {
    let totalDist = 0;
    let totalSec = 0;
    for (let i = 1; i < withTime.length; i++) {
      const dtSec = (withTime[i].ms - withTime[i - 1].ms) / 1000;
      if (dtSec > 0 && dtSec <= 60) {
        const d = haversine(
          withTime[i - 1].pt.latitude,
          withTime[i - 1].pt.longitude,
          withTime[i].pt.latitude,
          withTime[i].pt.longitude
        );
        if (d / dtSec <= 65) {
          totalDist += d;
          totalSec += dtSec;
        }
      }
    }
    avgSpeedMs = totalSec > 0 ? parseFloat((totalDist / totalSec).toFixed(2)) : 0;
  } else if (numericSpeeds.length > 0) {
    avgSpeedMs = 0;
  }

  return {
    id: options.id,
    label: options.label,
    source: options.source,
    samples: sampleCount,
    avgErrorM,
    updateIntervalS,
    avgSpeedMs,
    dataConsistencyPct,
    availabilityPct,
  };
}

/**
 * Computes baseline metrics for an uploaded KML manual/reference route.
 */
export function computeKmlBaselineMetrics(route: ParsedKmlRoute): RouteComparisonMetrics {
  const pts = route.points;
  const timed = pts.filter((p) => typeof p.timeMs === 'number' && p.timeMs > 0);
  let updateIntervalS = 1.0;
  let isSimulated = true;
  let avgSpeedMs = 0;

  if (timed.length >= 2) {
    const deltas: number[] = [];
    for (let i = 1; i < timed.length; i++) {
      const dt = (timed[i].timeMs! - timed[i - 1].timeMs!) / 1000;
      if (dt > 0) deltas.push(dt);
    }
    if (deltas.length > 0) {
      updateIntervalS = parseFloat((deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2));
      isSimulated = false;
      const totalDur = deltas.reduce((a, b) => a + b, 0);
      avgSpeedMs = totalDur > 0 ? parseFloat((route.totalDistanceM / totalDur).toFixed(2)) : 0;
    }
  } else if (pts.length >= 2) {
    const simDurationS = (pts.length - 1) * 1.0;
    avgSpeedMs = simDurationS > 0 ? parseFloat((route.totalDistanceM / simDurationS).toFixed(2)) : 0;
  }

  // Measure path smoothness / chord deviation as baseline geometry noise (0 if < 3 pts)
  let avgChordDev = 0;
  if (pts.length >= 3) {
    let sumDev = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      sumDev += distancePointToSegmentMeters(
        pts[i].lat,
        pts[i].lng,
        pts[i - 1].lat,
        pts[i - 1].lng,
        pts[i + 1].lat,
        pts[i + 1].lng
      );
    }
    avgChordDev = parseFloat((sumDev / (pts.length - 2)).toFixed(2));
  }

  let validSteps = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
    if (d > 0) validSteps++;
  }
  const consistencyPct =
    pts.length >= 2 ? parseFloat(((validSteps / (pts.length - 1)) * 100).toFixed(1)) : 100.0;

  return {
    id: 'kml_manual_route',
    label: `KML (${route.name})`,
    source: 'kml',
    samples: pts.length,
    avgErrorM: avgChordDev,
    updateIntervalS,
    avgSpeedMs,
    dataConsistencyPct: consistencyPct,
    availabilityPct: 100.0,
    isSimulated,
  };
}

export interface MeanRouteResult {
  points: Array<{ lat: number; lng: number }>;
  deviceCount: number;
  method: 'time-bucket' | 'arc-length' | 'centroid' | 'none';
}

function resampleRouteByArcLength(
  pts: Array<{ lat: number; lng: number }>,
  sampleCount: number
): Array<{ lat: number; lng: number }> {
  if (pts.length === 0) return [];
  if (pts.length === 1 || sampleCount <= 1) return [{ lat: pts[0].lat, lng: pts[0].lng }];

  const cumDist: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cumDist.push(cumDist[i - 1] + haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng));
  }
  const totalLen = cumDist[cumDist.length - 1];
  if (totalLen === 0) {
    return Array.from({ length: sampleCount }, () => ({ lat: pts[0].lat, lng: pts[0].lng }));
  }

  const out: Array<{ lat: number; lng: number }> = [];
  let seg = 1;
  for (let i = 0; i < sampleCount; i++) {
    const target = (i / (sampleCount - 1)) * totalLen;
    while (seg < cumDist.length - 1 && cumDist[seg] < target) {
      seg++;
    }
    const prevD = cumDist[seg - 1];
    const nextD = cumDist[seg];
    const ratio = nextD > prevD ? (target - prevD) / (nextD - prevD) : 0;
    const p0 = pts[seg - 1];
    const p1 = pts[seg];
    out.push({
      lat: p0.lat + ratio * (p1.lat - p0.lat),
      lng: p0.lng + ratio * (p1.lng - p0.lng),
    });
  }
  return out;
}

/**
 * Computes a multi-device consensus Mean Route across all provided device routes.
 * Prefers 5-second time-aligned averaging (equal weight per device regardless of Hz),
 * falling back to arc-length progress resampling if devices ran in non-overlapping windows.
 */
export function computeConsensusMeanRoute(
  routesByDevice: Record<string, Array<{ lat: number; lng: number; timeMs?: number }>>
): MeanRouteResult {
  const deviceIds = Object.keys(routesByDevice).filter((id) => routesByDevice[id].length > 0);
  if (deviceIds.length < 2) {
    return { points: [], deviceCount: deviceIds.length, method: 'none' };
  }

  // 1. Time-bucket averaging (5s buckets) when devices overlap in real time
  const buckets = new Map<number, Map<string, { sumLat: number; sumLng: number; count: number }>>();
  for (const devId of deviceIds) {
    for (const p of routesByDevice[devId]) {
      if (!p.timeMs || p.timeMs <= 0) continue;
      const bKey = Math.round(p.timeMs / 5000) * 5000;
      let devMap = buckets.get(bKey);
      if (!devMap) {
        devMap = new Map();
        buckets.set(bKey, devMap);
      }
      const acc = devMap.get(devId) || { sumLat: 0, sumLng: 0, count: 0 };
      acc.sumLat += p.lat;
      acc.sumLng += p.lng;
      acc.count += 1;
      devMap.set(devId, acc);
    }
  }

  const timeAlignedPoints = Array.from(buckets.entries())
    .filter(([, devMap]) => devMap.size >= 2)
    .sort((a, b) => a[0] - b[0])
    .map(([, devMap]) => {
      let sumLat = 0;
      let sumLng = 0;
      devMap.forEach((v) => {
        sumLat += v.sumLat / v.count;
        sumLng += v.sumLng / v.count;
      });
      return {
        lat: sumLat / devMap.size,
        lng: sumLng / devMap.size,
      };
    });

  if (timeAlignedPoints.length >= 3) {
    return {
      points: timeAlignedPoints,
      deviceCount: deviceIds.length,
      method: 'time-bucket',
    };
  }

  // 2. Fallback: resample multi-point routes along normalized arc-length progress [0..1]
  const multiPointIds = deviceIds.filter((id) => routesByDevice[id].length >= 2);
  if (multiPointIds.length >= 2) {
    const sampleN = 80;
    const resampled = multiPointIds.map((id) => resampleRouteByArcLength(routesByDevice[id], sampleN));
    const avgRoute: Array<{ lat: number; lng: number }> = [];
    for (let i = 0; i < sampleN; i++) {
      let sumLat = 0;
      let sumLng = 0;
      for (let d = 0; d < resampled.length; d++) {
        sumLat += resampled[d][i].lat;
        sumLng += resampled[d][i].lng;
      }
      avgRoute.push({
        lat: sumLat / resampled.length,
        lng: sumLng / resampled.length,
      });
    }
    return {
      points: avgRoute,
      deviceCount: multiPointIds.length,
      method: 'arc-length',
    };
  }

  // 3. Stationary fallback: mean centroid across per-device centers
  let sumLat = 0;
  let sumLng = 0;
  for (const id of deviceIds) {
    const pts = routesByDevice[id];
    const devLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const devLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    sumLat += devLat;
    sumLng += devLng;
  }
  return {
    points: [{ lat: sumLat / deviceIds.length, lng: sumLng / deviceIds.length }],
    deviceCount: deviceIds.length,
    method: 'centroid',
  };
}

/**
 * Uniformly decimates an ordered array of points to at most maxPoints while
 * always preserving the first and last point (so start, end, and route shape stay intact).
 */
export function decimatePoints<T>(points: T[], maxPoints: number): T[] {
  if (maxPoints <= 2 || points.length <= maxPoints) return points;
  const result: T[] = [points[0]];
  const interiorTarget = maxPoints - 2;
  const span = points.length - 2;
  let lastPickedIdx = 0;

  for (let i = 1; i <= interiorTarget; i++) {
    const idx = Math.min(points.length - 2, Math.max(1, Math.round((i * span) / (interiorTarget + 1))));
    if (idx > lastPickedIdx) {
      result.push(points[idx]);
      lastPickedIdx = idx;
    }
  }
  result.push(points[points.length - 1]);
  return result;
}
