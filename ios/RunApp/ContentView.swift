import SwiftUI

public struct ContentView: View {
    @StateObject private var syncService = SyncService.shared
    @State private var isSyncing = false
    @State private var latestAssessmentSentence: String = "Henüz senkronize edilmiş koşu yok."
    @State private var latestVerdict: String = "BEKLİYOR"
    @State private var easyPct: Double = 0.0
    @State private var moderatePct: Double = 0.0
    @State private var thresholdPct: Double = 0.0
    @State private var showTalkTestSheet = false
    @State private var showMirrorSheet = false
    @State private var mirrorData: [String: Any]? = nil
    @State private var syncSummaryMessage: String? = nil
    @State private var activeSilenceState: SilenceState? = nil

    enum SilenceState {
        case permissionMissing
        case serverUnreachable
        case noRunsFound
        case belowDataThreshold(found: Int, duplicates: Int, unique: Int)
        case calibrationPending
        case observationOnly
    }

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

                        // Sessizlik Durumu Tek Eylem Düğmesi (Asla Boş Ekran Kuralı 3.4)
                        if let silence = activeSilenceState {
                            silenceActionButton(silence)
                                .padding(.top, 4)
                        }

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

                    // 1.1 Bilgilendirme / Tekilleştirme Özeti Kartı
                    if let summary = syncSummaryMessage {
                        HStack(spacing: 10) {
                            Image(systemName: "info.circle.fill")
                                .foregroundColor(.blue)
                            Text(summary)
                                .font(.footnote)
                                .foregroundColor(.primary)
                            Spacer()
                        }
                        .padding(12)
                        .background(Color(.tertiarySystemBackground))
                        .cornerRadius(10)
                        .padding(.horizontal)
                    }

