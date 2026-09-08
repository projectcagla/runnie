import Foundation

public enum SurfaceType: String, Codable {
    case road = "ROAD"
    case trail = "TRAIL"
    case track = "TRACK"
    case treadmill = "TREADMILL"
}

public enum SportType: String, Codable {
    case run = "RUN"
    case trailRun = "TRAIL_RUN"
    case treadmillRun = "TREADMILL_RUN"
    case other = "OTHER"
}

public struct NormalizedActivity: Codable, Identifiable {
    public let id: String
    public let userId: String
    public var sportType: SportType
    public var title: String?
    public let startTime: String // ISO 8601
    public var elapsedTimeSec: Double
    public var movingTimeSec: Double
    public var distanceMeters: Double
    public var elevationGainMeters: Double
    public var hasHeartRate: Bool
    public var avgHr: Double?
    public var maxHr: Double?
    public var avgCadence: Double?
    public var avgPaceSecPerKm: Double?
    public var gapSecPerKm: Double?
    public var surfaceType: SurfaceType
    public var athletesCount: Int?
    public var isManual: Bool?
    public var workoutType: Int?
    public var startLatitude: Double?
    public var startLongitude: Double?
    public var hasInstantaneousPace: Bool?
    public var routeFilePath: String?
    public var sourceName: String?
    public var paceSource: String?
    public var userFeedbackTag: String?
    public var isDuplicate: Bool = false
    public var duplicateOfId: String?

    public init(
        id: String = UUID().uuidString,
        userId: String = "local_user",
        sportType: SportType = .run,
        title: String? = nil,
        startTime: String,
        elapsedTimeSec: Double,
        movingTimeSec: Double,
        distanceMeters: Double,
        elevationGainMeters: Double = 0.0,
        hasHeartRate: Bool = false,
        avgHr: Double? = nil,
        maxHr: Double? = nil,
        avgCadence: Double? = nil,
        avgPaceSecPerKm: Double? = nil,
        gapSecPerKm: Double? = nil,
        surfaceType: SurfaceType = .road,
        athletesCount: Int? = nil,
        isManual: Bool? = false,
        workoutType: Int? = nil,
        startLatitude: Double? = nil,
        startLongitude: Double? = nil,
        hasInstantaneousPace: Bool? = false,
        routeFilePath: String? = nil,
        sourceName: String? = nil,
        paceSource: String? = nil,
        userFeedbackTag: String? = nil,
        isDuplicate: Bool = false,
        duplicateOfId: String? = nil
    ) {
        self.id = id
        self.userId = userId
        self.sportType = sportType
        self.title = title
        self.startTime = startTime
        self.elapsedTimeSec = elapsedTimeSec
        self.movingTimeSec = movingTimeSec
        self.distanceMeters = distanceMeters
        self.elevationGainMeters = elevationGainMeters
        self.hasHeartRate = hasHeartRate
        self.avgHr = avgHr
        self.maxHr = maxHr
        self.avgCadence = avgCadence
        self.avgPaceSecPerKm = avgPaceSecPerKm
        self.gapSecPerKm = gapSecPerKm
        self.surfaceType = surfaceType
        self.athletesCount = athletesCount
        self.isManual = isManual
        self.workoutType = workoutType
        self.startLatitude = startLatitude
        self.startLongitude = startLongitude
        self.hasInstantaneousPace = hasInstantaneousPace
        self.routeFilePath = routeFilePath
        self.sourceName = sourceName
        self.paceSource = paceSource
        self.userFeedbackTag = userFeedbackTag
        self.isDuplicate = isDuplicate
        self.duplicateOfId = duplicateOfId
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.userId = (try? container.decode(String.self, forKey: .userId)) ?? "local_user"
        self.sportType = try container.decode(SportType.self, forKey: .sportType)
        self.title = try? container.decode(String.self, forKey: .title)
        self.startTime = try container.decode(String.self, forKey: .startTime)
        self.elapsedTimeSec = try container.decode(Double.self, forKey: .elapsedTimeSec)
        self.movingTimeSec = try container.decode(Double.self, forKey: .movingTimeSec)
        self.distanceMeters = try container.decode(Double.self, forKey: .distanceMeters)
        self.elevationGainMeters = (try? container.decode(Double.self, forKey: .elevationGainMeters)) ?? 0.0
        self.hasHeartRate = (try? container.decode(Bool.self, forKey: .hasHeartRate)) ?? false
        self.avgHr = try? container.decode(Double.self, forKey: .avgHr)
        self.maxHr = try? container.decode(Double.self, forKey: .maxHr)
        self.avgCadence = try? container.decode(Double.self, forKey: .avgCadence)
        self.avgPaceSecPerKm = try? container.decode(Double.self, forKey: .avgPaceSecPerKm)
        self.gapSecPerKm = try? container.decode(Double.self, forKey: .gapSecPerKm)
        self.surfaceType = (try? container.decode(SurfaceType.self, forKey: .surfaceType)) ?? .road
        self.athletesCount = try? container.decode(Int.self, forKey: .athletesCount)
        self.isManual = try? container.decode(Bool.self, forKey: .isManual)
        self.workoutType = try? container.decode(Int.self, forKey: .workoutType)
        self.startLatitude = try? container.decode(Double.self, forKey: .startLatitude)
        self.startLongitude = try? container.decode(Double.self, forKey: .startLongitude)
        self.hasInstantaneousPace = try? container.decode(Bool.self, forKey: .hasInstantaneousPace)
        self.routeFilePath = try? container.decode(String.self, forKey: .routeFilePath)
        self.sourceName = try? container.decode(String.self, forKey: .sourceName)
        self.paceSource = try? container.decode(String.self, forKey: .paceSource)
        self.userFeedbackTag = try? container.decode(String.self, forKey: .userFeedbackTag)
        self.isDuplicate = (try? container.decode(Bool.self, forKey: .isDuplicate)) ?? false
        self.duplicateOfId = try? container.decode(String.self, forKey: .duplicateOfId)
    }
}

