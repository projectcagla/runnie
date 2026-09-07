import Foundation
import HealthKit
import CoreLocation

public struct NormalizedActivityPayload: Codable {
    public let activity: IOSNormalizedActivity
    public let stream: [IOSStreamPoint]
}

public struct IOSNormalizedActivity: Codable {
    public let id: String
    public let userId: String
    public let sportType: String
    public let surfaceType: String
    public let title: String
    public let startTime: String
    public let elapsedTimeSec: Int
    public let movingTimeSec: Int
    public let distanceMeters: Double
    public let elevationGainMeters: Double
    public let hasHeartRate: Bool
    public let avgHr: Int?
    public let maxHr: Int?
    public let avgCadence: Int?
    public let avgPaceSecPerKm: Int
    public let gapSecPerKm: Int
    public let paceSource: String
    public let hasInstantaneousPace: Bool
    public let startLatitude: Double?
    public let startLongitude: Double?
    public let sourceName: String
}

public struct IOSStreamPoint: Codable {
    public let t: Int
    public let hr: Int?
    public let cad: Int?
    public let gap: Int?
    public let alt: Double?
    public let dist: Int?
}

/**
 * HealthKit Canlı Nesnelerini Çekirdek Veri Modeline Dönüştürücü
 */
public final class WorkoutNormalizer {

    public static func normalize(
        workout: HKWorkout,
        hrSamples: [HKQuantitySample],
        stepSamples: [HKQuantitySample],
        speedSamples: [HKQuantitySample],
        routeLocations: [CLLocation]
    ) -> NormalizedActivityPayload {
        let durationSec = max(1, Int(workout.duration))
        let distanceMeters = workout.totalDistance?.doubleValue(for: .meter()) ?? 0
        let avgSpeed = durationSec > 0 ? (distanceMeters / Double(durationSec)) : 0
        let avgPaceSecPerKm = avgSpeed > 0.5 ? Int(1000 / avgSpeed) : 360

        // 3 Kademeli Hız Belirleme
        let paceSource: String
        if !speedSamples.isEmpty {
            paceSource = "RUNNING_SPEED"
        } else if routeLocations.count > 1 {
            paceSource = "GPX_TRACKPOINT"
        } else {
            paceSource = "ACTIVITY_AVERAGE"
        }

        var streamPoints: [IOSStreamPoint] = []
        var hrSum = 0
        var hrMax = 0
        var validHrCount = 0
        var cadSum = 0
        var validCadCount = 0
        var gapSum = 0
        var validGapCount = 0

        let hrUnit = HKUnit(from: "count/min")
        let speedUnit = HKUnit(from: "m/s")

        for sec in stride(from: 0, through: durationSec, by: 10) {
            let pointTime = workout.startDate.addingTimeInterval(TimeInterval(sec))

            // 1. Nabız (En yakın +-10 saniye)
            var pointHr: Int? = nil
            if let closest = hrSamples.min(by: { abs($0.startDate.timeIntervalSince(pointTime)) < abs($1.startDate.timeIntervalSince(pointTime)) }),
               abs(closest.startDate.timeIntervalSince(pointTime)) <= 10.0 {
                let val = Int(closest.quantity.doubleValue(for: hrUnit))
                pointHr = val
                hrSum += val
                if val > hrMax { hrMax = val }
                validHrCount += 1
            }

            // 2. Kadans (Adım / süre * 60) - Sabit 168 fallback yok!
            var pointCad: Int? = nil
            if let step = stepSamples.first(where: { pointTime >= $0.startDate && pointTime <= $0.endDate }) {
                let dt = max(1.0, step.endDate.timeIntervalSince(step.startDate))
                let steps = step.quantity.doubleValue(for: .count())
                let cad = Int((steps / dt) * 60.0)
                if cad >= 100 && cad <= 240 {
                    pointCad = cad
                    cadSum += cad
                    validCadCount += 1
                }
            }

            // 3. Anlık Hız / GAP
            var pointGap = avgPaceSecPerKm
            if paceSource == "RUNNING_SPEED",
               let speedSample = speedSamples.min(by: { abs($0.startDate.timeIntervalSince(pointTime)) < abs($1.startDate.timeIntervalSince(pointTime)) }),
               abs(speedSample.startDate.timeIntervalSince(pointTime)) <= 10.0 {
                let mps = speedSample.quantity.doubleValue(for: speedUnit)
                if mps > 0.5 {
                    pointGap = Int(1000.0 / mps)
                }
            }

            if pointGap > 0 && pointGap < 1200 {
                gapSum += pointGap
                validGapCount += 1
            }

            streamPoints.pushPoint(IOSStreamPoint(
                t: sec,
                hr: pointHr,
                cad: pointCad,
                gap: pointGap,
                alt: nil,
                dist: Int(avgSpeed * Double(sec))
            ))
        }

        let isIndoor = (workout.metadata?[HKMetadataKeyIndoorWorkout] as? Bool) ?? false
        let avgHr = validHrCount > 0 ? (hrSum / validHrCount) : nil
        let avgCadence = validCadCount > 0 ? (cadSum / validCadCount) : nil
        let activityGap = validGapCount > 0 ? (gapSum / validGapCount) : avgPaceSecPerKm

        let firstLoc = routeLocations.first

        let activity = IOSNormalizedActivity(
            id: "hk_\(workout.uuid.uuidString)",
            userId: "ios_local_user",
            sportType: isIndoor ? "TREADMILL_RUN" : "RUN",
            surfaceType: isIndoor ? "TREADMILL" : "ROAD",
            title: "\(workout.sourceRevision.source.name) Koşusu",
            startTime: ISO8601DateFormatter().string(from: workout.startDate),
            elapsedTimeSec: durationSec,
            movingTimeSec: durationSec,
            distanceMeters: distanceMeters,
            elevationGainMeters: 0,
            hasHeartRate: validHrCount > 0,
            avgHr: avgHr,
            maxHr: validHrCount > 0 ? hrMax : nil,
            avgCadence: avgCadence,
            avgPaceSecPerKm: avgPaceSecPerKm,
            gapSecPerKm: activityGap,
            paceSource: paceSource,
            hasInstantaneousPace: paceSource != "ACTIVITY_AVERAGE",
            startLatitude: firstLoc?.coordinate.latitude,
            startLongitude: firstLoc?.coordinate.longitude,
            sourceName: workout.sourceRevision.source.name
        )

        return NormalizedActivityPayload(activity: activity, stream: streamPoints)
    }
}

private extension Array where Element == IOSStreamPoint {
    mutating func pushPoint(_ p: IOSStreamPoint) {
        self.append(p)
    }
}
