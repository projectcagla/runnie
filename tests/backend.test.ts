import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runMigrations } from '../backend/src/db/database.ts';
import { registerOrGetDevice, authenticateDeviceToken } from '../backend/src/auth/deviceAuth.ts';
import { evaluateDeduplication } from '../backend/src/services/deduplication.ts';
import { getHistoricalWeather } from '../backend/src/services/weatherService.ts';
import { deleteUserDataCompletely } from '../backend/src/services/deletionService.ts';
import { enqueueActivityForEvaluation, processNextEvaluationJob } from '../backend/src/services/queueService.ts';
import type { NormalizedActivity } from '../src/types.ts';

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  const schemaPath = path.join(process.cwd(), 'backend', 'src', 'db', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schemaSql);
  return db;
}

test('Backend: Cihaz Kaydı ve Yüksek Entropili Token Doğrulama', () => {
  const db = createTestDb();
  const reg = registerOrGetDevice(db, {
    deviceIdentifier: 'test_ios_vendor_id_123',
    model: 'iPhone15,2',
    appVersion: '1.0.0'
  });

  assert.ok(reg.authToken && reg.authToken.length >= 64, 'Token en az 64 hex karakter (256-bit) olmalıdır.');
  assert.ok(reg.userId.startsWith('usr_'), 'Kullanıcı kimliği usr_ ön eki taşımalıdır.');

  const session = authenticateDeviceToken(db, reg.authToken);
  assert.ok(session !== null, 'Üretilen token ile oturum açılabilmelidir.');
  assert.strictEqual(session?.userId, reg.userId);
  assert.strictEqual(session?.deviceId, reg.deviceId);

  const fakeSession = authenticateDeviceToken(db, 'gecersiz_token_dizesi_123456');
  assert.strictEqual(fakeSession, null, 'Geçersiz token ile oturum açılmamalıdır.');
});

test('Backend: Tekilleştirme — Tek Kopya Korunmalı, Zengin Olan Tutulmalı', () => {
  const baseAct: NormalizedActivity = {
    id: 'act_1',
    userId: 'usr_1',
    sportType: 'RUN',
    surfaceType: 'ROAD',
    title: 'Koşu',
    startTime: '2026-08-01T07:00:00.000Z',
    elapsedTimeSec: 1800,
    movingTimeSec: 1800,
    distanceMeters: 5000,
    elevationGainMeters: 10,
    hasHeartRate: true,
    avgPaceSecPerKm: 360,
    gapSecPerKm: 360,
    sourceName: 'Apple Watch Series 8',
    paceSource: 'RUNNING_SPEED',
    hasInstantaneousPace: true
  };

  // 1. Tekil kopya asla silinmez
  const singleDecision = evaluateDeduplication({ activity: baseAct, stream: [] }, []);
  assert.strictEqual(singleDecision.action, 'KEEP');

  // 2. Mükerrer çift: Gelen kopya sensörsüz Strava ise mevcut Apple Watch korunur
  const stravaCopy: NormalizedActivity = {
    ...baseAct,
    id: 'act_strava',
    sourceName: 'Strava',
    hasHeartRate: false,
    paceSource: 'ACTIVITY_AVERAGE',
    hasInstantaneousPace: false,
    startTime: '2026-08-01T07:00:15.000Z' // 15 sn sonra
  };

  const dupDecision = evaluateDeduplication(
    { activity: stravaCopy, stream: [] },
    [{ activity: baseAct, stream: [{ t: 0, hr: 135, gap: 360 }] }]
  );

  assert.strictEqual(dupDecision.action, 'MARK_DUPLICATE');
  assert.strictEqual(dupDecision.duplicateOfId, 'act_1');
});

test('Backend: Hava Servisi — Koordinat Yokken 20°C Uydurulmamalı (UNAVAILABLE)', async () => {
  const db = createTestDb();
  const res = await getHistoricalWeather(db, {
    latitude: undefined,
    longitude: undefined,
    isoStartTime: '2026-08-01T07:00:00.000Z'
  });

  assert.strictEqual(res.status, 'UNAVAILABLE');
  assert.strictEqual((res as any).snapshot, undefined);
});

