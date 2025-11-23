import { BaseAIProvider } from './BaseProvider';
import {
  AICompletionRequest,
  AICompletionResponse,
  AIStreamChunk,
  AIMessage,
} from '../../shared/ai-types';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProvider extends BaseAIProvider {
  private anthropicVersion: string = '2023-06-01';

  constructor(apiKey: string, endpoint: string = 'https://api.anthropic.com') {
    super('anthropic', 'Anthropic', endpoint, apiKey);
  }

  async createCompletion(request: AICompletionRequest): Promise<AICompletionResponse> {
    this.validateRequest(request);

    const { system, messages } = this.extractSystemMessage(request.messages);

    const anthropicRequest = {
      model: request.model,
      messages: this.convertMessages(messages),
      system,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 1.0,
      top_p: request.topP,
      stop_sequences: request.stop,
      stream: false,
    };

    const response = await this.makeRequest<AnthropicResponse>(
      `${this.endpoint}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': this.anthropicVersion,
        },
        body: JSON.stringify(anthropicRequest),
      }
    );

    return this.convertResponse(response);
  }

  async *createStreamingCompletion(
    request: AICompletionRequest
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    this.validateRequest(request);

    const { system, messages } = this.extractSystemMessage(request.messages);

    const anthropicRequest = {
      model: request.model,
      messages: this.convertMessages(messages),
      system,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 1.0,
      top_p: request.topP,
      stop_sequences: request.stop,
      stream: true,
    };

    const response = await fetch(`${this.endpoint}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.anthropicVersion,
      },
      body: JSON.stringify(anthropicRequest),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'content_block_delta') {
                yield {
                  id: parsed.id || 'stream',
                  model: request.model,
                  created: Date.now(),
                  choices: [{
                    index: 0,
                    delta: {
                      content: parsed.delta?.text || '',
                    },
                    finishReason: null,
                  }],
                };
              } else if (parsed.type === 'message_stop') {
                yield {
                  id: parsed.id || 'stream',
                  model: request.model,
                  created: Date.now(),
                  choices: [{
                    index: 0,
                    delta: {},
                    finishReason: 'stop',
                  }],
                };
              }
            } catch (error) {
              console.error('Failed to parse streaming chunk:', error);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<string[]> {
    // Anthropic doesn't provide a models endpoint, return known models
    return [
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
      'claude-2.1',
      'claude-2.0',
      'claude-instant-1.2',
    ];
  }

  async validateApiKey(): Promise<boolean> {
    try {
      // Test with a minimal request
      await this.createCompletion({
        model: 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 10,
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  private extractSystemMessage(messages: AIMessage[]): {
    system?: string;
    messages: AIMessage[];
  } {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const system = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n\n')
      : undefined;

    return { system, messages: otherMessages };
  }

  protected convertMessages(messages: AIMessage[]): AnthropicMessage[] {
    return messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));
  }

  protected convertResponse(response: AnthropicResponse): AICompletionResponse {
    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    return {
      id: response.id,
      model: response.model,
      created: Date.now(),
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finishReason: response.stop_reason as 'stop' | 'length' | null,
      }],
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }
}
