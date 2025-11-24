import { DatabaseManager } from '../database/DatabaseManager';

/**
 * Progress Manager
 *
 * Handles study progress tracking for users across knowledge bases and sections
 */
export class ProgressManager {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  /**
   * Record or update progress for a section
   */
  recordProgress(params: RecordProgressParams): void {
    const results = this.db.query<StudyProgress>(
      `SELECT * FROM study_progress WHERE kb_id = ? AND section_id = ?`,
      [params.kbId, params.sectionId]
    );
    const existing = results.length > 0 ? results[0] : null;

    if (existing) {
      // Update existing progress
      const updates: string[] = [];
      const values: unknown[] = [];

      if (params.userScore !== undefined) {
        updates.push('user_score = ?');
        values.push(params.userScore);
      }

      if (params.aiScore !== undefined) {
        updates.push('ai_score = ?');
        values.push(params.aiScore);
      }

      if (params.timeSpent !== undefined) {
        updates.push('time_spent = time_spent + ?');
        values.push(params.timeSpent);
      }

      if (params.updateLastViewed !== false) {
        updates.push('last_viewed = CURRENT_TIMESTAMP');
      }

      if (updates.length > 0) {
        values.push(params.kbId, params.sectionId);
        this.db.execute(
          `UPDATE study_progress SET ${updates.join(', ')}
           WHERE kb_id = ? AND section_id = ?`,
          values
        );
      }
    } else {
      // Insert new progress record
      this.db.execute(
        `INSERT INTO study_progress (kb_id, section_id, user_score, ai_score, time_spent, last_viewed)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          params.kbId,
          params.sectionId,
          params.userScore ?? 0.0,
          params.aiScore ?? 0.0,
          params.timeSpent ?? 0,
        ]
      );
    }
  }

  /**
   * Get progress for a specific section
   */
  getProgress(kbId: number, sectionId: string): StudyProgress | null {
    const results = this.db.query<StudyProgress>(
      `SELECT * FROM study_progress WHERE kb_id = ? AND section_id = ?`,
      [kbId, sectionId]
    );
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Get all progress for a knowledge base
   */
  getAllProgress(kbId: number): StudyProgress[] {
    return this.db.query<StudyProgress>(
      `SELECT * FROM study_progress WHERE kb_id = ? ORDER BY last_viewed DESC`,
      [kbId]
    );
  }

  /**
   * Get progress statistics for a knowledge base
   */
  getProgressStats(kbId: number): ProgressStats {
    const allProgress = this.getAllProgress(kbId);

    if (allProgress.length === 0) {
      return {
        totalSections: 0,
        completedSections: 0,
        averageUserScore: 0,
        averageAiScore: 0,
        totalTimeSpent: 0,
        completionPercentage: 0,
      };
    }

    const completedSections = allProgress.filter(
      p => (p.user_score >= 0.7 || p.ai_score >= 0.7)
    ).length;

    const totalUserScore = allProgress.reduce((sum, p) => sum + p.user_score, 0);
    const totalAiScore = allProgress.reduce((sum, p) => sum + p.ai_score, 0);
    const totalTimeSpent = allProgress.reduce((sum, p) => sum + p.time_spent, 0);

    return {
      totalSections: allProgress.length,
      completedSections,
      averageUserScore: totalUserScore / allProgress.length,
      averageAiScore: totalAiScore / allProgress.length,
      totalTimeSpent,
      completionPercentage: (completedSections / allProgress.length) * 100,
    };
  }

  /**
   * Get recent study activity
   */
  getRecentActivity(kbId: number, limit: number = 10): StudyProgress[] {
    return this.db.query<StudyProgress>(
      `SELECT * FROM study_progress
       WHERE kb_id = ?
       ORDER BY last_viewed DESC
       LIMIT ?`,
      [kbId, limit]
    );
  }

  /**
   * Get sections that need review (low scores)
   */
  getSectionsNeedingReview(kbId: number, threshold: number = 0.7): StudyProgress[] {
    return this.db.query<StudyProgress>(
      `SELECT * FROM study_progress
       WHERE kb_id = ? AND (user_score < ? OR ai_score < ?)
       ORDER BY last_viewed DESC`,
      [kbId, threshold, threshold]
    );
  }

  /**
   * Get top performing sections
   */
  getTopSections(kbId: number, limit: number = 10): StudyProgress[] {
    return this.db.query<StudyProgress>(
      `SELECT * FROM study_progress
       WHERE kb_id = ?
       ORDER BY (user_score + ai_score) / 2.0 DESC
       LIMIT ?`,
      [kbId, limit]
    );
  }

  /**
   * Record a study session
   */
  recordStudySession(params: StudySessionParams): void {
    // Update progress for the section
    this.recordProgress({
      kbId: params.kbId,
      sectionId: params.sectionId,
      timeSpent: params.duration,
      updateLastViewed: true,
    });

    // If scores are provided, update them
    if (params.userScore !== undefined || params.aiScore !== undefined) {
      this.recordProgress({
        kbId: params.kbId,
        sectionId: params.sectionId,
        userScore: params.userScore,
        aiScore: params.aiScore,
        updateLastViewed: false,
      });
    }
  }

  /**
   * Update user self-assessment score
   */
  updateUserScore(kbId: number, sectionId: string, score: number): void {
    if (score < 0 || score > 1) {
      throw new Error('Score must be between 0 and 1');
    }

    this.recordProgress({
      kbId,
      sectionId,
      userScore: score,
      updateLastViewed: false,
    });
  }

  /**
   * Update AI-generated score
   */
  updateAiScore(kbId: number, sectionId: string, score: number): void {
    if (score < 0 || score > 1) {
      throw new Error('Score must be between 0 and 1');
    }

    this.recordProgress({
      kbId,
      sectionId,
      aiScore: score,
      updateLastViewed: false,
    });
  }

  /**
   * Get study streak (consecutive days with activity)
   */
  getStudyStreak(kbId: number): number {
    const activity = this.db.query<{ date: string }>(
      `SELECT DISTINCT DATE(last_viewed) as date
       FROM study_progress
       WHERE kb_id = ?
       ORDER BY date DESC`,
      [kbId]
    );

    if (activity.length === 0) {
      return 0;
    }

    let streak = 1;
    let currentDate = new Date(activity[0].date);

    for (let i = 1; i < activity.length; i++) {
      const previousDate = new Date(activity[i].date);
      const dayDifference = Math.floor(
        (currentDate.getTime() - previousDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (dayDifference === 1) {
        streak++;
        currentDate = previousDate;
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * Get study time distribution by section
   */
  getTimeDistribution(kbId: number): SectionTimeDistribution[] {
    return this.db.query<SectionTimeDistribution>(
      `SELECT section_id, time_spent,
              CAST(time_spent AS REAL) /
              (SELECT SUM(time_spent) FROM study_progress WHERE kb_id = ?) * 100 as percentage
       FROM study_progress
       WHERE kb_id = ? AND time_spent > 0
       ORDER BY time_spent DESC`,
      [kbId, kbId]
    );
  }

  /**
   * Get learning velocity (sections completed per week)
   */
  getLearningVelocity(kbId: number, weeks: number = 4): number {
    const weeksAgo = new Date();
    weeksAgo.setDate(weeksAgo.getDate() - (weeks * 7));

    const results = this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM study_progress
       WHERE kb_id = ? AND last_viewed >= ? AND (user_score >= 0.7 OR ai_score >= 0.7)`,
      [kbId, weeksAgo.toISOString()]
    );

    const completedSections = results.length > 0 ? results[0] : null;
    return completedSections ? completedSections.count / weeks : 0;
  }

  /**
   * Reset progress for a section
   */
  resetProgress(kbId: number, sectionId: string): void {
    this.db.execute(
      `DELETE FROM study_progress WHERE kb_id = ? AND section_id = ?`,
      [kbId, sectionId]
    );
  }

  /**
   * Reset all progress for a knowledge base
   */
  resetAllProgress(kbId: number): void {
    this.db.execute(
      `DELETE FROM study_progress WHERE kb_id = ?`,
      [kbId]
    );
  }

  /**
   * Export progress data for a knowledge base
   */
  exportProgress(kbId: number): ProgressExport {
    const progress = this.getAllProgress(kbId);
    const stats = this.getProgressStats(kbId);
    const streak = this.getStudyStreak(kbId);
    const velocity = this.getLearningVelocity(kbId);

    return {
      kbId,
      exportDate: new Date().toISOString(),
      progress,
      stats,
      streak,
      velocity,
    };
  }

  /**
   * Import progress data
   */
  importProgress(data: ProgressExport): void {
    this.db.beginTransaction();

    try {
      for (const progressItem of data.progress) {
        this.recordProgress({
          kbId: data.kbId,
          sectionId: progressItem.section_id,
          userScore: progressItem.user_score,
          aiScore: progressItem.ai_score,
          timeSpent: progressItem.time_spent,
          updateLastViewed: false,
        });
      }

      this.db.commitTransaction();
    } catch (error) {
      this.db.rollbackTransaction();
      throw new Error(`Failed to import progress: ${(error as Error).message}`);
    }
  }
}

/**
 * Types
 */

export interface StudyProgress {
  id: number;
  kb_id: number;
  section_id: string;
  user_score: number;
  ai_score: number;
  time_spent: number;
  last_viewed: string;
}

export interface RecordProgressParams {
  kbId: number;
  sectionId: string;
  userScore?: number;
  aiScore?: number;
  timeSpent?: number;
  updateLastViewed?: boolean;
}

export interface StudySessionParams {
  kbId: number;
  sectionId: string;
  duration: number; // in seconds
  userScore?: number;
  aiScore?: number;
}

export interface ProgressStats {
  totalSections: number;
  completedSections: number;
  averageUserScore: number;
  averageAiScore: number;
  totalTimeSpent: number;
  completionPercentage: number;
}

export interface SectionTimeDistribution {
  section_id: string;
  time_spent: number;
  percentage: number;
}

export interface ProgressExport {
  kbId: number;
  exportDate: string;
  progress: StudyProgress[];
  stats: ProgressStats;
  streak: number;
  velocity: number;
}
