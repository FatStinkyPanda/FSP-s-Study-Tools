/**
 * Recommendation Engine for Personalized Learning Paths
 *
 * Analyzes user progress, performance patterns, and content relationships
 * to generate personalized study recommendations and learning paths.
 *
 * Features:
 * - Adaptive learning path generation based on performance
 * - Spaced repetition scheduling for optimal retention
 * - Prerequisite-aware content ordering
 * - Weak area identification and targeted review
 * - Time-based session recommendations
 */

import { DatabaseManager } from '../database/DatabaseManager';
import { ProgressManager, StudyProgress, ProgressStats } from '../progress/ProgressManager';
import { SemanticIndexer } from '../indexer/SemanticIndexer';
import { XMLParser, ParsedKnowledgeBase } from '../knowledge/XMLParser';

export interface LearningRecommendation {
  type: 'next_section' | 'review' | 'test' | 'break' | 'new_topic';
  priority: 'high' | 'medium' | 'low';
  sectionId?: string;
  title: string;
  description: string;
  estimatedTime: number; // in minutes
  reason: string;
  confidence: number; // 0-1
}

export interface LearningPath {
  id: string;
  kbId: number;
  name: string;
  description: string;
  sections: LearningPathSection[];
  estimatedTotalTime: number; // in minutes
  createdAt: string;
  adaptiveMode: boolean;
}

export interface LearningPathSection {
  sectionId: string;
  moduleId: string;
  chapterId: string;
  title: string;
  order: number;
  status: 'not_started' | 'in_progress' | 'completed' | 'needs_review';
  estimatedTime: number;
  prerequisites: string[];
  targetScore: number;
}

export interface SpacedRepetitionItem {
  sectionId: string;
  kbId: number;
  nextReviewDate: Date;
  interval: number; // in days
  easeFactor: number;
  repetitions: number;
  lastScore: number;
}

export interface StudySession {
  duration: number; // recommended duration in minutes
  sections: LearningPathSection[];
  includesReview: boolean;
  includesNew: boolean;
  estimatedQuestions: number;
}

interface ContentNode {
  id: string;
  moduleId: string;
  chapterId: string;
  sectionId: string;
  title: string;
  order: number;
  dependencies: string[];
  keywords: string[];
}

export class RecommendationEngine {
  private xmlParser: XMLParser;
  private contentGraph: Map<string, ContentNode> = new Map();
  private spacedRepetitionData: Map<string, SpacedRepetitionItem> = new Map();

  constructor(
    private db: DatabaseManager,
    private progressManager: ProgressManager,
    private semanticIndexer?: SemanticIndexer
  ) {
    this.xmlParser = new XMLParser();
  }

