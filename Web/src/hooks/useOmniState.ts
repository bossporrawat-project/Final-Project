import { useState } from 'react';

export interface Position {
  id?: string;
  device_id: string;
  device_name?: string;
  latitude: number;
  longitude: number;
  speed?: number;
  accuracy?: number | null;
  source: string;
  is_online?: boolean;
  updated_at?: string;
  recorded_at?: string;
}

export interface FilterState {
  src: string;
  dev: string;
}

export function useLivePositions() {
  const [livePos, setLivePos] = useState<Record<string, Position>>({});
  return { livePos, setLivePos };
}

export function useHistory() {
  const [histArr, setHistArr] = useState<Position[]>([]);
  return { histArr, setHistArr };
}

export function useTrackingSettings() {
  const [filter, setFilter] = useState<FilterState>({ src: 'all', dev: 'all' });
  const [isTrack, setIsTrack] = useState<boolean>(true);
  const [gpsOn, setGpsOn] = useState<boolean>(false);

  return { filter, setFilter, isTrack, setIsTrack, gpsOn, setGpsOn };
}
