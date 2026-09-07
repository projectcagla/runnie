import type { 
  EngineInput, 
  Assessment, 
  AssessmentIntent, 
  AssessmentJudgment, 
  ConfidenceLevel, 
  StreamPoint,
  UserThresholds
} from './types.ts';
import { CONFIG } from './config.ts';
import { verifyTextCompliance } from './forbiddenWords.ts';
import { matchesKeywords } from './textUtils.ts';
import templates from './templates.json' with { type: 'json' };

interface TemplateItem {
  id: string;
  intent: string;
  judgment: string;
  confidenceLevel: string;
  edgeTag?: string;
  primarySentence: string;
  secondaryCostSentence: string;
}

const templateList = templates as TemplateItem[];

/**
 * Akış İçi İnterval Tespiti:
 * Koşucu başlığa "Sabah Koşusu" yazmış olsa dahi, akışta periyodik
 * yüksek hız/nabız patlamaları (aralıklar) varsa interval seansını tespit eder.
 */
function detectIntervalSignature(stream: StreamPoint[], thresholds: UserThresholds): boolean {
  if (!stream || stream.length < 30) return false;

  let fastBurstCount = 0;
  let currentBurstLength = 0;
  let inBurst = false;

  for (let i = 1; i < stream.length; i++) {
    const p = stream[i];
    const dt = p.t - stream[i - 1].t;

    // Hız eşik temposunda veya üzerinde mi? (GAP <= thresholdPace)
    const isFast = (p.gap && p.gap <= thresholds.thresholdPaceGapSecPerKm) ||
                   (p.hr && p.hr >= thresholds.lthr);

    if (isFast) {
      currentBurstLength += dt;
      if (currentBurstLength >= 30 && !inBurst) {
        inBurst = true;
        fastBurstCount++;
      }
    } else {
      if (currentBurstLength >= 30) {
        // Aralık bitti, toparlanma başladı
        inBurst = false;
      }
      currentBurstLength = 0;
    }
  }

  // En az 3 belirgin hızlı aralık varsa bu bir interval seansıdır
  return fastBurstCount >= 3;
}

