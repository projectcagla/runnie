import Foundation

public final class OnDeviceWeatherService {
    public static let shared = OnDeviceWeatherService()

    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 5.0
        config.timeoutIntervalForResource = 8.0
        self.session = URLSession(configuration: config)
    }

    public static func roundCoordinate(_ coord: Double) -> Double {
        return (coord * 100.0).rounded() / 100.0
    }

    public static func buildCacheKey(lat: Double, lon: Double, dateStr: String, hour: Int) -> String {
        return "grid_\(roundCoordinate(lat))_\(roundCoordinate(lon))_\(dateStr)_\(hour)"
    }

    /**
     * Open-Meteo Geçmiş Hava Durumu Sorgusu ve Önbellekleme Servisi.
     * Koordinatlar bellek içi geçicidir (ephemeral), sorgudan sonra asla diske veya veritabanına yazılmaz.
     * Koordinat yoksa KESİNLİKLE 20°C uydurulmaz; doğrudan nil döner ve beraat kapanır.
     */
    public func fetchHistoricalWeather(latitude: Double?, longitude: Double?, date: Date) async -> WeatherSnapshot? {
        guard let lat = latitude, let lon = longitude else {
            return nil
        }

        let calendar = Calendar(identifier: .gregorian)
        let utcComponents = calendar.dateComponents(in: TimeZone(secondsFromGMT: 0)!, from: date)
        guard let year = utcComponents.year, let month = utcComponents.month, let day = utcComponents.day, let hour = utcComponents.hour else {
            return nil
        }

        let dateStr = String(format: "%04d-%02d-%02d", year, month, day)
        let cacheKey = Self.buildCacheKey(lat: lat, lon: lon, dateStr: dateStr, hour: hour)

        // 1. Yerel SQLite Önbellek Kontrolü
        if let cached = RunnieDatabase.shared.getCachedWeather(cacheKey: cacheKey) {
            return cached
        }

        // 2. Open-Meteo API Sorgusu
        let roundedLat = Self.roundCoordinate(lat)
        let roundedLon = Self.roundCoordinate(lon)
        let ageInDays = Date().timeIntervalSince(date) / (86400.0)
        let baseUrl = ageInDays < 5.0
            ? "https://api.open-meteo.com/v1/forecast"
            : "https://archive-api.open-meteo.com/v1/archive"

        guard let url = URL(string: "\(baseUrl)?latitude=\(roundedLat)&longitude=\(roundedLon)&start_date=\(dateStr)&end_date=\(dateStr)&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m&timezone=UTC") else {
            return nil
        }

        do {
            let (data, response) = try await session.data(from: url)
            guard let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200 else {
                return nil
            }

            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let hourly = json["hourly"] as? [String: Any],
                  let times = hourly["time"] as? [String],
                  let temps = hourly["temperature_2m"] as? [Double],
                  let apparents = hourly["apparent_temperature"] as? [Double],
                  let humidities = hourly["relative_humidity_2m"] as? [Double],
                  let winds = hourly["wind_speed_10m"] as? [Double] else {
                return nil
            }

            let targetTimeStr = String(format: "%@T%02d:00", dateStr, hour)
            let idx = times.firstIndex(where: { $0.hasPrefix(targetTimeStr) }) ?? 0

            guard idx < temps.count && idx < humidities.count else { return nil }

            let temp = temps[idx]
            let apparent = idx < apparents.count ? apparents[idx] : temp
            let humidity = humidities[idx]
            let wind = idx < winds.count ? winds[idx] : 0.0

            let snapshot = WeatherSnapshot(
                temperatureC: temp,
                apparentTemperatureC: apparent,
                relativeHumidity: humidity,
                windSpeedKmh: wind,
                weatherCode: nil,
                isExtremeHeat: temp >= EngineConfig.HEAT_TEMPERATURE_THRESHOLD_C
            )

            // Önbelleğe kaydet (koordinat kaydedilmez, sadece ızgara anahtarı)
            RunnieDatabase.shared.saveCachedWeather(cacheKey: cacheKey, weather: snapshot)
            return snapshot

        } catch {
            return nil
        }
    }
}
