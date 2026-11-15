import React from 'react';
import { Play, Pause, Navigation, Download, Trash2, BarChart2, Filter, Smartphone } from 'lucide-react';

interface ControlBarProps {
  isTracking: boolean;
  gpsOn: boolean;
  onToggleTracking: () => void;
  onToggleBrowserGPS: () => void;
  onFilterChange: (src: string, dev: string) => void;
  currentSrc: string;
  currentDev: string;
  onExport: () => void;
  onClear: () => void;
  onToggleAnalysis: () => void;
  deviceOptions: string[];
}

export default function ControlBar({
  isTracking,
  gpsOn,
  onToggleTracking,
  onToggleBrowserGPS,
  onFilterChange,
  currentSrc,
  currentDev,
  onExport,
  onClear,
  onToggleAnalysis,
  deviceOptions,
}: ControlBarProps) {
  return (
    <div id="cbar">
      <button 
        className={`btn ${isTracking ? 'btn-w' : 'btn-s'}`} 
        onClick={onToggleTracking}
      >
        {isTracking ? <Pause size={16} /> : <Play size={16} />}
        {isTracking ? 'Stop' : 'Start'}
      </button>
      
      <button 
        className="btn" 
        onClick={onToggleBrowserGPS}
        style={{ borderColor: gpsOn ? 'var(--cyan)' : '', color: gpsOn ? 'var(--cyan)' : '' }}
      >
        <Navigation size={16} />
        {gpsOn ? 'GPS: ON' : 'GPS: OFF'}
      </button>
      
      <div className="sep"></div>
      
      <div className="flex items-center gap-2 bg-[var(--bg-primary)] border border-[var(--border)] rounded-[var(--rs)] px-2">
        <Filter size={14} className="text-[var(--text-3)]" />
        <select 
          className="fsel"
          style={{ border: 'none', padding: '7px 6px', minWidth: '115px' }}
          value={currentSrc}
          onChange={(e) => onFilterChange(e.target.value, currentDev)}
        >
          <option value="all">All Sources</option>
          <option value="native">Native (Android)</option>
          <option value="browser">Browser</option>
          <option value="iot">IoT</option>
          <option value="traccar">Traccar</option>
        </select>
      </div>
      
      <div className="flex items-center gap-2 bg-[var(--bg-primary)] border border-[var(--border)] rounded-[var(--rs)] px-2">
        <Smartphone size={14} className="text-[var(--text-3)]" />
        <select 
          className="fsel"
          style={{ border: 'none', padding: '7px 6px', minWidth: '125px' }}
          value={currentDev}
          onChange={(e) => onFilterChange(currentSrc, e.target.value)}
        >
          <option value="all">All Devices</option>
          {deviceOptions.map((dev) => (
            <option key={dev} value={dev}>{dev}</option>
          ))}
        </select>
      </div>
      
      <div className="sep"></div>
      
      <button className="btn" onClick={onExport}>
        <Download size={16} /> Export
      </button>
      <button className="btn btn-d" onClick={onClear}>
        <Trash2 size={16} /> Clear
      </button>
      
      <div className="sep flex-1 bg-transparent"></div>
      
      <button 
        className="btn" 
        onClick={onToggleAnalysis} 
        style={{ borderColor: 'var(--purple)', color: 'var(--purple)' }}
      >
        <BarChart2 size={16} /> Analysis
      </button>
    </div>
  );
}
