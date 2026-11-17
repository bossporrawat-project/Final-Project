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

// (ตัวเลือกเสริม) ใส่ Google Geolocation API Key หากต้องการระบุตำแหน่งกลางตึกทึบด้วย Wi-Fi Scan
#define GOOGLE_GEOLOCATION_API_KEY ""

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
// GPS Module (UART1 ตามโค้ดเดิมของคุณบอส)
#define GPS_RX_PIN 16
#define GPS_TX_PIN 17
#define GPS_BAUD   9600

// SD Card Module (VSPI มาตรฐานตามรูปที่คุณบอสต่อ)
#define SD_CS_PIN   5
#define SD_SCK_PIN  18
#define SD_MISO_PIN 19
#define SD_MOSI_PIN 23

// ==================== 5. ความถี่การส่งข้อมูล ====================
const unsigned long LOG_INTERVAL_MS = 1000;  // 1000 ms = ส่งและบันทึกทุก 1 วินาที
const unsigned long QUEUE_SYNC_MS   = 10000; // 10000 ms = ตรวจคิวค้างใน SD Card ทุก 10 วินาที

// ==================== ตัวแปรระบบ ====================
HardwareSerial GPS(1);
TinyGPSPlus gps;
Preferences prefs;

bool sdReady = false;
bool m8nTimeAssisted = false;
double cachedLat = 0.0;
double cachedLng = 0.0;
bool hasCachedPos = false;
unsigned long lastSendTime = 0;
unsigned long lastQueueSyncTime = 0;
unsigned long lastCacheSaveTime = 0;
unsigned long lastIndoorFallbackTime = 0;
unsigned long bootTimeMs = 0;

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
// ปรับจูน u-blox NEO-M8N ให้จับสัญญาณอ่อนในอาคาร / ริมหน้าต่างไวขึ้น:
// 1) CFG-RATE = 1 Hz (1000 ms) สะสมสัญญาณดาวเทียมได้นานขึ้น 5 เท่าและไม่ล้น 9600 baud
// 2) CFG-NAV5 = Pedestrian + Auto 2D/3D + minElev=5° + cnoThresh=0
// ----------------------------------------------------------------------------
void configureNeoM8nIndoor() {
  // 1. CFG-RATE (0x06, 0x08): measRate = 1000ms (0x03E8), navRate = 1, timeRef = GPS(1)
  uint8_t cfgRate[6] = { 0xE8, 0x03, 0x01, 0x00, 0x01, 0x00 };
  sendUBXPacket(0x06, 0x08, cfgRate, sizeof(cfgRate));
  delay(80);

  // 2. CFG-NAV5 (0x06, 0x24): mask=0x0407 (dynModel + minEl + posFixMode + cnoThresh)
  uint8_t cfgNav5[36] = {0};
  cfgNav5[0]  = 0x07; // mask LSB (dyn | minEl | posFixMode)
  cfgNav5[1]  = 0x04; // mask MSB (cnoThresh)
  cfgNav5[2]  = 3;    // dynModel: 3 = Pedestrian (นิ่งและไวในอาคาร)
  cfgNav5[3]  = 3;    // fixMode:  3 = Auto 2D/3D (ล็อก 2D ได้ทันทีเมื่อเห็นแค่ 3 ดวง)
  cfgNav5[12] = 5;    // minElev:  5° (รับดาวเทียมมุมต่ำที่ลอดผ่านหน้าต่าง)
  cfgNav5[24] = 0;    // cnoThreshNumSVs = 0
  cfgNav5[25] = 0;    // cnoThresh = 0 dBHz (ไม่ตัดสัญญาณอ่อนทิ้ง)
  sendUBXPacket(0x06, 0x24, cfgNav5, sizeof(cfgNav5));
  delay(80);

  Serial.println("🛰️ [NEO-M8N] ตั้งค่าโหมดรับสัญญาณไวในอาคาร (1Hz + Auto 2D/3D + MinElev 5°) แล้ว");
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

    char dateBuf[16], timeBuf[16], isoBuf[32];
    snprintf(dateBuf, sizeof(dateBuf), "%04d-%02d-%02d", year, month, day);
    snprintf(timeBuf, sizeof(timeBuf), "%02d:%02d:%02d", hour, min, sec);
    snprintf(isoBuf, sizeof(isoBuf), "%sT%s+07:00", dateBuf, timeBuf);

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

// ส่งสถานะตำแหน่งเข้า gps_positions โดยตรง (ใช้ตอนรอ GPS ในอาคารจาก Wi-Fi / Cache)
bool upsertLivePositionOnly(double lat, double lng, double acc, const String& statusLabel, const String& isoTime) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(3500);
  String endpoint = String(SUPABASE_URL) + "/rest/v1/gps_positions?on_conflict=device_id";
  if (!http.begin(client, endpoint)) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "resolution=merge-duplicates,return=minimal");

  String payload = "{";
  payload += "\"device_id\":\"" + String(SUPABASE_DEVICE_ID) + "\",";
  payload += "\"device_name\":\"" + String(SUPABASE_DEVICE_ID) + "\",";
  payload += "\"latitude\":" + String(lat, 6) + ",";
  payload += "\"longitude\":" + String(lng, 6) + ",";
  payload += "\"speed\":0,";
  payload += "\"accuracy\":" + String(acc, 1) + ",";
  payload += "\"source\":\"iot\",";
  payload += "\"app_status\":\"" + statusLabel + "\",";
  payload += "\"is_online\":true";
  if (isoTime.length() > 0) payload += ",\"device_time\":\"" + isoTime + "\"";
  payload += "}";

  int code = http.POST(payload);
  http.end();
  return code >= 200 && code < 300;
}

