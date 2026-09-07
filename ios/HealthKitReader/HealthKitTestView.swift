import SwiftUI
import HealthKit

/**
 * HealthKit Test Görünümü (Erken Doğrulama Konsolu)
 * XML dışa aktarımına ihtiyaç duymadan cihazdaki canlı HealthKit verisini tarar.
 */
public struct HealthKitTestView: View {
    @State private var logText: String = "Test başlatılmayı bekliyor...\n"
    @State private var isRunning: Bool = false

    public init() {}

    public var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("HealthKit Okuma Katmanı Testi")
                .font(.title2.bold())

            Text("Bu test canlı HealthKit API'sini tarayarak anlık hız, kadans ve rota akışının erişilebilirliğini doğrular.")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Button(action: {
                Task {
                    await runHealthKitInspection()
                }
            }) {
                HStack {
                    if isRunning {
                        ProgressView().tint(.white)
                    }
                    Text(isRunning ? "Taranıyor..." : "Canlı HealthKit Taramasını Başlat")
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(isRunning ? Color.gray : Color.blue)
                .foregroundColor(.white)
                .cornerRadius(10)
            }
            .disabled(isRunning)

            Text("Konsol Çıktısı:")
                .font(.caption.bold())

            ScrollView {
                Text(logText)
                    .font(.system(.caption, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
            }
        }
        .padding()
    }

    private func appendLog(_ msg: String) {
        logText += msg + "\n"
        print("[HealthKitTest] \(msg)")
    }

    private func runHealthKitInspection() async {
        isRunning = true
        logText = "=== HEALTHKIT CANLI OKUMA TELEMETRİSİ ===\n"

        do {
            appendLog("1. İzinler isteniyor...")
            let granted = try await HealthKitManager.shared.requestAuthorization()
            guard granted else {
                appendLog("HATA: HealthKit izni verilmedi.")
                isRunning = false
                return
            }
            appendLog("-> İzinler onaylandı.")

            appendLog("2. Son koşu antrenmanları sorgulanıyor...")
            let workouts = try await HealthKitManager.shared.fetchRecentRunningWorkouts(limit: 10)
            appendLog("-> Bulunan Koşu Sayısı: \(workouts.count)")

            guard let firstWorkout = workouts.first else {
                appendLog("UYARI: Cihazda hiç koşu antrenmanı bulunamadı.")
                isRunning = false
                return
            }

            appendLog("\n3. En Son Koşunun Detaylı Taraması:")
            appendLog("   Tarih: \(firstWorkout.startDate)")
            appendLog("   Süre: \(Int(firstWorkout.duration)) saniye")
            appendLog("   Mesafe: \(Int(firstWorkout.totalDistance?.doubleValue(for: .meter()) ?? 0)) metre")
            appendLog("   Kaynak: \(firstWorkout.sourceRevision.source.name)")

            let hrSamples = try await HealthKitManager.shared.fetchHeartRateSamples(for: firstWorkout)
            appendLog("   Nabız Örnek Sayısı: \(hrSamples.count)")

            let stepSamples = try await HealthKitManager.shared.fetchStepSamples(for: firstWorkout)
            appendLog("   Adım Kaydı Sayısı: \(stepSamples.count)")

            let speedSamples = try await HealthKitManager.shared.fetchRunningSpeedSamples(for: firstWorkout)
            appendLog("   RunningSpeed Örnek Sayısı: \(speedSamples.count)")

            let routeLocs = try await HealthKitManager.shared.fetchRouteLocations(for: firstWorkout)
            appendLog("   GPS Rota Noktası Sayısı: \(routeLocs.count)")

            // Normalizasyon Testi
            let payload = WorkoutNormalizer.normalize(
                workout: firstWorkout,
                hrSamples: hrSamples,
                stepSamples: stepSamples,
                speedSamples: speedSamples,
                routeLocations: routeLocs
            )

            appendLog("\n4. Normalizasyon Sonucu:")
            appendLog("   Pace Kaynağı: \(payload.activity.paceSource)")
            appendLog("   Anlık Hız Mevcut mu: \(payload.activity.hasInstantaneousPace)")
            appendLog("   Ortalama Nabız: \(payload.activity.avgHr.map(String.init) ?? "Yok")")
            appendLog("   Ortalama Kadans: \(payload.activity.avgCadence.map(String.init) ?? "Yok")")
            appendLog("   Akış Noktası Sayısı: \(payload.stream.count)")

            appendLog("\n=== TARAMA TAMAMLANDI ===")
        } catch {
            appendLog("HATA: \(error.localizedDescription)")
        }

        isRunning = false
    }
}
