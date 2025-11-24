import { DatabaseManager } from '../database/DatabaseManager';
import { AIManager } from '../ai/AIManager';
import { XMLParser } from '../knowledge/XMLParser';
import { SectionContent } from '../../shared/types';

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

  constructor(db: DatabaseManager, aiManager?: AIManager) {
    this.db = db;
    this.aiManager = aiManager || null;
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
   */
  async generateQuestionsFromKB(params: GenerateQuestionsParams): Promise<TestQuestion[]> {
    if (!this.aiManager) {
      throw new Error('AI Manager not configured. Cannot generate questions.');
    }

    // Get KB content
    const kbResults = this.db.query<{ xml_content: string }>(
      `SELECT xml_content FROM knowledge_bases WHERE id = ?`,
      [params.kbId]
    );

    if (kbResults.length === 0) {
      throw new Error(`Knowledge base not found: ${params.kbId}`);
    }

    const xmlContent = kbResults[0].xml_content;

    // Extract sections from XML
    const sections = await this.extractSections(xmlContent, params.sectionIds);

    if (sections.length === 0) {
      throw new Error('No sections found in knowledge base');
    }

    // Generate questions using AI
    const questions: TestQuestion[] = [];

    for (const section of sections) {
      const sectionQuestions = await this.generateQuestionsForSection(
        section,
        params.questionsPerSection || 5,
        params.difficulty || 'medium'
      );
      questions.push(...sectionQuestions);
    }

    return questions;
  }

  /**
   * Extract sections from XML content
   */
  private async extractSections(xmlContent: string, sectionIds?: string[]): Promise<KBSection[]> {
    try {
      const parsed = await this.xmlParser.parseKnowledgeBase(xmlContent);
      const sections: KBSection[] = [];

      // Extract sections from parsed knowledge base
      for (const module of parsed.modules) {
        const moduleId = module.id;
        const moduleTitle = module.title;

        for (const chapter of module.chapters) {
          const chapterId = chapter.id;
          const chapterTitle = chapter.title;

          for (const section of chapter.sections) {
            const sectionId = section.id;
            const sectionTitle = section.title;
            const fullId = `${moduleId}.${chapterId}.${sectionId}`;

            // Filter by sectionIds if provided
            if (!sectionIds || sectionIds.length === 0 || sectionIds.includes(fullId)) {
              // Extract text content from section
              const content = this.extractSectionContent(section.content);

              sections.push({
                id: fullId,
                title: `${moduleTitle} > ${chapterTitle} > ${sectionTitle}`,
                content: content.trim(),
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

    return parts.join('\n\n').trim();
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

    try {
      const response = await this.aiManager.createCompletion({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        maxTokens: 2000,
      });

      const content = response.choices[0]?.message?.content || '';

      // Parse JSON response from AI
      const questions = this.parseAIQuestionResponse(content, section.id);

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
   */
  private parseAIQuestionResponse(content: string, sectionId: string): TestQuestion[] {
    try {
      // Extract JSON from response (AI might add text before/after)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in AI response');
      }

      const rawQuestions = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(rawQuestions)) {
        throw new Error('AI response is not an array');
      }

      // Convert to TestQuestion format with UUIDs
      return rawQuestions.map((q, index) => ({
        id: this.generateQuestionId(sectionId, index),
        question: q.question,
        type: 'multiple_choice' as const,
        correctAnswer: q.correctAnswer,
        options: q.options,
        sectionId,
        explanation: q.explanation,
      }));
    } catch (error) {
      throw new Error(`Failed to parse AI response: ${(error as Error).message}`);
    }
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
  sectionIds?: string[]; // Optional: specific sections to generate from
  questionsPerSection?: number; // Default: 5
  difficulty?: 'easy' | 'medium' | 'hard'; // Default: medium
}

export interface TestQuestion {
  id: string;
  question: string;
  type: 'multiple_choice' | 'true_false' | 'short_answer';
  correctAnswer: string;
  options?: Record<string, string>; // For multiple choice: { A: "...", B: "...", ... }
  sectionId?: string; // Which KB section this question is from
  explanation?: string; // Explanation of the correct answer
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
  id: string;
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
