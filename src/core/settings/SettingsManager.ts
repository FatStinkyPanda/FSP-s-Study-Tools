import { DatabaseManager } from '../database/DatabaseManager';

export interface AppSettings {
  // AI Provider API Keys
  openai_api_key?: string;
  anthropic_api_key?: string;
  google_api_key?: string;
  openrouter_api_key?: string;

  // Default AI Provider
  default_ai_provider?: 'openai' | 'anthropic' | 'google' | 'openrouter';

  // AI Model Settings
  default_model?: string;
  temperature?: number;
  max_tokens?: number;

  // UI Settings
  theme?: 'dark' | 'light' | 'auto';
  font_size?: 'small' | 'medium' | 'large';

  // Study Settings
  questions_per_session?: number;
  show_explanations?: boolean;
  shuffle_questions?: boolean;
}

export interface SettingRow {
  key: string;
  value: string;
  category: string;
  updated_at: string;
}

/**
 * SettingsManager
 *
 * Manages application settings with persistent storage in SQLite.
 * Settings are stored as key-value pairs with categories for organization.
 */
export class SettingsManager {
  private db: DatabaseManager;
  private cache: Map<string, string>;

  constructor(databaseManager: DatabaseManager) {
    this.db = databaseManager;
    this.cache = new Map();
    this.initializeSettingsTable();
    this.loadCache();
  }

  /**
   * Initialize settings table if it doesn't exist
   */
  private initializeSettingsTable(): void {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        category TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db.getDatabase().exec(createTableSQL);
  }

