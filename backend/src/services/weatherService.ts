import type { DatabaseSync } from 'node:sqlite';
import { BACKEND_CONFIG } from '../config.ts';
import type { WeatherSnapshot } from '../../../src/types.ts';

export interface WeatherQueryOptions {
  latitude?: number;
  longitude?: number;
  isoStartTime: string;
}

export interface WeatherSnapshot {
  temperatureC: number;
  apparentTemperatureC: number;
  relativeHumidity: number;
  windSpeedKmh: number;
  isExtremeHeat: boolean;
}

export type WeatherResult =
  | { status: 'AVAILABLE'; snapshot: WeatherSnapshot }
  | { status: 'UNAVAILABLE'; reason: 'MISSING_COORDINATES' | 'FETCH_FAILED' | 'DATA_UNAVAILABLE' };

/**
 * Koordinatları 2 Basamağa Yuvarlar (~1.1 km çözünürlük, önbellek optimizasyonu)
 */
export function roundCoordinate(coord: number): number {
  return Math.round(coord * 100) / 100;
}

export function buildWeatherCacheKey(lat: number, lon: number, dateStr: string, hour: number): string {
  return `grid_${roundCoordinate(lat)}_${roundCoordinate(lon)}_${dateStr}_${hour}`;
}

/**
 * Open-Meteo Geçmiş Hava Durumu Sorgusu ve Önbellekleme Servisi.
 * Koordinat yoksa veya hava verisi alınamazsa KESİNLİKLE 20°C / %50 uydurulmaz.
 * Doğrudan UNAVAILABLE döner ve beraat mekanizması o koşu için devre dışı kalır.
 */
export async function getHistoricalWeather(
  db: DatabaseSync,
  options: WeatherQueryOptions
): Promise<WeatherResult> {
  // 1. Koordinat Yoksa: Uydurma yok, doğrudan UNAVAILABLE
  if (options.latitude === undefined || options.longitude === undefined) {
    return { status: 'UNAVAILABLE', reason: 'MISSING_COORDINATES' };
  }

  const startTime = new Date(options.isoStartTime);
  if (isNaN(startTime.getTime())) {
    return { status: 'UNAVAILABLE', reason: 'FETCH_FAILED' };
  }

  const dateStr = startTime.toISOString().split('T')[0]; // YYYY-MM-DD
  const hour = startTime.getUTCHours();
  const cacheKey = buildWeatherCacheKey(options.latitude, options.longitude, dateStr, hour);

  // 2. Önbellek Kontrolü
  const cachedStmt = db.prepare('SELECT weather_json FROM weather_cache WHERE cache_key = ?');
  const cachedRow = cachedStmt.get(cacheKey) as { weather_json: string } | undefined;
  if (cachedRow) {
    try {
      const snap = JSON.parse(cachedRow.weather_json) as WeatherSnapshot;
      return { status: 'AVAILABLE', snapshot: snap };
    } catch {
      // Önbellek bozulmuşsa sorguya devam et
    }
  }

  // 3. Open-Meteo Archive API Sorgusu
  const lat = roundCoordinate(options.latitude);
  const lon = roundCoordinate(options.longitude);

  const ageInDays = (Date.now() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const baseUrl = ageInDays < 5 
    ? BACKEND_CONFIG.OPEN_METEO_FORECAST_URL 
    : BACKEND_CONFIG.OPEN_METEO_ARCHIVE_URL;

  const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m&timezone=UTC`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { status: 'UNAVAILABLE', reason: 'FETCH_FAILED' };
    }

    const data = await res.json() as any;
    if (!data?.hourly?.time || !Array.isArray(data.hourly.time)) {
      return { status: 'UNAVAILABLE', reason: 'DATA_UNAVAILABLE' };
    }

    const hourTargetStr = `${dateStr}T${hour.toString().padStart(2, '0')}:00`;
    const targetIdx = data.hourly.time.findIndex((t: string) => t.startsWith(hourTargetStr));
    const idx = targetIdx >= 0 ? targetIdx : 0;

    const rawTemp = data.hourly.temperature_2m?.[idx];
    const rawApparent = data.hourly.apparent_temperature?.[idx];
    const rawHumidity = data.hourly.relative_humidity_2m?.[idx];
    const rawWind = data.hourly.wind_speed_10m?.[idx];

    // Ölçülmemiş değeri varsayılanla DOLDURMA (20C uydurmak yasak)
    if (rawTemp === undefined || rawTemp === null || rawHumidity === undefined || rawHumidity === null) {
      return { status: 'UNAVAILABLE', reason: 'DATA_UNAVAILABLE' };
    }

    const temperatureC = Number(rawTemp);
    const apparentTemperatureC = rawApparent !== undefined && rawApparent !== null ? Number(rawApparent) : temperatureC;
    const relativeHumidity = Number(rawHumidity);
    const windSpeedKmh = rawWind !== undefined && rawWind !== null ? Number(rawWind) : 0;

    const isExtremeHeat = temperatureC >= 24.0 && relativeHumidity >= 75;

    const snapshot: WeatherSnapshot = {
      temperatureC: Math.round(temperatureC * 10) / 10,
      apparentTemperatureC: Math.round(apparentTemperatureC * 10) / 10,
      relativeHumidity: Math.round(relativeHumidity),
      windSpeedKmh: Math.round(windSpeedKmh * 10) / 10,
      isExtremeHeat
    };

    // 4. Önbelleğe Kaydet (Sadece hava özeti saklanır, kullanıcı koordinatı değil)
    const insertCacheStmt = db.prepare(`
      INSERT OR REPLACE INTO weather_cache (cache_key, weather_json, created_at)
      VALUES (?, ?, ?)
    `);
    insertCacheStmt.run(cacheKey, JSON.stringify(snapshot), new Date().toISOString());

    return { status: 'AVAILABLE', snapshot };
  } catch {
    return { status: 'UNAVAILABLE', reason: 'FETCH_FAILED' };
  }
}
