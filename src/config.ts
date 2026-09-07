// Yapılandırma ve Eşik Sabitleri (Magic Numbers Yok Edildi)
// Her katsayının ve eşiğin fizyolojik / teknik gerekçesi yanına yazılmıştır.

export const CONFIG = {
  // SÜRE EŞİKLERİ (SANİYE)
  MIN_ACTIVITY_DURATION_SEC: 900, // 15 dk: Bu sürenin altı kararlı durum fizyolojik analizi için yetersizdir.
  SHORT_ACTIVITY_DURATION_SEC: 1200, // 20 dk: Kısa koşu sınırıdır, özel kısa koşu şablonuna düşer.
  LONG_RUN_DURATION_SEC: 4500, // 75 dk: Uzun koşu sınıflandırma tabanıdır.
  VERY_LONG_RUN_DURATION_SEC: 5400, // 90 dk: Bu süreden sonra dehidrasyon kaynaklı kardiyak sürüklenme (drift) kaçınılmazdır.

  // ISINMA PENCERESİ EŞİKLERİ
  MAX_WARMUP_SEC: 480, // 8 dk: Standart koşuda kardiyak gecikmenin (cardiac lag) aşılması için maksimum süre.
  WARMUP_RATIO_MAX: 0.20, // Koşu süresinin en fazla %20'si ısınma sayılabilir (kısa koşularda veriyi yememek için).
  WARMUP_EARLY_EFFORT_SEC: 60, // Isınma içinde 60 saniye kesintisiz eşik üstü koşulursa ısınma penceresi derhal sonlandırılır.

  // KADANS KİLİTLENMESİ (CADENCE LOCK) ÇİFT SİNYAL FİLTRESİ
  CADENCE_LOCK_DIFF_THRESHOLD: 2, // Nabız ile kadans arasındaki fark <= 2 ise sensör kilitlenmiş olabilir.
  CADENCE_LOCK_MIN_DURATION_SEC: 180, // Kilitlenmenin sensör hatası sayılması için en az 3 dakika kesintisiz sürmesi gerekir.
  CADENCE_LOCK_MAX_CORRUPT_RATIO: 0.30, // Koşunun %30'undan fazlası kilitliyse nabız verisi çöpe atılır, tempo moduna geçilir.
  CADENCE_LOCK_MAX_HR_STD_DEV: 1.2, // Gerçek kilitlenmede nabız varyansı çöker (standart sapma <= 1.2 bpm).

  // ÇEVRESEL / HAVA EŞİKLERİ
  HEAT_TEMPERATURE_THRESHOLD_C: 24.0, // 24°C ve üzeri: Termoregülasyon için kan akışı cilde yönelir, nabız yükselir.
  HEAT_HUMIDITY_THRESHOLD_PCT: 75, // %75 nem: Ter buharlaşamaz, kardiyak yük aynı tempoda belirgin artar.
  HIGH_WIND_SPEED_KMH: 25.0, // 25 km/h: Rüzgar direnci tempo eforunu bozar.
  TRAIL_ELEVATION_GAIN_M_PER_KM: 25.0, // Kilometre başına 25m tırmanış üstü teknik patika/yokuş kabul edilir.

  // FİZYOLOJİK ORANLAR (EŞİK TÜRETME)
  // LTHR / HRmax oranı: Antrenmanlı dayanıklılık sporcularında ortalama %86.5'tir (Seiler, 2013).
  LTHR_RATIO_OF_HRMAX: 0.865,
  // Aerobik Eşik (AeT / Zone 2 Tavanı): Kalibre edilmemiş rekreasyonel koşucularda sistematik
  // aşırı iyimserliği (Tip II hata) engellemek için konservatif %83 kullanılır.
  AET_RATIO_OF_LTHR: 0.84,
  AET_RATIO_OF_LTHR_UNCALIBRATED: 0.83,
  // Aerobik Ayrışma (Decoupling / Pw:Hr) Güvenlik Tavanı (%):
  AEROBIC_DECOUPLING_MAX_PCT: 5.0, // Kolay koşuda hız sabitken nabız >%5 sürüklenirse gizli glikojen/eşik ihlali sayılır.
  
  // FİZYOLOJİK DURUM BERAATİ (PHYSIOLOGICAL STATE PARDON)
  PHYSIOLOGICAL_HR_REST_SPIKE_BPM: 5.0, // Koşu sabahı dinlenik nabız tabandan >= 5 bpm yüksekse sistemik yorgunluk/hastalık sinyalidir.
  PHYSIOLOGICAL_HRV_DROP_PCT: 20.0, // Koşu sabahı HRV (SDNN) tabandan >= %20 baskılanmışsa toparlanma eksikliği sinyalidir.

  // Karvonen Kalp Atım Rezervi (HRR) Katsayıları:
  AET_KARVONEN_RESERVE_RATIO: 0.65, // AeT = HR_rest + 0.65 * HRR
  LTHR_KARVONEN_RESERVE_RATIO: 0.85, // LTHR = HR_rest + 0.85 * HRR

  // GÜVEN SKORLARI VE EŞİKLERİ
  HIGH_CONFIDENCE_THRESHOLD: 0.75, // Bu skorun üstünde motor iddialı ve kesin konuşur.
  MEDIUM_CONFIDENCE_THRESHOLD: 0.55, // Bu aralıkta temkinli dil kullanılır.
  // 0.55'in altında motor hüküm vermez, gözlem ve soru sorar.

  // ŞİDDET DAĞILIMI UYUM EŞİKLERİ (%)
  EASY_COMPLIANCE_ZONE1_MIN_PCT: 75.0, // Kolay koşunun başarılı sayılması için Zone 1'de en az %75 süre geçmelidir.
  MILD_DRIFT_THRESHOLD_PCT: 25.0, // Eşik bölgesinde %25 ve üzeri süre: Hafif sapma.
  SEVERE_DRIFT_THRESHOLD_PCT: 35.0, // Eşik bölgesinde %35 ve üzeri süre: Ağır sapma.
  MODERATE_GRAY_ZONE_DRIFT_PCT: 45.0, // Gri bölgede (Zone 2) %45 ve üzeri süre: Monotonluk/gri bölge sapması.

  // YÜRÜYÜŞ TESPİTİ (JEFFING)
  WALK_CADENCE_THRESHOLD: 120, // 120 adım/dk altı yürüyüş kabul edilir.
  WALK_SPEED_MS: 0.83, // ~3.0 km/h altı durma veya yavaş yürüyüştür.
} as const;
