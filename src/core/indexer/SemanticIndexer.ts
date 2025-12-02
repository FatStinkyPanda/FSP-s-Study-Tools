/**
 * Semantic Indexer for Vector Embeddings and Similarity Search
 *
 * Provides semantic search capabilities using TF-IDF based embeddings
 * with optional support for external embedding models via AI providers.
 *
 * This implementation uses a lightweight TF-IDF approach for local embeddings
 * that doesn't require external dependencies, while supporting integration
 * with OpenAI/Google embeddings APIs for enhanced semantic search.
 */

import { DatabaseManager } from '../database/DatabaseManager';
import { ContentChunk } from '../knowledge/ContentChunker';
import { createLogger } from '../../shared/logger';

const log = createLogger('SemanticIndexer');

export interface EmbeddingResult {
  chunkId: string;
  embedding: number[];
  metadata: {
    kbId: number;
    sectionId: string;
    moduleId?: string;
    chapterId?: string;
  };
}

export interface SemanticSearchResult {
  chunkId: string;
  content: string;
  score: number;
  metadata: {
    kbId: number;
    sectionId: string;
    moduleId?: string;
    chapterId?: string;
  };
}

export interface VocabularyEntry {
  term: string;
  df: number; // Document frequency
  idf: number; // Inverse document frequency
}

interface StoredEmbedding {
  id: number;
  kb_id: number;
  chunk_id: string;
  section_id: string;
  module_id: string;
  chapter_id: string;
  content: string;
  embedding: string; // JSON serialized number[]
  created_at: string;
}

export class SemanticIndexer {
  private vocabulary: Map<string, VocabularyEntry> = new Map();
  private documentCount: number = 0;
  private embeddingDimension: number = 512; // TF-IDF vector dimension
  private initialized: boolean = false;

  constructor(private db: DatabaseManager) {}

  /**
   * Initialize the semantic indexer and ensure database tables exist
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create embeddings table if it doesn't exist
    this.ensureEmbeddingsTable();

    // Load vocabulary from existing indexed content
    await this.loadVocabulary();

    this.initialized = true;
    log.info(`SemanticIndexer initialized with ${this.vocabulary.size} terms in vocabulary`);
  }

  /**
   * Ensure the embeddings table exists in the database
   */
  private ensureEmbeddingsTable(): void {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS content_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kb_id INTEGER NOT NULL,
        chunk_id TEXT NOT NULL,
        section_id TEXT NOT NULL,
        module_id TEXT,
        chapter_id TEXT,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        UNIQUE(kb_id, chunk_id)
      );