public struct StreamPoint: Codable {
    public let t: Double // Aktivite başlangıcından saniye
    public var hr: Double?
    public var cad: Double?
    public var gap: Double? // sn/km
    public var alt: Double?
    public var dist: Double?

    public init(t: Double, hr: Double? = nil, cad: Double? = nil, gap: Double? = nil, alt: Double? = nil, dist: Double? = nil) {
        self.t = t
        self.hr = hr
        self.cad = cad
        self.gap = gap
        self.alt = alt
        self.dist = dist
    }
}

public struct WeatherSnapshot: Codable {
    public let temperatureC: Double
    public let apparentTemperatureC: Double
    public let relativeHumidity: Double
    public let windSpeedKmh: Double
    public var weatherCode: Int?
    public var isExtremeHeat: Bool?

    public init(temperatureC: Double, apparentTemperatureC: Double, relativeHumidity: Double, windSpeedKmh: Double, weatherCode: Int? = nil, isExtremeHeat: Bool? = false) {
        self.temperatureC = temperatureC
        self.apparentTemperatureC = apparentTemperatureC
        self.relativeHumidity = relativeHumidity
        self.windSpeedKmh = windSpeedKmh
        self.weatherCode = weatherCode
        self.isExtremeHeat = isExtremeHeat
    }
}

public struct AppleHealthMetrics: Codable {
    public var vo2MaxMlPerKgMin: Double?
    public var restingHeartRate: Double?
    public var hrvSdnnMs: Double?
    public var age: Int?

    public init(vo2MaxMlPerKgMin: Double? = nil, restingHeartRate: Double? = nil, hrvSdnnMs: Double? = nil, age: Int? = nil) {
        self.vo2MaxMlPerKgMin = vo2MaxMlPerKgMin
        self.restingHeartRate = restingHeartRate
        self.hrvSdnnMs = hrvSdnnMs
        self.age = age
    }
}

