import SwiftUI
import HealthKit

public struct ContentView: View {
    @StateObject private var stateManager = AppStateManager.shared
    @StateObject private var processor = WorkoutProcessor.shared

    @State private var showTalkTestSheet = false
    @State private var showMirrorSheet = false
    @State private var showDiagnosticsSheet = false
    @State private var showHKConsole = false
    @State private var showPrivacyAlert = false

    public init() {}

    public var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // 1. Ana Dürüstlük Kartı (The Honesty Card)
                    honestyCard()

                    // 2. İşlem Düğmeleri
                    VStack(spacing: 12) {
                        Button(action: {
                            Task { await runLocalAnalysis() }
                        }) {
                            HStack {
                                if stateManager.isSyncing {
                                    ProgressView().tint(.white).padding(.trailing, 6)
                                } else {
                                    Image(systemName: "cpu")
                                }
                                Text(stateManager.isSyncing ? "Cihazda Analiz Ediliyor..." : "HealthKit'i Analiz Et")
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
                                showMirrorSheet = true
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

                        // Tanı ve Veri İnceleme Kartı
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

                    // 4. Gizlilik ve Cihaz İçi Saklama Notu
                    VStack(spacing: 6) {
                        HStack(spacing: 6) {
                            Image(systemName: "lock.shield.fill")
                                .foregroundColor(.green)
                            Text("Tamamen Cihaz İçi & Sıfır Ağ Çağrısı")
                                .font(.caption2.bold())
                                .foregroundColor(.secondary)
                        }
                        Text("Sağlık verileriniz telefonunuzdan hiç çıkmaz. Bütün motor yerel olarak çalışır.")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)

                        Button("Verileri Cihazdan Tamamen Sil") {
                            showPrivacyAlert = true
                        }
                        .font(.caption2)
                        .foregroundColor(.red)
                        .padding(.top, 4)
                    }
                    .padding(.top, 10)
                    .padding(.horizontal)
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
            .sheet(isPresented: $showDiagnosticsSheet) {
                DiagnosticsView()
            }
            .alert("Tüm Yerel Veriler Silinsin mi?", isPresented: $showPrivacyAlert) {
                Button("Vazgeç", role: .cancel) {}
                Button("Tümünü Sil", role: .destructive) {
                    RunnieDatabase.shared.deleteUserDataCompletely()
                    Task { await runLocalAnalysis() }
                }
            } message: {
                Text("Cihazda saklanan tüm geçmiş koşu, akış ve değerlendirme kayıtları SQLite veritabanından kalıcı olarak silinecektir.")
            }
            .task {
                await runLocalAnalysis()
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

            // Tek Eylem Düğmesi
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
                Task { await runLocalAnalysis() }
            }) {
                Label(gate.actionTitle, systemImage: "lock.open.fill")
                    .font(.footnote.bold())
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)

        case .noRunsFound:
            Button(action: {
                Task { await runLocalAnalysis() }
            }) {
                Label(gate.actionTitle, systemImage: "magnifyingglass")
                    .font(.footnote.bold())
            }
            .buttonStyle(.borderedProminent)

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
                Task { await runLocalAnalysis() }
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

    // MARK: - Cihaz İçi Analiz
    private func runLocalAnalysis() async {
        stateManager.isSyncing = true
        defer { stateManager.isSyncing = false }
        try? await processor.processAllWorkouts()
    }

    // MARK: - Konuşma Testi Çıpası Sheet
    private func talkTestSheetView() -> some View {
        NavigationView {
            VStack(spacing: 20) {
                Text("Konuşma Testi Çıpası")
                    .font(.headline)
                Text("Son kolay koşunuzda rahatça tam cümleler kurabildiğiniz nabzı girin. Bu sayı cihazınızdaki motorun kişisel AeT eşiği için doğrudan kalibrasyon çıpası olur.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                StatefulHrInput { hr in
                    Task {
                        await processor.submitTalkTestAnchor(aetHr: hr)
                        showTalkTestSheet = false
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

    // MARK: - Ayna Ekranı Sheet
    private func mirrorSheetView() -> some View {
        NavigationView {
            ZStack {
                Color(.systemGroupedBackground)
                    .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        if let m = stateManager.mirrorData, let eligible = m["eligible"] as? Bool, eligible {
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
