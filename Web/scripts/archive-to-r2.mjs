import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import zlib from 'node:zlib';

const RETENTION_HOURS = Math.max(1, Number(process.env.ARCHIVE_RETENTION_HOURS || 48));
const MAX_ROWS_PER_RUN = Math.max(100, Number(process.env.ARCHIVE_MAX_ROWS || 100000));
const BATCH_SIZE = 1000;
const DRY_RUN = process.argv.includes('--dry-run');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

const r2AccountId = (process.env.R2_ACCOUNT_ID || '').trim();
const r2AccessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
const r2SecretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const r2Bucket = (process.env.R2_BUCKET_NAME || '').trim();

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}

if (!DRY_RUN && (!r2AccountId || !r2AccessKeyId || !r2SecretAccessKey || !r2Bucket)) {
  console.error('Missing R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const r2 = !DRY_RUN
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      },
    })
  : null;

function getBangkokDateStr(row) {
  const raw = row.server_time || row.device_time || row.recorded_at || new Date().toISOString();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  }
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

async function main() {
  const cutoffIso = new Date(Date.now() - RETENTION_HOURS * 3600 * 1000).toISOString();
  console.log(`[R2 Archive] Starting${DRY_RUN ? ' (DRY RUN)' : ''} — retention=${RETENTION_HOURS}h, cutoff=${cutoffIso}`);

  let totalArchived = 0;
  let totalDeleted = 0;
  let totalFiles = 0;

  while (totalArchived < MAX_ROWS_PER_RUN) {
    const limit = Math.min(BATCH_SIZE, MAX_ROWS_PER_RUN - totalArchived);
    const { data: batch, error } = await supabase
      .from('gps_history')
      .select('*')
      .lt('server_time', cutoffIso)
      .order('server_time', { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(`Supabase query failed: ${error.message}`);
    }
    if (!batch || batch.length === 0) {
      break;
    }

    const grouped = new Map();
    for (const row of batch) {
      const dateStr = getBangkokDateStr(row);
      const list = grouped.get(dateStr) || [];
      list.push(row);
      grouped.set(dateStr, list);
    }

    const uploadedIds = [];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');

    for (const [dateStr, dateRows] of grouped.entries()) {
      const ndjson = dateRows.map((r) => JSON.stringify(r)).join('\n') + '\n';
      const gzipped = zlib.gzipSync(Buffer.from(ndjson, 'utf8'), { level: 9 });
      const key = `archives/${dateStr}/part_${stamp}_${totalFiles + 1}.jsonl.gz`;

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would upload ${key}: ${dateRows.length} rows (${gzipped.length} bytes gzipped)`);
      } else {
        const putRes = await r2.send(
          new PutObjectCommand({
            Bucket: r2Bucket,
            Key: key,
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
          throw new Error(`R2 upload failed for ${key}`);
        }
        console.log(`Uploaded ${key} (${dateRows.length} rows, ${(gzipped.length / 1024).toFixed(1)} KB)`);
      }

      totalFiles += 1;
      totalArchived += dateRows.length;
      for (const r of dateRows) {
        if (r.id) uploadedIds.push(String(r.id));
      }
    }

    if (!DRY_RUN) {
      for (let i = 0; i < uploadedIds.length; i += 200) {
        const chunkIds = uploadedIds.slice(i, i + 200);
        const { error: delErr } = await supabase.from('gps_history').delete().in('id', chunkIds);
        if (delErr) {
          throw new Error(`Supabase delete failed after R2 upload: ${delErr.message}`);
        }
        totalDeleted += chunkIds.length;
      }
    } else {
      break;
    }

    if (batch.length < limit) break;
  }

  console.log(`[R2 Archive] Done: archived=${totalArchived}, deleted=${totalDeleted}, files=${totalFiles}`);
}

main().catch((err) => {
  console.error('[R2 Archive] Fatal error:', err);
  process.exit(1);
});
