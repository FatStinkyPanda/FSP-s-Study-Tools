import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeBase, ExecuteResult } from '../../shared/types';

export class DatabaseManager {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Initialize the database connection and schema
   */
  async initialize(): Promise<void> {
    try {
      // Ensure the directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Open database connection
      this.db = new Database(this.dbPath);

      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');

      // Set journal mode for better concurrency
      this.db.pragma('journal_mode = WAL');

      // Apply schema
      await this.applySchema();

      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Apply the database schema
   */
  private async applySchema(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Split schema into individual statements and execute
    const statements = schema
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    for (const statement of statements) {
      try {
        this.db.exec(statement);
      } catch (error) {
        console.error('Failed to execute statement:', statement);
        throw error;
      }
    }
  }

  /**
   * Execute a SQL query and return results
   */
  query<T = unknown>(sql: string, params?: unknown[]): T[] {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const stmt = this.db.prepare(sql);
      const rows = params ? stmt.all(...params) : stmt.all();
      return rows as T[];
    } catch (error) {
      console.error('Query failed:', sql, params, error);
      throw error;
    }
  }

  /**
   * Execute a SQL statement (INSERT, UPDATE, DELETE)
   */
  execute(sql: string, params?: unknown[]): ExecuteResult {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const stmt = this.db.prepare(sql);
      const result = params ? stmt.run(...params) : stmt.run();

      return {
        changes: result.changes,
        lastInsertRowid: Number(result.lastInsertRowid),
      };
    } catch (error) {
      console.error('Execute failed:', sql, params, error);
      throw error;
    }
  }

  /**
   * List all knowledge bases
   */
  listKnowledgeBases(): KnowledgeBase[] {
    const sql = `
      SELECT id, uuid, title, created_at, modified_at, metadata
      FROM knowledge_bases
      ORDER BY modified_at DESC
    `;

    const rows = this.query<KnowledgeBase>(sql);

    return rows.map(row => ({
      ...row,
      metadata: typeof row.metadata === 'string'
        ? JSON.parse(row.metadata as string)
        : row.metadata,
    }));
  }

  /**
   * Get a knowledge base by ID
   */
  getKnowledgeBase(id: number): KnowledgeBase | null {
    const sql = `
      SELECT id, uuid, title, created_at, modified_at, xml_content, metadata
      FROM knowledge_bases
      WHERE id = ?
    `;

    const rows = this.query<KnowledgeBase>(sql, [id]);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      ...row,
      metadata: typeof row.metadata === 'string'
        ? JSON.parse(row.metadata as string)
        : row.metadata,
    };
  }

  /**
   * Create a new knowledge base
   */
  createKnowledgeBase(data: {
    uuid: string;
    title: string;
    xml_content: string;
    metadata?: Record<string, unknown>;
  }): number {
    const sql = `
      INSERT INTO knowledge_bases (uuid, title, xml_content, metadata)
      VALUES (?, ?, ?, ?)
    `;

    const metadata = data.metadata ? JSON.stringify(data.metadata) : '{}';
    const result = this.execute(sql, [data.uuid, data.title, data.xml_content, metadata]);

    return result.lastInsertRowid;
  }

  /**
   * Update a knowledge base
   */
  updateKnowledgeBase(id: number, data: {
    title?: string;
    xml_content?: string;
    metadata?: Record<string, unknown>;
  }): boolean {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.title !== undefined) {
      updates.push('title = ?');
      params.push(data.title);
    }

    if (data.xml_content !== undefined) {
      updates.push('xml_content = ?');
      params.push(data.xml_content);
    }

    if (data.metadata !== undefined) {
      updates.push('metadata = ?');
      params.push(JSON.stringify(data.metadata));
    }

    if (updates.length === 0) {
      return false;
    }

    params.push(id);

    const sql = `
      UPDATE knowledge_bases
      SET ${updates.join(', ')}
      WHERE id = ?
    `;

    const result = this.execute(sql, params);
    return result.changes > 0;
  }

  /**
   * Delete a knowledge base
   */
  deleteKnowledgeBase(id: number): boolean {
    const sql = 'DELETE FROM knowledge_bases WHERE id = ?';
    const result = this.execute(sql, [id]);
    return result.changes > 0;
  }

  /**
   * Full-text search across knowledge base content
   */
  searchContent(query: string, kbId?: number): Array<{
    kb_id: number;
    section_id: string;
    content: string;
    rank: number;
  }> {
    let sql = `
      SELECT kb_id, section_id, content, rank
      FROM content_fts
      WHERE content_fts MATCH ?
    `;

    const params: unknown[] = [query];

    if (kbId !== undefined) {
      sql += ' AND kb_id = ?';
      params.push(kbId);
    }

    sql += ' ORDER BY rank LIMIT 50';

    return this.query(sql, params);
  }

  /**
   * Index content for full-text search
   */
  indexContent(kbId: number, sectionId: string, content: string, keywords: string): void {
    const sql = `
      INSERT INTO content_fts (kb_id, section_id, content, keywords)
      VALUES (?, ?, ?, ?)
    `;

    this.execute(sql, [kbId, sectionId, content, keywords]);
  }

  /**
   * Begin a transaction
   */
  beginTransaction(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    this.db.exec('BEGIN TRANSACTION');
  }

  /**
   * Commit a transaction
   */
  commitTransaction(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    this.db.exec('COMMIT');
  }

  /**
   * Rollback a transaction
   */
  rollbackTransaction(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    this.db.exec('ROLLBACK');
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('Database connection closed');
    }
  }

  /**
   * Get database statistics
   */
  getStats(): {
    size: number;
    knowledge_bases: number;
    sections_studied: number;
    tests_taken: number;
    conversations: number;
  } {
    const sizeResult = this.query<{ page_count: number; page_size: number }>(
      'PRAGMA page_count; PRAGMA page_size;'
    );

    const stats = this.query<{
      kb_count: number;
      progress_count: number;
      test_count: number;
      conversation_count: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM knowledge_bases) as kb_count,
        (SELECT COUNT(*) FROM study_progress) as progress_count,
        (SELECT COUNT(*) FROM test_results) as test_count,
        (SELECT COUNT(*) FROM conversations) as conversation_count
    `)[0];

    return {
      size: (sizeResult[0]?.page_count || 0) * (sizeResult[1]?.page_size || 0),
      knowledge_bases: stats.kb_count,
      sections_studied: stats.progress_count,
      tests_taken: stats.test_count,
      conversations: stats.conversation_count,
    };
  }
}
