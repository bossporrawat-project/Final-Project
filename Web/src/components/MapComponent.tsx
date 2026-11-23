'use client';

import React, { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { haversine, calculateBearing, formatDirectionTH, decimatePoints, computeConsensusMeanRoute } from '@/utils/calculations';

interface MapComponentProps {
  theme: 'dark' | 'light';
  liveData?: any[];
  historyData?: any[];
  clearSignal?: number;
  kmlRoute?: { lat: number; lng: number }[];
  showMeanRoute?: boolean;
}

function isValidPos(pos: any): boolean {
  return (
    pos != null &&
    typeof pos.latitude === 'number' &&
    typeof pos.longitude === 'number' &&
    !isNaN(pos.latitude) &&
    !isNaN(pos.longitude) &&
    !(pos.latitude === 0 && pos.longitude === 0)
  );
}

// Smooth sharp GPS corners using 1-pass Chaikin curve subdivision
function smoothCoordinates(coords: [number, number][]): [number, number][] {
  if (coords.length < 3) return coords;
  const smoothed: [number, number][] = [coords[0]];
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i];
    const p1 = coords[i + 1];
    const q: [number, number] = [0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]];
    const r: [number, number] = [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]];
    smoothed.push(q, r);
  }
  smoothed.push(coords[coords.length - 1]);
  return smoothed;
}

function formatDateTH(raw?: string) {
  if (!raw) return '—';
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' });
    }
  } catch {}
  return '—';
}

function formatTimeTH(raw?: string) {
  if (!raw) return '—';
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
    }
  } catch {}
  return raw;
}