  /**
   * Load all settings into memory cache
   */
  private loadCache(): void {
    const stmt = this.db.getDatabase().prepare('SELECT key, value FROM settings');
    const rows = stmt.all() as Array<{ key: string; value: string }>;

    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.key, row.value);
    }
  }

  /**
   * Get a setting value by key
   */
  get(key: string, defaultValue?: string): string | undefined {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    return defaultValue;
  }

  /**
   * Get a setting as a boolean
   */
  getBoolean(key: string, defaultValue = false): boolean {
    const value = this.get(key);
    if (value === undefined) return defaultValue;
    return value === 'true' || value === '1';
  }

  /**
   * Get a setting as a number
   */
  getNumber(key: string, defaultValue = 0): number {
    const value = this.get(key);
    if (value === undefined) return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Set a setting value
   */
  set(key: string, value: string | number | boolean, category = 'general'): void {
    const stringValue = String(value);

    const stmt = this.db.getDatabase().prepare(`
      INSERT INTO settings (key, value, category, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(key, stringValue, category);
    this.cache.set(key, stringValue);
  }

  /**
   * Delete a setting
   */
  delete(key: string): void {
    const stmt = this.db.getDatabase().prepare('DELETE FROM settings WHERE key = ?');
    stmt.run(key);
    this.cache.delete(key);
  }

  /**
   * Get all settings as an object
   */
  getAll(): AppSettings {
    const settings: AppSettings = {};

    // AI Provider API Keys
    settings.openai_api_key = this.get('openai_api_key');
    settings.anthropic_api_key = this.get('anthropic_api_key');
    settings.google_api_key = this.get('google_api_key');
    settings.openrouter_api_key = this.get('openrouter_api_key');

    // Default AI Provider
    const provider = this.get('default_ai_provider');
    if (provider === 'openai' || provider === 'anthropic' || provider === 'google' || provider === 'openrouter') {
      settings.default_ai_provider = provider;
    }

    // AI Model Settings
    settings.default_model = this.get('default_model');
    settings.temperature = this.getNumber('temperature');
    settings.max_tokens = this.getNumber('max_tokens');

    // UI Settings
    const theme = this.get('theme');
    if (theme === 'dark' || theme === 'light' || theme === 'auto') {
      settings.theme = theme;
    }
    const fontSize = this.get('font_size');
    if (fontSize === 'small' || fontSize === 'medium' || fontSize === 'large') {
      settings.font_size = fontSize;
    }

    // Study Settings
    settings.questions_per_session = this.getNumber('questions_per_session');
    settings.show_explanations = this.getBoolean('show_explanations');
    settings.shuffle_questions = this.getBoolean('shuffle_questions');

    return settings;
  }

  /**
   * Update multiple settings at once
   */
  updateAll(settings: Partial<AppSettings>): void {
    // AI Provider API Keys
    if (settings.openai_api_key !== undefined) {
      this.set('openai_api_key', settings.openai_api_key, 'ai_provider');
    }
    if (settings.anthropic_api_key !== undefined) {
      this.set('anthropic_api_key', settings.anthropic_api_key, 'ai_provider');
    }
    if (settings.google_api_key !== undefined) {
      this.set('google_api_key', settings.google_api_key, 'ai_provider');
    }
    if (settings.openrouter_api_key !== undefined) {
      this.set('openrouter_api_key', settings.openrouter_api_key, 'ai_provider');
    }

    // Default AI Provider
    if (settings.default_ai_provider !== undefined) {
      this.set('default_ai_provider', settings.default_ai_provider, 'ai_provider');
    }

    // AI Model Settings
    if (settings.default_model !== undefined) {
      this.set('default_model', settings.default_model, 'ai_model');
    }
    if (settings.temperature !== undefined) {
      this.set('temperature', settings.temperature, 'ai_model');
    }
    if (settings.max_tokens !== undefined) {
      this.set('max_tokens', settings.max_tokens, 'ai_model');
    }

    // UI Settings
    if (settings.theme !== undefined) {
      this.set('theme', settings.theme, 'ui');
    }
    if (settings.font_size !== undefined) {
      this.set('font_size', settings.font_size, 'ui');
    }

    // Study Settings
    if (settings.questions_per_session !== undefined) {
      this.set('questions_per_session', settings.questions_per_session, 'study');
    }
    if (settings.show_explanations !== undefined) {
      this.set('show_explanations', settings.show_explanations, 'study');
    }
    if (settings.shuffle_questions !== undefined) {
      this.set('shuffle_questions', settings.shuffle_questions, 'study');
    }
  }

  /**
   * Get settings by category
   */
  getByCategory(category: string): SettingRow[] {
    const stmt = this.db.getDatabase().prepare(`
      SELECT key, value, category, updated_at
      FROM settings
      WHERE category = ?
      ORDER BY key
    `);

    return stmt.all(category) as SettingRow[];
  }

  /**
   * Reset all settings to defaults
   */
  resetToDefaults(): void {
    const stmt = this.db.getDatabase().prepare('DELETE FROM settings');
    stmt.run();
    this.cache.clear();

    // Set default values
    this.set('theme', 'dark', 'ui');
    this.set('font_size', 'medium', 'ui');
    this.set('questions_per_session', 20, 'study');
    this.set('show_explanations', true, 'study');
    this.set('shuffle_questions', true, 'study');
    this.set('temperature', 0.7, 'ai_model');
    this.set('max_tokens', 2000, 'ai_model');
  }

  /**
   * Check if an API key is configured for a provider
   */
  hasApiKey(provider: 'openai' | 'anthropic' | 'google' | 'openrouter'): boolean {
    const key = this.get(`${provider}_api_key`);
    return !!key && key.length > 0;
  }

  /**
   * Get the default AI provider or the first one with an API key
   */
  getDefaultProvider(): string | undefined {
    const defaultProvider = this.get('default_ai_provider');
    if (defaultProvider && this.hasApiKey(defaultProvider as any)) {
      return defaultProvider;
    }

    // Fallback to first provider with API key
    const providers: Array<'openai' | 'anthropic' | 'google' | 'openrouter'> = [
      'openai',
      'anthropic',
      'google',
      'openrouter'
    ];

    for (const provider of providers) {
      if (this.hasApiKey(provider)) {
        return provider;
      }
    }

    return undefined;
  }

  /**
   * Export settings to JSON
   */
  export(): string {
    const settings = this.getAll();
    return JSON.stringify(settings, null, 2);
  }

  /**
   * Import settings from JSON
   */
  import(json: string): void {
    try {
      const settings = JSON.parse(json) as Partial<AppSettings>;
      this.updateAll(settings);
    } catch (error) {
      throw new Error(`Failed to import settings: ${(error as Error).message}`);
    }
  }
}
