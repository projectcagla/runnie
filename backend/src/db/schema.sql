-- Koşu Şiddeti Asistanı - Backend Veritabanı Şeması (SQLite / node:sqlite)
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 1. Kullanıcılar
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL
);

-- 2. Cihazlar ve Kimlik Doğrulama
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_identifier TEXT UNIQUE NOT NULL,
  auth_token_hash TEXT NOT NULL,
  apns_token TEXT,
  model TEXT,
  os_version TEXT,
  app_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 3. Aktiviteler (Koşular)
-- NOT: start_latitude ve start_longitude GİZLİLİK VE VERİ MİNİMİZASYONU gereği saklanmaz.
-- Koordinatlar senkronizasyon anında hava durumu sorgulanıp anında atılır.
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY, -- Sunucu tarafından üretilen UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_activity_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  sport_type TEXT NOT NULL,
  surface_type TEXT NOT NULL,
  title TEXT,
  start_time TEXT NOT NULL,
  elapsed_time_sec INTEGER NOT NULL,
  moving_time_sec INTEGER NOT NULL,
  distance_meters REAL NOT NULL,
  elevation_gain_meters REAL NOT NULL,
  has_heart_rate INTEGER NOT NULL DEFAULT 0,
  avg_hr INTEGER,
  max_hr INTEGER,
  avg_cadence INTEGER,
  avg_pace_sec_per_km INTEGER NOT NULL,
  gap_sec_per_km INTEGER NOT NULL,
  pace_source TEXT NOT NULL,
  has_instantaneous_pace INTEGER NOT NULL DEFAULT 0,
  weather_status TEXT NOT NULL DEFAULT 'UNAVAILABLE', -- 'AVAILABLE', 'UNAVAILABLE'
  temperature_celsius REAL,
  apparent_temperature_celsius REAL,
  relative_humidity_pct REAL,
  wind_speed_kmh REAL,
  is_extreme_heat INTEGER NOT NULL DEFAULT 0,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  duplicate_of_id TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT uq_activity_user_source_time UNIQUE (user_id, source_name, start_time)
);

CREATE INDEX IF NOT EXISTS idx_activities_user_time ON activities(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_activities_dup ON activities(user_id, is_duplicate);

-- 4. Aktivite Akış Serileri (StreamPoints JSON)
CREATE TABLE IF NOT EXISTS activity_streams (
  activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  stream_json TEXT NOT NULL,
  point_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- 5. Kullanıcı Fizyolojik Tarihsel Metrikleri (VO2max, Dinlenik Nabız)
CREATE TABLE IF NOT EXISTS user_metrics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL, -- 'VO2MAX', 'RESTING_HR', 'HRV_SDNN'
  date TEXT NOT NULL,
  value REAL NOT NULL,
  source_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_user_date ON user_metrics(user_id, metric_type, date);

-- 6. Kullanıcı Eşikleri (Sürümlenmiş, Geçerlilik Pencereli)
CREATE TABLE IF NOT EXISTS user_thresholds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  aet_hr INTEGER NOT NULL,
  ant_hr INTEGER NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  source TEXT NOT NULL, -- 'TALK_TEST_ANCHOR', 'VO2MAX_DERIVED', 'COLD_START'
  confidence_level TEXT NOT NULL, -- 'HIGH', 'MEDIUM', 'LOW'
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_thresholds_active ON user_thresholds(user_id, is_active);

-- 7. Hüküm ve Değerlendirmeler (Değişmez Arşiv)
CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  activity_id TEXT UNIQUE NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_threshold_id TEXT REFERENCES user_thresholds(id) ON DELETE SET NULL,
  verdict TEXT NOT NULL, -- 'ACCORDING_TO_PLAN', 'DRIFTED', 'BOUNDARY_ZONE', 'TOO_FAST', 'TOO_SLOW', 'INVALID'
  weather_status TEXT NOT NULL, -- 'AVAILABLE', 'UNAVAILABLE'
  heat_acquittal_applied INTEGER NOT NULL DEFAULT 0,
  sentence TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  metrics_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assessments_verdict ON assessments(verdict);

-- 8. Senkronizasyon ve İş Kuyruğu (Değerlendirme Hattı)
CREATE TABLE IF NOT EXISTS sync_jobs (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL, -- 'PENDING', 'EVALUATION_PLACEHOLDER', 'COMPLETED', 'FAILED'
  sync_received_at TEXT NOT NULL,
  completed_at TEXT,
  delivery_latency_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);

-- 9. Hava Durumu Önbelleği (Koordinat Saklamayan Izgara Anahtarlı Önbellek)
CREATE TABLE IF NOT EXISTS weather_cache (
  cache_key TEXT PRIMARY KEY, -- 'lat_lon_grid_YYYY-MM-DD_HH'
  weather_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 10. KVKK / GDPR Anonimleştirilmiş Denetim Günlüğü
CREATE TABLE IF NOT EXISTS anonymized_audit_log (
  id TEXT PRIMARY KEY,
  deleted_user_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  total_activities_deleted INTEGER NOT NULL,
  total_distance_km REAL NOT NULL,
  created_at TEXT NOT NULL
);

-- 11. Geriye Dönük Etiketleme ve Sistematik Sapma İzleme (Yer Gerçeği Akışı)
CREATE TABLE IF NOT EXISTS user_feedbacks (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feedback_tag TEXT NOT NULL, -- 'ACTUALLY_EASY', 'ACTUALLY_HARD', 'GROUP_RUN'
  perceived_rpe INTEGER, -- 1-10 algılanan zorluk (isteğe bağlı)
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_user ON user_feedbacks(user_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_tag ON user_feedbacks(feedback_tag);

