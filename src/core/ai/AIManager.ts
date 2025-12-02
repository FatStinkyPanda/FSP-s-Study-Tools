import { BaseAIProvider } from './BaseProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GoogleAIProvider } from './GoogleAIProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import { LocalAIProvider } from './LocalAIProvider';
import {
  AIProviderType,
  AICompletionRequest,
  AICompletionResponse,
  AIStreamChunk,
  AIConfiguration,
  AIProviderConfig,
  AIProviderError,
  LocalModelConfig,
} from '../../shared/ai-types';
import { createLogger } from '../../shared/logger';

const log = createLogger('AIManager');

// Fallback configuration for a provider
interface ProviderFallbackConfig {
  primary: string;
  secondary?: string;
  tertiary?: string;
}

export class AIManager {
  private providers: Map<AIProviderType, BaseAIProvider> = new Map();
  private localProvider: LocalAIProvider | null = null;
  private defaultProvider: AIProviderType = 'openai';
  private defaultProviderSecondary?: AIProviderType;
  private defaultProviderTertiary?: AIProviderType;
  private defaultModel: string = 'gpt-4-turbo-preview';
  private defaultTemperature: number = 0.7;
  private defaultMaxTokens: number = 2048;

  // Fallback models per provider
  private fallbackModels: Map<AIProviderType, ProviderFallbackConfig> = new Map();

  constructor(configuration?: AIConfiguration) {
    // Initialize local provider by default
    this.initializeLocalProvider();

    if (configuration) {
      this.loadConfiguration(configuration);
    }
  }

  /**
   * Initialize local AI provider
   */
  private initializeLocalProvider(modelsDirectory?: string): void {
    this.localProvider = new LocalAIProvider(modelsDirectory);
    this.providers.set('local', this.localProvider);
  }

  /**
   * Load configuration and initialize providers
   */
  loadConfiguration(config: AIConfiguration): void {
    this.defaultProvider = config.defaultProvider;
    this.defaultModel = config.defaultModel;
    this.defaultTemperature = config.temperature;
    this.defaultMaxTokens = config.maxTokens;

    for (const providerConfig of config.providers) {
      if (providerConfig.enabled) {
        this.addProvider(providerConfig);
      }
    }
  }

  /**
   * Add a provider
   */
  addProvider(config: AIProviderConfig): void {
    let provider: BaseAIProvider;

    switch (config.type) {
      case 'openai':
        provider = new OpenAIProvider(config.apiKey, config.endpoint);
        break;

      case 'anthropic':
        provider = new AnthropicProvider(config.apiKey, config.endpoint);
        break;

      case 'google':
        provider = new GoogleAIProvider(config.apiKey, config.endpoint);
        break;

      case 'openrouter':
        provider = new OpenRouterProvider(config.apiKey, config.endpoint);
        break;

      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }

    this.providers.set(config.type, provider);
  }

