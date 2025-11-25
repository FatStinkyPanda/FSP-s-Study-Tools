import { DatabaseManager } from '../database/DatabaseManager';

export interface AppSettings {
  // AI Provider API Keys
  openai_api_key?: string;
  anthropic_api_key?: string;
  google_api_key?: string;
  openrouter_api_key?: string;

  // Default AI Provider (with fallbacks)
  default_ai_provider?: 'openai' | 'anthropic' | 'google' | 'openrouter';
  default_ai_provider_secondary?: 'openai' | 'anthropic' | 'google' | 'openrouter';
  default_ai_provider_tertiary?: 'openai' | 'anthropic' | 'google' | 'openrouter';

  // AI Model Settings (primary models)
  default_model?: string;
  openai_model?: string;
  anthropic_model?: string;
  google_model?: string;
  openrouter_model?: string;

  // AI Model Settings (secondary fallback models)
  openai_model_secondary?: string;
  anthropic_model_secondary?: string;
  google_model_secondary?: string;
  openrouter_model_secondary?: string;

  // AI Model Settings (tertiary fallback models)
  openai_model_tertiary?: string;
  anthropic_model_tertiary?: string;
  google_model_tertiary?: string;
  openrouter_model_tertiary?: string;

  temperature?: number;
  max_tokens?: number;

  // Available models (cached from API)
  openai_models?: string[];
  anthropic_models?: string[];
  google_models?: string[];
  openrouter_models?: string[];

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
  updated_at: string;
}

/**
 * SettingsManager
 *
 * Manages application settings with persistent storage in SQLite.
 * Settings are stored as key-value pairs in JSON format.
 */
export class SettingsManager {
  private db: DatabaseManager;
  private cache: Map<string, unknown>;

  constructor(databaseManager: DatabaseManager) {
    this.db = databaseManager;
    this.cache = new Map();
    this.loadCache();
  }

  /**
   * Load all settings into memory cache
   */
  private loadCache(): void {
    try {
      const stmt = this.db.getDatabase().prepare('SELECT key, value FROM settings');
      const rows = stmt.all() as Array<{ key: string; value: string }>;

      this.cache.clear();
      for (const row of rows) {
        try {
          // Parse JSON value
          this.cache.set(row.key, JSON.parse(row.value));
        } catch {
          // If not valid JSON, store as string
          this.cache.set(row.key, row.value);
        }
      }
    } catch (error) {
      console.error('Failed to load settings cache:', error);
    }
  }

