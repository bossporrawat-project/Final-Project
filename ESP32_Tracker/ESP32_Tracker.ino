/*
 * ============================================================================
 * 🛰️ Tracker by boss — ESP32 + GPS (NEO-M8N / NEO-6M) + MH-SD Card Module
 * ============================================================================
 * ฟีเจอร์หลัก:
 * 1. ดึงทั้ง "วันที่ (Date)" และ "เวลา (Time)" จริงจากสัญญาณดาวเทียม GPS (และ NTP เสริม)
 *    - แปลงเป็นเวลาประเทศไทย (UTC+7): recorded_date (YYYY-MM-DD) และ recorded_time (HH:MM:SS)
 *    - สร้าง Timestamp มาตรฐาน ISO 8601 (device_time) สำหรับฐานข้อมูล Supabase
 * 2. บันทึกข้อมูลทุกจุดลง MH-SD Card Module (/gps_log.csv) พร้อมแยกคอลัมน์วันที่และเวลาชัดเจน
 * 3. ระบบ Offline Queue (/offline_queue.jsonl) บน SD Card:
 *    - หาก Wi-Fi หลุดหรือส่งเข้า Supabase ไม่สำเร็จ จะเก็บคิวลง SD Card
 *    - เมื่อกลับมาออนไลน์ จะทยอยส่งคิวย้อนหลังเข้า Supabase พร้อมวันที่และเวลาจริงตอนเกิดเหตุ
 * 4. ส่งเข้าตาราง gps_history ของ Supabase โดยตรง (Database Trigger จะซิงก์ไป
 *    อัปเดต gps_positions ให้อัตโนมัติแบบ Queue-Safe)
 *
 * ไลบรารีที่ต้องติดตั้งใน Arduino IDE:
 * - TinyGPSPlus (โดย Mikal Hart)
 * ============================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <TinyGPS++.h>
#include <HardwareSerial.h>
#include <SPI.h>
#include <SD.h>
#include <time.h>

// ===================== 1. ตั้งค่า Wi-Fi และอุปกรณ์ =====================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";      // <--- แก้ชื่อ Wi-Fi
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";  // <--- แก้รหัสผ่าน Wi-Fi
const char* DEVICE_ID     = "ESP32_001";           // ชื่ออุปกรณ์ที่แสดงบน Dashboard

// ===================== 2. ตั้งค่า Supabase =====================
const char* SUPABASE_URL  = "https://ryuhkaytmlapkuumgnlo.supabase.co";
const char* SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dWhrYXl0bWxhcGt1dW1nbmxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MzY4MjUsImV4cCI6MjEwNzExMjgyNX0.JYKrvAMK64xE5r92pepQy02fVl4mO55dMaz93heaee8";

// ===================== 3. ตั้งค่าขา Pin (ESP32) =====================
// การต่อสาย GPS Module (UART2)
#define GPS_RX_PIN 16   // ต่อกับขา TX ของ GPS
#define GPS_TX_PIN 17   // ต่อกับขา RX ของ GPS
#define GPS_BAUD   9600

// การต่อสาย MH-SD Card Module (SPI มาตรฐาน VSPI ของ ESP32)
#define SD_CS_PIN   5   // CS   -> GPIO 5
#define SD_SCK_PIN  18  // SCK  -> GPIO 18
#define SD_MISO_PIN 19  // MISO -> GPIO 19
#define SD_MOSI_PIN 23  // MOSI -> GPIO 23

// ===================== 4. ตั้งค่าความถี่การบันทึก =====================
const unsigned long LOG_INTERVAL_MS   = 5000;  // บันทึกและส่งข้อมูลทุกๆ 5 วินาที
const unsigned long QUEUE_SYNC_MS     = 10000; // ตรวจสอบคิวค้างใน SD Card ทุกๆ 10 วินาที

// ===================== ตัวแปรระบบ =====================
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

bool sdReady = false;
unsigned long lastLogTime = 0;
unsigned long lastQueueSyncTime = 0;

const char* CSV_LOG_FILE   = "/gps_log.csv";
const char* QUEUE_FILE     = "/offline_queue.jsonl";
const char* QUEUE_TMP_FILE = "/offline_queue_tmp.jsonl";

struct DeviceDateTime {
  String dateTH;   // วันที่ตามเวลาไทย YYYY-MM-DD (เช่น 2026-11-13)
  String timeTH;   // เวลาตามเวลาไทย HH:MM:SS (เช่น 15:02:10)
  String isoUTC;   // เวลามาตรฐาน ISO 8601 สำหรับส่งเข้า Supabase (เช่น 2026-11-13T15:02:10+07:00)
};

// ----------------------------------------------------------------------------
// ฟังก์ชันดึงทั้ง "วันที่" และ "เวลา" จากดาวเทียม GPS (แปลงเป็นเวลาไทย UTC+7)
// หรือใช้เวลาจาก NTP หากสัญญาณเวลาจาก GPS ยังไม่พร้อม
// ----------------------------------------------------------------------------
DeviceDateTime getDeviceDateTime() {
  DeviceDateTime dt;
  struct tm tmUTC = {0};
  bool validClock = false;

  // 1. ใช้เวลาจากดาวเทียม GPS เป็นหลัก
  if (gps.date.isValid() && gps.time.isValid() && gps.date.year() >= 2025) {
    tmUTC.tm_year = gps.date.year() - 1900;
    tmUTC.tm_mon  = gps.date.month() - 1;
    tmUTC.tm_mday = gps.date.day();
    tmUTC.tm_hour = gps.time.hour();
    tmUTC.tm_min  = gps.time.minute();
    tmUTC.tm_sec  = gps.time.second();

    // แปลงเป็น Epoch แล้วบวก +7 ชั่วโมง (25200 วินาที) สำหรับเวลาประเทศไทย
    // ใช้สูตรคำนวณวันเวลาแบบพกพา
    time_t rawEpoch = mktime(&tmUTC) + (7 * 3600);
    struct tm* tmTH = gmtime(&rawEpoch);

    char dateBuf[16], timeBuf[16], isoBuf[32];
    snprintf(dateBuf, sizeof(dateBuf), "%04d-%02d-%02d",
             tmTH->tm_year + 1900, tmTH->tm_mon + 1, tmTH->tm_mday);
    snprintf(timeBuf, sizeof(timeBuf), "%02d:%02d:%02d",
             tmTH->tm_hour, tmTH->tm_min, tmTH->tm_sec);
    snprintf(isoBuf, sizeof(isoBuf), "%sT%s+07:00", dateBuf, timeBuf);

    dt.dateTH = String(dateBuf);
    dt.timeTH = String(timeBuf);
    dt.isoUTC = String(isoBuf);
    return dt;
  }

  // 2. Fallback: ใช้เวลาจากระบบ (NTP ที่ตั้ง GMT+7 ไว้แล้ว)
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 10)) {
    char dateBuf[16], timeBuf[16], isoBuf[32];
    strftime(dateBuf, sizeof(dateBuf), "%Y-%m-%d", &timeinfo);
    strftime(timeBuf, sizeof(timeBuf), "%H:%M:%S", &timeinfo);
    snprintf(isoBuf, sizeof(isoBuf), "%sT%s+07:00", dateBuf, timeBuf);

    dt.dateTH = String(dateBuf);
    dt.timeTH = String(timeBuf);
    dt.isoUTC = String(isoBuf);
    return dt;
  }

  // 3. Fallback สุดท้ายกรณีไม่มีทั้งเวลา GPS และ NTP
  char secBuf[16];
  snprintf(secBuf, sizeof(secBuf), "00:00:%02lu", (millis() / 1000) % 60);
  dt.dateTH = "1970-01-01";
  dt.timeTH = String(secBuf);
  dt.isoUTC = "1970-01-01T" + dt.timeTH + "+07:00";
  return dt;
}

// ----------------------------------------------------------------------------
// ฟังก์ชันเริ่มต้นใช้งาน MH-SD Card Module
// ----------------------------------------------------------------------------
void initSDCard() {
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("⚠️ [SD Card] ไม่พบ MH-SD Card Module หรือการ์ดยังไม่ได้เสียบ!");
    sdReady = false;
    return;
  }

  sdReady = true;
  Serial.println("✅ [SD Card] เชื่อมต่อ MH-SD Card สำเร็จ!");

  // สร้างหัวตาราง CSV (มีทั้งคอลัมน์ recorded_date และ recorded_time แยกชัดเจน)
  if (!SD.exists(CSV_LOG_FILE)) {
    File file = SD.open(CSV_LOG_FILE, FILE_WRITE);
    if (file) {
      file.println("device_id,recorded_date,recorded_time,device_time_iso,latitude,longitude,speed_kmh,accuracy_m,satellites,synced");
      file.close();
      Serial.println("📄 [SD Card] สร้างไฟล์ /gps_log.csv เรียบร้อย");
    }
  }
}

// ----------------------------------------------------------------------------
// ฟังก์ชันบันทึกข้อมูลลงไฟล์ CSV ใน SD Card พร้อมวันที่และเวลาที่เก็บ
// ----------------------------------------------------------------------------
void appendCSVLog(const DeviceDateTime& dt, double lat, double lng, double speedKmh, double acc, int sats, bool synced) {
  if (!sdReady) return;

  File file = SD.open(CSV_LOG_FILE, FILE_APPEND);
  if (!file) {
    Serial.println("❌ [SD Card] เปิดไฟล์ /gps_log.csv ไม่ได้");
    return;
  }

  String line = String(DEVICE_ID) + "," +
                dt.dateTH + "," +
                dt.timeTH + "," +
                dt.isoUTC + "," +
                String(lat, 6) + "," +
                String(lng, 6) + "," +
                String(speedKmh, 1) + "," +
                String(acc, 1) + "," +
                String(sats) + "," +
                (synced ? "1" : "0");

  file.println(line);
  file.close();
  Serial.println("💾 [SD CSV] บันทึกลง SD Card -> วันที่: " + dt.dateTH + " เวลา: " + dt.timeTH + " | พิกัด: " + String(lat, 6) + ", " + String(lng, 6));
}

// ----------------------------------------------------------------------------
// ฟังก์ชันเก็บ JSON Payload ลงคิว Offline ใน SD Card เมื่อส่งขึ้น Cloud ไม่สำเร็จ
// ----------------------------------------------------------------------------
void enqueueOfflinePayload(const String& jsonPayload) {
  if (!sdReady) return;

  File file = SD.open(QUEUE_FILE, FILE_APPEND);
  if (file) {
    file.println(jsonPayload);
    file.close();
    Serial.println("📦 [Offline Queue] เก็บข้อมูลลงคิวใน SD Card รอส่งย้อนหลัง");
  }
}

// ----------------------------------------------------------------------------
// ฟังก์ชันยิงข้อมูล JSON เข้าตาราง gps_history ของ Supabase
// ----------------------------------------------------------------------------
bool sendToSupabase(const String& jsonPayload) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/gps_history?on_conflict=device_id,device_time";

  if (!http.begin(client, endpoint)) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "resolution=merge-duplicates,return=minimal");

  int httpCode = http.POST(jsonPayload);
  http.end();

  if (httpCode >= 200 && httpCode < 300) {
    Serial.printf("☁️ [Supabase] ส่งข้อมูลสำเร็จ (HTTP %d)\n", httpCode);
    return true;
  } else {
    Serial.printf("⚠️ [Supabase] ส่งข้อมูลไม่สำเร็จ (HTTP %d)\n", httpCode);
    return false;
  }
}

// ----------------------------------------------------------------------------
// ฟังก์ชันทยอยส่งข้อมูลที่ค้างอยู่ในคิวบน SD Card (/offline_queue.jsonl)
// ----------------------------------------------------------------------------
void flushOfflineQueue() {
  if (!sdReady || WiFi.status() != WL_CONNECTED) return;
  if (!SD.exists(QUEUE_FILE)) return;

  File qFile = SD.open(QUEUE_FILE, FILE_READ);
  if (!qFile) return;

  if (qFile.size() == 0) {
    qFile.close();
    SD.remove(QUEUE_FILE);
    return;
  }

  Serial.println("🔄 [Offline Queue] พบข้อมูลค้างใน SD Card กำลังทยอยซิงก์ขึ้น Supabase...");
  File tmpFile = SD.open(QUEUE_TMP_FILE, FILE_WRITE);
  int sentCount = 0;
  int remainCount = 0;

  while (qFile.available()) {
    String line = qFile.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    if (sentCount < 5 && sendToSupabase(line)) {
      sentCount++;
    } else {
      if (tmpFile) tmpFile.println(line);
      remainCount++;
    }
  }

  qFile.close();
  if (tmpFile) tmpFile.close();

  SD.remove(QUEUE_FILE);
  if (remainCount > 0) {
    SD.rename(QUEUE_TMP_FILE, QUEUE_FILE);
    Serial.printf("📌 [Offline Queue] ส่งสำเร็จ %d รายการ, เหลือค้าง %d รายการ\n", sentCount, remainCount);
  } else {
    SD.remove(QUEUE_TMP_FILE);
    Serial.printf("🎉 [Offline Queue] ซิงก์ข้อมูลย้อนหลังครบทั้งหมด %d รายการ!\n", sentCount);
  }
}

// ----------------------------------------------------------------------------
// SETUP
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n====================================================");
  Serial.println("🚀 Tracker by boss — ESP32 + MH-SD Card Starting...");
  Serial.println("====================================================");

  // ตั้งค่า Timezone เริ่มต้นเป็น UTC เพื่อให้ mktime คำนวณตรงกับเวลาดาวเทียม
  setenv("TZ", "UTC0", 1);
  tzset();

  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("📡 [GPS] เริ่มต้นรับสัญญาณ UART2 (RX:16, TX:17)");

  initSDCard();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("🌐 [Wi-Fi] กำลังเชื่อมต่อ");
  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 8000) {
    delay(400);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ [Wi-Fi] เชื่อมต่อสำเร็จ! IP: " + WiFi.localIP().toString());
    // ตั้งค่า NTP สำรองเป็นเวลาไทย (UTC+7 = 25200 วินาที)
    configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  } else {
    Serial.println("\n⚠️ [Wi-Fi] ยังไม่เชื่อมต่อ — ระบบจะทำงานในโหมด Offline และบันทึกลง SD Card");
  }
}

// ----------------------------------------------------------------------------
// LOOP
// ----------------------------------------------------------------------------
void loop() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  if (WiFi.status() != WL_CONNECTED && millis() % 15000 < 50) {
    WiFi.reconnect();
  }

  if (millis() - lastLogTime >= LOG_INTERVAL_MS) {
    lastLogTime = millis();

    if (gps.location.isValid()) {
      double lat         = gps.location.lat();
      double lng         = gps.location.lng();
      double speedKmh    = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
      double accuracy    = gps.hdop.isValid() ? (gps.hdop.hdop() * 5.0) : 10.0;
      int sats           = gps.satellites.isValid() ? gps.satellites.value() : 0;
      DeviceDateTime dt  = getDeviceDateTime();

      // สร้าง JSON สำหรับส่งเข้าตาราง gps_history ของ Supabase (เก็บทั้งวันที่+เวลาใน device_time)
      String jsonPayload = "{";
      jsonPayload += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
      jsonPayload += "\"latitude\":" + String(lat, 6) + ",";
      jsonPayload += "\"longitude\":" + String(lng, 6) + ",";
      jsonPayload += "\"speed\":" + String(speedKmh, 1) + ",";
      jsonPayload += "\"accuracy\":" + String(accuracy, 1) + ",";
      jsonPayload += "\"source\":\"iot\",";
      jsonPayload += "\"device_time\":\"" + dt.isoUTC + "\"";
      jsonPayload += "}";

      bool synced = sendToSupabase(jsonPayload);
      if (!synced) {
        enqueueOfflinePayload(jsonPayload);
      }

      // บันทึกทั้งวันที่ (recorded_date) และเวลา (recorded_time) ลง SD Card
      appendCSVLog(dt, lat, lng, speedKmh, accuracy, sats, synced);

    } else {
      Serial.print("⏳ [GPS] กำลังค้นหาสัญญาณดาวเทียม... (Satellites: ");
      Serial.print(gps.satellites.value());
      Serial.println(")");
    }
  }

  if (millis() - lastQueueSyncTime >= QUEUE_SYNC_MS) {
    lastQueueSyncTime = millis();
    flushOfflineQueue();
  }
}