public enum DerivationMethod: String, Codable {
    case empiricalPaceHrMapping = "EMPIRICAL_PACE_HR_MAPPING"
    case appleVo2MaxTheoretical = "APPLE_VO2MAX_THEORETICAL"
    case vdotRace = "VDOT_RACE"
    case talkTestAnchor = "TALK_TEST_ANCHOR"
    case unverifiedEstimate = "UNVERIFIED_ESTIMATE"
}

public struct UserThresholds: Codable, Identifiable {
    public let id: String
    public let userId: String
    public let validFrom: String
    public var validTo: String?
    public var hrMaxEstimated: Double
    public var hrRest: Double?
    public var lthr: Double
    public var aerobicThresholdHrPoint: Double
    public var aerobicThresholdHrMargin: Double
    public var aerobicThresholdHrMin: Double
    public var aerobicThresholdHrMax: Double
    public var thresholdPaceGapSecPerKm: Double
    public var easyPaceCeilingGapSecPerKm: Double
    public var derivationMethod: DerivationMethod
    public var confidenceScore: Double
    public var calibrationStatus: String

    public init(
        id: String = "thresh_\(Int(Date().timeIntervalSince1970))",
        userId: String = "local_user",
        validFrom: String = ISO8601DateFormatter().string(from: Date()),
        validTo: String? = nil,
        hrMaxEstimated: Double,
        hrRest: Double? = nil,
        lthr: Double,
        aerobicThresholdHrPoint: Double,
        aerobicThresholdHrMargin: Double,
        aerobicThresholdHrMin: Double,
        aerobicThresholdHrMax: Double,
        thresholdPaceGapSecPerKm: Double,
        easyPaceCeilingGapSecPerKm: Double,
        derivationMethod: DerivationMethod,
        confidenceScore: Double,
        calibrationStatus: String
    ) {
        self.id = id
        self.userId = userId
        self.validFrom = validFrom
        self.validTo = validTo
        self.hrMaxEstimated = hrMaxEstimated
        self.hrRest = hrRest
        self.lthr = lthr
        self.aerobicThresholdHrPoint = aerobicThresholdHrPoint
        self.aerobicThresholdHrMargin = aerobicThresholdHrMargin
        self.aerobicThresholdHrMin = aerobicThresholdHrMin
        self.aerobicThresholdHrMax = aerobicThresholdHrMax
        self.thresholdPaceGapSecPerKm = thresholdPaceGapSecPerKm
        self.easyPaceCeilingGapSecPerKm = easyPaceCeilingGapSecPerKm
        self.derivationMethod = derivationMethod
        self.confidenceScore = confidenceScore
        self.calibrationStatus = calibrationStatus
    }
}

public enum AssessmentIntent: String, Codable {
    case easy = "EASY"
    case quality = "QUALITY"
    case long = "LONG"
    case race = "RACE"
}

public enum AssessmentJudgment: String, Codable {
    case accordingToPlan = "ACCORDING_TO_PLAN"
    case driftedGray = "DRIFTED_GRAY"
    case driftedThreshold = "DRIFTED_THRESHOLD"
    case weatherPardon = "WEATHER_PARDON"
    case physiologicalPardon = "PHYSIOLOGICAL_PARDON"
    case underStimulated = "UNDER_STIMULATED"
    case qualitySuccess = "QUALITY_SUCCESS"
    case boundaryZone = "BOUNDARY_ZONE"
    case observationOnly = "OBSERVATION_ONLY"
}

public enum ConfidenceLevel: String, Codable {
    case high = "HIGH"
    case medium = "MEDIUM"
    case low = "LOW"
}

public struct PhysiologicalBaselines: Codable {
    public var restingHrBaseline: Double?
    public var hrvSdnnBaseline: Double?
    public var todayRestingHr: Double?
    public var todayHrvSdnn: Double?