      CREATE INDEX IF NOT EXISTS idx_embeddings_kb ON content_embeddings(kb_id);
      CREATE INDEX IF NOT EXISTS idx_embeddings_section ON content_embeddings(kb_id, section_id);
    `;

    try {
      this.db.getDatabase().exec(createTableSQL);
    } catch (error) {
      // Table might already exist, which is fine
      log.debug('Embeddings table check complete');
    }
  }

  /**
   * Load vocabulary from indexed content for TF-IDF calculations
   */
  private async loadVocabulary(): Promise<void> {
    try {
      const rows = this.db.query<{ content: string }>(
        'SELECT content FROM content_embeddings'
      );

      this.documentCount = rows.length;

      // Build term frequency across all documents
      const termDocFreq = new Map<string, number>();

      for (const row of rows) {
        const terms = this.tokenize(row.content);
        const uniqueTerms = new Set(terms);

        for (const term of uniqueTerms) {
          termDocFreq.set(term, (termDocFreq.get(term) || 0) + 1);
        }
      }

      // Calculate IDF for each term
      for (const [term, df] of termDocFreq) {
        const idf = Math.log((this.documentCount + 1) / (df + 1)) + 1;
        this.vocabulary.set(term, { term, df, idf });
      }
    } catch (error) {
      log.debug('No existing embeddings found, starting with empty vocabulary');
    }
  }

  /**
   * Index content chunks for semantic search
   */
  async indexChunks(kbId: number, chunks: ContentChunk[]): Promise<number> {
    await this.initialize();

    let indexedCount = 0;

    this.db.beginTransaction();

    try {
      for (const chunk of chunks) {
        // Generate embedding using TF-IDF
        const embedding = this.generateTFIDFEmbedding(chunk.content);

        // Store in database
        this.db.execute(
          `INSERT OR REPLACE INTO content_embeddings
           (kb_id, chunk_id, section_id, module_id, chapter_id, content, embedding)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            kbId,
            chunk.id,
            chunk.metadata.sectionId || '',
            chunk.metadata.moduleId || '',
            chunk.metadata.chapterId || '',
            chunk.content,
            JSON.stringify(embedding),
          ]
        );

        // Update vocabulary with new terms
        this.updateVocabulary(chunk.content);

        indexedCount++;
      }

      this.db.commitTransaction();
      log.info(`Indexed ${indexedCount} chunks for KB ${kbId}`);

      return indexedCount;
    } catch (error) {
      this.db.rollbackTransaction();
      throw new Error(`Failed to index chunks: ${(error as Error).message}`);
    }
  }

  /**
   * Generate TF-IDF embedding vector for text
   */
  private generateTFIDFEmbedding(text: string): number[] {
    const terms = this.tokenize(text);
    const termFreq = new Map<string, number>();

    // Calculate term frequency
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) || 0) + 1);
    }

    // Normalize TF values
    const maxFreq = Math.max(...termFreq.values(), 1);

    // Create embedding vector using hashing trick for fixed dimension
    const embedding = new Array(this.embeddingDimension).fill(0);

    for (const [term, freq] of termFreq) {
      const tf = freq / maxFreq;
      const vocabEntry = this.vocabulary.get(term);
      const idf = vocabEntry?.idf || Math.log(this.documentCount + 2);
      const tfidf = tf * idf;

      // Use multiple hash functions for better distribution
      const hash1 = this.hashString(term) % this.embeddingDimension;
      const hash2 = this.hashString(term + '_2') % this.embeddingDimension;
      const hash3 = this.hashString(term + '_3') % this.embeddingDimension;

      // Add to embedding with sign based on secondary hash
      const sign = this.hashString(term + '_sign') % 2 === 0 ? 1 : -1;
      embedding[hash1] += tfidf * sign;
      embedding[hash2] += tfidf * sign * 0.5;
      embedding[hash3] += tfidf * sign * 0.25;
    }

    // L2 normalize the embedding
    return this.normalizeVector(embedding);
  }

  /**
   * Tokenize text into terms
   */
  private tokenize(text: string): string[] {
    // Stop words to filter out
    const stopWords = new Set([
      'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in',
      'with', 'to', 'for', 'of', 'as', 'by', 'that', 'this', 'it', 'from',
      'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
      'can', 'must', 'shall', 'not', 'no', 'yes', 'all', 'any', 'some', 'such',
      'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 2 && !stopWords.has(term))
      .map(term => this.stem(term));
  }

  /**
   * Simple Porter-like stemming
   */
  private stem(word: string): string {
    // Simple suffix stripping for common English patterns
    const suffixes = ['ing', 'ed', 'es', 's', 'ly', 'tion', 'ment', 'ness', 'able', 'ible'];

    for (const suffix of suffixes) {
      if (word.endsWith(suffix) && word.length > suffix.length + 2) {
        return word.slice(0, -suffix.length);
      }
    }

    return word;
  }

  /**
   * Hash string to integer (DJB2 algorithm)
   */
  private hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash >>> 0; // Convert to unsigned 32-bit integer
    }
    return hash;
  }

  /**
   * L2 normalize a vector
   */
  private normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    return vector.map(val => val / magnitude);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) return 0;

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Update vocabulary with new terms
   */
  private updateVocabulary(text: string): void {
    const terms = this.tokenize(text);
    const uniqueTerms = new Set(terms);

    this.documentCount++;

    for (const term of uniqueTerms) {
      const existing = this.vocabulary.get(term);
      const newDf = (existing?.df || 0) + 1;
      const newIdf = Math.log((this.documentCount + 1) / (newDf + 1)) + 1;

      this.vocabulary.set(term, { term, df: newDf, idf: newIdf });
    }
  }

  /**
   * Perform semantic search within a knowledge base
   */
  async search(
    kbId: number,
    query: string,
    limit: number = 10,
    minScore: number = 0.1
  ): Promise<SemanticSearchResult[]> {
    await this.initialize();

    // Generate query embedding
    const queryEmbedding = this.generateTFIDFEmbedding(query);

    // Get all embeddings for the knowledge base
    const rows = this.db.query<StoredEmbedding>(
      'SELECT * FROM content_embeddings WHERE kb_id = ?',
      [kbId]
    );

    // Calculate similarities
    const results: SemanticSearchResult[] = [];

    for (const row of rows) {
      const embedding = JSON.parse(row.embedding) as number[];
      const score = this.cosineSimilarity(queryEmbedding, embedding);

      if (score >= minScore) {
        results.push({
          chunkId: row.chunk_id,
          content: row.content,
          score,
          metadata: {
            kbId: row.kb_id,
            sectionId: row.section_id,
            moduleId: row.module_id,
            chapterId: row.chapter_id,
          },
        });
      }
    }

    // Sort by score descending and limit results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Perform semantic search across all knowledge bases
   */
  async searchAll(
    query: string,
    limit: number = 20,
    minScore: number = 0.1
  ): Promise<SemanticSearchResult[]> {
    await this.initialize();

    // Generate query embedding
    const queryEmbedding = this.generateTFIDFEmbedding(query);

    // Get all embeddings
    const rows = this.db.query<StoredEmbedding>(
      'SELECT * FROM content_embeddings'
    );

    // Calculate similarities
    const results: SemanticSearchResult[] = [];

    for (const row of rows) {
      const embedding = JSON.parse(row.embedding) as number[];
      const score = this.cosineSimilarity(queryEmbedding, embedding);

      if (score >= minScore) {
        results.push({
          chunkId: row.chunk_id,
          content: row.content,
          score,
          metadata: {
            kbId: row.kb_id,
            sectionId: row.section_id,
            moduleId: row.module_id,
            chapterId: row.chapter_id,
          },
        });
      }
    }

    // Sort by score descending and limit results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Find similar content to a given chunk
   */
  async findSimilar(
    kbId: number,
    chunkId: string,
    limit: number = 5
  ): Promise<SemanticSearchResult[]> {
    await this.initialize();

    // Get the source chunk's embedding
    const sourceRows = this.db.query<StoredEmbedding>(
      'SELECT * FROM content_embeddings WHERE kb_id = ? AND chunk_id = ?',
      [kbId, chunkId]
    );

    if (sourceRows.length === 0) {
      return [];
    }

    const sourceEmbedding = JSON.parse(sourceRows[0].embedding) as number[];

    // Get all other embeddings in the same KB
    const rows = this.db.query<StoredEmbedding>(
      'SELECT * FROM content_embeddings WHERE kb_id = ? AND chunk_id != ?',
      [kbId, chunkId]
    );

    // Calculate similarities
    const results: SemanticSearchResult[] = [];

    for (const row of rows) {
      const embedding = JSON.parse(row.embedding) as number[];
      const score = this.cosineSimilarity(sourceEmbedding, embedding);

      results.push({
        chunkId: row.chunk_id,
        content: row.content,
        score,
        metadata: {
          kbId: row.kb_id,
          sectionId: row.section_id,
          moduleId: row.module_id,
          chapterId: row.chapter_id,
        },
      });
    }

    // Sort by score descending and limit results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Delete all embeddings for a knowledge base
   */
  async deleteKBEmbeddings(kbId: number): Promise<number> {
    const result = this.db.execute(
      'DELETE FROM content_embeddings WHERE kb_id = ?',
      [kbId]
    );
    return result.changes;
  }

  /**
   * Get embedding statistics for a knowledge base
   */
  async getStats(kbId?: number): Promise<{
    totalChunks: number;
    vocabularySize: number;
    averageEmbeddingDensity: number;
  }> {
    await this.initialize();

    let query = 'SELECT COUNT(*) as count FROM content_embeddings';
    const params: unknown[] = [];

    if (kbId !== undefined) {
      query += ' WHERE kb_id = ?';
      params.push(kbId);
    }

    const rows = this.db.query<{ count: number }>(query, params);
    const totalChunks = rows[0]?.count || 0;

    return {
      totalChunks,
      vocabularySize: this.vocabulary.size,
      averageEmbeddingDensity: this.embeddingDimension,
    };
  }

  /**
   * Re-index all content with fresh vocabulary
   * Useful after significant content additions
   */
  async reindexAll(): Promise<number> {
    await this.initialize();

    // Get all current content
    const rows = this.db.query<StoredEmbedding>(
      'SELECT * FROM content_embeddings'
    );

    if (rows.length === 0) return 0;

    // Rebuild vocabulary from scratch
    this.vocabulary.clear();
    this.documentCount = 0;

    // First pass: build vocabulary
    for (const row of rows) {
      const terms = this.tokenize(row.content);
      const uniqueTerms = new Set(terms);

      this.documentCount++;

      for (const term of uniqueTerms) {
        const existing = this.vocabulary.get(term);
        const newDf = (existing?.df || 0) + 1;
        this.vocabulary.set(term, { term, df: newDf, idf: 0 });
      }
    }

    // Calculate IDF values
    for (const [_term, entry] of this.vocabulary) {
      entry.idf = Math.log((this.documentCount + 1) / (entry.df + 1)) + 1;
    }

    // Second pass: regenerate embeddings
    this.db.beginTransaction();

    try {
      for (const row of rows) {
        const newEmbedding = this.generateTFIDFEmbedding(row.content);

        this.db.execute(
          `UPDATE content_embeddings SET embedding = ? WHERE id = ?`,
          [JSON.stringify(newEmbedding), row.id]
        );
      }

      this.db.commitTransaction();
      log.info(`Re-indexed ${rows.length} chunks`);
      return rows.length;
    } catch (error) {
      this.db.rollbackTransaction();
      throw new Error(`Failed to re-index: ${(error as Error).message}`);
    }
  }

  /**
   * Cluster content by similarity (simple K-means-like approach)
   */
  async clusterContent(
    kbId: number,
    numClusters: number = 5
  ): Promise<Map<number, string[]>> {
    await this.initialize();

    const rows = this.db.query<StoredEmbedding>(
      'SELECT * FROM content_embeddings WHERE kb_id = ?',
      [kbId]
    );

    if (rows.length === 0) return new Map();

    // Parse all embeddings
    const embeddings: { id: string; vector: number[] }[] = rows.map(row => ({
      id: row.chunk_id,
      vector: JSON.parse(row.embedding) as number[],
    }));

    // Simple K-means clustering
    const clusters = this.kMeans(embeddings, numClusters);

    return clusters;
  }

  /**
   * Simple K-means clustering implementation
   */
  private kMeans(
    items: { id: string; vector: number[] }[],
    k: number,
    maxIterations: number = 50
  ): Map<number, string[]> {
    if (items.length === 0 || k <= 0) return new Map();

    const n = items.length;
    k = Math.min(k, n);

    // Initialize centroids randomly
    const centroids: number[][] = [];
    const usedIndices = new Set<number>();

    while (centroids.length < k) {
      const idx = Math.floor(Math.random() * n);
      if (!usedIndices.has(idx)) {
        usedIndices.add(idx);
        centroids.push([...items[idx].vector]);
      }
    }

    // Assign items to clusters
    let assignments = new Array(n).fill(0);

    for (let iter = 0; iter < maxIterations; iter++) {
      // Assign each item to nearest centroid
      const newAssignments = items.map((item, _idx) => {
        let bestCluster = 0;
        let bestScore = -Infinity;

        for (let c = 0; c < k; c++) {
          const score = this.cosineSimilarity(item.vector, centroids[c]);
          if (score > bestScore) {
            bestScore = score;
            bestCluster = c;
          }
        }

        return bestCluster;
      });

      // Check for convergence
      let changed = false;
      for (let i = 0; i < n; i++) {
        if (newAssignments[i] !== assignments[i]) {
          changed = true;
          break;
        }
      }

      assignments = newAssignments;

      if (!changed) break;

      // Update centroids
      for (let c = 0; c < k; c++) {
        const clusterItems = items.filter((_, idx) => assignments[idx] === c);

        if (clusterItems.length > 0) {
          const newCentroid = new Array(this.embeddingDimension).fill(0);

          for (const item of clusterItems) {
            for (let d = 0; d < this.embeddingDimension; d++) {
              newCentroid[d] += item.vector[d];
            }
          }

          for (let d = 0; d < this.embeddingDimension; d++) {
            newCentroid[d] /= clusterItems.length;
          }

          centroids[c] = this.normalizeVector(newCentroid);
        }
      }
    }

    // Build result map
    const result = new Map<number, string[]>();
    for (let c = 0; c < k; c++) {
      result.set(c, []);
    }

    for (let i = 0; i < n; i++) {
      result.get(assignments[i])?.push(items[i].id);
    }

    return result;
  }
}
