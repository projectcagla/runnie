import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { sendActivityPushNotification } from './pushService.ts';
import { evaluateActivity } from '../../../src/engine.ts';
import { deriveThresholds } from '../../../src/thresholds.ts';
import type { 
  NormalizedActivity, 
  StreamPoint, 
  UserThresholds, 
  WeatherSnapshot 
} from '../../../src/types.ts';

export interface SyncJobRecord {
  id: string;
  activity_id: string;
  user_id: string;
  status: 'PENDING' | 'EVALUATING' | 'COMPLETED' | 'FAILED';
  sync_received_at: string;
  completed_at?: string;
  delivery_latency_ms?: number;
}

/**
 * Yeni Senkronize Edilen Aktiviteyi Değerlendirme İş Kuyruğuna Ekler
 */
export function enqueueActivityForEvaluation(
  db: DatabaseSync,
  userId: string,
  activityId: string,
  receivedAtMs = Date.now()
): string {
  const jobId = `job_${randomUUID()}`;
  const receivedAtIso = new Date(receivedAtMs).toISOString();

  const stmt = db.prepare(`
    INSERT INTO sync_jobs (id, activity_id, user_id, status, sync_received_at)
    VALUES (?, ?, ?, 'PENDING', ?)
  `);
  stmt.run(jobId, activityId, userId, receivedAtIso);

  return jobId;
}

/**
 * İş Kuyruğu İşleyicisi:
 * Senkronize edilen koşu için sürümlenmiş eşiği çözer, hava durumunu bağlar,
 * 4 bölgeli deterministik değerlendirme motorunu çalıştırır, değişmez assessments
 * tablosuna kaydeder ve 3 dakika SLA hedefli push bildirimini tetikler.
 */
