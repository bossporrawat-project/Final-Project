'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header from '@/components/Header';
import ControlBar from '@/components/ControlBar';
import MapArea from '@/components/MapArea';
import DataTables from '@/components/DataTables';
import AnalysisPanel from '@/components/AnalysisPanel';

import { useLivePositions, useHistory, useTrackingSettings, Position } from '@/hooks/useOmniState';
import { useBrowserGPS } from '@/hooks/useBrowserGPS';
import { useTraccar } from '@/hooks/useTraccar';
import { useIoT } from '@/hooks/useIoT';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { haversine, AnalysisStats } from '@/utils/calculations';

const DEFAULT_SUPABASE_URL = 'https://ryuhkaytmlapkuumgnlo.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dWhrYXl0bWxhcGt1dW1nbmxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MzY4MjUsImV4cCI6MjEwNzExMjgyNX0.JYKrvAMK64xE5r92pepQy02fVl4mO55dMaz93heaee8';
const DEFAULT_TRACCAR_TOKEN = 'RzBFAiEA0r4vWkHt8kbO4UUdUzpnQtp9kt8u-tCZpnGyuiOYnSMCIDdBykoJyep_WQyh3vNAFGJZz9anp4tVp3sJi6vi3mq3eyJpIjo3Mjg1Mzk1MjE3NTUyMDI5NTYxLCJ1IjoxNDg3MTYsImUiOiIyMDMwLTAxLTAxVDAwOjAwOjAwLjAwMCswMDowMCJ9';