                    // 2. İşlem Düğmeleri
                    VStack(spacing: 12) {
                        Button(action: {
                            Task {
                                await syncAllWorkouts()
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

    @ViewBuilder
    private func silenceActionButton(_ state: SilenceState) -> some View {
        switch state {
        case .permissionMissing:
            Button(action: {
                Task { await syncAllWorkouts() }
            }) {
                Label("İzinleri İste", systemImage: "lock.open.fill")
                    .font(.footnote.bold())
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)

        case .serverUnreachable:
            Button(action: {
                Task { await syncAllWorkouts() }
            }) {
                Label("Yeniden Dene", systemImage: "arrow.clockwise")
                    .font(.footnote.bold())
            }
            .buttonStyle(.borderedProminent)
            .tint(.orange)

        case .noRunsFound:
            Button(action: {
                Task { await syncAllWorkouts() }
            }) {
                Label("HealthKit'i Tara", systemImage: "magnifyingglass")
                    .font(.footnote.bold())
            }
            .buttonStyle(.borderedProminent)

        case .calibrationPending:
            Button(action: { showTalkTestSheet = true }) {
                Label("Konuşma Testi Çıpası Gir", systemImage: "waveform")
                    .font(.footnote.bold())
            }
            .buttonStyle(.borderedProminent)
            .tint(.purple)

        case .observationOnly:
            Button(action: {
                Task {
                    mirrorData = try? await syncService.fetchMirrorScreen()
                    showMirrorSheet = true
                }
            }) {
                Label("Ayna Ekranını İncele", systemImage: "eyeglasses")
                    .font(.footnote.bold())
            }
            .buttonStyle(.bordered)

        case .belowDataThreshold:
            Button(action: {
                Task { await syncAllWorkouts() }
            }) {
                Label("HealthKit'i Senkronize Et", systemImage: "arrow.triangle.2.circlepath")
                    .font(.footnote.bold())
            }
            .buttonStyle(.bordered)
        }
    }

    private func syncAllWorkouts() async {
        isSyncing = true
        defer { isSyncing = false }
        do {
            let authorized = try await HealthKitManager.shared.requestAuthorization()
            guard authorized else {
                await MainActor.run {
                    self.activeSilenceState = .permissionMissing
                    self.latestVerdict = "İZİN GEREKLİ"
                    self.latestAssessmentSentence = "HealthKit okuma izni verilmedi. Koşularınızın analiz edilebilmesi için Apple Sağlık izinleri gereklidir."
                }
                return
            }

            // 3.1: 60 günlük tam pencere ve limitsiz sorgu
            let workouts = try await HealthKitManager.shared.fetchRecentRunningWorkouts(days: 60)
            guard !workouts.isEmpty else {
                await MainActor.run {
                    self.activeSilenceState = .noRunsFound
                    self.latestVerdict = "KAYIT YOK"
                    self.latestAssessmentSentence = "HealthKit arşivinizde koşu antrenmanı bulunamadı. Apple Watch ile koşu kaydettikten sonra tekrar senkronize edin."
                }
                return
            }

            var payloads: [NormalizedActivityPayload] = []
            for w in workouts {
                let hr = (try? await HealthKitManager.shared.fetchHeartRateSamples(for: w)) ?? []
                let steps = (try? await HealthKitManager.shared.fetchStepSamples(for: w)) ?? []
                let speeds = (try? await HealthKitManager.shared.fetchRunningSpeedSamples(for: w)) ?? []
                let route = (try? await HealthKitManager.shared.fetchRouteLocations(for: w)) ?? []

                let payload = WorkoutNormalizer.normalize(
                    workout: w,
                    hrSamples: hr,
                    stepSamples: steps,
                    speedSamples: speeds,
                    routeLocations: route
                )
                payloads.append(payload)
            }

            let syncResults = try await syncService.syncWorkouts(payloads)

            var duplicateCount = 0
            var keptResults: [[String: Any]] = []
            for res in syncResults {
                if let dedup = res["deduplication"] as? [String: Any],
                   let action = dedup["action"] as? String,
                   action == "MARK_DUPLICATE" {
                    duplicateCount += 1
                } else {
                    keptResults.append(res)
                }
            }

            let totalFound = workouts.count
            let uniqueCount = totalFound - duplicateCount
            let summaryText = "\(totalFound) koşu bulundu, \(duplicateCount) adedi çift kayıt olarak elendi (\(uniqueCount) tekil). Ayna ekranı için 16 koşu gerekiyor."

            await MainActor.run {
                self.syncSummaryMessage = summaryText
                if uniqueCount < 16 {
                    self.activeSilenceState = .belowDataThreshold(found: totalFound, duplicates: duplicateCount, unique: uniqueCount)
                }
            }

            // En son tekil (kazanan) koşunun değerlendirmesini çek
            if let winnerAct = keptResults.first, let actId = winnerAct["activityId"] as? String {
                try await Task.sleep(nanoseconds: 500_000_000)
                if let asmt = try await syncService.fetchAssessment(activityId: actId) {
                    await MainActor.run {
                        self.latestAssessmentSentence = (asmt["sentence"] as? String) ?? "Değerlendirme üretildi."
                        let verdict = (asmt["verdict"] as? String) ?? "TAMAM"
                        self.latestVerdict = verdict
                        if verdict == "CALIBRATION_PENDING" {
                            self.activeSilenceState = .calibrationPending
                        } else if verdict == "OBSERVATION_ONLY" {
                            self.activeSilenceState = .observationOnly
                        } else if uniqueCount >= 16 {
                            self.activeSilenceState = nil
                        }
                        if let metrics = asmt["metrics"] as? [String: Any] {
                            self.easyPct = (metrics["easyPct"] as? Double) ?? 0.0
                            self.moderatePct = (metrics["moderatePct"] as? Double) ?? 0.0
                            self.thresholdPct = (metrics["thresholdPct"] as? Double) ?? 0.0
                        }
                    }
                }
            }
        } catch {
            await MainActor.run {
                self.activeSilenceState = .serverUnreachable
                self.latestVerdict = "BAĞLANTI"
                self.latestAssessmentSentence = "Sunucuya ulaşılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin."
            }
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
        case "PHYSIOLOGICAL_PARDON": return (Color.purple, "FİZYOLOJİK BERAAT")
        case "BOUNDARY_ZONE": return (Color.yellow, "SINIR BÖLGESİ")
        case "CALIBRATION_PENDING": return (Color.purple, "KALİBRASYON BEKLİYOR")
        case "OBSERVATION_ONLY": return (Color.gray, "GÖZLEM MODU")
        case "İZİN GEREKLİ": return (Color.red, "İZİN GEREKLİ")
        case "BAĞLANTI": return (Color.orange, "BAĞLANTI HATASI")
        case "KAYIT YOK": return (Color.gray, "KAYIT YOK")
        default: return (Color.gray, verdict)
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
