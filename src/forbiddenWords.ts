// Yasaklı Kelime Listesi ve Sahte Kesinlik Denetleyicisi
// Türkçe karakter normalleştirmesi ile tam koruma sağlar.

import { normalizeText } from './textUtils.ts';

export const FORBIDDEN_WORDS = [
  // 1. Eskimiş Fizyolojik Terimler
  'laktat birikimi',
  'laktik asit',
  'süt asidi',
  'toksin',
  'toksin atımı',
  'oksijensiz solunum',
  'yağ yakma nabzı',
  'yağ yakma bölgesi',

  // 2. Tıbbi / Hukuki İddialar
  'sakatlanacaksın',
  'sakatlık riski',
  'sakatlanma riski',
  'enflamasyon',
  'iltihap',
  'overtraining',
  'aşırı antrenman sendromu',
  'teşhis',
  'tedavi',
  'doku hasarı',
  'kalıcı hasar',
  'risk altındasın'
] as const;

// Sahte kesinlik kalıpları (Regex)
export const FAKE_CERTAINTY_PATTERNS = [
  /\b\d+\s*saat(lik)?\s*toparlanma/i, // Örn: "48 saatlik toparlanma"
  /toparlanma\s*süreni\s*\d+\s*saat/i, // Örn: "toparlanma süreni 24 saat uzattı"
  /kalbine\s*fazladan\s*\d+\s*atım/i, // Örn: "kalbine fazladan 14 atım yükledi"
  /\b\d+\s*kalori\b/i // Örn: "540 kalori yaktın"
];

export interface ComplianceResult {
  valid: boolean;
  violations: string[];
}

/**
 * Metnin yasaklı kelimeler ve sahte kesinlik kalıplarına uyup uymadığını denetler.
 * Türkçe normalleştirme kullanarak kaçakları önler.
 */
export function verifyTextCompliance(text: string): ComplianceResult {
  const violations: string[] = [];
  const normalizedText = normalizeText(text);

  for (const word of FORBIDDEN_WORDS) {
    const normalizedWord = normalizeText(word);
    if (normalizedText.includes(normalizedWord)) {
      violations.push(`Yasaklı kelime tespit edildi: "${word}"`);
    }
  }

  for (const pattern of FAKE_CERTAINTY_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(`Sahte kesinlik kalıbı tespit edildi: ${pattern.toString()}`);
    }
  }

  return {
    valid: violations.length === 0,
    violations
  };
}