export function evaluateActivity(input: EngineInput): Assessment {
  const { activity, stream, thresholds, weather } = input;
  const flags: string[] = [];

  // ADIM 1: ÖN FİLTRELEME
  if (activity.sportType !== 'RUN' && activity.sportType !== 'TRAIL_RUN' && activity.sportType !== 'TREADMILL_RUN') {
    return createSilencedAssessment(activity.id, activity.userId, thresholds.id, 'NON_RUN_SPORT', 'Koşu dışı aktivite; analiz edilmez.');
  }

  if (activity.movingTimeSec < CONFIG.MIN_ACTIVITY_DURATION_SEC) {
    return createSilencedAssessment(activity.id, activity.userId, thresholds.id, 'DURATION_TOO_SHORT', '15 dakikadan kısa aktivite; fizyolojik analiz yapılamaz.');
  }

  const isTreadmill = activity.sportType === 'TREADMILL_RUN' || activity.surfaceType === 'TREADMILL';
  if (isTreadmill) {
    flags.push('TREADMILL');
    if (!activity.hasHeartRate) {
      return createSilencedAssessment(activity.id, activity.userId, thresholds.id, 'TREADMILL_NO_HR', 'Koşu bandında nabız ve GPS verisi bulunmadığından analiz yapılamaz.');
    }
    flags.push('TREADMILL_ONLY_HR');
  }

  const isTrail = activity.sportType === 'TRAIL_RUN' || activity.surfaceType === 'TRAIL' || 
    (activity.distanceMeters > 0 && (activity.elevationGainMeters / (activity.distanceMeters / 1000) >= CONFIG.TRAIL_ELEVATION_GAIN_M_PER_KM));
  if (isTrail) flags.push('TRAIL');

  // ADIM 2: KADANS KİLİTLENMESİ TESPİTİ (ÇİFT SİNYAL: Yakınlık VE Varyans Çöküşü)
  let useHeartRate = activity.hasHeartRate;
  if (useHeartRate && stream && stream.length > 0) {
    let lockedSeconds = 0;
    let currentLockStreak = 0;
    let streakHrs: number[] = [];

    for (let i = 1; i < stream.length; i++) {
      const p = stream[i];
      const dt = p.t - stream[i - 1].t;
      if (p.hr && p.cad && Math.abs(p.hr - p.cad) <= CONFIG.CADENCE_LOCK_DIFF_THRESHOLD) {
        currentLockStreak += dt;
        streakHrs.push(p.hr);

        if (currentLockStreak >= CONFIG.CADENCE_LOCK_MIN_DURATION_SEC) {
          // Kilitlenme penceresinde nabız standart sapması kontrolü
          const mean = streakHrs.reduce((a, b) => a + b, 0) / streakHrs.length;
          const variance = streakHrs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / streakHrs.length;
          const stdDev = Math.sqrt(variance);

          // Gerçek kilitlenmede optik sensör adıma yapışır ve varyans çöker (stdDev <= 1.2)
          if (stdDev <= CONFIG.CADENCE_LOCK_MAX_HR_STD_DEV) {
            lockedSeconds += dt;
          }
        }
      } else {
        currentLockStreak = 0;
        streakHrs = [];
      }
    }

    if (lockedSeconds / activity.movingTimeSec >= CONFIG.CADENCE_LOCK_MAX_CORRUPT_RATIO) {
      useHeartRate = false;
      flags.push('CADENCE_LOCK');
    }
  }

  // ADIM 3: DİNAMİK ISINMA KIRPMA
  const maxWarmupSec = Math.min(CONFIG.MAX_WARMUP_SEC, Math.round(activity.movingTimeSec * CONFIG.WARMUP_RATIO_MAX));
  let warmupEndSec = maxWarmupSec;

  if (stream && stream.length > 0) {
    let highEffortStreak = 0;
    for (let i = 1; i < stream.length; i++) {
      const p = stream[i];
      if (p.t > maxWarmupSec) break;
      const dt = p.t - stream[i - 1].t;

      const isHighEffort = (useHeartRate && p.hr && p.hr >= thresholds.lthr) ||
                           (!useHeartRate && p.gap && p.gap <= thresholds.thresholdPaceGapSecPerKm);

      if (isHighEffort) {
        highEffortStreak += dt;
        if (highEffortStreak >= CONFIG.WARMUP_EARLY_EFFORT_SEC) {
          warmupEndSec = p.t;
          flags.push('EARLY_WARMUP_EFFORT');
          break;
        }
      } else {
        highEffortStreak = 0;
      }
    }
  }

  const steadyStream = (stream || []).filter(p => p.t >= warmupEndSec);
  const steadyDurationSec = activity.movingTimeSec - warmupEndSec;

  // ADIM 4: YÜRÜYÜŞ TESPİTİ
  let walkSeconds = 0;
  if (steadyStream.length > 0) {
    for (let i = 1; i < steadyStream.length; i++) {
      const p = steadyStream[i];
      const dt = p.t - steadyStream[i - 1].t;
      if ((p.cad && p.cad < CONFIG.WALK_CADENCE_THRESHOLD) || (p.gap && p.gap > 720)) {
        walkSeconds += dt;
      }
    }
    if (walkSeconds >= 60) flags.push('WALK_BREAKS');
  }

  // ADIM 5: NİYET (INTENT) TAHMİNİ (Türkçe Güvenli + Akış İçi Destekli)
  let inferredIntent: AssessmentIntent = 'EASY';
  const title = activity.title || '';

  const raceKeywords = ['yarış', 'race', 'maraton', 'marathon', '10k', '5k', 'parkrun', 'yarı maraton'];
  const qualityKeywords = ['tempo', 'interval', 'tekrar', 'aralık', 'fartlek', 'yokuş'];

  if (activity.workoutType === 1 || matchesKeywords(title, raceKeywords)) {
    inferredIntent = 'RACE';
  } else if (matchesKeywords(title, qualityKeywords)) {
    inferredIntent = 'QUALITY';
  } else if (detectIntervalSignature(steadyStream, thresholds)) {
    // Başlıkta yazmasa bile akışta interval bulundu!
    inferredIntent = 'QUALITY';
    flags.push('INTERVAL_SIGNATURE_DETECTED');
  } else if (activity.movingTimeSec >= CONFIG.LONG_RUN_DURATION_SEC) {
    inferredIntent = 'LONG';
  }

  if ((activity.athletesCount && activity.athletesCount > 1) || (activity as any).userFeedbackTag === 'GROUP_RUN') {
    flags.push('GROUP_RUN');
  } else if (activity.startTime) {
    const actDate = new Date(activity.startTime);
    const dayOfWeek = actDate.getUTCDay(); // 0 = Pazar, 6 = Cumartesi
    const hour = actDate.getUTCHours();
    const isWeekendMorning = (dayOfWeek === 0 || dayOfWeek === 6) && (hour >= 4 && hour <= 10);
    if (isWeekendMorning && steadyStream.length >= 30) {
      const gaps = steadyStream.map(p => p.gap).filter((g): g is number => typeof g === 'number' && g > 0);
      if (gaps.length > 20) {
        const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const varGap = gaps.reduce((a, b) => a + Math.pow(b - meanGap, 2), 0) / gaps.length;
        const stdDevGap = Math.sqrt(varGap);
        if (stdDevGap > 30) {
          flags.push('GROUP_RUN_CANDIDATE');
        }
      }
    }
  }

  // Aerobik Ayrışma (Decoupling) Hesabı
  let aerobicDecouplingPct: number | undefined = undefined;
  if (steadyStream.length >= 30) {
    const validSteadyPoints = steadyStream.filter(p => p.hr && p.gap);
    if (validSteadyPoints.length >= 20) {
      const half = Math.floor(validSteadyPoints.length / 2);
      const firstHalf = validSteadyPoints.slice(0, half);
      const secondHalf = validSteadyPoints.slice(half);

      const avgHr1 = firstHalf.reduce((s, p) => s + (p.hr || 0), 0) / firstHalf.length;
      const avgGap1 = firstHalf.reduce((s, p) => s + (p.gap || 0), 0) / firstHalf.length;
      const avgHr2 = secondHalf.reduce((s, p) => s + (p.hr || 0), 0) / secondHalf.length;
      const avgGap2 = secondHalf.reduce((s, p) => s + (p.gap || 0), 0) / secondHalf.length;

      if (avgGap1 > 0 && avgGap2 > 0 && Math.abs(avgGap2 - avgGap1) <= 25) {
        const decoupling = ((avgHr2 * avgGap1) / (avgHr1 * avgGap2) - 1) * 100;
        aerobicDecouplingPct = Math.round(decoupling * 10) / 10;
        if (aerobicDecouplingPct > CONFIG.AEROBIC_DECOUPLING_MAX_PCT) {
          flags.push('AEROBIC_DRIFT_WARNING');
        }
      }
    }
  }

  // ADIM 6: 4 BÖLGELİ DAĞILIM HESABI
  let defEasySec = 0;
  let uncCorridorSec = 0;
  let defGraySec = 0;
  let defThreshSec = 0;

  if (steadyStream.length > 1) {
    for (let i = 1; i < steadyStream.length; i++) {
      const p = steadyStream[i];
      const dt = p.t - steadyStream[i - 1].t;

      if (useHeartRate && p.hr) {
        if (p.hr < thresholds.aerobicThresholdHrMin) {
          defEasySec += dt;
        } else if (p.hr <= thresholds.aerobicThresholdHrMax) {
          uncCorridorSec += dt;
        } else if (p.hr <= thresholds.lthr) {
          defGraySec += dt;
        } else {
          defThreshSec += dt;
        }
      } else {
        const gap = p.gap || activity.gapSecPerKm;
        if (gap >= thresholds.easyPaceCeilingGapSecPerKm + 15) {
          defEasySec += dt;
        } else if (gap >= thresholds.easyPaceCeilingGapSecPerKm - 15) {
          uncCorridorSec += dt;
        } else if (gap > thresholds.thresholdPaceGapSecPerKm) {
          defGraySec += dt;
        } else {
          defThreshSec += dt;
        }
      }
    }
  }

  const totalSec = Math.max(1, defEasySec + uncCorridorSec + defGraySec + defThreshSec);
  const definiteEasyPct = Math.round((defEasySec / totalSec) * 1000) / 10;
  const uncertainCorridorPct = Math.round((uncCorridorSec / totalSec) * 1000) / 10;
  const definiteGrayPct = Math.round((defGraySec / totalSec) * 1000) / 10;
  const definiteThresholdPct = Math.round((defThreshSec / totalSec) * 1000) / 10;

  // Geriye dönük uyumluluk alanları
  const zoneEasyPct = Math.round(((defEasySec + (uncCorridorSec * 0.5)) / totalSec) * 1000) / 10;
  const zoneModeratePct = Math.round(((defGraySec + (uncCorridorSec * 0.5)) / totalSec) * 1000) / 10;
  const zoneThresholdPct = definiteThresholdPct;

  // ADIM 7: HÜKÜM & ŞABLON SEÇİMİ (Ortalama Nabız Değil, Dağılım Kuralı!)
  let analysisJudgment: AssessmentJudgment = 'ACCORDING_TO_PLAN';

  // Çevresel Isı Stresi (K5 Standardı: T >= 24°C VEYA Nem >= %75)
  const isHeatStress = weather && (
    weather.temperatureC >= CONFIG.HEAT_TEMPERATURE_THRESHOLD_C || 
    weather.relativeHumidity >= CONFIG.HEAT_HUMIDITY_THRESHOLD_PCT
  );

  // Fizyolojik Yorgunluk Stresi (Dinlenik Nabız veya HRV Baskılanması)
  const baselines = input.physiologicalBaselines;
  let isPhysiologicalStress = false;
  if (baselines?.todayRestingHr && baselines?.restingHrBaseline) {
    if (baselines.todayRestingHr - baselines.restingHrBaseline >= CONFIG.PHYSIOLOGICAL_HR_REST_SPIKE_BPM) {
      isPhysiologicalStress = true;
      flags.push('RESTING_HR_ELEVATED');
    }
  }
  if (baselines?.todayHrvSdnn && baselines?.hrvSdnnBaseline && baselines.hrvSdnnBaseline > 0) {
    const dropPct = ((baselines.hrvSdnnBaseline - baselines.todayHrvSdnn) / baselines.hrvSdnnBaseline) * 100;
    if (dropPct >= CONFIG.PHYSIOLOGICAL_HRV_DROP_PCT) {
      isPhysiologicalStress = true;
      flags.push('HRV_SUPPRESSED');
    }
  }

  if (inferredIntent === 'EASY') {
    const totalHighIntensityPct = definiteGrayPct + definiteThresholdPct;
    const paceIsEasy = isTreadmill || (activity.gapSecPerKm >= thresholds.easyPaceCeilingGapSecPerKm);

    // KURAL 1: Net Kolay Koşu Başarısı
    // Kesin kolay süresi >= %75 VEYA sıfır yüksek şiddet ile kolay tempolu koşu
    if (definiteEasyPct >= CONFIG.EASY_COMPLIANCE_ZONE1_MIN_PCT || (totalHighIntensityPct === 0 && paceIsEasy)) {
      analysisJudgment = 'ACCORDING_TO_PLAN';
    }
    // KURAL 2: Net İhlal / Aşırı Şiddet veya Beraat
    else if (totalHighIntensityPct >= CONFIG.MILD_DRIFT_THRESHOLD_PCT) {
      if (isHeatStress && paceIsEasy) {
        analysisJudgment = 'WEATHER_PARDON';
        flags.push('WEATHER_PARDONED');
      } else if (isPhysiologicalStress && paceIsEasy) {
        analysisJudgment = 'PHYSIOLOGICAL_PARDON';
        flags.push('PHYSIOLOGICAL_PARDONED');
      } else if (definiteThresholdPct >= CONFIG.SEVERE_DRIFT_THRESHOLD_PCT) {
        analysisJudgment = 'DRIFTED_THRESHOLD';
      } else {
        analysisJudgment = 'DRIFTED_GRAY';
      }
    }
    // KURAL 3: Belirsizlik / Sınır Koridoru (Yalnızca yüksek şiddet <%25 iken ve sınırda salınım varsa)
    else if (uncertainCorridorPct >= 25 && totalHighIntensityPct > 0) {
      analysisJudgment = 'BOUNDARY_ZONE';
      flags.push('BOUNDARY_CORRIDOR');
    } else {
      analysisJudgment = 'ACCORDING_TO_PLAN';
    }
  } else if (inferredIntent === 'QUALITY') {
    if (definiteThresholdPct >= 25 || (definiteGrayPct + definiteThresholdPct) >= 60) {
      analysisJudgment = 'QUALITY_SUCCESS';
    } else {
      analysisJudgment = 'UNDER_STIMULATED';
    }
  } else if (inferredIntent === 'LONG') {
    if (activity.movingTimeSec >= CONFIG.VERY_LONG_RUN_DURATION_SEC) {
      flags.push('CARDIAC_DRIFT_EXPECTED');
    }
    analysisJudgment = definiteThresholdPct >= CONFIG.SEVERE_DRIFT_THRESHOLD_PCT ? 'DRIFTED_THRESHOLD' : 'ACCORDING_TO_PLAN';
  } else if (inferredIntent === 'RACE') {
    analysisJudgment = 'OBSERVATION_ONLY';
    flags.push('RACE_EVENT');
  }

  // Güven Seviyesi ve Düşük Güven Koruması
  const confidenceScore = thresholds.confidenceScore;
  const confidenceLevel: ConfidenceLevel = 
    confidenceScore >= CONFIG.HIGH_CONFIDENCE_THRESHOLD ? 'HIGH' :
    confidenceScore >= CONFIG.MEDIUM_CONFIDENCE_THRESHOLD ? 'MEDIUM' : 'LOW';

  if (confidenceLevel === 'LOW') {
    // Soğuk başlangıç çıkmazı çözümü: Eşikler henüz doğrulanmamışken kullanıcıyı
    // aşırı eforla suçlamamak için DRIFTED durumları OBSERVATION_ONLY yapılır.
    // Ancak dengeli kolay koşularda (ACCORDING_TO_PLAN) kullanıcı sessiz bırakılmaz;
    // EASY_ON_TRACK_LOW şablonuyla geçici referans bildirilir.
    if (analysisJudgment === 'DRIFTED_GRAY' || analysisJudgment === 'DRIFTED_THRESHOLD') {
      analysisJudgment = 'OBSERVATION_ONLY';
    }
  }

  const matchedTemplate = selectTemplate({
    intent: inferredIntent,
    judgment: analysisJudgment,
    confidenceLevel,
    flags
  });

  const outputSentence = interpolateTemplate(matchedTemplate.primarySentence, {
    easyPct: zoneEasyPct,
    thresholdPct: zoneThresholdPct,
    moderatePct: zoneModeratePct
  });

  const secondaryCostSentence = interpolateTemplate(matchedTemplate.secondaryCostSentence, {
    easyPct: zoneEasyPct,
    thresholdPct: zoneThresholdPct,
    moderatePct: zoneModeratePct
  });

  const compliance1 = verifyTextCompliance(outputSentence);
  const compliance2 = verifyTextCompliance(secondaryCostSentence);
  if (!compliance1.valid || !compliance2.valid) {
    throw new Error(`Yasaklı ifade ihlali: ${[...compliance1.violations, ...compliance2.violations].join(', ')}`);
  }

  return {
    activityId: activity.id,
    userId: activity.userId,
    thresholdId: thresholds.id,
    inferredIntent,
    isUserOverridden: false,
    definiteEasyPct,
    uncertainCorridorPct,
    definiteGrayPct,
    definiteThresholdPct,
    zoneEasyPct,
    zoneModeratePct,
    zoneThresholdPct,
    analysisJudgment,
    templateId: matchedTemplate.id,
    outputSentence,
    secondaryCostSentence,
    confidenceLevel,
    confidenceScore,
    flags,
    isSilenced: false,
    steadyStateDurationSec: steadyDurationSec,
    aerobicDecouplingPct
  };
}

