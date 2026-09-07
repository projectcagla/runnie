import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import * as path from 'node:path';
import type { 
  NormalizedActivity, 
  StreamPoint, 
  AppleHealthMetrics, 
  SurfaceType,
  SportType 
} from '../types.ts';

export type PaceSource = 'RUNNING_SPEED' | 'GPX_TRACKPOINT' | 'DISTANCE_INTERVAL' | 'ACTIVITY_AVERAGE';

export interface HealthHistoricalRecord {
  date: Date;
  value: number;
}

export interface AdvancedRunningMetricsCount {
  runningSpeed: number;
  runningPower: number;
  runningStrideLength: number;
  runningGroundContactTime: number;
  runningVerticalOscillation: number;
  distanceWalkingRunning: number;
}

export interface SourceAppBreakdown {
  sourceName: string;
  totalWorkouts: number;
  outdoorCount: number;
  indoorCount: number;
  withHeartRate: number;
  withCadence: number;
  withGpxRoute: number;
  withRunningSpeed: number;
  withDistanceIntervals: number;
}

export interface DuplicateWorkoutPair {
  workout1: { id: string; source: string; startTime: string; distanceMeters: number };
  workout2: { id: string; source: string; startTime: string; distanceMeters: number };
  timeDiffSec: number;
  distanceDiffMeters: number;
  winnerSource?: string;
}

export interface DateParsingSample {
  rawString: string;
  parsedUtcIso: string;
  parsedLocalString: string;
}

export interface ParserTelemetry {
  fileSizeBytes: number;
  parseTimeMs: number;
  peakRssMb: number;
  totalRunningWorkouts: number;
  dateRange: { minDate?: string; maxDate?: string };
  outdoorCount: number;
  indoorCount: number;
  
  // Kalp Atım Hızı Kapsamı
  workoutsWithHeartRate: number;
  hrSampleIntervalStats: { avgSec: number; medianSec: number };
  totalHeartRateRecordsInExport: number;
  workoutHeartRateRecordsCaptured: number;
  hrWorkoutCoverageRatioPct: number;
  lowHrCoverageWorkoutsCount: number; // Nabız kapsama oranı <%50 olan seanslar
  
  // Kadans ve Adım
  workoutsWithCadence: number;
  
  // 3 Kademeli Hız & Tempo Hiyerarşisi
  paceSourceBreakdown: {
    runningSpeedCount: number;      // Kademe 1: HKQuantityTypeIdentifierRunningSpeed
    gpxTrackpointCount: number;     // Kademe 2: workout-routes/*.gpx
    distanceIntervalCount: number;  // Kademe 3: HKQuantityTypeIdentifierDistanceWalkingRunning
    activityAverageCount: number;   // Kademe 4: Düz ortalama hız (fallback)
  };

  // İleri Düzey Koşu Metrikleri Envanteri
  advancedRunningMetricsInExport: AdvancedRunningMetricsCount;

  // GPX Klasör Durumu
  gpxFilesFound: number;
  workoutsWithGpxRoute: number;

  // Kaynak Uygulama Dağılımı (Apple Watch, Garmin, Strava vb.)
  sourceAppBreakdown: SourceAppBreakdown[];

  // Mükerrer Antrenman Tespiti (Örn: Hem Saat Hem Strava yazmışsa)
  duplicateWorkoutsFound: DuplicateWorkoutPair[];

  // Zaman Dilimi & Tarih Doğrulama Örnekleri
  dateParsingSamples: DateParsingSample[];

  // VO2Max & Dinlenik Nabız
  vo2MaxRecordCount: number;
  restingHrRecordCount: number;
}

export interface ParsedHealthData {
  activities: NormalizedActivity[];
  streams: Map<string, StreamPoint[]>;
  appleMetrics: AppleHealthMetrics;
  historicalVo2Max: HealthHistoricalRecord[];
  historicalRestingHr: HealthHistoricalRecord[];
  telemetry: ParserTelemetry;
}

export interface AppleHealthParserOptions {
  xmlFilePath: string;
  routesDirPath?: string;
  onProgress?: (stage: string, percent?: number) => void;
}

interface RawWorkoutInternal {
  id: string;
  sourceName: string;
  rawStartDateString: string;
  startDate: Date;
  endDate: Date;
  startMs: number;
  endMs: number;
  durationSec: number;
  distanceMeters: number;
  isIndoor: boolean;
  routeFilePath?: string;
  
  // Akış Seans Verileri
  hrSamples: Array<{ tMs: number; hr: number }>;
  stepSamples: Array<{ startMs: number; endMs: number; steps: number }>;
  speedSamples: Array<{ tMs: number; speedMps: number }>;
  distanceSamples: Array<{ startMs: number; endMs: number; distanceMeters: number }>;
}

interface GpxTrackpoint {
  lat: number;
  lon: number;
  ele: number;
  timeMs: number;
}

interface ParsedGpxData {
  trackpoints: GpxTrackpoint[];
  totalElevationGainMeters: number;
  startLatitude: number;
  startLongitude: number;
  sampleIntervalSec: number;
}

