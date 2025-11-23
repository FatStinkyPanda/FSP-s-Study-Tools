import {
  AIProviderType,
  AICompletionRequest,
  AICompletionResponse,
  AIStreamChunk,
  AIProviderError,
  AIRateLimitError,
  AIAuthenticationError,
  AIMessage,
} from '../../shared/ai-types';

export abstract class BaseAIProvider {
  protected apiKey: string;
  protected endpoint: string;
  protected providerType: AIProviderType;
  protected name: string;

  constructor(
    providerType: AIProviderType,
    name: string,
    endpoint: string,
    apiKey: string
  ) {
    this.providerType = providerType;
    this.name = name;
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  /**
   * Create a completion (non-streaming)
   */
  abstract createCompletion(request: AICompletionRequest): Promise<AICompletionResponse>;

  /**
   * Create a streaming completion
   */
  abstract createStreamingCompletion(
    request: AICompletionRequest
  ): AsyncGenerator<AIStreamChunk, void, unknown>;

  /**
   * List available models
   */
  abstract listModels(): Promise<string[]>;

  /**
   * Validate API key
   */
  abstract validateApiKey(): Promise<boolean>;

  /**
   * Get provider information
   */
  getInfo(): { type: AIProviderType; name: string; endpoint: string } {
    return {
      type: this.providerType,
      name: this.name,
      endpoint: this.endpoint,
    };
  }

  /**
   * Make HTTP request with error handling
   */
  protected async makeRequest<T>(
    url: string,
    options: RequestInit
  ): Promise<T> {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof AIProviderError) {
        throw error;
      }

      throw new AIProviderError(
        `Request failed: ${(error as Error).message}`,
        this.providerType,
        undefined,
        error as Error
      );
    }
  }

  /**
   * Handle error responses
   */
  protected async handleErrorResponse(response: Response): Promise<never> {
    const statusCode = response.status;
    let errorMessage = `HTTP ${statusCode}: ${response.statusText}`;

    try {
      const errorData = await response.json() as { error?: { message?: string }; message?: string };
      errorMessage = errorData.error?.message || errorData.message || errorMessage;
    } catch {
      // Use default error message if JSON parsing fails
    }

    if (statusCode === 429) {
      const retryAfter = response.headers.get('retry-after');
      throw new AIRateLimitError(
        this.providerType,
        retryAfter ? parseInt(retryAfter, 10) : undefined
      );
    }

    if (statusCode === 401 || statusCode === 403) {
      throw new AIAuthenticationError(this.providerType);
    }

    throw new AIProviderError(
      errorMessage,
      this.providerType,
      statusCode
    );
  }

  /**
   * Convert messages to provider-specific format
   */
  protected abstract convertMessages(messages: AIMessage[]): unknown;

  /**
   * Convert provider response to standard format
   */
  protected abstract convertResponse(response: unknown): AICompletionResponse;

  /**
   * Estimate token count (rough approximation)
   */
  protected estimateTokens(text: string): number {
    // Rough approximation: ~4 characters per token for English
    return Math.ceil(text.length / 4);
  }

  /**
   * Validate request before sending
   */
  protected validateRequest(request: AICompletionRequest): void {
    if (!request.model) {
      throw new Error('Model is required');
    }

    if (!request.messages || request.messages.length === 0) {
      throw new Error('Messages array cannot be empty');
    }

    if (request.temperature !== undefined) {
      if (request.temperature < 0 || request.temperature > 2) {
        throw new Error('Temperature must be between 0 and 2');
      }
    }

    if (request.maxTokens !== undefined && request.maxTokens <= 0) {
      throw new Error('Max tokens must be positive');
    }
  }
}
