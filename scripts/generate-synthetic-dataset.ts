import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * KOŞU ŞİDDETİ ASİSTANI — SENTETİK VERİ ÜRETECİ
 * 
 * DİKKAT: Bu betik tarafından üretilen veriler YALNIZCA UÇTAN UCA HATTI VE SÖZDİZİMİNİ
 * SINAMAK İÇİN ÜRETİLMİŞ SENTETİK VERİLERDİR. DOĞRULAMA VEYA BAŞARI KANITI SAYILMAZ.
 * Gerçek dünya doğrulaması yalnızca kullanıcının kendi Apple Health dışa aktarımı ve
 * bizzat koşucunun vereceği yer gerçeği etiketleriyle yapılabilir.
 */

interface SyntheticStreamPoint {
  t: number;
  hr?: number;
  cad?: number;
  gap?: number;
  alt?: number;
  dist?: number;
}

interface SyntheticWorkout {
  activity: {
    id: string;
    userId: string;
    sportType: string;
    surfaceType: string;
    title: string;
    startTime: string;
    elapsedTimeSec: number;
    movingTimeSec: number;
    distanceMeters: number;
    elevationGainMeters: number;
    hasHeartRate: boolean;
    avgHr?: number;
    maxHr?: number;
    avgCadence?: number;
    avgPaceSecPerKm: number;
    gapSecPerKm: number;
    sourceName: string;
    paceSource: string;
    hasInstantaneousPace: boolean;
    startLatitude?: number;
    startLongitude?: number;
  };
  stream: SyntheticStreamPoint[];
}

