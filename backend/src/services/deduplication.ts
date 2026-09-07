import type { NormalizedActivity, StreamPoint } from '../../../src/types.ts';

export interface ActivityPayload {
  activity: NormalizedActivity;
  stream: StreamPoint[];
}

export interface DeduplicationDecision {
  action: 'KEEP' | 'MARK_DUPLICATE';
  reason: string;
  duplicateOfId?: string;
  supersededExistingId?: string;
}

const HARDWARE_SOURCES = new Set([
  'apple watch',
  'apple health',
  'garmin',
  'garmin connect',
  'connect',
  'coros',
  'polar',
  'suunto',
  'wahoo'
]);

/**
 * Aktivitenin Veri Zenginlik Puanını Hesaplar (0 - 100)
 * 1. Anlık Hız / GAP Kalitesi (en fazla 40 puan)
 * 2. Mesafe Varlığı (30 puan)
 * 3. Rota / GPS Koordinatı (15 puan)
 * 4. Kadans Varlığı (10 puan)
 * 5. Nabız Serisi Varlığı (10 puan)
 */
export function calculateRichnessScore(payload: ActivityPayload): number {
  let score = 0;
  const act = payload.activity;
  const stream = payload.stream;

  // 1. Anlık Hız / GAP Kalitesi (35-40 puan)
  if (act.paceSource === 'RUNNING_SPEED') {
    score += 35;
  } else if (act.paceSource === 'GPX_TRACKPOINT') {
    score += 30;
  } else if (act.paceSource === 'DISTANCE_INTERVAL') {
    score += 20;
  }
  if (act.hasInstantaneousPace) {
    score += 5;
  }

  // 2. Mesafe Varlığı (30 puan)
  if (act.distanceMeters && act.distanceMeters > 100) {
    score += 30;
  }

  // 3. Rota / GPS Koordinatları (15 puan)
  if ((act.startLatitude !== undefined && act.startLongitude !== undefined) || act.routeFilePath) {
    score += 15;
  }

  // 4. Kadans Varlığı (10 puan)
  if ((act.avgCadence !== undefined && act.avgCadence > 0) || stream.some(p => p.cad !== undefined && p.cad > 0)) {
    score += 10;
  }

  // 5. Nabız Serisi Varlığı (10 puan)
  if (act.hasHeartRate && stream.some(p => p.hr !== undefined && p.hr > 0)) {
    score += 10;
  }

  return Math.min(100, score);
}

/**
 * Kaynak İsminin Donanım / Saat Kaynağı Olup Olmadığını Kontrol Eder (Cihaz Bağımsız)
 */
export function isHardwareSource(sourceName: string): boolean {
  const clean = sourceName.trim().toLowerCase();
  return HARDWARE_SOURCES.has(clean) || clean.includes('watch') || clean.includes('garmin');
}

/**
 * Koşu Akıl Sağlığı Filtresi (Sanity Filter)
 * Sıfır mesafe ve düşük adım/kadans veya istirahat nabzı profiline sahip aktiviteleri yakalar.
 */
export function isSuspiciousNonRun(payload: ActivityPayload): boolean {
  const act = payload.activity;
  const stream = payload.stream;
  const dist = act.distanceMeters || 0;
  const durationSec = act.movingTimeSec || act.elapsedTimeSec || 0;

  if (dist <= 50 && durationSec >= 300) {
    const hasLowCadence = act.avgCadence !== undefined && act.avgCadence < 60;
    const hasNoRunningCadenceInStream = stream.length > 0 && !stream.some(p => p.cad !== undefined && p.cad >= 60);
    const isRestingHr = act.avgHr !== undefined && act.avgHr < 95;
    const isVeryLongZeroDist = durationSec >= 3600;

    // Süre, adım/kadans ve nabız profilini birlikte değerlendir:
    if ((hasLowCadence || hasNoRunningCadenceInStream) && isRestingHr) {
      return true;
    }

    if ((hasLowCadence || hasNoRunningCadenceInStream) && isVeryLongZeroDist) {
      return true;
    }

    if (act.avgCadence === undefined && isRestingHr) {
      return true;
    }
  }

  return false;
}

/**
 * İki Aktivitenin Aynı Koşuya Ait Mükerrer Çift Olup Olmadığını Kontrol Eder
 */
