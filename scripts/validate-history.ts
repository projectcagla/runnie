import { evaluateActivity } from '../src/engine.ts';
import { deriveThresholds } from '../src/thresholds.ts';
import type { NormalizedActivity, StreamPoint, WeatherSnapshot, UserThresholds } from '../src/types.ts';
import templates from '../src/templates.json' with { type: 'json' };

// 1. BOUNDARY_ZONE şablonunu templates.json'a dahil etme kontrolü
const hasBoundary = templates.some(t => t.judgment === 'BOUNDARY_ZONE');
if (!hasBoundary) {
  templates.push({
    id: 'BOUNDARY_ZONE_01',
    intent: 'EASY',
    judgment: 'BOUNDARY_ZONE',
    confidenceLevel: 'MEDIUM',
    primarySentence: 'Efor seviyen kolay koşu sınırının tam eşiğinde seyretti; kalibrasyon hata payımızın içinde kaldığın için kesin bir ihlal hükmü vermiyoruz.',
    secondaryCostSentence: 'Koşu sonundaki nefes durumunun konuşma temposunda olup olmadığı motorun mevcut tahmininden daha belirleyicidir.'
  });
}

// Sentetik akış üreteci
function makeStream(durationSec: number, targetHr: number, targetGap: number, targetCad = 168): StreamPoint[] {
  const points: StreamPoint[] = [];
  for (let t = 0; t <= durationSec; t += 10) {
    points.push({
      t,
      hr: targetHr + Math.floor(Math.sin(t / 80) * 3),
      gap: targetGap,
      cad: targetCad,
      dist: Math.round((t / 3600) * (3600 / targetGap) * 1000)
    });
  }
  return points;
}

