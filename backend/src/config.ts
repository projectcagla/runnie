import * as path from 'node:path';

export const BACKEND_CONFIG = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  DB_PATH: process.env.DB_PATH || path.join(process.cwd(), 'data', 'runnie.sqlite'),
  
  // Kimlik Doğrulama
  AUTH_SECRET: process.env.AUTH_SECRET || 'runnie-dev-device-secret-key-32chars!!',
  TOKEN_TTL_DAYS: 365,

  // Open-Meteo Servisi
  OPEN_METEO_ARCHIVE_URL: 'https://archive-api.open-meteo.com/v1/archive',
  OPEN_METEO_FORECAST_URL: 'https://api.open-meteo.com/v1/forecast',
  WEATHER_CACHE_TTL_HOURS: 24 * 30, // 30 gün önbellek

  // APNs Yapılandırması
  APNS_TEAM_ID: process.env.APNS_TEAM_ID || 'APPLE_TEAM_ID',
  APNS_KEY_ID: process.env.APNS_KEY_ID || 'APPLE_KEY_ID',
  APNS_BUNDLE_ID: 'com.projectcagla.runnie',
  APNS_PRODUCTION: process.env.NODE_ENV === 'production',
  TARGET_DELIVERY_SLA_SEC: 180 // 3 dakika hedefi
} as const;
