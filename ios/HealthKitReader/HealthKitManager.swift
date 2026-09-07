import Foundation
import HealthKit
import CoreLocation

/**
 * Koşu Şiddeti Asistanı - HealthKit Okuma ve Yetkilendirme Yöneticisi
 */
public final class HealthKitManager {
    public static let shared = HealthKitManager()
    public let healthStore = HKHealthStore()

    private init() {}

    public var isHealthKitAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }

    /**
     * Gerekli HealthKit İzinlerini İster
     */
    public func requestAuthorization() async throws -> Bool {
        guard isHealthKitAvailable else { return false }

        var readTypes: Set<HKObjectType> = [
            HKObjectType.workoutType(),
            HKSeriesType.workoutRoute(),
            HKObjectType.quantityType(forIdentifier: .heartRate)!,
            HKObjectType.quantityType(forIdentifier: .stepCount)!,
            HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)!,
            HKObjectType.quantityType(forIdentifier: .vo2Max)!,
            HKObjectType.quantityType(forIdentifier: .restingHeartRate)!
        ]

        // iOS 16+ İleri Düzey Koşu Metrikleri
        if #available(iOS 16.0, *) {
            if let runningSpeed = HKObjectType.quantityType(forIdentifier: .runningSpeed) {
                readTypes.insert(runningSpeed)
            }
            if let runningPower = HKObjectType.quantityType(forIdentifier: .runningPower) {
                readTypes.insert(runningPower)
            }
            if let strideLength = HKObjectType.quantityType(forIdentifier: .runningStrideLength) {
                readTypes.insert(strideLength)
            }
            if let gct = HKObjectType.quantityType(forIdentifier: .runningGroundContactTime) {
                readTypes.insert(gct)
            }
            if let vertOsc = HKObjectType.quantityType(forIdentifier: .runningVerticalOscillation) {
                readTypes.insert(vertOsc)
            }
        }

        try await healthStore.requestAuthorization(toShare: [], read: readTypes)
        return true
    }

    /**
     * Son Koşu Antrenmanlarını Sorgular (HKWorkoutActivityTypeRunning)
     */
    public func fetchRecentRunningWorkouts(limit: Int = 50) async throws -> [HKWorkout] {
        let predicate = HKQuery.predicateForWorkouts(with: .running)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: .workoutType(),
                predicate: predicate,
                limit: limit,
                sortDescriptors: [sortDescriptor]
            ) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                let workouts = (samples as? [HKWorkout]) ?? []
                continuation.resume(returning: workouts)
            }
            healthStore.execute(query)
        }
    }

    /**
     * Belirli Bir Antrenmanın Kalp Atım Hızı Örneklerini Çeker
     */
    public func fetchHeartRateSamples(for workout: HKWorkout) async throws -> [HKQuantitySample] {
        guard let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return [] }
        let predicate = HKQuery.predicateForSamples(withStart: workout.startDate.addingTimeInterval(-5),
                                                    end: workout.endDate.addingTimeInterval(5),
                                                    options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: hrType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: (samples as? [HKQuantitySample]) ?? [])
            }
            healthStore.execute(query)
        }
    }

    /**
     * Belirli Bir Antrenmanın Adım Kayıtlarını Çeker (Kadans İçin)
     */
    public func fetchStepSamples(for workout: HKWorkout) async throws -> [HKQuantitySample] {
        guard let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return [] }
        let predicate = HKQuery.predicateForSamples(withStart: workout.startDate.addingTimeInterval(-2),
                                                    end: workout.endDate.addingTimeInterval(2),
                                                    options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: stepType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: (samples as? [HKQuantitySample]) ?? [])
            }
            healthStore.execute(query)
        }
    }

    /**
     * iOS 16+ RunningSpeed Örneklerini Çeker (Kademe 1 Anlık Hız)
     */
    public func fetchRunningSpeedSamples(for workout: HKWorkout) async throws -> [HKQuantitySample] {
        guard #available(iOS 16.0, *),
              let speedType = HKQuantityType.quantityType(forIdentifier: .runningSpeed) else { return [] }

        let predicate = HKQuery.predicateForSamples(withStart: workout.startDate.addingTimeInterval(-2),
                                                    end: workout.endDate.addingTimeInterval(2),
                                                    options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: speedType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: (samples as? [HKQuantitySample]) ?? [])
            }
            healthStore.execute(query)
        }
    }

    /**
     * Antrenmanın GPS Rota Konumlarını Çeker (HKWorkoutRoute)
     */
    public func fetchRouteLocations(for workout: HKWorkout) async throws -> [CLLocation] {
        let routePredicate = HKQuery.predicateForObjects(from: workout)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        let routes: [HKWorkoutRoute] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: HKSeriesType.workoutRoute(), predicate: routePredicate, limit: 1, sortDescriptors: [sortDescriptor]) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: (samples as? [HKWorkoutRoute]) ?? [])
            }
            healthStore.execute(query)
        }

        guard let route = routes.first else { return [] }

        var locations: [CLLocation] = []
        return try await withCheckedThrowingContinuation { continuation in
            let routeQuery = HKWorkoutRouteQuery(route: route) { _, locs, done, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                if let locs = locs {
                    locations.append(contentsOf: locs)
                }
                if done {
                    continuation.resume(returning: locations)
                }
            }
            healthStore.execute(routeQuery)
        }
    }
}
