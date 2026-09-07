import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface DeletionResult {
  success: boolean;
  deletedActivitiesCount: number;
  totalDistanceKm: number;
  anonymizedAuditId: string;
}

/**
 * KVKK / GDPR Kapsamında Kullanıcı Verilerini Tamamen Siler (Unutulma Hakkı).
 * Kişisel tüm veriler (cihazlar, aktiviteler, akış noktaları, fizyolojik metrikler) silinir.
 * Yalnızca anonimleştirilmiş toplam istatistik denetim günlüğüne kaydedilir.
 */
export function deleteUserDataCompletely(db: DatabaseSync, userId: string): DeletionResult {
  // 1. Silinecek İstatistikleri Topla
  const statsStmt = db.prepare(`
    SELECT COUNT(*) as actCount, COALESCE(SUM(distance_meters), 0) as totalDist
    FROM activities
    WHERE user_id = ?
  `);
  const stats = statsStmt.get(userId) as { actCount: number; totalDist: number };
  const deletedActivitiesCount = stats.actCount;
  const totalDistanceKm = Math.round((stats.totalDist / 1000) * 10) / 10;

  // 2. Anonimleştirilmiş Özet Oluştur (Tuzlu SHA-256)
  const userHash = createHash('sha256').update(`deleted_salt_${userId}`).digest('hex').substring(0, 16);
  const auditId = `audit_${randomUUID()}`;

  const insertAuditStmt = db.prepare(`
    INSERT INTO anonymized_audit_log (id, deleted_user_hash, action, total_activities_deleted, total_distance_km, created_at)
    VALUES (?, ?, 'USER_FORGOTTEN', ?, ?, ?)
  `);
  insertAuditStmt.run(auditId, userHash, deletedActivitiesCount, totalDistanceKm, new Date().toISOString());

  // 3. İlişkili Tüm Tablolardan Veriyi Sil (Foreign key cascade ve doğrudan silme)
  db.prepare('DELETE FROM assessments WHERE activity_id IN (SELECT id FROM activities WHERE user_id = ?)').run(userId);
  db.prepare('DELETE FROM user_thresholds WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM activity_streams WHERE activity_id IN (SELECT id FROM activities WHERE user_id = ?)').run(userId);
  db.prepare('DELETE FROM activities WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_metrics WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM sync_jobs WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM devices WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  return {
    success: true,
    deletedActivitiesCount,
    totalDistanceKm,
    anonymizedAuditId: auditId
  };
}
