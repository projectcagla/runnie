import test from 'node:test';
import assert from 'node:assert';
import { evaluateActivity } from '../src/engine.ts';
import { 
  standardThresholds, 
  lowConfidenceThresholds, 
  standardWeather, 
  hotHumidWeather, 
  createSyntheticStream,
  fixturePerfectEasyRun,
  fixtureFailedEasyRun,
  fixtureHotHumidPardon,
  fixtureCadenceLock,
  fixtureWalkBreaks,
  fixtureShortRun,
  fixtureUltraShortRun,
  fixtureBikeRide,
  fixtureTreadmill,
  fixtureVeryLongRun,
  fixtureGroupRun
} from './fixtures.ts';

test('Karar Motoru: Mükemmel Kolay Koşu (ACCORDING_TO_PLAN)', () => {
  const stream = createSyntheticStream(2400, 136, 350); // AeT 145'in altı
  const assessment = evaluateActivity({
    activity: fixturePerfectEasyRun,
    stream,
    thresholds: standardThresholds,
    weather: standardWeather
  });

  assert.strictEqual(assessment.isSilenced, false);
  assert.strictEqual(assessment.inferredIntent, 'EASY');
  assert.strictEqual(assessment.analysisJudgment, 'ACCORDING_TO_PLAN');
  assert.strictEqual(assessment.confidenceLevel, 'HIGH');
  assert.strictEqual(assessment.zoneEasyPct >= 80, true);
  assert.strictEqual(assessment.outputSentence.includes('toparlanma'), true);
});

test('Karar Motoru: Eşik Bölgesine Kaymış Kolay Koşu (DRIFTED_THRESHOLD)', () => {
  const stream = createSyntheticStream(2400, 175, 280); // LTHR 172'nin üstü
  const assessment = evaluateActivity({
    activity: fixtureFailedEasyRun,
    stream,
    thresholds: standardThresholds,
    weather: standardWeather
  });

  assert.strictEqual(assessment.isSilenced, false);
  assert.strictEqual(assessment.inferredIntent, 'EASY');
  assert.strictEqual(assessment.analysisJudgment, 'DRIFTED_THRESHOLD');
  assert.strictEqual(assessment.zoneThresholdPct >= 35, true);
  assert.strictEqual(assessment.outputSentence.includes('eşik'), true);
});

test('Karar Motoru: Sıcak Hava ve Nem Beraati (WEATHER_PARDON)', () => {
  // Nabız 162 bpm (eşik civarı), ancak tempo 360 sn/km (6:00/km - kolay tempo tavanı 5:30'dan yavaş)
  const stream = createSyntheticStream(2400, 162, 360);
  const assessment = evaluateActivity({
    activity: fixtureHotHumidPardon,
    stream,
    thresholds: standardThresholds,
    weather: hotHumidWeather
  });

  assert.strictEqual(assessment.analysisJudgment, 'WEATHER_PARDON');
  assert.strictEqual(assessment.flags.includes('WEATHER_PARDONED'), true);
  assert.strictEqual(assessment.outputSentence.includes('sıcaklık ve nem'), true);
});

test('Karar Motoru: Kadans Kilitlenmesi Filtresi (CADENCE_LOCK)', () => {
  // 40 dakika boyunca nabız ile kadans 168'de kilitli
  const stream: any[] = [];
  for (let t = 0; t <= 2400; t += 10) {
    stream.push({
      t,
      hr: 168, // Kadansla birebir kilitli
      cad: 168,
      gap: 342, // Kolay tempo (5:42/km)
      dist: Math.round((t / 3600) * (3600 / 342) * 1000)
    });
  }

  const assessment = evaluateActivity({
    activity: fixtureCadenceLock,
    stream,
    thresholds: standardThresholds,
    weather: standardWeather
  });

  assert.strictEqual(assessment.flags.includes('CADENCE_LOCK'), true);
  assert.strictEqual(assessment.templateId.includes('CADENCE_LOCK'), true);
});

