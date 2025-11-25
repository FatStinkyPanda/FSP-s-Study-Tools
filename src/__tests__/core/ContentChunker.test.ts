/**
 * Unit tests for ContentChunker
 */
import { ContentChunker, ContentChunk, ChunkingOptions } from '../../core/knowledge/ContentChunker';

describe('ContentChunker', () => {
  let chunker: ContentChunker;

  beforeEach(() => {
    chunker = new ContentChunker();
  });

  describe('chunkText', () => {
    it('should return empty array for empty or whitespace text', () => {
      expect(chunker.chunkText('')).toEqual([]);
      expect(chunker.chunkText('   ')).toEqual([]);
      expect(chunker.chunkText('\n\n')).toEqual([]);
    });

    it('should create chunks from simple text', () => {
      const text = 'This is a test paragraph.\n\nThis is another paragraph.';
      const chunks = chunker.chunkText(text);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].content).toBeTruthy();
      expect(chunks[0].type).toBe('text');
    });

    it('should respect maxChunkSize option', () => {
      const longText = 'A'.repeat(500) + '\n\n' + 'B'.repeat(500) + '\n\n' + 'C'.repeat(500);
      const chunks = chunker.chunkText(longText, {}, { maxChunkSize: 600, preserveStructure: false });

      chunks.forEach(chunk => {
        // Allow some flexibility due to overlap
        expect(chunk.content.length).toBeLessThanOrEqual(700);
      });
    });

    it('should preserve structure when option is enabled', () => {
      const text = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.';
      const chunks = chunker.chunkText(text, {}, { preserveStructure: true, splitOn: 'paragraph' });

      // Each chunk should roughly correspond to paragraphs
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should include metadata in chunks', () => {
      const text = 'Test content for metadata checking.';
      const metadata = { sectionId: 'sec-1', chapterId: 'ch-1' };
      const chunks = chunker.chunkText(text, metadata);

      expect(chunks[0].metadata.sectionId).toBe('sec-1');
      expect(chunks[0].metadata.chapterId).toBe('ch-1');
      expect(chunks[0].metadata.wordCount).toBeGreaterThan(0);
      expect(chunks[0].metadata.characterCount).toBeGreaterThan(0);
    });

    it('should handle sentence splitting', () => {
      const text = 'First sentence. Second sentence! Third sentence?';
      const chunks = chunker.chunkText(text, {}, {
        splitOn: 'sentence',
        maxChunkSize: 50,
        minChunkSize: 10,
        preserveStructure: true
      });

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('content type detection', () => {
    it('should detect code blocks', () => {
      const codeText = '```javascript\nconst x = 1;\n```';
      const chunks = chunker.chunkText(codeText);

      expect(chunks[0].type).toBe('code');
    });

    it('should detect function declarations as code', () => {
      const codeText = 'function myFunction() { return true; }';
      const chunks = chunker.chunkText(codeText);

      expect(chunks[0].type).toBe('code');
    });

    it('should detect class declarations as code', () => {
      const codeText = 'class MyClass { constructor() {} }';
      const chunks = chunker.chunkText(codeText);

      expect(chunks[0].type).toBe('code');
    });

    it('should detect tables', () => {
      const tableText = '| Col1 | Col2 |\n|------|------|\n| A    | B    |\n| C    | D    |';
      const chunks = chunker.chunkText(tableText);

      expect(chunks[0].type).toBe('table');
    });

    it('should detect unordered lists', () => {
      const listText = '- Item 1\n- Item 2\n- Item 3';
      const chunks = chunker.chunkText(listText);

      expect(chunks[0].type).toBe('list');
    });

    it('should detect ordered lists', () => {
      const listText = '1. First item\n2. Second item\n3. Third item';
      const chunks = chunker.chunkText(listText);

      expect(chunks[0].type).toBe('list');
    });

    it('should detect headings', () => {
      const headingText = '# Main Heading\n\nSome content here.';
      const chunks = chunker.chunkText(headingText, {}, { splitOn: 'section' });

      // The first chunk should be detected as heading
      const headingChunk = chunks.find(c => c.type === 'heading');
      expect(headingChunk).toBeTruthy();
    });
  });

  describe('mergeChunks', () => {
    it('should merge chunks in order by startPosition', () => {
      const chunks: ContentChunk[] = [
        {
          id: 'chunk-1',
          content: 'Second chunk',
          type: 'text',
          metadata: { startPosition: 100, endPosition: 200, wordCount: 2, characterCount: 12 }
        },
        {
          id: 'chunk-0',
          content: 'First chunk',
          type: 'text',
          metadata: { startPosition: 0, endPosition: 100, wordCount: 2, characterCount: 11 }
        }
      ];

      const merged = chunker.mergeChunks(chunks);

      expect(merged).toContain('First chunk');
      expect(merged.indexOf('First chunk')).toBeLessThan(merged.indexOf('Second chunk'));
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', () => {
      const chunks: ContentChunk[] = [
        {
          id: 'chunk-1',
          content: 'Text chunk',
          type: 'text',
          metadata: { startPosition: 0, endPosition: 10, wordCount: 2, characterCount: 10 }
        },
        {
          id: 'chunk-2',
          content: 'Code chunk',
          type: 'code',
          metadata: { startPosition: 10, endPosition: 20, wordCount: 2, characterCount: 10 }
        },
        {
          id: 'chunk-3',
          content: 'Another text',
          type: 'text',
          metadata: { startPosition: 20, endPosition: 32, wordCount: 2, characterCount: 12 }
        }
      ];

      const stats = chunker.getStatistics(chunks);

      expect(stats.totalChunks).toBe(3);
      expect(stats.totalCharacters).toBe(32);
      expect(stats.totalWords).toBe(6);
      expect(stats.averageChunkSize).toBe(11); // Math.round(32/3)
      expect(stats.types.text).toBe(2);
      expect(stats.types.code).toBe(1);
    });

    it('should handle empty chunk array', () => {
      const stats = chunker.getStatistics([]);

      expect(stats.totalChunks).toBe(0);
      expect(stats.totalCharacters).toBe(0);
      expect(stats.totalWords).toBe(0);
      expect(stats.averageChunkSize).toBe(0);
    });
  });

  describe('findChunks', () => {
    const testChunks: ContentChunk[] = [
      {
        id: 'chunk-1',
        content: 'The quick brown fox jumps over the lazy dog.',
        type: 'text',
        metadata: { startPosition: 0, endPosition: 44, wordCount: 9, characterCount: 44 }
      },
      {
        id: 'chunk-2',
        content: 'Pack my box with five dozen liquor jugs.',
        type: 'text',
        metadata: { startPosition: 44, endPosition: 84, wordCount: 8, characterCount: 40 }
      }
    ];

    it('should find chunks containing search text (case insensitive)', () => {
      const results = chunker.findChunks(testChunks, 'FOX');

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('chunk-1');
    });

    it('should find chunks with case sensitive search', () => {
      const results = chunker.findChunks(testChunks, 'FOX', true);

      expect(results.length).toBe(0);
    });

    it('should return empty array when no matches', () => {
      const results = chunker.findChunks(testChunks, 'elephant');

      expect(results.length).toBe(0);
    });
  });

  describe('filterByType', () => {
    const mixedChunks: ContentChunk[] = [
      { id: '1', content: 'text', type: 'text', metadata: { startPosition: 0, endPosition: 4, wordCount: 1, characterCount: 4 } },
      { id: '2', content: 'code', type: 'code', metadata: { startPosition: 4, endPosition: 8, wordCount: 1, characterCount: 4 } },
      { id: '3', content: 'text2', type: 'text', metadata: { startPosition: 8, endPosition: 13, wordCount: 1, characterCount: 5 } },
    ];

    it('should filter chunks by type', () => {
      const textChunks = chunker.filterByType(mixedChunks, 'text');
      const codeChunks = chunker.filterByType(mixedChunks, 'code');

      expect(textChunks.length).toBe(2);
      expect(codeChunks.length).toBe(1);
    });
  });

  describe('filterByWordCount', () => {
    const chunks: ContentChunk[] = [
      { id: '1', content: 'short', type: 'text', metadata: { startPosition: 0, endPosition: 5, wordCount: 5, characterCount: 5 } },
      { id: '2', content: 'medium length', type: 'text', metadata: { startPosition: 5, endPosition: 18, wordCount: 15, characterCount: 13 } },
      { id: '3', content: 'very long content', type: 'text', metadata: { startPosition: 18, endPosition: 35, wordCount: 30, characterCount: 17 } },
    ];

    it('should filter chunks by word count range', () => {
      const results = chunker.filterByWordCount(chunks, 10, 20);

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('2');
    });
  });

  describe('extractKeywords', () => {
    it('should extract most frequent words', () => {
      const chunks: ContentChunk[] = [
        {
          id: '1',
          content: 'programming programming programming code code javascript',
          type: 'text',
          metadata: { startPosition: 0, endPosition: 56, wordCount: 6, characterCount: 56 }
        }
      ];

      const keywords = chunker.extractKeywords(chunks, 5);

      expect(keywords.length).toBeGreaterThan(0);
      expect(keywords[0].word).toBe('programming');
      expect(keywords[0].frequency).toBe(3);
    });

    it('should exclude stop words', () => {
      const chunks: ContentChunk[] = [
        {
          id: '1',
          content: 'the the the is is a an and or but programming',
          type: 'text',
          metadata: { startPosition: 0, endPosition: 47, wordCount: 11, characterCount: 47 }
        }
      ];

      const keywords = chunker.extractKeywords(chunks, 10);
      const stopWords = ['the', 'is', 'a', 'an', 'and', 'or', 'but'];

      keywords.forEach(kw => {
        expect(stopWords).not.toContain(kw.word);
      });
    });

    it('should exclude short words (3 chars or less)', () => {
      const chunks: ContentChunk[] = [
        {
          id: '1',
          content: 'go go go run run javascript typescript',
          type: 'text',
          metadata: { startPosition: 0, endPosition: 38, wordCount: 7, characterCount: 38 }
        }
      ];

      const keywords = chunker.extractKeywords(chunks, 10);

      keywords.forEach(kw => {
        expect(kw.word.length).toBeGreaterThan(3);
      });
    });
  });
});
