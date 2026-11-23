'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Header from '@/components/Header';
import ControlBar from '@/components/ControlBar';
import MapArea from '@/components/MapArea';
import DataTables from '@/components/DataTables';
import AnalysisPanel, { ReferenceMode, DeviceAnalysisRow } from '@/components/AnalysisPanel';

import { useLivePositions, useHistory, useTrackingSettings, Position } from '@/hooks/useOmniState';
import { useTraccar } from '@/hooks/useTraccar';
import { getSupabaseClient } from '@/lib/supabaseClient';
import {
  haversine,
  AnalysisStats,
  parseKmlRoute,
  distancePointToRouteMeters,
  computeTelemetryMetrics,
  computeKmlBaselineMetrics,
  ParsedKmlRoute,
  RouteComparisonMetrics,
} from '@/utils/calculations';

const DEFAULT_ANALYSIS_STATS: AnalysisStats = {
  samples: '-',
  meanError: '-',
  stdDev: '-',
  min: '-',
  max: '-',
  avgAcc: '-',
  barWidth: 0
};

function isValidCoord(p?: { latitude?: number; longitude?: number } | null): boolean {
  return Boolean(
    p &&
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    !isNaN(p.latitude) &&
    !isNaN(p.longitude) &&
    !(p.latitude === 0 && p.longitude === 0)
  );
}

function computeStatsForPoints(
  points: Position[],
  refLatNum: number,
  refLngNum: number,
  kmlPoints?: { lat: number; lng: number }[] | null
): AnalysisStats {
  if (points.length === 0) return DEFAULT_ANALYSIS_STATS;
  const errors = points.map((d) =>
    kmlPoints && kmlPoints.length >= 2
      ? distancePointToRouteMeters(d.latitude, d.longitude, kmlPoints)
      : haversine(refLatNum, refLngNum, d.latitude, d.longitude)
  );
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const stdDev = Math.sqrt(errors.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / errors.length);
  const max = Math.max(...errors);
  const min = Math.min(...errors);
  const validAccs = points.filter(d => d.accuracy != null && !isNaN(Number(d.accuracy))).map(d => Number(d.accuracy));
  const avgAcc = validAccs.length > 0 ? parseFloat((validAccs.reduce((a, b) => a + b, 0) / validAccs.length).toFixed(2)) : '-';

  return {
    samples: points.length,
    meanError: parseFloat(mean.toFixed(2)),
    stdDev: parseFloat(stdDev.toFixed(2)),
    min: parseFloat(min.toFixed(2)),
    max: parseFloat(max.toFixed(2)),
    avgAcc,
    barWidth: 0
  };
}

const DEFAULT_SUPABASE_URL = 'https://ryuhkaytmlapkuumgnlo.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dWhrYXl0bWxhcGt1dW1nbmxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MzY4MjUsImV4cCI6MjEwNzExMjgyNX0.JYKrvAMK64xE5r92pepQy02fVl4mO55dMaz93heaee8';
const DEFAULT_TRACCAR_TOKEN = 'SDBGAiEA7JbybnCRucezj3mEejwklEb6gAfl5SJkdxxpIEKeGj0CIQDe1zk0ASwL-Ztdc-9Q-IWM3LbMqrU6Ewtm79VukbWCHXsiaSI6MjUyODgwMDI3OTE5Mzk1MzAsInUiOjEwNDQ1LCJlIjoiMjAzNC0xMi0yOVQxNzowMDowMC4wMDArMDA6MDAifQ';
const HISTORY_PAGE_SIZE = 50;
const MAX_IN_MEMORY_ROUTE_POINTS = 12000;
const MAX_CSV_EXPORT_ROWS = 100000;