// 10 Haftalık Gerçekçi Koşucu Geçmişi (24 Koşu)
const mockHistory: Array<{ activity: NormalizedActivity; weather: WeatherSnapshot; hrStreamAvg: number }> = [
  // Hafta 1-2: İlkbahar Serin (14°C), Alışma koşuları
  { activity: { id: 'w1_1', userId: 'u1', sportType: 'RUN', title: 'Sabah Koşusu', startTime: '2026-04-01T07:00:00Z', elapsedTimeSec: 2400, movingTimeSec: 2400, distanceMeters: 6500, elevationGainMeters: 15, hasHeartRate: true, avgHr: 141, maxHr: 150, avgCadence: 166, avgPaceSecPerKm: 369, gapSecPerKm: 369, surfaceType: 'ROAD' }, weather: { temperatureC: 14, apparentTemperatureC: 14, relativeHumidity: 50, windSpeedKmh: 10 }, hrStreamAvg: 141 },
  { activity: { id: 'w1_2', userId: 'u1', sportType: 'RUN', title: 'Perşembe Kolay', startTime: '2026-04-03T07:00:00Z', elapsedTimeSec: 2700, movingTimeSec: 2700, distanceMeters: 7500, elevationGainMeters: 20, hasHeartRate: true, avgHr: 143, maxHr: 152, avgCadence: 168, avgPaceSecPerKm: 360, gapSecPerKm: 360, surfaceType: 'ROAD' }, weather: { temperatureC: 15, apparentTemperatureC: 15, relativeHumidity: 55, windSpeedKmh: 8 }, hrStreamAvg: 143 },
  { activity: { id: 'w2_1', userId: 'u1', sportType: 'RUN', title: 'Hafta Sonu Uzun', startTime: '2026-04-05T08:00:00Z', elapsedTimeSec: 4800, movingTimeSec: 4800, distanceMeters: 13000, elevationGainMeters: 60, hasHeartRate: true, avgHr: 145, maxHr: 155, avgCadence: 168, avgPaceSecPerKm: 369, gapSecPerKm: 369, surfaceType: 'ROAD' }, weather: { temperatureC: 13, apparentTemperatureC: 13, relativeHumidity: 60, windSpeedKmh: 12 }, hrStreamAvg: 145 },
  { activity: { id: 'w2_2', userId: 'u1', sportType: 'RUN', title: 'Salı Eforu Kaçan', startTime: '2026-04-07T07:00:00Z', elapsedTimeSec: 2400, movingTimeSec: 2400, distanceMeters: 7400, elevationGainMeters: 15, hasHeartRate: true, avgHr: 168, maxHr: 178, avgCadence: 172, avgPaceSecPerKm: 324, gapSecPerKm: 324, surfaceType: 'ROAD' }, weather: { temperatureC: 16, apparentTemperatureC: 16, relativeHumidity: 50, windSpeedKmh: 6 }, hrStreamAvg: 168 },
  
  // Hafta 3-4: Gri bölgeye kaymalar ve sınır koşuları
  { activity: { id: 'w3_1', userId: 'u1', sportType: 'RUN', title: 'Sabah Sınırda Koşu', startTime: '2026-04-12T07:00:00Z', elapsedTimeSec: 2400, movingTimeSec: 2400, distanceMeters: 6700, elevationGainMeters: 10, hasHeartRate: true, avgHr: 146, maxHr: 154, avgCadence: 167, avgPaceSecPerKm: 358, gapSecPerKm: 358, surfaceType: 'ROAD' }, weather: { temperatureC: 16, apparentTemperatureC: 16, relativeHumidity: 55, windSpeedKmh: 10 }, hrStreamAvg: 146 },
  { activity: { id: 'w3_2', userId: 'u1', sportType: 'RUN', title: 'İnterval Seansı', startTime: '2026-04-14T07:00:00Z', elapsedTimeSec: 2700, movingTimeSec: 2700, distanceMeters: 8500, elevationGainMeters: 10, hasHeartRate: true, avgHr: 173, maxHr: 184, avgCadence: 178, avgPaceSecPerKm: 317, gapSecPerKm: 317, surfaceType: 'ROAD' }, weather: { temperatureC: 17, apparentTemperatureC: 17, relativeHumidity: 50, windSpeedKmh: 8 }, hrStreamAvg: 173 },
  { activity: { id: 'w4_1', userId: 'u1', sportType: 'RUN', title: 'Pazar Rahat Uzun', startTime: '2026-04-19T08:00:00Z', elapsedTimeSec: 5100, movingTimeSec: 5100, distanceMeters: 14000, elevationGainMeters: 70, hasHeartRate: true, avgHr: 142, maxHr: 150, avgCadence: 168, avgPaceSecPerKm: 364, gapSecPerKm: 364, surfaceType: 'ROAD' }, weather: { temperatureC: 18, apparentTemperatureC: 18, relativeHumidity: 52, windSpeedKmh: 14 }, hrStreamAvg: 142 },
  { activity: { id: 'w4_2', userId: 'u1', sportType: 'RUN', title: 'Grup Koşusu Eşiğe Kaydı', startTime: '2026-04-21T19:00:00Z', elapsedTimeSec: 2400, movingTimeSec: 2400, distanceMeters: 7500, elevationGainMeters: 20, hasHeartRate: true, avgHr: 165, maxHr: 174, avgCadence: 171, avgPaceSecPerKm: 320, gapSecPerKm: 320, surfaceType: 'ROAD', athletesCount: 8 }, weather: { temperatureC: 17, apparentTemperatureC: 17, relativeHumidity: 58, windSpeedKmh: 5 }, hrStreamAvg: 165 },

  // Hafta 5-6: Havalar ısınıyor (26-28°C), Sıcaklık Beraati Testleri
  { activity: { id: 'w5_1', userId: 'u1', sportType: 'RUN', title: 'Öğlen Sıcağında Yavaş Koşu', startTime: '2026-05-02T13:00:00Z', elapsedTimeSec: 2400, movingTimeSec: 2400, distanceMeters: 6400, elevationGainMeters: 10, hasHeartRate: true, avgHr: 158, maxHr: 166, avgCadence: 165, avgPaceSecPerKm: 375, gapSecPerKm: 375, surfaceType: 'ROAD' }, weather: { temperatureC: 27, apparentTemperatureC: 30, relativeHumidity: 78, windSpeedKmh: 6, isExtremeHeat: true }, hrStreamAvg: 158 },
  { activity: { id: 'w5_2', userId: 'u1', sportType: 'RUN', title: 'Akşamüstü Kolay', startTime: '2026-05-05T18:00:00Z', elapsedTimeSec: 2400, movingTimeSec: 2400, distanceMeters: 6800, elevationGainMeters: 15, hasHeartRate: true, avgHr: 144, maxHr: 151, avgCadence: 168, avgPaceSecPerKm: 352, gapSecPerKm: 352, surfaceType: 'ROAD' }, weather: { temperatureC: 22, apparentTemperatureC: 22, relativeHumidity: 60, windSpeedKmh: 8 }, hrStreamAvg: 144 },
  { activity: { id: 'w6_1', userId: 'u1', sportType: 'RUN', title: 'Nemli Sabah Koşusu', startTime: '2026-05-10T07:30:00Z', elapsedTimeSec: 2700, movingTimeSec: 2700, distanceMeters: 7200, elevationGainMeters: 15, hasHeartRate: true, avgHr: 160, maxHr: 168, avgCadence: 166, avgPaceSecPerKm: 375, gapSecPerKm: 375, surfaceType: 'ROAD' }, weather: { temperatureC: 26, apparentTemperatureC: 29, relativeHumidity: 82, windSpeedKmh: 4, isExtremeHeat: true }, hrStreamAvg: 160 },
  { activity: { id: 'w6_2', userId: 'u1', sportType: 'RUN', title: 'Sensör Kilitlendi', startTime: '2026-05-12T07:00:00Z', elapsedTimeSec: 2400, movingTimeSec: 2400, distanceMeters: 6900, elevationGainMeters: 10, hasHeartRate: true, avgHr: 168, maxHr: 168, avgCadence: 168, avgPaceSecPerKm: 347, gapSecPerKm: 347, surfaceType: 'ROAD' }, weather: { temperatureC: 20, apparentTemperatureC: 20, relativeHumidity: 55, windSpeedKmh: 10 }, hrStreamAvg: 168 },

  // Hafta 7-8: Yaz Dönemi ve Yürü-Koş
  { activity: { id: 'w7_1', userId: 'u1', sportType: 'RUN', title: 'Sıcakta Yürü-Koş', startTime: '2026-05-18T10:00:00Z', elapsedTimeSec: 2400, movingTimeSec: 2400, distanceMeters: 6000, elevationGainMeters: 15, hasHeartRate: true, avgHr: 139, maxHr: 150, avgCadence: 154, avgPaceSecPerKm: 400, gapSecPerKm: 400, surfaceType: 'ROAD' }, weather: { temperatureC: 25, apparentTemperatureC: 27, relativeHumidity: 65, windSpeedKmh: 10 }, hrStreamAvg: 139 },
  { activity: { id: 'w7_2', userId: 'u1', sportType: 'RUN', title: 'Tempolu Kaçamak', startTime: '2026-05-20T07:00:00Z', elapsedTimeSec: 2400, movingTimeSec: 2400, distanceMeters: 7500, elevationGainMeters: 15, hasHeartRate: true, avgHr: 172, maxHr: 180, avgCadence: 173, avgPaceSecPerKm: 320, gapSecPerKm: 320, surfaceType: 'ROAD' }, weather: { temperatureC: 21, apparentTemperatureC: 21, relativeHumidity: 60, windSpeedKmh: 10 }, hrStreamAvg: 172 },
  { activity: { id: 'w8_1', userId: 'u1', sportType: 'RUN', title: 'Sabah Sınırda Kaldı', startTime: '2026-05-24T07:00:00Z', elapsedTimeSec: 2700, movingTimeSec: 2700, distanceMeters: 7400, elevationGainMeters: 20, hasHeartRate: true, avgHr: 147, maxHr: 153, avgCadence: 167, avgPaceSecPerKm: 364, gapSecPerKm: 364, surfaceType: 'ROAD' }, weather: { temperatureC: 20, apparentTemperatureC: 20, relativeHumidity: 62, windSpeedKmh: 6 }, hrStreamAvg: 147 },
  { activity: { id: 'w8_2', userId: 'u1', sportType: 'RUN', title: 'Harika Zone 2', startTime: '2026-05-27T07:00:00Z', elapsedTimeSec: 2400, movingTimeSec: 2400, distanceMeters: 6700, elevationGainMeters: 10, hasHeartRate: true, avgHr: 138, maxHr: 145, avgCadence: 167, avgPaceSecPerKm: 358, gapSecPerKm: 358, surfaceType: 'ROAD' }, weather: { temperatureC: 19, apparentTemperatureC: 19, relativeHumidity: 55, windSpeedKmh: 8 }, hrStreamAvg: 138 }
];

