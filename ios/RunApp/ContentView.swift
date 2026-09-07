import SwiftUI

public struct ContentView: View {
    @StateObject private var syncService = SyncService.shared
    @State private var isSyncing = false
    @State private var latestAssessmentSentence: String = "Henüz değerlendirilmiş koşu yok."
    @State private var latestVerdict: String = "BEKLİYOR"
    @State private var easyPct: Double = 0.0
    @State private var moderatePct: Double = 0.0
    @State private var thresholdPct: Double = 0.0
    @State private var showTalkTestSheet = false
    @State private var showMirrorSheet = false
    @State private var mirrorData: [String: Any]? = nil

    public init() {}

    public var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // 1. Ana Dürüstlük Kartı (The Honesty Card)
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("SON KOŞU ŞİDDETİ")
                                .font(.caption)
                                .fontWeight(.bold)
                                .foregroundColor(.secondary)
                            Spacer()
                            verdictBadge(latestVerdict)
                        }

                        Text(latestAssessmentSentence)
                            .font(.system(size: 18, weight: .medium, design: .rounded))
                            .foregroundColor(.primary)
                            .lineSpacing(4)

                        // 4 Bölmeli Dağılım Çubuğu
                        if easyPct > 0 || moderatePct > 0 || thresholdPct > 0 {
                            VStack(alignment: .leading, spacing: 6) {
                                GeometryReader { geo in
                                    HStack(spacing: 2) {
                                        Rectangle()
                                            .fill(Color.green)
                                            .frame(width: max(0, geo.size.width * CGFloat(easyPct / 100)))
                                        Rectangle()
                                            .fill(Color.orange)
                                            .frame(width: max(0, geo.size.width * CGFloat(moderatePct / 100)))
                                        Rectangle()
                                            .fill(Color.red)
                                            .frame(width: max(0, geo.size.width * CGFloat(thresholdPct / 100)))
                                    }
                                }
                                .frame(height: 10)
                                .cornerRadius(5)

                                HStack {
                                    legendItem(color: .green, label: "Aerobik: %\(Int(easyPct))")
                                    Spacer()
                                    legendItem(color: .orange, label: "Gri Bölge: %\(Int(moderatePct))")
                                    Spacer()
                                    legendItem(color: .red, label: "Eşik: %\(Int(thresholdPct))")
                                }
                                .font(.caption2)
                            }
                            .padding(.top, 4)
                        }
                    }
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(14)
                    .padding(.horizontal)

                    // 2. İşlem Düğmeleri
                    VStack(spacing: 12) {
                        Button(action: {
                            Task {
                                await syncLatestWorkout()
                            }
                        }) {
                            HStack {
                                if isSyncing {
                                    ProgressView().tint(.white).padding(.trailing, 6)
                                } else {
                                    Image(systemName: "arrow.triangle.2.circlepath")
                                }
                                Text(isSyncing ? "Senkronize Ediliyor..." : "HealthKit'i Senkronize Et")
                                    .bold()
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(isSyncing)

                        HStack(spacing: 12) {
                            Button(action: { showTalkTestSheet = true }) {
                                HStack {
                                    Image(systemName: "waveform")
                                    Text("Konuşma Çıpası")
                                }
                                .font(.subheadline)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color(.tertiarySystemBackground))
                                .cornerRadius(10)
                            }

                            Button(action: {
                                Task {
                                    mirrorData = try? await syncService.fetchMirrorScreen()
                                    showMirrorSheet = true
                                }
                            }) {
                                HStack {
                                    Image(systemName: "eyeglasses")
                                    Text("Ayna Ekranı")
                                }
                                .font(.subheadline)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color(.tertiarySystemBackground))
                                .cornerRadius(10)
                            }
                        }
                    }
                    .padding(.horizontal)

                    // 3. HealthKit Geliştirici Test Görünümü
                    HealthKitTestView()
                        .padding(.top, 10)
                }
                .padding(.vertical)
            }
            .navigationTitle("Runnie")
            .sheet(isPresented: $showTalkTestSheet) {
                talkTestSheetView()
            }
            .sheet(isPresented: $showMirrorSheet) {
                mirrorSheetView()
            }
        }
    }

    private func syncLatestWorkout() async {
        isSyncing = true
        defer { isSyncing = false }
        do {
            let authorized = try await HealthKitManager.shared.requestAuthorization()
            guard authorized else { return }

            let workouts = try await HealthKitManager.shared.fetchRecentRunningWorkouts(limit: 1)
            guard let latest = workouts.first else { return }

            let hr = try await HealthKitManager.shared.fetchHeartRateSamples(for: latest)
            let steps = try await HealthKitManager.shared.fetchStepSamples(for: latest)
            let speeds = try await HealthKitManager.shared.fetchRunningSpeedSamples(for: latest)
            let route = try await HealthKitManager.shared.fetchRouteLocations(for: latest)

            let payload = WorkoutNormalizer.normalize(
                workout: latest,
                hrSamples: hr,
                stepSamples: steps,
                speedSamples: speeds,
                routeLocations: route
            )

            let syncResults = try await syncService.syncWorkouts([payload])
            if let firstRes = syncResults.first, let actId = firstRes["activityId"] as? String {
                // Değerlendirmeyi bekle ve çek
                try await Task.sleep(nanoseconds: 500_000_000)
                if let asmt = try await syncService.fetchAssessment(activityId: actId) {
                    await MainActor.run {
                        self.latestAssessmentSentence = (asmt["sentence"] as? String) ?? "Değerlendirme üretildi."
                        self.latestVerdict = (asmt["verdict"] as? String) ?? "TAMAM"
                        if let metrics = asmt["metrics"] as? [String: Any] {
                            self.easyPct = (metrics["easyPct"] as? Double) ?? 0.0
                            self.moderatePct = (metrics["moderatePct"] as? Double) ?? 0.0
                            self.thresholdPct = (metrics["thresholdPct"] as? Double) ?? 0.0
                        }
                    }
                }
            }
        } catch {
            print("Sync hatası: \(error)")
        }
    }

    @ViewBuilder
    private func verdictBadge(_ verdict: String) -> some View {
        let (bg, text) = verdictColor(verdict)
        Text(text)
            .font(.caption2)
            .fontWeight(.heavy)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(bg)
            .foregroundColor(.white)
            .cornerRadius(6)
    }

    private func verdictColor(_ verdict: String) -> (Color, String) {
        switch verdict {
        case "ACCORDING_TO_PLAN": return (Color.green, "PLANA UYGUN")
        case "DRIFTED_GRAY": return (Color.orange, "GRİ BÖLGE SAPMASI")
        case "DRIFTED_THRESHOLD": return (Color.red, "EŞİK AŞIMI")
        case "WEATHER_PARDON": return (Color.teal, "ISI BERAATİ")
        case "BOUNDARY_ZONE": return (Color.yellow, "SINIR BÖLGESİ")
        default: return (Color.gray, "GÖZLEM")
        }
    }

    private func legendItem(color: Color, label: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).foregroundColor(.secondary)
        }
    }

    private func talkTestSheetView() -> some View {
        VStack(spacing: 20) {
            Text("Konuşma Testi Çıpası")
                .font(.headline)
            Text("Son kolay koşunuzda rahatça tam cümleler kurabildiğiniz nabzı girin. Bu sayı motorun kişisel AeT eşiği için doğrudan kalibrasyon çıpası olur.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            StatefulHrInput { hr in
                Task {
                    _ = try? await syncService.submitTalkTestAnchor(aetHr: hr)
                    showTalkTestSheet = false
                }
            }
        }
        .padding()
    }

    private func mirrorSheetView() -> some View {
        VStack(spacing: 16) {
            Text("Ayna Ekranı")
                .font(.title2)
                .bold()

            if let m = mirrorData, let eligible = m["eligible"] as? Bool, eligible {
                let runs = (m["totalRuns"] as? Int) ?? 0
                let dist = (m["totalDistanceKm"] as? Double) ?? 0.0

                Text("Son 60 günde \(runs) koşu ve \(String(format: "%.1f", dist)) km tamamlandı.")
                    .font(.subheadline)

                Text((m["mirrorQuestion"] as? String) ?? "")
                    .font(.body)
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(10)

                Button("Planlı Antrenman (Maraton Hazırlığı)") {
                    showMirrorSheet = false
                }
                .buttonStyle(.borderedProminent)

                Button("Farkında Olmadan Hızlandım") {
                    showMirrorSheet = false
                }
                .buttonStyle(.bordered)
            } else {
                Text(mirrorData?["message"] as? String ?? "Yetersiz veri. Son 60 günde en az 16 koşu ve 100 km gereklidir.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
            }
        }
        .padding()
    }
}

struct StatefulHrInput: View {
    @State private var hrText: String = "140"
    let onSave: (Int) -> Void

    var body: some View {
        VStack(spacing: 16) {
            TextField("Nabız (bpm)", text: $hrText)
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)
                .frame(width: 120)
                .multilineTextAlignment(.center)

            Button("Çıpayı Kaydet") {
                if let val = Int(hrText), val > 90 && val < 210 {
                    onSave(val)
                }
            }
            .buttonStyle(.borderedProminent)
        }
    }
}
