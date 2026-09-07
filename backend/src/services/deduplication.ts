import type { NormalizedActivity, StreamPoint } from '../../../src/types.ts';

export interface ActivityPayload {
  activity: NormalizedActivity;
  stream: StreamPoint[];
}

export interface DeduplicationDecision {
  action: 'KEEP' | 'MARK_DUPLICATE';
  reason: string;
  duplicateOfId?: string;
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
 */
export function calculateRichnessScore(payload: ActivityPayload): number {
  let score = 0;
  const act = payload.activity;
  const stream = payload.stream;

  // 1. Nabız Serisi Varlığı (+40 puan)
  if (act.hasHeartRate && stream.some(p => p.hr !== undefined)) {
    score += 40;
  }

  // 2. Anlık Hız / GAP Kalitesi (+30 puan)
  if (act.paceSource === 'RUNNING_SPEED') {
    score += 30; // En temiz doğrudan sensör
  } else if (act.paceSource === 'GPX_TRACKPOINT') {
    score += 28; // Eğimli Minetti GAP
  } else if (act.paceSource === 'DISTANCE_INTERVAL') {
    score += 20; // Mesafe dilimi
  }

  // 3. Kadans Varlığı (+15 puan)
  if (act.avgCadence && stream.some(p => p.cad !== undefined)) {
    score += 15;
  }

  // 4. GPS Koordinatları (+15 puan)
  if (act.startLatitude !== undefined && act.startLongitude !== undefined) {
    score += 15;
  }

  return score;
}

/**
 * Kaynak İsminin Donanım / Saat Kaynağı Olup Olmadığını Kontrol Eder
 */
export function isHardwareSource(sourceName: string): boolean {
  const clean = sourceName.trim().toLowerCase();
  return HARDWARE_SOURCES.has(clean) || clean.includes('watch') || clean.includes('garmin');
}

/**
 * Gelen Yeni Aktivite ile Veritabanındaki Mevcut Aktiviteler Arasında Tekilleştirme Kararı Verir.
 * Kural 1: Çifti olmayan tekil kayıt ASLA silinmez.
 * Kural 2: Çift tespit edildiğinde veri zenginliği yüksek olan tutulur.
 * Kural 3: Zenginlik eşitse, donanım kaydı üçüncü taraf köprü uygulamaya tercih edilir.
 */
export function evaluateDeduplication(
  incoming: ActivityPayload,
  existingActivities: Array<{ activity: NormalizedActivity; stream: StreamPoint[] }>
): DeduplicationDecision {
  const incStartMs = new Date(incoming.activity.startTime).getTime();
  const incDist = incoming.activity.distanceMeters;

  // Çakışan çift ara: Başlangıç farkı <= 120s ve mesafe farkı <= %5
  const duplicateCandidate = existingActivities.find(ex => {
    const exStartMs = new Date(ex.activity.startTime).getTime();
    const timeDiffSec = Math.abs(incStartMs - exStartMs) / 1000;
    if (timeDiffSec > 120) return false;

    const distDiff = Math.abs(incDist - ex.activity.distanceMeters);
    const maxDist = Math.max(1, incDist, ex.activity.distanceMeters);
    return (distDiff / maxDist) <= 0.05;
  });

  // Çift yoksa: Kural 1 gereği doğrudan SAKLA
  if (!duplicateCandidate) {
    return {
      action: 'KEEP',
      reason: 'Tekil aktivite; çakışan çift bulunamadı.'
    };
  }

  // Çift bulundu: Zenginlik ve Donanım Karşılaştırması
  const incomingScore = calculateRichnessScore(incoming);
  const existingScore = calculateRichnessScore(duplicateCandidate);

  // Kural 2: Zenginlik farkı
  if (incomingScore > existingScore) {
    return {
      action: 'KEEP',
      reason: `Gelen kopya daha zengin veri içeriyor (${incomingScore} vs ${existingScore} puan).`
    };
  } else if (existingScore > incomingScore) {
    return {
      action: 'MARK_DUPLICATE',
      duplicateOfId: duplicateCandidate.activity.id,
      reason: `Mevcut kopya daha zengin (${existingScore} vs ${incomingScore} puan); gelen kopya mükerrer olarak işaretlendi.`
    };
  }

  // Kural 3: Zenginlik eşitse donanım önceliği
  const incomingIsHw = isHardwareSource(incoming.activity.sourceName || '');
  const existingIsHw = isHardwareSource(duplicateCandidate.activity.sourceName || '');

  if (incomingIsHw && !existingIsHw) {
    return {
      action: 'KEEP',
      reason: `Puanlar eşit; gelen kopya donanım/saat kaydı (${incoming.activity.sourceName}).`
    };
  } else if (!incomingIsHw && existingIsHw) {
    return {
      action: 'MARK_DUPLICATE',
      duplicateOfId: duplicateCandidate.activity.id,
      reason: `Puanlar eşit; mevcut kopya donanım/saat kaydı (${duplicateCandidate.activity.sourceName}).`
    };
  }

  // Her şey eşitse mevcut kayıt korunur
  return {
    action: 'MARK_DUPLICATE',
    duplicateOfId: duplicateCandidate.activity.id,
    reason: 'Veri zenginliği ve kaynak tipi eşit; ilk gelen kayıt korundu.'
  };
}
