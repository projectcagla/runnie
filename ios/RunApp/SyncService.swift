import Foundation

public final class SyncService: ObservableObject {
    public static let shared = SyncService()
    
    @Published public var serverBaseUrl: String
    @Published public var authToken: String? = nil
    @Published public var userId: String? = nil
    @Published public var deviceId: String? = nil
    @Published public var lastSyncStatus: String = "Hazır"
    
    private let session: URLSession
    
    private init() {
        let savedUrl = UserDefaults.standard.string(forKey: "server_base_url") ?? "http://localhost:3000"
        self.serverBaseUrl = savedUrl
        self.authToken = UserDefaults.standard.string(forKey: "auth_token")
        self.userId = UserDefaults.standard.string(forKey: "user_id")
        self.deviceId = UserDefaults.standard.string(forKey: "device_id")
        
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10.0
        config.timeoutIntervalForResource = 20.0
        self.session = URLSession(configuration: config)
    }
    
    public func setServerBaseUrl(_ newUrl: String) {
        var clean = newUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        while clean.hasSuffix("/") {
            clean.removeLast()
        }
        guard !clean.isEmpty else { return }
        self.serverBaseUrl = clean
        UserDefaults.standard.setValue(clean, forKey: "server_base_url")
    }
    
    public func testConnection() async -> Result<String, Error> {
        guard let url = URL(string: "\(serverBaseUrl)/v1/health") else {
            return .failure(URLError(.badURL))
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 8.0
        
        do {
            let (data, response) = try await session.data(for: request)
            guard let httpRes = response as? HTTPURLResponse else {
                return .failure(URLError(.badServerResponse))
            }
            guard httpRes.statusCode == 200 else {
                return .failure(NSError(domain: "SyncService", code: httpRes.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(httpRes.statusCode)"]))
            }
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let status = json["status"] as? String {
                return .success("Sunucu Aktif (\(status))")
            }
            return .success("Sunucu Aktif (200 OK)")
        } catch {
            return .failure(error)
        }
    }
    
    public func registerDeviceIfNeeded() async throws {
        if authToken != nil && userId != nil { return }
        
        guard let url = URL(string: "\(serverBaseUrl)/v1/auth/device-register") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10.0
        
        let vendorId = (UserDefaults.standard.string(forKey: "vendor_device_id")) ?? UUID().uuidString
        UserDefaults.standard.setValue(vendorId, forKey: "vendor_device_id")
        
        let body: [String: Any] = [
            "deviceIdentifier": vendorId,
            "platform": "IOS",
            "appVersion": "1.0.0"
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await session.data(for: request)
        guard let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        if let token = json?["authToken"] as? String,
           let uId = json?["userId"] as? String,
           let dId = json?["deviceId"] as? String {
            await MainActor.run {
                self.authToken = token
                self.userId = uId
                self.deviceId = dId
            }
            UserDefaults.standard.setValue(token, forKey: "auth_token")
            UserDefaults.standard.setValue(uId, forKey: "user_id")
            UserDefaults.standard.setValue(dId, forKey: "device_id")
        }
    }
    
    public func syncWorkouts(_ payloads: [NormalizedActivityPayload]) async throws -> [[String: Any]] {
        try await registerDeviceIfNeeded()
        guard let token = authToken else { throw URLError(.userAuthenticationRequired) }
        
        guard let url = URL(string: "\(serverBaseUrl)/v1/sync/activities") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 15.0
        
        let encoder = JSONEncoder()
        let bodyData = try encoder.encode(["activities": payloads])
        request.httpBody = bodyData
        
        let (data, response) = try await session.data(for: request)
        guard let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return (json?["items"] as? [[String: Any]]) ?? []
    }
    
    public func fetchAssessment(activityId: String) async throws -> [String: Any]? {
        guard let token = authToken else { return nil }
        guard let url = URL(string: "\(serverBaseUrl)/v1/activities/\(activityId)/assessment") else { return nil }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10.0
        
        let (data, response) = try await session.data(for: request)
        guard let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200 else {
            return nil
        }
        return try JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
    
    public func submitTalkTestAnchor(aetHr: Int) async throws -> Bool {
        try await registerDeviceIfNeeded()
        guard let token = authToken else { return false }
        guard let url = URL(string: "\(serverBaseUrl)/v1/user/talk-test-anchor") else { return false }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10.0
        
        let body: [String: Any] = ["anchorHeartRate": aetHr]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (_, response) = try await session.data(for: request)
        guard let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200 else {
            return false
        }
        return true
    }
    
    public func fetchMirrorScreen() async throws -> [String: Any]? {
        guard let token = authToken else { return nil }
        guard let url = URL(string: "\(serverBaseUrl)/v1/user/mirror") else { return nil }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10.0
        
        let (data, response) = try await session.data(for: request)
        guard let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200 else {
            return nil
        }
        return try JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}
