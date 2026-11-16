import React, { useState, useEffect, useCallback } from 'react';
import { Cloud, Download, MapPin, Archive } from 'lucide-react';

interface ArchiveDayItem {
  date: string;
  fileCount: number;
  totalSizeBytes: number;
  lastModified: string | null;
}

interface CloudArchiveBarProps {
  onLoadArchivedPoints?: (rows: any[], date: string) => void;
}

export default function CloudArchiveBar({ onLoadArchivedPoints }: CloudArchiveBarProps) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [days, setDays] = useState<ArchiveDayItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [busyAction, setBusyAction] = useState<'list' | 'load' | 'archive' | null>(null);
  const [statusNote, setStatusNote] = useState<string>('');

  const fetchDays = useCallback(async () => {
    setBusyAction('list');
    try {
      const res = await fetch('/api/archive', { cache: 'no-store' });
      const data = await res.json();
      setConfigured(Boolean(data.configured));
      const nextDays: ArchiveDayItem[] = Array.isArray(data.days) ? data.days : [];
      setDays(nextDays);
      if (nextDays.length > 0 && !selectedDate) {
        setSelectedDate(nextDays[0].date);
      }
    } catch {
      setConfigured(false);
    } finally {
      setBusyAction(null);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchDays();
  }, []);

  const handleLoadToMap = async () => {
    if (!selectedDate) return;
    setBusyAction('load');
    setStatusNote('');
    try {
      const res = await fetch(`/api/archive?date=${encodeURIComponent(selectedDate)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Load failed');
      const rows = Array.isArray(data.rows) ? data.rows : [];
      onLoadArchivedPoints?.(rows, selectedDate);
      setStatusNote(`✓ โหลดจาก R2 วันที่ ${selectedDate} แล้ว ${rows.length.toLocaleString()} จุด`);
    } catch (err: any) {
      setStatusNote(`❌ ${err?.message || 'โหลดไม่สำเร็จ'}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunArchiveNow = async () => {
    setBusyAction('archive');
    setStatusNote('');
    try {
      const res = await fetch('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Archive failed');
      setStatusNote(
        data.archivedRows > 0
          ? `✓ ย้ายขึ้น R2 แล้ว ${Number(data.archivedRows).toLocaleString()} แถว (${data.uploadedFiles} ไฟล์)`
          : `✓ ไม่มีข้อมูลเก่าเกิน ${data.retentionHours} ชม. ให้ย้าย`
      );
      await fetchDays();
    } catch (err: any) {
      setStatusNote(`❌ ${err?.message || 'ย้ายข้อมูลไม่สำเร็จ'}`);
    } finally {
      setBusyAction(null);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="mb-3 px-3.5 py-2.5 rounded-[var(--rs)] bg-[var(--bg-card)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-xs">
      <div className="flex items-center gap-2">
        <Cloud size={15} className={configured ? 'text-[#06B6D4]' : 'text-[var(--text-3)]'} />
        <span className="font-semibold text-[var(--text-1)]">Cloudflare R2 Cold Archive</span>
        {configured === false && (
          <span className="text-[11px] text-[var(--text-3)]">
            (พร้อมใช้งาน — เพิ่ม <code className="text-[var(--cyan)]">R2_ACCOUNT_ID / ACCESS_KEY / BUCKET</code> ใน .env เพื่อเชื่อมต่อ)
          </span>
        )}
        {configured && days.length === 0 && (
          <span className="text-[11px] text-[var(--text-3)]">เชื่อมต่อ R2 แล้ว • ยังไม่มีไฟล์ Archive ย้อนหลัง</span>
        )}
        {statusNote && <span className="text-[11px] text-[#10B981] font-medium">{statusNote}</span>}
      </div>

      {configured && (
        <div className="flex flex-wrap items-center gap-2">
          {days.length > 0 && (
            <>
              <select
                aria-label="Select archived date in Cloudflare R2"
                className="bg-[var(--bg-primary)] text-[var(--text-1)] border border-[var(--border)] rounded px-2 py-1 text-xs focus:outline-none focus:border-[var(--cyan)]"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              >
                {days.map((d) => (
                  <option key={d.date} value={d.date}>
                    {d.date} ({d.fileCount} ไฟล์ • {formatBytes(d.totalSizeBytes)})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busyAction !== null || !selectedDate}
                onClick={handleLoadToMap}
                className="px-2.5 py-1 rounded border border-[#06B6D4]/40 bg-[#06B6D4]/10 text-[#06B6D4] hover:bg-[#06B6D4]/20 disabled:opacity-50 inline-flex items-center gap-1 font-medium"
              >
                <MapPin size={12} />
                {busyAction === 'load' ? 'กำลังโหลด...' : 'โหลดเข้าแผนที่'}
              </button>
              <a
                href={`/api/archive?date=${encodeURIComponent(selectedDate)}&format=csv`}
                className="px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-1)] hover:bg-[var(--bg-card-hover)] inline-flex items-center gap-1 font-medium"
              >
                <Download size={12} /> CSV
              </a>
            </>
          )}
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={handleRunArchiveNow}
            className="px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50 inline-flex items-center gap-1 font-medium"
          >
            <Archive size={12} />
            {busyAction === 'archive' ? 'กำลังย้ายขึ้น R2...' : 'ย้ายข้อมูลเก่าขึ้น R2'}
          </button>
        </div>
      )}
    </div>
  );
}
