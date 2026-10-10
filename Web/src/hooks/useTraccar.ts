import { useState, useEffect, useCallback, useRef } from 'react';

export interface TraccarPosition {
  deviceId: number;
  latitude: number;
  longitude: number;
  speed?: number;
  accuracy?: number;
  deviceTime?: string;
  [key: string]: any;
}

export function useTraccar(initialToken?: string | null) {
  const [isConnected, setIsConnected] = useState(false);
  const [positions, setPositions] = useState<TraccarPosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback((traccarToken: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    setError(null);
    try {
      const ws = new WebSocket(`wss://demo.traccar.org/api/socket?token=${traccarToken}`);
      
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
      
      ws.onclose = () => {
        setIsConnected(false);
        // Retry logic like in the original code
        reconnectTimeoutRef.current = setTimeout(() => {
          if (traccarToken) connect(traccarToken);
        }, 5000);
      };
      
      ws.onerror = () => {
        setIsConnected(false);
        setError("Failed to connect to Traccar WebSocket");
      };
      
      wsRef.current = ws;
    } catch (err: any) {
      setError(err.message || "Failed to initialize WebSocket");
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      // Prevent reconnection
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