/**
 * Haversine Formülü ile İki GPS Koordinatı Arasındaki Mesafeyi (Metre) Hesaplar.
 */
export function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Minetti et al. (2002) Eğim Düzeltmeli Enerji Maliyet Katsayısı (Cost Factor).
 */
export function calculateMinettiCostFactor(grade: number): number {
  const g = Math.max(-0.35, Math.min(0.35, grade));
  const c = 155.4 * Math.pow(g, 5) - 30.4 * Math.pow(g, 4) - 43.3 * Math.pow(g, 3) + 46.3 * Math.pow(g, 2) + 19.5 * g + 3.6;
  return Math.max(0.55, Math.min(2.5, c / 3.6));
}

/**
 * Tek Bir GPX Dosyasını Okuyup Anlık Konum, Hız, Yükseklik ve GAP Serisini Çıkarır.
 */
export async function parseGpxRouteFile(filePath: string): Promise<ParsedGpxData | undefined> {
  if (!existsSync(filePath)) return undefined;

  const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  const trackpoints: GpxTrackpoint[] = [];
  let buffer = '';
  let inTrkpt = false;

  for await (const line of rl) {
    if (line.includes('<trkpt')) {
      inTrkpt = true;
      buffer = line;
    } else if (inTrkpt) {
      buffer += ' ' + line;
    }

    if (inTrkpt && line.includes('</trkpt>')) {
      inTrkpt = false;
      const latMatch = buffer.match(/lat="([^"]+)"/);
      const lonMatch = buffer.match(/lon="([^"]+)"/);
      const eleMatch = buffer.match(/<ele>([^<]+)<\/ele>/);
      const timeMatch = buffer.match(/<time>([^<]+)<\/time>/);

      if (latMatch && lonMatch && timeMatch) {
        const lat = parseFloat(latMatch[1]);
        const lon = parseFloat(lonMatch[1]);
        const ele = eleMatch ? parseFloat(eleMatch[1]) : 0;
        const timeMs = new Date(timeMatch[1]).getTime();

        if (!isNaN(lat) && !isNaN(lon) && !isNaN(timeMs)) {
          trackpoints.push({ lat, lon, ele, timeMs });
        }
      }
      buffer = '';
    }
  }

  if (trackpoints.length < 2) return undefined;

  let totalElevationGainMeters = 0;
  let prevEle = trackpoints[0].ele;
  let timeDiffSum = 0;

  for (let i = 1; i < trackpoints.length; i++) {
    const dEle = trackpoints[i].ele - prevEle;
    if (dEle >= 0.5) {
      totalElevationGainMeters += dEle;
      prevEle = trackpoints[i].ele;
    } else if (dEle <= -0.5) {
      prevEle = trackpoints[i].ele;
    }
    timeDiffSum += (trackpoints[i].timeMs - trackpoints[i - 1].timeMs) / 1000;
  }

  const sampleIntervalSec = trackpoints.length > 1 ? (timeDiffSum / (trackpoints.length - 1)) : 1;

  return {
    trackpoints,
    totalElevationGainMeters: Math.round(totalElevationGainMeters),
    startLatitude: trackpoints[0].lat,
    startLongitude: trackpoints[0].lon,
    sampleIntervalSec: Math.round(sampleIntervalSec * 10) / 10
  };
}

/**
 * Sıralı Antrenmanlar İçinde Verilen Zaman Damgasına Denk Gelen Antrenmanı Binary Search ile Bulur ($O(\log W)$).
 */
function findOverlappingWorkout(workouts: RawWorkoutInternal[], tMs: number, paddingMs = 5000): RawWorkoutInternal | undefined {
  let low = 0;
  let high = workouts.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const w = workouts[mid];

    if (tMs < w.startMs - paddingMs) {
      high = mid - 1;
    } else if (tMs > w.endMs + paddingMs) {
      low = mid + 1;
    } else {
      return w;
    }
  }
  return undefined;
}

/**
 * Üretim Sınıfı Apple Health Dışa Aktarım Ayrıştırıcısı (İki Geçişli Akış Mimarisi).
 */