  /**
   * Get a setting value by key
   */
  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached as T;
    }
    return defaultValue;
  }

  /**
   * Get a setting as a string
   */
  getString(key: string, defaultValue?: string): string | undefined {
    const value = this.get(key);
    if (value === undefined) return defaultValue;
    return String(value);
  }

  /**
   * Get a setting as a boolean
   */
  getBoolean(key: string, defaultValue = false): boolean {
    const value = this.get(key);
    if (value === undefined) return defaultValue;
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1' || value === true;
  }

  /**
   * Get a setting as a number
   */
  getNumber(key: string, defaultValue = 0): number {
    const value = this.get(key);
    if (value === undefined) return defaultValue;
    if (typeof value === 'number') return value;
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Get a setting as an array
   */
  getArray<T = string>(key: string, defaultValue: T[] = []): T[] {
    const value = this.get(key);
    if (value === undefined) return defaultValue;
    if (Array.isArray(value)) return value as T[];
    return defaultValue;
  }

  /**
   * Set a setting value (stores as JSON)
   */
  set(key: string, value: unknown): void {
    const jsonValue = JSON.stringify(value);

    const stmt = this.db.getDatabase().prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(key, jsonValue);
    this.cache.set(key, value);
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
    settings.openai_api_key = this.getString('openai_api_key');
    settings.anthropic_api_key = this.getString('anthropic_api_key');
    settings.google_api_key = this.getString('google_api_key');
    settings.openrouter_api_key = this.getString('openrouter_api_key');

    // Default AI Provider (with fallbacks)
    const provider = this.getString('default_ai_provider');
    if (provider === 'openai' || provider === 'anthropic' || provider === 'google' || provider === 'openrouter') {
      settings.default_ai_provider = provider;
    }
    const providerSecondary = this.getString('default_ai_provider_secondary');
    if (providerSecondary === 'openai' || providerSecondary === 'anthropic' || providerSecondary === 'google' || providerSecondary === 'openrouter') {
      settings.default_ai_provider_secondary = providerSecondary;
    }
    const providerTertiary = this.getString('default_ai_provider_tertiary');
    if (providerTertiary === 'openai' || providerTertiary === 'anthropic' || providerTertiary === 'google' || providerTertiary === 'openrouter') {
      settings.default_ai_provider_tertiary = providerTertiary;
    }

    // AI Model Settings (primary)
    settings.default_model = this.getString('default_model');
    settings.openai_model = this.getString('openai_model');
    settings.anthropic_model = this.getString('anthropic_model');
    settings.google_model = this.getString('google_model');
    settings.openrouter_model = this.getString('openrouter_model');

    // AI Model Settings (secondary fallback)
    settings.openai_model_secondary = this.getString('openai_model_secondary');
    settings.anthropic_model_secondary = this.getString('anthropic_model_secondary');
    settings.google_model_secondary = this.getString('google_model_secondary');
    settings.openrouter_model_secondary = this.getString('openrouter_model_secondary');

    // AI Model Settings (tertiary fallback)
    settings.openai_model_tertiary = this.getString('openai_model_tertiary');
    settings.anthropic_model_tertiary = this.getString('anthropic_model_tertiary');
    settings.google_model_tertiary = this.getString('google_model_tertiary');
    settings.openrouter_model_tertiary = this.getString('openrouter_model_tertiary');

    settings.temperature = this.getNumber('temperature');
    settings.max_tokens = this.getNumber('max_tokens');

    // Available models (cached)
    settings.openai_models = this.getArray<string>('openai_models');
    settings.anthropic_models = this.getArray<string>('anthropic_models');
    settings.google_models = this.getArray<string>('google_models');
    settings.openrouter_models = this.getArray<string>('openrouter_models');

    // UI Settings
    const theme = this.getString('theme');
    if (theme === 'dark' || theme === 'light' || theme === 'auto') {
      settings.theme = theme;
    }
    const fontSize = this.getString('font_size');
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
      this.set('openai_api_key', settings.openai_api_key);
    }
    if (settings.anthropic_api_key !== undefined) {
      this.set('anthropic_api_key', settings.anthropic_api_key);
    }
    if (settings.google_api_key !== undefined) {
      this.set('google_api_key', settings.google_api_key);
    }
    if (settings.openrouter_api_key !== undefined) {
      this.set('openrouter_api_key', settings.openrouter_api_key);
    }

    // Default AI Provider (with fallbacks)
    if (settings.default_ai_provider !== undefined) {
      this.set('default_ai_provider', settings.default_ai_provider);
    }
    if (settings.default_ai_provider_secondary !== undefined) {
      this.set('default_ai_provider_secondary', settings.default_ai_provider_secondary);
    }
    if (settings.default_ai_provider_tertiary !== undefined) {
      this.set('default_ai_provider_tertiary', settings.default_ai_provider_tertiary);
    }

    // AI Model Settings (primary)
    if (settings.default_model !== undefined) {
      this.set('default_model', settings.default_model);
    }
    if (settings.openai_model !== undefined) {
      this.set('openai_model', settings.openai_model);
    }
    if (settings.anthropic_model !== undefined) {
      this.set('anthropic_model', settings.anthropic_model);
    }
    if (settings.google_model !== undefined) {
      this.set('google_model', settings.google_model);
    }
    if (settings.openrouter_model !== undefined) {
      this.set('openrouter_model', settings.openrouter_model);
    }

    // AI Model Settings (secondary fallback)
    if (settings.openai_model_secondary !== undefined) {
      this.set('openai_model_secondary', settings.openai_model_secondary);
    }
    if (settings.anthropic_model_secondary !== undefined) {
      this.set('anthropic_model_secondary', settings.anthropic_model_secondary);
    }
    if (settings.google_model_secondary !== undefined) {
      this.set('google_model_secondary', settings.google_model_secondary);
    }
    if (settings.openrouter_model_secondary !== undefined) {
      this.set('openrouter_model_secondary', settings.openrouter_model_secondary);
    }

    // AI Model Settings (tertiary fallback)
    if (settings.openai_model_tertiary !== undefined) {
      this.set('openai_model_tertiary', settings.openai_model_tertiary);
    }
    if (settings.anthropic_model_tertiary !== undefined) {
      this.set('anthropic_model_tertiary', settings.anthropic_model_tertiary);
    }
    if (settings.google_model_tertiary !== undefined) {
      this.set('google_model_tertiary', settings.google_model_tertiary);
    }
    if (settings.openrouter_model_tertiary !== undefined) {
      this.set('openrouter_model_tertiary', settings.openrouter_model_tertiary);
    }

    if (settings.temperature !== undefined) {
      this.set('temperature', settings.temperature);
    }
    if (settings.max_tokens !== undefined) {
      this.set('max_tokens', settings.max_tokens);
    }

    // Available models (cached)
    if (settings.openai_models !== undefined) {
      this.set('openai_models', settings.openai_models);
    }
    if (settings.anthropic_models !== undefined) {
      this.set('anthropic_models', settings.anthropic_models);
    }
    if (settings.google_models !== undefined) {
      this.set('google_models', settings.google_models);
    }
    if (settings.openrouter_models !== undefined) {
      this.set('openrouter_models', settings.openrouter_models);
    }

    // UI Settings
    if (settings.theme !== undefined) {
      this.set('theme', settings.theme);
    }
    if (settings.font_size !== undefined) {
      this.set('font_size', settings.font_size);
    }

    // Study Settings
    if (settings.questions_per_session !== undefined) {
      this.set('questions_per_session', settings.questions_per_session);
    }
    if (settings.show_explanations !== undefined) {
      this.set('show_explanations', settings.show_explanations);
    }
    if (settings.shuffle_questions !== undefined) {
      this.set('shuffle_questions', settings.shuffle_questions);
    }
  }

  /**
   * Reset all settings to defaults
   */
  resetToDefaults(): void {
    const stmt = this.db.getDatabase().prepare('DELETE FROM settings');
    stmt.run();
    this.cache.clear();

    // Set default values
    this.set('theme', 'dark');
    this.set('font_size', 'medium');
    this.set('questions_per_session', 20);
    this.set('show_explanations', true);
    this.set('shuffle_questions', true);
    this.set('temperature', 0.7);
    this.set('max_tokens', 64000);
  }

  /**
   * Check if an API key is configured for a provider
   */
  hasApiKey(provider: 'openai' | 'anthropic' | 'google' | 'openrouter'): boolean {
    const key = this.getString(`${provider}_api_key`);
    return !!key && key.length > 0;
  }

  /**
   * Get the default AI provider or the first one with an API key
   */
  getDefaultProvider(): string | undefined {
    const defaultProvider = this.getString('default_ai_provider');
    if (defaultProvider && this.hasApiKey(defaultProvider as 'openai' | 'anthropic' | 'google' | 'openrouter')) {
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
