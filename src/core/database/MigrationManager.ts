import * as fs from 'fs';
import * as path from 'path';
import { DatabaseManager } from './DatabaseManager';

interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export class MigrationManager {
  private db: DatabaseManager;
  private migrationsDir: string;

  constructor(db: DatabaseManager, migrationsDir: string) {
    this.db = db;
    this.migrationsDir = migrationsDir;
  }

  /**
   * Get current database version
   */
  private getCurrentVersion(): number {
    try {
      const result = this.db.query<{ version: number }>(
        'SELECT MAX(version) as version FROM migrations'
      );

      return result[0]?.version || 0;
    } catch (error) {
      // Migrations table doesn't exist yet
      return 0;
    }
  }

  /**
   * Load all migration files
   */
  private loadMigrations(): Migration[] {
    if (!fs.existsSync(this.migrationsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    const migrations: Migration[] = [];

    for (const file of files) {
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      if (!match) {
        console.warn(`Skipping invalid migration file: ${file}`);
        continue;
      }

      const version = parseInt(match[1], 10);
      const name = match[2];
      const content = fs.readFileSync(
        path.join(this.migrationsDir, file),
        'utf-8'
      );

      // Split migration into up and down sections
      const parts = content.split('-- DOWN');
      const up = parts[0].replace('-- UP', '').trim();
      const down = parts[1]?.trim() || '';

      migrations.push({ version, name, up, down });
    }

    return migrations;
  }

  /**
   * Apply pending migrations
   */
  async applyMigrations(): Promise<number> {
    const currentVersion = this.getCurrentVersion();
    const migrations = this.loadMigrations();

    const pending = migrations.filter(m => m.version > currentVersion);

    if (pending.length === 0) {
      console.log('No pending migrations');
      return 0;
    }

    console.log(`Applying ${pending.length} pending migration(s)...`);

    for (const migration of pending) {
      try {
        console.log(`Applying migration ${migration.version}: ${migration.name}`);

        this.db.beginTransaction();

        // Execute migration
        const statements = migration.up
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

        for (const statement of statements) {
          this.db.execute(statement);
        }

        // Record migration
        this.db.execute(
          'INSERT INTO migrations (version, name) VALUES (?, ?)',
          [migration.version, migration.name]
        );

        this.db.commitTransaction();

        console.log(`Migration ${migration.version} applied successfully`);
      } catch (error) {
        console.error(`Failed to apply migration ${migration.version}:`, error);
        this.db.rollbackTransaction();
        throw error;
      }
    }

    return pending.length;
  }

  /**
   * Rollback migrations to a specific version
   */
  async rollbackTo(targetVersion: number): Promise<number> {
    const currentVersion = this.getCurrentVersion();

    if (targetVersion >= currentVersion) {
      console.log('Nothing to rollback');
      return 0;
    }

    const migrations = this.loadMigrations();
    const toRollback = migrations
      .filter(m => m.version > targetVersion && m.version <= currentVersion)
      .sort((a, b) => b.version - a.version); // Rollback in reverse order

    console.log(`Rolling back ${toRollback.length} migration(s)...`);

    for (const migration of toRollback) {
      if (!migration.down) {
        throw new Error(`Migration ${migration.version} has no down script`);
      }

      try {
        console.log(`Rolling back migration ${migration.version}: ${migration.name}`);

        this.db.beginTransaction();

        // Execute rollback
        const statements = migration.down
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

        for (const statement of statements) {
          this.db.execute(statement);
        }

        // Remove migration record
        this.db.execute('DELETE FROM migrations WHERE version = ?', [migration.version]);

        this.db.commitTransaction();

        console.log(`Migration ${migration.version} rolled back successfully`);
      } catch (error) {
        console.error(`Failed to rollback migration ${migration.version}:`, error);
        this.db.rollbackTransaction();
        throw error;
      }
    }

    return toRollback.length;
  }

  /**
   * Get migration status
   */
  getStatus(): {
    currentVersion: number;
    appliedMigrations: Array<{ version: number; name: string; applied_at: string }>;
    pendingMigrations: Array<{ version: number; name: string }>;
  } {
    const currentVersion = this.getCurrentVersion();
    const allMigrations = this.loadMigrations();

    let appliedMigrations: Array<{ version: number; name: string; applied_at: string }> = [];

    try {
      appliedMigrations = this.db.query<{ version: number; name: string; applied_at: string }>(
        'SELECT version, name, applied_at FROM migrations ORDER BY version'
      );
    } catch (error) {
      // Migrations table doesn't exist yet
    }

    const pendingMigrations = allMigrations
      .filter(m => m.version > currentVersion)
      .map(m => ({ version: m.version, name: m.name }));

    return {
      currentVersion,
      appliedMigrations,
      pendingMigrations,
    };
  }
}
