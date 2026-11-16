import React from 'react';
import { Locate, Activity, Cpu, MapPin, Calculator, FileText, RotateCcw, X, Smartphone, Sparkles, Trophy } from 'lucide-react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { AnalysisStats } from '@/utils/calculations';

export type ReferenceMode = 'centroid' | 'device' | 'gps' | 'manual';

export interface DeviceAnalysisRow {
  deviceId: string;
  source: string;
  samples: number;
  meanError: number;
  stdDev: number;
  min: number;
  max: number;
  avgAcc: number | string;
}

interface AnalysisPanelProps {
  isVisible: boolean;
  onClose: () => void;
  onSetRefFromGPS: () => void;
  onRunAnalysis: () => void;
  onExportCSV: () => void;
  onReset: () => void;
  refMode: ReferenceMode;
  onRefModeChange: (mode: ReferenceMode) => void;
  refDeviceId: string;
  onRefDeviceIdChange: (devId: string) => void;
  deviceOptions: string[];
  refLat: string;
  refLng: string;
  onRefLatChange: (val: string) => void;
  onRefLngChange: (val: string) => void;
  refStatus: string;
  browserStats: AnalysisStats;
  iotStats: AnalysisStats;
  traccarStats: AnalysisStats;
  nativeStats?: AnalysisStats;
  deviceRows: DeviceAnalysisRow[];
  bestSummary: { label: string; meanError: number; samples: number } | null;
}

