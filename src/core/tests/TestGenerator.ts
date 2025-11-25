import { DatabaseManager } from '../database/DatabaseManager';
import { AIManager } from '../ai/AIManager';
import { XMLParser } from '../knowledge/XMLParser';
import { SectionContent } from '../../shared/types';
import { SettingsManager } from '../settings/SettingsManager';
import { ProgressManager, StudyProgress } from '../progress/ProgressManager';

/**
 * Test Generator
 *
 * Generates practice tests from knowledge base content
 * Supports both manual and AI-generated questions
 */
export class TestGenerator {
  private db: DatabaseManager;
  private aiManager: AIManager | null;
  private xmlParser: XMLParser;
  private settingsManager: SettingsManager | null;
  private progressManager: ProgressManager | null;

  constructor(db: DatabaseManager, aiManager?: AIManager, settingsManager?: SettingsManager, progressManager?: ProgressManager) {
    this.db = db;
    this.aiManager = aiManager || null;
    this.settingsManager = settingsManager || null;
    this.progressManager = progressManager || null;
    this.xmlParser = new XMLParser();
  }

  /**
   * Create a new practice test
   */
  createTest(params: CreateTestParams): number {
    const questionsJson = JSON.stringify(params.questions);

    this.db.execute(
      `INSERT INTO practice_tests (kb_id, title, type, questions)
       VALUES (?, ?, ?, ?)`,
      [params.kbId, params.title, params.type, questionsJson]
    );

    const results = this.db.query<{ id: number }>(
      `SELECT last_insert_rowid() as id`
    );

    return results[0].id;
  }

  /**
   * Get a practice test by ID
   */
  getTest(testId: number): PracticeTest | null {
    const results = this.db.query<PracticeTestRow>(
      `SELECT * FROM practice_tests WHERE id = ?`,
      [testId]
    );

    if (results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id,
      kbId: row.kb_id,
      title: row.title,
      type: row.type,
      questions: JSON.parse(row.questions),
      createdAt: row.created_at,
    };
  }

  /**
   * Get all tests for a knowledge base
   */
  getTestsForKB(kbId: number): PracticeTest[] {
    const results = this.db.query<PracticeTestRow>(
      `SELECT * FROM practice_tests WHERE kb_id = ? ORDER BY created_at DESC`,
      [kbId]
    );

    return results.map(row => ({
      id: row.id,
      kbId: row.kb_id,
      title: row.title,
      type: row.type,
      questions: JSON.parse(row.questions),
      createdAt: row.created_at,
    }));
  }

  /**
   * Update a practice test
   */
  updateTest(testId: number, updates: UpdateTestParams): void {
    const setParts: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) {
      setParts.push('title = ?');
      values.push(updates.title);
    }

    if (updates.questions !== undefined) {
      setParts.push('questions = ?');
      values.push(JSON.stringify(updates.questions));
    }

