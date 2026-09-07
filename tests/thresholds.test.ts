import test from 'node:test';
import assert from 'node:assert';
import { deriveThresholds } from '../src/thresholds.ts';
import { fixturePerfectEasyRun, fixtureRace, createSyntheticStream } from './fixtures.ts';

test('Eşik Türetme: Apple HealthKit VO2max ile Teorik Tahmin (Hata Marjı Geniş)', () => {
  const result = deriveThresholds({
    userId: 'user_apple_theoretic',
    activities: [fixturePerfectEasyRun],
    appleMetrics: {
      vo2MaxMlPerKgMin: 48,
      restingHeartRate: 50,
      age: 32
    }
  });

  assert.strictEqual(result.derivationMethod, 'APPLE_VO2MAX_THEORETICAL');
  // 4 katmanlı zincirde tek başına teorik tahmin güven skoru 0.85 DEĞİL, dürüstçe 0.60 olmalı!
  assert.strictEqual(result.confidenceScore, 0.60);
  assert.strictEqual(result.aerobicThresholdHrMargin >= 5, true, 'Teorik hata marjı en az +-5 bpm olmalı');

  // VO2max 48 için mantıklı eşik ve kolay tempo sınırları
  assert.strictEqual(result.thresholdPaceGapSecPerKm > 240 && result.thresholdPaceGapSecPerKm < 320, true);
  assert.strictEqual(result.easyPaceCeilingGapSecPerKm > result.thresholdPaceGapSecPerKm, true);
});

test('Eşik Türetme: Ampirik Hız -> Nabız Eşlemesi (Bölüm 4 Çözümü)', () => {
  const streamMap = new Map();
  // Kullanıcının kolay tempo tavanında (5:40/km = 340 sn/km) koştuğu 4 adet temiz koşu akışı
  for (let i = 1; i <= 4; i++) {
    const actId = `clean_act_${i}`;
    streamMap.set(actId, createSyntheticStream(2400, 142, 340));
  }

  const cleanActs = [1, 2, 3, 4].map(i => ({
    ...fixturePerfectEasyRun,
    id: `clean_act_${i}`,
    gapSecPerKm: 340
  }));

  const result = deriveThresholds({
    userId: 'user_empirical',
    activities: cleanActs,
    streams: streamMap,
    appleMetrics: { vo2MaxMlPerKgMin: 48 }
  });

  assert.strictEqual(result.derivationMethod, 'EMPIRICAL_PACE_HR_MAPPING');
  assert.strictEqual(result.confidenceScore >= 0.70 && result.confidenceScore <= 0.75, true, 'Daniels bağımlılığı sebebiyle ampirik eşleme 0.70-0.75 aralığına çekilmelidir.');
  assert.strictEqual(result.aerobicThresholdHrPoint, 142);
  assert.strictEqual(result.aerobicThresholdHrMargin <= 3, true, 'Ampirik hata marjı daralmalıdır (+-3 bpm)');
});

test('Eşik Türetme: Yarış Eforu Varsa', () => {
  const result = deriveThresholds({
    userId: 'user_racer',
    activities: [fixtureRace, fixturePerfectEasyRun]
  });

  assert.strictEqual(result.derivationMethod, 'VDOT_RACE');
  assert.strictEqual(result.confidenceScore >= 0.70, true);
  assert.strictEqual(result.thresholdPaceGapSecPerKm > 200, true);
});

test('Eşik Türetme: Ne VO2max Ne Yarış Var (Gri Bölge Koşucusu)', () => {
  const result = deriveThresholds({
    userId: 'user_gray_zone',
    activities: [fixturePerfectEasyRun]
  });

  assert.strictEqual(result.derivationMethod, 'UNVERIFIED_ESTIMATE');
  assert.strictEqual(result.confidenceScore <= 0.50, true);
  assert.strictEqual(result.aerobicThresholdHrMargin >= 6, true);
});

test('Eşik Türetme: Konuşma Testi Çıpası Güveni Yükseltir', () => {
  const result = deriveThresholds({
    userId: 'user_talk_test',
    activities: [fixturePerfectEasyRun],
    appleMetrics: { vo2MaxMlPerKgMin: 48 },
    talkTestConfirmedAeT: 144
  });

  assert.strictEqual(result.derivationMethod, 'TALK_TEST_ANCHOR');
  assert.strictEqual(result.aerobicThresholdHrPoint, 144);
  assert.strictEqual(result.confidenceScore >= 0.85, true);
  assert.strictEqual(result.aerobicThresholdHrMargin <= 2, true);
});