test('Karar Motoru: Dinamik Isınma Kırpma (Kısa Koşularda Veriyi Yememe)', () => {
  // 18 dakikalık kısa koşuda (1080 sn), ısınma 480 sn (8 dk) DEĞİL, en fazla %20 (216 sn) olmalıdır!
  const stream = createSyntheticStream(1080, 135, 337);
  const assessment = evaluateActivity({
    activity: fixtureShortRun,
    stream,
    thresholds: standardThresholds,
    weather: standardWeather
  });

  const warmupTime = 1080 - assessment.steadyStateDurationSec;
  assert.strictEqual(warmupTime <= 216, true, `Isınma süresi ${warmupTime} sn çıktı; 216 sn'den az olmalıdır.`);
});

test('Karar Motoru: Yürü-Koş Tespiti (WALK_BREAKS)', () => {
  // İçinde 90 saniye yürüyüş (kadans 100) olan akış
  const stream: any[] = [];
  for (let t = 0; t <= 2400; t += 10) {
    const isWalk = t >= 600 && t <= 720;
    stream.push({
      t,
      hr: isWalk ? 115 : 138,
      cad: isWalk ? 95 : 166,
      gap: isWalk ? 750 : 350
    });
  }

  const assessment = evaluateActivity({
    activity: fixtureWalkBreaks,
    stream,
    thresholds: standardThresholds,
    weather: standardWeather
  });

  assert.strictEqual(assessment.flags.includes('WALK_BREAKS'), true);
  assert.strictEqual(assessment.templateId.includes('WALK_BREAKS'), true);
});

test('Karar Motoru: Düşük Güven Koruması (LOW CONFIDENCE GUARD)', () => {
  // Koşucu eşiğe kaymış olsa bile, güven skoru 0.45 olduğu için iddialı hüküm engellenmeli!
  const stream = createSyntheticStream(2400, 175, 280);
  const assessment = evaluateActivity({
    activity: fixtureFailedEasyRun,
    stream,
    thresholds: lowConfidenceThresholds,
    weather: standardWeather
  });

  assert.strictEqual(assessment.confidenceLevel, 'LOW');
  assert.strictEqual(assessment.analysisJudgment, 'OBSERVATION_ONLY');
  assert.strictEqual(assessment.outputSentence.includes('kalibrasyon'), true);
});

test('Karar Motoru: Koşu Dışı Aktivite Sessizce Arşivlenir', () => {
  const assessment = evaluateActivity({
    activity: fixtureBikeRide,
    stream: [],
    thresholds: standardThresholds
  });

  assert.strictEqual(assessment.isSilenced, true);
  assert.strictEqual(assessment.silenceReason, 'NON_RUN_SPORT');
});

test('Karar Motoru: 15 Dakikadan Kısa Aktivite Sessiz Kalır', () => {
  const assessment = evaluateActivity({
    activity: fixtureUltraShortRun,
    stream: [],
    thresholds: standardThresholds
  });

  assert.strictEqual(assessment.isSilenced, true);
  assert.strictEqual(assessment.silenceReason, 'DURATION_TOO_SHORT');
});

test('Karar Motoru: Koşu Bandı ve Grup Koşusu Kenar Durumları', () => {
  const treadStream = createSyntheticStream(2100, 138, 350);
  const treadAssessment = evaluateActivity({
    activity: fixtureTreadmill,
    stream: treadStream,
    thresholds: standardThresholds
  });
  assert.strictEqual(treadAssessment.flags.includes('TREADMILL'), true);

  const groupStream = createSyntheticStream(2400, 165, 310);
  const groupAssessment = evaluateActivity({
    activity: fixtureGroupRun,
    stream: groupStream,
    thresholds: standardThresholds
  });
  assert.strictEqual(groupAssessment.flags.includes('GROUP_RUN'), true);
});