export async function parseAppleHealthExport(input: AppleHealthParserOptions | string): Promise<ParsedHealthData> {
  const options: AppleHealthParserOptions = typeof input === 'string' ? { xmlFilePath: input } : input;
  const startTime = Date.now();
  let peakRss = process.memoryUsage().rss;

  const updatePeakRss = () => {
    const cur = process.memoryUsage().rss;
    if (cur > peakRss) peakRss = cur;
  };

  const fileStats = statSync(options.xmlFilePath);
  const fileSizeBytes = fileStats.size;
  const baseDir = path.dirname(options.xmlFilePath);
  const routesDir = options.routesDirPath || path.join(baseDir, 'workout-routes');
  const hasRoutesDir = existsSync(routesDir);

  // =========================================================================
  // GEÇİŞ 1: Antrenman Pencereleri, Metrik Envanteri ve Tarihsel Kayıtlar
  // =========================================================================
  options.onProgress?.('PASS_1_INDEXING', 0);

  const workouts: RawWorkoutInternal[] = [];
  const vo2MaxRecords: HealthHistoricalRecord[] = [];
  const restingHrRecords: HealthHistoricalRecord[] = [];
  const standaloneRoutes: Array<{ startMs: number; endMs: number; routePath: string }> = [];
  const dateParsingSamples: DateParsingSample[] = [];

  const advancedMetricsCount: AdvancedRunningMetricsCount = {
    runningSpeed: 0,
    runningPower: 0,
    runningStrideLength: 0,
    runningGroundContactTime: 0,
    runningVerticalOscillation: 0,
    distanceWalkingRunning: 0
  };

  let totalHeartRateRecordsInExport = 0;

  let pass1Stream = createReadStream(options.xmlFilePath, { encoding: 'utf-8' });
  let rl1 = createInterface({ input: pass1Stream, crlfDelay: Infinity });

  let inWorkoutBlock = false;
  let workoutBlock = '';
  let inRouteBlock = false;
  let routeBlock = '';
  let workoutCounter = 1;

  for await (const line of rl1) {
    updatePeakRss();

    // 1.1 Workout Blok Yakalama
    if (line.includes('<Workout ') || inWorkoutBlock) {
      inWorkoutBlock = true;
      workoutBlock += ' ' + line;
      if (line.includes('</Workout>') || (line.includes('/>') && line.includes('<Workout '))) {
        inWorkoutBlock = false;
        if (workoutBlock.includes('workoutActivityType="HKWorkoutActivityTypeRunning"')) {
          const startMatch = workoutBlock.match(/startDate="([^"]+)"/);
          const endMatch = workoutBlock.match(/endDate="([^"]+)"/);
          const durationMatch = workoutBlock.match(/duration="([^"]+)"/);
          const durationUnitMatch = workoutBlock.match(/durationUnit="([^"]+)"/);
          const distMatch = workoutBlock.match(/totalDistance="([^"]+)"/);
          const distUnitMatch = workoutBlock.match(/totalDistanceUnit="([^"]+)"/);
          const sourceMatch = workoutBlock.match(/sourceName="([^"]+)"/);
          const indoorMatch = workoutBlock.match(/key="HKIndoorWorkout"\s+value="1"/) || workoutBlock.match(/HKIndoorWorkout="1"/);
          const routeMatch = workoutBlock.match(/<FileReference\s+path="([^"]+)"/);

          if (startMatch && endMatch) {
            const rawStart = startMatch[1];
            const startDate = new Date(rawStart);
            const endDate = new Date(endMatch[1]);
            const startMs = startDate.getTime();
            const endMs = endDate.getTime();

            let durationSec = durationMatch ? parseFloat(durationMatch[1]) : (endMs - startMs) / 1000;
            if (durationUnitMatch && durationUnitMatch[1] === 'min') durationSec *= 60;

            let distanceMeters = distMatch ? parseFloat(distMatch[1]) : 0;
            if (distUnitMatch && distUnitMatch[1] === 'km') distanceMeters *= 1000;
            else if (distUnitMatch && distUnitMatch[1] === 'mi') distanceMeters *= 1609.34;

            if (dateParsingSamples.length < 5) {
              dateParsingSamples.push({
                rawString: rawStart,
                parsedUtcIso: startDate.toISOString(),
                parsedLocalString: startDate.toString()
              });
            }

            workouts.push({
              id: `hk_run_${workoutCounter++}`,
              sourceName: sourceMatch ? sourceMatch[1] : 'Bilinmeyen Kaynak',
              rawStartDateString: rawStart,
              startDate,
              endDate,
              startMs,
              endMs,
              durationSec: Math.max(1, Math.round(durationSec)),
              distanceMeters: Math.round(distanceMeters),
              isIndoor: Boolean(indoorMatch),
              routeFilePath: routeMatch ? routeMatch[1] : undefined,
              hrSamples: [],
              stepSamples: [],
              speedSamples: [],
              distanceSamples: []
            });
          }
        }
        workoutBlock = '';
      }
    }

    // 1.2 Standalone WorkoutRoute Yakalama
    if (line.includes('<WorkoutRoute ') || inRouteBlock) {
      inRouteBlock = true;
      routeBlock += ' ' + line;
      if (line.includes('</WorkoutRoute>') || (line.includes('/>') && line.includes('<WorkoutRoute '))) {
        inRouteBlock = false;
        const startMatch = routeBlock.match(/startDate="([^"]+)"/);
        const endMatch = routeBlock.match(/endDate="([^"]+)"/);
        const refMatch = routeBlock.match(/<FileReference\s+path="([^"]+)"/);
        if (startMatch && refMatch) {
          const rStartMs = new Date(startMatch[1]).getTime();
          const rEndMs = endMatch ? new Date(endMatch[1]).getTime() : rStartMs;
          standaloneRoutes.push({ startMs: rStartMs, endMs: rEndMs, routePath: refMatch[1] });
        }
        routeBlock = '';
      }
    }

    // 1.3 İleri Düzey Koşu Metrikleri Sayımı & Tarihsel Kayıtlar
    if (line.includes('HKQuantityTypeIdentifierRunningSpeed')) {
      advancedMetricsCount.runningSpeed++;
    } else if (line.includes('HKQuantityTypeIdentifierRunningPower')) {
      advancedMetricsCount.runningPower++;
    } else if (line.includes('HKQuantityTypeIdentifierRunningStrideLength')) {
      advancedMetricsCount.runningStrideLength++;
    } else if (line.includes('HKQuantityTypeIdentifierRunningGroundContactTime')) {
      advancedMetricsCount.runningGroundContactTime++;
    } else if (line.includes('HKQuantityTypeIdentifierRunningVerticalOscillation')) {
      advancedMetricsCount.runningVerticalOscillation++;
    } else if (line.includes('HKQuantityTypeIdentifierDistanceWalkingRunning')) {
      advancedMetricsCount.distanceWalkingRunning++;
    } else if (line.includes('type="HKQuantityTypeIdentifierHeartRate"') || line.includes("type='HKQuantityTypeIdentifierHeartRate'")) {
      totalHeartRateRecordsInExport++;
    } else if (line.includes('HKQuantityTypeIdentifierVO2Max')) {
      const startMatch = line.match(/startDate="([^"]+)"/);
      const valMatch = line.match(/value="([^"]+)"/);
      if (startMatch && valMatch) {
        vo2MaxRecords.push({ date: new Date(startMatch[1]), value: parseFloat(valMatch[1]) });
      }
    } else if (line.includes('HKQuantityTypeIdentifierRestingHeartRate')) {
      const startMatch = line.match(/startDate="([^"]+)"/);
      const valMatch = line.match(/value="([^"]+)"/);
      if (startMatch && valMatch) {
        restingHrRecords.push({ date: new Date(startMatch[1]), value: Math.round(parseFloat(valMatch[1])) });
      }
    }
  }

  // Antrenmanları zamana göre sırala (Binary search için)
  workouts.sort((a, b) => a.startMs - b.startMs);

  for (const w of workouts) {
    if (!w.routeFilePath) {
      const matched = standaloneRoutes.find(r => 
        (r.startMs >= w.startMs - 180000 && r.startMs <= w.endMs + 60000) ||
        (w.startMs >= r.startMs - 60000 && w.startMs <= r.endMs + 180000)
      );
      if (matched) w.routeFilePath = matched.routePath;
    }
  }

  vo2MaxRecords.sort((a, b) => a.date.getTime() - b.date.getTime());
  restingHrRecords.sort((a, b) => a.date.getTime() - b.date.getTime());

  // =========================================================================
  // GEÇİŞ 2: HR, Step, RunningSpeed ve Distance Örneklerini Süzme ($O(\log W)$)
  // =========================================================================
  options.onProgress?.('PASS_2_STREAMING', 50);

  let workoutHeartRateRecordsCaptured = 0;

  if (workouts.length > 0) {
    let pass2Stream = createReadStream(options.xmlFilePath, { encoding: 'utf-8' });
    let rl2 = createInterface({ input: pass2Stream, crlfDelay: Infinity });

    for await (const line of rl2) {
      updatePeakRss();

      // 2.1 Kalp Atım Hızı - Tam tip eşleşmesi (HRV ve Recovery kayıtlarını dışla)
      if (line.includes('type="HKQuantityTypeIdentifierHeartRate"') || line.includes("type='HKQuantityTypeIdentifierHeartRate'")) {
        const startMatch = line.match(/startDate="([^"]+)"/);
        const valMatch = line.match(/value="([^"]+)"/);
        if (startMatch && valMatch) {
          const tMs = new Date(startMatch[1]).getTime();
          const targetWorkout = findOverlappingWorkout(workouts, tMs);
          if (targetWorkout) {
            targetWorkout.hrSamples.push({ tMs, hr: Math.round(parseFloat(valMatch[1])) });
            workoutHeartRateRecordsCaptured++;
          }
        }
      }
      // 2.2 Adım Sayısı (Kadans İçin)
      else if (line.includes('HKQuantityTypeIdentifierStepCount')) {
        const startMatch = line.match(/startDate="([^"]+)"/);
        const endMatch = line.match(/endDate="([^"]+)"/);
        const valMatch = line.match(/value="([^"]+)"/);
        if (startMatch && endMatch && valMatch) {
          const startMs = new Date(startMatch[1]).getTime();
          const endMs = new Date(endMatch[1]).getTime();
          const targetWorkout = findOverlappingWorkout(workouts, startMs);
          if (targetWorkout) {
            targetWorkout.stepSamples.push({
              startMs,
              endMs,
              steps: parseFloat(valMatch[1])
            });
          }
        }
      }
      // 2.3 RunningSpeed (Kademe 1 Anlık Hız)
      else if (line.includes('HKQuantityTypeIdentifierRunningSpeed')) {
        const startMatch = line.match(/startDate="([^"]+)"/);
        const valMatch = line.match(/value="([^"]+)"/);
        const unitMatch = line.match(/unit="([^"]+)"/);
        if (startMatch && valMatch) {
          const tMs = new Date(startMatch[1]).getTime();
          let speedMps = parseFloat(valMatch[1]);
          if (unitMatch && unitMatch[1] === 'km/h') speedMps /= 3.6;
          else if (unitMatch && unitMatch[1] === 'mi/h') speedMps *= 0.44704;

          const targetWorkout = findOverlappingWorkout(workouts, tMs);
          if (targetWorkout) {
            targetWorkout.speedSamples.push({ tMs, speedMps });
          }
        }
      }
      // 2.4 DistanceWalkingRunning (Kademe 3 Anlık Mesafe Dilimi)
      else if (line.includes('HKQuantityTypeIdentifierDistanceWalkingRunning')) {
        const startMatch = line.match(/startDate="([^"]+)"/);
        const endMatch = line.match(/endDate="([^"]+)"/);
        const valMatch = line.match(/value="([^"]+)"/);
        const unitMatch = line.match(/unit="([^"]+)"/);
        if (startMatch && endMatch && valMatch) {
          const startMs = new Date(startMatch[1]).getTime();
          const endMs = new Date(endMatch[1]).getTime();
          let distMeters = parseFloat(valMatch[1]);
          if (unitMatch && (unitMatch[1] === 'km' || unitMatch[1] === 'km/h')) distMeters *= 1000;
          else if (unitMatch && unitMatch[1] === 'mi') distMeters *= 1609.34;

          const targetWorkout = findOverlappingWorkout(workouts, startMs);
          if (targetWorkout) {
            targetWorkout.distanceSamples.push({
              startMs,
              endMs,
              distanceMeters: distMeters
            });
          }
        }
      }
    }
  }

  // =========================================================================
  // NORMALİZASYON, 3 KADEMELİ HIZ VE TELEMETRİ OLUŞTURMA
  // =========================================================================
  options.onProgress?.('NORMALIZING', 85);

  const activities: NormalizedActivity[] = [];
  const streams = new Map<string, StreamPoint[]>();

  let totalHrIntervalSecSum = 0;
  let hrIntervalCount = 0;
  let workoutsWithGpxRoute = 0;
  let workoutsWithCadence = 0;
  let lowHrCoverageWorkoutsCount = 0;

  const paceSourceCounts = {
    runningSpeedCount: 0,
    gpxTrackpointCount: 0,
    distanceIntervalCount: 0,
    activityAverageCount: 0
  };

  const sourceBreakdownMap = new Map<string, SourceAppBreakdown>();

  for (const w of workouts) {
    updatePeakRss();

    w.hrSamples.sort((a, b) => a.tMs - b.tMs);
    w.stepSamples.sort((a, b) => a.startMs - b.startMs);
    w.speedSamples.sort((a, b) => a.tMs - b.tMs);
    w.distanceSamples.sort((a, b) => a.startMs - b.startMs);

    // Kaynak uygulama istatistiklerini başlat
    if (!sourceBreakdownMap.has(w.sourceName)) {
      sourceBreakdownMap.set(w.sourceName, {
        sourceName: w.sourceName,
        totalWorkouts: 0,
        outdoorCount: 0,
        indoorCount: 0,
        withHeartRate: 0,
        withCadence: 0,
        withGpxRoute: 0,
        withRunningSpeed: 0,
        withDistanceIntervals: 0
      });
    }
    const sourceStat = sourceBreakdownMap.get(w.sourceName)!;
    sourceStat.totalWorkouts++;
    if (w.isIndoor) sourceStat.indoorCount++;
    else sourceStat.outdoorCount++;

    // GPX Çözümleme
    let gpxData: ParsedGpxData | undefined;
    let resolvedGpxPath: string | undefined;

    if (w.routeFilePath && hasRoutesDir) {
      const cleanPath = w.routeFilePath.replace(/^\//, '');
      const fullPath = path.isAbsolute(w.routeFilePath) ? w.routeFilePath : path.join(baseDir, cleanPath);
      if (existsSync(fullPath)) {
        resolvedGpxPath = fullPath;
      } else {
        const routeBasename = path.basename(w.routeFilePath);
        const altPath = path.join(routesDir, routeBasename);
        if (existsSync(altPath)) resolvedGpxPath = altPath;
      }
    }

    if (resolvedGpxPath) {
      gpxData = await parseGpxRouteFile(resolvedGpxPath);
      if (gpxData) {
        workoutsWithGpxRoute++;
        sourceStat.withGpxRoute++;
      }
    }

    // 3 Kademeli Hız Tespiti Ön Analizi
    let paceSource: PaceSource = 'ACTIVITY_AVERAGE';
    if (w.speedSamples.length > 0) {
      paceSource = 'RUNNING_SPEED';
      paceSourceCounts.runningSpeedCount++;
      sourceStat.withRunningSpeed++;
    } else if (gpxData && gpxData.trackpoints.length > 1) {
      paceSource = 'GPX_TRACKPOINT';
      paceSourceCounts.gpxTrackpointCount++;
    } else if (w.distanceSamples.length > 0) {
      paceSource = 'DISTANCE_INTERVAL';
      paceSourceCounts.distanceIntervalCount++;
      sourceStat.withDistanceIntervals++;
    } else {
      paceSourceCounts.activityAverageCount++;
    }

    // 10 saniyelik çözünürlükte StreamPoint oluştur
    const streamPoints: StreamPoint[] = [];
    const duration = w.durationSec;
    const avgSpeedMetersPerSec = duration > 0 ? (w.distanceMeters / duration) : 0;
    const avgPaceSecPerKm = avgSpeedMetersPerSec > 0 ? Math.round(1000 / avgSpeedMetersPerSec) : undefined;

    let hrSum = 0;
    let hrMax = 0;
    let validHrPointsCount = 0;
    let cadSum = 0;
    let validCadPointsCount = 0;

    let hrPtr = 0;
    let stepPtr = 0;
    let speedPtr = 0;
    let distPtr = 0;
    let gpxIdx = 0;
    let cumDistMeters = 0;

    let gapSum = 0;
    let validGapCount = 0;

    for (let sec = 0; sec <= duration; sec += 10) {
      const pointTimeMs = w.startMs + sec * 1000;

      // 1. Nabız Çözümleme: İki işaretçi ile +-10s penceresindeki EN YAKIN (true nearest neighbor) örneği seç
      while (hrPtr < w.hrSamples.length && w.hrSamples[hrPtr].tMs < pointTimeMs - 10000) {
        hrPtr++;
      }
      let pointHr: number | undefined;
      let minHrDiff = Infinity;
      let checkHrIdx = hrPtr;
      while (checkHrIdx < w.hrSamples.length && w.hrSamples[checkHrIdx].tMs <= pointTimeMs + 10000) {
        const diff = Math.abs(w.hrSamples[checkHrIdx].tMs - pointTimeMs);
        if (diff < minHrDiff) {
          minHrDiff = diff;
          pointHr = w.hrSamples[checkHrIdx].hr;
        }
        checkHrIdx++;
      }
      if (pointHr !== undefined) {
        hrSum += pointHr;
        if (pointHr > hrMax) hrMax = pointHr;
        validHrPointsCount++;
      }

      // 2. Kadans Çözümleme: [pointTimeMs - 2000, pointTimeMs + 2000] aralığını kapsayan adım kaydı
      while (stepPtr < w.stepSamples.length && w.stepSamples[stepPtr].endMs < pointTimeMs - 2000) {
        stepPtr++;
      }
      let pointCad: number | undefined;
      if (stepPtr < w.stepSamples.length) {
        const s = w.stepSamples[stepPtr];
        if (pointTimeMs >= s.startMs - 2000 && pointTimeMs <= s.endMs + 2000) {
          const stepSec = Math.max(1, (s.endMs - s.startMs) / 1000);
          const rawCad = Math.round((s.steps / stepSec) * 60);
          if (rawCad >= 100 && rawCad <= 240) {
            pointCad = rawCad;
            cadSum += pointCad;
            validCadPointsCount++;
          }
        }
      }

      // 3. Anlık Tempo ve GAP Çözümleme (3 Kademeli Hiyerarşi)
      let pointGap = avgPaceSecPerKm;
      let pointAlt: number | undefined;
      let pointDist = Math.round(avgSpeedMetersPerSec * sec);

      // KADEME 1: HKQuantityTypeIdentifierRunningSpeed
      if (paceSource === 'RUNNING_SPEED') {
        while (speedPtr < w.speedSamples.length && w.speedSamples[speedPtr].tMs < pointTimeMs - 10000) {
          speedPtr++;
        }
        let minSpeedDiff = Infinity;
        let chosenSpeed: number | undefined;
        let checkSpeedIdx = speedPtr;
        while (checkSpeedIdx < w.speedSamples.length && w.speedSamples[checkSpeedIdx].tMs <= pointTimeMs + 10000) {
          const diff = Math.abs(w.speedSamples[checkSpeedIdx].tMs - pointTimeMs);
          if (diff < minSpeedDiff) {
            minSpeedDiff = diff;
            chosenSpeed = w.speedSamples[checkSpeedIdx].speedMps;
          }
          checkSpeedIdx++;
        }
        if (chosenSpeed && chosenSpeed > 0.5) {
          pointGap = Math.round(1000 / chosenSpeed);
        }
      } 
      // KADEME 2: GPX Trackpoint (Haversine & Minetti GAP)
      else if (paceSource === 'GPX_TRACKPOINT' && gpxData && gpxData.trackpoints.length > 1) {
        while (gpxIdx < gpxData.trackpoints.length - 2 && gpxData.trackpoints[gpxIdx + 1].timeMs < pointTimeMs) {
          gpxIdx++;
        }
        const p1 = gpxData.trackpoints[gpxIdx];
        const p2 = gpxData.trackpoints[gpxIdx + 1];
        if (p1 && p2) {
          const dt = (p2.timeMs - p1.timeMs) / 1000;
          const dd = haversineDistanceMeters(p1.lat, p1.lon, p2.lat, p2.lon);
          cumDistMeters += dd;
          pointDist = Math.round(cumDistMeters);
          pointAlt = p2.ele;

          if (dt > 0 && dd > 0) {
            const rawSpeed = dd / dt;
            const rawPace = rawSpeed > 0.5 ? Math.round(1000 / rawSpeed) : 1200;
            const grade = dd > 2.0 ? (p2.ele - p1.ele) / dd : 0;
            const costFactor = calculateMinettiCostFactor(grade);
            pointGap = Math.round(rawPace / costFactor);
          }
        }
      }
      // KADEME 3: HKQuantityTypeIdentifierDistanceWalkingRunning
      else if (paceSource === 'DISTANCE_INTERVAL') {
        while (distPtr < w.distanceSamples.length && w.distanceSamples[distPtr].endMs < pointTimeMs - 2000) {
          distPtr++;
        }
        if (distPtr < w.distanceSamples.length) {
          const d = w.distanceSamples[distPtr];
          if (pointTimeMs >= d.startMs - 2000 && pointTimeMs <= d.endMs + 2000) {
            const dt = Math.max(1, (d.endMs - d.startMs) / 1000);
            const rawSpeed = d.distanceMeters / dt;
            if (rawSpeed > 0.5) {
              pointGap = Math.round(1000 / rawSpeed);
            }
          }
        }
      }

      // Hareket halindeki noktaların GAP değerlerini topla (Aktivite GAP için)
      if (pointGap > 0 && pointGap < 1200) {
        gapSum += pointGap;
        validGapCount++;
      }

      streamPoints.push({
        t: sec,
        hr: pointHr,
        cad: pointCad,
        gap: pointGap,
        alt: pointAlt,
        dist: pointDist
      });
    }

    streams.set(w.id, streamPoints);

    // Kapsama Kontrolleri
    const totalExpectedSamples = Math.max(1, Math.floor(duration / 10));
    const hrCoveragePct = (validHrPointsCount / totalExpectedSamples) * 100;
    if (hrCoveragePct < 50) {
      lowHrCoverageWorkoutsCount++;
    }

    if (validCadPointsCount > 0) {
      workoutsWithCadence++;
      sourceStat.withCadence++;
    }

    const hasHeartRate = validHrPointsCount > 0;
    if (hasHeartRate) sourceStat.withHeartRate++;

    const avgHr = hasHeartRate ? Math.round(hrSum / validHrPointsCount) : undefined;
    const avgCadence = validCadPointsCount > 0 ? Math.round(cadSum / validCadPointsCount) : undefined;

    if (w.hrSamples.length > 1) {
      for (let i = 1; i < w.hrSamples.length; i++) {
        const dt = (w.hrSamples[i].tMs - w.hrSamples[i - 1].tMs) / 1000;
        if (dt > 0 && dt <= 60) {
          totalHrIntervalSecSum += dt;
          hrIntervalCount++;
        }
      }
    }

    const sportType: SportType = w.isIndoor ? 'TREADMILL_RUN' : 'RUN';
    const surfaceType: SurfaceType = w.isIndoor ? 'TREADMILL' : (
      (gpxData && gpxData.totalElevationGainMeters / Math.max(1, w.distanceMeters / 1000) >= 25) ? 'TRAIL' : 'ROAD'
    );

    const activityGapSecPerKm = (validGapCount > 0 && paceSource !== 'ACTIVITY_AVERAGE')
      ? Math.round(gapSum / validGapCount)
      : avgPaceSecPerKm;

    activities.push({
      id: w.id,
      userId: 'apple_health_user',
      sportType,
      title: `${w.sourceName} ${w.isIndoor ? 'Bant' : 'Açık Alan'} Koşusu`,
      startTime: w.startDate.toISOString(),
      elapsedTimeSec: w.durationSec,
      movingTimeSec: w.durationSec,
      distanceMeters: w.distanceMeters,
      elevationGainMeters: gpxData ? gpxData.totalElevationGainMeters : 0,
      hasHeartRate,
      avgHr,
      maxHr: hasHeartRate ? hrMax : undefined,
      avgCadence,
      avgPaceSecPerKm,
      gapSecPerKm: activityGapSecPerKm,
      surfaceType,
      startLatitude: gpxData?.startLatitude,
      startLongitude: gpxData?.startLongitude,
      hasInstantaneousPace: paceSource !== 'ACTIVITY_AVERAGE',
      routeFilePath: w.routeFilePath,
      sourceName: w.sourceName,
      paceSource
    });
  }

  // Mükerrer Antrenman Tespiti (Duplicate Workouts)
  const duplicateWorkoutsFound: DuplicateWorkoutPair[] = [];
  for (let i = 0; i < workouts.length; i++) {
    for (let j = i + 1; j < workouts.length; j++) {
      const w1 = workouts[i];
      const w2 = workouts[j];
      const timeDiffSec = Math.abs(w1.startMs - w2.startMs) / 1000;
      
      const dur1Sec = Math.max(1, w1.durationSec);
      const dur2Sec = Math.max(1, w2.durationSec);
      const end1Ms = w1.startMs + dur1Sec * 1000;
      const end2Ms = w2.startMs + dur2Sec * 1000;
      const overlapMs = Math.max(0, Math.min(end1Ms, end2Ms) - Math.max(w1.startMs, w2.startMs));
      const minDurMs = Math.min(dur1Sec, dur2Sec) * 1000;

      let isCandidate = false;
      // İki tarafta da mesafe varsa
      if (w1.distanceMeters > 50 && w2.distanceMeters > 50) {
        const distDiff = Math.abs(w1.distanceMeters - w2.distanceMeters);
        const maxDist = Math.max(1, w1.distanceMeters, w2.distanceMeters);
        if (distDiff / maxDist <= 0.10 && (timeDiffSec <= 1800 || overlapMs > 0)) {
          isCandidate = true;
        }
      } else if (timeDiffSec <= 1800 && overlapMs > 0) {
        // Bir tarafta mesafe yoksa zaman örtüşmesiyle eşleştir
        if (overlapMs / minDurMs >= 0.40 || overlapMs >= 300_000) {
          isCandidate = true;
        }
      }

      if (isCandidate) {
        const distDiff = Math.abs(w1.distanceMeters - w2.distanceMeters);
        const score1 = (w1.distanceMeters > 100 ? 30 : 0) + ((w1.speedSamples?.length || 0) > 0 ? 35 : 0) + ((w1.routeLocations?.length || 0) > 0 ? 15 : 0) + ((w1.stepSamples?.length || 0) > 0 ? 10 : 0) + ((w1.hrSamples?.length || 0) > 0 ? 10 : 0);
        const score2 = (w2.distanceMeters > 100 ? 30 : 0) + ((w2.speedSamples?.length || 0) > 0 ? 35 : 0) + ((w2.routeLocations?.length || 0) > 0 ? 15 : 0) + ((w2.stepSamples?.length || 0) > 0 ? 10 : 0) + ((w2.hrSamples?.length || 0) > 0 ? 10 : 0);
        const winner = score1 >= score2 ? w1.sourceName : w2.sourceName;

        duplicateWorkoutsFound.push({
          workout1: { id: w1.id, source: w1.sourceName, startTime: w1.startDate.toISOString(), distanceMeters: w1.distanceMeters },
          workout2: { id: w2.id, source: w2.sourceName, startTime: w2.startDate.toISOString(), distanceMeters: w2.distanceMeters },
          timeDiffSec,
          distanceDiffMeters: distDiff,
          winnerSource: winner
        });
      } else if (w2.startMs - w1.startMs > 1800000) {
        break;
      }
    }
  }

  // Telemetriyi Hesapla
  const indoorCount = workouts.filter(w => w.isIndoor).length;
  const outdoorCount = workouts.length - indoorCount;
  const avgHrInterval = hrIntervalCount > 0 ? Math.round((totalHrIntervalSecSum / hrIntervalCount) * 10) / 10 : 0;

  let gpxFilesFound = 0;
  if (hasRoutesDir) {
    try {
      gpxFilesFound = readdirSync(routesDir).filter(f => f.endsWith('.gpx')).length;
    } catch {
      gpxFilesFound = 0;
    }
  }

  const latestVo2 = vo2MaxRecords.length > 0 ? vo2MaxRecords[vo2MaxRecords.length - 1].value : undefined;
  const latestRhr = restingHrRecords.length > 0 ? restingHrRecords[restingHrRecords.length - 1].value : undefined;

  const hrWorkoutCoverageRatioPct = totalHeartRateRecordsInExport > 0 
    ? Math.round((workoutHeartRateRecordsCaptured / totalHeartRateRecordsInExport) * 1000) / 10 
    : 0;

  const telemetry: ParserTelemetry = {
    fileSizeBytes,
    parseTimeMs: Date.now() - startTime,
    peakRssMb: Math.round((peakRss / (1024 * 1024)) * 10) / 10,
    totalRunningWorkouts: workouts.length,
    dateRange: {
      minDate: workouts.length > 0 ? workouts[0].startDate.toISOString().split('T')[0] : undefined,
      maxDate: workouts.length > 0 ? workouts[workouts.length - 1].startDate.toISOString().split('T')[0] : undefined
    },
    outdoorCount,
    indoorCount,
    workoutsWithHeartRate: workouts.filter(w => w.hrSamples.length > 0).length,
    hrSampleIntervalStats: {
      avgSec: avgHrInterval,
      medianSec: avgHrInterval > 0 ? Math.round(avgHrInterval) : 0
    },
    totalHeartRateRecordsInExport,
    workoutHeartRateRecordsCaptured,
    hrWorkoutCoverageRatioPct,
    lowHrCoverageWorkoutsCount,
    workoutsWithCadence,
    paceSourceBreakdown: paceSourceCounts,
    advancedRunningMetricsInExport: advancedMetricsCount,
    gpxFilesFound,
    workoutsWithGpxRoute,
    sourceAppBreakdown: Array.from(sourceBreakdownMap.values()),
    duplicateWorkoutsFound,
    dateParsingSamples,
    vo2MaxRecordCount: vo2MaxRecords.length,
    restingHrRecordCount: restingHrRecords.length
  };

  options.onProgress?.('COMPLETED', 100);

  return {
    activities,
    streams,
    appleMetrics: {
      vo2MaxMlPerKgMin: latestVo2,
      restingHeartRate: latestRhr
    },
    historicalVo2Max: vo2MaxRecords,
    historicalRestingHr: restingHrRecords,
    telemetry
  };
}
