import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { getDatabase, runMigrations } from './db/database.ts';
import { BACKEND_CONFIG } from './config.ts';
import { registerOrGetDevice, authenticateDeviceToken } from './auth/deviceAuth.ts';
import { evaluateDeduplication } from './services/deduplication.ts';
import { getHistoricalWeather } from './services/weatherService.ts';
import { registerApnsDeviceToken } from './services/pushService.ts';
import { enqueueActivityForEvaluation, processNextEvaluationJob } from './services/queueService.ts';
import { deleteUserDataCompletely } from './services/deletionService.ts';
import type { NormalizedActivity, StreamPoint } from '../../src/types.ts';

/**
 * JSON Gövde Okuma Yardımcısı
 */
async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) { // 50 MB limit
        req.destroy();
        resolve(null);
      }
    });
    req.on('end', () => {
      if (!body) return resolve(null);
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function createBackendServer(customDbPath?: string) {
  const db = getDatabase(customDbPath);
  runMigrations(db);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method;

    // 1. Sağlık Kontrolü (Health Check)
    if (method === 'GET' && pathname === '/v1/health') {
      return sendJson(res, 200, { status: 'healthy', time: new Date().toISOString() });
    }

    // 2. Cihaz Kaydı ve Kimlik (POST /v1/auth/device-register)
    if (method === 'POST' && pathname === '/v1/auth/device-register') {
      const body = await readJsonBody<any>(req);
      if (!body?.deviceIdentifier) {
        return sendJson(res, 400, { error: 'MISSING_DEVICE_IDENTIFIER' });
      }
      const authResult = registerOrGetDevice(db, {
        deviceIdentifier: body.deviceIdentifier,
        model: body.model,
        osVersion: body.osVersion,
        appVersion: body.appVersion
      });
      return sendJson(res, 200, authResult);
    }

    // Kimlik Doğrulama Katmanı (Auth Bearer Token)
    const authHeader = req.headers.authorization;
    const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';
    const authSession = authenticateDeviceToken(db, rawToken);

    // Korumalı uçlar için oturum kontrolü
    if (pathname.startsWith('/v1/sync') || pathname.startsWith('/v1/device') || pathname.startsWith('/v1/user')) {
      if (!authSession) {
        return sendJson(res, 401, { error: 'UNAUTHORIZED_DEVICE' });
      }
    }

    // 3. APNs Push Jetonu Kaydı (POST /v1/device/push-token)
    if (method === 'POST' && pathname === '/v1/device/push-token') {
      const body = await readJsonBody<any>(req);
      if (!body?.apnsToken) {
        return sendJson(res, 400, { error: 'MISSING_APNS_TOKEN' });
      }
      registerApnsDeviceToken(db, authSession!.deviceId, body.apnsToken);
      return sendJson(res, 200, { success: true });
    }

    // 4. Aktivite Senkronizasyon Uç Noktası (POST /v1/sync/activities)
    if (method === 'POST' && pathname === '/v1/sync/activities') {
      const body = await readJsonBody<{ activities: Array<{ activity: NormalizedActivity; stream: StreamPoint[] }> }>(req);
      if (!body?.activities || !Array.isArray(body.activities)) {
        return sendJson(res, 400, { error: 'INVALID_ACTIVITIES_PAYLOAD' });
      }

      const receivedAtMs = Date.now();
      const results: any[] = [];

      // Kullanıcının mevcut tüm aktivitelerini çek (tekilleştirme kontrolü için)
      const existingActsStmt = db.prepare(`
        SELECT a.*, s.stream_json
        FROM activities a
        LEFT JOIN activity_streams s ON a.id = s.activity_id
        WHERE a.user_id = ?
      `);
      const existingRows = existingActsStmt.all(authSession!.userId) as any[];
      const existingList = existingRows.map(r => ({
        activity: {
          id: r.id,
          userId: r.user_id,
          sportType: r.sport_type,
          surfaceType: r.surface_type,
          title: r.title,
          startTime: r.start_time,
          elapsedTimeSec: r.elapsed_time_sec,
          movingTimeSec: r.moving_time_sec,
          distanceMeters: r.distance_meters,
          elevationGainMeters: r.elevation_gain_meters,
          hasHeartRate: Boolean(r.has_heart_rate),
          avgHr: r.avg_hr ?? undefined,
          maxHr: r.max_hr ?? undefined,
          avgCadence: r.avg_cadence ?? undefined,
          avgPaceSecPerKm: r.avg_pace_sec_per_km,
          gapSecPerKm: r.gap_sec_per_km,
          surfaceType: r.surface_type,
          sourceName: r.source_name,
          paceSource: r.pace_source,
          hasInstantaneousPace: Boolean(r.has_instantaneous_pace)
        } as NormalizedActivity,
        stream: r.stream_json ? JSON.parse(r.stream_json) : []
      }));

      for (const item of body.activities) {
        const act = item.activity;
        const stream = item.stream || [];

        // 4.1. Tekilleştirme Değerlendirmesi
        const dedupDecision = evaluateDeduplication({ activity: act, stream }, existingList);
        const isDuplicate = dedupDecision.action === 'MARK_DUPLICATE' ? 1 : 0;

        // 4.2. Hava Durumu Sorgusu (Koordinatlar sorgulanır, veritabanına YAZILMAZ ve HEMEN ATILIR)
        const weatherResult = await getHistoricalWeather(db, {
          latitude: act.startLatitude,
          longitude: act.startLongitude,
          isoStartTime: act.startTime
        });

        const weatherStatus = weatherResult.status;
        const tempC = weatherResult.status === 'AVAILABLE' ? weatherResult.snapshot.temperatureC : null;
        const appTempC = weatherResult.status === 'AVAILABLE' ? weatherResult.snapshot.apparentTemperatureC : null;
        const relHum = weatherResult.status === 'AVAILABLE' ? weatherResult.snapshot.relativeHumidity : null;
        const windKmh = weatherResult.status === 'AVAILABLE' ? weatherResult.snapshot.windSpeedKmh : null;
        const isExtreme = weatherResult.status === 'AVAILABLE' && weatherResult.snapshot.isExtremeHeat ? 1 : 0;

        // 4.3. Sunucu Tarafı Güvenli Kimlik Üretimi (Client ID çakışmalarını önler)
        const serverActivityId = `act_${randomUUID()}`;

        // 4.4. Veritabanına Yaz (Koordinat sütunları YOKTUR, gizlilik korunur)
        const insertActStmt = db.prepare(`
          INSERT INTO activities (
            id, user_id, client_activity_id, source_name, sport_type, surface_type,
            title, start_time, elapsed_time_sec, moving_time_sec, distance_meters,
            elevation_gain_meters, has_heart_rate, avg_hr, max_hr, avg_cadence,
            avg_pace_sec_per_km, gap_sec_per_km, pace_source, has_instantaneous_pace,
            weather_status, temperature_celsius, apparent_temperature_celsius,
            relative_humidity_pct, wind_speed_kmh, is_extreme_heat,
            is_duplicate, duplicate_of_id, created_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
          ON CONFLICT(user_id, source_name, start_time) DO UPDATE SET
            is_duplicate = excluded.is_duplicate,
            duplicate_of_id = excluded.duplicate_of_id
        `);

        insertActStmt.run(
          serverActivityId,
          authSession!.userId,
          act.id, // İstemciden gelen yerel ID referans olarak saklanır
          act.sourceName || 'iOS HealthKit',
          act.sportType,
          act.surfaceType,
          act.title || 'Koşu',
          act.startTime,
          act.elapsedTimeSec,
          act.movingTimeSec,
          act.distanceMeters,
          act.elevationGainMeters,
          act.hasHeartRate ? 1 : 0,
          act.avgHr ?? null,
          act.maxHr ?? null,
          act.avgCadence ?? null,
          act.avgPaceSecPerKm ?? null,
          act.gapSecPerKm ?? null,
          act.paceSource || 'ACTIVITY_AVERAGE',
          act.hasInstantaneousPace ? 1 : 0,
          weatherStatus,
          tempC,
          appTempC,
          relHum,
          windKmh,
          isExtreme,
          isDuplicate,
          dedupDecision.duplicateOfId || null,
          new Date().toISOString()
        );

        // Eğer gelen daha zengin olduğu için mevcut eski kayıt mükerrere düşürüldüyse güncelle
        if (dedupDecision.supersededExistingId) {
          db.prepare('UPDATE activities SET is_duplicate = 1, duplicate_of_id = ? WHERE id = ?')
            .run(serverActivityId, dedupDecision.supersededExistingId);
          db.prepare('DELETE FROM sync_jobs WHERE activity_id = ?').run(dedupDecision.supersededExistingId);
          db.prepare('DELETE FROM assessments WHERE activity_id = ?').run(dedupDecision.supersededExistingId);
        }

        // Akış noktalarını kaydet
        const insertStreamStmt = db.prepare(`
          INSERT INTO activity_streams (activity_id, stream_json, point_count, created_at)
          VALUES (?, ?, ?, ?)
        `);
        insertStreamStmt.run(serverActivityId, JSON.stringify(stream), stream.length, new Date().toISOString());

        // 4.5. Mükerrer Değilse Değerlendirme Kuyruğuna Al
        let jobId: string | undefined;
        if (!isDuplicate) {
          jobId = enqueueActivityForEvaluation(db, authSession!.userId, serverActivityId, receivedAtMs);
        }

        results.push({
          activityId: serverActivityId,
          clientActivityId: act.id,
          weatherStatus,
          deduplication: dedupDecision,
          queuedJobId: jobId
        });
      }

      return sendJson(res, 200, { success: true, count: results.length, items: results });
    }

    // 5. Değerlendirme Sorgulama (GET /v1/activities/:id/assessment)
    if (method === 'GET' && pathname.startsWith('/v1/activities/') && pathname.endsWith('/assessment')) {
      const parts = pathname.split('/');
      const actId = parts[3];
      const row = db.prepare('SELECT * FROM assessments WHERE activity_id = ?').get(actId) as any;
      if (!row) return sendJson(res, 404, { error: 'ASSESSMENT_NOT_FOUND' });
      return sendJson(res, 200, {
        id: row.id,
        activityId: row.activity_id,
        userThresholdId: row.user_threshold_id,
        verdict: row.verdict,
        weatherStatus: row.weather_status,
        heatAcquittalApplied: Boolean(row.heat_acquittal_applied),
        sentence: row.sentence,
        reasons: JSON.parse(row.reasons_json || '[]'),
        metrics: JSON.parse(row.metrics_snapshot_json || '{}'),
        createdAt: row.created_at
      });
    }

    // 6. Kullanıcı Aktif Eşikleri (GET /v1/user/thresholds)
    if (method === 'GET' && pathname === '/v1/user/thresholds') {
      const row = db.prepare(`
        SELECT * FROM user_thresholds 
        WHERE user_id = ? AND is_active = 1 
        ORDER BY valid_from DESC LIMIT 1
      `).get(authSession!.userId) as any;
      if (!row) return sendJson(res, 404, { error: 'NO_ACTIVE_THRESHOLD' });
      return sendJson(res, 200, row);
    }

    // 7. Konuşma Testi Çıpası Kaydetme (POST /v1/user/talk-test-anchor)
    if (method === 'POST' && pathname === '/v1/user/talk-test-anchor') {
      const body = await readJsonBody<any>(req);
      if (!body?.anchorHeartRate) {
        return sendJson(res, 400, { error: 'MISSING_ANCHOR_HEART_RATE' });
      }
      const aet = Number(body.anchorHeartRate);
      const ant = Math.round(aet / 0.88);
      const nowIso = new Date().toISOString();

      // Eski aktif eşiği pasife çek
      db.prepare('UPDATE user_thresholds SET is_active = 0, valid_to = ? WHERE user_id = ? AND is_active = 1')
        .run(nowIso, authSession!.userId);

      const threshId = `thresh_${randomUUID()}`;
      db.prepare(`
        INSERT INTO user_thresholds (
          id, user_id, aet_hr, ant_hr, valid_from, source, confidence_level, is_active, created_at
        ) VALUES (?, ?, ?, ?, ?, 'TALK_TEST_ANCHOR', 'HIGH', 1, ?)
      `).run(threshId, authSession!.userId, aet, ant, nowIso, nowIso);

      return sendJson(res, 200, { success: true, thresholdId: threshId, aetHr: aet, antHr: ant });
    }

    // 8. Ayna Ekranı (GET /v1/user/mirror)
    // Şart: Son 60 günde en az 16 koşu ve 100 km
    if (method === 'GET' && pathname === '/v1/user/mirror') {
      const sixtyDaysAgoIso = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const recentActs = db.prepare(`
        SELECT id, start_time, distance_meters, elapsed_time_sec, avg_hr, gap_sec_per_km
        FROM activities
        WHERE user_id = ? AND start_time >= ? AND is_duplicate = 0
        ORDER BY start_time ASC
      `).all(authSession!.userId, sixtyDaysAgoIso) as any[];

      const totalRuns = recentActs.length;
      const totalDistKm = Math.round((recentActs.reduce((sum, a) => sum + a.distance_meters, 0) / 1000) * 10) / 10;

      if (totalRuns < 16 || totalDistKm < 100) {
        return sendJson(res, 200, {
          eligible: false,
          currentRuns: totalRuns,
          requiredRuns: 16,
          currentDistanceKm: totalDistKm,
          requiredDistanceKm: 100,
          message: 'Ayna ekranı için son 60 günde en az 16 koşu ve 100 km gereklidir.'
        });
      }

      // Değerlendirmelerden gri bölge ve kolay oranlarını topla
      const asmtRows = db.prepare(`
        SELECT verdict, COUNT(*) as cnt
        FROM assessments
        WHERE activity_id IN (
          SELECT id FROM activities WHERE user_id = ? AND start_time >= ?
        )
        GROUP BY verdict
      `).all(authSession!.userId, sixtyDaysAgoIso) as Array<{ verdict: string; cnt: number }>;

      const verdictMap = new Map(asmtRows.map(r => [r.verdict, r.cnt]));
      const planCount = verdictMap.get('ACCORDING_TO_PLAN') || 0;
      const driftCount = (verdictMap.get('DRIFTED_GRAY') || 0) + (verdictMap.get('DRIFTED_THRESHOLD') || 0);

      return sendJson(res, 200, {
        eligible: true,
        totalRuns,
        totalDistanceKm: totalDistKm,
        planComplianceRatioPct: Math.round((planCount / Math.max(1, totalRuns)) * 100),
        driftRatioPct: Math.round((driftCount / Math.max(1, totalRuns)) * 100),
        mirrorQuestion: `Son 60 günde ${totalRuns} koşunun %${Math.round((driftCount / Math.max(1, totalRuns)) * 100)}'ü eşik üzerinde tamamlandı. Bu dağılım planlı bir antrenman tercihi mi?`,
        options: [
          { key: 'INTENTIONAL', label: 'Planlı antrenman (Maraton / tempo odağı)' },
          { key: 'UNINTENTIONAL', label: 'Farkında olmadan hızlandım' }
        ]
      });
    }

    // 9. Geçmiş Hava Durumu Uç Noktası (GET /v1/weather/historical)
    if (method === 'GET' && pathname === '/v1/weather/historical') {
      const lat = url.searchParams.get('lat') ? parseFloat(url.searchParams.get('lat')!) : undefined;
      const lon = url.searchParams.get('lon') ? parseFloat(url.searchParams.get('lon')!) : undefined;
      const startTimeIso = url.searchParams.get('time');

      if (!startTimeIso) {
        return sendJson(res, 400, { error: 'MISSING_TIME_PARAM' });
      }

      const weather = await getHistoricalWeather(db, {
        latitude: lat,
        longitude: lon,
        isoStartTime: startTimeIso
      });

      return sendJson(res, 200, { weather });
    }

    // 10. KVKK / GDPR Kullanıcı Verilerini Silme Ucu (DELETE /v1/user/data)
    if (method === 'DELETE' && pathname === '/v1/user/data') {
      const deletionResult = deleteUserDataCompletely(db, authSession!.userId);
      return sendJson(res, 200, deletionResult);
    }

    // 11. Kuyruk Tetikleme (POST /v1/queue/process-next)
    if (method === 'POST' && pathname === '/v1/queue/process-next') {
      const job = await processNextEvaluationJob(db);
      return sendJson(res, 200, { job: job ?? null });
    }

    // 404 Bulunamadı
    return sendJson(res, 404, { error: 'NOT_FOUND' });
  });

  return {
    server,
    db,
    listen: (port: number = BACKEND_CONFIG.PORT) => {
      return new Promise<void>((resolve) => {
        server.listen(port, () => resolve());
      });
    },
    close: () => {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  };
}

// Doğrudan çalıştırma kontrolü
if (process.argv[1]?.endsWith('server.ts')) {
  const app = createBackendServer();
  app.listen(BACKEND_CONFIG.PORT).then(() => {
    console.log(`Koşu Şiddeti Asistanı Backend Port ${BACKEND_CONFIG.PORT} üzerinde dinliyor...`);
  });
}
