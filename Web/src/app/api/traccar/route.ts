import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!url || !key) {
      return NextResponse.json({ error: 'Supabase credentials not configured on server' }, { status: 500 });
    }

    const supabase = createClient(url, key);
    
    // Parse URL params for simple token security
    const { searchParams } = new URL(request.url);
    const reqToken = searchParams.get('token');
    const envToken = process.env.TRACCAR_SECRET;
    
    // If TRACCAR_SECRET is set in .env.local, we enforce it
    if (envToken && reqToken !== envToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse Payload
    const body = await request.json();
    
    // Handle Nested (Standard Traccar Forwarding) or Flat JSON
    const deviceId = body.device?.uniqueId || body.device?.name || body.deviceId || body.id || 'Unknown_Traccar';
    const lat = body.position?.latitude || body.latitude || 0;
    const lng = body.position?.longitude || body.longitude || 0;
    
    // Traccar sends speed in knots. Convert to km/h (1 knot = 1.852 km/h)
    const rawSpeed = body.position?.speed || body.speed || 0;
    const speedKmH = rawSpeed * 1.852; 
    
    const accuracy = body.position?.accuracy || body.accuracy || null;
    
    // Use Traccar fixTime or fallback to server time
    let timestamp = body.position?.fixTime || body.timestamp;
    if (!timestamp) {
      // Sometimes Traccar sends deviceTime which is unix timestamp
      if (body.position?.deviceTime) {
        timestamp = new Date(body.position.deviceTime).toISOString();
      } else {
        timestamp = new Date().toISOString();
      }
    }

    const now = new Date().toISOString();

    // 1. Update Live Position
    await supabase.from('gps_positions').upsert({
      device_id: deviceId.toString(),
      device_name: deviceId.toString(),
      latitude: lat,
      longitude: lng,
      speed: speedKmH,
      accuracy: accuracy,
      source: 'traccar',
      is_online: true,
      updated_at: now
    }, { onConflict: 'device_id' });

    // 2. Insert into History
    await supabase.from('gps_history').insert({
      device_id: deviceId.toString(),
      latitude: lat,
      longitude: lng,
      speed: speedKmH,
      accuracy: accuracy,
      source: 'traccar',
      recorded_at: timestamp
    });

    return NextResponse.json({ success: true, message: 'Data logged to Supabase' });

  } catch (error: any) {
    console.error('Traccar Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