test('Backend: KVKK / GDPR Unutulma Hakkı — Sert Silme ve Denetim İzi', () => {
  const db = createTestDb();
  const reg = registerOrGetDevice(db, { deviceIdentifier: 'vendor_to_delete' });

  db.prepare(`
    INSERT INTO activities (
      id, user_id, client_activity_id, source_name, sport_type, surface_type,
      start_time, elapsed_time_sec, moving_time_sec, distance_meters,
      elevation_gain_meters, avg_pace_sec_per_km, gap_sec_per_km, pace_source,
      weather_status, created_at
    ) VALUES (
      'act_del_1', ?, 'client_1', 'Apple Watch', 'RUN', 'ROAD',
      '2026-08-01T07:00:00.000Z', 1800, 1800, 5000, 10, 360, 360, 'RUNNING_SPEED',
      'UNAVAILABLE', '2026-08-01T07:30:00.000Z'
    )
  `).run(reg.userId);

  const delResult = deleteUserDataCompletely(db, reg.userId);
  assert.strictEqual(delResult.success, true);
  assert.strictEqual(delResult.deletedActivitiesCount, 1);
  assert.strictEqual(delResult.totalDistanceKm, 5);

  const userCheck = db.prepare('SELECT COUNT(*) as c FROM users WHERE id = ?').get(reg.userId) as any;
  assert.strictEqual(userCheck.c, 0, 'Kullanıcı fiziksel olarak silinmelidir.');

  const actCheck = db.prepare('SELECT COUNT(*) as c FROM activities WHERE user_id = ?').get(reg.userId) as any;
  assert.strictEqual(actCheck.c, 0, 'Aktiviteler fiziksel olarak silinmelidir.');

  const auditCheck = db.prepare('SELECT COUNT(*) as c FROM anonymized_audit_log').get() as any;
  assert.strictEqual(auditCheck.c, 1, 'Anonimleştirilmiş denetim izi oluşturulmalıdır.');
});

test('Backend: Senkronizasyondan Değerlendirmeye Uçtan Uca Hat', async () => {
  const db = createTestDb();
  const reg = registerOrGetDevice(db, { deviceIdentifier: 'vendor_e2e' });

  // 1. Aktivite ve akışı doğrudan veritabanına ekle
  const actId = 'act_e2e_001';
  db.prepare(`
    INSERT INTO activities (
      id, user_id, client_activity_id, source_name, sport_type, surface_type,
      title, start_time, elapsed_time_sec, moving_time_sec, distance_meters,
      elevation_gain_meters, has_heart_rate, avg_hr, avg_pace_sec_per_km, gap_sec_per_km,
      pace_source, has_instantaneous_pace, weather_status, created_at
    ) VALUES (
      ?, ?, 'client_e2e', 'Apple Watch', 'RUN', 'ROAD',
      'Sabah Kolay Koşusu', '2026-08-01T07:00:00.000Z', 1800, 1800, 5000,
      10, 1, 134, 360, 360, 'RUNNING_SPEED', 1, 'UNAVAILABLE', '2026-08-01T07:30:00.000Z'
    )
  `).run(actId, reg.userId);

  const stream = [
    { t: 0, hr: 125, cad: 168, gap: 360 },
    { t: 600, hr: 132, cad: 170, gap: 360 },
    { t: 1200, hr: 134, cad: 170, gap: 360 },
    { t: 1800, hr: 135, cad: 171, gap: 360 }
  ];

  db.prepare(`
    INSERT INTO activity_streams (activity_id, stream_json, point_count, created_at)
    VALUES (?, ?, ?, ?)
  `).run(actId, JSON.stringify(stream), stream.length, new Date().toISOString());

  // 2. Kuyruğa al
  const jobId = enqueueActivityForEvaluation(db, reg.userId, actId);
  assert.ok(jobId.startsWith('job_'));

  // 3. Kuyruğu işle
  const processed = await processNextEvaluationJob(db);
  assert.strictEqual(processed?.status, 'COMPLETED');

  // 4. assessments tablosuna yazılmış mı kontrol et
  const asmt = db.prepare('SELECT * FROM assessments WHERE activity_id = ?').get(actId) as any;
  assert.ok(asmt !== undefined, 'Assessment kaydı oluşturulmalıdır.');
  assert.ok(asmt.sentence && asmt.sentence.length > 10, 'Türkçe değerlendirme cümlesi üretilmelidir.');
  assert.strictEqual(asmt.verdict, 'ACCORDING_TO_PLAN');
});
