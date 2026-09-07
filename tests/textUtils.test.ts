import test from 'node:test';
import assert from 'node:assert';
import { normalizeText, matchesKeywords } from '../src/textUtils.ts';

test('Türkçe Karakter Normalleştirmesi: İ, I, ı, ğ, ş, ç, ö, ü vakaları', () => {
  // En kritik vaka: Büyük İ ile başlayan İnterval
  assert.strictEqual(normalizeText('İnterval Seansı'), 'interval seansi');
  assert.strictEqual(normalizeText('İNTERVAL'), 'interval');
  assert.strictEqual(normalizeText('interval'), 'interval');
  
  // Büyük I (noktasız) vakası
  assert.strictEqual(normalizeText('ISINMA KOŞUSU'), 'isinma kosusu');
  assert.strictEqual(normalizeText('Ilık Hava'), 'ilik hava');

  // Türkçe diakritikler
  assert.strictEqual(normalizeText('Yarış Parkuru'), 'yaris parkuru');
  assert.strictEqual(normalizeText('Aralık Tekrarı'), 'aralik tekrari');
  assert.strictEqual(normalizeText('Öğlen Güneşi'), 'oglen gunesi');
  assert.strictEqual(normalizeText('Şehir Turu'), 'sehir turu');
  assert.strictEqual(normalizeText('Çekmeköy Patika'), 'cekmekoy patika');
});

test('Anahtar Kelime Eşleşmesi: matchesKeywords doğrulaması', () => {
  const title1 = 'İnterval Seansı';
  const qualityKeywords = ['tempo', 'interval', 'tekrar', 'aralık', 'fartlek'];
  assert.strictEqual(matchesKeywords(title1, qualityKeywords), true);

  const title2 = '10K YARIŞI';
  const raceKeywords = ['yarış', 'race', 'maraton', '10k', '5k', 'parkrun'];
  assert.strictEqual(matchesKeywords(title2, raceKeywords), true);

  const title3 = 'Sabah Kolay Koşusu';
  assert.strictEqual(matchesKeywords(title3, qualityKeywords), false);
  assert.strictEqual(matchesKeywords(title3, ['kolay', 'toparlanma']), true);
});
