import { DatabaseManager } from '../database/DatabaseManager';
import { XMLParser, ParsedKnowledgeBase } from './XMLParser';
import { ContentChunker } from './ContentChunker';
import { SemanticIndexer, SemanticSearchResult } from '../indexer';
import { KnowledgeBase } from '../../shared/types';
import { ParserManager, ParsedDocument } from '../parser';
import { createLogger } from '../../shared/logger';

const log = createLogger('KnowledgeBaseManager');

export interface IndexedContent {
  chunkId: string;
  content: string;
  metadata: {
    kbId: number;
    moduleId: string;
    chapterId: string;
    sectionId: string;
    type: string;
  };
}

export class KnowledgeBaseManager {
  private xmlParser: XMLParser;
  private chunker: ContentChunker;
  private parserManager: ParserManager;
  private semanticIndexer: SemanticIndexer;

  constructor(private db: DatabaseManager) {
    this.xmlParser = new XMLParser();
    this.chunker = new ContentChunker();
    this.parserManager = new ParserManager();
    this.semanticIndexer = new SemanticIndexer(db);
  }

  /**
   * Import knowledge base from XML file
   */
  async importFromXML(xmlContent: string, filePath?: string): Promise<number> {
    try {
      // Parse XML
      const parsed = await this.xmlParser.parseKnowledgeBase(xmlContent);

      // Validate structure
      const validation = this.xmlParser.validateStructure(parsed);
      if (!validation.valid) {
        throw new Error(`Invalid XML structure: ${validation.errors.join(', ')}`);
      }

      // Log warnings if any
      if (validation.warnings.length > 0) {
        log.warn('XML validation warnings:', validation.warnings);
      }

      // Create knowledge base entry
      const kbId = await this.createKnowledgeBase({
        uuid: parsed.metadata.uuid,
        title: parsed.metadata.title,
        xml_content: xmlContent,
        metadata: {
          version: parsed.metadata.version,
          author: parsed.metadata.author,
          description: parsed.metadata.description,
          category: parsed.metadata.category,
          tags: parsed.metadata.tags,
          filePath,
          totalModules: parsed.modules.length,
          totalChapters: parsed.totalChapters,
          totalSections: parsed.totalSections,
          totalQuestions: parsed.totalQuestions,
        },
      });

      // Index content for full-text search
      await this.indexKnowledgeBase(kbId, parsed);

      return kbId;
    } catch (error) {
      throw new Error(`Failed to import XML: ${(error as Error).message}`);
    }
  }

  /**
   * Import knowledge base from document file (PDF, DOCX, TXT)
   */
  async importFromDocument(filePath: string): Promise<number> {
    try {
      log.info(`Importing document: ${filePath}`);

      // Check if file type is supported
      if (!this.parserManager.isSupported(filePath)) {
        throw new Error(
          `Unsupported file type. Supported formats: ${this.parserManager
            .getSupportedExtensions()
            .join(', ')}`
        );
      }

      // Parse document
      log.debug('Parsing document...');
      const parsed = await this.parserManager.parseFile(filePath);

      // Validate parsed document has content
      if (!parsed || !parsed.text || parsed.text.trim().length === 0) {
        throw new Error(
          'Document appears to be empty or contains no extractable text. Please ensure the document contains readable content.'
        );
      }

      log.debug(`Extracted ${parsed.text.length} characters from document`);

      // Log warnings if any
      if (parsed.warnings && parsed.warnings.length > 0) {
        log.warn('Document parsing warnings:', parsed.warnings);
      }

      // Convert to XML format
      log.debug('Converting to knowledge base format...');
      const xmlContent = this.convertDocumentToXML(parsed);

      // Validate XML was generated
      if (!xmlContent || xmlContent.trim().length === 0) {
        throw new Error('Failed to generate XML from document');
      }

      log.debug(`Generated XML (${xmlContent.length} characters)`);

      // Import as XML
      log.debug('Importing as XML...');
      return await this.importFromXML(xmlContent, filePath);
    } catch (error) {
      throw new Error(`Failed to import document: ${(error as Error).message}`);
    }
  }