export function areWorkoutsDuplicateCandidates(
  act1: NormalizedActivity,
  act2: NormalizedActivity
): boolean {
  const start1 = new Date(act1.startTime).getTime();
  const start2 = new Date(act2.startTime).getTime();
  const timeDiffSec = Math.abs(start1 - start2) / 1000;

  const dur1Sec = Math.max(1, act1.elapsedTimeSec || act1.movingTimeSec || 1);
  const dur2Sec = Math.max(1, act2.elapsedTimeSec || act2.movingTimeSec || 1);
  const end1 = start1 + dur1Sec * 1000;
  const end2 = start2 + dur2Sec * 1000;

  const overlapMs = Math.max(0, Math.min(end1, end2) - Math.max(start1, start2));
  const minDurMs = Math.min(dur1Sec, dur2Sec) * 1000;

  const d1 = act1.distanceMeters || 0;
  const d2 = act2.distanceMeters || 0;

  // 2.1. Mesafe karşılaştırması yalnızca iki tarafta da mesafe varsa (> 50m) uygulanır.
  if (d1 > 50 && d2 > 50) {
    const distDiff = Math.abs(d1 - d2);
    const maxDist = Math.max(d1, d2);
    const distDiffRatio = distDiff / maxDist;

    // Her iki tarafta mesafe varken: mesafe farkı <= %10 VE (başlangıç farkı <= 1800s veya zaman örtüşmesi)
    if (distDiffRatio <= 0.10 && (timeDiffSec <= 1800 || overlapMs > 0)) {
      return true;
    }
    return false;
  }

  // 2.1. Bir tarafta mesafe yoksa eşleştirme zaman örtüşmesiyle yapılır:
  // Başlangıçlar yakın ve süreler birbirini kapsıyor veya geniş oranda örtüşüyorsa aynı koşudur.
  // Cihazlar duraklamaları farklı işlediğinden süre karşılaştırmasında geniş tolerans kullanılır.
  if (timeDiffSec <= 1800 && overlapMs > 0) {
    const overlapRatio = overlapMs / minDurMs;
    if (overlapRatio >= 0.40 || overlapMs >= 300_000) {
      return true;
    }
  }

  return false;
}

/**
 * Gelen Yeni Aktivite ile Veritabanındaki Mevcut Aktiviteler Arasında Tekilleştirme Kararı Verir.
 */
export function evaluateDeduplication(
  incoming: ActivityPayload,
  existingActivities: Array<{ activity: NormalizedActivity; stream: StreamPoint[] }>
): DeduplicationDecision {
  // 1. Önce Çift Adayı Arama (Eşzamanlı iki cihazla koşulmuşsa kazanan belirlensin)
  const duplicateCandidate = existingActivities.find(ex =>
    areWorkoutsDuplicateCandidates(incoming.activity, ex.activity)
  );

  // Çift bulundu: Veri Zenginlik Skoru Karşılaştırması
  if (duplicateCandidate) {
    const incomingScore = calculateRichnessScore(incoming);
    const existingScore = calculateRichnessScore(duplicateCandidate);

    if (incomingScore > existingScore) {
      return {
        action: 'KEEP',
        supersededExistingId: duplicateCandidate.activity.id,
        reason: `Gelen kopya daha zengin veri içeriyor (${incomingScore} vs ${existingScore} puan).`
      };
    } else if (existingScore > incomingScore) {
      return {
        action: 'MARK_DUPLICATE',
        duplicateOfId: duplicateCandidate.activity.id,
        reason: `Mevcut kopya daha zengin (${existingScore} vs ${incomingScore} puan); gelen kopya mükerrer olarak işaretlendi.`
      };
    }

    // Skorlar Eşitse: Donanım Önceliği (Cihaz Bağımsız)
    const incomingIsHw = isHardwareSource(incoming.activity.sourceName || '');
    const existingIsHw = isHardwareSource(duplicateCandidate.activity.sourceName || '');

    if (incomingIsHw && !existingIsHw) {
      return {
        action: 'KEEP',
        supersededExistingId: duplicateCandidate.activity.id,
        reason: `Puanlar eşit; gelen kopya donanım/saat kaydı (${incoming.activity.sourceName}).`
      };
    } else if (!incomingIsHw && existingIsHw) {
      return {
        action: 'MARK_DUPLICATE',
        duplicateOfId: duplicateCandidate.activity.id,
        reason: `Puanlar eşit; mevcut kopya donanım/saat kaydı (${duplicateCandidate.activity.sourceName}).`
      };
    }

    return {
      action: 'MARK_DUPLICATE',
      duplicateOfId: duplicateCandidate.activity.id,
      reason: 'Veri zenginliği ve kaynak tipi eşit; ilk gelen kayıt korundu.'
    };
  }

  // 2. Çift Bulunmadıysa: Akıl Sağlığı Filtresi (Sanity Filter) Kontrolü
  if (isSuspiciousNonRun(incoming)) {
    return {
      action: 'MARK_DUPLICATE',
      duplicateOfId: 'SUSPICIOUS_NON_RUN',
      reason: 'Şüpheli koşu dışı aktivite; sıfır mesafe, düşük adım/kadans veya dinlenik nabız profili.'
    };
  }

  // 3. Tekil Geçerli Koşu Olarak SAKLA
  return {
    action: 'KEEP',
    reason: 'Tekil aktivite; çakışan çift bulunamadı.'
  };
}
