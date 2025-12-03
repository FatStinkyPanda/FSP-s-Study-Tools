/**
 * Mock for better-sqlite3 to enable Jest testing without native module compilation issues.
 *
 * This mock provides a minimal in-memory SQLite-like implementation.
 * Tests that require real database functionality should check for `isMock` property.
 *
 * For comprehensive database testing, use integration tests with the real Electron app,
 * or skip tests when the mock is detected using: `if (Database.isMock) return;`
 */

// In-memory data storage
interface TableData {
  rows: Record<string, unknown>[];
  autoIncrement: number;
}

const databases: Map<string, Map<string, TableData>> = new Map();

interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

class MockStatement {
  private db: MockDatabase;
  private sql: string;
  private boundParams: unknown[] = [];

  constructor(db: MockDatabase, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  bind(...params: unknown[]): this {
    this.boundParams = params;
    return this;
  }

  run(...params: unknown[]): RunResult {
    const allParams = params.length > 0 ? params : this.boundParams;
    return this.db._executeWrite(this.sql, allParams);
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    const allParams = params.length > 0 ? params : this.boundParams;
    const results = this.db._executeRead(this.sql, allParams);
    return results[0];
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    const allParams = params.length > 0 ? params : this.boundParams;
    return this.db._executeRead(this.sql, allParams);
  }

  *iterate(...params: unknown[]): Generator<Record<string, unknown>> {
    const results = this.all(...params);
    for (const row of results) {
      yield row;
    }
  }
}

class MockDatabase {
  static isMock = true;  // Flag to detect mock in tests
  open: boolean = true;
  inTransaction: boolean = false;
  name: string;
  memory: boolean;
  readonly: boolean = false;

  private storage: Map<string, TableData>;

  constructor(filename: string, _options?: Record<string, unknown>) {
    this.name = filename;
    this.memory = filename === ':memory:';

    // Initialize or get storage for this database
    if (!databases.has(filename)) {
      databases.set(filename, new Map());
    }
    this.storage = databases.get(filename)!;
  }

  prepare(sql: string): MockStatement {
    return new MockStatement(this, sql);
  }

  exec(sql: string): this {
    // Parse and execute multiple statements
    const statements = sql.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      this._executeWrite(stmt.trim(), []);
    }
    return this;
  }

  pragma(_pragma: string): unknown[] {
    // Return reasonable defaults for common pragmas
    if (_pragma.includes('page_count')) return [{ page_count: 1 }];
    if (_pragma.includes('page_size')) return [{ page_size: 4096 }];
    return [];
  }

  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
    return ((...args: Parameters<T>) => {
      this.inTransaction = true;
      try {
        return fn(...args);
      } finally {
        this.inTransaction = false;
      }
    }) as T;
  }

  close(): void {
    this.open = false;
    // Clear storage for memory databases on close
    if (this.memory) {
      this.storage.clear();
    }
  }

  // Internal methods for mock execution
  _executeWrite(sql: string, params: unknown[]): RunResult {
    const upperSql = sql.toUpperCase().trim();

    // Handle CREATE TABLE
    if (upperSql.startsWith('CREATE TABLE') || upperSql.startsWith('CREATE VIRTUAL TABLE')) {
      const match = sql.match(/(?:CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)["']?(\w+)["']?/i);
      if (match) {
        const tableName = match[1];
        if (!this.storage.has(tableName)) {
          this.storage.set(tableName, { rows: [], autoIncrement: 1 });
        }
      }
      return { changes: 0, lastInsertRowid: 0 };
    }

    // Handle CREATE INDEX (no-op)
    if (upperSql.startsWith('CREATE INDEX') || upperSql.startsWith('CREATE UNIQUE INDEX')) {
      return { changes: 0, lastInsertRowid: 0 };
    }

    // Handle INSERT
    if (upperSql.startsWith('INSERT')) {
      const match = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["']?(\w+)["']?\s*\(([^)]+)\)/i);
      if (match) {
        const tableName = match[1];
        const columns = match[2].split(',').map(c => c.trim().replace(/["']/g, ''));

        const table = this.storage.get(tableName);
        if (table) {
          const row: Record<string, unknown> = { id: table.autoIncrement };
          columns.forEach((col, i) => {
            row[col] = params[i] ?? null;
          });
          table.rows.push(row);
          table.autoIncrement++;
          return { changes: 1, lastInsertRowid: row.id as number };
        }
      }
      return { changes: 0, lastInsertRowid: 0 };
    }

    // Handle UPDATE
    if (upperSql.startsWith('UPDATE')) {
      return { changes: 1, lastInsertRowid: 0 };
    }

    // Handle DELETE
    if (upperSql.startsWith('DELETE')) {
      const match = sql.match(/DELETE\s+FROM\s+["']?(\w+)["']?/i);
      if (match) {
        const tableName = match[1];
        const table = this.storage.get(tableName);
        if (table) {
          const prevLength = table.rows.length;
          // Simple: delete all if no WHERE, or try to match by id
          if (params.length > 0) {
            table.rows = table.rows.filter(r => r.id !== params[0]);
          } else {
            table.rows = [];
          }
          return { changes: prevLength - table.rows.length, lastInsertRowid: 0 };
        }
      }
      return { changes: 0, lastInsertRowid: 0 };
    }

    return { changes: 0, lastInsertRowid: 0 };
  }

  _executeRead(sql: string, params: unknown[]): Record<string, unknown>[] {
    const upperSql = sql.toUpperCase().trim();

    // Handle SELECT
    if (upperSql.startsWith('SELECT')) {
      // Try to extract table name
      const fromMatch = sql.match(/FROM\s+["']?(\w+)["']?/i);
      if (fromMatch) {
        const tableName = fromMatch[1];
        const table = this.storage.get(tableName);
        if (table) {
          // Very basic WHERE handling for id lookups
          if (sql.includes('WHERE') && params.length > 0) {
            const idParam = params[0];
            return table.rows.filter(r => r.id === idParam || r.kb_id === idParam || r.uuid === idParam);
          }
          return [...table.rows];
        }
      }

      // Handle aggregate queries
      if (upperSql.includes('COUNT(')) {
        return [{ count: 0, kb_count: 0, progress_count: 0, test_count: 0, conversation_count: 0 }];
      }
    }

    return [];
  }
}

// Export as default (CommonJS style for Jest)
module.exports = MockDatabase;
module.exports.default = MockDatabase;
