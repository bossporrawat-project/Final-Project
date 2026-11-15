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
