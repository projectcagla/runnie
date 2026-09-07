import type { 
  NormalizedActivity, 
  StreamPoint, 
  UserThresholds, 
  WeatherSnapshot 
} from '../src/types.ts';

export const standardThresholds: UserThresholds = {
  id: 'thresh_standard_1',
  userId: 'user_1',
  validFrom: '2026-01-01T00:00:00Z',
  hrMaxEstimated: 190,
  hrRest: 50,
  lthr: 172,
  aerobicThresholdHrPoint: 145,
  aerobicThresholdHrMargin: 3,
  aerobicThresholdHrMin: 142,
  aerobicThresholdHrMax: 148,
  thresholdPaceGapSecPerKm: 270, // 4:30/km
  easyPaceCeilingGapSecPerKm: 330, // 5:30/km
  derivationMethod: 'EMPIRICAL_PACE_HR_MAPPING',
  confidenceScore: 0.85,
  calibrationStatus: 'CALIBRATED'
};

export const lowConfidenceThresholds: UserThresholds = {
  ...standardThresholds,
  id: 'thresh_low_conf',
  aerobicThresholdHrMargin: 7,
  aerobicThresholdHrMin: 138,
  aerobicThresholdHrMax: 152,
  derivationMethod: 'UNVERIFIED_ESTIMATE',
  confidenceScore: 0.40,
  calibrationStatus: 'CALIBRATING'
};

export const standardWeather: WeatherSnapshot = {
  temperatureC: 18.0,
  apparentTemperatureC: 18.0,
  relativeHumidity: 55,
  windSpeedKmh: 10.0
};

export const hotHumidWeather: WeatherSnapshot = {
  temperatureC: 29.0,
  apparentTemperatureC: 33.0,
  relativeHumidity: 80,
  windSpeedKmh: 8.0,
  isExtremeHeat: true
};

// Stream oluşturma yardımcısı
export function createSyntheticStream(
  durationSec: number, 
  targetHr: number, 
  targetPace: number, 
  targetCadence = 168
): StreamPoint[] {
  const points: StreamPoint[] = [];
  for (let t = 0; t <= durationSec; t += 10) {
    points.push({
      t,
      hr: targetHr + Math.floor(Math.sin(t / 60) * 3), // +-3 bpm dalgalanma
      cad: targetCadence,
      gap: targetPace,
      dist: Math.round((t / 3600) * (3600 / targetPace) * 1000)
    });
  }
  return points;
}

// -------------------------------------------------------------
// 17 SENTETİK KENAR DURUM AKTİVİTELERİ (FIXTURES)
// -------------------------------------------------------------

// 1. Grup Koşusu (athletesCount > 1)
export const fixtureGroupRun: NormalizedActivity = {
  id: 'act_group_run',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Kadıköy Salı Grubu Koşusu',
  startTime: '2026-05-12T19:30:00Z',
  elapsedTimeSec: 2400,
  movingTimeSec: 2400,
  distanceMeters: 7500,
  elevationGainMeters: 40,
  hasHeartRate: true,
  avgHr: 162, // Eşiğe yakın
  maxHr: 175,
  avgCadence: 170,
  avgPaceSecPerKm: 320,
  gapSecPerKm: 320,
  surfaceType: 'ROAD',
  athletesCount: 12
};

// 2. Resmi Yarış (workoutType = 1)
export const fixtureRace: NormalizedActivity = {
  id: 'act_race',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'İstanbul 10K Yarışı',
  startTime: '2026-04-19T09:00:00Z',
  elapsedTimeSec: 2700,
  movingTimeSec: 2700,
  distanceMeters: 10000,
  elevationGainMeters: 30,
  hasHeartRate: true,
  avgHr: 176,
  maxHr: 188,
  avgCadence: 180,
  avgPaceSecPerKm: 270,
  gapSecPerKm: 270,
  surfaceType: 'ROAD',
  workoutType: 1
};

// 3. Patika / Teknik Zemin (TRAIL)
export const fixtureTrailRun: NormalizedActivity = {
  id: 'act_trail',
  userId: 'user_1',
  sportType: 'TRAIL_RUN',
  title: 'Belgrad Ormanı Patika Koşusu',
  startTime: '2026-05-16T08:30:00Z',
  elapsedTimeSec: 3600,
  movingTimeSec: 3600,
  distanceMeters: 9000,
  elevationGainMeters: 350, // 39 m/km tırmanış
  hasHeartRate: true,
  avgHr: 142,
  maxHr: 160,
  avgCadence: 162,
  avgPaceSecPerKm: 400,
  gapSecPerKm: 340,
  surfaceType: 'TRAIL'
};

