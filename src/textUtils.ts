// Türkçe Karakter ve Metin Normalleştirme Yardımcısı
// Unicode case-folding ve Türkçe karakter tuzaklarını (İ, ı, ğ, ş, ç, ö, ü) tamamen çözer.

/**
 * Metindeki tüm Türkçe ve aksanlı karakterleri arama ve anahtar kelime
 * eşleştirmesi için güvenli ASCII küçük harf formatına dönüştürür.
 * 
 * Örnek:
 * "İnterval Seansı" -> "interval seansi"
 * "YARIŞ KOŞUSU" -> "yaris kosusu"
 * "Aralık Tekrarı" -> "aralik tekrari"
 */
export function normalizeText(text: string): string {
  if (!text) return '';

  return text
    // 1. Özel Türkçe büyük/küçük harf dönüşümleri (Locale bağımsız garanti)
    .replaceAll('İ', 'i')
    .replaceAll('I', 'ı')
    // 2. Standart küçük harfe çevir
    .toLowerCase()
    // 3. Kalan Türkçe harfleri ASCII dengiyle eşle
    .replaceAll('ı', 'i')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ş', 's')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c')
    // 4. Unicode diakritik temizliği (varsa birleşik noktaları ayıkla)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Normalize edilmiş metin içinde verilen anahtar kelimelerden
 * herhangi birinin geçip geçmediğini denetler.
 */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  const normalized = normalizeText(text);
  for (const kw of keywords) {
    const normalizedKw = normalizeText(kw);
    if (normalized.includes(normalizedKw)) {
      return true;
    }
  }
  return false;
}
