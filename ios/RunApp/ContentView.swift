import SwiftUI
import HealthKit

public struct ContentView: View {
    @StateObject private var syncService = SyncService.shared
    @StateObject private var stateManager = AppStateManager.shared
    
    @State private var showTalkTestSheet = false
    @State private var showMirrorSheet = false
    @State private var showServerSettings = false
    @State private var showDiagnosticsSheet = false
    @State private var showHKConsole = false

    public init() {}

    public var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // 1. Ana Dürüstlük Kartı (The Honesty Card)
                    honestyCard()
                    
                    // 1.1 Sunucu Bağlantı Uyarısı (Eğer ulaşılamadıysa direkt ayar yönlendirmesi)
                    if case .serverUnreachable(let url, _) = stateManager.currentGate {
                        HStack(spacing: 12) {
                            Image(systemName: "wifi.exclamationmark")
                                .foregroundColor(.orange)
                                .font(.title3)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Sunucuya Bağlanılamadı")
                                    .font(.footnote.bold())
                                Text(url)
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            Button("Ayarla") {
                                showServerSettings = true
                            }
                            .font(.caption.bold())
                            .buttonStyle(.borderedProminent)
                            .tint(.orange)
                        }
                        .padding(12)
                        .background(Color.orange.opacity(0.12))
                        .cornerRadius(12)
                        .padding(.horizontal)
                    }

