import { useState, useEffect, useCallback, useRef } from 'react';

export interface GPSPosition {
  latitude: number;
  longitude: number;
  speed: number;
  accuracy: number | null;
  timestamp: string;
}

export function useBrowserGPS(intervalSec: number = 2) {
  const [gpsOn, setGpsOn] = useState(false);
  const [position, setPosition] = useState<GPSPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const watchIdRef = useRef<number | null>(null);
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null);
  const latestPosRef = useRef<GeolocationCoordinates | null>(null);

  const startGPS = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError("Browser doesn't support Geolocation");
      return;
    }
    
    setGpsOn(true);
    setError(null);
    
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    if (intervalIdRef.current !== null) {
      clearInterval(intervalIdRef.current);
    }

    // Keep cache updated using watchPosition
    watchIdRef.current = navigator.geolocation.watchPosition(
      (p) => {
        latestPosRef.current = p.coords;
      },
      (e) => {
        console.warn('GPS:', e.message);
        setError(e.message);
        if (e.code === e.PERMISSION_DENIED) {
           setGpsOn(false);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    // Emit to state every intervalSec
    intervalIdRef.current = setInterval(() => {
      if (latestPosRef.current) {
        const { latitude, longitude, speed: raw, accuracy } = latestPosRef.current;
        const speed = raw ? raw * 3.6 : 0;
        const timestamp = new Date().toISOString();
        setPosition({ latitude, longitude, speed, accuracy, timestamp });
      }
    }, Math.max(1000, intervalSec * 1000));

  }, [intervalSec]);

  const stopGPS = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (intervalIdRef.current !== null) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
    setGpsOn(false);
    latestPosRef.current = null;
  }, []);

  useEffect(() => {
    // If GPS is currently on and interval changes, restart it to apply new interval
    if (gpsOn) {
      startGPS();
    }
    return () => {
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [intervalSec]); // removed startGPS from deps to avoid infinite loop when interval changes, wait, startGPS depends on intervalSec so it's fine.

  return { gpsOn, startGPS, stopGPS, position, error };
}
