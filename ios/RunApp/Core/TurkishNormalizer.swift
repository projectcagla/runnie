import Foundation

/**
 * Türkçe Karakter ve Metin Normalleştirme Yardımcısı
 * Unicode case-folding ve Türkçe karakter tuzaklarını (İ, ı, ğ, ş, ç, ö, ü) tamamen çözer.
 */
public struct TurkishNormalizer {
    public static func normalize(_ text: String) -> String {
        guard !text.isEmpty else { return "" }

        var result = text
            .replacingOccurrences(of: "İ", with: "i")
            .replacingOccurrences(of: "I", with: "ı")
            .lowercased()
            .replacingOccurrences(of: "ı", with: "i")
            .replacingOccurrences(of: "ğ", with: "g")
            .replacingOccurrences(of: "ü", with: "u")
            .replacingOccurrences(of: "ş", with: "s")
            .replacingOccurrences(of: "ö", with: "o")
            .replacingOccurrences(of: "ç", with: "c")

        result = result.folding(options: .diacriticInsensitive, locale: Locale(identifier: "tr_TR"))
            .trimmingCharacters(in: .whitespacesAndNewlines)

        return result
    }

    public static func matchesKeywords(_ text: String, keywords: [String]) -> Bool {
        let normalizedText = normalize(text)
        for kw in keywords {
            let normalizedKw = normalize(kw)
            if normalizedText.contains(normalizedKw) {
                return true
            }
        }
        return false
    }
}