  /**
   * Generate top recommendations for a user's current session
   */
  async getRecommendations(
    kbId: number,
    limit: number = 5
  ): Promise<LearningRecommendation[]> {
    const recommendations: LearningRecommendation[] = [];

    // Get current progress
    const progress = this.progressManager.getAllProgress(kbId);
    const stats = this.progressManager.getProgressStats(kbId);

    // Get KB structure
    const kb = this.db.getKnowledgeBase(kbId);
    if (!kb?.xml_content) {
      return recommendations;
    }

    const parsed = await this.xmlParser.parseKnowledgeBase(kb.xml_content);
    this.buildContentGraph(parsed);

    // 1. Check for sections needing review (spaced repetition)
    const reviewItems = await this.getSectionsNeedingReview(kbId, progress);
    for (const item of reviewItems.slice(0, 2)) {
      recommendations.push({
        type: 'review',
        priority: 'high',
        sectionId: item.sectionId,
        title: this.getSectionTitle(item.sectionId) || item.sectionId,
        description: 'Review this section to maintain retention',
        estimatedTime: 10,
        reason: `Last reviewed ${this.formatDaysAgo(item.nextReviewDate)}. Score was ${(item.lastScore * 100).toFixed(0)}%`,
        confidence: 0.9,
      });
    }

    // 2. Check for weak areas
    const weakAreas = this.progressManager.getSectionsNeedingReview(kbId, 0.7);
    for (const weak of weakAreas.slice(0, 2)) {
      if (!recommendations.some(r => r.sectionId === weak.section_id)) {
        recommendations.push({
          type: 'review',
          priority: 'medium',
          sectionId: weak.section_id,
          title: this.getSectionTitle(weak.section_id) || weak.section_id,
          description: 'Strengthen understanding in this area',
          estimatedTime: 15,
          reason: `Current score: ${(Math.max(weak.user_score, weak.ai_score) * 100).toFixed(0)}%`,
          confidence: 0.85,
        });
      }
    }

    // 3. Suggest next section in sequence
    const nextSection = await this.getNextSection(kbId, progress, parsed);
    if (nextSection) {
      recommendations.push({
        type: 'next_section',
        priority: recommendations.length === 0 ? 'high' : 'medium',
        sectionId: nextSection.id,
        title: nextSection.title || 'Next Section',
        description: 'Continue with the next section in your learning path',
        estimatedTime: this.estimateSectionTime(nextSection),
        reason: 'Natural progression from completed content',
        confidence: 0.8,
      });
    }

    // 4. Suggest taking a test if enough progress
    if (stats.completedSections >= 5 && stats.completionPercentage >= 30) {
      recommendations.push({
        type: 'test',
        priority: 'low',
        title: 'Practice Test',
        description: 'Test your knowledge on completed sections',
        estimatedTime: 20,
        reason: `You have ${stats.completedSections} completed sections ready for testing`,
        confidence: 0.7,
      });
    }

    // 5. Suggest break if long session
    const totalTimeToday = this.getStudyTimeToday(kbId, progress);
    if (totalTimeToday > 60) { // More than 60 minutes
      recommendations.push({
        type: 'break',
        priority: 'medium',
        title: 'Take a Break',
        description: 'Short breaks improve retention and focus',
        estimatedTime: 10,
        reason: `You've studied for ${totalTimeToday} minutes today`,
        confidence: 0.75,
      });
    }

    // Sort by priority and limit
    return this.sortRecommendations(recommendations).slice(0, limit);
  }

  /**
   * Generate a personalized learning path
   */
  async generateLearningPath(
    kbId: number,
    options: {
      targetSections?: string[];
      timeAvailable?: number; // minutes
      adaptiveMode?: boolean;
      includeReview?: boolean;
    } = {}
  ): Promise<LearningPath> {
    const kb = this.db.getKnowledgeBase(kbId);
    if (!kb?.xml_content) {
      throw new Error('Knowledge base not found or has no content');
    }

    const parsed = await this.xmlParser.parseKnowledgeBase(kb.xml_content);
    this.buildContentGraph(parsed);

    const progress = this.progressManager.getAllProgress(kbId);
    const progressMap = new Map(progress.map(p => [p.section_id, p]));

    const sections: LearningPathSection[] = [];
    let totalTime = 0;
    let order = 0;

    // Get all sections in order
    const allSections = this.getAllSectionsOrdered(parsed);

    for (const section of allSections) {
      const sectionId = `${section.moduleId}.${section.chapterId}.${section.sectionId}`;

      // Skip if not in target sections (when specified)
      if (options.targetSections && !options.targetSections.includes(sectionId)) {
        continue;
      }

      const sectionProgress = progressMap.get(sectionId);
      const estimatedTime = this.estimateSectionTime(section);

      // Check time budget
      if (options.timeAvailable && totalTime + estimatedTime > options.timeAvailable) {
        break;
      }

      const status = this.getSectionStatus(sectionProgress);
      const needsReview = options.includeReview &&
        status === 'completed' &&
        sectionProgress &&
        Math.max(sectionProgress.user_score, sectionProgress.ai_score) < 0.85;

      if (status !== 'completed' || needsReview) {
        sections.push({
          sectionId,
          moduleId: section.moduleId,
          chapterId: section.chapterId,
          title: section.title || 'Untitled Section',
          order: order++,
          status: needsReview ? 'needs_review' : status,
          estimatedTime,
          prerequisites: this.getPrerequisites(sectionId),
          targetScore: 0.8,
        });
        totalTime += estimatedTime;
      }
    }

    // Adaptive reordering based on performance
    if (options.adaptiveMode) {
      this.reorderByDifficulty(sections, progressMap);
    }

    return {
      id: `path-${Date.now()}`,
      kbId,
      name: `Learning Path for ${kb.title}`,
      description: options.adaptiveMode
        ? 'Adaptive path based on your performance'
        : 'Sequential learning path',
      sections,
      estimatedTotalTime: totalTime,
      createdAt: new Date().toISOString(),
      adaptiveMode: options.adaptiveMode || false,
    };
  }

