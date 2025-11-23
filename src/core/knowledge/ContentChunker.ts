/**
 * Content Chunking System
 * Breaks down large content into manageable chunks for better processing,
 * search indexing, and AI interactions
 */

export interface ContentChunk {
  id: string;
  content: string;
  type: 'text' | 'code' | 'table' | 'list' | 'heading';
  metadata: {
    sectionId?: string;
    chapterId?: string;
    moduleId?: string;
    startPosition: number;
    endPosition: number;
    wordCount: number;
    characterCount: number;
  };
  embedding?: number[]; // For future AI embeddings
}

export interface ChunkingOptions {
  maxChunkSize?: number; // Maximum characters per chunk
  minChunkSize?: number; // Minimum characters per chunk
  overlap?: number; // Character overlap between chunks
  preserveStructure?: boolean; // Try to preserve paragraphs/sections
  splitOn?: 'sentence' | 'paragraph' | 'section';
}

export class ContentChunker {
  private readonly defaultOptions: Required<ChunkingOptions> = {
    maxChunkSize: 1000,
    minChunkSize: 200,
    overlap: 100,
    preserveStructure: true,
    splitOn: 'paragraph',
  };

  /**
   * Chunk text content into smaller pieces
   */
  chunkText(
    text: string,
    metadata: Partial<ContentChunk['metadata']> = {},
    options: ChunkingOptions = {}
  ): ContentChunk[] {
    const opts = { ...this.defaultOptions, ...options };

    if (!text || text.trim().length === 0) {
      return [];
    }

    const chunks: ContentChunk[] = [];

    if (opts.preserveStructure) {
      // Try to split on natural boundaries
      const segments = this.splitOnBoundaries(text, opts.splitOn);
      let currentChunk = '';
      let startPosition = 0;

      for (const segment of segments) {
        if (currentChunk.length + segment.length > opts.maxChunkSize && currentChunk.length > 0) {
          // Save current chunk
          chunks.push(this.createChunk(currentChunk, startPosition, metadata));

          // Start new chunk with overlap
          if (opts.overlap > 0) {
            const overlapText = currentChunk.slice(-opts.overlap);
            currentChunk = overlapText + segment;
            startPosition = startPosition + currentChunk.length - overlapText.length - segment.length;
          } else {
            currentChunk = segment;
            startPosition = startPosition + currentChunk.length;
          }
        } else {
          currentChunk += segment;
        }
      }

      // Add remaining chunk
      if (currentChunk.trim().length >= opts.minChunkSize) {
        chunks.push(this.createChunk(currentChunk, startPosition, metadata));
      }
    } else {
      // Simple character-based chunking
      const simpleChunks = this.simpleChunk(text, opts.maxChunkSize, opts.overlap);
      let position = 0;

      for (const chunkText of simpleChunks) {
        chunks.push(this.createChunk(chunkText, position, metadata));
        position += chunkText.length - opts.overlap;
      }
    }

    return chunks;
  }

  /**
   * Split text on natural boundaries (sentences, paragraphs, sections)
   */
  private splitOnBoundaries(text: string, splitOn: 'sentence' | 'paragraph' | 'section'): string[] {
    switch (splitOn) {
      case 'sentence':
        return this.splitSentences(text);

      case 'paragraph':
        return this.splitParagraphs(text);

      case 'section':
        return this.splitSections(text);

      default:
        return this.splitParagraphs(text);
    }
  }

  /**
   * Split text into sentences
   */
  private splitSentences(text: string): string[] {
    // Split on sentence boundaries (.!?) but preserve the delimiter
    const sentences = text.split(/(?<=[.!?])\s+/);
    return sentences.filter(s => s.trim().length > 0);
  }

  /**
   * Split text into paragraphs
   */
  private splitParagraphs(text: string): string[] {
    const paragraphs = text.split(/\n\s*\n/);
    return paragraphs.filter(p => p.trim().length > 0).map(p => p.trim() + '\n\n');
  }