function selectTemplate(criteria: {
  intent: AssessmentIntent;
  judgment: AssessmentJudgment;
  confidenceLevel: ConfidenceLevel;
  flags: string[];
}): TemplateItem {
  const { intent, judgment, confidenceLevel, flags } = criteria;

  // 1. Kenar durum etiketleri (Sensör arızası vb. en yüksek önceliklidir)
  if (flags.includes('CADENCE_LOCK')) {
    const cadTpl = templateList.find(t => t.edgeTag === 'CADENCE_LOCK');
    if (cadTpl) return cadTpl;
  }

  if (flags.includes('TREADMILL')) {
    const treadTpl = templateList.find(t => t.edgeTag === 'TREADMILL');
    if (treadTpl) return treadTpl;
  }

  if (judgment === 'PHYSIOLOGICAL_PARDON') {
    const physTpl = templateList.find(t => t.judgment === 'PHYSIOLOGICAL_PARDON');
    if (physTpl) return physTpl;
  }

  if (flags.includes('GROUP_RUN') || flags.includes('GROUP_RUN_CANDIDATE')) {
    const groupTpl = templateList.find(t => t.edgeTag === 'GROUP_RUN' && t.judgment === judgment);
    if (groupTpl) return groupTpl;
  }

  if (flags.includes('WALK_BREAKS') && judgment === 'ACCORDING_TO_PLAN') {
    const walkTpl = templateList.find(t => t.edgeTag === 'WALK_BREAKS');
    if (walkTpl) return walkTpl;
  }

  if (flags.includes('CARDIAC_DRIFT_EXPECTED') && intent === 'LONG') {
    const driftTpl = templateList.find(t => t.edgeTag === 'LONG_RUN');
    if (driftTpl) return driftTpl;
  }

  // 2. Belirsiz Koridor Şablonu
  if (judgment === 'BOUNDARY_ZONE') {
    const boundaryTpl = templateList.find(t => t.judgment === 'BOUNDARY_ZONE');
    if (boundaryTpl) return boundaryTpl;
  }

  // 3. Yarış Şablonu
  if (intent === 'RACE') {
    const raceTpl = templateList.find(t => t.intent === 'RACE');
    if (raceTpl) return raceTpl;
  }

  if (confidenceLevel === 'LOW' || judgment === 'OBSERVATION_ONLY') {
    const lowTpl = templateList.find(t => t.judgment === 'OBSERVATION_ONLY' && t.confidenceLevel === 'LOW');
    if (lowTpl) return lowTpl;
  }

  const standard = templateList.find(t => 
    t.intent === intent && 
    t.judgment === judgment && 
    t.confidenceLevel === confidenceLevel &&
    !t.edgeTag
  );
  if (standard) return standard;

  const fallback = templateList.find(t => t.intent === intent && t.judgment === judgment && !t.edgeTag);
  if (fallback) return fallback;

  return templateList[0];
}

function interpolateTemplate(template: string, vars: Record<string, number | string>): string {
  let result = template;
  for (const [k, v] of Object.entries(vars)) {
    result = result.replaceAll(`%{${k}}`, Math.round(Number(v)).toString());
  }
  return result;
}

function createSilencedAssessment(
  activityId: string, 
  userId: string, 
  thresholdId: string, 
  reason: string, 
  explanation: string
): Assessment {
  return {
    activityId,
    userId,
    thresholdId,
    inferredIntent: 'EASY',
    isUserOverridden: false,
    definiteEasyPct: 0,
    uncertainCorridorPct: 0,
    definiteGrayPct: 0,
    definiteThresholdPct: 0,
    zoneEasyPct: 0,
    zoneModeratePct: 0,
    zoneThresholdPct: 0,
    analysisJudgment: 'OBSERVATION_ONLY',
    templateId: 'SILENCED',
    outputSentence: explanation,
    secondaryCostSentence: '',
    confidenceLevel: 'LOW',
    confidenceScore: 0,
    flags: [reason],
    isSilenced: true,
    silenceReason: reason,
    steadyStateDurationSec: 0
  };
}
