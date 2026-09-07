import type { 
  NormalizedActivity, 
  StreamPoint, 
  AppleHealthMetrics, 
  UserThresholds, 
  DerivationMethod 
} from './types.ts';
import { CONFIG } from './config.ts';

export interface ThresholdDerivationInput {
  userId: string;
  activities: NormalizedActivity[];
  streams?: Map<string, StreamPoint[]>;
  appleMetrics?: AppleHealthMetrics;
  talkTestConfirmedAeT?: number;
}

/**
 * Daniels VDOT formülü ile VO2max'tan teorik tempo aralıkları türetir.
 */
function derivePacesFromVO2max(vo2Max: number): { thresholdPaceGap: number; easyPaceCeilingGap: number } {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.60 - vo2Max;
  const vMetersPerMin = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  const vVO2maxPaceSecPerKm = (1000 / vMetersPerMin) * 60;
  
  const thresholdPaceGap = Math.round(vVO2maxPaceSecPerKm / 0.88);
  // Kolay tempo tavanı (en hızlı kolay): vVO2max'ın %68'i (Daniels E-Pace formülü)
  const easyPaceCeilingGap = Math.round(vVO2maxPaceSecPerKm / 0.68);

  return { thresholdPaceGap, easyPaceCeilingGap };
}

/**
 * BÖLÜM 4 ÇÖZÜMÜ: Ampirik Hız -> Nabız Eşlemesi.
 * Sabit bpm tavanı olmadan, tamamen fizyolojik stabilite ve bireysel
 * tepe nabız oranıyla doğrulanır.
 */
function deriveEmpiricalAeT(
  activities: NormalizedActivity[],
  streams: Map<string, StreamPoint[]>,
  targetEasyPaceSec: number,
  observedPeakHr: number
): { empiricalAeT: number; sampleCount: number; isDecouplingVerified: boolean } | null {
  const lowDecouplingHeartRates: number[] = [];
  const paceMatchingHeartRates: number[] = [];
  const paceToleranceSec = 25; // Hedef temponun +-25 sn/km civarı koridor

  for (const act of activities) {
    if (act.movingTimeSec < CONFIG.MIN_ACTIVITY_DURATION_SEC) continue;
    if (act.surfaceType === 'TRAIL') continue;

    const stream = streams.get(act.id);
    if (!stream || stream.length === 0) continue;

    // 1. Aerobik Ayrışma (Decoupling) Analizi (Isınma sonrası dk 8 ile bitiş arası)
    const steadyPoints = stream.filter(p => p.t >= 480 && p.t <= 3600 && p.hr && p.gap);
    if (steadyPoints.length >= 30) {
      const half = Math.floor(steadyPoints.length / 2);
      const firstHalf = steadyPoints.slice(0, half);
      const secondHalf = steadyPoints.slice(half);

      const avgHr1 = firstHalf.reduce((s, p) => s + (p.hr || 0), 0) / firstHalf.length;
      const avgGap1 = firstHalf.reduce((s, p) => s + (p.gap || 0), 0) / firstHalf.length;
      const avgHr2 = secondHalf.reduce((s, p) => s + (p.hr || 0), 0) / secondHalf.length;
      const avgGap2 = secondHalf.reduce((s, p) => s + (p.gap || 0), 0) / secondHalf.length;

      // Hız nispeten stabilse (|avgGap2 - avgGap1| <= 20 s/km)
      if (Math.abs(avgGap2 - avgGap1) <= 20 && avgGap1 > 0 && avgGap2 > 0) {
        // Pw:Hr Decoupling hesapla: (HR2 * GAP1) / (HR1 * GAP2) - 1
        const decoupling = ((avgHr2 * avgGap1) / (avgHr1 * avgGap2) - 1) * 100;
        // Ayrışma minimal ise (<= %3.5), bu seans gerçek bir aerobik kararlı durumdur
        if (decoupling <= 3.5 && decoupling >= -3.0) {
          lowDecouplingHeartRates.push(Math.round((avgHr1 + avgHr2) / 2));
        }
      }
    }

    // 2. Yedek: Hedef Kolay Tempo Civarı Pencereler
    for (const p of steadyPoints) {
      if (p.hr && p.gap && Math.abs(p.gap - targetEasyPaceSec) <= paceToleranceSec) {
        paceMatchingHeartRates.push(p.hr);
      }
    }
  }

  // FİZYOLOJİK GÜVENLİK KONTROLÜ:
  const effectiveMaxHr = Math.max(observedPeakHr, 175);
  const maxAllowedAeT = Math.round(effectiveMaxHr * 0.82);

  // Öncelik 1: Aerobik Ayrışması doğrulanmış seanslar
  if (lowDecouplingHeartRates.length >= 2) {
    lowDecouplingHeartRates.sort((a, b) => a - b);
    const medianHr = lowDecouplingHeartRates[Math.floor(lowDecouplingHeartRates.length / 2)];
    if (medianHr <= maxAllowedAeT) {
      return { empiricalAeT: medianHr, sampleCount: lowDecouplingHeartRates.length, isDecouplingVerified: true };
    }
  }

  // Öncelik 2: Stabil tempo pencereleri
  if (paceMatchingHeartRates.length >= 30) {
    paceMatchingHeartRates.sort((a, b) => a - b);
    const medianHr = paceMatchingHeartRates[Math.floor(paceMatchingHeartRates.length / 2)];
    if (medianHr <= maxAllowedAeT) {
      return { empiricalAeT: medianHr, sampleCount: paceMatchingHeartRates.length, isDecouplingVerified: false };
    }
  }

  return null;
}

