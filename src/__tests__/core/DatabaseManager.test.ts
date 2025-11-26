/**
 * Unit tests for DatabaseManager
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from '../../core/database/DatabaseManager';

describe('DatabaseManager', () => {
  let db: DatabaseManager;
  let testDbPath: string;

  beforeEach(async () => {
    // Create a unique test database path
    testDbPath = path.join(os.tmpdir(), `test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    db = new DatabaseManager(testDbPath);
    await db.initialize();
  });

  afterEach(async () => {
    // Close database and clean up
    if (db) {
      await db.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    // Also clean up WAL and SHM files if they exist
    if (fs.existsSync(`${testDbPath}-wal`)) {
      fs.unlinkSync(`${testDbPath}-wal`);
    }
    if (fs.existsSync(`${testDbPath}-shm`)) {
      fs.unlinkSync(`${testDbPath}-shm`);
    }
  });

  describe('initialization', () => {
    it('should initialize database successfully', async () => {
      expect(db.getDatabase()).toBeDefined();
    });

    it('should create database file', async () => {
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it('should throw error when database is not initialized', async () => {
      await db.close();
      expect(() => db.query('SELECT 1')).toThrow('Database not initialized');
    });

    it('should create required tables', async () => {
      const tables = db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      const tableNames = tables.map(t => t.name);

      expect(tableNames).toContain('knowledge_bases');
      expect(tableNames).toContain('study_progress');
      expect(tableNames).toContain('practice_tests');
      expect(tableNames).toContain('test_results');
      expect(tableNames).toContain('conversations');
      expect(tableNames).toContain('settings');
      expect(tableNames).toContain('migrations');
      expect(tableNames).toContain('highlights');
    });
  });

  describe('Knowledge Base CRUD', () => {
    const testKBData = {
      uuid: '12345678-1234-1234-1234-123456789012',
      title: 'Test Knowledge Base',
      xml_content: '<knowledge_base><modules></modules></knowledge_base>',
      metadata: { author: 'Test Author', version: '1.0' },
    };

    it('should create a knowledge base', () => {
      const id = db.createKnowledgeBase(testKBData);
      expect(id).toBeGreaterThan(0);
    });

    it('should get a knowledge base by ID', () => {
      const id = db.createKnowledgeBase(testKBData);
      const kb = db.getKnowledgeBase(id);

      expect(kb).not.toBeNull();
      expect(kb?.uuid).toBe(testKBData.uuid);
      expect(kb?.title).toBe(testKBData.title);
      expect(kb?.metadata).toEqual(testKBData.metadata);
    });

    it('should return null for non-existent knowledge base', () => {
      const kb = db.getKnowledgeBase(9999);
      expect(kb).toBeNull();
    });

    it('should list all knowledge bases', () => {
      db.createKnowledgeBase(testKBData);
      db.createKnowledgeBase({
        ...testKBData,
        uuid: '98765432-1234-1234-1234-123456789012',
        title: 'Second KB',
      });

      const kbs = db.listKnowledgeBases();
      expect(kbs.length).toBe(2);
    });

    it('should update a knowledge base', () => {
      const id = db.createKnowledgeBase(testKBData);

      const updated = db.updateKnowledgeBase(id, {
        title: 'Updated Title',
        metadata: { author: 'Updated Author' },
      });

      expect(updated).toBe(true);

      const kb = db.getKnowledgeBase(id);
      expect(kb?.title).toBe('Updated Title');
      expect(kb?.metadata).toEqual({ author: 'Updated Author' });
    });

    it('should return false when updating non-existent knowledge base', () => {
      const updated = db.updateKnowledgeBase(9999, { title: 'Test' });
      expect(updated).toBe(false);
    });

    it('should delete a knowledge base', () => {
      const id = db.createKnowledgeBase(testKBData);
      const deleted = db.deleteKnowledgeBase(id);

      expect(deleted).toBe(true);
      expect(db.getKnowledgeBase(id)).toBeNull();
    });

    it('should return false when deleting non-existent knowledge base', () => {
      const deleted = db.deleteKnowledgeBase(9999);
      expect(deleted).toBe(false);
    });

    it('should enforce UUID uniqueness', () => {
      db.createKnowledgeBase(testKBData);

      expect(() => {
        db.createKnowledgeBase({
          ...testKBData,
          title: 'Duplicate UUID',
        });
      }).toThrow();
    });

    it('should enforce UUID format (36 characters)', () => {
      expect(() => {
        db.createKnowledgeBase({
          ...testKBData,
          uuid: 'short-uuid',
        });
      }).toThrow();
    });
  });

  describe('Query and Execute', () => {
    it('should execute INSERT and return lastInsertRowid', () => {
      const result = db.execute(
        'INSERT INTO settings (key, value) VALUES (?, ?)',
        ['test_key', JSON.stringify({ setting: true })]
      );

      expect(result.lastInsertRowid).toBeGreaterThan(0);
      expect(result.changes).toBe(1);
    });

    it('should query data with parameters', () => {
      db.execute(
        'INSERT INTO settings (key, value) VALUES (?, ?)',
        ['query_test', JSON.stringify({ data: 'test' })]
      );

      const rows = db.query<{ key: string; value: string }>(
        'SELECT key, value FROM settings WHERE key = ?',
        ['query_test']
      );

      expect(rows.length).toBe(1);
      expect(rows[0].key).toBe('query_test');
    });

    it('should return empty array for no results', () => {
      const rows = db.query<{ key: string }>(
        'SELECT key FROM settings WHERE key = ?',
        ['nonexistent']
      );

      expect(rows).toEqual([]);
    });

    it('should throw on invalid SQL', () => {
      expect(() => {
        db.query('SELECT * FROM nonexistent_table');
      }).toThrow();
    });
  });

  describe('Transactions', () => {
    it('should commit transaction successfully', () => {
      db.beginTransaction();

      db.execute(
        'INSERT INTO settings (key, value) VALUES (?, ?)',
        ['txn_test', JSON.stringify({ data: 1 })]
      );

      db.commitTransaction();

      const rows = db.query<{ key: string }>(
        'SELECT key FROM settings WHERE key = ?',
        ['txn_test']
      );
      expect(rows.length).toBe(1);
    });

    it('should rollback transaction successfully', () => {
      db.beginTransaction();

      db.execute(
        'INSERT INTO settings (key, value) VALUES (?, ?)',
        ['rollback_test', JSON.stringify({ data: 1 })]
      );

      db.rollbackTransaction();

      const rows = db.query<{ key: string }>(
        'SELECT key FROM settings WHERE key = ?',
        ['rollback_test']
      );
      expect(rows.length).toBe(0);
    });
  });

  describe('Full-Text Search', () => {
    it('should index and search content', () => {
      const kbId = db.createKnowledgeBase({
        uuid: '11111111-1111-1111-1111-111111111111',
        title: 'Search Test KB',
        xml_content: '<knowledge_base><modules></modules></knowledge_base>',
      });

      db.indexContent(kbId, 'section-1', 'The quick brown fox jumps over the lazy dog', 'fox dog jump');
      db.indexContent(kbId, 'section-2', 'A lazy cat sleeps on the couch', 'cat sleep couch');

      const results = db.searchContent('fox');
      expect(results.length).toBe(1);
      expect(results[0].section_id).toBe('section-1');
    });

    it('should search with knowledge base filter', () => {
      const kb1 = db.createKnowledgeBase({
        uuid: '22222222-2222-2222-2222-222222222222',
        title: 'KB 1',
        xml_content: '<knowledge_base><modules></modules></knowledge_base>',
      });

      const kb2 = db.createKnowledgeBase({
        uuid: '33333333-3333-3333-3333-333333333333',
        title: 'KB 2',
        xml_content: '<knowledge_base><modules></modules></knowledge_base>',
      });

      db.indexContent(kb1, 'sec-1', 'JavaScript programming language', 'javascript programming');
      db.indexContent(kb2, 'sec-2', 'Python programming language', 'python programming');

      const allResults = db.searchContent('programming');
      expect(allResults.length).toBe(2);

      const kb1Results = db.searchContent('programming', kb1);
      expect(kb1Results.length).toBe(1);
      expect(kb1Results[0].kb_id).toBe(kb1);
    });
  });

  describe('Database Statistics', () => {
    it('should return database statistics', () => {
      const stats = db.getStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('knowledge_bases');
      expect(stats).toHaveProperty('sections_studied');
      expect(stats).toHaveProperty('tests_taken');
      expect(stats).toHaveProperty('conversations');
      expect(stats.knowledge_bases).toBe(0);
    });

    it('should update statistics after adding data', () => {
      db.createKnowledgeBase({
        uuid: '44444444-4444-4444-4444-444444444444',
        title: 'Stats Test',
        xml_content: '<knowledge_base><modules></modules></knowledge_base>',
      });

      const stats = db.getStats();
      expect(stats.knowledge_bases).toBe(1);
    });
  });

  describe('Foreign Key Constraints', () => {
    it('should cascade delete related data when KB is deleted', () => {
      const kbId = db.createKnowledgeBase({
        uuid: '55555555-5555-5555-5555-555555555555',
        title: 'Cascade Test',
        xml_content: '<knowledge_base><modules></modules></knowledge_base>',
      });

      // Insert study progress
      db.execute(
        'INSERT INTO study_progress (kb_id, section_id, user_score, ai_score) VALUES (?, ?, ?, ?)',
        [kbId, 'section-1', 0.8, 0.85]
      );

      // Insert conversation
      db.execute(
        'INSERT INTO conversations (kb_id, messages) VALUES (?, ?)',
        [kbId, JSON.stringify([{ role: 'user', content: 'Hello' }])]
      );

      // Verify data exists
      const progressBefore = db.query<{ id: number }>(
        'SELECT id FROM study_progress WHERE kb_id = ?',
        [kbId]
      );
      expect(progressBefore.length).toBe(1);

      // Delete KB
      db.deleteKnowledgeBase(kbId);

      // Verify cascade delete
      const progressAfter = db.query<{ id: number }>(
        'SELECT id FROM study_progress WHERE kb_id = ?',
        [kbId]
      );
      expect(progressAfter.length).toBe(0);

      const conversationsAfter = db.query<{ id: number }>(
        'SELECT id FROM conversations WHERE kb_id = ?',
        [kbId]
      );
      expect(conversationsAfter.length).toBe(0);
    });
  });

  describe('Score Constraints', () => {
    it('should enforce user_score range 0.0 to 1.0', () => {
      const kbId = db.createKnowledgeBase({
        uuid: '66666666-6666-6666-6666-666666666666',
        title: 'Score Test',
        xml_content: '<knowledge_base><modules></modules></knowledge_base>',
      });

      // Valid score
      expect(() => {
        db.execute(
          'INSERT INTO study_progress (kb_id, section_id, user_score) VALUES (?, ?, ?)',
          [kbId, 'section-valid', 0.5]
        );
      }).not.toThrow();

      // Score > 1.0
      expect(() => {
        db.execute(
          'INSERT INTO study_progress (kb_id, section_id, user_score) VALUES (?, ?, ?)',
          [kbId, 'section-over', 1.5]
        );
      }).toThrow();

      // Score < 0.0
      expect(() => {
        db.execute(
          'INSERT INTO study_progress (kb_id, section_id, user_score) VALUES (?, ?, ?)',
          [kbId, 'section-under', -0.1]
        );
      }).toThrow();
    });
  });
});
