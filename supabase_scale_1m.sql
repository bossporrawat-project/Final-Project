-- ============================================================================
-- Tracker by boss — Million-Row Scale Schema, Indexes & Server-Side RPCs
-- รองรับข้อมูลระดับ 1,000,000+ ถึง 10,000,000+ แถว บน Supabase PostgreSQL
-- รันสคริปต์นี้ใน Supabase Dashboard > SQL Editor > New Query
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. ตารางหลัก (สร้างหากยังไม่มี)
CREATE TABLE IF NOT EXISTS public.gps_positions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id TEXT UNIQUE NOT NULL,
    device_name TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    speed DOUBLE PRECISION DEFAULT 0,
    accuracy DOUBLE PRECISION,
    source TEXT,
    app_status TEXT DEFAULT 'Tracking Active',
    is_online BOOLEAN DEFAULT true,
    device_time TIMESTAMPTZ DEFAULT NOW(),
    server_time TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.gps_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    speed DOUBLE PRECISION DEFAULT 0,
    accuracy DOUBLE PRECISION,
    source TEXT,
    device_time TIMESTAMPTZ DEFAULT NOW(),
    server_time TIMESTAMPTZ DEFAULT NOW(),
    recorded_at TIMESTAMPTZ
);

ALTER TABLE public.gps_history
    ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_gps_history_device_time'
    ) THEN
        ALTER TABLE public.gps_history
            ADD CONSTRAINT uq_gps_history_device_time UNIQUE (device_id, device_time);
    END IF;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Skipping uq_gps_history_device_time constraint: %', SQLERRM;
END $$;

