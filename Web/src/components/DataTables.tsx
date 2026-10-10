import React from 'react';
import { Locate, Activity, Cpu } from 'lucide-react';

export interface PositionData {
  id: string;
  source: string; // 'browser', 'iot', 'traccar', 'native'
  device_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  accuracy: number | null;
  app_status?: string | null;
  timestamp?: string;
  updated_at?: string;
  recorded_at?: string;
  isMe?: boolean;
}

interface DataTablesProps {
  liveData: PositionData[];
  historyData: PositionData[];
}

export default function DataTables({ liveData, historyData }: DataTablesProps) {
  
  const getSourceIcon = (source: string) => {
    switch(source) {
      case 'browser': return <Locate size={18} className="text-[#06B6D4]" strokeWidth={1.5} />;
      case 'traccar': return <Activity size={18} className="text-[#8B5CF6]" strokeWidth={1.5} />;
      case 'iot': return <Cpu size={18} className="text-[#F97316]" strokeWidth={1.5} />;
      case 'native': return <Locate size={18} className="text-[#10B981]" strokeWidth={1.5} />;
      default: return <Locate size={18} strokeWidth={1.5} />;
    }
  };

  const renderDataRow = (label: string, val: string | number, highlight: boolean = false) => (
    <div className="data-row">
      <span className="dr-label">{label}</span>
      <span className={`dr-val ${highlight ? 'acc-highlight' : ''}`}>{val}</span>
    </div>
  );

  const renderColumn = (source: string, title: string, headerClass: string) => {
    // We only display the latest live data for that source in the card
    const sourceData = liveData.filter(d => d.source === source);
    const latest = sourceData.length > 0 ? sourceData[0] : null;

    return (
      <div className="comp-col">
        <div className={`comp-hdr ${headerClass}`}>
          {getSourceIcon(source)}
          {title}
        </div>
        <div className="comp-body">
          {latest ? (
            <>
              {renderDataRow('Device', latest.device_id)}
              {latest.app_status && renderDataRow('Status', latest.app_status, true)}
              {latest.latitude !== 0 && renderDataRow('Latitude', latest.latitude.toFixed(6))}
              {latest.longitude !== 0 && renderDataRow('Longitude', latest.longitude.toFixed(6))}
              {latest.speed > 0 && renderDataRow('Speed (km/h)', (latest.speed || 0).toFixed(1))}
              {latest.accuracy !== null && renderDataRow('Accuracy', latest.accuracy ? `${latest.accuracy.toFixed(1)} m` : '—')}
              {renderDataRow('Time', (() => {
                const timeStr = latest.timestamp || latest.updated_at || latest.recorded_at || '';
                if (!timeStr) return '—';
                try {
                  const d = new Date(timeStr);
                  if (isNaN(d.getTime())) return timeStr;
                  return d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
                } catch(e) { return timeStr; }
              })())}
            </>
          ) : (
            <div className="p-8 text-center text-[var(--text-3)] text-sm flex flex-col items-center gap-2">
              <span className="opacity-50 text-2xl">📡</span>
              <span>Waiting for {title}...</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div id="dsec">
      <div>
        <div className="dsec-header flex justify-between items-center">
          <span>Live Tracking Comparison</span>
          <span className="text-sm font-normal text-[var(--text-3)] bg-[var(--bg-secondary)] px-3 py-1 rounded-full border border-[var(--border)]">
            Total Live Points: {liveData.length}
          </span>
        </div>
        <div className="comp-grid mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {renderColumn('native', 'Native (Android)', 'ch-browser')}
          {renderColumn('browser', 'Browser (Real-time)', 'ch-browser')}
          {renderColumn('traccar', 'Traccar (Deep Analytics)', 'ch-traccar')}
          {renderColumn('iot', 'IoT ESP32 (Stable)', 'ch-iot')}
        </div>
      </div>

      <div className="mt-8">
        <div className="dsec-header flex justify-between items-center mb-4">
          <span>History Log ({historyData.length} records)</span>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-[var(--r)] overflow-hidden shadow-[var(--shadow)]">
          <div className="max-h-[300px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--bg-primary)] z-10 text-left border-b border-[var(--border)]">
                <tr>
                  <th className="p-3 font-semibold text-[var(--text-2)] uppercase text-xs tracking-wider">Source</th>
                  <th className="p-3 font-semibold text-[var(--text-2)] uppercase text-xs tracking-wider">Device</th>
                  <th className="p-3 font-semibold text-[var(--text-2)] uppercase text-xs tracking-wider">Lat / Lng</th>
                  <th className="p-3 font-semibold text-[var(--text-2)] uppercase text-xs tracking-wider">Speed</th>
                  <th className="p-3 font-semibold text-[var(--text-2)] uppercase text-xs tracking-wider">Accuracy</th>
                  <th className="p-3 font-semibold text-[var(--text-2)] uppercase text-xs tracking-wider">Time</th>
                </tr>
              </thead>
              <tbody>
                {historyData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-[var(--text-3)]">No history records yet.</td>
                  </tr>
                ) : (
                  historyData.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--row-alt)] hover:bg-[var(--bg-card-hover)] transition-colors">
                      <td className="p-3">
                        <span className={`text-[10px] px-2 py-1 rounded-full border uppercase font-bold
                          ${row.source === 'browser' ? 'bg-[#06B6D4]/10 text-[#06B6D4] border-[#06B6D4]/30' : 
                            row.source === 'traccar' ? 'bg-[#8B5CF6]/10 text-[#8B5CF6] border-[#8B5CF6]/30' : 
                            row.source === 'iot' ? 'bg-[#F97316]/10 text-[#F97316] border-[#F97316]/30' : 
                            'bg-gray-500/10 text-gray-400 border-gray-500/30'}`}
                        >
                          {row.source}
                        </span>
                      </td>
                      <td className="p-3">{row.device_id}</td>
                      <td className="p-3 font-inter">{row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}</td>
                      <td className="p-3 text-[#F59E0B] font-inter">{(row.speed || 0).toFixed(1)}</td>
                      <td className="p-3 text-[#06B6D4] font-inter">{row.accuracy ? `${row.accuracy.toFixed(1)}m` : '—'}</td>
                      <td className="p-3 text-[var(--text-3)]">
                        {(() => {
                          const timeStr = row.timestamp || row.recorded_at || row.updated_at || '';
                          if (!timeStr) return '—';
                          try {
                            const d = new Date(timeStr);
                            if (isNaN(d.getTime())) return timeStr;
                            return d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
                          } catch(e) { return timeStr; }
                        })()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
