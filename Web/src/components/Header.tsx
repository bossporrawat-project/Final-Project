import React from 'react';
import { Moon, Sun, Globe, Crosshair, Smartphone } from 'lucide-react';

interface HeaderProps {
  deviceName: string;
  theme: 'dark' | 'light';
  lang: 'th' | 'en';
  onToggleTheme: () => void;
  onToggleLang: () => void;
  status: {
    supabase: boolean;
    gps: boolean;
    traccar: boolean;
  };
  onChangeDeviceName?: () => void;
}

export default function Header({
  deviceName,
  theme,
  lang,
  onToggleTheme,
  onToggleLang,
  status,
  onChangeDeviceName,
}: HeaderProps) {
  return (
    <header id="hdr">
      <div className="hdr-l">
        <div className="logo">
          <Crosshair size={24} className="logo-icon" strokeWidth={2} />
          <span>Tracker by boss</span>
        </div>
        <div 
          className="dev-badge" style={{ cursor: "pointer", transition: "0.2s" }} onMouseOver={(e) => e.currentTarget.style.opacity = "0.7"} onMouseOut={(e) => e.currentTarget.style.opacity = "1"} 
          onClick={onChangeDeviceName}
          title="Click to change device name"
        >
          <Smartphone size={16} strokeWidth={1.5} className="text-[#06B6D4]" />
          <span>Device:</span> <b id="my-dev">{deviceName || 'â€”'}</b>
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
          <div className={`si ${status.traccar ? 'on' : ''}`} id="st-trc">
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

