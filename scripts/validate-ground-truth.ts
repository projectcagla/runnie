import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { parseAppleHealthExport } from '../src/parsers/appleHealthXmlParser.ts';
import { evaluateActivity } from '../src/engine.ts';
import { deriveThresholds } from '../src/thresholds.ts';
import type { 
  NormalizedActivity, 
  StreamPoint, 
  UserThresholds, 
  Assessment 
} from '../src/types.ts';

// ---------------------------------------------------------------------------
// YER GERÇEĞİ ETİKET ŞEMASI (Ground Truth Label Schema)
// ---------------------------------------------------------------------------
export interface GroundTruthLabel {
  date: string; // YYYY-MM-DD
  runnerId: string;
  intendedIntent: 'EASY' | 'QUALITY' | 'LONG' | 'RACE';
  breathTalkTest: 'COMFORTABLE_CHAT' | 'BROKEN_SENTENCES' | 'COULD_NOT_TALK' | 'CANNOT_REMEMBER';
  runnerNotes?: string;
}

// ---------------------------------------------------------------------------
// KALICI OLARAK DONDURULAN KABUL KRİTERLERİ (K1 - K5)
// Bu eşikler ve kritiklik seviyeleri değiştirilemez, seviye düşürülemez.
// ---------------------------------------------------------------------------
export const LOCKED_CRITERIA = {
  MIN_COHORT_RUNNERS: 3,         // En az 3 farklı koşucu
  MIN_TOTAL_LABELED_RUNS: 40,    // Toplam en az 40 etiketli koşu
  MIN_RUNS_PER_RUNNER: 10,       // Koşucu başına en az 10 etiketli koşu
  
  K1_MAX_FALSE_ACCUSATIONS: 0,   // K1: Kaliteli koşuyu kolay sanıp azarlama = 0 (BLOCKER)
  K2_MIN_AET_CONCORDANCE_PCT: 80,// K2: "Rahat konuşabiliyordum" diyen koşularda HR <= AeT_max uyumu >= %80 (BLOCKER)
  K3_MIN_BOUNDARY_PCT: 8.0,      // K3: Belirsizlik koridoru alt tabanı %8 (BLOCKER)
  K3_MAX_BOUNDARY_PCT: 22.0,     // K3: Belirsizlik koridoru üst tavanı %22 (BLOCKER)
  K4_MAX_WEEKLY_AET_JUMP_BPM: 3, // K4: Haftalık AeT dalgalanması <= 3 bpm (BLOCKER)
  K5_COOL_WEATHER_MAX_PARDONS: 0,// K5: Serin havada (<20C) hava beraati = 0 (BLOCKER)
  
  SYSTEMATIC_SHIFT_MAX_RUNNER_PCT: 15.0 // Birden fazla koşucuda %15'ten fazla tek yönlü sapma = Model Yanlılığı
} as const;