// 4. Koşu Bandı (Treadmill, GPS yok)
export const fixtureTreadmill: NormalizedActivity = {
  id: 'act_treadmill',
  userId: 'user_1',
  sportType: 'TREADMILL_RUN',
  title: 'Salonda Koşu Bandı',
  startTime: '2026-05-18T18:00:00Z',
  elapsedTimeSec: 2100,
  movingTimeSec: 2100,
  distanceMeters: 6000,
  elevationGainMeters: 0,
  hasHeartRate: true,
  avgHr: 138,
  maxHr: 144,
  avgCadence: 166,
  avgPaceSecPerKm: 350,
  gapSecPerKm: 350,
  surfaceType: 'TREADMILL'
};

// 5. Yürü-Koş (Jeffing)
export const fixtureWalkBreaks: NormalizedActivity = {
  id: 'act_walk_breaks',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Sabah Yürü-Koş',
  startTime: '2026-05-20T07:00:00Z',
  elapsedTimeSec: 2400,
  movingTimeSec: 2400,
  distanceMeters: 6200,
  elevationGainMeters: 20,
  hasHeartRate: true,
  avgHr: 139,
  maxHr: 152,
  avgCadence: 155,
  avgPaceSecPerKm: 387,
  gapSecPerKm: 387,
  surfaceType: 'ROAD'
};

// 6. Şehir İçi Dur-Kalk & Auto-pause (Elapsed >> Moving)
export const fixtureCityStopAndGo: NormalizedActivity = {
  id: 'act_city_stop',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Şehir İçi Sahil Koşusu',
  startTime: '2026-05-21T07:30:00Z',
  elapsedTimeSec: 3000, // 50 dk
  movingTimeSec: 2100,  // 35 dk hareket (%30 duraklama)
  distanceMeters: 6500,
  elevationGainMeters: 15,
  hasHeartRate: true,
  avgHr: 140,
  maxHr: 148,
  avgCadence: 165,
  avgPaceSecPerKm: 323,
  gapSecPerKm: 323,
  surfaceType: 'ROAD'
};

// 7. Kadans Kilitlenmesi (Cadence Lock: HR == Cadence)
export const fixtureCadenceLock: NormalizedActivity = {
  id: 'act_cadence_lock',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Bilekten Nabız Kilitlenme Testi',
  startTime: '2026-05-22T08:00:00Z',
  elapsedTimeSec: 2400,
  movingTimeSec: 2400,
  distanceMeters: 7000,
  elevationGainMeters: 20,
  hasHeartRate: true,
  avgHr: 168, // Yapay yüksek
  maxHr: 172,
  avgCadence: 168,
  avgPaceSecPerKm: 342, // Aslında kolay tempo
  gapSecPerKm: 342,
  surfaceType: 'ROAD'
};

// 8. Nabız Verisi Yok (Pure GPS)
export const fixtureNoHeartRate: NormalizedActivity = {
  id: 'act_no_hr',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Saat Şarjsız Kolay Koşu',
  startTime: '2026-05-23T08:00:00Z',
  elapsedTimeSec: 2400,
  movingTimeSec: 2400,
  distanceMeters: 6800,
  elevationGainMeters: 25,
  hasHeartRate: false,
  avgPaceSecPerKm: 350,
  gapSecPerKm: 350,
  surfaceType: 'ROAD'
};

// 9. Aşırı Sıcak ve Nem (Weather Pardon Adayı)
export const fixtureHotHumidPardon: NormalizedActivity = {
  id: 'act_hot_humid',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Öğlen Güneşi Koşusu',
  startTime: '2026-07-15T12:00:00Z',
  elapsedTimeSec: 2400,
  movingTimeSec: 2400,
  distanceMeters: 6800,
  elevationGainMeters: 10,
  hasHeartRate: true,
  avgHr: 160, // Eşik bölgesine kaymış
  maxHr: 168,
  avgCadence: 166,
  avgPaceSecPerKm: 355, // Ama tempo kolay (5:55/km > 5:30/km)
  gapSecPerKm: 355,
  surfaceType: 'ROAD'
};

// 10. Güçlü Rüzgar
export const fixtureHighWind: NormalizedActivity = {
  id: 'act_high_wind',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Kuvvetli Lodos Koşusu',
  startTime: '2026-05-24T08:00:00Z',
  elapsedTimeSec: 2400,
  movingTimeSec: 2400,
  distanceMeters: 7000,
  elevationGainMeters: 15,
  hasHeartRate: true,
  avgHr: 144,
  maxHr: 152,
  avgCadence: 168,
  avgPaceSecPerKm: 342,
  gapSecPerKm: 342,
  surfaceType: 'ROAD'
};