// ใช้ Google Geolocation API ผ่านการสแกน Wi-Fi BSSID รอบอาคาร (ถ้าใส่ API Key)
bool fetchWifiGeolocation(double& outLat, double& outLng, double& outAcc) {
  if (String(GOOGLE_GEOLOCATION_API_KEY).length() == 0 || WiFi.status() != WL_CONNECTED) return false;

  int n = WiFi.scanNetworks(false, false, false, 200);
  if (n <= 0) return false;

  String body = "{\"wifiAccessPoints\":[";
  int added = 0;
  for (int i = 0; i < n && added < 8; i++) {
    if (added > 0) body += ",";
    body += "{\"macAddress\":\"" + WiFi.BSSIDstr(i) + "\",\"signalStrength\":" + String(WiFi.RSSI(i)) + "}";
    added++;
  }
  body += "]}";
  WiFi.scanDelete();

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(4000);
  String url = String("https://www.googleapis.com/geolocation/v1/geolocate?key=") + GOOGLE_GEOLOCATION_API_KEY;
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  String resp = (code == 200) ? http.getString() : "";
  http.end();
  if (code != 200 || resp.length() == 0) return false;

  int latIdx = resp.indexOf("\"lat\"");
  int lngIdx = resp.indexOf("\"lng\"");
  int accIdx = resp.indexOf("\"accuracy\"");
  if (latIdx < 0 || lngIdx < 0) return false;

  outLat = resp.substring(resp.indexOf(":", latIdx) + 1).toDouble();
  outLng = resp.substring(resp.indexOf(":", lngIdx) + 1).toDouble();
  outAcc = (accIdx >= 0) ? resp.substring(resp.indexOf(":", accIdx) + 1).toDouble() : 35.0;
  return (outLat != 0.0 && outLng != 0.0);
}

// ==================== Setup ====================
void setup() {
  Serial.begin(115200);
  delay(300);
  bootTimeMs = millis();

  // โหลดพิกัดล่าสุดที่เคยจำไว้ใน Flash NVS (สำหรับ Warm Start ของ NEO-M8N และ Indoor Fallback)
  prefs.begin("gps_cache", false);
  if (prefs.getBool("valid", false)) {
    cachedLat = prefs.getDouble("lat", 0.0);
    cachedLng = prefs.getDouble("lng", 0.0);
    hasCachedPos = (cachedLat != 0.0 && cachedLng != 0.0);
    if (hasCachedPos) {
      Serial.printf("📌 [Flash Cache] พบพิกัดล่าสุดในเครื่อง: %.6f, %.6f\n", cachedLat, cachedLng);
    }
  }

  // GPS Setup (UART1: Pin 16=RX, 17=TX) + ปรับจูน NEO-M8N สำหรับสัญญาณอ่อนในอาคาร
  GPS.setRxBufferSize(1024);
  GPS.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  delay(800);
  configureNeoM8nIndoor();

  // เริ่มต้น SD Card (ใช้งานได้ทันทีแม้ไม่มี Wi-Fi)
  initSDCard();

  // ต่อ Wi-Fi แบบไม่ค้างตลอดกาล (รอสูงสุด 8 วินาที)
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 8000) {
    delay(400);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✔ WiFi Connected! IP: " + WiFi.localIP().toString());
    configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
    // รอ NTP สั้นๆ ไม่เกิน 2.5 วินาที เพื่อฉีดเวลาจริงเข้า NEO-M8N ช่วยให้จับดาวเทียมเร็วขึ้น
    struct tm tmCheck;
    getLocalTime(&tmCheck, 2500);
    injectM8nAssistance();
    #if ENABLE_FIREBASE_SYNC
      initFirebaseIfReady();
    #endif
  } else {
    Serial.println("\n⚠️ WiFi ยังไม่เชื่อมต่อ — บันทึกลง SD Card และรอซิงก์อัตโนมัติเมื่อออนไลน์");
  }
}

