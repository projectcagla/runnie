import Foundation

public struct ThresholdDerivationInput {
    public let userId: String
    public let activities: [NormalizedActivity]
    public var streams: [String: [StreamPoint]]
    public var appleMetrics: AppleHealthMetrics?
    public var talkTestConfirmedAeT: Double?

    public init(
        userId: String = "local_user",
        activities: [NormalizedActivity],
        streams: [String: [StreamPoint]] = [:],
        appleMetrics: AppleHealthMetrics? = nil,
        talkTestConfirmedAeT: Double? = nil
    ) {
        self.userId = userId
        self.activities = activities
        self.streams = streams
        self.appleMetrics = appleMetrics
        self.talkTestConfirmedAeT = talkTestConfirmedAeT
    }
}

public struct ThresholdDerivationEngine {
    /**
     * Daniels VDOT formülü ile VO2max'tan teorik tempo aralıkları türetir.
     */
    public static func derivePacesFromVO2max(_ vo2Max: Double) -> (thresholdPaceGap: Double, easyPaceCeilingGap: Double) {
        let a = 0.000104
        let b = 0.182258
        let c = -4.60 - vo2Max
        let vMetersPerMin = (-b + sqrt(b * b - 4 * a * c)) / (2 * a)
        let vVO2maxPaceSecPerKm = (1000.0 / vMetersPerMin) * 60.0

        let thresholdPaceGap = (vVO2maxPaceSecPerKm / 0.88).rounded()
        let easyPaceCeilingGap = (vVO2maxPaceSecPerKm / 0.68).rounded()

        return (thresholdPaceGap, easyPaceCeilingGap)
    }

    /**
     * Ampirik Hız -> Nabız Eşlemesi.
     * Sabit bpm tavanı olmadan, tamamen fizyolojik stabilite ve bireysel
     * tepe nabız oranıyla doğrulanır.
     */
    public static func deriveEmpiricalAeT(
        activities: [NormalizedActivity],
        streams: [String: [StreamPoint]],
        targetEasyPaceSec: Double,
        observedPeakHr: Double
    ) -> (empiricalAeT: Double, sampleCount: Int, isDecouplingVerified: Bool)? {
        var lowDecouplingHeartRates: [Double] = []
        var paceMatchingHeartRates: [Double] = []
        let paceToleranceSec: Double = 25.0

        for act in activities {
            if act.movingTimeSec < EngineConfig.MIN_ACTIVITY_DURATION_SEC { continue }
            if act.surfaceType == .trail { continue }

            guard let stream = streams[act.id], !stream.isEmpty else { continue }

            // 1. Aerobik Ayrışma (Decoupling) Analizi (Isınma sonrası 480sn ile 3600sn arası)
            let steadyPoints = stream.filter { $0.t >= 480 && $0.t <= 3600 && $0.hr != nil && $0.gap != nil }
            if steadyPoints.count >= 30 {
                let half = steadyPoints.count / 2
                let firstHalf = Array(steadyPoints[0..<half])
                let secondHalf = Array(steadyPoints[half..<steadyPoints.count])

                let avgHr1 = firstHalf.reduce(0.0) { $0 + ($1.hr ?? 0.0) } / Double(firstHalf.count)
                let avgGap1 = firstHalf.reduce(0.0) { $0 + ($1.gap ?? 0.0) } / Double(firstHalf.count)
                let avgHr2 = secondHalf.reduce(0.0) { $0 + ($1.hr ?? 0.0) } / Double(secondHalf.count)
                let avgGap2 = secondHalf.reduce(0.0) { $0 + ($1.gap ?? 0.0) } / Double(secondHalf.count)

                if abs(avgGap2 - avgGap1) <= 20.0 && avgGap1 > 0 && avgGap2 > 0 {
                    let decoupling = ((avgHr2 * avgGap1) / (avgHr1 * avgGap2) - 1.0) * 100.0
                    if decoupling <= 3.5 && decoupling >= -3.0 {
                        lowDecouplingHeartRates.append(((avgHr1 + avgHr2) / 2.0).rounded())
                    }
                }
            }

            // 2. Yedek: Hedef Kolay Tempo Civarı Pencereler
            for p in steadyPoints {
                if let hr = p.hr, let gap = p.gap, abs(gap - targetEasyPaceSec) <= paceToleranceSec {
                    paceMatchingHeartRates.append(hr)
                }
            }
        }

        let effectiveMaxHr = max(observedPeakHr, 175.0)
        let maxAllowedAeT = (effectiveMaxHr * 0.82).rounded()

        // Öncelik 1: Aerobik Ayrışması doğrulanmış seanslar
        if lowDecouplingHeartRates.count >= 2 {
            lowDecouplingHeartRates.sort()
            let medianHr = lowDecouplingHeartRates[lowDecouplingHeartRates.count / 2]
            if medianHr <= maxAllowedAeT {
                return (medianHr, lowDecouplingHeartRates.count, true)
            }
        }

        // Öncelik 2: Stabil tempo pencereleri
        if paceMatchingHeartRates.count >= 30 {
            paceMatchingHeartRates.sort()
            let medianHr = paceMatchingHeartRates[paceMatchingHeartRates.count / 2]
            if medianHr <= maxAllowedAeT {
                return (medianHr, paceMatchingHeartRates.count, false)
            }
        }

        return nil
    }