export function generateSyntheticWorkouts(): SyntheticWorkout[] {
  const workouts: SyntheticWorkout[] = [];
  const baseTime = new Date('2026-08-01T07:00:00.000Z').getTime();

  // 1. Plana Tam Uygun Kolay Koşu (ACCORDING_TO_PLAN)
  // Süre: 40 dk (2400 sn), AeT: 142 bpm. Nabız 130-138 bpm bandında sabit.
  {
    const duration = 2400;
    const stream: SyntheticStreamPoint[] = [];
    let dist = 0;
    for (let t = 0; t <= duration; t += 10) {
      const hr = t < 300 ? 120 + Math.round((t / 300) * 15) : 133 + (t % 5);
      dist += 28; // ~357 sn/km (5:57/km)
      stream.push({ t, hr, cad: 168 + (t % 4), gap: 357, dist });
    }
    workouts.push({
      activity: {
        id: 'syn_easy_plan_001',
        userId: 'synthetic_runner',
        sportType: 'RUN',
        surfaceType: 'ROAD',
        title: 'Sabah Kolay Koşusu',
        startTime: new Date(baseTime).toISOString(),
        elapsedTimeSec: duration,
        movingTimeSec: duration,
        distanceMeters: 6720,
        elevationGainMeters: 18,
        hasHeartRate: true,
        avgHr: 134,
        maxHr: 140,
        avgCadence: 170,
        avgPaceSecPerKm: 357,
        gapSecPerKm: 357,
        sourceName: 'Apple Watch Series 8',
        paceSource: 'RUNNING_SPEED',
        hasInstantaneousPace: true,
        startLatitude: 41.0082,
        startLongitude: 28.9784
      },
      stream
    });
  }

  // 2. Gri Bölgeye Sapan Koşu (DRIFTED_GRAY)
  // Süre: 45 dk (2700 sn). İlk 15 dk kolay, 2. yarıda nabız 152-158 bpm'e fırlıyor (AeT aşımı).
  {
    const duration = 2700;
    const stream: SyntheticStreamPoint[] = [];
    let dist = 0;
    for (let t = 0; t <= duration; t += 10) {
      let hr = 135;
      let gap = 350;
      if (t > 900) {
        // İkinci yarıda belirgin kardiyak drift ve tempo artışı
        hr = 148 + Math.min(12, Math.round(((t - 900) / 1800) * 12));
        gap = 325; // 5:25/km
      }
      dist += Math.round(10000 / gap);
      stream.push({ t, hr, cad: 172, gap, dist });
    }
    workouts.push({
      activity: {
        id: 'syn_drifted_gray_002',
        userId: 'synthetic_runner',
        sportType: 'RUN',
        surfaceType: 'ROAD',
        title: 'Akşam Park Koşusu',
        startTime: new Date(baseTime + 2 * 86400000).toISOString(),
        elapsedTimeSec: duration,
        movingTimeSec: duration,
        distanceMeters: 8100,
        elevationGainMeters: 22,
        hasHeartRate: true,
        avgHr: 149,
        maxHr: 161,
        avgCadence: 172,
        avgPaceSecPerKm: 333,
        gapSecPerKm: 333,
        sourceName: 'Apple Watch Series 8',
        paceSource: 'RUNNING_SPEED',
        hasInstantaneousPace: true,
        startLatitude: 41.0082,
        startLongitude: 28.9784
      },
      stream
    });
  }

  // 3. Sıcak Havada Disiplinli Koşu (WEATHER_PARDON)
  // 30°C / %80 nem. Tempo disiplinli şekilde 6:30/km'de tutulmuş ama nabız ısı sebebiyle 149 bpm'e çıkmış.
  {
    const duration = 2100;
    const stream: SyntheticStreamPoint[] = [];
    let dist = 0;
    for (let t = 0; t <= duration; t += 10) {
      const hr = t < 300 ? 128 : 148 + (t % 3);
      dist += 25; // ~390 sn/km (6:30/km)
      stream.push({ t, hr, cad: 164, gap: 390, dist });
    }
    workouts.push({
      activity: {
        id: 'syn_heat_pardon_003',
        userId: 'synthetic_runner',
        sportType: 'RUN',
        surfaceType: 'ROAD',
        title: 'Öğle Sıcağında Kolay Koşu',
        startTime: new Date(baseTime + 4 * 86400000).toISOString(),
        elapsedTimeSec: duration,
        movingTimeSec: duration,
        distanceMeters: 5380,
        elevationGainMeters: 10,
        hasHeartRate: true,
        avgHr: 147,
        maxHr: 152,
        avgCadence: 164,
        avgPaceSecPerKm: 390,
        gapSecPerKm: 390,
        sourceName: 'Apple Watch Ultra',
        paceSource: 'RUNNING_SPEED',
        hasInstantaneousPace: true,
        startLatitude: 41.0082,
        startLongitude: 28.9784
      },
      stream
    });
  }

  // 4. Akış İçi İnterval Seansı (QUALITY / INTERVAL)
  // Başlıkta "Hafif Koşu" yazıyor olsa dahi akışta 5 tekrar hızlı patlama var (270 sn/km).
  {
    const duration = 2400;
    const stream: SyntheticStreamPoint[] = [];
    let dist = 0;
    for (let t = 0; t <= duration; t += 10) {
      const isInterval = (t >= 600 && t < 720) || (t >= 900 && t < 1020) || 
                         (t >= 1200 && t < 1320) || (t >= 1500 && t < 1620) || 
                         (t >= 1800 && t < 1920);
      const hr = isInterval ? 172 : 136;
      const gap = isInterval ? 260 : 380;
      dist += Math.round(10000 / gap);
      stream.push({ t, hr, cad: isInterval ? 188 : 166, gap, dist });
    }
    workouts.push({
      activity: {
        id: 'syn_interval_hidden_004',
        userId: 'synthetic_runner',
        sportType: 'RUN',
        surfaceType: 'ROAD',
        title: 'Hafif Sabah Koşusu', // Yanıltıcı başlık
        startTime: new Date(baseTime + 6 * 86400000).toISOString(),
        elapsedTimeSec: duration,
        movingTimeSec: duration,
        distanceMeters: 7200,
        elevationGainMeters: 15,
        hasHeartRate: true,
        avgHr: 150,
        maxHr: 176,
        avgCadence: 174,
        avgPaceSecPerKm: 333,
        gapSecPerKm: 333,
        sourceName: 'Garmin Forerunner 955',
        paceSource: 'RUNNING_SPEED',
        hasInstantaneousPace: true,
        startLatitude: 41.0082,
        startLongitude: 28.9784
      },
      stream
    });
  }

  // 5. Mükerrer Çift (Apple Watch Donanımı vs Strava Köprüsü)
  {
    const startTime = new Date(baseTime + 8 * 86400000).toISOString();
    // Kopya 1: Donanım Apple Watch (Daha zengin sensör verisi)
    workouts.push({
      activity: {
        id: 'syn_dup_apple_watch_005a',
        userId: 'synthetic_runner',
        sportType: 'RUN',
        surfaceType: 'ROAD',
        title: 'Caddebostan Sahil Koşusu',
        startTime,
        elapsedTimeSec: 1800,
        movingTimeSec: 1800,
        distanceMeters: 5000,
        elevationGainMeters: 8,
        hasHeartRate: true,
        avgHr: 138,
        maxHr: 144,
        avgCadence: 170,
        avgPaceSecPerKm: 360,
        gapSecPerKm: 360,
        sourceName: 'Apple Watch Series 8',
        paceSource: 'RUNNING_SPEED',
        hasInstantaneousPace: true,
        startLatitude: 40.9632,
        startLongitude: 29.0621
      },
      stream: [
        { t: 0, hr: 122, cad: 165, gap: 370, dist: 0 },
        { t: 900, hr: 138, cad: 170, gap: 360, dist: 2500 },
        { t: 1800, hr: 142, cad: 171, gap: 358, dist: 5000 }
      ]
    });

    // Kopya 2: Strava (10 saniye sonra kaydedilmiş, sensörsüz üçüncü taraf kopya)
    workouts.push({
      activity: {
        id: 'syn_dup_strava_005b',
        userId: 'synthetic_runner',
        sportType: 'RUN',
        surfaceType: 'ROAD',
        title: 'Morning Run with Strava',
        startTime: new Date(new Date(startTime).getTime() + 10000).toISOString(),
        elapsedTimeSec: 1795,
        movingTimeSec: 1795,
        distanceMeters: 4985, // %0.3 fark
        elevationGainMeters: 8,
        hasHeartRate: false, // Sensörsüz
        avgPaceSecPerKm: 360,
        gapSecPerKm: 360,
        sourceName: 'Strava',
        paceSource: 'ACTIVITY_AVERAGE',
        hasInstantaneousPace: false
      },
      stream: []
    });
  }

  return workouts;
}

