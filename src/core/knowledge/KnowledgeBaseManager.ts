import { DatabaseManager } from '../database/DatabaseManager';
import { XMLParser, ParsedKnowledgeBase } from './XMLParser';
import { ContentChunker } from './ContentChunker';
import { KnowledgeBase } from '../../shared/types';

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

  constructor(private db: DatabaseManager) {
    this.xmlParser = new XMLParser();
    this.chunker = new ContentChunker();
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
        console.warn('XML validation warnings:', validation.warnings);
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
   * Index content chunks for full-text search
   */
  private async indexChunks(chunks: IndexedContent[]): Promise<void> {
    this.db.beginTransaction();

    try {
      for (const chunk of chunks) {
        this.db.execute(
          `INSERT INTO search_index (kb_id, module_id, chapter_id, section_id, content, content_type)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            chunk.metadata.kbId,
            chunk.metadata.moduleId,
            chunk.metadata.chapterId,
            chunk.metadata.sectionId,
            chunk.content,
            chunk.metadata.type,
          ]
        );
      }

      this.db.commitTransaction();
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
    return this.db.query(
      `SELECT
         module_id,
         chapter_id,
         section_id,
         highlight(search_index, 4, '<mark>', '</mark>') as content,
         content_type,
         bm25(search_index) as rank
       FROM search_index
       WHERE kb_id = ? AND search_index MATCH ?
       ORDER BY rank
       LIMIT ?`,
      [kbId, query, limit]
    );
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
      content_type: string;
      chunk_count: number;
    }>(
      `SELECT
         COUNT(DISTINCT section_id) as total_sections,
         COUNT(*) as total_chunks,
         content_type,
         COUNT(*) as chunk_count
       FROM search_index
       WHERE kb_id = ?
       GROUP BY content_type`,
      [kbId]
    );

    const contentTypes: Record<string, number> = {};
    let totalChunks = 0;

    for (const row of stats) {
      contentTypes[row.content_type] = row.chunk_count;
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
      // Delete search index entries
      this.db.execute('DELETE FROM search_index WHERE kb_id = ?', [id]);

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
      this.db.execute('DELETE FROM search_index WHERE kb_id = ?', [id]);

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
}
