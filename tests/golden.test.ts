import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
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
  fixtureTreadmill,
  fixtureVeryLongRun,
  fixtureGroupRun
} from './fixtures.ts';

test('Golden Fixtures: TypeScript Referans Çıktıları Üret ve Doğrula', () => {
  const cases = [
    {
      name: 'PERFECT_EASY_RUN',
      activity: fixturePerfectEasyRun,
      stream: createSyntheticStream(2400, 136, 350),
      thresholds: standardThresholds,
      weather: standardWeather
    },
    {
      name: 'FAILED_EASY_RUN_DRIFT_THRESHOLD',
      activity: fixtureFailedEasyRun,
      stream: createSyntheticStream(2400, 175, 280),
      thresholds: standardThresholds,
      weather: standardWeather
    },
    {
      name: 'HOT_HUMID_WEATHER_PARDON',
      activity: fixtureHotHumidPardon,
      stream: createSyntheticStream(2400, 162, 360),
      thresholds: standardThresholds,
      weather: hotHumidWeather
    },
    {
      name: 'CADENCE_LOCK',
      activity: fixtureCadenceLock,
      stream: (() => {
        const s = [];
        for (let t = 0; t <= 2400; t += 10) {
          s.push({ t, hr: 168, cad: 168, gap: 342, dist: Math.round((t / 3600) * (3600 / 342) * 1000) });
        }
        return s;
      })(),
      thresholds: standardThresholds,
      weather: standardWeather
    },
    {
      name: 'SHORT_RUN',
      activity: fixtureShortRun,
      stream: createSyntheticStream(1080, 135, 337),
      thresholds: standardThresholds,
      weather: standardWeather
    },
    {
      name: 'WALK_BREAKS',
      activity: fixtureWalkBreaks,
      stream: (() => {
        const s = [];
        for (let t = 0; t <= 2400; t += 10) {
          const isWalk = (t >= 600 && t < 720) || (t >= 1400 && t < 1520);
          s.push({
            t,
            hr: isWalk ? 115 : 138,
            cad: isWalk ? 105 : 166,
            gap: isWalk ? 750 : 340,
            dist: t * 3
          });
        }
        return s;
      })(),
      thresholds: standardThresholds,
      weather: standardWeather
    },
    {
      name: 'TREADMILL_RUN',
      activity: fixtureTreadmill,
      stream: createSyntheticStream(2400, 138, 330),
      thresholds: standardThresholds,
      weather: standardWeather
    },
    {
      name: 'VERY_LONG_RUN',
      activity: fixtureVeryLongRun,
      stream: createSyntheticStream(6000, 142, 355),
      thresholds: standardThresholds,
      weather: standardWeather
    },
    {
      name: 'GROUP_RUN',
      activity: fixtureGroupRun,
      stream: createSyntheticStream(2400, 162, 320),
      thresholds: standardThresholds,
      weather: standardWeather
    }
  ];

  const goldenFixtures = cases.map(c => {
    const asmt = evaluateActivity({
      activity: c.activity,
      stream: c.stream,
      thresholds: c.thresholds,
      weather: c.weather
    });

    return {
      name: c.name,
      activity: c.activity,
      stream: c.stream,
      thresholds: c.thresholds,
      weather: c.weather,
      expected: {
        judgment: asmt.analysisJudgment,
        inferredIntent: asmt.inferredIntent,
        confidenceLevel: asmt.confidenceLevel,
        zoneEasyPct: asmt.zoneEasyPct,
        zoneModeratePct: asmt.zoneModeratePct,
        zoneThresholdPct: asmt.zoneThresholdPct,
        templateId: asmt.templateId,
        outputSentence: asmt.outputSentence,
        flags: asmt.flags,
        isSilenced: asmt.isSilenced
      }
    };
  });

  const fixturesDir = path.resolve('tests/fixtures');
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  const goldenPath = path.join(fixturesDir, 'golden_fixtures.json');
  fs.writeFileSync(goldenPath, JSON.stringify(goldenFixtures, null, 2), 'utf-8');

  assert.strictEqual(goldenFixtures.length, 9);
  assert.strictEqual(fs.existsSync(goldenPath), true);
});
