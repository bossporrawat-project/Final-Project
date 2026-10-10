/**
 * Calculates the Haversine distance in meters between two points.
 */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface AnalysisStats {
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
  avgAcc: number | null;
}

/**
 * Calculates analysis statistics (mean, std dev, min, max) for given errors and accuracies.
 */
export function calculateStats(errors: number[], accs: number[]): AnalysisStats {
  const n = errors.length;
  if (n === 0) {
    return { n: 0, mean: 0, sd: 0, min: 0, max: 0, avgAcc: null };
  }

  const mean = errors.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 
    ? Math.sqrt(errors.map((e) => (e - mean) ** 2).reduce((a, b) => a + b, 0) / (n - 1))
    : 0;

  let min = errors[0];
  let max = errors[0];
  for (let i = 1; i < n; i++) {
    if (errors[i] < min) min = errors[i];
    if (errors[i] > max) max = errors[i];
  }

  const avgAcc =
    accs.length > 0 ? accs.reduce((a, b) => a + b, 0) / accs.length : null;

  return { n, mean, sd, min, max, avgAcc };
}
