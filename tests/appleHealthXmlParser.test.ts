import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { 
  parseAppleHealthExport, 
  haversineDistanceMeters, 
  calculateMinettiCostFactor, 
  parseGpxRouteFile 
} from '../src/parsers/appleHealthXmlParser.ts';

test('Apple Health Parser: Haversine Mesafe ve Minetti GAP Hesaplaması', () => {
  const dist = haversineDistanceMeters(41.0422, 29.0067, 40.9904, 29.0254);
  assert.ok(dist > 5000 && dist < 6500, `Beklenen mesafe ~5.8 km, bulunan: ${dist}`);

  const flatCost = calculateMinettiCostFactor(0);
  assert.strictEqual(Math.round(flatCost * 100) / 100, 1.0);

  const uphillCost = calculateMinettiCostFactor(0.10);
  assert.ok(uphillCost > 1.5, `Yokuş yukarı katsayı 1.5'ten büyük olmalı, bulunan: ${uphillCost}`);

  const downhillCost = calculateMinettiCostFactor(-0.10);
  assert.ok(downhillCost < 0.7, `İniş aşağı katsayı 0.7'den küçük olmalı, bulunan: ${downhillCost}`);
});

test('Apple Health Parser: İki Geçişli Akış, 3 Kademeli Hız, Mükerrer Antrenman ve İleri Metrikler', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple_health_test_'));
  const routesDir = path.join(tmpDir, 'workout-routes');
  fs.mkdirSync(routesDir);

  const sampleGpxPath = path.join(routesDir, 'route_test.gpx');
  const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Apple Health" version="1.1">
  <trk>
    <trkseg>
      <trkpt lat="41.012000" lon="28.987000">
        <ele>10.0</ele>
        <time>2026-05-01T07:00:00Z</time>
      </trkpt>
      <trkpt lat="41.012500" lon="28.987500">
        <ele>12.0</ele>
        <time>2026-05-01T07:00:10Z</time>
      </trkpt>
      <trkpt lat="41.013000" lon="28.988000">
        <ele>14.5</ele>
        <time>2026-05-01T07:00:20Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;
  fs.writeFileSync(sampleGpxPath, gpxContent, 'utf-8');

  // XML Dışa aktarım dosyası: 3 koşu içeriyor
  // Koşu 1: Apple Watch Açık Alan Koşusu (GPX rota bağlı)
  // Koşu 2: Strava İçe Aktarımı (Koşu 1 ile aynı zamanda ve mesafede -> Mükerrer Çift!)
  // Koşu 3: Koşu Bandı (RunningSpeed ve DistanceWalkingRunning içeren)
  const sampleXmlPath = path.join(tmpDir, 'export.xml');
  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
]>
<HealthData>
  <!-- Tarihsel VO2Max ve Dinlenik Nabız -->
  <Record type="HKQuantityTypeIdentifierVO2Max" sourceName="Apple Watch" startDate="2026-05-01 10:00:00 +0300" endDate="2026-05-01 10:00:00 +0300" value="52.4"/>
  <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Apple Watch" startDate="2026-05-01 06:00:00 +0300" endDate="2026-05-01 06:00:00 +0300" value="48"/>

  <!-- İleri Düzey Koşu Metrikleri -->
  <Record type="HKQuantityTypeIdentifierRunningPower" sourceName="Apple Watch" startDate="2026-05-01 07:00:00 +0000" endDate="2026-05-01 07:00:10 +0000" value="280"/>
  <Record type="HKQuantityTypeIdentifierRunningStrideLength" sourceName="Apple Watch" startDate="2026-05-01 07:00:00 +0000" endDate="2026-05-01 07:00:10 +0000" value="1.15"/>
  <Record type="HKQuantityTypeIdentifierRunningGroundContactTime" sourceName="Apple Watch" startDate="2026-05-01 07:00:00 +0000" endDate="2026-05-01 07:00:10 +0000" value="240"/>
  <Record type="HKQuantityTypeIdentifierRunningVerticalOscillation" sourceName="Apple Watch" startDate="2026-05-01 07:00:00 +0000" endDate="2026-05-01 07:00:10 +0000" value="8.5"/>

  <!-- Koşu 1 & 2 Sırasındaki Nabız Ölçümleri (2026-05-01T07:00:00Z) -->
  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" startDate="2026-05-01 07:00:00 +0000" endDate="2026-05-01 07:00:00 +0000" value="142"/>
  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" startDate="2026-05-01 07:00:10 +0000" endDate="2026-05-01 07:00:10 +0000" value="145"/>
  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" startDate="2026-05-01 07:00:20 +0000" endDate="2026-05-01 07:00:20 +0000" value="148"/>

  <!-- Koşu Sırasındaki Adım Kayıtları (10 sn içinde 29 adım = 174 spm) -->
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" startDate="2026-05-01 07:00:00 +0000" endDate="2026-05-01 07:00:10 +0000" value="29"/>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" startDate="2026-05-01 07:00:10 +0000" endDate="2026-05-01 07:00:20 +0000" value="30"/>

  <!-- Koşu 3 Sırasındaki RunningSpeed (Kademe 1) ve Distance Örnekleri -->
  <Record type="HKQuantityTypeIdentifierRunningSpeed" sourceName="Apple Watch" unit="m/s" startDate="2026-05-02 08:00:00 +0000" endDate="2026-05-02 08:00:10 +0000" value="3.1"/>
  <Record type="HKQuantityTypeIdentifierRunningSpeed" sourceName="Apple Watch" unit="m/s" startDate="2026-05-02 08:00:10 +0000" endDate="2026-05-02 08:00:20 +0000" value="3.2"/>
  <Record type="HKQuantityTypeIdentifierRunningSpeed" sourceName="Apple Watch" unit="m/s" startDate="2026-05-02 08:00:20 +0000" endDate="2026-05-02 08:00:30 +0000" value="3.2"/>
  <Record type="HKQuantityTypeIdentifierRunningSpeed" sourceName="Apple Watch" unit="m/s" startDate="2026-05-02 08:00:30 +0000" endDate="2026-05-02 08:00:40 +0000" value="3.3"/>
  <Record type="HKQuantityTypeIdentifierRunningSpeed" sourceName="Apple Watch" unit="m/s" startDate="2026-05-02 08:00:40 +0000" endDate="2026-05-02 08:00:50 +0000" value="3.3"/>
  <Record type="HKQuantityTypeIdentifierRunningSpeed" sourceName="Apple Watch" unit="m/s" startDate="2026-05-02 08:00:50 +0000" endDate="2026-05-02 08:01:00 +0000" value="3.4"/>

  <!-- 1. Koşu: Apple Watch Açık Alan Koşusu -->
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="20" durationUnit="sec" totalDistance="120" totalDistanceUnit="m" sourceName="Apple Watch" startDate="2026-05-01 07:00:00 +0000" endDate="2026-05-01 07:00:20 +0000">
    <MetadataEntry key="HKIndoorWorkout" value="0"/>
    <WorkoutRoute sourceName="Apple Watch" startDate="2026-05-01 07:00:00 +0000" endDate="2026-05-01 07:00:20 +0000">
      <FileReference path="/workout-routes/route_test.gpx"/>
    </WorkoutRoute>
  </Workout>

  <!-- 2. Koşu: Strava Çifti (Mükerrer Antrenman) -->
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="20" durationUnit="sec" totalDistance="121" totalDistanceUnit="m" sourceName="Strava" startDate="2026-05-01 07:00:05 +0000" endDate="2026-05-01 07:00:25 +0000">
    <MetadataEntry key="HKIndoorWorkout" value="0"/>
  </Workout>

  <!-- 3. Koşu: Bant Koşusu (RunningSpeed içeren) -->
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="60" durationUnit="sec" totalDistance="190" totalDistanceUnit="m" sourceName="Apple Watch" startDate="2026-05-02 08:00:00 +0000" endDate="2026-05-02 08:01:00 +0000">
    <MetadataEntry key="HKIndoorWorkout" value="1"/>
  </Workout>
