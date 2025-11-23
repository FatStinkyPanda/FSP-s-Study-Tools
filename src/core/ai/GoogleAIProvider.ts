import { BaseAIProvider } from './BaseProvider';
import {
  AICompletionRequest,
  AICompletionResponse,
  AIStreamChunk,
  AIMessage,
} from '../../shared/ai-types';

interface GoogleMessage {
  role: string;
  parts: Array<{ text: string }>;
}

interface GoogleResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
    index: number;
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GoogleAIProvider extends BaseAIProvider {
  constructor(apiKey: string, endpoint: string = 'https://generativelanguage.googleapis.com/v1beta') {
    super('google', 'Google AI', endpoint, apiKey);
  }

  async createCompletion(request: AICompletionRequest): Promise<AICompletionResponse> {
    this.validateRequest(request);

    const googleRequest = {
      contents: this.convertMessages(request.messages),
      generationConfig: {
        temperature: request.temperature ?? 1.0,
        maxOutputTokens: request.maxTokens,
        topP: request.topP,
        stopSequences: request.stop,
      },
    };

    const response = await this.makeRequest<GoogleResponse>(
      `${this.endpoint}/models/${request.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        body: JSON.stringify(googleRequest),
      }
    );

    return this.convertResponse(response);
  }

  async *createStreamingCompletion(
    request: AICompletionRequest
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    this.validateRequest(request);

    const googleRequest = {
      contents: this.convertMessages(request.messages),
      generationConfig: {
        temperature: request.temperature ?? 1.0,
        maxOutputTokens: request.maxTokens,
        topP: request.topP,
        stopSequences: request.stop,
      },
    };

    const response = await fetch(
      `${this.endpoint}/models/${request.model}:streamGenerateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(googleRequest),
      }
    );

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
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('{')) continue;

          try {
            const parsed = JSON.parse(trimmed);

            if (parsed.candidates && parsed.candidates.length > 0) {
              const candidate = parsed.candidates[0];
              const text = candidate.content?.parts?.[0]?.text || '';

              yield {
                id: 'google-stream',
                model: request.model,
                created: Date.now(),
                choices: [{
                  index: 0,
                  delta: {
                    content: text,
                  },
                  finishReason: candidate.finishReason === 'STOP' ? 'stop' : null,
                }],
              };
            }
          } catch (error) {
            console.error('Failed to parse streaming chunk:', error);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<string[]> {
    const response = await this.makeRequest<{ models: Array<{ name: string }> }>(
      `${this.endpoint}/models?key=${this.apiKey}`,
      {
        method: 'GET',
      }
    );

    return response.models
      .map(model => model.name.replace('models/', ''))
      .filter(name => name.startsWith('gemini'));
  }

  async validateApiKey(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch (error) {
      return false;
    }
  }

  protected convertMessages(messages: AIMessage[]): GoogleMessage[] {
    return messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));
  }

  protected convertResponse(response: GoogleResponse): AICompletionResponse {
    const candidate = response.candidates[0];
    const text = candidate.content.parts.map(p => p.text).join('');

    return {
      id: 'google-' + Date.now(),
      model: 'gemini',
      created: Date.now(),
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: text,
        },
        finishReason: candidate.finishReason === 'STOP' ? 'stop' : null,
      }],
      usage: {
        promptTokens: response.usageMetadata.promptTokenCount,
        completionTokens: response.usageMetadata.candidatesTokenCount,
        totalTokens: response.usageMetadata.totalTokenCount,
      },
    };
  }
}
