import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface UserFeedbackInput {
  activityId: string;
  userId: string;
  feedbackTag: 'ACTUALLY_EASY' | 'ACTUALLY_HARD' | 'GROUP_RUN';
  perceivedRpe?: number;
  note?: string;
}

export interface SystematicShiftReport {
  shiftDetected: boolean;
  direction?: 'AET_OVERESTIMATED' | 'AET_UNDERESTIMATED';
  discrepancyRatio: number;
  reviewedActivitiesCount: number;
  affectedUsersCount: number;
  recommendation: string;
}

/**
 * BÖLÜM 7.5: Kullanıcının geriye dönük etiketleme ve yer gerçeği beyanı kaydı.
 */
export function recordUserFeedback(db: DatabaseSync, input: UserFeedbackInput): string {
  const id = `fb_${randomUUID()}`;
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO user_feedbacks (id, activity_id, user_id, feedback_tag, perceived_rpe, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, input.activityId, input.userId, input.feedbackTag, input.perceivedRpe ?? null, input.note ?? null, now);

  return id;
}

/**
 * BÖLÜM 7.6: Sistematik Sapma Dedektörü (SYSTEMATIC_COHORT_SHIFT).
 * Eğer motorun "ACCORDING_TO_PLAN" dediği koşularda kullanıcıların >= %20'si
 * "ACTUALLY_HARD" beyanında bulunuyorsa bu rastgele bir hata değil,
 * modelin sistematik olarak AeT'yi yüksek tahmin ettiğinin (Tip II hata) kanıtıdır.
 */
export function detectSystematicCohortShift(db: DatabaseSync): SystematicShiftReport {
  // ACCORDING_TO_PLAN hükmü almış aktiviteler üzerindeki geri bildirimleri sorgula
  const query = db.prepare(`
    SELECT 
      f.feedback_tag,
      COUNT(DISTINCT f.user_id) as user_count,
      COUNT(f.id) as feedback_count
    FROM user_feedbacks f
    JOIN assessments a ON a.activity_id = f.activity_id
    WHERE a.verdict = 'ACCORDING_TO_PLAN'
    GROUP BY f.feedback_tag
  `).all() as Array<{ feedback_tag: string; user_count: number; feedback_count: number }>;

  const totalReviewed = query.reduce((sum, r) => sum + r.feedback_count, 0);
  const hardRow = query.find(r => r.feedback_tag === 'ACTUALLY_HARD');
  const hardCount = hardRow?.feedback_count ?? 0;
  const affectedUsers = hardRow?.user_count ?? 0;

  if (totalReviewed < 5) {
    return {
      shiftDetected: false,
      discrepancyRatio: 0,
      reviewedActivitiesCount: totalReviewed,
      affectedUsersCount: 0,
      recommendation: 'Yetersiz geri bildirim verisi; izleme devam ediyor.'
    };
  }

  const discrepancyRatio = Math.round((hardCount / totalReviewed) * 1000) / 10;

  if (discrepancyRatio >= 20.0 && affectedUsers >= 3) {
    return {
      shiftDetected: true,
      direction: 'AET_OVERESTIMATED',
      discrepancyRatio,
      reviewedActivitiesCount: totalReviewed,
      affectedUsersCount: affectedUsers,
      recommendation: 'Sistematik AeT aşırı tahmin yanlılığı (Tip II hata) tespit edildi! AET_RATIO_OF_LTHR katsayısı acilen düşürülmelidir.'
    };
  }

  return {
    shiftDetected: false,
    discrepancyRatio,
    reviewedActivitiesCount: totalReviewed,
    affectedUsersCount: affectedUsers,
    recommendation: 'Sistematik sapma tespit edilmedi; model tolerans sınırları içinde.'
  };
}