-- 2. Time-Series Indexes สำหรับระดับล้านแถว
-- Composite B-Tree สำหรับดึงเส้นทางแยกราย Device และการแบ่งหน้า (Pagination)
CREATE INDEX IF NOT EXISTS idx_gps_positions_updated
    ON public.gps_positions (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_gps_history_device_devtime
    ON public.gps_history (device_id, device_time DESC);

CREATE INDEX IF NOT EXISTS idx_gps_history_device_srvtime
    ON public.gps_history (device_id, server_time DESC);

CREATE INDEX IF NOT EXISTS idx_gps_history_server_time_desc
    ON public.gps_history (server_time DESC);

-- BRIN Index ขนาดเล็กมาก (~1,000x เล็กกว่า B-Tree) เหมาะกับตาราง Time-Series หลายล้านแถว
CREATE INDEX IF NOT EXISTS idx_gps_history_brin_server_time
    ON public.gps_history USING BRIN (server_time) WITH (pages_per_range = 128);

CREATE INDEX IF NOT EXISTS idx_gps_history_brin_device_time
    ON public.gps_history USING BRIN (device_time) WITH (pages_per_range = 128);

-- 3. Queue-Safe Trigger (ป้องกันข้อมูลค้างคิวเก่าเขียนทับตำแหน่งล่าสุด)
CREATE OR REPLACE FUNCTION public.fn_sync_latest_gps_position()
RETURNS TRIGGER AS $$
DECLARE
    eff_time TIMESTAMPTZ;
BEGIN
    eff_time := COALESCE(NEW.device_time, NEW.recorded_at, NOW());

    INSERT INTO public.gps_positions (
        device_id, device_name, latitude, longitude, speed, accuracy,
        source, app_status, is_online, device_time, server_time, updated_at
    )
    VALUES (
        NEW.device_id, NEW.device_id, NEW.latitude, NEW.longitude,
        COALESCE(NEW.speed, 0), NEW.accuracy, NEW.source,
        'Tracking Active', true, eff_time, NOW(), NOW()
    )
    ON CONFLICT (device_id) DO UPDATE
    SET
        latitude    = EXCLUDED.latitude,
        longitude   = EXCLUDED.longitude,
        speed       = EXCLUDED.speed,
        accuracy    = EXCLUDED.accuracy,
        source      = EXCLUDED.source,
        app_status  = 'Tracking Active',
        is_online   = true,
        device_time = EXCLUDED.device_time,
        server_time = NOW(),
        updated_at  = NOW()
    WHERE EXCLUDED.device_time >= COALESCE(gps_positions.device_time, to_timestamp(0));

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_gps_positions ON public.gps_history;
CREATE TRIGGER trg_sync_gps_positions
AFTER INSERT ON public.gps_history
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_latest_gps_position();

-- 4. RPC 1: Downsampling เส้นทางบน Server (ต่อให้มี 1,000,000 จุดต่อเครื่อง ก็ลดรูปเหลือ p_points_per_device อย่างสม่ำเสมอ)
CREATE OR REPLACE FUNCTION public.get_route_decimated(
    p_points_per_device INT DEFAULT 600,
    p_device_id TEXT DEFAULT NULL,
    p_source TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    device_id TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    accuracy DOUBLE PRECISION,
    source TEXT,
    device_time TIMESTAMPTZ,
    server_time TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    WITH filtered AS (
        SELECT
            h.id,
            h.device_id,
            h.latitude,
            h.longitude,
            h.speed,
            h.accuracy,
            h.source,
            COALESCE(h.device_time, h.recorded_at, h.server_time) AS eff_device_time,
            h.server_time,
            ROW_NUMBER() OVER (
                PARTITION BY h.device_id
                ORDER BY COALESCE(h.device_time, h.recorded_at, h.server_time) ASC
            ) AS rn,
            COUNT(*) OVER (PARTITION BY h.device_id) AS total_cnt
        FROM public.gps_history h
        WHERE h.latitude IS NOT NULL
          AND h.longitude IS NOT NULL
          AND NOT (h.latitude = 0 AND h.longitude = 0)
          AND (p_device_id IS NULL OR h.device_id = p_device_id)
          AND (p_source IS NULL OR h.source = p_source)
    ),
    sampled AS (
        SELECT
            f.*,
            GREATEST(1, FLOOR(f.total_cnt::DOUBLE PRECISION / GREATEST(1, p_points_per_device))::BIGINT) AS step
        FROM filtered f
    )
    SELECT
        s.id,
        s.device_id,
        s.latitude,
        s.longitude,
        s.speed,
        s.accuracy,
        s.source,
        s.eff_device_time AS device_time,
        s.server_time
    FROM sampled s
    WHERE s.total_cnt <= p_points_per_device
       OR s.rn = 1
       OR s.rn = s.total_cnt
       OR (s.rn % s.step) = 0
    ORDER BY s.device_id, s.eff_device_time ASC;
$$;

-- 5. RPC 2: คำนวณ Accuracy Analysis ระดับล้านแถวบน Server PostgreSQL โดยตรง
CREATE OR REPLACE FUNCTION public.get_accuracy_analysis(
    p_ref_lat DOUBLE PRECISION,
    p_ref_lng DOUBLE PRECISION
)
RETURNS TABLE (
    device_id TEXT,
    source TEXT,
    samples BIGINT,
    mean_error DOUBLE PRECISION,
    std_dev DOUBLE PRECISION,
    min_error DOUBLE PRECISION,
    max_error DOUBLE PRECISION,
    avg_acc DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    WITH dist_calc AS (
        SELECT
            h.device_id,
            COALESCE(h.source, 'unknown') AS source,
            h.accuracy,
            6371000.0 * 2.0 * ASIN(
                LEAST(
                    1.0,
                    SQRT(
                        POWER(SIN(RADIANS(h.latitude - p_ref_lat) / 2.0), 2) +
                        COS(RADIANS(p_ref_lat)) * COS(RADIANS(h.latitude)) *
                        POWER(SIN(RADIANS(h.longitude - p_ref_lng) / 2.0), 2)
                    )
                )
            ) AS err_m
        FROM public.gps_history h
        WHERE h.latitude IS NOT NULL
          AND h.longitude IS NOT NULL
          AND NOT (h.latitude = 0 AND h.longitude = 0)
    )
    SELECT
        d.device_id,
        MIN(d.source) AS source,
        COUNT(*)::BIGINT AS samples,
        ROUND(AVG(d.err_m)::NUMERIC, 2)::DOUBLE PRECISION AS mean_error,
        ROUND(COALESCE(STDDEV_POP(d.err_m), 0)::NUMERIC, 2)::DOUBLE PRECISION AS std_dev,
        ROUND(MIN(d.err_m)::NUMERIC, 2)::DOUBLE PRECISION AS min_error,
        ROUND(MAX(d.err_m)::NUMERIC, 2)::DOUBLE PRECISION AS max_error,
        ROUND(AVG(d.accuracy)::NUMERIC, 2)::DOUBLE PRECISION AS avg_acc
    FROM dist_calc d
    GROUP BY d.device_id
    ORDER BY mean_error ASC;
$$;

-- 6. RPC 3: หา Centroid อ้างอิงจากข้อมูลทั้งหมด (Auto Reference Point ระดับล้านแถว)
CREATE OR REPLACE FUNCTION public.get_history_centroid()
RETURNS TABLE (
    total_points BIGINT,
    avg_lat DOUBLE PRECISION,
    avg_lng DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        COUNT(*)::BIGINT AS total_points,
        AVG(latitude)::DOUBLE PRECISION AS avg_lat,
        AVG(longitude)::DOUBLE PRECISION AS avg_lng
    FROM public.gps_history
    WHERE latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND NOT (latitude = 0 AND longitude = 0);
$$;

-- 7. สิทธิ์การเรียกใช้งานผ่าน Supabase Anon Key & Realtime
GRANT EXECUTE ON FUNCTION public.get_route_decimated(INT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_accuracy_analysis(DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_history_centroid() TO anon, authenticated;

ALTER TABLE public.gps_positions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gps_history DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.gps_positions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.gps_history;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
