import React, { useRef } from 'react';
import { Locate, Activity, Cpu, MapPin, Calculator, FileText, RotateCcw, X, Smartphone, Sparkles, Trophy, Upload, Trash2, Route } from 'lucide-react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { AnalysisStats, ParsedKmlRoute, RouteComparisonMetrics } from '@/utils/calculations';

export type ReferenceMode = 'centroid' | 'device' | 'manual' | 'kml';

export interface DeviceAnalysisRow {
  deviceId: string;
  source: string;
  samples: number;
  meanError: number;
  stdDev: number;
  min: number;
  max: number;
  avgAcc: number | string;
  updateIntervalS?: number | null;
  avgSpeedMs?: number | null;
  dataConsistencyPct?: number | null;
  availabilityPct?: number | null;
}

interface AnalysisPanelProps {
  isVisible: boolean;
  onClose: () => void;
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
  iotStats: AnalysisStats;
  traccarStats: AnalysisStats;
  nativeStats?: AnalysisStats;
  deviceRows: DeviceAnalysisRow[];
  bestSummary: { label: string; meanError: number; samples: number } | null;
  kmlRoute?: ParsedKmlRoute | null;
  onUploadKml?: (file: File) => void;
  onClearKml?: () => void;
  comparisonMetrics?: RouteComparisonMetrics[];
}

