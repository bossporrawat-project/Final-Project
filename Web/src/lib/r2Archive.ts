import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import zlib from 'zlib';

export interface R2ArchiveDaySummary {
  date: string;
  fileCount: number;
  totalSizeBytes: number;
  lastModified: string | null;
}

export interface ArchiveRunSummary {
  archivedRows: number;
  deletedRows: number;
  uploadedFiles: number;
  retentionHours: number;
  cutoffIso: string;
  datesAffected: string[];
}

export function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() || '';
  const bucket = process.env.R2_BUCKET_NAME?.trim() || '';
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    isConfigured: Boolean(accountId && accessKeyId && secretAccessKey && bucket),
  };
}

export function createR2Client(): { client: S3Client; bucket: string } {
  const cfg = getR2Config();
  if (!cfg.isConfigured) {
    throw new Error('Cloudflare R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME) are not configured.');
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  return { client, bucket: cfg.bucket };
}

/**
 * Lists all archived YYYY-MM-DD dates stored under `archives/` in Cloudflare R2.
 */
export async function listR2ArchiveDays(): Promise<R2ArchiveDaySummary[]> {
  const { client, bucket } = createR2Client();
  const byDate = new Map<string, R2ArchiveDaySummary>();
  let continuationToken: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'archives/',
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of res.Contents || []) {
      const key = obj.Key || '';
      const match = key.match(/^archives\/(\d{4}-\d{2}-\d{2})\//);
      if (!match) continue;
      const date = match[1];
      const existing = byDate.get(date) || {
        date,
        fileCount: 0,
        totalSizeBytes: 0,
        lastModified: null,
      };
      existing.fileCount += 1;
      existing.totalSizeBytes += obj.Size || 0;
      const modIso = obj.LastModified ? obj.LastModified.toISOString() : null;
      if (modIso && (!existing.lastModified || modIso > existing.lastModified)) {
        existing.lastModified = modIso;
      }
      byDate.set(date, existing);
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Reads and gunzips all archived `.jsonl.gz` parts for a specific Bangkok date (`YYYY-MM-DD`).
 */
export async function readR2ArchiveByDate(date: string, maxRows: number = 50000): Promise<any[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD.');
  }

  const { client, bucket } = createR2Client();
  const prefix = `archives/${date}/`;
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of res.Contents || []) {
      if (obj.Key && obj.Key.endsWith('.jsonl.gz')) {
        keys.push(obj.Key);
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  keys.sort();

  const rows: any[] = [];
  const seenIds = new Set<string>();

  for (const key of keys) {
    if (rows.length >= maxRows) break;
    const objRes = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!objRes.Body) continue;
    const compressedBytes = await objRes.Body.transformToByteArray();
    const jsonl = zlib.gunzipSync(Buffer.from(compressedBytes)).toString('utf8');
    const lines = jsonl.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const dedupKey = parsed.id
          ? String(parsed.id)
          : `${parsed.device_id}_${parsed.device_time || parsed.server_time || ''}`;
        if (!seenIds.has(dedupKey)) {
          seenIds.add(dedupKey);
          rows.push(parsed);
          if (rows.length >= maxRows) break;
        }
      } catch {
        // Skip malformed NDJSON lines safely
      }
    }
  }

  return rows;
}

function getBangkokDateStr(row: any): string {
  const raw = row.server_time || row.device_time || row.recorded_at || new Date().toISOString();
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  }
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/**
 * Moves gps_history rows older than `retentionHours` from Supabase to gzipped NDJSON files on Cloudflare R2.
 * Rows are only deleted from Supabase after R2 confirms upload success.
 */
export async function archiveSupabaseHistoryToR2(options?: {
  retentionHours?: number;
  maxRowsPerRun?: number;
  batchSize?: number;
}): Promise<ArchiveRunSummary> {
  const retentionHours = Math.max(1, options?.retentionHours ?? Number(process.env.ARCHIVE_RETENTION_HOURS || 48));
  const maxRowsPerRun = Math.max(100, options?.maxRowsPerRun ?? 50000);
  const batchSize = Math.min(1000, Math.max(100, options?.batchSize ?? 1000));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and Key are required for archiving.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { client: r2, bucket } = createR2Client();
  const cutoffIso = new Date(Date.now() - retentionHours * 3600 * 1000).toISOString();

  let archivedRows = 0;
  let deletedRows = 0;
  let uploadedFiles = 0;
  const datesAffected = new Set<string>();

  while (archivedRows < maxRowsPerRun) {
    const { data: batch, error } = await supabase
      .from('gps_history')
      .select('*')
      .lt('server_time', cutoffIso)
      .order('server_time', { ascending: true })
      .limit(Math.min(batchSize, maxRowsPerRun - archivedRows));

    if (error) throw new Error(`Supabase fetch error: ${error.message}`);
    if (!batch || batch.length === 0) break;

    // Group rows by Bangkok date so each day stays cleanly organized under archives/YYYY-MM-DD/
    const groupedByDate = new Map<string, any[]>();
    for (const row of batch) {
      const dateStr = getBangkokDateStr(row);
      const list = groupedByDate.get(dateStr) || [];
      list.push(row);
      groupedByDate.set(dateStr, list);
    }

    const uploadedIds: string[] = [];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');

    for (const [dateStr, dateRows] of groupedByDate.entries()) {
      const ndjson = dateRows.map((r) => JSON.stringify(r)).join('\n') + '\n';
      const gzipped = zlib.gzipSync(Buffer.from(ndjson, 'utf8'), { level: 9 });
      const partKey = `archives/${dateStr}/part_${stamp}_${uploadedFiles + 1}.jsonl.gz`;

      const putRes = await r2.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: partKey,
          Body: gzipped,
          ContentType: 'application/x-ndjson',
          ContentEncoding: 'gzip',
          Metadata: {
            row_count: String(dateRows.length),
            archive_date: dateStr,
          },
        })
      );

      if ((putRes.$metadata.httpStatusCode || 500) >= 300) {
        throw new Error(`R2 upload failed for ${partKey}`);
      }

      uploadedFiles += 1;
      archivedRows += dateRows.length;
      datesAffected.add(dateStr);
      for (const r of dateRows) {
        if (r.id) uploadedIds.push(String(r.id));
      }
    }

    // Delete archived IDs in chunks of 200 after R2 upload succeeded
    for (let i = 0; i < uploadedIds.length; i += 200) {
      const chunkIds = uploadedIds.slice(i, i + 200);
      const { error: delErr } = await supabase
        .from('gps_history')
        .delete()
        .in('id', chunkIds);
      if (delErr) {
        throw new Error(`Supabase delete error after R2 upload: ${delErr.message}`);
      }
      deletedRows += chunkIds.length;
    }

    if (batch.length < batchSize) break;
  }

  return {
    archivedRows,
    deletedRows,
    uploadedFiles,
    retentionHours,
    cutoffIso,
    datesAffected: Array.from(datesAffected).sort(),
  };
}