  /**
   * Split text into sections (based on headers)
   */
  private splitSections(text: string): string[] {
    // Split on markdown-style headers or common section markers
    const sections = text.split(/(?=^#{1,6}\s+.+$)/m);
    return sections.filter(s => s.trim().length > 0);
  }

  /**
   * Simple character-based chunking
   */
  private simpleChunk(text: string, maxSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    let position = 0;

    while (position < text.length) {
      const end = Math.min(position + maxSize, text.length);
      chunks.push(text.substring(position, end));
      position = end - overlap;
    }

    return chunks;
  }

  /**
   * Create a ContentChunk object
   */
  private createChunk(
    content: string,
    startPosition: number,
    metadata: Partial<ContentChunk['metadata']>
  ): ContentChunk {
    const type = this.detectContentType(content);
    const wordCount = this.countWords(content);

    return {
      id: this.generateChunkId(startPosition),
      content: content.trim(),
      type,
      metadata: {
        ...metadata,
        startPosition,
        endPosition: startPosition + content.length,
        wordCount,
        characterCount: content.length,
      },
    };
  }

  /**
   * Detect content type (text, code, table, etc.)
   */
  private detectContentType(content: string): ContentChunk['type'] {
    const trimmed = content.trim();

    // Check for code blocks
    if (trimmed.startsWith('```') || trimmed.includes('function ') || trimmed.includes('class ')) {
      return 'code';
    }

    // Check for tables (markdown or pipe-separated)
    if (trimmed.includes('|') && trimmed.split('\n').filter(line => line.includes('|')).length > 2) {
      return 'table';
    }

    // Check for lists
    if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      return 'list';
    }

    // Check for headings
    if (/^#{1,6}\s/.test(trimmed)) {
      return 'heading';
    }

    return 'text';
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).length;
  }

  /**
   * Generate unique chunk ID
   */
  private generateChunkId(startPosition: number): string {
    return `chunk-${startPosition}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Merge chunks back into continuous text
   */
  mergeChunks(chunks: ContentChunk[]): string {
    return chunks
      .sort((a, b) => a.metadata.startPosition - b.metadata.startPosition)
      .map(chunk => chunk.content)
      .join('\n');
  }

  /**
   * Get chunk statistics
   */
  getStatistics(chunks: ContentChunk[]): {
    totalChunks: number;
    totalCharacters: number;
    totalWords: number;
    averageChunkSize: number;
    types: Record<ContentChunk['type'], number>;
  } {
    const stats = {
      totalChunks: chunks.length,
      totalCharacters: 0,
      totalWords: 0,
      averageChunkSize: 0,
      types: {
        text: 0,
        code: 0,
        table: 0,
        list: 0,
        heading: 0,
      },
    };

    for (const chunk of chunks) {
      stats.totalCharacters += chunk.metadata.characterCount;
      stats.totalWords += chunk.metadata.wordCount;
      stats.types[chunk.type]++;
    }

    stats.averageChunkSize = chunks.length > 0 ? Math.round(stats.totalCharacters / chunks.length) : 0;

    return stats;
  }

  /**
   * Find chunks containing specific text
   */
  findChunks(chunks: ContentChunk[], searchText: string, caseSensitive = false): ContentChunk[] {
    const search = caseSensitive ? searchText : searchText.toLowerCase();

    return chunks.filter(chunk => {
      const content = caseSensitive ? chunk.content : chunk.content.toLowerCase();
      return content.includes(search);
    });
  }

  /**
   * Filter chunks by type
   */
  filterByType(chunks: ContentChunk[], type: ContentChunk['type']): ContentChunk[] {
    return chunks.filter(chunk => chunk.type === type);
  }

  /**
   * Get chunks within a word count range
   */
  filterByWordCount(chunks: ContentChunk[], min: number, max: number): ContentChunk[] {
    return chunks.filter(chunk =>
      chunk.metadata.wordCount >= min && chunk.metadata.wordCount <= max
    );
  }

  /**
   * Extract keywords from chunks using simple frequency analysis
   */
  extractKeywords(chunks: ContentChunk[], topN = 10): Array<{ word: string; frequency: number }> {
    const wordFrequency = new Map<string, number>();
    const stopWords = new Set([
      'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with',
      'to', 'for', 'of', 'as', 'by', 'that', 'this', 'it', 'from', 'are', 'was', 'were',
    ]);

    for (const chunk of chunks) {
      const words = chunk.content
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(word => word.length > 3 && !stopWords.has(word));

      for (const word of words) {
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
      }
    }

    return Array.from(wordFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([word, frequency]) => ({ word, frequency }));
  }
}
