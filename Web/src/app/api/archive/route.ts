import { NextResponse } from 'next/server';
import {
  getR2Config,
  listR2ArchiveDays,
  readR2ArchiveByDate,
  archiveSupabaseHistoryToR2,
} from '@/lib/r2Archive';

/**
 * GET /api/archive
 * - Default: returns R2 configuration status and archived YYYY-MM-DD dates.
 * - ?date=YYYY-MM-DD: returns archived GPS points for that date (`format=csv` returns downloadable CSV).
 */
export async function GET(request: Request) {
  try {
    const cfg = getR2Config();
    if (!cfg.isConfigured) {
      return NextResponse.json({
        configured: false,
        days: [],
        message: 'Cloudflare R2 credentials are not configured yet.',
      });
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const format = searchParams.get('format');

    if (!date) {
      const days = await listR2ArchiveDays();
      return NextResponse.json({ configured: true, bucket: cfg.bucket, days });
    }

    const rows = await readR2ArchiveByDate(date, 50000);

    if (format === 'csv') {
      const headers = 'id,device_id,source,latitude,longitude,speed,accuracy,device_time,server_time\n';
      const csvBody = rows
        .map(
          (d) =>
            `${d.id || ''},${d.device_id || ''},${d.source || ''},${d.latitude},${d.longitude},${d.speed ?? 0},${d.accuracy ?? ''},${d.device_time || d.recorded_at || ''},${d.server_time || ''}`
        )
        .join('\n');
      return new NextResponse(headers + csvBody, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="r2_archive_${date}.csv"`,
        },
      });
    }

    return NextResponse.json({
      configured: true,
      date,
      count: rows.length,
      rows,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to read R2 archive' }, { status: 500 });
  }
}

/**
 * POST /api/archive
 * Moves old gps_history rows from Supabase to Cloudflare R2 (protected by CRON_SECRET if configured).
 */
export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (cronSecret) {
      const auth = request.headers.get('authorization');
      const { searchParams } = new URL(request.url);
      const tokenParam = searchParams.get('secret');
      if (auth !== `Bearer ${cronSecret}` && tokenParam !== cronSecret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const cfg = getR2Config();
    if (!cfg.isConfigured) {
      return NextResponse.json(
        { error: 'Cloudflare R2 credentials are not configured.' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const retentionHours = body?.retentionHours ? Number(body.retentionHours) : undefined;
    const summary = await archiveSupabaseHistoryToR2({ retentionHours });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Archive run failed' }, { status: 500 });
  }
}
