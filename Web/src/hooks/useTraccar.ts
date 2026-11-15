import { useState, useEffect, useCallback, useRef } from 'react';

export interface TraccarPosition {
  deviceId: number;
  latitude: number;
  longitude: number;
  speed?: number;
  accuracy?: number;
  deviceTime?: string;
  fixTime?: string;
  [key: string]: any;
}

export function useTraccar(initialToken?: string | null) {
  const [isConnected, setIsConnected] = useState(false);
  const [positions, setPositions] = useState<TraccarPosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(async (traccarToken: string, serverHost: string = 'demo.traccar.org') => {
    if (wsRef.current) {
      if (wsRef.current.onclose) wsRef.current.onclose = null;
      wsRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const cleanToken = traccarToken.trim();
    if (!cleanToken) return;

    const cleanHost = serverHost.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/\/+$/, '');
    setError(null);

    // 1. Fetch initial latest positions via REST API & verify token validity
    try {
      const posRes = await fetch(`https://${cleanHost}/api/positions`, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Accept': 'application/json'
        }
      });

      if (posRes.status === 401 || posRes.status === 403) {
        setIsConnected(false);
        setError('Traccar Token หมดอายุหรือไม่ถูกต้อง (401 Unauthorized)');
        console.warn('Traccar token unauthorized (401). Please generate a new token from Traccar.');
        return;
      }

      if (posRes.ok) {
        const initialPositions = await posRes.json();
        if (Array.isArray(initialPositions) && initialPositions.length > 0) {
          setPositions(initialPositions);
        }
      }
    } catch (restErr) {
      // Fallback to WebSocket even if REST check fails due to CORS
      console.warn('Traccar REST check warning:', restErr);
    }

    // 2. Connect WebSocket for real-time stream
    try {
      const ws = new WebSocket(`wss://${cleanHost}/api/socket?token=${encodeURIComponent(cleanToken)}`);
      
      ws.onopen = () => {
        setIsConnected(true);
        setError(null);
      };
      
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.positions && Array.isArray(m.positions)) {
            setPositions(m.positions);
          }
        } catch (err) {
          console.error('Error parsing Traccar message', err);
        }
      };
      
      ws.onclose = (ev) => {
        setIsConnected(false);
        // Do not infinitely retry if unauthorized / policy violation
        if (ev.code === 1008 || ev.code === 1003) return;
        reconnectTimeoutRef.current = setTimeout(() => {
          if (cleanToken) connect(cleanToken, cleanHost);
        }, 10000);
      };
      
      ws.onerror = () => {
        setIsConnected(false);
        setError('ไม่สามารถเชื่อมต่อ Traccar WebSocket ได้ (ตรวจสอบ Token หรือ Server)');
      };
      
      wsRef.current = ws;
    } catch (err: any) {
      setError(err.message || 'Failed to initialize WebSocket');
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      if (wsRef.current.onclose) {
        wsRef.current.onclose = null;
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (initialToken) {
      connect(initialToken);
    }
    return () => disconnect();
  }, [initialToken, connect, disconnect]);

  return { isConnected, positions, connect, disconnect, error };
}
