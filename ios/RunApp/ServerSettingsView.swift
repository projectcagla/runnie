import SwiftUI

public struct ServerSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var syncService = SyncService.shared
    
    @State private var serverUrlText: String = ""
    @State private var testState: TestState = .idle
    @State private var savedNotice: Bool = false
    
    enum TestState {
        case idle
        case testing
        case success(String)
        case failure(String)
    }
    
    public init() {}
    
    public var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Sunucu Adresi"), footer: Text("TestFlight sürümü 5G veya dış ağdayken bilgisayarınızdaki localhost'a erişemez. Bilgisayarınızda terminalden 'npm run tunnel' çalıştırarak aldığınız HTTPS adresini buraya giriniz.")) {
                    TextField("http://localhost:3000 veya https://...", text: $serverUrlText)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .keyboardType(.URL)
                        .font(.system(.body, design: .monospaced))
                    
                    if savedNotice {
                        Text("Adres kaydedildi.")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                }
                
                Section(header: Text("Hızlı Ön Tanımlar")) {
                    Button(action: {
                        serverUrlText = "http://localhost:3000"
                    }) {
                        Label("Localhost (Simülatör için)", systemImage: "macbook")
                    }
                    
                    Button(action: {
                        serverUrlText = "http://192.168.1.100:3000"
                    }) {
                        Label("Yerel Ağ / LAN (Aynı Wi-Fi)", systemImage: "wifi")
                    }
                    
                    Button(action: {
                        if !serverUrlText.starts(with: "https://") {
                            serverUrlText = "https://"
                        }
                    }) {
                        Label("Cloudflare Tunnel / HTTPS", systemImage: "shield.lefthalf.filled")
                    }
                }
                
                Section(header: Text("Bağlantı Doğrulama")) {
                    Button(action: {
                        Task { await runConnectionTest() }
                    }) {
                        HStack {
                            if case .testing = testState {
                                ProgressView().padding(.trailing, 6)
                                Text("Bağlantı Test Ediliyor...")
                            } else {
                                Label("Bağlantıyı Test Et (/v1/health)", systemImage: "bolt.horizontal.circle")
                            }
                        }
                    }
                    .disabled(testStateIsTesting)
                    
                    switch testState {
                    case .idle:
                        EmptyView()
                    case .testing:
                        EmptyView()
                    case .success(let msg):
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text(msg)
                                .font(.caption.bold())
                                .foregroundColor(.green)
                        }
                    case .failure(let err):
                        HStack(alignment: .top) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.red)
                            Text(err)
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                    }
                }
            }
            .navigationTitle("Sunucu Ayarları")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("İptal") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Kaydet") {
                        saveAndDismiss()
                    }
                    .bold()
                }
            }
            .onAppear {
                serverUrlText = syncService.serverBaseUrl
            }
        }
    }
    
    private var testStateIsTesting: Bool {
        if case .testing = testState { return true }
        return false
    }
    
    private func runConnectionTest() async {
        syncService.setServerBaseUrl(serverUrlText)
        testState = .testing
        
        let result = await syncService.testConnection()
        switch result {
        case .success(let msg):
            testState = .success(msg)
        case .failure(let err):
            testState = .failure("Bağlantı hatası: \(err.localizedDescription)")
        }
    }
    
    private func saveAndDismiss() {
        syncService.setServerBaseUrl(serverUrlText)
        savedNotice = true
        dismiss()
    }
}