function buildArrowSvg(bearing: number | null, size: number = 11) {
  if (bearing == null || isNaN(bearing)) {
    return `<span style="width:5px;height:5px;border-radius:50%;background:#ffffff;display:block;"></span>`;
  }
  const deg = Math.round(bearing);
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" style="transform: rotate(${deg}deg); display: block;">
      <path d="M12 2L19 20L12 16L5 20L12 2Z" fill="#FFFFFF" />
    </svg>
  `;
}

export default function MapComponent({ theme, liveData = [], historyData = [], clearSignal = 0, kmlRoute, showMeanRoute = false }: MapComponentProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const linesGroupRef = useRef<L.LayerGroup | null>(null);
  const dotsGroupRef = useRef<L.LayerGroup | null>(null);
  const kmlGroupRef = useRef<L.LayerGroup | null>(null);
  const meanGroupRef = useRef<L.LayerGroup | null>(null);

  // Persistent layer registries so open popups are never destroyed on live data updates
  // and old points are NEVER deleted until Clear is clicked
  const accumulatedByDeviceRef = useRef<Record<string, Map<string, any>>>({});
  const liveMarkersRef = useRef<Record<string, L.Marker>>({});
  const dotMarkersRef = useRef<Record<string, L.Marker>>({});
  const routeLayersRef = useRef<Record<string, { casing: L.Polyline; main: L.Polyline; flow: L.Polyline }>>({});

  const getSourceColor = (src?: string) => {
    switch (src) {
      case 'browser': return '#06B6D4'; // Cyan
      case 'traccar': return '#8B5CF6'; // Purple
      case 'iot':     return '#F97316'; // Orange
      case 'native':  return '#10B981'; // Emerald
      default:        return '#94A3B8'; // Slate
    }
  };

  // Initialize Leaflet map once and clean up on unmount / Fast Refresh
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (mapRef.current) {
      try {
        mapRef.current.remove();
      } catch {}
      mapRef.current = null;
    }
    if ((el as any)._leaflet_id) {
      delete (el as any)._leaflet_id;
      el.innerHTML = '';
    }

    const map = L.map(el, {
      center: [14.0724, 100.6011],
      zoom: 14,
      zoomControl: true,
      attributionControl: false,
      preferCanvas: true,
    });

    tileLayerRef.current = L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, className: theme === 'dark' ? 'dark-tiles' : '' }
    ).addTo(map);

    L.control
      .attribution({ prefix: false, position: 'bottomleft' })
      .addAttribution('© <a href="https://www.openstreetmap.org/copyright">OSM</a>')
      .addTo(map);

    linesGroupRef.current = L.layerGroup().addTo(map);
    dotsGroupRef.current = L.layerGroup().addTo(map);
    markersGroupRef.current = L.layerGroup().addTo(map);
    kmlGroupRef.current = L.layerGroup().addTo(map);
    meanGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 100);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        map.invalidateSize();
      });
      ro.observe(el);
    }

    return () => {
      clearTimeout(timer);
      if (ro) ro.disconnect();
      liveMarkersRef.current = {};
      dotMarkersRef.current = {};
      routeLayersRef.current = {};
      tileLayerRef.current = null;
      linesGroupRef.current = null;
      dotsGroupRef.current = null;
      markersGroupRef.current = null;
      kmlGroupRef.current = null;
      meanGroupRef.current = null;
      try {
        map.remove();
      } catch {}
      if ((el as any)._leaflet_id) {
        delete (el as any)._leaflet_id;
      }
      mapRef.current = null;
    };
  }, []);

  // Update tile layer when theme changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    tileLayerRef.current = L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, className: theme === 'dark' ? 'dark-tiles' : '' }
    ).addTo(map);
  }, [theme]);

  // Clear all accumulated points and markers ONLY when the user clicks Clear
  useEffect(() => {
    if (clearSignal === 0) return;
    accumulatedByDeviceRef.current = {};
    liveMarkersRef.current = {};
    dotMarkersRef.current = {};
    routeLayersRef.current = {};
    linesGroupRef.current?.clearLayers();
    dotsGroupRef.current?.clearLayers();
    markersGroupRef.current?.clearLayers();
    meanGroupRef.current?.clearLayers();
  }, [clearSignal]);

  // Draw KML Ground-Truth reference route whenever uploaded/cleared
  useEffect(() => {
    const map = mapRef.current;
    const kmlGroup = kmlGroupRef.current;
    if (!map || !kmlGroup) return;
    kmlGroup.clearLayers();
    if (!kmlRoute || kmlRoute.length === 0) return;

    const latlngs: [number, number][] = kmlRoute.map((p) => [p.lat, p.lng]);
    if (latlngs.length >= 2) {
      L.polyline(latlngs, {
        color: '#FACC15',
        weight: 4,
        opacity: 0.9,
        dashArray: '8 6',
      })
        .bindTooltip('KML (Manual Route / Ground Truth)', { sticky: true })
        .addTo(kmlGroup);
    } else {
      L.circleMarker(latlngs[0], { radius: 7, color: '#FACC15', fillOpacity: 0.9 })
        .bindTooltip('KML Reference Point')
        .addTo(kmlGroup);
    }

    const kmlBounds = L.latLngBounds(latlngs);
    if (kmlBounds.isValid()) {
      map.fitBounds(kmlBounds, { padding: [55, 55], maxZoom: 17 });
    }
  }, [kmlRoute]);

  const hasFittedBounds = useRef(false);

  // Update Route Ribbons, Directional Waypoint Dots, and Live Markers in-place without closing popups or deleting old points
  useEffect(() => {
    if (!mapRef.current || !markersGroupRef.current || !linesGroupRef.current || !dotsGroupRef.current) return;

    const bounds = L.latLngBounds([]);

    // 1. Permanently accumulate every valid historical & live point per device
    const ingestPoint = (pos: any, isFromLive: boolean = false) => {
      if (!isValidPos(pos) || !pos.device_id) return;
      const devId = pos.device_id;
      if (!accumulatedByDeviceRef.current[devId]) {
        accumulatedByDeviceRef.current[devId] = new Map<string, any>();
      }
      const ptMap = accumulatedByDeviceRef.current[devId];
      const rawTime = pos.device_time || pos.recorded_at || pos.updated_at || pos.timestamp || '';
      const coordKey = `${pos.latitude.toFixed(6)}_${pos.longitude.toFixed(6)}`;
      // Use coordinate+time key for live updates so moving live positions never overwrite older points
      const pointKey = (!isFromLive && pos.id) ? String(pos.id) : `${coordKey}_${rawTime}`;

      // Avoid adding duplicate stationary live heartbeats at the exact same coordinate as the most recent entry
      if (isFromLive && ptMap.size > 0) {
        const allPts = Array.from(ptMap.values());
        const lastPt = allPts[allPts.length - 1];
        if (
          lastPt &&
          Math.abs(lastPt.latitude - pos.latitude) < 0.000002 &&
          Math.abs(lastPt.longitude - pos.longitude) < 0.000002
        ) {
          return;
        }
      }

      if (!ptMap.has(pointKey)) {
        ptMap.set(pointKey, { ...pos, _pointKey: pointKey });
        // Compact in-memory store if a live session accumulates > 3000 points for one device
        if (ptMap.size > 3000) {
          const entries = Array.from(ptMap.entries());
          const sampled = decimatePoints(entries, 2000);
          ptMap.clear();
          sampled.forEach(([k, v]) => ptMap.set(k, v));
        }
      }
    };

    historyData.forEach((pos) => ingestPoint(pos, false));
    liveData.forEach((livePos) => ingestPoint(livePos, true));

    const latestBearingByDevice: Record<string, number | null> = {};

    // 2. Render / update route ribbons + all accumulated waypoint dots with direction arrows
    Object.keys(accumulatedByDeviceRef.current).forEach((deviceId) => {
      const ptMap = accumulatedByDeviceRef.current[deviceId];
      const points = Array.from(ptMap.values());
      if (points.length === 0) return;

      points.sort(
        (a, b) =>
          new Date(a.device_time || a.recorded_at || a.updated_at || a.timestamp || 0).getTime() -
          new Date(b.device_time || b.recorded_at || b.updated_at || b.timestamp || 0).getTime()
      );

      // Deduplicate only points that have identical coordinates AND identical timestamps
      const uniquePoints: any[] = [];
      points.forEach((pt) => {
        const prev = uniquePoints[uniquePoints.length - 1];
        const ptTime = pt.device_time || pt.recorded_at || pt.updated_at || pt.timestamp || '';
        const prevTime = prev ? (prev.device_time || prev.recorded_at || prev.updated_at || prev.timestamp || '') : '';
        if (
          !prev ||
          Math.abs(prev.latitude - pt.latitude) > 0.000001 ||
          Math.abs(prev.longitude - pt.longitude) > 0.000001 ||
          ptTime !== prevTime
        ) {
          uniquePoints.push(pt);
        }
      });

      const color = getSourceColor(uniquePoints[0]?.source || 'browser');

      // Distinct coordinate sequence for clean polyline drawing
      const linePoints: any[] = [];
      uniquePoints.forEach((pt) => {
        const prev = linePoints[linePoints.length - 1];
        if (!prev || Math.abs(prev.latitude - pt.latitude) > 0.000001 || Math.abs(prev.longitude - pt.longitude) > 0.000001) {
          linePoints.push(pt);
        }
      });

      let totalDistMeters = 0;
      for (let i = 1; i < linePoints.length; i++) {
        totalDistMeters += haversine(
          linePoints[i - 1].latitude,
          linePoints[i - 1].longitude,
          linePoints[i].latitude,
          linePoints[i].longitude
        );
      }

      if (linePoints.length >= 2) {
        const decimatedLinePts = decimatePoints(linePoints, 1000);
        const rawCoords = decimatedLinePts.map((p) => [p.latitude, p.longitude] as [number, number]);
        const smoothCoords = smoothCoordinates(rawCoords);

        const firstPt = linePoints[0];
        const lastPt = linePoints[linePoints.length - 1];
        const firstRawTime = firstPt.device_time || firstPt.recorded_at || firstPt.updated_at || '';
        const lastRawTime = lastPt.device_time || lastPt.recorded_at || lastPt.updated_at || '';
        const overallBearing = calculateBearing(firstPt.latitude, firstPt.longitude, lastPt.latitude, lastPt.longitude);
        const distLabel =
          totalDistMeters >= 1000
            ? `${(totalDistMeters / 1000).toFixed(2)} km`
            : `${Math.round(totalDistMeters)} m`;

        const routePopup = `
          <div class="pp-t" style="color: ${color}; border-bottom: 1px solid ${color}40; padding-bottom: 4px; margin-bottom: 6px;">
            🛣️ เส้นทาง — ${deviceId}
          </div>
          <div class="pp-r"><span class="l">ระยะทางรวม:</span><span class="v" style="color: ${color}; font-weight: 700;">${distLabel}</span></div>
          <div class="pp-r"><span class="l">ทิศทางรวม:</span><span class="v">${formatDirectionTH(overallBearing)}</span></div>
          <div class="pp-r"><span class="l">จำนวนจุด:</span><span class="v">${uniquePoints.length} จุด</span></div>
          <div class="pp-r"><span class="l">เริ่มต้น:</span><span class="v">${formatDateTH(firstRawTime)} ${formatTimeTH(firstRawTime)}</span></div>
          <div class="pp-r"><span class="l">ล่าสุด:</span><span class="v">${formatDateTH(lastRawTime)} ${formatTimeTH(lastRawTime)}</span></div>
        `;

        const existingRoute = routeLayersRef.current[deviceId];
        if (existingRoute) {
          existingRoute.casing.setLatLngs(smoothCoords);
          existingRoute.casing.setStyle({ color: theme === 'dark' ? '#090D16' : '#FFFFFF' });
          existingRoute.main.setLatLngs(smoothCoords);
          existingRoute.main.setStyle({ color });
          existingRoute.main.setPopupContent(routePopup);
          existingRoute.flow.setLatLngs(smoothCoords);
          existingRoute.flow.setPopupContent(routePopup);
        } else {
          const casing = L.polyline(smoothCoords, {
            color: theme === 'dark' ? '#090D16' : '#FFFFFF',
            weight: 7,
            opacity: 0.8,
            lineCap: 'round',
            lineJoin: 'round',
          });
          const main = L.polyline(smoothCoords, {
            color: color,
            weight: 4,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round',
          });
          const flow = L.polyline(smoothCoords, {
            color: '#FFFFFF',
            weight: 1.8,
            opacity: 0.8,
            dashArray: '6, 14',
            lineCap: 'round',
            lineJoin: 'round',
            className: 'route-flow-line',
          });

          main.bindPopup(routePopup, { autoClose: false, closeOnClick: false });
          flow.bindPopup(routePopup, { autoClose: false, closeOnClick: false });

          linesGroupRef.current?.addLayer(casing);
          linesGroupRef.current?.addLayer(main);
          linesGroupRef.current?.addLayer(flow);
          routeLayersRef.current[deviceId] = { casing, main, flow };
        }
      }

      // Draw up to 80 sampled historical directional waypoints + newest 10 live points per device to keep 60fps at million-row scale
      const renderWaypoints =
        uniquePoints.length <= 90
          ? uniquePoints
          : [...decimatePoints(uniquePoints.slice(0, -10), 80), ...uniquePoints.slice(-10)];

      const activeDotKeysForDevice = new Set<string>();
      renderWaypoints.forEach((pt, idx) => {
        const ptTime = pt.device_time || pt.timestamp || pt.recorded_at || pt.updated_at || '';
        const isStart = idx === 0 && renderWaypoints.length > 1;
        const dotKey = `${deviceId}_${pt._pointKey || pt.id || `${pt.latitude.toFixed(6)}_${pt.longitude.toFixed(6)}_${idx}`}`;
        activeDotKeysForDevice.add(dotKey);

        // Calculate the direction this point goes (to the next distinct coordinate, or from the previous distinct coordinate)
        let bearing: number | null = null;
        let nextTargetIdx: number | null = null;

        for (let j = idx + 1; j < renderWaypoints.length; j++) {
          if (
            Math.abs(renderWaypoints[j].latitude - pt.latitude) > 0.000002 ||
            Math.abs(renderWaypoints[j].longitude - pt.longitude) > 0.000002
          ) {
            bearing = calculateBearing(pt.latitude, pt.longitude, renderWaypoints[j].latitude, renderWaypoints[j].longitude);
            nextTargetIdx = j;
            break;
          }
        }

        if (bearing === null) {
          for (let j = idx - 1; j >= 0; j--) {
            if (
              Math.abs(renderWaypoints[j].latitude - pt.latitude) > 0.000002 ||
              Math.abs(renderWaypoints[j].longitude - pt.longitude) > 0.000002
            ) {
              bearing = calculateBearing(renderWaypoints[j].latitude, renderWaypoints[j].longitude, pt.latitude, pt.longitude);
              break;
            }
          }
        }

        if (idx === renderWaypoints.length - 1) {
          latestBearingByDevice[deviceId] = bearing;
        }

        const targetLabel =
          nextTargetIdx !== null
            ? `จุดที่ #${nextTargetIdx + 1}`
            : idx < renderWaypoints.length - 1
            ? `จุดที่ #${idx + 2}`
            : 'จุดล่าสุด (ปัจจุบัน)';

        const dotPopup = `
          <div class="pp-t" style="color: ${color}; border-bottom: 1px solid ${color}40; padding-bottom: 4px; margin-bottom: 6px;">
            ${isStart ? '🏁 จุดเริ่มต้น (#1)' : `📍 จุดที่ #${idx + 1}`} — ${deviceId}
          </div>
          <div class="pp-r"><span class="l">Direction:</span><span class="v" style="color: ${color}; font-weight: 700;">${formatDirectionTH(bearing)}</span></div>
          <div class="pp-r"><span class="l">มุ่งหน้าไป:</span><span class="v">${targetLabel}</span></div>
          <div class="pp-r"><span class="l">Lat/Lng:</span><span class="v">${pt.latitude.toFixed(6)}, ${pt.longitude.toFixed(6)}</span></div>
          <div class="pp-r"><span class="l">Speed:</span><span class="v">${Number(pt.speed || 0).toFixed(1)} km/h</span></div>
          <div class="pp-r"><span class="l">Date:</span><span class="v">${formatDateTH(ptTime)}</span></div>
          <div class="pp-r"><span class="l">Time:</span><span class="v">${formatTimeTH(ptTime)}</span></div>
        `;

        const roundedBearing = bearing !== null ? Math.round(bearing) : null;
        const iconSize: [number, number] = isStart ? [20, 20] : [18, 18];
        const iconAnchor: [number, number] = isStart ? [10, 10] : [9, 9];

        const makeWaypointIcon = () =>
          L.divIcon({
            className: '',
            html: `
              <div class="${isStart ? 'wp-dir-start' : 'wp-dir-marker'}" style="${isStart ? '' : `background: ${color};`}">
                ${buildArrowSvg(roundedBearing, isStart ? 12 : 10)}
              </div>
            `,
            iconSize,
            iconAnchor,
          });

        const existingDot = dotMarkersRef.current[dotKey];
        if (existingDot) {
          existingDot.setLatLng([pt.latitude, pt.longitude]);
          existingDot.setPopupContent(dotPopup);
          if ((existingDot as any)._bearing !== roundedBearing || (existingDot as any)._isStart !== isStart) {
            existingDot.setIcon(makeWaypointIcon());
            (existingDot as any)._bearing = roundedBearing;
            (existingDot as any)._isStart = isStart;
          }
        } else {
          const wpMarker = L.marker([pt.latitude, pt.longitude], {
            icon: makeWaypointIcon(),
            zIndexOffset: isStart ? 100 : -50,
          });
          (wpMarker as any)._bearing = roundedBearing;
          (wpMarker as any)._isStart = isStart;
          wpMarker.bindPopup(dotPopup, { autoClose: false, closeOnClick: false });
          dotsGroupRef.current?.addLayer(wpMarker);
          dotMarkersRef.current[dotKey] = wpMarker;
        }
      });

      // Prune decimated markers from previous pass for this device only (never deletes across devices)
      Object.keys(dotMarkersRef.current).forEach((key) => {
        if (key.startsWith(`${deviceId}_`) && !activeDotKeysForDevice.has(key)) {
          const oldMarker = dotMarkersRef.current[key];
          if (oldMarker) dotsGroupRef.current?.removeLayer(oldMarker);
          delete dotMarkersRef.current[key];
        }
      });
    });

    // 3. Draw or update live markers in-place with direction arrow (never deleting existing live markers unless cleared)
    liveData.forEach((pos) => {
      if (!isValidPos(pos) || !pos.device_id) return;

      const devId = pos.device_id;
      const srcName = String(pos.source || 'browser');
      const color = getSourceColor(srcName);
      const rawTime = (pos as any).device_time || pos.timestamp || (pos as any).updated_at || (pos as any).recorded_at || '';
      const liveBearing = latestBearingByDevice[devId] ?? null;
      const roundedLiveBearing = liveBearing !== null ? Math.round(liveBearing) : null;

      const popupContent = `
        <div class="pp-t" style="color: ${color}; border-bottom: 1px solid ${color}40; padding-bottom: 4px; margin-bottom: 8px;">
          ${srcName.toUpperCase()} — ${pos.device_id}
        </div>
        <div class="pp-r"><span class="l">Direction:</span><span class="v" style="color: ${color}; font-weight: 700;">${formatDirectionTH(liveBearing)}</span></div>
        <div class="pp-r"><span class="l">Lat:</span><span class="v">${pos.latitude.toFixed(6)}</span></div>
        <div class="pp-r"><span class="l">Lng:</span><span class="v">${pos.longitude.toFixed(6)}</span></div>
        <div class="pp-r"><span class="l">Speed:</span><span class="v">${Number(pos.speed || 0).toFixed(1)} km/h</span></div>
        <div class="pp-r"><span class="l">Date:</span><span class="v">${formatDateTH(rawTime)}</span></div>
        <div class="pp-r"><span class="l">Time:</span><span class="v">${formatTimeTH(rawTime)}</span></div>
      `;

      const makeLiveIcon = () =>
        L.divIcon({
          className: '',
          html: `
            <div class="live-marker-wrap">
              <div class="live-marker-core" style="background: ${color};">
                ${buildArrowSvg(roundedLiveBearing, 11)}
              </div>
            </div>
          `,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });

      const existingLive = liveMarkersRef.current[devId];
      if (existingLive) {
        existingLive.setLatLng([pos.latitude, pos.longitude]);
        existingLive.setPopupContent(popupContent);
        if ((existingLive as any)._bearing !== roundedLiveBearing) {
          existingLive.setIcon(makeLiveIcon());
          (existingLive as any)._bearing = roundedLiveBearing;
        }
      } else {
        const marker = L.marker([pos.latitude, pos.longitude], {
          icon: makeLiveIcon(),
          zIndexOffset: 500,
        });
        (marker as any)._bearing = roundedLiveBearing;
        marker.bindPopup(popupContent, { autoClose: false, closeOnClick: false });
        marker.bindTooltip(`<span style="color:${color}">●</span> ${pos.device_id}`, {
          permanent: true,
          direction: 'right',
          className: 'device-tooltip',
          offset: [12, 0],
        });

        markersGroupRef.current?.addLayer(marker);
        liveMarkersRef.current[devId] = marker;
      }

      bounds.extend([pos.latitude, pos.longitude]);
    });

    if (liveData.length > 0 && bounds.isValid() && !hasFittedBounds.current) {
      mapRef.current.fitBounds(bounds, { padding: [55, 55], maxZoom: 16 });
      hasFittedBounds.current = true;
    }

    // 4. Draw or clear Multi-Device Consensus Mean Route (เส้นค่ากลาง)
    const meanGroup = meanGroupRef.current;
    if (meanGroup) {
      meanGroup.clearLayers();
      if (showMeanRoute) {
        const activeIds = new Set([
          ...liveData.filter(isValidPos).map((p) => String(p.device_id)),
          ...historyData.filter(isValidPos).map((p) => String(p.device_id)),
        ]);
        const routesByDev: Record<string, Array<{ lat: number; lng: number; timeMs?: number }>> = {};
        Object.keys(accumulatedByDeviceRef.current).forEach((devId) => {
          if (activeIds.size > 0 && !activeIds.has(devId)) return;
          const pts = Array.from(accumulatedByDeviceRef.current[devId].values())
            .filter(isValidPos)
            .map((p) => {
              const rawT = p.device_time || p.recorded_at || p.updated_at || p.timestamp;
              const tMs = rawT ? Date.parse(String(rawT)) : NaN;
              return {
                lat: p.latitude,
                lng: p.longitude,
                timeMs: !isNaN(tMs) ? tMs : undefined,
              };
            })
            .sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));
          if (pts.length > 0) routesByDev[devId] = pts;
        });

        const consensus = computeConsensusMeanRoute(routesByDev);
        if (consensus.points.length >= 2) {
          const sampled = decimatePoints(consensus.points, 600);
          const rawCoords = sampled.map((p) => [p.lat, p.lng] as [number, number]);
          const smoothMean = smoothCoordinates(rawCoords);

          let meanDistM = 0;
          for (let i = 1; i < consensus.points.length; i++) {
            meanDistM += haversine(
              consensus.points[i - 1].lat,
              consensus.points[i - 1].lng,
              consensus.points[i].lat,
              consensus.points[i].lng
            );
          }
          const meanDistLabel =
            meanDistM >= 1000 ? `${(meanDistM / 1000).toFixed(2)} km` : `${Math.round(meanDistM)} m`;
          const methodLabel =
            consensus.method === 'time-bucket' ? 'เฉลี่ยร่วมตามช่วงเวลา (5s)' : 'เฉลี่ยตามสัดส่วนระยะเส้นทาง';

          const meanPopup = `
            <div class="pp-t" style="color: #EC4899; border-bottom: 1px solid #EC489940; padding-bottom: 4px; margin-bottom: 6px;">
              🧭 เส้นค่ากลาง (Mean Route)
            </div>
            <div class="pp-r"><span class="l">รวมอุปกรณ์:</span><span class="v" style="color: #EC4899; font-weight: 700;">${consensus.deviceCount} เครื่อง</span></div>
            <div class="pp-r"><span class="l">วิธีคำนวณ:</span><span class="v">${methodLabel}</span></div>
            <div class="pp-r"><span class="l">ระยะทางเส้นกลาง:</span><span class="v">${meanDistLabel}</span></div>
            <div class="pp-r"><span class="l">จำนวนจุด:</span><span class="v">${consensus.points.length} จุด</span></div>
          `;

          L.polyline(smoothMean, {
            color: theme === 'dark' ? '#090D16' : '#FFFFFF',
            weight: 8,
            opacity: 0.85,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(meanGroup);

          L.polyline(smoothMean, {
            color: '#EC4899',
            weight: 4.5,
            opacity: 0.98,
            lineCap: 'round',
            lineJoin: 'round',
          })
            .bindPopup(meanPopup, { autoClose: false, closeOnClick: false })
            .bindTooltip(`เส้นค่ากลาง (${consensus.deviceCount} เครื่อง)`, { sticky: true })
            .addTo(meanGroup);

          L.polyline(smoothMean, {
            color: '#FFFFFF',
            weight: 1.6,
            opacity: 0.9,
            dashArray: '5, 9',
            lineCap: 'round',
            lineJoin: 'round',
          })
            .bindPopup(meanPopup, { autoClose: false, closeOnClick: false })
            .addTo(meanGroup);
        } else if (consensus.points.length === 1) {
          const c = consensus.points[0];
          L.circleMarker([c.lat, c.lng], {
            radius: 9,
            color: '#FFFFFF',
            weight: 2,
            fillColor: '#EC4899',
            fillOpacity: 0.95,
          })
            .bindPopup(
              `<div class="pp-t" style="color:#EC4899">🧭 จุดค่ากลาง (${consensus.deviceCount} เครื่อง)</div><div class="pp-r"><span class="l">Lat/Lng:</span><span class="v">${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}</span></div>`
            )
            .bindTooltip(`จุดค่ากลาง (${consensus.deviceCount} เครื่อง)`, { permanent: true, direction: 'top' })
            .addTo(meanGroup);
        }
      }
    }
  }, [liveData, historyData, theme, showMeanRoute]);

  return (
    <div
      id="map"
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        minHeight: '380px',
        zIndex: 1,
      }}
    />
  );
}