export default function Dashboard() {
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [lang, setLang] = useState<'th' | 'en'>('th');
  const [myDevice, setMyDevice] = useState<string>('—');
  const [supaStatus, setSupaStatus] = useState(false);
  const [traccarStatus, setTraccarStatus] = useState(false);

  // Analysis States
  const [refLat, setRefLat] = useState('');
  const [refLng, setRefLng] = useState('');
  const [refStatus, setRefStatus] = useState('ไม่ได้ตั้งค่า');
  const defaultStats: AnalysisStats = { samples: '-', meanError: '-', stdDev: '-', min: '-', max: '-', avgAcc: '-', barWidth: 0 };
  const [browserStats, setBrowserStats] = useState<AnalysisStats>(defaultStats);
  const [iotStats, setIotStats] = useState<AnalysisStats>(defaultStats);
  const [traccarStats, setTraccarStats] = useState<AnalysisStats>(defaultStats);
  const [nativeStats, setNativeStats] = useState<AnalysisStats>(defaultStats);
  const lastHistoryRecordRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const lastTraccarRecordRef = useRef<Record<string, { lat: number; lng: number; time: number }>>({});
  const lastIoTRecordRef = useRef<Record<string, { lat: number; lng: number; timeStr: string; time: number }>>({});
  const livePollRef = useRef<NodeJS.Timeout | null>(null);

  // States from hooks
  const { livePos, setLivePos } = useLivePositions();
  const { histArr, setHistArr } = useHistory();
  const { filter, setFilter, isTrack, setIsTrack, gpsOn, setGpsOn } = useTrackingSettings();

  // Connection hooks
  const { startGPS, stopGPS, position: gpsPosition, gpsOn: browserGpsActive, error: gpsError } = useBrowserGPS();
  const { connect: connectTraccar, disconnect: disconnectTraccar, positions: traccarPositions, isConnected: traccarConnected, error: traccarError } = useTraccar();
  const { positions: iotPositions } = useIoT(true);

  const [supabase, setSupabase] = useState<any>(null);
  const [clearSignal, setClearSignal] = useState(0);

  const appendHistoryPoint = useCallback((pt: Position) => {
    if (!pt || !pt.device_id || (pt.latitude === 0 && pt.longitude === 0)) return;
    setHistArr(prev => {
      const ptTime = pt.device_time || pt.recorded_at || pt.updated_at || '';
      const exists = prev.some(p =>
        (pt.id && p.id === pt.id) ||
        (p.device_id === pt.device_id &&
          (p.device_time || p.recorded_at || p.updated_at || '') === ptTime &&
          Math.abs(p.latitude - pt.latitude) < 1e-6 &&
          Math.abs(p.longitude - pt.longitude) < 1e-6)
      );
      if (exists) return prev;
      return [pt, ...prev];
    });
  }, [setHistArr]);

  useEffect(() => {
    if (gpsError && !gpsError.toLowerCase().includes('timeout')) {
      alert(`⚠️ Browser GPS Error:\n${gpsError}\n\nPlease check your browser's location permissions or Windows location settings.`);
    }
  }, [gpsError]);

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
    const savedTrcToken = localStorage.getItem('omni_traccar_token');
    const validSavedToken = savedTrcToken && !savedTrcToken.startsWith('SDBGAiEAtq5U') ? savedTrcToken : null;
    const token = validSavedToken || process.env.NEXT_PUBLIC_TRACCAR_TOKEN || DEFAULT_TRACCAR_TOKEN;
    if (savedTrcToken && savedTrcToken.startsWith('SDBGAiEAtq5U')) {
      localStorage.setItem('omni_traccar_token', token);
    }

    setMyDevice(name || 'ESP32_Tracker');
    initializeSupabase(url, key);
    if (token) connectTraccar(token);

    return () => {
      if (livePollRef.current) {
        clearInterval(livePollRef.current);
        livePollRef.current = null;
      }
    };
  }, []);

  const initializeSupabase = async (url: string, key: string) => {
    try {
      if (livePollRef.current) {
        clearInterval(livePollRef.current);
        livePollRef.current = null;
      }

      const client = getSupabaseClient(url, key);
      setSupabase(client);
      setSupaStatus(true);
      // Fetch initial data ordered by actual server arrival time so skewed device clocks don't bury live records
      const { data: liveData } = await client
        .from('gps_positions')
        .select('*')
        .order('updated_at', { ascending: false, nullsFirst: false });
      const { data: historyData } = await client
        .from('gps_history')
        .select('*')
        .order('server_time', { ascending: false, nullsFirst: false })
        .limit(10000);
      
      const lastSeenSigByDev: Record<string, string> = {};
      if (liveData) {
        const liveMap: Record<string, any> = {};
        liveData.forEach((r: any) => {
          liveMap[r.device_id] = r;
          lastSeenSigByDev[r.device_id] = `${r.updated_at || ''}|${r.device_time || ''}|${r.latitude}|${r.longitude}|${r.speed}`;
        });
        setLivePos(liveMap);
      }
      if (historyData) setHistArr(historyData);

      client.removeAllChannels();

      const applyIncomingLiveRow = (r: any) => {
        if (!r || !r.device_id) return;
        const sig = `${r.updated_at || ''}|${r.device_time || ''}|${r.latitude}|${r.longitude}|${r.speed}`;
        if (lastSeenSigByDev[r.device_id] === sig) return;
        lastSeenSigByDev[r.device_id] = sig;

        setLivePos(prev => ({ ...prev, [r.device_id]: r }));
        if (r.latitude !== 0 || r.longitude !== 0) {
          appendHistoryPoint({
            ...r,
            id: `${r.device_id}_${r.device_time || r.updated_at}_${r.latitude}_${r.longitude}`
          });
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
          appendHistoryPoint(payload.new);
        }).subscribe();

      // Resilient polling fallback so Live Tracking Comparison stays real-time even if WebSocket stalls
      livePollRef.current = setInterval(async () => {
        try {
          const { data: latestRows, error } = await client
            .from('gps_positions')
            .select('*')
            .order('updated_at', { ascending: false, nullsFirst: false });
          if (!error && Array.isArray(latestRows)) {
            latestRows.forEach(applyIncomingLiveRow);
          }
        } catch {
          // Ignore transient network hiccups during background polling
        }
      }, 2500);
        
    } catch (err) {
      console.error(err);
      setSupaStatus(false);
    }
  };

  const handleChangeDeviceName = () => {
    const newName = window.prompt('กรุณาระบุชื่อ Device ใหม่สำหรับ Browser:', myDevice);
    if (newName && newName.trim() !== '') {
      const trimmed = newName.trim();
      localStorage.setItem('omni_device_name', trimmed);
      setMyDevice(trimmed);
    }
  };

  // Sync GPS to live view immediately & persist to Supabase when tracking is active
  useEffect(() => {
    if (!gpsPosition) return;
    const now = new Date().toISOString();
    const devTime = gpsPosition.timestamp || now;

    // Update Browser card & map immediately without waiting for Supabase Realtime round-trip
    setLivePos(prev => ({
      ...prev,
      [myDevice]: {
        device_id: myDevice,
        device_name: myDevice,
        latitude: gpsPosition.latitude,
        longitude: gpsPosition.longitude,
        speed: gpsPosition.speed,
        accuracy: gpsPosition.accuracy,
        source: 'browser',
        is_online: true,
        device_time: devTime,
        server_time: now,
        updated_at: now
      }
    }));

    if (supabase && isTrack) {
      // 1. Always update live position heartbeat
      supabase.from('gps_positions').upsert({
        device_id: myDevice, device_name: myDevice,
        latitude: gpsPosition.latitude, longitude: gpsPosition.longitude,
        speed: gpsPosition.speed, accuracy: gpsPosition.accuracy,
        source: 'browser', is_online: true,
        device_time: devTime, server_time: now, updated_at: now
      }, { onConflict: 'device_id' }).then();
      
      // 2. Only record into history if moved > 3 meters or > 30s elapsed
      const last = lastHistoryRecordRef.current;
      const dist = last ? haversine(last.lat, last.lng, gpsPosition.latitude, gpsPosition.longitude) : 999;
      const elapsed = last ? (Date.now() - last.time) : 999999;

      if (!last || dist > 3 || elapsed > 30000) {
        lastHistoryRecordRef.current = { lat: gpsPosition.latitude, lng: gpsPosition.longitude, time: Date.now() };
        appendHistoryPoint({
          id: `local_${myDevice}_${devTime}`,
          device_id: myDevice,
          latitude: gpsPosition.latitude,
          longitude: gpsPosition.longitude,
          speed: gpsPosition.speed,
          accuracy: gpsPosition.accuracy,
          source: 'browser',
          device_time: devTime,
          server_time: now
        });
        supabase.from('gps_history').insert({
          device_id: myDevice, latitude: gpsPosition.latitude, longitude: gpsPosition.longitude,
          speed: gpsPosition.speed, accuracy: gpsPosition.accuracy,
          source: 'browser',
          device_time: devTime, server_time: now
        }).then(({ error }: any) => {
          if (error) console.error('Insert gps_history error:', error);
        });
      }
    }
  }, [gpsPosition, supabase, isTrack, myDevice, appendHistoryPoint, setLivePos]);

  // Sync Traccar positions to live view and Supabase
  useEffect(() => {
    if (traccarPositions && traccarPositions.length > 0) {
      traccarPositions.forEach((tp: any) => {
        const devId = `Traccar_${tp.deviceId}`;
        const rawTime = tp.deviceTime || tp.fixTime;
        const devTime = rawTime ? new Date(rawTime).toISOString() : new Date().toISOString();
        const now = new Date().toISOString();
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
          server_time: now,
          updated_at: now
        };

        setLivePos(prev => ({ ...prev, [devId]: pos }));

        if (supabase && isTrack) {
          supabase.from('gps_positions').upsert({
            device_id: devId, device_name: devId,
            latitude: tp.latitude, longitude: tp.longitude,
            speed: speedKmH, accuracy: tp.accuracy || null,
            source: 'traccar', is_online: true,
            device_time: devTime, server_time: now, updated_at: now
          }, { onConflict: 'device_id' }).then();

          const last = lastTraccarRecordRef.current[devId];
          const dist = last ? haversine(last.lat, last.lng, tp.latitude, tp.longitude) : 999;
          const elapsed = last ? (Date.now() - last.time) : 999999;

          if (!last || dist > 3 || elapsed > 30000) {
            lastTraccarRecordRef.current[devId] = { lat: tp.latitude, lng: tp.longitude, time: Date.now() };
            appendHistoryPoint({
              id: `local_${devId}_${devTime}`,
              device_id: devId,
              latitude: tp.latitude,
              longitude: tp.longitude,
              speed: speedKmH,
              accuracy: tp.accuracy || null,
              source: 'traccar',
              device_time: devTime,
              server_time: now
            });
            supabase.from('gps_history').upsert({
              device_id: devId,
              latitude: tp.latitude,
              longitude: tp.longitude,
              speed: speedKmH,
              accuracy: tp.accuracy || null,
              source: 'traccar',
              device_time: devTime,
              server_time: now
            }, { onConflict: 'device_id,device_time' }).then(({ error }: any) => {
              if (error) console.error('Insert Traccar gps_history error:', error);
            });
          }
        }
      });
    }
  }, [traccarPositions, supabase, isTrack, setLivePos, appendHistoryPoint]);

  // Sync IoT (ESP32 from Firebase iot-project-c13c9) positions to live view and Supabase
  useEffect(() => {
    if (iotPositions && iotPositions.length > 0) {
      iotPositions.forEach((ip) => {
        const devId = ip.deviceId;
        const now = new Date().toISOString();
        let devTime = now;
        if (ip.timeStr && /^\d{2}:\d{2}:\d{2}$/.test(ip.timeStr)) {
          const todayBkk = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
          const parsed = new Date(`${todayBkk}T${ip.timeStr}+07:00`);
          if (!isNaN(parsed.getTime())) devTime = parsed.toISOString();
        } else if (ip.timeStr) {
          const parsed = new Date(ip.timeStr);
          if (!isNaN(parsed.getTime())) devTime = parsed.toISOString();
        }

        const pos: Position = {
          device_id: devId,
          device_name: devId,
          latitude: ip.latitude,
          longitude: ip.longitude,
          speed: ip.speed,
          accuracy: ip.accuracy,
          source: 'iot',
          is_online: true,
          device_time: devTime,
          server_time: now,
          updated_at: now
        };

        setLivePos(prev => ({ ...prev, [devId]: pos }));

        if (supabase && isTrack) {
          const last = lastIoTRecordRef.current[devId];
          const isChanged = !last || last.timeStr !== ip.timeStr || haversine(last.lat, last.lng, ip.latitude, ip.longitude) > 1;
          if (isChanged) {
            lastIoTRecordRef.current[devId] = { lat: ip.latitude, lng: ip.longitude, timeStr: ip.timeStr, time: Date.now() };
            appendHistoryPoint({
              id: `local_${devId}_${devTime}`,
              device_id: devId,
              latitude: ip.latitude,
              longitude: ip.longitude,
              speed: ip.speed,
              accuracy: ip.accuracy,
              source: 'iot',
              device_time: devTime,
              server_time: now
            });
            supabase.from('gps_positions').upsert({
              device_id: devId, device_name: devId,
              latitude: ip.latitude, longitude: ip.longitude,
              speed: ip.speed, accuracy: ip.accuracy,
              source: 'iot', is_online: true,
              device_time: devTime, server_time: now, updated_at: now
            }, { onConflict: 'device_id' }).then();

            supabase.from('gps_history').upsert({
              device_id: devId,
              latitude: ip.latitude,
              longitude: ip.longitude,
              speed: ip.speed,
              accuracy: ip.accuracy,
              source: 'iot',
              device_time: devTime,
              server_time: now
            }, { onConflict: 'device_id,device_time' }).then(({ error }: any) => {
              if (error) console.error('Insert IoT gps_history error:', error);
            });
          }
        }
      });
    }
  }, [iotPositions, supabase, isTrack, setLivePos, appendHistoryPoint]);

  // Handlers
  const toggleTracking = () => setIsTrack(!isTrack);
  const toggleBrowserGPS = () => {
    if (browserGpsActive) { stopGPS(); setGpsOn(false); }
    else { startGPS(); setGpsOn(true); }
  };
  
  const handleClear = async () => {
    if (!supabase || !confirm('⚠️ ลบประวัติเส้นทางทั้งหมด?')) return;
    await supabase.from('gps_history').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('gps_positions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    lastHistoryRecordRef.current = null;
    lastTraccarRecordRef.current = {};
    lastIoTRecordRef.current = {};
    setLivePos({});
    setHistArr([]);
    setClearSignal(c => c + 1);
  };

  // Analysis Handlers
  const handleSetRefFromGPS = () => {
    if (gpsPosition) {
      setRefLat(gpsPosition.latitude.toFixed(6));
      setRefLng(gpsPosition.longitude.toFixed(6));
      setRefStatus('✓ ดึงพิกัด GPS สำเร็จ');
    } else {
      setRefStatus('❌ ไม่พบพิกัด GPS (เปิด Browser GPS ก่อน)');
    }
  };

  const handleRunAnalysis = () => {
    const lat = parseFloat(refLat);
    const lng = parseFloat(refLng);
    if (isNaN(lat) || isNaN(lng)) {
      setRefStatus('❌ พิกัดอ้างอิงไม่ถูกต้อง');
      return;
    }

    const calculateStats = (source: string) => {
      const data = histArr.filter(d => d.source === source);
      if (data.length === 0) return defaultStats;

      const errors = data.map(d => haversine(lat, lng, d.latitude, d.longitude));
      const mean = errors.reduce((a,b) => a+b, 0) / errors.length;
      const stdDev = Math.sqrt(errors.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / errors.length);
      const max = Math.max(...errors);
      const min = Math.min(...errors);
      const validAccs = data.filter(d => d.accuracy !== null).map(d => d.accuracy as number);
      const avgAcc = validAccs.length > 0 ? (validAccs.reduce((a,b) => a+b, 0) / validAccs.length) : '-';

      return {
        samples: data.length,
        meanError: parseFloat(mean.toFixed(2)),
        stdDev: parseFloat(stdDev.toFixed(2)),
        min: parseFloat(min.toFixed(2)),
        max: parseFloat(max.toFixed(2)),
        avgAcc: typeof avgAcc === 'number' ? parseFloat(avgAcc.toFixed(2)) : avgAcc,
        barWidth: 0
      };
    };

    const bs = calculateStats('browser');
    const ts = calculateStats('traccar');
    const is = calculateStats('iot');
    const ns = calculateStats('native');
    
    // Normalize barWidth relative to max error
    const maxGlobalError = Math.max(
      (bs.meanError as number) || 0, 
      (ts.meanError as number) || 0, 
      (is.meanError as number) || 0,
      (ns.meanError as number) || 0
    );
    
    if (maxGlobalError > 0) {
      if (typeof bs.meanError === 'number') bs.barWidth = Math.min(100, (bs.meanError / maxGlobalError) * 100);
      if (typeof ts.meanError === 'number') ts.barWidth = Math.min(100, (ts.meanError / maxGlobalError) * 100);
      if (typeof is.meanError === 'number') is.barWidth = Math.min(100, (is.meanError / maxGlobalError) * 100);
      if (typeof ns.meanError === 'number') ns.barWidth = Math.min(100, (ns.meanError / maxGlobalError) * 100);
    }

    setBrowserStats(bs);
    setTraccarStats(ts);
    setIotStats(is);
    setNativeStats(ns);
    setRefStatus(`✓ คำนวณสำเร็จจาก ${histArr.length} จุด`);
  };

  const handleExportCSV = () => {
    if (histArr.length === 0) {
      alert("ไม่มีข้อมูล History สำหรับ Export");
      return;
    }
    const headers = "id,device_id,source,latitude,longitude,speed,accuracy,recorded_date,recorded_time,device_time,server_time\n";
    const csv = headers + histArr.map(d => {
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
      return `${d.id},${d.device_id},${d.source},${d.latitude},${d.longitude},${d.speed},${d.accuracy},${dateStr},${timeStr},${d.device_time || d.recorded_at || ''},${d.server_time || d.updated_at || ''}`;
    }).join("\n");

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omni_history_${new Date().getTime()}.csv`;
    a.click();
  };

  const handleResetAnalysis = () => {
    setRefLat('');
    setRefLng('');
    setRefStatus('ไม่ได้ตั้งค่า');
    setBrowserStats(defaultStats);
    setTraccarStats(defaultStats);
    setIotStats(defaultStats);
    setNativeStats(defaultStats);
  };

  // Data processing
  const liveValues = Object.values(livePos);
  const filteredLive = liveValues.filter(p => (filter.src === 'all' || p.source === filter.src) && (filter.dev === 'all' || p.device_id === filter.dev));
  const filteredHist = histArr.filter(p => (filter.src === 'all' || p.source === filter.src) && (filter.dev === 'all' || p.device_id === filter.dev));

  const stats = {
    all: liveValues.length,
    native: liveValues.filter(p => p.source === 'native').length,
    browser: liveValues.filter(p => p.source === 'browser').length,
    iot: liveValues.filter(p => p.source === 'iot').length,
    traccar: liveValues.filter(p => p.source === 'traccar').length
  };

  const deviceOptions = Array.from(new Set([
    ...liveValues.map((p: any) => p.device_id),
    ...histArr.map((p: any) => p.device_id)
  ])).filter(Boolean);

  return (
    <div className="min-h-screen flex flex-col">
      <Header 
        deviceName={myDevice} 
        theme={theme} 
        lang={lang}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        onToggleLang={() => setLang(l => l === 'th' ? 'en' : 'th')}
        onChangeDeviceName={handleChangeDeviceName}
        traccarError={traccarError}
        status={{ supabase: supaStatus, gps: browserGpsActive, traccar: traccarConnected }}
      />
      
      <ControlBar 
        isTracking={isTrack}
        gpsOn={browserGpsActive}
        onToggleTracking={toggleTracking}
        onToggleBrowserGPS={toggleBrowserGPS}
        onFilterChange={(src, dev) => setFilter({ src, dev })}
        currentSrc={filter.src}
        currentDev={filter.dev}
        deviceOptions={deviceOptions}
        onExport={handleExportCSV}
        onClear={handleClear}
        onToggleAnalysis={() => setIsAnalysisOpen(true)}
      />

      <MapArea stats={stats} theme={theme} liveData={filteredLive as any} historyData={filteredHist as any} clearSignal={clearSignal} />
      
      <DataTables liveData={filteredLive as any} historyData={filteredHist as any} />

      <AnalysisPanel 
        isVisible={isAnalysisOpen}
        onClose={() => setIsAnalysisOpen(false)}
        onSetRefFromGPS={handleSetRefFromGPS}
        onRunAnalysis={handleRunAnalysis}
        onExportCSV={handleExportCSV}
        onReset={handleResetAnalysis}
        refLat={refLat} refLng={refLng} 
        onRefLatChange={setRefLat} onRefLngChange={setRefLng}
        refStatus={refStatus}
        browserStats={browserStats}
        iotStats={iotStats}
        traccarStats={traccarStats}
        nativeStats={nativeStats}
      />
    </div>
  );
}


