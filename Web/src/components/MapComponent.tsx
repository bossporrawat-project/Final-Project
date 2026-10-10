import React, { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

interface MapComponentProps {
  theme: 'dark' | 'light';
  liveData?: any[];
  historyData?: any[];
}

export default function MapComponent({ theme, liveData = [], historyData = [] }: MapComponentProps) {
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const linesGroupRef = useRef<L.LayerGroup | null>(null);

  const getSourceColor = (src: string) => {
    switch (src) {
      case 'browser': return '#06B6D4'; // Cyan
      case 'traccar': return '#8B5CF6'; // Purple
      case 'iot': return '#F97316'; // Orange
      default: return '#94A3B8'; // Slate
    }
  };

  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map('map', {
        center: [14.0724, 100.6011],
        zoom: 13,
        zoomControl: true,
        attributionControl: false,
      });

      L.control
        .attribution({ prefix: false, position: 'bottomleft' })
        .addAttribution(
          '© <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        )
        .addTo(mapRef.current);
        
      markersGroupRef.current = L.layerGroup().addTo(mapRef.current);
      linesGroupRef.current = L.layerGroup().addTo(mapRef.current);
    }

    const map = mapRef.current;
    
    // Update theme
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    tileLayerRef.current = L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, className: theme === 'dark' ? 'dark-tiles' : '' }
    ).addTo(map);

    return () => {
      // Don't remove map to preserve state, just handled via react
    };
  }, [theme]);
  
  const hasFittedBounds = useRef(false);

  // Update Markers and Lines
  useEffect(() => {
    if (!mapRef.current || !markersGroupRef.current || !linesGroupRef.current) return;
    
    markersGroupRef.current.clearLayers();
    linesGroupRef.current.clearLayers();
    
    const bounds = L.latLngBounds([]);
    
    // 1. Draw historical paths (Polylines)
    const historyByDevice: Record<string, any[]> = {};
    historyData.forEach(pos => {
      if (pos.latitude === 0 && pos.longitude === 0) return;
      if (!historyByDevice[pos.device_id]) historyByDevice[pos.device_id] = [];
      historyByDevice[pos.device_id].push(pos);
    });

    Object.keys(historyByDevice).forEach(deviceId => {
      const points = historyByDevice[deviceId];
      // Sort by time ascending
      points.sort((a, b) => new Date(a.recorded_at || a.updated_at || 0).getTime() - new Date(b.recorded_at || b.updated_at || 0).getTime());
      
      const latlngs = points.map(p => [p.latitude, p.longitude] as [number, number]);
      const color = getSourceColor(points[0].source);
      
      const polyline = L.polyline(latlngs, {
        color: color,
        weight: 3,
        opacity: 0.5,
        dashArray: '5, 8',
        lineJoin: 'round'
      });
      linesGroupRef.current?.addLayer(polyline);
    });

    // 2. Draw live markers
    liveData.forEach(pos => {
      // Don't plot dummy status coordinates
      if (pos.latitude === 0 && pos.longitude === 0) return;

      const color = getSourceColor(pos.source);
      const marker = L.circleMarker([pos.latitude, pos.longitude], {
        radius: 8,
        fillColor: color,
        color: '#FFFFFF',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9
      });
      
      const popupContent = `
        <div class="pp-t" style="color: ${color}; border-bottom: 1px solid ${color}40; padding-bottom: 4px; margin-bottom: 8px;">
          ${pos.source.toUpperCase()} - ${pos.device_id}
        </div>
        <div class="pp-r"><span class="l">Lat:</span><span class="v">${pos.latitude.toFixed(6)}</span></div>
        <div class="pp-r"><span class="l">Lng:</span><span class="v">${pos.longitude.toFixed(6)}</span></div>
        <div class="pp-r"><span class="l">Speed:</span><span class="v">${(pos.speed || 0).toFixed(1)} km/h</span></div>
        <div class="pp-r"><span class="l">Time:</span><span class="v">${(() => { const timeStr = pos.timestamp || (pos as any).updated_at || (pos as any).recorded_at || ''; try { const d = new Date(timeStr); if (!isNaN(d.getTime())) return d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }); } catch(e) {} return timeStr; })()}</span></div>
      `;
      
      marker.bindPopup(popupContent);
      
      // Permanent Tooltip to always show device name
      marker.bindTooltip(`<b>${pos.device_id}</b>`, {
        permanent: true,
        direction: 'right',
        className: 'device-tooltip',
        offset: [10, 0]
      });

      markersGroupRef.current?.addLayer(marker);
      bounds.extend([pos.latitude, pos.longitude]);
    });
    
    if (liveData.length > 0 && bounds.isValid() && !hasFittedBounds.current) {
      mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      hasFittedBounds.current = true;
    }
    
  }, [liveData, historyData]);

  return <div id="map" />;
}
