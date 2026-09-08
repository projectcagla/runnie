import Foundation

public struct RunnieEngine {
    /**
     * Akış İçi İnterval Tespiti:
     * Koşucu başlığa "Sabah Koşusu" yazmış olsa dahi, akışta periyodik
     * yüksek hız/nabız patlamaları (aralıklar) varsa interval seansını tespit eder.
     */
    public static func detectIntervalSignature(stream: [StreamPoint], thresholds: UserThresholds) -> Bool {
        guard stream.count >= 30 else { return false }

        var fastBurstCount = 0
        var currentBurstLength: Double = 0
        var inBurst = false

        for i in 1..<stream.count {
            let p = stream[i]
            let dt = p.t - stream[i - 1].t

            let isFast = (p.gap != nil && p.gap! <= thresholds.thresholdPaceGapSecPerKm) ||
                         (p.hr != nil && p.hr! >= thresholds.lthr)

            if isFast {
                currentBurstLength += dt
                if currentBurstLength >= 30 && !inBurst {
                    inBurst = true
                    fastBurstCount += 1
                }
            } else {
                if currentBurstLength >= 30 {
                    inBurst = false
                }
                currentBurstLength = 0
            }
        }

        return fastBurstCount >= 3
    }

    public static func evaluateActivity(input: EngineInput) -> Assessment {
        let activity = input.activity
        let stream = input.stream
        let thresholds = input.thresholds
        let weather = input.weather
        var flags: [String] = []

        // ADIM 1: ÖN FİLTRELEME
        if activity.sportType != .run && activity.sportType != .trailRun && activity.sportType != .treadmillRun {
            return createSilencedAssessment(
                activityId: activity.id,
                userId: activity.userId,
                thresholdId: thresholds.id,
                reason: "NON_RUN_SPORT",
                explanation: "Koşu dışı aktivite; analiz edilmez."
            )
        }

        if activity.movingTimeSec < EngineConfig.MIN_ACTIVITY_DURATION_SEC {
            return createSilencedAssessment(
                activityId: activity.id,
                userId: activity.userId,
                thresholdId: thresholds.id,
                reason: "DURATION_TOO_SHORT",
                explanation: "15 dakikadan kısa aktivite; fizyolojik analiz yapılamaz."
            )
        }

        // ADIM 1.1: KOŞU AKIL SAĞLIĞI FİLTRESİ (SANITY FILTER)
        let isZeroDistance = activity.distanceMeters <= 50.0
        let hasLowCadence = activity.avgCadence != nil && activity.avgCadence! < 60.0
        let hasNoRunningCadenceInStream = !stream.isEmpty && !stream.contains(where: { ($0.cad ?? 0) >= 60.0 })

        if isZeroDistance && activity.movingTimeSec >= 300.0 {
            if hasLowCadence || hasNoRunningCadenceInStream || (activity.avgCadence == nil && !(activity.hasInstantaneousPace ?? false) && (activity.avgHr ?? 0) < 95.0) {
                return createSilencedAssessment(
                    activityId: activity.id,
                    userId: activity.userId,
                    thresholdId: thresholds.id,
                    reason: "SUSPICIOUS_NON_RUN",
                    explanation: "Şüpheli koşu dışı aktivite; sıfır mesafe ve koşu kadansı tespit edilemedi."
                )
            }
        }

        let isTreadmill = activity.sportType == .treadmillRun || activity.surfaceType == .treadmill
        if isTreadmill {
            flags.append("TREADMILL")
            if !activity.hasHeartRate {
                return createSilencedAssessment(
                    activityId: activity.id,
                    userId: activity.userId,
                    thresholdId: thresholds.id,
                    reason: "TREADMILL_NO_HR",
                    explanation: "Koşu bandında nabız ve GPS verisi bulunmadığından analiz yapılamaz."
                )
            }
            flags.append("TREADMILL_ONLY_HR")
        }

        let isTrail = activity.sportType == .trailRun || activity.surfaceType == .trail ||
            (activity.distanceMeters > 0 && (activity.elevationGainMeters / (activity.distanceMeters / 1000.0) >= EngineConfig.TRAIL_ELEVATION_GAIN_M_PER_KM))
        if isTrail { flags.append("TRAIL") }

        // ADIM 2: KADANS KİLİTLENMESİ TESPİTİ (ÇİFT SİNYAL: Yakınlık VE Varyans Çöküşü)
        var useHeartRate = activity.hasHeartRate
        if useHeartRate && !stream.isEmpty {
            var lockedSeconds: Double = 0
            var currentLockStreak: Double = 0
            var streakHrs: [Double] = []

            for i in 1..<stream.count {
                let p = stream[i]
                let dt = p.t - stream[i - 1].t
                if let hr = p.hr, let cad = p.cad, abs(hr - cad) <= EngineConfig.CADENCE_LOCK_DIFF_THRESHOLD {
                    currentLockStreak += dt
                    streakHrs.append(hr)

                    if currentLockStreak >= EngineConfig.CADENCE_LOCK_MIN_DURATION_SEC {
                        let mean = streakHrs.reduce(0.0, +) / Double(streakHrs.count)
                        let variance = streakHrs.reduce(0.0) { $0 + pow($1 - mean, 2) } / Double(streakHrs.count)
                        let stdDev = sqrt(variance)

                        if stdDev <= EngineConfig.CADENCE_LOCK_MAX_HR_STD_DEV {
                            lockedSeconds += dt
                        }
                    }
                } else {
                    currentLockStreak = 0
                    streakHrs.removeAll()
                }
            }

            if activity.movingTimeSec > 0 && (lockedSeconds / activity.movingTimeSec >= EngineConfig.CADENCE_LOCK_MAX_CORRUPT_RATIO) {
                useHeartRate = false
                flags.append("CADENCE_LOCK")
            }
        }

        // ADIM 3: DİNAMİK ISINMA KIRPMA
        let maxWarmupSec = min(EngineConfig.MAX_WARMUP_SEC, (activity.movingTimeSec * EngineConfig.WARMUP_RATIO_MAX).rounded())
        var warmupEndSec = maxWarmupSec

        if !stream.isEmpty {
            var highEffortStreak: Double = 0
            for i in 1..<stream.count {
                let p = stream[i]
                if p.t > maxWarmupSec { break }
                let dt = p.t - stream[i - 1].t

                let isHighEffort = (useHeartRate && p.hr != nil && p.hr! >= thresholds.lthr) ||
                                   (!useHeartRate && p.gap != nil && p.gap! <= thresholds.thresholdPaceGapSecPerKm)

                if isHighEffort {
                    highEffortStreak += dt
                    if highEffortStreak >= EngineConfig.WARMUP_EARLY_EFFORT_SEC {
                        warmupEndSec = p.t
                        flags.append("EARLY_WARMUP_EFFORT")
                        break
                    }
                } else {
                    highEffortStreak = 0
                }
            }
        }

        let steadyStream = stream.filter { $0.t >= warmupEndSec }
        let steadyDurationSec = max(0, activity.movingTimeSec - warmupEndSec)

        // ADIM 4: YÜRÜYÜŞ TESPİTİ
        var walkSeconds: Double = 0
        if !steadyStream.isEmpty {
            for i in 1..<steadyStream.count {
                let p = steadyStream[i]
                let dt = p.t - steadyStream[i - 1].t
                if (p.cad != nil && p.cad! < EngineConfig.WALK_CADENCE_THRESHOLD) || (p.gap != nil && p.gap! > 720.0) {
                    walkSeconds += dt
                }
            }
            if walkSeconds >= 60.0 { flags.append("WALK_BREAKS") }
        }

        // ADIM 5: NİYET (INTENT) TAHMİNİ
        var inferredIntent: AssessmentIntent = .easy
        let title = activity.title ?? ""

        let raceKeywords = ["yarış", "race", "maraton", "marathon", "10k", "5k", "parkrun", "yarı maraton"]
        let qualityKeywords = ["tempo", "interval", "tekrar", "aralık", "fartlek", "yokuş"]

        if activity.workoutType == 1 || TurkishNormalizer.matchesKeywords(title, keywords: raceKeywords) {
            inferredIntent = .race
        } else if TurkishNormalizer.matchesKeywords(title, keywords: qualityKeywords) {
            inferredIntent = .quality
        } else if detectIntervalSignature(stream: steadyStream, thresholds: thresholds) {
            inferredIntent = .quality
            flags.append("INTERVAL_SIGNATURE_DETECTED")
        } else if activity.movingTimeSec >= EngineConfig.LONG_RUN_DURATION_SEC {
            inferredIntent = .long
        }

        if (activity.athletesCount != nil && activity.athletesCount! > 1) || activity.userFeedbackTag == "GROUP_RUN" {
            flags.append("GROUP_RUN")
        } else {
            // Hafta sonu sabahı tempo dalgalanması analizi
            let formatter = ISO8601DateFormatter()
            if let actDate = formatter.date(from: activity.startTime) {
                let cal = Calendar(identifier: .gregorian)
                let weekday = cal.component(.weekday, from: actDate) // 1 = Pazar, 7 = Cumartesi
                let hour = cal.component(.hour, from: actDate)
                let isWeekendMorning = (weekday == 1 || weekday == 7) && (hour >= 4 && hour <= 10)
                if isWeekendMorning && steadyStream.count >= 30 {
                    let gaps = steadyStream.compactMap { $0.gap }.filter { $0 > 0 }
                    if gaps.count > 20 {
                        let meanGap = gaps.reduce(0.0, +) / Double(gaps.count)
                        let varGap = gaps.reduce(0.0) { $0 + pow($1 - meanGap, 2) } / Double(gaps.count)
                        let stdDevGap = sqrt(varGap)
                        if stdDevGap > 30.0 {
                            flags.append("GROUP_RUN_CANDIDATE")
                        }
                    }
                }
            }
        }

        // Aerobik Ayrışma (Decoupling) Hesabı
        var aerobicDecouplingPct: Double? = nil
        if steadyStream.count >= 30 {
            let validSteadyPoints = steadyStream.filter { $0.hr != nil && $0.gap != nil }
            if validSteadyPoints.count >= 20 {
                let half = validSteadyPoints.count / 2
                let firstHalf = Array(validSteadyPoints[0..<half])
                let secondHalf = Array(validSteadyPoints[half..<validSteadyPoints.count])

                let avgHr1 = firstHalf.reduce(0.0) { $0 + ($1.hr ?? 0.0) } / Double(firstHalf.count)
                let avgGap1 = firstHalf.reduce(0.0) { $0 + ($1.gap ?? 0.0) } / Double(firstHalf.count)
                let avgHr2 = secondHalf.reduce(0.0) { $0 + ($1.hr ?? 0.0) } / Double(secondHalf.count)
                let avgGap2 = secondHalf.reduce(0.0) { $0 + ($1.gap ?? 0.0) } / Double(secondHalf.count)

                if avgGap1 > 0 && avgGap2 > 0 && abs(avgGap2 - avgGap1) <= 25.0 {
                    let decoupling = ((avgHr2 * avgGap1) / (avgHr1 * avgGap2) - 1.0) * 100.0
                    aerobicDecouplingPct = (decoupling * 10.0).rounded() / 10.0
                    if aerobicDecouplingPct! > EngineConfig.AEROBIC_DECOUPLING_MAX_PCT {
                        flags.append("AEROBIC_DRIFT_WARNING")
                    }
                }
            }
        }

        // ADIM 6: 4 BÖLGELİ DAĞILIM HESABI
        var defEasySec: Double = 0
        var uncCorridorSec: Double = 0
        var defGraySec: Double = 0
        var defThreshSec: Double = 0

        if steadyStream.count > 1 {
            for i in 1..<steadyStream.count {
                let p = steadyStream[i]
                let dt = p.t - steadyStream[i - 1].t

                if useHeartRate, let hr = p.hr {
                    if hr < thresholds.aerobicThresholdHrMin {
                        defEasySec += dt
                    } else if hr <= thresholds.aerobicThresholdHrMax {
                        uncCorridorSec += dt
                    } else if hr <= thresholds.lthr {
                        defGraySec += dt
                    } else {
                        defThreshSec += dt
                    }
                } else {
                    let gap = p.gap ?? activity.gapSecPerKm
                    if let g = gap, g > 0 {
                        if g >= thresholds.easyPaceCeilingGapSecPerKm + 15.0 {
                            defEasySec += dt
                        } else if g >= thresholds.easyPaceCeilingGapSecPerKm - 15.0 {
                            uncCorridorSec += dt
                        } else if g > thresholds.thresholdPaceGapSecPerKm {
                            defGraySec += dt
                        } else {
                            defThreshSec += dt
                        }
                    }
                }
            }
        }

        let totalSec = max(1.0, defEasySec + uncCorridorSec + defGraySec + defThreshSec)
        let definiteEasyPct = ((defEasySec / totalSec) * 1000.0).rounded() / 10.0
        let uncertainCorridorPct = ((uncCorridorSec / totalSec) * 1000.0).rounded() / 10.0
        let definiteGrayPct = ((defGraySec / totalSec) * 1000.0).rounded() / 10.0
        let definiteThresholdPct = ((defThreshSec / totalSec) * 1000.0).rounded() / 10.0

        let zoneEasyPct = (((defEasySec + (uncCorridorSec * 0.5)) / totalSec) * 1000.0).rounded() / 10.0
        let zoneModeratePct = (((defGraySec + (uncCorridorSec * 0.5)) / totalSec) * 1000.0).rounded() / 10.0
        let zoneThresholdPct = definiteThresholdPct

        // ADIM 7: HÜKÜM & ŞABLON SEÇİMİ
        var analysisJudgment: AssessmentJudgment = .accordingToPlan

        let isHeatStress = weather != nil && (
            weather!.temperatureC >= EngineConfig.HEAT_TEMPERATURE_THRESHOLD_C ||
            weather!.relativeHumidity >= EngineConfig.HEAT_HUMIDITY_THRESHOLD_PCT
        )

        let baselines = input.physiologicalBaselines
        var isPhysiologicalStress = false
        if let todayRhr = baselines?.todayRestingHr, let baseRhr = baselines?.restingHrBaseline {
            if todayRhr - baseRhr >= EngineConfig.PHYSIOLOGICAL_HR_REST_SPIKE_BPM {
                isPhysiologicalStress = true
                flags.append("RESTING_HR_ELEVATED")
            }
        }
        if let todayHrv = baselines?.todayHrvSdnn, let baseHrv = baselines?.hrvSdnnBaseline, baseHrv > 0 {
            let dropPct = ((baseHrv - todayHrv) / baseHrv) * 100.0
            if dropPct >= EngineConfig.PHYSIOLOGICAL_HRV_DROP_PCT {
                isPhysiologicalStress = true
                flags.append("HRV_SUPPRESSED")
            }
        }

        if inferredIntent == .easy {
            let totalHighIntensityPct = definiteGrayPct + definiteThresholdPct
            let paceIsEasy = isTreadmill || (
                activity.gapSecPerKm != nil &&
                activity.gapSecPerKm! >= thresholds.easyPaceCeilingGapSecPerKm
            )

            // KURAL 1: Net Kolay Koşu Başarısı
            if definiteEasyPct >= EngineConfig.EASY_COMPLIANCE_ZONE1_MIN_PCT || (totalHighIntensityPct == 0 && paceIsEasy) {
                analysisJudgment = .accordingToPlan
            }
            // KURAL 2: Net İhlal / Aşırı Şiddet veya Beraat
            else if totalHighIntensityPct >= EngineConfig.MILD_DRIFT_THRESHOLD_PCT {
                if isHeatStress && paceIsEasy {
                    analysisJudgment = .weatherPardon
                    flags.append("WEATHER_PARDONED")
                } else if isPhysiologicalStress && paceIsEasy {
                    analysisJudgment = .physiologicalPardon
                    flags.append("PHYSIOLOGICAL_PARDONED")
                } else if definiteThresholdPct >= EngineConfig.SEVERE_DRIFT_THRESHOLD_PCT {
                    analysisJudgment = .driftedThreshold
                } else {
                    analysisJudgment = .driftedGray
                }
            }
            // KURAL 3: Belirsizlik / Sınır Koridoru
            else if uncertainCorridorPct >= 25.0 && totalHighIntensityPct > 0 {
                analysisJudgment = .boundaryZone
                flags.append("BOUNDARY_CORRIDOR")
            } else {
                analysisJudgment = .accordingToPlan
            }
        } else if inferredIntent == .quality {
            if definiteThresholdPct >= 25.0 || (definiteGrayPct + definiteThresholdPct) >= 60.0 {
                analysisJudgment = .qualitySuccess
            } else {
                analysisJudgment = .underStimulated
            }
        } else if inferredIntent == .long {
            if activity.movingTimeSec >= EngineConfig.VERY_LONG_RUN_DURATION_SEC {
                flags.append("CARDIAC_DRIFT_EXPECTED")
            }
            analysisJudgment = definiteThresholdPct >= EngineConfig.SEVERE_DRIFT_THRESHOLD_PCT ? .driftedThreshold : .accordingToPlan
        } else if inferredIntent == .race {
            analysisJudgment = .observationOnly
            flags.append("RACE_EVENT")
        }

        // Güven Seviyesi ve Düşük Güven Koruması
        let confidenceScore = thresholds.confidenceScore
        let confidenceLevel: ConfidenceLevel =
            confidenceScore >= EngineConfig.HIGH_CONFIDENCE_THRESHOLD ? .high :
            confidenceScore >= EngineConfig.MEDIUM_CONFIDENCE_THRESHOLD ? .medium : .low

        if confidenceLevel == .low {
            if analysisJudgment == .driftedGray || analysisJudgment == .driftedThreshold {
                analysisJudgment = .observationOnly
            }
        }

        let matchedTemplate = TemplatesCatalog.shared.selectTemplate(
            intent: inferredIntent,
            judgment: analysisJudgment,
            confidenceLevel: confidenceLevel,
            flags: flags
        )

        let vars: [String: Double] = [
            "easyPct": zoneEasyPct,
            "thresholdPct": zoneThresholdPct,
            "moderatePct": zoneModeratePct
        ]

        let outputSentence = TemplatesCatalog.interpolate(matchedTemplate.primarySentence, vars: vars)
        let secondaryCostSentence = TemplatesCatalog.interpolate(matchedTemplate.secondaryCostSentence, vars: vars)

        // Yasaklı kelime ve sahte kesinlik denetimi
        let comp1 = ForbiddenWords.verifyCompliance(outputSentence)
        let comp2 = ForbiddenWords.verifyCompliance(secondaryCostSentence)
        if !comp1.valid || !comp2.valid {
            fatalError("Yasaklı ifade ihlali: \((comp1.violations + comp2.violations).joined(separator: ", "))")
        }

        return Assessment(
            activityId: activity.id,
            userId: activity.userId,
            thresholdId: thresholds.id,
            inferredIntent: inferredIntent,
            isUserOverridden: false,
            definiteEasyPct: definiteEasyPct,
            uncertainCorridorPct: uncertainCorridorPct,
            definiteGrayPct: definiteGrayPct,
            definiteThresholdPct: definiteThresholdPct,
            zoneEasyPct: zoneEasyPct,
            zoneModeratePct: zoneModeratePct,
            zoneThresholdPct: zoneThresholdPct,
            analysisJudgment: analysisJudgment,
            templateId: matchedTemplate.id,
            outputSentence: outputSentence,
            secondaryCostSentence: secondaryCostSentence,
            confidenceLevel: confidenceLevel,
            confidenceScore: confidenceScore,
            flags: flags,
            isSilenced: false,
            steadyStateDurationSec: steadyDurationSec,
            aerobicDecouplingPct: aerobicDecouplingPct
        )
    }

    private static func createSilencedAssessment(
        activityId: String,
        userId: String,
        thresholdId: String,
        reason: String,
        explanation: String
    ) -> Assessment {
        return Assessment(
            activityId: activityId,
            userId: userId,
            thresholdId: thresholdId,
            inferredIntent: .easy,
            isUserOverridden: false,
            definiteEasyPct: 0,
            uncertainCorridorPct: 0,
            definiteGrayPct: 0,
            definiteThresholdPct: 0,
            zoneEasyPct: 0,
            zoneModeratePct: 0,
            zoneThresholdPct: 0,
            analysisJudgment: .observationOnly,
            templateId: "SILENCED",
            outputSentence: explanation,
            secondaryCostSentence: "",
            confidenceLevel: .low,
            confidenceScore: 0,
            flags: [reason],
            isSilenced: true,
            silenceReason: reason,
            steadyStateDurationSec: 0
        )
    }
}
