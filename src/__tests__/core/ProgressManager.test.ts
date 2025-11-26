/**
 * Unit tests for ProgressManager
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from '../../core/database/DatabaseManager';
import { ProgressManager, StudyProgress, ProgressStats } from '../../core/progress/ProgressManager';

describe('ProgressManager', () => {
  let db: DatabaseManager;
  let progressManager: ProgressManager;
  let testDbPath: string;
  let testKbId: number;

  beforeEach(async () => {
    // Create a unique test database path
    testDbPath = path.join(os.tmpdir(), `test-progress-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    db = new DatabaseManager(testDbPath);
    await db.initialize();

    // Create a test knowledge base
    testKbId = db.createKnowledgeBase({
      uuid: '12345678-1234-1234-1234-123456789012',
      title: 'Progress Test KB',
      xml_content: '<knowledge_base><modules></modules></knowledge_base>',
    });

    progressManager = new ProgressManager(db);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(`${testDbPath}-wal`)) {
      fs.unlinkSync(`${testDbPath}-wal`);
    }
    if (fs.existsSync(`${testDbPath}-shm`)) {
      fs.unlinkSync(`${testDbPath}-shm`);
    }
  });

  describe('recordProgress', () => {
    it('should create new progress record', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.75,
        aiScore: 0.80,
        timeSpent: 300,
      });

      const progress = progressManager.getProgress(testKbId, 'section-1');
      expect(progress).not.toBeNull();
      expect(progress?.user_score).toBe(0.75);
      expect(progress?.ai_score).toBe(0.80);
      expect(progress?.time_spent).toBe(300);
    });

    it('should update existing progress record', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.50,
        timeSpent: 100,
      });

      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.80,
        timeSpent: 200,
      });

      const progress = progressManager.getProgress(testKbId, 'section-1');
      expect(progress?.user_score).toBe(0.80);
      expect(progress?.time_spent).toBe(300); // 100 + 200
    });

    it('should use default values when not provided', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
      });

      const progress = progressManager.getProgress(testKbId, 'section-1');
      expect(progress?.user_score).toBe(0.0);
      expect(progress?.ai_score).toBe(0.0);
      expect(progress?.time_spent).toBe(0);
    });

    it('should update last_viewed timestamp', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
      });

      const progress = progressManager.getProgress(testKbId, 'section-1');
      expect(progress?.last_viewed).toBeDefined();
    });

    it('should not update last_viewed when updateLastViewed is false', () => {
      // First create a record
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.5,
      });

      const initialProgress = progressManager.getProgress(testKbId, 'section-1');
      const initialLastViewed = initialProgress?.last_viewed;

      // Wait a bit and update without touching last_viewed
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.8,
        updateLastViewed: false,
      });

      const updatedProgress = progressManager.getProgress(testKbId, 'section-1');
      expect(updatedProgress?.user_score).toBe(0.8);
      // last_viewed should not change
      expect(updatedProgress?.last_viewed).toBe(initialLastViewed);
    });
  });

  describe('getProgress', () => {
    it('should return null for non-existent progress', () => {
      const progress = progressManager.getProgress(testKbId, 'nonexistent-section');
      expect(progress).toBeNull();
    });

    it('should return progress for existing section', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.75,
      });

      const progress = progressManager.getProgress(testKbId, 'section-1');
      expect(progress).not.toBeNull();
      expect(progress?.section_id).toBe('section-1');
    });
  });

  describe('getAllProgress', () => {
    it('should return empty array for KB with no progress', () => {
      const progress = progressManager.getAllProgress(testKbId);
      expect(progress).toEqual([]);
    });

    it('should return all progress records for KB', () => {
      progressManager.recordProgress({ kbId: testKbId, sectionId: 'section-1' });
      progressManager.recordProgress({ kbId: testKbId, sectionId: 'section-2' });
      progressManager.recordProgress({ kbId: testKbId, sectionId: 'section-3' });

      const progress = progressManager.getAllProgress(testKbId);
      expect(progress.length).toBe(3);
    });

    it('should order by last_viewed descending', () => {
      progressManager.recordProgress({ kbId: testKbId, sectionId: 'section-1' });
      progressManager.recordProgress({ kbId: testKbId, sectionId: 'section-2' });
      progressManager.recordProgress({ kbId: testKbId, sectionId: 'section-3' });

      const progress = progressManager.getAllProgress(testKbId);
      // Most recently viewed should be first
      expect(progress[0].section_id).toBe('section-3');
    });
  });

  describe('getProgressStats', () => {
    it('should return zero stats for empty progress', () => {
      const stats = progressManager.getProgressStats(testKbId);

      expect(stats.totalSections).toBe(0);
      expect(stats.completedSections).toBe(0);
      expect(stats.averageUserScore).toBe(0);
      expect(stats.averageAiScore).toBe(0);
      expect(stats.totalTimeSpent).toBe(0);
      expect(stats.completionPercentage).toBe(0);
    });

    it('should calculate stats correctly', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.80,
        aiScore: 0.85,
        timeSpent: 300,
      });
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-2',
        userScore: 0.60,
        aiScore: 0.65,
        timeSpent: 200,
      });

      const stats = progressManager.getProgressStats(testKbId);

      expect(stats.totalSections).toBe(2);
      expect(stats.completedSections).toBe(1); // Only section-1 has score >= 0.7
      expect(stats.averageUserScore).toBe(0.70); // (0.80 + 0.60) / 2
      expect(stats.averageAiScore).toBe(0.75); // (0.85 + 0.65) / 2
      expect(stats.totalTimeSpent).toBe(500);
      expect(stats.completionPercentage).toBe(50); // 1 / 2 * 100
    });

    it('should count section as completed if either score >= 0.7', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.75,
        aiScore: 0.50,
      });
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-2',
        userScore: 0.40,
        aiScore: 0.80,
      });

      const stats = progressManager.getProgressStats(testKbId);
      expect(stats.completedSections).toBe(2);
    });
  });

  describe('getRecentActivity', () => {
    it('should return limited results', () => {
      for (let i = 0; i < 20; i++) {
        progressManager.recordProgress({
          kbId: testKbId,
          sectionId: `section-${i}`,
        });
      }

      const recent = progressManager.getRecentActivity(testKbId, 5);
      expect(recent.length).toBe(5);
    });

    it('should return empty array when no activity', () => {
      const recent = progressManager.getRecentActivity(testKbId);
      expect(recent).toEqual([]);
    });
  });

  describe('getSectionsNeedingReview', () => {
    it('should return sections with low scores', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-good',
        userScore: 0.85,
        aiScore: 0.90,
      });
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-bad',
        userScore: 0.40,
        aiScore: 0.50,
      });

      const needsReview = progressManager.getSectionsNeedingReview(testKbId, 0.7);

      expect(needsReview.length).toBe(1);
      expect(needsReview[0].section_id).toBe('section-bad');
    });

    it('should use custom threshold', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.75,
        aiScore: 0.75,
      });

      const withDefault = progressManager.getSectionsNeedingReview(testKbId, 0.7);
      const withHigher = progressManager.getSectionsNeedingReview(testKbId, 0.8);

      expect(withDefault.length).toBe(0);
      expect(withHigher.length).toBe(1);
    });
  });

  describe('getTopSections', () => {
    it('should return sections ordered by average score', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-low',
        userScore: 0.40,
        aiScore: 0.50,
      });
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-high',
        userScore: 0.90,
        aiScore: 0.95,
      });
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-mid',
        userScore: 0.70,
        aiScore: 0.75,
      });

      const top = progressManager.getTopSections(testKbId, 3);

      expect(top[0].section_id).toBe('section-high');
      expect(top[1].section_id).toBe('section-mid');
      expect(top[2].section_id).toBe('section-low');
    });

    it('should respect limit', () => {
      for (let i = 0; i < 20; i++) {
        progressManager.recordProgress({
          kbId: testKbId,
          sectionId: `section-${i}`,
          userScore: i / 20,
        });
      }

      const top = progressManager.getTopSections(testKbId, 5);
      expect(top.length).toBe(5);
    });
  });

  describe('recordStudySession', () => {
    it('should update time spent', () => {
      progressManager.recordStudySession({
        kbId: testKbId,
        sectionId: 'section-1',
        duration: 600, // 10 minutes
      });

      const progress = progressManager.getProgress(testKbId, 'section-1');
      expect(progress?.time_spent).toBe(600);
    });

    it('should accumulate time across sessions', () => {
      progressManager.recordStudySession({
        kbId: testKbId,
        sectionId: 'section-1',
        duration: 300,
      });
      progressManager.recordStudySession({
        kbId: testKbId,
        sectionId: 'section-1',
        duration: 400,
      });

      const progress = progressManager.getProgress(testKbId, 'section-1');
      expect(progress?.time_spent).toBe(700);
    });

    it('should update scores if provided', () => {
      progressManager.recordStudySession({
        kbId: testKbId,
        sectionId: 'section-1',
        duration: 300,
        userScore: 0.85,
        aiScore: 0.90,
      });

      const progress = progressManager.getProgress(testKbId, 'section-1');
      expect(progress?.user_score).toBe(0.85);
      expect(progress?.ai_score).toBe(0.90);
    });
  });

  describe('updateUserScore', () => {
    it('should update user score', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.5,
      });

      progressManager.updateUserScore(testKbId, 'section-1', 0.9);

      const progress = progressManager.getProgress(testKbId, 'section-1');
      expect(progress?.user_score).toBe(0.9);
    });

    it('should throw for invalid score', () => {
      expect(() => {
        progressManager.updateUserScore(testKbId, 'section-1', 1.5);
      }).toThrow('Score must be between 0 and 1');

      expect(() => {
        progressManager.updateUserScore(testKbId, 'section-1', -0.1);
      }).toThrow('Score must be between 0 and 1');
    });
  });

  describe('updateAiScore', () => {
    it('should update AI score', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        aiScore: 0.5,
      });

      progressManager.updateAiScore(testKbId, 'section-1', 0.95);

      const progress = progressManager.getProgress(testKbId, 'section-1');
      expect(progress?.ai_score).toBe(0.95);
    });

    it('should throw for invalid score', () => {
      expect(() => {
        progressManager.updateAiScore(testKbId, 'section-1', 1.5);
      }).toThrow('Score must be between 0 and 1');
    });
  });

  describe('getStudyStreak', () => {
    it('should return 0 for no activity', () => {
      const streak = progressManager.getStudyStreak(testKbId);
      expect(streak).toBe(0);
    });

    it('should return 1 for single day activity', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
      });

      const streak = progressManager.getStudyStreak(testKbId);
      expect(streak).toBe(1);
    });
  });

  describe('getTimeDistribution', () => {
    it('should return time distribution by section', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        timeSpent: 600,
      });
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-2',
        timeSpent: 400,
      });

      const distribution = progressManager.getTimeDistribution(testKbId);

      expect(distribution.length).toBe(2);
      expect(distribution[0].section_id).toBe('section-1'); // Higher time first
      expect(distribution[0].percentage).toBe(60);
      expect(distribution[1].percentage).toBe(40);
    });

    it('should exclude sections with zero time', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        timeSpent: 300,
      });
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-2',
        timeSpent: 0,
      });

      const distribution = progressManager.getTimeDistribution(testKbId);
      expect(distribution.length).toBe(1);
    });
  });

  describe('getLearningVelocity', () => {
    it('should return 0 for no completed sections', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.5, // Not completed
      });

      const velocity = progressManager.getLearningVelocity(testKbId, 4);
      expect(velocity).toBe(0);
    });

    it('should calculate velocity for completed sections', () => {
      // Record multiple completed sections
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.8,
      });
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-2',
        userScore: 0.75,
      });

      const velocity = progressManager.getLearningVelocity(testKbId, 1);
      expect(velocity).toBe(2); // 2 sections / 1 week
    });
  });

  describe('resetProgress', () => {
    it('should reset progress for a section', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.8,
      });

      progressManager.resetProgress(testKbId, 'section-1');

      const progress = progressManager.getProgress(testKbId, 'section-1');
      expect(progress).toBeNull();
    });

    it('should not affect other sections', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.8,
      });
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-2',
        userScore: 0.9,
      });

      progressManager.resetProgress(testKbId, 'section-1');

      const section2 = progressManager.getProgress(testKbId, 'section-2');
      expect(section2).not.toBeNull();
    });
  });

  describe('resetAllProgress', () => {
    it('should reset all progress for KB', () => {
      progressManager.recordProgress({ kbId: testKbId, sectionId: 'section-1' });
      progressManager.recordProgress({ kbId: testKbId, sectionId: 'section-2' });
      progressManager.recordProgress({ kbId: testKbId, sectionId: 'section-3' });

      progressManager.resetAllProgress(testKbId);

      const allProgress = progressManager.getAllProgress(testKbId);
      expect(allProgress.length).toBe(0);
    });
  });

  describe('exportProgress', () => {
    it('should export progress data', () => {
      progressManager.recordProgress({
        kbId: testKbId,
        sectionId: 'section-1',
        userScore: 0.8,
        aiScore: 0.85,
        timeSpent: 300,
      });

      const exported = progressManager.exportProgress(testKbId);

      expect(exported.kbId).toBe(testKbId);
      expect(exported.exportDate).toBeDefined();
      expect(exported.progress.length).toBe(1);
      expect(exported.stats).toBeDefined();
      expect(exported.streak).toBeDefined();
      expect(exported.velocity).toBeDefined();
    });
  });

  describe('importProgress', () => {
    it('should import progress data', () => {
      const importData = {
        kbId: testKbId,
        exportDate: new Date().toISOString(),
        progress: [
          {
            id: 1,
            kb_id: testKbId,
            section_id: 'section-1',
            user_score: 0.8,
            ai_score: 0.85,
            time_spent: 300,
            last_viewed: new Date().toISOString(),
          },
          {
            id: 2,
            kb_id: testKbId,
            section_id: 'section-2',
            user_score: 0.7,
            ai_score: 0.75,
            time_spent: 200,
            last_viewed: new Date().toISOString(),
          },
        ],
        stats: {
          totalSections: 2,
          completedSections: 2,
          averageUserScore: 0.75,
          averageAiScore: 0.80,
          totalTimeSpent: 500,
          completionPercentage: 100,
        },
        streak: 5,
        velocity: 2.5,
      };

      progressManager.importProgress(importData);

      const allProgress = progressManager.getAllProgress(testKbId);
      expect(allProgress.length).toBe(2);
    });

    it('should handle import errors with rollback', () => {
      // Create invalid import data that would cause an error
      const invalidData = {
        kbId: 99999, // Non-existent KB (will fail foreign key)
        exportDate: new Date().toISOString(),
        progress: [
          {
            id: 1,
            kb_id: 99999,
            section_id: 'section-1',
            user_score: 0.8,
            ai_score: 0.85,
            time_spent: 300,
            last_viewed: new Date().toISOString(),
          },
        ],
        stats: {} as ProgressStats,
        streak: 0,
        velocity: 0,
      };

      expect(() => {
        progressManager.importProgress(invalidData);
      }).toThrow('Failed to import progress');
    });
  });
});