</HealthData>`;
  fs.writeFileSync(sampleXmlPath, xmlContent, 'utf-8');

  const parsed = await parseAppleHealthExport({
    xmlFilePath: sampleXmlPath,
    routesDirPath: routesDir
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });

  // 1. Aktivite Sayısı ve Ayrıştırma Kontrolleri
  assert.strictEqual(parsed.activities.length, 3, '3 adet koşu aktivitesi bulunmalı');

  // 2. Mükerrer Antrenman Tespiti Kontrolü
  assert.strictEqual(parsed.telemetry.duplicateWorkoutsFound.length, 1, '1 çift mükerrer antrenman tespit edilmeli');
  const dup = parsed.telemetry.duplicateWorkoutsFound[0];
  assert.ok(
    (dup.workout1.source === 'Apple Watch' && dup.workout2.source === 'Strava') ||
    (dup.workout1.source === 'Strava' && dup.workout2.source === 'Apple Watch'),
    'Mükerrer çift Apple Watch ve Strava arasında olmalı'
  );
  assert.strictEqual(dup.timeDiffSec, 5, 'Zaman farkı 5 saniye olmalı');

  // 3. 3 Kademeli Hız Tespiti Kontrolleri
  // Koşu 1: GPX_TRACKPOINT (Kademe 2)
  const outdoorRun = parsed.activities.find(a => a.sourceName === 'Apple Watch' && a.surfaceType === 'ROAD')!;
  assert.strictEqual(outdoorRun.paceSource, 'GPX_TRACKPOINT');
  assert.strictEqual(outdoorRun.hasInstantaneousPace, true);

  // Koşu 3: RUNNING_SPEED (Kademe 1)
  const treadmillRun = parsed.activities.find(a => a.surfaceType === 'TREADMILL')!;
  assert.strictEqual(treadmillRun.paceSource, 'RUNNING_SPEED');
  assert.strictEqual(treadmillRun.hasInstantaneousPace, true);

  // 4. Kaynak Uygulama Dağılımı Kontrolleri
  const sources = parsed.telemetry.sourceAppBreakdown;
  assert.strictEqual(sources.length, 2); // Apple Watch ve Strava
  const stravaSource = sources.find(s => s.sourceName === 'Strava');
  assert.ok(stravaSource);
  assert.strictEqual(stravaSource.totalWorkouts, 1);

  // 5. İleri Düzey Metrikler Envanteri
  assert.strictEqual(parsed.telemetry.advancedRunningMetricsInExport.runningPower, 1);
  assert.strictEqual(parsed.telemetry.advancedRunningMetricsInExport.runningGroundContactTime, 1);

  // 6. Tarih ve Saat Dilimi Kontrolleri
  assert.ok(parsed.telemetry.dateParsingSamples.length >= 3);
});
