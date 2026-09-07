// Types for Koşu Şiddeti Asistanı Core Engine

export type SurfaceType = 'ROAD' | 'TRAIL' | 'TRACK' | 'TREADMILL';
export type SportType = 'RUN' | 'TRAIL_RUN' | 'TREADMILL_RUN' | 'OTHER';

export interface NormalizedActivity {
  id: string;
  userId: string;
  sportType: SportType;
  title?: string;
  startTime: string; // ISO 8601
  elapsedTimeSec: number;
  movingTimeSec: number;
  distanceMeters: number;
  elevationGainMeters: number;
  hasHeartRate: boolean;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  avgPaceSecPerKm: number;
  gapSecPerKm: number; // Grade Adjusted Pace (saniye/km)
  surfaceType: SurfaceType;
  athletesCount?: number;
  isManual?: boolean;
  workoutType?: number; // 1 = Race, 2 = Long Run, 3 = Workout
  startLatitude?: number;
  startLongitude?: number;
  hasInstantaneousPace?: boolean;
  routeFilePath?: string;
  sourceName?: string;
  paceSource?: 'RUNNING_SPEED' | 'GPX_TRACKPOINT' | 'DISTANCE_INTERVAL' | 'ACTIVITY_AVERAGE';
}

export interface StreamPoint {
  t: number; // Aktivite başlangıcından itibaren saniye
  hr?: number;
  cad?: number;
  gap?: number; // Saniye/km cinsinden anlık eğim düzeltmeli tempo
  alt?: number;
  dist?: number;
}

export interface WeatherSnapshot {
  temperatureC: number;
  apparentTemperatureC: number;
  relativeHumidity: number;
  windSpeedKmh: number;
  weatherCode?: number;
  isExtremeHeat?: boolean;
}

export interface AppleHealthMetrics {
  vo2MaxMlPerKgMin?: number;
  restingHeartRate?: number;
  hrvSdnnMs?: number;
  age?: number;
}

export type DerivationMethod = 
  | 'EMPIRICAL_PACE_HR_MAPPING' // En yüksek doğruluk: Kişisel hız-nabız eşlemesi
  | 'APPLE_VO2MAX_THEORETICAL'  // İkincil: Apple VO2max teorik dönüşümü
  | 'VDOT_RACE'                 // Yarış eforu
  | 'TALK_TEST_ANCHOR'          // Konuşma testi çıpası
  | 'UNVERIFIED_ESTIMATE';      // Düşük güven

export interface UserThresholds {
  id: string;
  userId: string;
  validFrom: string;
  validTo?: string;
  
  // Eşik Değerleri
  hrMaxEstimated: number;
  hrRest?: number;
  lthr: number; 
  
  // AeT Güven Aralığı (Error Margin / Boundary Zone)
  aerobicThresholdHrPoint: number;  // Nokta tahmini
  aerobicThresholdHrMargin: number; // Hata payı (+- bpm)
  aerobicThresholdHrMin: number;    // Alt sınır
  aerobicThresholdHrMax: number;    // Üst sınır
  
  thresholdPaceGapSecPerKm: number; // Eşik temposu (sn/km)
  easyPaceCeilingGapSecPerKm: number; // Kolay tempo tavanı (sn/km)
  
  derivationMethod: DerivationMethod;
  confidenceScore: number; // 0.00 - 1.00
  calibrationStatus: 'CALIBRATING' | 'CALIBRATED' | 'RECALIBRATED_RETROACTIVELY';
}

export type AssessmentIntent = 'EASY' | 'QUALITY' | 'LONG' | 'RACE';

export type AssessmentJudgment = 
  | 'ACCORDING_TO_PLAN'
  | 'DRIFTED_GRAY'
  | 'DRIFTED_THRESHOLD'
  | 'WEATHER_PARDON'
  | 'UNDER_STIMULATED'
  | 'QUALITY_SUCCESS'
  | 'BOUNDARY_ZONE'      // AeT hata aralığının içinde kalan belirsiz koşular
  | 'OBSERVATION_ONLY';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Assessment {
  activityId: string;
  userId: string;
  thresholdId: string;
  inferredIntent: AssessmentIntent;
  isUserOverridden: boolean;
  
  // 4 Bölgeli Belirsizlik Dağılımı
  definiteEasyPct: number;      // HR < AeT_min (Kesin Kolay)
  uncertainCorridorPct: number; // AeT_min <= HR <= AeT_max (Belirsizlik Koridoru)
  definiteGrayPct: number;      // AeT_max < HR <= LTHR (Kesin Gri Bölge)
  definiteThresholdPct: number; // HR > LTHR (Kesin Eşik)

  // Geriye dönük uyumluluk için 3 bölgeli özetler
  zoneEasyPct: number;
  zoneModeratePct: number;
  zoneThresholdPct: number;

  analysisJudgment: AssessmentJudgment;
  templateId: string;
  outputSentence: string;
  secondaryCostSentence: string;
  confidenceLevel: ConfidenceLevel;
  confidenceScore: number;
  flags: string[];
  isSilenced: boolean;
  silenceReason?: string;
  steadyStateDurationSec: number;
}

export interface EngineInput {
  activity: NormalizedActivity;
  stream: StreamPoint[];
  thresholds: UserThresholds;
  weather?: WeatherSnapshot;
}
