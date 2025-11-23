import { BaseAIProvider } from './BaseProvider';
import {
  AICompletionRequest,
  AICompletionResponse,
  AIStreamChunk,
  AIMessage,
} from '../../shared/ai-types';

interface OpenAIMessage {
  role: string;
  content: string;
  name?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider extends BaseAIProvider {
  constructor(apiKey: string, endpoint: string = 'https://api.openai.com/v1') {
    super('openai', 'OpenAI', endpoint, apiKey);
  }

  async createCompletion(request: AICompletionRequest): Promise<AICompletionResponse> {
    this.validateRequest(request);

    const openaiRequest = {
      model: request.model,
      messages: this.convertMessages(request.messages),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      frequency_penalty: request.frequencyPenalty,
      presence_penalty: request.presencePenalty,
      stop: request.stop,
      tools: request.tools,
      tool_choice: request.toolChoice,
      stream: false,
    };

    const response = await this.makeRequest<OpenAIResponse>(
      `${this.endpoint}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(openaiRequest),
      }
    );

    return this.convertResponse(response);
  }

  async *createStreamingCompletion(
    request: AICompletionRequest
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    this.validateRequest(request);

    const openaiRequest = {
      model: request.model,
      messages: this.convertMessages(request.messages),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      frequency_penalty: request.frequencyPenalty,
      presence_penalty: request.presencePenalty,
      stop: request.stop,
      tools: request.tools,
      tool_choice: request.toolChoice,
      stream: true,
    };

    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(openaiRequest),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;

            try {
              const parsed = JSON.parse(data);
              yield {
                id: parsed.id,
                model: parsed.model,
                created: parsed.created,
                choices: parsed.choices.map((choice: { index: number; delta: Partial<OpenAIMessage>; finish_reason: string | null }) => ({
                  index: choice.index,
                  delta: {
                    role: choice.delta.role as 'assistant' | undefined,
                    content: choice.delta.content,
                    tool_calls: choice.delta.tool_calls,
                  },
                  finishReason: choice.finish_reason,
                })),
              };
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
    const response = await this.makeRequest<{ data: Array<{ id: string }> }>(
      `${this.endpoint}/models`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    return response.data
      .map(model => model.id)
      .filter(id => id.startsWith('gpt-'));
  }

  async validateApiKey(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch (error) {
      return false;
    }
  }

  protected convertMessages(messages: AIMessage[]): OpenAIMessage[] {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      name: msg.name,
      tool_calls: msg.tool_calls,
      tool_call_id: msg.tool_call_id,
    }));
  }

  protected convertResponse(response: OpenAIResponse): AICompletionResponse {
    return {
      id: response.id,
      model: response.model,
      created: response.created,
      choices: response.choices.map(choice => ({
        index: choice.index,
        message: {
          role: choice.message.role as 'assistant',
          content: choice.message.content,
          name: choice.message.name,
          tool_calls: choice.message.tool_calls as never,
        },
        finishReason: choice.finish_reason as 'stop' | 'length' | 'tool_calls' | 'content_filter' | null,
      })),
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
    };
  }
}
