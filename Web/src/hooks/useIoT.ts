import { useState, useEffect, useRef } from 'react';

export interface IoTDevicePosition {
  deviceId: string;
  latitude: number;
  longitude: number;
  speed: number;
  accuracy: number | null;
  timeStr: string;
}

const IOT_FIREBASE_URL = 'https://iot-project-c13c9-default-rtdb.asia-southeast1.firebasedatabase.app/gps_data.json';

export function useIoT(enabled: boolean = true) {
  const [isConnected, setIsConnected] = useState(false);
  const [positions, setPositions] = useState<IoTDevicePosition[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastJsonRef = useRef<string>('');

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      return;
    }

    let isMounted = true;

    const fetchIoTData = async () => {
      try {
        const res = await fetch(IOT_FIREBASE_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!isMounted) return;

        setIsConnected(true);
        if (data && typeof data === 'object') {
          const list: IoTDevicePosition[] = [];
          Object.keys(data).forEach((key) => {
            const item = data[key];
            if (item && item.lat != null && item.lng != null) {
              const lat = parseFloat(item.lat);
              const lng = parseFloat(item.lng);
              if (!isNaN(lat) && !isNaN(lng)) {
                list.push({
                  deviceId: `ESP32_${item.device_id || key}`,
                  latitude: lat,
                  longitude: lng,
                  speed: item.speed ? parseFloat(item.speed) : 0,
                  accuracy: item.accuracy != null ? parseFloat(item.accuracy) : null,
                  timeStr: item.time || ''
                });
              }
            }
          });
          const nextJson = JSON.stringify(list);
          if (nextJson !== lastJsonRef.current) {
            lastJsonRef.current = nextJson;
            setPositions(list);
          }
        }
      } catch (err) {
        if (isMounted) setIsConnected(false);
      }
    };

    fetchIoTData();
    timerRef.current = setInterval(fetchIoTData, 2000);

    return () => {
      isMounted = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled]);

  return { isConnected, positions };
}
