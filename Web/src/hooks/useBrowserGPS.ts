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
  
  const gpsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startGPS = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError("Browser doesn't support Geolocation");
      return;
    }
    
    setGpsOn(true);
    setError(null);
    
    const send = () => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const { latitude, longitude, speed: raw, accuracy } = p.coords;
          const speed = raw ? raw * 3.6 : 0; // Convert m/s to km/h
          const timestamp = new Date().toISOString();
          
          setPosition({ latitude, longitude, speed, accuracy, timestamp });
        },
        (e) => {
          console.warn('GPS:', e.message);
          setError(e.message);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    };

    send();
    gpsIntervalRef.current = setInterval(send, 2000);
  }, []);

  const stopGPS = useCallback(() => {
    if (gpsIntervalRef.current) {
      clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = null;
    }
    setGpsOn(false);
  }, []);

  useEffect(() => {
    return () => stopGPS();
  }, [stopGPS]);

  return { gpsOn, startGPS, stopGPS, position, error };
}