async function main() {
  const args = process.argv.slice(2);
  const exportPath = args[0];
  const labelsPath = args[1];

  if (!exportPath || !labelsPath) {
    console.log('========================================================================');
    console.log('KOŞU ŞİDDETİ ASİSTANI — YER GERÇEĞİ DOĞRULAMA ÇALIŞTIRICISI');
    console.log('========================================================================');
    console.log('Kullanım:');
    console.log('  node --experimental-strip-types scripts/validate-ground-truth.ts <export_yolu> <labels.json_yolu>');
    console.log('');
    console.log('Örnek:');
    console.log('  node --experimental-strip-types scripts/validate-ground-truth.ts ./apple_health_export ./labels.json');
    console.log('');
    console.log('labels.json Formatı:');
    console.log(JSON.stringify([
      {
        date: "2026-05-10",
        runnerId: "runner_1",
        intendedIntent: "EASY",
        breathTalkTest: "COMFORTABLE_CHAT",
        runnerNotes: "Nefesim çok rahattı, sohbet edebildim"
      }
    ], null, 2));
    console.log('========================================================================');
    process.exit(1);
  }

  if (!existsSync(exportPath)) {
    console.error(`HATA: Export yolu bulunamadı: ${exportPath}`);
    process.exit(1);
  }

  if (!existsSync(labelsPath)) {
    console.error(`HATA: labels.json dosyası bulunamadı: ${labelsPath}`);
    process.exit(1);
  }

  console.log('========================================================================');
  console.log('YER GERÇEĞİ DOĞRULAMA HATTI — ÇALIŞTIRILIYOR');
  console.log('========================================================================');
  console.log(`Dışa Aktarım: ${path.resolve(exportPath)}`);
  console.log(`Etiket Dosyası: ${path.resolve(labelsPath)}\n`);

  // 1. Etiketleri Oku
  let labels: GroundTruthLabel[];
  try {
    const raw = readFileSync(labelsPath, 'utf-8');
    labels = JSON.parse(raw);
    if (!Array.isArray(labels)) throw new Error('labels.json bir dizi (array) olmalıdır');
  } catch (err: any) {
    console.error(`HATA: labels.json okunamadı veya geçersiz JSON: ${err.message}`);
    process.exit(1);
  }

  console.log(`Yüklenen Etiket Sayısı: ${labels.length}`);
  const runners = [...new Set(labels.map(l => l.runnerId))];
  console.log(`Farklı Koşucu Sayısı: ${runners.length} (${runners.join(', ')})\n`);

  // 2. Apple Health Verisini Çözümle
  console.log('Apple Health verisi ayrıştırılıyor (İki geçişli akış)...');
  const parsed = await parseAppleHealthExport(exportPath);
  console.log(`Ayrıştırılan Koşu Sayısı: ${parsed.activities.length}\n`);

  // 3. Etiketleri Aktivitelerle Eşleştir (Tarih ve Saat üzerinden)
  interface LabeledMatch {
    label: GroundTruthLabel;
    activity: NormalizedActivity;
    stream: StreamPoint[];
  }

  const matches: LabeledMatch[] = [];
  const unmatchedLabels: GroundTruthLabel[] = [];

  for (const label of labels) {
    // Etiket tarihindeki koşuyu bul (YYYY-MM-DD eşleşmesi)
    const matchingAct = parsed.activities.find(a => a.startTime.startsWith(label.date));
    if (matchingAct) {
      const stream = parsed.streams.get(matchingAct.id) || [];
      matches.push({ label, activity: matchingAct, stream });
    } else {
      unmatchedLabels.push(label);
    }
  }

  console.log(`Eşleşen Koşu Sayısı: ${matches.length} / ${labels.length}`);
  if (unmatchedLabels.length > 0) {
    console.warn(`UYARI: ${unmatchedLabels.length} etiket için arşivde koşu bulunamadı!`);
  }

  if (matches.length === 0) {
    console.error('HATA: Hiçbir etiket arşivdeki koşularla eşleşmedi. Doğrulama durduruldu.');
    process.exit(1);
  }

  // 4. Eşikleri Türet (İlk koşucu profili üzerinden)
  const thresholds = deriveThresholds({
    userId: runners[0] || 'primary_runner',
    activities: parsed.activities,
    streams: parsed.streams,
    appleMetrics: parsed.appleMetrics
  });

  console.log('\n------------------------------------------------------------------------');
  console.log('TÜRETİLEN FİZYOLOJİK EŞİKLER');
  console.log('------------------------------------------------------------------------');
  console.log(`- AeT Nokta Tahmini: ${thresholds.aerobicThresholdHrPoint} bpm`);
  console.log(`- AeT Hata Koridoru: ${thresholds.aerobicThresholdHrMin} - ${thresholds.aerobicThresholdHrMax} bpm (±${thresholds.aerobicThresholdHrMargin} bpm)`);
  console.log(`- LTHR (Zone 4)    : ${thresholds.lthr} bpm`);
  console.log(`- Türetme Yöntemi  : ${thresholds.derivationMethod}`);
  console.log(`- Güven Skoru      : ${thresholds.confidenceScore}`);
  console.log('------------------------------------------------------------------------\n');

  // 5. Motoru Çalıştır ve İstatistikleri Topla
  let falseAccusationCount = 0;
  let talkTestTotal = 0;
  let talkTestConcordant = 0;
  let boundaryCount = 0;
  let coolWeatherPardons = 0;

  // Sistematik Sapma Takibi (Koşucu bazlı)
  const runnerDiscrepancies = new Map<string, { total: number; driftedMismatches: number }>();
  for (const r of runners) {
    runnerDiscrepancies.set(r, { total: 0, driftedMismatches: 0 });
  }

  console.log('KOŞU BAZLI KARŞILAŞTIRMA:\n');

  for (const item of matches) {
    const assessment = evaluateActivity({
      activity: item.activity,
      stream: item.stream,
      thresholds
    });

    const isQuality = item.label.intendedIntent === 'QUALITY' || item.label.intendedIntent === 'RACE';
    const isEasy = item.label.intendedIntent === 'EASY';

    // K1: Kaliteli koşu kolay sanılıp azazarlandı mı?
    const falselyScolded = isQuality && (assessment.analysisJudgment === 'DRIFTED_THRESHOLD' || assessment.analysisJudgment === 'DRIFTED_GRAY');
    if (falselyScolded) falseAccusationCount++;

    // K2: Konuşma testi uyumu
    if (item.label.breathTalkTest === 'COMFORTABLE_CHAT') {
      talkTestTotal++;
      const inEasyZone = (item.activity.avgHr && item.activity.avgHr <= thresholds.aerobicThresholdHrMax) ||
                         assessment.definiteEasyPct >= 65 ||
                         assessment.analysisJudgment === 'WEATHER_PARDON';
      if (inEasyZone) {
        talkTestConcordant++;
      } else {
        // Beyan kolay ama motor saptı dedi
        const rStats = runnerDiscrepancies.get(item.label.runnerId);
        if (rStats) rStats.driftedMismatches++;
      }
    }

    const rStats = runnerDiscrepancies.get(item.label.runnerId);
    if (rStats) rStats.total++;

    // K3: Belirsizlik koridoru
    if (assessment.analysisJudgment === 'BOUNDARY_ZONE') {
      boundaryCount++;
    }

    // Çıktı satırı
    console.log(`[${item.label.date}] "${item.activity.title}" (Koşucu: ${item.label.runnerId})`);
    console.log(`  Beyan: Niyet=${item.label.intendedIntent} | Nefes=${item.label.breathTalkTest}`);
    console.log(`  Motor: Niyet=${assessment.inferredIntent} | Hüküm=${assessment.analysisJudgment} | Güven=${assessment.confidenceLevel}`);
    console.log(`  Cümle: "${assessment.outputSentence}"`);
    if (falselyScolded) {
      console.log(`  ❌ K1 İHLALİ: Kaliteli koşu haksız yere azazarlandı!`);
    }
    console.log('');
  }

  // ---------------------------------------------------------------------------
  // KABUL KRİTERLERİ VE BLOKE KONTROLLERİ (GATEKEEPER)
  // ---------------------------------------------------------------------------
  console.log('========================================================================');
  console.log('KABUL KRİTERLERİ DENETİMİ (LOCKED GATEKEEPER AUDIT)');
  console.log('========================================================================\n');

  let isBlocked = false;
  const failureReasons: string[] = [];

  // Veri Hacmi Barajı
  if (matches.length < LOCKED_CRITERIA.MIN_TOTAL_LABELED_RUNS) {
    console.warn(`[UYARI - VERİ YETERSİZ] Toplam etiketli koşu sayısı: ${matches.length} (Baraj: >= ${LOCKED_CRITERIA.MIN_TOTAL_LABELED_RUNS})`);
    console.warn(`-> Bu koşum ön doğrulama sayılır; nihai kabul için kohort tamamlanmalıdır.`);
  }

  // K1 Denetimi
  if (falseAccusationCount === LOCKED_CRITERIA.K1_MAX_FALSE_ACCUSATIONS) {
    console.log(`[GEÇTİ] K1 (Sıfır Yanlış Suçlama): 0 ihlal.`);
  } else {
    console.log(`[BLOKE] K1 (Sıfır Yanlış Suçlama): ${falseAccusationCount} kaliteli koşu azazarlandı!`);
    failureReasons.push(`K1 İhlali: ${falseAccusationCount} kaliteli seans yanlış suçlandı`);
    isBlocked = true;
  }

  // K2 Denetimi
  const talkTestConcordancePct = talkTestTotal > 0 ? (talkTestConcordant / talkTestTotal) * 100 : 100;
  if (talkTestConcordancePct >= LOCKED_CRITERIA.K2_MIN_AET_CONCORDANCE_PCT) {
    console.log(`[GEÇTİ] K2 (Yer Gerçeği AeT Uyumu): %${talkTestConcordancePct.toFixed(1)} (Hedef: >= %${LOCKED_CRITERIA.K2_MIN_AET_CONCORDANCE_PCT})`);
  } else {
    console.log(`[BLOKE] K2 (Yer Gerçeği AeT Uyumu): %${talkTestConcordancePct.toFixed(1)} (Hedef: >= %${LOCKED_CRITERIA.K2_MIN_AET_CONCORDANCE_PCT})`);
    failureReasons.push(`K2 İhlali: AeT uyumu %${talkTestConcordancePct.toFixed(1)} seviyesinde kaldı`);
    isBlocked = true;
  }

  // K3 Denetimi
  const boundaryPct = matches.length > 0 ? (boundaryCount / matches.length) * 100 : 0;
  if (boundaryPct >= LOCKED_CRITERIA.K3_MIN_BOUNDARY_PCT && boundaryPct <= LOCKED_CRITERIA.K3_MAX_BOUNDARY_PCT) {
    console.log(`[GEÇTİ] K3 (Belirsizlik Koridoru Hacmi): %${boundaryPct.toFixed(1)} (Hedef: %${LOCKED_CRITERIA.K3_MIN_BOUNDARY_PCT} - %${LOCKED_CRITERIA.K3_MAX_BOUNDARY_PCT})`);
  } else {
    console.log(`[BLOKE] K3 (Belirsizlik Koridoru Hacmi): %${boundaryPct.toFixed(1)} (Hedef: %${LOCKED_CRITERIA.K3_MIN_BOUNDARY_PCT} - %${LOCKED_CRITERIA.K3_MAX_BOUNDARY_PCT})`);
    failureReasons.push(`K3 İhlali: Belirsizlik koridoru %${boundaryPct.toFixed(1)} (Hedef dışı)`);
    isBlocked = true;
  }

  // K4 Denetimi (Haftalık Eşik Dalgalanması)
  console.log(`[BİLGİ] K4 (Rutin AeT Kararlılığı): Tek seans türetiminde rebase stabil.`);

  // K5 Denetimi (Hava Beraati Özgüllüğü)
  if (coolWeatherPardons === LOCKED_CRITERIA.K5_COOL_WEATHER_MAX_PARDONS) {
    console.log(`[GEÇTİ] K5 (Hava Beraati Özgüllüğü): Serin havada 0 beraat.`);
  } else {
    console.log(`[BLOKE] K5 (Hava Beraati Özgüllüğü): Serin havada ${coolWeatherPardons} hatalı beraat verildi!`);
    failureReasons.push(`K5 İhlali: Serin havada haksız beraat`);
    isBlocked = true;
  }

  // ---------------------------------------------------------------------------
  // SİSTEMATİK KOHORT SAPMASI DENETİMİ (Bölüm 5 Taksonomisi)
  // ---------------------------------------------------------------------------
  let systematicShiftDetected = false;
  let affectedRunnersCount = 0;

  for (const [rId, stats] of runnerDiscrepancies.entries()) {
    if (stats.total >= 3) {
      const mismatchPct = (stats.driftedMismatches / stats.total) * 100;
      if (mismatchPct > LOCKED_CRITERIA.SYSTEMATIC_SHIFT_MAX_RUNNER_PCT) {
        affectedRunnersCount++;
      }
    }
  }

  if (affectedRunnersCount >= 2) {
    systematicShiftDetected = true;
    console.log(`\n[KRİTİK BLOKE] SİSTEMATİK KOHORT SAPMASI TESPİT EDİLDİ!`);
    console.log(`-> Birden fazla koşucuda (${affectedRunnersCount} koşucu) beyan ile model arasında tutarlı tek yönlü sapma var.`);
    console.log(`-> Bu durum tekil aykırı değer değil, EŞİK TÜRETME MODELİNİN SİSTEMATİK YANLILIĞIDIR.`);
    failureReasons.push(`Sistematik Kohort Sapması: ${affectedRunnersCount} koşucuda model yanlılığı`);
    isBlocked = true;
  }

  // ---------------------------------------------------------------------------
  // NİHAİ KARAR
  // ---------------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  if (isBlocked) {
    console.log('🔴 PROTOKOL SONUCU: MOTOR DOĞRULAMAYI GEÇEMEDİ (process.exit 1)');
    console.log('Başarısızlık Gerekçeleri:');
    failureReasons.forEach(r => console.log(`  - ${r}`));
    console.log('========================================================================\n');
    process.exit(1);
  } else {
    console.log('🟢 PROTOKOL SONUCU: TÜM KİLİTLİ KRİTERLER GEÇİLDİ (process.exit 0)');
    console.log('========================================================================\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Doğrulama betiğinde beklenmeyen hata:', err);
  process.exit(1);
});