export async function processNextEvaluationJob(db: DatabaseSync): Promise<SyncJobRecord | null> {
  const selectStmt = db.prepare(`
    SELECT id, activity_id, user_id, status, sync_received_at
    FROM sync_jobs
    WHERE status = 'PENDING'
    ORDER BY sync_received_at ASC
    LIMIT 1
  `);
  const job = selectStmt.get() as SyncJobRecord | undefined;
  if (!job) return null;

  const startMs = Date.now();
  const receivedMs = new Date(job.sync_received_at).getTime();

  db.prepare("UPDATE sync_jobs SET status = 'EVALUATING' WHERE id = ?").run(job.id);

  try {
    // 1. Aktiviteyi ve Akış Serisini Veritabanından Çek
    const actStmt = db.prepare('SELECT * FROM activities WHERE id = ?');
    const act = actStmt.get(job.activity_id) as any;
    if (!act) {
      throw new Error(`Aktivite bulunamadı: ${job.activity_id}`);
    }

    const streamStmt = db.prepare('SELECT stream_json FROM activity_streams WHERE activity_id = ?');
    const streamRow = streamStmt.get(job.activity_id) as { stream_json: string } | undefined;
    const stream: StreamPoint[] = streamRow?.stream_json ? JSON.parse(streamRow.stream_json) : [];

    const actObj: NormalizedActivity = {
      id: act.id,
      userId: act.user_id,
      sportType: act.sport_type,
      surfaceType: act.surface_type,
      title: act.title,
      startTime: act.start_time,
      elapsedTimeSec: act.elapsed_time_sec,
      movingTimeSec: act.moving_time_sec,
      distanceMeters: act.distance_meters,
      elevationGainMeters: act.elevation_gain_meters,
      hasHeartRate: Boolean(act.has_heart_rate),
      avgHr: act.avg_hr ?? undefined,
      maxHr: act.max_hr ?? undefined,
      avgCadence: act.avg_cadence ?? undefined,
      avgPaceSecPerKm: act.avg_pace_sec_per_km,
      gapSecPerKm: act.gap_sec_per_km,
      sourceName: act.source_name,
      paceSource: act.pace_source,
      hasInstantaneousPace: Boolean(act.has_instantaneous_pace)
    };

    // 2. Kullanıcının Aktif Eşik Kaydını Çözümle
    const thresholdRow = db.prepare(`
      SELECT * FROM user_thresholds 
      WHERE user_id = ? AND is_active = 1 
      ORDER BY valid_from DESC LIMIT 1
    `).get(job.user_id) as any;

    let thresholds: UserThresholds;
    let thresholdRecordId: string;

    if (thresholdRow) {
      thresholdRecordId = thresholdRow.id;
      thresholds = {
        id: thresholdRow.id,
        userId: thresholdRow.user_id,
        validFrom: thresholdRow.valid_from,
        validTo: thresholdRow.valid_to ?? undefined,
        hrMaxEstimated: 185,
        lthr: thresholdRow.ant_hr,
        aerobicThresholdHrPoint: thresholdRow.aet_hr,
        aerobicThresholdHrMargin: 4,
        aerobicThresholdHrMin: thresholdRow.aet_hr - 4,
        aerobicThresholdHrMax: thresholdRow.aet_hr + 4,
        thresholdPaceGapSecPerKm: 300,
        easyPaceCeilingGapSecPerKm: 360,
        derivationMethod: thresholdRow.source as any,
        confidenceScore: thresholdRow.confidence_level === 'HIGH' ? 0.85 : (thresholdRow.confidence_level === 'MEDIUM' ? 0.65 : 0.40),
        calibrationStatus: thresholdRow.confidence_level === 'HIGH' ? 'CALIBRATED' : 'CALIBRATING'
      };
    } else {
      // Aktif eşik yoksa geçmiş aktiviteler ve metriklerden türet
      const pastRows = db.prepare('SELECT * FROM activities WHERE user_id = ?').all(job.user_id) as any[];
      const pastActs: NormalizedActivity[] = pastRows.map(r => ({
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
        sourceName: r.source_name,
        paceSource: r.pace_source,
        hasInstantaneousPace: Boolean(r.has_instantaneous_pace)
      }));

      const vo2Metric = db.prepare(`
        SELECT value FROM user_metrics 
        WHERE user_id = ? AND metric_type = 'VO2MAX' 
        ORDER BY date DESC LIMIT 1
      `).get(job.user_id) as { value: number } | undefined;

      const rhrMetric = db.prepare(`
        SELECT value FROM user_metrics 
        WHERE user_id = ? AND metric_type = 'RESTING_HR' 
        ORDER BY date DESC LIMIT 1
      `).get(job.user_id) as { value: number } | undefined;

      thresholds = deriveThresholds({
        userId: job.user_id,
        activities: pastActs,
        appleMetrics: {
          vo2MaxMlPerKgMin: vo2Metric?.value,
          restingHeartRate: rhrMetric?.value
        }
      });

      thresholdRecordId = `thresh_${randomUUID()}`;
      thresholds.id = thresholdRecordId;
      const confLevel = thresholds.confidenceScore >= 0.8 ? 'HIGH' : (thresholds.confidenceScore >= 0.6 ? 'MEDIUM' : 'LOW');

      db.prepare(`
        INSERT INTO user_thresholds (
          id, user_id, aet_hr, ant_hr, valid_from, source, confidence_level, is_active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        thresholdRecordId,
        job.user_id,
        thresholds.aerobicThresholdHrPoint,
        thresholds.lthr,
        new Date().toISOString(),
        thresholds.derivationMethod,
        confLevel,
        new Date().toISOString()
      );
    }

    // 3. Hava Durumu Modeli (Ölçülmemişse uydurma yok, undefined)
    let weather: WeatherSnapshot | undefined = undefined;
    if (act.weather_status === 'AVAILABLE' && act.temperature_celsius !== null && act.relative_humidity_pct !== null) {
      weather = {
        temperatureC: act.temperature_celsius,
        apparentTemperatureC: act.apparent_temperature_celsius ?? act.temperature_celsius,
        relativeHumidity: act.relative_humidity_pct,
        windSpeedKmh: act.wind_speed_kmh ?? 0,
        isExtremeHeat: Boolean(act.is_extreme_heat)
      };
    }

    // 4. Deterministik Karar Motorunu Çalıştır
    const assessment = evaluateActivity({
      activity: actObj,
      stream,
      thresholds,
      weather
    });

    const assessmentId = `asmt_${randomUUID()}`;
    const heatPardoned = assessment.judgment === 'WEATHER_PARDON' ? 1 : 0;

    // 5. Değişmez Değerlendirme Arşivine Yaz
    const insertAsmtStmt = db.prepare(`
      INSERT INTO assessments (
        id, activity_id, user_threshold_id, verdict, weather_status,
        heat_acquittal_applied, sentence, reasons_json, metrics_snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertAsmtStmt.run(
      assessmentId,
      job.activity_id,
      thresholdRecordId,
      assessment.judgment,
      act.weather_status,
      heatPardoned,
      assessment.outputSentence,
      JSON.stringify(assessment.flags),
      JSON.stringify({
        intent: assessment.intent,
        confidenceLevel: assessment.confidenceLevel,
        easyPct: assessment.zoneDistribution.zoneEasyPct,
        moderatePct: assessment.zoneDistribution.zoneModeratePct,
        thresholdPct: assessment.zoneDistribution.zoneThresholdPct,
        secondaryCostSentence: assessment.secondaryCostSentence
      }),
      new Date().toISOString()
    );

    // 6. Push Bildirimini Tetikle ve 3 Dakika SLA Süresini Hesapla
    const notificationTitle = assessment.judgment === 'ACCORDING_TO_PLAN'
      ? 'Koşu Şiddeti: Plana Uygun'
      : (assessment.judgment === 'WEATHER_PARDON' ? 'Koşu Şiddeti: Isı Beraati' : 'Koşu Şiddeti Değerlendirmesi');

    await sendActivityPushNotification(db, job.user_id, {
      title: notificationTitle,
      body: assessment.outputSentence,
      activityId: job.activity_id,
      syncReceivedAtMs: receivedMs
    });

    const completedAtMs = Date.now();
    const latencyMs = completedAtMs - receivedMs;

    db.prepare(`
      UPDATE sync_jobs 
      SET status = 'COMPLETED', completed_at = ?, delivery_latency_ms = ?
      WHERE id = ?
    `).run(new Date(completedAtMs).toISOString(), latencyMs, job.id);

    return {
      ...job,
      status: 'COMPLETED',
      completed_at: new Date(completedAtMs).toISOString(),
      delivery_latency_ms: latencyMs
    };
  } catch (err) {
    db.prepare("UPDATE sync_jobs SET status = 'FAILED' WHERE id = ?").run(job.id);
    return {
      ...job,
      status: 'FAILED'
    };
  }
}