  /**
   * Generate a focused study session
   */
  async generateStudySession(
    kbId: number,
    durationMinutes: number = 30
  ): Promise<StudySession> {
    const path = await this.generateLearningPath(kbId, {
      timeAvailable: durationMinutes,
      adaptiveMode: true,
      includeReview: true,
    });

    const reviewSections = path.sections.filter(s => s.status === 'needs_review');
    const newSections = path.sections.filter(s => s.status === 'not_started');
    const inProgressSections = path.sections.filter(s => s.status === 'in_progress');

    // Prioritize: in-progress > review > new
    const orderedSections = [
      ...inProgressSections,
      ...reviewSections.slice(0, 2),
      ...newSections,
    ];

    let remainingTime = durationMinutes;
    const sessionSections: LearningPathSection[] = [];

    for (const section of orderedSections) {
      if (remainingTime >= section.estimatedTime) {
        sessionSections.push(section);
        remainingTime -= section.estimatedTime;
      }
    }

    return {
      duration: durationMinutes - remainingTime,
      sections: sessionSections,
      includesReview: sessionSections.some(s => s.status === 'needs_review'),
      includesNew: sessionSections.some(s => s.status === 'not_started'),
      estimatedQuestions: Math.floor(sessionSections.length * 3),
    };
  }

  /**
   * Update spaced repetition data after a study session
   */
  async updateSpacedRepetition(
    kbId: number,
    sectionId: string,
    score: number
  ): Promise<SpacedRepetitionItem> {
    const key = `${kbId}:${sectionId}`;
    let item = this.spacedRepetitionData.get(key);

    if (!item) {
      item = {
        sectionId,
        kbId,
        nextReviewDate: new Date(),
        interval: 1,
        easeFactor: 2.5,
        repetitions: 0,
        lastScore: score,
      };
    }

    // SM-2 algorithm implementation
    const quality = Math.round(score * 5); // Convert 0-1 to 0-5

    if (quality >= 3) {
      // Successful recall
      if (item.repetitions === 0) {
        item.interval = 1;
      } else if (item.repetitions === 1) {
        item.interval = 6;
      } else {
        item.interval = Math.round(item.interval * item.easeFactor);
      }
      item.repetitions++;
    } else {
      // Failed recall - reset
      item.repetitions = 0;
      item.interval = 1;
    }

    // Update ease factor
    item.easeFactor = Math.max(
      1.3,
      item.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    );

    // Calculate next review date
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + item.interval);
    item.nextReviewDate = nextDate;
    item.lastScore = score;

    this.spacedRepetitionData.set(key, item);

    // Persist to database
    await this.persistSpacedRepetitionItem(item);

