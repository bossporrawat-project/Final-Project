import React from 'react';
import { Locate, Activity, Cpu, MapPin, Calculator, FileText, RotateCcw, X, Smartphone } from 'lucide-react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { AnalysisStats } from '@/utils/calculations';

interface AnalysisPanelProps {
  isVisible: boolean;
  onClose: () => void;
  onSetRefFromGPS: () => void;
  onRunAnalysis: () => void;
  onExportCSV: () => void;
  onReset: () => void;
  refLat: string;
  refLng: string;
  onRefLatChange: (val: string) => void;
  onRefLngChange: (val: string) => void;
  refStatus: string;
  browserStats: AnalysisStats;
  iotStats: AnalysisStats;
  traccarStats: AnalysisStats;
  nativeStats?: AnalysisStats;
}

export default function AnalysisPanel({
  isVisible,
  onClose,
  onSetRefFromGPS,
  onRunAnalysis,
  onExportCSV,
  onReset,
  refLat,
  refLng,
  onRefLatChange,
  onRefLngChange,
  refStatus,
  browserStats,
  iotStats,
  traccarStats,
  nativeStats,
}: AnalysisPanelProps) {
  
  const chartData = [
    {
      metric: 'Mean Error (m)',
      Browser: typeof browserStats.meanError === 'number' ? browserStats.meanError : 0,
      Traccar: typeof traccarStats.meanError === 'number' ? traccarStats.meanError : 0,
      IoT: typeof iotStats.meanError === 'number' ? iotStats.meanError : 0,
      Native: typeof nativeStats?.meanError === 'number' ? nativeStats.meanError : 0,
    },
    {
      metric: 'Max Error (m)',
      Browser: typeof browserStats.max === 'number' ? browserStats.max : 0,
      Traccar: typeof traccarStats.max === 'number' ? traccarStats.max : 0,
      IoT: typeof iotStats.max === 'number' ? iotStats.max : 0,
      Native: typeof nativeStats?.max === 'number' ? nativeStats.max : 0,
    },
    {
      metric: 'Std Deviation',
      Browser: typeof browserStats.stdDev === 'number' ? browserStats.stdDev : 0,
      Traccar: typeof traccarStats.stdDev === 'number' ? traccarStats.stdDev : 0,
      IoT: typeof iotStats.stdDev === 'number' ? iotStats.stdDev : 0,
      Native: typeof nativeStats?.stdDev === 'number' ? nativeStats.stdDev : 0,
    },
    {
      metric: 'Reported Acc (m)',
      Browser: typeof browserStats.avgAcc === 'number' ? browserStats.avgAcc : 0,
      Traccar: typeof traccarStats.avgAcc === 'number' ? traccarStats.avgAcc : 0,
      IoT: typeof iotStats.avgAcc === 'number' ? iotStats.avgAcc : 0,
      Native: typeof nativeStats?.avgAcc === 'number' ? nativeStats.avgAcc : 0,
    }
  ];

  return (
    <section id="analysis" className={isVisible ? 'show' : ''}>
      <div className="ana-header">
        <div className="ana-title">
          <Calculator size={20} className="text-[#06B6D4]" /> Accuracy Analysis
        </div>
        <button className="btn" onClick={onClose} aria-label="Close Analysis Panel"><X size={16} /></button>
      </div>
      <div className="ana-body">
        
        <div className="ana-left">
          <div className="ref-card">
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
              <MapPin size={16} className="text-[#F97316]" /> Reference Point
            </h3>
            <div className="ref-row">
              <input 
                className="ref-input" 
                type="text" 
                placeholder="Latitude" 
                value={refLat}
                onChange={(e) => onRefLatChange(e.target.value)}
              />
              <input 
                className="ref-input" 
                type="text" 
                placeholder="Longitude" 
                value={refLng}
                onChange={(e) => onRefLngChange(e.target.value)}
              />
              <button className="btn" onClick={onSetRefFromGPS}>
                <Locate size={14} /> Use GPS
              </button>
              <button className="btn btn-p" onClick={onRunAnalysis}>
                <Calculator size={14} /> Calculate
              </button>
            </div>
            <div className="text-sm font-medium text-[#10B981] mt-2">{refStatus}</div>
          </div>

          <div className="radar-container">
            <h3 className="font-bold text-sm mb-4 text-center">Error Profile (Lower is better)</h3>
            {isVisible && (
              <ResponsiveContainer width="100%" height="85%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: 'var(--text-2)', fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--popup-bg)', borderColor: 'var(--border)', borderRadius: '8px' }}
                    itemStyle={{ fontSize: '12px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', marginTop: '10px' }} />
                  <Radar name="Browser" dataKey="Browser" stroke="#06B6D4" fill="#06B6D4" fillOpacity={0.3} />
                  <Radar name="Traccar" dataKey="Traccar" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.3} />
                  <Radar name="IoT" dataKey="IoT" stroke="#F97316" fill="#F97316" fillOpacity={0.3} />
                  <Radar name="Native" dataKey="Native" stroke="#10B981" fill="#10B981" fillOpacity={0.3} />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="ana-right">
          <div className="cards-row">
            {/* Native (Android) */}
            {nativeStats && (
              <div className="ana-card ac-native">
                <div className="ana-card-title text-[#10B981]"><Smartphone size={16} /> Native (Android)</div>
                <div className="stat-grid">
                  <div className="stat-item"><div className="stat-label">Samples</div><div className="stat-value">{nativeStats.samples}</div></div>
                  <div className="stat-item"><div className="stat-label">Mean Error</div><div className="stat-value text-[#10B981]">{nativeStats.meanError} m</div></div>
                  <div className="stat-item"><div className="stat-label">Std Dev</div><div className="stat-value">{nativeStats.stdDev} m</div></div>
                  <div className="stat-item"><div className="stat-label">Max</div><div className="stat-value">{nativeStats.max} m</div></div>
                </div>
                <div className="mt-4">
                  <div className="text-[10px] text-[var(--text-3)] mb-1 uppercase tracking-wider">Error Ratio</div>
                  <div className="h-2 bg-[var(--bg-card-hover)] rounded-full overflow-hidden">
                    <div className="h-full bg-[#10B981] rounded-full transition-all duration-500" style={{ width: `${nativeStats.barWidth}%` }}></div>
                  </div>
                </div>
              </div>
            )}

            {/* Browser */}
            <div className="ana-card ac-browser">
              <div className="ana-card-title text-[#06B6D4]"><Locate size={16} /> Browser</div>
              <div className="stat-grid">
                <div className="stat-item"><div className="stat-label">Samples</div><div className="stat-value">{browserStats.samples}</div></div>
                <div className="stat-item"><div className="stat-label">Mean Error</div><div className="stat-value text-[#06B6D4]">{browserStats.meanError} m</div></div>
                <div className="stat-item"><div className="stat-label">Std Dev</div><div className="stat-value">{browserStats.stdDev} m</div></div>
                <div className="stat-item"><div className="stat-label">Max</div><div className="stat-value">{browserStats.max} m</div></div>
              </div>
              <div className="mt-4">
                <div className="text-[10px] text-[var(--text-3)] mb-1 uppercase tracking-wider">Error Ratio</div>
                <div className="h-2 bg-[var(--bg-card-hover)] rounded-full overflow-hidden">
                  <div className="h-full bg-[#06B6D4] rounded-full transition-all duration-500" style={{ width: `${browserStats.barWidth}%` }}></div>
                </div>
              </div>
            </div>

            {/* Traccar */}
            <div className="ana-card ac-traccar">
              <div className="ana-card-title text-[#8B5CF6]"><Activity size={16} /> Traccar</div>
              <div className="stat-grid">
                <div className="stat-item"><div className="stat-label">Samples</div><div className="stat-value">{traccarStats.samples}</div></div>
                <div className="stat-item"><div className="stat-label">Mean Error</div><div className="stat-value text-[#8B5CF6]">{traccarStats.meanError} m</div></div>
                <div className="stat-item"><div className="stat-label">Std Dev</div><div className="stat-value">{traccarStats.stdDev} m</div></div>
                <div className="stat-item"><div className="stat-label">Max</div><div className="stat-value">{traccarStats.max} m</div></div>
              </div>
              <div className="mt-4">
                <div className="text-[10px] text-[var(--text-3)] mb-1 uppercase tracking-wider">Error Ratio</div>
                <div className="h-2 bg-[var(--bg-card-hover)] rounded-full overflow-hidden">
                  <div className="h-full bg-[#8B5CF6] rounded-full transition-all duration-500" style={{ width: `${traccarStats.barWidth}%` }}></div>
                </div>
              </div>
            </div>

            {/* IoT */}
            <div className="ana-card ac-iot">
              <div className="ana-card-title text-[#F97316]"><Cpu size={16} /> IoT (ESP32)</div>
              <div className="stat-grid">
                <div className="stat-item"><div className="stat-label">Samples</div><div className="stat-value">{iotStats.samples}</div></div>
                <div className="stat-item"><div className="stat-label">Mean Error</div><div className="stat-value text-[#F97316]">{iotStats.meanError} m</div></div>
                <div className="stat-item"><div className="stat-label">Std Dev</div><div className="stat-value">{iotStats.stdDev} m</div></div>
                <div className="stat-item"><div className="stat-label">Max</div><div className="stat-value">{iotStats.max} m</div></div>
              </div>
              <div className="mt-4">
                <div className="text-[10px] text-[var(--text-3)] mb-1 uppercase tracking-wider">Error Ratio</div>
                <div className="h-2 bg-[var(--bg-card-hover)] rounded-full overflow-hidden">
                  <div className="h-full bg-[#F97316] rounded-full transition-all duration-500" style={{ width: `${iotStats.barWidth}%` }}></div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-4 border-t border-[var(--border)] pt-4">
            <button className="btn" onClick={onExportCSV}>
              <FileText size={14} /> Export CSV
            </button>
            <button className="btn btn-d" onClick={onReset}>
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </div>
        
      </div>
    </section>
  );
}
