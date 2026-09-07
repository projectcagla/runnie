import test from 'node:test';
import assert from 'node:assert';
import { verifyTextCompliance, FORBIDDEN_WORDS, FAKE_CERTAINTY_PATTERNS } from '../src/forbiddenWords.ts';
import templates from '../src/templates.json' with { type: 'json' };

test('Yasaklı kelimeler kural motoru testi: Pozitif ve negatif kontroller', () => {
  // 1. Yasaklı kelime içeren metin yakalanmalı
  const badText1 = 'Bu koşuda aşırı laktat birikimi oldu ve sakatlanacaksın.';
  const res1 = verifyTextCompliance(badText1);
  assert.strictEqual(res1.valid, false);
  assert.strictEqual(res1.violations.length >= 2, true);

  // 2. Sahte kesinlik kalıbı içeren metin yakalanmalı
  const badText2 = 'Bu tempo toparlanma süreni 24 saat uzattı ve kalbine fazladan 14 atım yükledi.';
  const res2 = verifyTextCompliance(badText2);
  assert.strictEqual(res2.valid, false);
  assert.strictEqual(res2.violations.length >= 2, true);

  // 3. Geçerli fizyolojik metin temiz çıkmalı
  const goodText = 'Kolay bir toparlanma koşusu olmalıydı; sürenin %85 ini aerobik bölgede tamamladın.';
  const res3 = verifyTextCompliance(goodText);
  assert.strictEqual(res3.valid, true);
  assert.strictEqual(res3.violations.length, 0);
});

test('templates.json içindeki TÜM şablonların yasaklı kelime ve sahte kesinlik denetimi', () => {
  assert.strictEqual(templates.length >= 30, true, 'En az 30 şablon bulunmalıdır.');

  for (const tpl of templates) {
    const check1 = verifyTextCompliance(tpl.primarySentence);
    assert.strictEqual(
      check1.valid, 
      true, 
      `Şablon ${tpl.id} primarySentence kural ihlali içeriyor: ${check1.violations.join(', ')}`
    );

    const check2 = verifyTextCompliance(tpl.secondaryCostSentence);
    assert.strictEqual(
      check2.valid, 
      true, 
      `Şablon ${tpl.id} secondaryCostSentence kural ihlali içeriyor: ${check2.violations.join(', ')}`
    );
  }
});