test('Karar Motoru: 90 Dakikadan Uzun Koşuda Kardiyak Sürüklenme Beklenir', () => {
  const longStream = createSyntheticStream(6000, 148, 333);
  const assessment = evaluateActivity({
    activity: fixtureVeryLongRun,
    stream: longStream,
    thresholds: standardThresholds
  });

  assert.strictEqual(assessment.inferredIntent, 'LONG');
  assert.strictEqual(assessment.flags.includes('CARDIAC_DRIFT_EXPECTED'), true);
});

test('Karar Motoru: Fizyolojik Durum Beraati (PHYSIOLOGICAL_PARDON)', () => {
  // Koşucu kolay tempoda (360 s/km) koşmuş ancak nabzı 162 bpm'e yükselmiş (aşırı efor bölgesi)
  // Hava serin (15°C, nem %50), yani ısı beraati YOK.
  // Ancak koşu sabahındaki dinlenik nabzı tabanından (50) 6 bpm yüksek (56 bpm).
  const stream = createSyntheticStream(2400, 162, 360);
  const assessment = evaluateActivity({
    activity: fixtureHotHumidPardon,
    stream,
    thresholds: standardThresholds,
    weather: standardWeather,
    physiologicalBaselines: {
      restingHrBaseline: 50,
      todayRestingHr: 56,
      hrvSdnnBaseline: 65,
      todayHrvSdnn: 60
    }
  });

  assert.strictEqual(assessment.analysisJudgment, 'PHYSIOLOGICAL_PARDON');
  assert.strictEqual(assessment.flags.includes('PHYSIOLOGICAL_PARDONED'), true);
  assert.strictEqual(assessment.flags.includes('RESTING_HR_ELEVATED'), true);
  assert.strictEqual(assessment.outputSentence.includes('dinlenik nabzın'), true);
});

test('Karar Motoru: Kadans Kilitlenmesi Çift Sinyal — Doğal RSA Dalgalanması Kilitlenme Sayılmaz', () => {
  // Koşucunun kadansı 165, nabzı da ortalama 165 civarı; ancak solunum aritmisi (RSA) nedeniyle
  // nabız 161 ile 169 arasında doğal dalgalanıyor (varyans çöküşü YOK, standart sapma > 1.2).
  const stream: any[] = [];
  for (let t = 0; t <= 2400; t += 10) {
    const rsaOffset = (t % 40 === 0) ? 3 : (t % 40 === 10 ? -3 : (t % 40 === 20 ? 2 : -2));
    stream.push({
      t,
      hr: 165 + rsaOffset,
      cad: 165,
      gap: 340,
      dist: Math.round((t / 3600) * (3600 / 340) * 1000)
    });
  }

  const assessment = evaluateActivity({
    activity: fixtureCadenceLock,
    stream,
    thresholds: standardThresholds,
    weather: standardWeather
  });

  // Doğal dalgalanma olduğu için CADENCE_LOCK bayrağı almamalı, nabız korunmalı!
  assert.strictEqual(assessment.flags.includes('CADENCE_LOCK'), false);
});

test('Karar Motoru: Kolay Koşuda Aerobik Ayrışma Uyarısı (AEROBIC_DRIFT_WARNING)', () => {
  // Hız sabit (350 sn/km = 5:50/km), ilk yarıda nabız 135 bpm, ikinci yarıda 148 bpm (ayrışma ~%9.6 > %5.0)
  const stream: any[] = [];
  for (let t = 0; t <= 2400; t += 10) {
    const hr = t <= 1200 ? 135 : 148;
    stream.push({
      t,
      hr,
      cad: 168,
      gap: 350
    });
  }

  const assessment = evaluateActivity({
    activity: fixturePerfectEasyRun,
    stream,
    thresholds: standardThresholds,
    weather: standardWeather
  });

  assert.strictEqual(assessment.flags.includes('AEROBIC_DRIFT_WARNING'), true);
  assert.strictEqual(assessment.aerobicDecouplingPct! > 5.0, true);
});
