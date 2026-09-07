import { existsSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { parseAppleHealthExport } from '../src/parsers/appleHealthXmlParser.ts';

/**
 * Apple Health Dışa Aktarım Keşif Betiği (Gelişmiş Telemetri Sürümü).
 * Motoru sınamaz, hiçbir hüküm vermez; 3 kademeli anlık hız, kaynak uygulamalar,
 * mükerrer kayıtlar, saat dilimi ve nabız eşleşme oranını soğuk verilerle raporlar.
 */
async function main() {
  const args = process.argv.slice(2);
  let targetPath = args[0];

  if (!targetPath) {
    const candidates = [
      './export.xml',
      './apple_health_export/export.xml',
      '../export.xml',
      './data/export.xml'
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        targetPath = c;
        break;
      }
    }
  }

  if (!targetPath) {
    console.log('========================================================================');
    console.log('KOŞU ŞİDDETİ ASİSTANI — APPLE HEALTH DIŞA AKTARIM KEŞİF BETİĞİ');
    console.log('========================================================================');
    console.log('Kullanım:');
    console.log('  node --experimental-strip-types scripts/inspect-health-export.ts <export_dizini_veya_export.xml_yolu>');
    console.log('');
    console.log('Örnekler:');
    console.log('  node --experimental-strip-types scripts/inspect-health-export.ts /Users/cagla/Downloads/apple_health_export');
    console.log('  node --experimental-strip-types scripts/inspect-health-export.ts /Users/cagla/Downloads/export.xml');
    console.log('========================================================================');
    process.exit(1);
  }

  let xmlPath = targetPath;
  let routesDir: string | undefined;

  if (existsSync(targetPath)) {
    const stat = statSync(targetPath);
    if (stat.isDirectory()) {
      const candidateXml = path.join(targetPath, 'export.xml');
      const candidateInnerXml = path.join(targetPath, 'apple_health_export', 'export.xml');
      if (existsSync(candidateXml)) {
        xmlPath = candidateXml;
      } else if (existsSync(candidateInnerXml)) {
        xmlPath = candidateInnerXml;
      } else {
        console.error(`HATA: '${targetPath}' dizininde 'export.xml' bulunamadı!`);
        process.exit(1);
      }
    }
  } else {
    console.error(`HATA: Belirtilen yol bulunamadı: ${targetPath}`);
    process.exit(1);
  }

  const baseDir = path.dirname(xmlPath);
  const potentialRoutes = path.join(baseDir, 'workout-routes');
  if (existsSync(potentialRoutes)) {
    routesDir = potentialRoutes;
  }

  console.log('========================================================================');
  console.log('KOŞU ŞİDDETİ ASİSTANI — APPLE HEALTH DIŞA AKTARIM KEŞİF RAPORU');
  console.log('========================================================================');
  console.log(`Hedef Dosya:  ${path.resolve(xmlPath)}`);
  console.log(`Rota Klasörü: ${routesDir ? path.resolve(routesDir) : '[workout-routes/ klasörü tespit edilemedi]'}`);
  console.log('Ayrıştırma başlatılıyor (İki geçişli akış, 3 kademeli tempo kontrolü)... Lütfen bekleyin...\n');

  const progressLogger = (stage: string, percent?: number) => {
    if (stage === 'PASS_1_INDEXING') {
      process.stdout.write('-> Geçiş 1/2: Antrenman pencereleri ve ileri düzey metrikler taranıyor...\r');
    } else if (stage === 'PASS_2_STREAMING') {
      process.stdout.write('-> Geçiş 2/2: HR, Step, RunningSpeed ve Distance örnekleri O(log W) ile süzülüyor...\r');
    } else if (stage === 'NORMALIZING') {
      process.stdout.write('-> Normalizasyon: 3 kademeli tempo ve mükerrer antrenmanlar analiz ediliyor... \r');
    } else if (stage === 'COMPLETED') {
      process.stdout.write('-> Ayrıştırma tamamlandı. Rapor yazdırılıyor...                            \n\n');
    }
  };

  const parsed = await parseAppleHealthExport({
    xmlFilePath: xmlPath,
    routesDirPath: routesDir,
    onProgress: progressLogger
  });

  const t = parsed.telemetry;
  const fileSizeMb = (t.fileSizeBytes / (1024 * 1024)).toFixed(1);
  const parseTimeSec = (t.parseTimeMs / 1000).toFixed(2);

  console.log('------------------------------------------------------------------------');
  console.log('1. SİSTEM VE BELLEK PERFORMANSI');
  console.log('------------------------------------------------------------------------');
  console.log(`- XML Dosya Boyutu:             ${fileSizeMb} MB`);
  console.log(`- Toplam Ayrıştırma Süresi:     ${parseTimeSec} saniye`);
  console.log(`- Tepe Bellek Kullanımı (RSS):  ${t.peakRssMb} MB`);

  console.log('\n------------------------------------------------------------------------');
  console.log('2. KOŞU AKTİVİTESİ HACMİ VE DAĞILIMI');
  console.log('------------------------------------------------------------------------');
  console.log(`- Toplam Koşu Sayısı:           ${t.totalRunningWorkouts}`);
  console.log(`- Tarih Aralığı:                ${t.dateRange.minDate || 'Yok'} -> ${t.dateRange.maxDate || 'Yok'}`);
  const indoorPct = t.totalRunningWorkouts > 0 ? ((t.indoorCount / t.totalRunningWorkouts) * 100).toFixed(1) : '0';
  const outdoorPct = t.totalRunningWorkouts > 0 ? ((t.outdoorCount / t.totalRunningWorkouts) * 100).toFixed(1) : '0';
  console.log(`- Açık Alan Koşusu:             ${t.outdoorCount} (%${outdoorPct})`);
  console.log(`- Kapalı Alan (Bant) Koşusu:    ${t.indoorCount} (%${indoorPct})`);

  console.log('\n------------------------------------------------------------------------');
  console.log('3. KAYNAK UYGULAMA DAĞILIMI (SOURCE APPLICATION BREAKDOWN)');
  console.log('------------------------------------------------------------------------');
  if (t.sourceAppBreakdown.length === 0) {
    console.log('Hiçbir antrenman kaynağı tespit edilemedi.');
  } else {
    for (const src of t.sourceAppBreakdown) {
      const srcHrPct = src.totalWorkouts > 0 ? ((src.withHeartRate / src.totalWorkouts) * 100).toFixed(1) : '0';
      const srcGpxPct = src.outdoorCount > 0 ? ((src.withGpxRoute / src.outdoorCount) * 100).toFixed(1) : '0';
      const srcSpeedPct = src.totalWorkouts > 0 ? ((src.withRunningSpeed / src.totalWorkouts) * 100).toFixed(1) : '0';
      const srcDistPct = src.totalWorkouts > 0 ? ((src.withDistanceIntervals / src.totalWorkouts) * 100).toFixed(1) : '0';
      console.log(`Kaynak: [${src.sourceName}]`);
      console.log(`  -> Toplam Koşu:               ${src.totalWorkouts} (Açık: ${src.outdoorCount}, Bant: ${src.indoorCount})`);
      console.log(`  -> Nabız Kapsamı:             ${src.withHeartRate} / ${src.totalWorkouts} (%${srcHrPct})`);
      console.log(`  -> GPX Rota Eşleşmesi:        ${src.withGpxRoute} / ${src.outdoorCount} (%${srcGpxPct})`);
      console.log(`  -> RunningSpeed Serisi:       ${src.withRunningSpeed} / ${src.totalWorkouts} (%${srcSpeedPct})`);
      console.log(`  -> Distance Dilim Serisi:     ${src.withDistanceIntervals} / ${src.totalWorkouts} (%${srcDistPct})`);
      console.log('');
    }
  }

  console.log('------------------------------------------------------------------------');
  console.log('4. MÜKERRER ANTRENMAN TESPİTİ (DEDUPLICATION CHECK)');
  console.log('------------------------------------------------------------------------');
  console.log(`- Tespit Edilen Çift Sayısı:    ${t.duplicateWorkoutsFound.length}`);
  if (t.duplicateWorkoutsFound.length > 0) {
    console.log('  Örnek Çakışan Antrenmanlar (Zaman farkı <= 120s ve Mesafe farkı <= %5):');
    for (let i = 0; i < Math.min(3, t.duplicateWorkoutsFound.length); i++) {
      const dup = t.duplicateWorkoutsFound[i];
      console.log(`  [Çift ${i + 1}] Tarih: ${dup.workout1.startTime.split('T')[0]}`);
      console.log(`    A: ${dup.workout1.source} (${(dup.workout1.distanceMeters / 1000).toFixed(2)} km)`);
      console.log(`    B: ${dup.workout2.source} (${(dup.workout2.distanceMeters / 1000).toFixed(2)} km)`);
      console.log(`    Fark: ${dup.timeDiffSec} saniye, ${dup.distanceDiffMeters.toFixed(0)} metre`);
    }
    if (t.duplicateWorkoutsFound.length > 3) {
      console.log(`  ... ve ${t.duplicateWorkoutsFound.length - 3} çift daha.`);
    }
  } else {
    console.log('  Mükerrer antrenman bulunamadı (Tek cihaz veya temiz kayıt).');
  }

  console.log('\n------------------------------------------------------------------------');
  console.log('5. KALP ATIM HIZI (HR) KAPSAMI VE EŞLEŞME ORANI');
  console.log('------------------------------------------------------------------------');
  const hrPct = t.totalRunningWorkouts > 0 ? ((t.workoutsWithHeartRate / t.totalRunningWorkouts) * 100).toFixed(1) : '0';
  console.log(`- Nabız Kaydı Olan Koşular:     ${t.workoutsWithHeartRate} / ${t.totalRunningWorkouts} (%${hrPct})`);
  console.log(`- Arşivdeki Toplam HR Kaydı:    ${t.totalHeartRateRecordsInExport.toLocaleString('tr-TR')}`);
  console.log(`- Koşulara Eşleşen HR Kaydı:    ${t.workoutHeartRateRecordsCaptured.toLocaleString('tr-TR')} (%${t.hrWorkoutCoverageRatioPct})`);
  console.log(`- Örnekleme Aralığı:            Ortalama ${t.hrSampleIntervalStats.avgSec} sn (Medyan: ~${t.hrSampleIntervalStats.medianSec} sn)`);
  console.log(`- Düşük Kapsamlı Koşular (<%50): ${t.lowHrCoverageWorkoutsCount} adet`);

  console.log('\n------------------------------------------------------------------------');
  console.log('6. ANLIK TEMPO VE HIZ İÇİN 3 KADEMELİ HİYERARŞİ DAĞILIMI');
  console.log('------------------------------------------------------------------------');
  const p = t.paceSourceBreakdown;
  const total = Math.max(1, t.totalRunningWorkouts);
  console.log(`- Kademe 1 (RunningSpeed Serisi):      ${p.runningSpeedCount} / ${total} (%${((p.runningSpeedCount / total) * 100).toFixed(1)}) [EN İYİ]`);
  console.log(`- Kademe 2 (GPX Rota Trackpoint):      ${p.gpxTrackpointCount} / ${total} (%${((p.gpxTrackpointCount / total) * 100).toFixed(1)}) [EĞİM VE GAP DÜZELTMELİ]`);
  console.log(`- Kademe 3 (DistanceWalkingRunning):   ${p.distanceIntervalCount} / ${total} (%${((p.distanceIntervalCount / total) * 100).toFixed(1)}) [BANT VE GPS-SİZ]`);
  console.log(`- Kademe 4 (Düz Aktivite Ortalaması):  ${p.activityAverageCount} / ${total} (%${((p.activityAverageCount / total) * 100).toFixed(1)}) [ANLIK VARYANS YOK]`);

  console.log('\n------------------------------------------------------------------------');
  console.log('7. İLERİ DÜZEY KOŞU METRİKLERİ ENVANTERİ (HEALTHKIT EXPORT İÇİNDE)');
  console.log('------------------------------------------------------------------------');
  const adv = t.advancedRunningMetricsInExport;
  console.log(`- HKQuantityTypeIdentifierRunningSpeed:              ${adv.runningSpeed.toLocaleString('tr-TR')} örnek`);
  console.log(`- HKQuantityTypeIdentifierRunningPower:              ${adv.runningPower.toLocaleString('tr-TR')} örnek`);
  console.log(`- HKQuantityTypeIdentifierRunningStrideLength:       ${adv.runningStrideLength.toLocaleString('tr-TR')} örnek`);
  console.log(`- HKQuantityTypeIdentifierRunningGroundContactTime:  ${adv.runningGroundContactTime.toLocaleString('tr-TR')} örnek`);
  console.log(`- HKQuantityTypeIdentifierRunningVerticalOscillation:${adv.runningVerticalOscillation.toLocaleString('tr-TR')} örnek`);
  console.log(`- HKQuantityTypeIdentifierDistanceWalkingRunning:    ${adv.distanceWalkingRunning.toLocaleString('tr-TR')} örnek`);

  console.log('\n------------------------------------------------------------------------');
  console.log('8. ADIM VE KADANS TÜRETİMİ (STEPCOUNT)');
  console.log('------------------------------------------------------------------------');
  const cadPct = t.totalRunningWorkouts > 0 ? ((t.workoutsWithCadence / t.totalRunningWorkouts) * 100).toFixed(1) : '0';
  console.log(`- Kadans Türetilebilen Koşular: ${t.workoutsWithCadence} / ${t.totalRunningWorkouts} (%${cadPct})`);
  console.log(`- Kadans Yöntemi:               Dinamik (Adım / Süre) * 60 (Sabit 168 iptal edildi, veri yoksa undefined)`);

  console.log('\n------------------------------------------------------------------------');
  console.log('9. GPS, ROTA VE HAVA DURUMU KOORDİNATLARI (WORKOUT-ROUTES)');
  console.log('------------------------------------------------------------------------');
  console.log(`- Klasördeki GPX Dosyası:       ${t.gpxFilesFound}`);
  console.log(`- GPX ile Eşleşen Açık Koşu:    ${t.workoutsWithGpxRoute} / ${t.outdoorCount}`);
  const hasGpxCoords = parsed.activities.some(a => a.startLatitude !== undefined);
  console.log(`- GPS Koordinat Erişimi:        ${hasGpxCoords ? 'MEVCUT (Open-Meteo hava sorgusu yapılabilir)' : 'YOK'}`);

  console.log('\n------------------------------------------------------------------------');
  console.log('10. TARİH VE SAAT DİLİMİ DENETİMİ (TIMEZONE OFFSET AUDIT)');
  console.log('------------------------------------------------------------------------');
  if (t.dateParsingSamples.length === 0) {
    console.log('Tarih örneği bulunamadı.');
  } else {
    for (let i = 0; i < t.dateParsingSamples.length; i++) {
      const s = t.dateParsingSamples[i];
      console.log(`[Örnek ${i + 1}] Ham XML:   "${s.rawString}"`);
      console.log(`         Ayrışan UTC:  ${s.parsedUtcIso}`);
      console.log(`         Yerel Zaman:  ${s.parsedLocalString}`);
    }
  }

  console.log('\n------------------------------------------------------------------------');
  console.log('11. FİZYOLOJİK TARİHSEL METRİKLER (VO2MAX & DİNLENİK NABIZ)');
  console.log('------------------------------------------------------------------------');
  console.log(`- VO2max Kayıt Sayısı:          ${t.vo2MaxRecordCount}`);
  if (parsed.historicalVo2Max.length > 0) {
    const vMin = Math.min(...parsed.historicalVo2Max.map(v => v.value));
    const vMax = Math.max(...parsed.historicalVo2Max.map(v => v.value));
    const firstDate = parsed.historicalVo2Max[0].date.toISOString().split('T')[0];
    const lastDate = parsed.historicalVo2Max[parsed.historicalVo2Max.length - 1].date.toISOString().split('T')[0];
    console.log(`  -> Tarih Aralığı:             ${firstDate} -> ${lastDate}`);
    console.log(`  -> Değer Aralığı:             ${vMin.toFixed(1)} - ${vMax.toFixed(1)} ml/kg/min`);
    console.log(`  -> En Son VO2max Değeri:      ${parsed.appleMetrics.vo2MaxMlPerKgMin ?? 'Yok'}`);
  }
  console.log(`- Dinlenik Nabız Kayıt Sayısı:  ${t.restingHrRecordCount}`);
  if (parsed.historicalRestingHr.length > 0) {
    const rMin = Math.min(...parsed.historicalRestingHr.map(r => r.value));
    const rMax = Math.max(...parsed.historicalRestingHr.map(r => r.value));
    const firstDate = parsed.historicalRestingHr[0].date.toISOString().split('T')[0];
    const lastDate = parsed.historicalRestingHr[parsed.historicalRestingHr.length - 1].date.toISOString().split('T')[0];
    console.log(`  -> Tarih Aralığı:             ${firstDate} -> ${lastDate}`);
    console.log(`  -> Değer Aralığı:             ${rMin} - ${rMax} bpm`);
    console.log(`  -> En Son Dinlenik Nabız:     ${parsed.appleMetrics.restingHeartRate ?? 'Yok'} bpm`);
  }

  console.log('\n========================================================================');
  console.log('12. A PRİORİ MİMARİ UYGUNLUK KONTROL LİSTESİ');
  console.log('========================================================================');
  const hasAnyInstantPace = (p.runningSpeedCount + p.gpxTrackpointCount + p.distanceIntervalCount) > 0;
  console.log(`[${hasAnyInstantPace ? 'UYGUN' : 'KRİTİK RİSK'}] Anlık Hız / Tempo: En az bir kademeden (%${(((total - p.activityAverageCount) / total) * 100).toFixed(1)}) anlık veri akışı.`);
  console.log(`[${t.workoutsWithCadence > 0 ? 'UYGUN' : 'KRİTİK RİSK'}] Dinamik Kadans: Gerçek adımdan türetilmiş kadans (%${cadPct}).`);
  console.log(`[${t.workoutsWithHeartRate > 0 ? 'UYGUN' : 'KRİTİK RİSK'}] Nabız Verisi: Koşuların %${hrPct}'inde nabız mevcut.`);
  console.log(`[${t.duplicateWorkoutsFound.length > 0 ? 'UYARI - TEKİLLEŞTİRME GEREKİR' : 'UYGUN'}] Mükerrer Kayıtlar: ${t.duplicateWorkoutsFound.length} çift çakışan aktivite.`);
  console.log(`[${hasGpxCoords ? 'UYGUN' : 'BİLGİ - SINIRLI HAVA'}] Çevresel Beraat: GPS başlangıç koordinatları.`);
  console.log('========================================================================\n');
}

main().catch(err => {
  console.error('Keşif betiği çalışırken beklenmeyen hata oluştu:', err);
  process.exit(1);
});
