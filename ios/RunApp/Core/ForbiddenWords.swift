import Foundation

/**
 * Yasaklı Kelime Listesi ve Sahte Kesinlik Denetleyicisi
 * Türkçe karakter normalleştirmesi ile tam koruma sağlar.
 */
public struct ForbiddenWords {
    public static let words: [String] = [
        // 1. Eskimiş Fizyolojik Terimler
        "laktat birikimi",
        "laktik asit",
        "süt asidi",
        "toksin",
        "toksin atımı",
        "oksijensiz solunum",
        "yağ yakma nabzı",
        "yağ yakma bölgesi",

        // 2. Tıbbi / Hukuki İddialar
        "sakatlanacaksın",
        "sakatlık riski",
        "sakatlanma riski",
        "enflamasyon",
        "iltihap",
        "overtraining",
        "aşırı antrenman sendromu",
        "teşhis",
        "tedavi",
        "doku hasarı",
        "kalıcı hasar",
        "risk altındasın"
    ]

    public static let fakeCertaintyPatterns: [String] = [
        #"(?i)\b\d+\s*saat(lik)?\s*toparlanma"#,
        #"(?i)toparlanma\s*süreni\s*\d+\s*saat"#,
        #"(?i)kalbine\s*fazladan\s*\d+\s*atım"#,
        #"(?i)\b\d+\s*kalori\b"#
    ]

    public static func verifyCompliance(_ text: String) -> (valid: Bool, violations: [String]) {
        var violations: [String] = []
        let normalizedText = TurkishNormalizer.normalize(text)

        for word in words {
            let normalizedWord = TurkishNormalizer.normalize(word)
            if normalizedText.contains(normalizedWord) {
                violations.append("Yasaklı kelime tespit edildi: \"\(word)\"")
            }
        }

        for pattern in fakeCertaintyPatterns {
            if let regex = try? NSRegularExpression(pattern: pattern) {
                let range = NSRange(location: 0, length: text.utf16.count)
                if regex.firstMatch(in: text, options: [], range: range) != nil {
                    violations.append("Sahte kesinlik kalıbı tespit edildi: \(pattern)")
                }
            }
        }

        return (valid: violations.isEmpty, violations: violations)
    }
}