    public init(restingHrBaseline: Double? = nil, hrvSdnnBaseline: Double? = nil, todayRestingHr: Double? = nil, todayHrvSdnn: Double? = nil) {
        self.restingHrBaseline = restingHrBaseline
        self.hrvSdnnBaseline = hrvSdnnBaseline
        self.todayRestingHr = todayRestingHr
        self.todayHrvSdnn = todayHrvSdnn
    }
}

public struct Assessment: Codable, Identifiable {
    public var id: String { activityId }
    public let activityId: String
    public let userId: String
    public let thresholdId: String
    public var inferredIntent: AssessmentIntent
    public var isUserOverridden: Bool
    public var definiteEasyPct: Double
    public var uncertainCorridorPct: Double
    public var definiteGrayPct: Double
    public var definiteThresholdPct: Double
    public var zoneEasyPct: Double
    public var zoneModeratePct: Double
    public var zoneThresholdPct: Double
    public var analysisJudgment: AssessmentJudgment
    public var templateId: String
    public var outputSentence: String
    public var secondaryCostSentence: String
    public var confidenceLevel: ConfidenceLevel
    public var confidenceScore: Double
    public var flags: [String]
    public var isSilenced: Bool
    public var silenceReason: String?
    public var steadyStateDurationSec: Double
    public var aerobicDecouplingPct: Double?

    public init(
        activityId: String,
        userId: String = "local_user",
        thresholdId: String,
        inferredIntent: AssessmentIntent,
        isUserOverridden: Bool = false,
        definiteEasyPct: Double,
        uncertainCorridorPct: Double,
        definiteGrayPct: Double,
        definiteThresholdPct: Double,
        zoneEasyPct: Double,
        zoneModeratePct: Double,
        zoneThresholdPct: Double,
        analysisJudgment: AssessmentJudgment,
        templateId: String,
        outputSentence: String,
        secondaryCostSentence: String,
        confidenceLevel: ConfidenceLevel,
        confidenceScore: Double,
        flags: [String],
        isSilenced: Bool,
        silenceReason: String? = nil,
        steadyStateDurationSec: Double,
        aerobicDecouplingPct: Double? = nil
    ) {
        self.activityId = activityId
        self.userId = userId
        self.thresholdId = thresholdId
        self.inferredIntent = inferredIntent
        self.isUserOverridden = isUserOverridden
        self.definiteEasyPct = definiteEasyPct
        self.uncertainCorridorPct = uncertainCorridorPct
        self.definiteGrayPct = definiteGrayPct
        self.definiteThresholdPct = definiteThresholdPct
        self.zoneEasyPct = zoneEasyPct
        self.zoneModeratePct = zoneModeratePct
        self.zoneThresholdPct = zoneThresholdPct
        self.analysisJudgment = analysisJudgment
        self.templateId = templateId
        self.outputSentence = outputSentence
        self.secondaryCostSentence = secondaryCostSentence
        self.confidenceLevel = confidenceLevel
        self.confidenceScore = confidenceScore
        self.flags = flags
        self.isSilenced = isSilenced
        self.silenceReason = silenceReason
        self.steadyStateDurationSec = steadyStateDurationSec
        self.aerobicDecouplingPct = aerobicDecouplingPct
    }
}

public struct EngineInput {
    public let activity: NormalizedActivity
    public let stream: [StreamPoint]
    public let thresholds: UserThresholds
    public var weather: WeatherSnapshot?
    public var physiologicalBaselines: PhysiologicalBaselines?

    public init(activity: NormalizedActivity, stream: [StreamPoint], thresholds: UserThresholds, weather: WeatherSnapshot? = nil, physiologicalBaselines: PhysiologicalBaselines? = nil) {
        self.activity = activity
        self.stream = stream
        self.thresholds = thresholds
        self.weather = weather
        self.physiologicalBaselines = physiologicalBaselines
    }
}
