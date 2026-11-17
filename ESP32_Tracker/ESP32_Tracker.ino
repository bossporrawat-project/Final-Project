/*
 * ============================================================================
 * 🛰️ Tracker by boss — ESP32 + GPS (5Hz UBX) + MH-SD Card Module
 * ============================================================================
 * รวมโค้ด GPS Module + Firebase เดิมของคุณบอส เข้ากับระบบ SD Card & Supabase:
 * 1. GPS (UART1: RX=16, TX=17, Baud 9600) + คำสั่ง UBX ตั้งค่า Refresh Rate 5Hz
 * 2. MH-SD Card Module (VSPI: CS=5, SCK=18, MISO=19, MOSI=23)
 *    - บันทึกลงไฟล์ /gps_log.csv ทุก 1 วินาที พร้อมวันที่และเวลาไทย (UTC+7)
 *    - ระบบ Offline Queue (/offline_queue.jsonl): หาก Wi-Fi หลุดหรืออยู่ข้างนอก
 *      จะเก็บคิวลง SD Card และทยอยซิงก์เข้า Supabase ให้อัตโนมัติเมื่อต่อ Wi-Fi ได้
 * 3. รองรับส่งขึ้นทั้ง Supabase (gps_history -> Trigger อัปเดต gps_positions)
 *    และ Firebase RTDB (/gps_data/001 และ /gps_log/001) ตามโค้ดเดิมของคุณบอส
 *
 * ⚙️ ตั้งค่า Arduino IDE ก่อน Compile:
 * - Tools -> Partition Scheme -> "Huge APP (3MB No OTA/1MB SPIFFS)"
 *   (หากเปิดใช้งาน Firebase ร่วมกับ Supabase เพื่อไม่ให้พื้นที่ Flash เต็ม)
 * - หากต้องการใช้เฉพาะ Supabase + SD Card (ประหยัดพื้นที่ & เร็วขึ้น)
 *   ให้เปลี่ยน #define ENABLE_FIREBASE_SYNC 1 เป็น 0
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <HardwareSerial.h>
#include <TinyGPS++.h>
#include <SPI.h>
#include <SD.h>
#include <Preferences.h>
#include <time.h>

// ตั้งเป็น 0 = ปิด Firebase ส่งตรงเข้า Supabase + SD Card เท่านั้น (Compile & Upload เร็วขึ้นมาก)
#define ENABLE_FIREBASE_SYNC 0

// เว็บลับในตัว ESP32 สำหรับอ่าน/ดาวน์โหลดไฟล์ทั้งหมดใน SD Card (แยกจากเว็บหลัก Next.js โดยสิ้นเชิง)
#define SD_WEB_ENABLE      1
#define SD_WEB_PORT        80
#define SD_WEB_SECRET_PATH "/boss-sd"

#if SD_WEB_ENABLE
  #include <WebServer.h>
#endif

#if ENABLE_FIREBASE_SYNC
  #include <Firebase_ESP_Client.h>
  #include "addons/TokenHelper.h"
  #include "addons/RTDBHelper.h"
#endif

// ==================== 1. ตั้งค่า Wi-Fi และ Device ====================
#define WIFI_SSID     "Boss"
#define WIFI_PASSWORD "Boss2548"

const char* SUPABASE_DEVICE_ID = "ESP32_001"; // ชื่อใน Supabase / หน้าเว็บ Dashboard
const char* FIREBASE_DEVICE_ID = "001";       // ชื่อ Node ใน Firebase (/gps_data/001)

// ==================== 2. ตั้งค่า Supabase ====================
const char* SUPABASE_URL = "https://ryuhkaytmlapkuumgnlo.supabase.co";
const char* SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dWhrYXl0bWxhcGt1dW1nbmxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MzY4MjUsImV4cCI6MjEwNzExMjgyNX0.JYKrvAMK64xE5r92pepQy02fVl4mO55dMaz93heaee8";

// ==================== 3. ตั้งค่า Firebase (ตามโค้ดเดิม) ====================
#if ENABLE_FIREBASE_SYNC
  #define API_KEY      "AIzaSyBNb02ytrtRG9bhEj0Zaw8UvwxYgp0oehw"
  #define DATABASE_URL "https://iot-project-c13c9-default-rtdb.asia-southeast1.firebasedatabase.app/"

  FirebaseData fbdo;
  FirebaseAuth auth;
  FirebaseConfig config;
  bool firebaseInitialized = false;
#endif

// ==================== 4. ตั้งค่าขา Pin ====================
// GPS Module (UART1 ตามโค้ดเดิมของคุณบอส — อัปเป็น 115200 bps อัตโนมัติเพื่อรองรับ 5Hz)
#define GPS_RX_PIN    16
#define GPS_TX_PIN    17
#define GPS_INIT_BAUD 9600
#define GPS_WORK_BAUD 115200

// SD Card Module (VSPI มาตรฐานตามรูปที่คุณบอสต่อ)
#define SD_CS_PIN   5
#define SD_SCK_PIN  18
#define SD_MISO_PIN 19
#define SD_MOSI_PIN 23

// ==================== 5. ความถี่การส่งข้อมูล (โหมด 5Hz สำหรับรถ EV) ====================
const unsigned long LOG_INTERVAL_MS   = 200;   // 200 ms = 5 Hz (5 จุด/วินาที ลง SD Card + Buffer)
const unsigned long CLOUD_BATCH_MS    = 1000;  // รวบส่ง Batch ขึ้น Supabase ทุก 1 วินาที (ครั้งละ ~5 จุด)
const unsigned long QUEUE_SYNC_MS     = 10000; // ตรวจคิวค้างใน SD Card ทุก 10 วินาที
const int           MAX_BATCH_POINTS  = 10;

// ==================== ตัวแปรระบบ ====================
HardwareSerial GPS(1);
TinyGPSPlus gps;
TinyGPSCustom gpGsvInView;
TinyGPSCustom glGsvInView;
Preferences prefs;

bool sdReady = false;
bool m8nTimeAssisted = false;
bool ev5HzActivated = false;
bool ntpConfigured = false;
double cachedLat = 0.0;
double cachedLng = 0.0;
bool hasCachedPos = false;
unsigned long lastSendTime = 0;
unsigned long lastCloudBatchTime = 0;
unsigned long lastQueueSyncTime = 0;
unsigned long lastCacheSaveTime = 0;
unsigned long lastWifiRetryTime = 0;

String cloudBatchJson = "";
int cloudBatchCount = 0;
String lastLoggedIso = "";

const char* CSV_LOG_FILE   = "/gps_log.csv";
const char* QUEUE_FILE     = "/offline_queue.jsonl";
const char* QUEUE_TMP_FILE = "/offline_queue_tmp.jsonl";

struct DeviceDateTime {
  String dateTH;   // YYYY-MM-DD (UTC+7)
  String timeTH;   // HH:MM:SS (UTC+7)
  String isoTH;    // YYYY-MM-DDTHH:MM:SS+07:00
  bool hasRealDate;
};

// ----------------------------------------------------------------------------
// ส่งคำสั่ง UBX Binary พร้อมคำนวณ Fletcher-8 Checksum อัตโนมัติ (สำหรับ NEO-M8N)
// ----------------------------------------------------------------------------
void sendUBXPacket(uint8_t msgClass, uint8_t msgId, const uint8_t* payload, uint16_t len) {
  uint8_t header[6] = {
    0xB5, 0x62,
    msgClass,
    msgId,
    (uint8_t)(len & 0xFF),
    (uint8_t)((len >> 8) & 0xFF)
  };

  uint8_t ckA = 0, ckB = 0;
  for (int i = 2; i < 6; i++) {
    ckA += header[i];
    ckB += ckA;
  }
  for (uint16_t i = 0; i < len; i++) {
    ckA += payload[i];
    ckB += ckA;
  }

  GPS.write(header, 6);
  if (len > 0 && payload != nullptr) {
    GPS.write(payload, len);
  }
  GPS.write(ckA);
  GPS.write(ckB);
  GPS.flush();
}

static void writeLE16(uint8_t* buf, uint16_t v) {
  buf[0] = (uint8_t)(v & 0xFF);
  buf[1] = (uint8_t)((v >> 8) & 0xFF);
}

static void writeLE32(uint8_t* buf, int32_t v) {
  buf[0] = (uint8_t)(v & 0xFF);
  buf[1] = (uint8_t)((v >> 8) & 0xFF);
  buf[2] = (uint8_t)((v >> 16) & 0xFF);
  buf[3] = (uint8_t)((v >> 24) & 0xFF);
}

// ----------------------------------------------------------------------------
// ตรวจจับและสลับ UART GPS เป็น 115200 bps อัตโนมัติ (หากโมดูลไม่รองรับจะถอยกลับ 9600 ให้เอง)
// ----------------------------------------------------------------------------
bool testGpsNmeaStream(unsigned long listenMs) {
  unsigned long start = millis();
  unsigned long prevPassed = gps.passedChecksum();
  int dollarCount = 0;
  while (millis() - start < listenMs) {
    while (GPS.available() > 0) {
      char ch = (char)GPS.read();
      if (ch == '$') dollarCount++;
      gps.encode(ch);
    }
    delay(5);
  }
  return (gps.passedChecksum() > prevPassed) || (dollarCount >= 2);
}

void initNeoM8nBaudAuto() {
  GPS.setRxBufferSize(2048);
  GPS.begin(GPS_INIT_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  delay(400);

  uint8_t cfgPrt[20] = {0};
  cfgPrt[0]  = 0x01; // portID: 1 = UART1
  cfgPrt[4]  = 0xD0; // mode = 8N1
  cfgPrt[5]  = 0x08;
  cfgPrt[8]  = 0x00; // baudRate = 115200 (0x0001C200)
  cfgPrt[9]  = 0xC2;
  cfgPrt[10] = 0x01;
  cfgPrt[11] = 0x00;
  cfgPrt[12] = 0x03; // inProtoMask = UBX + NMEA
  cfgPrt[14] = 0x03; // outProtoMask = UBX + NMEA

  sendUBXPacket(0x06, 0x00, cfgPrt, sizeof(cfgPrt));
  delay(120);

  // สลับเป็น 115200 แล้วทดสอบว่ามีข้อมูล NMEA เข้ามาจริงหรือไม่ (ไม่ใช้ GPS.end() เพื่อไม่ให้ RX หลุด)
  GPS.updateBaudRate(GPS_WORK_BAUD);
  while (GPS.available() > 0) GPS.read();

  if (testGpsNmeaStream(1100)) {
    Serial.println("✅ [GPS UART] เชื่อมต่อที่ 115200 bps สำเร็จ (รองรับ 5Hz เต็ม)");
  } else {
    GPS.updateBaudRate(GPS_INIT_BAUD);
    while (GPS.available() > 0) GPS.read();
    Serial.println("⚠️ [GPS UART] โมดูลตอบสนองที่ 9600 bps (ถอยกลับ 9600 อัตโนมัติเพื่อไม่ให้สัญญาณหาย)");
  }
}

static void sendNeoM8nRateAndNav(uint16_t measRateMs, uint8_t dynModel) {
  uint8_t cfgRate[6] = {
    (uint8_t)(measRateMs & 0xFF),
    (uint8_t)((measRateMs >> 8) & 0xFF),
    0x01, 0x00, 0x01, 0x00
  };
  sendUBXPacket(0x06, 0x08, cfgRate, sizeof(cfgRate));
  delay(80);

  // CFG-NAV5 (0x06, 0x24): mask = 0x0107 (dyn | minEl | posFixMode | cnoThreshold)
  uint8_t cfgNav5[36] = {0};
  cfgNav5[0]  = 0x07; // mask LSB (dyn | minEl | posFixMode)
  cfgNav5[1]  = 0x01; // mask MSB (cnoThreshold)
  cfgNav5[2]  = dynModel; // 0 = Portable (ค้นหาไว), 4 = Automotive (รถ EV)
  cfgNav5[3]  = 3;    // fixMode: 3 = Auto 2D/3D (จับไวแม้สัญญาณอ่อน)
  cfgNav5[12] = 5;    // minElev: 5°
  cfgNav5[24] = 0;    // cnoThreshNumSVs = 0
  cfgNav5[25] = 0;    // cnoThresh = 0 dBHz (ไม่ตัดดาวเทียมสัญญาณอ่อนทิ้ง)
  sendUBXPacket(0x06, 0x24, cfgNav5, sizeof(cfgNav5));
  delay(80);
}

void configureNeoM8nSearchMode() {
  // เริ่มต้นที่ 1Hz + Portable เพื่อให้ภาครับในอาคารจับดาวเทียมดวงแรกได้เร็วที่สุด
  sendNeoM8nRateAndNav(1000, 0);
  Serial.println("🛰️ [NEO-M8N Search] เปิดโหมด 1Hz + Portable + Auto 2D/3D เพื่อจับสัญญาณเริ่มต้นให้ไวที่สุด");
}

void configureNeoM8nEv5Hz() {
  // เมื่อจับพิกัดได้แล้ว ค่อยเร่งเป็น 5Hz (200ms) + Automotive สำหรับวิ่งบนรถ EV
  sendNeoM8nRateAndNav(200, 4);
  ev5HzActivated = true;
  Serial.println("🏎️ [NEO-M8N EV 5Hz] จับตำแหน่งได้แล้ว -> เปิดโหมด 5Hz + Automotive ทันที!");
}

// ----------------------------------------------------------------------------
// ฉีดเวลา UTC จาก NTP + พิกัดล่าสุดจาก Flash เข้า NEO-M8N เพื่อให้ Warm/Hot Start เร็วขึ้น
// ----------------------------------------------------------------------------
void injectM8nAssistance() {
  if (m8nTimeAssisted) return;

  time_t nowEpoch = 0;
  time(&nowEpoch);
  if (nowEpoch < 1735689600L) return; // รอจนกว่าจะได้เวลาจริงจาก NTP (>= ปี 2025)

  struct tm utc;
  gmtime_r(&nowEpoch, &utc);

  // UBX-MGA-INI-TIME_UTC (Class 0x13, ID 0x40, 24 bytes, type=0x10)
  uint8_t timeMsg[24] = {0};
  timeMsg[0]  = 0x10; // type = TIME_UTC
  timeMsg[1]  = 0x00; // version
  timeMsg[2]  = 0x00; // ref = none (on receipt)
  timeMsg[3]  = 0x80; // leapSecs unknown (-128)
  writeLE16(&timeMsg[4], (uint16_t)(utc.tm_year + 1900));
  timeMsg[6]  = (uint8_t)(utc.tm_mon + 1);
  timeMsg[7]  = (uint8_t)utc.tm_mday;
  timeMsg[8]  = (uint8_t)utc.tm_hour;
  timeMsg[9]  = (uint8_t)utc.tm_min;
  timeMsg[10] = (uint8_t)utc.tm_sec;
  writeLE16(&timeMsg[16], 5); // tAccS = 5 seconds
  sendUBXPacket(0x13, 0x40, timeMsg, sizeof(timeMsg));
  delay(40);

  // UBX-MGA-INI-POS_LLH (Class 0x13, ID 0x40, 20 bytes, type=0x01) ถ้าเคยมีพิกัดใน Flash
  if (hasCachedPos) {
    uint8_t posMsg[20] = {0};
    posMsg[0] = 0x01; // type = LLH
    posMsg[1] = 0x00; // version
    writeLE32(&posMsg[4], (int32_t)(cachedLat * 10000000.0));
    writeLE32(&posMsg[8], (int32_t)(cachedLng * 10000000.0));
    writeLE32(&posMsg[12], 1000);   // alt = 10m (1000 cm)
    writeLE32(&posMsg[16], 500000); // posAcc = 5 km (500,000 cm)
    sendUBXPacket(0x13, 0x40, posMsg, sizeof(posMsg));
    Serial.printf("⚡ [NEO-M8N Warm Start] ฉีดเวลา UTC + พิกัดตั้งต้น (%.5f, %.5f) สำเร็จ\n", cachedLat, cachedLng);
  } else {
    Serial.println("⚡ [NEO-M8N Warm Start] ฉีดเวลา UTC ปัจจุบันเข้าโมดูล GPS สำเร็จ");
  }

  m8nTimeAssisted = true;
}

void saveCachedPosition(double lat, double lng) {
  cachedLat = lat;
  cachedLng = lng;
  hasCachedPos = true;
  prefs.putDouble("lat", lat);
  prefs.putDouble("lng", lng);
  prefs.putBool("valid", true);
}

static int daysInMonth(int y, int m) {
  static const int d[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (m == 2 && ((y % 4 == 0 && y % 100 != 0) || (y % 400 == 0))) return 29;
  return d[m - 1];
}

// ----------------------------------------------------------------------------
// ดึงวันที่และเวลาไทย (UTC+7) จาก GPS โดยคำนวณข้ามวันตรงเป๊ะ ไม่เพี้ยนจาก TZ
// ----------------------------------------------------------------------------
DeviceDateTime getDeviceDateTime() {
  DeviceDateTime dt;
  dt.hasRealDate = false;

  if (gps.date.isValid() && gps.time.isValid() && gps.date.year() >= 2025) {
    int year  = gps.date.year();
    int month = gps.date.month();
    int day   = gps.date.day();
    int hour  = gps.time.hour() + 7;
    int min   = gps.time.minute();
    int sec   = gps.time.second();

    int cs    = gps.time.centisecond();

    if (hour >= 24) {
      hour -= 24;
      day += 1;
      if (day > daysInMonth(year, month)) {
        day = 1;
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    }

    char dateBuf[16], timeBuf[20], isoBuf[36];
    snprintf(dateBuf, sizeof(dateBuf), "%04d-%02d-%02d", year, month, day);
    snprintf(timeBuf, sizeof(timeBuf), "%02d:%02d:%02d.%02d", hour, min, sec, cs);
    snprintf(isoBuf, sizeof(isoBuf), "%sT%02d:%02d:%02d.%02d0+07:00", dateBuf, hour, min, sec, cs);

    dt.dateTH = String(dateBuf);
    dt.timeTH = String(timeBuf);
    dt.isoTH  = String(isoBuf);
    dt.hasRealDate = true;
    return dt;
  }

  // Fallback 1: ใช้เวลาจาก NTP (ตั้งค่า GMT+7 ไว้ใน setup)
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 10) && (timeinfo.tm_year + 1900) >= 2025) {
    char dateBuf[16], timeBuf[16], isoBuf[32];
    strftime(dateBuf, sizeof(dateBuf), "%Y-%m-%d", &timeinfo);
    strftime(timeBuf, sizeof(timeBuf), "%H:%M:%S", &timeinfo);
    snprintf(isoBuf, sizeof(isoBuf), "%sT%s+07:00", dateBuf, timeBuf);

    dt.dateTH = String(dateBuf);
    dt.timeTH = String(timeBuf);
    dt.isoTH  = String(isoBuf);
    dt.hasRealDate = true;
    return dt;
  }

  // Fallback 2: กรณีเวลาจากดาวเทียมมีแต่ HH:MM:SS (ยังไม่ล็อกวันที่)
  if (gps.time.isValid()) {
    int thHour = (gps.time.hour() + 7) % 24;
    char timeBuf[16];
    snprintf(timeBuf, sizeof(timeBuf), "%02d:%02d:%02d", thHour, gps.time.minute(), gps.time.second());
    dt.dateTH = "unknown-date";
    dt.timeTH = String(timeBuf);
    dt.isoTH  = "";
    return dt;
  }

  dt.dateTH = "1970-01-01";
  dt.timeTH = "00:00:00";
  dt.isoTH  = "";
  return dt;
}

// ----------------------------------------------------------------------------
// ฟังก์ชันเริ่มต้นใช้งาน SD Card (VSPI: CS=5, SCK=18, MISO=19, MOSI=23)
// ----------------------------------------------------------------------------
void initSDCard() {
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("⚠️ [SD Card] ไม่พบโมดูล SD Card หรือการ์ดยังไม่ได้เสียบ (ลองเช็กไฟเลี้ยง 5V VIN)");
    sdReady = false;
    return;
  }

  sdReady = true;
  Serial.println("✅ [SD Card] เชื่อมต่อสำเร็จ!");

  if (!SD.exists(CSV_LOG_FILE)) {
    File file = SD.open(CSV_LOG_FILE, FILE_WRITE);
    if (file) {
      file.println("device_id,recorded_date,recorded_time,device_time_iso,latitude,longitude,speed_kmh,accuracy_m,satellites,synced_supabase");
      file.close();
      Serial.println("📄 [SD Card] สร้างไฟล์ /gps_log.csv เรียบร้อย");
    }
  }
}

void appendCSVLog(const DeviceDateTime& dt, double lat, double lng, double speedKmh, double acc, int sats, bool synced) {
  if (!sdReady) return;
  File file = SD.open(CSV_LOG_FILE, FILE_APPEND);
  if (!file) return;

  String line = String(SUPABASE_DEVICE_ID) + "," +
                dt.dateTH + "," +
                dt.timeTH + "," +
                dt.isoTH + "," +
                String(lat, 6) + "," +
                String(lng, 6) + "," +
                String(speedKmh, 1) + "," +
                String(acc, 1) + "," +
                String(sats) + "," +
                (synced ? "1" : "0");
  file.println(line);
  file.close();
}

void enqueueOfflinePayload(const String& jsonPayload) {
  if (!sdReady) return;
  File file = SD.open(QUEUE_FILE, FILE_APPEND);
  if (file) {
    file.println(jsonPayload);
    file.close();
    Serial.println("📦 [Offline Queue] พักข้อมูลลง SD Card รอส่งย้อนหลัง");
  }
}

// ----------------------------------------------------------------------------
// ส่งเข้า Supabase แบบ Keep-Alive (gps_history -> Trigger ซิงก์ไป gps_positions)
// ----------------------------------------------------------------------------
WiFiClientSecure supaClient;
HTTPClient supaHttp;
bool supaHttpStarted = false;

bool postSupabaseOnce(const String& jsonPayload, int& outCode) {
  if (!supaHttpStarted) {
    supaClient.setInsecure();
    supaHttp.setReuse(true);
    supaHttp.setTimeout(3500);
    String endpoint = String(SUPABASE_URL) + "/rest/v1/gps_history?on_conflict=device_id,device_time";
    if (!supaHttp.begin(supaClient, endpoint)) return false;
    supaHttpStarted = true;
  }

  supaHttp.addHeader("Content-Type", "application/json");
  supaHttp.addHeader("apikey", SUPABASE_KEY);
  supaHttp.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  supaHttp.addHeader("Prefer", "resolution=merge-duplicates,return=minimal");

  outCode = supaHttp.POST(jsonPayload);
  return outCode >= 200 && outCode < 300;
}

bool sendToSupabase(const String& jsonPayload) {
  if (WiFi.status() != WL_CONNECTED) return false;

  int httpCode = -1;
  if (postSupabaseOnce(jsonPayload, httpCode)) {
    Serial.printf("☁️ [Supabase] ส่งข้อมูลสำเร็จ (HTTP %d)\n", httpCode);
    return true;
  }

  // หาก Keep-Alive Socket หลุดหรือหมดอายุ ให้รีเซ็ต Connection แล้วลองส่งใหม่อีก 1 ครั้ง
  if (httpCode <= 0) {
    supaHttp.end();
    supaClient.stop();
    supaHttpStarted = false;
    if (postSupabaseOnce(jsonPayload, httpCode)) {
      Serial.printf("☁️ [Supabase] ส่งข้อมูลสำเร็จหลังเชื่อมต่อใหม่ (HTTP %d)\n", httpCode);
      return true;
    }
  }

  Serial.printf("⚠️ [Supabase] ส่งไม่สำเร็จ (HTTP %d)\n", httpCode);
  return false;
}

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

  Serial.println("🔄 [Offline Queue] พบข้อมูลค้างใน SD Card กำลังทยอยส่งขึ้น Supabase...");
  File tmpFile = SD.open(QUEUE_TMP_FILE, FILE_WRITE);
  int sentCount = 0;
  int remainCount = 0;

  while (qFile.available()) {
    // ยังคงรับข้อมูล GPS ต่อเนื่องระหว่างทยอยส่งคิว
    while (GPS.available() > 0) gps.encode(GPS.read());

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
    Serial.printf("📌 [Offline Queue] ส่งสำเร็จ %d รายการ, เหลือ %d รายการ\n", sentCount, remainCount);
  } else {
    SD.remove(QUEUE_TMP_FILE);
    Serial.printf("🎉 [Offline Queue] ซิงก์ข้อมูลย้อนหลังครบทั้งหมด %d รายการ!\n", sentCount);
  }
}

#if ENABLE_FIREBASE_SYNC
void initFirebaseIfReady() {
  if (firebaseInitialized || WiFi.status() != WL_CONNECTED) return;

  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;

  if (Firebase.signUp(&config, &auth, "", "")) {
    Serial.println("✔ Firebase SignUp Success");
  } else {
    Serial.printf("✘ SignUp Failed: %s\n", config.signer.signupError.message.c_str());
  }

  config.token_status_callback = tokenStatusCallback;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  firebaseInitialized = true;
}

void sendToFirebase(double lat, double lng, double speedKmh, double acc, const String& timeStr) {
  if (!firebaseInitialized) initFirebaseIfReady();
  if (WiFi.status() == WL_CONNECTED && Firebase.ready()) {
    FirebaseJson json;
    json.set("device_id", FIREBASE_DEVICE_ID);
    json.set("lat", lat);
    json.set("lng", lng);
    json.set("speed", speedKmh);
    json.set("accuracy", acc);
    json.set("time", timeStr);

    String pathLog = "/gps_log/" + String(FIREBASE_DEVICE_ID);
    if (Firebase.RTDB.pushJSON(&fbdo, pathLog, &json)) {
      Serial.println("✔ Firebase Log saved");
    } else {
      Serial.println("✘ Firebase Log Error: " + fbdo.errorReason());
    }

    String pathLatest = "/gps_data/" + String(FIREBASE_DEVICE_ID);
    if (Firebase.RTDB.setJSON(&fbdo, pathLatest, &json)) {
      Serial.println("✔ Firebase Current updated");
    } else {
      Serial.println("✘ Firebase Data Error: " + fbdo.errorReason());
    }
  }
}
#endif

#if SD_WEB_ENABLE
// ============================================================================
// 🔐 Hidden SD Card Web Reader (ฝังในตัว ESP32 แยกจากเว็บหลัก Next.js โดยสิ้นเชิง)
// เข้าถึงเฉพาะพาธลับ SD_WEB_SECRET_PATH เท่านั้น (หน้า "/" ปกติจะคืนค่า 404 Not Found)
// ============================================================================
WebServer sdWebServer(SD_WEB_PORT);
bool sdWebStarted = false;

static const char SD_WEB_HTML[] PROGMEM = R"BOSS_SD_HTML(<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SD Card Vault</title>
<style>
  :root{--bg:#0b1020;--card:#131b30;--card2:#0f1628;--bd:#24314f;--tx:#e6edf7;--mu:#8ea0bf;--ac:#38bdf8;--ok:#22c55e;--wa:#f59e0b;--er:#ef4444}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  header{padding:14px 18px;border-bottom:1px solid var(--bd);background:var(--card2);display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
  .brand{font-weight:700;font-size:16px;display:flex;align-items:center;gap:8px}
  .pills{display:flex;flex-wrap:wrap;gap:8px}
  .pill{padding:4px 10px;border-radius:999px;background:var(--card);border:1px solid var(--bd);font-size:12px;color:var(--mu)}
  .pill b{color:var(--tx)}
  main{display:grid;grid-template-columns:320px 1fr;gap:14px;padding:14px;min-height:calc(100vh - 60px)}
  @media(max-width:860px){main{grid-template-columns:1fr}}
  .panel{background:var(--card);border:1px solid var(--bd);border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
  .ph{padding:11px 14px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--card2)}
  .ph h2{margin:0;font-size:14px}
  .toolbar{padding:10px 12px;border-bottom:1px solid var(--bd);display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  input[type=text]{background:var(--bg);color:var(--tx);border:1px solid var(--bd);border-radius:8px;padding:6px 10px;font-size:13px;outline:none}
  input[type=text]:focus{border-color:var(--ac)}
  button,.btn{background:#1c2844;color:var(--tx);border:1px solid var(--bd);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:5px}
  button:hover,.btn:hover{border-color:var(--ac)}
  button.primary{background:#0ea5e9;border-color:#0ea5e9;color:#061224;font-weight:600}
  button.danger{border-color:#7f1d1d;color:#fca5a5}
  button.danger:hover{background:#7f1d1d;color:#fff}
  button.active{background:var(--ac);color:#061224;border-color:var(--ac);font-weight:600}
  button:disabled{opacity:.45;cursor:not-allowed}
  #fileList{overflow:auto;max-height:72vh;padding:6px}
  .fitem{padding:8px 10px;border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid transparent}
  .fitem:hover{background:rgba(56,189,248,.08)}
  .fitem.sel{background:rgba(56,189,248,.16);border-color:rgba(56,189,248,.4)}
  .fpath{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;word-break:break-all}
  .fsize{font-size:11px;color:var(--mu);white-space:nowrap}
  .viewer{flex:1;overflow:auto;max-height:72vh;background:var(--bg)}
  pre{margin:0;padding:12px;font:12.5px/1.55 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;color:#cfe2ff}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{padding:6px 9px;border-bottom:1px solid #1b2540;text-align:left;white-space:nowrap}
  th{position:sticky;top:0;background:var(--card2);color:var(--ac);z-index:1}
  tr:hover td{background:rgba(255,255,255,.03)}
  a.map{color:var(--ac);text-decoration:none}
  a.map:hover{text-decoration:underline}
  .empty{padding:28px;text-align:center;color:var(--mu)}
</style>
</head>
<body>
<header>
  <div class="brand">🔒 SD Card Vault <span style="font-size:12px;color:var(--mu);font-weight:400">(ESP32 Local Storage)</span></div>
  <div class="pills" id="stats">
    <span class="pill">SD: <b id="stSd">...</b></span>
    <span class="pill">GPS: <b id="stGps">...</b></span>
    <span class="pill">Wi-Fi: <b id="stWifi">...</b></span>
  </div>
</header>
<main>
  <section class="panel">
    <div class="ph">
      <h2>📁 ไฟล์ทั้งหมด (<span id="fileCount">0</span>)</h2>
      <button onclick="loadAll()">🔄 รีเฟรช</button>
    </div>
    <div class="toolbar">
      <input type="text" id="fileFilter" placeholder="ค้นหาชื่อไฟล์..." style="width:100%" oninput="renderFiles()">
    </div>
    <div id="fileList"><div class="empty">กำลังโหลดรายการไฟล์...</div></div>
  </section>

  <section class="panel">
    <div class="ph">
      <h2 id="curTitle">เลือกไฟล์จากด้านซ้ายเพื่ออ่านข้อมูล</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <a class="btn" id="btnDl" href="#" style="display:none" download>⬇ ดาวน์โหลด</a>
        <button class="danger" id="btnDel" style="display:none" onclick="deleteCurrent()">🗑 ลบไฟล์</button>
      </div>
    </div>
    <div class="toolbar">
      <button id="mTable" class="active" onclick="setMode('table')">ตารางข้อมูล</button>
      <button id="mRaw" onclick="setMode('raw')">ข้อความดิบ</button>
      <button onclick="loadChunk(0,false)">⏮ เริ่มไฟล์</button>
      <button onclick="stepChunk(-1)">◀ ก่อนหน้า</button>
      <button onclick="stepChunk(1)">ถัดไป ▶</button>
      <button class="primary" onclick="loadChunk(0,true)">⏭ ท้ายไฟล์ล่าสุด</button>
      <input type="text" id="rowFilter" placeholder="กรองข้อความ/วันที่..." style="flex:1;min-width:150px" oninput="renderContent()">
      <span id="chunkInfo" style="font-size:12px;color:var(--mu)"></span>
    </div>
    <div class="viewer" id="viewer"><div class="empty">ยังไม่ได้เลือกไฟล์</div></div>
  </section>
</main>
<script>
const BASE = location.pathname.replace(/\/+$/, '');
const CHUNK = 16384;
const GPS_COLS = ['device_id','date','time','iso','lat','lng','speed','acc_m','sats','synced'];
let files = [];
let curFile = '';
let curSize = 0;
let curOffset = 0;
let curText = '';
let viewMode = 'table';

function fmtBytes(b){
  if(b < 1024) return b + ' B';
  if(b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(2) + ' MB';
}
function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadInfo(){
  try{
    const r = await fetch(BASE + '/api/info');
    const d = await r.json();
    document.getElementById('stSd').textContent = d.sdReady
      ? `${fmtBytes(d.usedBytes)} / ${fmtBytes(d.totalBytes)} (${d.cardType})`
      : 'ไม่พบการ์ด';
    document.getElementById('stGps').textContent = d.gpsValid
      ? `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)} | Sats:${d.sats} | ${d.ev5Hz ? '5Hz' : '1Hz'}`
      : `Searching (Sats:${d.sats})`;
    document.getElementById('stWifi').textContent = `${d.ip} (${d.rssi} dBm)`;
  }catch(e){}
}

async function loadFiles(){
  const el = document.getElementById('fileList');
  try{
    const r = await fetch(BASE + '/api/list');
    const d = await r.json();
    files = d.files || [];
    renderFiles();
    if(!curFile){
      const pref = files.find(f => !f.isDir && f.path === '/gps_log.csv') || files.find(f => !f.isDir);
      if(pref) selectFile(pref.path, true);
    }
  }catch(e){
    el.innerHTML = '<div class="empty">โหลดรายการไฟล์ไม่สำเร็จ</div>';
  }
}

function renderFiles(){
  const q = document.getElementById('fileFilter').value.trim().toLowerCase();
  const list = files.filter(f => !q || f.path.toLowerCase().includes(q));
  document.getElementById('fileCount').textContent = list.length;
  const el = document.getElementById('fileList');
  if(!list.length){ el.innerHTML = '<div class="empty">ไม่พบไฟล์ใน SD Card</div>'; return; }
  el.innerHTML = list.map(f => {
    const active = f.path === curFile ? ' sel' : '';
    const icon = f.isDir ? '📂' : (f.path.endsWith('.csv') ? '📊' : (f.path.endsWith('.jsonl') ? '📦' : '📄'));
    const click = f.isDir ? '' : `data-path="${esc(f.path)}" onclick="selectFile(this.dataset.path,true)"`;
    return `<div class="fitem${active}" ${click}>
      <div class="fpath">${icon} ${esc(f.path)}</div>
      <div class="fsize">${f.isDir ? 'DIR' : fmtBytes(f.size)}</div>
    </div>`;
  }).join('');
}

function selectFile(path, tail){
  curFile = path;
  renderFiles();
  document.getElementById('curTitle').textContent = path;
  const dl = document.getElementById('btnDl');
  dl.href = BASE + '/api/download?path=' + encodeURIComponent(path);
  dl.style.display = 'inline-flex';
  document.getElementById('btnDel').style.display = 'inline-flex';
  loadChunk(0, tail);
}

async function loadChunk(offset, tail){
  if(!curFile) return;
  const viewer = document.getElementById('viewer');
  viewer.innerHTML = '<div class="empty">กำลังอ่านไฟล์จาก SD Card...</div>';
  const url = `${BASE}/api/view?path=${encodeURIComponent(curFile)}&offset=${Math.max(0,offset)}&limit=${CHUNK}&tail=${tail?1:0}`;
  try{
    const r = await fetch(url);
    if(!r.ok){ viewer.innerHTML = `<div class="empty">อ่านไฟล์ไม่สำเร็จ (${r.status})</div>`; return; }
    curSize = parseInt(r.headers.get('X-File-Size') || '0', 10);
    curOffset = parseInt(r.headers.get('X-Offset') || '0', 10);
    curText = await r.text();
    document.getElementById('chunkInfo').textContent =
      `ไบต์ ${curOffset.toLocaleString()} - ${(curOffset + curText.length).toLocaleString()} / ${curSize.toLocaleString()} B`;
    renderContent();
  }catch(e){
    viewer.innerHTML = '<div class="empty">เกิดข้อผิดพลาดในการเชื่อมต่อ ESP32</div>';
  }
}

function stepChunk(dir){
  if(!curFile) return;
  const next = dir < 0 ? Math.max(0, curOffset - CHUNK) : Math.min(Math.max(0, curSize - CHUNK), curOffset + CHUNK);
  loadChunk(next, false);
}

function setMode(m){
  viewMode = m;
  document.getElementById('mTable').classList.toggle('active', m === 'table');
  document.getElementById('mRaw').classList.toggle('active', m === 'raw');
  renderContent();
}

function renderContent(){
  const viewer = document.getElementById('viewer');
  if(!curFile){ viewer.innerHTML = '<div class="empty">ยังไม่ได้เลือกไฟล์</div>'; return; }
  const q = document.getElementById('rowFilter').value.trim().toLowerCase();
  const isCsv = curFile.toLowerCase().endsWith('.csv');
  const isJsonl = curFile.toLowerCase().endsWith('.jsonl');

  if(viewMode === 'raw' || (!isCsv && !isJsonl)){
    const text = q ? curText.split(/\r?\n/).filter(l => l.toLowerCase().includes(q)).join('\n') : curText;
    viewer.innerHTML = `<pre>${esc(text || '(ไฟล์ว่าง)')}</pre>`;
    return;
  }

  const lines = curText.split(/\r?\n/).filter(Boolean);
  if(!lines.length){ viewer.innerHTML = '<div class="empty">ไม่มีข้อมูลในช่วงนี้</div>'; return; }

  if(isJsonl){
    const filtered = q ? lines.filter(l => l.toLowerCase().includes(q)) : lines;
    const rows = [];
    for(const line of filtered){
      try{
        const parsed = JSON.parse(line);
        if(Array.isArray(parsed)) rows.push(...parsed);
        else rows.push(parsed);
      }catch(_){}
    }
    if(!rows.length){ viewer.innerHTML = `<pre>${esc(filtered.join('\n'))}</pre>`; return; }
    const cols = Object.keys(rows[0]);
    const head = cols.map(c => `<th>${esc(c)}</th>`).join('') + '<th>Map</th>';
    const body = rows.slice(-300).reverse().map(row => {
      const mapLink = (row.latitude && row.longitude)
        ? `<td><a class="map" target="_blank" href="https://maps.google.com/?q=${row.latitude},${row.longitude}">📍 ดูแผนที่</a></td>`
        : '<td>-</td>';
      return '<tr>' + cols.map(c => `<td>${esc(row[c] ?? '')}</td>`).join('') + mapLink + '</tr>';
    }).join('');
    viewer.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    return;
  }

  let headers = null;
  let dataLines = lines;
  if(curOffset === 0){
    headers = lines[0].split(',');
    dataLines = lines.slice(1);
  } else {
    if(lines.length > 1) dataLines = lines.slice(1);
    const sample = (dataLines[0] || '').split(',');
    headers = sample.length === GPS_COLS.length ? GPS_COLS : sample.map((_,i)=>'col_'+(i+1));
  }
  const filtered = q ? dataLines.filter(l => l.toLowerCase().includes(q)) : dataLines;
  const latIdx = headers.findIndex(h => h.toLowerCase().includes('lat'));
  const lngIdx = headers.findIndex(h => h.toLowerCase().includes('lon') || h.toLowerCase().includes('lng'));
  const head = headers.map(h => `<th>${esc(h)}</th>`).join('') + (latIdx>=0 && lngIdx>=0 ? '<th>Map</th>' : '');
  const body = filtered.slice(-400).reverse().map(l => {
    const cells = l.split(',');
    let mapTd = '';
    if(latIdx>=0 && lngIdx>=0){
      const la = parseFloat(cells[latIdx]), ln = parseFloat(cells[lngIdx]);
      mapTd = (!isNaN(la) && !isNaN(ln))
        ? `<td><a class="map" target="_blank" href="https://maps.google.com/?q=${la},${ln}">📍 ดูแผนที่</a></td>`
        : '<td>-</td>';
    }
    return '<tr>' + headers.map((_,i)=>`<td>${esc(cells[i] ?? '')}</td>`).join('') + mapTd + '</tr>';
  }).join('');
  viewer.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

async function deleteCurrent(){
  if(!curFile) return;
  if(!confirm('ยืนยันลบไฟล์ ' + curFile + ' ออกจาก SD Card?\n(กู้คืนไม่ได้)')) return;
  const r = await fetch(BASE + '/api/delete?path=' + encodeURIComponent(curFile), { method: 'POST' });
  if(r.ok){
    curFile = '';
    curText = '';
    document.getElementById('btnDl').style.display = 'none';
    document.getElementById('btnDel').style.display = 'none';
    document.getElementById('curTitle').textContent = 'ลบไฟล์เรียบร้อย';
    document.getElementById('viewer').innerHTML = '<div class="empty">ลบไฟล์แล้ว</div>';
    loadAll();
  }else{
    alert('ลบไฟล์ไม่สำเร็จ (' + r.status + ')');
  }
}

function loadAll(){ loadInfo(); loadFiles(); }
loadAll();
setInterval(loadInfo, 5000);
</script>
</body>
</html>)BOSS_SD_HTML";

static String sanitizeSdPath(String rawPath) {
  rawPath.trim();
  if (rawPath.length() == 0) return "/";
  if (!rawPath.startsWith("/")) rawPath = "/" + rawPath;
  if (rawPath.indexOf("..") >= 0) return "";
  return rawPath;
}

static void appendJsonEscaped(String& out, const String& s) {
  out.reserve(out.length() + s.length() + 4);
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '\\' || c == '"') {
      out += '\\';
      out += c;
    } else if (c == '\n') {
      out += "\\n";
    } else if (c == '\r') {
      out += "\\r";
    } else if ((uint8_t)c >= 0x20) {
      out += c;
    }
  }
}

static void appendSdTreeJson(const String& dirPath, String& out, bool& firstItem, int depth, int& count) {
  if (depth > 4 || count >= 250) return;
  File dir = SD.open(dirPath);
  if (!dir || !dir.isDirectory()) {
    if (dir) dir.close();
    return;
  }

  File entry = dir.openNextFile();
  while (entry && count < 250) {
    while (GPS.available() > 0) gps.encode(GPS.read());

    bool isDir = entry.isDirectory();
    size_t sz = isDir ? 0 : entry.size();
    String entryPath = String(entry.path());
    if (entryPath.length() == 0) {
      entryPath = (dirPath == "/" ? "/" : dirPath + "/") + String(entry.name());
    }
    if (!entryPath.startsWith("/")) entryPath = "/" + entryPath;
    entry.close();

    if (!firstItem) out += ",";
    firstItem = false;
    out += "{\"path\":\"";
    appendJsonEscaped(out, entryPath);
    out += "\",\"size\":";
    out += String((unsigned long)sz);
    out += ",\"isDir\":";
    out += (isDir ? "true" : "false");
    out += "}";
    count++;

    if (isDir) {
      appendSdTreeJson(entryPath, out, firstItem, depth + 1, count);
    }
    entry = dir.openNextFile();
  }
  dir.close();
}

static const char* sdCardTypeLabel() {
  if (!sdReady) return "NONE";
  sdcard_type_t t = SD.cardType();
  if (t == CARD_MMC)  return "MMC";
  if (t == CARD_SD)   return "SDSC";
  if (t == CARD_SDHC) return "SDHC";
  return "UNKNOWN";
}

void handleSdWebRoot() {
  sdWebServer.send_P(200, "text/html; charset=utf-8", SD_WEB_HTML);
}

void handleSdWebInfo() {
  String json = "{";
  json += "\"sdReady\":" + String(sdReady ? "true" : "false") + ",";
  json += "\"cardType\":\"" + String(sdCardTypeLabel()) + "\",";
  json += "\"totalBytes\":" + String(sdReady ? (unsigned long long)SD.totalBytes() : 0ULL) + ",";
  json += "\"usedBytes\":" + String(sdReady ? (unsigned long long)SD.usedBytes() : 0ULL) + ",";
  json += "\"gpsValid\":" + String((gps.location.isValid() && gps.location.age() < 3000) ? "true" : "false") + ",";
  json += "\"lat\":" + String(gps.location.isValid() ? gps.location.lat() : 0.0, 6) + ",";
  json += "\"lng\":" + String(gps.location.isValid() ? gps.location.lng() : 0.0, 6) + ",";
  json += "\"sats\":" + String(gps.satellites.isValid() ? gps.satellites.value() : 0) + ",";
  json += "\"ev5Hz\":" + String(ev5HzActivated ? "true" : "false") + ",";
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"rssi\":" + String(WiFi.RSSI());
  json += "}";
  sdWebServer.send(200, "application/json; charset=utf-8", json);
}

void handleSdWebList() {
  if (!sdReady) {
    sdWebServer.send(503, "application/json; charset=utf-8", "{\"ok\":false,\"files\":[]}");
    return;
  }
  String json = "{\"ok\":true,\"files\":[";
  bool firstItem = true;
  int count = 0;
  appendSdTreeJson("/", json, firstItem, 0, count);
  json += "]}";
  sdWebServer.send(200, "application/json; charset=utf-8", json);
}

void handleSdWebView() {
  if (!sdReady) { sdWebServer.send(503, "text/plain", "SD not ready"); return; }
  String path = sanitizeSdPath(sdWebServer.arg("path"));
  if (path.length() == 0 || path == "/") { sdWebServer.send(400, "text/plain", "Invalid path"); return; }

  File f = SD.open(path, FILE_READ);
  if (!f || f.isDirectory()) {
    if (f) f.close();
    sdWebServer.send(404, "text/plain", "File not found");
    return;
  }

  size_t fileSize = f.size();
  size_t limit = sdWebServer.hasArg("limit") ? (size_t)sdWebServer.arg("limit").toInt() : 16384;
  if (limit == 0 || limit > 32768) limit = 16384;

  size_t offset = 0;
  if (sdWebServer.hasArg("tail") && sdWebServer.arg("tail") == "1") {
    offset = (fileSize > limit) ? (fileSize - limit) : 0;
  } else if (sdWebServer.hasArg("offset")) {
    offset = (size_t)sdWebServer.arg("offset").toInt();
    if (offset > fileSize) offset = fileSize;
  }

  size_t bytesToSend = min(limit, fileSize - offset);
  if (offset > 0) f.seek(offset, SeekSet);

  sdWebServer.sendHeader("X-File-Size", String((unsigned long)fileSize));
  sdWebServer.sendHeader("X-Offset", String((unsigned long)offset));
  sdWebServer.sendHeader("X-Chunk-Size", String((unsigned long)bytesToSend));
  sdWebServer.setContentLength(bytesToSend);
  sdWebServer.send(200, "text/plain; charset=utf-8", "");

  char buf[512];
  size_t remaining = bytesToSend;
  while (remaining > 0) {
    while (GPS.available() > 0) gps.encode(GPS.read());
    size_t toRead = min(sizeof(buf), remaining);
    size_t n = f.read((uint8_t*)buf, toRead);
    if (n == 0) break;
    sdWebServer.sendContent(buf, n);
    remaining -= n;
  }
  f.close();
}

void handleSdWebDownload() {
  if (!sdReady) { sdWebServer.send(503, "text/plain", "SD not ready"); return; }
  String path = sanitizeSdPath(sdWebServer.arg("path"));
  if (path.length() == 0 || path == "/") { sdWebServer.send(400, "text/plain", "Invalid path"); return; }

  File f = SD.open(path, FILE_READ);
  if (!f || f.isDirectory()) {
    if (f) f.close();
    sdWebServer.send(404, "text/plain", "File not found");
    return;
  }

  int slash = path.lastIndexOf('/');
  String fileName = (slash >= 0) ? path.substring(slash + 1) : path;
  sdWebServer.sendHeader("Content-Disposition", "attachment; filename=\"" + fileName + "\"");
  sdWebServer.streamFile(f, "application/octet-stream");
  f.close();
}

void handleSdWebDelete() {
  if (!sdReady) { sdWebServer.send(503, "text/plain", "SD not ready"); return; }
  String path = sanitizeSdPath(sdWebServer.arg("path"));
  if (path.length() == 0 || path == "/") { sdWebServer.send(400, "text/plain", "Invalid path"); return; }
  if (!SD.exists(path)) { sdWebServer.send(404, "text/plain", "Not found"); return; }

  if (SD.remove(path)) {
    sdWebServer.send(200, "application/json", "{\"ok\":true}");
  } else {
    sdWebServer.send(500, "application/json", "{\"ok\":false}");
  }
}

void initSdWebServerIfReady() {
  if (sdWebStarted || WiFi.status() != WL_CONNECTED) return;

  String base = String(SD_WEB_SECRET_PATH);
  sdWebServer.on(base.c_str(), HTTP_GET, handleSdWebRoot);
  sdWebServer.on((base + "/").c_str(), HTTP_GET, handleSdWebRoot);
  sdWebServer.on((base + "/api/info").c_str(), HTTP_GET, handleSdWebInfo);
  sdWebServer.on((base + "/api/list").c_str(), HTTP_GET, handleSdWebList);
  sdWebServer.on((base + "/api/view").c_str(), HTTP_GET, handleSdWebView);
  sdWebServer.on((base + "/api/download").c_str(), HTTP_GET, handleSdWebDownload);
  sdWebServer.on((base + "/api/delete").c_str(), HTTP_POST, handleSdWebDelete);

  // ซ่อนจากคนทั่วไป: พาธ "/" หรือพาธอื่นที่ไม่ได้ตั้งไว้จะคืน 404 ทั้งหมด
  sdWebServer.onNotFound([]() {
    sdWebServer.send(404, "text/plain", "Not Found");
  });

  sdWebServer.begin();
  sdWebStarted = true;
  Serial.printf("🔐 [Hidden SD Web] http://%s%s\n", WiFi.localIP().toString().c_str(), SD_WEB_SECRET_PATH);
}
#endif

bool scanAndReportWifiTarget() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, false);
  delay(100);

  Serial.println("🔍 [WiFi Scan] กำลังสแกนหาสัญญาณ Wi-Fi 2.4GHz รอบตัว...");
  int found = WiFi.scanNetworks(false, false, false, 120);
  bool targetFound = false;

  if (found <= 0) {
    Serial.println("⚠️ [WiFi Scan] ไม่พบคลื่น Wi-Fi 2.4GHz รอบข้างเลย");
  } else {
    Serial.printf("📶 [WiFi Scan] พบคลื่น 2.4GHz ทั้งหมด %d เครือข่าย:\n", found);
    int showCount = min(found, 10);
    for (int i = 0; i < found; i++) {
      String ssid = WiFi.SSID(i);
      int32_t rssi = WiFi.RSSI(i);
      int32_t ch = WiFi.channel(i);
      if (ssid == String(WIFI_SSID)) {
        targetFound = true;
        Serial.printf("   ✅ เจอเป้าหมาย \"%s\" (RSSI: %d dBm, Ch: %d)\n", ssid.c_str(), (int)rssi, (int)ch);
      } else if (i < showCount) {
        Serial.printf("   - %s (%d dBm, Ch: %d)\n", ssid.c_str(), (int)rssi, (int)ch);
      }
    }
    if (!targetFound) {
      Serial.printf("❌ [WiFi Scan] ไม่พบชื่อ \"%s\" บนคลื่น 2.4GHz (อาจปิด Hotspot อยู่ หรือเปิดเฉพาะ 5GHz)\n", WIFI_SSID);
    }
  }

  WiFi.scanDelete();
  return targetFound;
}

// ==================== Setup ====================
void setup() {
  Serial.begin(115200);
  delay(300);

  // โหลดพิกัดล่าสุดจาก Flash NVS เพื่อช่วย Warm Start ของชิป NEO-M8N เท่านั้น (ไม่ส่งค่า Cache ปลอมขึ้นเว็บ)
  prefs.begin("gps_cache", false);
  if (prefs.getBool("valid", false)) {
    cachedLat = prefs.getDouble("lat", 0.0);
    cachedLng = prefs.getDouble("lng", 0.0);
    hasCachedPos = (cachedLat != 0.0 && cachedLng != 0.0);
    if (hasCachedPos) {
      Serial.printf("📌 [Warm Start] พบพิกัดช่วยเริ่มต้นใน Flash: %.6f, %.6f\n", cachedLat, cachedLng);
    }
  }

  // GPS Setup (UART1: Pin 16=RX, 17=TX) -> ตรวจ Baud อัตโนมัติ (115200 / fallback 9600) และเริ่มค้นหาที่ 1Hz
  gpGsvInView.begin(gps, "GPGSV", 3);
  glGsvInView.begin(gps, "GLGSV", 3);
  initNeoM8nBaudAuto();
  configureNeoM8nSearchMode();

  // เริ่มต้น SD Card (ใช้งานได้ทันทีแม้ไม่มี Wi-Fi)
  initSDCard();

  // สแกนเช็กก่อนว่าเจอ Wi-Fi เป้าหมาย ("Boss") ในระยะ 2.4GHz หรือไม่ แล้วค่อยเชื่อมต่อ
  bool wifiTargetFound = scanAndReportWifiTarget();

  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiRetryTime = millis();
  if (wifiTargetFound) {
    Serial.print("Connecting to WiFi");
    unsigned long wifiStart = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 8000) {
      delay(400);
      Serial.print(".");
    }
  } else {
    delay(300);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✔ WiFi Connected! IP: " + WiFi.localIP().toString());
    configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
    ntpConfigured = true;
    struct tm tmCheck;
    getLocalTime(&tmCheck, 2500);
    injectM8nAssistance();
    #if SD_WEB_ENABLE
      initSdWebServerIfReady();
    #endif
    #if ENABLE_FIREBASE_SYNC
      initFirebaseIfReady();
    #endif
  } else {
    Serial.println("\n⚠️ WiFi ยังไม่เชื่อมต่อ — บันทึกลง SD Card และรอซิงก์อัตโนมัติเมื่อออนไลน์");
  }
}

void flushCloudBatch() {
  if (cloudBatchCount == 0 || cloudBatchJson.length() == 0) return;
  String arrayPayload = "[" + cloudBatchJson + "]";
  cloudBatchJson = "";
  cloudBatchCount = 0;

  if (!sendToSupabase(arrayPayload)) {
    enqueueOfflinePayload(arrayPayload);
  }
}

void printGpsSearchStatus(int satsUsed) {
  int gpView = gpGsvInView.isValid() ? atoi(gpGsvInView.value()) : 0;
  int glView = glGsvInView.isValid() ? atoi(glGsvInView.value()) : 0;
  Serial.printf("กำลังค้นหาสัญญาณดาวเทียม (Used:%d | InView GP:%d GL:%d | Chars:%lu | Passed:%lu)...\n",
                satsUsed, gpView, glView, gps.charsProcessed(), gps.passedChecksum());
}

// ==================== Loop ====================
void loop() {
  // 1. อ่านค่าจาก GPS ตลอดเวลา (ห้ามใส่ delay เด็ดขาด เพื่อไม่ให้ Buffer เต็ม)
  while (GPS.available() > 0) {
    gps.encode(GPS.read());
  }

  // ปล่อยให้ AutoReconnect ของ ESP32 ทำงานเบื้องหลัง ไม่เรียก WiFi.begin() ชนตอนกำลังเชื่อม
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiRetryTime >= 30000) {
      lastWifiRetryTime = millis();
      wl_status_t st = WiFi.status();
      if (st == WL_CONNECT_FAILED || st == WL_STOPPED) {
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
      Serial.printf("📡 [WiFi] รอเชื่อม \"%s\" (2.4GHz, status=%d) — บันทึกลง SD Card ต่อเนื่อง\n",
                    WIFI_SSID, (int)st);
    }
  } else {
    if (!ntpConfigured) {
      configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
      ntpConfigured = true;
    }
    if (!m8nTimeAssisted) {
      injectM8nAssistance();
    }
    #if SD_WEB_ENABLE
      initSdWebServerIfReady();
    #endif
  }

  #if SD_WEB_ENABLE
    if (sdWebStarted) {
      sdWebServer.handleClient();
    }
  #endif

  // 2. เก็บข้อมูลทันทีที่ NEO-M8N ส่งพิกัดใหม่รอบ 5 Hz (ทุก ~200 ms)
  if (gps.location.isUpdated() && millis() - lastSendTime >= 150) {
    lastSendTime = millis();

    int sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
    double hdop = gps.hdop.isValid() ? gps.hdop.hdop() : 5.0;

    if (gps.location.isValid() && gps.location.age() < 3000) {
      if (!ev5HzActivated) {
        configureNeoM8nEv5Hz();
      }
      double lat      = gps.location.lat();
      double lng      = gps.location.lng();
      double speedKmh = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
      double acc      = hdop * 2.5; // NEO-M8N ~2.5m CEP UERE x HDOP
      DeviceDateTime dt = getDeviceDateTime();

      if (dt.isoTH.length() == 0 || dt.isoTH != lastLoggedIso) {
        if (dt.isoTH.length() > 0) lastLoggedIso = dt.isoTH;

        // บันทึกพิกัดจริงลง Flash เพื่อช่วย Warm Start รอบหน้า (ครั้งแรกทันที หรือทุก 60 วิ)
        if (!hasCachedPos || millis() - lastCacheSaveTime >= 60000) {
          lastCacheSaveTime = millis();
          saveCachedPosition(lat, lng);
        }

        Serial.printf("[5Hz] Lat: %.6f, Lng: %.6f, Speed: %.1f km/h, Sats: %d, HDOP: %.2f, Time: %s\n",
                      lat, lng, speedKmh, sats, hdop, dt.timeTH.c_str());

        // เก็บลง Buffer Batch สำหรับส่งขึ้น Supabase (ทุก 1 วินาที / ครั้งละ ~5 จุด)
        if (dt.hasRealDate && dt.isoTH.length() > 0) {
          String itemJson = "{";
          itemJson += "\"device_id\":\"" + String(SUPABASE_DEVICE_ID) + "\",";
          itemJson += "\"latitude\":" + String(lat, 6) + ",";
          itemJson += "\"longitude\":" + String(lng, 6) + ",";
          itemJson += "\"speed\":" + String(speedKmh, 1) + ",";
          itemJson += "\"accuracy\":" + String(acc, 1) + ",";
          itemJson += "\"source\":\"iot\",";
          itemJson += "\"device_time\":\"" + dt.isoTH + "\"";
          itemJson += "}";

          if (cloudBatchCount > 0) cloudBatchJson += ",";
          cloudBatchJson += itemJson;
          cloudBatchCount++;
          if (cloudBatchCount >= MAX_BATCH_POINTS) {
            flushCloudBatch();
            lastCloudBatchTime = millis();
          }
        }

        // บันทึก 5Hz ทุกจุดลง SD Card CSV ทันที
        appendCSVLog(dt, lat, lng, speedKmh, acc, sats, WiFi.status() == WL_CONNECTED);

        #if ENABLE_FIREBASE_SYNC
          sendToFirebase(lat, lng, speedKmh, acc, dt.timeTH);
        #endif
      }
    } else {
      printGpsSearchStatus(sats);
    }
  } else if ((!gps.location.isValid() || gps.location.age() >= 3000) && millis() - lastSendTime >= 2000) {
    lastSendTime = millis();
    int sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
    printGpsSearchStatus(sats);
  }

  // 2.5 รวบส่ง Batch ขึ้น Supabase ทุกๆ 1 วินาที (~5 จุดต่อ 1 HTTP Request)
  if (millis() - lastCloudBatchTime >= CLOUD_BATCH_MS) {
    lastCloudBatchTime = millis();
    flushCloudBatch();
  }

  // 3. ทยอยส่งคิว Offline ที่ค้างบน SD Card เมื่อ Wi-Fi กลับมา
  if (millis() - lastQueueSyncTime >= QUEUE_SYNC_MS) {
    lastQueueSyncTime = millis();
    flushOfflineQueue();
  }
}
