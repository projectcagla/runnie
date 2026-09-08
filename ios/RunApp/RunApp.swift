import SwiftUI

@main
struct RunApp: App {
    init() {
        HealthKitManager.shared.startBackgroundWorkoutObserver {
            Task { @MainActor in
                try? await WorkoutProcessor.shared.processAllWorkouts()
            }
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
