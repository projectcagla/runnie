import Foundation
import HealthKit
import CoreLocation

@MainActor
public final class WorkoutProcessor: ObservableObject {
    public static let shared = WorkoutProcessor()

    private let healthKit = HealthKitManager.shared
    private let db = RunnieDatabase.shared
    private let weatherService = OnDeviceWeatherService.shared
    private let notifications = NotificationManager.shared

    private init() {}

    /**
     * Tüm HealthKit Arşivini Cihaz İçinde Taranıp Değerlendirilmesi
     * Sıfır sunucu, sıfır ağ çağrısı (hava durumu hariç).
     */
    public func processAllWorkouts(days: Int = 60) async throws {
        let authorized = try await healthKit.requestAuthorization()
        guard authorized else {
            AppStateManager.shared.setGate(.noPermission)
            return
        }

        _ = await notifications.requestAuthorization()

        let workouts = try await healthKit.fetchRecentRunningWorkouts(days: days, limit: HKObjectQueryNoLimit)
        guard !workouts.isEmpty else {
            AppStateManager.shared.setGate(.noRunsFound)
            return
        }

        // 1. Fizyolojik Göstergeler (HealthKit)
        let vo2Samples = (try? await healthKit.fetchVO2MaxSamples(days: 90)) ?? []
        let rhrSamples = (try? await healthKit.fetchRestingHeartRateSamples(days: 60)) ?? []
        let hrvSamples = (try? await healthKit.fetchHrvSamples(days: 60)) ?? []

        let latestVo2 = vo2Samples.first?.quantity.doubleValue(for: HKUnit(from: "ml/kg*min"))
        let latestRhr = rhrSamples.first?.quantity.doubleValue(for: HKUnit(from: "count/min"))
        let latestHrv = hrvSamples.first?.quantity.doubleValue(for: HKUnit.secondUnit(with: .milli))

        let appleMetrics = AppleHealthMetrics(
            vo2MaxMlPerKgMin: latestVo2,
            restingHeartRate: latestRhr,
            hrvSdnnMs: latestHrv,
            age: 35
        )

        // 2. Antrenmanları ve Akışları Oku
        var normalizedList: [NormalizedActivity] = []
        var streamsMap: [String: [StreamPoint]] = [:]
        var ephemeraCoords: [String: (lat: Double?, lon: Double?)] = [:]
        var totalDistanceKm: Double = 0.0

        for w in workouts {
            let hr = (try? await healthKit.fetchHeartRateSamples(for: w)) ?? []
            let steps = (try? await healthKit.fetchStepSamples(for: w)) ?? []
            let speeds = (try? await healthKit.fetchRunningSpeedSamples(for: w)) ?? []
            let route = (try? await healthKit.fetchRouteLocations(for: w)) ?? []

            let payload = WorkoutNormalizer.normalize(
                workout: w,
                hrSamples: hr,
                stepSamples: steps,
                speedSamples: speeds,
                routeLocations: route
            )

            let actId = w.uuid.uuidString
            let dist = payload.activity.distanceMeters
            totalDistanceKm += dist / 1000.0

            let act = NormalizedActivity(
                id: actId,
                sportType: .run,
                title: nil,
                startTime: payload.activity.startTime,
                elapsedTimeSec: Double(payload.activity.elapsedTimeSec),
                movingTimeSec: Double(payload.activity.movingTimeSec),
                distanceMeters: dist,
                elevationGainMeters: payload.activity.elevationGainMeters,
                hasHeartRate: payload.activity.hasHeartRate,
                avgHr: payload.activity.avgHr != nil ? Double(payload.activity.avgHr!) : nil,
                maxHr: payload.activity.maxHr != nil ? Double(payload.activity.maxHr!) : nil,
                avgCadence: payload.activity.avgCadence != nil ? Double(payload.activity.avgCadence!) : nil,
                avgPaceSecPerKm: payload.activity.avgPaceSecPerKm != nil ? Double(payload.activity.avgPaceSecPerKm!) : nil,
                gapSecPerKm: payload.activity.gapSecPerKm != nil ? Double(payload.activity.gapSecPerKm!) : nil,
                surfaceType: .road,
                hasInstantaneousPace: payload.activity.hasInstantaneousPace,
                sourceName: payload.activity.sourceName,
                paceSource: payload.activity.paceSource
            )

            let streamPoints = payload.stream.map { sp in
                StreamPoint(
                    t: Double(sp.t),
                    hr: sp.hr != nil ? Double(sp.hr!) : nil,
                    cad: sp.cad != nil ? Double(sp.cad!) : nil,
                    gap: sp.gap != nil ? Double(sp.gap!) : nil,
                    alt: sp.alt,
                    dist: sp.dist != nil ? Double(sp.dist!) : nil
                )
            }

            normalizedList.append(act)
            streamsMap[actId] = streamPoints

            // Geçici hava koordinatı (asla veritabanına yazılmaz!)
            if let firstLoc = route.first {
                ephemeraCoords[actId] = (firstLoc.coordinate.latitude, firstLoc.coordinate.longitude)
            }
        }

        // 3. Çift Cihaz Eşzamanlı Takip ve Tekilleştirme (Deduplication)
        var duplicateCount = 0
        var matchedIndices = Set<Int>()

        for i in 0..<normalizedList.count {
            for j in (i + 1)..<normalizedList.count {
                let w1 = workouts[i]
                let w2 = workouts[j]
                let timeDiff = abs(w1.startDate.timeIntervalSince(w2.startDate))

                let dur1 = max(1.0, w1.duration)
                let dur2 = max(1.0, w2.duration)
                let end1 = w1.startDate.addingTimeInterval(dur1)
                let end2 = w2.startDate.addingTimeInterval(dur2)
                let overlap = max(0.0, min(end1.timeIntervalSince1970, end2.timeIntervalSince1970) - max(w1.startDate.timeIntervalSince1970, w2.startDate.timeIntervalSince1970))
                let minDur = min(dur1, dur2)

                let d1 = w1.totalDistance?.doubleValue(for: .meter()) ?? 0
                let d2 = w2.totalDistance?.doubleValue(for: .meter()) ?? 0

                var isCandidate = false
                if d1 > 50 && d2 > 50 {
                    let distDiff = abs(d1 - d2)
                    let maxDist = max(d1, d2)
                    if (distDiff / maxDist) <= 0.10 && (timeDiff <= 1800 || overlap > 0) {
                        isCandidate = true
                    }
                } else if timeDiff <= 1800 && overlap > 0 {
                    if (overlap / minDur) >= 0.40 || overlap >= 300 {
                        isCandidate = true
                    }
                }

                if isCandidate {
                    // Zenginlik puanlaması
                    let score1 = richnessScore(normalizedList[i])
                    let score2 = richnessScore(normalizedList[j])

                    if score1 >= score2 {
                        normalizedList[j].isDuplicate = true
                        normalizedList[j].duplicateOfId = normalizedList[i].id
                        matchedIndices.insert(j)
                    } else {
                        normalizedList[i].isDuplicate = true
                        normalizedList[i].duplicateOfId = normalizedList[j].id
                        matchedIndices.insert(i)
                    }
                    duplicateCount += 1
                }
            }
        }

        let uniqueCount = max(0, normalizedList.count - matchedIndices.count)

        // 4. Eşik Türetme
        let talkTestAnchor = UserDefaults.standard.object(forKey: "talk_test_anchor_hr") as? Double

        let derivationInput = ThresholdDerivationInput(
            userId: "local_user",
            activities: normalizedList.filter { !$0.isDuplicate },
            streams: streamsMap,
            appleMetrics: appleMetrics,
            talkTestConfirmedAeT: talkTestAnchor
        )

        let thresholds = ThresholdDerivationEngine.deriveThresholds(input: derivationInput)
        db.saveThresholds(thresholds)

        // 5. Değerlendirme ve Yerel Saklama
        var latestWinnerAssessment: Assessment? = nil
        let isoFormatter = ISO8601DateFormatter()

        for act in normalizedList {
            let stream = streamsMap[act.id] ?? []
            db.saveActivity(act, stream: stream)

            if !act.isDuplicate {
                let actDate = isoFormatter.date(from: act.startTime) ?? Date()
                let coords = ephemeraCoords[act.id]

                // Hava durumu (Open-Meteo)
                var weatherSnap: WeatherSnapshot? = nil
                if let lat = coords?.lat, let lon = coords?.lon {
                    weatherSnap = await weatherService.fetchHistoricalWeather(latitude: lat, longitude: lon, date: actDate)
                }

                let engineInput = EngineInput(
                    activity: act,
                    stream: stream,
                    thresholds: thresholds,
                    weather: weatherSnap,
                    physiologicalBaselines: PhysiologicalBaselines(
                        restingHrBaseline: latestRhr,
                        hrvSdnnBaseline: latestHrv,
                        todayRestingHr: latestRhr,
                        todayHrvSdnn: latestHrv
                    )
                )

                let asmt = RunnieEngine.evaluateActivity(input: engineInput)
                db.saveAssessment(asmt)

                if latestWinnerAssessment == nil {
                    latestWinnerAssessment = asmt
                }
            }
        }

        // 6. Tanı Bilgilerini Güncelle
        var diag = AppStateManager.shared.diagnostics
        diag.totalScannedWorkouts = workouts.count
        diag.duplicatesEliminatedCount = matchedIndices.count
        diag.netUniqueRuns = uniqueCount
        diag.totalKm = totalDistanceKm
        diag.latestVO2Max = latestVo2
        diag.latestRHR = latestRhr
        diag.latestHRV = latestHrv
        diag.lastUpdated = Date()
        AppStateManager.shared.diagnostics = diag

        // 7. Durum Kapısını Belirle
        if let asmt = latestWinnerAssessment {
            let asmtData = AssessmentData(
                activityId: asmt.activityId,
                verdict: asmt.analysisJudgment.rawValue,
                sentence: asmt.outputSentence,
                easyPct: asmt.zoneEasyPct,
                moderatePct: asmt.zoneModeratePct,
                thresholdPct: asmt.zoneThresholdPct
            )

            if asmt.analysisJudgment == .observationOnly {
                AppStateManager.shared.setGate(.observationOnly)
            } else if thresholds.confidenceScore < EngineConfig.MEDIUM_CONFIDENCE_THRESHOLD {
                AppStateManager.shared.setGate(.calibrationPending)
            } else if uniqueCount < 16 || totalDistanceKm < 100.0 {
                AppStateManager.shared.setGate(.belowDataThreshold(
                    found: workouts.count,
                    duplicates: matchedIndices.count,
                    unique: uniqueCount,
                    totalDistanceKm: totalDistanceKm
                ))
            } else {
                AppStateManager.shared.setGate(.ready(assessment: asmtData))
            }

            // 8. Ayna Ekranı Verisi Hazırla
            if uniqueCount >= 16 && totalDistanceKm >= 100.0 {
                let highIntensityRuns = normalizedList.filter { act in
                    guard !act.isDuplicate else { return false }
                    return (act.avgHr ?? 0) >= thresholds.lthr
                }.count
                let highPct = Int((Double(highIntensityRuns) / Double(max(1, uniqueCount)) * 100.0).rounded())

                let q = "Son 60 günde \(uniqueCount) koşunun %\(highPct)'i AeT eşiği üzerinde geçti. Bu dağılım planlı bir maraton/tempo hazırlığı mı, yoksa farkında olmadan mı hızlandınız?"
                AppStateManager.shared.mirrorData = [
                    "eligible": true,
                    "totalRuns": uniqueCount,
                    "totalDistanceKm": totalDistanceKm,
                    "mirrorQuestion": q
                ]
            } else {
                AppStateManager.shared.mirrorData = [
                    "eligible": false,
                    "message": "Yetersiz veri. Son 60 günde en az 16 tekil koşu ve 100 km gereklidir.\n(Şu ana kadar: \(uniqueCount) tekil koşu, \(String(format: "%.1f", totalDistanceKm)) km)"
                ]
            }
        } else {
            AppStateManager.shared.setGate(.belowDataThreshold(
                found: workouts.count,
                duplicates: matchedIndices.count,
                unique: uniqueCount,
                totalDistanceKm: totalDistanceKm
            ))
        }
    }

    private func richnessScore(_ act: NormalizedActivity) -> Int {
        var score = 0
        if act.paceSource == "RUNNING_SPEED" { score += 35 }
        else if act.paceSource == "GPX_TRACKPOINT" { score += 30 }
        else if act.paceSource == "DISTANCE_INTERVAL" { score += 20 }
        if act.distanceMeters > 100 { score += 30 }
        if act.hasHeartRate { score += 10 }
        if act.avgCadence != nil { score += 10 }
        if act.sourceName?.contains("Apple") == true { score += 5 }
        return score
    }

    /**
     * Konuşma Testi Çıpası Kaydı
     */
    public func submitTalkTestAnchor(aetHr: Int) async {
        UserDefaults.standard.set(Double(aetHr), forKey: "talk_test_anchor_hr")
        try? await processAllWorkouts()
    }
}