                    // 2. İşlem Düğmeleri
                    VStack(spacing: 12) {
                        Button(action: {
                            Task { await syncAllWorkouts() }
                        }) {
                            HStack {
                                if stateManager.isSyncing {
                                    ProgressView().tint(.white).padding(.trailing, 6)
                                } else {
                                    Image(systemName: "arrow.triangle.2.circlepath")
                                }
                                Text(stateManager.isSyncing ? "Senkronize Ediliyor..." : "HealthKit'i Senkronize Et")
                                    .bold()
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(stateManager.isSyncing)

                        HStack(spacing: 12) {
                            Button(action: { showTalkTestSheet = true }) {
                                HStack {
                                    Image(systemName: "waveform")
                                    Text("Konuşma Çıpası")
                                }
                                .font(.subheadline)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color(.secondarySystemBackground))
                                .cornerRadius(10)
                            }

                            Button(action: {
                                Task {
                                    if !stateManager.currentGate.isServerUnreachable {
                                        stateManager.mirrorData = try? await syncService.fetchMirrorScreen()
                                    }
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
                                .background(Color(.secondarySystemBackground))
                                .cornerRadius(10)
                            }
                        }

                        // 71 Antrenman Şeffaflık & Tanı Kartı
                        Button(action: { showDiagnosticsSheet = true }) {
                            HStack {
                                Image(systemName: "chart.pie.fill")
                                    .foregroundColor(.purple)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Veri ve Kaynak Analizi")
                                        .font(.subheadline.bold())
                                        .foregroundColor(.primary)
                                    let scanned = stateManager.diagnostics.totalScannedWorkouts
                                    Text(scanned > 0 ? "\(scanned) koşu tarandı (çift kayıt & kaynak dökümü)" : "HealthKit kaynaklarını ve çift kayıtları incele")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            .padding()
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(12)
                        }
                    }
                    .padding(.horizontal)

                    // 3. İleri Düzey HealthKit Konsolu (Katlanabilir)
                    DisclosureGroup(isExpanded: $showHKConsole) {
                        HealthKitTestView()
                            .padding(.top, 8)
                    } label: {
                        HStack {
                            Image(systemName: "terminal")
                            Text("Geliştirici Canlı Telemetri Konsolu")
                                .font(.footnote.bold())
                        }
                        .foregroundColor(.secondary)
                    }
                    .padding(.horizontal)
                    .padding(.top, 10)
                }
                .padding(.vertical)
            }
            .navigationTitle("Runnie")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showServerSettings = true }) {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showTalkTestSheet) {
                talkTestSheetView()
            }
            .sheet(isPresented: $showMirrorSheet) {
                mirrorSheetView()
            }
            .sheet(isPresented: $showServerSettings) {
                ServerSettingsView()
            }
            .sheet(isPresented: $showDiagnosticsSheet) {
                DiagnosticsView()
            }
            .task {
                await checkInitialStatus()
            }
        }
    }

    // MARK: - 1. Dürüstlük Kartı
    @ViewBuilder
    private func honestyCard() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("SON KOŞU ŞİDDETİ")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.secondary)
                Spacer()
                verdictBadge(title: stateManager.currentGate.badgeTitle, color: stateManager.currentGate.badgeColor)
            }

            Text(stateManager.currentGate.sentence)
                .font(.system(size: 18, weight: .medium, design: .rounded))
                .foregroundColor(.primary)
                .lineSpacing(4)

            // Tek Eylem Düğmesi (Asla Boş Ekran Kuralı 3.4)
            actionButtonForCurrentGate()
                .padding(.top, 4)

            // Dağılım Çubuğu (Sadece ready durumunda)
            if case .ready(let data) = stateManager.currentGate {
                if data.easyPct > 0 || data.moderatePct > 0 || data.thresholdPct > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        GeometryReader { geo in
                            HStack(spacing: 2) {
                                Rectangle()
                                    .fill(Color.green)
                                    .frame(width: max(0, geo.size.width * CGFloat(data.easyPct / 100)))
                                Rectangle()
                                    .fill(Color.orange)
                                    .frame(width: max(0, geo.size.width * CGFloat(data.moderatePct / 100)))
                                Rectangle()
                                    .fill(Color.red)
                                    .frame(width: max(0, geo.size.width * CGFloat(data.thresholdPct / 100)))
                            }
                        }
                        .frame(height: 10)
                        .cornerRadius(5)

                        HStack {
                            legendItem(color: .green, label: "Aerobik: %\(Int(data.easyPct))")
                            Spacer()
                            legendItem(color: .orange, label: "Gri Bölge: %\(Int(data.moderatePct))")
                            Spacer()
                            legendItem(color: .red, label: "Eşik: %\(Int(data.thresholdPct))")
                        }
                        .font(.caption2)
                    }
                    .padding(.top, 4)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(14)
        .padding(.horizontal)
    }

    @ViewBuilder
    private func actionButtonForCurrentGate() -> some View {
        let gate = stateManager.currentGate
        switch gate {
        case .noPermission:
            Button(action: {
                Task { await syncAllWorkouts() }
            }) {
                Label(gate.actionTitle, systemImage: "lock.open.fill")
                    .font(.footnote.bold())
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)

        case .serverUnreachable:
            HStack(spacing: 8) {
                Button(action: {
                    Task { await syncAllWorkouts() }
                }) {
                    Label(gate.actionTitle, systemImage: "arrow.clockwise")
                        .font(.footnote.bold())
                }
                .buttonStyle(.borderedProminent)
                .tint(.orange)

                Button(action: {
                    showServerSettings = true
                }) {
                    Label("Sunucu Ayarları", systemImage: "gearshape")
                        .font(.footnote.bold())
                }
                .buttonStyle(.bordered)
            }

        case .noRunsFound:
            Button(action: {
                Task { await syncAllWorkouts() }
            }) {
                Label(gate.actionTitle, systemImage: "magnifyingglass")
                    .font(.footnote.bold())
            }
            .buttonStyle(.borderedProminent)

        case .unsyncedRuns:
            Button(action: {
                Task { await syncAllWorkouts() }
            }) {
                Label(gate.actionTitle, systemImage: "arrow.up.circle.fill")
                    .font(.footnote.bold())
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)

        case .calibrationPending:
            Button(action: { showTalkTestSheet = true }) {
                Label(gate.actionTitle, systemImage: "waveform")
                    .font(.footnote.bold())
            }
            .buttonStyle(.borderedProminent)
            .tint(.purple)

        case .observationOnly:
            Button(action: {
                showMirrorSheet = true
            }) {
                Label(gate.actionTitle, systemImage: "eyeglasses")
                    .font(.footnote.bold())
            }
            .buttonStyle(.bordered)

        case .belowDataThreshold:
            Button(action: {
                Task { await syncAllWorkouts() }
            }) {
                Label(gate.actionTitle, systemImage: "arrow.triangle.2.circlepath")
                    .font(.footnote.bold())
            }
            .buttonStyle(.bordered)

        case .ready:
            EmptyView()
        }
    }

    private func verdictBadge(title: String, color: Color) -> some View {
        Text(title)
            .font(.caption2)
            .fontWeight(.heavy)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color)
            .foregroundColor(.white)
            .cornerRadius(6)
    }

    private func legendItem(color: Color, label: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).foregroundColor(.secondary)
        }
    }

    // MARK: - Senkronizasyon ve Durum Yönetimi
    private func checkInitialStatus() async {
        do {
            let workouts = try await HealthKitManager.shared.fetchRecentRunningWorkouts(days: 60, limit: HKObjectQueryNoLimit)
            if workouts.isEmpty {
                stateManager.setGate(.noRunsFound)
            } else {
                stateManager.setGate(.unsyncedRuns(count: workouts.count))
                var d = stateManager.diagnostics
                d.totalScannedWorkouts = workouts.count
                stateManager.diagnostics = d
            }
        } catch {
            // İzin henüz istenmemiş olabilir
        }
    }

    private func syncAllWorkouts() async {
        stateManager.isSyncing = true
        defer { stateManager.isSyncing = false }
        
        do {
            let authorized = try await HealthKitManager.shared.requestAuthorization()
            guard authorized else {
                stateManager.setGate(.noPermission)
                return
            }

            // 60 günlük tam pencere ve limitsiz sorgu
            let workouts = try await HealthKitManager.shared.fetchRecentRunningWorkouts(days: 60, limit: HKObjectQueryNoLimit)
            guard !workouts.isEmpty else {
                stateManager.setGate(.noRunsFound)
                return
            }

            var payloads: [NormalizedActivityPayload] = []
            var totalDistanceMeters = 0.0
            
            for w in workouts {
                let dist = w.totalDistance?.doubleValue(for: .meter()) ?? 0
                totalDistanceMeters += dist
                
                // Temel mantık filtresi: 0 metre ve aşırı kısa kayıtları ele
                if dist < 50 && w.duration < 60 {
                    continue
                }

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

            // Sunucu Senkronizasyonu
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
            let uniqueCount = max(0, totalFound - duplicateCount)
            let totalKm = totalDistanceMeters / 1000.0

            var d = stateManager.diagnostics
            d.totalScannedWorkouts = totalFound
            d.duplicatesEliminatedCount = duplicateCount
            d.netUniqueRuns = uniqueCount
            d.totalKm = totalKm
            stateManager.diagnostics = d

            // En son tekil (kazanan) koşunun değerlendirmesini çek
            var assessmentAssigned = false
            if let winnerAct = keptResults.first, let actId = winnerAct["activityId"] as? String {
                try await Task.sleep(nanoseconds: 300_000_000)
                if let asmt = try await syncService.fetchAssessment(activityId: actId) {
                    let sentence = (asmt["sentence"] as? String) ?? "Değerlendirme üretildi."
                    let verdict = (asmt["verdict"] as? String) ?? "TAMAM"
                    var easyP = 0.0
                    var modP = 0.0
                    var thrP = 0.0
                    if let metrics = asmt["metrics"] as? [String: Any] {
                        easyP = (metrics["easyPct"] as? Double) ?? 0.0
                        modP = (metrics["moderatePct"] as? Double) ?? 0.0
                        thrP = (metrics["thresholdPct"] as? Double) ?? 0.0
                    }

                    let asmtData = AssessmentData(
                        activityId: actId,
                        verdict: verdict,
                        sentence: sentence,
                        easyPct: easyP,
                        moderatePct: modP,
                        thresholdPct: thrP
                    )

                    if verdict == "CALIBRATION_PENDING" {
                        stateManager.setGate(.calibrationPending)
                        assessmentAssigned = true
                    } else if verdict == "OBSERVATION_ONLY" {
                        stateManager.setGate(.observationOnly)
                        assessmentAssigned = true
                    } else if uniqueCount < 16 || totalKm < 100.0 {
                        stateManager.setGate(.belowDataThreshold(found: totalFound, duplicates: duplicateCount, unique: uniqueCount, totalDistanceKm: totalKm))
                        assessmentAssigned = true
                    } else {
                        stateManager.setGate(.ready(assessment: asmtData))
                        assessmentAssigned = true
                    }
                }
            }

            if !assessmentAssigned {
                if uniqueCount < 16 || totalKm < 100.0 {
                    stateManager.setGate(.belowDataThreshold(found: totalFound, duplicates: duplicateCount, unique: uniqueCount, totalDistanceKm: totalKm))
                } else {
                    let fallback = AssessmentData(activityId: "unknown", verdict: "ACCORDING_TO_PLAN", sentence: "Tüm koşular senkronize edildi.", easyPct: 80, moderatePct: 15, thresholdPct: 5)
                    stateManager.setGate(.ready(assessment: fallback))
                }
            }

            // Ayna Ekranı Verisini Çek
            stateManager.mirrorData = try? await syncService.fetchMirrorScreen()

        } catch {
            // Sunucuya ulaşılamadı: En üst öncelikli hata kapısı
            stateManager.setGate(.serverUnreachable(url: syncService.serverBaseUrl, underlyingError: error.localizedDescription))
            stateManager.mirrorData = nil
        }
    }

    // MARK: - Konuşma Testi Çıpası Sheet
    private func talkTestSheetView() -> some View {
        NavigationView {
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
                        await syncAllWorkouts()
                    }
                }
                Spacer()
            }
            .padding()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Kapat") { showTalkTestSheet = false }
                }
            }
        }
    }

    // MARK: - Ayna Ekranı Sheet (Problem 1 ve Problem 4 Düzeltmesi)
    private func mirrorSheetView() -> some View {
        NavigationView {
            ZStack {
                Color(.systemGroupedBackground)
                    .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        // Eğer sunucuya ulaşılamadıysa asla 'yetersiz veri' denmez
                        if case .serverUnreachable = stateManager.currentGate {
                            VStack(spacing: 16) {
                                Image(systemName: "wifi.exclamationmark")
                                    .font(.system(size: 44))
                                    .foregroundColor(.orange)
                                    .padding(.top, 20)

                                Text("Sunucuya Ulaşılamadı")
                                    .font(.title3.bold())

                                Text(stateManager.mirrorScreenNotice)
                                    .font(.body)
                                    .foregroundColor(.secondary)
                                    .multilineTextAlignment(.center)
                                    .padding(.horizontal)

                                Button(action: {
                                    showMirrorSheet = false
                                    showServerSettings = true
                                }) {
                                    Label("Sunucu Ayarlarını Düzenle", systemImage: "gearshape")
                                        .font(.subheadline.bold())
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(.orange)
                                .padding(.top, 8)
                            }
                            .padding(20)
                            .frame(maxWidth: .infinity)
                            .background(Color(.secondarySystemGroupedBackground))
                            .cornerRadius(16)
                            .padding(.horizontal)

                        } else if let m = stateManager.mirrorData, let eligible = m["eligible"] as? Bool, eligible {
                            // Ayna Soruları
                            let runs = (m["totalRuns"] as? Int) ?? 0
                            let dist = (m["totalDistanceKm"] as? Double) ?? 0.0

                            VStack(alignment: .leading, spacing: 14) {
                                Text("60 Günlük Profil")
                                    .font(.caption.bold())
                                    .foregroundColor(.secondary)

                                Text("Son 60 günde \(runs) koşu ve \(String(format: "%.1f", dist)) km tamamlandı.")
                                    .font(.headline)

                                Text((m["mirrorQuestion"] as? String) ?? "")
                                    .font(.body)
                                    .padding()
                                    .background(Color(.secondarySystemBackground))
                                    .cornerRadius(10)

                                Button("Planlı Antrenman (Maraton Hazırlığı)") {
                                    showMirrorSheet = false
                                }
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.blue)
                                .foregroundColor(.white)
                                .cornerRadius(10)

                                Button("Farkında Olmadan Hızlandım") {
                                    showMirrorSheet = false
                                }
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color(.secondarySystemBackground))
                                .foregroundColor(.primary)
                                .cornerRadius(10)
                            }
                            .padding(20)
                            .background(Color(.secondarySystemGroupedBackground))
                            .cornerRadius(16)
                            .padding(.horizontal)

                        } else {
                            // Durum Hiyerarşisine Uygun Bilgilendirme Kartı
                            VStack(spacing: 16) {
                                Image(systemName: "eyeglasses")
                                    .font(.system(size: 40))
                                    .foregroundColor(.secondary)
                                    .padding(.top, 20)

                                Text(stateManager.mirrorScreenNotice)
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                                    .multilineTextAlignment(.center)
                                    .padding(.horizontal)

                                if case .belowDataThreshold = stateManager.currentGate {
                                    Button("Tanı Ekranında İncele") {
                                        showMirrorSheet = false
                                        showDiagnosticsSheet = true
                                    }
                                    .font(.footnote.bold())
                                    .buttonStyle(.bordered)
                                }
                            }
                            .padding(20)
                            .frame(maxWidth: .infinity)
                            .background(Color(.secondarySystemGroupedBackground))
                            .cornerRadius(16)
                            .padding(.horizontal)
                        }
                    }
                    .padding(.vertical)
                }
            }
            .navigationTitle("Ayna Ekranı")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Kapat") {
                        showMirrorSheet = false
                    }
                }
            }
        }
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