async function main() {
  const outputDir = path.join(process.cwd(), 'data');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'synthetic_test_activities.json');
  const dataset = generateSyntheticWorkouts();

  writeFileSync(outputPath, JSON.stringify({ activities: dataset }, null, 2), 'utf-8');

  console.log('========================================================================');
  console.log('KOŞU ŞİDDETİ ASİSTANI — SENTETİK VERİ ÜRETECİ');
  console.log('========================================================================');
  console.log(`Hedef Dosya: ${outputPath}`);
  console.log(`Üretilen Aktivite Sayısı: ${dataset.length}`);
  console.log('Kapsanan Senaryolar:');
  console.log('  1. syn_easy_plan_001:       Plana uygun aerobik kolay koşu (AeT altı)');
  console.log('  2. syn_drifted_gray_002:    İkinci yarıda eşiği aşan gri bölge koşusu');
  console.log('  3. syn_heat_pardon_003:     Sıcaklık stresi altında korunan tempo (Beraat)');
  console.log('  4. syn_interval_hidden_004: Akış içi varyanstan tespit edilen interval seansı');
  console.log('  5. syn_dup_apple_watch_005a: Mükerrer çift (Donanım Apple Watch - Korunmalı)');
  console.log('  6. syn_dup_strava_005b:      Mükerrer çift (Strava köprüsü - İşaretlenmeli)');
  console.log('========================================================================');
  console.log('NOT: Bu veri sentetiktir; yalnızca sunucu ve kuyruk hattını denemek içindir.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