  /**
   * Convert parsed document to XML format
   */
  private convertDocumentToXML(doc: ParsedDocument): string {
    try {
      if (!doc || !doc.text) {
        throw new Error('Invalid document: missing text content');
      }

      const uuid = this.generateUUID();
      const title = doc.metadata.title || 'Imported Document';
      const author = doc.metadata.author || 'Unknown';

      // Extract images from elements
      const images = (doc.elements || [])
        .filter(el => el.type === 'image' && el.src)
        .map((el, idx) => ({
          src: el.src!,
          alt: el.alt || `Image ${idx + 1}`,
          order: idx,
        }));

      if (images.length > 0) {
        log.debug(`Converting document with ${images.length} images`);
      }

      // Split document into sections based on paragraphs
      const paragraphs = doc.text
        .split(/\n\n+/)
        .map(p => p.trim())
        .filter(p => p.length > 0);

      // Ensure we have at least some content
      if (paragraphs.length === 0) {
        throw new Error('Document contains no readable paragraphs');
      }

      // Group paragraphs into sections (roughly 500 words each)
      const sections: { paragraphs: string[]; images: typeof images }[] = [];
      let currentSection: string[] = [];
      let wordCount = 0;

      for (const para of paragraphs) {
        const paraWords = para.split(/\s+/).length;

        if (wordCount + paraWords > 500 && currentSection.length > 0) {
          sections.push({ paragraphs: currentSection, images: [] });
          currentSection = [para];
          wordCount = paraWords;
        } else {
          currentSection.push(para);
          wordCount += paraWords;
        }
      }

      if (currentSection.length > 0) {
        sections.push({ paragraphs: currentSection, images: [] });
      }

      // Distribute images across sections (roughly evenly)
      if (images.length > 0 && sections.length > 0) {
        const imagesPerSection = Math.ceil(images.length / sections.length);
        for (let i = 0; i < images.length; i++) {
          const sectionIdx = Math.min(Math.floor(i / imagesPerSection), sections.length - 1);
          sections[sectionIdx].images.push(images[i]);
        }
      }

      // Build XML
      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<knowledge_base>\n`;
      xml += `  <metadata>\n`;
      xml += `    <uuid>${this.escapeXML(uuid)}</uuid>\n`;
      xml += `    <title>${this.escapeXML(title)}</title>\n`;
      xml += `    <version>1.0</version>\n`;
      xml += `    <author>${this.escapeXML(author)}</author>\n`;
      xml += `    <description>Imported from ${this.escapeXML(doc.filePath)}</description>\n`;
      xml += `    <category>imported</category>\n`;
      xml += `  </metadata>\n\n`;

      xml += `  <modules>\n`;
      xml += `    <module id="main">\n`;
      xml += `      <title>${this.escapeXML(title)}</title>\n`;
      xml += `      <description>Content from imported document</description>\n`;
      xml += `      <chapters>\n`;
      xml += `        <chapter id="content">\n`;
      xml += `          <title>Document Content</title>\n`;
      xml += `          <sections>\n`;

      // Add sections with images
      sections.forEach((section, idx) => {
        const sectionId = `section-${idx + 1}`;
        const sectionTitle = section.paragraphs[0].substring(0, 50) + (section.paragraphs[0].length > 50 ? '...' : '');

        xml += `            <section id="${sectionId}">\n`;
        xml += `              <title>${this.escapeXML(sectionTitle)}</title>\n`;
        xml += `              <content>\n`;
        xml += `                <text>\n`;
        xml += this.escapeXML(section.paragraphs.join('\n\n'));
        xml += `\n                </text>\n`;

        // Add images for this section
        if (section.images.length > 0) {
          xml += `                <elements>\n`;
          section.images.forEach((img, imgIdx) => {
            xml += `                  <image order="${imgIdx}">\n`;
            xml += `                    <src>${this.escapeXML(img.src)}</src>\n`;
            xml += `                    <alt>${this.escapeXML(img.alt)}</alt>\n`;
            xml += `                  </image>\n`;
          });
          xml += `                </elements>\n`;
        }

        xml += `              </content>\n`;
        xml += `            </section>\n`;
      });

      xml += `          </sections>\n`;
      xml += `        </chapter>\n`;
      xml += `      </chapters>\n`;
      xml += `    </module>\n`;
      xml += `  </modules>\n`;
      xml += `</knowledge_base>`;

      return xml;
    } catch (error) {
      log.error('XML conversion error:', error);
      throw new Error(`Failed to convert document to XML: ${(error as Error).message}`);
    }
  }

  /**
   * Generate a UUID v4
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Escape XML special characters
   */
  private escapeXML(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Get supported document formats
   */
  getSupportedDocumentFormats(): string[] {
    return this.parserManager.getSupportedExtensions();
  }

  /**
   * Get file filters for document import dialog
   */
  getDocumentFileFilters(): Array<{ name: string; extensions: string[] }> {
    return this.parserManager.getFileFilters();
  }

  /**
   * Create knowledge base in database
   */
  private async createKnowledgeBase(data: {
    uuid: string;
    title: string;
    xml_content: string;
    metadata: Record<string, unknown>;
  }): Promise<number> {
    const result = this.db.execute(
      `INSERT INTO knowledge_bases (uuid, title, xml_content, metadata)
       VALUES (?, ?, ?, ?)`,
      [data.uuid, data.title, data.xml_content, JSON.stringify(data.metadata)]
    );

    return result.lastInsertRowid;
  }

  /**
   * Index knowledge base content for full-text search
   */
  private async indexKnowledgeBase(kbId: number, parsed: ParsedKnowledgeBase): Promise<void> {
    const chunks: IndexedContent[] = [];

    // Process each module
    for (const module of parsed.modules) {
      for (const chapter of module.chapters) {
        for (const section of chapter.sections) {
          // Chunk section content
          const sectionChunks = this.chunker.chunkText(
            section.content.text || section.content.markdown || '',
            {
              moduleId: module.id,
              chapterId: chapter.id,
              sectionId: section.id,
            }
          );

          // Prepare for indexing
          for (const chunk of sectionChunks) {
            chunks.push({
              chunkId: chunk.id,
              content: chunk.content,
              metadata: {
                kbId,
                moduleId: module.id,
                chapterId: chapter.id,
                sectionId: section.id,
                type: chunk.type,
              },
            });
          }
        }
      }
    }

    // Index all chunks
    await this.indexChunks(chunks);
  }

  /**
   * Index content chunks for full-text search and semantic search
   */
  private async indexChunks(chunks: IndexedContent[]): Promise<void> {
    this.db.beginTransaction();

    try {
      for (const chunk of chunks) {
        // Build section ID that includes module and chapter for uniqueness
        const fullSectionId = `${chunk.metadata.moduleId}/${chunk.metadata.chapterId}/${chunk.metadata.sectionId}`;

        // Build keywords from metadata
        const keywords = [
          chunk.metadata.moduleId,
          chunk.metadata.chapterId,
          chunk.metadata.sectionId,
          chunk.metadata.type,
        ].join(' ');

        this.db.execute(
          `INSERT INTO content_fts (kb_id, section_id, content, keywords)
           VALUES (?, ?, ?, ?)`,
          [
            chunk.metadata.kbId,
            fullSectionId,
            chunk.content,
            keywords,
          ]
        );
      }

      this.db.commitTransaction();

      // Also index for semantic search (async, non-blocking)
      const contentChunks = chunks.map(chunk => ({
        id: chunk.chunkId,
        content: chunk.content,
        type: chunk.metadata.type as 'text' | 'code' | 'table' | 'list' | 'heading',
        metadata: {
          sectionId: `${chunk.metadata.moduleId}/${chunk.metadata.chapterId}/${chunk.metadata.sectionId}`,
          moduleId: chunk.metadata.moduleId,
          chapterId: chunk.metadata.chapterId,
          startPosition: 0,
          endPosition: chunk.content.length,
          wordCount: chunk.content.split(/\s+/).length,
          characterCount: chunk.content.length,
        },
      }));

      if (chunks.length > 0) {
        await this.semanticIndexer.indexChunks(chunks[0].metadata.kbId, contentChunks);
      }
    } catch (error) {
      this.db.rollbackTransaction();
      throw new Error(`Failed to index chunks: ${(error as Error).message}`);
    }
  }

  /**
   * Get knowledge base by ID
   */
  async getKnowledgeBase(id: number): Promise<KnowledgeBase | null> {
    const rows = this.db.query<KnowledgeBase>(
      'SELECT * FROM knowledge_bases WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return null;
    }

    return rows[0];
  }

  /**
   * Get knowledge base by UUID
   */
  async getKnowledgeBaseByUUID(uuid: string): Promise<KnowledgeBase | null> {
    const rows = this.db.query<KnowledgeBase>(
      'SELECT * FROM knowledge_bases WHERE uuid = ?',
      [uuid]
    );

    if (rows.length === 0) {
      return null;
    }

    return rows[0];
  }

  /**
   * List all knowledge bases
   */
  async listKnowledgeBases(limit = 50, offset = 0): Promise<KnowledgeBase[]> {
    return this.db.query<KnowledgeBase>(
      `SELECT * FROM knowledge_bases
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
  }

  /**
   * Parse knowledge base XML
   */
  async parseKnowledgeBase(id: number): Promise<ParsedKnowledgeBase> {
    const kb = await this.getKnowledgeBase(id);

    if (!kb) {
      throw new Error(`Knowledge base ${id} not found`);
    }

    return this.xmlParser.parseKnowledgeBase(kb.xml_content);
  }

  /**
   * Search knowledge base content
   */
  async searchContent(
    kbId: number,
    query: string,
    limit = 20
  ): Promise<
    Array<{
      module_id: string;
      chapter_id: string;
      section_id: string;
      content: string;
      content_type: string;
      rank: number;
    }>
  > {
    // Use FTS5 for full-text search
    const results = this.db.query<{
      section_id: string;
      content: string;
      keywords: string;
      rank: number;
    }>(
      `SELECT
         section_id,
         highlight(content_fts, 2, '<mark>', '</mark>') as content,
         keywords,
         bm25(content_fts) as rank
       FROM content_fts
       WHERE kb_id = ? AND content_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      [kbId, query, limit]
    );

    // Parse section IDs (format: module/chapter/section)
    return results.map((row) => {
      const [moduleId, chapterId, sectionId] = row.section_id.split('/');
      const keywordParts = row.keywords.split(' ');
      return {
        module_id: moduleId || '',
        chapter_id: chapterId || '',
        section_id: sectionId || '',
        content: row.content,
        content_type: keywordParts[keywordParts.length - 1] || 'text',
        rank: row.rank,
      };
    });
  }

  /**
   * Search all knowledge bases for content
   */
  async searchAllKBs(
    query: string,
    limit = 20
  ): Promise<
    Array<{
      kb_id: number;
      kb_title: string;
      module_id: string;
      chapter_id: string;
      section_id: string;
      content: string;
      content_type: string;
      rank: number;
    }>
  > {
    // Use FTS5 for full-text search across all KBs
    const results = this.db.query<{
      kb_id: number;
      section_id: string;
      content: string;
      keywords: string;
      rank: number;
    }>(
      `SELECT
         kb_id,
         section_id,
         highlight(content_fts, 2, '<mark>', '</mark>') as content,
         keywords,
         bm25(content_fts) as rank
       FROM content_fts
       WHERE content_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      [query, limit]
    );

    // Get KB titles in a single query (optimized from N+1 queries)
    const kbIds = [...new Set(results.map((r) => r.kb_id))];
    const kbTitles: Record<number, string> = {};
    if (kbIds.length > 0) {
      const placeholders = kbIds.map(() => '?').join(',');
      const kbResults = this.db.query<{ id: number; title: string }>(
        `SELECT id, title FROM knowledge_bases WHERE id IN (${placeholders})`,
        kbIds
      );
      for (const kb of kbResults) {
        kbTitles[kb.id] = kb.title;
      }
    }

    // Parse section IDs (format: module/chapter/section)
    return results.map((row) => {
      const [moduleId, chapterId, sectionId] = row.section_id.split('/');
      const keywordParts = row.keywords.split(' ');
      return {
        kb_id: row.kb_id,
        kb_title: kbTitles[row.kb_id] || 'Unknown KB',
        module_id: moduleId || '',
        chapter_id: chapterId || '',
        section_id: sectionId || '',
        content: row.content,
        content_type: keywordParts[keywordParts.length - 1] || 'text',
        rank: row.rank,
      };
    });
  }

  /**
   * Get statistics for knowledge base
   */
  async getStatistics(kbId: number): Promise<{
    totalSections: number;
    totalChunks: number;
    totalCharacters: number;
    averageChunkSize: number;
    contentTypes: Record<string, number>;
  }> {
    const stats = this.db.query<{
      total_sections: number;
      total_chunks: number;
      keywords: string;
      chunk_count: number;
    }>(
      `SELECT
         COUNT(DISTINCT section_id) as total_sections,
         COUNT(*) as total_chunks,
         keywords,
         COUNT(*) as chunk_count
       FROM content_fts
       WHERE kb_id = ?
       GROUP BY keywords`,
      [kbId]
    );

    const contentTypes: Record<string, number> = {};
    let totalChunks = 0;

    for (const row of stats) {
      const keywordParts = row.keywords.split(' ');
      const contentType = keywordParts[keywordParts.length - 1] || 'text';
      contentTypes[contentType] = row.chunk_count;
      totalChunks += row.chunk_count;
    }

    return {
      totalSections: stats[0]?.total_sections || 0,
      totalChunks,
      totalCharacters: 0, // Would need to calculate from content
      averageChunkSize: 0, // Would need to calculate from content
      contentTypes,
    };
  }

  /**
   * Delete knowledge base and all associated data
   */
  async deleteKnowledgeBase(id: number): Promise<boolean> {
    this.db.beginTransaction();

    try {
      // Delete content search index entries
      this.db.execute('DELETE FROM content_fts WHERE kb_id = ?', [id]);

      // Delete conversations
      this.db.execute('DELETE FROM conversations WHERE kb_id = ?', [id]);

      // Delete study progress
      this.db.execute('DELETE FROM study_progress WHERE kb_id = ?', [id]);

      // Delete practice tests
      this.db.execute('DELETE FROM practice_tests WHERE kb_id = ?', [id]);

      // Delete knowledge base
      const result = this.db.execute('DELETE FROM knowledge_bases WHERE id = ?', [id]);

      this.db.commitTransaction();

      return result.changes > 0;
    } catch (error) {
      this.db.rollbackTransaction();
      throw new Error(`Failed to delete knowledge base: ${(error as Error).message}`);
    }
  }

  /**
   * Update knowledge base XML content
   */
  async updateContent(id: number, xmlContent: string): Promise<void> {
    this.db.beginTransaction();

    try {
      // Parse and validate new XML
      const parsed = await this.xmlParser.parseKnowledgeBase(xmlContent);
      const validation = this.xmlParser.validateStructure(parsed);

      if (!validation.valid) {
        throw new Error(`Invalid XML: ${validation.errors.join(', ')}`);
      }

      // Update knowledge base
      this.db.execute(
        `UPDATE knowledge_bases
         SET xml_content = ?, metadata = ?
         WHERE id = ?`,
        [
          xmlContent,
          JSON.stringify({
            totalModules: parsed.modules.length,
            totalChapters: parsed.totalChapters,
            totalSections: parsed.totalSections,
            totalQuestions: parsed.totalQuestions,
          }),
          id,
        ]
      );

      // Clear old index
      this.db.execute('DELETE FROM content_fts WHERE kb_id = ?', [id]);

      // Re-index content
      await this.indexKnowledgeBase(id, parsed);

      this.db.commitTransaction();
    } catch (error) {
      this.db.rollbackTransaction();
      throw new Error(`Failed to update content: ${(error as Error).message}`);
    }
  }

  /**
   * Export knowledge base to XML
   */
  async exportToXML(id: number): Promise<string> {
    const kb = await this.getKnowledgeBase(id);

    if (!kb) {
      throw new Error(`Knowledge base ${id} not found`);
    }

    return kb.xml_content;
  }

  /**
   * Get sample XML for reference
   */
  getSampleXML(): string {
    return this.xmlParser.generateSampleXML();
  }

  /**
   * Validate XML before import
   */
  async validateXML(xmlContent: string): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
    preview?: ParsedKnowledgeBase;
  }> {
    try {
      const parsed = await this.xmlParser.parseKnowledgeBase(xmlContent);
      const validation = this.xmlParser.validateStructure(parsed);

      return {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        preview: parsed,
      };
    } catch (error) {
      return {
        valid: false,
        errors: [(error as Error).message],
        warnings: [],
      };
    }
  }

