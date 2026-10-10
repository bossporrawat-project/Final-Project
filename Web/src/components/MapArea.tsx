import React from 'react';
import dynamic from 'next/dynamic';
import { Locate, Activity, Cpu, Smartphone } from 'lucide-react';

const MapComponent = dynamic(() => import('./MapComponent'), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-3)]">Loading Map...</div>
});

interface MapAreaProps {
  stats: {
    all: number;
    browser: number;
    iot: number;
    traccar: number;
  };
  theme: 'dark' | 'light';
  liveData?: any[];
  historyData?: any[];
}

export default function MapArea({ stats, theme, liveData = [], historyData = [] }: MapAreaProps) {
  return (
    <div id="map-c" className="relative h-[50vh] min-h-[360px] border-b border-[var(--border)]">
      <MapComponent theme={theme} liveData={liveData} historyData={historyData} />
      
      <div className="absolute top-4 right-4 z-[500] flex flex-col gap-2">
        <div className="sc flex items-center gap-2 bg-[var(--popup-bg)] backdrop-blur-md border border-[var(--border)] rounded-full px-3 py-1.5 shadow-[var(--shadow)]">
          <Smartphone size={14} className="text-[var(--text-2)]" />
          <span className="text-xs font-semibold text-[var(--text-1)]">Devices</span>
          <span className="text-sm font-bold text-[#06B6D4] ml-1">{stats.all}</span>
        </div>
        <div className="sc flex items-center gap-2 bg-[var(--popup-bg)] backdrop-blur-md border border-[var(--border)] rounded-full px-3 py-1.5 shadow-[var(--shadow)]">
          <Locate size={14} className="text-[#06B6D4]" />
          <span className="text-sm font-bold text-[#06B6D4] ml-1 w-4 text-center">{stats.browser}</span>
        </div>
        <div className="sc flex items-center gap-2 bg-[var(--popup-bg)] backdrop-blur-md border border-[var(--border)] rounded-full px-3 py-1.5 shadow-[var(--shadow)]">
          <Cpu size={14} className="text-[#F97316]" />
          <span className="text-sm font-bold text-[#F97316] ml-1 w-4 text-center">{stats.iot}</span>
        </div>
        <div className="sc flex items-center gap-2 bg-[var(--popup-bg)] backdrop-blur-md border border-[var(--border)] rounded-full px-3 py-1.5 shadow-[var(--shadow)]">
          <Activity size={14} className="text-[#8B5CF6]" />
          <span className="text-sm font-bold text-[#8B5CF6] ml-1 w-4 text-center">{stats.traccar}</span>
        </div>
      </div>
    </div>
  );
}