    if (setParts.length > 0) {
      values.push(testId);
      this.db.execute(
        `UPDATE practice_tests SET ${setParts.join(', ')} WHERE id = ?`,
        values
      );
    }
  }

  /**
   * Delete a practice test
   */
  deleteTest(testId: number): void {
    this.db.execute(`DELETE FROM practice_tests WHERE id = ?`, [testId]);
  }

  /**
   * Generate questions from KB content using AI
   * Supports selective generation by module, chapter, or section IDs
   * Can limit total questions with totalQuestions param
   */
  async generateQuestionsFromKB(params: GenerateQuestionsParams): Promise<TestQuestion[]> {
    if (!this.aiManager) {
      throw new Error('AI Manager not configured. Cannot generate questions.');
    }

    // Get KB content
    const kbResults = this.db.query<{ xml_content: string; title: string }>(
      `SELECT xml_content, title FROM knowledge_bases WHERE id = ?`,
      [params.kbId]
    );

    if (kbResults.length === 0) {
      throw new Error(`Knowledge base not found: ${params.kbId}`);
    }

    const xmlContent = kbResults[0].xml_content;

    if (!xmlContent || xmlContent.trim().length === 0) {
      throw new Error('Knowledge base has no content. Please add content before generating questions.');
    }

    // Extract sections from XML with filters
    const sections = await this.extractSections(xmlContent, {
      moduleIds: params.moduleIds,
      chapterIds: params.chapterIds,
      sectionIds: params.sectionIds,
    });

    if (sections.length === 0) {
      throw new Error('No sections with sufficient content found. Please add more detailed content to your knowledge base sections (at least 50 characters per section).');
    }

    // Apply adaptive mode sorting if enabled
    let sortedSections = sections;
    if (params.adaptiveMode && params.adaptiveMode !== 'none' && this.progressManager) {
      sortedSections = this.applySectionPrioritization(sections, params.kbId, params.adaptiveMode);
    }

    // Calculate questions per section based on total limit
    let questionsPerSection = params.questionsPerSection || 5;
    if (params.totalQuestions && sortedSections.length > 0) {
      // Distribute questions evenly across sections, minimum 1 per section
      questionsPerSection = Math.max(1, Math.ceil(params.totalQuestions / sortedSections.length));
    }

    // Generate questions using AI
    const questions: TestQuestion[] = [];
    const difficulty = params.difficulty || 'medium';

    for (const section of sortedSections) {
      // Check if we've reached the total question limit
      if (params.totalQuestions && questions.length >= params.totalQuestions) {
        break;
      }

      // Calculate how many more questions we can generate
      const remainingSlots = params.totalQuestions
        ? Math.max(1, params.totalQuestions - questions.length)
        : questionsPerSection;
      const questionsToGenerate = Math.min(questionsPerSection, remainingSlots);

      const sectionQuestions = await this.generateQuestionsForSection(
        section,
        questionsToGenerate,
        difficulty
      );
      questions.push(...sectionQuestions);
    }

    // Trim to exact total if specified
    if (params.totalQuestions && questions.length > params.totalQuestions) {
      return questions.slice(0, params.totalQuestions);
    }

    return questions;
  }

  /**
   * Extract sections from XML content
   * Only returns sections with substantial content (>50 chars)
   * Supports filtering by moduleIds, chapterIds, or sectionIds
   */
  private async extractSections(
    xmlContent: string,
    params?: {
      moduleIds?: string[];
      chapterIds?: string[];
      sectionIds?: string[];
    }
  ): Promise<KBSection[]> {
    try {
      const parsed = await this.xmlParser.parseKnowledgeBase(xmlContent);
      const sections: KBSection[] = [];
      let totalSectionsChecked = 0;
      let sectionsWithContent = 0;

      const { moduleIds, chapterIds, sectionIds } = params || {};

      // Extract sections from parsed knowledge base
      for (const module of parsed.modules) {
        const moduleId = module.id;
        const moduleTitle = module.title;

        // Skip this module if moduleIds filter is set and this module is not included
        if (moduleIds && moduleIds.length > 0 && !moduleIds.includes(moduleId)) {
          continue;
        }

        for (const chapter of module.chapters) {
          const chapterId = chapter.id;
          const chapterTitle = chapter.title;
          const fullChapterId = `${moduleId}.${chapterId}`;

          // Skip this chapter if chapterIds filter is set and this chapter is not included
          if (chapterIds && chapterIds.length > 0 && !chapterIds.includes(fullChapterId)) {
            continue;
          }

          for (const section of chapter.sections) {
            totalSectionsChecked++;
            const sectionIdPart = section.id;
            const sectionTitle = section.title;
            const fullId = `${moduleId}.${chapterId}.${sectionIdPart}`;

            // Filter by sectionIds if provided (most specific filter)
            if (sectionIds && sectionIds.length > 0 && !sectionIds.includes(fullId)) {
              continue;
            }

            // Extract text content from section
            const content = this.extractSectionContent(section.content);
            const trimmedContent = content.trim();

            // Only include sections with substantial content (more than 50 chars)
            // This prevents trying to generate questions from empty or stub sections
            if (trimmedContent.length > 50) {
              sectionsWithContent++;
              sections.push({
                id: fullId,
                moduleId: moduleId,
                chapterId: chapterId,
                sectionIdPart: sectionIdPart,
                title: `${moduleTitle} > ${chapterTitle} > ${sectionTitle}`,
                content: trimmedContent,
              });
            }
          }
        }
      }

      return sections;
    } catch (error) {
      throw new Error(`Failed to parse KB XML: ${(error as Error).message}`);
    }
  }

  /**
   * Extract text content from section content
   * Handles multiple content formats: text, markdown, html, and structured elements
   */
  private extractSectionContent(content: SectionContent): string {
    const parts: string[] = [];

    // Use text content (primary)
    if (content.text) {
      parts.push(content.text);
    }

    // Fall back to markdown if no text
    if (!content.text && content.markdown) {
      parts.push(content.markdown);
    }

    // Fall back to HTML if no text or markdown
    if (!content.text && !content.markdown && content.html) {
      // Strip HTML tags for plain text
      parts.push(content.html.replace(/<[^>]*>/g, ''));
    }

    // Extract text from structured elements (PDFs are often stored this way)
    if (parts.length === 0 && content.elements && content.elements.length > 0) {
      for (const element of content.elements) {
        // Extract from headings, paragraphs, code blocks, blockquotes
        if (element.content) {
          parts.push(element.content);
        }
        // Extract from lists
        if (element.items && element.items.length > 0) {
          parts.push(element.items.join('\n'));
        }
        // Extract from images (alt text or OCR)
        if (element.alt) {
          parts.push(element.alt);
        }
        // Extract from tables
        if (element.rows && element.rows.length > 0) {
          // Add table headers
          if (element.headers && element.headers.length > 0) {
            parts.push(element.headers.join(' | '));
          }
          // Add table rows
          for (const row of element.rows) {
            parts.push(row.join(' | '));
          }
        }
      }
    }

    // Extract text from images (OCR text)
    if (parts.length === 0 && content.images && content.images.length > 0) {
      for (const image of content.images) {
        if (image.ocr_text) {
          parts.push(image.ocr_text);
        }
      }
    }

    return parts.join('\n\n').trim();
  }

  /**
   * Apply section prioritization based on adaptive mode
   * - low_scores: Prioritize sections with lowest user/AI scores (below 70%)
   * - least_studied: Prioritize sections with least study time
   */
  private applySectionPrioritization(
    sections: KBSection[],
    kbId: number,
    adaptiveMode: 'low_scores' | 'least_studied'
  ): KBSection[] {
    if (!this.progressManager) {
      return sections;
    }

    // Get all progress data for this KB
    const progressData = this.progressManager.getAllProgress(kbId);

    // Create a map for quick lookup
    const progressMap = new Map<string, StudyProgress>();
    for (const progress of progressData) {
      progressMap.set(progress.section_id, progress);
    }

    // Sort sections based on adaptive mode
    const sortedSections = [...sections].sort((a, b) => {
      const progressA = progressMap.get(a.id);
      const progressB = progressMap.get(b.id);

      if (adaptiveMode === 'low_scores') {
        // Sections with no progress come first (never studied)
        if (!progressA && !progressB) return 0;
        if (!progressA) return -1; // No progress = highest priority
        if (!progressB) return 1;

        // Sort by average score (lower = higher priority)
        const avgScoreA = (progressA.user_score + progressA.ai_score) / 2;
        const avgScoreB = (progressB.user_score + progressB.ai_score) / 2;
        return avgScoreA - avgScoreB; // Lower scores first
      }

      if (adaptiveMode === 'least_studied') {
        // Sections with no progress come first (never studied)
        if (!progressA && !progressB) return 0;
        if (!progressA) return -1; // No progress = highest priority
        if (!progressB) return 1;

        // Sort by time spent (lower = higher priority)
        return progressA.time_spent - progressB.time_spent; // Less time first
      }

      return 0;
    });

    return sortedSections;
  }

  /**
   * Generate questions for a specific section using AI
   */
  private async generateQuestionsForSection(
    section: KBSection,
    count: number,
    difficulty: 'easy' | 'medium' | 'hard'
  ): Promise<TestQuestion[]> {
    if (!this.aiManager) {
      throw new Error('AI Manager not configured');
    }

    const prompt = this.buildQuestionGenerationPrompt(section, count, difficulty);

    // Get user-configured settings or use defaults
    const temperature = this.settingsManager?.getNumber('temperature', 0.7) ?? 0.7;
    const maxTokens = this.settingsManager?.getNumber('max_tokens', 64000) ?? 64000;

    try {
      const response = await this.aiManager.createCompletion({
        messages: [{ role: 'user', content: prompt }],
        temperature,
        maxTokens,
      });

      const content = response.choices[0]?.message?.content || '';
      const finishReason = response.choices[0]?.finishReason;

      // Check if response was truncated
      if (finishReason === 'length') {
        console.warn('AI response was truncated due to max_tokens limit');
      }

      // Parse JSON response from AI, including full hierarchy IDs
      const questions = this.parseAIQuestionResponse(content, section, difficulty);

      return questions;
    } catch (error) {
      throw new Error(`Failed to generate questions: ${(error as Error).message}`);
    }
  }

  /**
   * Build prompt for AI question generation
   */
  private buildQuestionGenerationPrompt(
    section: KBSection,
    count: number,
    difficulty: string
  ): string {
    return `You are an expert educator creating practice test questions.

Section: ${section.title}
Content:
${section.content}

Generate ${count} multiple-choice questions based on this content.
Difficulty level: ${difficulty}

Requirements:
- Each question should have 4 options (A, B, C, D)
- Only one option should be correct
- Include an explanation for the correct answer
- Questions should test understanding, not just memorization

Return ONLY a JSON array in this exact format:
[
  {
    "question": "Question text here?",
    "correctAnswer": "A",
    "options": {
      "A": "Correct answer",
      "B": "Incorrect answer 1",
      "C": "Incorrect answer 2",
      "D": "Incorrect answer 3"
    },
    "explanation": "Explanation of why A is correct"
  }
]

IMPORTANT: Return ONLY valid JSON, no additional text or formatting.`;
  }

  /**
   * Parse AI response to extract questions
   * Includes full hierarchy IDs (moduleId, chapterId, sectionId) in questions
   */
  private parseAIQuestionResponse(
    content: string,
    section: KBSection,
    difficulty: 'easy' | 'medium' | 'hard'
  ): TestQuestion[] {
    try {
      // Clean up the response - remove markdown code blocks if present
      let cleanedContent = content.trim();

      // Remove markdown code block markers (```json ... ``` or ``` ... ```)
      cleanedContent = cleanedContent.replace(/^```(?:json)?\s*\n?/i, '');
      cleanedContent = cleanedContent.replace(/\n?```\s*$/i, '');
      cleanedContent = cleanedContent.trim();

      // Extract JSON from response (AI might add text before/after)
      let jsonMatch = cleanedContent.match(/\[[\s\S]*\]/);

      // If no complete array found, try to find partial array starting with [
      if (!jsonMatch) {
        const arrayStart = cleanedContent.indexOf('[');
        if (arrayStart !== -1) {
          // Try to repair truncated JSON by finding complete objects
          const partialJson = cleanedContent.substring(arrayStart);

          // Try to find and extract complete question objects
          const completeObjects = this.extractCompleteJsonObjects(partialJson);
          if (completeObjects.length > 0) {
            return completeObjects.map((q, index) => ({
              id: this.generateQuestionId(section.id, index),
              question: q.question,
              type: 'multiple_choice' as const,
              correctAnswer: q.correctAnswer,
              options: q.options,
              moduleId: section.moduleId,
              chapterId: section.chapterId,
              sectionId: section.id,
              explanation: q.explanation,
              difficulty,
              tags: [section.title],
            }));
          }
        }
        throw new Error('No JSON array found in AI response. The AI may have returned an unexpected format.');
      }

      let rawQuestions;
      try {
        rawQuestions = JSON.parse(jsonMatch[0]);
      } catch {
        // Try to recover partial data from malformed JSON
        const completeObjects = this.extractCompleteJsonObjects(jsonMatch[0]);
        if (completeObjects.length > 0) {
          rawQuestions = completeObjects;
        } else {
          throw new Error('Invalid JSON in AI response. Please try again.');
        }
      }

      if (!Array.isArray(rawQuestions)) {
        throw new Error('AI response is not an array');
      }

      if (rawQuestions.length === 0) {
        throw new Error('AI returned empty question array');
      }

      // Convert to TestQuestion format with UUIDs and full hierarchy IDs
      return rawQuestions.map((q, index) => ({
        id: this.generateQuestionId(section.id, index),
        question: q.question,
        type: 'multiple_choice' as const,
        correctAnswer: q.correctAnswer,
        options: q.options,
        moduleId: section.moduleId,
        chapterId: section.chapterId,
        sectionId: section.id,
        explanation: q.explanation,
        difficulty,
        tags: [section.title],
      }));
    } catch (error) {
      throw new Error(`Failed to parse AI response: ${(error as Error).message}`);
    }
  }

  /**
   * Extract complete JSON objects from a potentially truncated array string
   */
  private extractCompleteJsonObjects(jsonString: string): Array<{
    question: string;
    correctAnswer: string;
    options: Record<string, string>;
    explanation?: string;
  }> {
    const objects: Array<{
      question: string;
      correctAnswer: string;
      options: Record<string, string>;
      explanation?: string;
    }> = [];

    // Find all complete JSON objects in the string
    let braceCount = 0;
    let objectStart = -1;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < jsonString.length; i++) {
      const char = jsonString[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') {
        if (braceCount === 0) {
          objectStart = i;
        }
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0 && objectStart !== -1) {
          // Found a complete object
          const objectStr = jsonString.substring(objectStart, i + 1);
          try {
            const obj = JSON.parse(objectStr);
            // Validate it has required fields
            if (obj.question && obj.correctAnswer && obj.options) {
              objects.push(obj);
            }
          } catch {
            // Skip invalid objects
          }
          objectStart = -1;
        }
      }
    }

    return objects;
  }

  /**
   * Generate a unique question ID
   */
  private generateQuestionId(sectionId: string, index: number): string {
    const timestamp = Date.now();
    return `q_${sectionId}_${timestamp}_${index}`;
  }

  /**
   * Validate question format
   */
  validateQuestion(question: TestQuestion): ValidationResult {
    const errors: string[] = [];

    if (!question.question || question.question.trim().length === 0) {
      errors.push('Question text is required');
    }

    if (question.type === 'multiple_choice') {
      if (!question.options || Object.keys(question.options).length < 2) {
        errors.push('Multiple choice questions need at least 2 options');
      }

      if (!question.correctAnswer) {
        errors.push('Correct answer is required');
      }

      if (question.options && !question.options[question.correctAnswer]) {
        errors.push('Correct answer must be one of the provided options');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate all questions in a test
   */
  validateTest(questions: TestQuestion[]): ValidationResult {
    const errors: string[] = [];

    if (!questions || questions.length === 0) {
      errors.push('Test must have at least one question');
    }

    questions.forEach((question, index) => {
      const result = this.validateQuestion(question);
      if (!result.valid) {
        result.errors.forEach(error => {
          errors.push(`Question ${index + 1}: ${error}`);
        });
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get test statistics
   */
  getTestStats(testId: number): TestStats | null {
    const test = this.getTest(testId);
    if (!test) {
      return null;
    }

    const totalQuestions = test.questions.length;
    const sectionCounts: Record<string, number> = {};

    test.questions.forEach(q => {
      if (q.sectionId) {
        sectionCounts[q.sectionId] = (sectionCounts[q.sectionId] || 0) + 1;
      }
    });

    return {
      testId: test.id,
      totalQuestions,
      sectionCounts,
      createdAt: test.createdAt,
    };
  }
}

/**
 * Types
 */

export interface CreateTestParams {
  kbId: number;
  title: string;
  type: 'manual' | 'ai_generated';
  questions: TestQuestion[];
}

export interface UpdateTestParams {
  title?: string;
  questions?: TestQuestion[];
}

export interface GenerateQuestionsParams {
  kbId: number;
  moduleIds?: string[];  // Optional: specific modules to generate from
  chapterIds?: string[]; // Optional: specific chapters to generate from (format: moduleId.chapterId)
  sectionIds?: string[]; // Optional: specific sections to generate from (format: moduleId.chapterId.sectionId)
  questionsPerSection?: number; // Default: 5
  totalQuestions?: number; // Optional: limit total questions across all content
  difficulty?: 'easy' | 'medium' | 'hard'; // Default: medium
  includeExisting?: boolean; // If true, generate more even if questions exist
  adaptiveMode?: 'none' | 'low_scores' | 'least_studied'; // Adaptive testing mode
}

export interface TestQuestion {
  id: string;
  question: string;
  type: 'multiple_choice' | 'true_false' | 'short_answer';
  correctAnswer: string;
  options?: Record<string, string>; // For multiple choice: { A: "...", B: "...", ... }
  moduleId?: string;   // Which KB module this question is from
  chapterId?: string;  // Which KB chapter this question is from
  sectionId?: string;  // Which KB section this question is from (full path: moduleId.chapterId.sectionId)
  explanation?: string; // Explanation of the correct answer
  difficulty?: 'easy' | 'medium' | 'hard';
  tags?: string[];     // Optional tags for categorization
}

export interface PracticeTest {
  id: number;
  kbId: number;
  title: string;
  type: 'manual' | 'ai_generated';
  questions: TestQuestion[];
  createdAt: string;
}

interface PracticeTestRow {
  id: number;
  kb_id: number;
  title: string;
  type: 'manual' | 'ai_generated';
  questions: string; // JSON
  created_at: string;
}

interface KBSection {
  id: string;           // Full section ID: moduleId.chapterId.sectionId
  moduleId: string;     // Module ID
  chapterId: string;    // Chapter ID (just the chapter part)
  sectionIdPart: string; // Section ID (just the section part)
  title: string;
  content: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface TestStats {
  testId: number;
  totalQuestions: number;
  sectionCounts: Record<string, number>;
  createdAt: string;
}