  /**
   * Perform semantic search within a knowledge base
   * Uses TF-IDF embeddings for similarity matching
   */
  async semanticSearch(
    kbId: number,
    query: string,
    limit: number = 10
  ): Promise<SemanticSearchResult[]> {
    return this.semanticIndexer.search(kbId, query, limit);
  }

  /**
   * Perform semantic search across all knowledge bases
   */
  async semanticSearchAll(
    query: string,
    limit: number = 20
  ): Promise<SemanticSearchResult[]> {
    return this.semanticIndexer.searchAll(query, limit);
  }

  /**
   * Find similar content chunks within a knowledge base
   */
  async findSimilarContent(
    kbId: number,
    chunkId: string,
    limit: number = 5
  ): Promise<SemanticSearchResult[]> {
    return this.semanticIndexer.findSimilar(kbId, chunkId, limit);
  }

  /**
   * Get semantic indexing statistics
   */
  async getSemanticStats(kbId?: number): Promise<{
    totalChunks: number;
    vocabularySize: number;
    averageEmbeddingDensity: number;
  }> {
    return this.semanticIndexer.getStats(kbId);
  }

  /**
   * Re-index all semantic embeddings (useful after major content updates)
   */
  async reindexSemanticContent(): Promise<number> {
    return this.semanticIndexer.reindexAll();
  }

  /**
   * Cluster content by semantic similarity
   */
  async clusterContent(
    kbId: number,
    numClusters: number = 5
  ): Promise<Map<number, string[]>> {
    return this.semanticIndexer.clusterContent(kbId, numClusters);
  }

  /**
   * Get access to the semantic indexer for advanced operations
   */
  getSemanticIndexer(): SemanticIndexer {
    return this.semanticIndexer;
  }
}
