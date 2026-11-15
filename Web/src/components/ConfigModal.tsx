import React, { useState, useEffect } from 'react';

interface ConfigModalProps {
  isVisible: boolean;
  onClose?: () => void;
  onSave: (config: {
    supabaseUrl: string;
    supabaseKey: string;
    deviceName: string;
    traccarToken: string;
  }) => void;
  initialValues?: {
    supabaseUrl?: string;
    supabaseKey?: string;
    deviceName?: string;
    traccarToken?: string;
  };
}

export default function ConfigModal({ isVisible, onClose, onSave, initialValues }: ConfigModalProps) {
  const [url, setUrl] = useState(initialValues?.supabaseUrl || '');
  const [key, setKey] = useState(initialValues?.supabaseKey || '');
  const [name, setName] = useState(initialValues?.deviceName || '');
  const [trc, setTrc] = useState(initialValues?.traccarToken || '');

  useEffect(() => {
    if (initialValues) {
      if (initialValues.supabaseUrl) setUrl(initialValues.supabaseUrl);
      if (initialValues.supabaseKey) setKey(initialValues.supabaseKey);
      if (initialValues.deviceName) setName(initialValues.deviceName);
      if (initialValues.traccarToken) setTrc(initialValues.traccarToken);
    }
  }, [initialValues, isVisible]);

  if (!isVisible) return null;

  return (
    <div className="mo" id="cfg-modal">
      <div className="md">
        <h2>🛰️ <span data-i18n="m_title">ตั้งค่า Tracker by boss Dashboard</span></h2>
        <p data-i18n="m_desc">
          กรุณาใส่ข้อมูล Supabase ของคุณ (สร้างฟรีที่ <a href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a>)
        </p>
        
        <label htmlFor="in-url">Supabase Project URL</label>
        <input 
          type="text" 
          id="in-url" 
          placeholder="https://xxxxx.supabase.co" 
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        
        <label htmlFor="in-key">Supabase Anon Key</label>
        <input 
          type="text" 
          id="in-key" 
          placeholder="eyJhbGciOiJIUzI1NiIs..." 
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        
        <label htmlFor="in-name" data-i18n="m_dev_label">ชื่ออุปกรณ์ของคุณ</label>
        <input 
          type="text" 
          id="in-name" 
          placeholder="Phone_1, Car_A ..." 
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        
        <label htmlFor="in-trc">
          Traccar API Token <small data-i18n="m_trc_hint">(ถ้ามี — ไม่ต้องก็ได้)</small>
        </label>
        <input 
          type="text" 
          id="in-trc" 
          placeholder="—" 
          value={trc}
          onChange={(e) => setTrc(e.target.value)}
        />
        
        <div className="md-acts">
          {onClose && (
            <button className="btn" onClick={onClose}>
              ยกเลิก
            </button>
          )}
          <button 
            className="btn btn-p" 
            onClick={() => onSave({ supabaseUrl: url, supabaseKey: key, deviceName: name, traccarToken: trc })}
          >
            🚀 <span data-i18n="btn_go">บันทึกและเริ่มใช้งาน</span>
          </button>
        </div>
      </div>
    </div>
  );
}