  /**
   * Get a provider by type
   */
  getProvider(type: AIProviderType): BaseAIProvider {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Provider ${type} not configured`);
    }
    return provider;
  }

  /**
   * Determine provider from model name
   */
  private determineProvider(model: string): AIProviderType {
    if (model.startsWith('local:')) return 'local';
    if (model.startsWith('gpt-')) return 'openai';
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('gemini-')) return 'google';
    if (model.includes('/')) return 'openrouter'; // OpenRouter models are namespaced

    return this.defaultProvider;
  }

  /**
   * Check if an error is retryable (overloaded, rate limited, capacity issues)
   */
  private isRetryableError(error: unknown): boolean {
    const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const retryablePatterns = [
      'overloaded',
      'rate limit',
      'rate_limit',
      'too many requests',
      '429',
      '503',
      'capacity',
      'temporarily unavailable',
      'server error',
      'service unavailable',
      'timeout',
      'econnreset',
      'fetch failed',
    ];
    return retryablePatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Get fallback models for a provider in order of priority
   */
  private getFallbackModels(providerType: AIProviderType, currentModel: string): string[] {
    const fallbacks: string[] = [];
    const config = this.fallbackModels.get(providerType);

    if (config) {
      // Add secondary and tertiary models from the same provider
      if (config.secondary && config.secondary !== currentModel) {
        fallbacks.push(config.secondary);
      }
      if (config.tertiary && config.tertiary !== currentModel) {
        fallbacks.push(config.tertiary);
      }
    }

    return fallbacks;
  }

  /**
   * Get fallback providers in order of priority
   */
  private getFallbackProviders(currentProvider: AIProviderType): AIProviderType[] {
    const fallbacks: AIProviderType[] = [];

    if (this.defaultProviderSecondary && this.defaultProviderSecondary !== currentProvider && this.providers.has(this.defaultProviderSecondary)) {
      fallbacks.push(this.defaultProviderSecondary);
    }
    if (this.defaultProviderTertiary && this.defaultProviderTertiary !== currentProvider && this.providers.has(this.defaultProviderTertiary)) {
      fallbacks.push(this.defaultProviderTertiary);
    }

    return fallbacks;
  }

  /**
   * Get the default model for a provider
   */
  private getDefaultModelForProvider(providerType: AIProviderType): string {
    const config = this.fallbackModels.get(providerType);
    if (config?.primary) {
      return config.primary;
    }

    // Fallback defaults
    switch (providerType) {
      case 'openai': return 'gpt-4-turbo-preview';
      case 'anthropic': return 'claude-3-5-sonnet-20241022';
      case 'google': return 'gemini-2.5-flash';
      case 'openrouter': return 'anthropic/claude-3.5-sonnet';
      default: return this.defaultModel;
    }
  }

  /**
   * Create a completion with automatic fallback support
   */
  async createCompletion(request: Partial<AICompletionRequest>): Promise<AICompletionResponse> {
    const fullRequest: AICompletionRequest = {
      model: request.model || this.defaultModel,
      messages: request.messages || [],
      temperature: request.temperature ?? this.defaultTemperature,
      maxTokens: request.maxTokens ?? this.defaultMaxTokens,
      topP: request.topP,
      frequencyPenalty: request.frequencyPenalty,
      presencePenalty: request.presencePenalty,
      stop: request.stop,
      tools: request.tools,
      toolChoice: request.toolChoice,
    };

    const providerType = this.determineProvider(fullRequest.model);
    const attempts: Array<{ provider: AIProviderType; model: string; error?: Error }> = [];

    // Build fallback chain: current model -> fallback models in same provider -> fallback providers
    const fallbackChain: Array<{ provider: AIProviderType; model: string }> = [
      { provider: providerType, model: fullRequest.model }
    ];

    // Add fallback models for current provider
    const fallbackModels = this.getFallbackModels(providerType, fullRequest.model);
    for (const model of fallbackModels) {
      fallbackChain.push({ provider: providerType, model });
    }

    // Add fallback providers with their primary models
    const fallbackProviders = this.getFallbackProviders(providerType);
    for (const fallbackProvider of fallbackProviders) {
      const primaryModel = this.getDefaultModelForProvider(fallbackProvider);
      fallbackChain.push({ provider: fallbackProvider, model: primaryModel });

      // Also add fallback models for the fallback provider
      const providerFallbackModels = this.getFallbackModels(fallbackProvider, primaryModel);
      for (const model of providerFallbackModels) {
        fallbackChain.push({ provider: fallbackProvider, model });
      }
    }

    // Try each option in the fallback chain
    let lastError: Error | undefined;
    for (const option of fallbackChain) {
      try {
        const provider = this.providers.get(option.provider);
        if (!provider) {
          continue;
        }

        const requestWithModel = { ...fullRequest, model: option.model };
        const result = await provider.createCompletion(requestWithModel);

        // Log if we used a fallback
        if (attempts.length > 0) {
          log.info(`Successfully used fallback: ${option.provider}/${option.model} after ${attempts.length} failed attempt(s)`);
        }

        return result;
      } catch (error) {
        lastError = error as Error;
        attempts.push({ provider: option.provider, model: option.model, error: lastError });

        // Only continue to fallback if error is retryable
        if (!this.isRetryableError(error)) {
          break;
        }

        log.debug(`Retryable error with ${option.provider}/${option.model}: ${lastError.message}. Trying fallback...`);
      }
    }

    // All fallbacks failed
    if (lastError instanceof AIProviderError) {
      throw lastError;
    }

    throw new AIProviderError(
      `Completion failed after ${attempts.length} attempt(s): ${lastError?.message || 'Unknown error'}`,
      providerType,
      undefined,
      lastError
    );
  }

  /**
   * Create a streaming completion with automatic fallback support
   */
  async *createStreamingCompletion(
    request: Partial<AICompletionRequest>
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    const fullRequest: AICompletionRequest = {
      model: request.model || this.defaultModel,
      messages: request.messages || [],
      temperature: request.temperature ?? this.defaultTemperature,
      maxTokens: request.maxTokens ?? this.defaultMaxTokens,
      topP: request.topP,
      frequencyPenalty: request.frequencyPenalty,
      presencePenalty: request.presencePenalty,
      stop: request.stop,
      tools: request.tools,
      toolChoice: request.toolChoice,
    };

    const providerType = this.determineProvider(fullRequest.model);
    const attempts: Array<{ provider: AIProviderType; model: string; error?: Error }> = [];

    // Build fallback chain: current model -> fallback models in same provider -> fallback providers
    const fallbackChain: Array<{ provider: AIProviderType; model: string }> = [
      { provider: providerType, model: fullRequest.model }
    ];

    // Add fallback models for current provider
    const fallbackModels = this.getFallbackModels(providerType, fullRequest.model);
    for (const model of fallbackModels) {
      fallbackChain.push({ provider: providerType, model });
    }

    // Add fallback providers with their primary models
    const fallbackProviders = this.getFallbackProviders(providerType);
    for (const fallbackProvider of fallbackProviders) {
      const primaryModel = this.getDefaultModelForProvider(fallbackProvider);
      fallbackChain.push({ provider: fallbackProvider, model: primaryModel });

      // Also add fallback models for the fallback provider
      const providerFallbackModels = this.getFallbackModels(fallbackProvider, primaryModel);
      for (const model of providerFallbackModels) {
        fallbackChain.push({ provider: fallbackProvider, model });
      }
    }

    // Try each option in the fallback chain
    let lastError: Error | undefined;
    for (const option of fallbackChain) {
      try {
        const provider = this.providers.get(option.provider);
        if (!provider) {
          continue;
        }

        const requestWithModel = { ...fullRequest, model: option.model };

        // Log if we're using a fallback
        if (attempts.length > 0) {
          log.info(`Trying fallback: ${option.provider}/${option.model} after ${attempts.length} failed attempt(s)`);
        }

        yield* provider.createStreamingCompletion(requestWithModel);
        return; // Success - exit the generator
      } catch (error) {
        lastError = error as Error;
        attempts.push({ provider: option.provider, model: option.model, error: lastError });

        // Only continue to fallback if error is retryable
        if (!this.isRetryableError(error)) {
          break;
        }

        log.debug(`Retryable error with ${option.provider}/${option.model}: ${lastError.message}. Trying fallback...`);
      }
    }

    // All fallbacks failed
    if (lastError instanceof AIProviderError) {
      throw lastError;
    }

    throw new AIProviderError(
      `Streaming completion failed after ${attempts.length} attempt(s): ${lastError?.message || 'Unknown error'}`,
      providerType,
      undefined,
      lastError
    );
  }

  /**
   * List available models for a provider
   */
  async listModels(providerType?: AIProviderType): Promise<Map<AIProviderType, string[]>> {
    const result = new Map<AIProviderType, string[]>();

    if (providerType) {
      const provider = this.getProvider(providerType);
      const models = await provider.listModels();
      result.set(providerType, models);
    } else {
      for (const [type, provider] of this.providers.entries()) {
        try {
          const models = await provider.listModels();
          result.set(type, models);
        } catch (error) {
          log.error(`Failed to list models for ${type}:`, error);
          result.set(type, []);
        }
      }
    }

    return result;
  }

  /**
   * Validate all configured providers
   */
  async validateProviders(): Promise<Map<AIProviderType, boolean>> {
    const results = new Map<AIProviderType, boolean>();

    for (const [type, provider] of this.providers.entries()) {
      try {
        const isValid = await provider.validateApiKey();
        results.set(type, isValid);
      } catch (error) {
        log.error(`Failed to validate ${type}:`, error);
        results.set(type, false);
      }
    }

    return results;
  }

  /**
   * Get provider information
   */
  getProviderInfo(type: AIProviderType): { type: AIProviderType; name: string; endpoint: string } {
    const provider = this.getProvider(type);
    return provider.getInfo();
  }

  /**
   * Get list of configured providers
   */
  getConfiguredProviders(): AIProviderType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is configured
   */
  isProviderConfigured(type: AIProviderType): boolean {
    return this.providers.has(type);
  }

  /**
   * Get default settings
   */
  getDefaults(): {
    provider: AIProviderType;
    model: string;
    temperature: number;
    maxTokens: number;
  } {
    return {
      provider: this.defaultProvider,
      model: this.defaultModel,
      temperature: this.defaultTemperature,
      maxTokens: this.defaultMaxTokens,
    };
  }

  /**
   * Update default settings
   */
  updateDefaults(settings: Partial<{
    provider: AIProviderType;
    model: string;
    temperature: number;
    maxTokens: number;
  }>): void {
    if (settings.provider !== undefined) {
      this.defaultProvider = settings.provider;
    }
    if (settings.model !== undefined) {
      this.defaultModel = settings.model;
    }
    if (settings.temperature !== undefined) {
      this.defaultTemperature = settings.temperature;
    }
    if (settings.maxTokens !== undefined) {
      this.defaultMaxTokens = settings.maxTokens;
    }
  }

  /**
   * Configure providers from app settings
   * This method loads API keys from settings and initializes available providers
   */
  configureFromSettings(settings: {
    openai_api_key?: string;
    anthropic_api_key?: string;
    google_api_key?: string;
    openrouter_api_key?: string;
    default_ai_provider?: 'openai' | 'anthropic' | 'google' | 'openrouter';
    default_model?: string;
    temperature?: number;
    max_tokens?: number;
  }): void {
    // Clear existing providers
    this.providers.clear();

    // Configure OpenAI if API key present
    if (settings.openai_api_key && settings.openai_api_key.length > 0) {
      this.addProvider({
        type: 'openai',
        name: 'OpenAI',
        endpoint: 'https://api.openai.com/v1',
        apiKey: settings.openai_api_key,
        enabled: true,
        models: [],
      });
    }

    // Configure Anthropic if API key present
    if (settings.anthropic_api_key && settings.anthropic_api_key.length > 0) {
      this.addProvider({
        type: 'anthropic',
        name: 'Anthropic',
        endpoint: 'https://api.anthropic.com/v1',
        apiKey: settings.anthropic_api_key,
        enabled: true,
        models: [],
      });
    }

    // Configure Google AI if API key present
    // Note: v1beta is required for function calling support
    if (settings.google_api_key && settings.google_api_key.length > 0) {
      this.addProvider({
        type: 'google',
        name: 'Google AI',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: settings.google_api_key,
        enabled: true,
        models: [],
      });
    }

    // Configure OpenRouter if API key present
    if (settings.openrouter_api_key && settings.openrouter_api_key.length > 0) {
      this.addProvider({
        type: 'openrouter',
        name: 'OpenRouter',
        endpoint: 'https://openrouter.ai/api/v1',
        apiKey: settings.openrouter_api_key,
        enabled: true,
        models: [],
      });
    }

    // Set default provider if specified, otherwise use first available
    if (settings.default_ai_provider && this.providers.has(settings.default_ai_provider)) {
      this.defaultProvider = settings.default_ai_provider;
    } else {
      // Use first available provider as default
      const availableProviders: AIProviderType[] = ['openai', 'anthropic', 'google', 'openrouter'];
      for (const provider of availableProviders) {
        if (this.providers.has(provider)) {
          this.defaultProvider = provider;
          break;
        }
      }
    }

    // Update other defaults if provided
    if (settings.default_model) {
      this.defaultModel = settings.default_model;
    }
    if (settings.temperature !== undefined) {
      this.defaultTemperature = settings.temperature;
    }
    if (settings.max_tokens !== undefined) {
      this.defaultMaxTokens = settings.max_tokens;
    }
  }

  /**
   * Add a local model configuration
   */
  addLocalModel(config: LocalModelConfig): void {
    if (!this.localProvider) {
      throw new Error('Local provider not initialized');
    }
    this.localProvider.addModelConfig(config);
  }

  /**
   * Load a local model into memory
   */
  async loadLocalModel(modelId: string): Promise<void> {
    if (!this.localProvider) {
      throw new Error('Local provider not initialized');
    }
    await this.localProvider.loadModel(modelId);
  }

  /**
   * Unload a local model from memory
   */
  async unloadLocalModel(modelId: string): Promise<void> {
    if (!this.localProvider) {
      throw new Error('Local provider not initialized');
    }
    await this.localProvider.unloadModel(modelId);
  }

  /**
   * Get list of configured local models
   */
  listLocalModels(): string[] {
    if (!this.localProvider) {
      return [];
    }
    return this.localProvider.getLoadedModels();
  }

  /**
   * Check if a local model is loaded
   */
  isLocalModelLoaded(modelId: string): boolean {
    if (!this.localProvider) {
      return false;
    }
    return this.localProvider.isModelLoaded(modelId);
  }

  /**
   * Get local model configuration
   */
  getLocalModelConfig(modelId: string): LocalModelConfig | undefined {
    if (!this.localProvider) {
      return undefined;
    }
    return this.localProvider.getModelConfig(modelId);
  }

  /**
   * Set local models directory
   */
  setLocalModelsDirectory(directory: string): void {
    if (!this.localProvider) {
      this.initializeLocalProvider(directory);
    } else {
      this.localProvider.setModelsDirectory(directory);
    }
  }

  /**
   * Get local models directory
   */
  getLocalModelsDirectory(): string | undefined {
    if (!this.localProvider) {
      return undefined;
    }
    return this.localProvider.getModelsDirectory();
  }
}
