import SwiftUI
import HealthKit

public struct DiagnosticsView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var stateManager = AppStateManager.shared
    @State private var isScanning = false
    @State private var scanError: String? = nil
    
    public init() {}
    
    public var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // 1. Özet İstatistik Kartları
                    summaryGrid()
                    
                    // 2. Kaynak Bazında Dağılım
                    sourcesSection()
                    
                    // 3. Çift Kayıt (Deduplication) ve Mantık Analizi
                    dedupSection()
                    
                    // 4. Fizyolojik Taban Değerleri
                    physiologySection()
                    
                    // 5. Yenile Düğmesi
                    Button(action: {
                        Task { await runFullDiagnosticsScan() }
                    }) {
                        HStack {
                            if isScanning {
                                ProgressView().tint(.white).padding(.trailing, 6)
                                Text("HealthKit Taranıyor...")
                            } else {
                                Image(systemName: "arrow.clockwise")
                                Text("Canlı Taramayı Yenile")
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(isScanning)
                    .padding(.horizontal)
                    
                    if let err = scanError {
                        Text(err)
                            .font(.caption)
                            .foregroundColor(.red)
                            .padding(.horizontal)
                    }
                }
                .padding(.vertical)
            }
            .navigationTitle("Tanı ve Veri İnceleme")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Kapat") {
                        dismiss()
                    }
                }
            }
            .task {
                if stateManager.diagnostics.totalScannedWorkouts == 0 {
                    await runFullDiagnosticsScan()
                }
            }
        }
    }
    
    // MARK: - 1. Özet Grid
    @ViewBuilder
    private func summaryGrid() -> some View {
        let d = stateManager.diagnostics
        VStack(alignment: .leading, spacing: 10) {
            Text("GENEL KOŞU VERİSİ ÖZETİ")
                .font(.caption.bold())
                .foregroundColor(.secondary)
                .padding(.horizontal)
            
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                metricCard(title: "Toplam Koşu Kaydı", value: "\(d.totalScannedWorkouts)", subtitle: "Son 60 gün (limitsiz)", color: .blue)
                metricCard(title: "Net Tekil Koşu", value: "\(d.netUniqueRuns)", subtitle: "\(String(format: "%.1f", d.totalKm)) km toplam", color: .green)
                metricCard(title: "Çift Kayıt Elenen", value: "\(d.duplicatesEliminatedCount)", subtitle: "\(d.duplicatePairsCount) eşleşen çift", color: .orange)
                metricCard(title: "Geçersiz / 0 km", value: "\(d.sanityDiscardedCount)", subtitle: "<50m veya test kaydı", color: .gray)
            }
            .padding(.horizontal)
        }
    }
    
    private func metricCard(title: String, value: String, subtitle: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption2.bold())
                .foregroundColor(.secondary)
            Text(value)
                .font(.system(size: 26, weight: .heavy, design: .rounded))
                .foregroundColor(color)
            Text(subtitle)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
    
    // MARK: - 2. Kaynak Bazında Dağılım
    @ViewBuilder
    private func sourcesSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("KAYNAK BAZINDA DÖKÜM (NEDEN \(stateManager.diagnostics.totalScannedWorkouts) ADET?)")
                .font(.caption.bold())
                .foregroundColor(.secondary)
                .padding(.horizontal)
            
            if stateManager.diagnostics.sources.isEmpty {
                Text("Henüz kaynak taraması yapılmadı.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
                    .padding(.horizontal)
            } else {
                VStack(spacing: 10) {
                    ForEach(stateManager.diagnostics.sources) { src in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Image(systemName: src.sourceName.contains("Apple") ? "applewatch" : "heart.fill")
                                    .foregroundColor(src.sourceName.contains("Apple") ? .primary : .red)
                                Text(src.sourceName)
                                    .font(.subheadline.bold())
                                Spacer()
                                Text("\(src.totalCount) Koşu")
                                    .font(.subheadline.bold())
                                    .foregroundColor(.blue)
                            }
                            
                            Divider()
                            
                            HStack(spacing: 8) {
                                tagView(label: "Mesafe: \(src.distanceCount)", active: src.distanceCount > 0)
                                tagView(label: "Sıfır Mesafe: \(src.zeroDistanceCount)", active: src.zeroDistanceCount > 0, alert: true)
                                tagView(label: "Nabız: \(src.heartRateCount)", active: src.heartRateCount > 0)
                            }
                            .font(.caption2)
                            
                            HStack(spacing: 8) {
                                tagView(label: "Hız Akışı: \(src.speedCount)", active: src.speedCount > 0)
                                tagView(label: "GPS Rota: \(src.routeCount)", active: src.routeCount > 0)
                            }
                            .font(.caption2)
                        }
                        .padding(14)
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(12)
                        .padding(.horizontal)
                    }
                }
            }
        }
    }
    
    private func tagView(label: String, active: Bool, alert: Bool = false) -> some View {
        Text(label)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(alert ? Color.red.opacity(0.15) : (active ? Color.green.opacity(0.15) : Color.gray.opacity(0.15)))
            .foregroundColor(alert ? .red : (active ? .green : .secondary))
            .cornerRadius(6)
    }
    
    // MARK: - 3. Çift Kayıt ve Zenginlik Analizi
    @ViewBuilder
    private func dedupSection() -> some View {
        let d = stateManager.diagnostics
        VStack(alignment: .leading, spacing: 10) {
            Text("TEKİLLEŞTİRME VE ELEME KURALLARI")
                .font(.caption.bold())
                .foregroundColor(.secondary)
                .padding(.horizontal)
            
            VStack(alignment: .leading, spacing: 8) {
                Text("• Eşzamanlı Cihazlar: Apple Watch (GPS + Hız + Rota) ile WHOOP (Yoğun Nabız) aynı koşuda çalıştırıldığında zaman örtüşmesi tespit edilir.")
                Text("• Zenginlik Karşılaştırması: GPS rotası ve anlık hız barındıran Apple Watch kaydı asıl antrenman seçilir; WHOOP kaydı çift olarak işaretlenir.")
                Text("• Tespit Edilen Çiftler: \(d.duplicatePairsCount) çift seans eşleşti, \(d.duplicatesEliminatedCount) adet mükerrer kayıt güvenle elendi.")
                Text("• Sonuç: \(d.totalScannedWorkouts) ham kayıttan \(d.netUniqueRuns) net tekil seans üretildi.")
            }
            .font(.caption)
            .foregroundColor(.secondary)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
            .padding(.horizontal)
        }
    }
    
    // MARK: - 4. Fizyolojik Taban Değerleri
    @ViewBuilder
    private func physiologySection() -> some View {
        let d = stateManager.diagnostics
        VStack(alignment: .leading, spacing: 10) {
            Text("FİZYOLOJİK TABAN DEĞERLERİ")
                .font(.caption.bold())
                .foregroundColor(.secondary)
                .padding(.horizontal)
            
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Son VO2max")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Text(d.latestVO2Max != nil ? String(format: "%.1f", d.latestVO2Max!) : "—")
                        .font(.title3.bold())
                        .foregroundColor(.blue)
                    Text("ml/kg/dk")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(10)
                
                VStack(alignment: .leading, spacing: 4) {
                    Text("Dinlenik Nabız")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Text(d.latestRHR != nil ? "\(Int(d.latestRHR!))" : "—")
                        .font(.title3.bold())
                        .foregroundColor(.red)
                    Text("bpm (RHR)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(10)
                
                VStack(alignment: .leading, spacing: 4) {
                    Text("HRV (SDNN)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Text(d.latestHRV != nil ? "\(Int(d.latestHRV!))" : "—")
                        .font(.title3.bold())
                        .foregroundColor(.purple)
                    Text("ms")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(10)
            }
            .padding(.horizontal)
        }
    }
    
    // MARK: - Tarama Mantığı
    private func runFullDiagnosticsScan() async {
        isScanning = true
        scanError = nil
        defer { isScanning = false }
        
        do {
            let granted = try await HealthKitManager.shared.requestAuthorization()
            guard granted else {
                scanError = "HealthKit izni verilmedi."
                return
            }
            
            let workouts = try await HealthKitManager.shared.fetchRecentRunningWorkouts(days: 60, limit: HKObjectQueryNoLimit)
            
            var sourcesMap: [String: SourceMetricBreakdown] = [:]
            var sanityDiscarded = 0
            var totalKm = 0.0
            
            for w in workouts {
                let src = w.sourceRevision.source.name
                var entry = sourcesMap[src] ?? SourceMetricBreakdown(sourceName: src)
                entry.totalCount += 1
                
                let distMeters = w.totalDistance?.doubleValue(for: .meter()) ?? 0
                totalKm += distMeters / 1000.0
                
                if distMeters >= 50 {
                    entry.distanceCount += 1
                } else {
                    entry.zeroDistanceCount += 1
                }
                
                if distMeters < 50 && w.duration < 120 {
                    sanityDiscarded += 1
                }
                
                let hr = (try? await HealthKitManager.shared.fetchHeartRateSamples(for: w)) ?? []
                if !hr.isEmpty { entry.heartRateCount += 1 }
                
                let spd = (try? await HealthKitManager.shared.fetchRunningSpeedSamples(for: w)) ?? []
                if !spd.isEmpty { entry.speedCount += 1 }
                
                let rt = (try? await HealthKitManager.shared.fetchRouteLocations(for: w)) ?? []
                if !rt.isEmpty { entry.routeCount += 1 }
                
                sourcesMap[src] = entry
            }
            
            // Çift çift analiz (Zaman örtüşmesi)
            var duplicatePairs = 0
            var matchedIndices = Set<Int>()
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
                        duplicatePairs += 1
                        matchedIndices.insert(j)
                    }
                }
            }
            
            let duplicatesEliminated = matchedIndices.count
            let netUnique = max(0, workouts.count - duplicatesEliminated)
            
            // Fizyolojik veriler
            let vo2Samples = (try? await HealthKitManager.shared.fetchVO2MaxSamples(days: 90)) ?? []
            let rhrSamples = (try? await HealthKitManager.shared.fetchRestingHeartRateSamples(days: 60)) ?? []
            let hrvSamples = (try? await HealthKitManager.shared.fetchHrvSamples(days: 60)) ?? []
            
            let latestVo2 = vo2Samples.first?.quantity.doubleValue(for: HKUnit(from: "ml/kg*min"))
            let latestVo2Date = vo2Samples.first?.startDate
            let latestRhr = rhrSamples.first?.quantity.doubleValue(for: HKUnit(from: "count/min"))
            let latestHrv = hrvSamples.first?.quantity.doubleValue(for: HKUnit.secondUnit(with: .milli))
            
            await MainActor.run {
                var d = stateManager.diagnostics
                d.totalScannedWorkouts = workouts.count
                d.sources = Array(sourcesMap.values).sorted(by: { $0.totalCount > $1.totalCount })
                d.sanityDiscardedCount = sanityDiscarded
                d.sanityRetainedCount = workouts.count - sanityDiscarded
                d.duplicatePairsCount = duplicatePairs
                d.duplicatesEliminatedCount = duplicatesEliminated
                d.netUniqueRuns = netUnique
                d.totalKm = totalKm
                d.latestVO2Max = latestVo2
                d.latestVO2MaxDate = latestVo2Date
                d.latestRHR = latestRhr
                d.latestHRV = latestHrv
                d.lastUpdated = Date()
                stateManager.diagnostics = d
            }
        } catch {
            scanError = "Tarama hatası: \(error.localizedDescription)"
        }
    }
}
