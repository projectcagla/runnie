import Foundation

/**
 * Yapılandırma ve Eşik Sabitleri (Magic Numbers Yok Edildi)
 * Her katsayının ve eşiğin fizyolojik / teknik gerekçesi yanına yazılmıştır.
 */
public struct EngineConfig {
    // SÜRE EŞİKLERİ (SANİYE)
    public static let MIN_ACTIVITY_DURATION_SEC: Double = 900 // 15 dk: Bu sürenin altı kararlı durum analizi için yetersizdir.
    public static let SHORT_ACTIVITY_DURATION_SEC: Double = 1200 // 20 dk: Kısa koşu sınırıdır.
    public static let LONG_RUN_DURATION_SEC: Double = 4500 // 75 dk: Uzun koşu sınıflandırma tabanıdır.
    public static let VERY_LONG_RUN_DURATION_SEC: Double = 5400 // 90 dk: Dehidrasyon kaynaklı kardiyak sürüklenme kaçınılmazdır.

    // ISINMA PENCERESİ EŞİKLERİ
    public static let MAX_WARMUP_SEC: Double = 480 // 8 dk: Standart koşuda kardiyak gecikmenin aşılması için maksimum süre.
    public static let WARMUP_RATIO_MAX: Double = 0.20 // Koşu süresinin en fazla %20'si ısınma sayılabilir.
    public static let WARMUP_EARLY_EFFORT_SEC: Double = 60 // Isınma içinde 60 sn kesintisiz eşik koşulursa ısınma derhal biter.

    // KADANS KİLİTLENMESİ (CADENCE LOCK) ÇİFT SİNYAL FİLTRESİ
    public static let CADENCE_LOCK_DIFF_THRESHOLD: Double = 2.0 // Nabız ile kadans farkı <= 2 ise sensör kilitlenmiş olabilir.
    public static let CADENCE_LOCK_MIN_DURATION_SEC: Double = 180 // En az 3 dakika kesintisiz sürmelidir.
    public static let CADENCE_LOCK_MAX_CORRUPT_RATIO: Double = 0.30 // Koşunun %30'undan fazlası kilitliyse nabız çöpe atılır.
    public static let CADENCE_LOCK_MAX_HR_STD_DEV: Double = 1.2 // Gerçek kilitlenmede standart sapma <= 1.2 bpm çöker.

    // ÇEVRESEL / HAVA EŞİKLERİ
    public static let HEAT_TEMPERATURE_THRESHOLD_C: Double = 24.0 // 24°C ve üzeri: Termoregülasyon kan akışını cilde yöneltir.
    public static let HEAT_HUMIDITY_THRESHOLD_PCT: Double = 75.0 // %75 nem: Ter buharlaşamaz, kardiyak yük artar.
    public static let HIGH_WIND_SPEED_KMH: Double = 25.0 // 25 km/h: Rüzgar direnci tempo eforunu bozar.
    public static let TRAIL_ELEVATION_GAIN_M_PER_KM: Double = 25.0 // Kilometre başına 25m tırmanış üstü patikadır.

    // FİZYOLOJİK ORANLAR (EŞİK TÜRETME)
    public static let LTHR_RATIO_OF_HRMAX: Double = 0.865 // Antrenmanlı dayanıklılık sporcularında ortalama %86.5 (Seiler, 2013).
    public static let AET_RATIO_OF_LTHR: Double = 0.84 // Kalibre edilmiş oran (Olbrecht, 2000).
    public static let AET_RATIO_OF_LTHR_UNCALIBRATED: Double = 0.83 // Kalibre edilmemiş rekreasyonel koşucularda konservatif taban.
    public static let AEROBIC_DECOUPLING_MAX_PCT: Double = 5.0 // Kolay koşuda hız sabitken nabız >%5 sürüklenirse gizli glikojen ihlali sayılır.

    // FİZYOLOJİK DURUM BERAATİ (PHYSIOLOGICAL STATE PARDON)
    public static let PHYSIOLOGICAL_HR_REST_SPIKE_BPM: Double = 5.0 // Dinlenik nabız >= +5 bpm yüksekse sistemik yorgunluktur.
    public static let PHYSIOLOGICAL_HRV_DROP_PCT: Double = 20.0 // HRV (SDNN) >= %20 baskılanmışsa toparlanma eksikliğidir.

    // Karvonen Kalp Atım Rezervi (HRR) Katsayıları
    public static let AET_KARVONEN_RESERVE_RATIO: Double = 0.65
    public static let LTHR_KARVONEN_RESERVE_RATIO: Double = 0.85

    // GÜVEN SKORLARI VE EŞİKLERİ
    public static let HIGH_CONFIDENCE_THRESHOLD: Double = 0.75
    public static let MEDIUM_CONFIDENCE_THRESHOLD: Double = 0.55

    // ŞİDDET DAĞILIMI UYUM EŞİKLERİ (%)
    public static let EASY_COMPLIANCE_ZONE1_MIN_PCT: Double = 75.0
    public static let MILD_DRIFT_THRESHOLD_PCT: Double = 25.0
    public static let SEVERE_DRIFT_THRESHOLD_PCT: Double = 35.0
    public static let MODERATE_GRAY_ZONE_DRIFT_PCT: Double = 45.0

    // YÜRÜYÜŞ TESPİTİ (JEFFING)
    public static let WALK_CADENCE_THRESHOLD: Double = 120.0
    public static let WALK_SPEED_MS: Double = 0.83 // ~3.0 km/h altı
}