    /**
     * Kullanıcı geçmişinden kişisel eşikleri ve AeT HATA KORİDORUNU türeten saf fonksiyon.
     */
    public static func deriveThresholds(input: ThresholdDerivationInput) -> UserThresholds {
        let validActivities = input.activities.filter { $0.movingTimeSec >= EngineConfig.MIN_ACTIVITY_DURATION_SEC }

        // 1. Gözlenen Tepe Nabız
        var observedPeakHr: Double = 0.0
        for act in validActivities {
            if act.hasHeartRate, let maxHr = act.maxHr, maxHr > observedPeakHr, maxHr < 225 {
                observedPeakHr = maxHr
            }
        }

        // 2. YOL 1: Apple HealthKit VO2max Mevcutsa
        if let vo2 = input.appleMetrics?.vo2MaxMlPerKgMin, vo2 > 20.0 {
            let (thresholdPaceGap, easyPaceCeilingGap) = derivePacesFromVO2max(vo2)
            let empirical = deriveEmpiricalAeT(
                activities: validActivities,
                streams: input.streams,
                targetEasyPaceSec: easyPaceCeilingGap,
                observedPeakHr: observedPeakHr
            )

            var aetPoint: Double
            var aetMargin: Double
            var confidence: Double
            var method: DerivationMethod

            if let emp = empirical {
                aetPoint = emp.empiricalAeT
                aetMargin = 3.0
                confidence = emp.isDecouplingVerified ? 0.75 : 0.70
                method = .empiricalPaceHrMapping
            } else {
                let age = Double(input.appleMetrics?.age ?? 35)
                let baseHrMax = observedPeakHr > 0 ? observedPeakHr : (208.0 - 0.7 * age)
                let theoreticalLthr = (baseHrMax * EngineConfig.LTHR_RATIO_OF_HRMAX).rounded()
                aetPoint = (theoreticalLthr * EngineConfig.AET_RATIO_OF_LTHR_UNCALIBRATED).rounded()
                aetMargin = 6.0
                confidence = 0.60
                method = .appleVo2MaxTheoretical
            }

            if let confirmed = input.talkTestConfirmedAeT {
                aetPoint = confirmed
                aetMargin = 2.0
                confidence = 0.90
                method = .talkTestAnchor
            }

            let lthr = (aetPoint / EngineConfig.AET_RATIO_OF_LTHR).rounded()

            return UserThresholds(
                userId: input.userId,
                hrMaxEstimated: observedPeakHr > 0 ? observedPeakHr : 185.0,
                hrRest: input.appleMetrics?.restingHeartRate,
                lthr: lthr,
                aerobicThresholdHrPoint: aetPoint,
                aerobicThresholdHrMargin: aetMargin,
                aerobicThresholdHrMin: aetPoint - aetMargin,
                aerobicThresholdHrMax: aetPoint + aetMargin,
                thresholdPaceGapSecPerKm: thresholdPaceGap,
                easyPaceCeilingGapSecPerKm: easyPaceCeilingGap,
                derivationMethod: method,
                confidenceScore: confidence,
                calibrationStatus: confidence >= EngineConfig.HIGH_CONFIDENCE_THRESHOLD ? "CALIBRATED" : "CALIBRATING"
            )
        }

        // 3. YOL 2: Yarış Eforu Varsa
        let raceEffort = validActivities.first { act in
            act.workoutType == 1 || TurkishNormalizer.matchesKeywords(act.title ?? "", keywords: ["yarış", "race", "maraton", "10k", "5k", "parkrun"])
        }
        if let race = raceEffort, let gap = race.gapSecPerKm, gap > 0 {
            let thresholdPaceGap = (gap * 1.05).rounded()
            let easyPaceCeilingGap = (thresholdPaceGap * 1.22).rounded()

            let hrMax = (race.maxHr != nil && race.maxHr! > 150) ? race.maxHr! : (observedPeakHr > 0 ? observedPeakHr : 185.0)
            let lthr = (hrMax * 0.88).rounded()
            let aetPoint = (lthr * EngineConfig.AET_RATIO_OF_LTHR).rounded()

            return UserThresholds(
                userId: input.userId,
                hrMaxEstimated: hrMax,
                lthr: lthr,
                aerobicThresholdHrPoint: aetPoint,
                aerobicThresholdHrMargin: 4.0,
                aerobicThresholdHrMin: aetPoint - 4.0,
                aerobicThresholdHrMax: aetPoint + 4.0,
                thresholdPaceGapSecPerKm: thresholdPaceGap,
                easyPaceCeilingGapSecPerKm: easyPaceCeilingGap,
                derivationMethod: .vdotRace,
                confidenceScore: 0.72,
                calibrationStatus: "CALIBRATED"
            )
        }

        // 4. YOL 3: Yetersiz Veri / Gri Bölge Koşucusu
        let hrMax = observedPeakHr > 0 ? observedPeakHr : 180.0
        let lthr = (hrMax * EngineConfig.LTHR_RATIO_OF_HRMAX).rounded()
        let aetPoint = (lthr * EngineConfig.AET_RATIO_OF_LTHR_UNCALIBRATED).rounded()

        return UserThresholds(
            userId: input.userId,
            hrMaxEstimated: hrMax,
            lthr: lthr,
            aerobicThresholdHrPoint: aetPoint,
            aerobicThresholdHrMargin: 7.0,
            aerobicThresholdHrMin: aetPoint - 7.0,
            aerobicThresholdHrMax: aetPoint + 7.0,
            thresholdPaceGapSecPerKm: 300.0,
            easyPaceCeilingGapSecPerKm: 360.0,
            derivationMethod: .unverifiedEstimate,
            confidenceScore: 0.40,
            calibrationStatus: "CALIBRATING"
        )
    }
}
