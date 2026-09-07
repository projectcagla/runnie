import Foundation
import SwiftUI
import HealthKit

/**
 * Runnie Durum Hiyerarşisi (State Priority Gates)
 * En üstteki kapı açılmadan altındaki durumlar asla aktifleşemez.
 */
public enum AppGate: Equatable {
    case noPermission
    case noRunsFound
    case serverUnreachable(url: String, underlyingError: String)
    case unsyncedRuns(count: Int)
    case belowDataThreshold(found: Int, duplicates: Int, unique: Int, totalDistanceKm: Double)
    case calibrationPending
    case observationOnly
    case ready(assessment: AssessmentData)

    public var isServerUnreachable: Bool {
        if case .serverUnreachable = self { return true }
        return false
    }

    public var isNoPermission: Bool {
        if case .noPermission = self { return true }
        return false
    }

    public var isNoRunsFound: Bool {
        if case .noRunsFound = self { return true }
        return false
    }

    public var isBelowDataThreshold: Bool {
        if case .belowDataThreshold = self { return true }
        return false
    }

    public var priorityIndex: Int {
        switch self {
        case .noPermission: return 1
        case .noRunsFound: return 2
        case .serverUnreachable: return 3
        case .unsyncedRuns: return 4
        case .belowDataThreshold: return 5
        case .calibrationPending: return 6
        case .observationOnly: return 7
        case .ready: return 8
        }
    }

    public var badgeTitle: String {
        switch self {
        case .noPermission: return "İZİN GEREKLİ"
        case .noRunsFound: return "KAYIT YOK"
        case .serverUnreachable: return "BAĞLANTI HATASI"
        case .unsyncedRuns: return "SENKRONİZASYON BEKLİYOR"
        case .belowDataThreshold: return "YETERSİZ VERİ"
        case .calibrationPending: return "KALİBRASYON BEKLİYOR"
        case .observationOnly: return "GÖZLEM MODU"
        case .ready(let data): return data.verdictLabel
        }
    }

    public var badgeColor: Color {
        switch self {
        case .noPermission: return .red
        case .noRunsFound: return .gray
        case .serverUnreachable: return .orange
        case .unsyncedRuns: return .blue
        case .belowDataThreshold: return .purple
        case .calibrationPending: return .purple
        case .observationOnly: return .gray
        case .ready(let data): return data.verdictColor
        }
    }

    public var sentence: String {
        switch self {
        case .noPermission:
            return "HealthKit okuma izni verilmedi. Koşularınızın analiz edilebilmesi için Apple Sağlık izinleri gereklidir."
        case .noRunsFound:
            return "HealthKit arşivinizde son 60 güne ait koşu antrenmanı bulunamadı. Apple Watch ile koşu kaydettikten sonra tekrar senkronize edin."
        case .serverUnreachable(let url, _):
            return "Sunucuya ulaşılamadı (\(url)). Lütfen sunucu adresinizi kontrol edip tekrar deneyin."
        case .unsyncedRuns(let count):
            return "Cihazınızda \(count) koşu bulundu. Şiddet analizi ve çift kayıt temizliği için sunucuya aktarılmayı bekliyor."
        case .belowDataThreshold(let found, let dups, let unique, let km):
            return "Ayna ekranı ve güvenilir temel profil için en az 16 tekil koşu ve 100 km gereklidir. (Arşiv: \(found) koşu, \(dups) çift elendi, \(unique) tekil, \(String(format: "%.1f", km)) km)"
        case .calibrationPending:
            return "İlk koşunuz kaydedildi. Kişisel aerobik eşiğinizi (AeT) belirlemek için konuşma testi çıpası bekleniyor."
        case .observationOnly:
            return "Veriler gözlem amacıyla kaydedildi. Sinyal netliği tam oluşmadığı için kesin bir şiddet hükmü üretilmedi."
        case .ready(let data):
            return data.sentence
        }
    }

    public var actionTitle: String {
        switch self {
        case .noPermission: return "İzinleri İste"
        case .noRunsFound: return "HealthKit'i Tara"
        case .serverUnreachable: return "Yeniden Dene"
        case .unsyncedRuns: return "Sunucuya Gönder"
        case .belowDataThreshold: return "Yeniden Senkronize Et"
        case .calibrationPending: return "Konuşma Çıpası Gir"
        case .observationOnly: return "Ayna Ekranını İncele"
        case .ready: return "HealthKit'i Senkronize Et"
        }
    }

    public static func == (lhs: AppGate, rhs: AppGate) -> Bool {
        switch (lhs, rhs) {
        case (.noPermission, .noPermission): return true
        case (.noRunsFound, .noRunsFound): return true
        case (.serverUnreachable(let u1, let e1), .serverUnreachable(let u2, let e2)):
            return u1 == u2 && e1 == e2
        case (.unsyncedRuns(let c1), .unsyncedRuns(let c2)):
            return c1 == c2
        case (.belowDataThreshold(let f1, let d1, let u1, let k1), .belowDataThreshold(let f2, let d2, let u2, let k2)):
            return f1 == f2 && d1 == d2 && u1 == u2 && abs(k1 - k2) < 0.01
        case (.calibrationPending, .calibrationPending): return true
        case (.observationOnly, .observationOnly): return true
        case (.ready(let d1), .ready(let d2)):
            return d1.activityId == d2.activityId && d1.verdict == d2.verdict
        default: return false
        }
    }
}

public struct AssessmentData: Equatable {
    public let activityId: String
    public let verdict: String
    public let sentence: String
    public let easyPct: Double
    public let moderatePct: Double
    public let thresholdPct: Double