// 11. Yüksek Rakım (>1500m)
export const fixtureHighAltitude: NormalizedActivity = {
  id: 'act_altitude',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Erciyes Dağ Eteği Koşusu',
  startTime: '2026-05-25T09:00:00Z',
  elapsedTimeSec: 2400,
  movingTimeSec: 2400,
  distanceMeters: 6500,
  elevationGainMeters: 120,
  hasHeartRate: true,
  avgHr: 148,
  maxHr: 158,
  avgCadence: 165,
  avgPaceSecPerKm: 369,
  gapSecPerKm: 360,
  surfaceType: 'ROAD'
};

// 12. Kısa Koşu (<20 dk, 18 dk)
export const fixtureShortRun: NormalizedActivity = {
  id: 'act_short_run',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Hızlıca Ter Atma',
  startTime: '2026-05-26T18:30:00Z',
  elapsedTimeSec: 1080, // 18 dk
  movingTimeSec: 1080,
  distanceMeters: 3200,
  elevationGainMeters: 10,
  hasHeartRate: true,
  avgHr: 135,
  maxHr: 142,
  avgCadence: 166,
  avgPaceSecPerKm: 337,
  gapSecPerKm: 337,
  surfaceType: 'ROAD'
};

// 13. Çok Kısa Koşu (<15 dk, sessiz kalma eşiği)
export const fixtureUltraShortRun: NormalizedActivity = {
  id: 'act_ultra_short',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Bakkala Koşu',
  startTime: '2026-05-26T18:00:00Z',
  elapsedTimeSec: 600, // 10 dk
  movingTimeSec: 600,
  distanceMeters: 1800,
  elevationGainMeters: 5,
  hasHeartRate: true,
  avgHr: 125,
  avgPaceSecPerKm: 333,
  gapSecPerKm: 333,
  surfaceType: 'ROAD'
};

// 14. Çok Uzun Koşu (>90 dk, Kardiyak Sürüklenme)
export const fixtureVeryLongRun: NormalizedActivity = {
  id: 'act_very_long',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Pazar Uzun Koşusu',
  startTime: '2026-05-27T07:00:00Z',
  elapsedTimeSec: 6000, // 100 dk
  movingTimeSec: 6000,
  distanceMeters: 18000,
  elevationGainMeters: 80,
  hasHeartRate: true,
  avgHr: 146,
  maxHr: 158,
  avgCadence: 168,
  avgPaceSecPerKm: 333,
  gapSecPerKm: 333,
  surfaceType: 'ROAD'
};

// 15. Koşu Dışı Aktivite (Bisiklet)
export const fixtureBikeRide: NormalizedActivity = {
  id: 'act_bike',
  userId: 'user_1',
  sportType: 'OTHER',
  title: 'Sahil Bisiklet Turu',
  startTime: '2026-05-28T10:00:00Z',
  elapsedTimeSec: 3600,
  movingTimeSec: 3600,
  distanceMeters: 25000,
  elevationGainMeters: 50,
  hasHeartRate: true,
  avgHr: 128,
  avgPaceSecPerKm: 144,
  gapSecPerKm: 144,
  surfaceType: 'ROAD'
};

// 16. Mükemmel Kolay Koşu (Zone 1 > %85)
export const fixturePerfectEasyRun: NormalizedActivity = {
  id: 'act_perfect_easy',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Sabah Kolay Toparlanma Koşusu',
  startTime: '2026-05-29T07:00:00Z',
  elapsedTimeSec: 2400,
  movingTimeSec: 2400,
  distanceMeters: 6800,
  elevationGainMeters: 15,
  hasHeartRate: true,
  avgHr: 136, // AeT 145'in oldukça altında
  maxHr: 142,
  avgCadence: 168,
  avgPaceSecPerKm: 350,
  gapSecPerKm: 350,
  surfaceType: 'ROAD'
};

// 17. Başarısız Kolay Koşu (Eşik Bölgesine Kaymış, Zone 3 > %40)
export const fixtureFailedEasyRun: NormalizedActivity = {
  id: 'act_failed_easy',
  userId: 'user_1',
  sportType: 'RUN',
  title: 'Görünürde Kolay Ama Çok Hızlı Koşu',
  startTime: '2026-05-30T07:00:00Z',
  elapsedTimeSec: 2400,
  movingTimeSec: 2400,
  distanceMeters: 8500,
  elevationGainMeters: 15,
  hasHeartRate: true,
  avgHr: 174, // LTHR 172'nin üstünde!
  maxHr: 182,
  avgCadence: 174,
  avgPaceSecPerKm: 282, // Hızlı tempo
  gapSecPerKm: 282,
  surfaceType: 'ROAD'
};