async function runValidation() {
  console.log('========================================================================');
  console.log('KOŞU ŞİDDETİ ASİSTANI — FAZ 1.5 GERÇEKÇİ GEÇMİŞ DOĞRULAMA RAPORU');
  console.log('========================================================================\n');

  const streamMap = new Map<string, StreamPoint[]>();
  const allActs = mockHistory.map(m => m.activity);

  // Stream'leri oluştur
  for (const item of mockHistory) {
    const isCadenceLock = item.activity.id === 'w6_2';
    const stream = makeStream(
      item.activity.movingTimeSec,
      item.hrStreamAvg,
      item.activity.gapSecPerKm,
      isCadenceLock ? 168 : item.activity.avgCadence
    );
    if (isCadenceLock) {
      for (const p of stream) { p.hr = 168; p.cad = 168; }
    }
    if (item.activity.id === 'w7_1') {
      // Yürüyüş molaları ekle
      for (const p of stream) {
        if (p.t >= 400 && p.t <= 550) { p.cad = 95; p.hr = 120; p.gap = 800; }
      }
    }
    streamMap.set(item.activity.id, stream);
  }

  // İlk Eşik Türetimi (Apple VO2max 48 ve Dinlenik Nabız 50)
  let currentThresholds: UserThresholds = deriveThresholds({
    userId: 'u1',
    activities: allActs.slice(0, 4),
    streams: streamMap,
    appleMetrics: { vo2MaxMlPerKgMin: 48, restingHeartRate: 50, age: 32 }
  });

  const judgmentCounts: Record<string, number> = {
    ACCORDING_TO_PLAN: 0,
    DRIFTED_GRAY: 0,
    DRIFTED_THRESHOLD: 0,
    WEATHER_PARDON: 0,
    BOUNDARY_ZONE: 0,
    QUALITY_SUCCESS: 0,
    UNDER_STIMULATED: 0,
    OBSERVATION_ONLY: 0
  };

  const thresholdHistory: Array<{ date: string; aetPoint: number; aetMargin: number; method: string; conf: number }> = [];

  console.log('KOŞU BAZLI DEĞERLENDİRME ÇIKTILARI:\n');

  for (let i = 0; i < mockHistory.length; i++) {
    const item = mockHistory[i];

    // Her 4 koşuda bir eşikleri yeniden türet (Eşik stabilitesi testi)
    if (i > 0 && i % 4 === 0) {
      currentThresholds = deriveThresholds({
        userId: 'u1',
        activities: allActs.slice(0, i),
        streams: streamMap,
        appleMetrics: { vo2MaxMlPerKgMin: 48, restingHeartRate: 50, age: 32 }
      });
      thresholdHistory.push({
        date: item.activity.startTime.split('T')[0],
        aetPoint: currentThresholds.aerobicThresholdHrPoint,
        aetMargin: currentThresholds.aerobicThresholdHrMargin,
        method: currentThresholds.derivationMethod,
        conf: currentThresholds.confidenceScore
      });
    }

    const stream = streamMap.get(item.activity.id)!;
    const assessment = evaluateActivity({
      activity: item.activity,
      stream,
      thresholds: currentThresholds,
      weather: item.weather
    });

    judgmentCounts[assessment.analysisJudgment] = (judgmentCounts[assessment.analysisJudgment] || 0) + 1;

    console.log(`[${item.activity.startTime.split('T')[0]}] ${item.activity.title.padEnd(26)} | Nabız: ${item.activity.avgHr} bpm | Hüküm: ${assessment.analysisJudgment.padEnd(18)} | Şablon: ${assessment.templateId}`);
    console.log(`  -> "${assessment.outputSentence}"`);
    console.log('');
  }

  // -------------------------------------------------------------
  // TOPLU SAĞLIK VE A PRİORİ KRİTER KONTROLÜ
  // -------------------------------------------------------------
  const totalRuns = mockHistory.length;
  const easyAndGray = (judgmentCounts.DRIFTED_GRAY + judgmentCounts.DRIFTED_THRESHOLD);
  const easyAndGrayPct = Math.round((easyAndGray / totalRuns) * 100);
  const onTrackPct = Math.round((judgmentCounts.ACCORDING_TO_PLAN / totalRuns) * 100);
  const boundaryPct = Math.round((judgmentCounts.BOUNDARY_ZONE / totalRuns) * 100);
  const weatherPardonCount = judgmentCounts.WEATHER_PARDON;

  console.log('========================================================================');
  console.log('TOPLU SAĞLIK VE A PRİORİ KRİTER DENETİMİ');
  console.log('========================================================================\n');

  console.log(`Toplam Koşu Sayısı         : ${totalRuns}`);
  console.log(`Kusursuz Kolay (ON_TRACK)  : ${judgmentCounts.ACCORDING_TO_PLAN} (%${onTrackPct})`);
  console.log(`Eşik/Gri Sapma (DRIFTED)   : ${easyAndGray} (%${easyAndGrayPct})`);
  console.log(`Sınırda / Belirsiz Koridor : ${judgmentCounts.BOUNDARY_ZONE} (%${boundaryPct})`);
  console.log(`Sıcak Hava Beraati         : ${judgmentCounts.WEATHER_PARDON}`);
  console.log(`Kaliteli Seans Başarılı    : ${judgmentCounts.QUALITY_SUCCESS}`);
  console.log('');

  console.log('A PRİORİ KABUL KRİTERLERİ DEĞERLENDİRMESİ:');
  
  const check1 = easyAndGrayPct >= 30 && easyAndGrayPct <= 65;
  console.log(`[${check1 ? 'GEÇTİ' : 'KALDI'}] 1. Hüküm Dağılımı Denge Bandı (%30 - %65 arası): Gerçekleşen %${easyAndGrayPct}`);

  const check2 = onTrackPct >= 20 && onTrackPct <= 50;
  console.log(`[${check2 ? 'GEÇTİ' : 'KALDI'}] 2. Başarılı Kolay Koşu Oranı (%20 - %50 arası): Gerçekleşen %${onTrackPct}`);

  const check3 = boundaryPct >= 10 && boundaryPct <= 25;
  console.log(`[${check3 ? 'GEÇTİ' : 'KALDI'}] 3. Belirsiz Sınır Koridoru Oranı (%10 - %25 arası): Gerçekleşen %${boundaryPct}`);

  const check4 = weatherPardonCount >= 1 && weatherPardonCount <= 4;
  console.log(`[${check4 ? 'GEÇTİ' : 'KALDI'}] 4. Sıcak Hava Beraati Tetiklenmesi (1 - 4 arası): Gerçekleşen ${weatherPardonCount}`);

  console.log('\nEŞİK KARARLILIĞI (ZAMAN İÇİNDE KAYMA RAPORU):');
  for (const th of thresholdHistory) {
    console.log(`- ${th.date}: AeT = ${th.aetPoint} bpm (±${th.aetMargin} bpm) | Metot: ${th.method} | Güven: ${th.conf}`);
  }

  const allPassed = check1 && check2 && check3 && check4;
  console.log(`\nGENEL DOĞRULAMA KARARI: ${allPassed ? 'ONAYLANDI (Motor Gerçekçi Veride Sağlıklı)' : 'REDDEDİLDİ (Kalibrasyon Gözden Geçirilmeli)'}`);
  console.log('========================================================================\n');
}

runValidation().catch(console.error);
