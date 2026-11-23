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
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(async (traccarToken: string, serverHost: string = 'demo3.traccar.org') => {
    if (wsRef.current) {
      if (wsRef.current.onclose) wsRef.current.onclose = null;
      wsRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    const cleanToken = traccarToken.trim();
    if (!cleanToken) return;

    const requestedHost = serverHost.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/\/+$/, '');
    const candidateHosts = Array.from(new Set([
      requestedHost,
      'demo3.traccar.org',
      'demo.traccar.org',
      'demo2.traccar.org',
      'demo4.traccar.org',
    ]));

    setError(null);

    // 1. Auto-detect which Traccar server accepts this token & fetch initial latest positions
    let resolvedHost = requestedHost;
    let authorized = false;
    let sawUnauthorized = false;

    for (const host of candidateHosts) {
      try {
        const posRes = await fetch(`https://${host}/api/positions`, {
          headers: {
            'Authorization': `Bearer ${cleanToken}`,
            'Accept': 'application/json'
          }
        });

        if (posRes.status === 401 || posRes.status === 403) {
          sawUnauthorized = true;
          continue;
        }

        if (posRes.ok) {
          resolvedHost = host;
          authorized = true;
          setIsConnected(true);
          const initialPositions = await posRes.json();
          if (Array.isArray(initialPositions) && initialPositions.length > 0) {
            setPositions(initialPositions);
            // Also fetch recent route history (last 6h) for each active device so full Traccar tracks sync to Supabase & Map
            const toIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();
            const fromIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
            for (const p of initialPositions) {
              if (!p?.deviceId) continue;
              fetch(`https://${host}/api/positions?deviceId=${p.deviceId}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`, {
                headers: {
                  'Authorization': `Bearer ${cleanToken}`,
                  'Accept': 'application/json'
                }
              })
                .then((r) => (r.ok ? r.json() : null))
                .then((histPts) => {
                  if (Array.isArray(histPts) && histPts.length > 1) {
                    setPositions(histPts);
                  }
                })
                .catch(() => {});
            }
          }
          break;
        }
      } catch (restErr) {
        console.warn(`Traccar REST check warning on ${host}:`, restErr);
      }
    }

    if (!authorized && sawUnauthorized) {
      setIsConnected(false);
      setError('Traccar Token หมดอายุหรือไม่ถูกต้อง (401 Unauthorized)');
      console.warn('Traccar token unauthorized (401) across candidate servers.');
      return;
    }

    const cleanHost = resolvedHost;

    // 1.5 Continuous REST polling every 3s (guarantees live updates even when cross-domain WebSocket cookies are blocked)
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`https://${cleanHost}/api/positions`, {
          headers: {
            'Authorization': `Bearer ${cleanToken}`,
            'Accept': 'application/json'
          }
        });
        if (res.ok) {
          setIsConnected(true);
          setError(null);
          const latest = await res.json();
          if (Array.isArray(latest) && latest.length > 0) {
            setPositions(latest);
          }
        }
      } catch {
        // Ignore transient network errors during poll
      }
    }, 3000);

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
        if (!pollIntervalRef.current) setIsConnected(false);
        // Do not infinitely retry if unauthorized / policy violation
        if (ev.code === 1008 || ev.code === 1003) return;
        reconnectTimeoutRef.current = setTimeout(() => {
          if (cleanToken) connect(cleanToken, cleanHost);
        }, 10000);
      };
      
      ws.onerror = () => {
        // REST polling still keeps Traccar connected if Bearer token is valid
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
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
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
