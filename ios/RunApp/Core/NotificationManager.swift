import Foundation
import UserNotifications
import HealthKit

public final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    public static let shared = NotificationManager()

    private override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    public func requestAuthorization() async -> Bool {
        do {
            let options: UNAuthorizationOptions = [.alert, .sound, .badge]
            return try await UNUserNotificationCenter.current().requestAuthorization(options: options)
        } catch {
            return false
        }
    }

    /**
     * Yerel Bildirim Planlar (APNs / Sunucu Gerekmez)
     * Bildirim gecikmesini (antenman bitişinden bildirime kadar geçen ms) telemetriye kaydeder.
     */
    public func dispatchAssessmentNotification(for assessment: Assessment, workoutEndTime: Date) {
        let center = UNUserNotificationCenter.current()

        let content = UNMutableNotificationContent()
        content.title = "Runnie — Koşu Şiddeti Raporu"
        content.subtitle = assessment.analysisJudgment.rawValue
        content.body = assessment.outputSentence
        content.sound = .default
        content.userInfo = ["activityId": assessment.activityId]

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1.0, repeats: false)
        let request = UNNotificationRequest(
            identifier: "asmt_\(assessment.activityId)",
            content: content,
            trigger: trigger
        )

        center.add(request) { error in
            let now = Date()
            let latencyMs = max(0, Int(now.timeIntervalSince(workoutEndTime) * 1000.0))
            RunnieDatabase.shared.saveDeliveryTelemetry(
                activityId: assessment.activityId,
                workoutEndTime: workoutEndTime,
                notificationTime: now,
                latencyMs: latencyMs
            )
        }
    }

    // Uygulama ön plandayken de bildirimin görünmesini sağlar
    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }
}
