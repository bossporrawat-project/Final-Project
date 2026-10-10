'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Header from '@/components/Header';
import ControlBar from '@/components/ControlBar';
import MapArea from '@/components/MapArea';
import DataTables from '@/components/DataTables';
import AnalysisPanel from '@/components/AnalysisPanel';
import ConfigModal from '@/components/ConfigModal';

import { useLivePositions, useHistory, useTrackingSettings } from '@/hooks/useOmniState';
import { useBrowserGPS } from '@/hooks/useBrowserGPS';
import { useTraccar } from '@/hooks/useTraccar';
import { getSupabaseClient } from '@/lib/supabaseClient';

// Haversine formula
function getDistanceFromLatLonInM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // Radius of the earth in m
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1); 
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
    ; 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  const d = R * c; // Distance in m
  return d;
}
function deg2rad(deg: number) {
  return deg * (Math.PI/180);
}

export default function Dashboard() {
  const [isConfigOpen, setIsConfigOpen] = useState(true);
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
  const defaultStats = { samples: '-', meanError: '-', stdDev: '-', min: '-', max: '-', avgAcc: '-', barWidth: 0 };
  const [browserStats, setBrowserStats] = useState<any>(defaultStats);
  const [iotStats, setIotStats] = useState<any>(defaultStats);
  const [traccarStats, setTraccarStats] = useState<any>(defaultStats);

  // States from hooks
  const { livePos, setLivePos } = useLivePositions();
  const { histArr, setHistArr } = useHistory();
  const { filter, setFilter, isTrack, setIsTrack, gpsOn, setGpsOn } = useTrackingSettings();

  // Connection hooks
  const { startGPS, stopGPS, position: gpsPosition, gpsOn: browserGpsActive, error: gpsError } = useBrowserGPS();
  const { connect: connectTraccar, disconnect: disconnectTraccar, positions: traccarPositions, isConnected: traccarConnected } = useTraccar();

  const [supabase, setSupabase] = useState<any>(null);

  useEffect(() => {
    if (gpsError) {
      alert(`⚠️ Browser GPS Error:\n${gpsError}\n\nPlease check your browser's location permissions or Windows location settings.`);
    }
  }, [gpsError]);

  // Apply theme & lang to DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.lang = lang;
  }, [theme, lang]);

  // Load config on mount
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || localStorage.getItem('omni_supa_url');
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || localStorage.getItem('omni_supa_key');
    const name = process.env.NEXT_PUBLIC_DEVICE_NAME || localStorage.getItem('omni_device_name');
    const token = process.env.NEXT_PUBLIC_TRACCAR_TOKEN || localStorage.getItem('omni_traccar_token');
    
    if (url && key) {
      setIsConfigOpen(false);
      setMyDevice(name || 'Anon_Device');
      initializeSupabase(url, key);
      if (token) connectTraccar(token);
    }
  }, []);

  const initializeSupabase = async (url: string, key: string) => {
    try {
      const client = getSupabaseClient(url, key);
      setSupabase(client);
      setSupaStatus(true);
      // Fetch initial data
      const { data: liveData } = await client.from('gps_positions').select('*').order('updated_at', { ascending: false });
      const { data: historyData } = await client.from('gps_history').select('*').order('recorded_at', { ascending: false }).limit(200);
      
      if (liveData) {
        const liveMap: Record<string, any> = {};
        liveData.forEach((r: any) => liveMap[r.device_id] = r);
        setLivePos(liveMap);
      }
      if (historyData) setHistArr(historyData);

      client.removeAllChannels();

      // Subscribe to realtime
      client.channel('live-pos')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'gps_positions' }, (payload: any) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old?.device_id;
            if (old) setLivePos(prev => { const n = {...prev}; delete n[old]; return n; });
          } else {
            const r = payload.new;
            setLivePos(prev => ({ ...prev, [r.device_id]: r }));
          }
        }).subscribe();
        
      client.channel('hist-log')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gps_history' }, (payload: any) => {
          setHistArr(prev => { if(prev.some(p => p.id === payload.new.id)) return prev; return [payload.new, ...prev].slice(0, 300); });
        }).subscribe();
        
    } catch (err) {
      console.error(err);
      setSupaStatus(false);
    }
  };

  const handleSaveConfig = (config: any) => {
    localStorage.setItem('omni_supa_url', config.supabaseUrl);
    localStorage.setItem('omni_supa_key', config.supabaseKey);
    localStorage.setItem('omni_device_name', config.deviceName);
    if (config.traccarToken) localStorage.setItem('omni_traccar_token', config.traccarToken);
    
    setMyDevice(config.deviceName);
    setIsConfigOpen(false);
    initializeSupabase(config.supabaseUrl, config.supabaseKey);
    if (config.traccarToken) connectTraccar(config.traccarToken);
  };

  // Sync GPS to Supabase
  useEffect(() => {
    if (gpsPosition && supabase && isTrack) {
      const now = new Date().toISOString();
      supabase.from('gps_positions').upsert({
        device_id: myDevice, device_name: myDevice,
        latitude: gpsPosition.latitude, longitude: gpsPosition.longitude,
        speed: gpsPosition.speed, accuracy: gpsPosition.accuracy,
        source: 'browser', is_online: true, updated_at: now
      }, { onConflict: 'device_id' }).then();
      
      supabase.from('gps_history').insert({
        device_id: myDevice, latitude: gpsPosition.latitude, longitude: gpsPosition.longitude,
        speed: gpsPosition.speed, accuracy: gpsPosition.accuracy,
        source: 'browser', recorded_at: now
      }).then();
    }
  }, [gpsPosition, supabase, isTrack, myDevice]);

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
    setLivePos({});
    setHistArr([]);
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

      const errors = data.map(d => getDistanceFromLatLonInM(lat, lng, d.latitude, d.longitude));
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
    }

    setBrowserStats(bs);
    setTraccarStats(ts);
    setIotStats(is);
    setRefStatus(`✓ คำนวณสำเร็จจาก ${histArr.length} จุด`);
  };

  const handleExportCSV = () => {
    if (histArr.length === 0) {
      alert("ไม่มีข้อมูล History สำหรับ Export");
      return;
    }
    const headers = "id,device_id,source,latitude,longitude,speed,accuracy,recorded_at\n";
    const csv = headers + histArr.map(d => 
      `${d.id},${d.device_id},${d.source},${d.latitude},${d.longitude},${d.speed},${d.accuracy},${d.recorded_at}`
    ).join("\n");

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
  };

  // Data processing
  const liveValues = Object.values(livePos);
  const filteredLive = liveValues.filter(p => (filter.src === 'all' || p.source === filter.src) && (filter.dev === 'all' || p.device_id === filter.dev));
  const filteredHist = histArr.filter(p => (filter.src === 'all' || p.source === filter.src) && (filter.dev === 'all' || p.device_id === filter.dev));

  const stats = {
    all: liveValues.length,
    browser: liveValues.filter(p => p.source === 'browser').length,
    iot: liveValues.filter(p => p.source === 'iot').length,
    traccar: liveValues.filter(p => p.source === 'traccar').length
  };

  const deviceOptions = Array.from(new Set(liveValues.map((p: any) => p.device_id)));

  return (
    <div className="min-h-screen flex flex-col">
      <Header 
        deviceName={myDevice} 
        theme={theme} 
        lang={lang}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        onToggleLang={() => setLang(l => l === 'th' ? 'en' : 'th')}
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
        onExport={() => {/* Export Logic */}}
        onClear={handleClear}
        onToggleAnalysis={() => setIsAnalysisOpen(true)}
      />

      <MapArea stats={stats} theme={theme} liveData={filteredLive as any} historyData={filteredHist as any} />
      
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
      />

      <ConfigModal 
        isVisible={isConfigOpen} 
        onSave={handleSaveConfig} 
      />
    </div>
  );
}


