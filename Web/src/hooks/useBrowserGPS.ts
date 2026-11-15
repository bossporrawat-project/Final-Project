import { useState, useEffect, useCallback, useRef } from 'react';

export interface GPSPosition {
  latitude: number;
  longitude: number;
  speed: number;
  accuracy: number | null;
  timestamp: string;
}

export function useBrowserGPS() {
  const [gpsOn, setGpsOn] = useState(false);
  const [position, setPosition] = useState<GPSPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const watchIdRef = useRef<number | null>(null);
  const lastPosRef = useRef<GPSPosition | null>(null);
  const sendIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startGPS = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError("Browser doesn't support Geolocation");
      return;
    }
    
    setGpsOn(true);
    setError(null);
    
    // 1. Initial fix and continuous watch
    watchIdRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude, longitude, speed: raw, accuracy } = p.coords;
        const speed = raw ? raw * 3.6 : 0;
        const timestamp = new Date(p.timestamp || Date.now()).toISOString();
        const pos = { latitude, longitude, speed, accuracy, timestamp };
        lastPosRef.current = pos;
        setPosition(pos);
      },
      (e) => {
        console.warn('GPS Warning:', e.message);
        // Only set error if permission denied (don't alert on transient timeout)
        if (e.code === e.PERMISSION_DENIED) {
          setError(e.message);
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    );

    // 2. Periodic emitter for stationary updates
    sendIntervalRef.current = setInterval(() => {
      if (lastPosRef.current) {
        setPosition({ ...lastPosRef.current, timestamp: new Date().toISOString() });
      }
    }, 2000);
  }, []);

  const stopGPS = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }
    setGpsOn(false);
  }, []);

  useEffect(() => {
    return () => stopGPS();
  }, [stopGPS]);

  return { gpsOn, startGPS, stopGPS, position, error };
}
