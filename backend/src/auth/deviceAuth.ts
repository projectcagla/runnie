import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface DeviceAuthSession {
  userId: string;
  deviceId: string;
  deviceIdentifier: string;
}

export interface RegisterDeviceParams {
  deviceIdentifier: string;
  model?: string;
  osVersion?: string;
  appVersion?: string;
}

export interface RegisterDeviceResult {
  userId: string;
  deviceId: string;
  authToken: string;
}

/**
 * SHA-256 ile Güvenli Token Özeti Üretir
 */
export function hashAuthToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Cihaz Kaydı ve Token Üretimi (Frictionless Device Auth)
 */
export function registerOrGetDevice(db: DatabaseSync, params: RegisterDeviceParams): RegisterDeviceResult {
  const nowIso = new Date().toISOString();
  
  // 1. Cihaz daha önce kayıtlı mı?
  const existingStmt = db.prepare('SELECT id, user_id FROM devices WHERE device_identifier = ?');
  const existing = existingStmt.get(params.deviceIdentifier) as { id: string; user_id: string } | undefined;

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashAuthToken(rawToken);

  if (existing) {
    // Cihazı ve son aktifliği güncelle, yeni token ata
    const updateStmt = db.prepare(`
      UPDATE devices 
      SET auth_token_hash = ?, model = COALESCE(?, model), os_version = COALESCE(?, os_version), app_version = COALESCE(?, app_version), updated_at = ?
      WHERE id = ?
    `);
    updateStmt.run(tokenHash, params.model || null, params.osVersion || null, params.appVersion || null, nowIso, existing.id);

    db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(nowIso, existing.user_id);

    return {
      userId: existing.user_id,
      deviceId: existing.id,
      authToken: rawToken
    };
  }

  // 2. Yeni kullanıcı ve yeni cihaz oluştur
  const userId = `usr_${randomUUID()}`;
  const deviceId = `dev_${randomUUID()}`;

  db.prepare('INSERT INTO users (id, created_at, last_active_at) VALUES (?, ?, ?)').run(userId, nowIso, nowIso);

  const insertDeviceStmt = db.prepare(`
    INSERT INTO devices (id, user_id, device_identifier, auth_token_hash, model, os_version, app_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertDeviceStmt.run(deviceId, userId, params.deviceIdentifier, tokenHash, params.model || null, params.osVersion || null, params.appVersion || null, nowIso, nowIso);

  return {
    userId,
    deviceId,
    authToken: rawToken
  };
}

/**
 * Bearer Token Doğrulama
 */
export function authenticateDeviceToken(db: DatabaseSync, rawToken: string): DeviceAuthSession | null {
  if (!rawToken || rawToken.length < 16) return null;

  const tokenHash = hashAuthToken(rawToken);
  const stmt = db.prepare(`
    SELECT d.id as deviceId, d.user_id as userId, d.device_identifier as deviceIdentifier
    FROM devices d
    WHERE d.auth_token_hash = ?
  `);
  const row = stmt.get(tokenHash) as DeviceAuthSession | undefined;
  if (!row) return null;

  // Son aktifliği güncelle
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(new Date().toISOString(), row.userId);

  return row;
}
