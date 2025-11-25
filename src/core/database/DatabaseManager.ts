import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeBase, ExecuteResult } from '../../shared/types';

// Embedded schema to avoid file loading issues in packaged app
const DATABASE_SCHEMA = `-- FSP's Study Tools - Database Schema
-- SQLite Database Schema for Knowledge Management and Progress Tracking

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Knowledge Bases Table
CREATE TABLE IF NOT EXISTS knowledge_bases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    xml_content TEXT NOT NULL,
    metadata JSON,
    CONSTRAINT valid_uuid CHECK (length(uuid) = 36)
);

-- Index for faster UUID lookups
CREATE INDEX IF NOT EXISTS idx_kb_uuid ON knowledge_bases(uuid);
CREATE INDEX IF NOT EXISTS idx_kb_modified ON knowledge_bases(modified_at DESC);

-- Study Progress Table
CREATE TABLE IF NOT EXISTS study_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kb_id INTEGER NOT NULL,
    section_id TEXT NOT NULL,
    user_score REAL DEFAULT 0.0 CHECK (user_score >= 0.0 AND user_score <= 1.0),
    ai_score REAL DEFAULT 0.0 CHECK (ai_score >= 0.0 AND ai_score <= 1.0),
    time_spent INTEGER DEFAULT 0,
    last_viewed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    UNIQUE(kb_id, section_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_kb ON study_progress(kb_id);
CREATE INDEX IF NOT EXISTS idx_progress_viewed ON study_progress(last_viewed DESC);

-- Practice Tests Table
CREATE TABLE IF NOT EXISTS practice_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kb_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('manual', 'ai_generated')),
    questions JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tests_kb ON practice_tests(kb_id);
CREATE INDEX IF NOT EXISTS idx_tests_created ON practice_tests(created_at DESC);

-- Test Results Table
CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id INTEGER NOT NULL,
    score REAL NOT NULL CHECK (score >= 0.0 AND score <= 1.0),
    answers JSON NOT NULL,
    taken_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    time_taken INTEGER NOT NULL,
    FOREIGN KEY (test_id) REFERENCES practice_tests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_results_test ON test_results(test_id);
CREATE INDEX IF NOT EXISTS idx_results_taken ON test_results(taken_at DESC);

-- Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kb_id INTEGER NOT NULL,
    messages JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversations_kb ON conversations(kb_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

-- Full-Text Search Table
CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
    kb_id UNINDEXED,
    section_id UNINDEXED,
    content,
    keywords,
    tokenize='porter unicode61'
);

-- Settings Table (for application configuration)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migration History Table
CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER UNIQUE NOT NULL,
    name TEXT NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Triggers for automatic timestamp updates
CREATE TRIGGER IF NOT EXISTS update_kb_modified_at
AFTER UPDATE ON knowledge_bases
FOR EACH ROW
BEGIN
    UPDATE knowledge_bases SET modified_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_conversation_updated_at
AFTER UPDATE ON conversations
FOR EACH ROW
BEGIN
    UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_settings_updated_at
AFTER UPDATE ON settings
FOR EACH ROW
BEGIN
    UPDATE settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
END;

-- Highlights Table (for user text highlights in KB content)
CREATE TABLE IF NOT EXISTS highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kb_id INTEGER NOT NULL,
    section_id TEXT NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    text TEXT NOT NULL,
    color TEXT DEFAULT 'yellow',
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_highlights_kb ON highlights(kb_id);
CREATE INDEX IF NOT EXISTS idx_highlights_section ON highlights(kb_id, section_id);

-- Views for common queries
CREATE VIEW IF NOT EXISTS knowledge_base_stats AS
SELECT
    kb.id,
    kb.title,
    kb.created_at,
    COUNT(DISTINCT sp.id) as sections_studied,
    AVG(sp.user_score) as avg_user_score,
    AVG(sp.ai_score) as avg_ai_score,
    SUM(sp.time_spent) as total_time_spent,
    COUNT(DISTINCT pt.id) as test_count,
    COUNT(DISTINCT c.id) as conversation_count
FROM knowledge_bases kb
LEFT JOIN study_progress sp ON kb.id = sp.kb_id
LEFT JOIN practice_tests pt ON kb.id = pt.kb_id
LEFT JOIN conversations c ON kb.id = c.kb_id
GROUP BY kb.id, kb.title, kb.created_at;

CREATE VIEW IF NOT EXISTS recent_activity AS
SELECT
    'study' as activity_type,
    kb_id,
    section_id as reference,
    last_viewed as timestamp
FROM study_progress
UNION ALL
SELECT
    'test' as activity_type,
    test_id as kb_id,
    CAST(id AS TEXT) as reference,
    taken_at as timestamp
FROM test_results
UNION ALL
SELECT
    'conversation' as activity_type,
    kb_id,
    CAST(id AS TEXT) as reference,
    updated_at as timestamp
FROM conversations
ORDER BY timestamp DESC
LIMIT 100;`;

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

    // Use embedded schema instead of loading from file
    const schema = DATABASE_SCHEMA;

    // Execute the entire schema at once
    // SQLite's exec() can handle multiple statements and triggers correctly
    try {
      this.db.exec(schema);
    } catch (error) {
      console.error('Failed to apply database schema:', error);
      throw error;
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
   * Get direct access to the database instance
   * Use with caution - prefer using query() and execute() methods
   */
  getDatabase(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
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