export default function Dashboard() {
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [lang, setLang] = useState<'th' | 'en'>('th');
  const [myDevice, setMyDevice] = useState<string>('—');
  const [supaStatus, setSupaStatus] = useState(false);
  const [traccarStatus, setTraccarStatus] = useState(false);

  // Analysis States
  const [refMode, setRefMode] = useState<ReferenceMode>('centroid');
  const [refDeviceId, setRefDeviceId] = useState('');
  const [refLat, setRefLat] = useState('');
  const [refLng, setRefLng] = useState('');
  const [analysisTick, setAnalysisTick] = useState(0);
  const [kmlRoute, setKmlRoute] = useState<ParsedKmlRoute | null>(null);
  const lastHistoryRecordRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const lastTraccarRecordRef = useRef<Record<string, { lat: number; lng: number; time: number; devTime?: string }>>({});
  const lastIoTRecordRef = useRef<Record<string, { lat: number; lng: number; timeStr: string; time: number }>>({});
  const livePollRef = useRef<NodeJS.Timeout | null>(null);

  // States from hooks
  const { livePos, setLivePos } = useLivePositions();
  const { histArr, setHistArr } = useHistory();
  const { filter, setFilter, isTrack, setIsTrack } = useTrackingSettings();

  // Connection hooks
  const { connect: connectTraccar, disconnect: disconnectTraccar, positions: traccarPositions, isConnected: traccarConnected, error: traccarError } = useTraccar();

  const [supabase, setSupabase] = useState<any>(null);
  const [clearSignal, setClearSignal] = useState(0);
  const [totalHistoryCount, setTotalHistoryCount] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageRows, setHistoryPageRows] = useState<Position[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [sourceHistoryRows, setSourceHistoryRows] = useState<{
    native: Position[];
    traccar: Position[];
    iot: Position[];
  }>({ native: [], traccar: [], iot: [] });
  const [sourceCounts, setSourceCounts] = useState<{
    all: number;
    native: number;
    traccar: number;
    iot: number;
  }>({ all: 0, native: 0, traccar: 0, iot: 0 });
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [serverCentroid, setServerCentroid] = useState<{ total: number; lat: number; lng: number } | null>(null);
  const [serverDeviceRows, setServerDeviceRows] = useState<DeviceAnalysisRow[] | null>(null);
  const histKeySetRef = useRef<Set<string>>(new Set());
  const historyPageRef = useRef<number>(1);
  const filterRef = useRef(filter);

  useEffect(() => {
    historyPageRef.current = historyPage;
  }, [historyPage]);

  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const makeCoordKey = (pt: Position) => {
    const ptTime = pt.device_time || pt.recorded_at || pt.updated_at || '';
    return `${pt.device_id}_${ptTime}_${Number(pt.latitude).toFixed(6)}_${Number(pt.longitude).toFixed(6)}`;
  };

  const makeHistKey = (pt: Position) => {
    return pt.id ? String(pt.id) : makeCoordKey(pt);
  };

  const appendHistoryPoint = useCallback((pt: Position, countAsNewDbInsert: boolean = true) => {
    if (!pt || !pt.device_id || pt.source === 'browser' || pt.device_id === 'Traccar_98615' || (pt.latitude === 0 && pt.longitude === 0)) return;
    const coordKey = makeCoordKey(pt);
    const idKey = pt.id ? String(pt.id) : coordKey;
    if (histKeySetRef.current.has(idKey) || histKeySetRef.current.has(coordKey)) return;

    histKeySetRef.current.add(idKey);
    histKeySetRef.current.add(coordKey);
    if (histKeySetRef.current.size > MAX_IN_MEMORY_ROUTE_POINTS * 3) {
      histKeySetRef.current.clear();
    }

    setHistArr(prev => {
      const next = [pt, ...prev];
      return next.length > MAX_IN_MEMORY_ROUTE_POINTS ? next.slice(0, MAX_IN_MEMORY_ROUTE_POINTS) : next;
    });

    if (pt.source === 'native' || pt.source === 'traccar' || pt.source === 'iot') {
      const srcKey = pt.source as 'native' | 'traccar' | 'iot';
      setSourceHistoryRows(prev => ({
        ...prev,
        [srcKey]: [pt, ...prev[srcKey]].slice(0, HISTORY_PAGE_SIZE),
      }));
      if (countAsNewDbInsert) {
        setSourceCounts(prev => ({
          ...prev,
          all: prev.all + 1,
          [srcKey]: prev[srcKey] + 1,
        }));
      }
    }

    if (countAsNewDbInsert) {
      const curFilter = filterRef.current;
      const matchesFilter =
        (curFilter.src === 'all' || pt.source === curFilter.src) &&
        (curFilter.dev === 'all' || pt.device_id === curFilter.dev);
      if (matchesFilter) {
        setTotalHistoryCount(c => c + 1);
        if (historyPageRef.current === 1) {
          setHistoryPageRows(prev => [pt, ...prev].slice(0, HISTORY_PAGE_SIZE));
        }
      }
    }
  }, [setHistArr]);

  const loadSourceBreakdown = useCallback(async (clientOverride?: any, devFilterOverride?: string) => {
    const activeClient = clientOverride || supabase;
    if (!activeClient) return;
    const devF = devFilterOverride ?? filterRef.current.dev;

    const queryForSource = (src: 'native' | 'traccar' | 'iot') => {
      let q = activeClient
        .from('gps_history')
        .select('*', { count: 'exact' })
        .eq('source', src)
        .neq('device_id', 'Traccar_98615');
      if (devF !== 'all') q = q.eq('device_id', devF);
      return q.order('server_time', { ascending: false, nullsFirst: false }).limit(HISTORY_PAGE_SIZE);
    };

    try {
      const [nRes, tRes, iRes] = await Promise.all([
        queryForSource('native'),
        queryForSource('traccar'),
        queryForSource('iot'),
      ]);
      const nRows = (nRes.data || []) as Position[];
      const tRows = (tRes.data || []) as Position[];
      const iRows = (iRes.data || []) as Position[];
      [...nRows, ...tRows, ...iRows].forEach((r) => {
        histKeySetRef.current.add(makeHistKey(r));
        histKeySetRef.current.add(makeCoordKey(r));
      });
      setSourceHistoryRows({ native: nRows, traccar: tRows, iot: iRows });
      const nCount = typeof nRes.count === 'number' ? nRes.count : nRows.length;
      const tCount = typeof tRes.count === 'number' ? tRes.count : tRows.length;
      const iCount = typeof iRes.count === 'number' ? iRes.count : iRows.length;
      setSourceCounts({
        all: nCount + tCount + iCount,
        native: nCount,
        traccar: tCount,
        iot: iCount,
      });
    } catch {
      // ignore transient error
    }
  }, [supabase]);

  const loadHistoryPage = useCallback(async (
    targetPage: number,
    srcFilter: string,
    devFilter: string,
    clientOverride?: any
  ) => {
    const activeClient = clientOverride || supabase;
    if (!activeClient) return;
    const safePage = Math.max(1, targetPage);
    setIsHistoryLoading(true);
    try {
      let query = activeClient
        .from('gps_history')
        .select('*', { count: 'exact' })
        .neq('source', 'browser');
      if (srcFilter !== 'all') query = query.eq('source', srcFilter);
      if (devFilter !== 'all') query = query.eq('device_id', devFilter);
      const from = (safePage - 1) * HISTORY_PAGE_SIZE;
      const to = from + HISTORY_PAGE_SIZE - 1;
      const { data, count, error } = await query
        .order('server_time', { ascending: false, nullsFirst: false })
        .range(from, to);

      if (!error) {
        const rows = (data || []) as Position[];
        rows.forEach((row) => {
          histKeySetRef.current.add(makeHistKey(row));
          histKeySetRef.current.add(makeCoordKey(row));
        });
        if (typeof count === 'number') setTotalHistoryCount(count);
        setHistoryPageRows(rows);
        setHistoryPage(safePage);
        historyPageRef.current = safePage;
      }
    } finally {
      setIsHistoryLoading(false);
    }
  }, [supabase]);

  // Apply theme & lang to DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.lang = lang;
  }, [theme, lang]);

  // Load config on mount (auto-connect without blocking modal)
  useEffect(() => {
    const url = localStorage.getItem('omni_supa_url') || process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const key = localStorage.getItem('omni_supa_key') || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
    const name = localStorage.getItem('omni_device_name') || process.env.NEXT_PUBLIC_DEVICE_NAME || 'ESP32_Tracker';
    const token = DEFAULT_TRACCAR_TOKEN;
    localStorage.setItem('omni_traccar_token', token);

    setMyDevice(name || 'ESP32_Tracker');
    initializeSupabase(url, key);

    return () => {
      if (livePollRef.current) {
        clearInterval(livePollRef.current);
        livePollRef.current = null;
      }
    };
  }, []);

  // Always connect with current DEFAULT_TRACCAR_TOKEN (and re-sync on HMR / Clear)
  useEffect(() => {
    localStorage.setItem('omni_traccar_token', DEFAULT_TRACCAR_TOKEN);
    connectTraccar(DEFAULT_TRACCAR_TOKEN, 'demo3.traccar.org');
  }, [connectTraccar, clearSignal]);

  const initializeSupabase = async (url: string, key: string) => {
    try {
      if (livePollRef.current) {
        clearInterval(livePollRef.current);
        livePollRef.current = null;
      }

      const client = getSupabaseClient(url, key);
      setSupabase(client);
      setSupaStatus(true);
      histKeySetRef.current.clear();
      // Fetch initial live positions ordered by actual server arrival time
      const { data: rawLiveData } = await client
        .from('gps_positions')
        .select('*')
        .neq('source', 'browser')
        .order('updated_at', { ascending: false, nullsFirst: false });
      const liveData = (rawLiveData || []).filter((r: any) => r?.source !== 'browser');

      // Call server-side downsampling RPC per device (p_points_per_device: 300 guarantees <= 599 rows < PostgREST 1000 cap even at 1M+ rows/device)
      const perDeviceRpcQueries = (liveData || []).map((dev: any) =>
        client.rpc('get_route_decimated', {
          p_points_per_device: 300,
          p_device_id: dev.device_id
        })
      );

      const [centroidRes, _pageRes, _srcBreakdownRes, ...perDeviceRpcResults] = await Promise.all([
        client.rpc('get_history_centroid'),
        loadHistoryPage(1, 'all', 'all', client),
        loadSourceBreakdown(client, 'all'),
        ...perDeviceRpcQueries
      ]);

      if (
        !centroidRes?.error &&
        Array.isArray(centroidRes?.data) &&
        centroidRes.data[0] &&
        Number(centroidRes.data[0].total_points) > 0
      ) {
        setServerCentroid({
          total: Number(centroidRes.data[0].total_points),
          lat: Number(centroidRes.data[0].avg_lat),
          lng: Number(centroidRes.data[0].avg_lng)
        });
      }

      const rpcSucceeded =
        perDeviceRpcResults.length > 0 &&
        perDeviceRpcResults.some((r: any) => !r?.error && Array.isArray(r?.data) && r.data.length > 0);

      let historyData: any[] = [];
      if (rpcSucceeded) {
        const mergedRpcMap = new Map<string, any>();
        perDeviceRpcResults.forEach((res: any) => {
          if (!res?.error && Array.isArray(res?.data)) {
            res.data.forEach((row: any) => {
              if (row?.source === 'browser') return;
              const key = makeHistKey(row);
              if (!mergedRpcMap.has(key)) mergedRpcMap.set(key, row);
            });
          }
        });
        historyData = Array.from(mergedRpcMap.values());
      } else {
        // Fallback: fetch global recent + per-device latest 1,000 rows so all devices show route lines
        const perDeviceQueries = (liveData || []).map((dev: any) =>
          client
            .from('gps_history')
            .select('*')
            .eq('device_id', dev.device_id)
            .order('server_time', { ascending: false, nullsFirst: false })
            .limit(1000)
        );

        const [globalHistRes, ...perDeviceResList] = await Promise.all([
          client
            .from('gps_history')
            .select('*')
            .order('server_time', { ascending: false, nullsFirst: false })
            .limit(1000),
          ...perDeviceQueries
        ]);

        const mergedMap = new Map<string, any>();
        const ingestHistRows = (rows?: any[] | null) => {
          if (!Array.isArray(rows)) return;
          rows.forEach((row) => {
            if (row?.source === 'browser') return;
            const key = makeHistKey(row);
            if (!mergedMap.has(key)) mergedMap.set(key, row);
          });
        };

        ingestHistRows(globalHistRes?.data);
        perDeviceResList.forEach((res) => ingestHistRows(res?.data));
        historyData = Array.from(mergedMap.values());
      }

      historyData.sort((a, b) => {
        const ta = new Date(a.server_time || a.device_time || 0).getTime();
        const tb = new Date(b.server_time || b.device_time || 0).getTime();
        return tb - ta;
      });

      historyData.forEach((row) => {
        histKeySetRef.current.add(makeHistKey(row));
        histKeySetRef.current.add(makeCoordKey(row));
      });
      
      const lastSeenSigByDev: Record<string, string> = {};
      if (liveData) {
        const liveMap: Record<string, any> = {};
        liveData.forEach((r: any) => {
          liveMap[r.device_id] = r;
          lastSeenSigByDev[r.device_id] = `${r.updated_at || ''}|${r.device_time || ''}|${r.latitude}|${r.longitude}|${r.speed}`;
          histKeySetRef.current.add(makeCoordKey(r));
        });
        setLivePos(liveMap);
      }
      setHistArr(historyData.slice(0, MAX_IN_MEMORY_ROUTE_POINTS));

      client.removeAllChannels();

      const applyIncomingLiveRow = (r: any) => {
        if (!r || !r.device_id || r.source === 'browser') return;
        const sig = `${r.updated_at || ''}|${r.device_time || ''}|${r.latitude}|${r.longitude}|${r.speed}`;
        if (lastSeenSigByDev[r.device_id] === sig) return;
        lastSeenSigByDev[r.device_id] = sig;

        setLivePos(prev => ({ ...prev, [r.device_id]: r }));
        if (r.latitude !== 0 || r.longitude !== 0) {
          appendHistoryPoint({
            ...r,
            id: `${r.device_id}_${r.device_time || r.updated_at}_${r.latitude}_${r.longitude}`
          }, true);
          // Ensure Native app live updates are also persisted to gps_history if the mobile batch insert hit a duplicate timestamp conflict
          if (r.source === 'native' && r.device_time) {
            client.from('gps_history').upsert({
              device_id: r.device_id,
              latitude: r.latitude,
              longitude: r.longitude,
              speed: r.speed || 0,
              accuracy: r.accuracy ?? null,
              source: 'native',
              device_time: r.device_time,
              server_time: r.server_time || r.updated_at || new Date().toISOString()
            }, { onConflict: 'device_id,device_time' }).then();
          }
        }
      };

      // Subscribe to realtime (never delete old points automatically; only on Clear)
      client.channel('live-pos')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'gps_positions' }, (payload: any) => {
          if (payload.eventType === 'DELETE') {
            return;
          }
          applyIncomingLiveRow(payload.new);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') setSupaStatus(true);
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSupaStatus(false);
        });
        
      client.channel('hist-log')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gps_history' }, (payload: any) => {
          appendHistoryPoint(payload.new, true);
        }).subscribe();

      // Resilient polling fallback so both Live Tracking Comparison and History Log stay real-time even if WebSocket stalls
      livePollRef.current = setInterval(async () => {
        try {
          const [posRes, histRes] = await Promise.all([
            client
              .from('gps_positions')
              .select('*')
              .neq('source', 'browser')
              .order('updated_at', { ascending: false, nullsFirst: false }),
            client
              .from('gps_history')
              .select('*')
              .neq('source', 'browser')
              .order('server_time', { ascending: false, nullsFirst: false })
              .limit(25)
          ]);
          if (!posRes.error && Array.isArray(posRes.data)) {
            posRes.data.forEach(applyIncomingLiveRow);
          }
          if (!histRes.error && Array.isArray(histRes.data) && histRes.data.length > 0) {
            // Feed oldest-to-newest so the newest row ends up on top of History Log
            for (let i = histRes.data.length - 1; i >= 0; i--) {
              appendHistoryPoint(histRes.data[i], true);
            }
          }
        } catch {
          // Ignore transient network hiccups during background polling
        }
      }, 2000);
        
    } catch (err) {
      console.error(err);
      setSupaStatus(false);
    }
  };

  // Sync Traccar positions to live view and Supabase (handles both single live updates and bulk history backfill)
  useEffect(() => {
    if (!traccarPositions || traccarPositions.length === 0) return;
    const validPositions = traccarPositions.filter(
      (tp: any) => tp && String(tp.deviceId) !== '98615' && (tp.latitude !== 0 || tp.longitude !== 0)
    );
    if (validPositions.length === 0) return;

    const now = new Date().toISOString();
    const latestByDev: Record<string, Position> = {};
    const historyToUpsert: any[] = [];

    validPositions.forEach((tp: any) => {
      const devId = `Traccar_${tp.deviceId}`;
      const rawTime = tp.fixTime || tp.deviceTime;
      const devTime = rawTime ? new Date(rawTime).toISOString() : now;
      const srvTime = tp.serverTime ? new Date(tp.serverTime).toISOString() : now;
      const speedKmH = tp.speed ? parseFloat((tp.speed * 1.852).toFixed(1)) : 0;

      const pos: Position = {
        device_id: devId,
        device_name: devId,
        latitude: tp.latitude,
        longitude: tp.longitude,
        speed: speedKmH,
        accuracy: tp.accuracy || null,
        source: 'traccar',
        is_online: true,
        device_time: devTime,
        server_time: srvTime,
        updated_at: now,
      };

      const prevLatest = latestByDev[devId];
      if (!prevLatest || new Date(devTime).getTime() >= new Date(prevLatest.device_time || 0).getTime()) {
        latestByDev[devId] = pos;
      }

      const last = lastTraccarRecordRef.current[devId];
      const isBulkBackfill = validPositions.length > 1;
      const dist = last ? haversine(last.lat, last.lng, tp.latitude, tp.longitude) : 999;
      const elapsed = last ? Date.now() - last.time : 999999;

      if (isBulkBackfill || !last || last.devTime !== devTime || dist > 1 || elapsed > 10000) {
        lastTraccarRecordRef.current[devId] = { lat: tp.latitude, lng: tp.longitude, time: Date.now(), devTime };
        appendHistoryPoint(
          {
            id: `local_${devId}_${devTime}`,
            device_id: devId,
            latitude: tp.latitude,
            longitude: tp.longitude,
            speed: speedKmH,
            accuracy: tp.accuracy || null,
            source: 'traccar',
            device_time: devTime,
            server_time: srvTime,
          },
          !isBulkBackfill
        );
        historyToUpsert.push({
          device_id: devId,
          latitude: tp.latitude,
          longitude: tp.longitude,
          speed: speedKmH,
          accuracy: tp.accuracy || null,
          source: 'traccar',
          device_time: devTime,
          server_time: srvTime,
        });
      }
    });

    setLivePos((prev) => ({ ...prev, ...latestByDev }));

    if (supabase && isTrack) {
      Object.values(latestByDev).forEach((pos) => {
        supabase
          .from('gps_positions')
          .upsert(
            {
              device_id: pos.device_id,
              device_name: pos.device_name,
              latitude: pos.latitude,
              longitude: pos.longitude,
              speed: pos.speed,
              accuracy: pos.accuracy,
              source: 'traccar',
              is_online: true,
              device_time: pos.device_time,
              server_time: pos.server_time,
              updated_at: now,
            },
            { onConflict: 'device_id' }
          )
          .then();
      });

      if (historyToUpsert.length > 0) {
        // Deduplicate by device_id + device_time before batch upserting
        const dedupMap = new Map<string, any>();
        historyToUpsert.forEach((row) => dedupMap.set(`${row.device_id}|${row.device_time}`, row));
        const uniqueRows = Array.from(dedupMap.values());
        (async () => {
          const chunkSize = 250;
          for (let i = 0; i < uniqueRows.length; i += chunkSize) {
            const chunk = uniqueRows.slice(i, i + chunkSize);
            await supabase.from('gps_history').upsert(chunk, { onConflict: 'device_id,device_time' });
          }
          if (uniqueRows.length > 1) {
            loadSourceBreakdown(supabase);
          }
        })();
      }
    }
  }, [traccarPositions, supabase, isTrack, setLivePos, appendHistoryPoint, loadSourceBreakdown]);

  // Handlers
  const toggleTracking = () => setIsTrack(!isTrack);
  
  const handleClear = async () => {
    if (!supabase || !confirm('⚠️ ลบประวัติเส้นทางทั้งหมด?')) return;
    await supabase.from('gps_history').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('gps_positions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    lastHistoryRecordRef.current = null;
    lastTraccarRecordRef.current = {};
    lastIoTRecordRef.current = {};
    histKeySetRef.current.clear();
    setLivePos({});
    setHistArr([]);
    setHistoryPageRows([]);
    setTotalHistoryCount(0);
    setSourceHistoryRows({ native: [], traccar: [], iot: [] });
    setSourceCounts({ all: 0, native: 0, traccar: 0, iot: 0 });
    setHistoryPage(1);
    setServerCentroid(null);
    setServerDeviceRows(null);
    setClearSignal(c => c + 1);
  };

  // Data processing
  const liveValues = Object.values(livePos).filter(p => p.source !== 'browser');
  const filteredLive = liveValues.filter(p => (filter.src === 'all' || p.source === filter.src) && (filter.dev === 'all' || p.device_id === filter.dev));
  const filteredHist = histArr.filter(p => p.source !== 'browser' && (filter.src === 'all' || p.source === filter.src) && (filter.dev === 'all' || p.device_id === filter.dev));

  const stats = {
    all: liveValues.length,
    native: liveValues.filter(p => p.source === 'native').length,
    iot: liveValues.filter(p => p.source === 'iot').length,
    traccar: liveValues.filter(p => p.source === 'traccar').length
  };

  const deviceOptions = Array.from(new Set([
    ...liveValues.map((p: any) => p.device_id),
    ...histArr.map((p: any) => p.device_id)
  ])).filter(Boolean);

  // Automatic real-time Accuracy Analysis (prefers full-DB Server SQL RPCs when installed)
  const resolvedReference = useMemo(() => {
    void analysisTick;
    const validHist = histArr.filter(isValidCoord);
    const validLive = liveValues.filter(isValidCoord);
    const allValid = validHist.length > 0 ? validHist : validLive;

    let resolvedLat: number | null = null;
    let resolvedLng: number | null = null;
    let statusMsg = 'กำลังคำนวณ...';

    if (refMode === 'centroid') {
      if (serverCentroid && serverCentroid.total > 0) {
        resolvedLat = serverCentroid.lat;
        resolvedLng = serverCentroid.lng;
        statusMsg = `✓ Auto Centroid (จากฐานข้อมูลทั้งหมด ${serverCentroid.total.toLocaleString()} จุด)`;
      } else if (allValid.length > 0) {
        resolvedLat = allValid.reduce((sum, p) => sum + p.latitude, 0) / allValid.length;
        resolvedLng = allValid.reduce((sum, p) => sum + p.longitude, 0) / allValid.length;
        statusMsg = `✓ Auto Centroid (ค่าเฉลี่ยจาก ${allValid.length.toLocaleString()} จุดตัวอย่าง)`;
      } else {
        statusMsg = 'รอข้อมูลพิกัดเพื่อคำนวณอัตโนมัติ...';
      }
    } else if (refMode === 'device') {
      const targetId = refDeviceId || deviceOptions[0] || '';
      const targetPoint =
        validLive.find(p => p.device_id === targetId) ||
        validHist.find(p => p.device_id === targetId) ||
        null;
      if (targetPoint) {
        resolvedLat = targetPoint.latitude;
        resolvedLng = targetPoint.longitude;
        statusMsg = `✓ เทียบกับพิกัดล่าสุดของ "${targetId}"`;
      } else {
        statusMsg = targetId ? `❌ ไม่พบพิกัดของ "${targetId}"` : 'ยังไม่มี Device ให้เลือก';
      }
    } else if (refMode === 'kml') {
      if (kmlRoute && kmlRoute.points.length > 0) {
        const mid = kmlRoute.points[Math.floor(kmlRoute.points.length / 2)];
        resolvedLat = mid.lat;
        resolvedLng = mid.lng;
        statusMsg = `✓ เทียบกับ KML Main Route: "${kmlRoute.name}" (${kmlRoute.points.length} จุด)`;
      } else {
        statusMsg = '📂 กรุณาอัปโหลดไฟล์ .kml เส้นทางหลักเพื่อคำนวณเทียบ';
      }
    } else {
      const latNum = parseFloat(refLat);
      const lngNum = parseFloat(refLng);
      if (!isNaN(latNum) && !isNaN(lngNum)) {
        resolvedLat = latNum;
        resolvedLng = lngNum;
        statusMsg = `✓ คำนวณอัตโนมัติจากพิกัดที่กำหนด (${(totalHistoryCount || allValid.length).toLocaleString()} จุด)`;
      } else {
        statusMsg = 'กรุณากรอก Latitude และ Longitude ให้ครบ';
      }
    }

    return { resolvedLat, resolvedLng, statusMsg, validHist, validLive };
  }, [analysisTick, refMode, refDeviceId, refLat, refLng, histArr, liveValues, deviceOptions, serverCentroid, totalHistoryCount, kmlRoute]);

  // Query server-side million-row SQL analysis RPC whenever Analysis is open and reference changes
  useEffect(() => {
    if (!isAnalysisOpen || !supabase || refMode === 'kml') {
      setServerDeviceRows(null);
      return;
    }
    const { resolvedLat, resolvedLng } = resolvedReference;
    if (resolvedLat === null || resolvedLng === null) {
      setServerDeviceRows(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('get_accuracy_analysis', {
          p_ref_lat: resolvedLat,
          p_ref_lng: resolvedLng
        });
        if (!cancelled && !error && Array.isArray(data) && data.length > 0) {
          const mapped: DeviceAnalysisRow[] = data
            .filter((r: any) => r.source !== 'browser')
            .map((r: any) => ({
              deviceId: r.device_id,
              source: r.source || 'unknown',
              samples: Number(r.samples) || 0,
              meanError: Number(r.mean_error) || 0,
              stdDev: Number(r.std_dev) || 0,
              min: Number(r.min_error) || 0,
              max: Number(r.max_error) || 0,
              avgAcc: r.avg_acc != null ? Number(r.avg_acc) : '-'
            }));
          setServerDeviceRows(mapped);
        } else if (!cancelled && error) {
          setServerDeviceRows(null);
        }
      } catch {
        if (!cancelled) setServerDeviceRows(null);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isAnalysisOpen, supabase, resolvedReference]);

  const autoAnalysis = useMemo(() => {
    const { resolvedLat, resolvedLng, statusMsg, validHist, validLive } = resolvedReference;
    const activeKmlPoints = refMode === 'kml' && kmlRoute ? kmlRoute.points : null;

    if (resolvedLat === null || resolvedLng === null) {
      return {
        displayLat: refMode === 'manual' ? refLat : '',
        displayLng: refMode === 'manual' ? refLng : '',
        statusMsg,
        traccarStats: DEFAULT_ANALYSIS_STATS,
        iotStats: DEFAULT_ANALYSIS_STATS,
        nativeStats: DEFAULT_ANALYSIS_STATS,
        deviceRows: [] as DeviceAnalysisRow[],
        comparisonMetrics: kmlRoute ? [computeKmlBaselineMetrics(kmlRoute)] : ([] as RouteComparisonMetrics[]),
        bestSummary: null as { label: string; meanError: number; samples: number } | null
      };
    }

    const getSourcePoints = (source: string) => {
      const fromHist = validHist.filter(d => d.source === source);
      return fromHist.length > 0 ? fromHist : validLive.filter(d => d.source === source);
    };

    const byDevice = new Map<string, Position[]>();
    validHist.forEach(p => {
      const list = byDevice.get(p.device_id) || [];
      list.push(p);
      byDevice.set(p.device_id, list);
    });
    validLive.forEach(p => {
      if (!byDevice.has(p.device_id)) {
        byDevice.set(p.device_id, [p]);
      }
    });

    let deviceRows: DeviceAnalysisRow[];
    let ts: AnalysisStats;
    let is: AnalysisStats;
    let ns: AnalysisStats;
    let finalStatus = statusMsg;

    if (!activeKmlPoints && serverDeviceRows && serverDeviceRows.length > 0) {
      deviceRows = serverDeviceRows.map(r => {
        const pts = byDevice.get(r.deviceId) || [];
        const tm = computeTelemetryMetrics(pts, {
          id: r.deviceId,
          label: r.deviceId,
          source: r.source,
          overrideAvgErrorM: r.meanError,
          overrideSamples: r.samples,
        });
        return {
          ...r,
          updateIntervalS: tm.updateIntervalS,
          avgSpeedMs: tm.avgSpeedMs,
          dataConsistencyPct: tm.dataConsistencyPct,
          availabilityPct: tm.availabilityPct,
        };
      });
      const aggregateSource = (src: string): AnalysisStats => {
        const rows = serverDeviceRows.filter(r => r.source === src && r.samples > 0);
        if (rows.length === 0) return DEFAULT_ANALYSIS_STATS;
        const totalN = rows.reduce((s, r) => s + r.samples, 0);
        const weightedMean = rows.reduce((s, r) => s + r.meanError * r.samples, 0) / totalN;
        const weightedStd = rows.reduce((s, r) => s + r.stdDev * r.samples, 0) / totalN;
        const minErr = Math.min(...rows.map(r => r.min));
        const maxErr = Math.max(...rows.map(r => r.max));
        const accRows = rows.filter(r => typeof r.avgAcc === 'number');
        const avgAcc =
          accRows.length > 0
            ? parseFloat(
                (
                  accRows.reduce((s, r) => s + Number(r.avgAcc) * r.samples, 0) /
                  accRows.reduce((s, r) => s + r.samples, 0)
                ).toFixed(2)
              )
            : '-';
        return {
          samples: totalN,
          meanError: parseFloat(weightedMean.toFixed(2)),
          stdDev: parseFloat(weightedStd.toFixed(2)),
          min: parseFloat(minErr.toFixed(2)),
          max: parseFloat(maxErr.toFixed(2)),
          avgAcc,
          barWidth: 0
        };
      };
      ts = aggregateSource('traccar');
      is = aggregateSource('iot');
      ns = aggregateSource('native');
      const totalAnalyzed = serverDeviceRows.reduce((s, r) => s + r.samples, 0);
      finalStatus = `${statusMsg} • คำนวณ SQL เต็มฐานข้อมูล ${totalAnalyzed.toLocaleString()} แถว`;
    } else {
      ts = computeStatsForPoints(getSourcePoints('traccar'), resolvedLat, resolvedLng, activeKmlPoints);
      is = computeStatsForPoints(getSourcePoints('iot'), resolvedLat, resolvedLng, activeKmlPoints);
      ns = computeStatsForPoints(getSourcePoints('native'), resolvedLat, resolvedLng, activeKmlPoints);

      deviceRows = Array.from(byDevice.entries())
        .map(([deviceId, pts]) => {
          const st = computeStatsForPoints(pts, resolvedLat, resolvedLng, activeKmlPoints);
          const tm = computeTelemetryMetrics(pts, {
            id: deviceId,
            label: deviceId,
            source: pts[0]?.source || 'unknown',
            kmlRoute: activeKmlPoints,
            refLat: resolvedLat,
            refLng: resolvedLng,
          });
          return {
            deviceId,
            source: pts[0]?.source || 'unknown',
            samples: Number(st.samples) || 0,
            meanError: typeof st.meanError === 'number' ? st.meanError : 0,
            stdDev: typeof st.stdDev === 'number' ? st.stdDev : 0,
            min: typeof st.min === 'number' ? st.min : 0,
            max: typeof st.max === 'number' ? st.max : 0,
            avgAcc: st.avgAcc,
            updateIntervalS: tm.updateIntervalS,
            avgSpeedMs: tm.avgSpeedMs,
            dataConsistencyPct: tm.dataConsistencyPct,
            availabilityPct: tm.availabilityPct,
          };
        })
        .filter(r => r.samples > 0)
        .sort((a, b) => a.meanError - b.meanError);
    }

    const comparisonMetrics: RouteComparisonMetrics[] = [];
    const sourceColumns: Array<{ src: string; label: string; stats: AnalysisStats }> = [
      { src: 'iot', label: 'IoT Data', stats: is },
      { src: 'traccar', label: 'API (Traccar)', stats: ts },
      { src: 'native', label: 'Native (Android)', stats: ns },
    ];
    for (const col of sourceColumns) {
      const pts = getSourcePoints(col.src);
      const hasStats = typeof col.stats.samples === 'number' && col.stats.samples > 0;
      if (pts.length === 0 && !hasStats) continue;
      comparisonMetrics.push(
        computeTelemetryMetrics(pts, {
          id: `src_${col.src}`,
          label: col.label,
          source: col.src,
          kmlRoute: activeKmlPoints,
          refLat: resolvedLat,
          refLng: resolvedLng,
          overrideAvgErrorM: typeof col.stats.meanError === 'number' ? col.stats.meanError : null,
          overrideSamples: typeof col.stats.samples === 'number' ? col.stats.samples : null,
        })
      );
    }
    if (kmlRoute && kmlRoute.points.length > 0) {
      comparisonMetrics.push(computeKmlBaselineMetrics(kmlRoute));
    }

    const maxGlobalError = Math.max(
      typeof ts.meanError === 'number' ? ts.meanError : 0,
      typeof is.meanError === 'number' ? is.meanError : 0,
      typeof ns.meanError === 'number' ? ns.meanError : 0
    );
    if (maxGlobalError > 0) {
      if (typeof ts.meanError === 'number') ts.barWidth = Math.min(100, (ts.meanError / maxGlobalError) * 100);
      if (typeof is.meanError === 'number') is.barWidth = Math.min(100, (is.meanError / maxGlobalError) * 100);
      if (typeof ns.meanError === 'number') ns.barWidth = Math.min(100, (ns.meanError / maxGlobalError) * 100);
    }

    const sourceCandidates = [
      { label: 'Native (Android)', stats: ns },
      { label: 'Traccar', stats: ts },
      { label: 'IoT (ESP32)', stats: is }
    ]
      .filter(c => typeof c.stats.meanError === 'number' && typeof c.stats.samples === 'number' && c.stats.samples > 0)
      .sort((a, b) => (a.stats.meanError as number) - (b.stats.meanError as number));

    const bestSummary =
      deviceRows.length > 0
        ? { label: deviceRows[0].deviceId, meanError: deviceRows[0].meanError, samples: deviceRows[0].samples }
        : sourceCandidates.length > 0
        ? {
            label: sourceCandidates[0].label,
            meanError: sourceCandidates[0].stats.meanError as number,
            samples: sourceCandidates[0].stats.samples as number
          }
        : null;

    return {
      displayLat: refMode === 'manual' ? refLat : resolvedLat.toFixed(6),
      displayLng: refMode === 'manual' ? refLng : resolvedLng.toFixed(6),
      statusMsg: finalStatus,
      traccarStats: ts,
      iotStats: is,
      nativeStats: ns,
      deviceRows,
      comparisonMetrics,
      bestSummary
    };
  }, [resolvedReference, serverDeviceRows, refMode, refLat, refLng, kmlRoute]);

  // Analysis Handlers
  const handleUploadKml = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseKmlRoute(text, file.name);
      if (parsed.points.length === 0) {
        alert('ไม่พบพิกัดในไฟล์ KML นี้ (รองรับ LineString, gx:Track และ Point)');
        return;
      }
      setKmlRoute(parsed);
      setRefMode('kml');
      setAnalysisTick(t => t + 1);
    } catch (err: any) {
      alert(err?.message || 'อ่านไฟล์ KML ไม่สำเร็จ');
    }
  };

  const handleClearKml = () => {
    setKmlRoute(null);
    if (refMode === 'kml') setRefMode('centroid');
  };

  // Analysis Handlers
  const handleRunAnalysis = () => {
    setAnalysisTick(t => t + 1);
  };

  const handleResetAnalysis = () => {
    setRefMode('centroid');
    setRefDeviceId('');
    setRefLat('');
    setRefLng('');
  };

  const handleExportCSV = async (overrideSrc?: string) => {
    const targetSrc = typeof overrideSrc === 'string' && overrideSrc.length > 0 ? overrideSrc : filter.src;
    if (exportProgress) return;
    setExportProgress('กำลังดึงข้อมูล 0 แถว...');

    let exportRows: any[] = [];
    try {
      if (supabase) {
        let totalFetchedSoFar = 0;
        const fetchAllForSource = async (src: string) => {
          const rows: any[] = [];
          const chunkSize = 1000;
          let offset = 0;
          // Loop until all rows for this source are fetched (no artificial row cap)
          while (true) {
            let query = supabase
              .from('gps_history')
              .select('*')
              .eq('source', src)
              .neq('device_id', 'Traccar_98615');
            if (filter.dev !== 'all') query = query.eq('device_id', filter.dev);
            const { data, error } = await query
              .order('device_time', { ascending: false, nullsFirst: false })
              .order('id', { ascending: false })
              .range(offset, offset + chunkSize - 1);
            if (error || !Array.isArray(data) || data.length === 0) break;
            rows.push(...data);
            totalFetchedSoFar += data.length;
            setExportProgress(`กำลังดึงข้อมูล... ${totalFetchedSoFar.toLocaleString()} แถว`);
            if (data.length < chunkSize) break;
            offset += chunkSize;
          }
          return rows;
        };

        if (targetSrc !== 'all') {
          exportRows = await fetchAllForSource(targetSrc);
        } else {
          // Fetch 100% of rows for each source in parallel so high-frequency 5Hz IoT never truncates Native or Traccar
          const [nativeRows, traccarRows, iotRows] = await Promise.all([
            fetchAllForSource('native'),
            fetchAllForSource('traccar'),
            fetchAllForSource('iot'),
          ]);
          exportRows = [...nativeRows, ...traccarRows, ...iotRows].sort((a, b) => {
            const ta = new Date(a.device_time || a.server_time || 0).getTime();
            const tb = new Date(b.device_time || b.server_time || 0).getTime();
            return tb - ta;
          });
        }
      }
      if (exportRows.length === 0) {
        exportRows =
          targetSrc === 'all'
            ? filteredHist
            : filteredHist.filter((r) => r.source === targetSrc);
      }
      if (exportRows.length === 0) {
        alert('ไม่มีข้อมูล History สำหรับ Export');
        return;
      }

      const headers =
        'id,device_id,source,latitude,longitude,speed,accuracy,recorded_date,recorded_time,device_time,server_time\n';
      const csvBody = exportRows
        .map((d) => {
          const rawTime = d.device_time || d.recorded_at || d.updated_at || '';
          let dateStr = '';
          let timeStr = '';
          if (rawTime) {
            const dt = new Date(rawTime);
            if (!isNaN(dt.getTime())) {
              dateStr = dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
              timeStr = dt.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
            }
          }
          return `${d.id},${d.device_id},${d.source},${d.latitude},${d.longitude},${d.speed ?? 0},${d.accuracy ?? ''},${dateStr},${timeStr},${d.device_time || d.recorded_at || ''},${d.server_time || d.updated_at || ''}`;
        })
        .join('\n');

      // Prepend UTF-8 BOM (\uFEFF) so Excel on Windows reads Thai characters and columns cleanly
      const blob = new Blob(['\uFEFF' + headers + csvBody], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix = targetSrc === 'all' ? 'all_sources' : targetSrc;
      a.download = `omni_history_${suffix}_${exportRows.length}rows_${new Date().getTime()}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } finally {
      setExportProgress(null);
    }
  };

  const handleToggleAnalysis = () => {
    setIsAnalysisOpen(prev => {
      const next = !prev;
      if (next) {
        setTimeout(() => {
          document.getElementById('analysis')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header 
        theme={theme} 
        lang={lang}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        onToggleLang={() => setLang(l => l === 'th' ? 'en' : 'th')}
        traccarError={traccarError}
        status={{ supabase: supaStatus, traccar: traccarConnected }}
      />
      
      <ControlBar 
        isTracking={isTrack}
        onToggleTracking={toggleTracking}
        onFilterChange={(src, dev) => {
          setFilter({ src, dev });
          loadHistoryPage(1, src, dev);
          loadSourceBreakdown(supabase, dev);
        }}
        currentSrc={filter.src}
        currentDev={filter.dev}
        deviceOptions={deviceOptions}
        onExport={() => handleExportCSV()}
        onClear={handleClear}
        onToggleAnalysis={handleToggleAnalysis}
      />

      <MapArea stats={stats} theme={theme} liveData={filteredLive as any} historyData={filteredHist as any} clearSignal={clearSignal} kmlRoute={kmlRoute?.points} />
      
      <DataTables
        liveData={filteredLive as any}
        historyData={(historyPageRows.length > 0 || totalHistoryCount > 0 ? historyPageRows : filteredHist) as any}
        totalHistoryCount={sourceCounts.all || totalHistoryCount || filteredHist.length}
        historyPage={historyPage}
        historyPageSize={HISTORY_PAGE_SIZE}
        onHistoryPageChange={(nextPage) => loadHistoryPage(nextPage, filter.src, filter.dev)}
        isHistoryLoading={isHistoryLoading}
        onLoadArchivedPoints={(rows) => {
          rows.forEach((r) => appendHistoryPoint(r, false));
        }}
        sourceHistoryRows={sourceHistoryRows as any}
        sourceCounts={sourceCounts}
        currentSrcFilter={filter.src}
        onSourceTabChange={(nextSrc) => {
          setFilter({ src: nextSrc, dev: filter.dev });
          loadHistoryPage(1, nextSrc, filter.dev);
        }}
        onExportSource={(targetSrc) => handleExportCSV(targetSrc)}
        exportProgress={exportProgress}
      />

      <AnalysisPanel 
        isVisible={isAnalysisOpen}
        onClose={() => setIsAnalysisOpen(false)}
        onRunAnalysis={handleRunAnalysis}
        onExportCSV={() => handleExportCSV()}
        onReset={handleResetAnalysis}
        refMode={refMode}
        onRefModeChange={(mode) => {
          if (mode === 'manual' && refMode !== 'manual') {
            setRefLat(autoAnalysis.displayLat);
            setRefLng(autoAnalysis.displayLng);
          }
          setRefMode(mode);
        }}
        refDeviceId={refDeviceId || deviceOptions[0] || ''}
        onRefDeviceIdChange={setRefDeviceId}
        deviceOptions={deviceOptions}
        refLat={autoAnalysis.displayLat}
        refLng={autoAnalysis.displayLng}
        onRefLatChange={setRefLat}
        onRefLngChange={setRefLng}
        refStatus={autoAnalysis.statusMsg}
        iotStats={autoAnalysis.iotStats}
        traccarStats={autoAnalysis.traccarStats}
        nativeStats={autoAnalysis.nativeStats}
        deviceRows={autoAnalysis.deviceRows}
        bestSummary={autoAnalysis.bestSummary}
        kmlRoute={kmlRoute}
        onUploadKml={handleUploadKml}
        onClearKml={handleClearKml}
        comparisonMetrics={autoAnalysis.comparisonMetrics}
      />
    </div>
  );
}