    public init(activityId: String, verdict: String, sentence: String, easyPct: Double, moderatePct: Double, thresholdPct: Double) {
        self.activityId = activityId
        self.verdict = verdict
        self.sentence = sentence
        self.easyPct = easyPct
        self.moderatePct = moderatePct
        self.thresholdPct = thresholdPct
    }

    public var verdictLabel: String {
        switch verdict {
        case "ACCORDING_TO_PLAN": return "PLANA UYGUN"
        case "DRIFTED_GRAY": return "GRİ BÖLGE SAPMASI"
        case "DRIFTED_THRESHOLD": return "EŞİK AŞIMI"
        case "WEATHER_PARDON": return "ISI BERAATİ"
        case "PHYSIOLOGICAL_PARDON": return "FİZYOLOJİK BERAAT"
        case "BOUNDARY_ZONE": return "SINIR BÖLGESİ"
        case "CALIBRATION_PENDING": return "KALİBRASYON BEKLİYOR"
        case "OBSERVATION_ONLY": return "GÖZLEM MODU"
        default: return verdict
        }
    }

    public var verdictColor: Color {
        switch verdict {
        case "ACCORDING_TO_PLAN": return .green
        case "DRIFTED_GRAY": return .orange
        case "DRIFTED_THRESHOLD": return .red
        case "WEATHER_PARDON": return .teal
        case "PHYSIOLOGICAL_PARDON": return .purple
        case "BOUNDARY_ZONE": return .yellow
        case "CALIBRATION_PENDING": return .purple
        case "OBSERVATION_ONLY": return .gray
        default: return .blue
        }
    }
}

public struct SourceMetricBreakdown: Identifiable {
    public var id: String { sourceName }
    public let sourceName: String
    public var totalCount: Int = 0
    public var distanceCount: Int = 0
    public var zeroDistanceCount: Int = 0
    public var heartRateCount: Int = 0
    public var speedCount: Int = 0
    public var routeCount: Int = 0

    public init(sourceName: String, totalCount: Int = 0, distanceCount: Int = 0, zeroDistanceCount: Int = 0, heartRateCount: Int = 0, speedCount: Int = 0, routeCount: Int = 0) {
        self.sourceName = sourceName
        self.totalCount = totalCount
        self.distanceCount = distanceCount
        self.zeroDistanceCount = zeroDistanceCount
        self.heartRateCount = heartRateCount
        self.speedCount = speedCount
        self.routeCount = routeCount
    }
}

public struct DiagnosticsState {
    public var totalScannedWorkouts: Int = 0
    public var sources: [SourceMetricBreakdown] = []
    public var sanityDiscardedCount: Int = 0
    public var sanityRetainedCount: Int = 0
    public var duplicatePairsCount: Int = 0
    public var duplicatesEliminatedCount: Int = 0
    public var netUniqueRuns: Int = 0
    public var totalKm: Double = 0.0
    public var latestVO2Max: Double? = nil
    public var latestVO2MaxDate: Date? = nil
    public var latestRHR: Double? = nil
    public var latestHRV: Double? = nil
    public var lastUpdated: Date? = nil

    public init() {}
}

@MainActor
public final class AppStateManager: ObservableObject {
    public static let shared = AppStateManager()

    @Published public var currentGate: AppGate = .unsyncedRuns(count: 0)
    @Published public var diagnostics: DiagnosticsState = DiagnosticsState()
    @Published public var mirrorData: [String: Any]? = nil
    @Published public var isSyncing: Bool = false

    private init() {}

    public func setGate(_ gate: AppGate) {
        self.currentGate = gate
    }

    /**
     * Ayna Ekranı İçin Durum Bilgilendirme Metni
     * Sunucuya ulaşılamadıysa ASLA 'yetersiz veri' denemez.
     */
    public var mirrorScreenNotice: String {
        switch currentGate {
        case .noPermission:
            return "HealthKit okuma izni verilmediği için koşularınıza ulaşılamadı."
        case .noRunsFound:
            return "Cihazınızda son 60 güne ait koşu antrenmanı bulunmuyor."
        case .serverUnreachable:
            let count = diagnostics.totalScannedWorkouts
            if count > 0 {
                return "Sunucuya ulaşamadığım için \(count) koşunun hiçbirini henüz işleyemedim.\nLütfen sunucu bağlantınızı kontrol edin."
            } else {
                return "Sunucuya ulaşamadığım için koşuları henüz işleyemedim.\nLütfen sunucu bağlantınızı kontrol edin."
            }
        case .unsyncedRuns(let count):
            return "Cihazda \(count) koşu bulundu fakat henüz sunucuya aktarılmadı. Lütfen ana ekrandan HealthKit'i Senkronize Edin."
        case .belowDataThreshold(_, _, let unique, let km):
            return "Yetersiz veri. Son 60 günde en az 16 tekil koşu ve 100 km gereklidir.\n(Şu ana kadar: \(unique) tekil koşu, \(String(format: "%.1f", km)) km)"
        case .calibrationPending:
            return "Koşu verileriniz kaydedildi. Kişisel aerobik eşiğinizi (AeT) sabitlemek için lütfen konuşma testi çıpası girin."
        case .observationOnly:
            return "Koşu verileriniz gözlem modunda kaydedildi. Henüz güvenilir bir aerobik profil oluşturulabilecek sinyal netliği elde edilemedi."
        case .ready:
            if let m = mirrorData, let eligible = m["eligible"] as? Bool, eligible {
                return ""
            }
            return mirrorData?["message"] as? String ?? "Veriler işlendi."
        }
    }
}
