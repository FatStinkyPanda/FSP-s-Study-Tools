/**
 * Unit tests for SemanticIndexer
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from '../../core/database/DatabaseManager';
import { SemanticIndexer, SemanticSearchResult, VocabularyEntry } from '../../core/indexer/SemanticIndexer';
import { ContentChunk } from '../../core/knowledge/ContentChunker';

describe('SemanticIndexer', () => {
  let db: DatabaseManager;
  let indexer: SemanticIndexer;
  let testDbPath: string;
  let testKbId: number;

  beforeEach(async () => {
    // Create a unique test database path
    testDbPath = path.join(os.tmpdir(), `test-semantic-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    db = new DatabaseManager(testDbPath);
    await db.initialize();

    // Create a test knowledge base
    testKbId = db.createKnowledgeBase({
      uuid: '12345678-1234-1234-1234-123456789012',
      title: 'Semantic Test KB',
      xml_content: '<knowledge_base><modules></modules></knowledge_base>',
    });

    indexer = new SemanticIndexer(db);
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

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await indexer.initialize();
      const stats = await indexer.getStats();
      expect(stats.totalChunks).toBe(0);
      expect(stats.vocabularySize).toBe(0);
    });

    it('should create embeddings table', async () => {
      await indexer.initialize();

      const tables = db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='content_embeddings'"
      );
      expect(tables.length).toBe(1);
    });

    it('should only initialize once', async () => {
      await indexer.initialize();
      await indexer.initialize(); // Second call should be idempotent

      const stats = await indexer.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('indexChunks', () => {
    const testChunks: ContentChunk[] = [
      {
        id: 'chunk-1',
        content: 'The quick brown fox jumps over the lazy dog. This is a test sentence about animals.',
        type: 'text',
        metadata: {
          startPosition: 0,
          endPosition: 100,
          wordCount: 15,
          characterCount: 100,
          sectionId: 'section-1',
          moduleId: 'module-1',
          chapterId: 'chapter-1',
        },
      },
      {
        id: 'chunk-2',
        content: 'Machine learning and artificial intelligence are transforming technology. Neural networks process data.',
        type: 'text',
        metadata: {
          startPosition: 100,
          endPosition: 200,
          wordCount: 12,
          characterCount: 100,
          sectionId: 'section-2',
          moduleId: 'module-1',
          chapterId: 'chapter-1',
        },
      },
      {
        id: 'chunk-3',
        content: 'The dog ran quickly through the forest. The fox was hiding behind a tree.',
        type: 'text',
        metadata: {
          startPosition: 200,
          endPosition: 300,
          wordCount: 14,
          characterCount: 76,
          sectionId: 'section-3',
          moduleId: 'module-2',
          chapterId: 'chapter-2',
        },
      },
    ];

    it('should index chunks successfully', async () => {
      const count = await indexer.indexChunks(testKbId, testChunks);
      expect(count).toBe(3);
    });

    it('should store embeddings in database', async () => {
      await indexer.indexChunks(testKbId, testChunks);

      const rows = db.query<{ chunk_id: string }>(
        'SELECT chunk_id FROM content_embeddings WHERE kb_id = ?',
        [testKbId]
      );
      expect(rows.length).toBe(3);
    });

    it('should update vocabulary after indexing', async () => {
      await indexer.indexChunks(testKbId, testChunks);

      const stats = await indexer.getStats();
      expect(stats.vocabularySize).toBeGreaterThan(0);
    });

    it('should handle empty chunks array', async () => {
      const count = await indexer.indexChunks(testKbId, []);
      expect(count).toBe(0);
    });

    it('should replace existing embeddings on re-index', async () => {
      await indexer.indexChunks(testKbId, testChunks);

      // Modify first chunk
      const modifiedChunks: ContentChunk[] = [{
        ...testChunks[0],
        content: 'Completely different content for testing purposes.',
      }];

      await indexer.indexChunks(testKbId, modifiedChunks);

      const rows = db.query<{ content: string }>(
        'SELECT content FROM content_embeddings WHERE kb_id = ? AND chunk_id = ?',
        [testKbId, 'chunk-1']
      );
      expect(rows[0].content).toBe('Completely different content for testing purposes.');
    });
  });

  describe('search', () => {
    const testChunks: ContentChunk[] = [
      {
        id: 'chunk-1',
        content: 'Aviation fundamentals include aerodynamics, flight principles, and aircraft systems.',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 100, wordCount: 10, characterCount: 80, sectionId: 'sec-1' },
      },
      {
        id: 'chunk-2',
        content: 'The pilot must understand weather patterns and navigation techniques for safe flight.',
        type: 'text',
        metadata: { startPosition: 100, endPosition: 200, wordCount: 12, characterCount: 85, sectionId: 'sec-2' },
      },
      {
        id: 'chunk-3',
        content: 'Database management involves SQL queries, indexing, and data normalization.',
        type: 'text',
        metadata: { startPosition: 200, endPosition: 300, wordCount: 10, characterCount: 75, sectionId: 'sec-3' },
      },
    ];

    beforeEach(async () => {
      await indexer.indexChunks(testKbId, testChunks);
    });

    it('should find relevant content', async () => {
      const results = await indexer.search(testKbId, 'aerodynamics flight', 10, 0);

      expect(results.length).toBeGreaterThan(0);
      // Aviation content should rank higher than database content
      expect(results[0].chunkId).not.toBe('chunk-3');
    });

    it('should return results sorted by score descending', async () => {
      const results = await indexer.search(testKbId, 'aircraft systems flight', 10, 0);

      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });

    it('should respect limit parameter', async () => {
      const results = await indexer.search(testKbId, 'flight', 2, 0);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should respect minScore parameter', async () => {
      const results = await indexer.search(testKbId, 'aviation', 10, 0.5);

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0.5);
      }
    });

    it('should return empty array for unrelated queries', async () => {
      const results = await indexer.search(testKbId, 'quantum physics chemistry', 10, 0.3);
      expect(results.length).toBe(0);
    });

    it('should include metadata in results', async () => {
      const results = await indexer.search(testKbId, 'aviation', 10, 0);

      if (results.length > 0) {
        expect(results[0].metadata).toHaveProperty('kbId');
        expect(results[0].metadata).toHaveProperty('sectionId');
        expect(results[0]).toHaveProperty('content');
        expect(results[0]).toHaveProperty('score');
      }
    });
  });

  describe('searchAll', () => {
    it('should search across multiple knowledge bases', async () => {
      // Create second KB
      const kb2Id = db.createKnowledgeBase({
        uuid: '98765432-1234-1234-1234-123456789012',
        title: 'Second KB',
        xml_content: '<knowledge_base><modules></modules></knowledge_base>',
      });

      const chunks1: ContentChunk[] = [{
        id: 'kb1-chunk',
        content: 'Programming languages like Python and JavaScript are popular for web development.',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 100, wordCount: 11, characterCount: 80, sectionId: 'sec-1' },
      }];

      const chunks2: ContentChunk[] = [{
        id: 'kb2-chunk',
        content: 'Python is widely used for machine learning and data science applications.',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 100, wordCount: 11, characterCount: 72, sectionId: 'sec-1' },
      }];

      await indexer.indexChunks(testKbId, chunks1);
      await indexer.indexChunks(kb2Id, chunks2);

      const results = await indexer.searchAll('Python programming', 10, 0);

      expect(results.length).toBe(2);

      // Both KBs should be represented
      const kbIds = results.map(r => r.metadata.kbId);
      expect(kbIds).toContain(testKbId);
      expect(kbIds).toContain(kb2Id);
    });
  });

  describe('findSimilar', () => {
    const testChunks: ContentChunk[] = [
      {
        id: 'chunk-1',
        content: 'The principles of aerodynamics govern how aircraft generate lift and overcome drag.',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 100, wordCount: 12, characterCount: 85, sectionId: 'sec-1' },
      },
      {
        id: 'chunk-2',
        content: 'Lift is generated when air flows over the wings, creating pressure differences.',
        type: 'text',
        metadata: { startPosition: 100, endPosition: 200, wordCount: 12, characterCount: 82, sectionId: 'sec-2' },
      },
      {
        id: 'chunk-3',
        content: 'Database indexing improves query performance by creating efficient data structures.',
        type: 'text',
        metadata: { startPosition: 200, endPosition: 300, wordCount: 10, characterCount: 80, sectionId: 'sec-3' },
      },
    ];

    beforeEach(async () => {
      await indexer.indexChunks(testKbId, testChunks);
    });

    it('should find similar content', async () => {
      const results = await indexer.findSimilar(testKbId, 'chunk-1', 5);

      expect(results.length).toBeGreaterThan(0);
      // chunk-2 (also about aerodynamics) should be more similar to chunk-1 than chunk-3
      if (results.length >= 2) {
        const chunk2Result = results.find(r => r.chunkId === 'chunk-2');
        const chunk3Result = results.find(r => r.chunkId === 'chunk-3');

        if (chunk2Result && chunk3Result) {
          expect(chunk2Result.score).toBeGreaterThan(chunk3Result.score);
        }
      }
    });

    it('should not include source chunk in results', async () => {
      const results = await indexer.findSimilar(testKbId, 'chunk-1', 5);

      const hasSourceChunk = results.some(r => r.chunkId === 'chunk-1');
      expect(hasSourceChunk).toBe(false);
    });

    it('should return empty array for non-existent chunk', async () => {
      const results = await indexer.findSimilar(testKbId, 'nonexistent-chunk', 5);
      expect(results).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const results = await indexer.findSimilar(testKbId, 'chunk-1', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('deleteKBEmbeddings', () => {
    const testChunks: ContentChunk[] = [
      {
        id: 'chunk-1',
        content: 'Test content for deletion',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 50, wordCount: 4, characterCount: 26, sectionId: 'sec-1' },
      },
    ];

    it('should delete all embeddings for a KB', async () => {
      await indexer.indexChunks(testKbId, testChunks);

      const deletedCount = await indexer.deleteKBEmbeddings(testKbId);
      expect(deletedCount).toBe(1);

      const remaining = db.query<{ id: number }>(
        'SELECT id FROM content_embeddings WHERE kb_id = ?',
        [testKbId]
      );
      expect(remaining.length).toBe(0);
    });

    it('should return 0 for KB with no embeddings', async () => {
      const deletedCount = await indexer.deleteKBEmbeddings(9999);
      expect(deletedCount).toBe(0);
    });

    it('should not affect other KB embeddings', async () => {
      const kb2Id = db.createKnowledgeBase({
        uuid: '11111111-1111-1111-1111-111111111111',
        title: 'Other KB',
        xml_content: '<knowledge_base><modules></modules></knowledge_base>',
      });

      await indexer.indexChunks(testKbId, testChunks);
      await indexer.indexChunks(kb2Id, testChunks);

      await indexer.deleteKBEmbeddings(testKbId);

      const kb2Embeddings = db.query<{ id: number }>(
        'SELECT id FROM content_embeddings WHERE kb_id = ?',
        [kb2Id]
      );
      expect(kb2Embeddings.length).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const chunks: ContentChunk[] = [
        {
          id: 'chunk-1',
          content: 'First test content for statistics',
          type: 'text',
          metadata: { startPosition: 0, endPosition: 50, wordCount: 5, characterCount: 34, sectionId: 'sec-1' },
        },
        {
          id: 'chunk-2',
          content: 'Second test content for statistics',
          type: 'text',
          metadata: { startPosition: 50, endPosition: 100, wordCount: 5, characterCount: 35, sectionId: 'sec-2' },
        },
      ];

      await indexer.indexChunks(testKbId, chunks);
      const stats = await indexer.getStats(testKbId);

      expect(stats.totalChunks).toBe(2);
      expect(stats.vocabularySize).toBeGreaterThan(0);
      expect(stats.averageEmbeddingDensity).toBe(512); // Default dimension
    });

    it('should filter stats by KB ID', async () => {
      const kb2Id = db.createKnowledgeBase({
        uuid: '22222222-2222-2222-2222-222222222222',
        title: 'Stats KB 2',
        xml_content: '<knowledge_base><modules></modules></knowledge_base>',
      });

      const chunks1: ContentChunk[] = [{
        id: 'chunk-1',
        content: 'KB1 content',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 20, wordCount: 2, characterCount: 11, sectionId: 'sec-1' },
      }];

      const chunks2: ContentChunk[] = [{
        id: 'chunk-2',
        content: 'KB2 content here',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 30, wordCount: 3, characterCount: 16, sectionId: 'sec-1' },
      }];

      await indexer.indexChunks(testKbId, chunks1);
      await indexer.indexChunks(kb2Id, chunks2);

      const statsAll = await indexer.getStats();
      const statsKb1 = await indexer.getStats(testKbId);

      expect(statsAll.totalChunks).toBe(2);
      expect(statsKb1.totalChunks).toBe(1);
    });
  });

  describe('reindexAll', () => {
    it('should rebuild vocabulary and re-generate embeddings', async () => {
      const chunks: ContentChunk[] = [
        {
          id: 'chunk-1',
          content: 'Aviation safety requires understanding weather patterns.',
          type: 'text',
          metadata: { startPosition: 0, endPosition: 60, wordCount: 6, characterCount: 55, sectionId: 'sec-1' },
        },
        {
          id: 'chunk-2',
          content: 'Weather conditions affect flight operations significantly.',
          type: 'text',
          metadata: { startPosition: 60, endPosition: 120, wordCount: 6, characterCount: 56, sectionId: 'sec-2' },
        },
      ];

      await indexer.indexChunks(testKbId, chunks);

      const reindexedCount = await indexer.reindexAll();
      expect(reindexedCount).toBe(2);

      // Verify embeddings still work for search
      const results = await indexer.search(testKbId, 'weather', 10, 0);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return 0 when no content exists', async () => {
      const reindexedCount = await indexer.reindexAll();
      expect(reindexedCount).toBe(0);
    });
  });

  describe('clusterContent', () => {
    const testChunks: ContentChunk[] = [
      // Aviation cluster
      {
        id: 'chunk-aviation-1',
        content: 'Aircraft aerodynamics and lift principles are fundamental to flight.',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 70, wordCount: 9, characterCount: 68, sectionId: 'sec-1' },
      },
      {
        id: 'chunk-aviation-2',
        content: 'Pilots must understand flight dynamics and aircraft performance.',
        type: 'text',
        metadata: { startPosition: 70, endPosition: 140, wordCount: 8, characterCount: 63, sectionId: 'sec-2' },
      },
      // Database cluster
      {
        id: 'chunk-db-1',
        content: 'SQL databases use indexing and queries for data management.',
        type: 'text',
        metadata: { startPosition: 140, endPosition: 210, wordCount: 9, characterCount: 60, sectionId: 'sec-3' },
      },
      {
        id: 'chunk-db-2',
        content: 'Database normalization and SQL optimization improve performance.',
        type: 'text',
        metadata: { startPosition: 210, endPosition: 280, wordCount: 7, characterCount: 63, sectionId: 'sec-4' },
      },
    ];

    it('should cluster similar content together', async () => {
      await indexer.indexChunks(testKbId, testChunks);

      const clusters = await indexer.clusterContent(testKbId, 2);

      expect(clusters.size).toBe(2);

      // Total items across all clusters should equal total chunks
      let totalItems = 0;
      for (const items of clusters.values()) {
        totalItems += items.length;
      }
      expect(totalItems).toBe(4);
    });

    it('should return empty map for KB with no content', async () => {
      const clusters = await indexer.clusterContent(testKbId, 3);
      expect(clusters.size).toBe(0);
    });

    it('should handle numClusters > number of items', async () => {
      await indexer.indexChunks(testKbId, testChunks.slice(0, 2));

      // Request 5 clusters but only have 2 items
      const clusters = await indexer.clusterContent(testKbId, 5);

      // Should create at most 2 clusters
      expect(clusters.size).toBeLessThanOrEqual(2);
    });

    it('should assign each chunk to exactly one cluster', async () => {
      await indexer.indexChunks(testKbId, testChunks);

      const clusters = await indexer.clusterContent(testKbId, 3);

      const allChunkIds = new Set<string>();
      for (const items of clusters.values()) {
        for (const id of items) {
          expect(allChunkIds.has(id)).toBe(false); // No duplicates
          allChunkIds.add(id);
        }
      }
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in content', async () => {
      const chunks: ContentChunk[] = [{
        id: 'special-chars',
        content: 'Test with special chars: @#$%^&*()! "quotes" and <html> tags.',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 70, wordCount: 10, characterCount: 63, sectionId: 'sec-1' },
      }];

      await expect(indexer.indexChunks(testKbId, chunks)).resolves.toBe(1);
    });

    it('should handle very short content', async () => {
      const chunks: ContentChunk[] = [{
        id: 'short',
        content: 'Hi',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 2, wordCount: 1, characterCount: 2, sectionId: 'sec-1' },
      }];

      await expect(indexer.indexChunks(testKbId, chunks)).resolves.toBe(1);
    });

    it('should handle unicode content', async () => {
      const chunks: ContentChunk[] = [{
        id: 'unicode',
        content: 'Unicode test: 日本語 русский العربية 中文 emoji: 🚀✈️',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 60, wordCount: 5, characterCount: 50, sectionId: 'sec-1' },
      }];

      await expect(indexer.indexChunks(testKbId, chunks)).resolves.toBe(1);
    });

    it('should handle content with only stop words', async () => {
      const chunks: ContentChunk[] = [{
        id: 'stopwords',
        content: 'the is at which on a an and or but in with to',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 50, wordCount: 14, characterCount: 46, sectionId: 'sec-1' },
      }];

      await expect(indexer.indexChunks(testKbId, chunks)).resolves.toBe(1);
    });
  });
});
