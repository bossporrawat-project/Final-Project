'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Locate, Activity, Cpu, Smartphone } from 'lucide-react';

const MapComponent = dynamic(() => import('./MapComponent'), {
  ssr: false,
  loading: () => (
    <div
      style={{ width: '100%', height: '100%', minHeight: '380px' }}
      className="w-full h-full flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-3)]"
    >
      Loading Map...
    </div>
  ),
});

interface MapAreaProps {
  stats: {
    all: number;
    native?: number;
    browser: number;
    iot: number;
    traccar: number;
  };
  theme: 'dark' | 'light';
  liveData?: any[];
  historyData?: any[];
  clearSignal?: number;
}

export default function MapArea({ stats, theme, liveData = [], historyData = [], clearSignal = 0 }: MapAreaProps) {
  return (
    <div
      id="map-c"
      className="relative h-[50vh] min-h-[360px] border-b border-[var(--border)]"
      style={{ position: 'relative', height: '50vh', minHeight: '380px', width: '100%' }}
    >
      <MapComponent theme={theme} liveData={liveData} historyData={historyData} clearSignal={clearSignal} />
      
      <div className="mst">
        <div className="sc" title="Total Active Devices">
          <Smartphone size={14} className="text-[var(--text-2)]" />
          <span className="text-xs font-semibold text-[var(--text-1)]">Devices</span>
          <span className="n text-[#06B6D4]">{stats.all}</span>
        </div>
        <div className="sc" title="Native (Android)">
          <Smartphone size={14} className="text-[#10B981]" />
          <span className="text-xs text-[var(--text-2)]">Native</span>
          <span className="n text-[#10B981]">{stats.native ?? 0}</span>
        </div>
        <div className="sc" title="Browser (Real-time)">
          <Locate size={14} className="text-[#06B6D4]" />
          <span className="text-xs text-[var(--text-2)]">Browser</span>
          <span className="n text-[#06B6D4]">{stats.browser}</span>
        </div>
        <div className="sc" title="IoT (ESP32)">
          <Cpu size={14} className="text-[#F97316]" />
          <span className="text-xs text-[var(--text-2)]">IoT</span>
          <span className="n text-[#F97316]">{stats.iot}</span>
        </div>
        <div className="sc" title="Traccar">
          <Activity size={14} className="text-[#8B5CF6]" />
          <span className="text-xs text-[var(--text-2)]">Traccar</span>
          <span className="n text-[#8B5CF6]">{stats.traccar}</span>
        </div>
      </div>
    </div>
  );
}
