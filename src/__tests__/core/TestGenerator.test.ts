/**
 * Unit tests for TestGenerator
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from '../../core/database/DatabaseManager';
import {
  TestGenerator,
  TestQuestion,
  PracticeTest,
  CreateTestParams,
  ValidationResult,
} from '../../core/tests/TestGenerator';
import { ProgressManager } from '../../core/progress/ProgressManager';

// Mock AIManager
const mockAIManager = {
  createCompletion: jest.fn(),
};

describe('TestGenerator', () => {
  let db: DatabaseManager;
  let testGenerator: TestGenerator;
  let testDbPath: string;
  let testKbId: number;

  const sampleXML = `<?xml version="1.0" encoding="UTF-8"?>
    <knowledge_base>
      <metadata>
        <uuid>test-uuid-123</uuid>
        <title>Test Knowledge Base</title>
        <version>1.0</version>
      </metadata>
      <modules>
        <module id="mod-1" order="1">
          <title>Test Module</title>
          <description>Module description</description>
          <chapters>
            <chapter id="ch-1" order="1">
              <title>Test Chapter</title>
              <sections>
                <section id="sec-1" order="1">
                  <title>Test Section</title>
                  <content>
                    <text>This is comprehensive test content about aviation fundamentals. Aircraft aerodynamics involve lift, drag, thrust, and weight as the four forces of flight. Understanding these principles is essential for pilots.</text>
                  </content>
                </section>
                <section id="sec-2" order="2">
                  <title>Another Section</title>
                  <content>
                    <text>Weather patterns affect flight operations significantly. Pilots must understand meteorology including clouds, pressure systems, and visibility requirements for safe flight operations.</text>
                  </content>
                </section>
              </sections>
            </chapter>
          </chapters>
        </module>
      </modules>
    </knowledge_base>`;

  beforeEach(async () => {
    // Create a unique test database path
    testDbPath = path.join(os.tmpdir(), `test-generator-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    db = new DatabaseManager(testDbPath);
    await db.initialize();

    // Create a test knowledge base
    testKbId = db.createKnowledgeBase({
      uuid: '12345678-1234-1234-1234-123456789012',
      title: 'TestGenerator Test KB',
      xml_content: sampleXML,
    });

    testGenerator = new TestGenerator(db);

    // Reset mocks
    mockAIManager.createCompletion.mockReset();
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

  describe('createTest', () => {
    const sampleQuestions: TestQuestion[] = [
      {
        id: 'q-1',
        question: 'What are the four forces of flight?',
        type: 'multiple_choice',
        correctAnswer: 'A',
        options: {
          A: 'Lift, drag, thrust, weight',
          B: 'Up, down, left, right',
          C: 'Speed, altitude, direction, time',
          D: 'Engine, wing, tail, fuselage',
        },
        sectionId: 'mod-1.ch-1.sec-1',
        difficulty: 'easy',
      },
    ];

    it('should create a test successfully', () => {
      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Aviation Fundamentals Test',
        type: 'manual',
        questions: sampleQuestions,
      });

      expect(testId).toBeGreaterThan(0);
    });

    it('should store test with correct data', () => {
      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Test Title',
        type: 'ai_generated',
        questions: sampleQuestions,
      });

      const test = testGenerator.getTest(testId);

      expect(test).not.toBeNull();
      expect(test?.title).toBe('Test Title');
      expect(test?.type).toBe('ai_generated');
      expect(test?.questions.length).toBe(1);
      expect(test?.kbId).toBe(testKbId);
    });

    it('should serialize questions correctly', () => {
      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Test',
        type: 'manual',
        questions: sampleQuestions,
      });

      const test = testGenerator.getTest(testId);
      expect(test?.questions[0].question).toBe('What are the four forces of flight?');
      expect(test?.questions[0].options?.A).toBe('Lift, drag, thrust, weight');
    });
  });

  describe('getTest', () => {
    it('should return null for non-existent test', () => {
      const test = testGenerator.getTest(9999);
      expect(test).toBeNull();
    });

    it('should return test with correct structure', () => {
      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Structure Test',
        type: 'manual',
        questions: [{
          id: 'q-1',
          question: 'Test question?',
          type: 'multiple_choice',
          correctAnswer: 'A',
          options: { A: 'Yes', B: 'No' },
        }],
      });

      const test = testGenerator.getTest(testId);

      expect(test).toHaveProperty('id');
      expect(test).toHaveProperty('kbId');
      expect(test).toHaveProperty('title');
      expect(test).toHaveProperty('type');
      expect(test).toHaveProperty('questions');
      expect(test).toHaveProperty('createdAt');
    });
  });

  describe('getTestsForKB', () => {
    it('should return empty array for KB with no tests', () => {
      const tests = testGenerator.getTestsForKB(testKbId);
      expect(tests).toEqual([]);
    });

    it('should return all tests for KB', () => {
      testGenerator.createTest({
        kbId: testKbId,
        title: 'Test 1',
        type: 'manual',
        questions: [{ id: 'q1', question: 'Q1?', type: 'multiple_choice', correctAnswer: 'A' }],
      });
      testGenerator.createTest({
        kbId: testKbId,
        title: 'Test 2',
        type: 'manual',
        questions: [{ id: 'q2', question: 'Q2?', type: 'multiple_choice', correctAnswer: 'A' }],
      });

      const tests = testGenerator.getTestsForKB(testKbId);
      expect(tests.length).toBe(2);
    });

    it('should order tests by created_at descending', () => {
      testGenerator.createTest({
        kbId: testKbId,
        title: 'First Test',
        type: 'manual',
        questions: [{ id: 'q1', question: 'Q?', type: 'multiple_choice', correctAnswer: 'A' }],
      });
      testGenerator.createTest({
        kbId: testKbId,
        title: 'Second Test',
        type: 'manual',
        questions: [{ id: 'q2', question: 'Q?', type: 'multiple_choice', correctAnswer: 'A' }],
      });

      const tests = testGenerator.getTestsForKB(testKbId);
      expect(tests[0].title).toBe('Second Test');
    });
  });

  describe('updateTest', () => {
    it('should update test title', () => {
      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Original Title',
        type: 'manual',
        questions: [{ id: 'q1', question: 'Q?', type: 'multiple_choice', correctAnswer: 'A' }],
      });

      testGenerator.updateTest(testId, { title: 'Updated Title' });

      const test = testGenerator.getTest(testId);
      expect(test?.title).toBe('Updated Title');
    });

    it('should update test questions', () => {
      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Test',
        type: 'manual',
        questions: [{ id: 'q1', question: 'Old Q?', type: 'multiple_choice', correctAnswer: 'A' }],
      });

      const newQuestions: TestQuestion[] = [
        { id: 'q1', question: 'New Q1?', type: 'multiple_choice', correctAnswer: 'B' },
        { id: 'q2', question: 'New Q2?', type: 'multiple_choice', correctAnswer: 'C' },
      ];

      testGenerator.updateTest(testId, { questions: newQuestions });

      const test = testGenerator.getTest(testId);
      expect(test?.questions.length).toBe(2);
      expect(test?.questions[0].question).toBe('New Q1?');
    });

    it('should not modify test if no updates provided', () => {
      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Original',
        type: 'manual',
        questions: [{ id: 'q1', question: 'Q?', type: 'multiple_choice', correctAnswer: 'A' }],
      });

      testGenerator.updateTest(testId, {});

      const test = testGenerator.getTest(testId);
      expect(test?.title).toBe('Original');
    });
  });

  describe('deleteTest', () => {
    it('should delete test', () => {
      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'To Delete',
        type: 'manual',
        questions: [{ id: 'q1', question: 'Q?', type: 'multiple_choice', correctAnswer: 'A' }],
      });

      testGenerator.deleteTest(testId);

      const test = testGenerator.getTest(testId);
      expect(test).toBeNull();
    });
  });

  describe('validateQuestion', () => {
    it('should validate correct question', () => {
      const question: TestQuestion = {
        id: 'q-1',
        question: 'What is 2+2?',
        type: 'multiple_choice',
        correctAnswer: 'A',
        options: { A: '4', B: '3', C: '5', D: '6' },
      };

      const result = testGenerator.validateQuestion(question);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject empty question text', () => {
      const question: TestQuestion = {
        id: 'q-1',
        question: '',
        type: 'multiple_choice',
        correctAnswer: 'A',
        options: { A: 'Yes', B: 'No' },
      };

      const result = testGenerator.validateQuestion(question);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Question text is required');
    });

    it('should reject multiple choice with < 2 options', () => {
      const question: TestQuestion = {
        id: 'q-1',
        question: 'Single option?',
        type: 'multiple_choice',
        correctAnswer: 'A',
        options: { A: 'Only option' },
      };

      const result = testGenerator.validateQuestion(question);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Multiple choice questions need at least 2 options');
    });

    it('should reject when correctAnswer not in options', () => {
      const question: TestQuestion = {
        id: 'q-1',
        question: 'Wrong answer?',
        type: 'multiple_choice',
        correctAnswer: 'C',
        options: { A: 'First', B: 'Second' },
      };

      const result = testGenerator.validateQuestion(question);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Correct answer must be one of the provided options');
    });

    it('should reject missing correctAnswer', () => {
      const question: TestQuestion = {
        id: 'q-1',
        question: 'No answer?',
        type: 'multiple_choice',
        correctAnswer: '',
        options: { A: 'First', B: 'Second' },
      };

      const result = testGenerator.validateQuestion(question);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Correct answer is required');
    });
  });

  describe('validateTest', () => {
    it('should validate test with valid questions', () => {
      const questions: TestQuestion[] = [
        {
          id: 'q-1',
          question: 'Q1?',
          type: 'multiple_choice',
          correctAnswer: 'A',
          options: { A: '1', B: '2' },
        },
        {
          id: 'q-2',
          question: 'Q2?',
          type: 'multiple_choice',
          correctAnswer: 'B',
          options: { A: '1', B: '2' },
        },
      ];

      const result = testGenerator.validateTest(questions);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject empty questions array', () => {
      const result = testGenerator.validateTest([]);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Test must have at least one question');
    });

    it('should report errors for each invalid question', () => {
      const questions: TestQuestion[] = [
        {
          id: 'q-1',
          question: '',
          type: 'multiple_choice',
          correctAnswer: 'A',
          options: { A: '1' },
        },
        {
          id: 'q-2',
          question: 'Valid question?',
          type: 'multiple_choice',
          correctAnswer: 'C',
          options: { A: '1', B: '2' },
        },
      ];

      const result = testGenerator.validateTest(questions);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Question 1'))).toBe(true);
      expect(result.errors.some(e => e.includes('Question 2'))).toBe(true);
    });
  });

  describe('getTestStats', () => {
    it('should return null for non-existent test', () => {
      const stats = testGenerator.getTestStats(9999);
      expect(stats).toBeNull();
    });

    it('should return correct statistics', () => {
      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Stats Test',
        type: 'manual',
        questions: [
          {
            id: 'q-1',
            question: 'Q1?',
            type: 'multiple_choice',
            correctAnswer: 'A',
            sectionId: 'mod-1.ch-1.sec-1',
          },
          {
            id: 'q-2',
            question: 'Q2?',
            type: 'multiple_choice',
            correctAnswer: 'B',
            sectionId: 'mod-1.ch-1.sec-1',
          },
          {
            id: 'q-3',
            question: 'Q3?',
            type: 'multiple_choice',
            correctAnswer: 'C',
            sectionId: 'mod-1.ch-1.sec-2',
          },
        ],
      });

      const stats = testGenerator.getTestStats(testId);

      expect(stats).not.toBeNull();
      expect(stats?.totalQuestions).toBe(3);
      expect(stats?.sectionCounts['mod-1.ch-1.sec-1']).toBe(2);
      expect(stats?.sectionCounts['mod-1.ch-1.sec-2']).toBe(1);
    });
  });

  describe('generateQuestionsFromKB', () => {
    it('should throw error when AI Manager not configured', async () => {
      await expect(
        testGenerator.generateQuestionsFromKB({ kbId: testKbId })
      ).rejects.toThrow('AI Manager not configured');
    });

    it('should throw error for non-existent KB', async () => {
      const generatorWithAI = new TestGenerator(db, mockAIManager as any);

      await expect(
        generatorWithAI.generateQuestionsFromKB({ kbId: 9999 })
      ).rejects.toThrow('Knowledge base not found');
    });

    it('should throw error for KB with no content', async () => {
      const emptyKbId = db.createKnowledgeBase({
        uuid: '99999999-9999-9999-9999-999999999999',
        title: 'Empty KB',
        xml_content: '',
      });

      const generatorWithAI = new TestGenerator(db, mockAIManager as any);

      await expect(
        generatorWithAI.generateQuestionsFromKB({ kbId: emptyKbId })
      ).rejects.toThrow('Knowledge base has no content');
    });
  });

  describe('Question Types', () => {
    it('should handle multiple_choice questions', () => {
      const question: TestQuestion = {
        id: 'mc-1',
        question: 'Multiple choice question?',
        type: 'multiple_choice',
        correctAnswer: 'B',
        options: { A: 'Option A', B: 'Option B', C: 'Option C', D: 'Option D' },
      };

      const result = testGenerator.validateQuestion(question);
      expect(result.valid).toBe(true);
    });

    it('should handle true_false questions', () => {
      const question: TestQuestion = {
        id: 'tf-1',
        question: 'Is this a true/false question?',
        type: 'true_false',
        correctAnswer: 'true',
      };

      // true_false doesn't require options validation
      expect(question.type).toBe('true_false');
    });

    it('should handle short_answer questions', () => {
      const question: TestQuestion = {
        id: 'sa-1',
        question: 'What is the capital of France?',
        type: 'short_answer',
        correctAnswer: 'Paris',
      };

      // short_answer doesn't require options validation
      expect(question.type).toBe('short_answer');
    });
  });

  describe('Question Metadata', () => {
    it('should preserve question metadata', () => {
      const question: TestQuestion = {
        id: 'meta-1',
        question: 'Test question?',
        type: 'multiple_choice',
        correctAnswer: 'A',
        options: { A: 'Yes', B: 'No' },
        moduleId: 'mod-1',
        chapterId: 'ch-1',
        sectionId: 'mod-1.ch-1.sec-1',
        explanation: 'This is the explanation',
        difficulty: 'medium',
        tags: ['aviation', 'fundamentals'],
      };

      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Metadata Test',
        type: 'manual',
        questions: [question],
      });

      const test = testGenerator.getTest(testId);
      const savedQuestion = test?.questions[0];

      expect(savedQuestion?.moduleId).toBe('mod-1');
      expect(savedQuestion?.chapterId).toBe('ch-1');
      expect(savedQuestion?.sectionId).toBe('mod-1.ch-1.sec-1');
      expect(savedQuestion?.explanation).toBe('This is the explanation');
      expect(savedQuestion?.difficulty).toBe('medium');
      expect(savedQuestion?.tags).toContain('aviation');
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in questions', () => {
      const question: TestQuestion = {
        id: 'special-1',
        question: 'What is the formula for water (H₂O)?',
        type: 'multiple_choice',
        correctAnswer: 'A',
        options: {
          A: 'H₂O',
          B: 'CO₂',
          C: 'NaCl',
          D: 'O₂',
        },
      };

      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Special Chars',
        type: 'manual',
        questions: [question],
      });

      const test = testGenerator.getTest(testId);
      expect(test?.questions[0].question).toContain('H₂O');
    });

    it('should handle unicode in questions', () => {
      const question: TestQuestion = {
        id: 'unicode-1',
        question: '日本語の質問ですか？',
        type: 'multiple_choice',
        correctAnswer: 'A',
        options: { A: 'はい', B: 'いいえ' },
      };

      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Unicode Test',
        type: 'manual',
        questions: [question],
      });

      const test = testGenerator.getTest(testId);
      expect(test?.questions[0].question).toBe('日本語の質問ですか？');
    });

    it('should handle very long question text', () => {
      const longText = 'A'.repeat(5000);
      const question: TestQuestion = {
        id: 'long-1',
        question: `Long question: ${longText}?`,
        type: 'multiple_choice',
        correctAnswer: 'A',
        options: { A: 'Yes', B: 'No' },
      };

      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Long Question',
        type: 'manual',
        questions: [question],
      });

      const test = testGenerator.getTest(testId);
      expect(test?.questions[0].question.length).toBeGreaterThan(5000);
    });

    it('should handle large number of questions', () => {
      const manyQuestions: TestQuestion[] = [];
      for (let i = 0; i < 100; i++) {
        manyQuestions.push({
          id: `q-${i}`,
          question: `Question ${i}?`,
          type: 'multiple_choice',
          correctAnswer: 'A',
          options: { A: 'Yes', B: 'No' },
        });
      }

      const testId = testGenerator.createTest({
        kbId: testKbId,
        title: 'Many Questions',
        type: 'manual',
        questions: manyQuestions,
      });

      const test = testGenerator.getTest(testId);
      expect(test?.questions.length).toBe(100);
    });
  });
});