export default function AnalysisPanel({
  isVisible,
  onClose,
  onSetRefFromGPS,
  onRunAnalysis,
  onExportCSV,
  onReset,
  refMode,
  onRefModeChange,
  refDeviceId,
  onRefDeviceIdChange,
  deviceOptions,
  refLat,
  refLng,
  onRefLatChange,
  onRefLngChange,
  refStatus,
  browserStats,
  iotStats,
  traccarStats,
  nativeStats,
  deviceRows,
  bestSummary,
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

  const modeBtnClass = (active: boolean) =>
    `text-xs font-semibold px-2.5 py-1.5 rounded border transition-colors ${
      active
        ? 'bg-[#06B6D4]/15 text-[#06B6D4] border-[#06B6D4]/50'
        : 'bg-[var(--bg-primary)] text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--bg-card-hover)]'
    }`;

  return (
    <section id="analysis" className={isVisible ? 'show' : ''}>
      <div className="ana-header">
        <div className="ana-title">
          <Calculator size={20} className="text-[#06B6D4]" />
          <span>Accuracy Analysis</span>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/40">
            AUTO LIVE
          </span>
        </div>
        <button className="btn" onClick={onClose} aria-label="Close Analysis Panel"><X size={16} /></button>
      </div>
      <div className="ana-body">

        <div className="ana-left">
          <div className="ref-card">
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
              <MapPin size={16} className="text-[#F97316]" /> Reference Point (คำนวณอัตโนมัติ)
            </h3>

            <div className="flex flex-wrap gap-1.5 mb-3">
              <button
                type="button"
                className={modeBtnClass(refMode === 'centroid')}
                onClick={() => onRefModeChange('centroid')}
              >
                <span className="inline-flex items-center gap-1"><Sparkles size={12} /> Auto (ค่าเฉลี่ย)</span>
              </button>
              <button
                type="button"
                className={modeBtnClass(refMode === 'device')}
                onClick={() => onRefModeChange('device')}
              >
                เทียบ Device หลัก
              </button>
              <button
                type="button"
                className={modeBtnClass(refMode === 'gps')}
                onClick={onSetRefFromGPS}
              >
                <span className="inline-flex items-center gap-1"><Locate size={12} /> Live GPS</span>
              </button>
              <button
                type="button"
                className={modeBtnClass(refMode === 'manual')}
                onClick={() => onRefModeChange('manual')}
              >
                กำหนดเอง
              </button>
            </div>

            {refMode === 'device' && (
              <div className="mb-3">
                <select
                  aria-label="Select reference device"
                  className="w-full text-xs bg-[var(--bg-primary)] text-[var(--text-1)] border border-[var(--border)] rounded px-2.5 py-2 focus:outline-none focus:border-[var(--cyan)]"
                  value={refDeviceId}
                  onChange={(e) => onRefDeviceIdChange(e.target.value)}
                >
                  {deviceOptions.length === 0 ? (
                    <option value="">ยังไม่มี Device</option>
                  ) : (
                    deviceOptions.map((dev) => (
                      <option key={dev} value={dev}>เทียบกับ: {dev}</option>
                    ))
                  )}
                </select>
              </div>
            )}

            <div className="ref-row">
              <input
                className="ref-input"
                type="text"
                placeholder="Latitude"
                value={refLat}
                onChange={(e) => {
                  if (refMode !== 'manual') onRefModeChange('manual');
                  onRefLatChange(e.target.value);
                }}
              />
              <input
                className="ref-input"
                type="text"
                placeholder="Longitude"
                value={refLng}
                onChange={(e) => {
                  if (refMode !== 'manual') onRefModeChange('manual');
                  onRefLngChange(e.target.value);
                }}
              />
              <button className="btn btn-p" onClick={onRunAnalysis}>
                <Calculator size={14} /> Recalculate
              </button>
            </div>
            <div className="text-xs font-medium text-[#10B981] mt-1">{refStatus}</div>
          </div>

          <div className="radar-container">
            <h3 className="font-bold text-sm mb-4 text-center">Error Profile (ค่ายิ่งน้อยยิ่งแม่นยำ)</h3>
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
          {bestSummary && (
            <div className="ana-card flex flex-wrap items-center justify-between gap-3 border-emerald-500/40 bg-emerald-500/5">
              <div className="flex items-center gap-2.5">
                <Trophy size={18} className="text-[#F59E0B] shrink-0" />
                <div>
                  <div className="text-xs text-[var(--text-3)] uppercase font-semibold tracking-wider">Best Accuracy Summary</div>
                  <div className="text-sm font-bold text-[var(--text-1)]">
                    แม่นยำที่สุดตอนนี้: <span className="text-[#10B981]">{bestSummary.label}</span> (Mean Error {bestSummary.meanError} m จาก {bestSummary.samples} จุด)
                  </div>
                </div>
              </div>
              <span className="text-[11px] text-emerald-400 font-semibold">คำนวณอัตโนมัติจากข้อมูลล่าสุด</span>
            </div>
          )}

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

          {deviceRows.length > 0 && (
            <div className="ana-card">
              <div className="ana-card-title justify-between">
                <span>Device Accuracy Ranking (เรียงตามความแม่นยำรายเครื่อง)</span>
                <span className="text-xs font-normal text-[var(--text-3)]">{deviceRows.length} devices</span>
              </div>
              <div className="overflow-x-auto max-h-[220px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-left border-b border-[var(--border)] text-[var(--text-3)] uppercase">
                    <tr>
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Device</th>
                      <th className="py-2 pr-3">Source</th>
                      <th className="py-2 pr-3">Samples</th>
                      <th className="py-2 pr-3">Mean Error</th>
                      <th className="py-2 pr-3">Std Dev</th>
                      <th className="py-2 pr-3">Min / Max</th>
                      <th className="py-2">Avg Acc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deviceRows.map((row, idx) => (
                      <tr key={row.deviceId} className="border-b border-[var(--row-alt)] last:border-none">
                        <td className="py-2 pr-3 font-bold text-[#F59E0B]">{idx + 1}</td>
                        <td className="py-2 pr-3 font-semibold text-[var(--text-1)]">{row.deviceId}</td>
                        <td className="py-2 pr-3 uppercase text-[10px] font-bold text-[var(--text-2)]">{row.source}</td>
                        <td className="py-2 pr-3 font-inter">{row.samples}</td>
                        <td className="py-2 pr-3 font-inter font-bold text-[#10B981]">{row.meanError} m</td>
                        <td className="py-2 pr-3 font-inter">{row.stdDev} m</td>
                        <td className="py-2 pr-3 font-inter text-[var(--text-2)]">{row.min} / {row.max} m</td>
                        <td className="py-2 font-inter text-[#06B6D4]">{typeof row.avgAcc === 'number' ? `${row.avgAcc} m` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-2 border-t border-[var(--border)] pt-4">
            <button className="btn" onClick={onExportCSV}>
              <FileText size={14} /> Export CSV
            </button>
            <button className="btn btn-d" onClick={onReset}>
              <RotateCcw size={14} /> Reset Auto
            </button>
          </div>
        </div>

      </div>
    </section>
  );
}
