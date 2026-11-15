import React from 'react';
import { Moon, Sun, Globe, Crosshair, Smartphone, Pencil } from 'lucide-react';

interface HeaderProps {
  deviceName: string;
  theme: 'dark' | 'light';
  lang: 'th' | 'en';
  onToggleTheme: () => void;
  onToggleLang: () => void;
  onChangeDeviceName?: () => void;
  traccarError?: string | null;
  status: {
    supabase: boolean;
    gps: boolean;
    traccar: boolean;
  };
}

export default function Header({
  deviceName,
  theme,
  lang,
  onToggleTheme,
  onToggleLang,
  onChangeDeviceName,
  traccarError,
  status,
}: HeaderProps) {
  return (
    <header id="hdr">
      <div className="hdr-l">
        <div className="logo">
          <Crosshair size={24} className="logo-icon" strokeWidth={2} />
          <span>Tracker by boss</span>
        </div>
        <div 
          className="dev-badge" 
          onClick={onChangeDeviceName}
          title="คลิกเพื่อเปลี่ยนชื่อ Device ของ Browser"
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          <Smartphone size={16} strokeWidth={1.5} className="text-[#06B6D4]" />
          <span>Device:</span> <b id="my-dev">{deviceName || '—'}</b>
          <Pencil size={13} style={{ marginLeft: '4px', opacity: 0.7 }} />
        </div>
      </div>
      <div className="hdr-r">
        <div className="sg">
          <div className={`si ${status.supabase ? 'on' : ''}`} id="st-supa">
            <div className="sd"></div>
            <span>Supabase</span>
          </div>
          <div className={`si ${status.gps ? 'on' : ''}`} id="st-gps">
            <div className="sd"></div>
            <span>GPS</span>
          </div>
          <div 
            className={`si ${status.traccar ? 'on' : ''}`} 
            id="st-trc"
            title={traccarError || (status.traccar ? 'Traccar เชื่อมต่อแล้ว' : 'Traccar Offline')}
          >
            <div className="sd"></div>
            <span>Traccar</span>
          </div>
        </div>
        <button
          className="tb"
          id="btn-theme"
          onClick={onToggleTheme}
          title="Dark/Light"
          aria-label="Toggle Theme"
        >
          {theme === 'dark' ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}
        </button>
        <button
          className="tb"
          id="btn-lang"
          onClick={onToggleLang}
          title="TH/EN"
          aria-label="Toggle Language"
        >
          <Globe size={18} strokeWidth={1.5} className={lang === 'th' ? 'text-[#06B6D4]' : ''} />
        </button>
      </div>
    </header>
  );
}