/**
 * Kullanıcı geçmişinden kişisel eşikleri ve AeT HATA KORİDORUNU türeten saf fonksiyon.
 */
export function deriveThresholds(input: ThresholdDerivationInput): UserThresholds {
  const { userId, activities, streams = new Map(), appleMetrics, talkTestConfirmedAeT } = input;
  const validActivities = activities.filter(a => a.movingTimeSec >= CONFIG.MIN_ACTIVITY_DURATION_SEC);

  // 1. Gözlenen Tepe Nabız (Temizlenmiş)
  let observedPeakHr = 0;
  for (const act of validActivities) {
    if (act.hasHeartRate && act.maxHr && act.maxHr > observedPeakHr && act.maxHr < 225) {
      observedPeakHr = act.maxHr;
    }
  }

  // 2. YOL 1: Apple HealthKit VO2max Mevcutsa
  if (appleMetrics?.vo2MaxMlPerKgMin && appleMetrics.vo2MaxMlPerKgMin > 20) {
    const vo2 = appleMetrics.vo2MaxMlPerKgMin;
    const { thresholdPaceGap, easyPaceCeilingGap } = derivePacesFromVO2max(vo2);

    // Ampirik Hız -> Nabız Eşlemesi Dene (Observed Peak HR referansıyla)
    const empirical = deriveEmpiricalAeT(validActivities, streams, easyPaceCeilingGap, observedPeakHr);

    let aetPoint: number;
    let aetMargin: number;
    let confidence: number;
    let method: DerivationMethod;

    if (empirical) {
      aetPoint = empirical.empiricalAeT;
      aetMargin = 3; // +-3 bpm dar hata aralığı
      // Daniels bağımlılığı ve sistematik yanlılık riski yüzünden 0.82 DEĞİL, bağımsız doğrulamaya göre 0.70-0.75 verilir
      confidence = empirical.isDecouplingVerified ? 0.75 : 0.70;
      method = 'EMPIRICAL_PACE_HR_MAPPING';
    } else {
      const baseHrMax = observedPeakHr > 0 ? observedPeakHr : (208 - 0.7 * (appleMetrics.age ?? 35));
      const theoreticalLthr = Math.round(baseHrMax * CONFIG.LTHR_RATIO_OF_HRMAX);
      // Çıpasız rekreasyonel koşucularda sistematik aşırı iyimserliği (Tip II hata) engellemek için konservatif %83
      aetPoint = Math.round(theoreticalLthr * CONFIG.AET_RATIO_OF_LTHR_UNCALIBRATED);
      aetMargin = 6; // +-6 bpm geniş hata aralığı (Hata birikimi yüzünden!)
      confidence = 0.60;
      method = 'APPLE_VO2MAX_THEORETICAL';
    }

    if (talkTestConfirmedAeT) {
      aetPoint = talkTestConfirmedAeT;
      aetMargin = 2;
      confidence = 0.90;
      method = 'TALK_TEST_ANCHOR';
    }

    const lthr = Math.round(aetPoint / CONFIG.AET_RATIO_OF_LTHR);

    return {
      id: `thresh_${Date.now()}`,
      userId,
      validFrom: new Date().toISOString(),
      hrMaxEstimated: Math.round(observedPeakHr || 185),
      hrRest: appleMetrics.restingHeartRate,
      lthr,
      aerobicThresholdHrPoint: aetPoint,
      aerobicThresholdHrMargin: aetMargin,
      aerobicThresholdHrMin: aetPoint - aetMargin,
      aerobicThresholdHrMax: aetPoint + aetMargin,
      thresholdPaceGapSecPerKm: thresholdPaceGap,
      easyPaceCeilingGapSecPerKm: easyPaceCeilingGap,
      derivationMethod: method,
      confidenceScore: confidence,
      calibrationStatus: confidence >= CONFIG.HIGH_CONFIDENCE_THRESHOLD ? 'CALIBRATED' : 'CALIBRATING'
    };
  }

  // 3. YOL 2: Yarış Eforu Varsa
  const raceEffort = validActivities.find(a => a.workoutType === 1 || (a.title && /yarış|race|maraton|10k|5k|parkrun/i.test(a.title)));
  if (raceEffort && raceEffort.gapSecPerKm > 0) {
    const racePace = raceEffort.gapSecPerKm;
    const thresholdPaceGap = Math.round(racePace * 1.05);
    const easyPaceCeilingGap = Math.round(thresholdPaceGap * 1.22);

    const hrMax = (raceEffort.maxHr && raceEffort.maxHr > 150) ? raceEffort.maxHr : observedPeakHr || 185;
    const lthr = Math.round(hrMax * 0.88);
    const aetPoint = Math.round(lthr * CONFIG.AET_RATIO_OF_LTHR);

    return {
      id: `thresh_${Date.now()}`,
      userId,
      validFrom: new Date().toISOString(),
      hrMaxEstimated: hrMax,
      lthr,
      aerobicThresholdHrPoint: aetPoint,
      aerobicThresholdHrMargin: 4,
      aerobicThresholdHrMin: aetPoint - 4,
      aerobicThresholdHrMax: aetPoint + 4,
      thresholdPaceGapSecPerKm: thresholdPaceGap,
      easyPaceCeilingGapSecPerKm: easyPaceCeilingGap,
      derivationMethod: 'VDOT_RACE',
      confidenceScore: 0.72,
      calibrationStatus: 'CALIBRATED'
    };
  }

  // 4. YOL 3: Yetersiz Veri / Gri Bölge Koşucusu (Geniş Belirsizlik)
  const hrMax = observedPeakHr > 0 ? observedPeakHr : 180;
  const lthr = Math.round(hrMax * CONFIG.LTHR_RATIO_OF_HRMAX);
  const aetPoint = Math.round(lthr * CONFIG.AET_RATIO_OF_LTHR_UNCALIBRATED);

  return {
    id: `thresh_${Date.now()}`,
    userId,
    validFrom: new Date().toISOString(),
    hrMaxEstimated: hrMax,
    lthr,
    aerobicThresholdHrPoint: aetPoint,
    aerobicThresholdHrMargin: 7, // +-7 bpm devasa belirsizlik
    aerobicThresholdHrMin: aetPoint - 7,
    aerobicThresholdHrMax: aetPoint + 7,
    thresholdPaceGapSecPerKm: 300,
    easyPaceCeilingGapSecPerKm: 360,
    derivationMethod: 'UNVERIFIED_ESTIMATE',
    confidenceScore: 0.40,
    calibrationStatus: 'CALIBRATING'
  };
}
