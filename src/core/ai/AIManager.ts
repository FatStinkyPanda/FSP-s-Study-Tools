import { BaseAIProvider } from './BaseProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GoogleAIProvider } from './GoogleAIProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import {
  AIProviderType,
  AICompletionRequest,
  AICompletionResponse,
  AIStreamChunk,
  AIConfiguration,
  AIProviderConfig,
  AIProviderError,
} from '../../shared/ai-types';

export class AIManager {
  private providers: Map<AIProviderType, BaseAIProvider> = new Map();
  private defaultProvider: AIProviderType = 'openai';
  private defaultModel: string = 'gpt-4-turbo-preview';
  private defaultTemperature: number = 0.7;
  private defaultMaxTokens: number = 2048;

  constructor(configuration?: AIConfiguration) {
    if (configuration) {
      this.loadConfiguration(configuration);
    }
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
    if (model.startsWith('gpt-')) return 'openai';
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('gemini-')) return 'google';
    if (model.includes('/')) return 'openrouter'; // OpenRouter models are namespaced

    return this.defaultProvider;
  }

  /**
   * Create a completion
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
    const provider = this.getProvider(providerType);

    try {
      return await provider.createCompletion(fullRequest);
    } catch (error) {
      if (error instanceof AIProviderError) {
        throw error;
      }

      throw new AIProviderError(
        `Completion failed: ${(error as Error).message}`,
        providerType,
        undefined,
        error as Error
      );
    }
  }

  /**
   * Create a streaming completion
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
    const provider = this.getProvider(providerType);

    try {
      yield* provider.createStreamingCompletion(fullRequest);
    } catch (error) {
      if (error instanceof AIProviderError) {
        throw error;
      }

      throw new AIProviderError(
        `Streaming completion failed: ${(error as Error).message}`,
        providerType,
        undefined,
        error as Error
      );
    }
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
          console.error(`Failed to list models for ${type}:`, error);
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
        console.error(`Failed to validate ${type}:`, error);
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
        apiKey: settings.openai_api_key,
        enabled: true,
      });
    }

    // Configure Anthropic if API key present
    if (settings.anthropic_api_key && settings.anthropic_api_key.length > 0) {
      this.addProvider({
        type: 'anthropic',
        apiKey: settings.anthropic_api_key,
        enabled: true,
      });
    }

    // Configure Google AI if API key present
    if (settings.google_api_key && settings.google_api_key.length > 0) {
      this.addProvider({
        type: 'google',
        apiKey: settings.google_api_key,
        enabled: true,
      });
    }

    // Configure OpenRouter if API key present
    if (settings.openrouter_api_key && settings.openrouter_api_key.length > 0) {
      this.addProvider({
        type: 'openrouter',
        apiKey: settings.openrouter_api_key,
        enabled: true,
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
   * Get list of configured providers
   */
  getConfiguredProviders(): AIProviderType[] {
    return Array.from(this.providers.keys());
  }
}