// ==================== Loop ====================
void loop() {
  // 1. อ่านค่าจาก GPS ตลอดเวลา (ห้ามใส่ delay เด็ดขาด เพื่อไม่ให้ Buffer เต็ม)
  while (GPS.available() > 0) {
    gps.encode(GPS.read());
  }

  // พยายามเชื่อม Wi-Fi อัตโนมัติเมื่อหลุด และฉีดเวลา Warm Start หากเพิ่งต่อติด
  if (WiFi.status() != WL_CONNECTED && millis() % 15000 < 30) {
    WiFi.reconnect();
  }
  if (WiFi.status() == WL_CONNECTED && !m8nTimeAssisted) {
    injectM8nAssistance();
  }

  // 2. เช็กเวลาทุกๆ 1 วินาที
  if (millis() - lastSendTime >= LOG_INTERVAL_MS) {
    lastSendTime = millis();

    if (gps.location.isValid() && gps.location.age() < 3000) {
      double lat      = gps.location.lat();
      double lng      = gps.location.lng();
      double speedKmh = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
      double acc      = gps.hdop.isValid() ? (gps.hdop.hdop() * 5.0) : 10.0;
      int sats        = gps.satellites.isValid() ? gps.satellites.value() : 0;
      DeviceDateTime dt = getDeviceDateTime();

      // บันทึกพิกัดจริงลง Flash เพื่อช่วย Warm Start รอบหน้า (ครั้งแรกทันที หรือทุก 60 วิ)
      if (!hasCachedPos || millis() - lastCacheSaveTime >= 60000) {
        lastCacheSaveTime = millis();
        saveCachedPosition(lat, lng);
      }

      Serial.printf("GPS Fix -> Lat: %.6f, Lng: %.6f, Speed: %.1f km/h, Sats: %d, Time: %s\n",
                    lat, lng, speedKmh, sats, dt.timeTH.c_str());

      // ส่งเข้า Supabase (ต้องมี ISO Timestamp จริงจาก GPS หรือ NTP เพื่อกันชนคิว)
      bool synced = false;
      if (dt.hasRealDate && dt.isoTH.length() > 0) {
        String jsonPayload = "{";
        jsonPayload += "\"device_id\":\"" + String(SUPABASE_DEVICE_ID) + "\",";
        jsonPayload += "\"latitude\":" + String(lat, 6) + ",";
        jsonPayload += "\"longitude\":" + String(lng, 6) + ",";
        jsonPayload += "\"speed\":" + String(speedKmh, 1) + ",";
        jsonPayload += "\"accuracy\":" + String(acc, 1) + ",";
        jsonPayload += "\"source\":\"iot\",";
        jsonPayload += "\"device_time\":\"" + dt.isoTH + "\"";
        jsonPayload += "}";

        synced = sendToSupabase(jsonPayload);
        if (!synced) {
          enqueueOfflinePayload(jsonPayload);
        }
      }

      // บันทึกลง SD Card CSV ทุกจุด
      appendCSVLog(dt, lat, lng, speedKmh, acc, sats, synced);

      // อัปเดตเข้า Firebase RTDB ด้วย (ถ้าเปิด ENABLE_FIREBASE_SYNC)
      #if ENABLE_FIREBASE_SYNC
        sendToFirebase(lat, lng, speedKmh, acc, dt.timeTH);
      #endif
    } else {
      int sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
      Serial.printf("กำลังค้นหาสัญญาณดาวเทียม (NEO-M8N Sats: %d)...\n", sats);

      // หากอยู่ในอาคารทึบเกิน 15 วินาทีแล้วยังไม่มีสัญญาณ GPS ให้ใช้ Wi-Fi Geo หรือ Flash Cache อัปเดตตำแหน่งบนเว็บชั่วคราวทุก 10 วิ
      if (WiFi.status() == WL_CONNECTED &&
          millis() - bootTimeMs > 15000 &&
          millis() - lastIndoorFallbackTime >= 10000) {
        lastIndoorFallbackTime = millis();
        DeviceDateTime dt = getDeviceDateTime();
        double wLat = 0, wLng = 0, wAcc = 40.0;
        if (fetchWifiGeolocation(wLat, wLng, wAcc)) {
          saveCachedPosition(wLat, wLng);
          if (upsertLivePositionOnly(wLat, wLng, wAcc, "Indoor (Wi-Fi Positioning)", dt.isoTH)) {
            Serial.printf("📶 [Indoor Wi-Fi] ระบุตำแหน่งในอาคาร: %.6f, %.6f (±%.0fm)\n", wLat, wLng, wAcc);
          }
        } else if (hasCachedPos) {
          if (upsertLivePositionOnly(cachedLat, cachedLng, 50.0, "Indoor Cache (Waiting GPS)", dt.isoTH)) {
            Serial.printf("🏠 [Indoor Cache] แสดงพิกัดล่าสุดระหว่างรอสัญญาณในอาคาร: %.6f, %.6f\n", cachedLat, cachedLng);
          }
        }
      }
    }
  }

  // 3. ทยอยส่งคิว Offline ที่ค้างบน SD Card เมื่อ Wi-Fi กลับมา
  if (millis() - lastQueueSyncTime >= QUEUE_SYNC_MS) {
    lastQueueSyncTime = millis();
    flushOfflineQueue();
  }
}
