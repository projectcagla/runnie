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

            appendLog("\n2. Son 60 gün koşu antrenmanları taranıyor (HKObjectQueryNoLimit)...")
            let workouts = try await HealthKitManager.shared.fetchRecentRunningWorkouts(days: 60, limit: HKObjectQueryNoLimit)
            appendLog("-> Bulunan Toplam Koşu Sayısı: \(workouts.count)")

            guard !workouts.isEmpty else {
                appendLog("UYARI: Cihazda hiç koşu antrenmanı bulunamadı.")
                isRunning = false
                return
            }

            // 3. Kaynak Bazında Döküm
            appendLog("\n3. Kaynak Bazında Koşu Dökümü:")
            var sourceGroups: [String: [HKWorkout]] = [:]
            for w in workouts {
                let src = w.sourceRevision.source.name
                sourceGroups[src, default: []].append(w)
            }

            for (sourceName, list) in sourceGroups {
                var withDist = 0
                var withHr = 0
                var withSpeed = 0
                var withRoute = 0

                for w in list {
                    if (w.totalDistance?.doubleValue(for: .meter()) ?? 0) > 50 { withDist += 1 }
                    let hr = (try? await HealthKitManager.shared.fetchHeartRateSamples(for: w)) ?? []
                    if !hr.isEmpty { withHr += 1 }
                    let spd = (try? await HealthKitManager.shared.fetchRunningSpeedSamples(for: w)) ?? []
                    if !spd.isEmpty { withSpeed += 1 }
                    let rt = (try? await HealthKitManager.shared.fetchRouteLocations(for: w)) ?? []
                    if !rt.isEmpty { withRoute += 1 }
                }

                appendLog("   • Kaynak: \(sourceName)")
                appendLog("     - Koşu Sayısı: \(list.count)")
                appendLog("     - Mesafeli: \(withDist) / \(list.count)")
                appendLog("     - Nabızlı: \(withHr) / \(list.count)")
                appendLog("     - Anlık Hızlı (RunningSpeed): \(withSpeed) / \(list.count)")
                appendLog("     - GPS Rotalı: \(withRoute) / \(list.count)")
            }

            // 4. Çift Tespiti ve Zenginlik Karşılaştırması
            appendLog("\n4. Çift Kayıt (Deduplication) Analizi:")
            var duplicatePairsCount = 0
            var duplicateWinners: [String: Int] = [:]

            for i in 0..<workouts.count {
                for j in (i + 1)..<workouts.count {
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
                        duplicatePairsCount += 1
                        let s1Name = w1.sourceRevision.source.name
                        let s2Name = w2.sourceRevision.source.name
                        let s1Score = (d1 > 100 ? 30 : 0) + (s1Name.lowercased().contains("watch") ? 35 : 0) + 20
                        let s2Score = (d2 > 100 ? 30 : 0) + (s2Name.lowercased().contains("watch") ? 35 : 0) + 20
                        let winner = s1Score >= s2Score ? s1Name : s2Name
                        duplicateWinners[winner, default: 0] += 1
                        appendLog("   -> Çift #\(duplicatePairsCount): [\(s1Name)] vs [\(s2Name)] (Fark: \(Int(timeDiff))s, Örtüşme: \(Int(overlap))s) => Kazanan: \(winner)")
                    }
                }
            }
            appendLog("   -> Toplam Tespit Edilen Çift: \(duplicatePairsCount)")
            appendLog("   -> Kazanan Kaynak Dağılımı: \(duplicateWinners)")

            // 5. VO2max, Dinlenik Nabız ve HRV Denetimi
            appendLog("\n5. Fizyolojik Metrik Denetimi (VO2max / Dinlenik Nabız / HRV):")
            let vo2Samples = (try? await HealthKitManager.shared.fetchVO2MaxSamples(days: 365)) ?? []
            appendLog("   • VO2max Kayıt Sayısı: \(vo2Samples.count)")
            if let latestVo2 = vo2Samples.first {
                let unit = HKUnit(from: "ml/kg*min")
                let val = String(format: "%.1f", latestVo2.quantity.doubleValue(for: unit))
                let dateStr = ISO8601DateFormatter().string(from: latestVo2.startDate)
                let src = latestVo2.sourceRevision.source.name
                appendLog("     -> En Güncel VO2max: \(val) ml/kg/min (Tarih: \(dateStr), Kaynak: \(src))")
                appendLog("     -> VO2max Hattı: ÇALIŞIYOR")
            } else {
                appendLog("     -> VO2max Hattı: Cihazda henüz Apple VO2max kaydı üretilmemiş (Konservatif taban devrede).")
            }

            let rhrSamples = (try? await HealthKitManager.shared.fetchRestingHeartRateSamples(days: 60)) ?? []
            appendLog("   • Dinlenik Nabız Kayıt Sayısı (Son 60 gün): \(rhrSamples.count)")
            if let latestRhr = rhrSamples.first {
                let unit = HKUnit(from: "count/min")
                let val = Int(latestRhr.quantity.doubleValue(for: unit))
                let src = latestRhr.sourceRevision.source.name
                appendLog("     -> En Güncel RHR: \(val) bpm (Kaynak: \(src))")
            }

            let hrvSamples = (try? await HealthKitManager.shared.fetchHrvSamples(days: 60)) ?? []
            appendLog("   • HRV (SDNN) Kayıt Sayısı (Son 60 gün): \(hrvSamples.count)")
            if let latestHrv = hrvSamples.first {
                let unit = HKUnit(from: "ms")
                let val = String(format: "%.1f", latestHrv.quantity.doubleValue(for: unit))
                let src = latestHrv.sourceRevision.source.name
                appendLog("     -> En Güncel HRV: \(val) ms (Kaynak: \(src))")
            }

            appendLog("\n=== TARAMA TAMAMLANDI ===")
        } catch {
            appendLog("HATA: \(error.localizedDescription)")
        }

        isRunning = false
    }
}