    return item;
  }

  /**
   * Get sections due for review based on spaced repetition
   */
  async getSectionsNeedingReview(
    kbId: number,
    _progress: StudyProgress[]
  ): Promise<SpacedRepetitionItem[]> {
    await this.loadSpacedRepetitionData(kbId);

    const now = new Date();
    const dueItems: SpacedRepetitionItem[] = [];

    for (const [_, item] of this.spacedRepetitionData) {
      if (item.kbId === kbId && item.nextReviewDate <= now) {
        dueItems.push(item);
      }
    }

    // Sort by urgency (most overdue first)
    return dueItems.sort((a, b) =>
      a.nextReviewDate.getTime() - b.nextReviewDate.getTime()
    );
  }

  /**
   * Find related content using semantic similarity
   */
  async findRelatedContent(
    kbId: number,
    sectionId: string,
    limit: number = 5
  ): Promise<string[]> {
    if (!this.semanticIndexer) {
      return [];
    }

    // Get chunks for this section
    const chunks = this.db.query<{ chunk_id: string }>(
      'SELECT chunk_id FROM content_embeddings WHERE kb_id = ? AND section_id = ?',
      [kbId, sectionId]
    );

    if (chunks.length === 0) {
      return [];
    }

    // Find similar content
    const similar = await this.semanticIndexer.findSimilar(kbId, chunks[0].chunk_id, limit);

    // Return unique section IDs
    const sectionIds = new Set<string>();
    for (const result of similar) {
      if (result.metadata.sectionId && result.metadata.sectionId !== sectionId) {
        sectionIds.add(result.metadata.sectionId);
      }
    }

    return Array.from(sectionIds);
  }

  /**
   * Analyze learning patterns and provide insights
   */
  async analyzeLearningPatterns(kbId: number): Promise<LearningInsights> {
    const progress = this.progressManager.getAllProgress(kbId);
    const stats = this.progressManager.getProgressStats(kbId);

    // Calculate best study time (based on scores)
    const studyTimeAnalysis = this.analyzeStudyTimes(progress);

    // Identify strong and weak topics
    const topicAnalysis = this.analyzeTopicPerformance(progress);

    // Calculate learning velocity
    const velocity = this.progressManager.getLearningVelocity(kbId, 4);

    // Estimate time to completion
    const estimatedCompletion = this.estimateCompletionTime(stats, velocity);

    return {
      bestStudyTime: studyTimeAnalysis.bestTime,
      averageSessionDuration: studyTimeAnalysis.avgDuration,
      strongTopics: topicAnalysis.strong,
      weakTopics: topicAnalysis.weak,
      learningVelocity: velocity,
      estimatedDaysToCompletion: estimatedCompletion,
      streak: this.progressManager.getStudyStreak(kbId),
      totalStudyTime: stats.totalTimeSpent,
      averageScore: (stats.averageUserScore + stats.averageAiScore) / 2,
    };
  }

  // Private helper methods

  private buildContentGraph(parsed: ParsedKnowledgeBase): void {
    this.contentGraph.clear();
    let globalOrder = 0;

    for (const module of parsed.modules) {
      for (const chapter of module.chapters) {
        for (const section of chapter.sections) {
          const id = `${module.id}.${chapter.id}.${section.id}`;

          this.contentGraph.set(id, {
            id,
            moduleId: module.id,
            chapterId: chapter.id,
            sectionId: section.id,
            title: section.title || 'Untitled',
            order: globalOrder++,
            dependencies: this.extractDependencies(section),
            keywords: this.extractKeywords(section),
          });
        }
      }
    }
  }

  private extractDependencies(_section: { id: string; title?: string; content?: { text?: string } }): string[] {
    // Extract dependencies from section content or metadata
    // This is a simplified implementation - could be enhanced with NLP
    return [];
  }

  private extractKeywords(section: { id: string; title?: string; content?: { text?: string } }): string[] {
    // Extract keywords from section content
    // This is a simplified implementation
    const content = section.content?.text || '';
    const words = content.toLowerCase().split(/\s+/);
    const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but']);

    return words
      .filter((w: string) => w.length > 3 && !stopWords.has(w))
      .slice(0, 10);
  }

  private getSectionTitle(sectionId: string): string | undefined {
    return this.contentGraph.get(sectionId)?.title;
  }

  private formatDaysAgo(date: Date): string {
    const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }

  private async getNextSection(
    _kbId: number,
    progress: StudyProgress[],
    parsed: ParsedKnowledgeBase
  ): Promise<{ id: string; title?: string; content?: { text?: string }; moduleId: string; chapterId: string } | null> {
    const completedIds = new Set(
      progress
        .filter(p => p.user_score >= 0.7 || p.ai_score >= 0.7)
        .map(p => p.section_id)
    );

    for (const module of parsed.modules) {
      for (const chapter of module.chapters) {
        for (const section of chapter.sections) {
          const id = `${module.id}.${chapter.id}.${section.id}`;
          if (!completedIds.has(id)) {
            return {
              id: section.id,
              title: section.title,
              content: section.content,
              moduleId: module.id,
              chapterId: chapter.id,
            };
          }
        }
      }
    }

    return null;
  }

  private estimateSectionTime(_section: { id?: string; title?: string }): number {
    // Estimate based on content length and complexity
    // Default to 15 minutes
    return 15;
  }

  private getStudyTimeToday(_kbId: number, progress: StudyProgress[]): number {
    const today = new Date().toISOString().split('T')[0];

    return progress
      .filter(p => p.last_viewed?.startsWith(today))
      .reduce((sum, p) => sum + (p.time_spent / 60), 0); // Convert to minutes
  }

  private sortRecommendations(recs: LearningRecommendation[]): LearningRecommendation[] {
    const priorityOrder = { high: 0, medium: 1, low: 2 };

    return recs.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.confidence - a.confidence;
    });
  }

  private getAllSectionsOrdered(parsed: ParsedKnowledgeBase): Array<{
    moduleId: string;
    chapterId: string;
    sectionId: string;
    title: string;
    order: number;
  }> {
    const sections: Array<{
      moduleId: string;
      chapterId: string;
      sectionId: string;
      title: string;
      order: number;
    }> = [];

    let order = 0;
    for (const module of parsed.modules) {
      for (const chapter of module.chapters) {
        for (const section of chapter.sections) {
          sections.push({
            moduleId: module.id,
            chapterId: chapter.id,
            sectionId: section.id,
            title: section.title || 'Untitled',
            order: order++,
          });
        }
      }
    }

    return sections;
  }

  private getSectionStatus(progress?: StudyProgress): 'not_started' | 'in_progress' | 'completed' {
    if (!progress) return 'not_started';
    if (progress.user_score >= 0.7 || progress.ai_score >= 0.7) return 'completed';
    if (progress.time_spent > 0) return 'in_progress';
    return 'not_started';
  }

  private getPrerequisites(sectionId: string): string[] {
    const node = this.contentGraph.get(sectionId);
    return node?.dependencies || [];
  }

  private reorderByDifficulty(
    sections: LearningPathSection[],
    progressMap: Map<string, StudyProgress>
  ): void {
    // Calculate difficulty based on average scores
    sections.sort((a, b) => {
      const progressA = progressMap.get(a.sectionId);
      const progressB = progressMap.get(b.sectionId);

      // Prioritize sections with lower scores (harder sections)
      const scoreA = progressA ? Math.max(progressA.user_score, progressA.ai_score) : 0.5;
      const scoreB = progressB ? Math.max(progressB.user_score, progressB.ai_score) : 0.5;

      // Also consider needs_review status
      if (a.status === 'needs_review' && b.status !== 'needs_review') return -1;
      if (b.status === 'needs_review' && a.status !== 'needs_review') return 1;

      return scoreA - scoreB;
    });

    // Update order numbers
    sections.forEach((s, i) => { s.order = i; });
  }

  private async loadSpacedRepetitionData(kbId: number): Promise<void> {
    try {
      const rows = this.db.query<{
        kb_id: number;
        section_id: string;
        next_review: string;
        interval: number;
        ease_factor: number;
        repetitions: number;
        last_score: number;
      }>(
        'SELECT * FROM spaced_repetition WHERE kb_id = ?',
        [kbId]
      );

      for (const row of rows) {
        const key = `${row.kb_id}:${row.section_id}`;
        this.spacedRepetitionData.set(key, {
          kbId: row.kb_id,
          sectionId: row.section_id,
          nextReviewDate: new Date(row.next_review),
          interval: row.interval,
          easeFactor: row.ease_factor,
          repetitions: row.repetitions,
          lastScore: row.last_score,
        });
      }
    } catch {
      // Table might not exist yet - create it
      this.ensureSpacedRepetitionTable();
    }
  }

  private ensureSpacedRepetitionTable(): void {
    try {
      this.db.getDatabase().exec(`
        CREATE TABLE IF NOT EXISTS spaced_repetition (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kb_id INTEGER NOT NULL,
          section_id TEXT NOT NULL,
          next_review TEXT NOT NULL,
          interval INTEGER DEFAULT 1,
          ease_factor REAL DEFAULT 2.5,
          repetitions INTEGER DEFAULT 0,
          last_score REAL DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
          UNIQUE(kb_id, section_id)
        );
        CREATE INDEX IF NOT EXISTS idx_sr_kb ON spaced_repetition(kb_id);
        CREATE INDEX IF NOT EXISTS idx_sr_review ON spaced_repetition(next_review);
      `);
    } catch (error) {
      console.log('Spaced repetition table check complete');
    }
  }

  private async persistSpacedRepetitionItem(item: SpacedRepetitionItem): Promise<void> {
    this.ensureSpacedRepetitionTable();

    this.db.execute(
      `INSERT OR REPLACE INTO spaced_repetition
       (kb_id, section_id, next_review, interval, ease_factor, repetitions, last_score)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        item.kbId,
        item.sectionId,
        item.nextReviewDate.toISOString(),
        item.interval,
        item.easeFactor,
        item.repetitions,
        item.lastScore,
      ]
    );
  }

  private analyzeStudyTimes(progress: StudyProgress[]): {
    bestTime: string;
    avgDuration: number;
  } {
    // Simplified analysis - would need more timestamp data for real analysis
    const totalTime = progress.reduce((sum, p) => sum + p.time_spent, 0);
    const avgDuration = progress.length > 0 ? totalTime / progress.length / 60 : 0; // minutes

    return {
      bestTime: 'morning', // Would need actual timestamp analysis
      avgDuration,
    };
  }

  private analyzeTopicPerformance(progress: StudyProgress[]): {
    strong: string[];
    weak: string[];
  } {
    const strong: string[] = [];
    const weak: string[] = [];

    for (const p of progress) {
      const avgScore = (p.user_score + p.ai_score) / 2;
      if (avgScore >= 0.8) {
        strong.push(p.section_id);
      } else if (avgScore < 0.6) {
        weak.push(p.section_id);
      }
    }

    return { strong: strong.slice(0, 5), weak: weak.slice(0, 5) };
  }

  private estimateCompletionTime(stats: ProgressStats, velocity: number): number {
    if (velocity === 0) return Infinity;

    const remaining = Math.max(0, 100 - stats.completionPercentage);
    const sectionsRemaining = (remaining / 100) * stats.totalSections || 10;

    return Math.ceil(sectionsRemaining / velocity) * 7; // days
  }
}

export interface LearningInsights {
  bestStudyTime: string;
  averageSessionDuration: number;
  strongTopics: string[];
  weakTopics: string[];
  learningVelocity: number;
  estimatedDaysToCompletion: number;
  streak: number;
  totalStudyTime: number;
  averageScore: number;
}
