import { OpenAIProvider } from './OpenAIProvider';

/**
 * OpenRouter provider - uses OpenAI-compatible API
 */
export class OpenRouterProvider extends OpenAIProvider {
  constructor(apiKey: string, endpoint: string = 'https://openrouter.ai/api/v1') {
    super(apiKey, endpoint);
    this.providerType = 'openrouter';
    this.name = 'OpenRouter';
  }

  async listModels(): Promise<string[]> {
    const response = await this.makeRequest<{ data: Array<{ id: string }> }>(
      `${this.endpoint}/models`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    return response.data.map(model => model.id);
  }
}