export default function AnalysisPanel({
  isVisible,
  onClose,
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
  iotStats,
  traccarStats,
  nativeStats,
  deviceRows,
  bestSummary,
  kmlRoute = null,
  onUploadKml,
  onClearKml,
  comparisonMetrics = [],
}: AnalysisPanelProps) {
  const kmlInputRef = useRef<HTMLInputElement | null>(null);

  const chartData = [
    {
      metric: 'Mean Error (m)',
      Traccar: typeof traccarStats.meanError === 'number' ? traccarStats.meanError : 0,
      IoT: typeof iotStats.meanError === 'number' ? iotStats.meanError : 0,
      Native: typeof nativeStats?.meanError === 'number' ? nativeStats.meanError : 0,
    },
    {
      metric: 'Max Error (m)',
      Traccar: typeof traccarStats.max === 'number' ? traccarStats.max : 0,
      IoT: typeof iotStats.max === 'number' ? iotStats.max : 0,
      Native: typeof nativeStats?.max === 'number' ? nativeStats.max : 0,
    },
    {
      metric: 'Std Deviation',
      Traccar: typeof traccarStats.stdDev === 'number' ? traccarStats.stdDev : 0,
      IoT: typeof iotStats.stdDev === 'number' ? iotStats.stdDev : 0,
      Native: typeof nativeStats?.stdDev === 'number' ? nativeStats.stdDev : 0,
    },
    {
      metric: 'Reported Acc (m)',
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
                className={modeBtnClass(refMode === 'manual')}
                onClick={() => onRefModeChange('manual')}
              >
                กำหนดเอง
              </button>
              <button
                type="button"
                className={modeBtnClass(refMode === 'kml')}
                onClick={() => {
                  onRefModeChange('kml');
                  if (!kmlRoute) kmlInputRef.current?.click();
                }}
              >
                <span className="inline-flex items-center gap-1"><Route size={12} /> KML Main Route</span>
              </button>
            </div>

            {onUploadKml && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-primary)]/70 px-2.5 py-2 text-xs">
                <input
                  ref={kmlInputRef}
                  type="file"
                  accept=".kml"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadKml(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => kmlInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#FACC15]/50 bg-[#FACC15]/10 text-[#FACC15] font-semibold hover:bg-[#FACC15]/20 transition-colors"
                >
                  <Upload size={12} /> {kmlRoute ? 'เปลี่ยนไฟล์ .kml' : 'อัปโหลด .kml (Main Route)'}
                </button>
                {kmlRoute ? (
                  <>
                    <span className="text-[var(--text-2)] truncate max-w-[210px]" title={kmlRoute.name}>
                      ✓ {kmlRoute.name} ({kmlRoute.points.length} จุด •{' '}
                      {kmlRoute.totalDistanceM >= 1000
                        ? `${(kmlRoute.totalDistanceM / 1000).toFixed(2)} km`
                        : `${Math.round(kmlRoute.totalDistanceM)} m`}
                      )
                    </span>
                    {onClearKml && (
                      <button
                        type="button"
                        onClick={onClearKml}
                        className="ml-auto text-rose-400 hover:text-rose-300 inline-flex items-center gap-1"
                        title="ลบเส้นทาง KML"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-[var(--text-3)]">อัปโหลดไฟล์เส้นทาง KML เพื่อเทียบ Error บนเส้นทางจริง</span>
                )}
              </div>
            )}

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

          {comparisonMetrics.length > 0 && (
            <div className="ana-card mb-4">
              <div className="ana-card-title justify-between">
                <span className="flex items-center gap-2">
                  <Route size={16} className="text-[#FACC15]" />
                  <span>Route &amp; Telemetry Benchmark Matrix</span>
                </span>
                <span className="text-xs font-normal text-[var(--text-3)]">
                  {kmlRoute ? `อ้างอิงเส้นทางหลัก: ${kmlRoute.name}` : 'อ้างอิง Reference Point'}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left border-b border-[var(--border)] text-[var(--text-2)]">
                    <tr>
                      <th className="py-2 pr-4 font-bold">Metric</th>
                      {comparisonMetrics.map((col) => (
                        <th key={col.id} className="py-2 px-3 text-center font-bold whitespace-nowrap">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-[var(--row-alt)] bg-[var(--bg-primary)]/40">
                      <td className="py-2.5 pr-4 font-semibold text-[var(--text-1)] whitespace-nowrap">
                        Accuracy (Avg Error on Main Route)
                      </td>
                      {comparisonMetrics.map((col) => (
                        <td key={col.id} className="py-2.5 px-3 text-center font-inter font-bold text-[#10B981]">
                          {col.avgErrorM != null ? `${col.avgErrorM.toFixed(2)} m` : '—'}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-[var(--row-alt)]">
                      <td className="py-2.5 pr-4 font-semibold text-[var(--text-1)] whitespace-nowrap">Update Interval</td>
                      {comparisonMetrics.map((col) => (
                        <td key={col.id} className="py-2.5 px-3 text-center font-inter text-[var(--text-2)]">
                          {col.updateIntervalS != null
                            ? `${col.updateIntervalS.toFixed(2)} s${col.isSimulated ? ' (Simulated)' : ''}`
                            : '—'}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-[var(--row-alt)] bg-[var(--bg-primary)]/40">
                      <td className="py-2.5 pr-4 font-semibold text-[var(--text-1)] whitespace-nowrap">Average Speed</td>
                      {comparisonMetrics.map((col) => (
                        <td key={col.id} className="py-2.5 px-3 text-center font-inter text-[#F59E0B]">
                          {col.avgSpeedMs != null ? `${col.avgSpeedMs.toFixed(2)} m/s` : '—'}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-[var(--row-alt)]">
                      <td className="py-2.5 pr-4 font-semibold text-[var(--text-1)] whitespace-nowrap">Data Consistency</td>
                      {comparisonMetrics.map((col) => (
                        <td key={col.id} className="py-2.5 px-3 text-center font-inter text-[#06B6D4]">
                          {col.dataConsistencyPct != null ? `${col.dataConsistencyPct.toFixed(1)}%` : '—'}
                        </td>
                      ))}
                    </tr>
                    <tr className="bg-[var(--bg-primary)]/40">
                      <td className="py-2.5 pr-4 font-semibold text-[var(--text-1)] whitespace-nowrap">Availability / Uptime</td>
                      {comparisonMetrics.map((col) => (
                        <td key={col.id} className="py-2.5 px-3 text-center font-inter text-[var(--text-1)]">
                          {col.availabilityPct != null ? `${col.availabilityPct.toFixed(1)}%` : '—'}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
                      <th className="py-2 pr-3">Interval</th>
                      <th className="py-2 pr-3">Avg Speed</th>
                      <th className="py-2 pr-3">Consistency</th>
                      <th className="py-2 pr-3">Uptime</th>
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
                        <td className="py-2 pr-3 font-inter text-[var(--text-2)]">{row.updateIntervalS != null ? `${row.updateIntervalS.toFixed(2)} s` : '—'}</td>
                        <td className="py-2 pr-3 font-inter text-[#F59E0B]">{row.avgSpeedMs != null ? `${row.avgSpeedMs.toFixed(2)} m/s` : '—'}</td>
                        <td className="py-2 pr-3 font-inter text-[#06B6D4]">{row.dataConsistencyPct != null ? `${row.dataConsistencyPct.toFixed(1)}%` : '—'}</td>
                        <td className="py-2 pr-3 font-inter text-[var(--text-1)]">{row.availabilityPct != null ? `${row.availabilityPct.toFixed(1)}%` : '—'}</td>
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
